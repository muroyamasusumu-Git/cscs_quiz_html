(function(){
  "use strict";

  // ===== 対象（レイアウト編集対象） =====
  // 方針：similar-list と cscs-field-star-summary は編集対象から除外
  var TARGETS = [
    { sel: "#cscs_sync_monitor_a", id: "cscs_sync_monitor_a" },
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

  // ===== 追加：デフォルト位置（元のインラインstyle）を記憶＆復元 =====
  // 目的：
  //   - ドラッグで変更した位置を localStorage から消すだけだと、今表示中の要素がそのまま残ることがある。
  //   - 「デフォルトに戻す」は、初回に記憶した“元のstyle”へ確実に戻すのが一番安全。
  var ORIG_ATTR = "data-cscs-layout-orig-style";

  function rememberOrigStyleIfNeeded(el){
    // 目的：初回だけ、元のインラインstyle状態を保存する（後でRESETで戻すため）
    if(!el) return;
    if(el.getAttribute(ORIG_ATTR)) return;

    var orig = {
      position: el.style.position || "",
      left: el.style.left || "",
      top: el.style.top || "",
      right: el.style.right || "",
      bottom: el.style.bottom || "",
      zIndex: el.style.zIndex || ""
    };

    try{
      el.setAttribute(ORIG_ATTR, JSON.stringify(orig));
    }catch(_){}
  }

  function loadOrigStyle(el){
    try{
      var raw = el.getAttribute(ORIG_ATTR);
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj) return null;
      return obj;
    }catch(_){
      return null;
    }
  }

  function applyOrigStyle(el, orig){
    // 目的：RESET時に、記憶しておいた“元のstyle”へ戻す
    if(!el || !orig) return;
    el.style.position = orig.position;
    el.style.left = orig.left;
    el.style.top = orig.top;
    el.style.right = orig.right;
    el.style.bottom = orig.bottom;
    el.style.zIndex = orig.zIndex;
  }

  function clearSavedPos(layoutId){
    // 目的：localStorage に保存した位置情報を削除する（現在のenvKeyだけ）
    try{ localStorage.removeItem(storageKey(layoutId)); }catch(_){}
  }

  function resetAllPositionsToDefault(){
    // 目的：
    //   1) 全ターゲットの保存済み位置（localStorage）を削除
    //   2) 全ターゲットの表示中styleを “元のstyle” に戻す
    for(var i=0;i<TARGETS.length;i++){
      var t = TARGETS[i];
      clearSavedPos(t.id);

      var el = document.querySelector(t.sel);
      if(!el) continue;

      var orig = loadOrigStyle(el);
      if(orig){
        applyOrigStyle(el, orig);
      }else{
        // 元styleが無い場合は、最小限だけ戻す（壊さない方針）
        el.style.left = "";
        el.style.top = "";
        el.style.zIndex = "";
      }
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
    // 目的：
    //   - 最初は「LAYOUT」ボタンのみ表示
    //   - 押すと小さいウィンドウ（EDIT/LOCK/RESET）を出す
    //   - LAYOUTボタンは右下から80px左へ（right: 88px）
    var id = "cscs-layout-menu-toggle";
    var btn = document.getElementById(id);
    if(btn) return btn;

    // ===== LAYOUT ボタン（常時表示） =====
    btn = document.createElement("button");
    btn.id = id;
    btn.textContent = "LAYOUT";

    btn.style.position = "fixed";
    btn.style.right = "120px";
    btn.style.bottom = "10px";
    btn.style.zIndex = "999999";
    btn.style.fontSize = "11px";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "999px";
    btn.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    btn.style.background = "rgba(0, 0, 0, 0.55)";
    btn.style.color = "rgb(255, 255, 255)";
    btn.style.height = "34px";
    btn.style.webkitTapHighlightColor = "transparent";

    document.body.appendChild(btn);

    // ===== 小窓（EDIT/LOCK/RESET） =====
    var pid = "cscs-layout-menu-panel";
    var panel = document.getElementById(pid);
    if(!panel){
      panel = document.createElement("div");
      panel.id = pid;

      panel.style.position = "fixed";
      panel.style.right = "88px";
      panel.style.bottom = "44px";
      panel.style.zIndex = "999999";
      panel.style.display = "none";
      panel.style.padding = "8px";
      panel.style.borderRadius = "12px";
      panel.style.border = "1px solid rgba(255,255,255,0.18)";
      panel.style.background = "rgba(0,0,0,0.65)";
      panel.style.backdropFilter = "blur(6px)";
      panel.style.webkitBackdropFilter = "blur(6px)";
      panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
      panel.style.minWidth = "150px";

      // 行コンテナ
      var row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "6px";
      row.style.alignItems = "center";
      row.style.justifyContent = "flex-end";
      panel.appendChild(row);

      function makeMiniButton(text){
        var b = document.createElement("button");
        b.textContent = text;
        b.style.fontSize = "11px";
        b.style.padding = "6px 8px";
        b.style.borderRadius = "999px";
        b.style.border = "1px solid rgba(255,255,255,0.20)";
        b.style.background = "rgba(255,255,255,0.06)";
        b.style.color = "#fff";
        b.style.webkitTapHighlightColor = "transparent";
        return b;
      }

      // ===== LOCK / EDIT 切替 + 状態表示 =====
      var editWrap = document.createElement("div");
      editWrap.style.display = "flex";
      editWrap.style.alignItems = "center";
      editWrap.style.gap = "6px";

      var editBtn = makeMiniButton(getEditMode() ? "LOCK" : "EDIT");
      editBtn.id = "cscs-layout-menu-edit";

      var stateLabel = document.createElement("span");
      stateLabel.id = "cscs-layout-menu-state";
      stateLabel.style.fontSize = "11px";
      stateLabel.style.color = "rgba(255,255,255,0.75)";
      stateLabel.textContent = getEditMode()
        ? "：EDITモード中"
        : "：LOCKモード中";

      editBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        var on = !getEditMode();
        setEditMode(on);

        editBtn.textContent = on ? "LOCK" : "EDIT";
        stateLabel.textContent = on
          ? "：EDITモード中"
          : "：LOCKモード中";

        updateHandlesVisibility();
      });

      editWrap.appendChild(editBtn);
      editWrap.appendChild(stateLabel);

      // RESET ボタン
      var resetBtn = makeMiniButton("RESET");
      resetBtn.id = "cscs-layout-menu-reset";

      resetBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        resetAllPositionsToDefault();
        updateHandlesVisibility();

        panel.style.display = "none";
      });

      row.appendChild(editWrap);
      row.appendChild(resetBtn);

      document.body.appendChild(panel);
    }

    // ===== LAYOUTボタン押下で小窓の表示/非表示 =====
    btn.addEventListener("click", function(e){
      e.preventDefault();
      e.stopPropagation();

      var editBtn = document.getElementById("cscs-layout-menu-edit");
      if(editBtn){
        editBtn.textContent = getEditMode() ? "EDIT" : "LOCK";
      }

      panel.style.display = (panel.style.display === "none") ? "block" : "none";
    });

    // ===== 小窓以外を押したら閉じる =====
    window.addEventListener("pointerdown", function(e){
      var panelNow = document.getElementById("cscs-layout-menu-panel");
      var btnNow = document.getElementById("cscs-layout-menu-toggle");
      if(!panelNow || !btnNow) return;

      if(panelNow.style.display === "none") return;

      var t = e.target;
      if(panelNow.contains(t)) return;
      if(btnNow.contains(t)) return;

      panelNow.style.display = "none";
    }, { passive: true });

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

    // 追加：RESETのために“元のインラインstyle”を初回だけ記憶する
    // 目的：localStorage削除だけではなく、見た目も確実にデフォルトへ戻せるようにする
    rememberOrigStyleIfNeeded(el);

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