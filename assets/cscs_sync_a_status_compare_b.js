// assets/cscs_sync_a_status_compare_b.js
/**
 * CSCS SYNC(A) ステータスパネル互換 “表示専用” 比較ビュー（B用）
 *
 * 目的:
 *   - Aのステータスパネルに近い情報を、Bページ上で比較確認できるように表示する。
 *   - Aの機能（送信キュー・merge送信・localStorage整流化）とは完全に分離する。
 *
 * 絶対にやらないこと（恒久）:
 *   - /api/sync/merge を叩かない（送信禁止）
 *   - localStorage に setItem/removeItem をしない（上書き禁止）
 *   - window.CSCS_SYNC など “A側の機能名” を定義しない（衝突禁止）
 *   - window.__cscs_sync_state を上書きしない（共有グローバル破壊禁止）
 *
 * 参照元（読むだけ）:
 *   - window.__cscs_sync_state（存在すれば最優先で読む）
 *   - もし無ければ GET /api/sync/state を 1回だけ読む（表示のためだけ）
 *   - localStorage（b_judge_record.js が書いた値を読むだけ）
 */
(function(){
  "use strict";

  // 二重初期化防止
  if (window.__CSCS_A_STATUS_COMPARE_B_INSTALLED__) return;
  window.__CSCS_A_STATUS_COMPARE_B_INSTALLED__ = true;

  // =========================
  // 設定
  // =========================
  var ENDPOINT_STATE = "/api/sync/state";

  // Bページでの表示先（無ければ自前で body 末尾に作る）
  var ROOT_ID = "cscs_sync_monitor_b_compare";

  // 折りたたみ状態の保存キー（Aとは別名）
  var LS_OPEN = "cscs_sync_b_compare_monitor_open";

  // =========================
  // QID検出（B）
  // =========================
  function detectQidFromLocationB(){
    try{
      var m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
      if (!m) return null;
      var day  = m[1];
      var num3 = m[2];
      return day + "-" + num3;
    }catch(_){
      return null;
    }
  }
  var QID = detectQidFromLocationB();

  // =========================
  // localStorage 読み取り（表示専用）
  // =========================
  function readLsStr(key){
    try{
      var v = localStorage.getItem(key);
      if (v === null || v === undefined) return null;
      var s = String(v);
      return s;
    }catch(_){
      return null;
    }
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

  function toDisplayText(value, emptyLabel){
    var fallback = (emptyLabel !== null && emptyLabel !== undefined) ? String(emptyLabel) : "-";
    if (value === null || value === undefined) return fallback;
    var s = String(value);
    if (s.trim() === "") return fallback;
    return s;
  }

  // =========================
  // state 読み取り（表示専用）
  // =========================
  function getSharedStateIfAny(){
    try{
      if (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object") {
        return window.__cscs_sync_state;
      }
      return null;
    }catch(_){
      return null;
    }
  }

  async function fetchStateOnceForView(){
    // 表示目的だけ。window.__cscs_sync_state には絶対に書かない。
    var res = await fetch(ENDPOINT_STATE, { method: "GET" });
    if (!res.ok) throw new Error(String(res.status));
    var json = await res.json();
    return json;
  }

  // =========================
  // 折りたたみ
  // =========================
  function readLsBool(key, defaultBool){
    try{
      var v = localStorage.getItem(key);
      if (v === null || v === undefined) return !!defaultBool;
      if (v === "1") return true;
      if (v === "0") return false;
      if (v === "true") return true;
      if (v === "false") return false;
      return !!defaultBool;
    }catch(_){
      return !!defaultBool;
    }
  }

  function writeLsBool(key, boolVal){
    try{
      localStorage.setItem(key, boolVal ? "1" : "0");
    }catch(_){}
  }

  // =========================
  // DOM生成（A風・ただし独立）
  // =========================
  function ensureRoot(){
    var root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;

    // Aと衝突しないクラス名（比較ビュー用）
    root.className = "cscs-sync-compare-root";

    // 置き場所：基本は body の末尾（Bステータスの邪魔をしない）
    document.body.appendChild(root);
    return root;
  }

  function injectStyleOnce(){
    var ID = "cscs_sync_compare_b_style";
    if (document.getElementById(ID)) return;

    var css = ""
      + "#"+ROOT_ID+"{position:fixed;right:12px;top:12px;z-index:99999;max-width:420px;width:calc(100vw - 24px);}\n"
      + "#"+ROOT_ID+" .cmp-card{background:rgba(0,0,0,0.56);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:10px 10px;color:rgba(255,255,255,0.92);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic',sans-serif;}\n"
      + "#"+ROOT_ID+" .cmp-top{display:flex;align-items:center;justify-content:space-between;gap:10px;}\n"
      + "#"+ROOT_ID+" .cmp-title{font-weight:600;letter-spacing:0.2px;font-size:13px;opacity:0.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n"
      + "#"+ROOT_ID+" .cmp-mini{font-size:11px;opacity:0.82;white-space:nowrap;}\n"
      + "#"+ROOT_ID+" .cmp-btn{background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.92);border-radius:10px;padding:4px 8px;font-size:11px;cursor:pointer;}\n"
      + "#"+ROOT_ID+" .cmp-btn:hover{background:rgba(255,255,255,0.14);}\n"
      + "#"+ROOT_ID+" .cmp-body{margin-top:8px;}\n"
      + "#"+ROOT_ID+" .cmp-grid{display:grid;grid-template-columns:140px 1fr;gap:6px 10px;font-size:12px;line-height:1.25;}\n"
      + "#"+ROOT_ID+" .cmp-lbl{opacity:0.78;}\n"
      + "#"+ROOT_ID+" .cmp-val{opacity:0.95;word-break:break-word;}\n"
      + "#"+ROOT_ID+" .cmp-sep{height:1px;background:rgba(255,255,255,0.10);margin:8px 0;}\n"
      + "#"+ROOT_ID+" .cmp-err{color:rgba(255,200,200,0.95);font-size:11px;white-space:pre-wrap;}\n";

    var st = document.createElement("style");
    st.id = ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function renderShell(root){
    var open = readLsBool(LS_OPEN, false);

    root.innerHTML =
      ''
      + '<div class="cmp-card">'
      + '  <div class="cmp-top">'
      + '    <div class="cmp-title">A Status Panel Compare (View Only / B)</div>'
      + '    <div style="display:flex;align-items:center;gap:8px;">'
      + '      <div class="cmp-mini cmp-qid"></div>'
      + '      <button class="cmp-btn cmp-toggle" type="button"></button>'
      + '    </div>'
      + '  </div>'
      + '  <div class="cmp-body" style="display:' + (open ? "block" : "none") + ';">'
      + '    <div class="cmp-grid">'
      + '      <div class="cmp-lbl">QID</div><div class="cmp-val v-qid"></div>'
      + '      <div class="cmp-lbl">SYNC totals</div><div class="cmp-val v-sync-totals"></div>'
      + '      <div class="cmp-lbl">local totals</div><div class="cmp-val v-local-totals"></div>'
      + '      <div class="cmp-lbl">streak3 (C)</div><div class="cmp-val v-s3c"></div>'
      + '      <div class="cmp-lbl">streakLen (C)</div><div class="cmp-val v-slc"></div>'
      + '      <div class="cmp-lbl">streak3 (W)</div><div class="cmp-val v-s3w"></div>'
      + '      <div class="cmp-lbl">streakLen (W)</div><div class="cmp-val v-slw"></div>'
      + '    </div>'
      + '    <div class="cmp-sep"></div>'
      + '    <div class="cmp-grid">'
      + '      <div class="cmp-lbl">streak3Today</div><div class="cmp-val v-s3t"></div>'
      + '      <div class="cmp-lbl">streak3WrongToday</div><div class="cmp-val v-s3wt"></div>'
      + '      <div class="cmp-lbl">oncePerDayToday</div><div class="cmp-val v-once"></div>'
      + '    </div>'
      + '    <div class="cmp-sep"></div>'
      + '    <div class="cmp-grid">'
      + '      <div class="cmp-lbl">LastSeen</div><div class="cmp-val v-last-seen"></div>'
      + '      <div class="cmp-lbl">LastCorrect</div><div class="cmp-val v-last-cor"></div>'
      + '      <div class="cmp-lbl">LastWrong</div><div class="cmp-val v-last-wrg"></div>'
      + '    </div>'
      + '    <div class="cmp-sep"></div>'
      + '    <div class="cmp-grid">'
      + '      <div class="cmp-lbl">ODOA</div><div class="cmp-val v-odoa"></div>'
      + '      <div class="cmp-lbl">VERIFY</div><div class="cmp-val v-verify"></div>'
      + '      <div class="cmp-lbl">state.updatedAt</div><div class="cmp-val v-updated"></div>'
      + '    </div>'
      + '    <div class="cmp-sep"></div>'
      + '    <div class="cmp-err v-err"></div>'
      + '  </div>'
      + '</div>';

    var btn = root.querySelector(".cmp-toggle");
    if (btn) btn.textContent = open ? "Hide" : "Show";

    var qmini = root.querySelector(".cmp-qid");
    if (qmini) qmini.textContent = QID ? QID : "(no qid)";

    if (btn) {
      btn.addEventListener("click", function(){
        var nowOpen = !readLsBool(LS_OPEN, false);
        writeLsBool(LS_OPEN, nowOpen);
        var body = root.querySelector(".cmp-body");
        if (body) body.style.display = nowOpen ? "block" : "none";
        btn.textContent = nowOpen ? "Hide" : "Show";
      });
    }
  }

  // =========================
  // 値の抽出（state/local）
  // =========================
  function readStateNumberOrNull(state, mapKey, qid){
    try{
      if (!state || typeof state !== "object") return null;
      var m = state[mapKey];
      if (!m || typeof m !== "object") return null;
      if (!Object.prototype.hasOwnProperty.call(m, qid)) return null;
      var v = m[qid];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
      return v;
    }catch(_){
      return null;
    }
  }

  function readStateAny(state, key){
    try{
      if (!state || typeof state !== "object") return null;
      if (!Object.prototype.hasOwnProperty.call(state, key)) return null;
      return state[key];
    }catch(_){
      return null;
    }
  }

  function formatOncePerDay(state, qid){
    try{
      var once = (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object")
        ? state.oncePerDayToday
        : null;

      if (!once) return "（データなし）";

      var day = null;
      if (typeof once.day === "number" && Number.isFinite(once.day) && once.day > 0) day = String(once.day);
      if (typeof once.day === "string" && String(once.day).trim() !== "") day = String(once.day).trim();

      var res = null;
      if (once.results && typeof once.results === "object" && qid) {
        if (Object.prototype.hasOwnProperty.call(once.results, qid)) {
          res = once.results[qid];
        }
      }
      var resText = (res === "correct" || res === "wrong") ? String(res) : (res !== null && res !== undefined ? String(res) : "no-entry");

      return "day=" + toDisplayText(day, "（データなし）") + " / qid=" + toDisplayText(qid, "（データなし）") + " / result=" + resText;
    }catch(_){
      return "（データなし）";
    }
  }

  // =========================
  // レンダリング
  // =========================
  function updateView(root, state, lastErrorText){
    var errEl = root.querySelector(".v-err");
    if (errEl) errEl.textContent = lastErrorText ? String(lastErrorText) : "";

    var qidEl = root.querySelector(".v-qid");
    if (qidEl) qidEl.textContent = QID ? QID : "（データなし）";

    // local totals
    var lc = QID ? readLsNonNegIntOrNull("cscs_q_correct_total:" + QID) : null;
    var lw = QID ? readLsNonNegIntOrNull("cscs_q_wrong_total:" + QID) : null;

    // local streaks
    var ls3c = QID ? readLsNonNegIntOrNull("cscs_q_correct_streak3_total:" + QID) : null;
    var lslc = QID ? readLsNonNegIntOrNull("cscs_q_correct_streak_len:" + QID) : null;
    var ls3w = QID ? readLsNonNegIntOrNull("cscs_q_wrong_streak3_total:" + QID) : null;
    var lslw = QID ? readLsNonNegIntOrNull("cscs_q_wrong_streak_len:" + QID) : null;

    // state totals
    var sc = QID ? readStateNumberOrNull(state, "correct", QID) : null;
    var si = QID ? readStateNumberOrNull(state, "incorrect", QID) : null;

    var ss3c = QID ? readStateNumberOrNull(state, "streak3", QID) : null;
    var sslc = QID ? readStateNumberOrNull(state, "streakLen", QID) : null;
    var ss3w = QID ? readStateNumberOrNull(state, "streak3Wrong", QID) : null;
    var sslw = QID ? readStateNumberOrNull(state, "streakWrongLen", QID) : null;

    var syncTotalsEl = root.querySelector(".v-sync-totals");
    if (syncTotalsEl) syncTotalsEl.textContent = "SYNC " + toDisplayText(sc, "-") + " / " + toDisplayText(si, "-");

    var localTotalsEl = root.querySelector(".v-local-totals");
    if (localTotalsEl) localTotalsEl.textContent = "local " + toDisplayText(lc, "-") + " / " + toDisplayText(lw, "-");

    var s3cEl = root.querySelector(".v-s3c");
    if (s3cEl) s3cEl.textContent = "sync " + toDisplayText(ss3c, "-") + " / local " + toDisplayText(ls3c, "-");

    var slcEl = root.querySelector(".v-slc");
    if (slcEl) slcEl.textContent = "sync " + toDisplayText(sslc, "-") + " / local " + toDisplayText(lslc, "-");

    var s3wEl = root.querySelector(".v-s3w");
    if (s3wEl) s3wEl.textContent = "sync " + toDisplayText(ss3w, "-") + " / local " + toDisplayText(ls3w, "-");

    var slwEl = root.querySelector(".v-slw");
    if (slwEl) slwEl.textContent = "sync " + toDisplayText(sslw, "-") + " / local " + toDisplayText(lslw, "-");

    // streak3Today (sync/local)
    var s3t = (state && state.streak3Today && typeof state.streak3Today === "object") ? state.streak3Today : null;
    var s3tDay = (s3t && Object.prototype.hasOwnProperty.call(s3t, "day")) ? String(s3t.day) : null;
    var s3tCnt = (s3t && typeof s3t.unique_count === "number" && Number.isFinite(s3t.unique_count)) ? s3t.unique_count : null;

    var lS3tDay = readLsStr("cscs_streak3_today_day");
    var lS3tCnt = readLsNonNegIntOrNull("cscs_streak3_today_unique_count");

    var s3tEl = root.querySelector(".v-s3t");
    if (s3tEl) {
      s3tEl.textContent =
        "sync day=" + toDisplayText(s3tDay, "（なし）") + " cnt=" + toDisplayText(s3tCnt, "（なし）") +
        " / local day=" + toDisplayText(lS3tDay, "（なし）") + " cnt=" + toDisplayText(lS3tCnt, "（なし）");
    }

    // streak3WrongToday (sync/local)
    var s3wt = (state && state.streak3WrongToday && typeof state.streak3WrongToday === "object") ? state.streak3WrongToday : null;
    var s3wtDay = (s3wt && Object.prototype.hasOwnProperty.call(s3wt, "day")) ? String(s3wt.day) : null;
    var s3wtCnt = (s3wt && typeof s3wt.unique_count === "number" && Number.isFinite(s3wt.unique_count)) ? s3wt.unique_count : null;

    var lS3wtDay = readLsStr("cscs_streak3_wrong_today_day");
    var lS3wtCnt = readLsNonNegIntOrNull("cscs_streak3_wrong_today_unique_count");

    var s3wtEl = root.querySelector(".v-s3wt");
    if (s3wtEl) {
      s3wtEl.textContent =
        "sync day=" + toDisplayText(s3wtDay, "（なし）") + " cnt=" + toDisplayText(s3wtCnt, "（なし）") +
        " / local day=" + toDisplayText(lS3wtDay, "（なし）") + " cnt=" + toDisplayText(lS3wtCnt, "（なし）");
    }

    // oncePerDayToday（stateのみ表示。localは読み出しだけ）
    var onceEl = root.querySelector(".v-once");
    if (onceEl) onceEl.textContent = formatOncePerDay(state, QID);

    // last day info
    var lastSeenSync = null;
    var lastCorrectSync = null;
    var lastWrongSync = null;

    try{
      if (state && state.lastSeenDay && typeof state.lastSeenDay === "object" && QID && Object.prototype.hasOwnProperty.call(state.lastSeenDay, QID)) {
        lastSeenSync = String(state.lastSeenDay[QID]);
      }
      if (state && state.lastCorrectDay && typeof state.lastCorrectDay === "object" && QID && Object.prototype.hasOwnProperty.call(state.lastCorrectDay, QID)) {
        lastCorrectSync = String(state.lastCorrectDay[QID]);
      }
      if (state && state.lastWrongDay && typeof state.lastWrongDay === "object" && QID && Object.prototype.hasOwnProperty.call(state.lastWrongDay, QID)) {
        lastWrongSync = String(state.lastWrongDay[QID]);
      }
    }catch(_){}

    var lastSeenLocal = QID ? readLsStr("cscs_q_last_seen_day:" + QID) : null;
    var lastCorrectLocal = QID ? readLsStr("cscs_q_last_correct_day:" + QID) : null;
    var lastWrongLocal = QID ? readLsStr("cscs_q_last_wrong_day:" + QID) : null;

    var lsEl = root.querySelector(".v-last-seen");
    if (lsEl) lsEl.textContent = "sync " + toDisplayText(lastSeenSync, "（なし）") + " / local " + toDisplayText(lastSeenLocal, "（なし）");

    var lcEl = root.querySelector(".v-last-cor");
    if (lcEl) lcEl.textContent = "sync " + toDisplayText(lastCorrectSync, "（なし）") + " / local " + toDisplayText(lastCorrectLocal, "（なし）");

    var lwEl = root.querySelector(".v-last-wrg");
    if (lwEl) lwEl.textContent = "sync " + toDisplayText(lastWrongSync, "（なし）") + " / local " + toDisplayText(lastWrongLocal, "（なし）");

    // odoa / verify
    var odoaMode = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
    var verifyMode = (typeof window.CSCS_VERIFY_MODE === "string") ? window.CSCS_VERIFY_MODE : "";

    var odoaEl = root.querySelector(".v-odoa");
    if (odoaEl) odoaEl.textContent = (odoaMode === "on") ? "ON" : (odoaMode === "off") ? "OFF" : "unknown";

    var verifyEl = root.querySelector(".v-verify");
    if (verifyEl) verifyEl.textContent = (verifyMode === "on") ? "ON" : (verifyMode === "off") ? "OFF" : "unknown";

    // updatedAt
    var up = readStateAny(state, "updatedAt");
    var upEl = root.querySelector(".v-updated");
    if (upEl) upEl.textContent = toDisplayText(up, "（データなし）");
  }

  // =========================
  // 起動
  // =========================
  async function boot(){
    injectStyleOnce();
    var root = ensureRoot();
    renderShell(root);

    var state = getSharedStateIfAny();
    var errText = "";

    if (!state) {
      try{
        state = await fetchStateOnceForView();
      }catch(e){
        state = null;
        errText = "[compare-b] GET /api/sync/state failed: " + String(e && e.message || e);
      }
    }

    updateView(root, state, errText);

    // 表示専用：定期更新は“重くしない”ため 5秒ごと（必要なら後で変更）
    setInterval(function(){
      try{
        var st = getSharedStateIfAny();
        if (st) {
          updateView(root, st, "");
          return;
        }
        // shared state が無い場合は localStorage だけでも更新（stateは前回のまま）
        updateView(root, state, errText);
      }catch(_){}
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();