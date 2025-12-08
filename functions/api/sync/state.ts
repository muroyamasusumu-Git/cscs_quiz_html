// state.ts
/**
 * CSCS SYNC state 取得エンドポイント（Workers 側）
 *
 * 【キー対応表（LocalStorage ⇔ SYNC state ⇔ delta payload）】
 *  ※merge.ts と同じキー設計を共有する。state.ts / merge.ts のどちらかで
 *    新しくキーを追加／既存キー名を変更した場合は、両方の表を必ず更新すること（恒久ルール）。
 *
 * ▼ 問題別累計
 *   - localStorage: "cscs_q_correct_total:" + qid
 *       ⇔ SYNC state: correct[qid]
 *       ⇔ delta payload: correctDelta[qid]
 *   - localStorage: "cscs_q_wrong_total:" + qid
 *       ⇔ SYNC state: incorrect[qid]
 *       ⇔ delta payload: incorrectDelta[qid]
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage: "cscs_q_correct_streak3_total:" + qid
 *       ⇔ SYNC state: streak3[qid]
 *       ⇔ delta payload: streak3Delta[qid]
 *   - localStorage: "cscs_q_correct_streak_len:" + qid
 *       ⇔ SYNC state: streakLen[qid]
 *       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ 問題別 3 連続不正解（💣用）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *   - localStorage: "cscs_q_wrong_streak_len:" + qid
 *       ⇔ SYNC state: streakWrongLen[qid]
 *       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ Streak3Today（本日の⭐️ユニーク数）
 *   - localStorage: "cscs_streak3_today_day"
 *       ⇔ SYNC state: streak3Today.day
 *       ⇔ delta payload: streak3TodayDelta.day
 *   - localStorage: "cscs_streak3_today_qids"
 *       ⇔ SYNC state: streak3Today.qids
 *       ⇔ delta payload: streak3TodayDelta.qids
 *   - localStorage: "cscs_streak3_today_unique_count"
 *       ⇔ SYNC state: streak3Today.unique_count
 *       ⇔ delta payload: streak3TodayDelta.unique_count（省略可）
 *
 * ▼ Streak3WrongToday（本日の3連続不正解ユニーク数）
 *   - localStorage: "cscs_streak3_wrong_today_day"
 *       ⇔ SYNC state: streak3WrongToday.day
 *       ⇔ delta payload: streak3WrongTodayDelta.day
 *   - localStorage: "cscs_streak3_wrong_today_qids"
 *       ⇔ SYNC state: streak3WrongToday.qids
 *       ⇔ delta payload: streak3WrongTodayDelta.qids
 *   - localStorage: "cscs_streak3_wrong_today_unique_count"
 *       ⇔ SYNC state: streak3WrongToday.unique_count
 *       ⇔ delta payload: streak3WrongTodayDelta.unique_count（省略可）
 *
 * ▼ oncePerDayToday（1日1回まで計測）
 *   - localStorage: "cscs_once_per_day_today_day"
 *       ⇔ SYNC state: oncePerDayToday.day
 *       ⇔ delta payload: oncePerDayTodayDelta.day
 *   - localStorage: "cscs_once_per_day_today_results"
 *       ⇔ SYNC state: oncePerDayToday.results[qid]
 *       ⇔ delta payload: oncePerDayTodayDelta.results[qid]
 *
 * ▼ お気に入り状態
 *   - localStorage: （fav_modal.js 内部管理）
 *       ⇔ SYNC state: fav[qid]
 *       ⇔ delta payload: fav[qid] ("unset" | "understood" | "unanswered" | "none")
 *
 * ▼ グローバル情報
 *   - localStorage: "cscs_total_questions"
 *       ⇔ SYNC state: global.totalQuestions
 *       ⇔ delta payload: global.totalQuestions
 *
 * ▼ 整合性ステータス（consistency_status）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: consistency_status[qid]
 *       ⇔ delta payload: consistencyStatusDelta[qid]
 *
 * ▼ 試験日設定（exam_date）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: exam_date (YYYY-MM-DD)
 *       ⇔ delta payload: exam_date_iso (YYYY-MM-DD)
 *
 * ▼ O.D.O.A / 検証モード関連
 *   - runtime: window.CSCS_VERIFY_MODE ("on" / "off")
 *       ⇔ SYNC state: odoa_mode ("on" / "off")
 *       ⇔ delta payload: odoa_mode
 */
export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // ★ Origin チェック（同一ドメイン＋ローカル開発のみ許可）
  const origin = request.headers.get("Origin");
  const allowedOrigins = [
    "https://cscs-quiz-html.pages.dev", // 本番
    "http://localhost:8789"             // ローカル開発
  ];

  if (origin !== null && !allowedOrigins.includes(origin)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain" }
    });
  }

  const user = await getUserIdFromAccess(request);
  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain" }
    });
  }
  const key = `sync:${user}`;

  try {
    console.log("====================================================");
    console.log("[SYNC/state] === onRequestGet START ===");
    console.log("[SYNC/state] user:", user);
    console.log("[SYNC/state] key :", key);
  } catch (_e) {}

  // -----------------------------
  // 1) KV から読み出し
  // -----------------------------
  let data: any = null;
  try {
    data = await env.SYNC.get(key, "json");
    console.log("[SYNC/state] RAW data from KV:", JSON.stringify(data));
  } catch (e) {
    console.error("[SYNC/state] ★KV 読み出し失敗:", e);
  }

  // -----------------------------
  // 2) empty テンプレ（補完用）
  // -----------------------------
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    streakLen: {},
    // 3連続不正解の累計・現在ストリークも SYNC に必ず載せるための初期構造
    streak3Wrong: {},
    streakWrongLen: {},
    consistency_status: {},
    // お気に入り状態（fav_modal.js 用）
    fav: {},
    // グローバルメタ情報（総問題数など）を保持する領域
    global: {},
    // O.D.O.A Mode の初期値（未保存ユーザー用に "off" で補完する）
    odoa_mode: "off",
    // ★ここでは streak3Today / streak3WrongToday / oncePerDayToday を追加しない（消失確認のため上書き禁止）
    updatedAt: 0
  };

  // -----------------------------
  // 3) out 生成（補完）
  // -----------------------------
  let out: any = data ? data : empty;

  // 欠けている構造だけ補完（streak3Today は絶対に補完しない）
  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.streak3Wrong) out.streak3Wrong = {};
  if (!out.streakWrongLen) out.streakWrongLen = {};
  if (!out.consistency_status) out.consistency_status = {};
  if (!out.fav || typeof out.fav !== "object") out.fav = {};
  if (!out.global || typeof out.global !== "object") out.global = {};

  // O.D.O.A Mode のフラグを補完（欠落 or 不正値のときは "off" に統一）
  const hasOdoaMode = Object.prototype.hasOwnProperty.call(out, "odoa_mode");
  if (!hasOdoaMode || typeof out.odoa_mode !== "string") {
    out.odoa_mode = "off";
    try {
      // ★ここで "off" で補完したことを明示的にログ出力（初回セットの確認用）
      console.log("[SYNC/state] odoa_mode が欠落または不正値のため 'off' で補完しました。");
    } catch (_e) {}
  }

  // -----------------------------
  // 4) streak3Today / streak3WrongToday / oncePerDayToday / fav / O.D.O.A Mode の存在/内容チェック
  //    - streak3Today / streak3WrongToday は「存在確認のみ（上書き禁止）」
  //    - oncePerDayToday は「day / results の簡易整合チェック」
  //    - fav は「構造と値が想定どおりかどうか」を確認（補正は行わない）
  // -----------------------------
  let hasProp = Object.prototype.hasOwnProperty.call(out, "streak3Today");
  let rawSt3 = hasProp ? out.streak3Today : undefined;

  let parsedDay: string | null = null;
  let parsedCount: number | null = null;

  if (hasProp && rawSt3 && typeof rawSt3 === "object") {
    parsedDay =
      typeof rawSt3.day === "string"
        ? rawSt3.day
        : null;

    if (typeof rawSt3.unique_count === "number") {
      const n = rawSt3.unique_count;
      parsedCount = Number.isFinite(n) && n >= 0 ? n : null;
    }
  }

  // ★ Streak3WrongToday 側の存在チェックと簡易パース
  //   - KV に保存されている「本日の3連続不正解ユニーク情報」が、
  //     day / unique_count / qids の3つとも想定どおりの形かどうかを確認する
  const hasWrongTodayProp = Object.prototype.hasOwnProperty.call(out, "streak3WrongToday");
  const rawSt3Wrong: any = hasWrongTodayProp ? (out as any).streak3WrongToday : undefined;

  let parsedWrongDay: string | null = null;
  let parsedWrongCount: number | null = null;

  if (hasWrongTodayProp && rawSt3Wrong && typeof rawSt3Wrong === "object") {
    parsedWrongDay =
      typeof rawSt3Wrong.day === "string"
        ? rawSt3Wrong.day
        : null;

    if (typeof rawSt3Wrong.unique_count === "number") {
      const nw = rawSt3Wrong.unique_count;
      parsedWrongCount = Number.isFinite(nw) && nw >= 0 ? nw : null;
    }
  }

  // oncePerDayToday 側の簡易チェック
  const hasOncePerDayProp = Object.prototype.hasOwnProperty.call(out, "oncePerDayToday");
  const rawOnce: any = hasOncePerDayProp ? (out as any).oncePerDayToday : undefined;

  let onceDayNum: number | null = null;
  let onceResultsKeysLength = 0;

  if (rawOnce && typeof rawOnce === "object") {
    if (typeof rawOnce.day === "number" && Number.isFinite(rawOnce.day)) {
      onceDayNum = rawOnce.day;
    }
    if (rawOnce.results && typeof rawOnce.results === "object") {
      onceResultsKeysLength = Object.keys(rawOnce.results as any).length;
    }
  }

  // fav 側の簡易チェック（fav_modal.js / merge.ts と同じ値セットかどうかを確認）
  // - fav はプレーンオブジェクトであることを期待
  // - 値は "unset" / "understood" / "unanswered" / "none" のいずれかであることを確認
  // - ここでは補正や削除は行わず、「不正が混ざっているかどうか」をログするだけに留める
  const hasFavPropForLog = Object.prototype.hasOwnProperty.call(out, "fav");
  const rawFav: any = hasFavPropForLog ? (out as any).fav : undefined;

  let favKeysLength = 0;
  let favAllValuesValid: boolean | null = null;

  if (rawFav && typeof rawFav === "object" && !Array.isArray(rawFav)) {
    const entries = Object.entries(rawFav as any);
    favKeysLength = entries.length;
    favAllValuesValid = true;

    for (const [qid, v] of entries) {
      if (typeof qid !== "string" || !qid) {
        favAllValuesValid = false;
        break;
      }
      if (
        v !== "unset" &&
        v !== "understood" &&
        v !== "unanswered" &&
        v !== "none"
      ) {
        favAllValuesValid = false;
        break;
      }
    }
  } else if (hasFavPropForLog) {
    // fav プロパティ自体は存在しているが、想定したプレーンオブジェクトでない場合
    favAllValuesValid = false;
  }

  // O.D.O.A Mode 側の簡易チェック
  const hasOdoaModePropForLog = Object.prototype.hasOwnProperty.call(out, "odoa_mode");
  const rawOdoaMode: any = hasOdoaModePropForLog ? (out as any).odoa_mode : undefined;

  let odModeParsed: "on" | "off" | null = null;
  if (typeof rawOdoaMode === "string") {
    if (rawOdoaMode === "on" || rawOdoaMode === "off") {
      odModeParsed = rawOdoaMode;
    }
  }

  // -----------------------------
  // 5) ログ出力（完全）
  // -----------------------------
  try {
    const qidsRaw =
      hasProp && rawSt3 && typeof rawSt3 === "object"
        ? (rawSt3 as any).qids
        : undefined;
    const qidsIsArray = Array.isArray(qidsRaw);
    const qidsLength = qidsIsArray ? (qidsRaw as any[]).length : 0;
    const isConsistent =
      qidsIsArray && parsedCount !== null
        ? parsedCount === qidsLength
        : null;

    console.log("[SYNC/state] --- streak3Today Check ---");
    console.log("[SYNC/state] hasProp:", hasProp);
    console.log("[SYNC/state] out.streak3Today (raw):", rawSt3);
    console.log("[SYNC/state] out.streak3Today.qids:", qidsRaw);
    console.log("[SYNC/state] out.streak3Today (parsed):", {
      day: parsedDay,
      unique_count: parsedCount,
      qidsIsArray,
      qidsLength,
      isConsistent
    });

    // ★ Streak3WrongToday の内容チェックログ
    //   - day / unique_count / qids 配列の整合性（unique_count === qids.length）を確認する
    const qidsWrongRaw =
      hasWrongTodayProp && rawSt3Wrong && typeof rawSt3Wrong === "object"
        ? (rawSt3Wrong as any).qids
        : undefined;
    const qidsWrongIsArray = Array.isArray(qidsWrongRaw);
    const qidsWrongLength = qidsWrongIsArray ? (qidsWrongRaw as any[]).length : 0;
    const isWrongConsistent =
      qidsWrongIsArray && parsedWrongCount !== null
        ? parsedWrongCount === qidsWrongLength
        : null;

    console.log("[SYNC/state] --- streak3WrongToday Check ---");
    console.log("[SYNC/state] hasWrongTodayProp        :", hasWrongTodayProp);
    console.log("[SYNC/state] out.streak3WrongToday(raw):", rawSt3Wrong);
    console.log("[SYNC/state] out.streak3WrongToday.qids:", qidsWrongRaw);
    console.log("[SYNC/state] out.streak3WrongToday(parsed):", {
      day: parsedWrongDay,
      unique_count: parsedWrongCount,
      qidsIsArray: qidsWrongIsArray,
      qidsLength: qidsWrongLength,
      isConsistent: isWrongConsistent
    });

    console.log("[SYNC/state] --- oncePerDayToday Check ---");
    console.log("[SYNC/state] hasOncePerDayProp:", hasOncePerDayProp);
    console.log("[SYNC/state] out.oncePerDayToday (raw):", rawOnce);
    console.log("[SYNC/state] out.oncePerDayToday (parsed):", {
      day: onceDayNum,
      resultsKeysLength: onceResultsKeysLength
    });

    console.log("[SYNC/state] --- fav Check ---");
    console.log("[SYNC/state] hasFavProp          :", hasFavPropForLog);
    console.log("[SYNC/state] favKeysLength       :", favKeysLength);
    console.log("[SYNC/state] favAllValuesValid   :", favAllValuesValid);

    console.log("[SYNC/state] --- O.D.O.A Mode Check ---");
    console.log("[SYNC/state] hasOdoaModeProp      :", hasOdoaModePropForLog);
    console.log("[SYNC/state] out.odoa_mode (raw)  :", rawOdoaMode);
    console.log("[SYNC/state] out.odoa_mode (parsed):", {
      odoa_mode: odModeParsed
    });

    console.log("[SYNC/state] --- summary ---");
    console.log("[SYNC/state] hasCorrect           :", !!out.correct);
    console.log("[SYNC/state] hasIncorrect         :", !!out.incorrect);
    console.log("[SYNC/state] hasStreak3           :", !!out.streak3);
    console.log("[SYNC/state] hasStreakLen         :", !!out.streakLen);
    // 3連続不正解系の有無も SYNC snapshot から確認できるようにする
    console.log("[SYNC/state] hasStreak3Wrong      :", !!out.streak3Wrong);
    console.log("[SYNC/state] hasStreakWrongLen    :", !!out.streakWrongLen);
    console.log("[SYNC/state] hasConsistencyStatus :", !!out.consistency_status);
    console.log("[SYNC/state] hasFav               :", !!out.fav);
    console.log("[SYNC/state] hasStreak3Today      :", hasProp);
    console.log("[SYNC/state] hasStreak3WrongToday :", hasWrongTodayProp);
    console.log("[SYNC/state] hasOncePerDayToday   :", hasOncePerDayProp);
    console.log("[SYNC/state] hasOdoaMode          :", hasOdoaModePropForLog);

    const hasGlobal = !!out.global && typeof out.global === "object";
    const totalQuestions =
      hasGlobal && typeof (out.global as any).totalQuestions === "number"
        ? (out.global as any).totalQuestions
        : null;
    console.log("[SYNC/state] hasGlobal            :", hasGlobal);
    console.log("[SYNC/state] global.totalQuestions:", totalQuestions);

    // exam_date が SYNC 上に正しく載っているかを簡易チェック
    const examDateRaw = (out as any).exam_date;
    const hasExamDate =
      typeof examDateRaw === "string" && examDateRaw.length > 0;
    console.log("[SYNC/state] hasExamDate          :", hasExamDate);
    console.log("[SYNC/state] exam_date            :", hasExamDate ? examDateRaw : null);

    console.log("[SYNC/state] === onRequestGet END ===");
    console.log("====================================================");
  } catch (_e) {}

  return new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json" },
  });
};

// -----------------------------
async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    console.error("[SYNC/state] CF-Access-Jwt-Assertion header missing.");
    return "";
  }

  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      console.error("[SYNC/state] invalid JWT format (parts length !== 3).");
      return "";
    }
    const payloadJson = atob(parts[1]);
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload.email !== "string" || !payload.email) {
      console.error("[SYNC/state] JWT payload does not contain valid email.", payload);
      return "";
    }
    return payload.email as string;
  } catch (e) {
    console.error("[SYNC/state] JWT decode/parse error.", e);
    return "";
  }
}