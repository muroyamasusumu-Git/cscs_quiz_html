// assets/cscs_slide_in.js
// CSCS 共通: 「左からのスライドイン」演出専用スクリプト
// - アニメーション定義とターゲット要素の制御をこのファイルに集約する。
// - 各機能JSは「スライドさせたい要素」をHTMLクラスや構造で用意するだけ。
// - どの要素をスライドさせるかは、下の SLIDE_TARGET_SELECTORS を編集して調整する。

(function () {
  "use strict";

  // =========================================
  // スライドイン対象のセレクタ設定（A/Bで切り替え）
  // - Aパート (body.mode-a): 問題文<h1>と<ol class="opts">もスライドイン
  // - Bパート (body.mode-b): #judge / .answer のみスライドイン
  // =========================================
  function getSlideTargetSelectors() {
    var body = document.body || document.getElementsByTagName("body")[0];
    var isModeB = false;

    if (body && body.classList && typeof body.classList.contains === "function") {
      isModeB = body.classList.contains("mode-b");
    }

    // Bパート: 判定表示エリア / 解答表示 / 解説テキストだけスライドイン
    if (isModeB) {
      return [
        "#judge",
        ".answer",
        ".explain-text"  // Bパートの解説文(span.explain-text)を、少し遅れてスライドインさせる対象として追加
      ];
    }

    // Aパート（その他）: 問題文 + 選択肢もスライドイン対象に含める
    return [
      "#judge",
      ".answer",
      "h1",
      "ol.opts"
    ];
  }

  // 一度だけアニメ用スタイルを注入する
  function ensureSlideStyle() {
    if (document.getElementById("cscs-slide-style")) return;

    var style = document.createElement("style");
    style.id = "cscs-slide-style";
    style.type = "text/css";
    style.textContent =
      // 汎用スライドイン（h1 / #judge / .answer / ol.opts などに利用）
      ".cscs-slide-in-left {" +
      "  animation: cscsSlideInLeft 0.5s ease-out 0s 1;" +  // 左から 0.5 秒でスライドインする基本アニメーション
      "  animation-fill-mode: both;" +                      // アニメ後も最終状態を維持する
      "  transform-origin: center left;" +                  // 左側を基準にスライドさせる
      "}" +
      // 解説テキスト専用のスライドイン（span.explain-text 用）
      ".cscs-slide-in-left-explain {" +
      "  animation: cscsSlideInLeftExplain 0.5s ease-out 0s 1;" + // 少し大きめに左からスライドイン
      "  animation-fill-mode: both;" +                            // アニメ後も最終位置を維持
      "  transform-origin: center left;" +                        // 左側基準
      "  display: inline-block;" +                                // inline 要素だと移動量が分かりづらいので inline-block にする
      "}" +
      "@keyframes cscsSlideInLeft {" +
      "  0% { transform: translateX(-40px); opacity: 0; }" +      // 通常要素は 40px 程度のスライド
      "  100% { transform: translateX(0); opacity: 1; }" +
      "}" +
      "@keyframes cscsSlideInLeftExplain {" +
      "  0% { transform: translateX(-80px); opacity: 0; }" +      // 解説は少し大きめに 80px 左から滑り込ませる
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

      var selectors = getSlideTargetSelectors();

      for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
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

          // 「この要素にはスライドイン処理を予約済み」というフラグを先に立てる
          el.setAttribute("data-cscs-slide-applied", "1");

          // 解説テキスト(span.explain-text)かどうかを判定する
          // - classList が使える環境では contains を優先
          // - そうでない場合は class 属性文字列から判定する
          var isExplainText = false;
          if (el.classList && typeof el.classList.contains === "function") {
            isExplainText = el.classList.contains("explain-text");
          } else {
            var clsText = el.getAttribute("class") || "";
            if (clsText.indexOf("explain-text") !== -1) {
              isExplainText = true;
            }
          }

          if (isExplainText) {
            // 解説テキストだけ、わずかに遅らせて「解説専用アニメーション」でスライドインさせる
            // - display:inline なままだと横移動が分かりづらいので、CSS側で inline-block にしている
            setTimeout(
              (function (targetEl) {
                return function () {
                  if (!targetEl) {
                    return;
                  }
                  try {
                    targetEl.classList.add("cscs-slide-in-left-explain"); // 解説専用アニメーションを適用
                  } catch (_e) {
                    // classList.add に失敗しても他要素には影響させない
                  }
                };
              })(el),
              250 // 遅延時間（ミリ秒）。必要に応じて 200〜300ms 程度で微調整可能
            );
          } else {
            // 通常の要素は即時に汎用スライドインアニメーションを適用
            el.classList.add("cscs-slide-in-left");
          }
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