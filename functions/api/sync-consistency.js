// functions/api/sync-consistency.js
// NSCA-CSCS「整合性チェックステータス」SYNC 用 API（Cloudflare Pages Functions）
// フロントからは /api/sync-consistency へ POST される前提
// ボディ: 1件または配列
//   {
//     "kind": "consistency_status",
//     "qid": "2025年9月26日-010",
//     "status_mark": "◎",
//     "status_label": "変更必要なし",
//     "classification_code": "S",
//     "classification_detail": "正解",
//     "saved_at": "2025-11-20T09:26:43.413Z"
//   }

const ALLOWED_ORIGINS = [
  "http://localhost:8789",
  "http://127.0.0.1:8789",
  "https://cscs-quiz-html.pages.dev"
];

// ===== CORS ヘルパー =====

function getOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  return origin;
}

function buildCorsHeaders(request) {
  const origin = getOrigin(request);
  const headers = new Headers();

  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  return headers;
}

function jsonResponse(request, status, data) {
  const headers = buildCorsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status: status, headers: headers });
}

// ===== メイン処理 =====

// CORS preflight
export async function onRequestOptions(context) {
  const { request } = context;
  const headers = buildCorsHeaders(request);
  return new Response(null, { status: 204, headers: headers });
}

// GET /api/sync-consistency?qid=...
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const qid = url.searchParams.get("qid") || "";

  if (!qid) {
    return jsonResponse(request, 400, {
      ok: false,
      error: "Missing qid parameter.",
      items: []
    });
  }

  const key = "consistency_status:" + qid;
  let stored = null;

  try {
    if (env && env.SYNC && typeof env.SYNC.get === "function") {
      const raw = await env.SYNC.get(key);
      if (raw) {
        try {
          stored = JSON.parse(raw);
        } catch (parseError) {
          console.error("[sync-consistency] failed to parse KV JSON:", parseError);
          stored = null;
        }
      }
    }
  } catch (e) {
    console.error("[sync-consistency] KV get error:", e);
  }

  if (!stored) {
    return jsonResponse(request, 200, {
      ok: true,
      items: []
    });
  }

  return jsonResponse(request, 200, {
    ok: true,
    items: [stored]
  });
}

// POST /api/sync-consistency
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = buildCorsHeaders(request);

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse(request, 400, { ok: false, error: "Invalid JSON body." });
  }

  // 1件でも配列でも受け取れるように正規化
  const items = Array.isArray(body) ? body : [body];

  const cleaned = items.map(function(item) {
    const kind = String(item && item.kind ? item.kind : "");
    const qid = String(item && item.qid ? item.qid : "");

    const statusObj = item && item.status ? item.status : {};
    const statusMark = String(statusObj && statusObj.status_mark ? statusObj.status_mark : "");
    const statusLabel = String(statusObj && statusObj.status_label ? statusObj.status_label : "");
    const classificationCode = String(statusObj && statusObj.classification_code ? statusObj.classification_code : "");
    const classificationDetail = String(statusObj && statusObj.classification_detail ? statusObj.classification_detail : "");
    const savedAt = String(statusObj && statusObj.saved_at ? statusObj.saved_at : "");

    return {
      kind: kind,
      qid: qid,
      status_mark: statusMark,
      status_label: statusLabel,
      classification_code: classificationCode,
      classification_detail: classificationDetail,
      saved_at: savedAt
    };
  });

  if (env && env.SYNC && typeof env.SYNC.put === "function") {
    for (let i = 0; i < cleaned.length; i++) {
      const item = cleaned[i];
      const qid = item && item.qid ? item.qid : "";
      if (!qid) {
        continue;
      }
      const key = "consistency_status:" + qid;
      try {
        await env.SYNC.put(key, JSON.stringify(item));
      } catch (e) {
        console.error("[sync-consistency] KV put error:", e);
      }
    }
  }

  return jsonResponse(request, 200, {
    ok: true,
    stored_count: cleaned.length,
    items: cleaned
  });
}

// DELETE /api/sync-consistency?qid=...
export async function onRequestDelete(context) {
  const { request, env } = context;
  const corsHeaders = buildCorsHeaders(request);
  const url = new URL(request.url);
  const qid = url.searchParams.get("qid") || "";

  if (request.method !== "DELETE") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  if (!qid) {
    return jsonResponse(request, 400, {
      ok: false,
      error: "Missing qid parameter.",
      deleted: false
    });
  }

  const key = "consistency_status:" + qid;
  let deleteError = null;

  if (env && env.SYNC && typeof env.SYNC.delete === "function") {
    try {
      await env.SYNC.delete(key);
    } catch (e) {
      console.error("[sync-consistency] KV delete error:", e);
      deleteError = e;
    }
  }

  if (deleteError) {
    return jsonResponse(request, 500, {
      ok: false,
      error: "KV delete failed.",
      deleted: false
    });
  }

  return jsonResponse(request, 200, {
    ok: true,
    deleted: true,
    qid: qid
  });
}

// fallback（POST 以外で呼ばれたとき用）
export async function onRequest(context) {
  const { request } = context;
  const headers = buildCorsHeaders(request);
  return new Response("Method Not Allowed", { status: 405, headers: headers });
}