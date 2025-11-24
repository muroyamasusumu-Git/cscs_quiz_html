export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  const delta = await request.json(); // { correctDelta:{qid:n}, incorrectDelta:{qid:n}, streak3Delta:{qid:n}, streakLenDelta:{qid:n} }
  const server =
    (await env.SYNC.get(key, "json")) ||
    { correct: {}, incorrect: {}, streak3: {}, streakLen: {}, updatedAt: 0 };

  for (const [qid, n] of Object.entries(delta.correctDelta || {})) {
    server.correct[qid] = (server.correct[qid] || 0) + (n as number);
  }
  for (const [qid, n] of Object.entries(delta.incorrectDelta || {})) {
    server.incorrect[qid] = (server.incorrect[qid] || 0) + (n as number);
  }
  for (const [qid, n] of Object.entries(delta.streak3Delta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.streak3) server.streak3 = {};
    server.streak3[qid] = (server.streak3[qid] || 0) + v;
  }

  for (const [qid, n] of Object.entries(delta.streakLenDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;
    if (!server.streakLen) server.streakLen = {};
    server.streakLen[qid] = v;
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