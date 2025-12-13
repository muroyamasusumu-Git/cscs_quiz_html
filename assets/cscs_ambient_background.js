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
      + "body." + BODY_CLASS + "{"
      + "background:"
      + "linear-gradient("
      + "var(--cscs-bg-angle,135deg),"
      + "rgba(4,5,7,1) 0%,"
      + "hsla(var(--cscs-h1,210), 60%, 12%, var(--cscs-c1a,0.22)) 28%,"
      + "hsla(var(--cscs-h2,285), 60%, 12%, var(--cscs-c2a,0.18)) 58%,"
      + "hsla(var(--cscs-h3,170), 60%, 12%, var(--cscs-c3a,0.16)) 82%,"
      + "rgba(2,2,3,1) 100%"
      + "),"
      + "radial-gradient(900px 700px at var(--cscs-b1x,20%) var(--cscs-b1y,25%), hsla(var(--cscs-h2,285), 70%, 14%, 0.18) 0%, rgba(0,0,0,0) 68%),"
      + "radial-gradient(1000px 800px at var(--cscs-b2x,75%) var(--cscs-b2y,70%), hsla(var(--cscs-h1,210), 70%, 14%, 0.16) 0%, rgba(0,0,0,0) 70%),"
      + "linear-gradient(180deg, rgba(6,7,10,1) 0%, rgba(2,2,3,1) 100%);"
      + "background-size: 140% 140%, 140% 140%, 140% 140%, 100% 100%;"
      + "background-position: var(--cscs-bg-x,50%) var(--cscs-bg-y,50%), 50% 50%, 50% 50%, 50% 50%;"
      + "background-attachment: fixed;"
      + "background-repeat: no-repeat;"
      + "background-color: rgba(2,2,3,1);"
      + "}"

      + "body." + BODY_CLASS + "[data-cscs-ambient-theme='soft']{"
      + "background:"
      + "radial-gradient(1200px 800px at 25% 20%, hsla(var(--cscs-h1,210), 65%, 78%, 0.25) 0%, rgba(255,255,255,0) 62%),"
      + "radial-gradient(1100px 700px at 75% 65%, hsla(var(--cscs-h2,285), 65%, 78%, 0.22) 0%, rgba(255,255,255,0) 65%),"
      + "radial-gradient(1400px 900px at 45% 85%, hsla(var(--cscs-h3,170), 65%, 78%, 0.20) 0%, rgba(255,255,255,0) 70%),"
      + "linear-gradient(180deg, rgba(248,249,252,1) 0%, rgba(238,241,248,1) 100%);"
      + "background-attachment: fixed;"
      + "background-repeat: no-repeat;"
      + "background-color: rgba(248,249,252,1);"
      + "}"
      ;

    styleEl.appendChild(document.createTextNode(cssText));
    document.head.appendChild(styleEl);
  }

  function ensureLayer() {
    if (!document || !document.body) return null;

    // このJS専用のスコープを body に付与（他要素へは一切影響しない）
    try {
      document.body.classList.add(BODY_CLASS);
    } catch (_eClass) {
      // classList が無い環境は対象外（フォールバックは作らない）
      return null;
    }

    // テーマは body 属性に保持（CSSが body の属性で出し分け）
    try {
      document.body.setAttribute("data-cscs-ambient-theme", theme);
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

    // speed 0..1 -> 実際の進み（秒あたりの位相変化）を極小にする
    var s = 0.002 + 0.010 * clamp01(speed);

    // 3つの色相（0..360）
    var h1 = 210 + 55 * Math.sin((t * s) * 2.0);
    var h2 = 285 + 60 * Math.sin((t * s) * 1.6 + 1.8);
    var h3 = 170 + 50 * Math.sin((t * s) * 1.2 + 3.1);

    // opacity / saturation を intensity に連動
    var op = 0.10 + 0.70 * clamp01(intensity);
    var sat = 100 + 35 * clamp01(intensity);

    // テーマにより、ちょい調整
    var blur = 0;
    if (theme === "deep") {
      blur = 0; // deep はシャープ寄り
    } else {
      blur = 0; // soft でも基本は無し（必要なら 0.5〜1px くらいに）
    }

    // CSS変数で反映
    try {
      document.body.style.setProperty("--cscs-h1", String(h1));
      document.documentElement.style.setProperty("--cscs-h2", String(h2));
      document.documentElement.style.setProperty("--cscs-h3", String(h3));

      // 黒の中に「色が入り込む量」：intensity に追従（薄め推奨）
      var c1a = 0.08 + 0.22 * clamp01(intensity);
      var c2a = 0.06 + 0.20 * clamp01(intensity);
      var c3a = 0.05 + 0.18 * clamp01(intensity);

      // 斜めグラデの角度をほんの少し揺らす（揺れ幅は小さく）
      var ang = 135 + 10 * Math.sin((t * s) * 0.9 + 0.4);

      // 斜めグラデを“流す”ための background-position（ゆっくり）
      var bx = 50 + 6 * Math.sin((t * s) * 0.7 + 1.2);
      var by = 50 + 6 * Math.sin((t * s) * 0.6 + 2.1);

      // 薄いradialの中心も少し漂わせる
      var b1x = 20 + 10 * Math.sin((t * s) * 0.8 + 2.7);
      var b1y = 25 + 10 * Math.sin((t * s) * 0.9 + 0.9);
      var b2x = 75 + 10 * Math.sin((t * s) * 0.85 + 1.6);
      var b2y = 70 + 10 * Math.sin((t * s) * 0.75 + 3.4);

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

      document.documentElement.style.setProperty("--cscs-bg-opacity", String(op));
      document.documentElement.style.setProperty("--cscs-bg-sat", String(sat) + "%");
      document.documentElement.style.setProperty("--cscs-bg-blur", String(blur) + "px");
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
      document.body.setAttribute("data-cscs-ambient-theme", theme);
    } catch (_e) {
    }
  }

  function init() {
    injectStyleIfNeeded();
    ensureLayer();

    // ページが前面にない時は止めて、省電力＆負荷減
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    });

    // 初期スタート
    start();
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
            document.body.classList.remove(BODY_CLASS);
            document.body.removeAttribute("data-cscs-ambient-theme");
            document.body.style.removeProperty("--cscs-h1");
            document.body.style.removeProperty("--cscs-h2");
            document.body.style.removeProperty("--cscs-h3");
            document.body.style.removeProperty("--cscs-bg-angle");
            document.body.style.removeProperty("--cscs-bg-x");
            document.body.style.removeProperty("--cscs-bg-y");
            document.body.style.removeProperty("--cscs-b1x");
            document.body.style.removeProperty("--cscs-b1y");
            document.body.style.removeProperty("--cscs-b2x");
            document.body.style.removeProperty("--cscs-b2y");
            document.body.style.removeProperty("--cscs-c1a");
            document.body.style.removeProperty("--cscs-c2a");
            document.body.style.removeProperty("--cscs-c3a");
            document.body.style.removeProperty("--cscs-bg-opacity");
            document.body.style.removeProperty("--cscs-bg-sat");
            document.body.style.removeProperty("--cscs-bg-blur");
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