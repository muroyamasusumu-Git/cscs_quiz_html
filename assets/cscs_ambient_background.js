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

  // reduced motion 対応（酔い・負荷回避）
  var prefersReducedMotion = false;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prefersReducedMotion = true;
    }
  } catch (_e) {
    prefersReducedMotion = false;
  }

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
      + "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 100%);"
      + "background-repeat: no-repeat;"
      + "background-attachment: fixed;"
      + "}"

      // ▼ 楕円スポットライト専用レイヤー（これだけ回転）
      + "html." + BODY_CLASS + "::after{"
      + "content:'';"
      + "position: fixed;"
      + "inset: 0;"
      + "pointer-events: none;"
      + "z-index: 0;"
      // 回転の支点を「楕円の中心」に合わせる
      + "transform-origin: 23% 20%;"
      // ▼ 楕円レイヤー全体を左上へオフセットしてから回転
      // 目的: 楕円の「中心(at 23% 20%)」ではなく、見た目全体を左上へ寄せる
      + "transform: translate(-4%, -4%) rotate(-5deg);"
      + "background:"
      // ▼ 中心コア（小さく・少しだけ強い）
      + "radial-gradient("
      + "ellipse 820px 240px at 23% 20%,"
      + "rgba(70,70,70,0.45) 0%,"
      + "rgba(50,50,50,0.32) 42%,"
      + "rgba(0,0,0,0) 70%"
      + "),"
      // ▼ メインの楕円スポットライト（既存）
      + "radial-gradient("
      + "ellipse 1980px 567px at 23% 20%,"
      + "rgba(58,58,58,0.64) 0%,"
      + "rgba(34,34,34,0.52) 38%,"
      + "rgba(0,0,0,0) 78%"
      + ");"
      + "background-repeat: no-repeat;"
      + "background-attachment: fixed;"
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

  // 時間でじわじわ色相をずらす（超ゆっくり）
  // “波”を3本（h1/h2/h3）に分けて干渉させると、自然に見える
  var rafId = null;
  var startMs = 0;

  function tick(now) {
    if (!enabled || prefersReducedMotion) {
      rafId = null;
      return;
    }
    if (!document || !document.body) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    if (!startMs) startMs = now;
    var t = (now - startMs) / 1000; // seconds

    // speed 0..1 -> 動きにスピードを付ける（“変化が分かる”寄り）
    // 目的: 視覚的に「動いている」ことが分かる速さにする
    var s = 0.030 + 0.140 * clamp01(speed);

    // 白黒の濃度比率（明度）は固定（時間で明るく/暗くならない）
    // 目的: 背景全体の明るさ感が上下しないようにする
    var g1 = (theme === "deep") ? 40 : 200;
    var g2 = (theme === "deep") ? 90 : 235;
    var g3 = (theme === "deep") ? 65 : 215;

    // intensity は「出方（アルファ）」に反映（時間で揺らさない）
    // 目的: ユーザー操作での強弱は許可しつつ、時間変化で明るさがブレないようにする
    var c1a = 0.14 + 0.40 * clamp01(intensity);
    var c2a = 0.12 + 0.36 * clamp01(intensity);
    var c3a = 0.10 + 0.34 * clamp01(intensity);

    // 斜めグラデ角度：動きが分かるように少し大きめに揺らす
    // 目的: “向き”の変化が見える
    var ang = 135 + 34 * Math.sin((t * s) * 1.1 + 0.4);

    // background-position：動きが分かるようにやや速め＆大きめ
    // 目的: グラデが“流れている”のが分かる
    var bx = 50 + 16 * Math.sin((t * s) * 1.0 + 1.2);
    var by = 50 + 16 * Math.sin((t * s) * 0.9 + 2.1);

    // radial中心：動きが分かるように漂い幅を維持しつつ少し速め
    // 目的: 2つの塊が“漂う”のが分かる
    var b1x = 20 + 18 * Math.sin((t * s) * 1.15 + 2.7);
    var b1y = 25 + 18 * Math.sin((t * s) * 1.25 + 0.9);
    var b2x = 75 + 18 * Math.sin((t * s) * 1.20 + 1.6);
    var b2y = 70 + 18 * Math.sin((t * s) * 1.05 + 3.4);

    // CSS変数で反映（明度は固定、動くのは angle/position/center + 左の円の楕円半径）
    try {
      document.documentElement.style.setProperty("--cscs-g1", String(g1));
      document.documentElement.style.setProperty("--cscs-g2", String(g2));
      document.documentElement.style.setProperty("--cscs-g3", String(g3));

      document.documentElement.style.setProperty("--cscs-bg-angle", String(ang) + "deg");
      document.documentElement.style.setProperty("--cscs-bg-x", String(bx) + "%");
      document.documentElement.style.setProperty("--cscs-bg-y", String(by) + "%");
      document.documentElement.style.setProperty("--cscs-b1x", String(b1x) + "%");
      document.documentElement.style.setProperty("--cscs-b1y", String(b1y) + "%");
      document.documentElement.style.setProperty("--cscs-b2x", String(b2x) + "%");
      document.documentElement.style.setProperty("--cscs-b2y", String(b2y) + "%");

      document.documentElement.style.setProperty("--cscs-c1a", String(c1a));
      document.documentElement.style.setProperty("--cscs-c2a", String(c2a));
      document.documentElement.style.setProperty("--cscs-c3a", String(c3a));

      // 左側の円形グラデ：中心位置は固定（CSS側で at 12% 50%）
      // ここでは “円⇄楕円” の変形（rx/ry）だけを時間で変化させる
      var blobBase = (theme === "deep") ? 720 : 980;  // 基本サイズ
      var blobAmp  = (theme === "deep") ? 220 : 260;  // 変形量（円→楕円の強さ）
      var blobPhase = (t * s) * 0.90;                 // 変形スピード（角度や位置は触らない）

      // 位相を90°ずらして「円→横楕円→縦楕円→円…」を作る
      var blobRx = blobBase + blobAmp * Math.sin(blobPhase);
      var blobRy = blobBase + blobAmp * Math.sin(blobPhase + Math.PI / 2);

      // 強さ（アルファ）は intensity に連動（時間では揺らさない）
      var blobA = 0.18 + 0.28 * clamp01(intensity);

      document.documentElement.style.setProperty("--cscs-blob-rx", String(Math.round(blobRx)) + "px");
      document.documentElement.style.setProperty("--cscs-blob-ry", String(Math.round(blobRy)) + "px");
      document.documentElement.style.setProperty("--cscs-blob-a", String(blobA));
    } catch (_e) {
      // 失敗しても継続（フォールバックで別ルートは作らない）
    }

    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (!enabled || prefersReducedMotion) return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
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

    // ▼ 動き無しモード：requestAnimationFrame を使わない
    // 目的: 背景は静的に固定し、ブラウザ負荷・インスペクタの“動きまくり”をゼロにする
    stop();
  }

  // 公開API
  window.CSCS_AMBIENT_BG = {
    setEnabled: function (v) {
      enabled = !!v;
      if (enabled) {
        ensureLayer();
        start();
      } else {
        stop();
        // body への影響を完全に取り除く（背景も元に戻す）
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