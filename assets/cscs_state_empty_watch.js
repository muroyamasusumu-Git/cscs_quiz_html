// assets/cscs_state_empty_watch.js
//
// 【読み込み範囲に関する重要な注意（設計前提）】
//   - 本ファイルは Aパート / Bパートの【両方】に読み込まれている共通JSである。
//   - したがって、本ファイルに追加する処理・監視・副作用は、
//     A/B 両パートの挙動・ログ・ネットワーク通信に同時に影響を与える。
//   - デバッグ用の一時的な監視や、片側（Aのみ / Bのみ）を想定した処理を
//     ここに追加することは原則として避けること。
//   - 片側限定の監視を行いたい場合は、
//     ・A/B 専用JSに分離する
//     ・もしくは URL / part 判定を明示的に行った上でガードする
//     という設計対応が必要になる。
//
// 目的:
//   /api/sync/state のレスポンスヘッダを毎回チェックし、
//   「KV miss + empty template 返却」をブラウザコンソールで一発確定させる。

(function () {
  "use strict";

  // 二重実行防止（SPA / A-B 遷移対策）
  if (window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__) return;
  window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__ = true;

  // ============================================================
  // 追加した処理: init/state/merge の「一致だけ」を 1 行で確定する観測器
  // - 重要: ここでは merge を叩かない（副作用のある通信を増やさない）
  // - merge は B 側の通常動作で発生したものを fetch フックで“観測”するだけ
  // ============================================================
  var __CSCS_SYNC_CONS_STORE__ = {
    init: null,   // { user, key, key_rule_ok }
    state: null,  // { user, key, kv_binding, kv_identity, pages_deploy, pages_commit }
    merge: null,  // { user, key, kv_binding, kv_identity, pages_deploy, pages_commit }
    reported: false
  };

  function _normPath(u) {
    try { return new URL(String(u || ""), location.origin).pathname; } catch (_e) { return ""; }
  }

  function _lower(s) {
    try { return String(s || "").trim().toLowerCase(); } catch (_e) { return ""; }
  }

  function _hdrGet(h, name) {
    try {
      if (!h || typeof h.get !== "function") return "";
      var v = h.get(name);
      return v == null ? "" : String(v);
    } catch (_e) {
      return "";
    }
  }

  function _pickSyncHeaders(res) {
    var h = res && res.headers ? res.headers : null;
    return {
      user: _hdrGet(h, "X-CSCS-User"),
      key: _hdrGet(h, "X-CSCS-Key"),
      kv_binding: _hdrGet(h, "X-CSCS-KV-Binding"),
      kv_identity: _hdrGet(h, "X-CSCS-KV-Identity"),
      pages_deploy: _hdrGet(h, "X-CSCS-Pages-Deploy"),
      pages_commit: _hdrGet(h, "X-CSCS-Pages-Commit")
    };
  }

  function _checkKeyRule(userLower, key) {
    var u = _lower(userLower);
    var k = String(key || "").trim();
    if (!u || !k) return false;
    return k === ("sync:" + u);
  }

  function _maybeReportSyncConsistency() {
    if (__CSCS_SYNC_CONS_STORE__.reported) return;

    var init = __CSCS_SYNC_CONS_STORE__.init;
    var state = __CSCS_SYNC_CONS_STORE__.state;
    var merge = __CSCS_SYNC_CONS_STORE__.merge;

    // 必須:
    // - init/body から user+key が取れて key規則(sync:<email小文字>)が成立
    // - state のヘッダから user+key が取れて key規則が成立
    // - merge のヘッダから user+key が取れて key規則が成立（※mergeは自然発生の観測待ち）
    if (!init || !state || !merge) return;

    var uInit = _lower(init.user);
    var uState = _lower(state.user);
    var uMerge = _lower(merge.user);

    var kInit = String(init.key || "").trim();
    var kState = String(state.key || "").trim();
    var kMerge = String(merge.key || "").trim();

    var sameKeyRule =
      _checkKeyRule(uInit, kInit) &&
      _checkKeyRule(uState, kState) &&
      _checkKeyRule(uMerge, kMerge) &&
      (kInit === kState) &&
      (kState === kMerge) &&
      (uInit === uState) &&
      (uState === uMerge);

    // KV binding / deploy 実体は「ヘッダが揃っている範囲」で一致を見る（init はヘッダを返さない設計なので state/merge 間で判定）
    var bState = String(state.kv_binding || "").trim();
    var bMerge = String(merge.kv_binding || "").trim();
    var sameKvBinding = !!bState && !!bMerge && (bState === bMerge);

    var dState = String(state.pages_deploy || "").trim();
    var dMerge = String(merge.pages_deploy || "").trim();
    var cState = String(state.pages_commit || "").trim();
    var cMerge = String(merge.pages_commit || "").trim();

    var samePagesDeploy = !!dState && !!dMerge ? (dState === dMerge) : (!!cState && !!cMerge ? (cState === cMerge) : false);

    if (sameKeyRule && sameKvBinding && samePagesDeploy) {
      __CSCS_SYNC_CONS_STORE__.reported = true;
      console.log(
        "[CSCS][SYNC][CONSISTENCY] ✅ init/state/merge are consistent",
        {
          same_key_rule: true,
          same_kv_binding: true,
          same_pages_deploy: true,
          user: uState,
          key: kState,
          kv_binding: bState,
          pages_deploy: dState,
          pages_commit: cState,
          kv_identity_state: String(state.kv_identity || "").trim(),
          kv_identity_merge: String(merge.kv_identity || "").trim()
        }
      );
    }
  }

  // 追加した処理: merge を“叩かずに”観測するための fetch フック
  // - 既存の fetch ラッパー（net_watch等）があっても、その上からさらに 1段被せる
  // - 観測対象は /api/sync/merge の response headers のみ（bodyは読まない）
  (function installFetchObserve() {
    try {
      if (window.__CSCS_SYNC_CONS_OBSERVER_INSTALLED__) return;
      window.__CSCS_SYNC_CONS_OBSERVER_INSTALLED__ = true;

      var _fetch0 = window.fetch;
      if (typeof _fetch0 !== "function") return;

      window.fetch = function (input, init) {
        var url = "";
        var path = "";
        try {
          url = (typeof input === "string") ? input : (input && typeof input.url === "string" ? input.url : "");
          path = _normPath(url);
        } catch (_e0) {
          url = "";
          path = "";
        }

        var p = _fetch0.apply(this, arguments);

        // merge 観測のみ（副作用なし）
        if (path !== "/api/sync/merge") return p;

        try {
          return Promise.resolve(p).then(function (res) {
            try {
              var picked = _pickSyncHeaders(res);

              __CSCS_SYNC_CONS_STORE__.merge = {
                user: picked.user,
                key: picked.key,
                kv_binding: picked.kv_binding,
                kv_identity: picked.kv_identity,
                pages_deploy: picked.pages_deploy,
                pages_commit: picked.pages_commit
              };
              _maybeReportSyncConsistency();
            } catch (_ePick) {}
            return res;
          });
        } catch (_eWrap) {
          return p;
        }
      };
    } catch (_e) {}
  })();

  try {
    fetch("/api/sync/state", {
      cache: "no-store",
      credentials: "include"
    })
      .then(function (r) {
        const kv = r.headers.get("X-CSCS-KV");
        const isEmpty = r.headers.get("X-CSCS-IsEmptyTemplate");

        // 追加した処理: KV バインディング名を毎回ログで確定させる（A/B共通JSなので副作用はログのみ）
        // - 目的: 「この function が掴んでいる KV バインディング名」をコンソール一発で確定
        // - 成功例: [CSCS][ENV_KEYS] X-CSCS-KV-Binding= "SYNC"
        const kvBinding = r.headers.get("X-CSCS-KV-Binding");
        console.log("[CSCS][ENV_KEYS] X-CSCS-KV-Binding=", kvBinding);

        // ★ EMPTY テンプレ確定ログ（ブラウザ側）
        // - Workers 側の [SYNC/state][EMPTY-TEMPLATE] と意味を完全一致させる
        if (kv === "miss" && isEmpty === "1") {
          console.warn(
            "[CSCS][EMPTY-TEMPLATE] KV state not available -> out=empty returned",
            { kv: "miss", template: "empty" }
          );
        } else {
          console.log("[CSCS][STATE] state ok", {
            kv: kv,
            isEmptyTemplate: isEmpty
          });
        }

        // 追加した処理: state のヘッダから一致判定材料を保存（ここではログは増やさない）
        try {
          var pickedState = _pickSyncHeaders(r);
          __CSCS_SYNC_CONS_STORE__.state = {
            user: pickedState.user,
            key: pickedState.key,
            kv_binding: pickedState.kv_binding,
            kv_identity: pickedState.kv_identity,
            pages_deploy: pickedState.pages_deploy,
            pages_commit: pickedState.pages_commit
          };
          _maybeReportSyncConsistency();
        } catch (_eState) {}

        // 追加した処理: /api/sync/init の判定結果（✅/❌）を毎回“簡潔に”出す（デバッグ段階なので常時ログ）
        // - 目的: 手動スモークテストと同じ結論（INIT OK/FAILED）を、この監視JS起動だけで毎回確定させる
        // - 方針: 推測はしない（status とレスポンスヘッダの有無だけで判定）
        // - 注意: 本ファイルは A/B 両方で読み込まれるため、A/B 両方から init が実行されログが出る（副作用は通信＋ログのみ）
        fetch("/api/sync/init", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({ force: false })
        })
          .then(function (res) {
            const hdrs = {
              "X-CSCS-Key": res.headers.get("X-CSCS-Key"),
              "X-CSCS-User": res.headers.get("X-CSCS-User"),
              "X-CSCS-KV-Binding": res.headers.get("X-CSCS-KV-Binding"),
              "X-CSCS-KV-Identity": res.headers.get("X-CSCS-KV-Identity")
            };

            // 追加した処理: 判定に必要な最小情報だけをログに残す（検索しやすい）
            console.log("[CSCS][INIT] status:", res.status);
            console.log("[CSCS][INIT] ok:", res.ok);
            console.log("[CSCS][INIT] response headers:", hdrs);

            // 追加した処理: init body から user/key を取り、key規則(sync:<email小文字>)を確認して保存
            // - ここで deploy/binding を推測しない（init.ts が返していないため）
            res.clone().json().then(function (b) {
              try {
                var user = (b && typeof b.user === "string") ? b.user : "";
                var key = (b && typeof b.key === "string") ? b.key : "";
                __CSCS_SYNC_CONS_STORE__.init = {
                  user: user,
                  key: key,
                  key_rule_ok: _checkKeyRule(user, key)
                };
                _maybeReportSyncConsistency();
              } catch (_eB) {}
            }).catch(function (_eJ) {});

            // 追加した処理: 手動スモークテストと同じ基準で“1行結論”を出す（推測しない）
            if (res.status === 200 && hdrs["X-CSCS-Key"] && hdrs["X-CSCS-User"]) {
              console.log("✅ INIT OK:", "key issued / returned", "| user =", hdrs["X-CSCS-User"]);
            } else {
              console.warn("❌ INIT FAILED:", "implementation or binding issue");
            }
          })
          .catch(function (e) {
            console.error("[CSCS][INIT] fetch /api/sync/init failed", e);
          });
      })
      .catch(function (e) {
        console.error("[CSCS][STATE] fetch /api/sync/state failed", e);
      });
  } catch (e) {
    console.error("[CSCS][STATE] unexpected error", e);
  }
})();