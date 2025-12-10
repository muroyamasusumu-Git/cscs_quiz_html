// assets/cscs_slide_in.js
// CSCS 共通: 「左からのスライドイン」演出専用スクリプト
// - アニメーション定義とターゲット要素の制御をこのファイルに集約する。
// - 各機能JSは「スライドさせたい要素」をHTMLクラスや構造で用意するだけ。
// - どの要素をスライドさせるかは、下の SLIDE_TARGET_SELECTORS を編集して調整する。

(function () {
  "use strict";

  // =========================================
  // スライドイン対象のセレクタ設定
  // ※ ここに書いたセレクタの要素が左からスライドインする
  // =========================================
  var SLIDE_TARGET_SELECTORS = [
    "#judge",   // Bパートの判定表示エリア
    ".answer"   // 「正解: A ～」などの解答表示エリア
  ];

  // 一度だけアニメ用スタイルを注入する
  function ensureSlideStyle() {
    if (document.getElementById("cscs-slide-style")) return;

    var style = document.createElement("style");
    style.id = "cscs-slide-style";
    style.type = "text/css";
    style.textContent =
      ".cscs-slide-in-left {" +
      "  animation: cscsSlideInLeft 0.5s ease-out 0s 1;" +
      "  transform-origin: center left;" +
      "}" +
      "@keyframes cscsSlideInLeft {" +
      "  0% { transform: translateX(-40px); opacity: 0; }" +
      "  100% { transform: translateX(0); opacity: 1; }" +
      "}";

    var head =
      document.head ||
      document.getElementsByTagName("head")[0] ||
      document.documentElement;
    head.appendChild(style);
  }

  // 対象要素にスライドイン用クラスを付与する（多重適用は data 属性でガード）
  function applySlideInOnce() {
    try {
      ensureSlideStyle();

      for (var i = 0; i < SLIDE_TARGET_SELECTORS.length; i++) {
        var sel = SLIDE_TARGET_SELECTORS[i];
        if (!sel) continue;

        var nodes = document.querySelectorAll(sel);
        if (!nodes || nodes.length === 0) continue;

        for (var j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (!el) continue;

          // すでに適用済みならスキップ（何度呼んでも一度だけ発火）
          if (el.getAttribute("data-cscs-slide-applied") === "1") {
            continue;
          }

          el.setAttribute("data-cscs-slide-applied", "1");
          el.classList.add("cscs-slide-in-left");
        }
      }
    } catch (e) {
      try {
        console.warn("[cscs_slide_in] applySlideInOnce error", e);
      } catch (_) {}
    }
  }

  // 初期化: DOM 準備後に一度スライドインを試みる
  function initSlideIn() {
    applySlideInOnce();

    // 少し遅延させて再度実行（他JSが後から DOM を書き換えるケースへの保険）
    setTimeout(applySlideInOnce, 50);
    setTimeout(applySlideInOnce, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSlideIn, { once: true });
    window.addEventListener("load", applySlideInOnce);
  } else {
    initSlideIn();
    window.addEventListener("load", applySlideInOnce);
  }

  // 外部から直接呼びたい場合用の簡易API
  // 例: CSCS_SLIDE.addLeft(document.querySelector(".foo"));
  window.CSCS_SLIDE = {
    addLeft: function (el) {
      try {
        if (!el) return;
        ensureSlideStyle();
        if (el.getAttribute("data-cscs-slide-applied") === "1") {
          return;
        }
        el.setAttribute("data-cscs-slide-applied", "1");
        el.classList.add("cscs-slide-in-left");
      } catch (e) {
        try {
          console.warn("[cscs_slide_in] addLeft error", e);
        } catch (_) {}
      }
    }
  };
})();