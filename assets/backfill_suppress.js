// CSCS backfill 抑止シム（TTL内のみ backfill を無効化。リアルタイム記録は稼働）
(() => {
  const epoch = Number(localStorage.getItem("cscs_reset_epoch") || 0);
  const ttl   = Number(localStorage.getItem("cscs_reset_ttl_ms") || 0);
  const suppressed = (Date.now() - epoch) < ttl;
  window.__CSCS_BACKFILL_SUPPRESSED__ = suppressed;

  // b_judge_record.js が定義する backfill 関数を NOOP に差し替え
  function patch() {
    if (!suppressed) return;                  // 抑止期間外なら何もしない

    const f1 = window.cscsBackfillIfNeeded;
    const f2 = window.cscs_backfill_if_needed;

    // 本体未読込なら次の tick で再試行
    if (!f1 && !f2) {
      setTimeout(patch, 0);
      return;
    }

    const noop = () => console.info("🚫 backfill suppressed (TTL)");

    if (typeof f1 === "function") {
      window.cscsBackfillIfNeeded = noop;
    }
    if (typeof f2 === "function") {
      window.cscs_backfill_if_needed = noop;
    }
  }

  setTimeout(patch, 0);
})();