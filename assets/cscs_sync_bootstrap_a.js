// assets/cscs_sync_bootstrap_a.js
// 目的:
//   - /api/sync/init (POST) を叩いて sync key を確定する
//   - key を localStorage と window 共有 Promise に格納する
//   - 後続が待てるように window.dispatchEvent(new Event("cscs:syncKeyReady")) を投げる
//
// 【最重要ルール（プロジェクト恒久・見落とし防止）】
//   /api/sync/state を叩く処理を含む JS は、必ずこの bootstrap の「処理完了後」に起動すること。
//   ここでいう「処理完了」は、次のいずれかを満たしたタイミングを指す（同値）:
//     1) window.__CSCS_SYNC_KEY_PROMISE__ が resolve した後
//     2) window に sync key が確定し、"cscs:syncKeyReady" イベントが dispatch された後
//
//   理由:
//     state.ts は "X-CSCS-Key" 必須で、キー未確定のまま /api/sync/state を叩くと
//     missing key / 403 等で落ち、ODOA / oncePerDayToday / consistency_status の参照が破綻する。
//     よって、後続は必ず window.__CSCS_SYNC_KEY_PROMISE__.then(...) で待ってから実行する。
//     （localStorage の値だけで確定扱いして開始するのは禁止。最終確定はサーバー init の結果。）
//
// 整合性（必須）:
//   - init.ts は key を `sync:<lowercase email>` で確定して返す
//   - state.ts は X-CSCS-Key を必須とし、かつ `sync:<authenticated user>` と一致しないと 403
//
// 方針（プロジェクト恒久）:
//   - 推測フォールバックはしない（失敗は失敗として console.error で確定させる）
//   - ただし「同一ページ内の多重起動」は window 共有 Promise で抑止する

(function () {
  "use strict";

  var INIT_ENDPOINT = "/api/sync/init";

  // localStorage に保存するキー名（フロント側の “唯一の保管場所” として扱う）
  var LS_SYNC_KEY = "cscs_sync_key";

  // window に保存する共有スロット（同一ページ内の多重起動を防ぐ）
  var WIN_PROMISE = "__CSCS_SYNC_KEY_PROMISE__";
  var WIN_KEY = "__CSCS_SYNC_KEY__";
  var WIN_USER = "__CSCS_SYNC_USER__";

  // 既に走っているなら、その Promise を返して終わり
  if (window[WIN_PROMISE] && typeof window[WIN_PROMISE].then === "function") {
    return;
  }

  // ユーティリティ: 文字列かどうか
  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  // ユーティリティ: key 形式の最小検証（決定条件はサーバー。ここは最低限）
  function looksLikeSyncKey(v) {
    if (!isNonEmptyString(v)) return false;
    // init.ts / state.ts の規則: sync:<lowercase email>
    // 厳密な email 検証はしない（クライアント推測を増やさない）
    return v.indexOf("sync:") === 0 && v.length > "sync:".length;
  }

  // ============================================================
  // ★ 追加: init 手動ボタン導線（A側UIバインド / strict）
  // ------------------------------------------------------------
  // 【由来の明記】
  //   - 本ブロックは、もともと cscs_sync_a.js 内に存在していた
  //     「SYNC 初期化状況（user / key / state.status）を UI に表示するための
  //      init 手動ボタン導線・ステータス表示ロジック」を、
  //     設計整理の結果、本 bootstrap に正式移植したものである。
  //
  //   - 目的は「/api/sync/state を叩く前に key が必ず確定している」ことを
  //     UI 表示・デバッグの両面で保証すること。
  //
  // 【設計上の位置づけ】
  //   - 表示専用の診断/UI 導線であり、SYNC 本体ロジックは一切変更しない。
  //   - /api/sync/init は bootstrap が唯一の確定ルート。
  //
  // 【厳守ルール】
  //   - /api/sync/state を叩くのは必ず bootstrap 完了後
  //     （WIN_PROMISE resolve 後）のみ。
  //   - 推測フォールバックは禁止（欠損は欠損として UI に表示する）。
  // ============================================================
  window.CSCS_SYNC_INIT_BIND_A_STRICT = function (box) {
    try{
      const initBtn = box.querySelector('button[data-sync-init="1"]');
      const elUser  = box.querySelector(".sync-user-email");
      const elKey   = box.querySelector(".sync-key-status");
      const elState = box.querySelector(".sync-state-status");

      function readLocalSyncKeyStrict(){
        try{
          const v = localStorage.getItem(LS_SYNC_KEY);
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          return s === "" ? null : s;
        }catch(_){
          return null;
        }
      }

      function refreshInitUiSnapshotStrict(stateStatus, userEmailFromHeader){
        // ★ 処理: key状態（present/missing）
        try{
          const k = readLocalSyncKeyStrict();
          if (elKey) elKey.textContent = (k !== null) ? "present" : "missing";
        }catch(_){}

        // ★ 処理: user表示（/api/sync/state ヘッダ由来のみ）
        try{
          if (elUser) {
            if (userEmailFromHeader === null || userEmailFromHeader === undefined) {
              elUser.textContent = "MISSING";
            } else {
              const s = String(userEmailFromHeader).trim();
              elUser.textContent = (s === "") ? "MISSING" : s;
            }
          }
        }catch(_){}

        // ★ 処理: state status表示（数値以外はそのまま出さずMISSING）
        try{
          if (elState) {
            if (typeof stateStatus === "number" && Number.isFinite(stateStatus)) {
              elState.textContent = String(stateStatus);
            } else {
              elState.textContent = "MISSING";
            }
          }
        }catch(_){}
      }

      async function fetchStateWithKeyStrict(){
        // ★ 重要: /api/sync/state は bootstrap 完了後にのみ実行する
        if (window[WIN_PROMISE] && typeof window[WIN_PROMISE].then === "function") {
          await window[WIN_PROMISE];
        }

        const k = readLocalSyncKeyStrict();
        if (k === null) {
          // ★ 処理: key欠損なら state確認は実施できない（推測せず欠損として扱う）
          return { ok: false, status: null, user: null };
        }

        const r = await fetch("/api/sync/state", {
          method: "GET",
          credentials: "include",
          headers: {
            "X-CSCS-Key": k
          }
        });

        // ★ 処理: user(email) はヘッダからのみ取得（欠損はnull）
        let userEmail = null;
        try{
          const u = r.headers ? r.headers.get("X-CSCS-User") : null;
          if (u !== null && u !== undefined) {
            const s = String(u).trim();
            userEmail = (s === "") ? null : s;
          }
        }catch(_){
          userEmail = null;
        }

        return { ok: (r.status === 200), status: r.status, user: userEmail };
      }

      async function runInitFlowStrict(){
        // ★ 重要: /api/sync/init を “手動で叩いた後” に /api/sync/state へ進む
        // ★ 重要: state は bootstrap 完了後のみ（fetchStateWithKeyStrict で保証）
        const existedKey = (readLocalSyncKeyStrict() !== null);
        const force = existedKey ? true : false;

        let initStatus = null;
        let stateStatus = null;
        let userEmail = null;

        try{
          const initRes = await fetch(INIT_ENDPOINT, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ force: force })
          });

          initStatus = initRes.status;

          if (initRes.status === 200) {
            // ★ 処理: 200時のみ body.key を保存（欠損は欠損として保存しない）
            let key = null;
            try{
              const j = await initRes.json();
              if (j && Object.prototype.hasOwnProperty.call(j, "key")) {
                const raw = j.key;
                if (raw !== null && raw !== undefined) {
                  const s = String(raw).trim();
                  key = (s === "") ? null : s;
                }
              }
            }catch(_){
              key = null;
            }

            if (key !== null) {
              try{
                localStorage.setItem(LS_SYNC_KEY, key);
              }catch(_){}
              // ★ 処理: window 側も更新（後続の参照用 / 推測ではない）
              try{
                window[WIN_KEY] = key;
              }catch(_){}
            }
          }

          // ★ 処理: 保存直後に state をヘッダ付きで確認
          const st = await fetchStateWithKeyStrict();
          stateStatus = st.status;
          userEmail = st.user;

          // ★ 処理: UI更新（欠損は欠損のまま）
          refreshInitUiSnapshotStrict(stateStatus, userEmail);

          // ★ 処理: 判定ログを必ず1行
          if (initStatus === 200 && stateStatus === 200) {
            console.log("✅ INIT+STATE OK (init=" + initStatus + ", state=" + stateStatus + ")");
          } else {
            console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
          }
        }catch(e){
          // ★ 処理: 例外時も「1行ログ」ルールを守る（statusはnull）
          refreshInitUiSnapshotStrict(stateStatus, userEmail);
          console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
        }
      }

      // ★ 処理: 起動時スナップショット（key状態だけは常に表示できる）
      refreshInitUiSnapshotStrict(null, null);

      // ★ 追加: 起動直後に status を埋める（ただし /api/sync/state は必ず bootstrap 完了後）
      try{
        (async function(){
          try{
            const st0 = await fetchStateWithKeyStrict();
            refreshInitUiSnapshotStrict(st0.status, st0.user);
          }catch(_e0){
            // フォールバック禁止: 取れないなら MISSING のまま（起動時スナップショットを維持）
            refreshInitUiSnapshotStrict(null, null);
          }
        })();
      }catch(_e1){}

      if (initBtn) {
        initBtn.addEventListener("click", function(){
          runInitFlowStrict();
        });
      }
    }catch(_){}
  };

  // ユーティリティ: localStorage 書き込み（失敗しても例外は外へ出さない）
  function writeLocalStorage(key, val) {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ユーティリティ: localStorage 読み（失敗時は空文字）
  function readLocalStorage(key) {
    try {
      var v = localStorage.getItem(key);
      return typeof v === "string" ? v : "";
    } catch (_e) {
      return "";
    }
  }

  // ユーティリティ: 共有状態を window に確定させる（順序が重要）
  function commitResolvedKey(user, key) {
    window[WIN_USER] = user;
    window[WIN_KEY] = key;

    // localStorage は「観測・再利用」用（このページの真実はサーバー確定）
    var lsOk = writeLocalStorage(LS_SYNC_KEY, key);

    // 後続へ通知（指示どおり Event のみ）
    var eventOk = false;
    try {
      window.dispatchEvent(new Event("cscs:syncKeyReady"));
      eventOk = true;
    } catch (_e) {
      // 古い環境向け（ただし基本は現代ブラウザ想定）
      try {
        var ev = document.createEvent("Event");
        ev.initEvent("cscs:syncKeyReady", true, true);
        window.dispatchEvent(ev);
        eventOk = true;
      } catch (_e2) {
        eventOk = false;
      }
    }

    // ★ 成功確定ログ（検索しやすい1行）
    try {
      console.log("[CSCS][sync_bootstrap] OK: sync key resolved + stored + event dispatched", {
        endpoint: INIT_ENDPOINT,
        key: key,
        user: typeof user === "string" ? user : "",
        lsOk: lsOk ? "1" : "0",
        eventOk: eventOk ? "1" : "0"
      });
    } catch (_e3) {}
  }

  // 実行本体: init を叩いて key を確定
  function fetchInitAndResolve() {
    // init.ts: body が壊れてても force=false 扱い、POST only
    // ここも最小: force を送らない（= false）
    var ctrl = null;
    var timer = null;

    try {
      ctrl = new AbortController();
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_e) {}
      }, 15000); // 15s（長すぎるフォールバックはしない。待ち時間を固定）
    } catch (_e) {
      ctrl = null;
      timer = null;
    }

    var fetchOpts = {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({}),
    };

    if (ctrl && ctrl.signal) {
      fetchOpts.signal = ctrl.signal;
    }

    return fetch(INIT_ENDPOINT, fetchOpts)
      .then(function (res) {
        if (timer) {
          try {
            clearTimeout(timer);
          } catch (_e) {}
        }

        // init.ts は JSON を返し、X-CSCS-Key / X-CSCS-User をレスポンスヘッダにも載せる
        var hk = "";
        var hu = "";

        try {
          hk = res.headers.get("X-CSCS-Key") || "";
        } catch (_e) {
          hk = "";
        }

        try {
          hu = res.headers.get("X-CSCS-User") || "";
        } catch (_e2) {
          hu = "";
        }

        if (!res.ok) {
          // フォールバック禁止: 失敗は失敗として確定
          return res.text().then(function (t) {
            var msg = "[CSCS][sync_bootstrap] /api/sync/init failed: status=" + res.status + " body=" + String(t || "");
            throw new Error(msg);
          });
        }

        // まず JSON を読む（ヘッダが空でも body で key を取れるケースに備えるが、推測ではない）
        return res.json().then(function (data) {
          var keyFromBody = "";
          var userFromBody = "";

          if (data && typeof data === "object") {
            if (typeof data.key === "string") keyFromBody = data.key;
            if (typeof data.user === "string") userFromBody = data.user;
          }

          var finalKey = isNonEmptyString(hk) ? hk.trim() : String(keyFromBody || "").trim();
          var finalUser = isNonEmptyString(hu) ? hu.trim() : String(userFromBody || "").trim();

          if (!looksLikeSyncKey(finalKey)) {
            throw new Error("[CSCS][sync_bootstrap] init returned invalid key: " + String(finalKey || ""));
          }

          // user は必須ではないが、取れたら保存（診断用）
          commitResolvedKey(finalUser, finalKey);
          return finalKey;
        });
      })
      .catch(function (e) {
        if (timer) {
          try {
            clearTimeout(timer);
          } catch (_e) {}
        }

        // 失敗は確定ログ（後続は Promise reject で判断できる）
        try {
          console.error("[CSCS][sync_bootstrap] init failed:", e);
        } catch (_e2) {}

        throw e;
      });
  }

  // 共有 Promise を window にセット（後続はこれを待てる）
  window[WIN_PROMISE] = new Promise(function (resolve, reject) {
    // 1) まず localStorage から読み（“暫定”）
    //    - ただし最終確定は init の結果（サーバーの真実）
    var lsKey = readLocalStorage(LS_SYNC_KEY);
    if (looksLikeSyncKey(lsKey)) {
      // 既に入っている場合でも “即 resolve せず”、init で確定し直す
      // （state.ts は key と user が一致しないと 403 なので、ここで勝手に確定扱いしない）
      // ただし診断のため window には一旦置く（後で init 結果で上書き）
      window[WIN_KEY] = lsKey;
    }

    fetchInitAndResolve()
      .then(function (key) {
        resolve(key);
      })
      .catch(function (e) {
        reject(e);
      });
  });

  // “Promise を待たない” 利用者向けの最小導線:
  // - window[WIN_PROMISE] が存在する事実だけで後続が待機できる
  // - ready イベントは commitResolvedKey 内で投げる
})();