// assets/cscs_sync_a_status_compare_b.js
/**
 * CSCS SYNC(A) — Aパート用 SYNC ステータス取得＆表示（表示専用）
 *
 * 方針（重要）:
 *  - このファイルは「/api/sync/state から状態を取得して UI に表示するだけ」。
 *  - /api/sync/merge は呼ばない（送信しない）。
 *  - localStorage を上書きしない（setItem/removeItem しない）。
 *  - フォールバックで別ソースから推測して埋めない（取れなければ欠損表示）。
 *
 * 使用API:
 *  - GET /api/sync/state
 *
 * 想定DOM:
 *  - #cscs_sync_monitor_a
 *  - #cscs_sync_totals
 */
(function(){
  "use strict";

  // =========================
  // ① QID検出（Aパート）
  // =========================
  function detectQidFromLocationA() {
    const m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_a(?:\.html)?$/);
    if (!m) return null;
    const day  = m[1];
    const num3 = m[2];
    return day + "-" + num3;
  }
  const QID = detectQidFromLocationA();

  // =========================
  // ② 表示ユーティリティ
  // =========================
  function toDisplayText(value, emptyLabel){
    const fallback = emptyLabel != null ? String(emptyLabel) : "-";
    if (value === null || value === undefined) return fallback;
    const s = String(value);
    if (s.trim() === "") return fallback;
    return s;
  }

  function readLsNonNegIntOrNull(key){
    try{
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return null;
      const s = String(raw).trim();
      if (s === "") return null;
      if (!/^\d+$/.test(s)) return null;
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    }catch(_){
      return null;
    }
  }

  function readLocalTotalsForQid(qid){
    const kC = "cscs_q_correct_total:" + qid;
    const kW = "cscs_q_wrong_total:"   + qid;
    return { c: readLsNonNegIntOrNull(kC), w: readLsNonNegIntOrNull(kW) };
  }

  function readLocalStreakLenForQid(qid){
    return readLsNonNegIntOrNull("cscs_q_correct_streak_len:" + qid);
  }

  function readLocalWrongStreakLenForQid(qid){
    return readLsNonNegIntOrNull("cscs_q_wrong_streak_len:" + qid);
  }

  function readStateMapNumberStrict(state, mapKey, qid){
    if (!state || typeof state !== "object") return { ok: false, value: null };
    const mp = state[mapKey];
    if (!mp || typeof mp !== "object") return { ok: false, value: null };
    if (!Object.prototype.hasOwnProperty.call(mp, qid)) return { ok: false, value: null };

    const v = mp[qid];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, value: null };
    return { ok: true, value: v };
  }

  function computeProgressOrNull(streakLen){
    if (typeof streakLen !== "number" || !Number.isFinite(streakLen)) return null;
    return (streakLen % 3);
  }

  // =========================
  // ③ ステータス表示（UI更新）
  // =========================
  let lastSyncStatus = "idle";   // "idle" | "fetching" | "ok" | "error" | "offline"
  let lastSyncTime   = null;     // "HH:MM:SS"
  let lastSyncError  = "";

  function updateMonitor(){
    try{
      if (!QID) return;

      const box = document.getElementById("cscs_sync_monitor_a");
      if (!box) return;

      const totalsEl = document.getElementById("cscs_sync_totals");

      const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
        ? window.__cscs_sync_state
        : null;

      // --- SYNC側（server） ---
      let sc = null, si = null, ss3 = null, sl = null, ss3w = null, slw = null;

      if (state) {
        const rc   = readStateMapNumberStrict(state, "correct", QID);
        const ri   = readStateMapNumberStrict(state, "incorrect", QID);
        const rs3  = readStateMapNumberStrict(state, "streak3", QID);
        const rsl  = readStateMapNumberStrict(state, "streakLen", QID);
        const rs3w = readStateMapNumberStrict(state, "streak3Wrong", QID);
        const rslw = readStateMapNumberStrict(state, "streakWrongLen", QID);

        sc   = rc.ok   ? rc.value   : null;
        si   = ri.ok   ? ri.value   : null;
        ss3  = rs3.ok  ? rs3.value  : null;
        sl   = rsl.ok  ? rsl.value  : null;
        ss3w = rs3w.ok ? rs3w.value : null;
        slw  = rslw.ok ? rslw.value : null;
      }

      // --- local側（読み取りのみ） ---
      const localTotals = readLocalTotalsForQid(QID);
      const lc = localTotals.c;
      const li = localTotals.w;

      const ll  = readLocalStreakLenForQid(QID);
      const llw = readLocalWrongStreakLenForQid(QID);

      // --- 表示反映 ---
      const qEl = box.querySelector(".sync-qid");
      if (qEl) qEl.textContent = toDisplayText(QID, "（データなし）");

      const serverTextEl = totalsEl ? totalsEl.querySelector(".sync-server-text") : null;
      if (serverTextEl) {
        serverTextEl.textContent = "SYNC " + (sc === null ? "-" : String(sc)) + " / " + (si === null ? "-" : String(si));
      }

      const lEl  = box.querySelector(".sync-local");
      if (lEl) {
        lEl.textContent = "local  " + (lc === null ? "-" : String(lc)) + " / " + (li === null ? "-" : String(li));
      }

      const s3sEl = box.querySelector(".sync-streak3-server");
      if (s3sEl) s3sEl.textContent = (ss3 === null) ? "-" : String(ss3);

      const slsEl = box.querySelector(".sync-streaklen-server");
      if (slsEl) slsEl.textContent = (sl === null) ? "-" : String(sl);

      const s3wsEl = box.querySelector(".sync-wrong-streak3-server");
      if (s3wsEl) s3wsEl.textContent = (ss3w === null) ? "-" : String(ss3w);

      const slwsEl = box.querySelector(".sync-wrong-streaklen-server");
      if (slwsEl) slwsEl.textContent = (slw === null) ? "-" : String(slw);

      const slsProgEl  = box.querySelector(".sync-streaklen-server-progress");
      const sllProgEl  = box.querySelector(".sync-streaklen-local-progress");
      const slwsProgEl = box.querySelector(".sync-wrong-streaklen-server-progress");
      const sllwProgEl = box.querySelector(".sync-wrong-streaklen-local-progress");

      const serverProgress = computeProgressOrNull(sl);
      const localProgress  = computeProgressOrNull(ll);
      const serverWrongProgress = computeProgressOrNull(slw);
      const localWrongProgress  = computeProgressOrNull(llw);

      if (slsProgEl)  slsProgEl.textContent  = (serverProgress === null) ? "-" : String(serverProgress);
      if (sllProgEl)  sllProgEl.textContent  = (localProgress === null) ? "-" : String(localProgress);
      if (slwsProgEl) slwsProgEl.textContent = (serverWrongProgress === null) ? "-" : String(serverWrongProgress);
      if (sllwProgEl) sllwProgEl.textContent = (localWrongProgress === null) ? "-" : String(localWrongProgress);

      const stEl = box.querySelector(".sync-status");
      if (stEl) {
        const time = lastSyncTime ? lastSyncTime : "-";
        const err  = lastSyncError ? (" err:" + lastSyncError) : "";
        stEl.textContent = lastSyncStatus + " (" + time + ")" + err;
      }
    }catch(_){
      // UI更新失敗は握りつぶし（表示専用）
    }
  }

  // =========================
  // ④ /api/sync/state 取得（表示専用）
  // =========================
  async function fetchStateOnce(){
    if (!QID) return;

    if (!navigator.onLine) {
      lastSyncStatus = "offline";
      lastSyncError  = "";
      updateMonitor();
      return;
    }

    lastSyncStatus = "fetching";
    lastSyncError  = "";
    updateMonitor();

    try{
      const r = await fetch("/api/sync/state", { method: "GET" });
      if (!r.ok) throw new Error(String(r.status));

      const json = await r.json();

      window.__cscs_sync_state = json;

      lastSyncStatus = "ok";
      lastSyncTime   = new Date().toLocaleTimeString();
      lastSyncError  = "";

      console.log("[SYNC-A][VIEW-ONLY] state fetched", {
        qid: QID,
        updatedAt: (json && Object.prototype.hasOwnProperty.call(json, "updatedAt")) ? json.updatedAt : null,
        hasCorrect: !!(json && json.correct),
        hasIncorrect: !!(json && json.incorrect),
        hasStreak3: !!(json && json.streak3),
        hasStreakLen: !!(json && json.streakLen),
        hasStreak3Wrong: !!(json && json.streak3Wrong),
        hasStreakWrongLen: !!(json && json.streakWrongLen)
      });
    }catch(e){
      lastSyncStatus = "error";
      lastSyncError  = String(e && e.message || e);
    }finally{
      updateMonitor();
    }
  }

  // =========================
  // ⑤ 初回＆定期更新（表示専用）
  // =========================
  function start(){
    if (!QID) return;

    // 初回
    fetchStateOnce();

    // 定期（必要なら間隔はここで変える）
    setInterval(fetchStateOnce, 5000);

    // オンライン復帰で即時更新
    window.addEventListener("online", function(){ fetchStateOnce(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();