// assets/b_wrong_strike_mark.js
// 目的: b_judge.js が付与した「cscs-wrong-choice」クラスを検知し、
//       .sa-correct-pulse-inner に打ち消し線の見た目だけを適用する（演出専用 / 集計はしない）
(function(){
  "use strict";

  // 追加処理①：このJSの多重インストール防止（同一ページで複数回読み込まれても1回だけ動かす）
  if (window.__cscsBWrongStrikeMarkInstalled) return;
  window.__cscsBWrongStrikeMarkInstalled = true;

  var STYLE_ID = "cscs-wrong-strike-mark-style";
  var OBSERVER_KEY = "__cscsBWrongStrikeMarkObserver";

  // 追加処理②：打ち消し線の見た目を CSS で固定注入（1回だけ）
  function injectStyleOnce(){
    try{
      if (document.getElementById(STYLE_ID)) return;

      var styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.type = "text/css";

      var cssText =
        "ol.opts li.cscs-wrong-choice{ text-decoration:none !important; }" +
        "ol.opts li.cscs-wrong-choice .sa-correct-pulse-inner{" +
          "text-decoration-line:line-through !important;" +
          "text-decoration-thickness:2px !important;" +
          "text-decoration-color:currentColor !important;" +
          "text-decoration-style:solid !important;" +
        "}";

      if (styleEl.styleSheet) {
        styleEl.styleSheet.cssText = cssText;
      } else {
        styleEl.appendChild(document.createTextNode(cssText));
      }
      document.head.appendChild(styleEl);
    }catch(_){}
  }

  // 追加処理③：現在の DOM 状態から「誤答マーク済み」を探し、.sa-correct-pulse-inner に線が当たる状態へ寄せる
  // - 実際の線は CSS 側で出す（ここは“見つけて揃える”だけ）
  function applyStrikeToCurrent(){
    try{
      var ol = document.querySelector("ol.opts");
      if (!ol) return;

      var wrongLis = ol.querySelectorAll("li.cscs-wrong-choice");
      if (!wrongLis || wrongLis.length === 0) return;

      for (var i = 0; i < wrongLis.length; i++) {
        var li = wrongLis[i];

        // 念のため：li 自体には線が入らないようにして marker 巻き込みを防ぐ
        try{
          if (li.style && typeof li.style.setProperty === "function") {
            li.style.setProperty("text-decoration", "none", "important");
            li.style.setProperty("text-decoration-line", "none", "important");
          } else if (li.style) {
            li.style.textDecoration = "none";
          }
        }catch(_eLi){}

        // 演出対象は .sa-correct-pulse-inner に固定
        var inner = null;
        try { inner = li.querySelector(".sa-correct-pulse-inner"); } catch(_eInner) { inner = null; }
        if (!inner) continue;

        // 念のため：他JSが inline style で消してくる場合に備えて、inline にも最低限入れておく
        // （本体は CSS !important で固定）
        try{
          if (inner.style && typeof inner.style.setProperty === "function") {
            inner.style.setProperty("text-decoration-line", "line-through", "important");
            inner.style.setProperty("text-decoration-thickness", "2px", "important");
            inner.style.setProperty("text-decoration-color", "currentColor", "important");
            inner.style.setProperty("text-decoration-style", "solid", "important");
          } else if (inner.style) {
            inner.style.textDecoration = "line-through";
          }
        }catch(_eInline){}
      }
    }catch(_){}
  }

  // 追加処理④：後から DOM が差し替わっても打ち消し線が消えないように監視する
  // - 監視対象は ol.opts（存在する場合）
  function installObserver(){
    try{
      if (window[OBSERVER_KEY]) return;

      var ol = document.querySelector("ol.opts");
      if (!ol) return;

      if (!window.MutationObserver) return;

      var obs = new MutationObserver(function(){
        applyStrikeToCurrent();
      });

      obs.observe(ol, { childList: true, subtree: true, attributes: true });
      window[OBSERVER_KEY] = obs;
    }catch(_){}
  }

  // 追加処理⑤：初期実行（DOMタイミング差に強くするため複数回）
  function boot(){
    injectStyleOnce();
    applyStrikeToCurrent();
    installObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    window.addEventListener("load", boot, { once: true });
  } else {
    boot();
    window.addEventListener("load", boot, { once: true });
  }

  setTimeout(boot, 0);
  setTimeout(boot, 50);
  setTimeout(boot, 200);
  setTimeout(boot, 600);

})(); 