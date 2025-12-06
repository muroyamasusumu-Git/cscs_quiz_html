// functions/api/consistency-check.js
// NSCA-CSCS 一問用「整合性チェック」API（Cloudflare Pages Functions）
// フロントからは /api/consistency-check へ POST される前提
// ボディ: { model: "models/...", prompt: "...", strict: true/false }
// 戻り値: Gemini が生成した JSON オブジェクトだけをそのまま返す

const ALLOWED_ORIGINS = [
  "http://localhost:8789",
  "http://127.0.0.1:8789",
  "https://cscs-quiz-html.pages.dev"
];

const DEFAULT_MODEL = "models/gemini-2.5-flash";

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

  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
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

async function callGeminiConsistencyCheck(env, prompt, modelName) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment.");
  }

  const model = modelName && typeof modelName === "string" ? modelName : DEFAULT_MODEL;
  const url = "https://generativelanguage.googleapis.com/v1beta/" + model + ":generateContent";

  const reqBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  const maxRetries = 2;
  const baseDelayMs = 400;
  let res = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch(url + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const text = await res.text();

      // 503（モデル過負荷）のときだけ、少し待ってから再試行
      if (res.status === 503 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(function(resolve) {
          setTimeout(resolve, delay);
        });
        continue;
      }

      // 503以外のHTTPエラーはそのままErrorとして上位に投げる。
      // ここでstatusとresponseBodyをErrorオブジェクトに持たせておくことで、
      // 呼び出し元（onRequestPost）がHTTP 429などのステータスを判別できるようにする。
      const err = new Error("Gemini API error: HTTP " + res.status + " " + text);
      err.status = res.status;
      err.responseBody = text;
      throw err;
    }

    // res.ok のときはループを抜ける
    break;
  }

  if (!res || !res.ok) {
    throw new Error("Gemini API error: failed after retries.");
  }

  const data = await res.json();

  if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error("Gemini API response has no candidates.");
  }

  const first = data.candidates[0];
  if (!first || !first.content || !Array.isArray(first.content.parts) || first.content.parts.length === 0) {
    throw new Error("Gemini API response has no content parts.");
  }

  const part = first.content.parts[0];
  const text = typeof part.text === "string" ? part.text : "";

  if (!text) {
    throw new Error("Gemini API response text is empty.");
  }

  let json;
  let textNormalized = text;
  try {
    if (typeof textNormalized === "string") {
      let s = textNormalized.trim();

      if (s.startsWith("```")) {
        const lines = s.split("\n");

        if (lines.length > 0 && lines[0].trim().startsWith("```")) {
          lines.shift();
        }

        while (lines.length > 0 && lines[0].trim() === "") {
          lines.shift();
        }

        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
          lines.pop();
        }

        if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
          lines.pop();
        }

        s = lines.join("\n").trim();
      }

      const firstBraceIndex = s.indexOf("{");
      const lastBraceIndex = s.lastIndexOf("}");

      if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
        s = s.slice(firstBraceIndex, lastBraceIndex + 1);
      }

      textNormalized = s;
    }

    json = JSON.parse(textNormalized);
  } catch (e) {
    json = {
      overall: "ng",
      judgement_mark: "×",
      reason_summary: "Gemini 出力が有効な JSON ではありませんでした。raw_text と parse_error を確認してください。",
      answer_correctness: {
        status: "wrong",
        mode: "uncertain",
        mode_reason: "Gemini 出力の JSON パースエラーのため詳細評価は実施できませんでした。",
        issues: [
          "Gemini 出力が JSON 形式になっていないため、answer_correctness の詳細判定はスキップしました。"
        ],
        suggested_correct_choice_index: 0
      },
      explanation_quality: {
        status: "problematic",
        issues: [
          "Gemini 出力が JSON 形式になっていないため、解説品質の詳細判定はスキップしました。"
        ]
      },
      problem_statement_nsac_validity: {
        status: "ambiguous",
        issues: [
          "Gemini 出力が JSON 形式になっていないため、問題文の NSCA 的妥当性の詳細判定はスキップしました。"
        ],
        suggested_rewrite: ""
      },
      auto_fixable: false,
      suggested_fixed_item: {
        question: "",
        choices: [
          "",
          "",
          "",
          ""
        ],
        correct_index: 0,
        explanation: "",
        deep_dive_tags: []
      },
      raw_text: text,
      parse_error: String(e && e.message ? e.message : e)
    };
    return json;
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    json = {
      overall: "ng",
      judgement_mark: "×",
      reason_summary: "Gemini 出力のルートがオブジェクトではありませんでした。raw_text を確認してください。",
      answer_correctness: {
        status: "wrong",
        mode: "uncertain",
        mode_reason: "Gemini 出力の JSON 形式が期待と異なるため詳細評価は実施できませんでした。",
        issues: [
          "Gemini 出力のルートがオブジェクトではなかったため、answer_correctness の詳細判定はスキップしました。"
        ],
        suggested_correct_choice_index: 0
      },
      explanation_quality: {
        status: "problematic",
        issues: [
          "Gemini 出力の JSON 形式が期待と異なるため、解説品質の詳細判定はスキップしました。"
        ]
      },
      problem_statement_nsac_validity: {
        status: "ambiguous",
        issues: [
          "Gemini 出力の JSON 形式が期待と異なるため、問題文の NSCA 的妥当性の詳細判定はスキップしました。"
        ],
        suggested_rewrite: ""
      },
      auto_fixable: false,
      suggested_fixed_item: {
        question: "",
        choices: [
          "",
          "",
          "",
          ""
        ],
        correct_index: 0,
        explanation: "",
        deep_dive_tags: []
      },
      raw_text: text,
      parse_error: "root is not plain object"
    };
  }

  return json;
}

// ===== Cloudflare Pages Functions エクスポート =====

// CORS preflight
export async function onRequestOptions(context) {
  const { request } = context;
  const headers = buildCorsHeaders(request);
  return new Response(null, { status: 204, headers: headers });
}

// POST /api/consistency-check
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
    return jsonResponse(request, 400, { error: "Invalid JSON body." });
  }

  const prompt = body && typeof body.prompt === "string" ? body.prompt : "";
  const modelName = body && typeof body.model === "string" ? body.model : DEFAULT_MODEL;

  if (!prompt) {
    return jsonResponse(request, 400, { error: "Missing 'prompt' in request body." });
  }

  try {
    const json = await callGeminiConsistencyCheck(env, prompt, modelName);
    return jsonResponse(request, 200, json);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);

    // Gemini側がHTTP 429（レート制限など）を返した場合は、
    // /api/consistency-check もHTTP 429でそのまま返す。
    // これにより、フロント側は response.status === 429 をトリガーに
    // 自動検証モードを安全側（OFF）に倒すことができる。
    const statusFromError = typeof e === "object" && e !== null && typeof e.status === "number"
      ? e.status
      : null;

    if (statusFromError === 429 || msg.indexOf("HTTP 429") !== -1) {
      return jsonResponse(request, 429, { error: msg });
    }

    // それ以外のエラー（400系/500系）は従来どおりHTTP 500でまとめて返す。
    // フォールバック処理は行わず、フロント側でメッセージを見て対処してもらう方針。
    return jsonResponse(request, 500, { error: msg });
  }
}

// fallback（POST 以外で呼ばれたとき用・保険）
export async function onRequest(context) {
  const { request } = context;
  const headers = buildCorsHeaders(request);
  return new Response("Method Not Allowed", { status: 405, headers: headers });
}