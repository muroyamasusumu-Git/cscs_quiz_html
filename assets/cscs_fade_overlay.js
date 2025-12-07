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
   * 問題文＋選択肢を「画面上の見た目を一切変えず」に前面へ浮かせる処理。
   * - クローンは作らず、渡された DOM ノードそのものに z-index を付与してオーバーレイより前面に出す。
   * - DOM の親子関係や left/top/width/margin などのレイアウトは一切変更しない。
   * - choiceNode が <li> の場合は、親の <ol class="opts"> などのリストコンテナに昇格させてリスト全体をハイライトする。
   *
   * @param {Element|null} questionNode  元の問題文DOMノード(<h1>など)
   * @param {Element|null} choiceNode    元の選択肢コンテナDOMノード(<ol class="opts"> など。<li> が来た場合はここでリスト親に昇格させる)
   * @returns {null}                     独立レイヤー要素は作らないので常に null
   */
  function createHighlightLayer(questionNode, choiceNode) {
    try {
      // 旧仕様で使っていたハイライト用レイヤー(#cscs-fade-highlight-layer)が残っていれば掃除しておく
      var existing = document.getElementById("cscs-fade-highlight-layer"); // 旧レイヤー要素を取得
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing); // 旧レイヤーを DOM から完全に取り除く
      }

      // choiceNode が <li> の場合は、ここで必ず親の <ol class="opts"> などのリストコンテナに昇格させる
      // - これにより、番号付きリスト全体（インデント・行間・装飾を含む）をそのまま前面に出せる
      // - 親のリストコンテナが見つからない場合は、選択肢側のハイライトは行わない（フォールバック無し）
      if (choiceNode && choiceNode.nodeType === 1) {
        var tag = choiceNode.tagName ? choiceNode.tagName.toLowerCase() : "";
        if (tag === "li") {
          var listContainer = null;                                     // 昇格先となるリストコンテナ(<ol>/<ul>)の一時保持
          if (typeof choiceNode.closest === "function") {
            listContainer = choiceNode.closest("ol.opts") ||            // まずは .opts を持つ <ol> を最優先で探す
                            choiceNode.closest("ol") ||                 // 見つからなければ汎用的な <ol> を対象とする
                            choiceNode.closest("ul");                   // それでも無ければ <ul> を対象にする
          }
          if (listContainer && listContainer.nodeType === 1) {
            choiceNode = listContainer;                                 // ハイライト対象をリストコンテナ全体に差し替える
          } else {
            choiceNode = null;                                          // 親リストが見つからない場合は選択肢のハイライトは諦める
          }
        }
      }

      // ハイライト対象が何も渡されていない場合は処理不要
      if (!questionNode && !choiceNode) {
        return null; // どちらも null なら何もせず終了
      }

      // ハイライト対象を配列にまとめる（共通ロジックで処理するため）
      var targets = []; // 前面に出す対象ノード一覧
      if (questionNode && questionNode.nodeType === 1) {
        targets.push(questionNode); // 有効な問題文ノードを登録
      }
      if (choiceNode && choiceNode.nodeType === 1) {
        targets.push(choiceNode);   // 有効な選択肢コンテナノードを登録
      }

      // それぞれの対象ノードに対して、レイアウトはそのままに z-index のみを上げる
      for (var i = 0; i < targets.length; i++) {
        var node = targets[i]; // 現在処理中のノード

        // 一度ハイライト適用済みのノードに対しては二重に処理を掛けない
        if (node.getAttribute("data-cscs-highlight-fixed") === "1") {
          continue; // data-cscs-highlight-fixed="1" があればスキップ
        }

        // 元の inline style 値を退避しておく（必要になればデバッグ用に確認できるようにする）
        node.setAttribute("data-cscs-highlight-orig-position", node.style.position || ""); // 元々の position を保存
        node.setAttribute("data-cscs-highlight-orig-zindex", node.style.zIndex || "");    // 元々の z-index を保存

        // このノードにはハイライト用処理を適用済みであることをマークする
        node.setAttribute("data-cscs-highlight-fixed", "1"); // 再処理防止フラグをセット

        // position が未指定（inline style 上で空）の場合だけ relative を付けて z-index を有効にする
        if (!node.style.position) {
          node.style.position = "relative";                   // レイアウトを崩さずにスタッキングコンテキストだけ作る
        }

        // フェードオーバーレイ(z-index:9998)より前面に出すための z-index を付与し、見た目はそのままに手前へ浮かせる
        node.style.zIndex = "9999";                           // 暗転オーバーレイより前に表示させる
        node.style.pointerEvents = "none";                    // フェード中はクリック・タップを拾わないようイベントを無効化する
      }

      // 独立したレイヤー要素は生成していないので戻り値は null
      return null;
    } catch (_e) {
      // 予期せぬ例外が発生してもフェード処理自体は継続させたいので null を返して終了
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