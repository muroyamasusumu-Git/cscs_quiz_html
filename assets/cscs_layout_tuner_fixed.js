(function(){
  "use strict";

  // ===== 対象（今回ユーザーが指定した5つだけ） =====
  var TARGETS = [
    { sel: "#cscs_sync_monitor_a", id: "cscs_sync_monitor_a" },
    { sel: "#similar-list", id: "similar-list" },
    { sel: "#cscs-field-star-summary", id: "cscs-field-star-summary" },
    { sel: "#nl-daily-summary-host", id: "nl-daily-summary-host" },
    { sel: "#nl-panel", id: "nl-panel" }
  ];

  var EDIT_KEY = "cscs_layout_edit_on";
  var NS = "cscs_layout_v1_fixed_targets";

  function envKey(){
    var w = Math.round(window.innerWidth);
    var h = Math.round(window.innerHeight);
    return w + "x" + h;
  }
  function storageKey(layoutId){
    return NS + ":" + envKey() + ":" + layoutId;
  }

  function getEditMode(){
    try { return localStorage.getItem(EDIT_KEY) === "1"; } catch(_) { return false; }
  }
  function setEditMode(on){
    try { localStorage.setItem(EDIT_KEY, on ? "1" : "0"); } catch(_) {}
  }

  function loadPos(layoutId){
    try{
      var raw = localStorage.getItem(storageKey(layoutId));
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj) return null;
      if(typeof obj.left !== "number") return null;
      if(typeof obj.top !== "number") return null;
      return obj;
    }catch(_){
      return null;
    }
  }

  function savePos(layoutId, pos){
    try{ localStorage.setItem(storageKey(layoutId), JSON.stringify(pos)); }catch(_){}
  }

  function clamp(n, min, max){
    if(n < min) return min;
    if(n > max) return max;
    return n;
  }

  function applyPos(el, pos){
    if(!pos) return;
    el.style.position = "fixed";
    el.style.left = pos.left + "px";
    el.style.top  = pos.top  + "px";
    if(pos.z != null) el.style.zIndex = String(pos.z);
  }

  function ensureToggleButton(){
    var id = "cscs-layout-edit-toggle";
    var btn = document.getElementById(id);
    if(btn) return btn;

    btn = document.createElement("button");
    btn.id = id;
    btn.textContent = getEditMode() ? "LAYOUT：EDIT" : "LAYOUT：LOCK";

    btn.style.position = "fixed";
    btn.style.right = "8px";
    btn.style.bottom = "8px";
    btn.style.zIndex = "999999";
    btn.style.fontSize = "11px";
    btn.style.padding = "6px 8px";
    btn.style.borderRadius = "999px";
    btn.style.border = "1px solid rgba(255,255,255,0.2)";
    btn.style.background = "rgba(0,0,0,0.55)";
    btn.style.color = "#fff";
    btn.style.webkitTapHighlightColor = "transparent";

    btn.addEventListener("click", function(){
      var on = !getEditMode();
      setEditMode(on);
      btn.textContent = on ? "LAYOUT：EDIT" : "LAYOUT：LOCK";
      updateHandlesVisibility();
    });

    document.body.appendChild(btn);
    return btn;
  }

  function createHandle(el, layoutId){
    var existed = el.querySelector(":scope > .cscs-layout-handle");
    if(existed) return existed;

    // position:fixed のまま、要素内にハンドルを置く
    // absolute の基準は「要素自身」なので、要素が fixed ならOK
    var h = document.createElement("div");
    h.className = "cscs-layout-handle";
    h.setAttribute("data-layout-id-handle", layoutId);

    h.textContent = "≡";
    h.style.position = "absolute";
    h.style.right = "-6px";
    h.style.top = "-6px";
    h.style.width = "24px";
    h.style.height = "24px";
    h.style.display = "none";
    h.style.alignItems = "center";
    h.style.justifyContent = "center";
    h.style.borderRadius = "999px";
    h.style.border = "1px solid rgba(255,255,255,0.25)";
    h.style.background = "rgba(0,0,0,0.55)";
    h.style.color = "#fff";
    h.style.fontSize = "14px";
    h.style.lineHeight = "24px";
    h.style.textAlign = "center";
    h.style.cursor = "grab";
    h.style.userSelect = "none";
    h.style.webkitUserSelect = "none";
    h.style.touchAction = "none";
    h.style.zIndex = "999999";

    // ハンドルを「要素の右上」に固定するため、要素を基準にする
    // fixedでもOKだが、絶対に要素基準にしたいので relative にする（ただし fixed を壊さない）
    // ここでは position を変えず、ハンドルは要素内 absolute でOK（要素が fixed/absolute/relative なら基準になる）
    // もし el が position:static の場合だけ fixed に寄せる
    var p = getComputedStyle(el).position;
    if(p === "static"){
      el.style.position = "fixed";
    }

    el.appendChild(h);
    return h;
  }

  function makeDraggableByHandle(el, handle, layoutId){
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    function onDown(e){
      if(!getEditMode()) return;

      dragging = true;
      handle.setPointerCapture(e.pointerId);

      var rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      el.style.userSelect = "none";
      el.style.webkitUserSelect = "none";
      el.style.touchAction = "none";
      el.style.outline = "1px dashed rgba(255,255,255,0.55)";
      el.style.outlineOffset = "2px";

      handle.style.cursor = "grabbing";

      e.preventDefault();
    }

    function onMove(e){
      if(!dragging) return;

      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      var newLeft = startLeft + dx;
      var newTop  = startTop  + dy;

      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var rect = el.getBoundingClientRect();

      newLeft = clamp(newLeft, 0, vw - rect.width);
      newTop  = clamp(newTop,  0, vh - rect.height);

      el.style.position = "fixed";
      el.style.left = Math.round(newLeft) + "px";
      el.style.top  = Math.round(newTop)  + "px";
    }

    function onUp(e){
      if(!dragging) return;
      dragging = false;

      var rect = el.getBoundingClientRect();
      savePos(layoutId, {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        z: el.style.zIndex ? parseInt(el.style.zIndex, 10) : null
      });

      el.style.userSelect = "";
      el.style.webkitUserSelect = "";
      el.style.touchAction = "";
      el.style.outline = "";
      el.style.outlineOffset = "";

      handle.style.cursor = "grab";
    }

    handle.addEventListener("pointerdown", onDown, { passive: false });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
  }

  function updateHandlesVisibility(){
    var on = getEditMode();
    var handles = document.querySelectorAll(".cscs-layout-handle");
    for(var i=0;i<handles.length;i++){
      handles[i].style.display = on ? "flex" : "none";
    }
  }

  function initOneTarget(t){
    var el = document.querySelector(t.sel);
    if(!el) return false;

    // 二重初期化防止
    if(el.getAttribute("data-cscs-layout-initialized") === "1") return true;
    el.setAttribute("data-cscs-layout-initialized", "1");

    // 既に fixed で運用してる前提。staticなら fixed化する（最小限）
    var p = getComputedStyle(el).position;
    if(p === "static"){
      el.style.position = "fixed";
    }

    // 位置復元
    applyPos(el, loadPos(t.id));

    // ハンドル＆ドラッグ
    var handle = createHandle(el, t.id);
    makeDraggableByHandle(el, handle, t.id);

    return true;
  }

  function boot(){
    ensureToggleButton();

    // 初回
    for(var i=0;i<TARGETS.length;i++){
      initOneTarget(TARGETS[i]);
    }
    updateHandlesVisibility();

    // 遅延生成DOM対策：短時間だけポーリング（フォールバックじゃなく、単に「出現待ち」）
    var tries = 0;
    var timer = setInterval(function(){
      tries++;

      var allOk = true;
      for(var i=0;i<TARGETS.length;i++){
        var ok = initOneTarget(TARGETS[i]);
        if(!ok) allOk = false;
      }

      if(allOk || tries >= 40){
        clearInterval(timer);
      }
    }, 250);

    // 画面サイズが変わったら（回転/分割表示）そのenvKeyの保存位置を適用
    window.addEventListener("resize", function(){
      for(var i=0;i<TARGETS.length;i++){
        var t = TARGETS[i];
        var el = document.querySelector(t.sel);
        if(!el) continue;
        applyPos(el, loadPos(t.id));
      }
    }, { passive: true });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();