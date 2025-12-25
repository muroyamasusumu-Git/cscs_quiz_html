// ============================================================================
// 🚨🚨🚨 CSCS SYNC completely delete API（超・危険） 🚨🚨🚨
//
// 【概要】
//   この API は、CSCS の SYNC(KV) に保存されている state を
//   「部分初期化」や「差分リセット」ではなく、
//   🔥 KVキーごと delete する “完全消去” 🔥 を行う。
//
// 【何が消えるか】
//   - 計測系（正解数 / 不正解数 / streak / oncePerDay / today系 など）
//   - 設定系（fav / consistency_status / exam_date / odoa_mode など）
//   - 旧仕様の残骸フィールド
//   - 命名揺れ・過去バージョン由来の未知フィールド
//   - 想定外に混入したあらゆる state
//   → 「sync:${user}」に紐づく state は 100% 消滅する。
//
// 【重要な注意（必読）】
//   - これは「reset」ではない。
//     → “完全削除（DELETE）” であり、取り消し不可・復元不可。
//   - 実行した瞬間、そのユーザーの SYNC state は空になる。
//   - バックアップ機構は存在しない。
//     → 誤実行＝即データロスト。
//   - 本番ユーザー / 本番環境で実行した場合、
//     それは「バグ」ではなく「事故」になる。
//
// 【想定ユースケース】
//   - 計測系の実装を 1bit の誤差もなく検証したいデバッグ期のみ。
//   - 差分同期・部分リセットでは “過去履歴が混ざる” ため、
//     完全な初期状態から検証する必要がある場合。
//   - 「設定系は後のフェーズで作る」と割り切れている段階。
//
// 【使用禁止条件】
//   - 本番運用フェーズ
//   - テストであっても、
//     「このユーザーのデータが消えても問題ない」と
//     明言できない状況
//   - UI / 自動処理 / バッチ / cron などからの呼び出し
//
// 【設計上の意図】
//   - 差分同期では “消えないデータ” が存在するため、
//     デバッグ期においては KV.delete 以外に
//     「完全な整合性」を保証する手段が存在しない。
//   - 危険であることを承知の上で、
//     あえて “名前・コメント・挙動” を過激にしている。
//     （安全そうに見える方が危険）
//
// ⚠️⚠️⚠️ 本番運用フェーズでは使用禁止 ⚠️⚠️⚠️
// ============================================================================

export const onRequestPost: PagesFunction<{ SYNC: KVNamespace }> = async ({ env, request }) => {
  // Cloudflare Access の JWT から user（email）を取得
  // → この user に紐づく SYNC state が削除対象になる
  const user = await getUserIdFromAccess(request);
  const key = `sync:${user}`;

  // リクエストボディは形式チェックのためだけに読み取る
  // 内容は一切使用しない（誤差ゼロ・挙動固定を優先）
  try {
    await request.json();
  } catch (e) {
    // JSON でなくても完全削除を実行する
  }

  // --------------------------------------------------------------------------
  // 🚨 ここが最も危険な処理 🚨
  //
  //   env.SYNC.delete(key)
  //
  // - KV の該当キーを「上書き」ではなく「完全削除」する
  // - 一度 delete されたデータは復元不能
  // - この1行が実行された時点で、その user の SYNC state は消滅する
  // --------------------------------------------------------------------------
  await env.SYNC.delete(key);

  // 実行結果を明示的に返す（ログ・コンソール確認用）
  const out = {
    ok: true,
    action: "COMPLETELY_DELETE",
    key: key,
    deleted: true,
    updatedAt: Date.now()
  };

  return new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json" }
  });
};

async function getUserIdFromAccess(request: Request) {
  // Cloudflare Access による認証ヘッダ
  const jwt = request.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) {
    throw new Response("Unauthorized", { status: 401 });
  }

  // JWT payload から email を user 識別子として使用
  // → この email が SYNC(KV) のキー空間を決定する
  const payload = JSON.parse(atob(jwt.split(".")[1]));
  return payload.email;
}