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
      })
      .catch(function (e) {
        console.error("[CSCS][STATE] fetch /api/sync/state failed", e);
      });
  } catch (e) {
    console.error("[CSCS][STATE] unexpected error", e);
  }
})();