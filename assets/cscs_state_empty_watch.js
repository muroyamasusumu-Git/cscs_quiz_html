// assets/cscs_state_empty_watch.js
// 目的:
//   /api/sync/state のレスポンスヘッダを毎回チェックし、
//   「KV miss + empty template 返却」をブラウザコンソールで一発確定させる。
// 方針:
//   - state.ts 側の Workers ログと同じ事実を、クライアント側でも二重確認
//   - 条件一致時は必ず console.warn を 1 行だけ出す
//   - クライアントJS依存による誤判定を避け、ヘッダのみを見る

(function () {
  "use strict";

  // 二重実行防止（SPA / A-B 遷移対策）
  if (window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__) return;
  window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__ = true;

  try {
    fetch("/api/sync/state", {
      cache: "no-store",
      credentials: "include"
    })
      .then(function (r) {
        const kv = r.headers.get("X-CSCS-KV");
        const isEmpty = r.headers.get("X-CSCS-IsEmptyTemplate");

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
      })
      .catch(function (e) {
        console.error("[CSCS][STATE] fetch /api/sync/state failed", e);
      });
  } catch (e) {
    console.error("[CSCS][STATE] unexpected error", e);
  }
})();