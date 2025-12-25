// assets/cscs_sync_header_compare.js
// ============================================================================
// CSCS SYNC Header Compare Monitor (B-part ONLY)
//
// 🎯 用途（重要）:
//   - このスクリプトは **Bパートにのみ読み込ませる前提** の監視ツール。
//   - Aパートの挙動や通信は一切対象にしない。
//   - 「Bで実際に発生している SYNC 挙動」だけを切り出して検証するためのもの。
//
// 目的:
//   - /api/sync/merge と /api/sync/state の Response Headers を捕捉し、
//     以下の3ヘッダを **同一実行文脈（B）で直接比較**する。
//       • X-CSCS-Key
//       • X-CSCS-User
//       • X-CSCS-KV-Identity（存在すれば）
//
// 判定できること:
//   - merge と state が
//       1) 同じ KV namespace を掴んでいるか
//       2) 同じ sync:key（大小含む完全一致）を使っているか
//   を **即座に確定**できる。
//
// 注意事項:
//   - fetch をフックするため、「この JS が読み込まれた後」の通信のみが対象。
//   - 本番常駐用ではなく、**原因切り分け専用の一時デバッグツール**。
//   - UI や SYNC ロジックの挙動は一切変更しない（観測のみ）。
// ============================================================================

(function () {
  "use strict";

  if (window.__CSCS_SYNC_HEADER_COMPARE__) return;
  window.__CSCS_SYNC_HEADER_COMPARE__ = true;

  var store = {
    merge: null,
    state: null
  };

  function normalizePath(url) {
    try {
      return new URL(url, location.origin).pathname;
    } catch (e) {
      return "";
    }
  }

  function isTarget(path) {
    return path === "/api/sync/merge" || path === "/api/sync/state";
  }

  function pick(headers) {
    function g(name) {
      try {
        var v = headers.get(name);
        return v == null ? "" : String(v);
      } catch (e) {
        return "";
      }
    }
    return {
      "X-CSCS-Key": g("X-CSCS-Key"),
      "X-CSCS-User": g("X-CSCS-User"),
      "X-CSCS-KV-Identity": g("X-CSCS-KV-Identity")
    };
  }

  function compareAndReport() {
    if (!store.merge || !store.state) return;

    var m = store.merge;
    var s = store.state;

    var keySame = m["X-CSCS-Key"] === s["X-CSCS-Key"];
    var kvSame =
      m["X-CSCS-KV-Identity"] &&
      s["X-CSCS-KV-Identity"] &&
      m["X-CSCS-KV-Identity"] === s["X-CSCS-KV-Identity"];

    var verdict = "";
    if (!kvSame) {
      verdict = "❌ Case B: KV namespace が違う（binding / deploy / env 不一致）";
    } else if (!keySame) {
      verdict = "⚠️ Case A: KVは同じだが X-CSCS-Key が違う（大小問題・別ユーザー扱い）";
    } else {
      verdict = "✅ Case C: KV / Key ともに一致（今回の原因ではない）";
    }

    console.groupCollapsed("[CSCS][SYNC][HEADER_COMPARE] 結論確定");
    console.table({
      merge: m,
      state: s
    });
    console.log("key_same:", keySame);
    console.log("kv_identity_same:", kvSame);
    console.log("VERDICT:", verdict);
    console.groupEnd();
  }

  // fetch hook
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = async function (input, init) {
      var resp = await _fetch.apply(this, arguments);

      try {
        var path = normalizePath(
          typeof input === "string" ? input : input.url
        );
        if (isTarget(path)) {
          var tag = path.endsWith("merge") ? "merge" : "state";
          store[tag] = pick(resp.headers);

          if (tag === "merge" && (resp.status === 400 || resp.status === 401)) {
            var text = "";
            var json = null;
            try {
              text = await resp.clone().text();
            } catch (_e1) {
              text = "";
            }
            try {
              json = JSON.parse(text);
            } catch (_e2) {
              json = null;
            }

            if (resp.status === 400 && json && json.error === "SYNC_KEY_REQUIRED") {
              console.log("[CSCS][SYNC][merge] key missing (X-CSCS-Key header is required)");
            }
          }

          compareAndReport();
        }
      } catch (e) {}

      return resp;
    };
  }

  console.log("[CSCS][SYNC][HEADER_COMPARE] installed");
})();