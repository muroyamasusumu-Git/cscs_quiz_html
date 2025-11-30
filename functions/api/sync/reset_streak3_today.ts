// functions/api/sync/reset_streak3_today.ts

export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // 既存データを取得（なければ空オブジェクトから開始）
  const data = (await env.SYNC.get(key, "json")) || {};
  const server: any = data;

  // 足りないプロパティを補完
  if (!server.correct) server.correct = {};
  if (!server.incorrect) server.incorrect = {};
  if (!server.streak3) server.streak3 = {};
  if (!server.streakLen) server.streakLen = {};
  if (!server.consistency_status) server.consistency_status = {};
  if (!server.streak3Today) server.streak3Today = { day: "", unique_count: 0 };

  // ★ 今日の⭐️ユニーク数を「完全リセット」
  server.streak3Today = { day: "", unique_count: 0 };

  server.updatedAt = Date.now();
  await env.SYNC.put(key, JSON.stringify(server));

  return new Response(
    JSON.stringify({
      ok: true,
      streak3Today: server.streak3Today
    }),
    {
      headers: { "content-type": "application/json" }
    }
  );
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}