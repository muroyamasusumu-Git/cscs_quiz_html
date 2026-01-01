// functions/api/sync/merge.ts
/**
 * CSCS SYNC merge 実装（Workers 側）
 *
 * 【キー対応表（LocalStorage ⇔ SYNC state ⇔ delta payload）】
 *  ※このファイルで「新しくキーを追加／既存キー名を変更」した場合は、
 *    必ずこの表を更新すること（恒久ルール）。
 *
 * ▼ 問題別累計
 *   - localStorage: "cscs_q_correct_total:" + qid
 *       ⇔ SYNC state: server.correct[qid]
 *       ⇔ delta payload: correctDelta[qid]
 *   - localStorage: "cscs_q_wrong_total:" + qid
 *       ⇔ SYNC state: server.incorrect[qid]
 *       ⇔ delta payload: incorrectDelta[qid]
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage: "cscs_q_correct_streak3_total:" + qid
 *       ⇔ SYNC state: server.streak3[qid]
 *       ⇔ delta payload: streak3Delta[qid]
 *   - localStorage: "cscs_q_correct_streak_len:" + qid
 *       ⇔ SYNC state: server.streakLen[qid]
 *       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
 *   - localStorage: "cscs_q_correct_streak_max:" + qid
 *       ⇔ SYNC state: server.streakMax[qid]
 *       ⇔ delta payload: streakMaxDelta[qid]（max 更新時のみ送信 / 最新値）
 *   - localStorage: "cscs_q_correct_streak_max_day:" + qid
 *       ⇔ SYNC state: server.streakMaxDay[qid]
 *       ⇔ delta payload: streakMaxDayDelta[qid]（max 更新時のみ送信 / JST YYYYMMDD）
 *
 * ▼ 問題別 3 連続不正解（💣用）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: server.streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *   - localStorage: "cscs_q_wrong_streak_len:" + qid
 *       ⇔ SYNC state: server.streakWrongLen[qid]
 *       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
 *   - localStorage: "cscs_q_wrong_streak_max:" + qid
 *       ⇔ SYNC state: server.streakWrongMax[qid]
 *       ⇔ delta payload: streakWrongMaxDelta[qid]（max 更新時のみ送信 / 最新値）
 *   - localStorage: "cscs_q_wrong_streak_max_day:" + qid
 *       ⇔ SYNC state: server.streakWrongMaxDay[qid]
 *       ⇔ delta payload: streakWrongMaxDayDelta[qid]（max 更新時のみ送信 / JST YYYYMMDD）
 *
 * ▼ Streak3Today（本日の⭐️ユニーク数）
 *   - localStorage: "cscs_streak3_today_day"
 *       ⇔ SYNC state: server.streak3Today.day（number: YYYYMMDD）
 *       ⇔ delta payload: streak3TodayDelta.day（number: YYYYMMDD）
 *   - localStorage: "cscs_streak3_today_qids"
 *       ⇔ SYNC state: server.streak3Today.qids
 *       ⇔ delta payload: streak3TodayDelta.qids
 *   - localStorage: "cscs_streak3_today_unique_count"
 *       ⇔ SYNC state: server.streak3Today.unique_count
 *       ⇔ delta payload: streak3TodayDelta.unique_count（省略可）
 *
 * ▼ Streak3WrongToday（本日の3連続不正解ユニーク数）
 *   - localStorage: "cscs_streak3_wrong_today_day"
 *       ⇔ SYNC state: server.streak3WrongToday.day（number: YYYYMMDD）
 *       ⇔ delta payload: streak3WrongTodayDelta.day（number: YYYYMMDD）
 *   - localStorage: "cscs_streak3_wrong_today_qids"
 *       ⇔ SYNC state: server.streak3WrongToday.qids
 *       ⇔ delta payload: streak3WrongTodayDelta.qids
 *   - localStorage: "cscs_streak3_wrong_today_unique_count"
 *       ⇔ SYNC state: server.streak3WrongToday.unique_count
 *       ⇔ delta payload: streak3WrongTodayDelta.unique_count（省略可）
 *
 * ▼ oncePerDayToday（1日1回まで計測）
 *   - localStorage: "cscs_once_per_day_today_day"
 *       ⇔ SYNC state: server.oncePerDayToday.day（number: YYYYMMDD）
 *       ⇔ delta payload: oncePerDayTodayDelta.day（number: YYYYMMDD）
 *   - localStorage: "cscs_once_per_day_today_results"
 *       ⇔ SYNC state: server.oncePerDayToday.results[qid]
 *       ⇔ delta payload: oncePerDayTodayDelta.results[qid]
 *
 * ▼ 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）
 *   - localStorage: "cscs_q_last_seen_day:" + qid
 *       ⇔ SYNC state: server.lastSeenDay[qid]
 *       ⇔ delta payload: lastSeenDayDelta[qid]
 *   - localStorage: "cscs_q_last_correct_day:" + qid
 *       ⇔ SYNC state: server.lastCorrectDay[qid]
 *       ⇔ delta payload: lastCorrectDayDelta[qid]
 *   - localStorage: "cscs_q_last_wrong_day:" + qid
 *       ⇔ SYNC state: server.lastWrongDay[qid]
 *       ⇔ delta payload: lastWrongDayDelta[qid]
 *
 * ▼ お気に入り状態
 *   - localStorage: （fav_modal.js 内部管理）
 *       ⇔ SYNC state: server.fav[qid]
 *       ⇔ delta payload: fav[qid] ("unset" | "fav001" | "fav002" | "fav003")  // ★ー/★1/★2/★3 に対応
 *
 * ▼ グローバル情報
 *   - localStorage: "cscs_total_questions"
 *       ⇔ SYNC state: server.global.totalQuestions
 *       ⇔ delta payload: global.totalQuestions
 *
 * ▼ 整合性ステータス（consistency_status）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: server.consistency_status[qid]
 *       ⇔ delta payload: consistencyStatusDelta[qid]
 *
 * ▼ 試験日設定（exam_date）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: server.exam_date (YYYY-MM-DD)
 *       ⇔ delta payload: exam_date_iso (YYYY-MM-DD)
 *
 * ▼ O.D.O.A / 検証モード関連
 *   - runtime: window.CSCS_VERIFY_MODE ("on" / "off")
 *       ⇔ SYNC state: server.odoa_mode ("on" / "off")
 *       ⇔ delta payload: odoa_mode
 */
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // ★ Origin チェック（同一ドメイン＋ローカル開発のみ許可）
  const origin = request.headers.get("Origin");
  const allowedOrigins = [
    "https://cscs-quiz-html.pages.dev", // 本番ドメイン（必要に応じて変更）
    "http://localhost:8789"            // wrangler pages dev 用（不要なら消してOK）
  ];

  if (origin !== null && !allowedOrigins.includes(origin)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain" }
    });
  }

  const user = await getUserIdFromAccess(request);
  if (!user) {
    // JWT が無い / パースできない場合は 401 を明示的に返す
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Content-Type": "text/plain" }
    });
  }

  // ★ user / key を確定させる（state.ts と突き合わせるため）
  const userRaw = user;
  const userNormalized = typeof userRaw === "string" ? userRaw.trim().toLowerCase() : "";
  const key = `sync:${userNormalized}`;

  console.log("[SYNC/merge][KEY] resolved", {
    userRaw,
    userNormalized,
    key
  });

  let kvIdentityId = "";

  // ★ レスポンス用：KV put が実行されたか（KV保存データには入れない）
  let putExecuted = false;
  let putDiagBefore: any = null;
  let putDiagAfter: any = null;

  // (0) 受信 delta 全体をログ
  // - クライアント（A/B パートなど）から送られてきた差分データを JSON として受け取る
  // - ここでパースに失敗した場合は以降の処理は不可能なので 400 を返して終了
  let delta: any;
  try {
    delta = await request.json();
  } catch (e) {
    console.error("[SYNC/merge] ★delta JSON parse 失敗:", e);
    return new Response("bad json", { status: 400 });
  }

  // ★ payloadType / diffKeysCount / willPut を「KVに入る前」に確定させる（最重要）
  // - 目的: 「diff が空なのか」「そもそも diff 処理に入っていないのか」をログ一発で確定する
  // - 方針: payloadType を必須チェックし、"diff" 以外は即 400（KV.get/put を絶対に実行しない）
  // - 方針: diffKeysCount（全 delta の合計キー数）を算出し、0 なら NO_DIFF_SKIP_PUT で即 return（KV.get/put を絶対に実行しない）
  const payloadTypeRaw = (delta as any).payloadType;
  const payloadType = typeof payloadTypeRaw === "string" ? payloadTypeRaw : "";

  // ★ diffKeysCount 算出（全 delta 合計）
  // - correctDelta 等は「qid→値」のプレーンオブジェクト想定なので Object.keys().length を数える
  // - today 系は「qid配列/結果map」なので、それぞれ妥当な粒度で数える（qids.length / results の keys）
  function countKeys(obj: any): number {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
    return Object.keys(obj).length;
  }

  const diffKeysCount =
    countKeys((delta as any).correctDelta) +
    countKeys((delta as any).incorrectDelta) +
    countKeys((delta as any).streak3Delta) +
    countKeys((delta as any).streakLenDelta) +
    countKeys((delta as any).streak3WrongDelta) +
    countKeys((delta as any).streakWrongLenDelta) +
    countKeys((delta as any).streakMaxDelta) +
    countKeys((delta as any).streakMaxDayDelta) +
    countKeys((delta as any).streakWrongMaxDelta) +
    countKeys((delta as any).streakWrongMaxDayDelta) +
    countKeys((delta as any).lastSeenDayDelta) +
    countKeys((delta as any).lastCorrectDayDelta) +
    countKeys((delta as any).lastWrongDayDelta) +
    countKeys((delta as any).consistencyStatusDelta) +
    countKeys((delta as any).fav) +
    countKeys((delta as any).global) +
    (Array.isArray((delta as any).streak3TodayDelta && (delta as any).streak3TodayDelta.qids) ? (delta as any).streak3TodayDelta.qids.length : 0) +
    (Array.isArray((delta as any).streak3WrongTodayDelta && (delta as any).streak3WrongTodayDelta.qids) ? (delta as any).streak3WrongTodayDelta.qids.length : 0) +
    countKeys((delta as any).oncePerDayTodayDelta && (delta as any).oncePerDayTodayDelta.results) +
    (typeof (delta as any).odoa_mode === "string" ? 1 : 0) +
    (typeof (delta as any).exam_date_iso === "string" ? 1 : 0);

  const willPut = diffKeysCount > 0;

  console.log("[MERGE] payloadType:", payloadType);
  console.log("[MERGE] diffKeysCount:", diffKeysCount);

  // ★ 必須ログ（payloadType / diffKeysCount / willPut）
  console.log("[SYNC/merge][PAYLOAD] summary:", {
    payloadType,
    diffKeysCount,
    willPut
  });

  // ★ payloadType 必須チェック（最優先・フォールバック無し）
  if (!payloadType) {
    console.log("[SYNC/merge][PAYLOAD] payloadType missing → reject", {
      payloadType,
      diffKeysCount,
      willPut
    });
    return new Response(JSON.stringify({ error: "PAYLOAD_TYPE_REQUIRED" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  }

  // ★ payloadType === "diff" 以外は即エラー
  //   → diff 処理に「入っていない」ことをここで確定させる
  if (payloadType !== "diff") {
    console.log("[SYNC/merge][PAYLOAD] payloadType invalid (expect diff) → reject", {
      payloadType,
      diffKeysCount,
      willPut
    });
    return new Response(JSON.stringify({ error: "PAYLOAD_TYPE_INVALID" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  }

  // ★ diff 処理に入ったが、差分が無いケース
  //   → put せず 200 で終了（key チェックに入らない）
  if (diffKeysCount === 0) {
    console.log("[MERGE] payloadType: diff");
    console.log("[MERGE] diffKeysCount: 0");
    console.log("[MERGE] NO_DIFF_SKIP_PUT");

    // ★ (1) Pages メタを early return 前に確定（diag:kv_identity の作成payloadにも使う）
    const envAny: any = env as any;
    const pagesDeploymentId =
      typeof (envAny as any).CF_PAGES_DEPLOYMENT_ID === "string"
        ? String((envAny as any).CF_PAGES_DEPLOYMENT_ID)
        : "";
    const pagesCommitSha =
      typeof (envAny as any).CF_PAGES_COMMIT_SHA === "string"
        ? String((envAny as any).CF_PAGES_COMMIT_SHA)
        : "";
    const pagesBranch =
      typeof (envAny as any).CF_PAGES_BRANCH === "string"
        ? String((envAny as any).CF_PAGES_BRANCH)
        : "";
    const pagesProject =
      typeof (envAny as any).CF_PAGES_PROJECT_NAME === "string"
        ? String((envAny as any).CF_PAGES_PROJECT_NAME)
        : "";

    // ★ (2) request route を early return 前に確定（colo / ray を診断ヘッダとログに使う）
    const reqId = crypto.randomUUID();
    const cfAny: any = (request as any).cf || {};
    const colo = typeof cfAny.colo === "string" ? cfAny.colo : "";
    const ray = request.headers.get("CF-Ray") || "";

    // ★ (3) KV identity を early return 前に確定（NO_DIFFでも X-CSCS-KV-Identity を非空にする）
    const kvIdentityKey = "diag:kv_identity";
    let kvIdentityRaw: string | null = null;

    try {
      kvIdentityRaw = await env.SYNC.get(kvIdentityKey, "text");
      console.log("[SYNC/merge][KV-IDENTITY][NO_DIFF] get OK:", {
        hasValue: !!kvIdentityRaw
      });
    } catch (e) {
      console.error("[SYNC/merge][KV-IDENTITY][NO_DIFF] get FAILED:", e);
      kvIdentityRaw = null;
    }

    if (!kvIdentityRaw) {
      const identityObj = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        pages: {
          project: pagesProject,
          branch: pagesBranch,
          commit: pagesCommitSha,
          deployment: pagesDeploymentId
        }
      };

      try {
        await env.SYNC.put(kvIdentityKey, JSON.stringify(identityObj));
        kvIdentityId = identityObj.id;
        console.log("[SYNC/merge][KV-IDENTITY][NO_DIFF] put OK (created):", {
          key: kvIdentityKey,
          id: kvIdentityId
        });
      } catch (e) {
        console.error("[SYNC/merge][KV-IDENTITY][NO_DIFF] put FAILED:", e);
      }
    } else {
      try {
        const parsed = JSON.parse(kvIdentityRaw);
        kvIdentityId = parsed && typeof parsed.id === "string" ? parsed.id : "";
        console.log("[SYNC/merge][KV-IDENTITY][NO_DIFF] use existing:", {
          key: kvIdentityKey,
          id: kvIdentityId
        });
      } catch (e) {
        console.error("[SYNC/merge][KV-IDENTITY][NO_DIFF] parse FAILED:", e);
        kvIdentityId = "";
      }
    }

    console.log("[SYNC/merge][diag][NO_DIFF] response headers snapshot:", {
      reqId,
      user,
      key,
      colo,
      ray,
      kv_identity: kvIdentityId,
      pages: {
        project: pagesProject,
        branch: pagesBranch,
        commit: pagesCommitSha,
        deployment: pagesDeploymentId
      }
    });

    return new Response(
      JSON.stringify({
        ok: true,
        reason: "NO_DIFF_SKIP_PUT",
        payloadType,
        diffKeysCount,
        willPut: false,
        __cscs_merge: {
          putExecuted: false,
          putBefore: null,
          putAfter: null
        }
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",

          "X-CSCS-KV-Binding": "SYNC",
          "X-CSCS-KV-Identity": kvIdentityId,

          "X-CSCS-Pages-Project": pagesProject,
          "X-CSCS-Pages-Branch": pagesBranch,
          "X-CSCS-Pages-Commit": pagesCommitSha,
          "X-CSCS-Pages-Deploy": pagesDeploymentId,

          "X-CSCS-KV-HasEnvSYNC": (env as any).SYNC ? "1" : "0",
          "X-CSCS-KV-HasGet": (env as any).SYNC && typeof (env as any).SYNC.get === "function" ? "1" : "0",
          "X-CSCS-KV-HasPut": (env as any).SYNC && typeof (env as any).SYNC.put === "function" ? "1" : "0",
          "X-CSCS-KV-HasDelete": (env as any).SYNC && typeof (env as any).SYNC.delete === "function" ? "1" : "0",

          "X-CSCS-ReqId": reqId,
          "X-CSCS-User": user,
          "X-CSCS-Key": key,
          "X-CSCS-Colo": colo,
          "X-CSCS-CF-Ray": ray,
          "X-CSCS-UpdatedAt": "",
          "X-CSCS-OdoaMode": ""
        }
      }
    );
  }

  // ★ 実際に put する場合のみ key を必須にする
  const reqKey = request.headers.get("X-CSCS-Key");
  if (!reqKey) {
    console.log("[SYNC/merge][KEY] missing X-CSCS-Key header → reject");
    return new Response(JSON.stringify({ error: "SYNC_KEY_REQUIRED" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  }

  // 受信した delta の全体像と、streak3TodayDelta の有無をログに残す
  try {
    console.log("====================================================");
    console.log("[SYNC/merge] === onRequestPost START ===");
    console.log("[SYNC/merge] user :", user);
    console.log("[SYNC/merge] key  :", key);

    // ★KVバインディング診断（このFunctionsがどのKVを“掴んでいるか”の判定材料）
    // - binding名はコード上は固定で "SYNC"
    // - envにSYNCが存在するか、get/put/delete が生えているかを出す（binding実体がKVとして機能しているかの確認）
    // - env keys を「全件」出す（preview/prod 等で env の見え方が違うのを確実に切り分ける）
    // - requestの Host / CF-Ray / colo を出す（別デプロイ/別経路の切り分け材料）
    const envAny: any = env as any;
    const envKeys = envAny && typeof envAny === "object" ? Object.keys(envAny).sort() : [];
    const syncAny: any = envAny ? envAny.SYNC : undefined;

    console.log("[SYNC/merge][KV-DIAG] bindingName:", "SYNC");
    console.log("[SYNC/merge][KV-DIAG] env keys (all):", envKeys);

    console.log("[SYNC/merge][KV-DIAG] binding check:", {
      bindingName: "SYNC",
      hasEnvSYNC: !!syncAny,
      typeOfSYNC: typeof syncAny,
      hasGet: !!(syncAny && typeof syncAny.get === "function"),
      hasPut: !!(syncAny && typeof syncAny.put === "function"),
      hasDelete: !!(syncAny && typeof syncAny.delete === "function")
    });

    const reqHost = request.headers.get("Host") || "";
    const reqRay = request.headers.get("CF-Ray") || "";
    const cfAny: any = (request as any).cf || {};
    const reqColo = typeof cfAny.colo === "string" ? cfAny.colo : "";
    console.log("[SYNC/merge][KV-DIAG] request route snapshot:", {
      host: reqHost,
      ray: reqRay,
      colo: reqColo
    });

    // ★Pages デプロイ実体診断（preview / production / 別デプロイを一発で確定）
    // - CF Pages が自動注入する環境変数群を出す
    // - state.ts と merge.ts で同一値なら「同一デプロイ実体」を確定できる
    const pagesDeploymentId =
      typeof (envAny as any).CF_PAGES_DEPLOYMENT_ID === "string"
        ? String((envAny as any).CF_PAGES_DEPLOYMENT_ID)
        : "";
    const pagesCommitSha =
      typeof (envAny as any).CF_PAGES_COMMIT_SHA === "string"
        ? String((envAny as any).CF_PAGES_COMMIT_SHA)
        : "";
    const pagesBranch =
      typeof (envAny as any).CF_PAGES_BRANCH === "string"
        ? String((envAny as any).CF_PAGES_BRANCH)
        : "";
    const pagesProject =
      typeof (envAny as any).CF_PAGES_PROJECT_NAME === "string"
        ? String((envAny as any).CF_PAGES_PROJECT_NAME)
        : "";

    console.log("[SYNC/merge][PAGES-DIAG] pages meta:", {
      project: pagesProject,
      branch: pagesBranch,
      commit: pagesCommitSha,
      deployment: pagesDeploymentId
    });

    // ★KV identity 証明（最終兵器）
    // - 目的: state/merge が「同一のKV namespace」を掴んでいることを“証明”する
    // - 方針: merge.ts 側だけが「未作成時のみ」diag:kv_identity を 1回だけ作る（state.tsは読むだけ）
    // - 成功確認: putしたか / 既に存在したか / 読めたidentityId を必ずログに出す
    const kvIdentityKey = "diag:kv_identity";
    let kvIdentityRaw: string | null = null;

    try {
      kvIdentityRaw = await env.SYNC.get(kvIdentityKey, "text");
      console.log("[SYNC/merge][KV-IDENTITY] get OK:", {
        hasValue: !!kvIdentityRaw
      });
    } catch (e) {
      console.error("[SYNC/merge][KV-IDENTITY] get FAILED:", e);
      kvIdentityRaw = null;
    }

    if (!kvIdentityRaw) {
      const identityObj = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        pages: {
          project: pagesProject,
          branch: pagesBranch,
          commit: pagesCommitSha,
          deployment: pagesDeploymentId
        }
      };

      try {
        await env.SYNC.put(kvIdentityKey, JSON.stringify(identityObj));
        kvIdentityId = identityObj.id;
        console.log("[SYNC/merge][KV-IDENTITY] put OK (created):", {
          key: kvIdentityKey,
          id: kvIdentityId
        });
      } catch (e) {
        console.error("[SYNC/merge][KV-IDENTITY] put FAILED:", e);
      }
    } else {
      try {
        const parsed = JSON.parse(kvIdentityRaw);
        kvIdentityId = parsed && typeof parsed.id === "string" ? parsed.id : "";
        console.log("[SYNC/merge][KV-IDENTITY] use existing:", {
          key: kvIdentityKey,
          id: kvIdentityId
        });
      } catch (e) {
        console.error("[SYNC/merge][KV-IDENTITY] parse FAILED:", e);
        kvIdentityId = "";
      }
    }

    // ★受信deltaのスナップショット（既存ログ）
    console.log("[SYNC/merge] (1) delta 全体:", JSON.stringify(delta));
    console.log("[SYNC/merge] (1-1) delta.streak3TodayDelta:", JSON.stringify((delta as any).streak3TodayDelta ?? null));
  } catch (_e) {}

  // (server) 現在のサーバー状態を KV から取得
  // - ユーザーごとの SYNC スナップショットを KV から読み出す
  //
  // 【フォールバックに関与するポイント①: “KV.get が null → 初期テンプレ採用”】
  // - env.SYNC.get(key, "json") は、キー未作成(未保存)のとき通常 null を返す。
  // - また、KV取得で例外が起きた場合も（ここは try/catch を挟んでないので）上へ投げられる可能性がある。
  // - 現在の実装は `(...get...) || { ... }` なので、
  //   - 取得結果が null（=未保存） → 初期テンプレ（空オブジェクト＋odoa_mode:"off"等）を server に採用
  //   - 取得結果が falsy（想定外だが "" や 0 など）→ 同様にテンプレ採用
  //
  // つまり:
  //   “サーバーに何も無い/読めない” を “正しい空状態” として扱う暗黙フォールバックがここにある。
  //
  // 【重要な誤解ポイント】
  // - これは state.ts のような「返却のための空補完」ではなく、
  //   merge の内部状態として「この後 KV.put されうる server の土台」になる。
  // - したがって、もしここでテンプレ採用が走ると、
  //   delta が小さい/一部だけの場合でも「結果として空に見える」状態が作られうる（※どこまで上書きするかは後段次第）。
  let server: any =
    (await env.SYNC.get(key, "json")) || {
      correct: {},
      incorrect: {},
      streak3: {},
      streakLen: {},
      streakMax: {},
      streakMaxDay: {},
      streak3Wrong: {},
      streakWrongLen: {},
      streakWrongMax: {},
      streakWrongMaxDay: {},
      lastSeenDay: {},
      lastCorrectDay: {},
      lastWrongDay: {},
      consistency_status: {},
      // お気に入り状態（fav_modal.js からの同期先）
      fav: {},
      // グローバルメタ情報（総問題数など）を保持する領域
      global: {},
      // O.D.O.A Mode の初期値（まだ一度も保存されていないユーザーは "off" から開始）
      odoa_mode: "off",
      // ここでは初期値として streak3Today / streak3WrongToday / oncePerDayToday を用意する（「無からの初回保存」を許可）
      // - day は number: YYYYMMDD（B側payload・oncePerDayToday と型を統一）
      streak3Today: { day: 0, unique_count: 0, qids: [] },
      streak3WrongToday: { day: 0, unique_count: 0, qids: [] },
      oncePerDayToday: { day: 0, results: {} },
      updatedAt: 0
    };

  // 読み出した server オブジェクトに必須フィールドが欠けていた場合は補完する
  //
  // 【フォールバックに “見える” ポイント②: 欠落→空オブジェクト補完（形合わせ）】
  // - ここは「別ソースから埋め合わせる」類のフォールバックではなく、
  //   “null/undefined で落ちないための最低限の構造補完”。
  // - ただし UI/ロジック側から見ると、
  //   欠落していたデータが {} や 0 に見えるため「0に戻った」印象を与えやすい。
  // - 特に “旧フォーマットのデータ” を読む場面では、
  //   「存在しない＝未計測」なのか「消えた」なのかの区別が曖昧になりやすいのでログで追う前提。
  if (!server.correct) server.correct = {};
  if (!server.incorrect) server.incorrect = {};
  if (!server.streak3) server.streak3 = {};
  if (!server.streakLen) server.streakLen = {};

  // ★ 追加: 問題別「最高連続正解数 / 達成日」を保持する map の形を保証する
  if (!server.streakMax) server.streakMax = {};
  if (!server.streakMaxDay) server.streakMaxDay = {};

  if (!server.streak3Wrong) server.streak3Wrong = {};
  if (!server.streakWrongLen) server.streakWrongLen = {};

  // ★ 追加: 問題別「最高連続不正解数 / 達成日」を保持する map の形を保証する
  if (!server.streakWrongMax) server.streakWrongMax = {};
  if (!server.streakWrongMaxDay) server.streakWrongMaxDay = {};

  if (!server.lastSeenDay) server.lastSeenDay = {};
  if (!server.lastCorrectDay) server.lastCorrectDay = {};
  if (!server.lastWrongDay) server.lastWrongDay = {};
  if (!server.consistency_status) server.consistency_status = {};
  if (!server.fav || typeof server.fav !== "object") server.fav = {};

  // 【フォールバックに “見える” ポイント③: 今日系フィールドの欠落→空テンプレ補完】
  // - streak3Today / streak3WrongToday / oncePerDayToday は “1日単位の構造” を持つ。
  // - 旧データにフィールド自体が存在しない場合、ここで「空の構造」を作って以後の処理を通す。
  // - これにより「存在しない」は「空の today 構造」に置き換えられる（=欠落検知はできなくなる）。
  // - state.ts は “today を補完しない” 方針だったが、merge.ts は “初回保存を許可する” ため補完している。
  if (!(server as any).streak3Today) {
    (server as any).streak3Today = { day: 0, unique_count: 0, qids: [] };
  }

  // ★ streak3WrongToday が欠けている既存ユーザーのデータを補完
  //   - 旧フォーマットからの移行時に、構造を壊さずに「空の3連続不正解ユニーク情報」を用意する
  if (!(server as any).streak3WrongToday) {
    (server as any).streak3WrongToday = { day: 0, unique_count: 0, qids: [] };
  }

  // 【フォールバックに “見える” ポイント④: oncePerDayToday 欠落→空テンプレ補完】
  // - oncePerDayToday は “day:number + results:{}” を前提に後段でマージする。
  // - 欠落/不正構造を空テンプレに丸めることで「データが無い/壊れている」を “空” として扱う。
  if (!(server as any).oncePerDayToday || typeof (server as any).oncePerDayToday !== "object") {
    (server as any).oncePerDayToday = { day: 0, results: {} };
  }

  // 【フォールバックに “見える” ポイント⑤: global 欠落→空オブジェクト補完】
  // - totalQuestions を入れる箱。欠けていたら空箱を用意するだけ。
  if (!(server as any).global || typeof (server as any).global !== "object") {
    (server as any).global = {};
  }

  // O.D.O.A Mode が存在しない or 不正な場合は "off" で補完しておく
  //
  // 【フォールバックに “見える” ポイント⑥: 不正値の丸め込み（coerce）】
  // - server.odoa_mode が欠落/不正（string以外）なら "off" に強制する。
  // - これは “テンプレに戻す” というより「壊れた値を正規値へ丸める」処理。
  // - UIから見ると “勝手にoffになった” に見えるので、ログで
  //   「KV miss 由来」なのか「KV内の値欠落/破損」なのかを切り分ける前提。
  if (!Object.prototype.hasOwnProperty.call(server as any, "odoa_mode") || typeof (server as any).odoa_mode !== "string") {
    (server as any).odoa_mode = "off";
    try {
      console.log("[SYNC/merge] (0-1) server.odoa_mode が欠落または不正値のため 'off' で補完しました。");
    } catch (_e) {}
  }

  // ★ 実更新検知用：merge前スナップショット（updatedAt を触る前の状態）
  // - diffKeysCount > 0 でも「実更新が0」のケースがあり得るため、KV.put の要否を最終確定する
  const serverBeforeMergeSnapshot = JSON.stringify(server);

  // (1) delta.streak3TodayDelta / oncePerDayTodayDelta が送られてきたか
  // - クライアント側が「今日の ⭐️ ユニーク一覧」と「1日1回までカウント対象 oncePerDayTodayDelta」を送信してきているかどうかを確認する
  const streak3TodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).streak3TodayDelta
      : undefined;

  // ★ 今日の3連続不正解ユニーク（💣）用の delta を取り出す
  //   - クライアント側から streak3WrongTodayDelta が送られてきた場合のみ処理対象にする
  const streak3WrongTodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).streak3WrongTodayDelta
      : undefined;

  const oncePerDayTodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).oncePerDayTodayDelta
      : undefined;

  // streak3TodayDelta / streak3WrongTodayDelta / oncePerDayTodayDelta の構造検査用ログ
  try {
    const hasStreak3Delta =
      streak3TodayDelta && typeof streak3TodayDelta === "object" ? true : false;

    let dayDebug = "";
    let qidsRawDebug: unknown = undefined;
    let qidsIsArray = false;
    let qidsLen = 0;

    if (hasStreak3Delta) {
      // day が number（YYYYMMDD）かどうか
      dayDebug =
        typeof (streak3TodayDelta as any).day === "number"
          ? String((streak3TodayDelta as any).day)
          : "";
      // qids が配列かどうか／要素数はいくつか
      qidsRawDebug = (streak3TodayDelta as any).qids;
      qidsIsArray = Array.isArray(qidsRawDebug);
      qidsLen = qidsIsArray ? (qidsRawDebug as any[]).length : 0;
    }

    console.log(
      "[SYNC/merge] (1) delta.streak3TodayDelta 受信:",
      JSON.stringify(streak3TodayDelta ?? null)
    );
    console.log("[SYNC/merge] (1-2) streak3TodayDelta 詳細:", {
      hasDelta: hasStreak3Delta,
      day: dayDebug,
      qidsIsArray,
      qidsLength: qidsLen
    });

    // ★ Streak3WrongTodayDelta 側の構造チェック（day / qids の有無だけ確認）
    const hasStreak3WrongDelta =
      streak3WrongTodayDelta && typeof streak3WrongTodayDelta === "object" ? true : false;
    let wrongDayDebug = "";
    let wrongQidsRawDebug: unknown = undefined;
    let wrongQidsIsArray = false;
    let wrongQidsLen = 0;

    if (hasStreak3WrongDelta) {
      wrongDayDebug =
        typeof (streak3WrongTodayDelta as any).day === "number"
          ? String((streak3WrongTodayDelta as any).day)
          : "";
      wrongQidsRawDebug = (streak3WrongTodayDelta as any).qids;
      wrongQidsIsArray = Array.isArray(wrongQidsRawDebug);
      wrongQidsLen = wrongQidsIsArray ? (wrongQidsRawDebug as any[]).length : 0;
    }

    console.log(
      "[SYNC/merge] (1-2w) delta.streak3WrongTodayDelta 受信:",
      JSON.stringify(streak3WrongTodayDelta ?? null)
    );
    console.log("[SYNC/merge] (1-2w) streak3WrongTodayDelta 詳細:", {
      hasDelta: hasStreak3WrongDelta,
      day: wrongDayDebug,
      qidsIsArray: wrongQidsIsArray,
      qidsLength: wrongQidsLen
    });

    // oncePerDayTodayDelta 側の簡易ログ（day / results の有無だけ確認）
    const hasOncePerDayDelta =
      oncePerDayTodayDelta && typeof oncePerDayTodayDelta === "object" ? true : false;
    let onceDayDebug: number | null = null;
    let resultsKeysLength = 0;
    if (hasOncePerDayDelta) {
      onceDayDebug =
        typeof (oncePerDayTodayDelta as any).day === "number"
          ? (oncePerDayTodayDelta as any).day
          : null;
      const resultsRaw = (oncePerDayTodayDelta as any).results;
      if (resultsRaw && typeof resultsRaw === "object") {
        resultsKeysLength = Object.keys(resultsRaw).length;
      }
    }
    console.log("[SYNC/merge] (1-3) oncePerDayTodayDelta 詳細:", {
      hasDelta: hasOncePerDayDelta,
      day: onceDayDebug,
      resultsKeysLength
    });
  } catch (_e) {}

  // (2) BEFORE: merge 前の server.streak3Today の状態をログ
  // - マージ前のサーバー側 streak3Today がどうなっているかを記録しておく
  try {
    const beforeSt3 = (server as any).streak3Today || null;
    console.log("[SYNC/merge] (2) BEFORE server.streak3Today:", JSON.stringify(beforeSt3));
  } catch (_e) {
    console.warn("[SYNC/merge] ★logging error (BEFORE streak3Today)");
  }

  // ---- 通常の correct / incorrect / streak3 / streakLen / consistency_status マージ ----
  //
  // 【フォールバックに “見える” ポイント⑦: delta未指定を {} 扱いにして “何もしない”】
  // - 以降の各マージは概ね `Object.entries(delta.xxx || {})` の形式。
  // - delta.xxx が undefined / null の場合、`|| {}` により空集合として扱われ、更新は一切行われない（=スキップ）。
  // - これは “別ソースへフォールバック” ではなく「データが来てないものは触らない」という方針。
  // - ただし、もし上流クライアントの送信が欠落していると、
  //   ユーザー体感では「反映されない/0のまま」に見え、フォールバックっぽく誤解されやすい。
  // ---- 通常の correct / incorrect / streak3 / streakLen / consistency_status マージ ----
  // ここから先は「今日の⭐️情報」以外の通常カウンタ類を差分加算する

  // correctDelta: 各 qid の正解数の増分をサーバー合計に足す
  for (const [qid, n] of Object.entries(delta.correctDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    server.correct[qid] = (server.correct[qid] || 0) + v;
  }

  // incorrectDelta: 各 qid の不正解数の増分をサーバー合計に足す
  for (const [qid, n] of Object.entries(delta.incorrectDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    server.incorrect[qid] = (server.incorrect[qid] || 0) + v;
  }

  // streak3Delta: 各 qid の「3連続正解達成回数」の増分をサーバー側に加算
  for (const [qid, n] of Object.entries(delta.streak3Delta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.streak3) server.streak3 = {};
    server.streak3[qid] = (server.streak3[qid] || 0) + v;
  }

  // streakLenDelta: 各 qid の「現在の連続正解長」をサーバー側に上書き
  // - これは累積ではなく「最新値」であり、そのままセットする
  for (const [qid, n] of Object.entries(delta.streakLenDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;
    if (!server.streakLen) server.streakLen = {};
    server.streakLen[qid] = v;
  }

  // ★ 追加: streakLen は streakMax の下限（serverが遅れていても追従させる）
  // - streakMaxDelta が欠落しても、streakLen が増えていれば max を単調増加で更新する
  // - day は lastCorrectDayDelta（=確実に届いた“最終正解日”）がある場合のみセットする
  const lastCorrectDayDeltaForMax = (delta as any).lastCorrectDayDelta || {};

  for (const [qid, n] of Object.entries(delta.streakLenDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;

    if (!server.streakMax) server.streakMax = {};
    if (!server.streakMaxDay) server.streakMaxDay = {};

    const prevMax = typeof server.streakMax[qid] === "number" ? server.streakMax[qid] : 0;

    if (v > prevMax) {
      server.streakMax[qid] = v;

      const dayRaw = (lastCorrectDayDeltaForMax as any)[qid];
      const dayNum = Number(dayRaw);
      const dayStr = String(dayNum);

      if (Number.isFinite(dayNum) && /^\d{8}$/.test(dayStr)) {
        server.streakMaxDay[qid] = dayNum;
      }
    }
  }

  // streak3WrongDelta: 各 qid の「3連続不正解達成回数」の増分をサーバー側に加算
  for (const [qid, n] of Object.entries((delta as any).streak3WrongDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.streak3Wrong) server.streak3Wrong = {};
    server.streak3Wrong[qid] = (server.streak3Wrong[qid] || 0) + v;
  }

  // streakWrongLenDelta: 各 qid の「現在の連続不正解長」をサーバー側に上書き
  // - これは累積ではなく「最新値」であり、そのままセットする
  for (const [qid, n] of Object.entries((delta as any).streakWrongLenDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;
    if (!server.streakWrongLen) server.streakWrongLen = {};
    server.streakWrongLen[qid] = v;
  }

  // ★ 追加: streakWrongLen は streakWrongMax の下限（serverが遅れていても追従させる）
  // - streakWrongMaxDelta が欠落しても、streakWrongLen が増えていれば max を単調増加で更新する
  // - day は lastWrongDayDelta（=確実に届いた“最終不正解日”）がある場合のみセットする
  const lastWrongDayDeltaForMax = (delta as any).lastWrongDayDelta || {};

  for (const [qid, n] of Object.entries((delta as any).streakWrongLenDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;

    if (!server.streakWrongMax) server.streakWrongMax = {};
    if (!server.streakWrongMaxDay) server.streakWrongMaxDay = {};

    const prevMax = typeof server.streakWrongMax[qid] === "number" ? server.streakWrongMax[qid] : 0;

    if (v > prevMax) {
      server.streakWrongMax[qid] = v;

      const dayRaw = (lastWrongDayDeltaForMax as any)[qid];
      const dayNum = Number(dayRaw);
      const dayStr = String(dayNum);

      if (Number.isFinite(dayNum) && /^\d{8}$/.test(dayStr)) {
        server.streakWrongMaxDay[qid] = dayNum;
      }
    }
  }

  // streakMaxDelta: 各 qid の「最高連続正解数」をサーバー側に保存
  // - ★ max保証: 絶対に下がらない（prev と比較して大きい時だけ更新）
  // - ★ day更新と紐付けるため、maxが更新されたqidを記録する
  const updatedStreakMaxQids = new Set<string>();

  for (const [qid, n] of Object.entries((delta as any).streakMaxDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;
    if (!server.streakMax) server.streakMax = {};

    const prev = typeof server.streakMax[qid] === "number" ? server.streakMax[qid] : 0;
    const next = v > prev ? v : prev;

    if (next !== prev) {
      server.streakMax[qid] = next;
      updatedStreakMaxQids.add(qid);
    }
  }

  // streakMaxDayDelta: 各 qid の「最高連続正解数を最後に更新した達成日」を保存
  // - ★ max が更新された qid のみを対象にする
  // - ★ day は number（YYYYMMDD）であることを必須とする
  for (const [qid, n] of Object.entries((delta as any).streakMaxDayDelta || {})) {
    if (!updatedStreakMaxQids.has(qid)) continue;

    const v = n as number;
    if (!Number.isFinite(v)) continue;
    const dayStr = String(v);
    if (!/^\d{8}$/.test(dayStr)) continue;

    if (!server.streakMaxDay) server.streakMaxDay = {};
    server.streakMaxDay[qid] = v;
  }

  // streakMaxDayDelta: 各 qid の「最高連続正解数を最後に更新した達成日（JST YYYYMMDD）」をサーバー側に保存
  // - ★ max更新と連動: streakMax が更新された qid のみ day を更新する（単独day更新は無効）
  for (const [qid, n] of Object.entries((delta as any).streakMaxDayDelta || {})) {
    if (!updatedStreakMaxQids.has(qid)) continue;

    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    const dayStr = String(v);
    if (!/^\d{8}$/.test(dayStr)) continue;

    if (!server.streakMaxDay) server.streakMaxDay = {};
    server.streakMaxDay[qid] = v;
  }

  // streakWrongMaxDelta: 各 qid の「最高連続不正解数」をサーバー側に保存
  // - ★ max保証: 絶対に下がらない（prev と比較して大きい時だけ更新）
  // - ★ day更新と紐付けるため、maxが更新されたqidを記録する
  const updatedStreakWrongMaxQids = new Set<string>();

  for (const [qid, n] of Object.entries((delta as any).streakWrongMaxDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v < 0) continue;
    if (!server.streakWrongMax) server.streakWrongMax = {};

    const prev = typeof server.streakWrongMax[qid] === "number" ? server.streakWrongMax[qid] : 0;
    const next = v > prev ? v : prev;

    if (next !== prev) {
      server.streakWrongMax[qid] = next;
      updatedStreakWrongMaxQids.add(qid);
    }
  }

  // streakWrongMaxDayDelta: 各 qid の「最高連続不正解数を最後に更新した達成日」を保存
  // - ★ max が更新された qid のみを対象にする
  // - ★ day は number（YYYYMMDD）であることを必須とする
  for (const [qid, n] of Object.entries((delta as any).streakWrongMaxDayDelta || {})) {
    if (!updatedStreakWrongMaxQids.has(qid)) continue;

    const v = n as number;
    if (!Number.isFinite(v)) continue;
    const dayStr = String(v);
    if (!/^\d{8}$/.test(dayStr)) continue;

    if (!server.streakWrongMaxDay) server.streakWrongMaxDay = {};
    server.streakWrongMaxDay[qid] = v;
  }

  // streakWrongMaxDayDelta: 各 qid の「最高連続不正解数を最後に更新した達成日（JST YYYYMMDD）」をサーバー側に保存
  // - ★ max更新と連動: streakWrongMax が更新された qid のみ day を更新する（単独day更新は無効）
  for (const [qid, n] of Object.entries((delta as any).streakWrongMaxDayDelta || {})) {
    if (!updatedStreakWrongMaxQids.has(qid)) continue;

    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    const dayStr = String(v);
    if (!/^\d{8}$/.test(dayStr)) continue;

    if (!server.streakWrongMaxDay) server.streakWrongMaxDay = {};
    server.streakWrongMaxDay[qid] = v;
  }

  // lastSeenDayDelta: 各 qid の「最終閲覧日」をサーバー側に反映（YYYYMMDD 数値）
  for (const [qid, n] of Object.entries((delta as any).lastSeenDayDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.lastSeenDay) server.lastSeenDay = {};
    const prev = typeof server.lastSeenDay[qid] === "number" ? server.lastSeenDay[qid] : 0;
    if (v > prev) {
      server.lastSeenDay[qid] = v;
    }
  }

  // lastCorrectDayDelta: 各 qid の「最終正解日」をサーバー側に反映（YYYYMMDD 数値）
  for (const [qid, n] of Object.entries((delta as any).lastCorrectDayDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.lastCorrectDay) server.lastCorrectDay = {};
    const prev = typeof server.lastCorrectDay[qid] === "number" ? server.lastCorrectDay[qid] : 0;
    if (v > prev) {
      server.lastCorrectDay[qid] = v;
    }
  }

  // lastWrongDayDelta: 各 qid の「最終不正解日」をサーバー側に反映（YYYYMMDD 数値）
  for (const [qid, n] of Object.entries((delta as any).lastWrongDayDelta || {})) {
    const v = n as number;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!server.lastWrongDay) server.lastWrongDay = {};
    const prev = typeof server.lastWrongDay[qid] === "number" ? server.lastWrongDay[qid] : 0;
    if (v > prev) {
      server.lastWrongDay[qid] = v;
    }
  }

  // 3連続不正解関連 delta のサマリログ（どの qid に対して更新が入ったかを確認する用）
  try {
    const rawStreak3Wrong = (delta as any).streak3WrongDelta || {};
    const rawStreakWrongLen = (delta as any).streakWrongLenDelta || {};
    const keysStreak3Wrong = Object.keys(rawStreak3Wrong);
    const keysStreakWrongLen = Object.keys(rawStreakWrongLen);
    console.log("[SYNC/merge] (2-w) streak3WrongDelta / streakWrongLenDelta merged:", {
      hasStreak3WrongDelta: keysStreak3Wrong.length > 0,
      hasStreakWrongLenDelta: keysStreakWrongLen.length > 0,
      streak3WrongDeltaKeys: keysStreak3Wrong,
      streakWrongLenDeltaKeys: keysStreakWrongLen
    });
  } catch (_eLogWrong) {}

  // consistencyStatusDelta: consistency_status の差分反映
  // - payload が null の場合はキー削除
  // - それ以外はそのまま上書き
  const consistencyStatusDelta = (delta as any).consistencyStatusDelta || {};
  for (const [qid, payload] of Object.entries(consistencyStatusDelta)) {
    if (!server.consistency_status) {
      server.consistency_status = {};
    }
    if (payload === null) {
      delete server.consistency_status[qid];
      continue;
    }
    server.consistency_status[qid] = payload;
  }

  // favDelta: お気に入り状態の差分反映（fav_modal.js との連携専用）
  // - delta.fav = { [qid]: "unset" | "fav001" | "fav002" | "fav003" }
  //   → それぞれ UI 上の「★ー / ★1 / ★2 / ★3」に対応する
  // - 値は上記 4 種類の文字列のみ許可し、それ以外が混ざっている場合は 400 を返して処理を中断する
  // - フォールバックや自動変換は行わず、「送られてきた fav の内容」がそのままサーバー状態になる
  const favDelta = (delta as any).fav;
  if (favDelta !== undefined) {
    // delta.fav が存在するにもかかわらずプレーンオブジェクトでない場合はエラー扱い
    if (!favDelta || typeof favDelta !== "object" || Array.isArray(favDelta)) {
      console.error("[SYNC/merge] (favDelta-err) delta.fav がプレーンオブジェクトではありません:", {
        favDeltaType: typeof favDelta
      });
      return new Response("invalid favDelta: structure", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // server.fav が存在しない / 不正な場合はここで空オブジェクトとして初期化
    //
    // 【フォールバックに “見える” ポイント⑧: 欠落構造→空オブジェクト補完（fav）】
    // - 旧データや壊れたデータで server.fav が無い場合、ここで空にして処理を継続する。
    // - これにより “favが存在しない” は “fav={}” に置き換えられる。
    // - favDelta が来ていればこの後に値が入り、来ていなければ空のまま温存される。
    if (!server.fav || typeof server.fav !== "object") {
      server.fav = {};
    }

    // まず全エントリを検証し、不正なキー／値があれば即 400 を返す
    // - v は "unset" / "fav001" / "fav002" / "fav003" のいずれかであることを要求する（★ー / ★1 / ★2 / ★3）
    for (const [qid, raw] of Object.entries(favDelta as any)) {
      if (typeof qid !== "string" || !qid) {
        console.error("[SYNC/merge] (favDelta-err) delta.fav 内のキー(qid)が不正です:", {
          qid,
          value: raw
        });
        return new Response("invalid favDelta: qid", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }

      const v = raw as any;
      const isValidFavString =
        v === "unset" || v === "fav001" || v === "fav002" || v === "fav003";

      if (!isValidFavString) {
        console.error("[SYNC/merge] (favDelta-err) delta.fav 内の値が不正です:", {
          qid,
          value: v
        });
        return new Response("invalid favDelta: value", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    // ここまで到達したら全エントリが有効 → サーバー側 fav に反映
    // - server.fav[qid] には "unset" / "fav001" / "fav002" / "fav003" のいずれかをそのまま保存する
    for (const [qid, raw] of Object.entries(favDelta as any)) {
      const v = raw as "unset" | "fav001" | "fav002" | "fav003";
      server.fav[qid] = v;
    }

    // マージ結果をログに出して、どの qid が更新されたかを確認できるようにする
    try {
      console.log("[SYNC/merge] (favDelta) fav updated:", {
        keys: Object.keys(favDelta as any)
      });
    } catch (_eLog) {}
  }

  // global.totalQuestions: 総問題数の更新
  // - delta.global.totalQuestions に「正の有限数」が来ている場合のみ採用
  // - それ以外（未指定 / 0 以下 / NaN）は無視してサーバー状態を変えない
  try {
    const globalDelta = (delta as any).global;
    if (globalDelta && typeof globalDelta === "object") {
      const rawTq = (globalDelta as any).totalQuestions;
      const n = Number(rawTq);
      if (Number.isFinite(n) && n > 0) {
        if (!(server as any).global || typeof (server as any).global !== "object") {
          (server as any).global = {};
        }
        (server as any).global.totalQuestions = n;
        try {
          console.log("[SYNC/merge] (2-g) global.totalQuestions 更新:", {
            totalQuestions: n
          });
        } catch (_eLog) {}
      } else if (rawTq !== undefined) {
        try {
          console.warn("[SYNC/merge] (2-g-warn) 不正な totalQuestions が送信されたため無視します:", {
            raw: rawTq
          });
        // 【フォールバックに “見える” ポイント⑨: 不正入力は “無視して現状維持”】
        // - totalQuestions は UI 表示に使うことが多いので、値が変わらないと「反映されてない」に見える。
        // - ここはフォールバックではなく “更新拒否(keep previous)”。
        // - 送信が壊れていた場合でも、サーバーの既存値を守る設計。          
        } catch (_eWarn) {}
      }
    }
  } catch (_e) {
    try {
      console.warn("[SYNC/merge] (2-g-err) global.totalQuestions 処理中にエラーが発生しました");
    } catch (_e2) {}
  }

  // - streak3TodayDelta が送られてきた場合のみ処理
  // - 「今日の qids 一覧」をサーバー側にそのまま上書きする前に、
  //   day / qids / unique_count を徹底検証し、異常があれば 400 を返して処理を中断する
  if (streak3TodayDelta && typeof streak3TodayDelta === "object") {
    console.log("[SYNC/merge] (2-1) streak3Today: delta あり（検証開始）");

    const dayValue = (streak3TodayDelta as any).day;
    const qidsRaw = (streak3TodayDelta as any).qids;
    const uniqueCountRaw = (streak3TodayDelta as any).unique_count;

    // マージ前の構造チェック用ログ
    try {
      const tmpDay =
        typeof dayValue === "string"
          ? dayValue
          : "";
      const tmpQids = Array.isArray(qidsRaw) ? qidsRaw : [];
      console.log("[SYNC/merge] (2-1-1) streak3TodayDelta マージ前チェック:", {
        day: tmpDay,
        qidsIsArray: Array.isArray(qidsRaw),
        qidsLength: tmpQids.length,
        uniqueCountRaw
      });
    } catch (_e) {}

    // ---- fail-fast 検証 ----

    // day は「8桁（YYYYMMDD）」であることを要求する（string/number 両対応）
    const dayStrToday =
      typeof dayValue === "number"
        ? String(dayValue)
        : (typeof dayValue === "string" ? dayValue : "");

    if (!/^\d{8}$/.test(dayStrToday)) {
      console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.day が8桁(YYYYMMDD)でないため更新中断:", {
        dayValue
      });
      return new Response("invalid streak3TodayDelta: day format", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // qids は配列であることを要求する
    if (!Array.isArray(qidsRaw)) {
      console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.qids が配列ではないため更新中断:", {
        qidsRaw
      });
      return new Response("invalid streak3TodayDelta: qids", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // qids の各要素は文字列（qid）であることを要求する
    for (const q of qidsRaw) {
      if (typeof q !== "string") {
        console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.qids 内に文字列以外の要素があるため更新中断:", {
          invalidElement: q
        });
        return new Response("invalid streak3TodayDelta: qids element", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    const qids = qidsRaw as string[];
    const day = Number(dayStrToday);

    // unique_count が送られてきている場合は、qids.length と完全一致していることを要求する
    if (uniqueCountRaw !== undefined && uniqueCountRaw !== null) {
      const ucNum = Number(uniqueCountRaw);
      if (!Number.isFinite(ucNum) || ucNum < 0 || ucNum !== qids.length) {
        console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.unique_count が不整合のため更新中断:", {
          uniqueCountRaw,
          qidsLength: qids.length
        });
        return new Response("invalid streak3TodayDelta: unique_count", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    // ここまで到達したら検証は全て OK → streak3Today をフル上書きする
    (server as any).streak3Today = {
      day,
      unique_count: qids.length,
      qids
    };

    // 上書き後の内容を詳細にログ出力して、コンソール上から成功を確認できるようにする
    try {
      console.log("[SYNC/merge] (2-1-2) streak3Today バリデーション成功 → 上書き完了:", {
        day: (server as any).streak3Today.day,
        unique_count: (server as any).streak3Today.unique_count,
        qidsLength: Array.isArray((server as any).streak3Today.qids)
          ? (server as any).streak3Today.qids.length
          : -1
      });
    } catch (_e2) {}
  } else {
    // 今回の delta には streak3TodayDelta が含まれていない場合
    //
    // 【フォールバックに “見える” ポイント⑩: “更新しない＝現状維持” だが、初期テンプレ採用時は空が維持される】
    // - ここは「別の情報源へフォールバック」ではなく「このリクエストでは streak3Today を触らない」。
    // - ただし、(server) 初期化段階で KV.get が null だった場合、
    //   server.streak3Today はテンプレ {day:"", unique_count:0, qids:[]} になっている。
    // - その状態で delta が来なければ “空を維持” するだけなので、
    //   体感としては “今日の情報が0に戻った” ように見える。
    console.log("[SYNC/merge] (2-1) streak3Today: delta なし（更新スキップ）");
  }

  // ★ Streak3WrongTodayDelta のマージ処理
  //   - 本日の3連続不正解ユニーク（💣）の一覧をサーバー側に反映する
  //   - streak3WrongTodayDelta が送られてきた場合だけ検証し、day / qids / unique_count をチェックする
  if (streak3WrongTodayDelta && typeof streak3WrongTodayDelta === "object") {
    console.log("[SYNC/merge] (2-1w) streak3WrongToday: delta あり（検証開始）");

    const dayValueW = (streak3WrongTodayDelta as any).day;
    const qidsRawW = (streak3WrongTodayDelta as any).qids;
    const uniqueCountRawW = (streak3WrongTodayDelta as any).unique_count;

    // マージ前の構造チェック用ログ（💣版）
    try {
      const tmpDayW =
        typeof dayValueW === "string"
          ? dayValueW
          : "";
      const tmpQidsW = Array.isArray(qidsRawW) ? qidsRawW : [];
      console.log("[SYNC/merge] (2-1w-1) streak3WrongTodayDelta マージ前チェック:", {
        day: tmpDayW,
        qidsIsArray: Array.isArray(qidsRawW),
        qidsLength: tmpQidsW.length,
        uniqueCountRaw: uniqueCountRawW
      });
    } catch (_eW) {}

    // ---- fail-fast 検証（💣版）----

    // day は「8桁（YYYYMMDD）」であることを要求する（string/number 両対応）
    const dayStrWrongToday =
      typeof dayValueW === "number"
        ? String(dayValueW)
        : (typeof dayValueW === "string" ? dayValueW : "");

    if (!/^\d{8}$/.test(dayStrWrongToday)) {
      console.error("[SYNC/merge] (2-1w-err) streak3WrongTodayDelta.day が8桁(YYYYMMDD)でないため更新中断:", {
        dayValueW
      });
      return new Response("invalid streak3WrongTodayDelta: day format", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // qids は配列であることを要求する
    if (!Array.isArray(qidsRawW)) {
      console.error("[SYNC/merge] (2-1w-err) streak3WrongTodayDelta.qids が配列ではないため更新中断:", {
        qidsRawW
      });
      return new Response("invalid streak3WrongTodayDelta: qids", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // qids の各要素は文字列（qid）であることを要求する
    for (const q of qidsRawW) {
      if (typeof q !== "string") {
        console.error("[SYNC/merge] (2-1w-err) streak3WrongTodayDelta.qids 内に文字列以外の要素があるため更新中断:", {
          invalidElement: q
        });
        return new Response("invalid streak3WrongTodayDelta: qids element", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    const qidsW = qidsRawW as string[];
    const dayW = Number(dayStrWrongToday);

    // unique_count が送られてきている場合は、qids.length と完全一致していることを要求する
    if (uniqueCountRawW !== undefined && uniqueCountRawW !== null) {
      const ucNumW = Number(uniqueCountRawW);
      if (!Number.isFinite(ucNumW) || ucNumW < 0 || ucNumW !== qidsW.length) {
        console.error("[SYNC/merge] (2-1w-err) streak3WrongTodayDelta.unique_count が不整合のため更新中断:", {
          uniqueCountRawW,
          qidsLength: qidsW.length
        });
        return new Response("invalid streak3WrongTodayDelta: unique_count", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }

    // ここまで到達したら検証は全て OK → streak3WrongToday をフル上書きする
    (server as any).streak3WrongToday = {
      day: dayW,
      unique_count: qidsW.length,
      qids: qidsW
    };

    // 上書き後の内容を詳細にログ出力して、コンソール上から成功を確認できるようにする
    try {
      console.log("[SYNC/merge] (2-1w-2) streak3WrongToday バリデーション成功 → 上書き完了:", {
        day: (server as any).streak3WrongToday.day,
        unique_count: (server as any).streak3WrongToday.unique_count,
        qidsLength: Array.isArray((server as any).streak3WrongToday.qids)
          ? (server as any).streak3WrongToday.qids.length
          : -1
      });
    } catch (_eW2) {}
  } else {
    // 今回の delta には streak3WrongTodayDelta が含まれていない場合
    //
    // 【フォールバックに “見える” ポイント⑪: “更新しない＝現状維持” だが、初期テンプレ採用時は空が維持される】
    // - streak3WrongToday も streak3Today と同じ構造。
    // - KV miss / 旧データ欠落補完で空テンプレが入っていると、delta無し＝空のまま。
    console.log("[SYNC/merge] (2-1w) streak3WrongToday: delta なし（更新スキップ）");
  }

  // (2-2) AFTER: マージ後の server.streak3Today / server.streak3WrongToday をログ
  // - 上記のマージ処理の結果、サーバー側の「今日の⭐️ / 💣 ユニーク情報」がどうなったかの最終確認
  try {
    const afterSt3 = (server as any).streak3Today || null;
    console.log("[SYNC/merge] (2-3) AFTER server.streak3Today:", JSON.stringify(afterSt3));
  } catch (_e) {
    console.warn("[SYNC/merge] ★logging error (AFTER streak3Today)");
  }

  try {
    const afterSt3Wrong = (server as any).streak3WrongToday || null;
    console.log("[SYNC/merge] (2-3w) AFTER server.streak3WrongToday:", JSON.stringify(afterSt3Wrong));
  } catch (_eW3) {
    console.warn("[SYNC/merge] ★logging error (AFTER streak3WrongToday)");
  }

  // ---- oncePerDayTodayDelta のマージ ----
  // - oncePerDayTodayDelta が送られてきた場合のみ処理
  // - day / results を検証し、問題がなければ server.oncePerDayToday にマージまたは上書きする
  if (oncePerDayTodayDelta && typeof oncePerDayTodayDelta === "object") {
    console.log("[SYNC/merge] (2-4) oncePerDayToday: delta あり（検証開始）");

    const dayRaw = (oncePerDayTodayDelta as any).day;
    const resultsRaw = (oncePerDayTodayDelta as any).results;

    // マージ前の構造チェック用ログ
    try {
      console.log("[SYNC/merge] (2-4-1) oncePerDayTodayDelta マージ前チェック:", {
        day: dayRaw,
        resultsType: typeof resultsRaw
      });
    } catch (_e) {}

    // ---- fail-fast 検証 ----

    // day は Number（YYYYMMDD 相当の 8桁）であることを要求する
    if (typeof dayRaw !== "number" || !Number.isFinite(dayRaw)) {
      console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.day が不正のため更新中断:", {
        dayRaw
      });
      return new Response("invalid oncePerDayTodayDelta: day", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }
    const dayStr = String(dayRaw);
    if (!/^\d{8}$/.test(dayStr)) {
      console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.day が8桁数値でないため更新中断:", {
        dayRaw
      });
      return new Response("invalid oncePerDayTodayDelta: day format", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // results はプレーンオブジェクトであることを要求する
    if (!resultsRaw || typeof resultsRaw !== "object") {
      console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.results がオブジェクトでないため更新中断:", {
        resultsRaw
      });
      return new Response("invalid oncePerDayTodayDelta: results", {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // results の各要素: key は qid 文字列 / value は "correct" or "wrong"
    const cleanedResults: any = {};
    for (const [qid, v] of Object.entries(resultsRaw as any)) {
      if (typeof qid !== "string" || !qid) {
        console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.results 内のキーが不正:", {
          qid,
          value: v
        });
        return new Response("invalid oncePerDayTodayDelta: results key", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
      if (v !== "correct" && v !== "wrong") {
        console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.results 内の値が不正:", {
          qid,
          value: v
        });
        return new Response("invalid oncePerDayTodayDelta: results value", {
          status: 400,
          headers: { "Content-Type": "text/plain" }
        });
      }
      cleanedResults[qid] = v;
    }

    // ここまで到達したら検証は全て OK
    // 既存の oncePerDayToday と同じ day なら results をマージ、
    // day が違う場合は「新しい日」とみなして丸ごと置き換え
    const prev = (server as any).oncePerDayToday || { day: 0, results: {} };

    let mode: "reset" | "merge" = "reset";
    let mergedResults: any = {};

    if (prev && typeof prev === "object" && prev.day === dayRaw) {
      mode = "merge";
      mergedResults = prev.results && typeof prev.results === "object" ? { ...(prev.results as any) } : {};
      for (const [qid, v] of Object.entries(cleanedResults)) {
        mergedResults[qid] = v;
      }
    } else {
      // 【フォールバックに “見える” ポイント⑫: day が違うと “当日構造をリセット”】
      // - oncePerDayToday は「本日分」のみを保持する設計。
      // - day が変わったら、前日の results を残すのではなく “新しい日として丸ごと置き換え” する。
      // - これはフォールバックではなく仕様上の reset。
      // - UIから見ると “記録が消えた” に見えるが、「前日分を保持しない」という仕様によるもの。
      mode = "reset";
      mergedResults = cleanedResults;
    }

    (server as any).oncePerDayToday = {
      day: dayRaw,
      results: mergedResults
    };

    // マージ後の結果をログ出力して、コンソールから成功を確認できるようにする
    try {
      const snap = (server as any).oncePerDayToday || null;
      console.log("[SYNC/merge] (2-4-2) oncePerDayToday 更新完了:", {
        mode,
        day: snap ? snap.day : null,
        resultsKeysLength:
          snap && snap.results && typeof snap.results === "object"
            ? Object.keys(snap.results).length
            : 0
      });
    } catch (_e2) {}
  } else {
    // 今回の delta には oncePerDayTodayDelta が含まれていない場合
    console.log("[SYNC/merge] (2-4) oncePerDayToday: delta なし（更新スキップ）");
  }

  // O.D.O.A Mode (odoa_mode) が送られてきた場合だけモード状態を更新
  // - delta.odoa_mode は "on" / "off" のいずれかの文字列を期待する
  const odoaModeRaw =
    typeof (delta as any).odoa_mode === "string"
      ? (delta as any).odoa_mode
      : null;

  if (odoaModeRaw !== null) {
    const prevMode = (server as any).odoa_mode;
    if (odoaModeRaw === "on" || odoaModeRaw === "off") {
      (server as any).odoa_mode = odoaModeRaw;
      try {
        console.log("[SYNC/merge] (2-5) O.D.O.A Mode 更新:", {
          prev: prevMode,
          next: (server as any).odoa_mode
        });
      } catch (_e) {}
    } else {
      // 想定外の値が送られてきた場合は無視し、ログだけ残す
      try {
        console.warn("[SYNC/merge] (2-5-warn) 不正な odoa_mode が送信されたため無視します:", {
          recv: odoaModeRaw
        });
      } catch (_e2) {}
    }
  }

  // exam_date_iso (YYYY-MM-DD) が送られてきた場合だけ exam_date を更新
  // - 「試験日を変更する」用途のためのフィールド
  const examDateIsoRaw =
    typeof (delta as any).exam_date_iso === "string"
      ? (delta as any).exam_date_iso
      : null;


  // 【フォールバックに “見える” ポイント⑬: 不正な exam_date は “無視して現状維持”】
  // - exam_date は「新しい日付に常に上書き」ポリシーだが、
  //   そもそもフォーマットが不正なら server.exam_date を変更しない（= keep previous）。
  // - UIからは「更新できなかった」に見えるので、必要なら warn ログを追加すると切り分けが楽。
  if (examDateIsoRaw) {
    const m = examDateIsoRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d);
      // 不正な日付（例: 2025-02-31）を弾くために Date オブジェクトで再検証
      if (
        !Number.isNaN(dt.getTime()) &&
        dt.getFullYear() === y &&
        dt.getMonth() === mo &&
        dt.getDate() === d
      ) {
        (server as any).exam_date = examDateIsoRaw;
      }
    }
  }

  // ★ 実更新チェック：updatedAt を触る前に server が変化したか判定
  // - 「キーはあるがバリデーションで全スキップ」等のケースでは put しない
  const serverAfterMergeSnapshot = JSON.stringify(server);

  if (serverAfterMergeSnapshot === serverBeforeMergeSnapshot) {
    console.log("[SYNC/merge] NO_EFFECTIVE_UPDATE_SKIP_PUT");

    const responseObj = Object.assign({}, server, {
      __cscs_merge: {
        putExecuted: false,
        putBefore: null,
        putAfter: null
      }
    });

    return new Response(JSON.stringify(responseObj), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  }

  // 今回の merge 処理がいつ行われたかのタイムスタンプを保存（★実更新がある時だけ）
  server.updatedAt = Date.now();

  // (3) KV 保存＋ (4) 保存直後の dump
  try {

    // ★ streak3TodayDelta が無い場合は server.streak3Today を一切変更しない
    //   - delta が届いたときだけ (2-1) の処理で上書きし、その結果をそのまま KV に保存する
    //   - ここでは「今回のリクエストで streak3Today に手を入れたかどうか」をログだけ残す
    try {
      const beforeGuardSt3 = (server as any).streak3Today || null;
      const hasDeltaForToday =
        streak3TodayDelta && typeof streak3TodayDelta === "object" ? true : false;

      const beforeGuardSt3Wrong = (server as any).streak3WrongToday || null;
      const hasDeltaForTodayWrong =
        streak3WrongTodayDelta && typeof streak3WrongTodayDelta === "object" ? true : false;

      const beforeGuardOnce = (server as any).oncePerDayToday || null;
      const hasOncePerDayDelta =
        oncePerDayTodayDelta && typeof oncePerDayTodayDelta === "object" ? true : false;

      console.log("[SYNC/merge][guard] streak3TodayDelta 判定:", {
        hasDelta: hasDeltaForToday,
        willUpdate: hasDeltaForToday,
        streak3TodaySnapshot: beforeGuardSt3
      });
      console.log("[SYNC/merge][guard] streak3WrongTodayDelta 判定:", {
        hasDelta: hasDeltaForTodayWrong,
        willUpdate: hasDeltaForTodayWrong,
        streak3WrongTodaySnapshot: beforeGuardSt3Wrong
      });
      console.log("[SYNC/merge][guard] oncePerDayTodayDelta 判定:", {
        hasDelta: hasOncePerDayDelta,
        willUpdate: hasOncePerDayDelta,
        oncePerDayTodaySnapshot: beforeGuardOnce
      });
    } catch (_e) {
      console.warn("[SYNC/merge][guard] logging error (streak3Today / streak3WrongToday / oncePerDayToday snapshot)");
    }

    const jsonStr = JSON.stringify(server);

    // ★ put 前ログ（payloadサイズと updatedAt）
    console.log("[SYNC/merge][PUT] before", {
      key,
      bytes: jsonStr.length,
      updatedAt: (server as any).updatedAt
    });

    // ★ 追加: put 直前に「実際に put しようとしている object」を確定させてログを出す
    // - beforePut は「KV に保存する元データ（server）」そのもの
    // - payloadType/payloadKeys で「空テンプレしか入ってない」「期待キーが無い」を一発で切る
    const beforePut = server; // 実際に put しようとしている object
    console.log("[SYNC/merge][PUT TRY]", {
      key,
      hasPayload: !!beforePut,
      payloadType: typeof beforePut,
      payloadKeys: beforePut && typeof beforePut === "object" ? Object.keys(beforePut as any) : null,
    });

    // ★ KV.put 本体（例外は絶対に潰さない）
    try {
      // ★ [STEP 3][証拠ログ] PUT 実行直前
      // - 本当に「これから KV.put を呼ぶ」瞬間を確定ログとして残す
      // - key / updatedAt / 書き込みサイズ(bytes) を必ず出す
      putDiagBefore = {
        key,
        updatedAt: (server as any).updatedAt,
        bytes: JSON.stringify(beforePut).length
      };
      console.log("[SYNC][MERGE][PUT][BEFORE]", putDiagBefore);

      await env.SYNC.put(key, JSON.stringify(beforePut));

      putExecuted = true;
      putDiagAfter = {
        key,
        updatedAt: (server as any).updatedAt
      };

      // ★ [STEP 3][証拠ログ] PUT 実行直後
      // - await が正常に戻った＝put が「成功した」ことを確定させる
      console.log("[SYNC][MERGE][PUT][AFTER]", putDiagAfter);

      // ★ 既存: read-after-write で「本当に KV に入ったか」を即検証する
      const verify = await env.SYNC.get(key, "text");
      console.log("[SYNC/merge][PUT VERIFY]", {
        key,
        textBytes: verify ? verify.length : 0,
        textHead: verify ? verify.slice(0, 200) : null
      });

      console.log("[SYNC/merge][PUT] OK", { key });
    } catch (e) {
      console.error("[SYNC/merge][PUT] FAILED", {
        key,
        error: e
      });
      throw e;
    }

    console.log("[SYNC/merge] (3-0) ★KV write:", { key, bytes: jsonStr.length, updatedAt: (server as any).updatedAt, kv_identity: kvIdentityId });
    console.log("[SYNC/merge] (3) ★KV保存成功:", {
      key,
      streak3Today: (server as any).streak3Today
    });

    // ★★★ 決定打：read-after-write（同じ key を即 get） ★★★
    try {
      const readBackText = await env.SYNC.get(key, "text");

      if (readBackText === null) {
        console.error("[SYNC/merge][READ-AFTER-WRITE] NULL", {
          key,
          note: "KV.put直後だが get(text) が null"
        });
      } else {
        let parsedUpdatedAt: number | null = null;
        try {
          const parsed = JSON.parse(readBackText);
          parsedUpdatedAt =
            parsed && typeof parsed.updatedAt === "number"
              ? parsed.updatedAt
              : null;
        } catch (_e) {}

        console.log("[SYNC/merge][READ-AFTER-WRITE] OK", {
          key,
          textBytes: readBackText.length,
          updatedAtWritten: (server as any).updatedAt,
          updatedAtReadBack: parsedUpdatedAt,
          sameUpdatedAt: parsedUpdatedAt === (server as any).updatedAt
        });
      }
    } catch (e) {
      console.error("[SYNC/merge][READ-AFTER-WRITE] FAILED", {
        key,
        error: e
      });
    }

    // streak3Today フィールドが「unique_count === qids.length」を満たしているかの自己整合性チェック
    // - 本日の3連続正解ユニーク数について、保存された配列長とカウント値が一致しているかを確認する
    try {
      const s3 = (server as any).streak3Today || null;
      const qlen =
        s3 && Array.isArray(s3.qids) ? (s3.qids as any[]).length : -1;
      console.log("[SYNC/merge] (3-1) streak3Today 整合性チェック:", {
        day: s3 ? s3.day : null,
        unique_count: s3 ? s3.unique_count : null,
        qidsLength: qlen,
        isConsistent:
          s3 && Array.isArray(s3.qids)
            ? s3.unique_count === qlen
            : false
      });
    } catch (_e2) {
      console.warn("[SYNC/merge] (3-1 err) streak3Today 整合性ログ失敗");
    }

    // streak3WrongToday フィールドが「unique_count === qids.length」を満たしているかの自己整合性チェック
    // - 本日の3連続不正解ユニーク数についても、サーバー保存直後に配列長とカウント値の整合を確認する
    try {
      const s3w = (server as any).streak3WrongToday || null;
      const qlenW =
        s3w && Array.isArray(s3w.qids) ? (s3w.qids as any[]).length : -1;
      console.log("[SYNC/merge] (3-1w) streak3WrongToday 整合性チェック:", {
        day: s3w ? s3w.day : null,
        unique_count: s3w ? s3w.unique_count : null,
        qidsLength: qlenW,
        isConsistent:
          s3w && Array.isArray(s3w.qids)
            ? s3w.unique_count === qlenW
            : false
      });
    } catch (_e3) {
      console.warn("[SYNC/merge] (3-1w err) streak3WrongToday 整合性ログ失敗");
    }

    // (4) 保存直後に KV から再取得 → parsed.streak3Today を確認
    // - 実際に KV に書き込まれた JSON が期待通りかどうか、もう一度読み出して検証する
    try {
      const raw = await env.SYNC.get(key, "text");
      console.log("[SYNC/merge] (4-1) ★KV直後ダンプ(raw):", raw);

      try {
        const parsed = raw ? JSON.parse(raw) : null;
        const s3t = parsed ? (parsed as any).streak3Today : null;
        console.log("[SYNC/merge] (4-2) ★KV直後ダンプ(parsed.streak3Today):", s3t);
      } catch (e2) {
        console.warn("[SYNC/merge] (4-err) ★KV直後ダンプ(JSON.parse失敗)", e2);
      }
    } catch (e1) {
      console.warn("[SYNC/merge] (4-err) ★KV直後ダンプ取得失敗", e1);
    }
  } catch (e) {
    // KV.put 自体が失敗した場合のエラーハンドリング
    console.error("[SYNC/merge] (3-err) ★KV保存失敗", e);
    console.log("[SYNC/merge] === onRequestPost END (KV put failed) ===");
    console.log("====================================================");
    return new Response("KV put failed", {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }

  // 正常終了時のログ
  try {
    console.log("[SYNC/merge] === onRequestPost END (OK) ===");
    console.log("====================================================");
  } catch (_e) {}

  // クライアントには、マージ後の server スナップショット全体を返す
  // - UI巻き戻り対策A: 「POSTの返答 = 確定版(merged state)」として扱えるように、
  //   キャッシュ禁止ヘッダを付けて返す（中継/ブラウザに古い返答を掴ませない）
  // - 成功確認: レスポンス直前に updatedAt / サイズ / 主要キーをログ出力する
  try {
    const responseObj = Object.assign({}, server, {
      __cscs_merge: {
        putExecuted: putExecuted,
        putBefore: putDiagBefore,
        putAfter: putDiagAfter
      }
    });

    const resJson = JSON.stringify(responseObj);

    const reqId = crypto.randomUUID();
    const cfAny: any = (request as any).cf || {};
    const colo = typeof cfAny.colo === "string" ? cfAny.colo : "";
    const ray = request.headers.get("CF-Ray") || "";

    const odoaModeNow =
      typeof (server as any).odoa_mode === "string"
        ? (server as any).odoa_mode
        : "";

    const updatedAtNow =
      typeof (server as any).updatedAt === "number"
        ? String((server as any).updatedAt)
        : "";

    console.log("[SYNC/merge][diag] response headers snapshot:", {
      reqId,
      user,
      key,
      colo,
      ray,
      kv_identity: kvIdentityId,
      odoa_mode: odoaModeNow,
      updatedAt: updatedAtNow
    });

    console.log("[SYNC/merge] (5) ★RESPONSE merged state (no-store):", {
      key,
      updatedAt: (server as any).updatedAt,
      bytes: resJson.length,
      hasStreak3Today: Object.prototype.hasOwnProperty.call(server as any, "streak3Today"),
      hasStreak3WrongToday: Object.prototype.hasOwnProperty.call(server as any, "streak3WrongToday"),
      hasOncePerDayToday: Object.prototype.hasOwnProperty.call(server as any, "oncePerDayToday")
    });

    return new Response(resJson, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",

        // ★KVバインディング診断ヘッダ（ブラウザNetworkで一発突き合わせ用）
        "X-CSCS-KV-Binding": "SYNC",
        "X-CSCS-KV-Identity": kvIdentityId,

        // ★Pages デプロイ実体診断ヘッダ（preview / production / 別デプロイを一発で確定）
        "X-CSCS-Pages-Project": typeof (env as any).CF_PAGES_PROJECT_NAME === "string" ? String((env as any).CF_PAGES_PROJECT_NAME) : "",
        "X-CSCS-Pages-Branch": typeof (env as any).CF_PAGES_BRANCH === "string" ? String((env as any).CF_PAGES_BRANCH) : "",
        "X-CSCS-Pages-Commit": typeof (env as any).CF_PAGES_COMMIT_SHA === "string" ? String((env as any).CF_PAGES_COMMIT_SHA) : "",
        "X-CSCS-Pages-Deploy": typeof (env as any).CF_PAGES_DEPLOYMENT_ID === "string" ? String((env as any).CF_PAGES_DEPLOYMENT_ID) : "",

        // ★KV binding 実体診断ヘッダ（state と merge で env.SYNC が同じ“形”か確認）
        "X-CSCS-KV-HasEnvSYNC": (env as any).SYNC ? "1" : "0",
        "X-CSCS-KV-HasGet": (env as any).SYNC && typeof (env as any).SYNC.get === "function" ? "1" : "0",
        "X-CSCS-KV-HasPut": (env as any).SYNC && typeof (env as any).SYNC.put === "function" ? "1" : "0",
        "X-CSCS-KV-HasDelete": (env as any).SYNC && typeof (env as any).SYNC.delete === "function" ? "1" : "0",

        "X-CSCS-ReqId": reqId,
        "X-CSCS-User": user,
        "X-CSCS-Key": key,
        "X-CSCS-Colo": colo,
        "X-CSCS-CF-Ray": ray,
        "X-CSCS-UpdatedAt": updatedAtNow,
        "X-CSCS-OdoaMode": odoaModeNow
      },
    });
  } catch (e) {
    console.error("[SYNC/merge] (5-err) ★RESPONSE stringify failed:", e);
    return new Response("response json failed", {
      status: 500,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }
    });
  }
};

async function getUserIdFromAccess(request: Request) {
  // Cloudflare Access の JWT からユーザーの email を取り出し、
  // ユーザーごとの SYNC キー（sync:<email>）を作るための ID として使う
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    // 【フォールバックに “見える” 可能性があるポイント⑭: 認証ヘッダー欠落→401】
    // - getUserIdFromAccess はヘッダーが無ければ空文字を返す。
    // - 呼び出し元 onRequestPost は `if (!user)` で 401 を返すため、
    //   merge.ts 自体は “テンプレを返す” ことはしない（明示的に失敗で止める）。
    // - ただしフロントが 401 を “未同期扱い” としてUIを初期化すると、
    //   体感では “0に戻った/テンプレに戻った” に近く見える。
    console.error("[SYNC/merge] CF-Access-Jwt-Assertion header missing.");
    return "";
  }

  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      console.error("[SYNC/merge] invalid JWT format (parts length !== 3).");
      return "";
    }
    const payloadJson = atob(parts[1]);
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload.email !== "string" || !payload.email) {
      console.error("[SYNC/merge] JWT payload does not contain valid email.", payload);
      return "";
    }
    return payload.email as string;
  } catch (e) {
    console.error("[SYNC/merge] JWT decode/parse error.", e);
    return "";
  }
}