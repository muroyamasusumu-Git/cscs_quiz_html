// merge.ts
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  const delta = await request.json(); // { correctDelta:{qid:n}, incorrectDelta:{qid:n}, streak3Delta:{qid:n}, streakLenDelta:{qid:n} }
  const server =
    (await env.SYNC.get(key, "json")) ||
    { correct: {}, incorrect: {}, streak3: {}, streakLen: {}, consistency_status: {}, streak3Today: { day: "", unique_count: 0 }, updatedAt: 0 };

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
  if (!(server as any).streak3Today) {
    (server as any).streak3Today = { day: "", unique_count: 0 };
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

  // ★ debug: merge 前の streak3Today の状態をログ出力
  try {
    console.log(
      "[SYNC/merge] BEFORE streak3Today:",
      JSON.stringify((server as any).streak3Today)
    );
    console.log(
      "[SYNC/merge] delta.streak3Today:",
      JSON.stringify((delta as any).streak3Today)
    );
  } catch (_e) {}

  const streak3TodayDelta = delta.streak3Today;
  if (streak3TodayDelta && typeof streak3TodayDelta === "object") {
    // ★ delta あり（フロントから streak3Today が送られてきた）
    console.log("[SYNC/merge] ★streak3Today: delta あり（更新実施）");

    (server as any).streak3Today = {
      day: typeof streak3TodayDelta.day === "string" ? streak3TodayDelta.day : "",
      unique_count:
        typeof streak3TodayDelta.unique_count === "number" &&
        Number.isFinite(streak3TodayDelta.unique_count) &&
        streak3TodayDelta.unique_count >= 0
          ? streak3TodayDelta.unique_count
          : 0,
      qids: Array.isArray((streak3TodayDelta as any).qids)
        ? (streak3TodayDelta as any).qids
        : []
    };
  } else {
    // ★ delta なし（今回は streak3Today は更新されない）
    try {
      console.log("[SYNC/merge] ★streak3Today: delta なし（更新スキップ）");
    } catch (_e) {}
  }

  // ★ debug: merge 後の streak3Today の状態をログ出力
  try {
    console.log(
      "[SYNC/merge] AFTER  streak3Today:",
      JSON.stringify((server as any).streak3Today)
    );
  } catch (_e) {}

  // exam_date_iso (YYYY-MM-DD) が送られてきた場合だけ exam_date を更新
  const examDateIsoRaw = typeof delta.exam_date_iso === "string" ? delta.exam_date_iso : null;
  if (examDateIsoRaw) {
    const m = examDateIsoRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d);
      if (
        !Number.isNaN(dt.getTime()) &&
        dt.getFullYear() === y &&
        dt.getMonth() === mo &&
        dt.getDate() === d
      ) {
        // バリデーションを通った YYYY-MM-DD だけを保存
        (server as any).exam_date = examDateIsoRaw;
      }
    }
  }

  server.updatedAt = Date.now();

  // ★ KV 保存の成否＋「実際に入った JSON」を必ずログに出す
  try {
    const jsonStr = JSON.stringify(server);

    await env.SYNC.put(key, jsonStr);
    console.log("[SYNC/merge] ★KV保存成功", {
      key,
      streak3Today: (server as any).streak3Today
    });

    // ★ 保存直後に KV から生の文字列を再取得してダンプ
    try {
      const raw = await env.SYNC.get(key, "text");
      console.log("[SYNC/merge] ★KV直後ダンプ(raw):", raw);

      try {
        const parsed = raw ? JSON.parse(raw) : null;
        console.log("[SYNC/merge] ★KV直後ダンプ(parsed.streak3Today):", parsed ? (parsed as any).streak3Today : null);
      } catch (e2) {
        console.warn("[SYNC/merge] ★KV直後ダンプ(JSON.parse失敗)", e2);
      }
    } catch (e1) {
      console.warn("[SYNC/merge] ★KV直後ダンプ取得失敗", e1);
    }
  } catch (e) {
    console.error("[SYNC/merge] ★KV保存失敗", e);
    return new Response("KV put failed", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

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