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

  // この端末が「ちゃんと hover をサポートしているか」を判定するフラグ
  // - PC のマウス環境などでは true
  // - iPad / スマホなどのタッチ主体の環境では false になる想定
  var SUPPORTS_HOVER = false;
  try {
    if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      SUPPORTS_HOVER = true;
    }
  } catch (_eMediaHover) {
    SUPPORTS_HOVER = false;
  }

  // SCALE_STYLE_TEXT:
  //   ・.sa-hover           : hover 時のアニメーションを適用する共通クラス
  //   ・display:inline-block; padding:… により拡大時の文字切れを防止
  //   ・.sa-hover:hover     : hover 中のみ 1.10 倍に拡大
  //
  //   ・.sa-hover-fixed     :
  //       - クリック後に付与される「固定拡大」用のクラス
  //       - transform:scale(1.10) を常時維持
  //       - transition:none にすることで、hover/out による再アニメーションを完全に無効化
  var SCALE_STYLE_TEXT =
    ".sa-hover{" +
    "display:inline-block;" +
    "padding:2px 4px;" +
    "transition-property:transform;" +
    "transition-duration:0.15s;" +
    "transition-timing-function:ease-out;" +
    "transform-origin:center center;" +
    "cursor:pointer;" +
    "}" +
    ".sa-hover:hover{" +
    "transform:scale(1.10);" +
    "}" +
    ".sa-hover-fixed{" +
    "display:inline-block;" +                 // hover版と同じボックス特性を維持
    "padding:2px 4px;" +
    "transform-origin:center center;" +
    "transform:scale(1.10) !important;" +    // 常時 1.10 倍を強制
    "transition-property:none !important;" + // 以後はアニメーションさせない（サイズ固定）
    "}" +
    ".sa-hover-fixed:hover{" +
    "transform:scale(1.10) !important;" +    // hoverしても値は変えない（見た目も一切変化させない）
    "}" +
    "#cscs-fade-highlight-layer .sa-hover," +
    "#cscs-fade-highlight-layer .sa-hover-fixed," +
    "#cscs-fade-highlight-layer a{" +
    "transition-property:none !important;" +
    "transition-duration:0s !important;" +
    "transition-timing-function:linear !important;" +
    "animation:none !important;" +
    "animation-name:none !important;" +
    "animation-duration:0s !important;" +
    "}" +
    "#cscs-fade-highlight-layer *{" +
    "transition:none !important;" +
    "transition-property:none !important;" +
    "transition-duration:0s !important;" +
    "transition-timing-function:linear !important;" +
    "animation:none !important;" +
    "animation-name:none !important;" +
    "animation-duration:0s !important;" +
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

  // easeInOutQuad(t):
  //   ・0〜1 の進行度 t（時間割合）を「動きの加減速カーブ」に変換する関数。
  //   ・前半（t < 0.5）はゆっくり始まり徐々に加速し、
  //     後半は減速して止まる「自然な動き」を作る。
  //   ・CSS の transition-timing-function と同種の概念を JS で再現している。
  function easeInOutQuad(t) {
    if (t < 0.5) {
      return 2 * t * t;
    } else {
      return -1 + (4 - 2 * t) * t;
    }
  }

  // animateScale(el, from, to, duration, easing, onDone):
  //   ・要素 el の transform: scale() を「時間経過にあわせて連続的に変化」させる関数。
  //   ・from : 開始時の拡大率（例: 1.0）
  //   ・to   : 終了時の拡大率（例: 1.06）
  //   ・duration : アニメーション全体の時間（ミリ秒）
  //   ・easing   : 進行度（0→1）を動きのカーブに変換する関数
  //   ・onDone   : アニメ終了後に一度だけ実行されるコールバック
  //
  //   仕組み:
  //     1. performance.now() で開始時刻を取得
  //     2. requestAnimationFrame で毎フレーム tick() が呼ばれる
  //     3. 経過時間から進行度（progress 0〜1）を計算
  //     4. easing(progress) で滑らかな加減速カーブに変換
  //     5. scale(from → to) を補間して transform に適用
  //     6. 最終フレームで onDone() を呼ぶ
  //
  //   ※ CSS transition では表現しきれない「JS 制御の連続したアニメーション」を作れる。
  function animateScale(el, from, to, duration, easing, onDone) {
    if (!el) return;

    // ハイライトレイヤー(#cscs-fade-highlight-layer) 配下の要素に対しては、
    // アニメーションを一切行わず「最終状態のみ」を即時適用する。
    try {
      if (el.closest && el.closest("#cscs-fade-highlight-layer")) {
        var finalScale = (typeof to === "number") ? to : 1.0;
        el.style.transformOrigin = "center center";
        try {
          el.style.setProperty("transform", "scale(" + finalScale + ")", "important");
        } catch (_eSet) {
          el.style.transform = "scale(" + finalScale + ")";
        }
        if (typeof onDone === "function") {
          onDone();
        }
        return;
      }
    } catch (_eHighlightScale) {
      // closest 未対応環境では従来挙動
    }

    var start = performance.now();

    function tick(now) {
      var elapsed = now - start;                  // 経過時間
      var progress = elapsed / duration;          // 全体のどの位置まで進んだか（0〜1）
      if (progress > 1) {
        progress = 1;                             // 最後のフレームで 1 に固定
      }

      var eased = easing(progress);               // 加減速カーブを適用した進行度
      var value = from + (to - from) * eased;     // 拡大率の補間値を計算

      el.style.transform = "scale(" + value + ")";
      el.style.transformOrigin = "center center"; // 拡大の基準点は中央

      if (progress < 1) {
        requestAnimationFrame(tick);              // 次フレームへ
      } else {
        if (typeof onDone === "function") {
          onDone();                               // アニメ終了コールバック
        }
      }
    }

    requestAnimationFrame(tick);                  // アニメ開始
  }

  // ScaleAnimator:
  //   animateScale() を用途別にラップしたユーティリティ集。
  //   画面側からは「どんな動きをさせたいか」だけを指定できるようにしている。
  //
  //   grow(el)   : 要素をふわっと大きくする（from=1.0 → to=1.2）
  //   shrink(el) : 要素を小さくする（from=1.0 → to=0.8）
  //   pulse(el)  : 一度大きく → 元に戻す（ポヨンとする UI で使われる動き）
  //   scale(el)  : from → to の任意値へスケールさせる汎用版
  //
  //   ※現在の CSCS Aパートでは hover のみにして pulse/grow は使っていないが、
  //     将来的な UI 拡張で「押した瞬間に弾む」「Bパートだけ動かしたい」などに利用できるよう残してある。
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
      var d = typeof duration === "number" ? duration : 160;
      var m = typeof midScale === "number" ? midScale : 1.12;
      var e = typeof easing === "function" ? easing : easeInOutQuad;

      // midScale（例: 1.12）までふくらませ、同じ duration で元のサイズに戻す。
      // UI に「押し返してくるような弾力」を感じさせる典型的な動き。
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

    // ハイライトレイヤー配下のクローン要素にはスケール系のバインドを一切行わない。
    try {
      if (el.closest && el.closest("#cscs-fade-highlight-layer")) {
        return;
      }
    } catch (_eBindHighlight) {
      // closest 未対応環境では従来挙動
    }

    if (el.getAttribute("data-sa-bound") === "1") {
      return;
    }
    el.setAttribute("data-sa-bound", "1");

    // 初期状態では hover 用のクラスを付与して、
    // マウスオーバー時にだけ 1.10 倍へふわっと拡大させる。
    el.classList.add("sa-hover");

    // 選択肢行内の <a> かどうかを事前に判定しておく
    // - <ol class="opts"> の内部にある <a> も対象にするが、
    //   Bパート側では bindScaleToAllClickables() でそもそも除外される。
    var isChoiceAnchor = false;
    try {
      if (el.tagName === "A" && el.closest("ol.opts")) {
        isChoiceAnchor = true;
      }
    } catch (_e) {
      isChoiceAnchor = false;
    }

    // この要素が「一度でも hover 状態になったかどうか」をフラグで持っておく。
    // - PC（hover: hover）のみで有効にする。
    var hasHover = false;
    if (SUPPORTS_HOVER) {
      var markHovered = function () {
        hasHover = true;
        el.setAttribute("data-sa-hovered", "1");
      };
      // マウス環境での hover 開始を拾う
      el.addEventListener("mouseenter", markHovered);
      // pointer イベントに対応している環境では pointerover でも拾う
      el.addEventListener("pointerover", markHovered);
    }

    // ▼クリックされた瞬間の処理
    //   - hover サポートあり（PC等）かつ「一度でも hover された要素」の場合のみ、
    //     hover 状態（1.10倍）をそのまま固定する。
    //   - hover サポートなし（iPad 等）では、クリック時にスケール固定は行わない。
    el.addEventListener("click", function () {
      // タッチデバイスなど「hover なし」の環境では、クリック時にスケールを固定しない。
      if (!SUPPORTS_HOVER) {
        return;
      }

      // hover 経験が無ければ固定しない（= hover してからクリックしたときだけ固定）
      if (!hasHover && el.getAttribute("data-sa-hovered") !== "1") {
        return;
      }

      // Bパートの選択肢アンカーは bindScaleToAllClickables 側で除外されている前提なので、
      // ここでは isChoiceAnchor は特別扱いせず、PC なら他のボタンと同じ挙動にする。
      el.classList.remove("sa-hover");
      el.classList.add("sa-hover-fixed");
      el.style.transformOrigin = "center center";
      el.style.transform = "scale(1.10)";
    });
  }

  function bindScaleToAllClickables(root) {
    // baseSelectors:
    //   - "a[href]"             : 画面内の通常リンク（選択肢リンクなどを含む）
    //   - "button"              : <button> 要素全般
    //   - "[role=\"button\"]"   : role 属性でボタン扱いされている要素
    //   - "[data-sa-clickable]" : JS 側で明示的に「拡大対象」にしたい任意要素
    //   - "ol.opts li"          : A/B パートの選択肢 1 行全体（行面クリックを有効にしたい）
    //   - ".cscs-choice"        : そのほか問題選択 UI 系
    //   - ".nav-button" / ".nav-btn" : ページ遷移ナビゲーションのボタン
    //   - ".monitor-link" / ".monitor-button" : モニタ系 UI のリンク／ボタン
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

    // Bパートかどうかを事前に判定しておく（body.mode-b）
    var body = document.body;
    var isModeB = false;
    if (body && body.classList && body.classList.contains("mode-b")) {
      isModeB = true;
    }

    for (var i = 0; i < nodeList.length; i++) {
      var el = nodeList[i];

      // #cscs-fade-highlight-layer 配下のクローン要素は、
      // フェード専用表示なのでスケール系のイベントバインドは一切行わない。
      try {
        if (el.closest("#cscs-fade-highlight-layer")) {
          continue;
        }
      } catch (_eHighlight) {
        // closest が使えない古い環境では従来どおりの挙動にフォールバック
      }

      // ▼ 選択肢の行 <li>（ol.opts li）について
      //   ・ブラウザは <li> に対して「A. / B. / C. / D.」などのマーカーを描画する。
      //   ・<li> 全体を拡大すると、このマーカーも一緒に拡大されてしまう。
      //   ・今回の方針では「選択肢テキストの hover 時だけをアニメーションさせる」ため、
      //     <li> 自体には hover / click のスケールアニメーションを一切付けない。
      //   ・同じ行の中にある <a class=\"opt-link\" ...> は、bindScaleToElement() 側で
      //     hover 用クラス（sa-hover）のみ付与される。
      if (el.tagName === "LI" && el.closest("ol.opts")) {
        // Aパート / Bパートともに、<li> 自体にはスケール系の処理を何も行わない。
        continue;
      }

      // ▼ Bパートでは「選択肢テキスト自体」の拡大を無効化する。
      //   ・Aパート: <a href="...">（選択肢テキスト）は拡大対象
      //   ・Bパート: 同じ <a> でも、ol.opts 内にあるものは拡大対象から除外
      if (isModeB && el.tagName === "A" && el.closest("ol.opts")) {
        continue;
      }

      // 通常のボタン/リンク/role=button などは、
      // isFocusableClickable で「クリック可能」と判断されたもののみに拡大効果を付ける。
      if (isFocusableClickable(el)) {
        bindScaleToElement(el);
      }
    }
  }

  // DOM 構築完了時に一度全体へバインドし、
  // その後は MutationObserver で動的に追加された要素にも同じ処理を適用する。
  function setupGlobalBinding() {
    var body = document.body;

    // body.classList に "mode-a" または "mode-b" が付いているページだけを対象にする。
    //   ・Aパートの <body> には "mode-a"
    //   ・Bパートの <body> には "mode-b"
    //   が付与されている想定とし、それ以外の画面では hover 拡大を無効化する。
    if (!body || !body.classList) {
      return;
    }
    var isModeA = body.classList.contains("mode-a");
    var isModeB = body.classList.contains("mode-b");
    if (!isModeA && !isModeB) {
      return;
    }

    // ページ初期表示時点の DOM に対して一括バインド。
    injectScaleStyleIfNeeded();
    bindScaleToAllClickables(document);

    // MutationObserver が使えない古い環境では、
    // 初回バインドだけ行い、動的追加要素の追従は行わない。
    if (!window.MutationObserver) {
      return;
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
          // 追加されたノード自身とその子孫に対して、
          // 「押せる要素の自動検出＋バインド」を再実行して、
          // 動的に増えたボタン類にも同じ hover 拡大を適用する。
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