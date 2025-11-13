export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // このユーザーの正誤データを全クリア
  const empty = {
    correct: {},
    incorrect: {},
    updatedAt: Date.now()
  };

  await env.SYNC.put(key, JSON.stringify(empty));

  return new Response(JSON.stringify(empty), {
    headers: { "content-type": "application/json" }
  });
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}