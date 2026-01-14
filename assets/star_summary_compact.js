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

  // ============================================================
  // 【編集しやすい設定まとめ】
  // ------------------------------------------------------------
  // - 見た目の編集 → CONFIG.CSS_TEXT を触る
  // - 位置・サイズの編集 → CONFIG.CONTAINER_STYLE を触る
  // - HTMLの文言や構造の編集 → buildCompactHTML() を触る
  // ============================================================

  var CONFIG = {
    STYLE_TAG_ID: "cscs-star-summary-compact-style",

    // ここが「固定配置の見た目」編集ポイント（JS style直書きを集約）
    CONTAINER_STYLE: {
      display: "block",
      position: "fixed",
      top: "10px",
      right: "20px",
      left: "71%",
      bottom: "10px",
      marginLeft: "0px",
      fontWeight: "500",
      width: "auto",
      zIndex: "9999"
    },
    
    // ここが「CSS」編集ポイント（後からここだけ触ればOK）
    // ※既存のCSSが別ファイルにあるなら、ここは最小でもOK
    CSS_TEXT: [
      ".cscs-star-summary-line-compact {",
      "  box-sizing: border-box;",
      "  padding: 0px 0px;",
      "  border-radius: 10px;",
      "  background: rgba(0,0,0,0.04);",
      "  backdrop-filter: blur(2px);",
      "  font-size: 12.5px;",
      "  line-height: 1.35;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-row {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 6px;",
      "  margin: 4px 0;",
      "  white-space: nowrap;",
      "  opacity: 0.65;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-meter {",
      "  opacity: 1;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-label {",
      "  opacity: 0.85;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-percent {",
      "  font-weight: 700;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-meter {",
      "  position: relative;",
      "  flex: 1 1 auto;",
      "  min-width: 60px;",
      "  height: 6px;",
      "  border-radius: 999px;",
      "  background: rgba(255,255,255,0.18);",
      "  overflow: hidden;",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-meter-fill {",
      "  display: block;",
      "  height: 100%;",
      "  width: var(--todayPercent, 0%);",
      "  background: rgba(255,255,255,0.55);",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-meter-fill-total {",
      "  width: var(--totalPercent, 0%);",
      "  background: rgba(255,255,255,0.75);",
      "}",
      ".cscs-star-summary-line-compact .cscs-star-mood {",
      "  opacity: 0.95;",
      "}",

      "",
      "/* =====================================================",
      " * Aパート専用スタイル（body.mode-a のときのみ適用）",
      " * -----------------------------------------------------",
      " * - compact行の見た目をA用に上書き",
      " * - Bパートには一切影響しない",
      " * ===================================================== */",
      "body.mode-a .cscs-star-summary-line-compact {",
      "  display: grid;",
      "  grid-template-columns: 1fr;",
      "  row-gap: 6px;",
      "  font-size: 14px;",
      "  margin-bottom: -5px;",
      "  margin-left: 0px;",
      "  width: 54%;",
      "  padding-bottom: 14px;",
      "  border-bottom: 1px solid rgba(255, 255, 255, 0.18);",
      "  margin-top: 10px;",
      "}",

      "",
      "/* =====================================================",
      " * Bパート専用スタイル（body.mode-b のときのみ適用）",
      " * ===================================================== */",
      "body.mode-b .cscs-star-summary-line-compact {",
      "  display: grid;",
      "  grid-template-columns: 1fr;",
      "  row-gap: 6px;",
      "  font-size: 14px;",
      "  margin-bottom: 15px;",
      "  margin-left: 0px;",
      "  width: 54%;",
      "  padding-bottom: 0px;",
      "  border-bottom: 0px solid rgba(255, 255, 255, 0.18);",
      "  margin-top: 15px;",
      "}",

      "",
      "/* =====================================================",
      " * 共通補助スタイル",
      " * ===================================================== */",
      ".cscs-star-main-compact {",
      "  font-weight: 600;",
      "}",

      ".cscs-star-summary-line-compact .cscs-star-mood {",
      "  margin-left: 6px;",
      "  opacity: 0.8;",
      "  white-space: nowrap;",
      "}",

      ""
    ].join("\n")
  };

  function injectCSSOnce() {
    try {
      var id = String(CONFIG.STYLE_TAG_ID || "");
      if (!id) {
        return;
      }
      var exists = null;
      try {
        exists = document.getElementById(id);
      } catch (_eGet) {
        exists = null;
      }
      if (exists) {
        return;
      }
      var style = document.createElement("style");
      style.id = id;
      style.type = "text/css";
      style.appendChild(document.createTextNode(String(CONFIG.CSS_TEXT || "")));
      (document.head || document.documentElement).appendChild(style);
    } catch (_eInject) {
    }
  }

  function applyInlineStyles(el, styleObj) {
    try {
      if (!el || !styleObj) {
        return;
      }
      var keys = Object.keys(styleObj);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        try {
          el.style[k] = String(styleObj[k]);
        } catch (_eSet) {
        }
      }
    } catch (_eAll) {
    }
  }

  function buildCompactHTML(data) {
    var targetNum = String(data.targetNum);
    var reachCount = String(data.reachCount);
    var preReachCount = String(data.preReachCount);

    var starTodayCount = String(data.starTodayCount);
    var todayPercentText = String(data.todayPercent);
    var moodText = String(data.moodText);

    var starTotalSolvedQuestions = String(data.starTotalSolvedQuestions);
    var totalPercentText = String(data.totalPercent);

    // HTMLの編集はここだけ見ればOK（テンプレ文字列で一塊）
    return (
      "<div class=\"cscs-star-row cscs-star-row-goal\">" +
        "<span class=\"cscs-star-label\">本日の目標</span>" +
        "<span class=\"cscs-star-percent\">⭐️" + targetNum + "個</span>" +
        "<span class=\"cscs-star-label\">／リーチ⚡️" + reachCount + "個／連続✨" + preReachCount + "個</span>" +
        "<span class=\"cscs-star-mood\"></span>" +
      "</div>" +

      "<div class=\"cscs-star-row cscs-star-row-today\">" +
        "<span class=\"cscs-star-label\">本日の獲得分</span>" +
        "<span class=\"cscs-star-percent\">+" + starTodayCount + "</span>" +
        "<span class=\"cscs-star-meter\">" +
          "<span class=\"cscs-star-meter-fill\"></span>" +
        "</span>" +
        "<span class=\"cscs-star-mood\">" + todayPercentText + "% (状況:" + moodText + ")</span>" +
      "</div>" +

      "<div class=\"cscs-star-row cscs-star-row-total\">" +
        "<span class=\"cscs-star-label\">現在の総進捗</span>" +
        "<span class=\"cscs-star-percent\">" + starTotalSolvedQuestions + "個</span>" +
        "<span class=\"cscs-star-meter\">" +
          "<span class=\"cscs-star-meter-fill cscs-star-meter-fill-total\"></span>" +
        "</span>" +
        "<span class=\"cscs-star-mood\">" + totalPercentText + "% (状況:" + moodText + ")</span>" +
      "</div>"
    );
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

      // CSSはここで1回だけ注入（編集は CONFIG.CSS_TEXT）
      injectCSSOnce();

      // コンパクトな進捗行を構築（3行・縦並び）
      var needLine = document.createElement("div");
      needLine.className = "cscs-star-summary-line-compact";

      // CSS変数でゲージ幅を渡す（HTMLの構造を固定化できて編集しやすい）
      try {
        needLine.style.setProperty("--todayPercent", String(todayPercent) + "%");
      } catch (_eVarToday) {
      }
      try {
        needLine.style.setProperty("--totalPercent", String(totalPercent.toFixed(2)) + "%");
      } catch (_eVarTotal) {
      }

      // HTMLは関数1箇所に集約（編集は buildCompactHTML）
      needLine.innerHTML = buildCompactHTML({
        targetNum: targetNum,
        starTodayCount: starTodayCount,
        todayPercent: String(todayPercent),
        starTotalSolvedQuestions: starTotalSolvedQuestions,
        totalPercent: String(totalPercent.toFixed(2)),
        moodText: moodText,
        reachCount: reachCount,
        preReachCount: preReachCount
      });

      // スタイルは設定1箇所に集約（編集は CONFIG.CONTAINER_STYLE）
      applyInlineStyles(needLine, CONFIG.CONTAINER_STYLE);

      // 追加した処理:
      // - div.cscs-star-summary-line-compact は常に <div id="root"> 直下へ入れる
      // - #root が無い場合のみ panel にフォールバック
      (function () {
        var root = null;

        try {
          root = document.getElementById("root");
        } catch (_eRoot) {
          root = null;
        }

        if (root && root.insertBefore) {
          root.insertBefore(needLine, root.firstChild);
          return;
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