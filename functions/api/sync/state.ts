export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // データ読み込み（存在しなければ空オブジェクト）
  const data = await env.SYNC.get(key, "json");

  // streak3 / consistency_status を必ず返却するため empty に項目を用意
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    streakLen: {},
    consistency_status: {},
    updatedAt: 0
  };

  // data が存在しても欠けている項目があれば補完する
  const out: any = data || empty;
  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.consistency_status) out.consistency_status = {};

  // KV 上の consistency_status:* を集約して out.consistency_status に詰める
  try {
    const list = await env.SYNC.list({ prefix: "consistency_status:" });
    const keys = Array.isArray(list.keys) ? list.keys : [];
    for (const entry of keys) {
      const name = entry && entry.name ? entry.name : "";
      if (!name) continue;
      const qid = name.replace(/^consistency_status:/, "");
      if (!qid) continue;

      try {
        const raw = await env.SYNC.get(name);
        if (!raw) continue;
        const parsed = JSON.parse(String(raw));
        out.consistency_status[qid] = parsed;
      } catch (_e) {
      }
    }
  } catch (_e) {
  }

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