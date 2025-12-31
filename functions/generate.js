// functions/generate.js
export async function onRequestPost({ request, env }) {
  try {
    const { model = "models/gemini-2.5-flash", prompt } = await request.json();

    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "MISSING_SERVER_KEY" }), {
        status: 500, headers: cors(),
      });
    }
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "INVALID_PROMPT" }), {
        status: 400, headers: cors(),
      });
    }

    const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };
    const url  = `https://generativelanguage.googleapis.com/v1/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...cors(), "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: cors(),
    });
  }
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type",
  };
}