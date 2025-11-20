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

  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
  const { request } = context;
  const url = new URL(request.url);
  const qid = url.searchParams.get("qid") || "";

  if (!qid) {
    return jsonResponse(request, 400, {
      ok: false,
      error: "Missing qid parameter.",
      items: []
    });
  }

  // いまは永続ストレージ未実装のため、常に空の items を返すだけ
  // （将来 KV / D1 / R2 に保存するようになったら、ここで qid から読み出す）
  return jsonResponse(request, 200, {
    ok: true,
    items: []
  });
}

// POST /api/sync-consistency
export async function onRequestPost(context) {
  const { request /*, env*/ } = context;
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

    // status オブジェクト経由で受け取る形にそろえる
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

  // ★ ここで本来は KV / D1 / R2 などに保存する
  // 　いまはデバッグ用にそのまま echo するだけ
  // 　（env バインドが決まったらここを書き換える）

  return jsonResponse(request, 200, {
    ok: true,
    stored_count: cleaned.length,
    items: cleaned
  });
}

// fallback（POST 以外で呼ばれたとき用）
export async function onRequest(context) {
  const { request } = context;
  const headers = buildCorsHeaders(request);
  return new Response("Method Not Allowed", { status: 405, headers: headers });
}