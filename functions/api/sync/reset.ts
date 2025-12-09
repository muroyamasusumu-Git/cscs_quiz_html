// ============================================================================
// CSCS SYNC reset API
// ※ cscs_debug_reset_button.js と完全に整合する仕様を必ず維持すること。
// 
// ▼ この API（/api/sync/reset）は「計測系のみを初期化」するためのもの。
// ▼ consistency_status / fav / examDate などの設定系は絶対に削除しない。
// ▼ 設定系は取り扱い禁止（この API では触らない）。
//
// -----------------------------------------------------------------------------
// 【localStorage / sessionStorage 側でリセットされる対象（参考：デバッグボタン側）】
//
// ▼ 日次系
//   - cscs_correct_attempts_YYYYMMDD
//   - cscs_wrong_attempts_YYYYMMDD
//   - cscs_correct_done:YYYYMMDD
//   - cscs_wrong_done:YYYYMMDD
//   - cscs_correct_attempt_log_YYYYMMDD
//   - cscs_wrong_attempt_log_YYYYMMDD
//
// ▼ 問題別累計（ローカルキャッシュ）
//   - cscs_q_correct_total:qid
//   - cscs_q_wrong_total:qid
//   - cscs_q_correct_counted_total:qid
//   - cscs_q_wrong_counted_total:qid
//   - cscs_q_correct_uncounted_total:qid
//   - cscs_q_wrong_uncounted_total:qid
//
// ▼ 問題別 3 連続正解 / 不正解（ローカル）
//   - cscs_q_correct_streak3_total:qid
//   - cscs_q_correct_streak_len:qid
//   - cscs_q_correct_streak3_log:qid
//   - cscs_q_wrong_streak3_total:qid
//   - cscs_q_wrong_streak_len:qid
//   - cscs_q_wrong_streak3_log:qid
//
// ▼ グローバルストリーク
//   - cscs_correct_streak_len
//   - cscs_correct_streak3_total
//   - cscs_correct_streak3_log
//
// ▼ その他メタ（local のみ）
//   - cscs_wrong_log
//   - cscs_last_seen_day
//
// ▼ Streak3Today
//   - cscs_streak3_today_day
//   - cscs_streak3_today_qids
//   - cscs_streak3_today_unique_count
//
// ▼ Streak3WrongToday
//   - cscs_streak3_wrong_today_day
//   - cscs_streak3_wrong_today_qids
//   - cscs_streak3_wrong_today_unique_count
//
// ▼ oncePerDayToday
//   - cscs_once_per_day_today_day
//   - cscs_once_per_day_today_results
//
// ▼ A→B トークン
//   - cscs_from_a:qid
//   - cscs_from_a_token:qid
//   - sessionStorage 同名キー
//
// -----------------------------------------------------------------------------
// 【SYNC state 側でリセットされる対象】
//
// ▼ 問題別累計
//   - server.correct[qid]
//   - server.incorrect[qid]
//
// ▼ 問題別 3 連続正解
//   - server.streak3[qid]
//   - server.streakLen[qid]
//
// ▼ 問題別 3 連続不正解
//   - server.streak3Wrong[qid]
//   - server.streakWrongLen[qid]
//
// ▼ Streak3Today
//   - server.streak3Today(day / qids / unique_count)
//
// ▼ Streak3WrongToday
//   - server.streak3WrongToday(day / qids / unique_count)
//
// ▼ oncePerDayToday
//   - server.oncePerDayToday(day / results)
//
// ▼ token_from_a（存在すれば）
//
// -----------------------------------------------------------------------------
// ⚠️【SYNC state で絶対にリセットしてはいけない対象】⚠️
//   - server.consistency_status     （整合性チェック結果）
//   - server.fav                    （お気に入り状態）
//   - server.examDate               （試験日）
//   → reset.ts 内では、これらのフィールドを絶対に上書き・削除しないこと。
// -----------------------------------------------------------------------------

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