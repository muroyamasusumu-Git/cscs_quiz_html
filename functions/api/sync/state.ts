// state.ts
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
    consistency_status: {},
    // お気に入り状態（fav_modal.js 用）
    fav: {},
    // グローバルメタ情報（総問題数など）を保持する領域
    global: {},
    // O.D.O.A Mode の初期値（未保存ユーザー用に "off" で補完する）
    odoa_mode: "off",
    // ★ここでは streak3Today を追加しない（消失確認のため上書き禁止）
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
  // 4) streak3Today / oncePerDayToday の存在/内容チェック
  //    - streak3Today は「存在確認のみ（上書き禁止）」
  //    - oncePerDayToday は「day / results の簡易整合チェック」を行う
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

    console.log("[SYNC/state] --- oncePerDayToday Check ---");
    console.log("[SYNC/state] hasOncePerDayProp:", hasOncePerDayProp);
    console.log("[SYNC/state] out.oncePerDayToday (raw):", rawOnce);
    console.log("[SYNC/state] out.oncePerDayToday (parsed):", {
      day: onceDayNum,
      resultsKeysLength: onceResultsKeysLength
    });

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
    console.log("[SYNC/state] hasConsistencyStatus :", !!out.consistency_status);
    console.log("[SYNC/state] hasFav               :", !!out.fav);
    console.log("[SYNC/state] hasStreak3Today      :", hasProp);
    console.log("[SYNC/state] hasOncePerDayToday   :", hasOncePerDayProp);
    console.log("[SYNC/state] hasOdoaMode          :", hasOdoaModePropForLog);

    const hasGlobal = !!out.global && typeof out.global === "object";
    const totalQuestions =
      hasGlobal && typeof (out.global as any).totalQuestions === "number"
        ? (out.global as any).totalQuestions
        : null;
    console.log("[SYNC/state] hasGlobal            :", hasGlobal);
    console.log("[SYNC/state] global.totalQuestions:", totalQuestions);

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