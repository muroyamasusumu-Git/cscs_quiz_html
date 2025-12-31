// functions/api/deep-dive.js
const ALLOWED_ORIGINS = [
  "https://cscs-quiz-html.pages.dev",
  "http://localhost:8789"
];

export async function onRequest(context) {
  try {
    const request = context.request;
    let origin = request.headers.get("Origin") || "";
    const isCorsRequest = origin !== "";
    const isAllowedOrigin =
      !isCorsRequest || ALLOWED_ORIGINS.includes(origin);

    // CORSプリフライト（OPTIONS）の処理
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin) {
        return new Response(null, {
          status: 403,
          headers: corsHeaders(origin)
        });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    // 本体リクエストのオリジン制限（ブラウザからのCORSリクエストのみ）
    if (isCorsRequest && !isAllowedOrigin) {
      return jsonError("Origin not allowed", 403, origin);
    }

    // ============================================================
    // 1) Gemini API Key（Cloudflare Pages / Worker の環境変数）
    // ============================================================
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError("GEMINI_API_KEY is not set", 500, origin);
    }

    // ============================================================
    // 2) クライアントからの入力
    // ============================================================
    const reqBody = await request.json().catch(() => null);
    if (!reqBody || typeof reqBody.prompt !== "string") {
      return jsonError("Invalid request: prompt required", 400, origin);
    }

    const prompt = reqBody.prompt.trim();
    if (!prompt) {
      return jsonError("Prompt is empty", 400, origin);
    }

    // ============================================================
    // 3) Gemini Flash 2.5 を呼び出し
    // ============================================================
    const modelURL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    const geminiRes = await fetch(modelURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    if (!geminiRes.ok) {
      return jsonError(
        `Gemini API error (status ${geminiRes.status})`,
        500
      );
    }

    const json = await geminiRes.json().catch(() => null);
    if (!json) {
      return jsonError("Invalid JSON from Gemini", 500);
    }

    // ============================================================
    // 4) レスポンス抽出（構造変化に強い）
    // ============================================================
    let output = "";

    try {
      const cand = json?.candidates?.[0];
      const parts = cand?.content?.parts;

      if (Array.isArray(parts)) {
        output = parts
          .map((p) => (typeof p.text === "string" ? p.text : ""))
          .join("")
          .trim();
      }
    } catch (_) {
      // fallback
      output = "";
    }

    if (!output) output = "";

    // ============================================================
    // 5) 結果送信（フロント側は output のみ期待）
    // ============================================================
    return new Response(JSON.stringify({ output }), {
      status: 200,
      headers: corsHeaders(origin)
    });

  } catch (err) {
    return jsonError("Server error: " + String(err), 500, origin);
  }
}

// ============================================================
// ヘルパー：エラー整形
// ============================================================
function jsonError(msg, status = 500, origin = "") {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: corsHeaders(origin)
  });
}

// ============================================================
// ヘルパー：CORS
// ============================================================
function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "Content-Type"
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}
