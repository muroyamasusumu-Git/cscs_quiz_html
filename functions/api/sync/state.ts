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
    streak3Today: { day: "", unique_q_count: 0 },
    updatedAt: 0
  };

  // data が存在しても欠けている項目があれば補完する
  const out: any = data || empty;
  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.consistency_status) out.consistency_status = {};
  if (!out.streak3Today) out.streak3Today = { day: "", unique_q_count: 0 };

  var correctMap = out.correct || {};
  var incorrectMap = out.incorrect || {};
  var streak3Map = out.streak3 || {};
  var streakLenMap = out.streakLen || {};

  var qidsMap: any = {};
  for (const qid of Object.keys(correctMap)) {
    qidsMap[qid] = true;
  }
  for (const qid of Object.keys(incorrectMap)) {
    qidsMap[qid] = true;
  }
  for (const qid of Object.keys(streak3Map)) {
    qidsMap[qid] = true;
  }
  for (const qid of Object.keys(streakLenMap)) {
    qidsMap[qid] = true;
  }

  var dataQ: any = {};
  for (const qid of Object.keys(qidsMap)) {
    var cRaw = correctMap[qid];
    var iRaw = incorrectMap[qid];
    var s3Raw = streak3Map[qid];
    var sLenRaw = streakLenMap[qid];

    var cTotal =
      typeof cRaw === "number" && Number.isFinite(cRaw) && cRaw >= 0 ? cRaw : 0;
    var iTotal =
      typeof iRaw === "number" && Number.isFinite(iRaw) && iRaw >= 0 ? iRaw : 0;
    var s3Total =
      typeof s3Raw === "number" && Number.isFinite(s3Raw) && s3Raw >= 0 ? s3Raw : null;
    var sLen =
      typeof sLenRaw === "number" && Number.isFinite(sLenRaw) && sLenRaw >= 0
        ? sLenRaw
        : null;

    dataQ[qid] = {
      correct: { total: cTotal },
      incorrect: { total: iTotal },
      streak3: { total: s3Total },
      streakLen: sLen
    };
  }

  if (!out.data || typeof out.data !== "object") {
    out.data = {};
  }
  out.data.q = dataQ;

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