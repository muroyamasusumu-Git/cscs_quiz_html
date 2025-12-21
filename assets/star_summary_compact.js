// assets/star_summary_compact.js
(function () {
  "use strict";

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "star_summary_compact"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }

  // =========================
  // 1) CSS注入（compact行専用）
  // =========================
  function injectCompactSummaryStyles() {
    if (document.getElementById("cscs-star-summary-compact-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "cscs-star-summary-compact-style";
    style.textContent = `
    .cscs-star-summary-line-compact {
        display: grid;
        grid-template-columns: 1fr;
        row-gap: 6px;
        font-size: 14px;
        margin-bottom: 15px;
        margin-left: 0px;
        width: 57%;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.18);
    }

    body.mode-a .cscs-star-summary-line-compact {
        display: grid;
        grid-template-columns: 1fr;
        row-gap: 6px;
        font-size: 16px;
        margin-bottom: -5px;
        margin-left: 0px;
        width: 54%;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.18);
        margin-top: 10px;
        opacity: 0.5;
    }

    body.mode-b .cscs-star-summary-line-compact {
        display: grid;
        grid-template-columns: 1fr;
        row-gap: 6px;
        font-size: 14px;
        margin-bottom: 15px;
        margin-left: 0px;
        width: 54%;
        padding-bottom: 0px;
        border-bottom: 0px solid rgba(255, 255, 255, 0.18);
        margin-top: 15px;
        opacity: 0.5;
    }

    .cscs-star-main-compact {
        font-weight: 600;
    }

    .cscs-star-mood {
        margin-left: 6px;
        opacity: 0.8;
        white-space: nowrap;
    }

    .cscs-star-row {
        display: grid;
        grid-template-columns: auto auto 1fr auto;
        align-items: center;
        column-gap: 8px;
        padding: 0px 0px;
        white-space: nowrap;
    }

    .cscs-star-row .cscs-star-label {
        font-weight: 600;
    }

    .cscs-star-row .cscs-star-percent {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .cscs-star-row .cscs-star-meter {
        justify-self: stretch;
    }

    .cscs-star-meter {
        position: relative;
        display: inline-block;
        flex: 1 1 auto;
        width: auto;
        min-width: 30px;
        max-width: 220px;
        height: 8px;
        margin-left: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        overflow: hidden;
        margin-top: 1px;
    }

    .cscs-star-meter-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(255, 215, 0, 0.95), rgba(255, 255, 255, 0.95));
    }

    .cscs-star-meter-fill-total {
        background: linear-gradient(90deg, rgba(255, 215, 0, 0.95), rgba(255, 255, 255, 0.95));
    }
    `;
    document.head.appendChild(style);
    console.log("star_summary_compact.js: CSS injected");
  }

  // =========================
  // 2) SYNCから必要値を読む（compact行に必要な最小セット）
  // =========================
  async function loadCompactNumbersFromSync() {
    var result = {
      totalQuestions: 0,
      starTotalSolvedQuestions: 0,
      remainingDays: 0,
      targetPerDay: 0,
      reachCount: 0,
      preReachCount: 0,
      streak3TodayUnique: 0
    };

    try {
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("star_summary_compact.js: /api/sync/state fetch failed:", res.status);
        return result;
      }

      var json = await res.json();
      var root = json.data || json;

      // 総問題数（最優先: root.global.totalQuestions）
      var TOTAL_Q = 0;
      try {
        if (root && typeof root === "object" && root.global && typeof root.global === "object") {
          var tRaw = root.global.totalQuestions;
          if (typeof tRaw === "number" && Number.isFinite(tRaw) && tRaw > 0) {
            TOTAL_Q = tRaw;
          }
        }
      } catch (_eT) {
        TOTAL_Q = 0;
      }
      result.totalQuestions = TOTAL_Q;

      // streak3（⭐️獲得済み問題数を「qidユニークで」数える：>0 のqid数）
      var totalStarQ = 0;
      if (root.streak3 && typeof root.streak3 === "object") {
        Object.keys(root.streak3).forEach(function (qid) {
          var cnt = Number(root.streak3[qid] || 0);
          if (Number.isFinite(cnt) && cnt > 0) {
            totalStarQ += 1;
          }
        });
      }
      result.starTotalSolvedQuestions = totalStarQ;

      // exam_date から remainingDays（試験日-14日を締切）
      var examDate = null;
      if (typeof root.exam_date === "string") {
        var m = root.exam_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          var y = Number(m[1]);
          var mo = Number(m[2]) - 1;
          var d = Number(m[3]);
          var dt = new Date(y, mo, d);
          if (
            !Number.isNaN(dt.getTime()) &&
            dt.getFullYear() === y &&
            dt.getMonth() === mo &&
            dt.getDate() === d
          ) {
            examDate = dt;
          }
        }
      }

      var remainingDays = 0;
      if (examDate) {
        var now = new Date();
        var todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var deadline = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
        deadline.setDate(deadline.getDate() - 14);
        var diffMs = deadline.getTime() - todayBase.getTime();
        remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (!Number.isFinite(remainingDays) || remainingDays < 0) {
          remainingDays = 0;
        }
      }
      result.remainingDays = remainingDays;

      // 1日あたり目標
      var targetPerDay = 0;
      if (remainingDays > 0 && TOTAL_Q > 0) {
        var remainingStar = TOTAL_Q - totalStarQ;
        if (!Number.isFinite(remainingStar) || remainingStar < 0) {
          remainingStar = 0;
        }
        targetPerDay = Math.ceil(remainingStar / remainingDays);
        if (!Number.isFinite(targetPerDay) || targetPerDay < 0) {
          targetPerDay = 0;
        }
      }
      result.targetPerDay = targetPerDay;

      // リーチ⚡️ / 連続✨（streakLen から：streak3済みは除外）
      var reachCount = 0;
      var preReachCount = 0;
      if (root.streakLen && typeof root.streakLen === "object") {
        Object.keys(root.streakLen).forEach(function (qid) {
          var len = Number(root.streakLen[qid]);
          if (!Number.isFinite(len)) {
            return;
          }

          var streak3TotalForQid = 0;
          if (root.streak3 && Object.prototype.hasOwnProperty.call(root.streak3, qid)) {
            streak3TotalForQid = Number(root.streak3[qid]);
            if (!Number.isFinite(streak3TotalForQid)) {
              streak3TotalForQid = 0;
            }
          }
          if (streak3TotalForQid > 0) {
            return;
          }

          if (len === 2) {
            reachCount += 1;
            return;
          }
          if (len === 1) {
            preReachCount += 1;
            return;
          }
        });
      }
      result.reachCount = reachCount;
      result.preReachCount = preReachCount;

      // streak3Today.unique_count
      var u = 0;
      if (root.streak3Today && typeof root.streak3Today === "object") {
        u = Number(root.streak3Today.unique_count);
        if (!Number.isFinite(u) || u < 0) {
          u = 0;
        }
      }
      result.streak3TodayUnique = u;

      return result;
    } catch (e) {
      console.error("star_summary_compact.js: loadCompactNumbersFromSync error", e);
      return result;
    }
  }

  // =========================
  // 3) DOMに挿入（A/Bで差し込み先が違う）
  // =========================
  function insertCompactLine(lineEl) {
    var isModeA = false;
    var isModeB = false;

    try {
      isModeA = !!(document.body && document.body.classList && document.body.classList.contains("mode-a"));
    } catch (_eModeA) {
      isModeA = false;
    }

    try {
      isModeB = !!(document.body && document.body.classList && document.body.classList.contains("mode-b"));
    } catch (_eModeB) {
      isModeB = false;
    }

    if (isModeA) {
      var similar = document.getElementById("similar-list");
      if (similar && similar.parentNode) {
        similar.parentNode.insertBefore(lineEl, similar);
        return true;
      }
    }

    if (isModeB) {
      var explainMenu = document.querySelector(".explain_menu");
      if (explainMenu && explainMenu.parentNode) {
        explainMenu.parentNode.insertBefore(lineEl, explainMenu);
        return true;
      }
    }

    // どこにも刺せない場合は .wrap の末尾へ
    var wrapContainer = document.querySelector(".wrap");
    if (wrapContainer) {
      wrapContainer.appendChild(lineEl);
      return true;
    }

    return false;
  }

  // =========================
  // 4) compact行のHTMLを構築
  // =========================
  function buildCompactHtml(nums) {
    var targetNum = Number(nums.targetPerDay || 0);
    if (!Number.isFinite(targetNum) || targetNum < 0) {
      targetNum = 0;
    }

    var starTodayCount = Number(nums.streak3TodayUnique || 0);
    if (!Number.isFinite(starTodayCount) || starTodayCount < 0) {
      starTodayCount = 0;
    }

    var totalQuestions = Number(nums.totalQuestions || 0);
    if (!Number.isFinite(totalQuestions) || totalQuestions < 0) {
      totalQuestions = 0;
    }

    var starTotalSolved = Number(nums.starTotalSolvedQuestions || 0);
    if (!Number.isFinite(starTotalSolved) || starTotalSolved < 0) {
      starTotalSolved = 0;
    }

    var todayPercent = 0;
    if (targetNum > 0) {
      todayPercent = Math.floor((starTodayCount / targetNum) * 100);
      if (!Number.isFinite(todayPercent) || todayPercent < 0) {
        todayPercent = 0;
      }
      if (todayPercent > 100) {
        todayPercent = 100;
      }
    }

    var totalPercent = 0;
    if (totalQuestions > 0) {
      totalPercent = ((starTotalSolved / totalQuestions) * 100);
      if (!Number.isFinite(totalPercent) || totalPercent < 0) {
        totalPercent = 0;
      }
      if (totalPercent > 100) {
        totalPercent = 100;
      }
      totalPercent = Number(totalPercent.toFixed(2));
    }

    var basePerDay = 30;
    var mood = "";
    if (targetNum <= basePerDay * 0.8) {
      mood = "余裕";
    } else if (targetNum <= basePerDay * 1.1) {
      mood = "順調";
    } else if (targetNum <= basePerDay * 1.4) {
      mood = "巻き返し";
    } else {
      mood = "要注意";
    }
    var moodText = mood || "順調";

    var reachCount = Number(nums.reachCount || 0);
    if (!Number.isFinite(reachCount) || reachCount < 0) {
      reachCount = 0;
    }

    var preReachCount = Number(nums.preReachCount || 0);
    if (!Number.isFinite(preReachCount) || preReachCount < 0) {
      preReachCount = 0;
    }

    var html = "";

    html += "<div class=\"cscs-star-row cscs-star-row-goal\">";
    html += "<span class=\"cscs-star-label\">本日の目標</span>";
    html += "<span class=\"cscs-star-percent\">⭐️" + String(targetNum) + "個</span>";
    html += "<span class=\"cscs-star-label\">／リーチ⚡️" + String(reachCount) + "個／連続✨" + String(preReachCount) + "個</span>";
    html += "<span class=\"cscs-star-mood\"></span>";
    html += "</div>";

    html += "<div class=\"cscs-star-row cscs-star-row-today\">";
    html += "<span class=\"cscs-star-label\">本日の獲得分</span>";
    html += "<span class=\"cscs-star-percent\">+" + String(starTodayCount) + "</span>";
    html += "<span class=\"cscs-star-meter\">";
    html += "<span class=\"cscs-star-meter-fill\" style=\"width:" + String(todayPercent) + "%;\"></span>";
    html += "</span>";
    html += "<span class=\"cscs-star-mood\">" + String(todayPercent) + "% (状況:" + moodText + ")</span>";
    html += "</div>";

    html += "<div class=\"cscs-star-row cscs-star-row-total\">";
    html += "<span class=\"cscs-star-label\">現在の総進捗</span>";
    html += "<span class=\"cscs-star-percent\">" + String(starTotalSolved) + "個</span>";
    html += "<span class=\"cscs-star-meter\">";
    html += "<span class=\"cscs-star-meter-fill cscs-star-meter-fill-total\" style=\"width:" + totalPercent.toFixed(2) + "%;\"></span>";
    html += "</span>";
    html += "<span class=\"cscs-star-mood\">" + totalPercent.toFixed(2) + "% (状況:" + moodText + ")</span>";
    html += "</div>";

    return {
      html: html,
      debug: {
        targetNum: targetNum,
        starTodayCount: starTodayCount,
        todayPercent: todayPercent,
        totalPercent: totalPercent,
        moodText: moodText,
        reachCount: reachCount,
        preReachCount: preReachCount
      }
    };
  }

  // =========================
  // 5) 描画（初回）
  // =========================
  async function renderCompactSummaryOnce() {
    injectCompactSummaryStyles();

    // 二重生成防止
    if (document.getElementById("cscs-star-summary-line-compact-root")) {
      return;
    }

    var nums = await loadCompactNumbersFromSync();
    var built = buildCompactHtml(nums);

    var line = document.createElement("div");
    line.id = "cscs-star-summary-line-compact-root";
    line.className = "cscs-star-summary-line-compact";
    line.innerHTML = built.html;

    line.style.marginLeft = "0px";
    line.style.fontWeight = "500";

    insertCompactLine(line);

    console.log("star_summary_compact.js: rendered", built.debug);
  }

  // =========================
  // 6) Bページだけ「遅延で1回」上書き更新（今の field_summary と同じ思想）
  // =========================
  function scheduleBPageCompactRefreshOnce() {
    var path = location.pathname || "";
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) {
      return;
    }

    console.log("star_summary_compact.js: B-page detected, scheduling delayed refresh (2000ms).");

    setTimeout(function () {
      (async function () {
        try {
          var line = document.getElementById("cscs-star-summary-line-compact-root");
          if (!line) {
            console.warn("star_summary_compact.js: delayed refresh skipped (line not found).");
            return;
          }

          var nums = await loadCompactNumbersFromSync();
          var built = buildCompactHtml(nums);

          line.innerHTML = built.html;

          console.log("star_summary_compact.js: delayed refresh done.", built.debug);
        } catch (e) {
          console.error("star_summary_compact.js: delayed refresh failed", e);
        }
      })();
    }, 2000);
  }

  // =========================
  // 7) 起動
  // =========================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderCompactSummaryOnce();
      scheduleBPageCompactRefreshOnce();
    });
  } else {
    renderCompactSummaryOnce();
    scheduleBPageCompactRefreshOnce();
  }

})();