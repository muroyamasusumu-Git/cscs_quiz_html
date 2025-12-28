// functions/_cscs_sync_key.ts
//
// 目的:
// - Cloudflare Access で認証された「ユーザーEmail」を唯一のIDとして採用し、
//   そのユーザーに紐づく CSCS SYNC Key を KV に保存/取得する共通部品。
// - “フォールバックは基本無し” 方針:
//   - Accessメールヘッダが無ければ 401 で落とす（推測/代替取得しない）。
//   - KV も「user→key」「key→user」の両方向を必ず揃えて持つ。
//     （片方向だけにすると state/merge 側の “一致判定” が曖昧になるため）
//
// 注意:
// - Headers.get() は大文字小文字を区別しないため、
//   "Cf-Access-Authenticated-User-Email" の 1本指定で十分。
// - console.log は Cloudflare 側のログに出る（ブラウザConsoleではない）。
//   ブラウザで監視したい場合は cscs_sync_header_compare.js 側で見る。

export type SyncEnv = {
  /**
   * Cloudflare Pages / Workers にバインドされている KVNamespace。
   *
   * 【重要な設計前提】
   * - このプロパティ名 `SYNC` は
   *   Cloudflare 側（wrangler / Pages 設定）で指定した
   *   **KV バインディング名そのもの**に対応する。
   *
   * 例:
   *   - Pages の KV binding 名が "SYNC" の場合
   *       → env.SYNC が KVNamespace として注入される
   *
   *   - もし binding 名が "CSCS_SYNC_KV" なら
   *       → env.CSCS_SYNC_KV になる
   *       → この型定義もそれに合わせて変更が必要
   *
   * 【なぜ型を明示するか】
   * - env は実体としては `any` でも動くが、
   *   型で固定しておくことで
   *     ・誤った binding 名の参照
   *     ・別 KV を掴んでいる事故
   *   をコンパイル時に検知できる。
   *
   * 【確認方法（実測）】
   * - /api/sync/state のレスポンスヘッダ
   *     X-CSCS-KV-Binding: "SYNC"
   *   が出ていれば、
   *     → この型 `{ SYNC: KVNamespace }` は正しい。
   */
  SYNC: KVNamespace;
};

/**
 * Cloudflare Access が注入する “認証ユーザーEmail” を唯一の正として取り出す。
 * 取れなければ空文字を返す（呼び出し側が 401 を返す）。
 */
export function getAccessUserEmail(req: Request): string {
  const h = req.headers;

  // ★ Email一択（フォールバックなし）
  const v = h.get("Cf-Access-Authenticated-User-Email");
  if (typeof v === "string" && v.trim()) return v.trim();

  return "";
}

/**
 * ヘッダ/URLに安全な syncKey を生成する。
 * - crypto.getRandomValues で 32byte を生成し、
 * - base64url（+→-、/→_、末尾=除去）にして返す。
 */
export function makeSyncKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }

  const b64 = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return b64;
}

/**
 * KVキー: userEmail → syncKey
 * - ユーザーが “自分のキー” を確実に引けるための正。
 */
export function kvKeyUserToSyncKey(userEmail: string): string {
  return `cscs_user_sync_key:${userEmail}`;
}

/**
 * KVキー: syncKey → userEmail
 * - state/merge が “そのkeyの所有者は誰か” を確実に照合するための正。
 */
export function kvKeySyncKeyToOwner(syncKey: string): string {
  return `cscs_sync_key_owner:${syncKey}`;
}

/**
 * 既存キーがあればそれを返す。無ければ発行して KV に保存する。
 * forceReissue=true なら必ず再発行して上書きする。
 *
 * 書き込みは必ず “両方向”:
 * - user→key
 * - key→user
 */
export async function getOrIssueSyncKey(
  env: SyncEnv,
  userEmail: string,
  forceReissue: boolean
): Promise<string> {
  const kv = env.CSCS_SYNC_KV;

  if (!forceReissue) {
    const existing = await kv.get(kvKeyUserToSyncKey(userEmail));
    if (typeof existing === "string" && existing.trim()) {
      return existing.trim();
    }
  }

  const key = makeSyncKey();

  await kv.put(kvKeyUserToSyncKey(userEmail), key);
  await kv.put(kvKeySyncKeyToOwner(key), userEmail);

  return key;
}

/**
 * syncKey が “この userEmail のものか” を KV（key→owner）で厳密に照合する。
 * フォールバック無し:
 * - owner が無い / 不一致 → false
 */
export async function assertSyncKeyMatchesUser(
  env: SyncEnv,
  syncKey: string,
  userEmail: string
): Promise<boolean> {
  const kv = env.CSCS_SYNC_KV;

  const owner = await kv.get(kvKeySyncKeyToOwner(syncKey));
  if (typeof owner !== "string" || !owner.trim()) return false;

  return owner.trim() === userEmail;
}