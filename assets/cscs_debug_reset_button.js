// assets/cscs_debug_reset_button.js
// CSCS 計測系（ローカル＋SYNC）を一括リセットするデバッグ専用ボタン
(function () {
  "use strict";

  if (window.CSCS_DEBUG_RESET_BUTTON_INSTALLED) {
    return;
  }
  window.CSCS_DEBUG_RESET_BUTTON_INSTALLED = true;

  // ---- 共通ユーティリティ ----
  function deleteByPrefix(storage, prefix) {
    var keys = [];
    var i;
    var k;
    for (i = 0; i < storage.length; i++) {
      k = storage.key(i);
      if (k && k.indexOf(prefix) === 0) {
        keys.push(k);
      }
    }
    keys.forEach(function (key) {
      try {
        storage.removeItem(key);
        console.log("[DEBUG-RESET] deleted:", key);
      } catch (e) {
        console.warn("[DEBUG-RESET] failed to delete:", key, e);
      }
    });
  }

  function resetLocalCounters() {
    var LS = window.localStorage;
    var SS = window.sessionStorage;

    // ===== 日次系 =====
    deleteByPrefix(LS, "cscs_correct_attempts_");
    deleteByPrefix(LS, "cscs_wrong_attempts_");
    deleteByPrefix(LS, "cscs_correct_done:");
    deleteByPrefix(LS, "cscs_wrong_done:");
    deleteByPrefix(LS, "cscs_correct_attempt_log_");
    deleteByPrefix(LS, "cscs_wrong_attempt_log_");

    // ===== 問題別累計 =====
    deleteByPrefix(LS, "cscs_q_correct_total:");
    deleteByPrefix(LS, "cscs_q_wrong_total:");
    deleteByPrefix(LS, "cscs_q_correct_counted_total:");
    deleteByPrefix(LS, "cscs_q_wrong_counted_total:");
    deleteByPrefix(LS, "cscs_q_correct_uncounted_total:");
    deleteByPrefix(LS, "cscs_q_wrong_uncounted_total:");

    // ===== 問題別ストリーク =====
    deleteByPrefix(LS, "cscs_q_correct_streak_len:");
    deleteByPrefix(LS, "cscs_q_correct_streak3_total:");
    deleteByPrefix(LS, "cscs_q_correct_streak3_log:");

    // ===== 全体ストリーク =====
    try { LS.removeItem("cscs_correct_streak_len"); } catch (e) {}
    try { LS.removeItem("cscs_correct_streak3_total"); } catch (e) {}
    try { LS.removeItem("cscs_correct_streak3_log"); } catch (e) {}

    // ===== その他メタ =====
    try { LS.removeItem("cscs_wrong_log"); } catch (e) {}
    try { LS.removeItem("cscs_last_seen_day"); } catch (e) {}

    // ===== ⭐️ 今日の新規3連正解 =====
    try { LS.removeItem("cscs_streak3_today_day"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_today_qids"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_today_unique_count"); } catch (e) {}

    // ===== 1日1回計測モード =====
    try { LS.removeItem("cscs_once_per_day_today_day"); } catch (e) {}
    try { LS.removeItem("cscs_once_per_day_today_results"); } catch (e) {}

    // ===== A→B トークン =====
    deleteByPrefix(LS, "cscs_from_a:");
    deleteByPrefix(LS, "cscs_from_a_token:");
    deleteByPrefix(SS, "cscs_from_a:");
    deleteByPrefix(SS, "cscs_from_a_token:");

    console.log("[DEBUG-RESET] local counters cleared.");
  }

  function resetSyncOnServer() {
    // /api/sync/reset が無い場合もあるので、エラーなら警告だけ
    try {
      return fetch("/api/sync/reset", {
        method: "POST"
      }).then(function (res) {
        if (res.ok) {
          console.log("[DEBUG-RESET] SYNC reset (server-side) OK");
        } else {
          console.warn("[DEBUG-RESET] SYNC reset failed:", res.status, res.statusText);
        }
      }).catch(function (e) {
        console.warn("[DEBUG-RESET] SYNC reset request error:", e);
      });
    } catch (e) {
      console.warn("[DEBUG-RESET] SYNC reset not available:", e);
      return Promise.resolve();
    }
  }

  // ---- ボタンクリック時の処理 ----
  function handleClick() {
    var ok = window.confirm(
      "CSCS の計測データ（ローカル＋SYNC）をリセットします。\n" +
      "⭐️や正解/不正解の累計、1日1回計測、トークンも全て消えます。\n\n" +
      "本当に実行してもよいですか？"
    );
    if (!ok) {
      return;
    }

    console.log("=== CSCS DEBUG RESET: start ===");
    resetLocalCounters();
    resetSyncOnServer().then(function () {
      console.log("=== CSCS DEBUG RESET: done ===");
      window.alert("CSCS 計測データのリセットが完了しました。");
    });
  }

  // ---- ボタン生成 ----
  function createButton() {
    var btn = document.createElement("button");
    btn.id = "cscs-debug-reset-button";
    btn.textContent = "CSCS計測リセット";
    btn.type = "button";

    // ざっくり右下固定のデバッグ用スタイル
    btn.style.position = "fixed";
    btn.style.right = "16px";
    btn.style.bottom = "16px";
    btn.style.zIndex = "99999";
    btn.style.padding = "8px 12px";
    btn.style.fontSize = "12px";
    btn.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    btn.style.background = "#b91c1c";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "4px";
    btn.style.cursor = "pointer";
    btn.style.opacity = "0.8";

    btn.addEventListener("mouseenter", function () {
      btn.style.opacity = "1";
    });
    btn.addEventListener("mouseleave", function () {
      btn.style.opacity = "0.8";
    });

    btn.addEventListener("click", handleClick);

    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createButton);
  } else {
    createButton();
  }
})();