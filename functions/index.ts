// quiz_html/functions/index.ts

export const onRequest: PagesFunction = async (context) => {
  const request = context.request;
  const url = new URL(request.url);

  // 1) manifest.json を読み込む（全日一覧）
  const manifestUrl = new URL("/manifest.json", url);

  let manifest: {
    days?: { date?: string; path?: string }[];
  };

  try {
    const res = await fetch(manifestUrl.toString(), {
      // 軽くキャッシュしてもOK（好みで調整）
      cf: { cacheTtl: 60, cacheEverything: true } as any
    });

    if (!res.ok) {
      throw new Error(`manifest.json fetch failed: ${res.status}`);
    }

    manifest = await res.json();
  } catch (err) {
    console.error("[root-random] failed to load manifest.json:", err);
    // フォールバック：固定のスタートページに飛ばす
    const fallback = `${url.origin}/_build_cscs_20250926/slides/q001_a.html`;
    return Response.redirect(fallback, 302);
  }

  const days = (manifest && Array.isArray(manifest.days)) ? manifest.days : [];

  if (!days.length) {
    console.error("[root-random] manifest.days is empty");
    const fallback = `${url.origin}/_build_cscs_20250926/slides/q001_a.html`;
    return Response.redirect(fallback, 302);
  }

  // 2) ランダムな「日」を1つ選ぶ
  const dayIndex = Math.floor(Math.random() * days.length);
  const dayEntry = days[dayIndex];
  const date = (dayEntry && typeof dayEntry.date === "string")
    ? dayEntry.date
    : "20250926"; // 念のためフォールバック

  // 3) その日の中から 1〜30 のランダムな問題番号を選ぶ
  //    （仕様上 30問固定なので 1〜30 でOK。将来変えるならここを調整）
  const QUESTIONS_PER_DAY = 30;
  const qIndex = Math.floor(Math.random() * QUESTIONS_PER_DAY) + 1; // 1〜30
  const qNum3 = qIndex.toString().padStart(3, "0");

  // 4) AパートのURLを組み立てる
  const targetPath = `/_build_cscs_${date}/slides/q${qNum3}_a.html`;
  const targetUrl = `${url.origin}${targetPath}`;

  console.log("[root-random] redirect to:", targetUrl);

  // 5) 302でリダイレクト
  return Response.redirect(targetUrl, 302);
};