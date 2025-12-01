// state.ts
export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
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

  // -----------------------------
  // 4) streak3Today の存在/内容チェック（上書き禁止）
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

  // -----------------------------
  // 5) ログ出力（完全）
  // -----------------------------
  try {
    console.log("[SYNC/state] --- streak3Today Check ---");
    console.log("[SYNC/state] hasProp:", hasProp);
    console.log("[SYNC/state] out.streak3Today (raw):", rawSt3);
    console.log("[SYNC/state] out.streak3Today (parsed):", {
      day: parsedDay,
      unique_count: parsedCount
    });

    console.log("[SYNC/state] --- summary ---");
    console.log("[SYNC/state] hasCorrect           :", !!out.correct);
    console.log("[SYNC/state] hasIncorrect         :", !!out.incorrect);
    console.log("[SYNC/state] hasStreak3           :", !!out.streak3);
    console.log("[SYNC/state] hasStreakLen         :", !!out.streakLen);
    console.log("[SYNC/state] hasConsistencyStatus :", !!out.consistency_status);
    console.log("[SYNC/state] hasStreak3Today      :", hasProp);

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
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}