// title_autoscale.js
// h1 の実幅を測って長文なら自動で縮小。
// wrap 幅に対して scrollWidth を比較し、--h1-scale を更新。
// <ol> も連動してフォントサイズを小さくする。
(function(){
  "use strict";

  function scaleByFit(el, container){
    if(!el || !container) return 1;
    document.documentElement.style.setProperty("--h1-scale","1");
    const cw = container.clientWidth || container.offsetWidth || window.innerWidth;
    const need = el.scrollWidth;
    if (!cw || !need) return 1;
    const raw = (cw * 0.95) / need;       // 少し余裕を持たせる
    return Math.max(0.7, Math.min(1, raw)); // 0.7〜1.0に制限
  }

  function applyScale(){
    const h1 = document.querySelector(".wrap h1") || document.querySelector("h1");
    const container = document.querySelector(".wrap") || document.body;
    if(!h1 || !container) return;
    const s = scaleByFit(h1, container);
    document.documentElement.style.setProperty("--h1-scale", String(s));
  }

  window.addEventListener("DOMContentLoaded", applyScale);
  window.addEventListener("load", applyScale);
  window.addEventListener("resize", () => {
    clearTimeout(window.__h1_scale_tid);
    window.__h1_scale_tid = setTimeout(applyScale, 120);
  });
})();