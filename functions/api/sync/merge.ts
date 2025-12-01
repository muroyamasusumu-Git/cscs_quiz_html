// merge.ts
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // (0) 受信 delta 全体をログ
  let delta: any;
  try {
    delta = await request.json();
  } catch (e) {
    console.error("[SYNC/merge] ★delta JSON parse 失敗:", e);
    return new Response("bad json", { status: 400 });
  }

  try {
    console.log("====================================================");
    console.log("[SYNC/merge] === onRequestPost START ===");
    console.log("[SYNC/merge] user :", user);
    console.log("[SYNC/merge] key  :", key);
    console.log("[SYNC/merge] (1) delta 全体:", JSON.stringify(delta));
    console.log("[SYNC/merge] (1-1) delta.streak3TodayDelta:", JSON.stringify((delta as any).streak3TodayDelta ?? null));
  } catch (_e) {}

  // (server) 現在のサーバー状態を KV から取得
  let server: any =
    (await env.SYNC.get(key, "json")) || {
      correct: {},
      incorrect: {},
      streak3: {},
      streakLen: {},
      consistency_status: {},
      // ここでは初期値として streak3Today を用意する（「無からの初回保存」を許可）
      streak3Today: { day: "", unique_count: 0, qids: [] },
      updatedAt: 0
    };

  if (!server.correct) server.correct = {};
  if (!server.incorrect) server.incorrect = {};
  if (!server.streak3) server.streak3 = {};
  if (!server.streakLen) server.streakLen = {};
  if (!server.consistency_status) server.consistency_status = {};
  if (!(server as any).streak3Today) {
    (server as any).streak3Today = { day: "", unique_count: 0, qids: [] };
  }

  // (1) delta.streak3TodayDelta が送られてきたか
  const streak3TodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).streak3TodayDelta
      : undefined;

  try {
    const hasDelta =
      streak3TodayDelta && typeof streak3TodayDelta === "object" ? true : false;

    let dayDebug = "";
    let qidsRawDebug: unknown = undefined;
    let qidsIsArray = false;
    let qidsLen = 0;

    if (hasDelta) {
      dayDebug =
        typeof (streak3TodayDelta as any).day === "string"
          ? (streak3TodayDelta as any).day
          : "";
      qidsRawDebug = (streak3TodayDelta as any).qids;
      qidsIsArray = Array.isArray(qidsRawDebug);
      qidsLen = qidsIsArray ? (qidsRawDebug as any[]).length : 0;
    }

    console.log(
      "[SYNC/merge] (1) delta.streak3TodayDelta 受信:",
      JSON.stringify(streak3TodayDelta ?? null)
    );
    console.log("[SYNC/merge] (1-2) streak3TodayDelta 詳細:", {
      hasDelta,
      day: dayDebug,
      qidsIsArray,
      qidsLength: qidsLen
    });
  } catch (_e) {}

  // (2) BEFORE: merge 前の server.streak3Today の状態をログ
  try {
    const beforeSt3 = (server as any).streak3Today || null;
    console.log("[SYNC/merge] (2) BEFORE server.streak3Today:", JSON.stringify(beforeSt3));
  } catch (_e) {
    console.warn("[SYNC/merge] ★logging error (BEFORE streak3Today)");
  }

  // ---- 通常の correct / incorrect / streak3 / streakLen / consistency_status マージ ----

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

  const consistencyStatusDelta = (delta as any).consistencyStatusDelta || {};
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

  // ---- streak3Today のマージ（フル上書き） ----
  if (streak3TodayDelta && typeof streak3TodayDelta === "object") {
    console.log("[SYNC/merge] (2-1) streak3Today: delta あり（更新実施）");

    const dayValue = (streak3TodayDelta as any).day;
    const qidsRaw = (streak3TodayDelta as any).qids;

    const day =
      typeof dayValue === "string"
        ? dayValue
        : "";

    const qids = Array.isArray(qidsRaw) ? qidsRaw : [];

    try {
      console.log("[SYNC/merge] (2-1-1) streak3TodayDelta マージ前チェック:", {
        day,
        qidsIsArray: Array.isArray(qidsRaw),
        qidsLength: qids.length
      });
    } catch (_e) {}

    // day が空なら「無効」とみなして何もしない
    if (day) {
      (server as any).streak3Today = {
        day,
        unique_count: qids.length,
        qids
      };
      try {
        console.log("[SYNC/merge] (2-1-2) streak3Today マージ後設定:", {
          day: (server as any).streak3Today.day,
          unique_count: (server as any).streak3Today.unique_count,
          qidsLength: Array.isArray((server as any).streak3Today.qids)
            ? (server as any).streak3Today.qids.length
            : -1
        });
      } catch (_e2) {}
    } else {
      console.warn("[SYNC/merge] (2-2) streak3TodayDelta.day が空のためスキップ");
    }
  } else {
    console.log("[SYNC/merge] (2-1) streak3Today: delta なし（更新スキップ）");
  }

  // (2-2) AFTER: マージ後の server.streak3Today をログ
  try {
    const afterSt3 = (server as any).streak3Today || null;
    console.log("[SYNC/merge] (2-3) AFTER server.streak3Today:", JSON.stringify(afterSt3));
  } catch (_e) {
    console.warn("[SYNC/merge] ★logging error (AFTER streak3Today)");
  }

  // exam_date_iso (YYYY-MM-DD) が送られてきた場合だけ exam_date を更新
  const examDateIsoRaw =
    typeof (delta as any).exam_date_iso === "string"
      ? (delta as any).exam_date_iso
      : null;

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
        (server as any).exam_date = examDateIsoRaw;
      }
    }
  }

  server.updatedAt = Date.now();

  // (3) KV 保存＋ (4) 保存直後の dump
  try {
    const jsonStr = JSON.stringify(server);

    await env.SYNC.put(key, jsonStr);
    console.log("[SYNC/merge] (3) ★KV保存成功:", {
      key,
      streak3Today: (server as any).streak3Today
    });

    try {
      const s3 = (server as any).streak3Today || null;
      const qlen =
        s3 && Array.isArray(s3.qids) ? (s3.qids as any[]).length : -1;
      console.log("[SYNC/merge] (3-1) streak3Today 整合性チェック:", {
        day: s3 ? s3.day : null,
        unique_count: s3 ? s3.unique_count : null,
        qidsLength: qlen,
        isConsistent:
          s3 && Array.isArray(s3.qids)
            ? s3.unique_count === qlen
            : false
      });
    } catch (_e2) {
      console.warn("[SYNC/merge] (3-1 err) streak3Today 整合性ログ失敗");
    }

    // (4) 保存直後に KV から再取得 → parsed.streak3Today を確認
    try {
      const raw = await env.SYNC.get(key, "text");
      console.log("[SYNC/merge] (4-1) ★KV直後ダンプ(raw):", raw);

      try {
        const parsed = raw ? JSON.parse(raw) : null;
        const s3t = parsed ? (parsed as any).streak3Today : null;
        console.log("[SYNC/merge] (4-2) ★KV直後ダンプ(parsed.streak3Today):", s3t);
      } catch (e2) {
        console.warn("[SYNC/merge] (4-err) ★KV直後ダンプ(JSON.parse失敗)", e2);
      }
    } catch (e1) {
      console.warn("[SYNC/merge] (4-err) ★KV直後ダンプ取得失敗", e1);
    }
  } catch (e) {
    console.error("[SYNC/merge] (3-err) ★KV保存失敗", e);
    console.log("[SYNC/merge] === onRequestPost END (KV put failed) ===");
    console.log("====================================================");
    return new Response("KV put failed", {
      status: 500,
      headers: { "content-type": "text/plain" }
    });
  }

  try {
    console.log("[SYNC/merge] === onRequestPost END (OK) ===");
    console.log("====================================================");
  } catch (_e) {}

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