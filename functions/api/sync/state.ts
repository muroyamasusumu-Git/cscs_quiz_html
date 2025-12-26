// functions/api/sync/state.ts
/**
 * CSCS SYNC state 取得エンドポイント（Workers 側）
 *
 * 【キー対応表（LocalStorage ⇔ SYNC state ⇔ delta payload）】
 *  ※merge.ts と同じキー設計を共有する。state.ts / merge.ts のどちらかで
 *    新しくキーを追加／既存キー名を変更した場合は、両方の表を必ず更新すること（恒久ルール）。
 *
 * ▼ 問題別累計
 *   - localStorage: "cscs_q_correct_total:" + qid
 *       ⇔ SYNC state: correct[qid]
 *       ⇔ delta payload: correctDelta[qid]
 *   - localStorage: "cscs_q_wrong_total:" + qid
 *       ⇔ SYNC state: incorrect[qid]
 *       ⇔ delta payload: incorrectDelta[qid]
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage: "cscs_q_correct_streak3_total:" + qid
 *       ⇔ SYNC state: streak3[qid]
 *       ⇔ delta payload: streak3Delta[qid]
 *   - localStorage: "cscs_q_correct_streak_len:" + qid
 *       ⇔ SYNC state: streakLen[qid]
 *       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ 問題別 3 連続不正解（💣用）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *   - localStorage: "cscs_q_wrong_streak_len:" + qid
 *       ⇔ SYNC state: streakWrongLen[qid]
 *       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ Streak3Today（本日の⭐️ユニーク数）
 *   - localStorage: "cscs_streak3_today_day"
 *       ⇔ SYNC state: streak3Today.day
 *       ⇔ delta payload: streak3TodayDelta.day
 *   - localStorage: "cscs_streak3_today_qids"
 *       ⇔ SYNC state: streak3Today.qids
 *       ⇔ delta payload: streak3TodayDelta.qids
 *   - localStorage: "cscs_streak3_today_unique_count"
 *       ⇔ SYNC state: streak3Today.unique_count
 *       ⇔ delta payload: streak3TodayDelta.unique_count（省略可）
 *
 * ▼ Streak3WrongToday（本日の3連続不正解ユニーク数）
 *   - localStorage: "cscs_streak3_wrong_today_day"
 *       ⇔ SYNC state: streak3WrongToday.day
 *       ⇔ delta payload: streak3WrongTodayDelta.day
 *   - localStorage: "cscs_streak3_wrong_today_qids"
 *       ⇔ SYNC state: streak3WrongToday.qids
 *       ⇔ delta payload: streak3WrongTodayDelta.qids
 *   - localStorage: "cscs_streak3_wrong_today_unique_count"
 *       ⇔ SYNC state: streak3WrongToday.unique_count
 *       ⇔ delta payload: streak3WrongTodayDelta.unique_count（省略可）
 *
 * ▼ oncePerDayToday（1日1回まで計測）
 *   - localStorage: "cscs_once_per_day_today_day"
 *       ⇔ SYNC state: oncePerDayToday.day
 *       ⇔ delta payload: oncePerDayTodayDelta.day
 *   - localStorage: "cscs_once_per_day_today_results"
 *       ⇔ SYNC state: oncePerDayToday.results[qid]
 *       ⇔ delta payload: oncePerDayTodayDelta.results[qid]
 *
 * ▼ 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）
 *   - localStorage: "cscs_q_last_seen_day:" + qid
 *       ⇔ SYNC state: lastSeenDay[qid]
 *       ⇔ delta payload: lastSeenDayDelta[qid]
 *   - localStorage: "cscs_q_last_correct_day:" + qid
 *       ⇔ SYNC state: lastCorrectDay[qid]
 *       ⇔ delta payload: lastCorrectDayDelta[qid]
 *   - localStorage: "cscs_q_last_wrong_day:" + qid
 *       ⇔ SYNC state: lastWrongDay[qid]
 *       ⇔ delta payload: lastWrongDayDelta[qid]
 *
 * ▼ お気に入り状態
 *   - localStorage: （fav_modal.js 内部管理）
 *       ⇔ SYNC state: fav[qid]
 *       ⇔ delta payload: fav[qid] ("unset" | "fav001" | "fav002" | "fav003")  // ★ー / ★1 / ★2 / ★3
 *
 * ▼ グローバル情報
 *   - localStorage: "cscs_total_questions"
 *       ⇔ SYNC state: global.totalQuestions
 *       ⇔ delta payload: global.totalQuestions
 *
 * ▼ 整合性ステータス（consistency_status）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: consistency_status[qid]
 *       ⇔ delta payload: consistencyStatusDelta[qid]
 *
 * ▼ 試験日設定（exam_date）
 *   - localStorage: （直接保存はしない / SYNC 専用）
 *       ⇔ SYNC state: exam_date (YYYY-MM-DD)
 *       ⇔ delta payload: exam_date_iso (YYYY-MM-DD)
 *
 * ▼ O.D.O.A / 検証モード関連
 *   - runtime: window.CSCS_VERIFY_MODE ("on" / "off")
 *       ⇔ SYNC state: odoa_mode ("on" / "off")
 *       ⇔ delta payload: odoa_mode
 */
export const onRequestGet: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // ★ Origin チェック（同一ドメイン＋ローカル開発のみ許可）
  const origin = request.headers.get("Origin");
  const allowedOrigins = [
    "https://cscs-quiz-html.pages.dev", // 本番
    "http://localhost:8789"             // ローカル開発
  ];

  if (origin !== null && !allowedOrigins.includes(origin)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain" }
    });
  }

  const user = await getUserIdFromAccess(request);
  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain" }
    });
  }

  // =============================
  // state.ts : KEY MUST BE PROVIDED (align with merge.ts)
  // =============================
  // ★ /api/sync/state も必ず key を要求する（空テンプレで誤魔化さない）
  const headerKeyRaw = request.headers.get("X-CSCS-Key") || "";
  const headerKey = typeof headerKeyRaw === "string" ? headerKeyRaw.trim() : "";

  if (!headerKey) {
    const body = JSON.stringify({
      ok: false,
      __cscs_warn: { code: "SYNC_STATE_MISSING_KEY", message: "X-CSCS-Key is required for /api/sync/state" }
    });
    return new Response(body, {
      status: 400,
      headers: {
        "content-type": "application/json",
        "Cache-Control": "no-store",
        "X-CSCS-IsEmptyTemplate": "1",
        "X-CSCS-Warn": "SYNC_STATE_MISSING_KEY"
      }
    });
  }

  // ★ user / key を確定させる（merge.ts と突き合わせるため）
  const userRaw = user;
  const userNormalized = typeof userRaw === "string" ? userRaw.trim().toLowerCase() : "";
  const expectedKey = `sync:${userNormalized}`;

  // ★ 不一致なら拒否（別keyで読まれたら事故る）
  if (headerKey !== expectedKey) {
    const body = JSON.stringify({
      ok: false,
      __cscs_warn: { code: "SYNC_STATE_KEY_MISMATCH", message: "X-CSCS-Key does not match authenticated user" }
    });
    return new Response(body, {
      status: 403,
      headers: {
        "content-type": "application/json",
        "Cache-Control": "no-store",
        "X-CSCS-Warn": "SYNC_STATE_KEY_MISMATCH",
        "X-CSCS-Key": headerKey,
        "X-CSCS-ExpectedKey": expectedKey
      }
    });
  }

  const key = headerKey;

  console.log("[SYNC/state][KEY] resolved", {
    userRaw,
    userNormalized,
    key
  });

  let kvIdentityId = "";

  try {
    console.log("====================================================");
    console.log("[SYNC/state] === onRequestGet START ===");
    console.log("[SYNC/state] user:", user);
    console.log("[SYNC/state] key :", key);

    // ★KVバインディング診断（このFunctionsがどのKVを“掴んでいるか”の判定材料）
    // - binding名はコード上は固定で "SYNC"
    // - envにSYNCが存在するか、get/put/delete が生えているかを出す（binding実体がKVとして機能しているかの確認）
    // - env keys を「全件」出す（preview/prod 等で env の見え方が違うのを確実に切り分ける）
    // - requestの Host / CF-Ray / colo を出す（別デプロイ/別経路の切り分け材料）
    const envAny: any = env as any;
    const envKeys = envAny && typeof envAny === "object" ? Object.keys(envAny).sort() : [];
    const syncAny: any = envAny ? envAny.SYNC : undefined;

    console.log("[SYNC/state][KV-DIAG] bindingName:", "SYNC");
    console.log("[SYNC/state][KV-DIAG] env keys (all):", envKeys);

    console.log("[SYNC/state][KV-DIAG] binding check:", {
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
    console.log("[SYNC/state][KV-DIAG] request route snapshot:", {
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

    console.log("[SYNC/state][PAGES-DIAG] pages meta:", {
      project: pagesProject,
      branch: pagesBranch,
      commit: pagesCommitSha,
      deployment: pagesDeploymentId
    });

    // ★KV identity 証明（読むだけ）
    // - 目的: merge.ts が作った diag:kv_identity を state.ts でも読めることを示す
    // - 方針: state.ts は put しない（余計な書き込みを増やさない）
    // - 成功確認: get/parse 成功と kvIdentityId をログに出す
    const kvIdentityKey = "diag:kv_identity";
    try {
      const kvIdentityRaw = await env.SYNC.get(kvIdentityKey, "text");
      console.log("[SYNC/state][KV-IDENTITY] get OK:", {
        hasValue: !!kvIdentityRaw
      });

      if (kvIdentityRaw) {
        const parsed = JSON.parse(kvIdentityRaw);
        kvIdentityId = parsed && typeof parsed.id === "string" ? parsed.id : "";
        console.log("[SYNC/state][KV-IDENTITY] parsed:", {
          key: kvIdentityKey,
          id: kvIdentityId
        });
      } else {
        console.warn("[SYNC/state][KV-IDENTITY] missing (not created yet):", {
          key: kvIdentityKey
        });
      }
    } catch (e) {
      console.error("[SYNC/state][KV-IDENTITY] get/parse FAILED:", e);
      kvIdentityId = "";
    }
  } catch (_e) {}

  // -----------------------------
  // 1) KV から読み出し
  // -----------------------------

  // ★ text get（json が null でも text が取れるかを見る）
  let dataText: string | null = null;
  let textGetError: any = null;

  try {
    dataText = await env.SYNC.get(key, "text");
  } catch (e) {
    textGetError = e;
  }

  // ★ json get
  let dataJson: any = null;
  let jsonGetError: any = null;

  try {
    dataJson = await env.SYNC.get(key, { type: "json", cacheTtl: 0 });
  } catch (e) {
    jsonGetError = e;
  }

  // ★ 追加した処理0: 「json が null だが text は取れている」ズレを正す（同一KV内で完結）
  // - 何をしているか: KV.get(json) が null/例外でも、同じ key の KV.get(text) が non-null なら JSON.parse を試みる
  // - 目的: 「KVに実データが入っているのに state が empty を返す」状況を排除する（別ソースのフォールバックではなく、同一KVの別取得方式で整合させる）
  // - 注意: parse に失敗した場合は“埋め合わせ”はしない（dataJson は null のまま）→ 以降の empty 判定が働く
  if (dataJson === null && dataText !== null) {
    try {
      const parsedFromText = JSON.parse(dataText);
      dataJson = parsedFromText;
      console.log("[SYNC/state][JSON-SALVAGE] json was null -> parsed from text OK", {
        key
      });
    } catch (e) {
      console.warn("[SYNC/state][JSON-SALVAGE] json was null -> JSON.parse(text) FAILED", {
        key,
        error: String(e)
      });
    }
  }

  // ★ 追加した処理1: text の「UTF-8バイト長」を算出する
  // - 何をしているか: dataText.length（文字数）ではなく、実際に KV に入っている JSON 文字列の「バイト感」を確認する
  // - 目的: 「textは取れてるがサイズが0/異常」「巨大すぎる/途中で壊れてる」などをログだけで切り分ける
  let textBytesUtf8 = 0;
  try {
    if (dataText !== null) {
      textBytesUtf8 = new TextEncoder().encode(dataText).length;
    }
  } catch (_e) {
    textBytesUtf8 = dataText ? dataText.length : 0;
  }

  // ★ 追加した処理2: text の冒頭/末尾を固定長で切り出す（検索性＆破損判定のため）
  // - 何をしているか: 先頭300文字＋末尾200文字を出す
  // - 目的: 「json型はnullなのにtextは取れている」ケースで、実際の中身がJSONっぽいか/途中欠損かを一発で見る
  const textHead = dataText ? dataText.slice(0, 300) : null;
  const textTail = dataText ? dataText.slice(Math.max(0, dataText.length - 200)) : null;

  // ★ 追加した処理3: json の型情報も併記する（object / null / array など）
  // - 何をしているか: dataJson の typeof と Array判定をログ化
  // - 目的: KVのjson取得が「null」なのか「空オブジェクト」なのか「配列」なのかを即判定できるようにする
  const jsonType =
    dataJson === null
      ? "null"
      : Array.isArray(dataJson)
        ? "array"
        : typeof dataJson;

  // ★ RAW（検索しやすい形で確定）
  // - JSONは「実オブジェクト」を出す（null/empty/型崩れの判定が一発）
  // - textは「長さ＋冒頭＋末尾」を出す（“実際に入ってるのにjsonでnull”の切り分け）
  // - error は必ず String 化して1行検索できる形に統一
  console.log("[STATE][KV RAW]", {
    key,
    json: dataJson,
    jsonType,
    textChars: dataText ? dataText.length : 0,
    textBytesUtf8,
    textHead,
    textTail,
    jsonGetError: jsonGetError ? String(jsonGetError) : null,
    textGetError: textGetError ? String(textGetError) : null
  });

  // ★ 結果を1行で確定
  // - 何をしているか: KV.get(json) と KV.get(text) の成否を、必ず1行で確定させる
  // - 目的: 「ログが多すぎて追えない」時でも、この1行だけ見れば “取れてる/取れてない” を判定できる
  console.log("[SYNC/state][GET] result", {
    key,
    jsonGet: dataJson === null ? "null" : "non-null",
    jsonType,
    jsonGetError: jsonGetError ? String(jsonGetError) : null,
    textGet: dataText === null ? "null" : "non-null",
    textChars: dataText ? dataText.length : 0,
    textBytesUtf8
  });

  // ★ empty テンプレに落ちた理由を1行で明示
  // - 何をしているか: json取得がnullだった事実だけを明示（埋め合わせはしない）
  // - 目的: “emptyテンプレが返る条件” をログ検索で即特定する
  if (dataJson === null) {
    console.warn("[SYNC/state][EMPTY-TEMPLATE-REASON]", {
      reason: "KV.get(json) returned null (and JSON.parse(text) salvage did not produce json)",
      key
    });
  }

  // ★ 既存ロジック互換：以降は従来どおり data を参照する
  // - out = data ? data : empty; の分岐を壊さないため、data は最終的な json（salvage後）を採用する
  let data: any = dataJson;

  // -----------------------------
  // 2) empty テンプレ（補完用）
  // -----------------------------
  const empty = {
    correct: {},
    incorrect: {},
    streak3: {},
    streakLen: {},
    // 3連続不正解の累計・現在ストリークも SYNC に必ず載せるための初期構造
    streak3Wrong: {},
    streakWrongLen: {},
    lastSeenDay: {},
    lastCorrectDay: {},
    lastWrongDay: {},
    consistency_status: {},
    // お気に入り状態（fav_modal.js 用）
    fav: {},
    // グローバルメタ情報（総問題数など）を保持する領域
    global: {},
    // O.D.O.A Mode の初期値（未保存ユーザー用に "off" で補完する）
    odoa_mode: "off",
    // ★ここでは streak3Today / streak3WrongToday / oncePerDayToday を追加しない（消失確認のため上書き禁止）
    updatedAt: 0
  };

  // -----------------------------
  // 3) out 生成（補完）
  // -----------------------------
  // 【重要】ここが “暗黙フォールバック” の本体
  // - data は KV.get(key, json) の結果
  // - KV に保存が無い / 取り出し失敗 / null が返った場合、data は null になりうる
  // - そのとき out は empty に差し替わる（=「KV miss を empty で置き換える」）
  //
  // つまり:
  //   out = data ? data : empty;
  // は、挙動としては
  //   「KVの実データが取れない → 初期テンプレ（odoa_mode:"off"等）を “正しいstate” として返す」
  // になっている。
  //
  // この方式の危険点:
  // - “未保存” と “本当に off” を区別できない（UIが off に戻されたように見える）
  // - もし KV miss が一時的に起きると、ユーザーの体感では「設定が勝手にOFFになった」に見える
  let out: any = data ? data : empty;

  // ★ empty テンプレ返却 “確定” ログ（Workers側で一発判定）
  // - 目的: 「KVからstateを取得できていない → out=empty を選択 → サーバーがempty返却を宣言」
  //         の3点を、ログ1行で確定できるようにする。
  // - 判定基準: data が truthy でなければ out は empty（=KV未取得/未保存/取得失敗を区別せず empty返却）
  // - 注意: ここで “別ソースから埋め合わせ” はしない（フォールバック禁止方針）
  const isEmptyTemplate = data ? "0" : "1";
  if (isEmptyTemplate === "1") {
    try {
      console.warn("[SYNC/state][EMPTY-TEMPLATE] KV state NOT obtained -> out=empty (KV miss/failed/empty).");
    } catch (_e) {}
  } else {
    try {
      console.log("[SYNC/state][KV-HIT] KV state obtained -> out=KV data.");
    } catch (_e) {}
  }

  // 欠けている構造だけ補完（streak3Today は絶対に補完しない）
  // - ここでの補完は「null/undefined で落ちるのを防ぐための“最低限の形合わせ”」だけ。
  // - 値の推測や別ソースからの埋め合わせ（フォールバック）は行わない方針。
  // - streak3Today を補完しないのは、「存在しない/消えた」を検知できるようにするため。
  if (!out.correct) out.correct = {};
  if (!out.incorrect) out.incorrect = {};
  if (!out.streak3) out.streak3 = {};
  if (!out.streakLen) out.streakLen = {};
  if (!out.streak3Wrong) out.streak3Wrong = {};
  if (!out.streakWrongLen) out.streakWrongLen = {};
  if (!out.lastSeenDay) out.lastSeenDay = {};
  if (!out.lastCorrectDay) out.lastCorrectDay = {};
  if (!out.lastWrongDay) out.lastWrongDay = {};
  if (!out.consistency_status) out.consistency_status = {};
  if (!out.fav || typeof out.fav !== "object") out.fav = {};
  if (!out.global || typeof out.global !== "object") out.global = {};

  // O.D.O.A Mode のフラグを補完（欠落 or 不正値のときは "off" に統一）
  // - ここも “フォールバックっぽく見える” 代表例。
  // - out が empty 由来の場合、odoa_mode は最初から "off" なのでここは通常通らない。
  // - 逆に、out が KV 由来なのに odoa_mode が欠落/壊れている場合だけ、この補完が発動する。
  // - その場合、UI は "off" を受け取るため、原因が「KVの欠落」なのか「KVの破損」なのかをログで区別する必要がある。
  const hasOdoaMode = Object.prototype.hasOwnProperty.call(out, "odoa_mode");
  if (!hasOdoaMode || typeof out.odoa_mode !== "string") {
    out.odoa_mode = "off";
    try {
      // ★ここで "off" で補完したことを明示的にログ出力（初回セットの確認用）
      console.log("[SYNC/state] odoa_mode が欠落または不正値のため 'off' で補完しました。");
    } catch (_e) {}
  }

  // -----------------------------
  // 4) streak3Today / streak3WrongToday / oncePerDayToday / fav / O.D.O.A Mode の存在/内容チェック
  //    - streak3Today / streak3WrongToday は「存在確認のみ（上書き禁止）」
  //    - oncePerDayToday は「day / results の簡易整合チェック」
  //    - fav は「構造と値が想定どおりかどうか」を確認（補正は行わない）
  // -----------------------------
  let hasProp = Object.prototype.hasOwnProperty.call(out, "streak3Today");
  let rawSt3 = hasProp ? out.streak3Today : undefined;

  let parsedDay: string | null = null;
  let parsedCount: number | null = null;

  if (hasProp && rawSt3 && typeof rawSt3 === "object") {
    parsedDay =
      typeof rawSt3.day === "string"
        ? rawSt3.day
        : null;

    if (typeof rawSt3.unique_count === "number") {
      const n = rawSt3.unique_count;
      parsedCount = Number.isFinite(n) && n >= 0 ? n : null;
    }
  }

  // ★ Streak3WrongToday 側の存在チェックと簡易パース
  //   - KV に保存されている「本日の3連続不正解ユニーク情報」が、
  //     day / unique_count / qids の3つとも想定どおりの形かどうかを確認する
  const hasWrongTodayProp = Object.prototype.hasOwnProperty.call(out, "streak3WrongToday");
  const rawSt3Wrong: any = hasWrongTodayProp ? (out as any).streak3WrongToday : undefined;

  let parsedWrongDay: string | null = null;
  let parsedWrongCount: number | null = null;

  if (hasWrongTodayProp && rawSt3Wrong && typeof rawSt3Wrong === "object") {
    parsedWrongDay =
      typeof rawSt3Wrong.day === "string"
        ? rawSt3Wrong.day
        : null;

    if (typeof rawSt3Wrong.unique_count === "number") {
      const nw = rawSt3Wrong.unique_count;
      parsedWrongCount = Number.isFinite(nw) && nw >= 0 ? nw : null;
    }
  }

  // oncePerDayToday 側の簡易チェック
  const hasOncePerDayProp = Object.prototype.hasOwnProperty.call(out, "oncePerDayToday");
  const rawOnce: any = hasOncePerDayProp ? (out as any).oncePerDayToday : undefined;

  let onceDayNum: number | null = null;
  let onceResultsKeysLength = 0;

  if (rawOnce && typeof rawOnce === "object") {
    if (typeof rawOnce.day === "number" && Number.isFinite(rawOnce.day)) {
      onceDayNum = rawOnce.day;
    }
    if (rawOnce.results && typeof rawOnce.results === "object") {
      onceResultsKeysLength = Object.keys(rawOnce.results as any).length;
    }
  }

  // fav 側の簡易チェック（fav_modal.js / merge.ts と同じ値セットかどうかを確認）
  // - 値は "unset" / "fav001" / "fav002" / "fav003" のいずれかであることを確認
  // - 保存内容の補正は一切行わず、検証結果だけログに残す
  const hasFavPropForLog = Object.prototype.hasOwnProperty.call(out, "fav");
  const rawFav: any = hasFavPropForLog ? (out as any).fav : undefined;

  let favKeysLength = 0;
  let favAllValuesValid: boolean | null = null;

  if (rawFav && typeof rawFav === "object" && !Array.isArray(rawFav)) {
    const entries = Object.entries(rawFav as any);
    favKeysLength = entries.length;
    favAllValuesValid = true;

    for (const [qid, v] of entries) {
      // qid が文字列であることだけ確認
      if (typeof qid !== "string" || !qid) {
        favAllValuesValid = false;
        break;
      }

      // ★ 保存されている値が "unset" / "fav001" / "fav002" / "fav003" かをチェック
      if (
        v !== "unset" &&
        v !== "fav001" &&
        v !== "fav002" &&
        v !== "fav003"
      ) {
        favAllValuesValid = false;
        break;
      }
    }
  } else if (hasFavPropForLog) {
    favAllValuesValid = false;
  }

  // O.D.O.A Mode 側の簡易チェック
  const hasOdoaModePropForLog = Object.prototype.hasOwnProperty.call(out, "odoa_mode");
  const rawOdoaMode: any = hasOdoaModePropForLog ? (out as any).odoa_mode : undefined;

  let odModeParsed: "on" | "off" | null = null;
  if (typeof rawOdoaMode === "string") {
    if (rawOdoaMode === "on" || rawOdoaMode === "off") {
      odModeParsed = rawOdoaMode;
    }
  }

  // -----------------------------
  // 5) ログ出力（完全）
  // -----------------------------
  try {
    const qidsRaw =
      hasProp && rawSt3 && typeof rawSt3 === "object"
        ? (rawSt3 as any).qids
        : undefined;
    const qidsIsArray = Array.isArray(qidsRaw);
    const qidsLength = qidsIsArray ? (qidsRaw as any[]).length : 0;
    const isConsistent =
      qidsIsArray && parsedCount !== null
        ? parsedCount === qidsLength
        : null;

    console.log("[SYNC/state] --- streak3Today Check ---");
    console.log("[SYNC/state] hasProp:", hasProp);
    console.log("[SYNC/state] out.streak3Today (raw):", rawSt3);
    console.log("[SYNC/state] out.streak3Today.qids:", qidsRaw);
    console.log("[SYNC/state] out.streak3Today (parsed):", {
      day: parsedDay,
      unique_count: parsedCount,
      qidsIsArray,
      qidsLength,
      isConsistent
    });

    // ★ Streak3WrongToday の内容チェックログ
    //   - day / unique_count / qids 配列の整合性（unique_count === qids.length）を確認する
    const qidsWrongRaw =
      hasWrongTodayProp && rawSt3Wrong && typeof rawSt3Wrong === "object"
        ? (rawSt3Wrong as any).qids
        : undefined;
    const qidsWrongIsArray = Array.isArray(qidsWrongRaw);
    const qidsWrongLength = qidsWrongIsArray ? (qidsWrongRaw as any[]).length : 0;
    const isWrongConsistent =
      qidsWrongIsArray && parsedWrongCount !== null
        ? parsedWrongCount === qidsWrongLength
        : null;

    console.log("[SYNC/state] --- streak3WrongToday Check ---");
    console.log("[SYNC/state] hasWrongTodayProp        :", hasWrongTodayProp);
    console.log("[SYNC/state] out.streak3WrongToday(raw):", rawSt3Wrong);
    console.log("[SYNC/state] out.streak3WrongToday.qids:", qidsWrongRaw);
    console.log("[SYNC/state] out.streak3WrongToday(parsed):", {
      day: parsedWrongDay,
      unique_count: parsedWrongCount,
      qidsIsArray: qidsWrongIsArray,
      qidsLength: qidsWrongLength,
      isConsistent: isWrongConsistent
    });

    console.log("[SYNC/state] --- oncePerDayToday Check ---");
    console.log("[SYNC/state] hasOncePerDayProp:", hasOncePerDayProp);
    console.log("[SYNC/state] out.oncePerDayToday (raw):", rawOnce);
    console.log("[SYNC/state] out.oncePerDayToday (parsed):", {
      day: onceDayNum,
      resultsKeysLength: onceResultsKeysLength
    });

    console.log("[SYNC/state] --- fav Check ---");
    console.log("[SYNC/state] hasFavProp          :", hasFavPropForLog);
    console.log("[SYNC/state] favKeysLength       :", favKeysLength);
    console.log("[SYNC/state] favAllValuesValid   :", favAllValuesValid);

    console.log("[SYNC/state] --- O.D.O.A Mode Check ---");
    console.log("[SYNC/state] hasOdoaModeProp      :", hasOdoaModePropForLog);
    console.log("[SYNC/state] out.odoa_mode (raw)  :", rawOdoaMode);
    console.log("[SYNC/state] out.odoa_mode (parsed):", {
      odoa_mode: odModeParsed
    });

    console.log("[SYNC/state] --- summary ---");
    console.log("[SYNC/state] hasCorrect           :", !!out.correct);
    console.log("[SYNC/state] hasIncorrect         :", !!out.incorrect);
    console.log("[SYNC/state] hasStreak3           :", !!out.streak3);
    console.log("[SYNC/state] hasStreakLen         :", !!out.streakLen);
    // 3連続不正解系の有無も SYNC snapshot から確認できるようにする
    console.log("[SYNC/state] hasStreak3Wrong      :", !!out.streak3Wrong);
    console.log("[SYNC/state] hasStreakWrongLen    :", !!out.streakWrongLen);
    console.log("[SYNC/state] hasLastSeenDay       :", !!out.lastSeenDay);
    console.log("[SYNC/state] hasLastCorrectDay    :", !!out.lastCorrectDay);
    console.log("[SYNC/state] hasLastWrongDay      :", !!out.lastWrongDay);
    console.log("[SYNC/state] hasConsistencyStatus :", !!out.consistency_status);
    console.log("[SYNC/state] hasFav               :", !!out.fav);
    console.log("[SYNC/state] hasStreak3Today      :", hasProp);
    console.log("[SYNC/state] hasStreak3WrongToday :", hasWrongTodayProp);
    console.log("[SYNC/state] hasOncePerDayToday   :", hasOncePerDayProp);
    console.log("[SYNC/state] hasOdoaMode          :", hasOdoaModePropForLog);

    const hasGlobal = !!out.global && typeof out.global === "object";
    const totalQuestions =
      hasGlobal && typeof (out.global as any).totalQuestions === "number"
        ? (out.global as any).totalQuestions
        : null;
    console.log("[SYNC/state] hasGlobal            :", hasGlobal);
    console.log("[SYNC/state] global.totalQuestions:", totalQuestions);

    // exam_date が SYNC 上に正しく載っているかを簡易チェック
    const examDateRaw = (out as any).exam_date;
    const hasExamDate =
      typeof examDateRaw === "string" && examDateRaw.length > 0;
    console.log("[SYNC/state] hasExamDate          :", hasExamDate);
    console.log("[SYNC/state] exam_date            :", hasExamDate ? examDateRaw : null);

    console.log("[SYNC/state] === onRequestGet END ===");
    console.log("====================================================");
  } catch (_e) {}

  // UI巻き戻り対策B:
  // - /api/sync/state のレスポンス自体を no-store にして、ブラウザ/中継が古いJSONを保持しないようにする
  // - 成功確認: no-store で返していることをログ
  try {
    const resJson = JSON.stringify(out);

    const reqId = crypto.randomUUID();
    const cfAny: any = (request as any).cf || {};
    const colo = typeof cfAny.colo === "string" ? cfAny.colo : "";
    const ray = request.headers.get("CF-Ray") || "";

    // 【フォールバックに関与するポイント④: kvHit の定義】
    // - kvHit は “KVから何か取れたか” の判定に使う診断ラベル。
    // - 現在は `data ? "hit" : "miss"` のため、data が null のとき miss になる。
    // - 重要: この miss は「KVが本当に空(未保存)」なのか
    //         「読み出し失敗/一時的なnull」なのかを区別しない。
    // - そのため、UIで初期値に見える問題が起きたときは、
    //   この kvHit と、上の KV.get の RAWログ/例外ログをセットで見るのが前提。
    const kvHit = data ? "hit" : "miss";

    // ★ empty テンプレ返却フラグ（確定）
    // - 目的: out = data ? data : empty; の結果として「empty が返った」ことを、
    //         クライアント側（Networkヘッダ / コンソール）で一発判定できるようにする
    // - 判定基準: data が truthy でない場合は empty テンプレ返却（= isEmptyTemplate: "1"）
    // - 注意: これは「KVが未保存」か「一時的に読めなかった」かは区別しない（フォールバックはしない方針）
    const isEmptyTemplate = data ? "0" : "1";

    // ★ EMPTY確定ログ（Workersログで“一発確定”させるための1行）
    // - 何をしているか: KVから取れていない（kv=miss）→ out=empty が選ばれた（template=empty）→ サーバ自身が empty 返却を宣言（このログ行）
    // - ねらい: Workersログを1行見るだけで「KV未取得」「out=empty」「empty返却宣言」を確定できるようにする
    // - 仕様固定: 第2引数に必ず { kv:"miss", template:"empty" } を渡す（検索性のため）
    if (isEmptyTemplate === "1") {
      console.warn("[SYNC/state][EMPTY-REASON] reason:", data === null ? "KV.get returned null (miss/empty)" : "KV.get threw or returned falsy (read failed or invalid)", { hasData: !!data, dataType: typeof data });
      console.warn("[SYNC/state][EMPTY-TEMPLATE] KV state not available -> out=empty returned", { kv: "miss", template: "empty" }, { reqId, user, key });
    }

    const odoaModeNow =
      typeof (out as any).odoa_mode === "string"
        ? (out as any).odoa_mode
        : "";

    const updatedAtNow =
      typeof (out as any).updatedAt === "number"
        ? String((out as any).updatedAt)
        : "";

    console.log("[SYNC/state][diag] response headers snapshot:", {
      reqId,
      user,
      key,
      kv: kvHit,
      isEmptyTemplate,
      colo,
      ray,
      kv_identity: kvIdentityId,
      odoa_mode: odoaModeNow,
      updatedAt: updatedAtNow
    });

    console.log("[SYNC/state] ★RESPONSE no-store:", { bytes: resJson.length });

    return new Response(resJson, {
      headers: {
        "content-type": "application/json",
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
        "X-CSCS-KV": kvHit,

        // ★ empty テンプレ返却フラグ（確定）
        // - 目的: クライアント側で「今返ってきたstateが empty テンプレか」を一発で判定する
        // - 値: "1"=emptyテンプレ返却, "0"=KV由来データ返却
        "X-CSCS-IsEmptyTemplate": isEmptyTemplate,

        "X-CSCS-Colo": colo,
        "X-CSCS-CF-Ray": ray,
        "X-CSCS-UpdatedAt": updatedAtNow,
        "X-CSCS-OdoaMode": odoaModeNow
      },
    });
  } catch (e) {
    console.error("[SYNC/state] ★RESPONSE stringify failed:", e);
    return new Response("response json failed", {
      status: 500,
      headers: { "content-type": "text/plain", "Cache-Control": "no-store" }
    });
  }
};

// -----------------------------
async function getUserIdFromAccess(request: Request) {
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    // 【フォールバックに “見える” 可能性があるポイント⑤: 認証ヘッダー欠落】
    // - ここで空文字を返す → 呼び出し元 onRequestGet では `if (!user)` で 401 を返す。
    // - state.ts 自体は “emptyテンプレ” を返さず、明確に Unauthorized で止める。
    // - ただし、フロント側が 401 を「stateが無い扱い」にしてUI初期化を走らせる設計だと、
    //   見た目は “テンプレに戻った” に近い挙動になる。
    // - なので「OFFになった/0になった」系の現象では、401が混じっていないかも必ず確認する。
    console.error("[SYNC/state] CF-Access-Jwt-Assertion header missing.");
    return "";
  }

  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      console.error("[SYNC/state] invalid JWT format (parts length !== 3).");
      return "";
    }
    const payloadJson = atob(parts[1]);
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload.email !== "string" || !payload.email) {
      console.error("[SYNC/state] JWT payload does not contain valid email.", payload);
      return "";
    }
    return payload.email as string;
  } catch (e) {
    console.error("[SYNC/state] JWT decode/parse error.", e);
    return "";
  }
}