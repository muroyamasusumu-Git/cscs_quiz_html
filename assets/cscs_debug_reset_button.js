// assets/cscs_debug_reset_button.js
// CSCS 計測系（ローカル＋SYNC 計測系のみ）をリセットするデバッグ専用ボタン
// ※ SYNC 側では「問題別累計・ストリーク・Streak3Today/WrongToday・oncePerDayToday」だけを初期化し、
//    整合性チェック結果や試験日設定などの他の設定は絶対に消さない前提。
//
// 【localStorage / sessionStorage でリセットする対象】
// ▼ 日次系
//   - localStorage: "cscs_correct_attempts_" + day
//   - localStorage: "cscs_wrong_attempts_" + day
//   - localStorage: "cscs_correct_done:" + day
//   - localStorage: "cscs_wrong_done:" + day
//   - localStorage: "cscs_correct_attempt_log_" + day
//   - localStorage: "cscs_wrong_attempt_log_" + day
//
// ▼ 問題別累計（ローカルキャッシュ）
//   - localStorage: "cscs_q_correct_total:" + qid
//   - localStorage: "cscs_q_wrong_total:" + qid
//   - localStorage: "cscs_q_correct_counted_total:" + qid
//   - localStorage: "cscs_q_wrong_counted_total:" + qid
//   - localStorage: "cscs_q_correct_uncounted_total:" + qid
//   - localStorage: "cscs_q_wrong_uncounted_total:" + qid
//
// ▼ 問題別 3 連続正解 / 不正解（ローカルキャッシュ）
//   - localStorage: "cscs_q_correct_streak3_total:" + qid
//   - localStorage: "cscs_q_correct_streak_len:" + qid
//   - localStorage: "cscs_q_correct_streak3_log:" + qid
//   - localStorage: "cscs_q_wrong_streak3_total:" + qid
//   - localStorage: "cscs_q_wrong_streak_len:" + qid
//   - localStorage: "cscs_q_wrong_streak3_log:" + qid
//
// ▼ 全体ストリーク（その日の連続正解などの集約）
//   - localStorage: "cscs_correct_streak_len"
//   - localStorage: "cscs_correct_streak3_total"
//   - localStorage: "cscs_correct_streak3_log"
//
// ▼ その他メタ情報
//   - localStorage: "cscs_wrong_log"
//   - localStorage: "cscs_last_seen_day"
//
// ▼ Streak3Today（本日の⭐️ユニーク数）
//   - localStorage: "cscs_streak3_today_day"
//   - localStorage: "cscs_streak3_today_qids"
//   - localStorage: "cscs_streak3_today_unique_count"
//
// ▼ Streak3WrongToday（本日の3連続不正解ユニーク数）
//   - localStorage: "cscs_streak3_wrong_today_day"
//   - localStorage: "cscs_streak3_wrong_today_qids"
//   - localStorage: "cscs_streak3_wrong_today_unique_count"
//
// ▼ oncePerDayToday（1日1回まで計測）
//   - localStorage: "cscs_once_per_day_today_day"
//   - localStorage: "cscs_once_per_day_today_results"
//
// ▼ A→B トークン（ページ間連携用）
//   - localStorage: "cscs_from_a:" + qid
//   - localStorage: "cscs_from_a_token:" + qid
//   - sessionStorage: "cscs_from_a:" + qid
//   - sessionStorage: "cscs_from_a_token:" + qid
//
// 【SYNC state でリセットする対象】
// ▼ 問題別累計
//   - localStorage: "cscs_q_correct_total:" + qid
//       ⇔ SYNC state: server.correct[qid]
//       ⇔ delta payload: correctDelta[qid]
//   - localStorage: "cscs_q_wrong_total:" + qid
//       ⇔ SYNC state: server.incorrect[qid]
//       ⇔ delta payload: incorrectDelta[qid]
//
// ▼ 問題別 3 連続正解（⭐️用）
//   - localStorage: "cscs_q_correct_streak3_total:" + qid
//       ⇔ SYNC state: server.streak3[qid]
//       ⇔ delta payload: streak3Delta[qid]
//   - localStorage: "cscs_q_correct_streak_len:" + qid
//       ⇔ SYNC state: server.streakLen[qid]
//       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
//
// ▼ 問題別 3 連続不正解（💣用）
//   - localStorage: "cscs_q_wrong_streak3_total:" + qid
//       ⇔ SYNC state: server.streak3Wrong[qid]
//       ⇔ delta payload: streak3WrongDelta[qid]
//   - localStorage: "cscs_q_wrong_streak_len:" + qid
//       ⇔ SYNC state: server.streakWrongLen[qid]
//       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
//
// ▼ Streak3Today（本日の⭐️ユニーク数）
//   - localStorage: "cscs_streak3_today_day"
//       ⇔ SYNC state: server.streak3Today.day
//       ⇔ delta payload: streak3TodayDelta.day
//   - localStorage: "cscs_streak3_today_qids"
//       ⇔ SYNC state: server.streak3Today.qids
//       ⇔ delta payload: streak3TodayDelta.qids
//   - localStorage: "cscs_streak3_today_unique_count"
//       ⇔ SYNC state: server.streak3Today.unique_count
//       ⇔ delta payload: streak3TodayDelta.unique_count（省略可）
//
// ▼ Streak3WrongToday（本日の3連続不正解ユニーク数）
//   - localStorage: "cscs_streak3_wrong_today_day"
//       ⇔ SYNC state: server.streak3WrongToday.day
//       ⇔ delta payload: streak3WrongTodayDelta.day
//   - localStorage: "cscs_streak3_wrong_today_qids"
//       ⇔ SYNC state: server.streak3WrongToday.qids
//       ⇔ delta payload: streak3WrongTodayDelta.qids
//   - localStorage: "cscs_streak3_wrong_today_unique_count"
//       ⇔ SYNC state: server.streak3WrongToday.unique_count
//       ⇔ delta payload: streak3WrongTodayDelta.unique_count（省略可）
//
// ▼ oncePerDayToday（1日1回まで計測）
//   - localStorage: "cscs_once_per_day_today_day"
//       ⇔ SYNC state: server.oncePerDayToday.day
//       ⇔ delta payload: oncePerDayTodayDelta.day
//   - localStorage: "cscs_once_per_day_today_results"
//       ⇔ SYNC state: server.oncePerDayToday.results[qid]
//       ⇔ delta payload: oncePerDayTodayDelta.results[qid]
//
// ⚠️【SYNC state で絶対にリセットしない対象（このボタン経由では触らない）】⚠️
// ▼ 整合性ステータス（consistency_status）
//   - localStorage: （直接保存はしない / SYNC 専用）
//       ⇔ SYNC state: server.consistency_status[qid]
//       ⇔ delta payload: consistencyStatusDelta[qid]
//   → このボタンでは consistency_status を初期化しない（整合性チェック結果は維持する）
//
// ▼ お気に入り状態
//   - localStorage: （fav_modal.js 内部管理）
//       ⇔ SYNC state: server.fav[qid]
//       ⇔ delta payload: fav[qid] ("unset" | "understood" | "unanswered" | "none")
//   → このボタンでは fav を初期化しない（お気に入り状態は維持する）
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

  // ===== ローカルストレージ：カテゴリ別リセット関数 =====

  // 日次系（correct_attempts / wrong_attempts / done / attempt_log）をリセットする
  function resetDailyLocal() {
    var LS = window.localStorage;
    deleteByPrefix(LS, "cscs_correct_attempts_");
    deleteByPrefix(LS, "cscs_wrong_attempts_");
    deleteByPrefix(LS, "cscs_correct_done:");
    deleteByPrefix(LS, "cscs_wrong_done:");
    deleteByPrefix(LS, "cscs_correct_attempt_log_");
    deleteByPrefix(LS, "cscs_wrong_attempt_log_");
    console.log("[DEBUG-RESET] local daily metrics cleared.");
  }

  // 問題別累計（正解 / 不正解・counted / uncounted）をリセットする
  function resetQTotalsLocal() {
    var LS = window.localStorage;
    deleteByPrefix(LS, "cscs_q_correct_total:");
    deleteByPrefix(LS, "cscs_q_wrong_total:");
    deleteByPrefix(LS, "cscs_q_correct_counted_total:");
    deleteByPrefix(LS, "cscs_q_wrong_counted_total:");
    deleteByPrefix(LS, "cscs_q_correct_uncounted_total:");
    deleteByPrefix(LS, "cscs_q_wrong_uncounted_total:");
    console.log("[DEBUG-RESET] local per-question totals cleared.");
  }

  // 問題別ストリーク（3連続正解 / 3連続不正解）をリセットする
  function resetQStreaksLocal() {
    var LS = window.localStorage;
    deleteByPrefix(LS, "cscs_q_correct_streak_len:");
    deleteByPrefix(LS, "cscs_q_correct_streak3_total:");
    deleteByPrefix(LS, "cscs_q_correct_streak3_log:");
    deleteByPrefix(LS, "cscs_q_wrong_streak_len:");
    deleteByPrefix(LS, "cscs_q_wrong_streak3_total:");
    deleteByPrefix(LS, "cscs_q_wrong_streak3_log:");
    console.log("[DEBUG-RESET] local per-question streaks cleared.");
  }

  // 全体ストリーク（その日の連続正解情報）をリセットする
  function resetGlobalStreakLocal() {
    var LS = window.localStorage;
    try { LS.removeItem("cscs_correct_streak_len"); } catch (e) {}
    try { LS.removeItem("cscs_correct_streak3_total"); } catch (e) {}
    try { LS.removeItem("cscs_correct_streak3_log"); } catch (e) {}
    console.log("[DEBUG-RESET] local global streak cleared.");
  }

  // その他メタ情報（wrong_log / last_seen_day）をリセットする
  function resetMetaLocal() {
    var LS = window.localStorage;
    try { LS.removeItem("cscs_wrong_log"); } catch (e) {}
    try { LS.removeItem("cscs_last_seen_day"); } catch (e) {}
    console.log("[DEBUG-RESET] local meta info cleared.");
  }

  // Streak3Today（本日の⭐️ユニーク数）をリセットする
  function resetStreak3TodayLocal() {
    var LS = window.localStorage;
    try { LS.removeItem("cscs_streak3_today_day"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_today_qids"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_today_unique_count"); } catch (e) {}
    console.log("[DEBUG-RESET] local Streak3Today cleared.");
  }

  // Streak3WrongToday（本日の3連続不正解ユニーク数）をリセットする
  function resetStreak3WrongTodayLocal() {
    var LS = window.localStorage;
    try { LS.removeItem("cscs_streak3_wrong_today_day"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_wrong_today_qids"); } catch (e) {}
    try { LS.removeItem("cscs_streak3_wrong_today_unique_count"); } catch (e) {}
    console.log("[DEBUG-RESET] local Streak3WrongToday cleared.");
  }

  // oncePerDayToday（1日1回計測）をリセットする
  function resetOncePerDayLocal() {
    var LS = window.localStorage;
    try { LS.removeItem("cscs_once_per_day_today_day"); } catch (e) {}
    try { LS.removeItem("cscs_once_per_day_today_results"); } catch (e) {}
    console.log("[DEBUG-RESET] local oncePerDayToday cleared.");
  }

  // A→B トークン（ページ間連携用）をリセットする
  function resetTokenLocal() {
    var LS = window.localStorage;
    var SS = window.sessionStorage;
    deleteByPrefix(LS, "cscs_from_a:");
    deleteByPrefix(LS, "cscs_from_a_token:");
    deleteByPrefix(SS, "cscs_from_a:");
    deleteByPrefix(SS, "cscs_from_a_token:");
    console.log("[DEBUG-RESET] local A→B tokens cleared.");
  }

  // 全カテゴリを一括リセットするヘルパー（従来の挙動）
  function resetLocalCounters() {
    resetDailyLocal();
    resetQTotalsLocal();
    resetQStreaksLocal();
    resetGlobalStreakLocal();
    resetMetaLocal();
    resetStreak3TodayLocal();
    resetStreak3WrongTodayLocal();
    resetOncePerDayLocal();
    resetTokenLocal();
    console.log("[DEBUG-RESET] local counters cleared (all categories).");
  }

  // ===== SYNC：カテゴリ別リセット関数 =====

  // /api/sync/reset に JSON body を投げる共通ヘルパー
  // scope で「どのカテゴリをリセットするか」をサーバーに伝える
  function postSyncReset(scope) {
    try {
      return fetch("/api/sync/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ scope: scope })
      }).then(function (res) {
        if (res.ok) {
          console.log("[DEBUG-RESET] SYNC reset OK for scope:", scope);
        } else {
          console.warn("[DEBUG-RESET] SYNC reset failed for scope:", scope, res.status, res.statusText);
        }
      }).catch(function (e) {
        console.warn("[DEBUG-RESET] SYNC reset request error for scope:", scope, e);
      });
    } catch (e) {
      console.warn("[DEBUG-RESET] SYNC reset not available for scope:", scope, e);
      return Promise.resolve();
    }
  }

  // 日次系（correct_attempts / wrong_attempts / done / attempt_log）を SYNC 側でリセットする
  function resetDailySync() {
    return postSyncReset("daily");
  }

  // 問題別累計（correct / incorrect）を SYNC 側でリセットする
  function resetQTotalsSync() {
    return postSyncReset("q_totals");
  }

  // 問題別ストリーク（3連続正解 / 3連続不正解）を SYNC 側でリセットする
  function resetQStreaksSync() {
    return postSyncReset("q_streaks");
  }

  // 全体ストリーク（global streak）を SYNC 側でリセットする
  function resetGlobalStreakSync() {
    return postSyncReset("global_streak");
  }

  // その他メタ情報（必要に応じてサーバー側で定義）を SYNC 側でリセットする
  function resetMetaSync() {
    return postSyncReset("meta");
  }

  // Streak3Today（本日の⭐️ユニーク数）を SYNC 側でリセットする
  function resetStreak3TodaySync() {
    return postSyncReset("streak3_today");
  }

  // Streak3WrongToday（本日の3連続不正解ユニーク数）を SYNC 側でリセットする
  function resetStreak3WrongTodaySync() {
    return postSyncReset("streak3_wrong_today");
  }

  // oncePerDayToday（1日1回計測）を SYNC 側でリセットする
  function resetOncePerDaySync() {
    return postSyncReset("once_per_day");
  }

  // A→B トークン（サーバー側で保持している場合のみ）を SYNC 側でリセットする
  function resetTokenSync() {
    return postSyncReset("token_from_a");
  }

  // 全カテゴリを一括リセットするヘルパー（従来の resetSyncOnServer 相当）
  function resetSyncOnServer() {
    // ※ consistency_status / fav はサーバー側で scope 対象に含めない実装にしておくこと
    return Promise.all([
      resetDailySync(),
      resetQTotalsSync(),
      resetQStreaksSync(),
      resetGlobalStreakSync(),
      resetMetaSync(),
      resetStreak3TodaySync(),
      resetStreak3WrongTodaySync(),
      resetOncePerDaySync(),
      resetTokenSync()
    ]).then(function () {
      console.log("[DEBUG-RESET] SYNC reset (all metric scopes, without consistency_status/fav) done.");
    });
  }

  // ---- 全体リセットボタンクリック時の処理 ----
  function handleClick() {
    // 全ての計測系カテゴリ（ローカル＋SYNC）をまとめてリセットする
    // consistency_status / fav / 試験日設定などの SYNC 設定は保持する
    var ok = window.confirm(
      "[ALL] CSCS の計測データ（ローカル＋SYNC の計測系）を全てリセットします。\n" +
      "⭐️や正解/不正解の累計、3連続正解・3連続不正解、Streak3Today / Streak3WrongToday、\n" +
      "1日1回計測、A→Bトークンも全て消えます。\n" +
      "※ 整合性ステータス（consistency_status）やお気に入り状態（fav）、\n" +
      "   試験日設定などの SYNC 設定情報は消えません。\n\n" +
      "本当に実行してもよいですか？"
    );
    if (!ok) {
      return;
    }

    console.log("=== CSCS DEBUG RESET: [ALL] start ===");
    resetLocalCounters();
    resetSyncOnServer().then(function () {
      console.log("=== CSCS DEBUG RESET: [ALL] done ===");
      window.alert(
        "[ALL] CSCS の計測データ（ローカル＋SYNC 計測系）のリセットが完了しました。\n" +
        "整合性ステータス（consistency_status）やお気に入り状態（fav）、\n" +
        "試験日設定などの SYNC 設定情報は保持されています。"
      );
    });
  }

  // ---- ボタン生成（topmeta-left の 🗑️ からパネルを開閉） ----
  function createButton() {
    // 1) トリガーを挿入する topmeta-left 要素を取得
    var topmetaLeft = document.querySelector(".topmeta-left");
    if (!topmetaLeft) {
      // トリガーを挿入できない場合は警告だけ出して終了する（フォールバックは行わない）
      console.warn("[DEBUG-RESET] .topmeta-left が見つからないため、リセットトリガーを設置できませんでした。");
      return;
    }

    // 2) 右下固定のパネルコンテナを作成（最初は非表示）
    var panel = document.createElement("div");
    panel.id = "cscs-debug-reset-panel";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "99999";
    panel.style.padding = "8px";
    panel.style.background = "rgba(0,0,0,0.75)";
    panel.style.borderRadius = "6px";
    panel.style.display = "none"; // 🗑️ を押すまでは表示しない
    panel.style.flexDirection = "column";
    panel.style.gap = "4px";
    panel.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    // 共通のボタンスタイルを適用するヘルパー
    function styleButton(btn) {
      btn.type = "button";
      btn.style.padding = "4px 6px";
      btn.style.fontSize = "11px";
      btn.style.background = "#7f1d1d";
      btn.style.color = "#fff";
      btn.style.border = "none";
      btn.style.borderRadius = "3px";
      btn.style.cursor = "pointer";
      btn.style.opacity = "0.9";
      btn.style.textAlign = "left";
      btn.addEventListener("mouseenter", function () {
        btn.style.opacity = "1";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.opacity = "0.9";
      });
    }

    // パネルタイトル
    var title = document.createElement("div");
    title.textContent = "CSCS 計測リセット";
    title.style.color = "#fff";
    title.style.fontSize = "11px";
    title.style.marginBottom = "4px";
    panel.appendChild(title);

    // ボタン生成ヘルパー（テキスト・説明・ローカル関数・SYNC 関数を受け取る）
    function createResetButton(label, description, resetLocalFn, resetSyncFn) {
      var btn = document.createElement("button");
      btn.textContent = label;
      styleButton(btn);
      btn.addEventListener("click", function () {
        var ok = window.confirm(
          label + " をリセットします。\n\n" +
          description + "\n\n" +
          "※ 整合性ステータス（consistency_status）やお気に入り状態（fav）、\n" +
          "   試験日設定などの SYNC 設定情報は消えません。\n\n" +
          "本当に実行してもよいですか？"
        );
        if (!ok) {
          return;
        }
        console.log("=== CSCS DEBUG RESET: [" + label + "] start ===");
        if (typeof resetLocalFn === "function") {
          resetLocalFn();
        }
        if (typeof resetSyncFn === "function") {
          resetSyncFn().then(function () {
            console.log("=== CSCS DEBUG RESET: [" + label + "] done ===");
            window.alert(label + " のリセットが完了しました。");
          });
        } else {
          console.log("=== CSCS DEBUG RESET: [" + label + "] done (local only) ===");
          window.alert(label + " のリセットが完了しました。");
        }
      });
      panel.appendChild(btn);
    }

    // ▼ ALL（従来の挙動：全ての計測系カテゴリをまとめてリセット）
    createResetButton(
      "[ALL] 全計測（Local＋SYNC｜日次＋累計＋ストリーク＋トークン）",
      "【対象：LocalStorage 全計測キー ＋ SYNC 全計測キー】\n" +
      "日次系(cscs_correct_attempts_* / cscs_wrong_attempts_* / done / attempt_log)、\n" +
      "問題別累計(cscs_q_correct_total:* / wrong_total:* / counted / uncounted)、\n" +
      "問題別ストリーク(cscs_q_correct_streak_len:* / wrong_streak_len:* / streak3_* など)、\n" +
      "Streak3Today / Streak3WrongToday、1日1回計測、A→Bトークンの\n" +
      "LocalStorage と SYNC state の両方を削除します。",
      resetLocalCounters,
      resetSyncOnServer
    );

    // ▼ 日次系
    createResetButton(
      "日次系のみ（Local＋SYNC｜YYYYMMDD別の当日集計）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_correct_attempts_YYYYMMDD\n" +
      "- cscs_wrong_attempts_YYYYMMDD\n" +
      "- cscs_correct_done:YYYYMMDD / cscs_wrong_done:YYYYMMDD\n" +
      "- cscs_correct_attempt_log_YYYYMMDD / wrong_attempt_log_YYYYMMDD\n" +
      "[SYNC]\n" +
      "- server.daily(correct/incorrect/done/log)",
      resetDailyLocal,
      resetDailySync
    );

    // ▼ 問題別累計
    createResetButton(
      "問題別累計のみ（Local＋SYNC｜qid別 正/誤 累計）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_q_correct_total:qid\n" +
      "- cscs_q_wrong_total:qid\n" +
      "- cscs_q_correct_counted_total:qid / wrong_counted_total:qid\n" +
      "- cscs_q_correct_uncounted_total:qid / wrong_uncounted_total:qid\n" +
      "[SYNC]\n" +
      "- server.correct[qid]\n" +
      "- server.incorrect[qid]",
      resetQTotalsLocal,
      resetQTotalsSync
    );

    // ▼ 問題別ストリーク
    createResetButton(
      "問題別ストリークのみ（Local＋SYNC｜qid別 連続正解/不正解）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_q_correct_streak_len:qid\n" +
      "- cscs_q_correct_streak3_total:qid / cscs_q_correct_streak3_log:qid\n" +
      "- cscs_q_wrong_streak_len:qid\n" +
      "- cscs_q_wrong_streak3_total:qid / cscs_q_wrong_streak3_log:qid\n" +
      "[SYNC]\n" +
      "- server.streakLen[qid]\n" +
      "- server.streak3[qid]\n" +
      "- server.streakWrongLen[qid]\n" +
      "- server.streak3Wrong[qid]",
      resetQStreaksLocal,
      resetQStreaksSync
    );

    // ▼ 全体ストリーク
    createResetButton(
      "全体ストリークのみ（Local＋SYNC｜当日のグローバル連続）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_correct_streak_len\n" +
      "- cscs_correct_streak3_total\n" +
      "- cscs_correct_streak3_log\n" +
      "[SYNC]\n" +
      "- server.globalStreak(len / streak3 / log)",
      resetGlobalStreakLocal,
      resetGlobalStreakSync
    );

    // ▼ その他メタ
    createResetButton(
      "その他メタのみ（Local＋SYNC｜ログ/最終閲覧日など）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_wrong_log\n" +
      "- cscs_last_seen_day\n" +
      "[SYNC]\n" +
      "- server.meta（※ consistency_status / fav は含まれない）",
      resetMetaLocal,
      resetMetaSync
    );

    // ▼ Streak3Today
    createResetButton(
      "Streak3Todayのみ（Local＋SYNC｜本日の⭐️ユニーク）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_streak3_today_day\n" +
      "- cscs_streak3_today_qids\n" +
      "- cscs_streak3_today_unique_count\n" +
      "[SYNC]\n" +
      "- server.streak3Today(day / qids / count)",
      resetStreak3TodayLocal,
      resetStreak3TodaySync
    );

    // ▼ Streak3WrongToday
    createResetButton(
      "Streak3WrongTodayのみ（Local＋SYNC｜本日の3連続不正解）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_streak3_wrong_today_day\n" +
      "- cscs_streak3_wrong_today_qids\n" +
      "- cscs_streak3_wrong_today_unique_count\n" +
      "[SYNC]\n" +
      "- server.streak3WrongToday(day / qids / count)",
      resetStreak3WrongTodayLocal,
      resetStreak3WrongTodaySync
    );

    // ▼ oncePerDayToday
    createResetButton(
      "1日1回計測のみ（Local＋SYNC｜oncePerDayToday）",
      "【対象キー：LocalStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_once_per_day_today_day\n" +
      "- cscs_once_per_day_today_results\n" +
      "[SYNC]\n" +
      "- server.oncePerDayToday(day / results[qid])",
      resetOncePerDayLocal,
      resetOncePerDaySync
    );

    // ▼ A→B トークン
    createResetButton(
      "A→Bトークンのみ（Local＋SYNC｜ページ間連携）",
      "【対象キー：LocalStorage + sessionStorage + SYNC】\n" +
      "[Local]\n" +
      "- cscs_from_a:qid\n" +
      "- cscs_from_a_token:qid\n" +
      "[Session]\n" +
      "- cscs_from_a:* / cscs_from_a_token:*\n" +
      "[SYNC]\n" +
      "- server.token_from_a（存在する場合）",
      resetTokenLocal,
      resetTokenSync
    );

    // 3) 🗑️ トリガーボタンを topmeta-left に挿入する（閉じタグ直前の子要素として追加）
    var trigger = document.createElement("button");
    trigger.id = "cscs-debug-reset-trigger";
    trigger.type = "button";
    trigger.textContent = "🗑️";
    trigger.title = "CSCS 計測リセットパネルを表示 / 非表示";
    trigger.style.marginLeft = "-4px";
    trigger.style.marginRight = "-4px";
    trigger.style.padding = "0px 0px";
    trigger.style.fontSize = "14px";
    trigger.style.background = "none";
    trigger.style.border = "medium";
    trigger.style.cursor = "pointer";
    trigger.style.color = "inherit";
    trigger.style.lineHeight = "1";

    // クリックすると右下パネルの表示 / 非表示を切り替える
    trigger.addEventListener("click", function () {
      if (panel.style.display === "none") {
        panel.style.display = "flex";
      } else {
        panel.style.display = "none";
      }
    });

    topmetaLeft.appendChild(trigger);
    document.body.appendChild(panel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createButton);
  } else {
    createButton();
  }
})();