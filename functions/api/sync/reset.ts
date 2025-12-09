export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // リセット対象スコープをリクエストボディから取得（無指定・不正なら "all"）
  let scope = "all";
  try {
    const body = await request.json();
    if (body && typeof body.scope === "string" && body.scope.length > 0) {
      scope = body.scope;
    }
  } catch (e) {
    // json でない場合などは "all" のままにしておく
  }

  // 既存 state を取得（なければ空オブジェクトからスタート）
  const raw = await env.SYNC.get(key);
  let current: any;
  if (raw) {
    try {
      current = JSON.parse(raw);
    } catch (e) {
      current = {};
    }
  } else {
    current = {};
  }

  // scope ごとに「計測系だけ」を初期化し、fav / consistency_status / 試験日など設定系は維持する
  function resetStateByScope(state: any, targetScope: string): any {
    const next: any = { ...state };

    switch (targetScope) {
      case "daily":
        // 日次集計系のみ初期化（例: server.daily）
        // ※ 他のフィールド（fav / consistency_status / examDate 等）は触らない
        next.daily = {};
        break;

      case "q_totals":
        // 問題別の正解/不正累計のみ初期化
        next.correct = {};
        next.incorrect = {};
        break;

      case "q_streaks":
        // 問題別ストリーク系（3連続正解/不正、連続数）だけ初期化
        next.streak3 = {};
        next.streakLen = {};
        next.streak3Wrong = {};
        next.streakWrongLen = {};
        break;

      case "global_streak":
        // 全体ストリークのみ初期化
        next.globalStreak = {};
        break;

      case "streak3_today":
        // 本日の⭐️ユニーク（Streak3Today）だけ初期化
        next.streak3Today = {};
        break;

      case "streak3_wrong_today":
        // 本日の3連続不正解ユニーク（Streak3WrongToday）のみ初期化
        next.streak3WrongToday = {};
        break;

      case "once_per_day":
        // oncePerDayToday（1日1回計測）だけ初期化
        next.oncePerDayToday = {};
        break;

      case "token_from_a":
        // A→B トークン（サーバー側保持分）があればそれだけ初期化
        next.token_from_a = {};
        break;

      case "meta":
        // meta 領域だけ初期化（consistency_status / fav / examDate は別フィールドとして残す前提）
        next.meta = {};
        break;

      case "all":
      default:
        // 「計測系のみ」を全カテゴリまとめて初期化
        // 設定系（fav / consistency_status / examDate など）は維持する
        next.daily = {};
        next.correct = {};
        next.incorrect = {};
        next.streak3 = {};
        next.streakLen = {};
        next.streak3Wrong = {};
        next.streakWrongLen = {};
        next.globalStreak = {};
        next.streak3Today = {};
        next.streak3WrongToday = {};
        next.oncePerDayToday = {};
        next.token_from_a = {};
        // meta は「計測寄りの補足情報」として空オブジェクトに初期化しておくが、
        // consistency_status / fav / examDate は next 上の別フィールドとしてそのまま残る
        next.meta = next.meta || {};
        break;
    }

    // 更新時刻だけ毎回上書き
    next.updatedAt = Date.now();
    return next;
  }

  const next = resetStateByScope(current, scope);

  await env.SYNC.put(key, JSON.stringify(next));

  return new Response(JSON.stringify(next), {
    headers: { "content-type": "application/json" }
  });
};

async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}