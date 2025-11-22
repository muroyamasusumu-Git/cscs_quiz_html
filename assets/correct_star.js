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

  // ===== 3連続正解フラグの判定 =====
  function hasStreak3(qid) {
    if (!qid) {
      return false;
    }

    // 問題別の3連正解累計キー
    // 例: "cscs_q_correct_streak3_total:20250926-001"
    var key = "cscs_q_correct_streak3_total:" + qid;
    var raw = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch (e) {
      // localStorage が使えない環境では常に false
      return false;
    }

    if (raw === null || raw === undefined || raw === "") {
      return false;
    }

    var n = parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      return false;
    }

    return n >= 1;
  }

  // ===== スター表示の更新 =====
  function updateCorrectStar() {
    var qid = getCurrentQid();
    var starElement = document.querySelector(".qno .correct_star");

    if (!starElement) {
      return;
    }

    var isActive = hasStreak3(qid);

    if (isActive) {
      starElement.setAttribute("data-star-state", "on");
    } else {
      starElement.setAttribute("data-star-state", "off");
    }
  }

  // ===== 初期化 =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      updateCorrectStar();
    });
  } else {
    updateCorrectStar();
  }

  // SYNC 後に外部から再評価できるように公開
  window.cscsUpdateCorrectStar = updateCorrectStar;
})();