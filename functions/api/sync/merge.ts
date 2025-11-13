export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  const delta = await request.json(); // { correctDelta:{qid:n}, incorrectDelta:{qid:n} }
  const server = (await env.SYNC.get(key, "json")) || { correct: {}, incorrect: {}, updatedAt: 0 };

  for (const [qid, n] of Object.entries(delta.correctDelta || {})) {
    server.correct[qid] = (server.correct[qid] || 0) + (n as number);
  }
  for (const [qid, n] of Object.entries(delta.incorrectDelta || {})) {
    server.incorrect[qid] = (server.incorrect[qid] || 0) + (n as number);
  }

  server.updatedAt = Date.now();
  await env.SYNC.put(key, JSON.stringify(server));
  return new Response(JSON.stringify(server), {
    headers: { "content-type": "application/json" },
  });
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}