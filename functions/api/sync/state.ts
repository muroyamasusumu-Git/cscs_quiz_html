export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // データ読み込み（存在しなければ空オブジェクト）
  const data = await env.SYNC.get(key, "json");

  // ★ debug: KV から生で取れたデータをログ出力
  try {
    console.log("[SYNC/state] key:", key);
    console.log("[SYNC/state] RAW data from KV:", JSON.stringify(data));
  } catch (_e) {}

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
  const out: any = data || empty;
  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.consistency_status) out.consistency_status = {};
  if (!out.streak3Today) out.streak3Today = { day: "", unique_count: 0 };

  // ★ debug: クライアントに返す streak3Today をログ出力
  try {
    console.log("[SYNC/state] out.streak3Today:", JSON.stringify(out.streak3Today));
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