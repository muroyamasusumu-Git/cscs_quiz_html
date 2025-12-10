// assets/clickable_scale_effects.js
// 押せるボタンやリンクに「ふわっと拡大 → 戻る」動きを付ける共通スクリプト
// ・CSSはこのファイル内で <style> を自動挿入
// ・hover: わずかに拡大（押せそう感）
// ・click / Enter / Space: ポヨンと膨らんで戻る（pulse）
// ・Aパート / Bパート 共通で利用可能

(function () {
  "use strict";

  // =====================================
  // 1) CSS（hover用の拡大スタイル）を注入
  // =====================================
  var SCALE_STYLE_ID = "sa-scale-style";

  var SCALE_STYLE_TEXT =
    ".sa-hover{" +
    "transition-property:transform;" +
    "transition-duration:0.15s;" +
    "transition-timing-function:ease-out;" +
    "transform-origin:center center;" +
    "cursor:pointer;" +
    "}" +
    ".sa-hover:hover{" +
    "transform:scale(1.06);" +
    "}";

  function injectScaleStyleIfNeeded() {
    try {
      if (document.getElementById(SCALE_STYLE_ID)) {
        return;
      }
      var styleEl = document.createElement("style");
      styleEl.id = SCALE_STYLE_ID;
      styleEl.type = "text/css";
      if (styleEl.styleSheet) {
        // 古いIE対策（たぶん使わないけど一応）
        styleEl.styleSheet.cssText = SCALE_STYLE_TEXT;
      } else {
        styleEl.appendChild(document.createTextNode(SCALE_STYLE_TEXT));
      }
      document.head.appendChild(styleEl);
    } catch (e) {
      console.error("[clickable_scale_effects] CSS 注入に失敗しました:", e);
    }
  }

  // =====================================
  // 2) scale アニメーション本体（ScaleAnimator）
  // =====================================

  function easeInOutQuad(t) {
    if (t < 0.5) {
      return 2 * t * t;
    } else {
      return -1 + (4 - 2 * t) * t;
    }
  }

  function animateScale(el, from, to, duration, easing, onDone) {
    if (!el) return;

    var start = performance.now();

    function tick(now) {
      var elapsed = now - start;
      var progress = elapsed / duration;
      if (progress > 1) {
        progress = 1;
      }

      var eased = easing(progress);
      var value = from + (to - from) * eased;

      el.style.transform = "scale(" + value + ")";
      el.style.transformOrigin = "center center";

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        if (typeof onDone === "function") {
          onDone();
        }
      }
    }

    requestAnimationFrame(tick);
  }

  var ScaleAnimator = {
    grow: function (el, duration, to, from, easing) {
      var d = typeof duration === "number" ? duration : 200;
      var t = typeof to === "number" ? to : 1.2;
      var f = typeof from === "number" ? from : 1.0;
      var e = typeof easing === "function" ? easing : easeInOutQuad;
      animateScale(el, f, t, d, e, null);
    },

    shrink: function (el, duration, to, from, easing) {
      var d = typeof duration === "number" ? duration : 200;
      var t = typeof to === "number" ? to : 0.8;
      var f = typeof from === "number" ? from : 1.0;
      var e = typeof easing === "function" ? easing : easeInOutQuad;
      animateScale(el, f, t, d, e, null);
    },

    pulse: function (el, duration, midScale, easing) {
      var d = typeof duration === "number" ? duration : 160;    // 速めのポヨン
      var m = typeof midScale === "number" ? midScale : 1.12;  // 気持ちいいくらいの拡大
      var e = typeof easing === "function" ? easing : easeInOutQuad;

      animateScale(el, 1.0, m, d, e, function () {
        animateScale(el, m, 1.0, d, e, null);
      });
    },

    scale: function (el, from, to, duration, easing, onDone) {
      var f = typeof from === "number" ? from : 1.0;
      var t = typeof to === "number" ? to : 1.0;
      var d = typeof duration === "number" ? duration : 250;
      var e = typeof easing === "function" ? easing : easeInOutQuad;
      animateScale(el, f, t, d, e, onDone);
    }
  };

  // グローバルに公開（必要なら直接呼べるように）
  window.ScaleAnimator = ScaleAnimator;

  // =====================================
  // 3) 押せる要素を自動検出してアニメ付与
  // =====================================

  function isFocusableClickable(el) {
    if (!el) return false;

    var tag = el.tagName;
    if (tag === "BUTTON") return true;

    if (tag === "A" && el.hasAttribute("href")) return true;

    var role = el.getAttribute("role");
    if (role === "button") return true;

    if (el.hasAttribute("data-sa-clickable")) return true;

    return false;
  }

  function bindScaleToElement(el) {
    if (!el) return;

    if (el.getAttribute("data-sa-bound") === "1") {
      return;
    }
    el.setAttribute("data-sa-bound", "1");

    el.classList.add("sa-hover");          // hover 用のクラスだけ付与し、クリック時の JS アニメは行わない
  }

  function bindScaleToAllClickables(root) {
    var baseSelectors = [
      "a[href]",
      "button",
      "[role=\"button\"]",
      "[data-sa-clickable=\"1\"]",
      "ol.opts li",
      ".cscs-choice",
      ".nav-button",
      ".nav-btn",
      ".monitor-link",
      ".monitor-button"
    ];

    var selector = baseSelectors.join(",");
    var nodeList = root.querySelectorAll(selector);

    for (var i = 0; i < nodeList.length; i++) {
      var el = nodeList[i];

      // A/Bパートの選択肢行（ol.opts li）は「行全体」を押せる面として扱いたいので、
      // isFocusableClickable の判定に関係なく必ずバインドする。
      if (el.tagName === "LI" && el.closest("ol.opts")) {
        bindScaleToElement(el);
        continue;
      }

      // 通常のボタン/リンク/role=button などは、フォーカス可能なクリック要素だけにバインドする。
      if (isFocusableClickable(el)) {
        bindScaleToElement(el);
      }
    }
  }

  // DOM 構築完了時に一度全体へバインドし、
  // その後は MutationObserver で動的に追加された要素にも同じ処理を適用する。
  function setupGlobalBinding() {
    var body = document.body;
    if (!body || !body.classList || !body.classList.contains("mode-a")) {
      return;                              // Aパート以外（例: mode-b）では一切バインドしない
    }

    injectScaleStyleIfNeeded();
    bindScaleToAllClickables(document);

    if (!window.MutationObserver) {
      return;                              // 古い環境では初回バインドのみ
    }

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (!m.addedNodes || m.addedNodes.length === 0) {
          continue;
        }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          // 追加されたノード自身とその子孫に対して、同じ「押せる要素の自動検出＋バインド」を行う。
          bindScaleToAllClickables(node);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupGlobalBinding();
  });

  // 動的に追加されたDOM用（必要なら手動でも呼び出せるように）
  window.ScaleAnimatorBinding = {
    bindRoot: function (root) {
      injectScaleStyleIfNeeded();
      bindScaleToAllClickables(root || document);
    }
  };
})();