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
 * ▼ 問題別 連続不正解（Local のみで表示する最高値/達成日）
 *   - localStorage:
 *       "cscs_q_wrong_streak_max:"     + qid
 *       "cscs_q_wrong_streak_max_day:" + qid
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

  // ★ 追加: streak max カード（A）初回ログ用フラグ
  //   - updateMonitor() 内で一度だけ「streak max カードの値が取れてUIに反映された」ことを
  //     コンソールに出すための状態。
  let loggedStreakMaxUiOnce = false;

  // ★ 追加: 不正解 streak max カード（A）初回ログ用フラグ
  //   - updateMonitor() 内で一度だけ「不正解 streak max カードの値が取れてUIに反映された」ことを
  //     コンソールに出すための状態。
  let loggedWrongStreakMaxUiOnce = false;

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

  // === ③ モニタUIの折りたたみ（永続化） ===
  // 方針:
  //   - デフォルトは閉じ（collapsed）
  //   - ユーザーが開いた状態/閉じた状態を localStorage に保存し、リロード/遷移後も維持
  const LS_MON_OPEN        = "cscs_sync_a_monitor_open";
  const LS_DAYS_OPEN       = "cscs_sync_a_days_open";
  const LS_QDEL_OPEN       = "cscs_sync_a_queue_detail_open";

  function readLsBool(key, defaultBool){
    try{
      const v = localStorage.getItem(key);
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

  // ★ 追加: localStorage から「最高連続正解数（過去最高）」を読み取る
  //   - b_judge_record.js が "cscs_q_correct_streak_max:{qid}" に保存している値をそのまま利用
  function readLocalStreakMaxForQid(qid){
    try{
      const kM = "cscs_q_correct_streak_max:" + qid;
      const m  = parseInt(localStorage.getItem(kM) || "0", 10) || 0;
      return m;
    }catch(_){
      return 0;
    }
  }

  // ★ 追加: localStorage から「最高連続正解数を更新した達成日（JST YYYYMMDD）」を読み取る
  //   - b_judge_record.js が "cscs_q_correct_streak_max_day:{qid}" に保存している値をそのまま利用
  function readLocalStreakMaxDayForQid(qid){
    try{
      const kD = "cscs_q_correct_streak_max_day:" + qid;
      const v = localStorage.getItem(kD);
      return v || "";
    }catch(_){
      return "";
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

  // ★ 追加: localStorage から「最高連続不正解数（過去最高）」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_max:{qid}" に保存している値をそのまま利用
  function readLocalWrongStreakMaxForQid(qid){
    try{
      const kM = "cscs_q_wrong_streak_max:" + qid;
      const m  = parseInt(localStorage.getItem(kM) || "0", 10) || 0;
      return m;
    }catch(_){
      return 0;
    }
  }

  // ★ 追加: localStorage から「最高連続不正解数を更新した達成日（JST YYYYMMDD）」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_max_day:{qid}" に保存している値をそのまま利用
  function readLocalWrongStreakMaxDayForQid(qid){
    try{
      const kD = "cscs_q_wrong_streak_max_day:" + qid;
      const v = localStorage.getItem(kD);
      return v || "";
    }catch(_){
      return "";
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

      // ★ 追加: 正解ストリークの「過去最高」と「達成日」を localStorage から取得
      //   - フォールバック無し：b_judge_record.js の localStorage を唯一の参照元として表示する
      const lMax    = readLocalStreakMaxForQid(QID);
      const lMaxDay = readLocalStreakMaxDayForQid(QID);

      // ★ 追加: 不正解ストリークの「過去最高」と「達成日」を localStorage から取得
      //   - フォールバック無し：b_judge_record.js の localStorage を唯一の参照元として表示する
      const lWrongMax    = readLocalWrongStreakMaxForQid(QID);
      const lWrongMaxDay = readLocalWrongStreakMaxDayForQid(QID);

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
          serverTextEl.textContent = "SYNC " + sc + " / " + si;
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

        // ★ 追加: 日付の「SYNC day / local day / 今日一致」を見える化する要素（A）
        const s3tDaySyncEl      = box.querySelector(".sync-streak3today-day-sync");
        const s3tDayLocalEl     = box.querySelector(".sync-streak3today-day-local");
        const s3tDayIsTodayEl   = box.querySelector(".sync-streak3today-day-istoday");

        const s3wtDaySyncEl     = box.querySelector(".sync-streak3wrongtoday-day-sync");
        const s3wtDayLocalEl    = box.querySelector(".sync-streak3wrongtoday-day-local");
        const s3wtDayIsTodayEl  = box.querySelector(".sync-streak3wrongtoday-day-istoday");

        const onceDaySyncEl     = box.querySelector(".sync-onceperday-day-sync");
        const onceDayLocalEl    = box.querySelector(".sync-onceperday-day-local");
        const onceDayIsTodayEl  = box.querySelector(".sync-onceperday-day-istoday");

        // ★ 追加: streak max カード（A）表示用要素
        const streakMaxLenEl    = box.querySelector(".sync-streakmax-len-local");
        const streakMaxValEl    = box.querySelector(".sync-streakmax-max-local");
        const streakMaxDayEl    = box.querySelector(".sync-streakmax-maxday-local");

        // ★ 追加: 不正解 streak max カード（A）表示用要素
        const wrongStreakMaxLenEl = box.querySelector(".sync-wrong-streakmax-len-local");
        const wrongStreakMaxValEl = box.querySelector(".sync-wrong-streakmax-max-local");
        const wrongStreakMaxDayEl = box.querySelector(".sync-wrong-streakmax-maxday-local");

        // ★ 追加: キュー（+Δ）詳細（B）
        const qdCwEl     = box.querySelector(".sync-queue-cw");
        const qdS3El     = box.querySelector(".sync-queue-s3");
        const qdSLel     = box.querySelector(".sync-queue-sl");
        const qdS3wEl    = box.querySelector(".sync-queue-s3w");
        const qdSLwEl    = box.querySelector(".sync-queue-slw");
        const qdSeenEl   = box.querySelector(".sync-queue-lastseen");
        const qdCorEl    = box.querySelector(".sync-queue-lastcorrect");
        const qdWrgEl    = box.querySelector(".sync-queue-lastwrong");

        // ★ 問題別 最終日情報表示用要素（詳細テーブル）
        const lastSeenSyncEl     = box.querySelector(".sync-last-seen-sync");
        const lastCorrectSyncEl  = box.querySelector(".sync-last-correct-sync");
        const lastWrongSyncEl    = box.querySelector(".sync-last-wrong-sync");
        const lastSeenLocalEl    = box.querySelector(".sync-last-seen-local");
        const lastCorrectLocalEl = box.querySelector(".sync-last-correct-local");
        const lastWrongLocalEl   = box.querySelector(".sync-last-wrong-local");

        // ★ 追加: lastday サマリー（summary 1行）
        const lastdaySummaryTypeEl  = box.querySelector(".sync-lastday-summary-type");
        const lastdaySummarySyncEl  = box.querySelector(".sync-lastday-summary-sync");
        const lastdaySummaryLocalEl = box.querySelector(".sync-lastday-summary-local");

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

        // ★ 追加: localStorage 側の「day」も読み取って表示に出す（A）
        let localStreakDayRaw = "";
        let localWrongStreakDayRaw = "";
        try{
          localStreakDayRaw = localStorage.getItem("cscs_streak3_today_day") || "";
          localWrongStreakDayRaw = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
        }catch(_){}

        // ★ 追加: oncePerDayToday の day（SYNC/local）も見える化（A）
        let syncOnceDayRaw = "";
        let localOnceDayRaw = "";
        try{
          const stateForOnceDay = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
            ? window.__cscs_sync_state
            : null;
          const onceObj = stateForOnceDay && stateForOnceDay.oncePerDayToday && typeof stateForOnceDay.oncePerDayToday === "object"
            ? stateForOnceDay.oncePerDayToday
            : null;
          if (onceObj && typeof onceObj.day === "number" && Number.isFinite(onceObj.day) && onceObj.day > 0) {
            syncOnceDayRaw = String(onceObj.day);
          } else if (onceObj && typeof onceObj.day === "string" && onceObj.day.trim() !== "") {
            syncOnceDayRaw = onceObj.day.trim();
          } else {
            syncOnceDayRaw = "";
          }
        }catch(_){}

        try{
          localOnceDayRaw = localStorage.getItem("cscs_once_per_day_today_day") || "";
        }catch(_){}

        // ★ 追加: “そのdayが今日なのか” を明示（A）
        //   - ここでは「YYYYMMDD（数値化できる場合）」で今日比較する
        function isTodayYmdString(ymdStr){
          try{
            const s = String(ymdStr || "").trim();
            if (!/^\d{8}$/.test(s)) return "unknown";
            const now = new Date();
            const yy = now.getFullYear();
            const mm = now.getMonth() + 1;
            const dd = now.getDate();
            const today = String(yy * 10000 + mm * 100 + dd);
            return s === today ? "YES" : "NO";
          }catch(_){
            return "unknown";
          }
        }

        if (s3tDaySyncEl)    s3tDaySyncEl.textContent  = toDisplayText(streak3Today.day, "（データなし）");
        if (s3tDayLocalEl)   s3tDayLocalEl.textContent = toDisplayText(localStreakDayRaw, "（データなし）");
        if (s3tDayIsTodayEl) s3tDayIsTodayEl.textContent = isTodayYmdString(streak3Today.day);

        if (s3wtDaySyncEl)   s3wtDaySyncEl.textContent = toDisplayText(streak3WrongToday.day, "（データなし）");
        if (s3wtDayLocalEl)  s3wtDayLocalEl.textContent = toDisplayText(localWrongStreakDayRaw, "（データなし）");
        if (s3wtDayIsTodayEl) s3wtDayIsTodayEl.textContent = isTodayYmdString(streak3WrongToday.day);

        if (onceDaySyncEl)    onceDaySyncEl.textContent  = toDisplayText(syncOnceDayRaw, "（データなし）");
        if (onceDayLocalEl)   onceDayLocalEl.textContent = toDisplayText(localOnceDayRaw, "（データなし）");
        if (onceDayIsTodayEl) onceDayIsTodayEl.textContent = isTodayYmdString(syncOnceDayRaw);

        // ★ 最終日情報（LastSeen / LastCorrect / LastWrong）を UI に反映（詳細テーブル）
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

        // ★ 追加: lastday の「最新正誤記録」を 1行サマリーに反映
        //   - lastCorrect と lastWrong のうち、日付が新しい方を「最新」として採用
        //   - 表示は「ラベル + SYNC値 + local値」の1行にする
        //   - フォールバックで別ソースから推測しない（取れている値だけで判定）
        function ymdToNum8(v){
          const s = String(v || "").trim();
          if (!/^\d{8}$/.test(s)) return null;
          const n = parseInt(s, 10);
          if (!Number.isFinite(n) || n <= 0) return null;
          return n;
        }

        function pickLatestType(){
          const cS = ymdToNum8(lastCorrectSync);
          const wS = ymdToNum8(lastWrongSync);
          const cL = ymdToNum8(lastCorrectLocal);
          const wL = ymdToNum8(lastWrongLocal);

          let bestType = "lastCorrect";
          let bestNum = null;

          function consider(type, n){
            if (n === null) return;

            // ★ 処理1: まだ候補が無い or より新しい日付なら更新
            if (bestNum === null || n > bestNum) {
              bestNum = n;
              bestType = type;
              return;
            }

            // ★ 処理2: 同日タイなら correct 優先（lastWrong が勝っていたら lastCorrect に戻す）
            if (bestNum !== null && n === bestNum) {
              if (type === "lastCorrect" && bestType === "lastWrong") {
                bestType = "lastCorrect";
              }
            }
          }

          consider("lastCorrect", cS);
          consider("lastWrong",  wS);
          consider("lastCorrect", cL);
          consider("lastWrong",  wL);

          return bestType;
        }

        const latestType = pickLatestType();
        const latestSyncVal  = (latestType === "lastWrong") ? lastWrongSync  : lastCorrectSync;
        const latestLocalVal = (latestType === "lastWrong") ? lastWrongLocal : lastCorrectLocal;

        if (lastdaySummaryTypeEl) {
          // ★ summary の種別表示は 1行で読みやすい “LastWrong / LastCorrect” に統一
          lastdaySummaryTypeEl.textContent = (latestType === "lastWrong") ? "LastWrong" : "LastCorrect";
        }
        if (lastdaySummarySyncEl) {
          // ★ summary の SYNC 値（8桁日付 or データなし）
          //   - 表示は「SYNC 20251210」のようにラベル込みにする
          lastdaySummarySyncEl.textContent = "SYNC " + toDisplayText(latestSyncVal, "（データなし）");
        }
        if (lastdaySummaryLocalEl) {
          // ★ summary の local 値（8桁日付 or データなし）
          //   - 表示は「local 20251210」のようにラベル込みにする
          lastdaySummaryLocalEl.textContent = "local " + toDisplayText(latestLocalVal, "（データなし）");
        }

        // ★ 追加: 見出しと下の詳細が “同じ情報で二重表示” にならないように調整する
        // ★ 処理1: 見出しが LastCorrect の場合 → 下の lastCorrect 行を非表示
        // ★ 処理2: 見出しが LastWrong   の場合 → 下の lastWrong 行を非表示
        // ★ 処理3: 見出しがどちらでもない/未判定の場合 → 両方表示（ここではフォールバック推測はしない）
        try{
          const hideCorrect = (latestType === "lastCorrect");
          const hideWrong   = (latestType === "lastWrong");

          const correctRows = box.querySelectorAll(".lastday-grid .ld-row-lastcorrect");
          const wrongRows   = box.querySelectorAll(".lastday-grid .ld-row-lastwrong");

          correctRows.forEach(function(el){
            el.style.display = hideCorrect ? "none" : "";
          });
          wrongRows.forEach(function(el){
            el.style.display = hideWrong ? "none" : "";
          });
        }catch(_){}

        // ★ lastday は折りたたみ無し：見出し差し替え（open判定）は不要

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

        // ★ 追加: streak max カード（A）に localStorage の値を反映
        //   - len: 現在の連続正解数（cscs_q_correct_streak_len:{qid}）
        //   - max: 最高連続正解数（cscs_q_correct_streak_max:{qid}）
        //   - day: 最高を更新した日（cscs_q_correct_streak_max_day:{qid}）
        if (streakMaxLenEl) streakMaxLenEl.textContent = toDisplayText(lMax !== null && lMax !== undefined ? ll : "", "（データなし）");
        if (streakMaxValEl) streakMaxValEl.textContent = toDisplayText(lMax !== null && lMax !== undefined ? lMax : "", "（データなし）");
        if (streakMaxDayEl) streakMaxDayEl.textContent = toDisplayText(lMaxDay, "（データなし）");

        // ★ 追加: 不正解 streak max カード（A）に localStorage の値を反映
        //   - len: 現在の連続不正解数（cscs_q_wrong_streak_len:{qid}）
        //   - max: 最高連続不正解数（cscs_q_wrong_streak_max:{qid}）
        //   - day: 最高を更新した日（cscs_q_wrong_streak_max_day:{qid}）
        if (wrongStreakMaxLenEl) wrongStreakMaxLenEl.textContent = toDisplayText(lWrongMax !== null && lWrongMax !== undefined ? llWrong : "", "（データなし）");
        if (wrongStreakMaxValEl) wrongStreakMaxValEl.textContent = toDisplayText(lWrongMax !== null && lWrongMax !== undefined ? lWrongMax : "", "（データなし）");
        if (wrongStreakMaxDayEl) wrongStreakMaxDayEl.textContent = toDisplayText(lWrongMaxDay, "（データなし）");

        // ★ 追加: 初回だけ「UI反映に成功した」ログを出す（コンソールで確認可能）
        if (!loggedStreakMaxUiOnce) {
          console.log("[SYNC-A] streak-max card updated (localStorage)", {
            qid: QID,
            streakLen: ll,
            streakMax: lMax,
            streakMaxDay: lMaxDay
          });
          loggedStreakMaxUiOnce = true;
        }

        // ★ 追加: 初回だけ「不正解 streak max カード反映に成功した」ログを出す（コンソールで確認可能）
        if (!loggedWrongStreakMaxUiOnce) {
          console.log("[SYNC-A] wrong-streak-max card updated (localStorage)", {
            qid: QID,
            wrongStreakLen: llWrong,
            wrongStreakMax: lWrongMax,
            wrongStreakMaxDay: lWrongMaxDay
          });
          loggedWrongStreakMaxUiOnce = true;
        }

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

        // ★ 追加: キュー（+Δ）に “Totals(c/w) 以外” の溜まり具合を表示（B）
        //   - streakLenDelta / streakWrongLenDelta は「増分」ではなく「最新値」なので、そのまま表示する
        //   - last*DayDelta も「最新値」なので、そのまま表示する
        const qdS3  = queue.streak3Delta[QID] || 0;
        const qdSL  = Object.prototype.hasOwnProperty.call(queue.streakLenDelta, QID) ? queue.streakLenDelta[QID] : null;

        const qdS3W = queue.streak3WrongDelta[QID] || 0;
        const qdSLW = Object.prototype.hasOwnProperty.call(queue.streakWrongLenDelta, QID) ? queue.streakWrongLenDelta[QID] : null;

        const qdSeen = Object.prototype.hasOwnProperty.call(queue.lastSeenDayDelta, QID) ? queue.lastSeenDayDelta[QID] : "";
        const qdCor  = Object.prototype.hasOwnProperty.call(queue.lastCorrectDayDelta, QID) ? queue.lastCorrectDayDelta[QID] : "";
        const qdWrg  = Object.prototype.hasOwnProperty.call(queue.lastWrongDayDelta, QID) ? queue.lastWrongDayDelta[QID] : "";

        if (qdCwEl)   qdCwEl.textContent   = toDisplayText(dC, "0") + " / " + toDisplayText(dI, "0");
        if (qdS3El)   qdS3El.textContent   = toDisplayText(qdS3, "0");
        if (qdSLel)   qdSLel.textContent   = toDisplayText(qdSL !== null && qdSL !== undefined ? qdSL : "", "（なし）");
        if (qdS3wEl)  qdS3wEl.textContent  = toDisplayText(qdS3W, "0");
        if (qdSLwEl)  qdSLwEl.textContent  = toDisplayText(qdSLW !== null && qdSLW !== undefined ? qdSLW : "", "（なし）");

        if (qdSeenEl) qdSeenEl.textContent = toDisplayText(qdSeen, "（なし）");
        if (qdCorEl)  qdCorEl.textContent  = toDisplayText(qdCor, "（なし）");
        if (qdWrgEl)  qdWrgEl.textContent  = toDisplayText(qdWrg, "（なし）");

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

        // ★ 変更: ODOA の状態と count対象判定は「唯一の参照元」を固定する
        //   参照元:
        //     (1) window.CSCS_ODOA_MODE            … "on" / "off"
        //     (2) window.__cscs_sync_state.oncePerDayToday … { day, results }
        //     (3) window.CSCS_VERIFY_MODE         … "on" の場合は常に計測対象外
        //   方針:
        //     - localStorage 等へのフォールバックは行わない（取れなければ unknown 表示）
        try{
          // (1) ODOA モード表示：window.CSCS_ODOA_MODE をそのまま正とする
          const odoaMode = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
          if (odoaMode === "on") {
            odoaLabel = "ODOA: ON";
          } else if (odoaMode === "off") {
            odoaLabel = "ODOA: OFF";
          } else {
            odoaLabel = "ODOA: unknown";
          }

          // (2) VERIFY モード：ON の場合は常に「count対象: NO」
          const verifyModeOn =
            (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on");

          if (verifyModeOn) {
            countLabel = "count対象: NO";
            reasonLabel = "理由: VERIFY_MODE";
          } else {
            // (3) oncePerDayToday を __cscs_sync_state から取得（ここ以外からは取らない）
            const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
              ? window.__cscs_sync_state
              : null;

            const once = (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object")
              ? state.oncePerDayToday
              : null;

            // (4) 今日 YYYYMMDD（数値）を作る（once.day が number の想定に合わせる）
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

            // (5) count対象判定
            //   - ODOA: OFF → count対象: YES（ODOA制限が無い）
            //   - ODOA: ON  → 今日すでに oncePerDayToday.results[QID] があれば count対象: NO
            //   - 情報が取れない場合は unknown
            if (odoaMode === "off") {
              countLabel = "count対象: YES";
              reasonLabel = "理由: ODOA_OFF";
            } else if (odoaMode === "on") {
              if (
                once &&
                typeof once.day === "number" &&
                todayYmd !== null &&
                once.day === todayYmd &&
                once.results &&
                typeof once.results === "object"
              ) {
                const hasEntry = Object.prototype.hasOwnProperty.call(once.results, QID);
                if (hasEntry) {
                  countLabel = "count対象: NO";
                  reasonLabel = "理由: ALREADY_MEASURED_TODAY";
                } else {
                  countLabel = "count対象: YES";
                  reasonLabel = "理由: NOT_MEASURED_TODAY";
                }
              } else {
                countLabel = "count対象: unknown";
                reasonLabel = "理由: ONCEPERDAY_STATE_UNAVAILABLE";
              }
            } else {
              countLabel = "count対象: unknown";
              reasonLabel = "理由: ODOA_MODE_UNKNOWN";
            }
          }
        }catch(_eOdoa){
          // ★ 補足: 参照元が壊れていた/例外になった場合は unknown 表示に倒す（フォールバック取得はしない）
          odoaLabel = "ODOA: unknown";
          countLabel = "count対象: unknown";
          reasonLabel = "理由: unknown";
        }

        if (stEl) stEl.textContent = lastSyncStatus + " (" + time + ")" + err;

        const onceEl = box.querySelector(".sync-onceperday");
        if (onceEl) {
          // ★ 表示方針:
          //   - oncePerDayToday と ODOA を「同じ枠で一気に読める」4行構成にする
          //   - 未開始（今日の状態が未生成/未到達）でも「count対象: 判定可能」と出す（判定不可にしない）
          //   - フォールバックで別ソースから埋め合わせない（取れなければ取れない表示）

          function ymdNumToIso(ymdNum){
            try{
              const s = String(ymdNum);
              if (!/^\d{8}$/.test(s)) return "";
              return s.slice(0,4) + "-" + s.slice(4,6) + "-" + s.slice(6,8);
            }catch(_){
              return "";
            }
          }

          function ymdStrToIso(ymdStr){
            try{
              const s = String(ymdStr || "").trim();
              if (!/^\d{8}$/.test(s)) return "";
              return s.slice(0,4) + "-" + s.slice(4,6) + "-" + s.slice(6,8);
            }catch(_){
              return "";
            }
          }

          function getTodayYmdNum(){
            try{
              const now = new Date();
              const yy = now.getFullYear();
              const mm = now.getMonth() + 1;
              const dd = now.getDate();
              return yy * 10000 + mm * 100 + dd;
            }catch(_){
              return null;
            }
          }

          // ---- 参照元を固定（フォールバックしない） ----
          const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
            ? window.__cscs_sync_state
            : null;

          const once = (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object")
            ? state.oncePerDayToday
            : null;

          const odoaMode = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
          const odoaText = (odoaMode === "on") ? "ON" : (odoaMode === "off") ? "OFF" : "unknown";

          const todayYmd = getTodayYmdNum();

          // ---- oncePerDayToday の状態判定 ----
          let isTodayOnce = false;
          let onceDayIso = "";
          let lastRecordedDayIso = "";
          let measuredResult = null; // "correct" | "wrong" | null

          try{
            // day は number or string(8桁) の両方が来うる想定だが、今日判定は「8桁化」して行う
            let onceDayNum = null;

            if (once && typeof once.day === "number" && Number.isFinite(once.day) && once.day > 0) {
              onceDayNum = once.day;
              const iso = ymdNumToIso(onceDayNum);
              if (iso) {
                lastRecordedDayIso = iso;
              }
            } else if (once && typeof once.day === "string") {
              const iso = ymdStrToIso(once.day);
              if (iso) {
                lastRecordedDayIso = iso;
              }
              if (/^\d{8}$/.test(String(once.day || "").trim())) {
                onceDayNum = parseInt(String(once.day).trim(), 10);
              }
            }

            if (todayYmd !== null && onceDayNum !== null && onceDayNum === todayYmd) {
              isTodayOnce = true;
              onceDayIso = ymdNumToIso(todayYmd);

              if (once && once.results && typeof once.results === "object") {
                const r = once.results[QID];
                if (r === "correct" || r === "wrong") {
                  measuredResult = r;
                } else if (Object.prototype.hasOwnProperty.call(once.results, QID)) {
                  // 値があるが想定外 → 計測済として扱う（表示は unknown）
                  measuredResult = "unknown";
                } else {
                  measuredResult = null;
                }
              } else {
                measuredResult = null;
              }
            }
          }catch(_){
            isTodayOnce = false;
            measuredResult = null;
          }

          // ---- 表示文の組み立て（指定フォーマット） ----
          let line1 = "";
          let line2 = "";
          let line3 = "";
          let line4 = "";

          if (!isTodayOnce) {
            // oncePerDayToday: 未開始
            line1 = "oncePerDayToday: 未開始";
            line2 = "lastRecordedDay: " + (lastRecordedDayIso ? lastRecordedDayIso : "（データなし）");
            line3 = "count対象: 判定可能";

            // 未開始状態では累計加算は「Yes」と表示（この行は ODOA 側に寄せる）
            line4 = "ODOA: " + odoaText + " (累計加算: Yes)";
          } else {
            // oncePerDayToday: 計測中
            line1 = "oncePerDayToday: 計測中";
            line2 = "Today: " + (onceDayIso ? onceDayIso : "（データなし）");

            if (measuredResult === "correct" || measuredResult === "wrong") {
              line3 = "count対象: No 計測済(" + measuredResult + ")";
            } else if (measuredResult === "unknown") {
              line3 = "count対象: No 計測済(unknown)";
            } else {
              line3 = "count対象: Yes 未計測";
            }

            // ODOA 側の「累計加算: Yes/No」
            //   - ODOA: OFF は常に Yes
            //   - ODOA: ON は count対象が No（計測済）なら No、それ以外は Yes
            let addYesNo = "Yes";
            if (odoaMode === "off") {
              addYesNo = "Yes";
            } else if (odoaMode === "on") {
              const counted = (measuredResult === "correct" || measuredResult === "wrong" || measuredResult === "unknown");
              addYesNo = counted ? "No" : "Yes";
            } else {
              addYesNo = "unknown";
            }
            line4 = "ODOA: " + odoaText + " (累計加算: " + addYesNo + ")";
          }

          onceEl.innerHTML =
            '<div class="once-grid">' +

              '<div class="once-label">oncePerDayToday</div>' +
              '<div class="once-val">' + line1.replace(/^oncePerDayToday:\s*/, "") + '</div>' +

              '<div class="once-label">' +
                (isTodayOnce ? 'Today' : 'lastRecordedDay') +
              '</div>' +
              '<div class="once-val">' +
                (isTodayOnce
                  ? line2.replace(/^Today:\s*/, "")
                  : line2.replace(/^lastRecordedDay:\s*/, "")
                ) +
              '</div>' +

              '<div class="once-label">count対象</div>' +
              '<div class="once-val">' +
                line3.replace(/^count対象:\s*/, "") +
              '</div>' +

              '<div class="once-label">ODOA</div>' +
              '<div class="once-val">' +
                line4.replace(/^ODOA:\s*/, "") +
              '</div>' +

            '</div>';
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
        // ============================================================
        // ★ フォールバック無し：mergeレスポンスから「確実に取れた値だけ」を採用する
        // ------------------------------------------------------------
        // - 値が欠損/型不正なら console.error で原因を確実に可視化
        // - 欠損時は dataset（UI表示の“サーバー値”）も更新しない
        // ============================================================
        function readMapNumberStrict(src, mapKey, qid){
          // ★ 処理1: mapの存在チェック（無ければログ＆失敗）
          if (!src || typeof src !== "object" || !src[mapKey] || typeof src[mapKey] !== "object") {
            console.error("[SYNC-A][NO-FALLBACK] merge response missing map", {
              qid: qid,
              mapKey: mapKey,
              gotType: src && typeof src === "object" ? typeof src[mapKey] : typeof src
            });
            return { ok: false, value: null };
          }

          // ★ 処理2: qidキーの存在チェック（無ければログ＆失敗）
          if (!Object.prototype.hasOwnProperty.call(src[mapKey], qid)) {
            console.error("[SYNC-A][NO-FALLBACK] merge response missing qid entry", {
              qid: qid,
              mapKey: mapKey
            });
            return { ok: false, value: null };
          }

          // ★ 処理3: number検証（非number/NaN/負数はログ＆失敗）
          const v = src[mapKey][qid];
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
            console.error("[SYNC-A][NO-FALLBACK] merge response invalid number", {
              qid: qid,
              mapKey: mapKey,
              value: v,
              valueType: typeof v
            });
            return { ok: false, value: null };
          }

          // ★ 処理4: 成功ログ（必要十分な情報だけ）
          console.log("[SYNC-A][OK] merge response value", {
            qid: qid,
            mapKey: mapKey,
            value: v
          });
          return { ok: true, value: v };
        }

        const rc  = readMapNumberStrict(latest, "correct", QID);
        const ri  = readMapNumberStrict(latest, "incorrect", QID);
        const rs3 = readMapNumberStrict(latest, "streak3", QID);
        const rsl = readMapNumberStrict(latest, "streakLen", QID);
        const rs3w = readMapNumberStrict(latest, "streak3Wrong", QID);
        const rslw = readMapNumberStrict(latest, "streakWrongLen", QID);

        // ★ 処理5: 全て取れた場合のみ、UIのサーバー値を更新する（欠損時は上書きしない）
        if (rc.ok && ri.ok && rs3.ok && rsl.ok && rs3w.ok && rslw.ok) {
          setServerTotalsForQid(rc.value, ri.value, rs3.value, rsl.value);

          console.log("[SYNC-A][OK] sendDelta merged server snapshot for this QID", {
            qid: QID,
            correctTotal: rc.value,
            wrongTotal: ri.value,
            streak3Correct: rs3.value,
            streakLenCorrect: rsl.value,
            streak3Wrong: rs3w.value,
            streakLenWrong: rslw.value
          });
        } else {
          console.error("[SYNC-A][NO-OVERWRITE] sendDelta skipped server totals update (missing/invalid)", {
            qid: QID,
            ok: {
              correct: rc.ok,
              incorrect: ri.ok,
              streak3: rs3.ok,
              streakLen: rsl.ok,
              streak3Wrong: rs3w.ok,
              streakWrongLen: rslw.ok
            }
          });
        }
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

      // ============================================================
      // ★ フォールバック無し：server state から「確実に取れた値だけ」を採用する
      // ------------------------------------------------------------
      // - 欠損/型不正なら console.error で確実に可視化
      // - 欠損時は以降の localStorage 同期（上書き）も行わない
      // ============================================================
      function readStateMapNumberStrict(state, mapKey, qid){
        // ★ 処理1: mapの存在チェック
        if (!state || typeof state !== "object" || !state[mapKey] || typeof state[mapKey] !== "object") {
          console.error("[SYNC-A][NO-FALLBACK] state missing map", {
            qid: qid,
            mapKey: mapKey,
            gotType: state && typeof state === "object" ? typeof state[mapKey] : typeof state
          });
          return { ok: false, value: null };
        }

        // ★ 処理2: qidキーの存在チェック
        if (!Object.prototype.hasOwnProperty.call(state[mapKey], qid)) {
          console.error("[SYNC-A][NO-FALLBACK] state missing qid entry", {
            qid: qid,
            mapKey: mapKey
          });
          return { ok: false, value: null };
        }

        // ★ 処理3: number検証
        const v = state[mapKey][qid];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          console.error("[SYNC-A][NO-FALLBACK] state invalid number", {
            qid: qid,
            mapKey: mapKey,
            value: v,
            valueType: typeof v
          });
          return { ok: false, value: null };
        }

        // ★ 処理4: 成功ログ
        console.log("[SYNC-A][OK] state value", {
          qid: qid,
          mapKey: mapKey,
          value: v
        });
        return { ok: true, value: v };
      }

      const rc  = readStateMapNumberStrict(s, "correct", QID);
      const ri  = readStateMapNumberStrict(s, "incorrect", QID);
      const rs3 = readStateMapNumberStrict(s, "streak3", QID);
      const rsl = readStateMapNumberStrict(s, "streakLen", QID);
      const rs3w = readStateMapNumberStrict(s, "streak3Wrong", QID);
      const rslw = readStateMapNumberStrict(s, "streakWrongLen", QID);

      // ★ 処理5: 以降の同期可否（全部そろってる時だけ同期する）
      const canSyncQidNumbers = !!(rc.ok && ri.ok && rs3.ok && rsl.ok && rs3w.ok && rslw.ok);

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
        // ============================================================
        // ★ フォールバック無し：oncePerDayToday が取れない/壊れている場合は上書きしない
        // ------------------------------------------------------------
        // - day が number でない / results が object でない → console.error
        // - その場合 localStorage は setItem/removeItem を一切しない
        // ============================================================
        const hasOnce = !!oncePerDayToday;
        const okDay = !!(hasOnce && typeof oncePerDayToday.day === "number" && Number.isFinite(oncePerDayToday.day));
        const okResults = !!(hasOnce && oncePerDayToday.results && typeof oncePerDayToday.results === "object");

        if (okDay && okResults) {
          localStorage.setItem("cscs_once_per_day_today_day", String(oncePerDayToday.day));
          localStorage.setItem("cscs_once_per_day_today_results", JSON.stringify(oncePerDayToday.results));

          console.log("[SYNC-A][OK] initialFetch synced oncePerDayToday from server to localStorage", {
            day: oncePerDayToday.day,
            resultsKeys: Object.keys(oncePerDayToday.results || {}).length
          });
        } else {
          console.error("[SYNC-A][NO-OVERWRITE] initialFetch skipped oncePerDayToday localStorage sync (missing/invalid)", {
            hasOnce: hasOnce,
            okDay: okDay,
            okResults: okResults,
            dayType: hasOnce ? typeof oncePerDayToday.day : null,
            resultsType: hasOnce ? typeof oncePerDayToday.results : null
          });
        }
      }catch(eOnceSync){
        console.error("[SYNC-A][ERROR] initialFetch oncePerDayToday sync failed", {
          error: String(eOnceSync && eOnceSync.message || eOnceSync)
        });
      }

      // ★ 追加: SYNC 側 streak3Today を正として localStorage 側も同期する
      //   - state.streak3Today を唯一のソースとして、
      //     「今日の⭐️ユニーク数」関連の localStorage を上書きする。
      const streak3Today = (s && s.streak3Today && typeof s.streak3Today === "object")
        ? s.streak3Today
        : null;

      try{
        // ============================================================
        // ★ フォールバック無し：streak3Today が取れない/壊れている場合は上書きしない
        // ------------------------------------------------------------
        // - day / unique_count / qids を検証し、NGなら console.error
        // - NG時は localStorage を set/remove しない（0埋め禁止）
        // ============================================================
        const hasObj = !!streak3Today;
        const okDay = !!(hasObj && ("day" in streak3Today) && String(streak3Today.day || "").trim() !== "");
        const okCount = !!(hasObj && typeof streak3Today.unique_count === "number" && Number.isFinite(streak3Today.unique_count) && streak3Today.unique_count >= 0);
        const okQids = !!(hasObj && Array.isArray(streak3Today.qids));

        if (okDay && okCount && okQids) {
          localStorage.setItem("cscs_streak3_today_day", String(streak3Today.day));
          localStorage.setItem("cscs_streak3_today_unique_count", String(streak3Today.unique_count));
          localStorage.setItem("cscs_streak3_today_qids", JSON.stringify(streak3Today.qids));

          console.log("[SYNC-A][OK] initialFetch synced streak3Today from server to localStorage", {
            day: String(streak3Today.day),
            unique_count: streak3Today.unique_count,
            qidsLen: streak3Today.qids.length
          });
        } else {
          console.error("[SYNC-A][NO-OVERWRITE] initialFetch skipped streak3Today localStorage sync (missing/invalid)", {
            hasObj: hasObj,
            okDay: okDay,
            okCount: okCount,
            okQids: okQids,
            dayType: hasObj ? typeof streak3Today.day : null,
            countType: hasObj ? typeof streak3Today.unique_count : null,
            qidsIsArray: hasObj ? Array.isArray(streak3Today.qids) : null
          });
        }
      }catch(eS3t){
        console.error("[SYNC-A][ERROR] initialFetch streak3Today sync failed", {
          error: String(eS3t && eS3t.message || eS3t)
        });
      }

      // ★ 追加: SYNC 側 streak3WrongToday を正として localStorage 側も同期する
      //   - state.streak3WrongToday を唯一のソースとして、
      //     「今日の3連続不正解ユニーク数」関連の localStorage を上書きする。
      //   - フォールバックは行わず、state.streak3WrongToday が無ければ
      //     「day: 空 / unique_count: 0 / qids: 空配列」とみなす。
      const streak3WrongToday = (s && s.streak3WrongToday && typeof s.streak3WrongToday === "object")
        ? s.streak3WrongToday
        : null;

      try{
        // ============================================================
        // ★ フォールバック無し：streak3WrongToday が取れない/壊れている場合は上書きしない
        // ============================================================
        const hasObj = !!streak3WrongToday;
        const okDay = !!(hasObj && ("day" in streak3WrongToday) && String(streak3WrongToday.day || "").trim() !== "");
        const okCount = !!(hasObj && typeof streak3WrongToday.unique_count === "number" && Number.isFinite(streak3WrongToday.unique_count) && streak3WrongToday.unique_count >= 0);
        const okQids = !!(hasObj && Array.isArray(streak3WrongToday.qids));

        if (okDay && okCount && okQids) {
          localStorage.setItem("cscs_streak3_wrong_today_day", String(streak3WrongToday.day));
          localStorage.setItem("cscs_streak3_wrong_today_unique_count", String(streak3WrongToday.unique_count));
          localStorage.setItem("cscs_streak3_wrong_today_qids", JSON.stringify(streak3WrongToday.qids));

          console.log("[SYNC-A][OK] initialFetch synced streak3WrongToday from server to localStorage", {
            day: String(streak3WrongToday.day),
            unique_count: streak3WrongToday.unique_count,
            qidsLen: streak3WrongToday.qids.length
          });
        } else {
          console.error("[SYNC-A][NO-OVERWRITE] initialFetch skipped streak3WrongToday localStorage sync (missing/invalid)", {
            hasObj: hasObj,
            okDay: okDay,
            okCount: okCount,
            okQids: okQids,
            dayType: hasObj ? typeof streak3WrongToday.day : null,
            countType: hasObj ? typeof streak3WrongToday.unique_count : null,
            qidsIsArray: hasObj ? Array.isArray(streak3WrongToday.qids) : null
          });
        }
      }catch(eS3wt){
        console.error("[SYNC-A][ERROR] initialFetch streak3WrongToday sync failed", {
          error: String(eS3wt && eS3wt.message || eS3wt)
        });
      }

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

      // ============================================================
      // ★ フォールバック無し：QID数値が全部取れた場合のみ、dataset と localStorage を同期する
      // ------------------------------------------------------------
      // - 欠損/型不正があれば console.error を出して「一切上書きしない」
      // ============================================================
      if (canSyncQidNumbers) {
        setServerTotalsForQid(rc.value, ri.value, rs3.value, rsl.value);

        try{
          localStorage.setItem("cscs_q_correct_total:" + QID, String(rc.value));
          localStorage.setItem("cscs_q_wrong_total:"   + QID, String(ri.value));
          localStorage.setItem("cscs_q_correct_streak3_total:" + QID, String(rs3.value));
          localStorage.setItem("cscs_q_correct_streak_len:" + QID, String(rsl.value));
          localStorage.setItem("cscs_q_wrong_streak3_total:" + QID, String(rs3w.value));
          localStorage.setItem("cscs_q_wrong_streak_len:" + QID, String(rslw.value));

          console.log("[SYNC-A][OK] initialFetch synced qid numbers from server to localStorage", {
            qid: QID,
            correctTotal: rc.value,
            wrongTotal: ri.value,
            streak3Correct: rs3.value,
            streakLenCorrect: rsl.value,
            streak3Wrong: rs3w.value,
            streakLenWrong: rslw.value
          });
        }catch(eSync){
          console.error("[SYNC-A][ERROR] initialFetch localStorage sync failed", {
            qid: QID,
            error: String(eSync && eSync.message || eSync)
          });
        }
      } else {
        console.error("[SYNC-A][NO-OVERWRITE] initialFetch skipped qid localStorage sync (missing/invalid)", {
          qid: QID,
          ok: {
            correct: rc.ok,
            incorrect: ri.ok,
            streak3: rs3.ok,
            streakLen: rsl.ok,
            streak3Wrong: rs3w.ok,
            streakWrongLen: rslw.ok
          }
        });
      }

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
  font-weight: 400;
  margin: 0 3px 6px 0;
  text-align: right;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

#cscs_sync_monitor_a .sync-toggle-btn{
  appearance: none;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(0,0,0,0.45);
  color: #eee;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10.5px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.9;
}
#cscs_sync_monitor_a .sync-toggle-btn:active{
  transform: translateY(1px);
}

/* ★ OPEN/CLOSE で「オプション項目（指定4つ）」だけを隠す
   - パネル自体（ヘッダ/他カード）は常時表示
   - .sync-optional を付けたカードだけ非表示にする */
#cscs_sync_monitor_a.cscs-compact .sync-optional{
  display: none !important;
}

#cscs_sync_monitor_a .sync-grid{
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  width: auto;
}

#cscs_sync_monitor_a {
  position: fixed;
  right: 15px;
  top: 100px;
  color: #eee;
  padding: 8px;
  font: 10px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: 46vw;
  width: 310px;
  opacity: 0.55;
  z-index: 2147483647;
}

#cscs_sync_monitor_a details.sync-fold{
  margin: 0;
}
#cscs_sync_monitor_a details.sync-fold > summary{
  list-style: none;
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  font-size: 11px;
  opacity: 0.85;
  margin-bottom: 4px;
}
#cscs_sync_monitor_a details.sync-fold > summary::-webkit-details-marker{
  display: none;
}
#cscs_sync_monitor_a details.sync-fold > summary::before{
  content: "▶";
  display: inline-block;
  width: 14px;
  opacity: 0.85;
}
#cscs_sync_monitor_a details.sync-fold[open] > summary::before{
  content: "▼";
}

@media (max-width: 520px){
  #cscs_sync_monitor_a .sync-grid{
    grid-template-columns: 1fr;
  }
}
#cscs_sync_monitor_a .sync-card{
  border-radius: 10px;
  padding: 8px 10px;

  /* ガラス感：少し透けた黒 */
  background: rgba(0,0,0,0.52);


  /* エッジの光：薄い白枠 + ほんの少し内側のハイライト */
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);

  line-height: 1;
}
#cscs_sync_monitor_a .sync-card .sync-title{
  font-weight: 700;
  font-size: 11px;
  opacity: 0.85;
  margin-bottom: 5px;

  /* ★ 見出しは基本的に改行しない（入り切らない時は…） */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ★ 英語ラベルだけ少し薄く・軽く */
#cscs_sync_monitor_a .sync-card .sync-title .sync-title-en{
  opacity: 0.58;
  font-weight: 600;
  letter-spacing: 0.02em;
}
#cscs_sync_monitor_a .sync-card .sync-body{
  /* ★ グリッドのマス内では改行させない（必要なら行をグリッドで分ける） */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;

  /* ★ 詳細（本文）は見出しより少し弱めにして、階層をはっきりさせる */
  word-break: normal;
  font-weight: 400;
  opacity: 0.52;
  font-size: 10.25px;
  letter-spacing: 0.01em;
}

/* ★ “複数行” に見せたいものは <br> ではなく「小グリッド」で行を分ける */
#cscs_sync_monitor_a .mini-grid{
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0px 10px;
  font-size: 11px;
  line-height: 1.25;
}

#cscs_sync_monitor_a .mini-label{
  font-weight: 600;
  opacity: 0.80;
  white-space: nowrap;
}

#cscs_sync_monitor_a .mini-val{
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-weight: 850;
  font-size: 11.5px;
  letter-spacing: 0.03em;
  opacity: 0.96;
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

#cscs_sync_monitor_a .days-grid{
  display: grid;
  grid-template-columns: 150px 1fr 1fr 60px;
  gap: 4px 10px;
  align-items: center;
  font-size: 11px;
}

#cscs_sync_monitor_a .days-head{
  font-weight: 700;
  opacity: 0.8;
  white-space: nowrap;
}

#cscs_sync_monitor_a .days-label{
  opacity: 0.78;
  white-space: nowrap;
}

#cscs_sync_monitor_a .days-val{
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

#cscs_sync_monitor_a .delta-grid{
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 4px 10px;
  align-items: center;
  font-size: 11px;
}

#cscs_sync_monitor_a .delta-label{
  opacity: 0.78;
  white-space: nowrap;
}

#cscs_sync_monitor_a .delta-val{
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

#cscs_sync_monitor_a .once-grid{
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  font-size: 11px;
  line-height: 1.25;
}

#cscs_sync_monitor_a .once-label{
  font-weight: 600;
  opacity: 0.80;
  white-space: nowrap;
}

#cscs_sync_monitor_a .once-val{
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ============================================================
   ★ OncePerDayToday / O.D.O.A Mode 折りたたみ（カード単体）
   ------------------------------------------------------------
   - 見出し右端に「▶show / ▼hide」テキストボタン
   - 折りたたみ時は「見出し + 3行目（count対象）」だけ表示
   ============================================================ */
#cscs_sync_monitor_a .sync-card.once-card .sync-title{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

#cscs_sync_monitor_a .once-fold-btn{
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.86);
  font-weight: 700;
  font-size: 10.5px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0.92;
  white-space: nowrap;
}

#cscs_sync_monitor_a .once-fold-btn:active{
  transform: translateY(1px);
}

/* 折りたたみ時：once-grid のうち「3行目（count対象）」だけ残す
   once-grid の子要素は 8個（label/val ×4行）
   3行目は 5番目(label) と 6番目(val) */
#cscs_sync_monitor_a .sync-card.once-card.once-collapsed .once-grid > :not(:nth-child(5)):not(:nth-child(6)){
  display: none !important;
}

/* ============================================================
   ★ 右ブロック（値側）を右寄せに統一
   ------------------------------------------------------------
   - 2カラム系: mini-grid / status-grid / delta-grid / once-grid
   - Totals(c/w) 行: 2〜4列を右寄せ
   - lastday-grid / days-grid: 「ラベル以外」を右寄せ
   ============================================================ */
#cscs_sync_monitor_a .mini-val,
#cscs_sync_monitor_a .status-value,
#cscs_sync_monitor_a .delta-val,
#cscs_sync_monitor_a .once-val{
  text-align: right;
}

/* Totals(c/w) の行は 4カラムなので、値側(2〜4列)を右寄せ */
#cscs_sync_monitor_a .totals-row > :nth-child(2),
#cscs_sync_monitor_a .totals-row > :nth-child(3),
#cscs_sync_monitor_a .totals-row > :nth-child(4){
  text-align: right;
}

/* lastday-grid は 3カラム（label / SYNC / local）
   ★ 2列目（真ん中=SYNC列）だけセンター寄せ
   ★ 3列目（local列）は右寄せ */
#cscs_sync_monitor_a .lastday-grid > :nth-child(3n+2){
  text-align: center;
}
#cscs_sync_monitor_a .lastday-grid > :nth-child(3n+3){
  text-align: right;
}

/* ★ lastday 見出し（type / SYNC / local）の寄せ方：真ん中だけセンター */
#cscs_sync_monitor_a .sync-lastday-headline > :nth-child(2){
  text-align: center;
}
#cscs_sync_monitor_a .sync-lastday-headline > :nth-child(3){
  text-align: right;
}

/* days-grid は 4カラム（label / sync / local / isToday） */
#cscs_sync_monitor_a .days-grid > :nth-child(4n+2),
#cscs_sync_monitor_a .days-grid > :nth-child(4n+3),
#cscs_sync_monitor_a .days-grid > :nth-child(4n+4){
  text-align: right;
}

/* ★ lastday は折りたたみ無し：常時表示の1行ヘッダー */
#cscs_sync_monitor_a .sync-lastday-headline{
  display: grid;

  /* ★ lastday-grid と列幅を完全一致させる（label=80px / SYNC / local） */
  grid-template-columns: 80px minmax(0,1fr) minmax(0,1fr);

  column-gap: 10px;
  align-items: baseline;
  white-space: nowrap;
  overflow: hidden;
  margin-bottom: 6px;
  font-weight: 700;
  font-size: 11px;
  opacity: 0.85;
}

/* ★ type */
#cscs_sync_monitor_a .sync-lastday-headline .sync-lastday-summary-type{
  font-weight: 700;
  opacity: 0.90;
}

/* ★ SYNC/local は「縮む列」に入れ、入り切らない時は … で省略する */
#cscs_sync_monitor_a .sync-lastday-headline .sync-lastday-summary-sync{
  font-variant-numeric: tabular-nums;
  opacity: 0.88;
  font-size: 10px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
#cscs_sync_monitor_a .sync-lastday-headline .sync-lastday-summary-local{
  font-variant-numeric: tabular-nums;
  opacity: 0.88;
  font-size: 10px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
          `.trim();
          (document.head || document.documentElement).appendChild(st);
        }
      }catch(_){}

      const box = document.createElement("div");
      box.id = "cscs_sync_monitor_a";
      box.innerHTML = `
        <div class="sync-header">
          <span>SYNC(A): <span class="sync-qid"></span></span>
          <button type="button" class="sync-toggle-btn" data-sync-toggle="1">OPEN</button>
        </div>

        <div class="sync-grid">
          <div class="sync-card sync-span-2">
            <div class="sync-body totals-row">
              <div class="sync-totals-label">Totals(c/w)</div>

              <div id="cscs_sync_totals" class="sync-totals" data-server-c="0" data-server-i="0">
                <span class="sync-server-text">SYNC 0 / 0</span>
              </div>

              <div class="sync-local">local  0 / 0</div>
              <div class="sync-queue">+Δ    0 / 0</div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">⭐️3連続正解数 <span class="sync-title-en">Count</span></div>
            <div class="sync-body sync-streak3">
              SYNC <span class="sync-streak3-server">0</span> 回 / local <span class="sync-streak3-val">0</span> 回
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">💣3連続不正解 <span class="sync-title-en">Count</span></div>
            <div class="sync-body sync-wrong-streak3">
              SYNC <span class="sync-wrong-streak3-server">0</span> 回 / local <span class="sync-wrong-streak3-val">0</span> 回
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続正解 進捗 <span class="sync-title-en">Progress</span></div>
            <div class="sync-body sync-streaklen">
              SYNC (<span class="sync-streaklen-server-progress">0</span>/3) /
              local (<span class="sync-streaklen-local-progress">0</span>/3)
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">3連続不正解 進捗 <span class="sync-title-en">Progress</span></div>
            <div class="sync-body sync-wrong-streaklen">
              SYNC (<span class="sync-wrong-streaklen-server-progress">0</span>/3) /
              local (<span class="sync-wrong-streaklen-local-progress">0</span>/3)
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">Streak3TodayUnique</div>
            <div class="sync-body sync-streak3today">
              <div class="mini-grid">
                <div class="mini-label">day</div>
                <div class="mini-val"><span class="sync-streak3today-day">-</span></div>

                <div class="mini-label">unique</div>
                <div class="mini-val">sync <span class="sync-streak3today-sync">0</span> / local <span class="sync-streak3today-local">0</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">Streak3WrongTodayUq</div>
            <div class="sync-body sync-streak3wrongtoday">
              <div class="mini-grid">
                <div class="mini-label">day</div>
                <div class="mini-val"><span class="sync-streak3wrongtoday-day">-</span></div>

                <div class="mini-label">unique</div>
                <div class="mini-val">sync <span class="sync-streak3wrongtoday-sync">0</span> / local <span class="sync-streak3wrongtoday-local">0</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">連続正解 (Local)</div>
            <div class="sync-body">
              <div class="mini-grid">
                <div class="mini-label">streak_len</div>
                <div class="mini-val"><span class="sync-streakmax-len-local">（データなし）</span></div>

                <div class="mini-label">streak_max</div>
                <div class="mini-val"><span class="sync-streakmax-max-local">（データなし）</span></div>

                <div class="mini-label">max_day</div>
                <div class="mini-val"><span class="sync-streakmax-maxday-local">（データなし）</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">連続不正解 (Local)</div>
            <div class="sync-body">
              <div class="mini-grid">
                <div class="mini-label">streak_len</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-len-local">（データなし）</span></div>

                <div class="mini-label">streak_max</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-max-local">（データなし）</span></div>

                <div class="mini-label">max_day</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-maxday-local">（データなし）</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card sync-span-2 once-card">
            <div class="sync-title">
              <span class="once-title-text">OncePerDayToday / O.D.O.A Mode</span>
              <button type="button" class="once-fold-btn" data-once-fold="1">▶show</button>
            </div>
            <div class="sync-body sync-onceperday">oncePerDayToday: （データなし）</div>
          </div>

          <div class="sync-card sync-span-2">
            <div class="sync-lastday-headline">
              <span class="sync-lastday-summary-type">LastCorrect</span>
              <span class="sync-lastday-summary-sync">SYNC （データなし）</span>
              <span class="sync-lastday-summary-local">local （データなし）</span>
            </div>

            <div class="sync-body sync-lastday">
              <div class="lastday-grid">
                <div class="ld-label ld-row-lastseen">lastSeen</div>
                <div class="ld-row-lastseen"><span class="sync-last-seen-sync">（データなし）</span></div>
                <div class="ld-row-lastseen"><span class="sync-last-seen-local">（データなし）</span></div>

                <div class="ld-label ld-row-lastcorrect">lastCorrect</div>
                <div class="ld-row-lastcorrect"><span class="sync-last-correct-sync">（データなし）</span></div>
                <div class="ld-row-lastcorrect"><span class="sync-last-correct-local">（データなし）</span></div>

                <div class="ld-label ld-row-lastwrong">lastWrong</div>
                <div class="ld-row-lastwrong"><span class="sync-last-wrong-sync">（データなし）</span></div>
                <div class="ld-row-lastwrong"><span class="sync-last-wrong-local">（データなし）</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card sync-span-2">
            <details class="sync-fold" data-fold="queue">
              <summary>Queue Δ detail（送信待ち）</summary>
              <div class="sync-body">
                <div class="delta-grid">
                  <div class="delta-label">Totals(c/w)</div>
                  <div class="delta-val"><span class="sync-queue-cw">0 / 0</span></div>

                  <div class="delta-label">streak3Delta</div>
                  <div class="delta-val"><span class="sync-queue-s3">0</span></div>

                  <div class="delta-label">streakLenDelta</div>
                  <div class="delta-val"><span class="sync-queue-sl">（なし）</span></div>

                  <div class="delta-label">streak3WrongDelta</div>
                  <div class="delta-val"><span class="sync-queue-s3w">0</span></div>

                  <div class="delta-label">streakWrongLenDelta</div>
                  <div class="delta-val"><span class="sync-queue-slw">（なし）</span></div>

                  <div class="delta-label">lastSeenDayDelta</div>
                  <div class="delta-val"><span class="sync-queue-lastseen">（なし）</span></div>

                  <div class="delta-label">lastCorrectDayDelta</div>
                  <div class="delta-val"><span class="sync-queue-lastcorrect">（なし）</span></div>

                  <div class="delta-label">lastWrongDayDelta</div>
                  <div class="delta-val"><span class="sync-queue-lastwrong">（なし）</span></div>
                </div>
              </div>
            </details>
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

      // === ④ 折りたたみ状態の復元＆永続化（モニタ全体 / Days / Queue） ===
      try{
        /* ★ OPEN/CLOSE は「パネル全体」ではなく「指定4項目（sync-optional）だけ」を出し入れする
           - cscs-compact: オプション項目を隠す（デフォルト）
           - compact 解除: オプション項目を表示（＝OPEN状態）
           - 状態は LS_MON_OPEN に保存し、リロード後も維持 */
        const monitorOpen = readLsBool(LS_MON_OPEN, false);  // デフォルトはCLOSE（オプション非表示）
        if (monitorOpen) {
          box.classList.remove("cscs-compact");
        } else {
          box.classList.add("cscs-compact");
        }

        const toggleBtn = box.querySelector('button[data-sync-toggle="1"]');
        function refreshToggleBtnLabel(){
          if (!toggleBtn) return;
          const isOpen = !box.classList.contains("cscs-compact"); // compact解除＝OPEN
          toggleBtn.textContent = isOpen ? "CLOSE" : "OPEN";
        }
        refreshToggleBtnLabel();

        if (toggleBtn) {
          toggleBtn.addEventListener("click", function(){
            // ★ クリックで「オプション項目」だけをトグル（他の項目は常時表示）
            const nextOpen = box.classList.contains("cscs-compact"); // 今CLOSE(=compact)ならOPENへ
            if (nextOpen) {
              box.classList.remove("cscs-compact");
            } else {
              box.classList.add("cscs-compact");
            }
            // ★ 永続化：OPEN状態（true/false）を保存
            writeLsBool(LS_MON_OPEN, nextOpen);
            refreshToggleBtnLabel();
          });
        }

        const daysDetails       = box.querySelector('details.sync-fold[data-fold="days"]');
        const queueDetails      = box.querySelector('details.sync-fold[data-fold="queue"]');

        // ============================================================
        // ★ OncePerDayToday / O.D.O.A Mode：カード単体の折りたたみ
        // ------------------------------------------------------------
        // - 見出し右端: 「▶show / ▼hide」
        // - 折りたたみ時: 見出し + 3行目（count対象）のみ表示
        // - 状態は localStorage に永続化
        // ============================================================
        const LS_ONCE_OPEN = "cscs_sync_a_onceperday_open";
        const onceCard = box.querySelector(".sync-card.once-card");
        const onceFoldBtn = box.querySelector('button[data-once-fold="1"]');

        function refreshOnceFoldBtnLabel(){
          if (!onceFoldBtn) return;
          const isOpen = !(onceCard && onceCard.classList.contains("once-collapsed"));
          onceFoldBtn.textContent = isOpen ? "▼hide" : "▶show";
        }

        try{
          const onceOpen = readLsBool(LS_ONCE_OPEN, false); // デフォルトは折りたたみ（closed）
          if (onceCard) {
            if (onceOpen) {
              onceCard.classList.remove("once-collapsed");
            } else {
              onceCard.classList.add("once-collapsed");
            }
          }
          refreshOnceFoldBtnLabel();
        }catch(_){}

        if (onceFoldBtn) {
          onceFoldBtn.addEventListener("click", function(){
            try{
              if (!onceCard) return;
              const nextOpen = onceCard.classList.contains("once-collapsed"); // 今閉じてるなら開く
              if (nextOpen) {
                onceCard.classList.remove("once-collapsed");
              } else {
                onceCard.classList.add("once-collapsed");
              }
              writeLsBool(LS_ONCE_OPEN, nextOpen);
              refreshOnceFoldBtnLabel();
            }catch(_){}
          });
        }

        /* ★ OPEN/CLOSE の対象カード（指定4項目）をマーキングする
           - HTML文字列を直接いじらず、生成後DOMから「days/queue」のdetailsを特定
           - それぞれの親 .sync-card に sync-optional を付ける（CLOSE時に消える対象） */
        function markOptional(detailsEl){
          try{
            if (!detailsEl) return;
            const card = detailsEl.closest(".sync-card");
            if (card) {
              card.classList.add("sync-optional");
            }
          }catch(_){}
        }
        markOptional(daysDetails);
        markOptional(queueDetails);

        const daysOpen        = readLsBool(LS_DAYS_OPEN, false);        // デフォルト閉じ
        const queueOpen       = readLsBool(LS_QDEL_OPEN, false);        // デフォルト閉じ

        if (daysDetails)        daysDetails.open        = !!daysOpen;
        if (queueDetails)       queueDetails.open       = !!queueOpen;

        if (daysDetails) {
          daysDetails.addEventListener("toggle", function(){
            writeLsBool(LS_DAYS_OPEN, !!daysDetails.open);
          });
        }
        if (queueDetails) {
          queueDetails.addEventListener("toggle", function(){
            writeLsBool(LS_QDEL_OPEN, !!queueDetails.open);
          });
        }
      }catch(_){}

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