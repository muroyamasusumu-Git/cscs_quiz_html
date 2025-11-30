// assets/cscs_sync_a.js
(function(){
  // === ① QID検出（Aパート） ===
  function detectQidFromLocationA() {
    const m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_a(?:\.html)?$/);
    if (!m) return null;
    const day  = m[1];   // 例: "20250926"
    const num3 = m[2];   // 例: "001"
    // qid 形式を「YYYYMMDD-NNN」に統一
    return day + "-" + num3;
  }
  const QID = detectQidFromLocationA();

  // === ② 差分キュー（Aパート専用） ===
  const queue = { correctDelta: {}, incorrectDelta: {}, streak3Delta: {}, streakLenDelta: {} };
  let sendTimer = null;

  // SYNCモニタ用ステータス
  let lastSyncStatus = "idle";   // "idle" | "sending" | "ok" | "error" | "offline"
  let lastSyncTime   = null;     // "HH:MM:SS"
  let lastSyncError  = "";

  function readLocalTotalsForQid(qid){
    try{
      const kC = "cscs_q_correct_total:" + qid;
      const kW = "cscs_q_wrong_total:"   + qid;
      const c  = parseInt(localStorage.getItem(kC) || "0", 10) || 0;
      const w  = parseInt(localStorage.getItem(kW) || "0", 10) || 0;
      return { c, w };
    }catch(_){
      return { c:0, w:0 };
    }
  }

  function readLocalStreak3ForQid(qid){
    try{
      const kS = "cscs_q_correct_streak3_total:" + qid;
      const s  = parseInt(localStorage.getItem(kS) || "0", 10) || 0;
      return s;
    }catch(_){
      return 0;
    }
  }

  function readLocalStreakLenForQid(qid){
    try{
      const kL = "cscs_q_correct_streak_len:" + qid;
      const l  = parseInt(localStorage.getItem(kL) || "0", 10) || 0;
      return l;
    }catch(_){
      return 0;
    }
  }

  function setServerTotalsForQid(c, i, s3, sLen){
    const el = document.getElementById("cscs_sync_totals");
    if (el) {
      el.dataset.serverC = String(c);
      el.dataset.serverI = String(i);
      if (typeof s3 === "number") {
        el.dataset.serverS3 = String(s3);
      }
      if (typeof sLen === "number") {
        el.dataset.serverSL = String(sLen);
      }
    }
  }

  function updateMonitor(){
    try{
      if (!QID) return;
      const box = document.getElementById("cscs_sync_monitor_a");
      const totalsEl = document.getElementById("cscs_sync_totals");

      const dC = queue.correctDelta[QID]   || 0;
      const dI = queue.incorrectDelta[QID] || 0;

      const local = readLocalTotalsForQid(QID);
      const lc = local.c;
      const li = local.w;

      const ls = readLocalStreak3ForQid(QID);
      const ll = readLocalStreakLenForQid(QID);

      let sc = 0, si = 0, ss = 0, sl = 0;
      if (totalsEl) {
        sc = parseInt(totalsEl.dataset.serverC || "0", 10) || 0;
        si = parseInt(totalsEl.dataset.serverI || "0", 10) || 0;
        ss = parseInt(totalsEl.dataset.serverS3 || "0", 10) || 0;
        sl = parseInt(totalsEl.dataset.serverSL || "0", 10) || 0;
        totalsEl.textContent = "server " + sc + " / " + si;
      }

      const serverProgress = sl % 3;
      const localProgress  = ll % 3;

      const streak3Today = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today)
        ? window.__cscs_sync_state.streak3Today
        : { day: "", unique_q_count: 0 };

      let localStreakDay = "";
      let localStreakCount = 0;
      try{
        localStreakDay = localStorage.getItem("cscs_streak3_today_day") || "";
        const rawLocalCnt = localStorage.getItem("cscs_streak3_today_unique_q_count");
        const parsedLocalCnt = rawLocalCnt == null ? NaN : parseInt(rawLocalCnt, 10);
        if (Number.isFinite(parsedLocalCnt) && parsedLocalCnt >= 0) {
          localStreakCount = parsedLocalCnt;
        }
      }catch(_){}

      if (box) {
        const qEl  = box.querySelector(".sync-qid");

        const s3tDayEl   = box.querySelector(".sync-streak3today-day");
        const s3tSyncEl  = box.querySelector(".sync-streak3today-sync");
        const s3tLocalEl = box.querySelector(".sync-streak3today-local");
        if (s3tDayEl)   s3tDayEl.textContent   = streak3Today.day || "-";
        if (s3tSyncEl)  s3tSyncEl.textContent  = String(streak3Today.unique_q_count || 0);
        if (s3tLocalEl) s3tLocalEl.textContent = String(localStreakCount);

        const lEl  = box.querySelector(".sync-local");
        const qdEl = box.querySelector(".sync-queue");
        const stEl = box.querySelector(".sync-status");
        const s3El = box.querySelector(".sync-streak3-val");
        const s3sEl = box.querySelector(".sync-streak3-server");
        const slEl = box.querySelector(".sync-streaklen-val");
        const slsEl = box.querySelector(".sync-streaklen-server");
        const slsProgEl = box.querySelector(".sync-streaklen-server-progress");
        const sllProgEl = box.querySelector(".sync-streaklen-local-progress");

        if (qEl)   qEl.textContent  = QID;
        if (lEl)   lEl.textContent  = "local  " + lc + " / " + li;
        if (qdEl)  qdEl.textContent = "+Δ    " + dC + " / " + dI;
        if (s3El)  s3El.textContent = String(ls);
        if (s3sEl) s3sEl.textContent = String(ss);

        if (slEl)        slEl.textContent        = String(ll);
        if (slsEl)       slsEl.textContent       = String(sl);
        if (slsProgEl)   slsProgEl.textContent   = String(serverProgress);
        if (sllProgEl)   sllProgEl.textContent   = String(localProgress);

        const time = lastSyncTime ? lastSyncTime : "-";
        const err  = lastSyncError ? (" err:" + lastSyncError) : "";
        if (stEl) stEl.textContent = lastSyncStatus + " (" + time + ")" + err;
      }
    }catch(_){
      // UI更新失敗は握りつぶし
    }
  }

  function scheduleSend(){
    if (!navigator.onLine) {
      lastSyncStatus = "offline";
      updateMonitor();
      return;
    }
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendDelta, 1000);
    updateMonitor();
  }

  async function sendDelta(){
    const hasC  = Object.keys(queue.correctDelta).length>0;
    const hasI  = Object.keys(queue.incorrectDelta).length>0;
    const hasS3 = Object.keys(queue.streak3Delta).length>0;
    const hasSL = Object.keys(queue.streakLenDelta).length>0;
    if (!hasC && !hasI && !hasS3 && !hasSL) return;

    const payload = {
      qid: QID || null,
      correctDelta: queue.correctDelta,
      incorrectDelta: queue.incorrectDelta,
      streak3Delta: queue.streak3Delta,
      streakLenDelta: queue.streakLenDelta,
      updatedAt: Date.now()
    };

    lastSyncStatus = "sending";
    lastSyncError  = "";
    updateMonitor();

    try{
      const res = await fetch("/api/sync/merge", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(String(res.status));

      queue.correctDelta    = {};
      queue.incorrectDelta  = {};
      queue.streak3Delta    = {};
      queue.streakLenDelta  = {};

      const latest = await res.json();

      // SYNC 全体状態を常に最新に保つ（streak3Today も含めて反映）
      try{
        window.__cscs_sync_state = latest;
      }catch(_){}

      if (QID){
        const c   = (latest.correct   && latest.correct[QID])   || 0;
        const i   = (latest.incorrect && latest.incorrect[QID]) || 0;
        const s3  = (latest.streak3   && latest.streak3[QID])   || 0;
        const sl  = (latest.streakLen && latest.streakLen[QID]) || 0;
        setServerTotalsForQid(c, i, s3, sl);
      }
      lastSyncStatus = "ok";
      lastSyncTime   = new Date().toLocaleTimeString();
      lastSyncError  = "";
    }catch(e){
      lastSyncStatus = "error";
      lastSyncError  = String(e && e.message || e);
    }finally{
      updateMonitor();
    }
  }

  window.CSCS_SYNC = {
    recordCorrect(){
      if (!QID) return;
      queue.correctDelta[QID] = (queue.correctDelta[QID] || 0) + 1;
      scheduleSend();
    },
    recordIncorrect(){
      if (!QID) return;
      queue.incorrectDelta[QID] = (queue.incorrectDelta[QID] || 0) + 1;
      scheduleSend();
    },
    recordStreak3(){
      if (!QID) return;
      queue.streak3Delta[QID] = (queue.streak3Delta[QID] || 0) + 1;
      try{
        var ev = new CustomEvent("cscs:streak3-earned", {
          detail: {
            qid: QID,
            ts: Date.now()
          }
        });
        window.dispatchEvent(ev);
      }catch(_){}
      scheduleSend();
    },
    recordStreakLen(){
      if (!QID) return;
      const currentLen = readLocalStreakLenForQid(QID);
      queue.streakLenDelta[QID] = currentLen;
      scheduleSend();
    },
    async fetchServer(){
      const r = await fetch("/api/sync/state");
      if(!r.ok) throw new Error(r.statusText);
      return r.json();
    }
  };

  async function initialFetch(){
    if (!QID) return;
    try{
      const s  = await CSCS_SYNC.fetchServer();
      const c  = (s.correct   && s.correct[QID])   || 0;
      const i  = (s.incorrect && s.incorrect[QID]) || 0;
      const s3 = (s.streak3   && s.streak3[QID])   || 0;
      const sl = (s.streakLen && s.streakLen[QID]) || 0;

      window.__cscs_sync_state = s;

      // ★ 追加: SYNC 側 streak3Today を正として localStorage 側も同期する
      const streak3Today = (s && s.streak3Today)
        ? s.streak3Today
        : { day: "", unique_q_count: 0, qids: [] };

      try{
        if (streak3Today.day) {
          localStorage.setItem("cscs_streak3_today_day", String(streak3Today.day));
        } else {
          localStorage.removeItem("cscs_streak3_today_day");
        }
        localStorage.setItem(
          "cscs_streak3_today_unique_q_count",
          String(streak3Today.unique_q_count || 0)
        );
        if (Array.isArray(streak3Today.qids)) {
          localStorage.setItem(
            "cscs_streak3_today_qids",
            JSON.stringify(streak3Today.qids)
          );
        } else {
          localStorage.removeItem("cscs_streak3_today_qids");
        }
      }catch(_){}

      setServerTotalsForQid(c, i, s3, sl);

      try{
        localStorage.setItem("cscs_q_correct_total:" + QID, String(c));
        localStorage.setItem("cscs_q_wrong_total:"   + QID, String(i));
        localStorage.setItem("cscs_q_correct_streak3_total:" + QID, String(s3));
        localStorage.setItem("cscs_q_correct_streak_len:" + QID, String(sl));
      }catch(_){}

      lastSyncStatus = "pulled";
      lastSyncTime   = new Date().toLocaleTimeString();
      lastSyncError  = "";
    }catch(e){
      lastSyncStatus = "error";
      lastSyncError  = String(e && e.message || e);
    }finally{
      updateMonitor();
    }
  }

  async function resetSyncForThisQid(showAlert, doFetch){
    if (showAlert === undefined) showAlert = true;
    if (doFetch === undefined) doFetch = true;
    if (!QID) return;
    try{
      await fetch("/api/sync/reset_qid", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ qid: QID })
      });

      try{
        const kCorNow  = "cscs_q_correct_total:" + QID;
        const kWrgNow  = "cscs_q_wrong_total:"   + QID;
        const kCorLast = "cscs_sync_last_c:"     + QID;
        const kWrgLast = "cscs_sync_last_w:"     + QID;

        localStorage.setItem(kCorNow,  "0");
        localStorage.setItem(kWrgNow,  "0");
        localStorage.setItem(kCorLast, "0");
        localStorage.setItem(kWrgLast, "0");
      }catch(_){}

      if (doFetch) {
        await initialFetch();
      }
      if (showAlert) {
        alert("この問題のSYNCカウンタをリセットしました。");
      }
    }catch(e){
      if (showAlert) {
        alert("reset 失敗: " + e);
      } else {
        console.warn("reset_qid 失敗:", e);
      }
    }
  }

  async function resetStarForThisQid(showAlert){
    if (showAlert === undefined) showAlert = true;
    if (!QID) return;
    try{
      try{
        await fetch("/api/sync/reset_streak3_qid", {
          method:"POST",
          headers:{ "content-type":"application/json" },
          body: JSON.stringify({ qid: QID })
        });
      }catch(_){}

      const kStreakLen    = "cscs_q_correct_streak_len:" + QID;
      const kStreakTotal  = "cscs_q_correct_streak3_total:" + QID;
      const kStreakLastS3 = "cscs_sync_last_s3:" + QID;
      try{
        localStorage.removeItem(kStreakLen);
        localStorage.removeItem(kStreakTotal);
        localStorage.setItem(kStreakLastS3, "0");
      }catch(_){}

      const logKey = "cscs_correct_streak3_log";
      try{
        const raw = localStorage.getItem(logKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(function(entry){
              if (!entry || typeof entry !== "object") return true;
              if (!("qid" in entry)) return true;
              return entry.qid !== QID;
            });
            localStorage.setItem(logKey, JSON.stringify(filtered));
          }
        }
      }catch(_){}

      try{
        const totalsEl = document.getElementById("cscs_sync_totals");
        if (totalsEl) {
          const sc = parseInt(totalsEl.dataset.serverC || "0", 10) || 0;
          const si = parseInt(totalsEl.dataset.serverI || "0", 10) || 0;
          setServerTotalsForQid(sc, si, 0);
        }
      }catch(_){}

      try{
        const stars = document.querySelectorAll(".correct_star");
        stars.forEach(function(el){
          el.style.display = "none";
        });
      }catch(_){}

      updateMonitor();

      if (showAlert) {
        alert("この問題の星データをリセットしました。");
      }
    }catch(e){
      if (showAlert) {
        alert("星データのリセットに失敗しました: " + e);
      } else {
        console.warn("reset_streak3_qid 失敗:", e);
      }
    }
  }

  async function resetStreak3TodayAll(showAlert){
    if (showAlert === undefined) showAlert = true;
    try{
      await fetch("/api/sync/reset_streak3_today", {
        method:"POST",
        headers:{ "content-type":"application/json" }
      });

      try{
        localStorage.removeItem("cscs_streak3_today_day");
        localStorage.removeItem("cscs_streak3_today_unique_q_count");
        localStorage.removeItem("cscs_streak3_today_qids");
      }catch(_){}

      if (showAlert) {
        alert("今日の 3連続正解ユニーク数（SYNC と local の両方）をリセットしました。");
      }

      try{
        const s = await CSCS_SYNC.fetchServer();
        window.__cscs_sync_state = s;
        updateMonitor();
      }catch(_){}
    }catch(e){
      if (showAlert) {
        alert("reset_streak3_today 失敗: " + e);
      } else {
        console.warn("reset_streak3_today 失敗:", e);
      }
    }
  }

  window.addEventListener("DOMContentLoaded", function(){
    if (!QID) return;
    try{
      const box = document.createElement("div");
      box.id = "cscs_sync_monitor_a";
      box.innerHTML = `
        <div class="sync-header">SYNC(A): <span class="sync-qid"></span></div>
        <div id="cscs_sync_totals" class="sync-line sync-totals" data-server-c="0" data-server-i="0">server 0 / 0</div>
        <div class="sync-line sync-local">local  0 / 0</div>
        <div class="sync-line sync-queue">+Δ    0 / 0</div>
        <div class="sync-line sync-streak3">
          3連続正解回数:<br>
          SYNC <span class="sync-streak3-server">0</span> 回 / local <span class="sync-streak3-val">0</span> 回
        </div>
        <div class="sync-line sync-streaklen">
          3連続正解回数 (進捗):<br>
          SYNC <span class="sync-streaklen-server">0</span> (<span class="sync-streaklen-server-progress">0</span>/3) /
          local <span class="sync-streaklen-val">0</span> (<span class="sync-streaklen-local-progress">0</span>/3)
        </div>

        <div class="sync-line sync-streak3today">
          今日の 3連続正解ユニーク数:<br>
          day: <span class="sync-streak3today-day">-</span><br>
          unique: sync <span class="sync-streak3today-sync">0</span> / local <span class="sync-streak3today-local">0</span>
        </div>

        <div class="sync-line sync-status-row">status: <span class="sync-status">idle (-)</span></div>
        
        <div class="sync-reset-row">            
          <button id="cscs_sync_test_reset" type="button" class="sync-reset-button">reset this qid</button>
          <button id="cscs_sync_star_reset" type="button" class="sync-reset-button">reset stars</button>
          <button id="cscs_sync_streak3today_reset" type="button" class="sync-reset-button">reset today streak</button>
          <button id="cscs_sync_all_reset" type="button" class="sync-reset-button">reset all</button>
        </div>
      `;
      const wrap = document.querySelector("div.wrap");
      if (wrap) {
        wrap.appendChild(box);
      } else {
        document.body.appendChild(box);
      }

      const btnOk   = document.getElementById("cscs_sync_test_ok");
      const btnNg   = document.getElementById("cscs_sync_test_ng");
      const btnReset  = document.getElementById("cscs_sync_test_reset");
      const btnStarReset = document.getElementById("cscs_sync_star_reset");
      const btnStreakTodayReset = document.getElementById("cscs_sync_streak3today_reset");
      const btnAllReset = document.getElementById("cscs_sync_all_reset");

      if (btnReset) {
        btnReset.addEventListener("click", function(){
          resetSyncForThisQid(true, true);
        });
      }

      if (btnStarReset) {
        btnStarReset.addEventListener("click", function(){
          resetStarForThisQid(true);
        });
      }

      if (btnStreakTodayReset) {
        btnStreakTodayReset.addEventListener("click", function(){
          resetStreak3TodayAll(true);
        });
      }

      if (btnAllReset) {
        btnAllReset.addEventListener("click", async function(){
          if (!QID) return;
          const ok = window.confirm("この問題のSYNCカウンタ・星・今日の3連続正解ユニーク数をすべてリセットします。よろしいですか？");
          if (!ok) return;
          await resetSyncForThisQid(false, false);
          await resetStarForThisQid(false);
          await resetStreak3TodayAll(false);
          await initialFetch();
          alert("この問題に関するSYNCカウンタ・星・今日の3連続正解ユニーク数をすべてリセットしました。");
        });
      }

      if (btnOk)   btnOk.addEventListener("click", () => window.CSCS_SYNC.recordCorrect());
      if (btnNg)   btnNg.addEventListener("click", () => window.CSCS_SYNC.recordIncorrect());
    }catch(_){}
    initialFetch();
  });

  window.addEventListener("online", function(){
    lastSyncStatus = "idle";
    sendDelta();
  });
  window.addEventListener("offline", function(){
    lastSyncStatus = "offline";
    updateMonitor();
  });
})();