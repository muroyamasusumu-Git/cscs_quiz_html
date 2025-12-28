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
  * ▼ LocalStorage キー
 *   - "cscs_fav"
 *   - "cscs_fav_map"
 *   - "cscs_results"
 *   - "cscs_wrong_log"
 *   - "cscs_q_correct_total:" + qid      // b_judge_record.js 由来の問題別「正解」累計
 *   - "cscs_q_wrong_total:"   + qid      // b_judge_record.js 由来の問題別「不正解」累計
 *   - "cscs_exam_date"                    // 試験日カレンダー用
 *   - "cscs_sync_key"                     // SYNC state 取得に使うキー（X-CSCS-Key）
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

  // 空欄を「-」で表示する共通ヘルパー（フォールバック埋め禁止）
  //   - null / undefined / "" / 空白のみ → "-"
  //   - 0 は「本当に 0 の場合だけ」"0" として表示される（呼び出し元で null と区別する）
  function toDisplayText(value, emptyLabel){
    // ★ 処理1: 欠損（null/undefined/空文字）を "-" に統一する
    const fallback = emptyLabel != null ? String(emptyLabel) : "-";
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

      // ★ 処理: localStorage の数値を「厳密」に読む（欠損/空/非数 → null、"0" → 0）
      function readLsNonNegIntOrNull(key){
        const raw = localStorage.getItem(key);

        // 欠損は null（0埋め禁止）
        if (raw === null || raw === undefined) return null;

        const s = String(raw).trim();
        if (s === "") return null;

        // 数字以外は null（0埋め禁止）
        if (!/^\d+$/.test(s)) return null;

        const n = parseInt(s, 10);
        if (!Number.isFinite(n) || n < 0) return null;

        return n;
      }

      const c = readLsNonNegIntOrNull(kC);
      const w = readLsNonNegIntOrNull(kW);

      return { c, w };
    }catch(_){
      // ★ 方針: 例外でも 0 にせず null（欠損扱い）にする
      return { c: null, w: null };
    }
  }

  function readLocalStreak3ForQid(qid){
    try{
      const kS = "cscs_q_correct_streak3_total:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kS);
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

  function readLocalStreakLenForQid(qid){
    try{
      const kL = "cscs_q_correct_streak_len:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kL);
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

  // ★ 追加: localStorage から「最高連続正解数（過去最高）」を読み取る
  //   - b_judge_record.js が "cscs_q_correct_streak_max:{qid}" に保存している値をそのまま利用
  function readLocalStreakMaxForQid(qid){
    try{
      const kM = "cscs_q_correct_streak_max:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kM);
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

  // ★ 追加: localStorage から「最高連続正解数を更新した達成日（JST YYYYMMDD）」を読み取る
  //   - b_judge_record.js が "cscs_q_correct_streak_max_day:{qid}" に保存している値をそのまま利用
  function readLocalStreakMaxDayForQid(qid){
    try{
      const kD = "cscs_q_correct_streak_max_day:" + qid;
      const v = localStorage.getItem(kD);

      // ★ 処理1: 欠損/空は null（空文字で埋めない）
      if (v === null || v === undefined) {
        console.log("[SYNC-A][NO-FALLBACK][LS] streakMaxDay missing -> null", { qid: qid, key: kD });
        return null;
      }
      const s = String(v).trim();
      if (s === "") {
        console.log("[SYNC-A][NO-FALLBACK][LS] streakMaxDay empty -> null", { qid: qid, key: kD, raw: v });
        return null;
      }

      // ★ 処理2: 成功ログ（取得できた事実を確実に可視化）
      console.log("[SYNC-A][OK][LS] streakMaxDay ok", { qid: qid, key: kD, value: s });
      return s;
    }catch(e){
      console.error("[SYNC-A][NO-FALLBACK][LS] streakMaxDay read exception -> null", {
        qid: qid,
        error: String(e && e.message || e)
      });
      return null;
    }
  }

  // ★ 不正解側: localStorage から「3連続不正解回数」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak3_total:{qid}" に加算した値をそのまま利用
  function readLocalWrongStreak3ForQid(qid){
    try{
      const kS = "cscs_q_wrong_streak3_total:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kS);
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

  // ★ 不正解側: localStorage から「現在の連続不正解長」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_len:{qid}" に保存している最新値
  function readLocalWrongStreakLenForQid(qid){
    try{
      const kL = "cscs_q_wrong_streak_len:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kL);
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

  // ★ 追加: localStorage から「最高連続不正解数（過去最高）」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_max:{qid}" に保存している値をそのまま利用
  function readLocalWrongStreakMaxForQid(qid){
    try{
      const kM = "cscs_q_wrong_streak_max:" + qid;

      // ★ 処理: 欠損/空/非数は null（0埋め禁止）
      const raw = localStorage.getItem(kM);
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

  // ★ 追加: localStorage から「最高連続不正解数を更新した達成日（JST YYYYMMDD）」を読み取る
  //   - b_judge_record.js が "cscs_q_wrong_streak_max_day:{qid}" に保存している値をそのまま利用
  function readLocalWrongStreakMaxDayForQid(qid){
    try{
      const kD = "cscs_q_wrong_streak_max_day:" + qid;
      const v = localStorage.getItem(kD);

      // ★ 処理1: 欠損/空は null（空文字で埋めない）
      if (v === null || v === undefined) {
        console.log("[SYNC-A][NO-FALLBACK][LS] wrongStreakMaxDay missing -> null", { qid: qid, key: kD });
        return null;
      }
      const s = String(v).trim();
      if (s === "") {
        console.log("[SYNC-A][NO-FALLBACK][LS] wrongStreakMaxDay empty -> null", { qid: qid, key: kD, raw: v });
        return null;
      }

      // ★ 処理2: 成功ログ
      console.log("[SYNC-A][OK][LS] wrongStreakMaxDay ok", { qid: qid, key: kD, value: s });
      return s;
    }catch(e){
      console.error("[SYNC-A][NO-FALLBACK][LS] wrongStreakMaxDay read exception -> null", {
        qid: qid,
        error: String(e && e.message || e)
      });
      return null;
    }
  }

  // ★ 問題別 最終日情報: localStorage から「最終閲覧日」を読み取る
  function readLocalLastSeenDayForQid(qid){
    try{
      const k = "cscs_q_last_seen_day:" + qid;
      const v = localStorage.getItem(k);

      // ★ 処理1: 欠損/空は null（空文字で埋めない）
      if (v === null || v === undefined) {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastSeenDay missing -> null", { qid: qid, key: k });
        return null;
      }
      const s = String(v).trim();
      if (s === "") {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastSeenDay empty -> null", { qid: qid, key: k, raw: v });
        return null;
      }

      // ★ 処理2: 成功ログ
      console.log("[SYNC-A][OK][LS] lastSeenDay ok", { qid: qid, key: k, value: s });
      return s;
    }catch(e){
      console.error("[SYNC-A][NO-FALLBACK][LS] lastSeenDay read exception -> null", {
        qid: qid,
        error: String(e && e.message || e)
      });
      return null;
    }
  }

  // ★ 問題別 最終日情報: localStorage から「最終正解日」を読み取る
  function readLocalLastCorrectDayForQid(qid){
    try{
      const k = "cscs_q_last_correct_day:" + qid;
      const v = localStorage.getItem(k);

      // ★ 処理1: 欠損/空は null（空文字で埋めない）
      if (v === null || v === undefined) {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastCorrectDay missing -> null", { qid: qid, key: k });
        return null;
      }
      const s = String(v).trim();
      if (s === "") {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastCorrectDay empty -> null", { qid: qid, key: k, raw: v });
        return null;
      }

      // ★ 処理2: 成功ログ
      console.log("[SYNC-A][OK][LS] lastCorrectDay ok", { qid: qid, key: k, value: s });
      return s;
    }catch(e){
      console.error("[SYNC-A][NO-FALLBACK][LS] lastCorrectDay read exception -> null", {
        qid: qid,
        error: String(e && e.message || e)
      });
      return null;
    }
  }

  // ★ 問題別 最終日情報: localStorage から「最終不正解日」を読み取る
  function readLocalLastWrongDayForQid(qid){
    try{
      const k = "cscs_q_last_wrong_day:" + qid;
      const v = localStorage.getItem(k);

      // ★ 処理1: 欠損/空は null（空文字で埋めない）
      if (v === null || v === undefined) {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastWrongDay missing -> null", { qid: qid, key: k });
        return null;
      }
      const s = String(v).trim();
      if (s === "") {
        console.log("[SYNC-A][NO-FALLBACK][LS] lastWrongDay empty -> null", { qid: qid, key: k, raw: v });
        return null;
      }

      // ★ 処理2: 成功ログ
      console.log("[SYNC-A][OK][LS] lastWrongDay ok", { qid: qid, key: k, value: s });
      return s;
    }catch(e){
      console.error("[SYNC-A][NO-FALLBACK][LS] lastWrongDay read exception -> null", {
        qid: qid,
        error: String(e && e.message || e)
      });
      return null;
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

      // ★ 処理: 「|| 0」で欠損を0埋めしない（欠損は null のままにして可視化）
      const hasDC = Object.prototype.hasOwnProperty.call(queue.correctDelta, QID);
      const hasDI = Object.prototype.hasOwnProperty.call(queue.incorrectDelta, QID);

      const dC = hasDC ? queue.correctDelta[QID] : null;
      const dI = hasDI ? queue.incorrectDelta[QID] : null;

      // ★ 処理: 欠損/数値をコンソールで確実に判別できるログ
      console.log("[SYNC-A][NO-FALLBACK][QUEUE] delta snapshot", {
        qid: QID,
        correctDelta: dC,
        incorrectDelta: dI,
        missing: { correctDelta: !hasDC, incorrectDelta: !hasDI }
      });

      const local = readLocalTotalsForQid(QID);
      const lc = local.c; // ★ 欠損は null（0埋め禁止）
      const li = local.w; // ★ 欠損は null（0埋め禁止）

      const ls = readLocalStreak3ForQid(QID);   // ★ 欠損は null（0埋め禁止）
      const ll = readLocalStreakLenForQid(QID); // ★ 欠損は null（0埋め禁止）

      // ★ 追加ログ: localStorage から「欠損か/数値か」を確実に確認できる
      console.log("[SYNC-A][UI] local snapshot (no-fallback)", {
        qid: QID,
        localTotals: { correct: lc, wrong: li },
        localStreak: { streak3: ls, streakLen: ll },
        missing: {
          totals: (lc === null || li === null),
          streak: (ls === null || ll === null)
        }
      });

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

      // ============================================================
      // ★ 表示方針:
      //   - SYNC合計（serverC/serverI）が「未取得/欠損」の場合は 0 にせず "-" 表示
      //   - フォールバックで別ソースから推測しない（datasetが空なら欠損扱い）
      //   - streak3/streakLen は従来通り（欠損時は 0 表示のまま）※必要なら後で同様に拡張可能
      // ============================================================
      let sc = null, si = null, ss = null, sl = null;
      if (totalsEl) {
        // ★ 処理1: dataset の数値を “厳密” に読む（空/欠損/非数は null）
        function readDatasetNonNegIntOrNull(ds, keyName){
          try{
            if (!ds) return null;
            const raw = ds[keyName];
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

        // ★ 処理2: SYNC合計（c/w）は欠損なら null のまま（0にしない）
        sc = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverC");
        si = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverI");

        // ★ 処理3: streak 系も欠損なら null（0埋め禁止）
        ss = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverS3");
        sl = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverSL");

        // ★ 処理4: 表示を反映（欠損は "-"）
        const serverTextEl = totalsEl.querySelector(".sync-server-text");
        if (serverTextEl) {
          const cText = (sc === null) ? "-" : String(sc);
          const iText = (si === null) ? "-" : String(si);
          serverTextEl.textContent = "SYNC " + cText + " / " + iText;

          // ★ 処理5: コンソールで「欠損なのか/数値なのか」を確実に確認できるログ
          console.log("[SYNC-A][UI] totals server display updated", {
            qid: QID,
            serverC: sc,
            serverI: si,
            missing: (sc === null || si === null)
          });
        }
      }

      // ★ 処理: progress は推測で埋めない
      //   - sl/ll が number の時だけ計算し、それ以外は null（UI は "-" で表示する）
      const serverProgress = (typeof sl === "number" && Number.isFinite(sl)) ? (sl % 3) : null;
      const localProgress  = (typeof ll === "number" && Number.isFinite(ll)) ? (ll % 3) : null;

      // ★ 追加ログ: progress の算出が「計算できたか/欠損か」を確認
      console.log("[SYNC-A][UI] progress computed (no-fallback)", {
        qid: QID,
        serverProgress: serverProgress,
        localProgress: localProgress,
        missing: {
          server: (serverProgress === null),
          local: (localProgress === null)
        }
      });

      // ★ 不正解ストリーク（SYNC 側）の最新値を __cscs_sync_state から取得（フォールバック禁止）
      let ssWrong = null;
      let slWrong = null;
      try{
        const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
          ? window.__cscs_sync_state
          : null;

        // ★ 処理1: state未取得なら null のまま（0埋め禁止）
        if (!state) {
          console.log("[SYNC-A][NO-FALLBACK] __cscs_sync_state missing -> wrong streak server = null", {
            qid: QID
          });
        } else {
          // ★ 処理2: streak3Wrong[qid] を厳密に検証して採用（欠損/型不正は null）
          if (state.streak3Wrong && typeof state.streak3Wrong === "object" && Object.prototype.hasOwnProperty.call(state.streak3Wrong, QID)) {
            const v = state.streak3Wrong[QID];
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
              ssWrong = v;
              console.log("[SYNC-A][NO-FALLBACK] wrong streak3 server ok", { qid: QID, value: ssWrong });
            } else {
              console.error("[SYNC-A][NO-FALLBACK] wrong streak3 server invalid -> null", { qid: QID, value: v, type: typeof v });
            }
          } else {
            console.log("[SYNC-A][NO-FALLBACK] wrong streak3 server missing entry -> null", { qid: QID });
          }

          // ★ 処理3: streakWrongLen[qid] を厳密に検証して採用（欠損/型不正は null）
          if (state.streakWrongLen && typeof state.streakWrongLen === "object" && Object.prototype.hasOwnProperty.call(state.streakWrongLen, QID)) {
            const v2 = state.streakWrongLen[QID];
            if (typeof v2 === "number" && Number.isFinite(v2) && v2 >= 0) {
              slWrong = v2;
              console.log("[SYNC-A][NO-FALLBACK] wrong streakLen server ok", { qid: QID, value: slWrong });
            } else {
              console.error("[SYNC-A][NO-FALLBACK] wrong streakLen server invalid -> null", { qid: QID, value: v2, type: typeof v2 });
            }
          } else {
            console.log("[SYNC-A][NO-FALLBACK] wrong streakLen server missing entry -> null", { qid: QID });
          }
        }
      }catch(e){
        ssWrong = null;
        slWrong = null;
        console.error("[SYNC-A][NO-FALLBACK] wrong streak server read exception -> nulls", {
          qid: QID,
          error: String(e && e.message || e)
        });
      }

      // ★ 処理4: progress は “計算できる時だけ” 計算（nullなら "-" 表示へ）
      const serverWrongProgress = (typeof slWrong === "number" && Number.isFinite(slWrong)) ? (slWrong % 3) : null;
      const localWrongProgress  = (typeof llWrong === "number" && Number.isFinite(llWrong)) ? (llWrong % 3) : null;

      console.log("[SYNC-A][NO-FALLBACK] wrong progress computed", {
        qid: QID,
        serverWrongProgress: serverWrongProgress,
        localWrongProgress: localWrongProgress,
        missing: {
          server: (serverWrongProgress === null),
          local: (localWrongProgress === null)
        }
      });

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

      // ★ フォールバック完全排除：SYNC state が無ければ null（欠損扱い）で保持する
      //   - { unique_count: 0 } のような “勝手な0埋めオブジェクト生成” を禁止する
      let streak3Today = null;
      try{
        const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
          ? window.__cscs_sync_state
          : null;

        if (state && state.streak3Today && typeof state.streak3Today === "object") {
          streak3Today = state.streak3Today;
          console.log("[SYNC-A][NO-FALLBACK][STATE] streak3Today ok (object)", {
            hasDay: Object.prototype.hasOwnProperty.call(streak3Today, "day"),
            hasUniqueCount: Object.prototype.hasOwnProperty.call(streak3Today, "unique_count"),
            hasQids: Object.prototype.hasOwnProperty.call(streak3Today, "qids")
          });
        } else {
          streak3Today = null;
          console.log("[SYNC-A][NO-FALLBACK][STATE] streak3Today missing -> null", {
            hasState: !!state
          });
        }
      }catch(e){
        streak3Today = null;
        console.error("[SYNC-A][NO-FALLBACK][STATE] streak3Today read exception -> null", {
          error: String(e && e.message || e)
        });
      }

      // ★ UI表示用：SYNC側は “取れた時だけ” 値を採用（取れなければ空→-）
      const streak3TodayDayForUi =
        (streak3Today && Object.prototype.hasOwnProperty.call(streak3Today, "day"))
          ? streak3Today.day
          : "";

      const streak3TodayCountForUi =
        (streak3Today && typeof streak3Today.unique_count === "number" && Number.isFinite(streak3Today.unique_count))
          ? streak3Today.unique_count
          : "";

      let localStreakDay = "";
      let localStreakCount = null;
      try{
        // ★ 処理1: day は “無いなら無い” を正として空文字（UI側で "-" / -に落とす）
        localStreakDay = localStorage.getItem("cscs_streak3_today_day") || "";

        // ★ 処理2: unique_count は欠損なら null（0埋め禁止）
        const k = "cscs_streak3_today_unique_count";
        const rawLocalCnt = localStorage.getItem(k);

        if (rawLocalCnt === null || rawLocalCnt === undefined) {
          localStreakCount = null;
          console.log("[SYNC-A][NO-FALLBACK][LS] streak3Today unique_count missing -> null", {
            key: k
          });
        } else {
          const s = String(rawLocalCnt).trim();
          if (s === "") {
            localStreakCount = null;
            console.log("[SYNC-A][NO-FALLBACK][LS] streak3Today unique_count empty -> null", {
              key: k,
              raw: rawLocalCnt
            });
          } else if (!/^\d+$/.test(s)) {
            localStreakCount = null;
            console.error("[SYNC-A][NO-FALLBACK][LS] streak3Today unique_count invalid -> null", {
              key: k,
              raw: rawLocalCnt
            });
          } else {
            const n = parseInt(s, 10);
            localStreakCount = (Number.isFinite(n) && n >= 0) ? n : null;
            console.log("[SYNC-A][NO-FALLBACK][LS] streak3Today unique_count ok", {
              key: k,
              value: localStreakCount
            });
          }
        }
      }catch(e){
        localStreakCount = null;
        console.error("[SYNC-A][NO-FALLBACK][LS] streak3Today unique_count exception -> null", {
          error: String(e && e.message || e)
        });
      }

      // ★ フォールバック完全排除：SYNC state が無ければ null（欠損扱い）で保持する
      let streak3WrongToday = null;
      try{
        const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
          ? window.__cscs_sync_state
          : null;

        if (state && state.streak3WrongToday && typeof state.streak3WrongToday === "object") {
          streak3WrongToday = state.streak3WrongToday;
          console.log("[SYNC-A][NO-FALLBACK][STATE] streak3WrongToday ok (object)", {
            hasDay: Object.prototype.hasOwnProperty.call(streak3WrongToday, "day"),
            hasUniqueCount: Object.prototype.hasOwnProperty.call(streak3WrongToday, "unique_count"),
            hasQids: Object.prototype.hasOwnProperty.call(streak3WrongToday, "qids")
          });
        } else {
          streak3WrongToday = null;
          console.log("[SYNC-A][NO-FALLBACK][STATE] streak3WrongToday missing -> null", {
            hasState: !!state
          });
        }
      }catch(e){
        streak3WrongToday = null;
        console.error("[SYNC-A][NO-FALLBACK][STATE] streak3WrongToday read exception -> null", {
          error: String(e && e.message || e)
        });
      }

      // ★ UI表示用：SYNC側は “取れた時だけ” 値を採用（取れなければ空→-）
      const streak3WrongTodayDayForUi =
        (streak3WrongToday && Object.prototype.hasOwnProperty.call(streak3WrongToday, "day"))
          ? streak3WrongToday.day
          : "";

      const streak3WrongTodayCountForUi =
        (streak3WrongToday && typeof streak3WrongToday.unique_count === "number" && Number.isFinite(streak3WrongToday.unique_count))
          ? streak3WrongToday.unique_count
          : "";

      let localWrongStreakDay = "";
      let localWrongStreakCount = null;
      try{
        // ★ 処理1: day は “無いなら無い” を正として空文字
        localWrongStreakDay = localStorage.getItem("cscs_streak3_wrong_today_day") || "";

        // ★ 処理2: unique_count は欠損なら null（0埋め禁止）
        const k = "cscs_streak3_wrong_today_unique_count";
        const rawLocalWrongCnt = localStorage.getItem(k);

        if (rawLocalWrongCnt === null || rawLocalWrongCnt === undefined) {
          localWrongStreakCount = null;
          console.log("[SYNC-A][NO-FALLBACK][LS] streak3WrongToday unique_count missing -> null", {
            key: k
          });
        } else {
          const s = String(rawLocalWrongCnt).trim();
          if (s === "") {
            localWrongStreakCount = null;
            console.log("[SYNC-A][NO-FALLBACK][LS] streak3WrongToday unique_count empty -> null", {
              key: k,
              raw: rawLocalWrongCnt
            });
          } else if (!/^\d+$/.test(s)) {
            localWrongStreakCount = null;
            console.error("[SYNC-A][NO-FALLBACK][LS] streak3WrongToday unique_count invalid -> null", {
              key: k,
              raw: rawLocalWrongCnt
            });
          } else {
            const n = parseInt(s, 10);
            localWrongStreakCount = (Number.isFinite(n) && n >= 0) ? n : null;
            console.log("[SYNC-A][NO-FALLBACK][LS] streak3WrongToday unique_count ok", {
              key: k,
              value: localWrongStreakCount
            });
          }
        }
      }catch(e){
        localWrongStreakCount = null;
        console.error("[SYNC-A][NO-FALLBACK][LS] streak3WrongToday unique_count exception -> null", {
          error: String(e && e.message || e)
        });
      }

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
          // ★ 変更: Streak3TodayUnique の day 項目は UI から削除（非表示）
          s3tDayEl.textContent = "";
          s3tDayEl.style.display = "none";
        }
        if (s3tSyncEl) {
          // ★ 処理: SYNC側 unique_count も「取れた時だけ」採用（無ければ欠損→-）
          s3tSyncEl.textContent = toDisplayText(streak3TodayCountForUi, "-");
        }
        if (s3tLocalEl) {
          s3tLocalEl.textContent = toDisplayText(
            Number.isFinite(localStreakCount) ? localStreakCount : "",
            "-"
          );
        }

        // ★ 今日の3連続不正解ユニーク数をモニタUIに反映する
        //   - unique: sync 側 unique_count と localStorage 側の値を並列表記
        const s3wtDayEl   = box.querySelector(".sync-streak3wrongtoday-day");
        const s3wtSyncEl  = box.querySelector(".sync-streak3wrongtoday-sync");
        const s3wtLocalEl = box.querySelector(".sync-streak3wrongtoday-local");
        if (s3wtDayEl) {
          // ★ 変更: Streak3WrongTodayUq の day 項目は UI から削除（非表示）
          s3wtDayEl.textContent = "";
          s3wtDayEl.style.display = "none";
        }
        if (s3wtSyncEl) {
          // ★ 処理: SYNC側 unique_count も「取れた時だけ」採用（無ければ欠損→-）
          s3wtSyncEl.textContent = toDisplayText(streak3WrongTodayCountForUi, "-");
        }
        if (s3wtLocalEl) {
          s3wtLocalEl.textContent = toDisplayText(
            Number.isFinite(localWrongStreakCount) ? localWrongStreakCount : "",
            "-"
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

        // ★ 変更: Streak3TodayUnique / Streak3WrongTodayUq の day 比較欄は UI から削除（非表示）
        if (s3tDaySyncEl)    { s3tDaySyncEl.textContent = "";  s3tDaySyncEl.style.display = "none"; }
        if (s3tDayLocalEl)   { s3tDayLocalEl.textContent = ""; s3tDayLocalEl.style.display = "none"; }
        if (s3tDayIsTodayEl) { s3tDayIsTodayEl.textContent = ""; s3tDayIsTodayEl.style.display = "none"; }

        if (s3wtDaySyncEl)    { s3wtDaySyncEl.textContent = "";  s3wtDaySyncEl.style.display = "none"; }
        if (s3wtDayLocalEl)   { s3wtDayLocalEl.textContent = ""; s3wtDayLocalEl.style.display = "none"; }
        if (s3wtDayIsTodayEl) { s3wtDayIsTodayEl.textContent = ""; s3wtDayIsTodayEl.style.display = "none"; }

        if (onceDaySyncEl)    onceDaySyncEl.textContent  = toDisplayText(syncOnceDayRaw, "-");
        if (onceDayLocalEl)   onceDayLocalEl.textContent = toDisplayText(localOnceDayRaw, "-");
        if (onceDayIsTodayEl) onceDayIsTodayEl.textContent = isTodayYmdString(syncOnceDayRaw);

        // ★ 最終日情報（LastSeen / LastCorrect / LastWrong）を UI に反映（詳細テーブル）
        if (lastSeenSyncEl) {
          lastSeenSyncEl.textContent = toDisplayText(lastSeenSync, "-");
        }
        if (lastCorrectSyncEl) {
          lastCorrectSyncEl.textContent = toDisplayText(lastCorrectSync, "-");
        }
        if (lastWrongSyncEl) {
          lastWrongSyncEl.textContent = toDisplayText(lastWrongSync, "-");
        }
        if (lastSeenLocalEl) {
          lastSeenLocalEl.textContent = toDisplayText(lastSeenLocal, "-");
        }
        if (lastCorrectLocalEl) {
          lastCorrectLocalEl.textContent = toDisplayText(lastCorrectLocal, "-");
        }
        if (lastWrongLocalEl) {
          lastWrongLocalEl.textContent = toDisplayText(lastWrongLocal, "-");
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
          lastdaySummarySyncEl.textContent = "SYNC " + toDisplayText(latestSyncVal, "-");
        }
        if (lastdaySummaryLocalEl) {
          // ★ summary の local 値（8桁日付 or データなし）
          //   - 表示は「local 20251210」のようにラベル込みにする
          lastdaySummaryLocalEl.textContent = "local " + toDisplayText(latestLocalVal, "-");
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

        if (qEl)   qEl.textContent  = QID ? QID : "-";
        if (lEl) {
          // ★ 処理1: null は "-" 表示（0埋め禁止）
          const lcText = (lc === null) ? "-" : String(lc);
          const liText = (li === null) ? "-" : String(li);
          lEl.textContent  = "local  " + lcText + " / " + liText;

          // ★ 処理2: 反映成功ログ（欠損有無も出す）
          console.log("[SYNC-A][UI] local totals display updated", {
            qid: QID,
            correct: lc,
            wrong: li,
            missing: (lc === null || li === null)
          });
        }

        if (qdEl)  qdEl.textContent = "+Δ    " + dC + " / " + dI;

        if (s3El) {
          // ★ 処理3: null は "-" 表示（0埋め禁止）
          s3El.textContent = (ls === null) ? "-" : String(ls);

          // ★ 処理4: 反映成功ログ
          console.log("[SYNC-A][UI] local streak3 display updated", {
            qid: QID,
            streak3: ls,
            missing: (ls === null)
          });
        }

        // ★ 処理: server streak3 は欠損なら "-"（0埋め禁止）
        if (s3sEl) s3sEl.textContent = (ss === null) ? "-" : String(ss);

        // ★ 追加: streak max カード（A）に localStorage の値を反映
        //   - len: 現在の連続正解数（cscs_q_correct_streak_len:{qid}）
        //   - max: 最高連続正解数（cscs_q_correct_streak_max:{qid}）
        //   - day: 最高を更新した日（cscs_q_correct_streak_max_day:{qid}）
        if (streakMaxLenEl) streakMaxLenEl.textContent = toDisplayText(lMax !== null && lMax !== undefined ? ll : "", "-");
        if (streakMaxValEl) streakMaxValEl.textContent = toDisplayText(lMax !== null && lMax !== undefined ? lMax : "", "-");
        if (streakMaxDayEl) streakMaxDayEl.textContent = toDisplayText(lMaxDay, "-");

        // ★ 追加: 不正解 streak max カード（A）に localStorage の値を反映
        //   - len: 現在の連続不正解数（cscs_q_wrong_streak_len:{qid}）
        //   - max: 最高連続不正解数（cscs_q_wrong_streak_max:{qid}）
        //   - day: 最高を更新した日（cscs_q_wrong_streak_max_day:{qid}）
        if (wrongStreakMaxLenEl) wrongStreakMaxLenEl.textContent = toDisplayText(lWrongMax !== null && lWrongMax !== undefined ? llWrong : "", "-");
        if (wrongStreakMaxValEl) wrongStreakMaxValEl.textContent = toDisplayText(lWrongMax !== null && lWrongMax !== undefined ? lWrongMax : "", "-");
        if (wrongStreakMaxDayEl) wrongStreakMaxDayEl.textContent = toDisplayText(lWrongMaxDay, "-");

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

        if (slEl) {
          // ★ 処理1: null は "-" 表示（0埋め禁止）
          slEl.textContent = (ll === null) ? "-" : String(ll);

          // ★ 処理2: 反映成功ログ
          console.log("[SYNC-A][UI] local streakLen display updated", {
            qid: QID,
            streakLen: ll,
            missing: (ll === null)
          });
        }

        // ★ 処理: server streakLen は欠損なら "-"（0埋め禁止）
        if (slsEl)       slsEl.textContent       = (sl === null) ? "-" : String(sl);

        if (slsProgEl) {
          // ★ 処理3: null は "-" 表示（推測で 0 にしない）
          slsProgEl.textContent = (serverProgress === null) ? "-" : String(serverProgress);

          // ★ 処理4: 反映成功ログ
          console.log("[SYNC-A][UI] server progress display updated", {
            qid: QID,
            serverProgress: serverProgress,
            missing: (serverProgress === null)
          });
        }

        if (sllProgEl) {
          // ★ 処理5: null は "-" 表示（推測で 0 にしない）
          sllProgEl.textContent = (localProgress === null) ? "-" : String(localProgress);

          // ★ 処理6: 反映成功ログ
          console.log("[SYNC-A][UI] local progress display updated", {
            qid: QID,
            localProgress: localProgress,
            missing: (localProgress === null)
          });
        }

        // ★ 不正解ストリークの値を UI に反映（欠損は "-"、0 は本当に 0 の時だけ）
        if (s3wEl)  s3wEl.textContent  = (lsWrong === null) ? "-" : String(lsWrong);
        if (s3wsEl) s3wsEl.textContent = (ssWrong === null) ? "-" : String(ssWrong);
        if (slwEl)  slwEl.textContent  = (llWrong === null) ? "-" : String(llWrong);
        if (slwsEl) slwsEl.textContent = (slWrong === null) ? "-" : String(slWrong);

        // ★ 処理: progress は “計算できる時だけ” 数字、できなければ "-"（0埋め禁止）
        if (slwsProgEl) slwsProgEl.textContent = (serverWrongProgress === null) ? "-" : String(serverWrongProgress);
        if (sllwProgEl) sllwProgEl.textContent  = (localWrongProgress === null) ? "-" : String(localWrongProgress);

        // ★ 追加: キュー（+Δ）に “Totals(c/w) 以外” の溜まり具合を表示（B）
        //   - streakLenDelta / streakWrongLenDelta は「増分」ではなく「最新値」なので、そのまま表示する
        //   - last*DayDelta も「最新値」なので、そのまま表示する
        // ★ 処理: 「|| 0」禁止。欠損は null のまま保持して “取れていない” を明確化する
        const hasQdS3  = Object.prototype.hasOwnProperty.call(queue.streak3Delta, QID);
        const qdS3     = hasQdS3 ? queue.streak3Delta[QID] : null;

        const qdSL  = Object.prototype.hasOwnProperty.call(queue.streakLenDelta, QID) ? queue.streakLenDelta[QID] : null;

        const hasQdS3W = Object.prototype.hasOwnProperty.call(queue.streak3WrongDelta, QID);
        const qdS3W    = hasQdS3W ? queue.streak3WrongDelta[QID] : null;

        const qdSLW = Object.prototype.hasOwnProperty.call(queue.streakWrongLenDelta, QID) ? queue.streakWrongLenDelta[QID] : null;

        // ★ 処理: 欠損/数値をコンソールで確実に判別できるログ
        console.log("[SYNC-A][NO-FALLBACK][QUEUE] detail snapshot", {
          qid: QID,
          qdS3: qdS3,
          qdS3W: qdS3W,
          qdSL: qdSL,
          qdSLW: qdSLW,
          missing: { qdS3: !hasQdS3, qdS3W: !hasQdS3W }
        });

        const qdSeen = Object.prototype.hasOwnProperty.call(queue.lastSeenDayDelta, QID) ? queue.lastSeenDayDelta[QID] : "";
        const qdCor  = Object.prototype.hasOwnProperty.call(queue.lastCorrectDayDelta, QID) ? queue.lastCorrectDayDelta[QID] : "";
        const qdWrg  = Object.prototype.hasOwnProperty.call(queue.lastWrongDayDelta, QID) ? queue.lastWrongDayDelta[QID] : "";

        // ★ 処理1: 欠損（null/undefined）を "0" で埋めず、「-」として可視化する
        if (qdCwEl)   qdCwEl.textContent   = toDisplayText(dC, "-") + " / " + toDisplayText(dI, "-");
        // ★ 処理2: 欠損（null/undefined）を "0" で埋めず、「-」として可視化する
        if (qdS3El)   qdS3El.textContent   = toDisplayText(qdS3, "-");
        // ★ 処理3: streakLenDelta は「最新値」なので、欠損時のみ「（なし）」を表示する（推測で数値化しない）
        if (qdSLel)   qdSLel.textContent   = toDisplayText(qdSL !== null && qdSL !== undefined ? qdSL : "", "（なし）");
        // ★ 処理4: 欠損（null/undefined）を "0" で埋めず、「-」として可視化する
        if (qdS3wEl)  qdS3wEl.textContent  = toDisplayText(qdS3W, "-");
        // ★ 処理5: streakWrongLenDelta は「最新値」なので、欠損時のみ「（なし）」を表示する（推測で数値化しない）
        if (qdSLwEl)  qdSLwEl.textContent  = toDisplayText(qdSLW !== null && qdSLW !== undefined ? qdSLW : "", "（なし）");

        // ★ 処理6: 反映が確実に成功したかをコンソールで確認できるログ（欠損/表示文字列も併記）
        console.log("[SYNC-A][OK][UI] queue detail text updated (no-fallback)", {
          qid: QID,
          raw: {
            dC: dC,
            dI: dI,
            qdS3: qdS3,
            qdS3W: qdS3W,
            qdSL: qdSL,
            qdSLW: qdSLW
          },
          rendered: {
            cw: (qdCwEl ? qdCwEl.textContent : null),
            s3: (qdS3El ? qdS3El.textContent : null),
            sl: (qdSLel ? qdSLel.textContent : null),
            s3w: (qdS3wEl ? qdS3wEl.textContent : null),
            slw: (qdSLwEl ? qdSLwEl.textContent : null)
          }
        });

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

        const onceElSync  = box.querySelector(".sync-onceperday.sync");
        const onceElLocal = box.querySelector(".sync-onceperday.local");

        // ============================================================
        // ★ SYNC由来カード：既存ロジック（参照元 = window.__cscs_sync_state）を維持して描画
        // ------------------------------------------------------------
        // - 表示は従来の4行構成
        // - フォールバックで別ソースから埋め合わせない（取れなければ取れない表示）
        // ============================================================
        if (onceElSync) {
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

          // ★ 処理: 参照元を固定（SYNC snapshot のみ）
          const state = (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object")
            ? window.__cscs_sync_state
            : null;

          const once = (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object")
            ? state.oncePerDayToday
            : null;

          const odoaMode = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
          const odoaText = (odoaMode === "on") ? "ON" : (odoaMode === "off") ? "OFF" : "unknown";

          const todayYmd = getTodayYmdNum();

          let isTodayOnce = false;
          let onceDayIso = "";
          let lastRecordedDayIso = "";
          let measuredResult = null; // "correct" | "wrong" | null

          try{
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

          let line1 = "";
          let line2 = "";
          let line3 = "";
          let line4 = "";

          if (!isTodayOnce) {
            line1 = "oncePerDayToday: 未開始";
            line2 = "lastRecordedDay: " + (lastRecordedDayIso ? lastRecordedDayIso : "-");
            line3 = "count対象: 判定可能";
            line4 = "ODOA: " + odoaText + " (累計加算: Yes)";
          } else {
            line1 = "oncePerDayToday: 計測中";
            line2 = "Today: " + (onceDayIso ? onceDayIso : "-");

            if (measuredResult === "correct" || measuredResult === "wrong") {
              line3 = "count対象: No 計測済(" + measuredResult + ")";
            } else if (measuredResult === "unknown") {
              line3 = "count対象: No 計測済(unknown)";
            } else {
              line3 = "count対象: Yes 未計測";
            }

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

          onceElSync.innerHTML =
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

        // ============================================================
        // ★ local由来カード：参照元 = localStorage（SYNC snapshot を参照しない）
        // ------------------------------------------------------------
        // - oncePerDayToday: localStorage の day/results をそのまま読む
        // - ODOA/VERIFY: window のフラグだけを読む（localStorage等へフォールバックしない）
        // - 欠損は欠損として扱い、0埋め・推測はしない
        // ============================================================
        if (onceElLocal) {
          function ymdNumToIso(ymdNum){
            try{
              const s = String(ymdNum);
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

          // ★ 処理: localStorage から oncePerDayToday の day/results を取得する
          let localDayNum = null;
          let localResults = null;

          try{
            const rawDay = localStorage.getItem("cscs_once_per_day_today_day");
            if (rawDay !== null && rawDay !== undefined) {
              const s = String(rawDay).trim();
              if (/^\d{8}$/.test(s)) {
                localDayNum = parseInt(s, 10);
              }
            }
          }catch(_){
            localDayNum = null;
          }

          try{
            const rawRes = localStorage.getItem("cscs_once_per_day_today_results");
            if (rawRes !== null && rawRes !== undefined) {
              const s = String(rawRes).trim();
              if (s !== "") {
                const parsed = JSON.parse(s);
                if (parsed && typeof parsed === "object") {
                  localResults = parsed;
                }
              }
            }
          }catch(_){
            localResults = null;
          }

          const odoaMode = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
          const odoaText = (odoaMode === "on") ? "ON" : (odoaMode === "off") ? "OFF" : "unknown";

          const verifyModeOn =
            (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on");

          const todayYmd = getTodayYmdNum();

          let isTodayOnce = false;
          let onceDayIso = "";
          let lastRecordedDayIso = "";
          let measuredResult = null; // "correct" | "wrong" | "unknown" | null

          try{
            if (localDayNum !== null) {
              const iso = ymdNumToIso(localDayNum);
              if (iso) {
                lastRecordedDayIso = iso;
              }
            }

            if (todayYmd !== null && localDayNum !== null && localDayNum === todayYmd) {
              isTodayOnce = true;
              onceDayIso = ymdNumToIso(todayYmd);

              if (localResults && typeof localResults === "object") {
                const r = localResults[QID];
                if (r === "correct" || r === "wrong") {
                  measuredResult = r;
                } else if (Object.prototype.hasOwnProperty.call(localResults, QID)) {
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

          let line1 = "";
          let line2 = "";
          let line3 = "";
          let line4 = "";

          if (!isTodayOnce) {
            // ★ 処理: localの oncePerDayToday が今日でない（または欠損）場合は未開始扱いで表示する
            line1 = "oncePerDayToday: 未開始";
            line2 = "lastRecordedDay: " + (lastRecordedDayIso ? lastRecordedDayIso : "-");
            line3 = "count対象: 判定可能";
            line4 = "ODOA: " + odoaText + " (累計加算: Yes)";
          } else {
            line1 = "oncePerDayToday: 計測中";
            line2 = "Today: " + (onceDayIso ? onceDayIso : "-");

            // ★ 処理: VERIFY_MODE は常に count対象: NO として表示する
            if (verifyModeOn) {
              line3 = "count対象: NO 理由: VERIFY_MODE";
            } else {
              if (measuredResult === "correct" || measuredResult === "wrong") {
                line3 = "count対象: No 計測済(" + measuredResult + ")";
              } else if (measuredResult === "unknown") {
                line3 = "count対象: No 計測済(unknown)";
              } else {
                line3 = "count対象: Yes 未計測";
              }
            }

            // ★ 処理: ODOAの累計加算表示（local判定のcount対象と連動して Yes/No を出す）
            let addYesNo = "Yes";
            if (odoaMode === "off") {
              addYesNo = "Yes";
            } else if (odoaMode === "on") {
              const counted = (verifyModeOn || measuredResult === "correct" || measuredResult === "wrong" || measuredResult === "unknown");
              addYesNo = counted ? "No" : "Yes";
            } else {
              addYesNo = "unknown";
            }
            line4 = "ODOA: " + odoaText + " (累計加算: " + addYesNo + ")";
          }

          onceElLocal.innerHTML =
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
      // ★ 処理1: merge を叩き、レスポンスヘッダも必ず取得する（欠損は欠損として null）
      let _syncKey = "";
      try{
        _syncKey = localStorage.getItem("cscs_sync_key") || "";
      }catch(_){
        _syncKey = "";
      }

      if (!_syncKey) {
        throw new Error("SYNC_KEY_MISSING_LOCAL");
      }

      const res = await fetch("/api/sync/merge", {
        method:"POST",
        headers:{ "content-type":"application/json", "X-CSCS-Key": String(_syncKey) },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(String(res.status));

      // ★ 処理2: 指定ヘッダ群を “そのまま” 抜き出す（フォールバックで埋めない）
      function readHeaderStrict(headers, name){
        try{
          const v = headers ? headers.get(name) : null;
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          return s === "" ? null : s;
        }catch(_){
          return null;
        }
      }

      function readHeaderAny(headers, names){
        for (let i = 0; i < names.length; i++) {
          const v = readHeaderStrict(headers, names[i]);
          if (v !== null) return v;
        }
        return null;
      }

      const mergeHeaders = {
        // ★ 処理2-1: 明示指定ヘッダ
        "X-CSCS-User": readHeaderStrict(res.headers, "X-CSCS-User"),
        "Key": readHeaderAny(res.headers, ["X-CSCS-Key", "X-CSCS-API-Key", "X-CSCS-Token", "X-CSCS-User-Key"]),
        "OdoaMode": readHeaderAny(res.headers, ["X-CSCS-OdoaMode", "X-CSCS-ODOA-Mode", "X-ODOA-Mode"]),
        "KV(hit|miss)": readHeaderAny(res.headers, ["X-CSCS-KV", "X-CSCS-KV-Cache", "CF-KV-Cache", "X-KV-Cache", "X-KV"]),
        "Colo": readHeaderAny(res.headers, ["CF-Colo", "cf-colo"]),
        "CF-Ray": readHeaderAny(res.headers, ["CF-Ray", "cf-ray"])
      };

      // ★ 処理3: merge ヘッダを “確実に” 出す（ここで missing も見える化）
      console.log("[SYNC-A][HDR][MERGE] response headers snapshot", {
        endpoint: "/api/sync/merge",
        qid: QID || null,
        headers: mergeHeaders,
        missing: {
          "X-CSCS-User": (mergeHeaders["X-CSCS-User"] === null),
          "Key": (mergeHeaders["Key"] === null),
          "OdoaMode": (mergeHeaders["OdoaMode"] === null),
          "KV(hit|miss)": (mergeHeaders["KV(hit|miss)"] === null),
          "Colo": (mergeHeaders["Colo"] === null),
          "CF-Ray": (mergeHeaders["CF-Ray"] === null)
        }
      });

      // ★ 処理4: merge ヘッダを保持し、state と一致/不一致を比較できるようにする
      try{
        if (!window.__cscs_sync_last_headers || typeof window.__cscs_sync_last_headers !== "object") {
          window.__cscs_sync_last_headers = { state: null, merge: null };
        }
        window.__cscs_sync_last_headers.merge = mergeHeaders;
      }catch(_){}

      // ★ 処理5: state ヘッダが既にあるなら “一致/不一致” をここで判定して出す
      try{
        const last = (window.__cscs_sync_last_headers && typeof window.__cscs_sync_last_headers === "object")
          ? window.__cscs_sync_last_headers
          : null;

        const sh = last && last.state ? last.state : null;
        if (sh) {
          const keys = ["X-CSCS-User", "Key", "OdoaMode", "KV(hit|miss)", "Colo", "CF-Ray"];
          const diff = {};
          let anyDiff = false;

          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const sv = sh[k];
            const mv = mergeHeaders[k];
            const same = (sv === mv);
            if (!same) {
              anyDiff = true;
              diff[k] = { state: sv, merge: mv };
            }
          }

          console.log("[SYNC-A][CMP][MERGE↔STATE] headers compare", {
            qid: QID || null,
            match: !anyDiff,
            diff: diff
          });
        } else {
          console.log("[SYNC-A][CMP][MERGE↔STATE] headers compare skipped (state headers missing)", {
            qid: QID || null
          });
        }
      }catch(eCmp){
        console.error("[SYNC-A][CMP][MERGE↔STATE] headers compare error", {
          qid: QID || null,
          error: String(eCmp && eCmp.message || eCmp)
        });
      }

      queue.correctDelta        = {};
      queue.incorrectDelta      = {};
      queue.streak3Delta        = {};
      queue.streakLenDelta      = {};
      queue.streak3WrongDelta   = {};
      queue.streakWrongLenDelta = {};
      queue.lastSeenDayDelta    = {};
      queue.lastCorrectDayDelta = {};
      queue.lastWrongDayDelta   = {};

      // ★ 処理6: JSON本文を取得し、注目項目（odoa_mode / updatedAt / correct 空か等）をログ
      const latest = await res.json();

      let correctInfo = null;
      try{
        const hasCorrectMap = !!(latest && latest.correct && typeof latest.correct === "object");
        const keysLen = hasCorrectMap ? Object.keys(latest.correct).length : null;

        let qidHasEntry = null;
        let qidValue = null;
        if (hasCorrectMap && QID) {
          qidHasEntry = Object.prototype.hasOwnProperty.call(latest.correct, QID);
          if (qidHasEntry) qidValue = latest.correct[QID];
        }

        correctInfo = {
          hasCorrectMap: hasCorrectMap,
          correctKeysLen: keysLen,
          correctIsEmpty: (hasCorrectMap ? (keysLen === 0) : null),
          qid: QID || null,
          qidHasEntry: qidHasEntry,
          qidValue: qidValue
        };
      }catch(eCorrect){
        correctInfo = {
          error: String(eCorrect && eCorrect.message || eCorrect)
        };
      }

      console.log("[SYNC-A][BODY][MERGE] json snapshot (selected fields)", {
        endpoint: "/api/sync/merge",
        qid: QID || null,
        odoa_mode: (latest && Object.prototype.hasOwnProperty.call(latest, "odoa_mode")) ? latest.odoa_mode : null,
        updatedAt: (latest && Object.prototype.hasOwnProperty.call(latest, "updatedAt")) ? latest.updatedAt : null,
        correct: correctInfo
      });

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
      // ★ 処理: 「|| 0」禁止。欠損は “無い” として扱い、明示的に 1 をセットする
      if (Object.prototype.hasOwnProperty.call(queue.correctDelta, QID)) {
        queue.correctDelta[QID] = queue.correctDelta[QID] + 1;
      } else {
        queue.correctDelta[QID] = 1;
      }

      // ★ 処理: キュー加算が成功したことを確実に確認できるログ
      console.log("[SYNC-A][OK][QUEUE] correctDelta incremented", {
        qid: QID,
        correctDelta: queue.correctDelta[QID]
      });

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
      // ★ 処理: 「|| 0」禁止。欠損は “無い” として扱い、明示的に 1 をセットする
      if (Object.prototype.hasOwnProperty.call(queue.incorrectDelta, QID)) {
        queue.incorrectDelta[QID] = queue.incorrectDelta[QID] + 1;
      } else {
        queue.incorrectDelta[QID] = 1;
      }

      // ★ 処理: キュー加算が成功したことを確実に確認できるログ
      console.log("[SYNC-A][OK][QUEUE] incorrectDelta incremented", {
        qid: QID,
        incorrectDelta: queue.incorrectDelta[QID]
      });

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
      // ★ 処理: 「|| 0」禁止。欠損は “無い” として扱い、明示的に 1 をセットする
      if (Object.prototype.hasOwnProperty.call(queue.streak3Delta, QID)) {
        queue.streak3Delta[QID] = queue.streak3Delta[QID] + 1;
      } else {
        queue.streak3Delta[QID] = 1;
      }

      // ★ 処理: キュー加算が成功したことを確実に確認できるログ
      console.log("[SYNC-A][OK][QUEUE] streak3Delta incremented", {
        qid: QID,
        streak3Delta: queue.streak3Delta[QID]
      });
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
      // ★ 処理: 「|| 0」禁止。欠損は “無い” として扱い、明示的に 1 をセットする
      if (Object.prototype.hasOwnProperty.call(queue.streak3WrongDelta, QID)) {
        queue.streak3WrongDelta[QID] = queue.streak3WrongDelta[QID] + 1;
      } else {
        queue.streak3WrongDelta[QID] = 1;
      }

      // ★ 処理: キュー加算が成功したことを確実に確認できるログ
      console.log("[SYNC-A][OK][QUEUE] streak3WrongDelta incremented", {
        qid: QID,
        streak3WrongDelta: queue.streak3WrongDelta[QID]
      });
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
      // ★ 処理: NO-PULLモードがONなら、sync/state 取得を行わず例外で停止する
      if (window.__cscs_sync_no_pull === true) {
        throw new Error("NO_PULL_MODE");
      }

      // ★ 追加した処理0: localStorage の SYNC key を先に読む（欠損は欠損として null）
      // - key が無い状態で /api/sync/state を叩くと 400 になりログが汚れるため、ここで止める
      // - フォールバックで埋めない（欠損は欠損として上流に伝える）
      let syncKey = null;
      try{
        const v = localStorage.getItem("cscs_sync_key");
        if (v !== null && v !== undefined) {
          const s = String(v).trim();
          syncKey = (s === "") ? null : s;
        }
      }catch(_){
        syncKey = null;
      }

      // ★ 追加した処理0-1: key 欠損なら state は叩かない（推測せず例外で停止）
      if (syncKey === null) {
        throw new Error("SYNC_STATE_MISSING_KEY");
      }

      // ★ 処理1: /api/sync/state を「Key付き」で叩き、レスポンスヘッダも必ず取得する（欠損は欠損として null）
      const r = await fetch("/api/sync/state", {
        method: "GET",
        credentials: "include",
        headers: {
          "X-CSCS-Key": syncKey
        }
      });
      if(!r.ok) throw new Error(r.statusText);

      // ★ 処理2: 指定ヘッダ群を “そのまま” 抜き出す（フォールバックで埋めない）
      function readHeaderStrict(headers, name){
        try{
          const v = headers ? headers.get(name) : null;
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          return s === "" ? null : s;
        }catch(_){
          return null;
        }
      }

      function readHeaderAny(headers, names){
        for (let i = 0; i < names.length; i++) {
          const v = readHeaderStrict(headers, names[i]);
          if (v !== null) return v;
        }
        return null;
      }

      const stateHeaders = {
        // ★ 処理2-1: 明示指定ヘッダ
        "X-CSCS-User": readHeaderStrict(r.headers, "X-CSCS-User"),
        "Key": readHeaderAny(r.headers, ["X-CSCS-Key", "X-CSCS-API-Key", "X-CSCS-Token", "X-CSCS-User-Key"]),
        "OdoaMode": readHeaderAny(r.headers, ["X-CSCS-OdoaMode", "X-CSCS-ODOA-Mode", "X-ODOA-Mode"]),
        "KV(hit|miss)": readHeaderAny(r.headers, ["X-CSCS-KV", "X-CSCS-KV-Cache", "CF-KV-Cache", "X-KV-Cache", "X-KV"]),
        "Colo": readHeaderAny(r.headers, ["CF-Colo", "cf-colo"]),
        "CF-Ray": readHeaderAny(r.headers, ["CF-Ray", "cf-ray"])
      };

      // ★ 処理3: state ヘッダを “確実に” 出す（ここで missing も見える化）
      console.log("[SYNC-A][HDR][STATE] response headers snapshot", {
        endpoint: "/api/sync/state",
        qid: QID || null,
        headers: stateHeaders,
        missing: {
          "X-CSCS-User": (stateHeaders["X-CSCS-User"] === null),
          "Key": (stateHeaders["Key"] === null),
          "OdoaMode": (stateHeaders["OdoaMode"] === null),
          "KV(hit|miss)": (stateHeaders["KV(hit|miss)"] === null),
          "Colo": (stateHeaders["Colo"] === null),
          "CF-Ray": (stateHeaders["CF-Ray"] === null)
        }
      });

      // ★ 処理4: JSON本文を取得（本文側の要点もログに出す）
      const json = await r.json();

      // ★ 処理5: 本文JSONの注目項目（od oa_mode / updatedAt / correct 空か等）をまとめてログ
      let correctInfo = null;
      try{
        const hasCorrectMap = !!(json && json.correct && typeof json.correct === "object");
        const keysLen = hasCorrectMap ? Object.keys(json.correct).length : null;

        let qidHasEntry = null;
        let qidValue = null;
        if (hasCorrectMap && QID) {
          qidHasEntry = Object.prototype.hasOwnProperty.call(json.correct, QID);
          if (qidHasEntry) qidValue = json.correct[QID];
        }

        correctInfo = {
          hasCorrectMap: hasCorrectMap,
          correctKeysLen: keysLen,
          correctIsEmpty: (hasCorrectMap ? (keysLen === 0) : null),
          qid: QID || null,
          qidHasEntry: qidHasEntry,
          qidValue: qidValue
        };
      }catch(eCorrect){
        correctInfo = {
          error: String(eCorrect && eCorrect.message || eCorrect)
        };
      }

      console.log("[SYNC-A][BODY][STATE] json snapshot (selected fields)", {
        endpoint: "/api/sync/state",
        qid: QID || null,
        odoa_mode: (json && Object.prototype.hasOwnProperty.call(json, "odoa_mode")) ? json.odoa_mode : null,
        updatedAt: (json && Object.prototype.hasOwnProperty.call(json, "updatedAt")) ? json.updatedAt : null,
        correct: correctInfo
      });

      // ★ 処理6: 取得した state ヘッダを保持し、merge 側ヘッダと一致/不一致を比較できるようにする
      try{
        if (!window.__cscs_sync_last_headers || typeof window.__cscs_sync_last_headers !== "object") {
          window.__cscs_sync_last_headers = { state: null, merge: null };
        }
        window.__cscs_sync_last_headers.state = stateHeaders;
      }catch(_){}

      // ★ 処理7: もし merge ヘッダが既にあるなら “一致/不一致” をここでも判定して出す
      try{
        const last = (window.__cscs_sync_last_headers && typeof window.__cscs_sync_last_headers === "object")
          ? window.__cscs_sync_last_headers
          : null;

        const mh = last && last.merge ? last.merge : null;
        if (mh) {
          const keys = ["X-CSCS-User", "Key", "OdoaMode", "KV(hit|miss)", "Colo", "CF-Ray"];
          const diff = {};
          let anyDiff = false;

          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const sv = stateHeaders[k];
            const mv = mh[k];
            const same = (sv === mv);
            if (!same) {
              anyDiff = true;
              diff[k] = { state: sv, merge: mv };
            }
          }

          console.log("[SYNC-A][CMP][STATE↔MERGE] headers compare", {
            qid: QID || null,
            match: !anyDiff,
            diff: diff
          });
        } else {
          console.log("[SYNC-A][CMP][STATE↔MERGE] headers compare skipped (merge headers missing)", {
            qid: QID || null
          });
        }
      }catch(eCmp){
        console.error("[SYNC-A][CMP][STATE↔MERGE] headers compare error", {
          qid: QID || null,
          error: String(eCmp && eCmp.message || eCmp)
        });
      }

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

    // ★ 処理: NO-PULLモードがONなら、sync/state を取りに行かずに終了する
    if (window.__cscs_sync_no_pull === true) {
      lastSyncStatus = "nopull";
      lastSyncTime   = new Date().toLocaleTimeString();
      lastSyncError  = "";
      updateMonitor();
      return;
    }

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

      // ★ 追加: SYNC 側 streak3WrongToday を正として localStorage 側も同期する（no-fallback）
      //   - state.streak3WrongToday を唯一のソースとして、
      //     「今日の3連続不正解ユニーク数」関連の localStorage を上書きする。
      //   - 無い/壊れている場合は “0埋め” せず、上書きもしない（欠損は欠損のまま）
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
          // ★ 処理1: dataset を厳密に読む（欠損/非数は null。0埋めしない）
          function readDatasetNonNegIntOrNull(ds, keyName){
            try{
              if (!ds) return null;
              const raw = ds[keyName];
              if (raw === null || raw === undefined) return null;
              const s = String(raw).trim();
              if (s === "") return null;
              if (!/^\d+$/.test(s)) return null;
              const n = parseInt(s, 10);
              if (!Number.isFinite(n) || n < 0) return null;
              return n;
            }catch(_e){
              return null;
            }
          }

          const sc = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverC");
          const si = readDatasetNonNegIntOrNull(totalsEl.dataset, "serverI");

          // ★ 処理2: 両方取れた時だけ上書き（欠損なら上書き禁止）
          if (sc !== null && si !== null) {
            setServerTotalsForQid(sc, si, 0);
            console.log("[SYNC-A][OK][NO-FALLBACK] resetStar dataset updated", { serverC: sc, serverI: si });
          } else {
            console.error("[SYNC-A][NO-OVERWRITE] resetStar skipped dataset update (missing/invalid)", {
              serverC: sc,
              serverI: si
            });
          }
        }
      }catch(e){
        console.error("[SYNC-A][ERROR] resetStar dataset sync failed", {
          error: String(e && e.message || e)
        });
      }

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

      // 2) クライアント側 snapshot は「生成して埋める」の禁止：存在しても削除/未定義にする（no-fallback）
      try{
        if (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object") {
          delete window.__cscs_sync_state.streak3Today;
        }
        console.log("[SYNC-A][NO-FALLBACK][RESET] cleared snapshot streak3Today (delete only)", {
          hasState: !!window.__cscs_sync_state
        });
      }catch(e){
        console.error("[SYNC-A][NO-FALLBACK][RESET] clear snapshot streak3Today failed", {
          error: String(e && e.message || e)
        });
      }

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

      // 3) クライアント側 snapshot は「空オブジェクト生成」禁止：存在しても削除/未定義にする（no-fallback）
      try{
        if (window.__cscs_sync_state && typeof window.__cscs_sync_state === "object") {
          delete window.__cscs_sync_state.oncePerDayToday;
        }
        console.log("[SYNC-A][NO-FALLBACK][RESET] cleared snapshot oncePerDayToday (delete only)", {
          hasState: !!window.__cscs_sync_state
        });
      }catch(e){
        console.error("[SYNC-A][NO-FALLBACK][RESET] clear snapshot oncePerDayToday failed", {
          error: String(e && e.message || e)
        });
      }

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

      // 3) クライアント側 snapshot を一旦クリアしてから /api/sync/state を取り直す（no-fallback）
      //   - 空オブジェクト生成で「存在する体」を作らない
      //   - delete + null にして「無い」を正として扱う
      try{
        const had = Object.prototype.hasOwnProperty.call(window, "__cscs_sync_state");
        if (had) {
          delete window.__cscs_sync_state;
        }
        window.__cscs_sync_state = null;

        console.log("[SYNC-A][NO-FALLBACK][RESET] cleared snapshot __cscs_sync_state (delete + null)", {
          had: had,
          nowType: typeof window.__cscs_sync_state,
          nowValue: window.__cscs_sync_state
        });
      }catch(e){
        console.error("[SYNC-A][NO-FALLBACK][RESET] clear snapshot __cscs_sync_state failed", {
          error: String(e && e.message || e)
        });
      }

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
  grid-template-columns: auto 1fr;
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

#cscs_sync_monitor_a .sync-nopull-btn {
    font-size: 9px;
    font-weight: 800;
    opacity: 0.7;
    text-shadow: none !impotant;
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

          <!-- ★ 追加: 初回セット導線（最小仕様）
               - ボタン: キー発行 / 再発行
               - 表示: user(email) / key(localStorage)状態 / state(200/400/403など) -->
          <button type="button" class="sync-toggle-btn" data-sync-init="1">キー発行 / 再発行</button>

          <span class="sync-mini">
            user <span class="sync-user-email">-</span>
          </span>
          <span class="sync-mini">
            key <span class="sync-key-status">-</span>
          </span>
          <span class="sync-mini">
            state <span class="sync-state-status">-</span>
          </span>

          <button type="button" class="sync-toggle-btn" data-sync-toggle="1">OPEN</button>
        </div>

        <div class="sync-grid">
          <div class="sync-card sync-span-2">
            <div class="sync-body totals-row">
              <div class="sync-totals-label">Totals(c/w)</div>

              <div id="cscs_sync_totals" class="sync-totals" data-server-c="" data-server-i="">
                <span class="sync-server-text">SYNC - / -</span>
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
                <div class="mini-label">unique</div>
                <div class="mini-val">sync <span class="sync-streak3today-sync">0</span> / local <span class="sync-streak3today-local">0</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">Streak3WrongTodayUq</div>
            <div class="sync-body sync-streak3wrongtoday">
              <div class="mini-grid">
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
                <div class="mini-val"><span class="sync-streakmax-len-local">-</span></div>

                <div class="mini-label">streak_max</div>
                <div class="mini-val"><span class="sync-streakmax-max-local">-</span></div>

                <div class="mini-label">max_day</div>
                <div class="mini-val"><span class="sync-streakmax-maxday-local">-</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card">
            <div class="sync-title">連続不正解 (Local)</div>
            <div class="sync-body">
              <div class="mini-grid">
                <div class="mini-label">streak_len</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-len-local">-</span></div>

                <div class="mini-label">streak_max</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-max-local">-</span></div>

                <div class="mini-label">max_day</div>
                <div class="mini-val"><span class="sync-wrong-streakmax-maxday-local">-</span></div>
              </div>
            </div>
          </div>

          <div class="sync-card sync-span-2 once-card once-card-sync">
            <div class="sync-title">
              <span class="once-title-text">OncePerDayToday / O.D.O.A Mode (SYNC)</span>
              <button type="button" class="once-fold-btn" data-once-fold="sync">▶show</button>
            </div>
            <div class="sync-body sync-onceperday sync">oncePerDayToday: -</div>
          </div>

          <div class="sync-card sync-span-2 once-card once-card-local">
            <div class="sync-title">
              <span class="once-title-text">OncePerDayToday / O.D.O.A Mode (local)</span>
              <button type="button" class="once-fold-btn" data-once-fold="local">▶show</button>
            </div>
            <div class="sync-body sync-onceperday local">oncePerDayToday: -</div>
          </div>

          <div class="sync-card sync-span-2">
            <div class="sync-lastday-headline">
              <span class="sync-lastday-summary-type">LastCorrect</span>
              <span class="sync-lastday-summary-sync">SYNC -</span>
              <span class="sync-lastday-summary-local">local -</span>
            </div>

            <div class="sync-body sync-lastday">
              <div class="lastday-grid">
                <div class="ld-label ld-row-lastseen">lastSeen</div>
                <div class="ld-row-lastseen"><span class="sync-last-seen-sync">-</span></div>
                <div class="ld-row-lastseen"><span class="sync-last-seen-local">-</span></div>

                <div class="ld-label ld-row-lastcorrect">lastCorrect</div>
                <div class="ld-row-lastcorrect"><span class="sync-last-correct-sync">-</span></div>
                <div class="ld-row-lastcorrect"><span class="sync-last-correct-local">-</span></div>

                <div class="ld-label ld-row-lastwrong">lastWrong</div>
                <div class="ld-row-lastwrong"><span class="sync-last-wrong-sync">-</span></div>
                <div class="ld-row-lastwrong"><span class="sync-last-wrong-local">-</span></div>
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
              <div class="status-value">
                <span class="sync-status">pulled (-)</span>
                <button type="button" class="sync-nopull-btn" data-nopull-toggle="1">NO-PULL:OFF</button>
              </div>
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
        // ============================================================
        // ★ OncePerDayToday / O.D.O.A Mode：カード単体の折りたたみ（SYNC / local を分離）
        // ------------------------------------------------------------
        // - data-once-fold="sync" / "local" をそれぞれ別カードとして扱う
        // - 状態は localStorage に別キーで永続化する
        // ============================================================
        const LS_ONCE_OPEN_SYNC  = "cscs_sync_a_onceperday_open_sync";
        const LS_ONCE_OPEN_LOCAL = "cscs_sync_a_onceperday_open_local";

        const onceCardSync   = box.querySelector(".sync-card.once-card.once-card-sync");
        const onceCardLocal  = box.querySelector(".sync-card.once-card.once-card-local");
        const onceFoldBtnSync  = box.querySelector('button[data-once-fold="sync"]');
        const onceFoldBtnLocal = box.querySelector('button[data-once-fold="local"]');

        function refreshOnceFoldBtnLabel(btn, card){
          if (!btn) return;
          const isOpen = !(card && card.classList.contains("once-collapsed"));
          btn.textContent = isOpen ? "▼hide" : "▶show";
        }

        try{
          // ★ 処理: SYNCカードの折りたたみ状態を復元する
          const onceOpenSync = readLsBool(LS_ONCE_OPEN_SYNC, false); // デフォルトは折りたたみ（closed）
          if (onceCardSync) {
            if (onceOpenSync) {
              onceCardSync.classList.remove("once-collapsed");
            } else {
              onceCardSync.classList.add("once-collapsed");
            }
          }
          refreshOnceFoldBtnLabel(onceFoldBtnSync, onceCardSync);

          // ★ 処理: localカードの折りたたみ状態を復元する
          const onceOpenLocal = readLsBool(LS_ONCE_OPEN_LOCAL, false); // デフォルトは折りたたみ（closed）
          if (onceCardLocal) {
            if (onceOpenLocal) {
              onceCardLocal.classList.remove("once-collapsed");
            } else {
              onceCardLocal.classList.add("once-collapsed");
            }
          }
          refreshOnceFoldBtnLabel(onceFoldBtnLocal, onceCardLocal);
        }catch(_){}

        if (onceFoldBtnSync) {
          onceFoldBtnSync.addEventListener("click", function(){
            try{
              if (!onceCardSync) return;
              // ★ 処理: SYNCカードをトグルし、永続化する
              const nextOpen = onceCardSync.classList.contains("once-collapsed"); // 今閉じてるなら開く
              if (nextOpen) {
                onceCardSync.classList.remove("once-collapsed");
              } else {
                onceCardSync.classList.add("once-collapsed");
              }
              writeLsBool(LS_ONCE_OPEN_SYNC, nextOpen);
              refreshOnceFoldBtnLabel(onceFoldBtnSync, onceCardSync);
            }catch(_){}
          });
        }

        if (onceFoldBtnLocal) {
          onceFoldBtnLocal.addEventListener("click", function(){
            try{
              if (!onceCardLocal) return;
              // ★ 処理: localカードをトグルし、永続化する
              const nextOpen = onceCardLocal.classList.contains("once-collapsed"); // 今閉じてるなら開く
              if (nextOpen) {
                onceCardLocal.classList.remove("once-collapsed");
              } else {
                onceCardLocal.classList.add("once-collapsed");
              }
              writeLsBool(LS_ONCE_OPEN_LOCAL, nextOpen);
              refreshOnceFoldBtnLabel(onceFoldBtnLocal, onceCardLocal);
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

      // ★ 処理: 「syncからデータを取得しない（NO-PULL）」モードを localStorage で永続化し、ボタンで切替
      //   - ON: initialFetch() を実行しない（sync/state を取りに行かない）
      //   - OFF: 通常通り initialFetch() で sync/state 取得を行う
      const LS_NO_PULL = "cscs_sync_a_no_pull_mode";
      const noPullBtn = box.querySelector('button[data-nopull-toggle="1"]');

      function refreshNoPullBtnLabel(){
        if (!noPullBtn) return;
        const on = (window.__cscs_sync_no_pull === true);
        noPullBtn.textContent = on ? "NO-PULL:ON" : "NO-PULL:OFF";
      }

      try{
        // ★ 処理: 起動時に localStorage から状態を復元し、グローバルフラグに反映する
        const on = readLsBool(LS_NO_PULL, false);
        window.__cscs_sync_no_pull = !!on;
        refreshNoPullBtnLabel();
      }catch(_){}

      if (noPullBtn) {
        noPullBtn.addEventListener("click", function(){
          try{
            // ★ 処理: クリックでON/OFFをトグルし、localStorageへ保存する
            const nextOn = !(window.__cscs_sync_no_pull === true);
            window.__cscs_sync_no_pull = nextOn;
            writeLsBool(LS_NO_PULL, nextOn);
            refreshNoPullBtnLabel();

            // ★ 処理: ONは「取得しない」ので状態だけ更新、OFFは即 pull する
            if (nextOn) {
              lastSyncStatus = "nopull";
              lastSyncTime   = new Date().toLocaleTimeString();
              lastSyncError  = "";
              updateMonitor();
            } else {
              initialFetch();
            }
          }catch(_){}
        });
      }

      // ============================================================
      // ★ 追加: 初回セット導線（最小仕様）
      // ------------------------------------------------------------
      // - 既存SYNC/計測ロジックには触れない（独立UI + 独立fetch）
      // - user: Cloudflare Access の email（/api/sync/state レスポンスヘッダからのみ）
      // - key状態: localStorage("cscs_sync_key") present/missing
      // - state状態: /api/sync/state を X-CSCS-Key 付きで叩いた status（200/400/403など）
      // - ボタン押下:
      //     1) POST /api/sync/init {force:false}（再発行時のみtrue）
      //     2) 200なら body.key を localStorage("cscs_sync_key") に保存
      //     3) 直後に GET /api/sync/state を header: X-CSCS-Key で確認
      //     4) 判定ログを必ず1行（✅ / ❌ + status併記）
      // - フォールバック禁止（欠損は欠損として UI に表示）
      // ============================================================
      try{
        const initBtn = box.querySelector('button[data-sync-init="1"]');
        const elUser  = box.querySelector(".sync-user-email");
        const elKey   = box.querySelector(".sync-key-status");
        const elState = box.querySelector(".sync-state-status");

        function readLocalSyncKeyStrict(){
          try{
            const v = localStorage.getItem("cscs_sync_key");
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            return s === "" ? null : s;
          }catch(_){
            return null;
          }
        }

        function refreshInitUiSnapshotStrict(stateStatus, userEmailFromHeader){
          // ★ 処理: key状態（present/missing）
          try{
            const k = readLocalSyncKeyStrict();
            if (elKey) elKey.textContent = (k !== null) ? "present" : "missing";
          }catch(_){}

          // ★ 処理: user表示（/api/sync/state ヘッダ由来のみ）
          try{
            if (elUser) {
              if (userEmailFromHeader === null || userEmailFromHeader === undefined) {
                elUser.textContent = "MISSING";
              } else {
                const s = String(userEmailFromHeader).trim();
                elUser.textContent = (s === "") ? "MISSING" : s;
              }
            }
          }catch(_){}

          // ★ 処理: state status表示（数値以外はそのまま出さずMISSING）
          try{
            if (elState) {
              if (typeof stateStatus === "number" && Number.isFinite(stateStatus)) {
                elState.textContent = String(stateStatus);
              } else {
                elState.textContent = "MISSING";
              }
            }
          }catch(_){}
        }

        async function fetchStateWithKeyStrict(){
          const k = readLocalSyncKeyStrict();
          if (k === null) {
            // ★ 処理: key欠損なら state確認は実施できない（推測せず欠損として扱う）
            return { ok: false, status: null, user: null };
          }

          const r = await fetch("/api/sync/state", {
            method: "GET",
            credentials: "include",
            headers: {
              "X-CSCS-Key": k
            }
          });

          // ★ 処理: user(email) はヘッダからのみ取得（欠損はnull）
          let userEmail = null;
          try{
            const u = r.headers ? r.headers.get("X-CSCS-User") : null;
            if (u !== null && u !== undefined) {
              const s = String(u).trim();
              userEmail = (s === "") ? null : s;
            }
          }catch(_){
            userEmail = null;
          }

          return { ok: (r.status === 200), status: r.status, user: userEmail };
        }

        async function runInitFlowStrict(){
          // ★ 処理: 再発行判定（localStorageに既存keyがあれば force:true）
          const existedKey = (readLocalSyncKeyStrict() !== null);
          const force = existedKey ? true : false;

          let initStatus = null;
          let stateStatus = null;
          let userEmail = null;

          try{
            const initRes = await fetch("/api/sync/init", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ force: force })
            });

            initStatus = initRes.status;

            if (initRes.status === 200) {
              // ★ 処理: 200時のみ body.key を保存（欠損は欠損として保存しない）
              let key = null;
              try{
                const j = await initRes.json();
                if (j && Object.prototype.hasOwnProperty.call(j, "key")) {
                  const raw = j.key;
                  if (raw !== null && raw !== undefined) {
                    const s = String(raw).trim();
                    key = (s === "") ? null : s;
                  }
                }
              }catch(_){
                key = null;
              }

              if (key !== null) {
                localStorage.setItem("cscs_sync_key", key);
              }
            }

            // ★ 処理: 保存直後に state をヘッダ付きで確認
            const st = await fetchStateWithKeyStrict();
            stateStatus = st.status;
            userEmail = st.user;

            // ★ 処理: UI更新（欠損は欠損のまま）
            refreshInitUiSnapshotStrict(stateStatus, userEmail);

            // ★ 処理: 判定ログを必ず1行
            if (initStatus === 200 && stateStatus === 200) {
              console.log("✅ INIT+STATE OK (init=" + initStatus + ", state=" + stateStatus + ")");
            } else {
              console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
            }
          }catch(e){
            // ★ 処理: 例外時も「1行ログ」ルールを守る（statusはnull）
            refreshInitUiSnapshotStrict(stateStatus, userEmail);
            console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
          }
        }

        // ★ 処理: 起動時スナップショット（key状態だけは常に表示できる）
        refreshInitUiSnapshotStrict(null, null);

        if (initBtn) {
          initBtn.addEventListener("click", function(){
            runInitFlowStrict();
          });
        }
      }catch(_){}
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