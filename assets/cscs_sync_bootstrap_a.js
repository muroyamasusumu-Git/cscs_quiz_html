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