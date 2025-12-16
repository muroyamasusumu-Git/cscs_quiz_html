// assets/cscs_slide_in.js
// CSCS 共通: 「左からのスライドイン」演出専用スクリプト
// - アニメーション定義とターゲット要素の制御をこのファイルに集約する。
// - 各機能JSは「スライドさせたい要素」をHTMLクラスや構造で用意するだけ。
// - どの要素をスライドさせるかは、下の SLIDE_TARGET_SELECTORS を編集して調整する。

(function () {
  "use strict";

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "cscs_slide_in"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }

  // =========================================
  // スライドイン対象のセレクタ設定（A/Bで切り替え）
  // - Aパート (body.mode-a): 問題文<h1>と<ol class="opts">もスライドイン
  // - Bパート (body.mode-b): #judge / .answer のみスライドイン
  // =========================================
  function getSlideTargetSelectors() {
    var body = document.body || document.getElementsByTagName("body")[0];
    var isModeB = false;

    if (body && body.classList && typeof body.classList.contains === "function") {
      isModeB = body.classList.contains("mode-b");
    }

    // Bパート: 判定表示エリア / 解答表示 / 解説テキストだけスライドイン
    if (isModeB) {
      return [
        "#judge",
        ".answer",
        ".explain-text"  // Bパートの解説文(span.explain-text)を、少し遅れてスライドインさせる対象として追加
      ];
    }

    // Aパート（その他）: 問題文 + 選択肢 + 上部メタ情報もスライドイン対象に含める
    return [
      "#judge",
      ".answer",
      "div.topmeta",
      "div.qno",
      "h1",
      "ol.opts"
    ];
  }

  // 一度だけアニメ用スタイルを注入する
  function ensureSlideStyle() {
    if (document.getElementById("cscs-slide-style")) return;

    var style = document.createElement("style");
    style.id = "cscs-slide-style";
    style.type = "text/css";
    style.textContent =
      // 汎用スライドイン（h1 / #judge / .answer / ol.opts / .explain-text などに利用）
      ".cscs-slide-in-left {" +
      "  animation: cscsSlideInLeft 0.5s ease-out 0s 1;" +       // 左から 0.5 秒でスライドインする基本アニメーション
      "  animation-fill-mode: both;" +                           // アニメ後も最終状態を維持する
      "  transform-origin: center left;" +                       // 左側を基準にスライドさせる
      "}" +
      "@keyframes cscsSlideInLeft {" +
      "  0% { transform: translateX(-40px); opacity: 0; }" +      // 通常要素は 40px 程度のスライド
      "  100% { transform: translateX(0); opacity: 1; }" +
      "}";

    var head =
      document.head ||
      document.getElementsByTagName("head")[0] ||
      document.documentElement;
    head.appendChild(style);
  }

  // 対象要素にスライドイン用クラスを付与する（多重適用は data 属性でガード）
  function applySlideInOnce() {
    try {
      ensureSlideStyle();

      var selectors = getSlideTargetSelectors();

      for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        if (!sel) continue;

        var nodes = document.querySelectorAll(sel);
        if (!nodes || nodes.length === 0) continue;

        for (var j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (!el) continue;

          // すでに適用済みならスキップ（何度呼んでも一度だけ発火）
          if (el.getAttribute("data-cscs-slide-applied") === "1") {
            continue;
          }

          // 「この要素にはスライドイン処理を予約済み」というフラグを先に立てる
          el.setAttribute("data-cscs-slide-applied", "1");

          // 解説も含めて、対象要素はすべて同じスライドインに統一する
          try {
            el.classList.add("cscs-slide-in-left");
          } catch (_e) {
            // classList.add に失敗しても他要素には影響させない
          }
        }
      }
    } catch (e) {
      try {
        console.warn("[cscs_slide_in] applySlideInOnce error", e);
      } catch (_) {}
    }
  }

  // 初期化: DOM 準備後に一度スライドインを試みる
  function initSlideIn() {
    applySlideInOnce();

    // 少し遅延させて再度実行（他JSが後から DOM を書き換えるケースへの保険）
    setTimeout(applySlideInOnce, 50);
    setTimeout(applySlideInOnce, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSlideIn, { once: true });
    window.addEventListener("load", applySlideInOnce);
  } else {
    initSlideIn();
    window.addEventListener("load", applySlideInOnce);
  }

  // 外部から直接呼びたい場合用の簡易API
  // 例: CSCS_SLIDE.addLeft(document.querySelector(".foo"));
  window.CSCS_SLIDE = {
    addLeft: function (el) {
      try {
        if (!el) return;
        ensureSlideStyle();
        if (el.getAttribute("data-cscs-slide-applied") === "1") {
          return;
        }
        el.setAttribute("data-cscs-slide-applied", "1");
        el.classList.add("cscs-slide-in-left");
      } catch (e) {
        try {
          console.warn("[cscs_slide_in] addLeft error", e);
        } catch (_) {}
      }
    }
  };
})();