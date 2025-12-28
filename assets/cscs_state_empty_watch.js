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

        // 追加した処理: ENV_KEYS 互換のKV診断ログ（スクショと同じ観測軸）
        // - 何をしているか: X-CSCS-EnvKeys / X-CSCS-KV-* を読み、スクショと同じ項目を同じ形式で出す
        // - 目的: コンソールだけで「KVバインディング名」「env.SYNC生存」「KV identity」を一発確定させる
        // - 方針: ノイズ抑制のため初回1回だけ出す（SPA遷移でも二重出力しない）
        const envKeysRaw = r.headers.get("X-CSCS-EnvKeys") || "";
        const envKeysList = envKeysRaw ? envKeysRaw.split(",").filter(Boolean) : [];

        const kvBinding = r.headers.get("X-CSCS-KV-Binding") || "";
        const kvHasEnvSYNC = r.headers.get("X-CSCS-KV-HasEnvSYNC") || "";
        const kvIdentity = r.headers.get("X-CSCS-KV-Identity") || "";

        if (!window.__CSCS_KV_BINDING_DIAG_LOGGED__) {
          window.__CSCS_KV_BINDING_DIAG_LOGGED__ = true;

          console.log("[CSCS][ENV_KEYS] status=", r.status);
          console.log("[CSCS][ENV_KEYS] X-CSCS-EnvKeys(raw)=", envKeysRaw);
          console.log("[CSCS][ENV_KEYS] keys(list)=", envKeysList);

          console.log("[CSCS][ENV_KEYS] has SYNC=", envKeysList.includes("SYNC"));

          console.log("[CSCS][ENV_KEYS] X-CSCS-KV-Binding=", kvBinding);
          console.log("[CSCS][ENV_KEYS] X-CSCS-KV-HasEnvSYNC=", kvHasEnvSYNC);
          console.log("[CSCS][ENV_KEYS] X-CSCS-KV-Identity=", kvIdentity);

          console.log("[CSCS][KV-BINDING] verdict", {
            ok_binding_is_SYNC: kvBinding === "SYNC",
            ok_env_SYNC_is_alive: kvHasEnvSYNC === "1",
            ok_has_identity: !!kvIdentity
          });
        }

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