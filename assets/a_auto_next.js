// a_auto_next.js — Aパート用：選択肢クリック → Bパートへ安全に自動遷移
(function () {
  "use strict";

  if (window.__CSCS_A_AUTO_NEXT_LOADED__) {
    return;
  }
  window.__CSCS_A_AUTO_NEXT_LOADED__ = true;

  function bindAutoNext() {
    var links = document.querySelectorAll("ol.opts a.opt-link");
    if (!links || !links.length) {
      return;
    }

    for (var i = 0; i < links.length; i++) {
      (function (a) {
        if (a.dataset.autoNextBound === "1") {
          return;
        }
        a.dataset.autoNextBound = "1";

        a.addEventListener(
          "click",
          function (ev) {
            try {
              // 修飾キーがある場合（新規タブなど）は元のブラウザ挙動を優先
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
                return;
              }

              var href = a.getAttribute("href");
              if (!href) {
                return;
              }

              ev.preventDefault();
              ev.stopPropagation();

              // 軽いディレイを入れて二重送信や描画競合を避ける
              setTimeout(function () {
                try {
                  window.location.href = href;
                } catch (e) {
                  // 最悪リンクのデフォルト遷移にフォールバック
                  window.location.assign(href);
                }
              }, 80);
            } catch (_e) {
            }
          },
          { passive: false }
        );
      })(links[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAutoNext);
  } else {
    bindAutoNext();
  }
})();