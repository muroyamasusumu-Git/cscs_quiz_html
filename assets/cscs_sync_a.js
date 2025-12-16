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
 *   - payload(merge):
 *       streak3TodayDelta { day, qids }
 *
 * ▼ 今日の3連続不正解ユニーク数（Streak3WrongToday）
 *   - localStorage:
 *       "cscs_streak3_wrong_today_day"
 *       "cscs_streak3_wrong_today_qids"
 *       "cscs_streak3_wrong_today_unique_count"
 *   - SYNC state:
 *       state.streak3WrongToday.day
 *       state.streak3WrongToday.qids
 *       state.streak3WrongToday.unique_count
 *   - payload(merge):
 *       streak3WrongTodayDelta { day, qids }
 *
 * ▼ 1 日 1 回計測モード（oncePerDayToday）
 *   - localStorage:
 *       "cscs_once_per_day_today_day"
 *       "cscs_once_per_day_today_results"
 *   - SYNC state:
 *       state.oncePerDayToday.day
 *       state.oncePerDayToday.results[qid]
 *
 * ▼ 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）
 *   - localStorage:
 *       "cscs_q_last_seen_day:"    + qid
 *       "cscs_q_last_correct_day:" + qid
 *       "cscs_q_last_wrong_day:"   + qid
 *   - SYNC state:
 *       state.lastSeenDay[qid]
 *       state.lastCorrectDay[qid]
 *       state.lastWrongDay[qid]
 *   - payload(merge):
 *       lastSeenDayDelta[qid]
 *       lastCorrectDayDelta[qid]
 *       lastWrongDayDelta[qid]
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
  //   - lastSeenDayDelta / lastCorrectDayDelta / lastWrongDayDelta:
  //       問題別の「最終日情報」を SYNC 側へ渡すための最新値
  const queue = {
    correctDelta: {},
    incorrectDelta: {},
    streak3Delta: {},
    streakLenDelta: {},
    streak3WrongDelta: {},
    streakWrongLenDelta: {},
    lastSeenDayDelta: {},
    lastCorrectDayDelta: {},
    lastWrongDayDelta: {}
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

  // ★ 問題別 最終日情報: localStorage から「最終閲覧日」を読み取る
  function readLocalLastSeenDayForQid(qid){
    try{
      const k = "cscs_q_last_seen_day:" + qid;
      const v = localStorage.getItem(k);
      return v || "";
    }catch(_){
      return "";
    }
  }

  // ★ 問題別 最終日情報: localStorage から「最終正解日」を読み取る
  function readLocalLastCorrectDayForQid(qid){
    try{
      const k = "cscs_q_last_correct_day:" + qid;
      const v = localStorage.getItem(k);
      return v || "";
    }catch(_){
      return "";
    }
  }

  // ★ 問題別 最終日情報: localStorage から「最終不正解日」を読み取る
  function readLocalLastWrongDayForQid(qid){
    try{
      const k = "cscs_q_last_wrong_day:" + qid;
      const v = localStorage.getItem(k);
      return v || "";
    }catch(_){
      return "";
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

        const serverTextEl = totalsEl.querySelector(".sync-server-text");
        if (serverTextEl) {
          serverTextEl.textContent = "server " + sc + " / " + si;
        }
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

      // ★ 今日の3連続不正解ユニーク数（Streak3WrongToday）を SYNC state と localStorage から読み込む
      //   - SYNC 側: state.streak3WrongToday.{day, unique_count, qids}
      //   - local 側: cscs_streak3_wrong_today_day / _unique_count をそのまま表示に使う
      const streak3WrongToday = (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday)
        ? window.__cscs_sync_state.streak3WrongToday
        : { day: "", unique_count: 0 };

      let localWrongStreakDay = "";
      let localWrongStreakCount = 0;
      try{
        localWrongStreakDay = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
        const rawLocalWrongCnt = localStorage.getItem("cscs_streak3_wrong_today_unique_count");
        const parsedLocalWrongCnt = rawLocalWrongCnt == null ? NaN : parseInt(rawLocalWrongCnt, 10);
        if (Number.isFinite(parsedLocalWrongCnt) && parsedLocalWrongCnt >= 0) {
          localWrongStreakCount = parsedLocalWrongCnt;
        }
      }catch(_){}

      // ★ 問題別 最終日情報（LastSeen / LastCorrect / LastWrong）の取得
      //   - local: localStorage に保存された最終日
      //   - sync : window.__cscs_sync_state.lastSeenDay などに保存された最終日
      let lastSeenLocal = "";
      let lastCorrectLocal = "";
      let lastWrongLocal = "";
      try{
        lastSeenLocal = readLocalLastSeenDayForQid(QID);
        lastCorrectLocal = readLocalLastCorrectDayForQid(QID);
        lastWrongLocal = readLocalLastWrongDayForQid(QID);
      }catch(_){}

      let lastSeenSync = "";
      let lastCorrectSync = "";
      let lastWrongSync = "";
      try{
        const stateForLast = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
          ? window.__cscs_sync_state
          : null;

        if (stateForLast && stateForLast.lastSeenDay && typeof stateForLast.lastSeenDay === "object") {
          const v = stateForLast.lastSeenDay[QID];
          // ★ 最終閲覧日の SYNC 値は string / number のどちらでも来る想定
          //   - "20251211" / 20251211 の両方を許容し、表示用には文字列に統一する
          if (typeof v === "string" && v) {
            lastSeenSync = v;
          } else if (typeof v === "number" && Number.isFinite(v) && v > 0) {
            lastSeenSync = String(v);
          }
        }

        if (stateForLast && stateForLast.lastCorrectDay && typeof stateForLast.lastCorrectDay === "object") {
          const v2 = stateForLast.lastCorrectDay[QID];
          // ★ 最終正解日の SYNC 値も string / number 両対応で文字列化して扱う
          if (typeof v2 === "string" && v2) {
            lastCorrectSync = v2;
          } else if (typeof v2 === "number" && Number.isFinite(v2) && v2 > 0) {
            lastCorrectSync = String(v2);
          }
        }

        if (stateForLast && stateForLast.lastWrongDay && typeof stateForLast.lastWrongDay === "object") {
          const v3 = stateForLast.lastWrongDay[QID];
          // ★ 最終不正解日の SYNC 値も同様に string / number 両対応
          if (typeof v3 === "string" && v3) {
            lastWrongSync = v3;
          } else if (typeof v3 === "number" && Number.isFinite(v3) && v3 > 0) {
            lastWrongSync = String(v3);
          }
        }
      }catch(_){}

      if (box) {
        const qEl  = box.querySelector(".sync-qid");

        const s3tDayEl   = box.querySelector(".sync-streak3today-day");
        const s3tSyncEl  = box.querySelector(".sync-streak3today-sync");
        const s3tLocalEl = box.querySelector(".sync-streak3today-local");

        // ★ 問題別 最終日情報表示用要素
        const lastSeenSyncEl     = box.querySelector(".sync-last-seen-sync");
        const lastCorrectSyncEl  = box.querySelector(".sync-last-correct-sync");
        const lastWrongSyncEl    = box.querySelector(".sync-last-wrong-sync");
        const lastSeenLocalEl    = box.querySelector(".sync-last-seen-local");
        const lastCorrectLocalEl = box.querySelector(".sync-last-correct-local");
        const lastWrongLocalEl   = box.querySelector(".sync-last-wrong-local");
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

        // ★ 今日の3連続不正解ユニーク数をモニタUIに反映する
        //   - day: state.streak3WrongToday.day
        //   - unique: sync 側 unique_count と localStorage 側の値を並列表記
        const s3wtDayEl   = box.querySelector(".sync-streak3wrongtoday-day");
        const s3wtSyncEl  = box.querySelector(".sync-streak3wrongtoday-sync");
        const s3wtLocalEl = box.querySelector(".sync-streak3wrongtoday-local");
        if (s3wtDayEl) {
          s3wtDayEl.textContent = toDisplayText(streak3WrongToday.day, "（データなし）");
        }
        if (s3wtSyncEl) {
          s3wtSyncEl.textContent = toDisplayText(
            typeof streak3WrongToday.unique_count === "number" ? streak3WrongToday.unique_count : "",
            "（データなし）"
          );
        }
        if (s3wtLocalEl) {
          s3wtLocalEl.textContent = toDisplayText(
            Number.isFinite(localWrongStreakCount) ? localWrongStreakCount : "",
            "（データなし）"
          );
        }

        // ★ 最終日情報（LastSeen / LastCorrect / LastWrong）を UI に反映
        if (lastSeenSyncEl) {
          lastSeenSyncEl.textContent = toDisplayText(lastSeenSync, "（データなし）");
        }
        if (lastCorrectSyncEl) {
          lastCorrectSyncEl.textContent = toDisplayText(lastCorrectSync, "（データなし）");
        }
        if (lastWrongSyncEl) {
          lastWrongSyncEl.textContent = toDisplayText(lastWrongSync, "（データなし）");
        }
        if (lastSeenLocalEl) {
          lastSeenLocalEl.textContent = toDisplayText(lastSeenLocal, "（データなし）");
        }
        if (lastCorrectLocalEl) {
          lastCorrectLocalEl.textContent = toDisplayText(lastCorrectLocal, "（データなし）");
        }
        if (lastWrongLocalEl) {
          lastWrongLocalEl.textContent = toDisplayText(lastWrongLocal, "（データなし）");
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

        // oncePerDayToday の計測状況を別行として表示するためのラベル文字列を作成
        // ★ 追加: ODOA: ON/OFF / count対象 / 理由 を同じ行に付加して表示する
        let onceLabel = "";
        let odoaLabel = "ODOA: unknown";
        let countLabel = "count対象: unknown";
        let reasonLabel = "理由: unknown";

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
              // 計測済（correct / wrong）
              onceLabel = "計測済(" + r + ")";
            } else if (Object.prototype.hasOwnProperty.call(once.results, QID)) {
              // 何かしら値はあるが unknown の場合
              onceLabel = "計測済(unknown)";
            } else {
              // 今日の日付だがこの QID は未計測
              onceLabel = "未計測";
            }
          } else {
            // oncePerDayToday 自体が今日ではない or データなし
            onceLabel = "未計測";
          }
        }catch(_eOnce){
          // oncePerDayToday 表示に失敗してもステータス自体は出す
          onceLabel = "";
        }

        // ★ 追加: ODOA の状態と count対象判定を「window.CSCS_ODOA」を唯一の参照元として取得
        //   - ここでは localStorage や他DOMなどへフォールバックしない（取れなければ unknown で表示）
        //   - CSCS_ODOA 側が提供しているAPI/形に合わせて、取れる情報だけ表示する
        try{
          const odoa = (window.CSCS_ODOA && typeof window.CSCS_ODOA === "object")
            ? window.CSCS_ODOA
            : null;

          // (1) ODOA: ON/OFF の推定（CSCS_ODOA が明示している boolean を優先して読む）
          let odoaOn = null;
          if (odoa && typeof odoa.enabled === "boolean") {
            odoaOn = odoa.enabled;
          } else if (odoa && typeof odoa.isEnabled === "boolean") {
            odoaOn = odoa.isEnabled;
          } else if (odoa && typeof odoa.on === "boolean") {
            odoaOn = odoa.on;
          } else if (odoa && typeof odoa.isOn === "boolean") {
            odoaOn = odoa.isOn;
          }

          if (odoaOn === true) {
            odoaLabel = "ODOA: ON";
          } else if (odoaOn === false) {
            odoaLabel = "ODOA: OFF";
          } else {
            odoaLabel = "ODOA: unknown";
          }

          // (2) count対象 / 理由
          //     - CSCS_ODOA が関数を持っている場合のみ、それを使って判定する
          //     - 返り値が boolean の場合は YES/NO のみ
          //     - 返り値が object の場合は { isTarget, reason } 形式を読める範囲で表示
          let isTarget = null;
          let reason = null;

          if (odoa && typeof odoa.isCountTarget === "function") {
            const r = odoa.isCountTarget(QID);
            if (typeof r === "boolean") {
              isTarget = r;
            } else if (r && typeof r === "object") {
              if (typeof r.isTarget === "boolean") {
                isTarget = r.isTarget;
              } else if (typeof r.target === "boolean") {
                isTarget = r.target;
              }
              if (typeof r.reason === "string" && r.reason.trim() !== "") {
                reason = r.reason.trim();
              }
            }
          } else if (odoa && typeof odoa.getCountDecision === "function") {
            const r2 = odoa.getCountDecision(QID);
            if (typeof r2 === "boolean") {
              isTarget = r2;
            } else if (r2 && typeof r2 === "object") {
              if (typeof r2.isTarget === "boolean") {
                isTarget = r2.isTarget;
              } else if (typeof r2.target === "boolean") {
                isTarget = r2.target;
              }
              if (typeof r2.reason === "string" && r2.reason.trim() !== "") {
                reason = r2.reason.trim();
              }
            }
          }

          if (isTarget === true) {
            countLabel = "count対象: YES";
          } else if (isTarget === false) {
            countLabel = "count対象: NO";
          } else {
            countLabel = "count対象: unknown";
          }

          if (typeof reason === "string" && reason) {
            // 期待される表示例: excluded / not-in-candidates / unknown（CSCS_ODOA が返したものを尊重）
            reasonLabel = "理由: " + reason;
          } else {
            // 理由が取れない場合は unknown のまま
            reasonLabel = "理由: unknown";
          }
        }catch(_eOdoa){
          // ODOA 判定に失敗しても、oncePerDayToday 表示は維持する
          odoaLabel = "ODOA: unknown";
          countLabel = "count対象: unknown";
          reasonLabel = "理由: unknown";
        }

        if (stEl) stEl.textContent = lastSyncStatus + " (" + time + ")" + err;

        const onceEl = box.querySelector(".sync-onceperday");
        if (onceEl) {
          // oncePerDayToday / ODOA / count対象 / 理由 をそれぞれ改行して表示する
          const base = onceLabel || "（データなし）";
          onceEl.innerHTML =
            "oncePerDayToday: " + base + "<br>" +
            odoaLabel + "<br>" +
            countLabel + "<br>" +
            reasonLabel;
        }
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
    const hasLastSeen    = Object.keys(queue.lastSeenDayDelta).length>0;
    const hasLastCorrect = Object.keys(queue.lastCorrectDayDelta).length>0;
    const hasLastWrong   = Object.keys(queue.lastWrongDayDelta).length>0;

    // ★ いずれの delta も空なら、送信する意味がないので終了
    if (
      !hasC &&
      !hasI &&
      !hasS3 &&
      !hasSL &&
      !hasS3W &&
      !hasSLW &&
      !hasLastSeen &&
      !hasLastCorrect &&
      !hasLastWrong
    ) {
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
      // ★ 追加: 問題別 最終日情報の delta（最新値）を Workers へ送る
      lastSeenDayDelta: queue.lastSeenDayDelta,
      lastCorrectDayDelta: queue.lastCorrectDayDelta,
      lastWrongDayDelta: queue.lastWrongDayDelta,
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
      hasLastSeenDayDelta: hasLastSeen,
      hasLastCorrectDayDelta: hasLastCorrect,
      hasLastWrongDayDelta: hasLastWrong,
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

      queue.correctDelta        = {};
      queue.incorrectDelta      = {};
      queue.streak3Delta        = {};
      queue.streakLenDelta      = {};
      queue.streak3WrongDelta   = {};
      queue.streakWrongLenDelta = {};
      queue.lastSeenDayDelta    = {};
      queue.lastCorrectDayDelta = {};
      queue.lastWrongDayDelta   = {};

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
    //   あわせて「最終閲覧日」「最終正解日」も localStorage から読み取り、
    //   それぞれ lastSeenDayDelta / lastCorrectDayDelta に最新値として積む。
    recordCorrect(){
      if (!QID) return;
      queue.correctDelta[QID] = (queue.correctDelta[QID] || 0) + 1;

      try{
        const seenDay = readLocalLastSeenDayForQid(QID);
        if (seenDay) {
          queue.lastSeenDayDelta[QID] = seenDay;
        }
        const correctDay = readLocalLastCorrectDayForQid(QID);
        if (correctDay) {
          queue.lastCorrectDayDelta[QID] = correctDay;
        }
      }catch(_){}

      console.log("[SYNC-A] recordCorrect queued", {
        qid: QID,
        delta: queue.correctDelta[QID],
        lastSeenDay: queue.lastSeenDayDelta[QID] || null,
        lastCorrectDay: queue.lastCorrectDayDelta[QID] || null
      });
      scheduleSend();
    },

    // ★ 不正解1回分の計測を SYNC キューに積む（累計 incorrectDelta）
    //   あわせて「最終閲覧日」「最終不正解日」も localStorage から読み取り、
    //   それぞれ lastSeenDayDelta / lastWrongDayDelta に最新値として積む。
    recordIncorrect(){
      if (!QID) return;
      queue.incorrectDelta[QID] = (queue.incorrectDelta[QID] || 0) + 1;

      try{
        const seenDay = readLocalLastSeenDayForQid(QID);
        if (seenDay) {
          queue.lastSeenDayDelta[QID] = seenDay;
        }
        const wrongDay = readLocalLastWrongDayForQid(QID);
        if (wrongDay) {
          queue.lastWrongDayDelta[QID] = wrongDay;
        }
      }catch(_){}

      console.log("[SYNC-A] recordIncorrect queued", {
        qid: QID,
        delta: queue.incorrectDelta[QID],
        lastSeenDay: queue.lastSeenDayDelta[QID] || null,
        lastWrongDay: queue.lastWrongDayDelta[QID] || null
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
      // ★ 取得した SYNC state が、3連正解系 / 3連不正解系 / 今日の3連ユニーク系を
      //   すべて持っているかどうかをデバッグログに出す
      console.log("[SYNC-A] fetchServer state fetched", {
        hasCorrect: !!(json && json.correct),
        hasIncorrect: !!(json && json.incorrect),
        hasStreak3: !!(json && json.streak3),
        hasStreakLen: !!(json && json.streakLen),
        hasStreak3Wrong: !!(json && json.streak3Wrong),
        hasStreakWrongLen: !!(json && json.streakWrongLen),
        hasStreak3Today: !!(json && json.streak3Today),
        hasStreak3WrongToday: !!(json && json.streak3WrongToday),
        hasLastSeenDay: !!(json && json.lastSeenDay),
        hasLastCorrectDay: !!(json && json.lastCorrectDay),
        hasLastWrongDay: !!(json && json.lastWrongDay)
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

      // ★ 追加: SYNC 側 oncePerDayToday を正として localStorage 側も同期する（欠けていた上書き）
      //   - A の役割として「SYNC state を正」に localStorage を整流化する。
      //   - フォールバックは増やさず、SYNC に無ければ removeItem で「無い」を正として反映する。
      const oncePerDayToday = (s && s.oncePerDayToday && typeof s.oncePerDayToday === "object")
        ? s.oncePerDayToday
        : null;

      try{
        // (1) day: number なら String(day) で保存。それ以外（欠損/非number）は removeItem
        if (oncePerDayToday && typeof oncePerDayToday.day === "number") {
          localStorage.setItem("cscs_once_per_day_today_day", String(oncePerDayToday.day));
        } else {
          localStorage.removeItem("cscs_once_per_day_today_day");
        }

        // (2) results: object なら JSON.stringify して保存。それ以外（欠損/非object）は removeItem
        if (oncePerDayToday && oncePerDayToday.results && typeof oncePerDayToday.results === "object") {
          localStorage.setItem(
            "cscs_once_per_day_today_results",
            JSON.stringify(oncePerDayToday.results)
          );
        } else {
          localStorage.removeItem("cscs_once_per_day_today_results");
        }

        console.log("[SYNC-A] initialFetch synced oncePerDayToday from server to localStorage", {
          day: oncePerDayToday && typeof oncePerDayToday.day === "number" ? oncePerDayToday.day : null,
          hasResults: !!(oncePerDayToday && oncePerDayToday.results && typeof oncePerDayToday.results === "object")
        });
      }catch(_){}

      // ★ 追加: SYNC 側 streak3Today を正として localStorage 側も同期する
      //   - state.streak3Today を唯一のソースとして、
      //     「今日の⭐️ユニーク数」関連の localStorage を上書きする。
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

      // ★ 追加: SYNC 側 streak3WrongToday を正として localStorage 側も同期する
      //   - state.streak3WrongToday を唯一のソースとして、
      //     「今日の3連続不正解ユニーク数」関連の localStorage を上書きする。
      //   - フォールバックは行わず、state.streak3WrongToday が無ければ
      //     「day: 空 / unique_count: 0 / qids: 空配列」とみなす。
      const streak3WrongToday = (s && s.streak3WrongToday)
        ? s.streak3WrongToday
        : { day: "", unique_count: 0, qids: [] };

      try{
        if (streak3WrongToday.day) {
          localStorage.setItem("cscs_streak3_wrong_today_day", String(streak3WrongToday.day));
        } else {
          localStorage.removeItem("cscs_streak3_wrong_today_day");
        }
        localStorage.setItem(
          "cscs_streak3_wrong_today_unique_count",
          String(streak3WrongToday.unique_count || 0)
        );
        if (Array.isArray(streak3WrongToday.qids)) {
          localStorage.setItem(
            "cscs_streak3_wrong_today_qids",
            JSON.stringify(streak3WrongToday.qids)
          );
        } else {
          localStorage.removeItem("cscs_streak3_wrong_today_qids");
        }
      }catch(_){}

      // ★ 追加: 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）を
      //   SYNC state を唯一の正として localStorage に同期（このQID分だけ）。
      //   - state 側は string/number 混在があり得るため、保存は常に String(v) に統一する。
      //   - 値が無い/空（null/undefined/""/空白のみ）の場合は removeItem して「ない」を正として反映する。
      try{
        const kSeen = "cscs_q_last_seen_day:" + QID;
        const kCor  = "cscs_q_last_correct_day:" + QID;
        const kWrg  = "cscs_q_last_wrong_day:" + QID;

        let vSeen = "";
        let vCor  = "";
        let vWrg  = "";

        if (s && s.lastSeenDay && typeof s.lastSeenDay === "object") {
          const rawSeen = s.lastSeenDay[QID];
          if (rawSeen !== null && rawSeen !== undefined) {
            vSeen = String(rawSeen);
          }
        }
        if (s && s.lastCorrectDay && typeof s.lastCorrectDay === "object") {
          const rawCor = s.lastCorrectDay[QID];
          if (rawCor !== null && rawCor !== undefined) {
            vCor = String(rawCor);
          }
        }
        if (s && s.lastWrongDay && typeof s.lastWrongDay === "object") {
          const rawWrg = s.lastWrongDay[QID];
          if (rawWrg !== null && rawWrg !== undefined) {
            vWrg = String(rawWrg);
          }
        }

        if (vSeen.trim() !== "") {
          localStorage.setItem(kSeen, vSeen);
        } else {
          localStorage.removeItem(kSeen);
        }

        if (vCor.trim() !== "") {
          localStorage.setItem(kCor, vCor);
        } else {
          localStorage.removeItem(kCor);
        }

        if (vWrg.trim() !== "") {
          localStorage.setItem(kWrg, vWrg);
        } else {
          localStorage.removeItem(kWrg);
        }

        console.log("[SYNC-A] initialFetch synced last-day fields from server to localStorage", {
          qid: QID,
          lastSeenDay: vSeen.trim() !== "" ? vSeen : null,
          lastCorrectDay: vCor.trim() !== "" ? vCor : null,
          lastWrongDay: vWrg.trim() !== "" ? vWrg : null
        });
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
          // ★ 今日の3連続不正解ユニーク数（Streak3WrongToday）関連キーも一括削除対象に含める
          //   - reset_all_qid 実行時に「今日の3連続不正解ユニーク数」のローカル状態も完全リセットする。
          "cscs_streak3_wrong_today_day",
          "cscs_streak3_wrong_today_unique_count",
          "cscs_streak3_wrong_today_qids",
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
      // SYNC(A) monitor の見た目（グリッド/カード）用CSSを一度だけ注入
      try{
        if (!document.getElementById("cscs-sync-a-monitor-style")) {
          const st = document.createElement("style");
          st.id = "cscs-sync-a-monitor-style";
          st.textContent = `
#cscs_sync_monitor_a{
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.35;
}
#cscs_sync_monitor_a .sync-header{
  font-weight: 700;
  margin: 0 0 6px 0;
  text-align: right;
}
#cscs_sync_monitor_a .sync-grid{
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  width: auto;
}

#cscs_sync_monitor_a {
  position: fixed;
  right: 3px;
  top: 107px;
  /* background: rgba(0,0,0,0.55); */
  color: #eee;
  /* border: 1px solid rgba(255,255,255,0.10); */
  /* border-radius: 12px; */
  padding: 8px;
  font: 9px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: 46vw;
  width: 300px;
  opacity: 0.88;
  z-index: 2147483647;
}



@media (max-width: 520px){
  #cscs_sync_monitor_a .sync-grid{
    grid-template-columns: 1fr;
  }
}
#cscs_sync_monitor_a .sync-card{
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(0,0,0,0.72);
  border: 1px solid rgba(255,255,255,0.12);
  line-height: 1;
}
#cscs_sync_monitor_a .sync-card .sync-title{
  font-weight: 700;
  font-size: 11px;
  opacity: 0.85;
  margin-bottom: 4px;
}
#cscs_sync_monitor_a .sync-card .sync-body{
  word-break: break-word;
}

#cscs_sync_monitor_a .status-grid{
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  line-height: 1.25;
}

#cscs_sync_monitor_a .status-label{
  font-weight: 600;
  font-size: 10.5px;
  letter-spacing: 0.02em;
  opacity: 0.80;
  white-space: nowrap;
}

#cscs_sync_monitor_a .status-value{
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

#cscs_sync_monitor_a .totals-row{
  display: grid;
  grid-template-columns: auto 1fr 1fr 1fr;
  gap: 6px 10px;
  align-items: center;
  font-size: 11px;
}

#cscs_sync_monitor_a .sync-totals-label{
  font-weight: 700;
  opacity: 0.85;
  white-space: nowrap;
}

#cscs_sync_monitor_a .sync-totals,
#cscs_sync_monitor_a .sync-local,
#cscs_sync_monitor_a .sync-queue{
  white-space: nowrap;
}
#cscs_sync_monitor_a .sync-card.sync-span-2{
  grid-column: 1 / -1;
}

#cscs_sync_monitor_a .lastday-grid{
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  gap: 4px 10px;
  align-items: center;
  font-size: 11px;
}

#cscs_sync_monitor_a .lastday-grid .ld-head{
  font-weight: 700;
  opacity: 0.8;
}

#cscs_sync_monitor_a .lastday-grid .ld-label{
  opacity: 0.75;
}
          `.trim();
          (document.head || document.documentElement).appendChild(st);
        }
      }catch(_){}

      const box = document.createElement("div");
      box.id = "cscs_sync_monitor_a";
      box.innerHTML = `
        <div class="sync-header">SYNC(A): <span class="sync-qid"></span></div>

        <div class="sync-grid">
          <div class="sync-card sync-span-2">
            <div class="sync-body totals-row">
              <div class="sync-totals-label">Totals(c/w)</div>

              <div id="cscs_sync_totals" class="sync-totals" data-server-c="0" data-server-i="0">
                <span class="sync-server-text">server 0 / 0</span>
              </div>

              <div class="sync-local">local  0 / 0</div>
              <div class="sync-queue">+Δ    0 / 0</div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続正解 回数</div>
            <div class="sync-body sync-streak3">
              SYNC <span class="sync-streak3-server">0</span> 回 / local <span class="sync-streak3-val">0</span> 回
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続正解 進捗</div>
            <div class="sync-body sync-streaklen">
              SYNC <span class="sync-streaklen-server">0</span> (<span class="sync-streaklen-server-progress">0</span>/3) /
              local <span class="sync-streaklen-val">0</span> (<span class="sync-streaklen-local-progress">0</span>/3)
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続不正解 回数</div>
            <div class="sync-body sync-wrong-streak3">
              SYNC <span class="sync-wrong-streak3-server">0</span> 回 / local <span class="sync-wrong-streak3-val">0</span> 回
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続不正解 進捗</div>
            <div class="sync-body sync-wrong-streaklen">
              SYNC <span class="sync-wrong-streaklen-server">0</span> (<span class="sync-wrong-streaklen-server-progress">0</span>/3) /
              local <span class="sync-wrong-streaklen-val">0</span> (<span class="sync-wrong-streaklen-local-progress">0</span>/3)
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">Streak3TodayUnique</div>
            <div class="sync-body sync-streak3today">
              day: <span class="sync-streak3today-day">-</span><br>
              unique: sync <span class="sync-streak3today-sync">0</span> / local <span class="sync-streak3today-local">0</span>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">Streak3WrongTodayUq</div>
            <div class="sync-body sync-streak3wrongtoday">
              day: <span class="sync-streak3wrongtoday-day">-</span><br>
              unique: sync <span class="sync-streak3wrongtoday-sync">0</span> / local <span class="sync-streak3wrongtoday-local">0</span>
            </div>
          </div>

          <div class="sync-card sync-span-2">
            <div class="sync-body sync-lastday">
              <div class="lastday-grid">
                <div class="ld-head">LastDay</div>
                <div class="ld-head">SYNC</div>
                <div class="ld-head">local</div>

                <div class="ld-label">lastSeen</div>
                <div><span class="sync-last-seen-sync">（データなし）</span></div>
                <div><span class="sync-last-seen-local">（データなし）</span></div>

                <div class="ld-label">lastCorrect</div>
                <div><span class="sync-last-correct-sync">（データなし）</span></div>
                <div><span class="sync-last-correct-local">（データなし）</span></div>

                <div class="ld-label">lastWrong</div>
                <div><span class="sync-last-wrong-sync">（データなし）</span></div>
                <div><span class="sync-last-wrong-local">（データなし）</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card sync-span-2">
            <div class="sync-title">oncePerDayToday / ODOA</div>
            <div class="sync-body sync-onceperday">oncePerDayToday: （データなし）</div>
          </div>

          <div class="sync-card sync-span-2">
            <div class="sync-body status-grid">
              <div class="status-label">Status</div>
              <div class="status-value"><span class="sync-status">pulled (-)</span></div>
            </div>
          </div>
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