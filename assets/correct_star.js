/* correct_star.js — 3連続正解スター表示制御用スクリプト
 *
 * 役割：
 * - 現在表示中の問題の qid を取得する
 * - localStorage の 3連続正解カウンタ（cscs_correct_streak3_total:{qid}）を読む
 * - .qno 内の <span class="correct_star">⭐️</span> の表示 / 非表示を切り替える
 *
 * 想定前提：
 * - b_judge_record.js が 3連続正解達成のたびに
 *   localStorage.setItem("cscs_correct_streak3_total:" + qid, n)
 *   のような形で累計回数を保存している
 * - migrate_top_date() などで .qno の直下に
 *   <span class="correct_star">⭐️</span>
 *   が既に差し込まれている
 */

(function () {
  "use strict";

  // ===== QID の取得ヘルパー =====
  function getQidFromGlobalMeta() {
    if (typeof window !== "undefined" && window.cscsMeta && typeof window.cscsMeta === "object") {
      if (window.cscsMeta.qid) {
        return String(window.cscsMeta.qid);
      }
    }
    return null;
  }

  function getQidFromMetaTag() {
    var meta = document.querySelector('meta[name="cscs-qid"]');
    if (meta && meta.content) {
      return String(meta.content);
    }
    return null;
  }

  function getCurrentQid() {
    // 優先順位：
    // 1) window.cscsMeta.qid
    // 2) <meta name="cscs-qid" content="...">
    var qid = getQidFromGlobalMeta();
    if (qid) {
      return qid;
    }
    qid = getQidFromMetaTag();
    if (qid) {
      return qid;
    }
    return null;
  }

  // ===== 3連続正解カウント取得 =====
  function getStreak3Count(qid) {
    if (!qid) {
      return 0;
    }

    // 問題別の3連正解累計キー
    // 例: "cscs_q_correct_streak3_total:20250926-001"
    var key = "cscs_q_correct_streak3_total:" + qid;
    var raw = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch (e) {
      // localStorage が使えない環境では 0 回扱い
      return 0;
    }

    if (raw === null || raw === undefined || raw === "") {
      return 0;
    }

    var n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }

    return n;
  }

  // ===== 現在の連続正解数（1連続 / 2連続 など）を SYNC から取得 =====
  function getCurrentStreakLenFromSync(qid) {
    if (!qid) {
      return 0;
    }

    var root = null;
    try {
      if (typeof window !== "undefined" && window.CSCS_SYNC_DATA && typeof window.CSCS_SYNC_DATA === "object") {
        if (window.CSCS_SYNC_DATA.data && typeof window.CSCS_SYNC_DATA.data === "object") {
          root = window.CSCS_SYNC_DATA.data;
        } else {
          root = window.CSCS_SYNC_DATA;
        }
      }
    } catch (e) {
      console.error("correct_star.js: CSCS_SYNC_DATA 参照中に例外:", e);
      root = null;
    }

    if (!root || !root.streakLen || typeof root.streakLen !== "object") {
      console.warn("correct_star.js: CSCS_SYNC_DATA から streakLen を取得できませんでした", {
        hasSyncData: !!root,
        hasStreakLen: !!(root && root.streakLen)
      });
      return 0;
    }

    var lenRaw = root.streakLen[qid];
    var len = Number(lenRaw || 0);
    if (!Number.isFinite(len) || len < 0) {
      len = 0;
    }

    console.log("correct_star.js: CSCS_SYNC_DATA から streakLen を読み取りました", {
      qid: qid,
      streakLen: len
    });

    return len;
  }

  // ===== 3連続正解回数 → スター絵文字 変換ヘルパー =====
  function getStarSymbolFromStreakCount(count) {
    var n = Number(count || 0);
    if (!Number.isFinite(n) || n < 0) {
      n = 0;
    }

    if (n >= 9) {
      // 9回以上達成で 💫
      return "💫";
    } else if (n >= 3) {
      // 3〜8回達成で 🌟
      return "🌟";
    } else if (n >= 1) {
      // 1〜2回達成で ⭐️
      return "⭐️";
    }

    // 未達成時は従来どおり ⭐️（CSS側で data 属性を見て制御）
    return "⭐️";
  }

  // nav_list.js など他スクリプトからも利用できるように公開
  if (typeof window !== "undefined") {
    window.cscsGetStarSymbolFromStreakCount = getStarSymbolFromStreakCount;
  }

  // ===== スター表示の更新 =====
  function updateCorrectStar() {
    var qid = getCurrentQid();
    var starElement = document.querySelector(".qno .correct_star");

    if (!starElement) {
      return;
    }
    if (!qid) {
      console.warn("correct_star.js: qid を取得できなかったためスター表示を更新できませんでした");
      return;
    }

    // 3連続正解達成回数（累積）
    var count = getStreak3Count(qid);

    // 3連続正解の累積回数に応じた基本シンボル（⭐️/🌟/💫）
    var symbolFromTotal = getStarSymbolFromStreakCount(count);

    // 現在の連続正解数（1連続 / 2連続 など）を CSCS_SYNC_DATA から取得
    var currentStreakLen = 0;
    if (count < 1) {
      currentStreakLen = getCurrentStreakLenFromSync(qid);
    }

    var finalSymbol = symbolFromTotal;
    var state = "off";

    if (count >= 1) {
      // 一度でも3連続正解を達成していれば、累積シンボルをそのまま表示
      finalSymbol = symbolFromTotal;
      state = "on";
    } else {
      // まだ3連続正解は達成していないので、
      // 現在の連続正解数に応じて ⚡️ / ✨ / ⭐️ を切り替える
      if (currentStreakLen >= 2) {
        // リーチ⚡️（2連続正解中）
        finalSymbol = "⚡️";
        state = "on";
      } else if (currentStreakLen === 1) {
        // あと1回でリーチ✨（1連続正解中）
        finalSymbol = "✨";
        state = "on";
      } else {
        // 連続正解も無い場合は従来どおりの ⭐️ + OFF
        finalSymbol = "⭐️";
        state = "off";
      }
    }

    starElement.textContent = finalSymbol;
    starElement.setAttribute("data-star-state", state);

    console.log("correct_star.js: スター表示を更新しました", {
      qid: qid,
      streak3Total: count,
      currentStreakLen: currentStreakLen,
      finalSymbol: finalSymbol,
      dataStarState: state
    });
  }

  // ===== 初期化 =====
  // .qno .correct_star が DOM に出現するまで監視し、見つかったタイミングでコールバックを実行する
  function waitForCorrectStar(callback) {
    var target = document.body;
    if (!target) {
      console.warn("correct_star.js: document.body が存在しないため、スター監視を開始できませんでした");
      return;
    }

    var observer = new MutationObserver(function () {
      var starElement = document.querySelector(".qno .correct_star");
      if (starElement) {
        observer.disconnect();
        console.log("correct_star.js: .qno .correct_star を検出したため updateCorrectStar を実行します");
        callback();
      }
    });

    observer.observe(target, { childList: true, subtree: true });
    console.log("correct_star.js: .qno .correct_star の出現を監視開始");
  }

  function initCorrectStarWatcher() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        waitForCorrectStar(updateCorrectStar);
      });
    } else {
      waitForCorrectStar(updateCorrectStar);
    }
  }

  initCorrectStarWatcher();

  // SYNC 後に外部から再評価できるように公開
  window.cscsUpdateCorrectStar = updateCorrectStar;

  // SYNC の state が更新されたタイミングでもスター表示を再評価する
  window.addEventListener("cscs-sync-updated", function () {
    try {
      console.log("correct_star.js: cscs-sync-updated を受信したためスター表示を再評価します");
      updateCorrectStar();
    } catch (e) {
      console.error("correct_star.js: cscs-sync-updated ハンドラ内で例外:", e);
    }
  });
})();