export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // データ読み込み（存在しなければ空オブジェクト）
  const data = await env.SYNC.get(key, "json");

  // streak3 を必ず返却するため empty に streak3 を追加
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    updatedAt: 0
  };

  // data が存在しても streak3 が無い可能性があるので補完する
  const out = data || empty;
  if (!out.streak3) out.streak3 = {};

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