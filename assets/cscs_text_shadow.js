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
    var y = (0.6 + 0.8 * i).toFixed(2);     // 0.6..1.4
    var blur = (1.2 + 2.8 * i).toFixed(2);  // 1.2..4.0

    // alpha をノブで変化（暗背景でも邪魔になりにくい範囲）
    // 影を「少し」強めるため、ベース/伸び幅をわずかに増やす（見やすさ優先）
    var a1 = (0.18 + 0.26 * i).toFixed(3);  // 0.18..0.44
    var a2 = (0.08 + 0.16 * i).toFixed(3);  // 0.08..0.24

    // modeで質感を変える（crisp はちょい小さく/硬く）
    if (modeName === "crisp") {
      y = (0.4 + 0.6 * i).toFixed(2);       // 0.4..1.0
      blur = (0.8 + 1.8 * i).toFixed(2);    // 0.8..2.6
      // crisp は輪郭が出やすい一方で薄いと負けやすいので、alpha を少しだけ上乗せ
      a1 = (0.20 + 0.28 * i).toFixed(3);    // 0.20..0.48
      a2 = (0.10 + 0.18 * i).toFixed(3);    // 0.10..0.28
    }

    // 2段重ね（メインの影 + ごく薄い外側）で “滲み” を抑えつつ読みやすく
    var shadow = [
      "0 " + y + "px " + blur + "px rgba(0,0,0," + a1 + ")",
      "0 0 " + (Number(blur) + 1.2).toFixed(2) + "px rgba(0,0,0," + a2 + ")"
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