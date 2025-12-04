// merge.ts
export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

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

  // 受信した delta の全体像と、streak3TodayDelta の有無をログに残す
  try {
    console.log("====================================================");
    console.log("[SYNC/merge] === onRequestPost START ===");
    console.log("[SYNC/merge] user :", user);
    console.log("[SYNC/merge] key  :", key);
    console.log("[SYNC/merge] (1) delta 全体:", JSON.stringify(delta));
    console.log("[SYNC/merge] (1-1) delta.streak3TodayDelta:", JSON.stringify((delta as any).streak3TodayDelta ?? null));
  } catch (_e) {}

  // (server) 現在のサーバー状態を KV から取得
  // - ユーザーごとの SYNC スナップショットを KV から読み出す
  // - まだ一度も保存されていなければ、全フィールド空のオブジェクトを初期値として使う
  let server: any =
    (await env.SYNC.get(key, "json")) || {
      correct: {},
      incorrect: {},
      streak3: {},
      streakLen: {},
      consistency_status: {},
      // グローバルメタ情報（総問題数など）を保持する領域
      global: {},
      // O.D.O.A Mode の初期値（まだ一度も保存されていないユーザーは "off" から開始）
      odoa_mode: "off",
      // ここでは初期値として streak3Today / oncePerDayToday を用意する（「無からの初回保存」を許可）
      streak3Today: { day: "", unique_count: 0, qids: [] },
      oncePerDayToday: { day: 0, results: {} },
      updatedAt: 0
    };

  // 読み出した server オブジェクトに必須フィールドが欠けていた場合は補完する
  if (!server.correct) server.correct = {};
  if (!server.incorrect) server.incorrect = {};
  if (!server.streak3) server.streak3 = {};
  if (!server.streakLen) server.streakLen = {};
  if (!server.consistency_status) server.consistency_status = {};
  if (!(server as any).streak3Today) {
    (server as any).streak3Today = { day: "", unique_count: 0, qids: [] };
  }
  if (!(server as any).oncePerDayToday || typeof (server as any).oncePerDayToday !== "object") {
    (server as any).oncePerDayToday = { day: 0, results: {} };
  }
  if (!(server as any).global || typeof (server as any).global !== "object") {
    (server as any).global = {};
  }

  // O.D.O.A Mode が存在しない or 不正な場合は "off" で補完しておく
  if (!Object.prototype.hasOwnProperty.call(server as any, "odoa_mode") || typeof (server as any).odoa_mode !== "string") {
    (server as any).odoa_mode = "off";
    try {
      console.log("[SYNC/merge] (0-1) server.odoa_mode が欠落または不正値のため 'off' で補完しました。");
    } catch (_e) {}
  }

  // (1) delta.streak3TodayDelta / oncePerDayTodayDelta が送られてきたか
  // - クライアント側が「今日の ⭐️ ユニーク一覧」と「1日1回までカウント対象 oncePerDayTodayDelta」を送信してきているかどうかを確認する
  const streak3TodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).streak3TodayDelta
      : undefined;

  const oncePerDayTodayDelta =
    delta && typeof delta === "object"
      ? (delta as any).oncePerDayTodayDelta
      : undefined;

  // streak3TodayDelta / oncePerDayTodayDelta の構造検査用ログ
  try {
    const hasStreak3Delta =
      streak3TodayDelta && typeof streak3TodayDelta === "object" ? true : false;

    let dayDebug = "";
    let qidsRawDebug: unknown = undefined;
    let qidsIsArray = false;
    let qidsLen = 0;

    if (hasStreak3Delta) {
      // day が string かどうか
      dayDebug =
        typeof (streak3TodayDelta as any).day === "string"
          ? (streak3TodayDelta as any).day
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

    // day は「非空の文字列」であることを要求する
    if (typeof dayValue !== "string" || !dayValue) {
      console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.day が不正のため更新中断:", {
        dayValue
      });
      return new Response("invalid streak3TodayDelta: day", {
        status: 400,
        headers: { "content-type": "text/plain" }
      });
    }

    // qids は配列であることを要求する
    if (!Array.isArray(qidsRaw)) {
      console.error("[SYNC/merge] (2-1-err) streak3TodayDelta.qids が配列ではないため更新中断:", {
        qidsRaw
      });
      return new Response("invalid streak3TodayDelta: qids", {
        status: 400,
        headers: { "content-type": "text/plain" }
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
          headers: { "content-type": "text/plain" }
        });
      }
    }

    const qids = qidsRaw as string[];
    const day = dayValue as string;

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
          headers: { "content-type": "text/plain" }
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
    console.log("[SYNC/merge] (2-1) streak3Today: delta なし（更新スキップ）");
  }

  // (2-2) AFTER: マージ後の server.streak3Today をログ
  // - 上記のマージ処理の結果、サーバー側の streak3Today がどうなったかの最終確認
  try {
    const afterSt3 = (server as any).streak3Today || null;
    console.log("[SYNC/merge] (2-3) AFTER server.streak3Today:", JSON.stringify(afterSt3));
  } catch (_e) {
    console.warn("[SYNC/merge] ★logging error (AFTER streak3Today)");
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
        headers: { "content-type": "text/plain" }
      });
    }
    const dayStr = String(dayRaw);
    if (!/^\d{8}$/.test(dayStr)) {
      console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.day が8桁数値でないため更新中断:", {
        dayRaw
      });
      return new Response("invalid oncePerDayTodayDelta: day format", {
        status: 400,
        headers: { "content-type": "text/plain" }
      });
    }

    // results はプレーンオブジェクトであることを要求する
    if (!resultsRaw || typeof resultsRaw !== "object") {
      console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.results がオブジェクトでないため更新中断:", {
        resultsRaw
      });
      return new Response("invalid oncePerDayTodayDelta: results", {
        status: 400,
        headers: { "content-type": "text/plain" }
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
          headers: { "content-type": "text/plain" }
        });
      }
      if (v !== "correct" && v !== "wrong") {
        console.error("[SYNC/merge] (2-4-err) oncePerDayTodayDelta.results 内の値が不正:", {
          qid,
          value: v
        });
        return new Response("invalid oncePerDayTodayDelta: results value", {
          status: 400,
          headers: { "content-type": "text/plain" }
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

  // 今回の merge 処理がいつ行われたかのタイムスタンプを保存
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

      const beforeGuardOnce = (server as any).oncePerDayToday || null;
      const hasOncePerDayDelta =
        oncePerDayTodayDelta && typeof oncePerDayTodayDelta === "object" ? true : false;

      console.log("[SYNC/merge][guard] streak3TodayDelta 判定:", {
        hasDelta: hasDeltaForToday,
        willUpdate: hasDeltaForToday,
        streak3TodaySnapshot: beforeGuardSt3
      });
      console.log("[SYNC/merge][guard] oncePerDayTodayDelta 判定:", {
        hasDelta: hasOncePerDayDelta,
        willUpdate: hasOncePerDayDelta,
        oncePerDayTodaySnapshot: beforeGuardOnce
      });
    } catch (_e) {
      console.warn("[SYNC/merge][guard] logging error (streak3Today / oncePerDayToday snapshot)");
    }

    const jsonStr = JSON.stringify(server);

    // マージ済みの server オブジェクトを KV に保存
    await env.SYNC.put(key, jsonStr);
    console.log("[SYNC/merge] (3) ★KV保存成功:", {
      key,
      streak3Today: (server as any).streak3Today
    });

    // streak3Today フィールドが「unique_count === qids.length」を満たしているかの自己整合性チェック
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
      headers: { "content-type": "text/plain" }
    });
  }

  // 正常終了時のログ
  try {
    console.log("[SYNC/merge] === onRequestPost END (OK) ===");
    console.log("====================================================");
  } catch (_e) {}

  // クライアントには、マージ後の server スナップショット全体を返す
  return new Response(JSON.stringify(server), {
    headers: { "content-type": "application/json" },
  });
};

async function getUserIdFromAccess(request: Request) {
  // Cloudflare Access の JWT からユーザーの email を取り出し、
  // ユーザーごとの SYNC キー（sync:<email>）を作るための ID として使う
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) throw new Response("Unauthorized", { status: 401 });
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}