// assets/cscs_fade_overlay.js
/**
 * CSCS Fade Overlay + Highlight Transition Controller
 *
 * 【このファイルは元々「フェードイン/フェードアウト専用」だったが、現在は clickable_scale_effects.js と密接に連動する。】
 * clickable_scale_effects.js は「クリック直後の transform(scale) を固定する（sa-hover-fixed 等）」挙動を持つため、
 * ページ遷移フェード中に hover/active/JS/CSS の揺り戻しで scale(1.0) に戻ることがある。
 * その揺り戻しを確実に潰して「クリック直後の見た目のまま暗転→遷移」させるために、
 * このファイル側でも transform/transition/animation を強制固定する処理（スケール系のハードロック）を持っている。
 *
 * ------------------------------------------------------------
 * このJSがやっていること（全体像 / ChatGPT向けの要約）
 * ------------------------------------------------------------
 *
 * 1) フェード用の黒幕オーバーレイを生成・再利用する
 *    - id="cscs-global-fade-overlay" を body に 1 回だけ作り、
 *      opacity の transition で暗転/復帰を表現する。
 *
 * 2) フェードアウト遷移（fadeOutTo）
 *    - overlay を透明→指定の濃さへ変化させて暗転し、
 *      sessionStorage に「フェード中だった」印を残してから nextUrl へ遷移する。
 *    - mode-a の場合だけフェード時間を短くする等の分岐を持つ。
 *
 * 3) フェードイン（runFadeInIfNeeded）
 *    - 遷移前に残された sessionStorage フラグを見て、
 *      暗い状態から opacity=0 へ戻すことで復帰演出を行う。
 *    - 完了後は overlay を DOM から削除する。
 *
 * 4) ハイライト付きフェードアウト（fadeOutToWithHighlight）
 *    - クリック直後の「問題文 + 選択肢」の見た目を clone して、
 *      #cscs-fade-highlight-layer（overlay 内の最前面レイヤー）に固定配置する。
 *    - clone 側は意図しない二重アニメを避けるため、
 *      transition/animation/transform を徹底的に無効化する（injectHighlightKillCss）。
 *    - 選択肢 clone では「選択された1つだけ」を残し、他の li を透明化して視認性を上げる。
 *
 * 5) clickable_scale_effects.js 由来の「スケール揺り戻し」を潰すための処理（重要）
 *    - フェード中、元DOM側（画面下に残る本物の選択肢）でも、
 *      選択された <li>/<a> の transform を一定時間 requestAnimationFrame で上書きし続ける（ハードロック）。
 *    - さらに「他の選択肢」を scale(0.90) に縮小して、選択済みを目立たせる演出も行う。
 *
 * 公開API:
 *   window.CSCS_FADE.fadeOutTo(url, reason)
 *   window.CSCS_FADE.fadeOutToWithHighlight(url, reason, { questionNode, choiceNode })
 *   window.CSCS_FADE.runFadeInIfNeeded()
 *   window.CSCS_FADE.fadeReload(reason)
 */
(function () {
  "use strict";

  // =========================================
  // フェード演出の基本パラメータ
  // ここを変えると「暗くなる速さ・暗さ・カーブ」が一括で調整できる
  // =========================================
  var FADE_DURATION_MS = 1250;     // フェードにかける時間（ミリ秒）
  var FADE_MAX_OPACITY = 0.7;      // 画面をどれくらい暗くするか（0〜1）
  // 追加: 立ち上がり/抜けが上品なカーブ（"ease-in-out" より「ぬるっ」とした高級感が出る）
  var FADE_EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";
  var SESSION_KEY = "cscs_page_fade_pending"; // 遷移元→遷移先に「フェード中だった」ことを伝えるためのsessionStorageキー

  // クローンハイライト用の「アニメ全殺しCSS」を一度だけ注入するためのID
  var HIGHLIGHT_KILL_STYLE_ID = "cscs-highlight-kill-style";

  // フェード用の keyframes（2段階）＋テキストシャドウを一度だけ注入するためのID
  var FADE_STYLE_ID = "cscs-fade-style";

  /**
   * フェード用の keyframes（2段階）と、全体の薄い text-shadow を注入する。
   * - 2段階フェードを keyframes にして段差（カクつき）を出さない
   * - テキストに薄い影を入れて、黒背景上での可読性を上げる
   */
  function injectFadeCss() {
    try {
      if (document.getElementById(FADE_STYLE_ID)) {
        return;
      }
      var styleEl = document.createElement("style");
      styleEl.id = FADE_STYLE_ID;
      styleEl.type = "text/css";

      var cssText = ""
        + "@keyframes cscsFadeOut2Step{"
        + "0%{opacity:0; backdrop-filter:blur(2px);}"
        + "20%{opacity:calc(var(--cscs-fade-mid,0.38) * 0.6); backdrop-filter:blur(3px);}"
        + "55%{opacity:var(--cscs-fade-mid,0.38); backdrop-filter:blur(5px);}"
        + "100%{opacity:var(--cscs-fade-max,0.7); backdrop-filter:blur(8px);}"
        + "}"
        + "@keyframes cscsFadeIn2Step{"
        + "0%{opacity:var(--cscs-fade-max,0.7); backdrop-filter:blur(8px);}"
        + "45%{opacity:var(--cscs-fade-in-mid,0.22); backdrop-filter:blur(5px);}"
        + "80%{opacity:calc(var(--cscs-fade-in-mid,0.22) * 0.4); backdrop-filter:blur(3px);}"
        + "100%{opacity:0; backdrop-filter:blur(2px);}"
        + "}"
        + ".wrap, .wrap *{"
        + "text-shadow:0 1px 2px rgba(0,0,0,0.30);"
        + "}";

      if (styleEl.styleSheet) {
        styleEl.styleSheet.cssText = cssText;
      } else {
        styleEl.appendChild(document.createTextNode(cssText));
      }
      document.head.appendChild(styleEl);
    } catch (_e) {
      // CSS注入に失敗しても致命的ではないので握りつぶす
    }
  }
    
  /**
   * #cscs-fade-highlight-layer 配下のすべての要素について、
   * CSS 側から transition / animation / transform を徹底的に無効化するスタイルを注入する。
   * - クローン側で「意図しないアニメーション」が二重に走ることを防ぐための保険。
   * - transform は後から JS 側で !important を付けて上書きできるよう、
   *   ここでも !important 付きで一括リセットしておく。
   */
  function injectHighlightKillCss() {
    try {
      if (document.getElementById(HIGHLIGHT_KILL_STYLE_ID)) {
        return;
      }
      var styleEl = document.createElement("style");
      styleEl.id = HIGHLIGHT_KILL_STYLE_ID;
      styleEl.type = "text/css";
      var cssText =
        "#cscs-fade-highlight-layer, " +
        "#cscs-fade-highlight-layer *{" +
        "transition:none !important;" +
        "transition-property:none !important;" +
        "transition-duration:0s !important;" +
        "transition-timing-function:linear !important;" +
        "animation:none !important;" +
        "animation-name:none !important;" +
        "animation-duration:0s !important;" +
        "animation-timing-function:linear !important;" +
        "transform-origin:center center !important;" +
        "}";
      if (styleEl.styleSheet) {
        styleEl.styleSheet.cssText = cssText;
      } else {
        styleEl.appendChild(document.createTextNode(cssText));
      }
      document.head.appendChild(styleEl);
    } catch (_e) {
      // CSS注入に失敗しても致命的ではないので握りつぶす
    }
  }

  // =========================================
  // 画面全体を覆うフェード用オーバーレイを取得 or 新規作成
  // （毎回新しく作らず、既存のものを再利用）
  // =========================================
  function getOrCreateFadeOverlay() {
    // 既に作成済みならそれを返す
    var overlay = document.getElementById("cscs-global-fade-overlay");
    if (overlay) {
      return overlay;
    }
    // なければ新規に <div> を作成して、全画面固定配置の黒幕として挿入
    overlay = document.createElement("div");
    overlay.id = "cscs-global-fade-overlay";
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";

    // 追加: ノイズではなく「ガラスっぽい暗幕」にする
    // - 背景は単純な暗幕（軽いビネット）にして、質感は backdrop-filter のぼかしで作る
    overlay.style.background =
      "radial-gradient(ellipse at 40% 30%, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.82) 60%, rgba(0,0,0,0.92) 100%)";

    // 追加: 背面をもう少し強めにぼかして“おしゃれ感”を出す
    overlay.style.backdropFilter = "blur(8px) saturate(125%)";
    overlay.style.webkitBackdropFilter = "blur(8px) saturate(125%)";

    overlay.style.opacity = "0";               // 初期状態は完全透明
    overlay.style.pointerEvents = "none";      // クリックなどは下の要素に通す
    overlay.style.zIndex = "9998";             // ほぼ最前面（他UIより上）

    // 追加: アニメの対象を明示して、暗転をよりスムーズにする
    overlay.style.willChange = "opacity";
    overlay.style.transition =
      "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    document.body.appendChild(overlay);
    return overlay;
  }

  // =========================================
  // 画面を黒くフェードアウトさせてから、指定URLへ遷移する
  // nextUrl: 遷移先URL
  // reason : 遷移理由（ログ用 / 復路の判定用に保存しているが、ここでは特に使用していない）
  // =========================================

  /**
   * 問題文＋選択肢を「画面上の見た目を極力そのまま」に前面へ浮かせる処理。
   * - 元 DOM は一切動かさず、そのクローンをフェード用オーバーレイ内部の専用レイヤー(#cscs-fade-highlight-layer)に配置する。
   * - getBoundingClientRect() で現在の表示位置・幅を取得し、その座標に position: fixed でクローンを貼り付ける。
   * - ハイライトレイヤーは常に「黒幕オーバーレイの内側かつ最前面」に置くことで、スタッキングコンテキスト競合を避ける。
   *
   * @param {Element|null} questionNode  元の問題文DOMノード(<h1>など)
   * @param {Element|null} choiceNode    元の選択肢コンテナDOMノード(<ol class="opts"> など。<li> が来た場合はここでリスト親に昇格させる)
   * @returns {Element|null}             作成されたハイライトレイヤー要素 or null
   */
  function createHighlightLayer(questionNode, choiceNode, selectedWasWrong) {
    try {
      // 既存のハイライトレイヤーがあれば一度削除して、毎回まっさらな状態から作り直す
      var existing = document.getElementById("cscs-fade-highlight-layer");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing); // 古いレイヤーをオーバーレイ内部から取り除く
      }

      // ハイライトレイヤー用の「アニメ全殺しCSS」を必ず注入
      injectHighlightKillCss();

      // 選択された choice (A/B/C/D など) を保存しておくための変数
      // - choiceNode が <li> の場合に、その <a> の href から choice パラメータを抽出してセットする
      var selectedChoiceCode = null;
      // 元の <a> 要素が clickable_scale_effects.js によって「固定スケール状態(sa-hover-fixed)」になっているかどうか
      // を保存しておくフラグ。クローン側にも同じ固定スケールを反映させるために利用する。
      var selectedChoiceFixed = false;

      // choiceNode が <li> の場合は、ここで必ず親の <ol class="opts"> などのリストコンテナに昇格させる
      // - 番号付きリスト全体（インデント・行間・装飾を含む）をそのまま前面に出すための前処理
      // - 親リストコンテナが見つからない場合は、選択肢側のハイライトは行わない（フォールバックなし）
      if (choiceNode && choiceNode.nodeType === 1) {
        var tag = choiceNode.tagName ? choiceNode.tagName.toLowerCase() : "";
        if (tag === "li") {
          // まず、この <li> が持つ <a> の href から choice=◯ のパラメータを抜き出して記録しておく
          var anchorForSelected = choiceNode.querySelector("a");
          if (anchorForSelected && anchorForSelected.href) {
            var m = anchorForSelected.href.match(/choice=([A-Z])/);
            if (m && m[1]) {
              selectedChoiceCode = m[1]; // 例: "A" / "B" / "C" / "D"
            }
            // 元の <a> に sa-hover-fixed が付いていれば、「固定スケール状態」としてフラグを立てる
            if (anchorForSelected.classList && anchorForSelected.classList.contains("sa-hover-fixed")) {
              selectedChoiceFixed = true;
            }
          }

          var listContainer = null;
          if (typeof choiceNode.closest === "function") {
            listContainer = choiceNode.closest("ol.opts") ||
                            choiceNode.closest("ol") ||
                            choiceNode.closest("ul");
          }
          if (listContainer && listContainer.nodeType === 1) {
            choiceNode = listContainer;      // <li> ではなく、親のリストコンテナ全体をハイライト対象に昇格させる
          } else {
            choiceNode = null;               // 親リストが見つからない場合は選択肢のハイライトは諦める
          }
        }
      }

      // ハイライト対象が存在しない場合は何もせず終了
      if (!questionNode && !choiceNode) {
        return null;                         // 問題文・選択肢の両方が無ければ何もせず終了
      }

      // フェード用オーバーレイを必ず取得し、その「内側」にハイライトレイヤーをぶら下げる
      // - こうすることで、オーバーレイのスタッキングコンテキストの中で z-index を完結させられる
      var overlay = getOrCreateFadeOverlay(); // 既存オーバーレイを取得（無ければ新規作成）
      if (!overlay) {
        return null;                         // 何らかの理由でオーバーレイが作れない場合はハイライトも諦める
      }

      // フェードオーバーレイ内部に、ハイライト専用レイヤーを新規作成
      var layer = document.createElement("div");
      layer.id = "cscs-fade-highlight-layer";
      layer.style.position = "fixed";
      layer.style.left = "0";
      layer.style.top = "0";
      layer.style.right = "0";
      layer.style.bottom = "0";
      layer.style.zIndex = "9999";          // オーバーレイ背景より前面に出すための z-index（コンテキストは overlay の内側で完結）
      layer.style.pointerEvents = "none";   // ハイライトレイヤー自体はマウス操作を一切受け付けない
      try {
        if (layer.style && typeof layer.style.setProperty === "function") {
          layer.style.setProperty("transition", "none", "important");
          layer.style.setProperty("animation", "none", "important");
        } else {
          layer.style.transition = "none";
          layer.style.animation = "none";
        }
      } catch (_eLayerStyle) {
      }
      overlay.appendChild(layer);           // body 直下ではなく overlay 配下にぶら下げることで、黒幕と一体化した前面表示にする

      // ハイライト対象を配列にまとめて、共通のクローン処理を適用する
      var targets = [];
      if (questionNode && questionNode.nodeType === 1) {
        targets.push(questionNode);          // 有効な問題文ノードをハイライト対象として登録
      }
      if (choiceNode && choiceNode.nodeType === 1) {
        targets.push(choiceNode);            // 有効な選択肢コンテナノードをハイライト対象として登録
      }

      // 各対象ノードごとに、画面上の位置に合わせたクローンを作り、ハイライトレイヤー上に固定配置する
      for (var i = 0; i < targets.length; i++) {
        var node = targets[i];
        var rect = node.getBoundingClientRect(); // 元DOMの画面上の位置・幅を取得する（ビューポート基準）
        var clone = node.cloneNode(true);        // 元DOMは動かさず、クローンだけをハイライト用に利用する

        // クローン共通の識別用クラス付与や微調整を行う
        if (clone && clone.nodeType === 1) {
          // --- 追加処理: スライドイン演出の状態をクローンから除去する ---
          // cscs_slide_in.js により付与されたアニメーション用クラスやフラグは、
          // ハイライト側では不要かつ二重アニメーションの原因になるため、ここで剥がしておく。
          if (clone.classList && typeof clone.classList.remove === "function") {
            clone.classList.remove("cscs-slide-in-left"); // スライドイン用クラスを削除
          } else {
            var clsText = clone.getAttribute("class") || "";
            if (clsText.indexOf("cscs-slide-in-left") !== -1) {
              clsText = clsText.replace(/\bcscs-slide-in-left\b/g, " ");
              clsText = clsText.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
              clone.setAttribute("class", clsText);
            }
          }
          clone.removeAttribute("data-cscs-slide-applied"); // 「一度だけ適用」フラグもクローンでは無効化する
          // --- 追加処理ここまで ---

          // --- 追加処理②: クローン配下の transition / animation / transform を徹底的に無効化する ---
          try {
            if (clone.style && typeof clone.style.setProperty === "function") {
              clone.style.setProperty("transition", "none", "important");
              clone.style.setProperty("transition-property", "none", "important");
              clone.style.setProperty("transition-duration", "0s", "important");
              clone.style.setProperty("transition-timing-function", "linear", "important");
              clone.style.setProperty("animation", "none", "important");
              clone.style.setProperty("animation-name", "none", "important");
              clone.style.setProperty("animation-duration", "0s", "important");
              clone.style.setProperty("animation-timing-function", "linear", "important");
            } else if (clone.style) {
              clone.style.transition = "none";
              clone.style.transitionProperty = "none";
              clone.style.animation = "none";
              clone.style.animationName = "none";
            }
          } catch (_eStyleRoot) {
          }

          try {
            var allNodes = clone.querySelectorAll("*");
            for (var ai = 0; ai < allNodes.length; ai++) {
              var an = allNodes[ai];
              if (!an || !an.style) {
                continue;
              }
              try {
                if (typeof an.style.setProperty === "function") {
                  an.style.setProperty("transition", "none", "important");
                  an.style.setProperty("transition-property", "none", "important");
                  an.style.setProperty("transition-duration", "0s", "important");
                  an.style.setProperty("transition-timing-function", "linear", "important");
                  an.style.setProperty("animation", "none", "important");
                  an.style.setProperty("animation-name", "none", "important");
                  an.style.setProperty("animation-duration", "0s", "important");
                  an.style.setProperty("animation-timing-function", "linear", "important");
                } else {
                  an.style.transition = "none";
                  an.style.transitionProperty = "none";
                  an.style.animation = "none";
                  an.style.animationName = "none";
                }
              } catch (_eEach) {
              }

              // clickable_scale_effects.js 系のクラスが付いている要素は、
              // クローン側では「現在のスケールを保つだけ」の静止状態に固定する。
              try {
                if (an.classList && (an.classList.contains("sa-hover") || an.classList.contains("sa-hover-fixed"))) {
                  an.classList.remove("sa-hover");
                  if (!an.classList.contains("sa-hover-fixed")) {
                    an.classList.add("sa-hover-fixed");
                  }
                  an.style.transformOrigin = "center center";
                  try {
                    an.style.setProperty("transform", "scale(1.10)", "important");
                  } catch (_eSetScale) {
                    an.style.transform = "scale(1.10)";
                  }
                }
              } catch (_eClassFix) {
              }
            }
          } catch (_eStyleChildren) {
          }
          // --- 追加処理② ここまで ---

          // クローン共通の識別用クラスを付与して、CSSから「クローンだけ」を安全に調整できるようにする
          if (clone.classList) {
            clone.classList.add("cscs-fade-highlight-clone");
          } else {
            var cls = clone.getAttribute("class") || "";
            if (cls.indexOf("cscs-fade-highlight-clone") === -1) {
              clone.setAttribute("class", (cls ? cls + " " : "") + "cscs-fade-highlight-clone");
            }
          }

          // ▼ 追加：クローン自体にも極薄の背景を持たせて段差を消す
          try {
            clone.style.backgroundColor = "rgba(0,0,0,0.10)";
            clone.style.borderRadius = "4px";
          } catch (_eCloneBg) {
          }

          // 選択肢コンテナ(<ol class="opts">)のクローンだけ、元レイアウトとの差を埋めるための微調整を行う
          // ※ここでは「選択した<li>だけ可視化し、それ以外の<li>は透明にする」処理も追加する
          var cloneTag = clone.tagName ? clone.tagName.toLowerCase() : "";
          if (cloneTag === "ol" && clone.classList && clone.classList.contains("opts")) {
            clone.style.marginLeft = "18px";
            clone.style.marginBottom = "15px";
            clone.style.lineHeight = "1"; // クローン専用行間。フェード破損を起こさない安全定義。

            // --- 追加処理① ---
            // 選択されていない <li> を透明化し、選択された <li> のみ残す。
            // selectedChoiceCode（"A" / "B" / "C"）に基づいて href の choice=◯ を判定する。
            var selected = selectedChoiceCode;
            if (selected) {
              var lis = clone.querySelectorAll("li");
              for (var ii = 0; ii < lis.length; ii++) {
                var li = lis[ii];
                var link = li.querySelector("a");
                if (!link || !link.href) {
                  continue;
                }

                // href 内の choice=◯ と、選択されたコードが一致するかどうかで可視・不可視を切り替える
                if (link.href.indexOf("choice=" + selected) === -1) {
                  // 選択されなかった選択肢 → 完全に透明化
                  li.style.opacity = "0";
                } else {
                  // 選択された選択肢 → 表示（クローン側ではテキスト部分のみ 1.10 倍の「静止状態」で表示する）
                  li.style.opacity = "1";

                  // クローン内の <a>（選択肢テキスト）だけを、最初から 1.10 倍で固定表示する。
                  // クラスは一切変更せず、スタイルだけで拡大させる。
                  if (link && link.style) {
                    link.style.display = "inline-block";
                    link.style.transformOrigin = "center center";
                    try {
                      link.style.setProperty("transform", "scale(1.10)", "important");
                      link.style.setProperty("transition", "none", "important");
                      link.style.setProperty("transition-property", "none", "important");
                      link.style.setProperty("animation", "none", "important");
                      link.style.setProperty("animation-name", "none", "important");
                    } catch (_eLink) {
                      link.style.transform = "scale(1.10)";
                      link.style.transition = "none";
                    }
                  }
                }
              }
            }
            // --- 追加処理① ここまで ---
          }
        }

        // クローンを配置するためのラッパーを作成し、元の位置に固定する
        var wrapper = document.createElement("div");
        wrapper.style.position = "fixed";
        wrapper.style.left = String(rect.left) + "px";
        // 元の表示位置から 15px だけ上方向にオフセットして、わずかに浮かび上がって見えるようにする
        wrapper.style.top = String(rect.top - 15) + "px";
        wrapper.style.width = String(rect.width) + "px";
        wrapper.style.margin = "0";
        wrapper.style.padding = "6px 8px";   // ← 文字の周囲に最小限の空気を作る
        wrapper.style.pointerEvents = "none";

        // ▼ 追加：クローン用の「透過ガラス背景」
        wrapper.style.background =
          "linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.28))";
        wrapper.style.backdropFilter = "blur(4px)";
        wrapper.style.webkitBackdropFilter = "blur(4px)";
        wrapper.style.borderRadius = "6px";

        // 影は「浮かせる」ではなく「馴染ませる」ため極薄
        wrapper.style.boxShadow =
          "0 0 0 1px rgba(255,255,255,0.02), 0 6px 16px rgba(0,0,0,0.25)";

        try {
          if (wrapper.style && typeof wrapper.style.setProperty === "function") {
            wrapper.style.setProperty("transition", "none", "important");
            wrapper.style.setProperty("animation", "none", "important");
          } else {
            wrapper.style.transition = "none";
            wrapper.style.animation = "none";
          }
        } catch (_eWrapper) {
        }

        wrapper.appendChild(clone);              // クローンを wrapper に入れて
        layer.appendChild(wrapper);              // wrapper ごとハイライトレイヤーに追加する
      }

      return layer;                              // 作成したハイライトレイヤー要素を返す（デバッグ・検証用）
    } catch (_e) {
      return null;                               // 例外発生時もフェード自体は続行できるように null を返しておく
    }
  }

  function fadeOutTo(nextUrl, reason) {

    // 追加: フェード用CSS（keyframes + text-shadow）を必ず注入
    injectFadeCss();

    // ▼ 追加：Aパート（body.mode-a）の場合だけフェード弱くする
    try {
      var body = document.body;
      if (body && body.classList && body.classList.contains("mode-a")) {
        // A→B の遷移だけ弱フェード（両方“少し長く”した上でAをやや短めにする）
        FADE_DURATION_MS = 700;
        FADE_MAX_OPACITY = 0.7;
      } else {
        // Bパートなど、通常フェード（今より少し長め）
        FADE_DURATION_MS = 950;
        FADE_MAX_OPACITY = 0.7;
      }
    } catch (_e) {
      // エラーが起きても既存フェード仕様で続行
    }
    // ▲ 追加ここまで

    if (!nextUrl) {
      // 遷移先 URL が無い場合はフェード処理自体を行わない
      return;
    }

    // フェード用オーバーレイを準備（既存があれば再利用、無ければ作成）
    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "0";              // 最初は完全に透明な状態からスタートする
    overlay.style.pointerEvents = "auto";     // フェード中は画面操作を一括でブロックする

    // 追加: keyframes 2段階で自然に暗転させる（transition切替をやめて段差を消す）
    // - mid は MAX の 55% に固定し、自然な「決まり→沈み込み」を作る
    try {
      overlay.style.setProperty("--cscs-fade-max", String(FADE_MAX_OPACITY));
      overlay.style.setProperty("--cscs-fade-mid", String(FADE_MAX_OPACITY * 0.55));
    } catch (_eVar) {
    }
    overlay.style.animation =
      "cscsFadeOut2Step "
      + String(FADE_DURATION_MS)
      + "ms cubic-bezier(0.18, 0.55, 0.25, 1) forwards";

    // フェード完了のタイミングで sessionStorage に「フェード中だった」情報を残し、その後に実際の遷移を行う
    window.setTimeout(function () {
      try {
        var payload = {
          reason: reason || "",
          timestamp: Date.now()
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      } catch (_e) {
        // sessionStorage が利用できない環境でもフェードと遷移は継続させる
      }
      // 実際のページ遷移をここで実行する
      location.href = nextUrl;
    }, FADE_DURATION_MS + 60);
  }

  /**
   * ハイライト対象（問題文＋選択肢）を指定してフェードアウト遷移するための拡張API。
   * 実際のフェード処理は既存の fadeOutTo に一元化し、ここではハイライトレイヤーの生成だけを担当する。
   *
   * @param {string} nextUrl                         遷移先URL
   * @param {string} reason                          ログや復路判定用の任意の文字列
   * @param {Object} highlightTargets                ハイライト対象の DOM ノードセット
   *   highlightTargets.questionNode … 問題文DOMノード (例: <h1>…)
   *   highlightTargets.choiceNode   … 選択肢DOMノード (例: <li>…)
   */
  function fadeOutToWithHighlight(nextUrl, reason, highlightTargets) {
    if (!nextUrl) {
      // 遷移先 URL が無い場合はハイライトもフェードも行わない
      return;
    }

    var questionNode = null;
    var choiceNode = null;
    // フェードの「下」に残っている元の選択肢 <li> を同時にフェードアウトさせるための参照
    var originalChoiceLi = null;

    // 呼び出し側から渡されたオブジェクトから、安全に DOM ノードだけを取り出す
    try {
      if (highlightTargets && typeof highlightTargets === "object") {
        if (highlightTargets.questionNode && highlightTargets.questionNode.nodeType === 1) {
          questionNode = highlightTargets.questionNode;
        }
        if (highlightTargets.choiceNode && highlightTargets.choiceNode.nodeType === 1) {
          choiceNode = highlightTargets.choiceNode;

          // 元の「選択された <li>」を特定する
          try {
            var tag = choiceNode.tagName ? choiceNode.tagName.toLowerCase() : "";
            if (tag === "li") {
              // 通常ケース：choiceNode がそのまま選択された <li> の場合
              originalChoiceLi = choiceNode;
            } else if ((tag === "a" || tag === "span" || tag === "div") && typeof choiceNode.closest === "function") {
              // 将来の拡張に備え、もし <a> やそのラッパが渡されても、直近の <li> を拾う
              var li = choiceNode.closest("li");
              if (li && li.nodeType === 1) {
                originalChoiceLi = li;
              }
            }
          } catch (_eChoiceLi) {
            originalChoiceLi = null;
          }
        }
      }
    } catch (_e) {
      // 途中で例外が出てもフェード処理自体は継続させるため、ここでは握りつぶして初期値(null)のままにする
      questionNode = null;
      choiceNode = null;
      originalChoiceLi = null;
    }

    // 問題文または選択肢のどちらかが取得できていれば、
    // クリック処理が走った直後（ほぼ同時）のタイミングで
    // フェード用オーバーレイの上にハイライトレイヤーを作成する。
    // clickable_scale_effects.js 側のクリック時アニメーションを削った前提で、
    // 「クリック直後の見た目」をそのままクローンする挙動にする。
    if (questionNode || choiceNode) {
      createHighlightLayer(questionNode, choiceNode, false);
    }

    // ▼ ここから追加処理：クローン元（画面下に残っている本物の選択肢）側でも
    //    フェード中に scale(1.0) へ揺り戻されないように、transform をハードロックする。
    (function lockOriginalChoiceScale() {
      if (!originalChoiceLi) {
        return;
      }

      // 元の <li> の中の <a> を対象とする（実際にスケールしているのはテキスト側の <a> 想定）
      var originalAnchor = null;
      try {
        originalAnchor = originalChoiceLi.querySelector("a");
      } catch (_eFindAnchor) {
        originalAnchor = null;
      }
      if (!originalAnchor || !originalAnchor.style) {
        return;
      }

      // ▼ クリック直後の「現在の transform」を一度だけ読み取り、
      //    それを fixedTransform としてロック対象値にする（以後は computedStyle を読まない）
      var fixedTransform = "scale(1.10)";
      try {
        var cs = window.getComputedStyle(originalAnchor);
        if (cs && cs.transform && cs.transform !== "none") {
          fixedTransform = cs.transform;
        }
      } catch (_eGetCs) {
        fixedTransform = "scale(1.10)";
      }

      // ▼ 追加：<li> 側も transform を固定する（テキスト側だけでなく親側の揺り戻しも潰す）
      var fixedLiTransform = "none";
      try {
        var csLi = window.getComputedStyle(originalChoiceLi);
        if (csLi && csLi.transform && csLi.transform !== "none") {
          fixedLiTransform = csLi.transform;
        }
      } catch (_eGetCsLi) {
        fixedLiTransform = "none";
      }

      // ▼ 追加：hover/active 由来の揺り戻しを物理的に封じるため、
      //    ロック中は一時的に pointer-events を切る（フェード中に追加入力させない意図も兼ねる）
      try {
        originalAnchor.style.setProperty("pointer-events", "none", "important");
        originalChoiceLi.style.setProperty("pointer-events", "none", "important");
      } catch (_ePe) {
      }

      // ▼ ロック継続時間（ミリ秒）
      //    フェード時間より十分長く取り、遷移完了まで上書き合戦に確実に勝つ。
      //    - 目安：FADE_DURATION_MS + 3000ms（最低 3500ms）
      var LOCK_DURATION_MS = Math.max(3500, FADE_DURATION_MS + 3000);
      var startTime = performance.now();

      // 毎フレーム fixedTransform と transition/animation の kill を上書きし続けるループ
      function loop(now) {
        // DOM から外れていたらそこで終了
        if (!document.body || !document.body.contains(originalAnchor)) {
          return;
        }

        var elapsed = now - startTime;
        if (elapsed > LOCK_DURATION_MS) {
          // ロック解除：pointer-events だけ戻す（他の style は遷移でページが変わるので戻さない）
          try {
            originalAnchor.style.removeProperty("pointer-events");
            originalChoiceLi.style.removeProperty("pointer-events");
          } catch (_eUnpe) {
          }
          return;
        }

        try {
          // ▼ 選択肢テキスト(<a>)を強制固定（縮小・揺り戻しを潰す）
          originalAnchor.style.transformOrigin = "center center";
          originalAnchor.style.setProperty("transform", fixedTransform, "important");

          // ▼ 親 <li> 側も、もし transform が入っている環境ならそれを固定する
          if (fixedLiTransform && fixedLiTransform !== "none") {
            originalChoiceLi.style.transformOrigin = "center center";
            originalChoiceLi.style.setProperty("transform", fixedLiTransform, "important");
          }

          // ▼ transition/animation を毎フレーム完全に無効化して、CSS/JS の介入を潰す
          originalAnchor.style.setProperty("transition", "none", "important");
          originalAnchor.style.setProperty("transition-property", "none", "important");
          originalAnchor.style.setProperty("transition-duration", "0s", "important");
          originalAnchor.style.setProperty("transition-timing-function", "linear", "important");
          originalAnchor.style.setProperty("animation", "none", "important");
          originalAnchor.style.setProperty("animation-name", "none", "important");
          originalAnchor.style.setProperty("animation-duration", "0s", "important");
          originalAnchor.style.setProperty("animation-timing-function", "linear", "important");

          originalChoiceLi.style.setProperty("transition", "none", "important");
          originalChoiceLi.style.setProperty("transition-property", "none", "important");
          originalChoiceLi.style.setProperty("transition-duration", "0s", "important");
          originalChoiceLi.style.setProperty("transition-timing-function", "linear", "important");
          originalChoiceLi.style.setProperty("animation", "none", "important");
          originalChoiceLi.style.setProperty("animation-name", "none", "important");
          originalChoiceLi.style.setProperty("animation-duration", "0s", "important");
          originalChoiceLi.style.setProperty("animation-timing-function", "linear", "important");
        } catch (_eLock) {
          // ここで失敗しても致命的ではないので何もしない（フォールバック無し）
        }

        requestAnimationFrame(loop);
      }

      // フェード開始とほぼ同時にロックループをスタートさせる
      requestAnimationFrame(loop);
    })();

    // ▼ ここから追加処理：フェードアウト中に「他の選択肢」を少しだけ縮小させる。
    //    - 選択された <li> と同じリスト内の兄弟 <li> を対象にする
    //    - テキスト部分（<a>）があればそこを縮小対象にし、なければ <li> 全体を縮小させる
    (function shrinkOtherChoicesDuringFade() {
      if (!originalChoiceLi) {
        return;
      }

      var listNode = originalChoiceLi.parentNode;
      if (!listNode || listNode.nodeType !== 1) {
        return;
      }

      var lis = null;
      try {
        lis = listNode.querySelectorAll("li");
      } catch (_eLis) {
        lis = null;
      }
      if (!lis || !lis.length) {
        return;
      }

      // フェード時間に近い値で、ゆっくり目に縮小させる
      var SHRINK_DURATION_MS = 480;

      for (var si = 0; si < lis.length; si++) {
        var li = lis[si];
        if (!li || li === originalChoiceLi) {
          continue;
        }

        // 縮小対象要素を決める：基本は <a>、無ければ <li> 自体
        var target = null;
        try {
          target = li.querySelector("a");
        } catch (_eFindA) {
          target = null;
        }
        if (!target) {
          target = li;
        }
        if (!target || !target.style) {
          continue;
        }

        try {
          // 左端を基準に横方向だけ少しすぼむように縮小する
          target.style.transformOrigin = "left center";
          target.style.transitionProperty = "transform";
          target.style.transitionDuration = String(SHRINK_DURATION_MS) + "ms";
          target.style.transitionTimingFunction = "ease-out";
          target.style.transform = "scale(0.95)";
        } catch (_eShrink) {
          // transition 設定に失敗した場合は何もしない
        }
      }
    })();

    // フェードアウトと sessionStorage の処理は既存の fadeOutTo に委譲して、一貫した挙動を保つ
    fadeOutTo(nextUrl, reason);
  }

  // =========================================
  // 遷移“後”のページ側で呼び出される処理
  // 前ページで fadeOutTo が使われていれば、
  // 黒い状態から徐々にフェードインする
  // =========================================
  function runFadeInIfNeeded() {
    var needFade = false;
    try {
      // 遷移前に残されたフラグを取得
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        needFade = true;                     // フェードインが必要
        sessionStorage.removeItem(SESSION_KEY); // 一度使ったら削除（使い捨て）
      }
    } catch (_e) {
      needFade = false;
    }

    if (!needFade) {
      // フェードが不要なら何もしない
      return;
    }

    // 追加: フェード用CSS（keyframes + text-shadow）を必ず注入
    injectFadeCss();

    // フェード用オーバーレイを取得（無ければ作成）
    var overlay = getOrCreateFadeOverlay();

    // 遷移直後は「真っ暗な状態」からスタート
    overlay.style.opacity = String(FADE_MAX_OPACITY);
    overlay.style.pointerEvents = "none"; // 画面操作は通す

    // 追加: keyframes 2段階で自然に復帰させる（暗転と同じ質で戻す）
    try {
      overlay.style.setProperty("--cscs-fade-max", String(FADE_MAX_OPACITY));
      overlay.style.setProperty("--cscs-fade-in-mid", String(FADE_MAX_OPACITY * 0.30));
    } catch (_eVar) {
    }
    overlay.style.animation =
      "cscsFadeIn2Step "
      + String(FADE_DURATION_MS)
      + "ms cubic-bezier(0.22, 0.6, 0.3, 1) forwards";

    // フェードイン完了後、DOMからオーバーレイを削除して後始末
    window.setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, FADE_DURATION_MS + 80);
  }

  // =========================================
  // 現在のページをリロードするためのヘルパー
  // - URLはそのまま
  // - fadeOutTo を経由することで「フェード→リロード→フェードイン」がかかる
  // =========================================
  function fadeReload(reason) {
    fadeOutTo(location.href, reason || "reload");
  }

  // =========================================
  // 外部から使えるAPIをグローバルに公開
  // - CSCS_FADE.fadeOutTo(url, reason)
  //     通常のフェードアウト → ページ遷移を行う基本API
  // - CSCS_FADE.fadeOutToWithHighlight(url, reason, { questionNode, choiceNode })
  //     問題文＋選択肢を画面中央にハイライト表示したままフェードアウト → 遷移する拡張API
  // - CSCS_FADE.runFadeInIfNeeded()
  //     前ページからのフェード情報を見て、必要な場合だけフェードイン演出を行う
  // - CSCS_FADE.fadeReload(reason)
  //     現在ページをフェード付きでリロードするヘルパー
  // =========================================
  window.CSCS_FADE = {
    fadeOutTo: fadeOutTo,
    fadeOutToWithHighlight: fadeOutToWithHighlight,
    runFadeInIfNeeded: runFadeInIfNeeded,
    fadeReload: fadeReload
  };

  // =========================================
  // ページ読み込み時に「フェードインが必要かどうか」をチェックして実行
  // - すでに DOM が準備できていれば即実行
  // - まだなら DOMContentLoaded 後に実行
  // =========================================
  if (document.readyState === "complete" || document.readyState === "interactive") {
    // DOMがすでに準備完了している場合
    runFadeInIfNeeded();
  } else {
    // DOM構築完了後にフェードイン判定
    document.addEventListener("DOMContentLoaded", runFadeInIfNeeded);
  }
})();