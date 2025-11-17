// /assets/wrong_badge.js
// 目的: b_judge_record.js のキー命名に完全一致。表示の（正解/不正）をリンク化し、クリックで集計を出力。
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

  // ===== 固定ボックス（正/不を <a> に変更） =====
  function ensureFixedBox() {
    const boxId = "cscs-fixed-status";
    let box = document.getElementById(boxId);
    if (box) return box;

    box = document.createElement("div");
    box.id = boxId;
    box.innerHTML = `
      <span class="fav-status">［--］</span>
      <a href="#" class="wrong-status" role="button" aria-label="成績の統計を表示" title="">（正解:--回 / 不正解:--回）</a>
    `;
    document.body.appendChild(box);
    return box;
  }

  // ===== 当日ユニーク値の読取り（b_judge_record.js 準拠） =====
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

  // ===== 集計ユーティリティ =====
  // 柔軟に: {counted}, {total}, {sum}, {raw}, {unique} のいずれでも拾う
  function sumField(obj) {
    return Object.values(obj).reduce((acc, v) => {
      if (!v || typeof v !== "object") return acc;
      if (Number.isFinite(v.total))   return acc + v.total;
      if (Number.isFinite(v.counted)) return acc + v.counted;
      if (Number.isFinite(v.sum))     return acc + v.sum;
      return acc;
    }, 0);
  }
  function uniqueProblemCount(obj) {
    // 1) 配列（qids/unique/rawIds）があれば、それらのユニーク件数を返す
    const set = new Set();
    for (const v of Object.values(obj)) {
      if (!v || typeof v !== "object") continue;
      const cands = [];
      if (Array.isArray(v.qids))   cands.push(...v.qids);
      if (Array.isArray(v.unique)) cands.push(...v.unique);
      if (Array.isArray(v.rawIds)) cands.push(...v.rawIds);
      for (const id of cands) if (id != null) set.add(String(id));
    }
    if (set.size > 0) return set.size;

    // 2) 配列が無いログ構造では、数値フィールド raw を合算してユニーク問題数の近似とする
    //    例: { "20250926": { raw: 3, counted: 1 } }
    return Object.values(obj).reduce((acc, v) => {
      const n = (v && typeof v === "object" && Number.isFinite(v.raw)) ? v.raw : 0;
      return acc + n;
    }, 0);
  }
  function computeStats() {
    const cd = JSON.parse(localStorage.getItem("cscs_correct_daily_log") || "{}");
    const wd = JSON.parse(localStorage.getItem("cscs_wrong_daily_log")  || "{}");

    const correctTotal = sumField(cd);
    const wrongTotal   = sumField(wd);

    // ユニーク問題数（配列が無ければ raw を使うフォールバック）
    const correctRaw = uniqueProblemCount(cd);
    const wrongRaw   = uniqueProblemCount(wd);

    // 記録日数は正解・不正のキーの和集合で数える
    const days = new Set([...Object.keys(cd), ...Object.keys(wd)]).size;

    return { cd, wd, correctTotal, wrongTotal, correctRaw, wrongRaw, days };
  }

  function showStats() {
    const { correctTotal, wrongTotal, correctRaw, wrongRaw, days, cd, wd } = computeStats();

    const rows = [
      { type: "✅ 正解（延べ）",           value: correctTotal },
      { type: "❌ 不正解（延べ）",         value: wrongTotal },
      { type: "🟩 正解（ユニーク問題数）", value: correctRaw },
      { type: "🟥 不正解（ユニーク問題数）", value: wrongRaw },
      { type: "📅 記録日数",               value: days },
    ];

    // 画面は軽く、詳細はコンソールに
    console.group("[CSCS] 集計情報");
    console.table(rows);
    console.log("正解 日次ログ (cscs_correct_daily_log):", cd);
    console.log("不正 日次ログ (cscs_wrong_daily_log):",  wd);
    console.groupEnd();

    alert([
      `✅ 正解（延べ）: ${correctTotal}`,
      `❌ 不正解（延べ）: ${wrongTotal}`,
      `🟩 正解（ユニーク問題数）: ${correctRaw}`,
      `🟥 不正解（ユニーク問題数）: ${wrongRaw}`,
      `📅 記録日数: ${days}`,
      "",
      "※ 詳細はブラウザのコンソール (console) を確認してください。"
    ].join("\n"));
  }

  // ===== モーダル（簡易） =====
  function openResetPanel(qid, correct, wrong) {
    // 既存があれば一度除去
    const old = document.getElementById("cscs-reset-modal");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const overlay = document.createElement("div");
    overlay.id = "cscs-reset-modal";
    overlay.style.cssText = [
      "position:fixed","inset:0","z-index:999999",
      "background:rgba(0,0,0,.5)","display:flex",
      "align-items:center","justify-content:center"
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "min-width:320px","max-width:90vw","background:#1c1c1c",
      "color:#fff","border-radius:10px","padding:16px",
      "box-shadow:0 10px 30px rgba(0,0,0,.4)","font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,sans-serif"
    ].join(";");

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">回数記録のリセット</div>
      <div style="opacity:.9;margin-bottom:12px;">
        <div style="margin-bottom:4px;">qid: <code>${qid}</code></div>
        <div style="margin-bottom:8px;">現在の累計（延べ）：<b>正解:${correct}回 / 不正解:${wrong}回</b></div>
        <div>この問題のみの正誤回数（<code>cscs_q_correct_total:${qid}</code> / <code>cscs_q_wrong_total:${qid}</code>）を削除します。</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="cscs-reset-cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #555;background:#2b2b2b;color:#ddd;cursor:pointer; width: 130px;">キャンセル</button>
        <button type="button" id="cscs-reset-do" style="padding:8px 12px;border-radius:8px;border:0 solid #c33;background:#a35757;color:#fff;cursor:pointer; width: 130px;">回数記録のリセット</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function close() {
      try { overlay.remove(); } catch(_){}
    }
    panel.querySelector("#cscs-reset-cancel").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    panel.querySelector("#cscs-reset-do").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { localStorage.removeItem(`cscs_q_correct_total:${qid}`); } catch(_){}
      try { localStorage.removeItem(`cscs_q_wrong_total:${qid}`); } catch(_){}
      close();
      // 反映
      try { console.info("[reset] cleared per-problem totals", { qid }); } catch(_){}
      render();
    });

    // 透過部クリックで閉じる
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  // ===== 描画 =====
  function render() {
    const { label, type } = readFavLabelAndType();

    // 当該1問の QID を pathname から復元（A/B両方対応）
    const dayPath = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1] || "";
    const n3 = (location.pathname.match(/q(\d{3})_[ab]/i) || [])[1] || "";
    const qid = dayPath && n3 ? `${dayPath}-${n3}` : "";

    // 「当該1問の累計（延べ）」を参照
    const correct = qid ? parseInt(localStorage.getItem(`cscs_q_correct_total:${qid}`) || "0", 10) : 0;
    const wrong   = qid ? parseInt(localStorage.getItem(`cscs_q_wrong_total:${qid}`)   || "0", 10) : 0;

    const box = ensureFixedBox();
    const favSpan = box.querySelector(".fav-status");
    const wrongLink = box.querySelector(".wrong-status");

    if (favSpan) {
      favSpan.textContent = `［${label}］`;
      favSpan.className = `fav-status fav-${type}`;
    }
    if (wrongLink) {
      // 表示（リンク）
      wrongLink.textContent = `(正解:${correct}回 / 不正解:${wrong}回)`;
      wrongLink.setAttribute("title", qid ? `qid: ${qid} の累計（延べ）` : `qid未特定（パス判定不可）`);
      wrongLink.setAttribute("href", "#");

      // クリックでモーダル
      wrongLink.onclick = (e) => {
        e.preventDefault();
        if (!qid) return;
        openResetPanel(qid, correct, wrong);
      };
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