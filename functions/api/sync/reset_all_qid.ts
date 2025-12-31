// /api/sync/reset_all_qid
// デバッグ専用エンドポイント。
// - 全ての qid について「計測系」の SYNC データを初期化する
//   （correct / incorrect / streak3 / streakLen）
// - streak3Today / oncePerDayToday などの「グローバル系」はここでは触らない
//   → それらは専用の reset エンドポイントで個別に操作する前提
//
// 本仕様のユーザー機能ではなく、開発・検証用のみに使用することを想定。

type SyncState = {
  correct?: Record<string, number>;
  incorrect?: Record<string, number>;
  streak3?: Record<string, number>;
  streakLen?: Record<string, number>;
  streak3Today?: {
    day: number | null;
    unique_count: number;
    qids?: string[];
  };
  oncePerDayToday?: {
    day: number | null;
    results: Record<string, string>;
  };
  updatedAt?: number;
};

type Env = {
  SYNC: KVNamespace;
};

// Cookie からユーザーキーを取得する。
// ※ 既存の /api/sync/state や /api/sync/merge と同じ方式に合わせて、
//   必要なら cookie 名などを調整してください。
function getUserKeyFromRequest(request: Request): string {
  const cookie = request.headers.get("Cookie") || "";
  // 例: "cscs_uid=xxxx; other=yyy"
  const m = cookie.match(/cscs_uid=([^;]+)/);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch (_e) {
      return m[1];
    }
  }
  // Cookie が無い場合は既存実装に合わせて適宜変更
  return "default";
}

// SYNC KV に保存している state を読み込む。
// キー形式は "state:{userKey}" を前提とする（既存実装と合わせてください）。
async function loadSyncState(env: Env, userKey: string): Promise<SyncState> {
  const key = "state:" + userKey;
  const raw = await env.SYNC.get(key, { type: "text" });
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as SyncState;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch (_e) {
    return {};
  }
}

// SYNC KV に state を保存する。
async function saveSyncState(env: Env, userKey: string, state: SyncState): Promise<void> {
  const key = "state:" + userKey;
  const json = JSON.stringify(state);
  await env.SYNC.put(key, json);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const userKey = getUserKeyFromRequest(request);

    // 1) 既存の state を取得
    const current = await loadSyncState(env, userKey);

    const currentCorrect = current.correct || {};
    const currentIncorrect = current.incorrect || {};
    const currentStreak3 = current.streak3 || {};
    const currentStreakLen = current.streakLen || {};

    const clearedCounts = {
      correctKeys: Object.keys(currentCorrect).length,
      incorrectKeys: Object.keys(currentIncorrect).length,
      streak3Keys: Object.keys(currentStreak3).length,
      streakLenKeys: Object.keys(currentStreakLen).length
    };

    // 2) qid ごとの計測系マップを空にする
    const nextState: SyncState = {
      ...current,
      correct: {},
      incorrect: {},
      streak3: {},
      streakLen: {},
      updatedAt: Date.now()
    };

    // 3) 保存
    await saveSyncState(env, userKey, nextState);

    // 4) ログ出力（デバッグ確認用）
    console.log("[SYNC:reset_all_qid] cleared measurement maps for user", {
      userKey: userKey,
      clearedCounts: clearedCounts
    });

    // 5) レスポンスとして、クリア前の件数と after の簡易状態を返す
    const body = {
      ok: true,
      userKey: userKey,
      clearedCounts: clearedCounts,
      // 返しすぎると重くなるので、qidマップは「キー数のみ」にする
      after: {
        correctKeys: nextState.correct ? Object.keys(nextState.correct).length : 0,
        incorrectKeys: nextState.incorrect ? Object.keys(nextState.incorrect).length : 0,
        streak3Keys: nextState.streak3 ? Object.keys(nextState.streak3).length : 0,
        streakLenKeys: nextState.streakLen ? Object.keys(nextState.streakLen).length : 0,
        hasStreak3Today: !!nextState.streak3Today,
        hasOncePerDayToday: !!nextState.oncePerDayToday,
        updatedAt: nextState.updatedAt || null
      }
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e: any) {
    console.error("[SYNC:reset_all_qid] ERROR", e);
    const body = {
      ok: false,
      error: String(e && e.message ? e.message : e)
    };
    return new Response(JSON.stringify(body), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};