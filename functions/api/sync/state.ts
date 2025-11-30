// state.ts
export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // ★★★ ログ強制モード: 開始ログ ★★★
  try {
    console.log("[SYNC/state] === onRequestGet START ===");
    console.log("[SYNC/state] user key:", key);
  } catch (_e) {}

  // データ読み込み（存在しなければ null）
  let data: any = null;
  try {
    data = await env.SYNC.get(key, "json");
  } catch (e) {
    // KV 読み出しで例外が起きても必ずログを出す
    try {
      console.error("[SYNC/state] ★KV 読み出し失敗:", e);
    } catch (_e2) {}
  }

  // ★★★ ここから読み出しの状態分類ログ ★★★
  try {
    if (data == null) {
      console.warn("[SYNC/state] ★データなし（KVに何も保存されていない可能性）");
    } else {
      console.log("[SYNC/state] RAW data from KV:", JSON.stringify(data));

      if (typeof data.updatedAt === "number") {
        const ageMs = Date.now() - data.updatedAt;

        if (ageMs < 1000) {
          console.log("[SYNC/state] ★最新データ（保存後すぐ反映） age(ms):", ageMs);
        } else if (ageMs < 5000) {
          console.log("[SYNC/state] ★比較的新しいデータ age(ms):", ageMs);
        } else {
          console.warn("[SYNC/state] ★古いデータを返しています（KV 遅延の可能性大） age(ms):", ageMs);
        }
      } else {
        console.warn("[SYNC/state] ★updatedAt が存在しないデータ（不整合の可能性）");
      }
    }
  } catch (_e) {}
  // ★★★ 状態分類ログ ここまで ★★★

  // streak3 / consistency_status / streak3Today を必ず返却するため empty に項目を用意
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    streakLen: {},
    consistency_status: {},
    streak3Today: { day: "", unique_count: 0 },
    updatedAt: 0
  };

  // data が存在しても欠けている項目があれば補完する
  let out: any;
  if (data) {
    out = data;
    try {
      console.log("[SYNC/state] ★KVヒット: 既存データを使用");
    } catch (_e) {}
  } else {
    out = empty;
    try {
      console.log("[SYNC/state] ★KVミス: empty テンプレートを使用");
    } catch (_e) {}
  }

  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.consistency_status) out.consistency_status = {};

  // ★ streak3Today の正規化とログ
  try {
    if (!out.streak3Today || typeof out.streak3Today !== "object") {
      console.warn("[SYNC/state] ★streak3Today が存在しないか不正な形式のため、デフォルトを適用します。");
      out.streak3Today = { day: "", unique_count: 0 };
    }

    // day は string 以外は空文字に落とす
    if (typeof out.streak3Today.day !== "string") {
      console.warn("[SYNC/state] ★streak3Today.day が string ではないため、空文字に補正します。 value:", out.streak3Today.day);
      out.streak3Today.day = "";
    }

    // unique_count は 0 以上の number 以外は 0 にする
    if (
      typeof out.streak3Today.unique_count !== "number" ||
      !Number.isFinite(out.streak3Today.unique_count) ||
      out.streak3Today.unique_count < 0
    ) {
      console.warn(
        "[SYNC/state] ★streak3Today.unique_count が不正なため、0 に補正します。 value:",
        out.streak3Today.unique_count
      );
      out.streak3Today.unique_count = 0;
    }
  } catch (_e) {
    // ここで例外が出ても最後に out.streak3Today が undefined にならないように保険
    out.streak3Today = { day: "", unique_count: 0 };
  }

  // ★ debug: クライアントに返す値を “要約して” ログ出力
  try {
    const updatedAt = typeof out.updatedAt === "number" ? out.updatedAt : 0;
    const ageMs = updatedAt ? (Date.now() - updatedAt) : null;

    console.log("[SYNC/state] ★state RESPONSE streak3Today:", {
      day: out.streak3Today.day,
      unique_count: out.streak3Today.unique_count
    });

    console.log("[SYNC/state] ★state 応答オブジェクト概要", {
      hasCorrect: !!out.correct,
      hasIncorrect: !!out.incorrect,
      hasStreak3: !!out.streak3,
      hasStreakLen: !!out.streakLen,
      hasConsistencyStatus: !!out.consistency_status,
      hasStreak3Today: !!out.streak3Today,
      updatedAt,
      ageMs
    });

    console.log("[SYNC/state] === onRequestGet END ===");
  } catch (_e) {}

  return new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json" },
  });
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}