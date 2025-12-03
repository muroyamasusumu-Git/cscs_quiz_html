// assets/backfill_suppress.js
// CSCS backfill 抑止シム
// ・一定時間（TTL）だけ backfill を無効化する
// ・その間も「リアルタイム記録」自体は動かしたまま、backfill 関数だけを殺す

(() => {
  // ▼ 1. 抑止期間（TTL）の基準を localStorage から取得
  //    cscs_reset_epoch: 抑止開始時刻（ミリ秒）
  //    cscs_reset_ttl_ms: 抑止を続ける期間（ミリ秒）
  const epoch = Number(localStorage.getItem("cscs_reset_epoch") || 0);
  const ttl   = Number(localStorage.getItem("cscs_reset_ttl_ms") || 0);

  // ▼ 2. 今が「抑止期間内」かどうかを判定
  //    現在時刻 - epoch < ttl であれば抑止フラグを true にする
  const suppressed = (Date.now() - epoch) < ttl;

  // ▼ 3. グローバルフラグとしても公開（他のスクリプトからも参照可能）
  window.__CSCS_BACKFILL_SUPPRESSED__ = suppressed;

  // ▼ 4. b_judge_record.js が定義する backfill 関数を NOOP に差し替える処理
  function patch() {
    // 抑止期間外なら何もしないで終了
    if (!suppressed) return;

    // b_judge_record.js 側で定義される想定の関数名を2種類チェック
    const f1 = window.cscsBackfillIfNeeded;
    const f2 = window.cscs_backfill_if_needed;

    // どちらもまだ存在しない = 本体JSが未ロード
    // → 次の tick で再試行して、読み込み完了を待つ
    if (!f1 && !f2) {
      setTimeout(patch, 0);
      return;
    }

    // 差し替え先の NOOP 関数
    const noop = () => console.info("🚫 backfill suppressed (TTL)");

    // それぞれ「関数として存在」しているものだけ NOOP に置き換える
    if (typeof f1 === "function") {
      window.cscsBackfillIfNeeded = noop;
    }
    if (typeof f2 === "function") {
      window.cscs_backfill_if_needed = noop;
    }
  }

  // ▼ 5. 最初の patch を「非同期（タイマー）で」走らせる
  //    → 他の JS が window に関数を生やすタイミングを待つため
  setTimeout(patch, 0);
})();