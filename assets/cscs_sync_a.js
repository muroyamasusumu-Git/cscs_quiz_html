// assets/cscs_sync_a.js
/**
 * CSCS SYNC(A) — Aパート用 SYNC モニタ＆送信キュー
 *
 * このファイルで使用する LocalStorage / SYNC(JSON) / payload の
 * キー対応表をここに一覧する。
 *
 * 【重要：開発ルール（恒久）】
 *   📌 このファイル内で LocalStorage / SYNC / payload のキー名に
 *       「変更」または「新規追加」が発生した場合は、
 *       必ず **このキー対応表コメントを更新すること**。
 *
 *   - b_judge_record.js・SYNC Worker（merge/state.ts）側と
 *     キー仕様の不整合が生じることを防ぐ目的。
 *   - ここに書かれていないキーは原則として使用禁止。
 *
 * ▼ 問題別累計（正解 / 不正解）
 *   - localStorage:
 *       "cscs_q_correct_total:" + qid
 *       "cscs_q_wrong_total:"   + qid
 *   - SYNC state:
 *       state.correct[qid]
 *       state.incorrect[qid]
 *   - payload(merge):
 *       correctDelta[qid]
 *       incorrectDelta[qid]
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage:
 *       "cscs_q_correct_streak3_total:" + qid
 *       "cscs_q_correct_streak_len:"    + qid
 *   - SYNC state:
 *       state.streak3[qid]
 *       state.streakLen[qid]
 *   - payload(merge):
 *       streak3Delta[qid]
 *       streakLenDelta[qid]   // 「増分」ではなく「最新値」を送る
 *
 * ▼ 問題別 3 連続不正解
 *   - localStorage:
 *       "cscs_q_wrong_streak3_total:" + qid
 *       "cscs_q_wrong_streak_len:"    + qid
 *   - SYNC state:
 *       state.streak3Wrong[qid]
 *       state.streakWrongLen[qid]
 *   - payload(merge):
 *       streak3WrongDelta[qid]
 *       streakWrongLenDelta[qid]   // 「増分」ではなく「最新値」を送る
 *
 * ▼ 今日の⭐️ユニーク数（Streak3Today）
 *   - localStorage:
 *       "cscs_streak3_today_day"
 *       "cscs_streak3_today_unique_count"
 *       "cscs_streak3_today_qids"
 *   - SYNC state:
 *       state.streak3Today.day
 *       state.streak3Today.unique_count
 *       state.streak3Today.qids
 *
 * ▼ 1 日 1 回計測モード（oncePerDayToday）
 *   - localStorage:
 *       "cscs_once_per_day_today_day"
 *       "cscs_once_per_day_today_results"
 *   - SYNC state:
 *       state.oncePerDayToday.day
 *       state.oncePerDayToday.results[qid]
 *
 * ▼ デバッグ用ローカルログ
 *   - localStorage:
 *       "cscs_sync_last_c:"  + qid
 *       "cscs_sync_last_w:"  + qid
 *       "cscs_sync_last_s3:" + qid
 *       "cscs_correct_streak3_log"
 *
 * ▼ 使用する主な API エンドポイント
 *   - GET  /api/sync/state
 *   - POST /api/sync/merge
 *   - POST /api/sync/reset_qid
 *   - POST /api/sync/reset_streak3_qid
 *   - POST /api/sync/reset_streak3_today
 *   - POST /api/sync/reset_once_per_day_today
 *   - POST /api/sync/reset_all_qid
 */
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
  //   - correctDelta / incorrectDelta: 正解・不正解の累計差分
  //   - streak3Delta / streakLenDelta: 3連続「正解」回数と現在の連続正解長
  //   - streak3WrongDelta / streakWrongLenDelta: 3連続「不正解」回数と現在の連続不正解長
  const queue = {
    correctDelta: {},
    incorrectDelta: {},
    streak3Delta: {},
    streakLenDelta: {},
    streak3WrongDelta: {},
    streakWrongLenDelta: {}
  };
  let sendTimer = null;

  // SYNCモニタ用ステータス
  let lastSyncStatus = "idle";   // "idle" | "sending" | "ok" | "error" | "offline"
  let lastSyncTime   = null;     // "HH:MM:SS"
  let lastSyncError  = "";

  // ★ 不正解ストリーク表示の初回ログ用フラグ
  //   - updateMonitor() 内で一度だけ「不正解ストリーク UI が有効になっている」ことを
  //     コンソールに出すための状態。
  let loggedWrongStreakUiOnce = false;

  // ★ デバッグUI方針ログ用フラグ
  //   - 「不正解ストリークはまだモニタに出していない」ポリシーを
  //     コンソールに一度だけ明示するための状態。
  //   - updateMonitor() 内で一度だけ true にして以降はログを出さない。
  let loggedWrongStreakUiPolicy = false;

  // 空欄を「（データなし）」などで埋めるための共通ヘルパー
  function toDisplayText(value, emptyLabel){
    const fallback = emptyLabel != null ? String(emptyLabel) : "（データなし）";
    if (value === null || value === undefined) {
      return fallback;
    }
    const s = String(value);
    if (s.trim() === "") {
      return fallback;
    }
    return s;
  }

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

  // ★ 不正解側: localStorage から「3連続不正解回数」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak3_total:{qid}" に加算した値をそのまま利用
  function readLocalWrongStreak3ForQid(qid){
    try{
      const kS = "cscs_q_wrong_streak3_total:" + qid;
      const s  = parseInt(localStorage.getItem(kS) || "0", 10) || 0;
      return s;
    }catch(_){
      return 0;
    }
  }

  // ★ 不正解側: localStorage から「現在の連続不正解長」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_len:{qid}" に保存している最新値
  function readLocalWrongStreakLenForQid(qid){
    try{
      const kL = "cscs_q_wrong_streak_len:" + qid;
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

      // ★ 不正解ストリーク（localStorage）の読み取り
      //   - b_judge_record.js が書き込んでいる
      //     "cscs_q_wrong_streak3_total:{qid}"
      //     "cscs_q_wrong_streak_len:{qid}"
      //     をそのまま UI に出す。
      const lsWrong = readLocalWrongStreak3ForQid(QID);
      const llWrong = readLocalWrongStreakLenForQid(QID);

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

      // ★ 不正解ストリーク（SYNC 側）の最新値を __cscs_sync_state から取得
      let ssWrong = 0;
      let slWrong = 0;
      try{
        const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
          ? window.__cscs_sync_state
          : null;
        if (state && state.streak3Wrong && typeof state.streak3Wrong === "object") {
          const v = state.streak3Wrong[QID];
          if (typeof v === "number" && v >= 0) {
            ssWrong = v;
          }
        }
        if (state && state.streakWrongLen && typeof state.streakWrongLen === "object") {
          const v2 = state.streakWrongLen[QID];
          if (typeof v2 === "number" && v2 >= 0) {
            slWrong = v2;
          }
        }
      }catch(_){}

      const serverWrongProgress = slWrong % 3;
      const localWrongProgress  = llWrong % 3;

      // ★ 初回だけ、不正解ストリーク UI の値をコンソールにログ出し
      if (!loggedWrongStreakUiOnce) {
        console.log("[SYNC-A] wrong-streak monitor enabled", {
          qid: QID,
          localWrongStreak3Total: lsWrong,
          localWrongStreakLen: llWrong,
          serverWrongStreak3Total: ssWrong,
          serverWrongStreakLen: slWrong
        });
        loggedWrongStreakUiOnce = true;
      }

      const streak3Today = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today)
        ? window.__cscs_sync_state.streak3Today
        : { day: "", unique_count: 0 };

      let localStreakDay = "";
      let localStreakCount = 0;
      try{
        localStreakDay = localStorage.getItem("cscs_streak3_today_day") || "";
        const rawLocalCnt = localStorage.getItem("cscs_streak3_today_unique_count");
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
        if (s3tDayEl) {
          s3tDayEl.textContent = toDisplayText(streak3Today.day, "（データなし）");
        }
        if (s3tSyncEl) {
          // unique_count 自体が欠損している場合のみ「（データなし）」を表示
          s3tSyncEl.textContent = toDisplayText(
            typeof streak3Today.unique_count === "number" ? streak3Today.unique_count : "",
            "（データなし）"
          );
        }
        if (s3tLocalEl) {
          s3tLocalEl.textContent = toDisplayText(
            Number.isFinite(localStreakCount) ? localStreakCount : "",
            "（データなし）"
          );
        }

        const lEl  = box.querySelector(".sync-local");
        const qdEl = box.querySelector(".sync-queue");
        const stEl = box.querySelector(".sync-status");
        const s3El = box.querySelector(".sync-streak3-val");
        const s3sEl = box.querySelector(".sync-streak3-server");
        const slEl = box.querySelector(".sync-streaklen-val");
        const slsEl = box.querySelector(".sync-streaklen-server");
        const slsProgEl = box.querySelector(".sync-streaklen-server-progress");
        const sllProgEl = box.querySelector(".sync-streaklen-local-progress");

        // ★ 不正解ストリーク用 DOM 取得
        const s3wEl  = box.querySelector(".sync-wrong-streak3-val");
        const s3wsEl = box.querySelector(".sync-wrong-streak3-server");
        const slwEl  = box.querySelector(".sync-wrong-streaklen-val");
        const slwsEl = box.querySelector(".sync-wrong-streaklen-server");
        const slwsProgEl = box.querySelector(".sync-wrong-streaklen-server-progress");
        const sllwProgEl = box.querySelector(".sync-wrong-streaklen-local-progress");

        if (qEl)   qEl.textContent  = QID ? QID : "（データなし）";
        if (lEl)   lEl.textContent  = "local  " + lc + " / " + li;
        if (qdEl)  qdEl.textContent = "+Δ    " + dC + " / " + dI;
        if (s3El)  s3El.textContent = String(ls);
        if (s3sEl) s3sEl.textContent = String(ss);

        if (slEl)        slEl.textContent        = String(ll);
        if (slsEl)       slsEl.textContent       = String(sl);
        if (slsProgEl)   slsProgEl.textContent   = String(serverProgress);
        if (sllProgEl)   sllProgEl.textContent   = String(localProgress);

        // ★ 不正解ストリークの値を UI に反映
        if (s3wEl)  s3wEl.textContent  = String(lsWrong);
        if (s3wsEl) s3wsEl.textContent = String(ssWrong);
        if (slwEl)  slwEl.textContent  = String(llWrong);
        if (slwsEl) slwsEl.textContent = String(slWrong);
        if (slwsProgEl) slwsProgEl.textContent = String(serverWrongProgress);
        if (sllwProgEl) sllwProgEl.textContent  = String(localWrongProgress);

        const time = lastSyncTime ? lastSyncTime : "-";
        const err  = lastSyncError ? (" err:" + lastSyncError) : "";

        // oncePerDayToday の計測状況をステータス文字列に付加する
        let onceLabel = "";
        try{
          const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
            ? window.__cscs_sync_state
            : null;

          let todayYmd = null;
          try{
            const now = new Date();
            const yy = now.getFullYear();
            const mm = now.getMonth() + 1;
            const dd = now.getDate();
            todayYmd = yy * 10000 + mm * 100 + dd;
          }catch(_eDate){
            todayYmd = null;
          }

          const once = state && state.oncePerDayToday && typeof state.oncePerDayToday === "object"
            ? state.oncePerDayToday
            : null;

          if (
            once &&
            typeof once.day === "number" &&
            todayYmd !== null &&
            once.day === todayYmd &&
            once.results &&
            typeof once.results === "object"
          ) {
            const r = once.results[QID];
            if (r === "correct" || r === "wrong") {
              onceLabel = " / oncePerDayToday: 計測済(" + r + ")";
            } else if (Object.prototype.hasOwnProperty.call(once.results, QID)) {
              onceLabel = " / oncePerDayToday: 計測済(unknown)";
            } else {
              onceLabel = " / oncePerDayToday: 未計測";
            }
          } else {
            onceLabel = " / oncePerDayToday: 未計測";
          }
        }catch(_eOnce){
          // oncePerDayToday 表示に失敗してもステータス自体は出す
          onceLabel = "";
        }

        if (stEl) stEl.textContent = lastSyncStatus + " (" + time + ")" + err + onceLabel;
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
    const hasC   = Object.keys(queue.correctDelta).length>0;
    const hasI   = Object.keys(queue.incorrectDelta).length>0;
    const hasS3  = Object.keys(queue.streak3Delta).length>0;
    const hasSL  = Object.keys(queue.streakLenDelta).length>0;
    const hasS3W = Object.keys(queue.streak3WrongDelta).length>0;
    const hasSLW = Object.keys(queue.streakWrongLenDelta).length>0;

    // ★ 6種類のいずれの delta も空なら、送信する意味がないので終了
    if (!hasC && !hasI && !hasS3 && !hasSL && !hasS3W && !hasSLW) {
      return;
    }

    const payload = {
      qid: QID || null,
      correctDelta: queue.correctDelta,
      incorrectDelta: queue.incorrectDelta,
      streak3Delta: queue.streak3Delta,
      streakLenDelta: queue.streakLenDelta,
      // ★ 追加: 不正解側ストリークの delta も Workers へ送る
      streak3WrongDelta: queue.streak3WrongDelta,
      streakWrongLenDelta: queue.streakWrongLenDelta,
      updatedAt: Date.now()
    };

    // 送信前に、今回送る delta の中身をコンソールで確認できるようにする
    console.log("[SYNC-A] sendDelta payload(prepare)", {
      qid: QID,
      hasCorrectDelta: hasC,
      hasIncorrectDelta: hasI,
      hasStreak3Delta: hasS3,
      hasStreakLenDelta: hasSL,
      hasStreak3WrongDelta: hasS3W,
      hasStreakWrongLenDelta: hasSLW,
      payload: payload
    });

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

      queue.correctDelta       = {};
      queue.incorrectDelta     = {};
      queue.streak3Delta       = {};
      queue.streakLenDelta     = {};
      queue.streak3WrongDelta  = {};
      queue.streakWrongLenDelta = {};

      const latest = await res.json();

      // SYNC 全体状態を常に最新に保つ（streak3Today も含めて反映）
      try{
        window.__cscs_sync_state = latest;
      }catch(_){}

      if (QID){
        const c   = (latest.correct       && latest.correct[QID])       || 0;
        const i   = (latest.incorrect     && latest.incorrect[QID])     || 0;
        const s3  = (latest.streak3       && latest.streak3[QID])       || 0;
        const sl  = (latest.streakLen     && latest.streakLen[QID])     || 0;
        const s3W = (latest.streak3Wrong  && latest.streak3Wrong[QID])  || 0;
        const slW = (latest.streakWrongLen && latest.streakWrongLen[QID]) || 0;

        setServerTotalsForQid(c, i, s3, sl);

        // ★ 不正解ストリークのサーバー側最新値もコンソールに出しておく
        console.log("[SYNC-A] sendDelta merged server snapshot for this QID", {
          qid: QID,
          correctTotal: c,
          wrongTotal: i,
          streak3Correct: s3,
          streakLenCorrect: sl,
          streak3Wrong: s3W,
          streakLenWrong: slW
        });
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
    // ★ 正解1回分の計測を SYNC キューに積む（累計 correctDelta）
    recordCorrect(){
      if (!QID) return;
      queue.correctDelta[QID] = (queue.correctDelta[QID] || 0) + 1;
      console.log("[SYNC-A] recordCorrect queued", {
        qid: QID,
        delta: queue.correctDelta[QID]
      });
      scheduleSend();
    },

    // ★ 不正解1回分の計測を SYNC キューに積む（累計 incorrectDelta）
    recordIncorrect(){
      if (!QID) return;
      queue.incorrectDelta[QID] = (queue.incorrectDelta[QID] || 0) + 1;
      console.log("[SYNC-A] recordIncorrect queued", {
        qid: QID,
        delta: queue.incorrectDelta[QID]
      });
      scheduleSend();
    },

    // ★ 3連続「正解」達成回数を 1 回分キューに積む
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
      console.log("[SYNC-A] recordStreak3 queued", {
        qid: QID,
        delta: queue.streak3Delta[QID]
      });
      scheduleSend();
    },

    // ★ 3連続「不正解」達成回数を 1 回分キューに積む
    recordWrongStreak3(){
      if (!QID) return;
      queue.streak3WrongDelta[QID] = (queue.streak3WrongDelta[QID] || 0) + 1;
      try{
        var ev = new CustomEvent("cscs:wrong-streak3-earned", {
          detail: {
            qid: QID,
            ts: Date.now()
          }
        });
        window.dispatchEvent(ev);
      }catch(_){}
      console.log("[SYNC-A] recordWrongStreak3 queued", {
        qid: QID,
        delta: queue.streak3WrongDelta[QID]
      });
      scheduleSend();
    },

    // ★ 現在の「連続正解長」を SYNC 側 streakLen[qid] に同期するための値としてキューに積む
    recordStreakLen(){
      if (!QID) return;
      const currentLen = readLocalStreakLenForQid(QID);
      queue.streakLenDelta[QID] = currentLen;
      console.log("[SYNC-A] recordStreakLen queued", {
        qid: QID,
        streakLen: currentLen
      });
      scheduleSend();
    },

    // ★ 現在の「連続不正解長」を SYNC 側 streakWrongLen[qid] に同期するための値としてキューに積む
    recordWrongStreakLen(){
      if (!QID) return;
      const currentLenWrong = readLocalWrongStreakLenForQid(QID);
      queue.streakWrongLenDelta[QID] = currentLenWrong;
      console.log("[SYNC-A] recordWrongStreakLen queued", {
        qid: QID,
        streakWrongLen: currentLenWrong
      });
      scheduleSend();
    },

    // ★ /api/sync/state から SYNC 全体状態を取得するユーティリティ
    async fetchServer(){
      const r = await fetch("/api/sync/state");
      if(!r.ok) throw new Error(r.statusText);
      const json = await r.json();
      console.log("[SYNC-A] fetchServer state fetched", {
        hasCorrect: !!(json && json.correct),
        hasIncorrect: !!(json && json.incorrect),
        hasStreak3: !!(json && json.streak3),
        hasStreakLen: !!(json && json.streakLen),
        hasStreak3Wrong: !!(json && json.streak3Wrong),
        hasStreakWrongLen: !!(json && json.streakWrongLen)
      });
      return json;
    }
  };

  async function initialFetch(){
    if (!QID) return;
    try{
      const s  = await CSCS_SYNC.fetchServer();
      const c  = (s.correct       && s.correct[QID])       || 0;
      const i  = (s.incorrect     && s.incorrect[QID])     || 0;
      const s3 = (s.streak3       && s.streak3[QID])       || 0;
      const sl = (s.streakLen     && s.streakLen[QID])     || 0;
      const s3W = (s.streak3Wrong && s.streak3Wrong[QID])  || 0;
      const slW = (s.streakWrongLen && s.streakWrongLen[QID]) || 0;

      window.__cscs_sync_state = s;

      // oncePerDayToday 情報を参照して、
      // 「今日この QID が oncePerDay 計測済みかどうか」をコンソールに出す
      try{
        var once = (s && s.oncePerDayToday && typeof s.oncePerDayToday === "object")
          ? s.oncePerDayToday
          : null;

        var todayYmd = null;
        try{
          var now = new Date();
          var yy = now.getFullYear();
          var mm = now.getMonth() + 1;
          var dd = now.getDate();
          todayYmd = yy * 10000 + mm * 100 + dd;  // 例: 20251203
        }catch(_eDate){
          todayYmd = null;
        }

        var onceLogPayload = {
          qid: QID,
          todayYmd: todayYmd,
          onceDay: once && typeof once.day === "number" ? once.day : null,
          onceResult: null,
          measuredToday: false
        };

        if (
          once &&
          typeof once.day === "number" &&
          todayYmd !== null &&
          once.day === todayYmd &&
          once.results &&
          typeof once.results === "object"
        ) {
          var r = once.results[QID];
          if (r === "correct" || r === "wrong") {
            onceLogPayload.onceResult = r;
            onceLogPayload.measuredToday = true;
          } else if (Object.prototype.hasOwnProperty.call(once.results, QID)) {
            // 値が "correct"/"wrong" 以外でも「何らかの計測済み」として扱う
            onceLogPayload.onceResult = String(r);
            onceLogPayload.measuredToday = true;
          }
        }

        if (onceLogPayload.measuredToday) {
          console.log("[SYNC-A:oncePerDay] this qid is ALREADY measured today", onceLogPayload);
        } else {
          console.log("[SYNC-A:oncePerDay] this qid is NOT measured today (or oncePerDayToday.day != today)", onceLogPayload);
        }
      }catch(_eOnce){
        console.log("[SYNC-A:oncePerDay] oncePerDayToday check skipped (error)", _eOnce);
      }

      // ★ 追加: SYNC 側 streak3Today を正として localStorage 側も同期する
      const streak3Today = (s && s.streak3Today)
        ? s.streak3Today
        : { day: "", unique_count: 0, qids: [] };

      try{
        if (streak3Today.day) {
          localStorage.setItem("cscs_streak3_today_day", String(streak3Today.day));
        } else {
          localStorage.removeItem("cscs_streak3_today_day");
        }
        localStorage.setItem(
          "cscs_streak3_today_unique_count",
          String(streak3Today.unique_count || 0)
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
        // ★ 不正解ストリークも SYNC 側を正として localStorage に初期同期する
        localStorage.setItem("cscs_q_wrong_streak3_total:" + QID, String(s3W));
        localStorage.setItem("cscs_q_wrong_streak_len:" + QID, String(slW));
        console.log("[SYNC-A] initialFetch synced streak values from server to localStorage", {
          qid: QID,
          correctTotal: c,
          wrongTotal: i,
          streak3Correct: s3,
          streakLenCorrect: sl,
          streak3Wrong: s3W,
          streakLenWrong: slW
        });
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

      // 1) localStorage 側の今日の 3連続正解ユニーク数を削除
      try{
        localStorage.removeItem("cscs_streak3_today_day");
        localStorage.removeItem("cscs_streak3_today_unique_count");
        localStorage.removeItem("cscs_streak3_today_qids");
      }catch(_){}

      // 2) クライアント側の SYNC スナップショットも「streak3Today を空」に更新（デバッグ専用）
      try{
        if (!window.__cscs_sync_state || typeof window.__cscs_sync_state !== "object") {
          window.__cscs_sync_state = {};
        }
        window.__cscs_sync_state.streak3Today = {
          day: "",
          unique_count: 0,
          qids: []
        };
      }catch(_){}

      // 3) サーバー側の最新状態を /api/sync/state から取り直して上書き（streak3Today も含めて確認）
      try{
        const s = await CSCS_SYNC.fetchServer();
        window.__cscs_sync_state = s;
      }catch(_){}

      // 4) モニタ表示を最新状態で再描画
      updateMonitor();

      if (showAlert) {
        alert("今日の 3連続正解ユニーク数（SYNC と local の両方）をリセットしました。");
      }
    }catch(e){
      if (showAlert) {
        alert("reset_streak3_today 失敗: " + e);
      } else {
        console.warn("reset_streak3_today 失敗:", e);
      }
    }
  }

  // oncePerDayToday（1日1問カウント）用の SYNC + local リセット（デバッグ専用）
  async function resetOncePerDayTodayAll(showAlert){
    if (showAlert === undefined) showAlert = true;
    try{
      console.log("[SYNC-A:oncePerDay] reset_once_per_day_today START");

      // 1) Workers 側の oncePerDayToday をリセット（デバッグ用エンドポイント想定）
      const res = await fetch("/api/sync/reset_once_per_day_today", {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }

      // 2) localStorage 側の oncePerDayToday 情報を削除
      try{
        localStorage.removeItem("cscs_once_per_day_today_day");
        localStorage.removeItem("cscs_once_per_day_today_results");
      }catch(_){}

      // 3) クライアント側 snapshot の oncePerDayToday を一旦クリア
      try{
        if (!window.__cscs_sync_state || typeof window.__cscs_sync_state !== "object") {
          window.__cscs_sync_state = {};
        }
        window.__cscs_sync_state.oncePerDayToday = {
          day: null,
          results: {}
        };
      }catch(_){}

      // 4) サーバー側の最新状態を取り直して、oncePerDayToday も含めて上書き
      try{
        const s = await CSCS_SYNC.fetchServer();
        window.__cscs_sync_state = s;
      }catch(_){}

      // 5) モニタを最新状態で再描画
      updateMonitor();

      console.log("[SYNC-A:oncePerDay] reset_once_per_day_today completed (SYNC + local cleared)");
      if (showAlert) {
        alert("oncePerDayToday（SYNC と local の両方）をリセットしました。");
      }
    }catch(e){
      console.warn("[SYNC-A:oncePerDay] reset_once_per_day_today failed:", e);
      if (showAlert) {
        alert("reset_once_per_day_today 失敗: " + e);
      }
    }
  }

  // ★ デバッグ専用: 全ての qid の計測系 SYNC + local 記録を一括リセットする
  //   - 本仕様のユーザー機能ではなく、開発・検証用のみに使用することを想定
  async function resetAllQidSyncAndLocal(showAlert){
    if (showAlert === undefined) showAlert = true;
    try{
      console.log("[SYNC-A:debug] reset_all_qid START");

      // 1) Workers 側で全qidの計測系データをリセットする（デバッグ用エンドポイント想定）
      const res = await fetch("/api/sync/reset_all_qid", {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }

      // 2) localStorage 側の計測系キーを全て削除
      let removedKeys = 0;
      try{
        const prefixes = [
          "cscs_q_correct_total:",
          "cscs_q_wrong_total:",
          "cscs_q_correct_streak3_total:",
          "cscs_q_correct_streak_len:",
          "cscs_q_wrong_streak3_total:",
          "cscs_q_wrong_streak_len:",
          "cscs_sync_last_c:",
          "cscs_sync_last_w:",
          "cscs_sync_last_s3:"
        ];

        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (!key) continue;
          for (let j = 0; j < prefixes.length; j++) {
            if (key.indexOf(prefixes[j]) === 0) {
              localStorage.removeItem(key);
              removedKeys++;
              break;
            }
          }
        }

        const globalKeys = [
          "cscs_streak3_today_day",
          "cscs_streak3_today_unique_count",
          "cscs_streak3_today_qids",
          "cscs_once_per_day_today_day",
          "cscs_once_per_day_today_results",
          "cscs_correct_streak3_log"
        ];
        for (let g = 0; g < globalKeys.length; g++) {
          try{
            if (localStorage.getItem(globalKeys[g]) !== null) {
              localStorage.removeItem(globalKeys[g]);
              removedKeys++;
            }
          }catch(_){}
        }
      }catch(_){}

      // 3) クライアント側 snapshot を一旦クリアしてから /api/sync/state を取り直す
      try{
        window.__cscs_sync_state = {};
      }catch(_){}

      try{
        const s = await CSCS_SYNC.fetchServer();
        window.__cscs_sync_state = s;
      }catch(_){}

      // 4) モニタを最新状態で再描画
      updateMonitor();

      console.log("[SYNC-A:debug] reset_all_qid COMPLETED", {
        removedLocalKeys: removedKeys
      });

      if (showAlert) {
        alert("全ての問題(qid)の計測系 SYNC と local 記録をリセットしました（デバッグ専用）。");
      }
    }catch(e){
      console.warn("[SYNC-A:debug] reset_all_qid FAILED:", e);
      if (showAlert) {
        alert("reset_all_qid 失敗: " + e);
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
        <div class="sync-reset-row">            
          <button id="cscs_sync_test_reset" type="button" class="sync-reset-button">reset this qid</button>
          <button id="cscs_sync_star_reset" type="button" class="sync-reset-button">reset stars</button>
          <button id="cscs_sync_streak3today_reset" type="button" class="sync-reset-button">reset today streak</button>
          <button id="cscs_sync_onceperday_reset" type="button" class="sync-reset-button">reset oncePerDay</button>
          <button id="cscs_sync_all_reset" type="button" class="sync-reset-button">reset all</button>
          <!-- <button id="cscs_sync_all_qid_reset" type="button" class="sync-reset-button">⚠︎reset all qid</button> -->
        </div>        
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

        <div class="sync-line sync-wrong-streak3">
          3連続不正解回数:<br>
          SYNC <span class="sync-wrong-streak3-server">0</span> 回 / local <span class="sync-wrong-streak3-val">0</span> 回
        </div>
        <div class="sync-line sync-wrong-streaklen">
          3連続不正解回数 (進捗):<br>
          SYNC <span class="sync-wrong-streaklen-server">0</span> (<span class="sync-wrong-streaklen-server-progress">0</span>/3) /
          local <span class="sync-wrong-streaklen-val">0</span> (<span class="sync-wrong-streaklen-local-progress">0</span>/3)
        </div>

        <div class="sync-line sync-streak3today">
          Streak3TodayUnique:<br>
          day: <span class="sync-streak3today-day">-</span><br>
          unique: sync <span class="sync-streak3today-sync">0</span> / local <span class="sync-streak3today-local">0</span>
        </div>

        <div class="sync-line sync-status-row">status: <span class="sync-status">idle (-)</span></div>
        
        <div class="sync-reset-row">            
          <button id="cscs_sync_test_reset" type="button" class="sync-reset-button">reset this qid</button>
          <button id="cscs_sync_star_reset" type="button" class="sync-reset-button">reset stars</button>
          <button id="cscs_sync_streak3today_reset" type="button" class="sync-reset-button">reset today streak</button>
          <button id="cscs_sync_onceperday_reset" type="button" class="sync-reset-button">reset oncePerDay</button>
          <button id="cscs_sync_all_reset" type="button" class="sync-reset-button">reset all</button>
          <!-- <button id="cscs_sync_all_qid_reset" type="button" class="sync-reset-button">⚠︎reset all qid</button> -->
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
      const btnOncePerDayReset = document.getElementById("cscs_sync_onceperday_reset");
      const btnAllReset = document.getElementById("cscs_sync_all_reset");
      const btnAllQidReset = document.getElementById("cscs_sync_all_qid_reset");

      if (btnReset) {
        btnReset.addEventListener("click", async function(){
          await resetSyncForThisQid(true, false);
          location.reload();
        });
      }

      if (btnStarReset) {
        btnStarReset.addEventListener("click", async function(){
          await resetStarForThisQid(true);
          location.reload();
        });
      }

      if (btnStreakTodayReset) {
        btnStreakTodayReset.addEventListener("click", async function(){
          await resetStreak3TodayAll(true);
          location.reload();
        });
      }

      if (btnOncePerDayReset) {
        btnOncePerDayReset.addEventListener("click", async function(){
          await resetOncePerDayTodayAll(true);
          location.reload();
        });
      }

      if (btnAllReset) {
        btnAllReset.addEventListener("click", async function(){
          if (!QID) return;
          const ok = window.confirm("この問題のSYNCカウンタ・星・今日の3連続正解ユニーク数・oncePerDayToday をすべてリセットします。よろしいですか？");
          if (!ok) return;
          await resetSyncForThisQid(false, false);
          await resetStarForThisQid(false);
          await resetStreak3TodayAll(false);
          await resetOncePerDayTodayAll(false);
          alert("この問題に関するSYNCカウンタ・星・今日の3連続正解ユニーク数・oncePerDayToday をすべてリセットしました。");
          location.reload();
        });
      }

      if (btnAllQidReset) {
        btnAllQidReset.addEventListener("click", async function(){
          const ok = window.confirm("⚠︎本当に、全ての問題(qid)の計測系 SYNC と local 記録をリセットしますか？\n\nこの操作はデバッグ専用であり、本番利用は想定していません。");
          if (!ok) return;
          await resetAllQidSyncAndLocal(true);
          location.reload();
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