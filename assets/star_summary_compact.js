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
  }
  if (__effectsDisabled) {
    return;
  }

  // すでに定義済みなら上書きしない
  if (window.CSCSStarSummaryCompact && typeof window.CSCSStarSummaryCompact === "object") {
    return;
  }

  // ------------------------------------------------------------
  // 公開API:
  //   window.CSCSStarSummaryCompact.render(opts)
  //
  // opts:
  //   - panel: HTMLElement（fallback挿入先）
  //   - targetNum: number
  //   - starTodayCount: number
  //   - todayPercent: number (0-100)
  //   - starTotalSolvedQuestions: number
  //   - totalPercent: number (0-100)
  //   - moodText: string
  //   - reachCount: number
  //   - preReachCount: number
  //
  // return:
  //   - 生成した needLine（div.cscs-star-summary-line-compact）
  // ------------------------------------------------------------
  function render(opts) {
    try {
      if (!opts || typeof opts !== "object") {
        console.error("star_summary_compact.js: opts is required");
        return null;
      }

      var panel = opts.panel;

      var targetNum = Number(opts.targetNum);
      if (!Number.isFinite(targetNum) || targetNum < 0) {
        targetNum = 0;
      }

      var starTodayCount = Number(opts.starTodayCount);
      if (!Number.isFinite(starTodayCount) || starTodayCount < 0) {
        starTodayCount = 0;
      }

      var todayPercent = Number(opts.todayPercent);
      if (!Number.isFinite(todayPercent) || todayPercent < 0) {
        todayPercent = 0;
      }
      if (todayPercent > 100) {
        todayPercent = 100;
      }

      var starTotalSolvedQuestions = Number(opts.starTotalSolvedQuestions);
      if (!Number.isFinite(starTotalSolvedQuestions) || starTotalSolvedQuestions < 0) {
        starTotalSolvedQuestions = 0;
      }

      var totalPercent = Number(opts.totalPercent);
      if (!Number.isFinite(totalPercent) || totalPercent < 0) {
        totalPercent = 0;
      }
      if (totalPercent > 100) {
        totalPercent = 100;
      }

      var moodText = String(opts.moodText == null ? "" : opts.moodText);
      if (!moodText) {
        moodText = "順調";
      }

      var reachCount = Number(opts.reachCount);
      if (!Number.isFinite(reachCount) || reachCount < 0) {
        reachCount = 0;
      }

      var preReachCount = Number(opts.preReachCount);
      if (!Number.isFinite(preReachCount) || preReachCount < 0) {
        preReachCount = 0;
      }

      // コンパクトな進捗行を構築（3行・縦並び）
      var needLine = document.createElement("div");
      needLine.className = "cscs-star-summary-line-compact";

      var html = "";

      // 1) 本日の目標（⭐️ / ⚡️ / ✨）
      html += "<div class=\"cscs-star-row cscs-star-row-goal\">";
      html += "<span class=\"cscs-star-label\">本日の目標</span>";
      html += "<span class=\"cscs-star-percent\">⭐️" + String(targetNum) + "個</span>";
      html += "<span class=\"cscs-star-label\">／リーチ⚡️" + String(reachCount) + "個／連続✨" + String(preReachCount) + "個</span>";
      html += "<span class=\"cscs-star-mood\"></span>";
      html += "</div>";

      // 2) 本日の獲得分（+X / ゲージ / % / 状況）
      html += "<div class=\"cscs-star-row cscs-star-row-today\">";
      html += "<span class=\"cscs-star-label\">本日の獲得分</span>";
      html += "<span class=\"cscs-star-percent\">+" + String(starTodayCount) + "</span>";
      html += "<span class=\"cscs-star-meter\">";
      html += "<span class=\"cscs-star-meter-fill\" style=\"width:" + String(todayPercent) + "%;\"></span>";
      html += "</span>";
      html += "<span class=\"cscs-star-mood\">" + String(todayPercent) + "% (状況:" + moodText + ")</span>";
      html += "</div>";

      // 3) 現在の総進捗（獲得数 / ゲージ / % / 状況）
      html += "<div class=\"cscs-star-row cscs-star-row-total\">";
      html += "<span class=\"cscs-star-label\">現在の総進捗</span>";
      html += "<span class=\"cscs-star-percent\">" + String(starTotalSolvedQuestions) + "個</span>";
      html += "<span class=\"cscs-star-meter\">";
      html += "<span class=\"cscs-star-meter-fill cscs-star-meter-fill-total\" style=\"width:" + totalPercent.toFixed(2) + "%;\"></span>";
      html += "</span>";
      html += "<span class=\"cscs-star-mood\">" + totalPercent.toFixed(2) + "% (状況:" + moodText + ")</span>";
      html += "</div>";

      needLine.innerHTML = html;

      needLine.style.marginLeft = "0px";
      needLine.style.fontWeight = "500";

      // 追加した処理:
      // - Aパート(body.mode-a)のとき：
      //     compact行(div.cscs-star-summary-line-compact)を <div id="similar-list"> の直前へ移動して挿入する
      //     similar-list が無い場合は移動せず、panel 内に入れる
      // - Bパート(body.mode-b)のとき：
      //     compact行を <div class="explain_menu"> の直前へ移動して挿入する
      //     explain_menu が無い場合は panel 内に入れる
      (function () {
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
            similar.parentNode.insertBefore(needLine, similar);
            return;
          }
        }

        if (isModeB) {
          var explainMenu = document.querySelector(".explain_menu");
          if (explainMenu && explainMenu.parentNode) {
            explainMenu.parentNode.insertBefore(needLine, explainMenu);
            return;
          }
        }

        if (panel && panel.appendChild) {
          panel.appendChild(needLine);
        }
      })();

      return needLine;
    } catch (e) {
      console.error("star_summary_compact.js: render failed", e);
      return null;
    }
  }

  window.CSCSStarSummaryCompact = {
    render: render
  };
})();