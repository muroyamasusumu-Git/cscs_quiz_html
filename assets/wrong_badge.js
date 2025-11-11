// /assets/wrong_badge.js
// 目的: b_judge_record.js のキー命名に完全一致させ、1日1回の正解/不正表示だけ行う
(() => {
  "use strict";

  // ===== JST "today" (YYYYMMDD) =====
  function getTodayYYYYMMDD_JST() {
    try {
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      return jst.toISOString().slice(0, 10).replace(/-/g, "");
    } catch {
      return "";
    }
  }

  // ===== Favorites（既存表示は維持） =====
  function favLabelFromString(s) {
    switch (String(s || "unset")) {
      case "understood": return "理解済";
      case "unanswered": return "要復習";
      case "none":       return "重要";
      default:           return "未設定";
    }
  }

  function favLabelFromNumber(n) {
    switch ((n | 0)) {
      case 1: return "理解済";
      case 2: return "要復習";
      case 3: return "重要";
      default: return "未設定";
    }
  }

  function readFavLabelAndType() {
    const dayPath = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1] || "";
    const n3 = (location.pathname.match(/q(\d{3})_[ab]/i) || [])[1] || "";
    const qid = dayPath && n3 ? `${dayPath}-${n3}` : "";

    if (!qid) return { label: "未設定", type: "unset" };

    try {
      const obj = JSON.parse(localStorage.getItem("cscs_fav") || "{}");
      if (obj && Object.prototype.hasOwnProperty.call(obj, qid)) {
        const raw = String(obj[qid] || "unset");
        return { label: favLabelFromString(raw), type: raw };
      }
    } catch {}

    try {
      const m = JSON.parse(localStorage.getItem("cscs_fav_map") || "{}");
      if (m && Object.prototype.hasOwnProperty.call(m, qid)) {
        const n = m[qid];
        const label = favLabelFromNumber(n);
        const type =
          n === 1 ? "understood" :
          n === 2 ? "unanswered" :
          n === 3 ? "none" :
          "unset";
        return { label, type };
      }
    } catch {}

    return { label: "未設定", type: "unset" };
  }

  // ===== 固定ボックス =====
  function ensureFixedBox() {
    const boxId = "cscs-fixed-status";
    let box = document.getElementById(boxId);
    if (box) return box;

    box = document.createElement("div");
    box.id = boxId;
    box.innerHTML = `
      <span class="fav-status">［--］</span>
      <span class="wrong-status">（正解:--回 / 不正解:--回）</span>
    `;
    document.body.appendChild(box);
    return box;
  }

  // ===== 当日ユニーク値の読取り（b_judge_record.js 準拠） =====
  // 正解: localStorage["cscs_daily_unique_done:<YYYYMMDD>"]
  // 不正: localStorage["cscs_wrong_attempts_<YYYYMMDD>"]
  function readTodayUniqueCorrect() {
    try {
      const dayPlay = getTodayYYYYMMDD_JST();
      if (!dayPlay) return 0;
      const v = localStorage.getItem(`cscs_daily_unique_done:${dayPlay}`);
      return v === "1" ? 1 : 0;
    } catch {
      return 0;
    }
  }

  function readTodayUniqueWrong() {
    try {
      const dayPlay = getTodayYYYYMMDD_JST();
      if (!dayPlay) return 0;
      const n = parseInt(localStorage.getItem(`cscs_wrong_attempts_${dayPlay}`) || "0", 10);
      return (Number.isFinite(n) && n > 0) ? 1 : 0;
    } catch {
      return 0;
    }
  }

  // ===== 描画（集計ロジック更新版） =====
  function render() {
    const { label, type } = readFavLabelAndType();

    // === 集計値の取得（b_judge_record.js 準拠：日次ログの counted 合計） ===
    const cd = JSON.parse(localStorage.getItem("cscs_correct_daily_log") || "{}");
    const wd = JSON.parse(localStorage.getItem("cscs_wrong_daily_log")  || "{}");

    const sumCounted = (obj) =>
      Object.values(obj).reduce((a, b) => a + ((b && typeof b === "object") ? (b.counted || 0) : 0), 0);

    const correct = sumCounted(cd);
    const wrong   = sumCounted(wd);

    // === UI更新 ===
    const box = ensureFixedBox();
    const favSpan = box.querySelector(".fav-status");
    const wrongSpan = box.querySelector(".wrong-status");

    if (favSpan) {
      favSpan.textContent = `［${label}］`;
      favSpan.className = `fav-status fav-${type}`;
    }
    if (wrongSpan) {
      wrongSpan.textContent = `(正解:${correct}回 / 不正解:${wrong}回)`;
    }
  }

  // ===== 監視 =====
  window.addEventListener("DOMContentLoaded", render);
  window.addEventListener("storage", render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
  setInterval(render, 2000);
})();