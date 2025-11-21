// functions/api/sync/reset_qid.ts
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // --- 認証（CF Access） ---
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // --- Body を JSON で受け取り、qid を取得 ---
  const body = await request.json().catch(() => null);
  if (!body || !body.qid) {
    return new Response(JSON.stringify({ error: "qid is required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }
  const qid = String(body.qid);

  // --- 現在の SYNC データをロード ---
  const raw = await env.SYNC.get(key);
  let data: any;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { correct: {}, incorrect: {}, updatedAt: Date.now() };
    }
  } else {
    data = { correct: {}, incorrect: {}, updatedAt: Date.now() };
  }

  // --- qid をピンポイントで削除 ---
  if (data.correct && data.correct[qid] !== undefined) {
    delete data.correct[qid];
  }
  if (data.incorrect && data.incorrect[qid] !== undefined) {
    delete data.incorrect[qid];
  }

  // --- updatedAt 更新 ---
  data.updatedAt = Date.now();

  // --- 保存 ---
  await env.SYNC.put(key, JSON.stringify(data));

  // --- レスポンス ---
  return new Response(JSON.stringify({ ok: true, cleared_qid: qid, data }), {
    headers: { "content-type": "application/json" }
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