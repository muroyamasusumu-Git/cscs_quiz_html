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
   * 問題文＋選択肢をクローンして、フェード用オーバーレイの「上」に固定表示するレイヤーを作成する。
   *
   * @param {Element|null} questionNode  元の問題文DOMノード
   * @param {Element|null} choiceNode    元の選択肢DOMノード（クリックされた<li>など）
   * @returns {Element|null}             作成されたハイライトレイヤー要素 or null
   */
  function createHighlightLayer(questionNode, choiceNode) {
    try {
      // 既存のレイヤーがあれば一旦削除
      var existing = document.getElementById("cscs-fade-highlight-layer");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

      // ハイライト対象が一切なければ何もしない
      if (!questionNode && !choiceNode) {
        return null;
      }

      // フルスクリーンのハイライトレイヤー（オーバーレイより1段高い z-index）
      var layer = document.createElement("div");
      layer.id = "cscs-fade-highlight-layer";
      layer.style.position = "fixed";
      layer.style.left = "0";
      layer.style.top = "0";
      layer.style.right = "0";
      layer.style.bottom = "0";
      layer.style.zIndex = "9999";          // フェードオーバーレイ(9998)よりも上
      layer.style.pointerEvents = "none";   // ハイライト中も操作はブロック済みなのでイベントは通さない
      layer.style.display = "flex";
      layer.style.alignItems = "center";
      layer.style.justifyContent = "center";

      // 中央に表示するコンテナ
      var inner = document.createElement("div");
      inner.id = "cscs-fade-highlight-inner";
      inner.style.maxWidth = "80%";
      inner.style.fontSize = "1em";

      // 問題文のクローン
      if (questionNode && questionNode.nodeType === 1) {
        var qClone = questionNode.cloneNode(true);
        inner.appendChild(qClone);
      }

      // 選択肢のクローン
      if (choiceNode && choiceNode.nodeType === 1) {
        var cClone = choiceNode.cloneNode(true);
        cClone.style.marginTop = "16px";
        inner.appendChild(cClone);
      }

      layer.appendChild(inner);
      document.body.appendChild(layer);
      return layer;
    } catch (_e) {
      return null;
    }
  }

  function fadeOutTo(nextUrl, reason) {
    if (!nextUrl) {
      return; // URLが無ければ何もしない
    }

    // フェード用オーバーレイを準備（無ければ作る）
    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "0";              // まず透明からスタート
    overlay.style.pointerEvents = "auto";     // フェード中は操作できないようにブロック
    overlay.style.transition =
      "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    // 少しだけ遅らせてから opacity を変更 → CSSトランジションが発火して、ふわっと暗くなる
    window.setTimeout(function () {
      overlay.style.opacity = String(FADE_MAX_OPACITY);  // 指定の暗さまでフェード
    }, 20);

    // フェードが終わるタイミングで、sessionStorage にフラグを置いてからページ遷移
    window.setTimeout(function () {
      try {
        // 遷移理由やタイムスタンプをペイロードとして保存
        var payload = {
          reason: reason || "",
          timestamp: Date.now()
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      } catch (_e) {
        // sessionStorage が使えない環境では何もしない
      }
      // 実際のページ遷移
      location.href = nextUrl;
    }, FADE_DURATION_MS + 40); // フェード完了後＋ちょっと余裕を持たせる
  }

  /**
   * ハイライト対象（問題文＋選択肢）を指定してフェードアウト遷移するための拡張API。
   *
   * @param {string} nextUrl
   * @param {string} reason
   * @param {Object} highlightTargets
   *   highlightTargets.questionNode … 問題文DOMノード
   *   highlightTargets.choiceNode   … 選択肢DOMノード
   */
  function fadeOutToWithHighlight(nextUrl, reason, highlightTargets) {
    if (!nextUrl) {
      return;
    }

    var questionNode = null;
    var choiceNode = null;

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
      questionNode = null;
      choiceNode = null;
    }

    if (questionNode || choiceNode) {
      createHighlightLayer(questionNode, choiceNode);
    }

    // 実際のフェードアウト処理は既存の fadeOutTo に委譲する
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
  // - CSCS_FADE.fadeOutToWithHighlight(url, reason, { questionNode, choiceNode })
  // - CSCS_FADE.runFadeInIfNeeded()
  // - CSCS_FADE.fadeReload(reason)
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