// functions/api/deep-dive.js
export async function onRequest(context) {
  try {
    // ============================================================
    // 1) Gemini API Key（Cloudflare Pages / Worker の環境変数）
    // ============================================================
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError("GEMINI_API_KEY is not set", 500);
    }

    // ============================================================
    // 2) クライアントからの入力
    // ============================================================
    const reqBody = await context.request.json().catch(() => null);
    if (!reqBody || typeof reqBody.prompt !== "string") {
      return jsonError("Invalid request: prompt required", 400);
    }

    const prompt = reqBody.prompt.trim();
    if (!prompt) {
      return jsonError("Prompt is empty", 400);
    }

    // ============================================================
    // 3) Gemini Flash 2.5 を呼び出し
    // ============================================================
    const modelURL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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
      headers: corsHeaders()
    });

  } catch (err) {
    return jsonError("Server error: " + String(err), 500);
  }
}

// ============================================================
// ヘルパー：エラー整形
// ============================================================
function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: corsHeaders()
  });
}

// ============================================================
// ヘルパー：CORS
// ============================================================
function corsHeaders() {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
