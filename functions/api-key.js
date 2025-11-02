// functions/api-key.js
export async function onRequest(context) {
  // Pages の環境変数から取得
  const key = context.env?.GEMINI_API_KEY || "";

  // 未設定なら 404 返却
  if (!key) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set" }), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  }

  // JSON形式で返す（テキストではなく）
  return new Response(JSON.stringify({ key }), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}