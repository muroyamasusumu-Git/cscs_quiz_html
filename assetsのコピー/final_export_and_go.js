// assets/final_export_and_go.js
// Bパート最終問題：その日の回答をJSONでエクスポート → result.htmlへ遷移
(function () {
  "use strict";

  function getDayFromPath() {
    const m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : (localStorage.getItem("cscs_last_day") || "unknown");
  }

  function downloadJSON(obj, filename) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
    } catch (e) {
      console && console.warn && console.warn("export failed:", e);
    }
  }

  function exportAndGo() {
    const nextHref = "result.html";
    const day = getDayFromPath();

    let all = [];
    try { all = JSON.parse(localStorage.getItem("cscs_results") || "[]"); }
    catch (_) { all = []; }

    const rows = all
      .filter(r => r && r.day === day)
      .sort((a, b) => (a.stem || "").localeCompare(b.stem || ""));

    const payload = { day, exportedAt: new Date().toISOString(), results: rows };

    const t = new Date();
    const pad = n => String(n).padStart(2, "0");
    const fn = `cscs_${day}_results_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.json`;

    downloadJSON(payload, fn);

    // 即遷移だとDLが落ちる環境対策
    setTimeout(() => { window.location.href = nextHref; }, 350);
  }

  function isDeepDiveClick(target) {
    return !!(target && target.closest && (
      target.closest('#dd-panel') ||
      target.closest('.deep-dive-btn') ||
      target.closest('.dd-btn')
    ));
  }

  function isFavClick(target) {
    return !!(target && target.closest && (
      target.closest('#fav-backdrop .fav-modal') ||
      target.closest('#fav-backdrop')
    ));
  }

  window.addEventListener("DOMContentLoaded", () => {
    // ドキュメントどこでも（リンク/音声ボタン/DeepDive/Favを除く）→ エクスポート → 遷移
    document.addEventListener("click", (e) => {
      if (e.target.closest(".audio-fallback-btn")) return;
      if (e.target.closest("a")) return;
      if (isDeepDiveClick(e.target)) return;
      if (isFavClick(e.target)) return;
      e.preventDefault();
      exportAndGo();
    });

    // スペース / Enter / → でも発火（DeepDive/Fav開時は抑止）
    document.addEventListener("keydown", (e) => {
      if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        exportAndGo();
      }
    });

    // 画面オーバーレイのクリックで実行（保険）
    const ov = document.querySelector(".next-overlay");
    if (ov) {
      ov.addEventListener("click", (e) => { e.preventDefault(); exportAndGo(); });
      ov.href = "#";
      ov.style.zIndex = 9999;
      ov.setAttribute("aria-label", "結果へ");
      ov.setAttribute("role", "link");
      ov.setAttribute("tabindex", "0");
    }
  });
})();