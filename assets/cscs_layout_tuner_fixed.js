/** // assets/cscs_layout_tuner_fixed.js
 * CSCS Layout Editor (Fixed Targets) — 画面内パネルの位置をGUIで調整・保存するためのユーティリティ
 *
 * 【目的】
 *   - 指定した「固定表示パネル」(TARGETS) の位置を、ユーザー操作で微調整できるようにする。
 *   - 調整した位置は localStorage に保存され、次回以降も同じ画面サイズ(envKey)で復元される。
 *   - いつでも「RESET」で “元のインラインstyle” に戻せる（localStorage削除＋表示中style復元）。
 *
 * 【対象要素（編集できるもの）】
 *   - TARGETS 配列に列挙した 3つだけ：
 *       #cscs_sync_monitor_a
 *       #nl-daily-summary-host
 *       #nl-panel
 *   - similar-list / cscs-field-star-summary は “意図的に除外” 済み。
 *
 * 【UI概要】
 *   - 右下に常時「LAYOUT」ボタン（#cscs-layout-menu-toggle）を表示。
 *   - 押すと小窓（#cscs-layout-menu-panel）が開き、
 *       1) LOCK / EDIT 切替（状態ラベル付き）
 *       2) RESET（全ターゲットをデフォルトへ）
 *       3) 対象選択（select）
 *       4) X/Y スライダーで移動（現在値表示）
 *       5) ±1 微調整ボタン（長押しで連続移動：pointerdown中だけ連打）
 *     を操作できる。
 *
 * 【操作モード】
 *   - EDITモード(localStorage: cscs_layout_edit_on=1) のときだけ編集を許可：
 *       - ドラッグ用ハンドル（.cscs-layout-handle）の表示
 *       - スライダー移動
 *       - ±1（長押し連打含む）
 *   - LOCKモードでは表示位置の変更は行わない（見るだけ）。
 *
 * 【保存仕様】
 *   - 保存キー:  cscs_layout_v1_fixed_targets:{envKey}:{layoutId}
 *   - envKey は "幅x高さ"（例: "430x932"）で、端末回転や分割表示ごとに別保存。
 *   - 保存値: { left:number, top:number, z:number|null }
 *
 * 【RESET仕様（重要）】
 *   - 初回初期化時に、各要素の “元のインラインstyle” を data 属性に記録：
 *       data-cscs-layout-orig-style = {"position","left","top","right","bottom","zIndex"}
 *   - RESET は
 *       (1) 現在envKeyの localStorage 保存位置を削除
 *       (2) 表示中要素の style を元の値へ戻す
 *     を行う。
 *
 * 【ドラッグ仕様】
 *   - 各ターゲット要素の右上に「≡」ハンドルを追加し、EDIT時のみ表示。
 *   - pointerdown→move→up で位置を fixed の left/top に反映し、最後に保存する。
 *
 * 【±1 長押し連打の安全柵】
 *   - ボタン外で指を離した場合も止まるように、
 *       window.pointerup / blur / pagehide
 *     で stopHold() を呼んで暴走を防止。
 */
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
  var __effectId = "cscs_layout_tuner_fixed"; // ← このJS固有のIDにする
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

  // ===== 追加：個別セーブ（プリセット） =====
  // 目的：
  //   - 「RESETで全部戻る」のではなく、選択中だけ戻す／自分の基準位置に戻す を可能にする
  //   - プリセットは envKey ごと（画面サイズごと）に保持する
  var PRESET_NS = "cscs_layout_v1_fixed_targets_preset";

  function presetKey(layoutId){
    return PRESET_NS + ":" + envKey() + ":" + layoutId;
  }

  function savePreset(layoutId, pos){
    try{ localStorage.setItem(presetKey(layoutId), JSON.stringify(pos)); }catch(_){}
  }

  // ===== 追加：固定ON/OFF（要素ごと） =====
  // 目的：
  //   - ターゲットごとに「固定（EDIT/LOCK管理対象）」と「固定解除（管理外）」を切替可能にする
  //   - 固定ONのときは EDIT/LOCK中に位置＋W/Hを固定してレイアウト揺れを防ぐ
  //   - 固定OFFのときは元のインラインstyleへ戻し、このツールの管理外にする
  var ENABLE_NS = "cscs_layout_v1_fixed_targets_enabled";

  function enabledKey(layoutId){
    return ENABLE_NS + ":" + envKey() + ":" + layoutId;
  }

  function isTargetEnabled(layoutId){
    try{
      var v = localStorage.getItem(enabledKey(layoutId));
      if(v === null || v === "") return true; // 既定：固定ON
      return v === "1";
    }catch(_){
      return true; // localStorage不可でも既定は固定ON（壊さない方針）
    }
  }

  function setTargetEnabled(layoutId, on){
    try{
      localStorage.setItem(enabledKey(layoutId), on ? "1" : "0");
    }catch(_){}
  }

  function enableTargetFixed(layoutId){
    // 追加した処理:
    // - 固定ONにした瞬間の見た目を「そのまま凍結」できるようにする
    // - 保存位置が無ければ、現在rectから pos を作って保存し、applyPosで固定運用へ入れる
    var el = null;
    for(var i=0;i<TARGETS.length;i++){
      if(TARGETS[i].id === layoutId){
        el = document.querySelector(TARGETS[i].sel);
        break;
      }
    }
    if(!el) return;

    rememberOrigStyleIfNeeded(el);
    setTargetEnabled(layoutId, true);

    var pos = loadPos(layoutId);
    if(!pos){
      var rect = el.getBoundingClientRect();
      pos = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        z: el.style.zIndex ? parseInt(el.style.zIndex, 10) : null
      };
      savePos(layoutId, pos);
    }

    applyPos(el, pos);
  }

  function disableTargetFixed(layoutId){
    // 追加した処理:
    // - 固定解除は「元のインラインstyle」へ戻して管理外にする（フォールバックで埋めない）
    var el = null;
    for(var i=0;i<TARGETS.length;i++){
      if(TARGETS[i].id === layoutId){
        el = document.querySelector(TARGETS[i].sel);
        break;
      }
    }
    if(!el) return;

    setTargetEnabled(layoutId, false);

    var orig = loadOrigStyle(el);
    if(orig){
      applyOrigStyle(el, orig);
      return;
    }

    // 元styleが無い場合は、最小限だけ解除（壊さない方針）
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.right = "";
    el.style.bottom = "";
    el.style.width = "";
    el.style.height = "";
    el.style.zIndex = "";
  }

  function loadPreset(layoutId){
    try{
      var raw = localStorage.getItem(presetKey(layoutId));
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj) return null;
      if(typeof obj.left !== "number") return null;
      if(typeof obj.top !== "number") return null;

      // 追加した処理:
      // - width/height は「無くてもOK」にする（旧データ互換）
      if(obj.width != null && typeof obj.width !== "number") obj.width = null;
      if(obj.height != null && typeof obj.height !== "number") obj.height = null;

      return obj;
    }catch(_){
      return null;
    }
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

      // 追加した処理:
      // - width/height は「無くてもOK」にする（旧データ互換）
      if(obj.width != null && typeof obj.width !== "number") obj.width = null;
      if(obj.height != null && typeof obj.height !== "number") obj.height = null;

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
      width: el.style.width || "",
      height: el.style.height || "",
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
    el.style.width = orig.width;
    el.style.height = orig.height;
    el.style.zIndex = orig.zIndex;
  }

  function clearSavedPos(layoutId){
    // 目的：localStorage に保存した位置情報を削除する（現在のenvKeyだけ）
    try{ localStorage.removeItem(storageKey(layoutId)); }catch(_){}
  }

  function resetOnePositionToDefault(layoutId){
    // 目的：
    //   - 「選択中だけRESET」を実現する
    //   - まずは保存済み位置（通常の作業位置）だけ削除する
    //   - 戻し先は「プリセットがあればプリセット」「なければ元のインラインstyle」
    clearSavedPos(layoutId);

    var el = null;
    for(var i=0;i<TARGETS.length;i++){
      if(TARGETS[i].id === layoutId){
        el = document.querySelector(TARGETS[i].sel);
        break;
      }
    }
    if(!el) return;

    var preset = loadPreset(layoutId);
    if(preset){
      applyPos(el, preset);
      return;
    }

    var orig = loadOrigStyle(el);
    if(orig){
      applyOrigStyle(el, orig);
      return;
    }

    // 元styleが無い場合は、最小限だけ戻す（壊さない方針）
    // 追加した処理:
    // - width/height もクリアして、AUTO相当（CSS本来のサイズ）に戻せるようにする
    el.style.left = "";
    el.style.top = "";
    el.style.width = "";
    el.style.height = "";
    el.style.zIndex = "";
  }

  function resetAllPositionsToDefault(){
    // 目的：
    //   - 従来どおり「全ターゲットRESET」も残す
    //   - ただし各ターゲットは「プリセットがあればプリセット」に戻す（個別セーブを活かす）
    for(var i=0;i<TARGETS.length;i++){
      resetOnePositionToDefault(TARGETS[i].id);
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

    // 追加した処理:
    // - right/bottom が残っていると left/top と競合して「初回ジャンプ」の原因になるため、
    //   left/top 運用へ入る瞬間に right/bottom を必ず解除する
    el.style.right = "";
    el.style.bottom = "";

    el.style.position = "fixed";
    el.style.left = pos.left + "px";
    el.style.top  = pos.top  + "px";

    // 追加した処理:
    // - width/height を保存している場合は適用（横/縦に広げる）
    // - 未指定（null/undefined）の場合は触らず、明示的に空へ戻したい時は "" を入れる設計にする
    if(pos.width != null) el.style.width = Math.round(pos.width) + "px";
    if(pos.height != null) el.style.height = Math.round(pos.height) + "px";

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

      function makeMiniLabel(text){
        var s = document.createElement("span");
        s.textContent = text;
        s.style.fontSize = "11px";
        s.style.color = "rgba(255,255,255,0.80)";
        return s;
      }

      function makeValueText(){
        var s = document.createElement("span");
        s.style.fontSize = "11px";
        s.style.color = "rgba(255,255,255,0.70)";
        s.style.minWidth = "44px";
        s.style.textAlign = "right";
        s.textContent = "0";
        return s;
      }

      function makeRange(){
        var r = document.createElement("input");
        r.type = "range";
        r.min = "0";
        r.max = "0";
        r.step = "1";
        r.value = "0";
        r.style.width = "140px";
        r.style.height = "18px";
        r.style.opacity = "0.95";
        return r;
      }

      function getDefaultSelectedId(){
        return TARGETS[0] ? TARGETS[0].id : "";
      }

      function getSelectedId(){
        try{
          var v = localStorage.getItem("cscs_layout_selected_target_id");
          if(!v) return getDefaultSelectedId();
          return v;
        }catch(_){
          return getDefaultSelectedId();
        }
      }

      function setSelectedId(id){
        try{ localStorage.setItem("cscs_layout_selected_target_id", id); }catch(_){}
      }

      function getTargetById(id){
        for(var i=0;i<TARGETS.length;i++){
          if(TARGETS[i].id === id) return TARGETS[i];
        }
        return null;
      }

      function getElById(id){
        var t = getTargetById(id);
        if(!t) return null;
        return document.querySelector(t.sel);
      }

      function setRangeEnabled(enabled){
        var sel = document.getElementById("cscs-layout-target-select");
        var x = document.getElementById("cscs-layout-x-slider");
        var y = document.getElementById("cscs-layout-y-slider");
        var w = document.getElementById("cscs-layout-w-slider");
        var h = document.getElementById("cscs-layout-h-slider");
        if(sel) sel.disabled = !enabled;
        if(x) x.disabled = !enabled;
        if(y) y.disabled = !enabled;
        if(w) w.disabled = !enabled;
        if(h) h.disabled = !enabled;
      }

      function clampInt(n, min, max){
        n = Math.round(n);
        if(n < min) return min;
        if(n > max) return max;
        return n;
      }

      function updateRangesForEl(el){
        var x = document.getElementById("cscs-layout-x-slider");
        var y = document.getElementById("cscs-layout-y-slider");
        var w = document.getElementById("cscs-layout-w-slider");
        var h = document.getElementById("cscs-layout-h-slider");
        if(!x || !y) return;

        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var rect = el.getBoundingClientRect();

        var maxX = Math.max(0, Math.floor(vw - rect.width));
        var maxY = Math.max(0, Math.floor(vh - rect.height));

        x.min = "0";
        x.max = String(maxX);
        x.step = "1";

        y.min = "0";
        y.max = String(maxY);
        y.step = "1";

        // 追加した処理:
        // - 幅/高さの上限は「いまの left/top を起点に、画面内に収まる最大値」にする
        //   例: width は vw - rect.left、height は vh - rect.top
        if(w){
          var minW = 80;
          var maxW = Math.max(minW, Math.floor(vw - rect.left));
          w.min = String(minW);
          w.max = String(maxW);
          w.step = "1";
        }
        if(h){
          var minH = 80;
          var maxH = Math.max(minH, Math.floor(vh - rect.top));
          h.min = String(minH);
          h.max = String(maxH);
          h.step = "1";
        }
      }

      function syncSlidersFromEl(el){
        var x = document.getElementById("cscs-layout-x-slider");
        var y = document.getElementById("cscs-layout-y-slider");
        var w = document.getElementById("cscs-layout-w-slider");
        var h = document.getElementById("cscs-layout-h-slider");

        var xv = document.getElementById("cscs-layout-x-value");
        var yv = document.getElementById("cscs-layout-y-value");
        var wv = document.getElementById("cscs-layout-w-value");
        var hv = document.getElementById("cscs-layout-h-value");

        if(!x || !y || !xv || !yv) return;

        var rect = el.getBoundingClientRect();

        updateRangesForEl(el);

        var maxX = parseInt(x.max, 10) || 0;
        var maxY = parseInt(y.max, 10) || 0;

        var left = clampInt(rect.left, 0, maxX);
        var top  = clampInt(rect.top,  0, maxY);

        x.value = String(left);
        y.value = String(top);

        xv.textContent = String(left);
        yv.textContent = String(top);

        // 追加した処理:
        // - 幅/高さもスライダーに反映
        if(w && wv){
          var maxW = parseInt(w.max, 10) || 80;
          var ww = clampInt(rect.width, parseInt(w.min, 10) || 80, maxW);
          w.value = String(ww);
          wv.textContent = String(ww);
        }
        if(h && hv){
          var maxH = parseInt(h.max, 10) || 80;
          var hh = clampInt(rect.height, parseInt(h.min, 10) || 80, maxH);
          h.value = String(hh);
          hv.textContent = String(hh);
        }
      }

      function lockActionButtonsDuringResize(ms){
        // 追加した処理:
        // - W/H変更中（スライダー操作中・連打中）は誤タップが起きやすいので
        //   SAVE/AUTO を短時間だけ disabled + 半透明にする
        // - 連続で呼ばれても「最後の呼び出し」だけが復帰タイミングになるようタイマーを上書きする
        var saveBtn = document.getElementById("cscs-layout-menu-save");
        var autoBtn = document.getElementById("cscs-layout-menu-auto");
        var dur = (typeof ms === "number" && ms > 0) ? ms : 250;

        function lockOne(btn){
          if(!btn) return;
          try{
            btn.disabled = true;
            btn.style.opacity = "0.55";

            if(btn.__cscsTempLockTimer){
              clearTimeout(btn.__cscsTempLockTimer);
              btn.__cscsTempLockTimer = 0;
            }

            btn.__cscsTempLockTimer = setTimeout(function(){
              btn.disabled = false;
              btn.style.opacity = "1";
              btn.__cscsTempLockTimer = 0;
            }, dur);
          }catch(_eLock){
          }
        }

        lockOne(saveBtn);
        lockOne(autoBtn);
      }

      function applyFromSliders(){
        var id = getSelectedId();
        var el = getElById(id);
        if(!el) return;

        var x = document.getElementById("cscs-layout-x-slider");
        var y = document.getElementById("cscs-layout-y-slider");
        var w = document.getElementById("cscs-layout-w-slider");
        var h = document.getElementById("cscs-layout-h-slider");

        var xv = document.getElementById("cscs-layout-x-value");
        var yv = document.getElementById("cscs-layout-y-value");
        var wv = document.getElementById("cscs-layout-w-value");
        var hv = document.getElementById("cscs-layout-h-value");

        if(!x || !y || !xv || !yv) return;

        updateRangesForEl(el);

        var maxX = parseInt(x.max, 10) || 0;
        var maxY = parseInt(y.max, 10) || 0;

        var left = clampInt(parseInt(x.value, 10) || 0, 0, maxX);
        var top  = clampInt(parseInt(y.value, 10) || 0, 0, maxY);

        // 追加した処理:
        // - right/bottom が残っていると left/top と競合してレイアウトが跳ねることがあるため、
        //   スライダーで left/top 運用に入るタイミングで right/bottom を解除する
        el.style.right = "";
        el.style.bottom = "";

        el.style.position = "fixed";
        el.style.left = left + "px";
        el.style.top = top + "px";

        xv.textContent = String(left);
        yv.textContent = String(top);

        // 追加した処理:
        // - 幅/高さも反映（横/縦に広げられる）
        // - W/Hを触っている最中だけ、誤タップ防止で SAVE/AUTO を短時間ロックする
        var widthVal = null;
        var heightVal = null;
        var touchedWH = false;

        if(w && wv){
          var minW = parseInt(w.min, 10) || 80;
          var maxW = parseInt(w.max, 10) || minW;
          widthVal = clampInt(parseInt(w.value, 10) || minW, minW, maxW);
          w.value = String(widthVal);
          wv.textContent = String(widthVal);
          el.style.width = widthVal + "px";
          touchedWH = true;
        }

        if(h && hv){
          var minH = parseInt(h.min, 10) || 80;
          var maxH = parseInt(h.max, 10) || minH;
          heightVal = clampInt(parseInt(h.value, 10) || minH, minH, maxH);
          h.value = String(heightVal);
          hv.textContent = String(heightVal);
          el.style.height = heightVal + "px";
          touchedWH = true;
        }

        if(touchedWH){
          lockActionButtonsDuringResize(250);
        }

        savePos(id, {
          left: left,
          top: top,
          width: widthVal,
          height: heightVal,
          z: el.style.zIndex ? parseInt(el.style.zIndex, 10) : null
        });
      }

      function nudgeAxis(axis, delta){
        if(!getEditMode()) return;

        var id = getSelectedId();
        var el = getElById(id);
        if(!el) return;

        var x = document.getElementById("cscs-layout-x-slider");
        var y = document.getElementById("cscs-layout-y-slider");
        var w = document.getElementById("cscs-layout-w-slider");
        var h = document.getElementById("cscs-layout-h-slider");
        if(!x || !y) return;

        updateRangesForEl(el);

        if(axis === "x"){
          var maxX = parseInt(x.max, 10) || 0;
          var curX = parseInt(x.value, 10) || 0;
          var nextX = clampInt(curX + delta, 0, maxX);
          x.value = String(nextX);
          applyFromSliders();
          return;
        }

        if(axis === "y"){
          var maxY = parseInt(y.max, 10) || 0;
          var curY = parseInt(y.value, 10) || 0;
          var nextY = clampInt(curY + delta, 0, maxY);
          y.value = String(nextY);
          applyFromSliders();
          return;
        }

        // 追加した処理:
        // - width/height の ±1 も可能にする
        if(axis === "w" && w){
          var minW = parseInt(w.min, 10) || 80;
          var maxW = parseInt(w.max, 10) || minW;
          var curW = parseInt(w.value, 10) || minW;
          var nextW = clampInt(curW + delta, minW, maxW);
          w.value = String(nextW);
          applyFromSliders();
          return;
        }

        if(axis === "h" && h){
          var minH = parseInt(h.min, 10) || 80;
          var maxH = parseInt(h.max, 10) || minH;
          var curH = parseInt(h.value, 10) || minH;
          var nextH = clampInt(curH + delta, minH, maxH);
          h.value = String(nextH);
          applyFromSliders();
          return;
        }
      }

      function installHoldRepeat(btn, axis, delta){
        if(!btn) return;
        if(btn.getAttribute("data-cscs-hold-repeat") === "1") return;
        btn.setAttribute("data-cscs-hold-repeat", "1");

        var holdTimer = 0;
        var repeatTimer = 0;
        var holding = false;

        function clearTimers(){
          if(holdTimer){
            clearTimeout(holdTimer);
            holdTimer = 0;
          }
          if(repeatTimer){
            clearInterval(repeatTimer);
            repeatTimer = 0;
          }
        }

        function stopHold(){
          holding = false;
          clearTimers();
          try{ btn.releasePointerCapture && btn.releasePointerCapture(btn.__cscsHoldPid); }catch(_){}
          btn.__cscsHoldPid = null;
        }

        function startHold(e){
          if(!getEditMode()) return;

          holding = true;
          btn.__cscsHoldPid = e.pointerId;

          try{ btn.setPointerCapture && btn.setPointerCapture(e.pointerId); }catch(_){}

          // まず1回は即時反映（タップでも効く）
          nudgeAxis(axis, delta);

          // 長押し判定後に連打開始
          holdTimer = setTimeout(function(){
            if(!holding) return;
            repeatTimer = setInterval(function(){
              if(!holding) return;
              nudgeAxis(axis, delta);
            }, 40);
          }, 250);

          e.preventDefault();
          e.stopPropagation();
        }

        function onPointerDown(e){
          startHold(e);
        }

        function onPointerUp(e){
          stopHold();
          e.preventDefault();
          e.stopPropagation();
        }

        function onPointerCancel(e){
          stopHold();
          e.preventDefault();
          e.stopPropagation();
        }

        function onPointerLeave(e){
          // 押したまま指が外に出たら止める（意図せぬ暴走防止）
          stopHold();
          e.preventDefault();
          e.stopPropagation();
        }

        btn.addEventListener("pointerdown", onPointerDown, { passive: false });
        btn.addEventListener("pointerup", onPointerUp, { passive: false });
        btn.addEventListener("pointercancel", onPointerCancel, { passive: false });
        btn.addEventListener("pointerleave", onPointerLeave, { passive: false });

        // iOS対策：コンテキストメニュー等で暴走しないよう保険
        window.addEventListener("blur", stopHold, { passive: true });
        window.addEventListener("pagehide", stopHold, { passive: true });

        // 追加保険：ボタン外で指を離した場合でも必ず停止させる
        window.addEventListener("pointerup", stopHold, { passive: true });
      }

      function refreshLayoutPanelUI(){
        var editBtn = document.getElementById("cscs-layout-menu-edit");
        var stateLabel = document.getElementById("cscs-layout-menu-state");
        if(editBtn){
          editBtn.textContent = getEditMode() ? "LOCK" : "EDIT";
        }
        if(stateLabel){
          stateLabel.textContent = getEditMode()
            ? "：EDITモード中"
            : "：LOCKモード中";
        }

        var sel = document.getElementById("cscs-layout-target-select");
        if(sel){
          sel.value = getSelectedId();
        }

        // 追加した処理:
        // - 固定OFF（管理外）の要素は、EDITモードでもスライダー操作不可にする
        var __id = getSelectedId();
        var el = getElById(__id);
        var enabled = isTargetEnabled(__id);

        var pinBtn = document.getElementById("cscs-layout-menu-pin");
        if(pinBtn){
          pinBtn.textContent = enabled ? "FREE" : "FIX";
        }

        // 追加した処理:
        // - 固定OFF（FREE）にした瞬間に誤操作ゼロにするため、
        //   SAVE/AUTO/RESET を disabled + 半透明 にする（RESET ALLは残す）
        function guardBtn(btn, ok){
          if(!btn) return;
          try{
            btn.disabled = !ok;
            btn.style.opacity = ok ? "1" : "0.45";
          }catch(_eGuard){
          }
        }

        var saveBtn = document.getElementById("cscs-layout-menu-save");
        var autoBtn = document.getElementById("cscs-layout-menu-auto");
        var resetBtn = document.getElementById("cscs-layout-menu-reset");
        var resetAllBtn = document.getElementById("cscs-layout-menu-reset-all");

        var okActions = !!el && enabled;
        guardBtn(saveBtn, okActions);
        guardBtn(autoBtn, okActions);
        guardBtn(resetBtn, okActions);
        guardBtn(resetAllBtn, true);

        if(el && getEditMode() && enabled){
          setRangeEnabled(true);
          syncSlidersFromEl(el);
        }else{
          setRangeEnabled(false);
        }
      }

      panel.__refreshLayoutPanelUI = refreshLayoutPanelUI;

      // ===== レイアウト小窓 UI（縦積み） =====
      var col = document.createElement("div");
      col.style.display = "flex";
      col.style.flexDirection = "column";
      col.style.gap = "8px";
      panel.appendChild(col);

      // (1) EDIT/LOCK + RESET 行
      var rowTop = document.createElement("div");
      rowTop.style.display = "flex";
      rowTop.style.gap = "6px";
      rowTop.style.alignItems = "center";
      rowTop.style.justifyContent = "flex-end";
      col.appendChild(rowTop);

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
        refreshLayoutPanelUI();
      });

      editWrap.appendChild(editBtn);
      editWrap.appendChild(stateLabel);

      // ===== 追加：SAVE（選択中）=====
      // 目的：
      //   - 「この位置を基準にしたい」を個別に保存できるようにする
      //   - 以後、RESET（選択中）はこのプリセットへ戻る
      var saveBtn = makeMiniButton("SAVE");
      saveBtn.id = "cscs-layout-menu-save";

      saveBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        var __id = getSelectedId();
        var __el = getElById(__id);
        if(!__el) return;

        var __rect = __el.getBoundingClientRect();
        savePreset(__id, {
          left: Math.round(__rect.left),
          top: Math.round(__rect.top),
          width: Math.round(__rect.width),
          height: Math.round(__rect.height),
          z: __el.style.zIndex ? parseInt(__el.style.zIndex, 10) : null
        });

        // 追加した処理:
        // - 保存後、スライダー表示も現在値に同期しておく
        syncSlidersFromEl(__el);

        // 追加した処理:
        // - SAVEしたことが分かるように、ボタン文言を一瞬だけ "SAVED" にする（1秒）
        // - SAVED中は「半透明」＋「押せない（disabled）」にして、誤連打を防ぐ
        // - 多重クリックでも最終状態が必ず "SAVE" に戻るよう、タイマーを上書き管理する
        try{
          var __origText = "SAVE";

          saveBtn.textContent = "SAVED";
          saveBtn.disabled = true;
          saveBtn.style.opacity = "0.55";

          if(saveBtn.__cscsSavedTimer){
            clearTimeout(saveBtn.__cscsSavedTimer);
            saveBtn.__cscsSavedTimer = 0;
          }

          saveBtn.__cscsSavedTimer = setTimeout(function(){
            saveBtn.textContent = __origText;
            saveBtn.disabled = false;
            saveBtn.style.opacity = "1";
            saveBtn.__cscsSavedTimer = 0;
          }, 1000);
        }catch(_eSaved){
        }
      });

      // ===== 変更：RESET（選択中）=====
      // 目的：
      //   - 全体ではなく「選択中ターゲットだけ」を戻す
      //   - 戻し先は「プリセット優先」→無ければ「元のインラインstyle」
      var resetBtn = makeMiniButton("RESET");
      resetBtn.id = "cscs-layout-menu-reset";

      resetBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        var __id = getSelectedId();

        // (1) 選択中だけデフォルトへ戻す（作業位置削除＋プリセット/元style復元）
        resetOnePositionToDefault(__id);

        // (2) ドラッグハンドル表示を現在モードに同期
        updateHandlesVisibility();

        // (3) スライダー値も「戻した現在位置」に同期
        var __el = getElById(__id);
        if(__el){
          syncSlidersFromEl(__el);
        }else{
          var __x = document.getElementById("cscs-layout-x-slider");
          var __y = document.getElementById("cscs-layout-y-slider");
          var __xv = document.getElementById("cscs-layout-x-value");
          var __yv = document.getElementById("cscs-layout-y-value");
          if(__x) __x.value = "0";
          if(__y) __y.value = "0";
          if(__xv) __xv.textContent = "0";
          if(__yv) __yv.textContent = "0";
        }

        // (4) パネルUI全体も再同期（EDIT/LOCK表示、disabled状態など）
        refreshLayoutPanelUI();

        // 重要：RESETしてもウィンドウは閉じない（作業継続のため）
        // panel.style.display = "none";
      });

      // ===== 追加：RESET ALL =====
      // 目的：
      //   - 従来どおり「全部戻す」も残す（ただし各ターゲットはプリセット優先で復元）
      var resetAllBtn = makeMiniButton("RESET ALL");
      resetAllBtn.id = "cscs-layout-menu-reset-all";

      resetAllBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        // (1) 全ターゲットを戻す（プリセット優先）
        resetAllPositionsToDefault();

        // (2) ドラッグハンドル表示を現在モードに同期
        updateHandlesVisibility();

        // (3) 選択中ターゲットのスライダー値を同期
        var __id = getSelectedId();
        var __el = getElById(__id);
        if(__el){
          syncSlidersFromEl(__el);
        }

        // (4) パネルUI全体も再同期
        refreshLayoutPanelUI();

        // 重要：RESETしてもウィンドウは閉じない（作業継続のため）
        // panel.style.display = "none";
      });

      // ===== 追加：AUTO（選択中 / width&height クリア）=====
      // 目的：
      //   - 選択中ターゲットの width/height を "" に戻して「CSS本来のサイズ」に戻す
      //   - 位置(left/top)は維持しつつ、保存値 width/height は null として更新する
      //   - 変更後はスライダー表示も現在値に同期する
      var autoBtn = makeMiniButton("AUTO");
      autoBtn.id = "cscs-layout-menu-auto";

      autoBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        var __id = getSelectedId();
        var __el = getElById(__id);
        if(!__el) return;

        var __rectBefore = __el.getBoundingClientRect();

        // 追加した処理:
        // - インラインwidth/heightをクリアしてCSS本来へ戻す
        __el.style.width = "";
        __el.style.height = "";

        // 追加した処理:
        // - left/top は今のまま維持（サイズだけ戻す）
        // - 保存値として width/height は null にする（次回 applyPos で触らない）
        savePos(__id, {
          left: Math.round(__rectBefore.left),
          top: Math.round(__rectBefore.top),
          width: null,
          height: null,
          z: __el.style.zIndex ? parseInt(__el.style.zIndex, 10) : null
        });

        // 追加した処理:
        // - UIを現在値に同期（AUTO後のrectに合わせる）
        syncSlidersFromEl(__el);
      });

      rowTop.appendChild(editWrap);
      rowTop.appendChild(saveBtn);
      rowTop.appendChild(autoBtn);
      rowTop.appendChild(resetBtn);
      rowTop.appendChild(resetAllBtn);

      // (2) 対象選択
      var rowSel = document.createElement("div");
      rowSel.style.display = "flex";
      rowSel.style.alignItems = "center";
      rowSel.style.justifyContent = "space-between";
      rowSel.style.gap = "8px";
      col.appendChild(rowSel);

      var selLabel = makeMiniLabel("対象");
      rowSel.appendChild(selLabel);

      var sel = document.createElement("select");
      sel.id = "cscs-layout-target-select";
      sel.style.fontSize = "11px";
      sel.style.padding = "6px 8px";
      sel.style.borderRadius = "10px";
      sel.style.border = "1px solid rgba(255,255,255,0.18)";
      sel.style.background = "rgba(255,255,255,0.06)";
      sel.style.color = "#fff";
      sel.style.minWidth = "190px";
      sel.style.webkitTapHighlightColor = "transparent";

      for(var i=0;i<TARGETS.length;i++){
        var opt = document.createElement("option");
        opt.value = TARGETS[i].id;
        opt.textContent = TARGETS[i].id;
        sel.appendChild(opt);
      }

      sel.value = getSelectedId();

      sel.addEventListener("change", function(e){
        e.preventDefault();
        e.stopPropagation();

        setSelectedId(sel.value);

        var el = getElById(getSelectedId());
        if(el && getEditMode()){
          syncSlidersFromEl(el);
        }
      });

      rowSel.appendChild(sel);

      // ===== 追加：FIX/FREE（固定ON/OFF） =====
      // 目的：
      //   - 選択中ターゲットを「固定（EDIT/LOCK管理対象）」⇄「固定解除（管理外）」で切替できるようにする
      //   - 固定ONに戻すときは、現在見えている位置＋サイズを保存して即固定化できるようにする
      var pinBtn = makeMiniButton(isTargetEnabled(getSelectedId()) ? "FREE" : "FIX");
      pinBtn.id = "cscs-layout-menu-pin";

      pinBtn.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();

        var __id = getSelectedId();
        var __el = getElById(__id);
        if(!__el) return;

        var nowEnabled = isTargetEnabled(__id);

        if(nowEnabled){
          disableTargetFixed(__id);
        }else{
          enableTargetFixed(__id);
        }

        updateHandlesVisibility();
        refreshLayoutPanelUI();
      });

      rowSel.appendChild(pinBtn);

      // (3) Xスライダー
      var rowX = document.createElement("div");
      rowX.style.display = "flex";
      rowX.style.alignItems = "center";
      rowX.style.gap = "8px";
      rowX.style.justifyContent = "space-between";
      col.appendChild(rowX);

      var xLeft = document.createElement("div");
      xLeft.style.display = "flex";
      xLeft.style.alignItems = "center";
      xLeft.style.gap = "8px";
      rowX.appendChild(xLeft);

      xLeft.appendChild(makeMiniLabel("X"));

      var xMinus = makeMiniButton("-1");
      xMinus.id = "cscs-layout-x-minus";
      xMinus.style.padding = "6px 10px";
      installHoldRepeat(xMinus, "x", -1);
      xLeft.appendChild(xMinus);

      var xSlider = makeRange();
      xSlider.id = "cscs-layout-x-slider";
      xLeft.appendChild(xSlider);

      var xPlus = makeMiniButton("+1");
      xPlus.id = "cscs-layout-x-plus";
      xPlus.style.padding = "6px 10px";
      installHoldRepeat(xPlus, "x", +1);
      xLeft.appendChild(xPlus);

      var xValue = makeValueText();
      xValue.id = "cscs-layout-x-value";
      rowX.appendChild(xValue);

      xSlider.addEventListener("input", function(e){
        e.preventDefault();
        e.stopPropagation();
        applyFromSliders();
      });

      // (4) Yスライダー
      var rowY = document.createElement("div");
      rowY.style.display = "flex";
      rowY.style.alignItems = "center";
      rowY.style.gap = "8px";
      rowY.style.justifyContent = "space-between";
      col.appendChild(rowY);

      var yLeft = document.createElement("div");
      yLeft.style.display = "flex";
      yLeft.style.alignItems = "center";
      yLeft.style.gap = "8px";
      rowY.appendChild(yLeft);

      yLeft.appendChild(makeMiniLabel("Y"));

      var yMinus = makeMiniButton("-1");
      yMinus.id = "cscs-layout-y-minus";
      yMinus.style.padding = "6px 10px";
      installHoldRepeat(yMinus, "y", -1);
      yLeft.appendChild(yMinus);

      var ySlider = makeRange();
      ySlider.id = "cscs-layout-y-slider";
      yLeft.appendChild(ySlider);

      var yPlus = makeMiniButton("+1");
      yPlus.id = "cscs-layout-y-plus";
      yPlus.style.padding = "6px 10px";
      installHoldRepeat(yPlus, "y", +1);
      yLeft.appendChild(yPlus);

      var yValue = makeValueText();
      yValue.id = "cscs-layout-y-value";
      rowY.appendChild(yValue);

      ySlider.addEventListener("input", function(e){
        e.preventDefault();
        e.stopPropagation();
        applyFromSliders();
      });

      // (5) Wスライダー（幅）
      var rowW = document.createElement("div");
      rowW.style.display = "flex";
      rowW.style.alignItems = "center";
      rowW.style.gap = "8px";
      rowW.style.justifyContent = "space-between";
      col.appendChild(rowW);

      var wLeft = document.createElement("div");
      wLeft.style.display = "flex";
      wLeft.style.alignItems = "center";
      wLeft.style.gap = "8px";
      rowW.appendChild(wLeft);

      wLeft.appendChild(makeMiniLabel("W"));

      var wMinus = makeMiniButton("-1");
      wMinus.id = "cscs-layout-w-minus";
      wMinus.style.padding = "6px 10px";
      installHoldRepeat(wMinus, "w", -1);
      wLeft.appendChild(wMinus);

      var wSlider = makeRange();
      wSlider.id = "cscs-layout-w-slider";
      wLeft.appendChild(wSlider);

      var wPlus = makeMiniButton("+1");
      wPlus.id = "cscs-layout-w-plus";
      wPlus.style.padding = "6px 10px";
      installHoldRepeat(wPlus, "w", +1);
      wLeft.appendChild(wPlus);

      var wValue = makeValueText();
      wValue.id = "cscs-layout-w-value";
      rowW.appendChild(wValue);

      wSlider.addEventListener("input", function(e){
        e.preventDefault();
        e.stopPropagation();
        applyFromSliders();
      });

      // (6) Hスライダー（高さ）
      var rowH = document.createElement("div");
      rowH.style.display = "flex";
      rowH.style.alignItems = "center";
      rowH.style.gap = "8px";
      rowH.style.justifyContent = "space-between";
      col.appendChild(rowH);

      var hLeft = document.createElement("div");
      hLeft.style.display = "flex";
      hLeft.style.alignItems = "center";
      hLeft.style.gap = "8px";
      rowH.appendChild(hLeft);

      hLeft.appendChild(makeMiniLabel("H"));

      var hMinus = makeMiniButton("-1");
      hMinus.id = "cscs-layout-h-minus";
      hMinus.style.padding = "6px 10px";
      installHoldRepeat(hMinus, "h", -1);
      hLeft.appendChild(hMinus);

      var hSlider = makeRange();
      hSlider.id = "cscs-layout-h-slider";
      hLeft.appendChild(hSlider);

      var hPlus = makeMiniButton("+1");
      hPlus.id = "cscs-layout-h-plus";
      hPlus.style.padding = "6px 10px";
      installHoldRepeat(hPlus, "h", +1);
      hLeft.appendChild(hPlus);

      var hValue = makeValueText();
      hValue.id = "cscs-layout-h-value";
      rowH.appendChild(hValue);

      hSlider.addEventListener("input", function(e){
        e.preventDefault();
        e.stopPropagation();
        applyFromSliders();
      });

      setRangeEnabled(false);

      document.body.appendChild(panel);
    }

    // ===== LAYOUTボタン押下で小窓の表示/非表示 =====
    btn.addEventListener("click", function(e){
      e.preventDefault();
      e.stopPropagation();

      panel.style.display = (panel.style.display === "none") ? "block" : "none";

      if(panel.style.display === "block"){
        if(panel.__refreshLayoutPanelUI){
          panel.__refreshLayoutPanelUI();
        }
      }
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
      try{ handle.setPointerCapture(e.pointerId); }catch(_){}

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

      // 追加した処理:
      // - right/bottom が残っていると left/top と競合してドラッグ開始時に位置が飛ぶことがあるため、
      //   ドラッグで left/top 運用に入るタイミングで right/bottom を解除する
      el.style.right = "";
      el.style.bottom = "";

      el.style.position = "fixed";
      el.style.left = Math.round(newLeft) + "px";
      el.style.top  = Math.round(newTop)  + "px";
    }

    function onUp(e){
      if(!dragging) return;
      dragging = false;

      var rect = el.getBoundingClientRect();
      savePos(layoutId, {
        // 追加した処理:
        // - ドラッグ確定でも width/height を保存する
        //   （ここが無いと、W/Hを調整した後にドラッグするとW/Hが消える）
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
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
    // 追加した処理:
    // - ハンドルは「EDITモード」かつ「対象が固定ON」のときだけ表示
    var on = getEditMode();
    var handles = document.querySelectorAll(".cscs-layout-handle");
    for(var i=0;i<handles.length;i++){
      var hid = handles[i].getAttribute("data-layout-id-handle") || "";
      var show = on && hid && isTargetEnabled(hid);
      handles[i].style.display = show ? "flex" : "none";
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
    // 追加した処理:
    // - 固定ONのときだけ applyPos で fixed運用へ入れる（固定OFFは管理外のため触らない）
    if(isTargetEnabled(t.id)){
      applyPos(el, loadPos(t.id));
    }

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

        // 追加した処理:
        // - 固定ONの要素だけ、envKey切替後の保存位置を適用する（固定OFFは管理外）
        if(isTargetEnabled(t.id)){
          applyPos(el, loadPos(t.id));
        }
      }
    }, { passive: true });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }
})();