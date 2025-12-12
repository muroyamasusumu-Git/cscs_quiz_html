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
  //   ・.sa-hover                    : hover 時のアニメーションを適用する共通クラス
  //   ・display:inline-block; padding:… により拡大時の文字切れを防止
  //   ・.sa-hover:hover,:active      : hover / active 中のみ 1.10 倍に拡大
  //
  //   ・.sa-hover-fixed              :
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
    ".sa-hover:hover,.sa-hover:active{" +
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
    ".sa-correct-pulse-inner{" +
    "display:inline-block;" +                // テキスト塊だけを拡大させるためのインラインブロック
    "transform-origin:center center;" +      // 拡大の基準点を中央に固定
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

  // easeOutCubic(t):
  //   ・最初が速く、後半ほどゆっくり減速して止まる（＝「最初早めで、あとゆっくり」）
  //   ・Bパートの正解拡大で「キュッ → ふわっ」を作る用途向け
  function easeOutCubic(t) {
    var u = 1 - t;
    return 1 - (u * u * u);
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
      // transform-origin は、事前にスタイルで指定されていればそれを尊重し、
      // 指定がない場合のみデフォルトで center center にする。
      if (!el.style.transformOrigin || el.style.transformOrigin === "") {
        el.style.transformOrigin = "center center"; // 拡大の基準点は中央
      }

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
      // hover をサポートしていない環境では、
      // 選択肢アンカー以外は従来どおり何もしない。
      if (!SUPPORTS_HOVER && !isChoiceAnchor) {
        return;
      }

      // 通常ボタン類は「一度 hover 済み」のものだけロック対象にする。
      // 選択肢アンカー(<ol class="opts"> 内の <a>)は hover の有無に関係なく固定拡大させる。
      if (!isChoiceAnchor) {
        if (!hasHover && el.getAttribute("data-sa-hovered") !== "1") {
          return;
        }
      }

      // ▼ クリック時点の見た目の transform を「一度だけ」取得して固定値にする。
      //    以後は getComputedStyle を再度読まず、この fixed 値だけを延々と上書きし続ける。
      //    途中で CSS が 1.0 に戻っても、それを拾ってしまうことがないようにする。
      var lockedTransform = "scale(1.10)";
      try {
        var csInit = window.getComputedStyle(el);
        var tfInit = csInit ? csInit.transform : null;
        if (tfInit && tfInit !== "none") {
          lockedTransform = tfInit;
        }
      } catch (_eInit) {
        lockedTransform = "scale(1.10)";
      }

      // ▼ 即座に 1 フレーム目のロックをかける（見た目と transform を同期）
      //    ここで inline style + !important を入れて、この時点での拡大状態を固定する。
      el.style.transformOrigin = "center center";
      el.style.setProperty("transform", lockedTransform, "important");
      el.style.setProperty("transition", "none", "important");
      el.style.setProperty("transition-property", "none", "important");
      el.style.setProperty("transition-duration", "0s", "important");
      el.style.setProperty("transition-timing-function", "linear", "important");
      el.style.setProperty("animation", "none", "important");
      el.style.setProperty("animation-name", "none", "important");
      el.style.setProperty("animation-duration", "0s", "important");
      el.style.setProperty("animation-timing-function", "linear", "important");

      // CSS 側の hover 効果から切り離し、「固定表示」用クラスに切り替える。
      // これにより、:hover の on/off で transform が変化しなくなる。
      el.classList.remove("sa-hover");
      el.classList.add("sa-hover-fixed");

      // ▼ ロック中は hover/out 由来のイベントを遮断するため、
      //    一時的に pointer-events を無効化しておく。
      //    これでマウスの出入りによる :hover 状態の変化トリガーも封じる。
      el.style.setProperty("pointer-events", "none", "important");

      // ▼ 一定フレーム数のあいだ、lockedTransform をひたすら上書きし続けるループ。
      //    - フェードアウト(800ms)よりかなり長い 240 フレーム(約4秒@60fps) まで継続させる。
      //    - 毎フレーム、transform と transition/animation を強制的に上書きし続けることで、
      //      1.0 に戻ろうとするあらゆる CSS/JS の介入を物理的に潰す。
      var frameCount = 0;
      var maxFrames = 240;

      function hardLockLoop() {
        frameCount += 1;

        // 要素が既に DOM から外れている場合は、これ以上何もしない
        if (!document.body || !document.body.contains(el)) {
          return;
        }

        try {
          // transform を毎フレーム lockedTransform に上書きし続ける。
          el.style.transformOrigin = "center center";
          el.style.setProperty("transform", lockedTransform, "important");

          // 1.0 に戻ろうとする CSS transition/animation を毎フレーム完全に無効化する。
          el.style.setProperty("transition", "none", "important");
          el.style.setProperty("transition-property", "none", "important");
          el.style.setProperty("transition-duration", "0s", "important");
          el.style.setProperty("transition-timing-function", "linear", "important");
          el.style.setProperty("animation", "none", "important");
          el.style.setProperty("animation-name", "none", "important");
          el.style.setProperty("animation-duration", "0s", "important");
          el.style.setProperty("animation-timing-function", "linear", "important");
        } catch (_eLoop) {
          // ここでエラーになっても特にフォールバックは行わない。
        }

        if (frameCount < maxFrames) {
          requestAnimationFrame(hardLockLoop);
        } else {
          // ▼ ロック完了後に pointer-events を元に戻し、
          //    以後のクリックや hover を通常どおり受け付けるようにする。
          el.style.removeProperty("pointer-events");
        }
      }

      // ▼ 次フレーム以降でハードロックループを開始する。
      //    クリックに伴う :active / :hover の切り替えが一通り走った後も、
      //    その上から lockedTransform をねじ込み続ける。
      requestAnimationFrame(hardLockLoop);
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

    // ▼ Bパートの正解選択肢(<li class="is-correct">)とその他の選択肢に、
    //    ページ表示時に一度だけスケールアニメーションを付ける。
    //    - body.mode-b のときだけ有効
    //    - 正解: 中身だけを 1.0 → 1.20 → 1.00 → 1.10 に変化（全体を少しゆっくりめに）
    //    - 不正解: 中身だけを 1.0 → 0.90 に縮小してそのままキープ（こちらも少しゆっくり）
    //    - <li> 本体ではなく、内部ラッパー <span> に対してスケールをかけることで、
    //      A〜D のリストマーカーは拡大・縮小させず、テキスト部分だけを中央から動かす。
    if (isModeB) {
      try {
        var correctLis = document.querySelectorAll("li.is-correct");
        for (var k = 0; k < correctLis.length; k++) {
          var li = correctLis[k];

          // 既にラッパーがある場合はそれを再利用し、
          // 無い場合は <li> 直下の中身をすべて <span class="sa-correct-pulse-inner"> で包む。
          var inner = li.querySelector(".sa-correct-pulse-inner");
          if (!inner) {
            inner = document.createElement("span");
            inner.className = "sa-correct-pulse-inner";

            // <li> の既存の子ノード（テキスト・<span>・<small> など）をすべて
            // sa-correct-pulse-inner の中に移動させる。
            // これにより、見た目の構造は変えずに「中身だけを 1 つの塊」として扱える。
            while (li.firstChild) {
              inner.appendChild(li.firstChild);
            }
            li.appendChild(inner);
          }

          // ▼ 正解テキスト塊は「左端を基準に」右方向だけ拡大させる。
          //   A〜D のリストマーカーに被らないようにしつつ、
          //   不正解側(otherInner)と同じ左端ラインに揃える。
          try {
            inner.style.display = "inline-block";
            inner.style.width = "100%";
            inner.style.transformOrigin = "left center";

            // 不正解側と同じく、position + left でテキスト塊の左端位置を揃える
            inner.style.position = "relative";
            inner.style.left = "-10px"; // (-40px + 34px) → 正解だけ右へ34px寄せる
          } catch (_eCorrectOrigin) {
            // style 設定に失敗しても致命的ではないので、そのまま進める
          }

          // ▼ 正解テキスト塊(inner) に対して
          //      1.0 → 1.20 → 1.00 → 1.10
          //    の順にスケールを変化させる三段アニメーションを付与する。
          //   - 時間を全体的に伸ばして、Bパートの結果表示に合う「ゆっくりめ」の動きにする。
          (function runTriplePulse(targetEl, correctLi) {
            // 正解行は 1.0 → 1.10 だけにして、ゆっくりフワッと拡大させる
            // easeInOutQuad によって、立ち上がりはやや速く、その後なめらかに減速する。
            // 正解行の拡大と「その他の選択肢の縮小」で速度を分ける
            // - 正解行：従来どおり少しゆっくり
            // - その他：もっと速く縮む（A→B遷移の視認性を上げる）
            var correctDuration = 520; // 正解アニメ全体の時間（ゆっくりめ）
            var otherShrinkDuration = 220; // ★その他の縮小スピード（短いほど速い）

            // 正解行のスケールアニメーション（1.0 → 1.10 の一段だけ）
            // - 最初速く立ち上がって、後半ゆっくり止まる（「最初早めで、あとゆっくり」）
            animateScale(targetEl, 1.0, 1.10, correctDuration, easeOutCubic, null);

            // ▼ 同じ <ol> 内にある「その他の選択肢 li」に対しては、
            //    中身だけを 1.0 → 0.90 に縮小するアニメーションを付与する。
            //    - こちらは otherShrinkDuration で速めに縮める
            try {
              var listNode = correctLi.parentNode;
              if (!listNode) {
                return;
              }

              var allLis = listNode.querySelectorAll("li");
              for (var i = 0; i < allLis.length; i++) {
                var otherLi = allLis[i];
                if (otherLi === correctLi) {
                  continue;
                }

                // 既にラッパーがある場合はそれを再利用し、
                // 無い場合は <li> 直下の中身をすべて <span class="sa-correct-pulse-inner"> で包む。
                // 正解と同じクラス名を使うが、役割は
                //   - 「テキスト部分だけを 1 つの塊にする共通ラッパー」
                // として扱う。
                var otherInner = otherLi.querySelector(".sa-correct-pulse-inner");
                if (!otherInner) {
                  otherInner = document.createElement("span");
                  otherInner.className = "sa-correct-pulse-inner";
                  while (otherLi.firstChild) {
                    otherInner.appendChild(otherLi.firstChild);
                  }
                  otherLi.appendChild(otherInner);
                }

                // 不正解側は 1.0 → 0.90 にだけ縮小して、そのサイズで落ち着かせる。
                // 行頭の縦ラインをきれいに揃えるため、
                //  - display:inline-block
                //  - width:100%
                //  - transform-origin:left center
                //  - position + left で、テキスト塊全体をリストマーカー側へ寄せる
                // を明示指定して「左端を基準に横方向だけすぼみつつ、インデントも少し浅くする」ようにする。
                try {
                  otherInner.style.display = "inline-block";
                  otherInner.style.width = "100%";
                  otherInner.style.transformOrigin = "left center";

                  // ▼ 縦ラインをもっと強く左側へ寄せる
                  otherInner.style.position = "relative";
                  otherInner.style.left = "-10px";
                } catch (_eSetOrigin) {
                  // style 設定に失敗しても致命的ではないので、そのまま進める
                }

                // 全体のテンポにあわせて、ゆっくり縮んでそのまま静止させる。
                animateScale(otherInner, 1.0, 0.90, otherShrinkDuration, easeInOutQuad, null);
              }
            } catch (_eShrinkOthers) {
              // 縮小処理で失敗しても、正解アニメ自体には影響させない
            }
          })(inner, li);
        }
      } catch (_eCorrectPulse) {
        // 正解行が存在しない場合や取得失敗時も、他処理への影響は出さない
      }
    }

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