// functions/api/consistency-check.js

const ALLOWED_ORIGINS = [
  "https://cscs-quiz-html.pages.dev",
  "http://localhost:8789"
];

export async function onRequest(context) {
  const request = context.request;
  let origin = request.headers.get("Origin") || "";
  const isCorsRequest = origin !== "";
  const isAllowedOrigin =
    !isCorsRequest || ALLOWED_ORIGINS.includes(origin);

  // ===== CORS プリフライト（OPTIONS） =====
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

  // ===== メソッド制限 =====
  if (request.method !== "POST") {
    return jsonError("Method Not Allowed", 405, origin);
  }

  // CORS 本体のオリジンチェック
  if (isCorsRequest && !isAllowedOrigin) {
    return jsonError("Origin not allowed", 403, origin);
  }

  try {
    // ===== 1) 環境変数から Gemini API Key を取得 =====
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError("GEMINI_API_KEY is not set", 500, origin);
    }

    // ===== 2) フロントからの入力を取得 =====
    const reqBody = await request.json().catch(() => null);
    if (
      !reqBody ||
      typeof reqBody.prompt !== "string" ||
      !reqBody.prompt.trim()
    ) {
      return jsonError("Invalid request: prompt required", 400, origin);
    }

    const prompt = reqBody.prompt.trim();
    const modelName =
      typeof reqBody.model === "string" && reqBody.model.trim()
        ? reqBody.model.trim()
        : "models/gemini-2.5-flash";

    const strictFlag =
      typeof reqBody.strict === "boolean" ? reqBody.strict : false;

    // ===== 3) Gemini API 呼び出し =====
    const modelURL =
      "https://generativelanguage.googleapis.com/v1beta/" +
      encodeURIComponent(modelName) +
      ":generateContent";

    const geminiRes = await fetch(modelURL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        // strictFlag は今のところプロンプトの中で使っているので、
        // API パラメータには特に渡していない
      })
    });

    if (!geminiRes.ok) {
      return jsonError(
        "Gemini API error (status " + String(geminiRes.status) + ")",
        500,
        origin
      );
    }

    const geminiJson = await geminiRes.json().catch(() => null);
    if (!geminiJson) {
      return jsonError("Invalid JSON from Gemini", 500, origin);
    }

    // ===== 4) Gemini の応答から「JSON文字列」を取り出す =====
    // プロンプトで「JSONオブジェクトのみ出力して」と指示しているので、
    // parts[].text に JSON がそのまま入っている想定。
    let llmText = "";
    try {
      const cand = geminiJson && geminiJson.candidates
        ? geminiJson.candidates[0]
        : null;
      const parts = cand && cand.content && Array.isArray(cand.content.parts)
        ? cand.content.parts
        : [];

      llmText = parts
        .map(function(p) {
          if (p && typeof p.text === "string") {
            return p.text;
          }
          return "";
        })
        .join("")
        .trim();
    } catch (e) {
      llmText = "";
    }

    if (!llmText) {
      return jsonError("Empty response from Gemini", 500, origin);
    }

    // ===== 5) その文字列を JSON.parse して検証し、素の JSON として返す =====
    let resultObj;
    try {
      resultObj = JSON.parse(llmText);
    } catch (e) {
      // LLM が JSON 以外を混ぜて返した場合に備えてエラー扱い
      return jsonError(
        "Gemini output is not valid JSON: " + String(e),
        500,
        origin
      );
    }

    // フロント側(consistency_check_debug.js)は
    // response.text() → JSON.parse(text) を期待しているので、
    // ここでは JSON をそのまま返す
    return new Response(JSON.stringify(resultObj), {
      status: 200,
      headers: corsHeaders(origin)
    });
  } catch (err) {
    return jsonError("Server error: " + String(err), 500, origin);
  }
}

// ===== ヘルパー =====

function jsonError(msg, status, origin) {
  return new Response(JSON.stringify({ error: msg }), {
    status: status || 500,
    headers: corsHeaders(origin)
  });
}

function corsHeaders(origin) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}