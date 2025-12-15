// assets/cscs_text_shadow.js
/**
 * CSCS Text Drop Shadow (global)
 *
 * 目的:
 * - 画面内のテキスト全体に「読みやすさのための薄い影」を付ける
 * - 1枚の style を注入して、ON/OFF と強さを JS から調整できるようにする
 *
 * 公開API:
 *   window.CSCS_TEXT_SHADOW.setEnabled(true|false)
 *   window.CSCS_TEXT_SHADOW.setIntensity(0..1)
 *   window.CSCS_TEXT_SHADOW.setMode("soft"|"crisp")
 *
 * 注意:
 * - "text-shadow" はテキストにだけ効く（画像やSVGには効かない）
 * - 全体 * にかけるので、必要なら excludeSelectors に追加して対象外を作れる
 */
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
    __effectsDisabled = false;
  }
  if (__effectsDisabled) {
    return;
  }

  var STYLE_ID = "cscs-text-shadow-style";
  var BODY_CLASS = "cscs-text-shadow-on";

  // 0..1（影の濃さ/強さのノブ）
  var intensity = 0.55;

  // "soft"  : ふわっと（暗め背景向け）
  // "crisp" : くっきり（明るめ背景向け）
  var mode = "soft";

  var enabled = true;

  // 影を当てたくない要素があればここに追加（例: アイコンだけは影不要、など）
  // CSS セレクタで指定（複数OK）
  var excludeSelectors = [
    "svg",
    "svg *",
    "canvas",
    "img",
    "video",
    ".no-text-shadow",
    ".no-text-shadow *"
  ];

  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function ensureStyleTag() {
    var el = document.getElementById(STYLE_ID);
    if (el) return el;

    el = document.createElement("style");
    el.id = STYLE_ID;
    el.type = "text/css";
    document.head.appendChild(el);
    return el;
  }

  function buildShadowCSS(intensity01, modeName) {
    // 強さに応じて「ぼかし/距離/濃さ」を動かす
    // ほんの少しだけ “下” に落とすと読みやすくなる（特に小さい文字）
    var i = clamp01(intensity01);

    // px をノブで変化
    // 縦方向の落ちを増やして立体感を強める
    var y = (0.8 + 1.0 * i).toFixed(2);     // 0.8..1.8
    var blur = (1.2 + 2.8 * i).toFixed(2);  // 1.2..4.0

    // alpha をノブで変化（暗背景でも邪魔になりにくい範囲）
    // 影を「かなり」強めるため、メイン影を明確に主役化
    var a1 = (0.28 + 0.36 * i).toFixed(3);  // 0.28..0.64
    var a2 = (0.12 + 0.22 * i).toFixed(3);  // 0.12..0.34

    // modeで質感を変える（crisp はちょい小さく/硬く）
    if (modeName === "crisp") {
      // crisp でも落ちを感じられるように少し増やす
      y = (0.6 + 0.8 * i).toFixed(2);       // 0.6..1.4
      blur = (0.8 + 1.8 * i).toFixed(2);    // 0.8..2.6
      // crisp は輪郭が出やすい一方で薄いと負けやすいので、alpha をしっかり上乗せ
      a1 = (0.30 + 0.38 * i).toFixed(3);    // 0.30..0.68
      a2 = (0.14 + 0.24 * i).toFixed(3);    // 0.14..0.38
    }

    // メイン影 + 外側影 + ごく薄い補助影（背景が強くても輪郭を保持）
    var shadow = [
      "0 " + y + "px " + blur + "px rgba(0,0,0," + a1 + ")",
      "0 0 " + (Number(blur) + 1.8).toFixed(2) + "px rgba(0,0,0," + a2 + ")",
      "0 0 " + (Number(blur) + 3.0).toFixed(2) + "px rgba(0,0,0," + (a2 * 0.6).toFixed(3) + ")"
    ].join(",");

    return shadow;
  }

  function apply() {
    var styleEl = ensureStyleTag();
    var shadow = buildShadowCSS(intensity, mode);

    // :where(*) を使うと詳細度が低くて上書きしやすい
    // ただし * 全体に当てるので、不要なところは excludeSelectors で打ち消す
    var excludeCSS = "";
    for (var k = 0; k < excludeSelectors.length; k++) {
      excludeCSS += "body." + BODY_CLASS + " " + excludeSelectors[k] + "{ text-shadow: none !important; }\n";
    }

    styleEl.textContent =
      "body." + BODY_CLASS + " :where(*){ text-shadow: " + shadow + "; }\n" +
      excludeCSS;

    if (enabled) {
      document.body.classList.add(BODY_CLASS);
    } else {
      document.body.classList.remove(BODY_CLASS);
    }
  }

  function setEnabled(v) {
    enabled = !!v;
    apply();
  }

  function setIntensity(v) {
    intensity = clamp01(v);
    apply();
  }

  function setMode(v) {
    var s = String(v || "").toLowerCase();
    if (s !== "soft" && s !== "crisp") return;
    mode = s;
    apply();
  }

  // 公開API
  window.CSCS_TEXT_SHADOW = {
    setEnabled: setEnabled,
    setIntensity: setIntensity,
    setMode: setMode
  };

  // DOM ready 待ち（bodyが無いタイミングの class 操作を避ける）
  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      fn();
      return;
    }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  onReady(function () {
    apply();
  });
})();