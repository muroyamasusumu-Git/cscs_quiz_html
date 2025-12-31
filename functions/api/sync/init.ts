// functions/api/sync/init.ts
//
// 目的:
// - Cloudflare Access の “認証ユーザーEmail” を唯一のIDとして確定し、
//   そのユーザーに紐づく sync key を KV に「発行 or 既存返却 or 再発行」して返す。
// - これにより、フロントは localStorage("cscs_sync_key") を 1回で正しく確定できる。
// - “フォールバックは基本無し” 方針:
//   - Accessメールヘッダが無い場合は 401 で即終了。
//   - body が壊れていても force は false 扱い（処理を勝手に推測で拡張しない）。
//
// ブラウザConsoleでの確認ポイント:
// - cscs_sync_header_compare.js で /api/sync/init の REQ/RESP を監視すると確実。
// - さらに init のレスポンスヘッダに
//     X-CSCS-Key: <issued key>
//     X-CSCS-User: <authenticated email>
//   を載せるので、Networkタブでも一発で見える。

import {
  getAccessUserEmail,
  type SyncEnv,
} from "../../_cscs_sync_key";

function json(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): Response {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });

  // 監視・実測しやすいよう、必要な情報はレスポンスヘッダにも載せる
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
  }

  return new Response(JSON.stringify(body), { status, headers: h });
}

export const onRequestPost: PagesFunction<SyncEnv> = async (ctx) => {
  const req = ctx.request;

  // 1) 認証ユーザーEmailを確定（Email一択。無ければ 401）
  const userEmail = getAccessUserEmail(req);
  if (!userEmail) {
    return json(401, {
      ok: false,
      __cscs_warn: {
        code: "SYNC_INIT_NO_ACCESS_EMAIL",
        message: "Cf-Access-Authenticated-User-Email is missing.",
      },
    });
  }

  // 2) force 再発行フラグを読む（最小限）
  // - JSONが壊れていても force=false（フォールバック/推測で暴走しない）
  let force = false;
  try {
    const data = await req.json().catch(() => ({}));
    force =
      !!(data &&
      typeof data === "object" &&
      (data as any).force === true);
  } catch (_e) {
    force = false;
  }

  // 3) state.ts と同じ規則で key を確定（sync:<lowercase email>）
  const userNormalized = String(userEmail).trim().toLowerCase();
  const key = `sync:${userNormalized}`;

  // 4) 応答
  return json(
    200,
    { ok: true, user: userNormalized, key, reissued: force },
    { "X-CSCS-Key": key, "X-CSCS-User": userNormalized }
  );
};

export const onRequestGet: PagesFunction<SyncEnv> = async (_ctx) => {
  return json(405, {
    ok: false,
    __cscs_warn: { code: "METHOD_NOT_ALLOWED", message: "POST only" },
  });
};