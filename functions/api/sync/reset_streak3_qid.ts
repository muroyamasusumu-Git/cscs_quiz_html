// functions/api/sync/reset_streak3_qid.ts
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // --- 認証（CF Access） ---
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // --- Body を JSON で受け取り、qid を取得 ---
  const body = await request.json().catch(() => null);
  if (!body || !body.qid) {
    return new Response(JSON.stringify({ error: "qid is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const qid = String(body.qid);

  // --- 現在の SYNC データをロード ---
  const raw = await env.SYNC.get(key);
  let data: any;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = { correct: {}, incorrect: {}, streak3: {}, streakLen: {}, updatedAt: Date.now() };
    }
  } else {
    data = { correct: {}, incorrect: {}, streak3: {}, streakLen: {}, updatedAt: Date.now() };
  }

  // --- safety: 各フィールドが無ければ作る（merge.ts と統一） ---
  if (!data.correct || typeof data.correct !== "object") {
    data.correct = {};
  }
  if (!data.incorrect || typeof data.incorrect !== "object") {
    data.incorrect = {};
  }
  if (!data.streak3 || typeof data.streak3 !== "object") {
    data.streak3 = {};
  }
  if (!data.streakLen || typeof data.streakLen !== "object") {
    data.streakLen = {};
  }
  if (!data.consistency_status || typeof data.consistency_status !== "object") {
    data.consistency_status = {};
  }

  // --- qid の streak3 / streakLen を 0 にリセット ---
  data.streak3[qid] = 0;
  data.streakLen[qid] = 0;

  // --- 更新 ---
  data.updatedAt = Date.now();

  // --- 保存 ---
  await env.SYNC.put(key, JSON.stringify(data));

  // --- レスポンス ---
  return new Response(JSON.stringify({
    ok: true,
    cleared_streak3_qid: qid,
    data
  }), {
    headers: { "Content-Type": "application/json" }
  });
};


// ============================================================
// 共通関数：CF Access からユーザー email を取り出す
// ============================================================
async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}