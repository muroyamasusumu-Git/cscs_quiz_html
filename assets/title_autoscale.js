(function(){
  "use strict";

  try {
    if (!document.documentElement.classList.contains("autoscale-hide")) {
      document.documentElement.classList.add("autoscale-hide");
    }
  } catch (_) {}

  function q(sel){ return document.querySelector(sel); }

  function measureScale() {
    const h1 = q("h1");
    const ol = q("ol.opts");
    if (!h1) return { h1: 1, ol: 1 };

    const wrap = q(".wrap") || document.body;
    const containerWidth = wrap.getBoundingClientRect().width || window.innerWidth;

    // --- h1 実寸測定 ---
    const clone = h1.cloneNode(true);
    clone.style.visibility = "hidden";
    clone.style.position = "absolute";
    clone.style.left = "-99999px";
    clone.style.top = "0";
    clone.style.transform = "none";
    clone.style.whiteSpace = "normal";
    document.body.appendChild(clone);

    const naturalWidth = clone.getBoundingClientRect().width || containerWidth;
    const naturalHeight = clone.getBoundingClientRect().height || 0;

    const lineHeight = parseFloat(getComputedStyle(h1).lineHeight || "44");
    const targetLines = 2;
    const targetHeight = lineHeight * targetLines;

    const sx = containerWidth > 0 ? Math.min(1, containerWidth / naturalWidth) : 1;
    const sy = naturalHeight > 0 ? Math.min(1, targetHeight / naturalHeight) : 1;

    let h1Scale = Math.min(sx, sy);

    // --- h1カーブは前回のまま（大きめ） ---
    const textLen = (h1.textContent || "").trim().length;
    if (textLen >= 60) h1Scale = Math.min(h1Scale, 0.80);
    else if (textLen >= 45) h1Scale = Math.min(h1Scale, 0.85);
    else if (textLen >= 30) h1Scale = Math.min(h1Scale, 0.90);
    else if (textLen >= 20) h1Scale = Math.min(h1Scale, 0.95);
    h1Scale = Math.max(0.85, h1Scale);

    // --- ol の縮小を強める ---
    // h1 が小さいほど ol もさらに小さく
    let olScale = 1.0;
    if (h1Scale < 0.8) olScale = 0.85;     // h1 かなり小さい → ol も小さめ
    else if (h1Scale < 0.85) olScale = 0.88;
    else if (h1Scale < 0.9) olScale = 0.90;
    else if (h1Scale < 0.95) olScale = 0.92;
    else olScale = 0.95;                   // h1 が大きめのときでも少しだけ小さく

    document.body.removeChild(clone);
    return { h1: h1Scale, ol: olScale };
  }

  async function ready() {
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (_) {}

    const { h1, ol } = measureScale();
    const root = document.documentElement;
    root.style.setProperty("--h1-scale", String(h1));
    root.style.setProperty("--opts-scale", String(ol));
    root.classList.remove("autoscale-hide");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();