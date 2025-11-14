// functions/api/deep-dive.js
export async function onRequest(context) {
  try {
    // ==== 1) 環境変数（安全） ====
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not set" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // ==== 2) クライアントからの入力 ====
    const reqBody = await context.request.json().catch(() => null);
    if (!reqBody || typeof reqBody.prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid request: prompt required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const prompt = reqBody.prompt.trim();
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is empty" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // ==== 3) Gemini Flash 2.5 (1.5-flash-002) を呼ぶ ====
    const geminiURL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent";

    const geminiRes = await fetch(geminiURL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey  // ← ブラウザには絶対渡らない
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
      return new Response(
        JSON.stringify({
          error: "Gemini API error",
          status: geminiRes.status
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const json = await geminiRes.json().catch(() => null);
    if (!json) {
      return new Response(
        JSON.stringify({ error: "Invalid response from Gemini" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // ==== 4) AIテキストの抽出 ====
    const output =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // ==== 5) 結果のみ返す（安全） ====
    return new Response(JSON.stringify({ output }), {
      headers: { "content-type": "application/json" }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error", details: String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
