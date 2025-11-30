// state.ts
export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // データ読み込み（存在しなければ空オブジェクト）
  const data = await env.SYNC.get(key, "json");

  // ★★★ ここから読み出しの状態分類ログ ★★★
  try {
    console.log("[SYNC/state] key:", key);

    if (data == null) {
      console.warn("[SYNC/state] ★データなし（KVに何も保存されていない可能性）");
    } else {
      console.log("[SYNC/state] RAW data from KV:", JSON.stringify(data));

      if (typeof data.updatedAt === "number") {
        const ageMs = Date.now() - data.updatedAt;

        if (ageMs < 1000) {
          console.log("[SYNC/state] ★最新データ（保存後すぐ反映） age(ms):", ageMs);
        } else if (ageMs < 5000) {
          console.log("[SYNC/state] ★比較的新しいデータ age(ms):", ageMs);
        } else {
          console.warn("[SYNC/state] ★古いデータを返しています（KV 遅延の可能性大） age(ms):", ageMs);
        }
      } else {
        console.warn("[SYNC/state] ★updatedAt が存在しないデータ（不整合の可能性）");
      }
    }
  } catch (_e) {}
  // ★★★ 状態分類ログ ここまで ★★★

  // streak3 / consistency_status を必ず返却するため empty に項目を用意
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    streakLen: {},
    consistency_status: {},
    streak3Today: { day: "", unique_count: 0 },
    updatedAt: 0
  };

  // data が存在しても欠けている項目があれば補完する
  let out: any;
  if (data) {
    out = data;
    try {
      console.log("[SYNC/state] ★KVヒット: 既存データを使用");
    } catch (_e) {}
  } else {
    out = empty;
    try {
      console.log("[SYNC/state] ★KVミス: empty テンプレートを使用");
    } catch (_e) {}
  }

  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.consistency_status) out.consistency_status = {};
  if (!out.streak3Today) out.streak3Today = { day: "", unique_count: 0 };

  // ★ debug: クライアントに返す streak3Today と out 全体をログ出力
  try {
    console.log("[SYNC/state] out.streak3Today:", JSON.stringify(out.streak3Today));
    console.log("[SYNC/state] ★state 応答オブジェクト概要", {
      hasCorrect: !!out.correct,
      hasIncorrect: !!out.incorrect,
      hasStreak3: !!out.streak3,
      hasStreakLen: !!out.streakLen,
      hasConsistencyStatus: !!out.consistency_status
    });
  } catch (_e) {}

  return new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json" },
  });
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}