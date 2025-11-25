export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  const delta = await request.json(); // { correctDelta:{qid:n}, incorrectDelta:{qid:n}, streak3Delta:{qid:n}, streakLenDelta:{qid:n} }
  const server =
    (await env.SYNC.get(key, "json")) ||
    { correct: {}, incorrect: {}, streak3: {}, streakLen: {}, consistency_status: {}, updatedAt: 0 };

  if (!server.correct) {
    server.correct = {};
  }
  if (!server.incorrect) {
    server.incorrect = {};
  }
  if (!server.streak3) {
    server.streak3 = {};
  }
  if (!server.streakLen) {
    server.streakLen = {};
  }
  if (!server.consistency_status) {
    server.consistency_status = {};
  }

  for (const [qid, n] of Object.entries(delta.correctDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    server.correct[qid] = (server.correct[qid] || 0) + v;
  }
  for (const [qid, n] of Object.entries(delta.incorrectDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    server.incorrect[qid] = (server.incorrect[qid] || 0) + v;
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

  const consistencyStatusDelta = delta.consistencyStatusDelta || {};
  for (const [qid, payload] of Object.entries(consistencyStatusDelta)) {
    if (!server.consistency_status) {
      server.consistency_status = {};
    }
    if (payload === null) {
      delete server.consistency_status[qid];
      continue;
    }
    server.consistency_status[qid] = payload;
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