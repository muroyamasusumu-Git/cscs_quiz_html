// assets/cscs_sync_a_status_compare_b.js
// -------------------------------------------
// 目的:
//   - Aの「SYNCステータスパネル相当」を、Bページで“表示だけ”行う。
//   - 送信（/api/sync/merge）やキュー管理は一切しない。
//   - 参照元は /api/sync/state と localStorage のみ（フォールバックで別ソースを捏造しない）。
//
// 前提:
//   - BページURL: /_build_cscs_YYYYMMDD/slides/qNNN_b.html
//   - qid形式: "YYYYMMDD-NNN"
//
// 注意:
//   - このJSは “Aのcscs_sync_a.js” を読み込まなくても動く（完全独立）。
//   - 既存B側のSYNCパネルと衝突しないよう、DOM id を専用化している。

(function(){
  "use strict";

  // 二重初期化防止
  if (window.__CSCS_A_PANEL_ON_B_INSTALLED__) return;
  window.__CSCS_A_PANEL_ON_B_INSTALLED__ = true;

  var SYNC_STATE_ENDPOINT = "/api/sync/state";

  // =========================
  // QID検出（Bページ）
  // =========================
  function detectQidFromLocationB(){
    var m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) return null;
    var day  = m[1];
    var num3 = m[2];
    return day + "-" + num3;
  }

  var QID = detectQidFromLocationB();

  // =========================
  // “欠損は欠損” 表示用
  // =========================
  function toDisplayText(value, emptyLabel){
    var fallback = (emptyLabel != null) ? String(emptyLabel) : "-";
    if (value === null || value === undefined) return fallback;
    var s = String(value);
    if (s.trim() === "") return fallback;
    return s;
  }

  function readLsNonNegIntOrNull(key){
    try{
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return null;
      var s = String(raw).trim();
      if (s === "") return null;
      if (!/^\d+$/.test(s)) return null;
      var n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    }catch(_){
      return null;
    }
  }

  function readDatasetNonNegIntOrNull(ds, keyName){
    try{
      if (!ds) return null;
      var raw = ds[keyName];
      if (raw === null || raw === undefined) return null;
      var s = String(raw).trim();
      if (s === "") return null;
      if (!/^\d+$/.test(s)) return null;
      var n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    }catch(_){
      return null;
    }
  }

  // =========================
  // パネルDOM（Bへ挿入）
  // =========================
  function ensurePanelDom(){
    var rootId = "cscs_sync_monitor_a_on_b";
    var existing = document.getElementById(rootId);
    if (existing) return existing;

    // Bページ内の挿入先：まず body 直下（最小依存）
    var host = document.body;
    if (!host) return null;

    // style（最低限：読みやすいカード表示）
    injectStyleOnce();

    var box = document.createElement("div");
    box.id = rootId;

    // Aの“雰囲気”に寄せた、必要最小限の表示枠
    box.innerHTML =
      '' +
      '<div class="cscs-aob-card">' +
        '<div class="cscs-aob-head">' +
          '<div class="cscs-aob-title">SYNC Monitor (A panel on B)</div>' +
          '<div class="cscs-aob-qid">qid: <span class="aob-qid-val">（未検出）</span></div>' +
        '</div>' +

        '<div class="cscs-aob-grid">' +

          '<div class="aob-row">' +
            '<div class="aob-k">SYNC totals</div>' +
            '<div class="aob-v"><span class="aob-sync-totals">（データなし）</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">local totals</div>' +
            '<div class="aob-v"><span class="aob-local-totals">（データなし）</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streak3 (⭐️)</div>' +
            '<div class="aob-v">SYNC <span class="aob-sync-s3">-</span> / local <span class="aob-local-s3">-</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streakLen</div>' +
            '<div class="aob-v">SYNC <span class="aob-sync-sl">-</span> (p:<span class="aob-sync-sl-prog">-</span>) / local <span class="aob-local-sl">-</span> (p:<span class="aob-local-sl-prog">-</span>)</div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streak3Wrong</div>' +
            '<div class="aob-v">SYNC <span class="aob-sync-s3w">-</span> / local <span class="aob-local-s3w">-</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streakWrongLen</div>' +
            '<div class="aob-v">SYNC <span class="aob-sync-slw">-</span> (p:<span class="aob-sync-slw-prog">-</span>) / local <span class="aob-local-slw">-</span> (p:<span class="aob-local-slw-prog">-</span>)</div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streak3Today</div>' +
            '<div class="aob-v">SYNC day <span class="aob-s3t-day-sync">（データなし）</span> / unique <span class="aob-s3t-uc-sync">（データなし）</span> ｜ local day <span class="aob-s3t-day-local">（データなし）</span> / unique <span class="aob-s3t-uc-local">（データなし）</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">streak3WrongToday</div>' +
            '<div class="aob-v">SYNC day <span class="aob-s3wt-day-sync">（データなし）</span> / unique <span class="aob-s3wt-uc-sync">（データなし）</span> ｜ local day <span class="aob-s3wt-day-local">（データなし）</span> / unique <span class="aob-s3wt-uc-local">（データなし）</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">oncePerDayToday</div>' +
            '<div class="aob-v">SYNC day <span class="aob-once-day-sync">（データなし）</span> ｜ local day <span class="aob-once-day-local">（データなし）</span> ｜ result <span class="aob-once-qid-result">（データなし）</span></div>' +
          '</div>' +

          '<div class="aob-row">' +
            '<div class="aob-k">status</div>' +
            '<div class="aob-v"><span class="aob-status">idle</span> (<span class="aob-time">-</span>) <span class="aob-err"></span></div>' +
          '</div>' +

        '</div>' +
      '</div>';

    // 先頭に挿入（邪魔ならCSSで位置調整してOK）
    host.insertBefore(box, host.firstChild);
    return box;
  }

  function injectStyleOnce(){
    var styleId = "cscs_sync_a_panel_on_b_style";
    if (document.getElementById(styleId)) return;

    var css =
      '' +
      '#cscs_sync_monitor_a_on_b{ position: relative; z-index: 9999; }\n' +
      '#cscs_sync_monitor_a_on_b .cscs-aob-card{\n' +
      '  margin: 10px;\n' +
      '  padding: 10px 10px;\n' +
      '  border: 1px solid rgba(255,255,255,0.14);\n' +
      '  border-radius: 10px;\n' +
      '  background: rgba(0,0,0,0.42);\n' +
      '  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);\n' +
      '  color: rgba(255,255,255,0.92);\n' +
      '  font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;\n' +
      '  line-height: 1.25;\n' +
      '}\n' +
      '#cscs_sync_monitor_a_on_b .cscs-aob-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:10px; margin-bottom:8px; }\n' +
      '#cscs_sync_monitor_a_on_b .cscs-aob-title{ font-weight:600; opacity:0.95; }\n' +
      '#cscs_sync_monitor_a_on_b .cscs-aob-qid{ font-size:12px; opacity:0.85; }\n' +
      '#cscs_sync_monitor_a_on_b .cscs-aob-grid{ display:grid; grid-template-columns:1fr; gap:6px; }\n' +
      '#cscs_sync_monitor_a_on_b .aob-row{ display:grid; grid-template-columns:160px 1fr; gap:10px; }\n' +
      '#cscs_sync_monitor_a_on_b .aob-k{ font-size:12px; opacity:0.78; }\n' +
      '#cscs_sync_monitor_a_on_b .aob-v{ font-size:13px; opacity:0.95; word-break:break-word; }\n';

    var style = document.createElement("style");
    style.id = styleId;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  // =========================
  // state取得（表示のみ）
  // =========================
  var lastStatus = "idle";
  var lastTime = null;
  var lastErr = "";

  function setStatus(box, status, err){
    try{
      var st = box.querySelector(".aob-status");
      var tm = box.querySelector(".aob-time");
      var er = box.querySelector(".aob-err");
      if (st) st.textContent = status;
      if (tm) tm.textContent = lastTime ? lastTime : "-";
      if (er) er.textContent = err ? (" err:" + err) : "";
    }catch(_){}
  }

  function computeProgressMod3(n){
    if (typeof n === "number" && Number.isFinite(n)) return (n % 3);
    return null;
  }

  function readOncePerDayQidResult(state, qid){
    try{
      if (!state || typeof state !== "object") return null;
      var once = (state.oncePerDayToday && typeof state.oncePerDayToday === "object") ? state.oncePerDayToday : null;
      if (!once || !once.results || typeof once.results !== "object") return null;
      if (!Object.prototype.hasOwnProperty.call(once.results, qid)) return null;
      return once.results[qid];
    }catch(_){
      return null;
    }
  }

  async function fetchState(){
    if (!QID) return null;
    var r = await fetch(SYNC_STATE_ENDPOINT, { method: "GET" });
    if (!r.ok) throw new Error(String(r.status));
    var json = await r.json();
    return json;
  }

  function updateUiFromState(box, state){
    if (!box) return;

    // qid
    try{
      var qidEl = box.querySelector(".aob-qid-val");
      if (qidEl) qidEl.textContent = QID ? QID : "（未検出）";
    }catch(_){}

    // local totals
    var lc = readLsNonNegIntOrNull("cscs_q_correct_total:" + QID);
    var lw = readLsNonNegIntOrNull("cscs_q_wrong_total:" + QID);

    // local streaks
    var ls3  = readLsNonNegIntOrNull("cscs_q_correct_streak3_total:" + QID);
    var lsl  = readLsNonNegIntOrNull("cscs_q_correct_streak_len:" + QID);
    var ls3w = readLsNonNegIntOrNull("cscs_q_wrong_streak3_total:" + QID);
    var lslw = readLsNonNegIntOrNull("cscs_q_wrong_streak_len:" + QID);

    // sync totals / streaks（欠損は欠損）
    var sc = null, si = null, ss3 = null, ssl = null, ss3w = null, sslw = null;

    try{
      if (state && typeof state === "object") {
        if (state.correct && typeof state.correct === "object" && Object.prototype.hasOwnProperty.call(state.correct, QID)) {
          var v = state.correct[QID];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) sc = v;
        }
        if (state.incorrect && typeof state.incorrect === "object" && Object.prototype.hasOwnProperty.call(state.incorrect, QID)) {
          var v2 = state.incorrect[QID];
          if (typeof v2 === "number" && Number.isFinite(v2) && v2 >= 0) si = v2;
        }
        if (state.streak3 && typeof state.streak3 === "object" && Object.prototype.hasOwnProperty.call(state.streak3, QID)) {
          var v3 = state.streak3[QID];
          if (typeof v3 === "number" && Number.isFinite(v3) && v3 >= 0) ss3 = v3;
        }
        if (state.streakLen && typeof state.streakLen === "object" && Object.prototype.hasOwnProperty.call(state.streakLen, QID)) {
          var v4 = state.streakLen[QID];
          if (typeof v4 === "number" && Number.isFinite(v4) && v4 >= 0) ssl = v4;
        }
        if (state.streak3Wrong && typeof state.streak3Wrong === "object" && Object.prototype.hasOwnProperty.call(state.streak3Wrong, QID)) {
          var v5 = state.streak3Wrong[QID];
          if (typeof v5 === "number" && Number.isFinite(v5) && v5 >= 0) ss3w = v5;
        }
        if (state.streakWrongLen && typeof state.streakWrongLen === "object" && Object.prototype.hasOwnProperty.call(state.streakWrongLen, QID)) {
          var v6 = state.streakWrongLen[QID];
          if (typeof v6 === "number" && Number.isFinite(v6) && v6 >= 0) sslw = v6;
        }
      }
    }catch(_){}

    // progress（計算できる時だけ）
    var sp  = computeProgressMod3(ssl);
    var lp  = computeProgressMod3(lsl);
    var spw = computeProgressMod3(sslw);
    var lpw = computeProgressMod3(lslw);

    // streak3Today / WrongToday（SYNCは取れた時だけ）
    var s3tDaySync = "";
    var s3tUcSync  = "";
    var s3wtDaySync = "";
    var s3wtUcSync  = "";

    try{
      if (state && state.streak3Today && typeof state.streak3Today === "object") {
        if (Object.prototype.hasOwnProperty.call(state.streak3Today, "day")) {
          s3tDaySync = String(state.streak3Today.day || "");
        }
        if (typeof state.streak3Today.unique_count === "number" && Number.isFinite(state.streak3Today.unique_count)) {
          s3tUcSync = String(state.streak3Today.unique_count);
        }
      }
    }catch(_){}

    try{
      if (state && state.streak3WrongToday && typeof state.streak3WrongToday === "object") {
        if (Object.prototype.hasOwnProperty.call(state.streak3WrongToday, "day")) {
          s3wtDaySync = String(state.streak3WrongToday.day || "");
        }
        if (typeof state.streak3WrongToday.unique_count === "number" && Number.isFinite(state.streak3WrongToday.unique_count)) {
          s3wtUcSync = String(state.streak3WrongToday.unique_count);
        }
      }
    }catch(_){}

    // local today系（欠損は欠損）
    var s3tDayLocal = "";
    var s3tUcLocal  = readLsNonNegIntOrNull("cscs_streak3_today_unique_count");
    var s3wtDayLocal = "";
    var s3wtUcLocal  = readLsNonNegIntOrNull("cscs_streak3_wrong_today_unique_count");

    try{ s3tDayLocal  = localStorage.getItem("cscs_streak3_today_day") || ""; }catch(_){}
    try{ s3wtDayLocal = localStorage.getItem("cscs_streak3_wrong_today_day") || ""; }catch(_){}

    // oncePerDayToday（SYNC day / local day / result）
    var onceDaySync = "";
    var onceDayLocal = "";
    var onceResult = null;

    try{
      if (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object") {
        if (typeof state.oncePerDayToday.day === "number" && Number.isFinite(state.oncePerDayToday.day)) {
          onceDaySync = String(state.oncePerDayToday.day);
        } else if (typeof state.oncePerDayToday.day === "string" && state.oncePerDayToday.day.trim() !== "") {
          onceDaySync = state.oncePerDayToday.day.trim();
        }
      }
    }catch(_){}

    try{ onceDayLocal = localStorage.getItem("cscs_once_per_day_today_day") || ""; }catch(_){}
    onceResult = readOncePerDayQidResult(state, QID);

    // ---- DOM反映 ----
    function setText(sel, text){
      try{
        var el = box.querySelector(sel);
        if (el) el.textContent = text;
      }catch(_){}
    }

    setText(".aob-sync-totals", "SYNC " + toDisplayText(sc, "-") + " / " + toDisplayText(si, "-"));
    setText(".aob-local-totals", "local " + toDisplayText(lc, "-") + " / " + toDisplayText(lw, "-"));

    setText(".aob-sync-s3",  toDisplayText(ss3, "-"));
    setText(".aob-local-s3", toDisplayText(ls3, "-"));

    setText(".aob-sync-sl",  toDisplayText(ssl, "-"));
    setText(".aob-local-sl", toDisplayText(lsl, "-"));
    setText(".aob-sync-sl-prog",  toDisplayText(sp, "-"));
    setText(".aob-local-sl-prog", toDisplayText(lp, "-"));

    setText(".aob-sync-s3w",  toDisplayText(ss3w, "-"));
    setText(".aob-local-s3w", toDisplayText(ls3w, "-"));

    setText(".aob-sync-slw",  toDisplayText(sslw, "-"));
    setText(".aob-local-slw", toDisplayText(lslw, "-"));
    setText(".aob-sync-slw-prog",  toDisplayText(spw, "-"));
    setText(".aob-local-slw-prog", toDisplayText(lpw, "-"));

    setText(".aob-s3t-day-sync", toDisplayText(s3tDaySync, "（データなし）"));
    setText(".aob-s3t-uc-sync",  toDisplayText(s3tUcSync,  "（データなし）"));
    setText(".aob-s3t-day-local", toDisplayText(s3tDayLocal, "（データなし）"));
    setText(".aob-s3t-uc-local",  toDisplayText((s3tUcLocal === null ? "" : String(s3tUcLocal)), "（データなし）"));

    setText(".aob-s3wt-day-sync", toDisplayText(s3wtDaySync, "（データなし）"));
    setText(".aob-s3wt-uc-sync",  toDisplayText(s3wtUcSync,  "（データなし）"));
    setText(".aob-s3wt-day-local", toDisplayText(s3wtDayLocal, "（データなし）"));
    setText(".aob-s3wt-uc-local",  toDisplayText((s3wtUcLocal === null ? "" : String(s3wtUcLocal)), "（データなし）"));

    setText(".aob-once-day-sync",  toDisplayText(onceDaySync, "（データなし）"));
    setText(".aob-once-day-local", toDisplayText(onceDayLocal, "（データなし）"));
    setText(".aob-once-qid-result", toDisplayText(onceResult, "（データなし）"));

    console.log("[A-PANEL-ON-B][UI] updated (no-send)", {
      qid: QID,
      sync: { c: sc, w: si, s3: ss3, sl: ssl, s3w: ss3w, slw: sslw },
      local: { c: lc, w: lw, s3: ls3, sl: lsl, s3w: ls3w, slw: lslw },
      today: {
        streak3Today: { syncDay: s3tDaySync, syncUc: s3tUcSync, localDay: s3tDayLocal, localUc: s3tUcLocal },
        streak3WrongToday: { syncDay: s3wtDaySync, syncUc: s3wtUcSync, localDay: s3wtDayLocal, localUc: s3wtUcLocal }
      },
      oncePerDayToday: { syncDay: onceDaySync, localDay: onceDayLocal, qidResult: onceResult }
    });
  }

  async function tick(){
    if (!QID) return;

    var box = ensurePanelDom();
    if (!box) return;

    lastStatus = "sending";
    lastErr = "";
    lastTime = null;
    setStatus(box, lastStatus, lastErr);

    try{
      var state = await fetchState();

      // “表示だけ”でも、他のビューが参照できるように保持（上書きはOK）
      try{
        window.__cscs_sync_state = state;
      }catch(_){}

      lastStatus = "ok";
      lastTime = new Date().toLocaleTimeString();
      lastErr = "";

      updateUiFromState(box, state);
      setStatus(box, lastStatus, lastErr);
    }catch(e){
      lastStatus = "error";
      lastTime = new Date().toLocaleTimeString();
      lastErr = String(e && e.message || e);

      setStatus(box, lastStatus, lastErr);
      console.error("[A-PANEL-ON-B][ERROR] tick failed", { qid: QID, error: lastErr });
    }
  }

  function start(){
    if (!QID) {
      console.log("[A-PANEL-ON-B] QID not detected. panel skipped.", { path: location.pathname });
      return;
    }

    // 初回
    tick();

    // 以降は軽めに更新（“表示だけ”なので 5秒間隔）
    setInterval(function(){
      tick();
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();