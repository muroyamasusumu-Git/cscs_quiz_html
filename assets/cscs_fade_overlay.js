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
   * - 元 DOM は一切動かさず、そのクローンを body 直下の専用レイヤー(#cscs-fade-highlight-layer)に配置する。
   * - getBoundingClientRect() で現在の表示位置・幅を取得し、その座標に position: fixed でクローンを貼り付ける。
   * - 質問文ブロックと各選択肢(li)で、X/Y のオフセットと行間(line-height)を個別に調整できる。
   *
   * @param {Element|null} questionNode  元の問題文DOMノード(<h1>など)
   * @param {Element|null} choiceNode    元の選択肢コンテナ/項目DOMノード(<ol class="opts"> または <li> など)
   * @returns {Element|null}             作成されたハイライトレイヤー要素 or null
   */
  function createHighlightLayer(questionNode, choiceNode) {
    try {
      // =========================================
      // 位置・行間の調整用パラメータ
      // ここだけ変えれば見た目の微調整ができる
      // =========================================

      // 質問文ブロック(h1)用のオフセット（px）
      var QUESTION_OFFSET_X_PX = 0;    // 左右
      var QUESTION_OFFSET_Y_PX = -15;  // 上下

      // 選択肢4つを li ごとに個別調整するための配列
      // インデックス: 0=A, 1=B, 2=C, 3=D

      // X方向オフセット（px）: 左右位置の微調整用
      var CHOICE_OFFSET_X_PX_LIST = [0, 0, 0, 0];

      // Y方向オフセット（px）: 上下位置の微調整用
      var CHOICE_OFFSET_Y_PX_LIST = [-15, -15, -15, -15];

      // 行間補正（line-height 倍率）
      // 1.0 が元のまま、それ以外の値を入れるとクローン側の行間だけ変更される
      var CHOICE_LINE_HEIGHT_LIST = [1.0, 1.0, 1.0, 1.0];

      // 旧レイヤーが残っていたら削除してクリーンな状態にする
      var existing = document.getElementById("cscs-fade-highlight-layer");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

      // choiceNode が li/ol/ul のどれで来ても、ここで親のリストコンテナを特定する
      var listContainer = null;
      if (choiceNode && choiceNode.nodeType === 1) {
        var tag = choiceNode.tagName ? choiceNode.tagName.toLowerCase() : "";
        if (tag === "li") {
          // li のときは親の ol.opts / ol / ul を探す
          if (typeof choiceNode.closest === "function") {
            listContainer = choiceNode.closest("ol.opts") ||
                            choiceNode.closest("ol") ||
                            choiceNode.closest("ul");
          }
        } else if (tag === "ol" || tag === "ul") {
          // すでにリストコンテナそのものが渡ってきている場合
          listContainer = choiceNode;
        }
      }

      // h1 もリストコンテナも無ければ何もしない
      if (!questionNode && !listContainer) {
        return null;
      }

      // フェード用のハイライトレイヤーを作成（黒幕より前面）
      var layer = document.createElement("div");
      layer.id = "cscs-fade-highlight-layer";
      layer.style.position = "fixed";
      layer.style.left = "0";
      layer.style.top = "0";
      layer.style.right = "0";
      layer.style.bottom = "0";
      layer.style.zIndex = "9999";
      layer.style.pointerEvents = "none";
      document.body.appendChild(layer);

      // ============================
      // 1) 質問文(h1)のクローンを配置
      // ============================
      if (questionNode && questionNode.nodeType === 1) {
        var qrect = questionNode.getBoundingClientRect();
        var qclone = questionNode.cloneNode(true);

        var qw = document.createElement("div");
        qw.style.position = "fixed";
        qw.style.left = String(qrect.left + QUESTION_OFFSET_X_PX) + "px";
        qw.style.top = String(qrect.top + QUESTION_OFFSET_Y_PX) + "px";
        qw.style.width = String(qrect.width) + "px";
        qw.style.margin = "0";
        qw.style.padding = "0";
        qw.style.pointerEvents = "none";

        qw.appendChild(qclone);
        layer.appendChild(qw);
      }

      // ============================
      // 2) 選択肢 li を1つずつクローンして配置
      // ============================
      if (listContainer) {
        var items = listContainer.querySelectorAll("li");
        for (var i = 0; i < items.length; i++) {
          var li = items[i];
          var rect = li.getBoundingClientRect();
          var clone = li.cloneNode(true);

          // 個別の X/Y オフセットと行間補正を取得（設定が無ければ 0 / 1.0 を使う）
          var offsetX = (typeof CHOICE_OFFSET_X_PX_LIST[i] === "number")
            ? CHOICE_OFFSET_X_PX_LIST[i]
            : 0;
          var offsetY = (typeof CHOICE_OFFSET_Y_PX_LIST[i] === "number")
            ? CHOICE_OFFSET_Y_PX_LIST[i]
            : 0;
          var lineHeightFactor = (typeof CHOICE_LINE_HEIGHT_LIST[i] === "number")
            ? CHOICE_LINE_HEIGHT_LIST[i]
            : 1.0;

          // クローン側に行間補正を適用（1.0 のときは何もしない）
          if (lineHeightFactor && lineHeightFactor !== 1.0) {
            clone.style.lineHeight = String(lineHeightFactor);
          }

          // クローンを固定配置するためのラッパーを作成
          var wrap = document.createElement("div");
          wrap.style.position = "fixed";
          wrap.style.left = String(rect.left + offsetX) + "px";
          wrap.style.top = String(rect.top + offsetY) + "px";
          wrap.style.width = String(rect.width) + "px";
          wrap.style.margin = "0";
          wrap.style.padding = "0";
          wrap.style.pointerEvents = "none";

          wrap.appendChild(clone);
          layer.appendChild(wrap);
        }
      }

      return layer;
    } catch (_e) {
      return null;
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
   *   highlightTargets.choiceNode   … 選択肢DOMノード (例: <li>… または <ol class="opts"> …)
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