// assets/cscs_fade_overlay.js
(function () {
  "use strict";

  // =========================================
  // フェード演出の基本パラメータ
  // ここを変えると「暗くなる速さ・暗さ・カーブ」が一括で調整できる
  // =========================================
  var FADE_DURATION_MS = 800;      // フェードにかける時間（ミリ秒）
  var FADE_MAX_OPACITY = 0.7;      // 画面をどれくらい暗くするか（0〜1）
  var FADE_EASING = "ease-in-out"; // CSSトランジション用のイージング関数
  var SESSION_KEY = "cscs_page_fade_pending"; // 遷移元→遷移先に「フェード中だった」ことを伝えるためのsessionStorageキー

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
    overlay.style.backgroundColor = "#000000";  // 真っ黒
    overlay.style.opacity = "0";               // 初期状態は完全透明
    overlay.style.pointerEvents = "none";      // クリックなどは下の要素に通す
    overlay.style.zIndex = "9998";             // ほぼ最前面（他UIより上）
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
  function createHighlightLayer(questionNode, choiceNode) {
    try {
      // 既存のハイライトレイヤーがあれば一度削除して、毎回まっさらな状態から作り直す
      var existing = document.getElementById("cscs-fade-highlight-layer");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing); // 古いレイヤーをオーバーレイ内部から取り除く
      }

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

          // クローン共通の識別用クラスを付与して、CSSから「クローンだけ」を安全に調整できるようにする
          if (clone.classList) {
            clone.classList.add("cscs-fade-highlight-clone"); // classList が使える場合は add で足す
          } else {
            var cls = clone.getAttribute("class") || "";
            if (cls.indexOf("cscs-fade-highlight-clone") === -1) {
              clone.setAttribute("class", (cls ? cls + " " : "") + "cscs-fade-highlight-clone"); // 属性操作でクラスを追加
            }
          }

          // 選択肢コンテナ(<ol class="opts">)のクローンだけ、元レイアウトとの差を埋めるための微調整を行う
          // ※ここでは「選択した<li>だけ可視化し、それ以外の<li>は透明にする」処理も追加する
          var cloneTag = clone.tagName ? cloneTag = clone.tagName.toLowerCase() : "";
          if (cloneTag === "ol" && clone.classList && clone.classList.contains("opts")) {
            clone.style.marginLeft = "18px";
            clone.style.marginBottom = "15px";
            clone.style.lineHeight = "1"; // クローン専用行間。フェード破損を起こさない安全定義。

            // --- 追加処理① ---
            // 選択されていない <li> を透明化し、選択された <li> のみ残す。
            // selectedChoiceCode（"A" / "B" / "C" / "D"）に基づいて href の choice=◯ を判定する。
            var selected = selectedChoiceCode;
            if (selected) {
              var lis = clone.querySelectorAll("li");
              for (var ii = 0; ii < lis.length; ii++) {
                var li = lis[ii];
                var link = li.querySelector("a");
                if (!link || !link.href) {
                  // クローン内で href を持たないものは選択対象外として透明にしておく
                  li.style.opacity = "0";
                  continue;
                }

                // ここでは、まだ href を残したまま「どの選択肢が選ばれたか」を判定する。
                // - link.href に含まれる "choice=◯" と selectedChoiceCode を比較する。
                var hrefStr = String(link.href);
                var isSelected = hrefStr.indexOf("choice=" + selected) !== -1;

                if (!isSelected) {
                  // 選択されなかった選択肢 → 完全に透明化
                  li.style.opacity = "0";
                  continue;
                }

                // 選択された選択肢 → 表示（クローン側ではテキスト部分のみ 1.10 倍の「静止状態」で表示する）
                li.style.opacity = "1";

                // 以降は「クローンを clickable 対象から完全に外す」処理。
                // - clickable_scale_effects.js の検出条件から除外するために clickable 系の属性・クラスを削除する。
                if (link.classList) {
                  // hover 拡大用クラスを外すことで、クローンに対しては CSS 側のスケールを効かせない。
                  link.classList.remove("sa-hover");
                  link.classList.remove("sa-hover-fixed");
                }
                link.removeAttribute("data-sa-bound");
                link.removeAttribute("data-sa-clickable");
                link.removeAttribute("role");
                // "a[href]" セレクタから外すために、判定が終わったあとで href を削除する。
                link.removeAttribute("href");

                // クローン内の <a>（選択肢テキスト）だけを、最初から 1.10 倍で固定表示する。
                // イベントやトランジションは一切付けず、完全に静止した 1.10 倍テキストとして扱う。
                if (link && link.style) {
                  link.style.display = "inline-block";
                  link.style.transformOrigin = "center center";
                  link.style.transform = "scale(1.00)";
                  link.style.transition = "none";
                  link.style.transitionProperty = "none";
                  // pointerEvents を none にしておくことで、クローンのテキスト自体は
                  // マウスオーバー／クリックのヒットターゲットにならず、元 DOM 側にだけイベントが届く。
                  link.style.pointerEvents = "none";
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
        // 元の表示位置から 10px だけ上方向にオフセットして、わずかに浮かび上がって見えるようにする
        wrapper.style.top = String(rect.top - 15) + "px";
        wrapper.style.width = String(rect.width) + "px";
        wrapper.style.margin = "0";
        wrapper.style.padding = "0";
        wrapper.style.pointerEvents = "none";    // ハイライトレイヤー上ではマウスイベントを拾わない（クリックは元DOM側で処理済みの前提）

        wrapper.appendChild(clone);              // クローンを wrapper に入れて
        layer.appendChild(wrapper);              // wrapper ごとハイライトレイヤーに追加する
      }

      return layer;                              // 作成したハイライトレイヤー要素を返す（デバッグ・検証用）
    } catch (_e) {
      return null;                               // 例外発生時もフェード自体は続行できるように null を返しておく
    }
  }

  function fadeOutTo(nextUrl, reason) {
    if (!nextUrl) {
      // 遷移先 URL が無い場合はフェード処理自体を行わない
      return;
    }

    // フェード用オーバーレイを準備（既存があれば再利用、無ければ作成）
    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "0";              // 最初は完全に透明な状態からスタートする
    overlay.style.pointerEvents = "auto";     // フェード中は画面操作を一括でブロックする
    overlay.style.transition =
      "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    // 少しだけ遅らせて opacity を上げ、CSS トランジションによるふわっとした暗転を発生させる
    window.setTimeout(function () {
      overlay.style.opacity = String(FADE_MAX_OPACITY);  // 設定された暗さまで徐々に暗転させる
    }, 20);

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
    }, FADE_DURATION_MS + 40); // フェード時間より少しだけ長く待ち、完全に暗くなってから遷移する
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

    // 呼び出し側から渡されたオブジェクトから、安全に DOM ノードだけを取り出す
    try {
      if (highlightTargets && typeof highlightTargets === "object") {
        if (highlightTargets.questionNode && highlightTargets.questionNode.nodeType === 1) {
          questionNode = highlightTargets.questionNode;
        }
        if (highlightTargets.choiceNode && highlightTargets.choiceNode.nodeType === 1) {
          choiceNode = highlightTargets.choiceNode;
        }
      }
    } catch (_e) {
      // 途中で例外が出てもフェード処理自体は継続させるため、ここでは握りつぶして初期値(null)のままにする
      questionNode = null;
      choiceNode = null;
    }

    // 問題文または選択肢のどちらかが取得できていれば、フェード用オーバーレイの上にハイライトレイヤーを作成する
    if (questionNode || choiceNode) {
      createHighlightLayer(questionNode, choiceNode);
    }

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

    // フェード用オーバーレイを取得（無ければ作成）
    var overlay = getOrCreateFadeOverlay();
    // 遷移直後は「真っ暗な状態」からスタート
    overlay.style.opacity = String(FADE_MAX_OPACITY);
    overlay.style.pointerEvents = "none"; // 画面操作は通す
    overlay.style.transition =
      "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    // 少しだけ遅らせてから opacity を 0 に戻す → 黒から画面がふわっと現れる
    window.setTimeout(function () {
      overlay.style.opacity = "0";
    }, 20);

    // フェードイン完了後、DOMからオーバーレイを削除して後始末
    window.setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, FADE_DURATION_MS + 60);
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