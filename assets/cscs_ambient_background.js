// assets/cscs_ambient_background.js
/**
 * CSCS Ambient Background (slow gradient drift)
 *
 * 目的:
 * - ページ全体の背景に「ごくゆっくり変化するグラデーション」を敷く
 * - quiz のUI(= .wrap) より背面に固定し、クリックやレイアウトに干渉しない
 *
 * 公開API:
 *   window.CSCS_AMBIENT_BG.setEnabled(true|false)
 *   window.CSCS_AMBIENT_BG.setIntensity(0..1)
 *   window.CSCS_AMBIENT_BG.setSpeed(0..1)
 *   window.CSCS_AMBIENT_BG.setTheme("deep"|"soft")
 */
(function () {
  "use strict";

  var BODY_CLASS = "cscs-ambient-bg-on";
  var STYLE_ID = "cscs-ambient-bg-style";

  var enabled = true;
  var intensity = 0.55; // 0..1（透明度・色の強さ）
  var speed = 0.22;     // 0..1（色相の進む速さ）
  var theme = "deep";   // "deep" or "soft"

  // ▼ 全体の暗さ（背景レイヤーのみ）: 0..1
  // 目的: テスト時にここ1箇所で「全体的に少し暗め」を一括調整できるようにする
  var dim = 0.18;

  function injectStyleIfNeeded() {
    if (document.getElementById(STYLE_ID)) return;

    var styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.type = "text/css";

    // 重要:
    // - body背景は触らない
    // - 背景レイヤーは最背面に固定
    // - .wrap 側を前面に保つ（z-indexの衝突を避けるため、必要なら .wrap に position:relative; z-index:1; を足す）
    var cssText = ""
      + "html, body{"
      + "height:100%;"
      + "min-height:100%;"
      + "}"
      + "html." + BODY_CLASS + "{"
      + "min-height:100vh;"
      + "background-color: rgba(0,0,0,1);"
      + "}"

      + "body{"
      + "background: transparent;"
      + "position: relative;"
      + "z-index: 1;"
      + "}"

      // ▼ quiz UI を背景レイヤーより必ず前面に固定
      // 目的: html::before / html::after の擬似要素が“上に被さる”事故を防ぐ
      + ".wrap{"
      + "position: relative;"
      + "z-index: 2;"
      + "}"

      + "html." + BODY_CLASS + "::before{"
      + "content:'';"
      + "position: fixed;"
      + "inset: 0;"
      + "pointer-events: none;"
      + "z-index: 0;"
      // ▼ 右＆左下の暗さ + ベース黒（回転しない）
      + "background:"
      // ▼ 右下 → 左上へ抜ける直線グラデーション
      // 目的: 光の方向感を補強し、画面右下をわずかに明るく、左上を締める
      + "linear-gradient("
      + "135deg,"
      + "rgba(0,0,0,0.05) 0%,"
      + "rgba(0,0,0,0.18) 55%,"
      + "rgba(0,0,0,0.32) 100%"
      + "),"
      // ▼ 全体の暗さ（黒オーバーレイ）
      // 目的: dim の値で、背景レイヤー全体を一括で少し暗めに寄せる
      + "linear-gradient(180deg, rgba(0,0,0,var(--cscs-ambient-dim-a,0)) 0%, rgba(0,0,0,var(--cscs-ambient-dim-a,0)) 100%),"
      // 右側を暗く落とす
      + "linear-gradient("
      + "to right,"
      + "rgba(0,0,0,0) 0%,"
      + "rgba(0,0,0,0.22) 55%,"
      + "rgba(0,0,0,0.58) 100%"
      + "),"
      // 左下も暗く溜める
      + "linear-gradient("
      + "to bottom,"
      + "rgba(0,0,0,0) 0%,"
      + "rgba(0,0,0,0.28) 60%,"
      + "rgba(0,0,0,0.70) 100%"
      + "),"
      // ベースの黒
      + "linear-gradient(180deg, rgba(18,18,18,1) 0%, rgba(14,14,14,1) 100%);"
      + "background-repeat: no-repeat;"
      + "background-attachment: fixed;"
      + "}"

      // ▼ 楕円スポットライト専用レイヤー（これだけ回転）
      + "html." + BODY_CLASS + "::after{"
      + "content:'';"
      + "position: fixed;"
      // ▼ 回転で端が欠けるのを防ぐため、擬似要素を画面外へ広げる
      // 目的: rotate() により右端・下端が透明になって見える“途切れ”を、方向別の余白で確実にカバーする
      + "top: -12%;"
      + "right: -12%;"
      + "bottom: -22%;"
      + "left: -22%;"
      + "pointer-events: none;"
      + "z-index: 0;"
      // 回転の支点を「楕円の中心」に合わせる
      + "transform-origin: 23% 20%;"
      // ▼ 楕円レイヤー全体を左上へオフセットしてから回転
      // 目的: 楕円の「中心(at 23% 20%)」ではなく、見た目全体を左上へ寄せる
      + "transform: translate(-4%, -4%) rotate(-30deg);"
      + "background:"
      // ▼ 全体の暗さ（黒オーバーレイ）
      // 目的: dim の値で、楕円スポットライト層も一括で少し暗めに寄せる
      + "linear-gradient(180deg, rgba(0,0,0,var(--cscs-ambient-dim-a,0)) 0%, rgba(0,0,0,var(--cscs-ambient-dim-a,0)) 100%),"
      // ▼ 中心コア（小さく・少しだけ強い）
      + "radial-gradient("
      + "ellipse 400px 130px at 23% 30%,"
      + "rgba(70,70,70,0.45) 0%,"
      + "rgba(50,50,50,0.32) 42%,"
      + "rgba(0,0,0,0) 70%"
      + "),"
      // ▼ メインの楕円スポットライト（既存）
      + "radial-gradient("
      + "ellipse 1980px 567px at 23% 30%,"
      + "rgba(58,58,58,0.64) 0%,"
      + "rgba(34,34,34,0.52) 38%,"
      + "rgba(0,0,0,0) 78%"
      + "),"
      // ▼ ほんのりノイズ（粒子）: バンディング抑制＆質感付け
      + "url(\"data:image/svg+xml;utf8,"
      + "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>"
      + "<filter id='n'>"
      + "<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>"
      + "<feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.055 0'/>"
      + "</filter>"
      + "<rect width='160' height='160' filter='url(%23n)'/>"
      + "</svg>\");"
      + "background-repeat: no-repeat, no-repeat, no-repeat, repeat;"
      + "background-attachment: fixed, fixed, fixed, fixed;"
      + "background-blend-mode: normal, normal, normal, soft-light;"
      + "}"

      + "html." + BODY_CLASS + "[data-cscs-ambient-theme='soft']{"
      + "background-color: rgba(245,245,245,1);"
      + "}"

      + "html." + BODY_CLASS + "[data-cscs-ambient-theme='soft']::before{"
      + "background:"
      + "radial-gradient(1200px 800px at 25% 20%, rgba(var(--cscs-g1,200), var(--cscs-g1,200), var(--cscs-g1,200), 0.36) 0%, rgba(255,255,255,0) 62%),"
      + "radial-gradient(1100px 700px at 75% 65%, rgba(var(--cscs-g2,235), var(--cscs-g2,235), var(--cscs-g2,235), 0.32) 0%, rgba(255,255,255,0) 65%),"
      + "radial-gradient(1400px 900px at 45% 85%, rgba(var(--cscs-g3,215), var(--cscs-g3,215), var(--cscs-g3,215), 0.30) 0%, rgba(255,255,255,0) 70%),"
      + "linear-gradient(180deg, rgba(245,245,245,1) 0%, rgba(225,225,225,1) 100%);"
      + "}"
      ;

    styleEl.appendChild(document.createTextNode(cssText));
    document.head.appendChild(styleEl);
  }

  function ensureLayer() {
    if (!document || !document.body) return null;

    // このJS専用のスコープを body に付与（他要素へは一切影響しない）
    try {
      document.documentElement.classList.add(BODY_CLASS);
    } catch (_eClass) {
      // classList が無い環境は対象外（フォールバックは作らない）
      return null;
    }

    // テーマは body 属性に保持（CSSが body の属性で出し分け）
    try {
      document.documentElement.setAttribute("data-cscs-ambient-theme", theme);
    } catch (_eTheme) {
    }

    return document.body;
  }

  function clamp01(x) {
    if (typeof x !== "number" || isNaN(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function applyDim() {
    if (!document || !document.documentElement) return;

    // ▼ dim(0..1) → 乗算しやすい黒オーバーレイの alpha(0..0.30) に変換
    // 目的: 暗さを上げても「黒がベタ塗り」にならず、微調整がしやすい範囲に収める
    var a = 0.30 * clamp01(dim);

    try {
      document.documentElement.style.setProperty("--cscs-ambient-dim-a", String(a));
    } catch (_e) {
    }
  }

  function applyTheme() {
    if (!document || !document.body) return;
    try {
      document.documentElement.setAttribute("data-cscs-ambient-theme", theme);
    } catch (_e) {
    }
  }

  function init() {
    injectStyleIfNeeded();
    ensureLayer();

    // ▼ 背景の暗さ（黒オーバーレイ）を反映
    // 目的: テスト用つまみ dim の値を、CSS変数へ一括反映する
    applyDim();

    // 補足: アニメ処理（rAF/tick）は完全に削除し、背景は静的に固定する
  }

  // 公開API
  window.CSCS_AMBIENT_BG = {
    setEnabled: function (v) {
      enabled = !!v;
      if (enabled) {
        // 補足: アニメ処理は削除済みのため、class付与のみ行う
        ensureLayer();

        // ▼ 背景の暗さ（黒オーバーレイ）を反映
        // 目的: OFF→ON したときも dim の見た目が即座に戻るようにする
        applyDim();
      } else {
        // 補足: アニメ処理は削除済みのため、停止処理は不要。class/属性とCSS変数を掃除する
        try {
          if (document && document.body) {
            document.documentElement.classList.remove(BODY_CLASS);
            document.documentElement.removeAttribute("data-cscs-ambient-theme");
            document.body.style.removeProperty("--cscs-h1");
            document.body.style.removeProperty("--cscs-h2");
            document.body.style.removeProperty("--cscs-h3");
            document.documentElement.style.removeProperty("--cscs-g1");
            document.documentElement.style.removeProperty("--cscs-g2");
            document.documentElement.style.removeProperty("--cscs-g3");
            document.documentElement.style.removeProperty("--cscs-bg-angle");
            document.documentElement.style.removeProperty("--cscs-bg-x");
            document.documentElement.style.removeProperty("--cscs-bg-y");
            document.documentElement.style.removeProperty("--cscs-b1x");
            document.documentElement.style.removeProperty("--cscs-b1y");
            document.documentElement.style.removeProperty("--cscs-b2x");
            document.documentElement.style.removeProperty("--cscs-b2y");
            document.documentElement.style.removeProperty("--cscs-c1a");
            document.documentElement.style.removeProperty("--cscs-c2a");
            document.documentElement.style.removeProperty("--cscs-c3a");

            // 左側の円形グラデ（円⇄楕円）の制御変数も消す
            document.documentElement.style.removeProperty("--cscs-blob-rx");
            document.documentElement.style.removeProperty("--cscs-blob-ry");
            document.documentElement.style.removeProperty("--cscs-blob-a");

            document.documentElement.style.removeProperty("--cscs-bg-opacity");
            document.documentElement.style.removeProperty("--cscs-bg-sat");
            document.documentElement.style.removeProperty("--cscs-bg-blur");

            // ▼ 背景の暗さ（黒オーバーレイ）も掃除
            // 目的: setEnabled(false) で見た目を完全に元へ戻す
            document.documentElement.style.removeProperty("--cscs-ambient-dim-a");
          }
        } catch (_e) {
        }
      }
    },
    setIntensity: function (v) {
      intensity = clamp01(v);
    },
    setSpeed: function (v) {
      speed = clamp01(v);
    },
    setTheme: function (v) {
      if (v === "deep" || v === "soft") {
        theme = v;
        applyTheme();
      }
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();