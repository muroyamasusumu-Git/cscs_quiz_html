// /assets/wrong_badge.js 相当機能（お気に入り表示専用版）
// 目的: localStorage の cscs_fav / cscs_fav_map を読み取り、
//       画面左上の .topmeta-left に「［★x］」を表示する。
(() => {
  "use strict";

  // ===== Favorites（ステータス → ラベル） =====

  // お気に入りステータスのラベル化（文字列版）
  function favLabelFromString(s) {
    switch (String(s || "unset")) {
      case "understood": return "★１";
      case "unanswered": return "★２";
      case "none":       return "★３";
      default:           return "★ー";
    }
  }

  // お気に入りステータスのラベル化（数値版）
  function favLabelFromNumber(n) {
    switch ((n | 0)) {
      case 1: return "★１";
      case 2: return "★２";
      case 3: return "★３";
      default: return "★ー";
    }
  }

  // 現在ページの QID に紐づく「お気に入りステータス」を localStorage から読み取る
  // ・cscs_fav      : 文字列版 "understood" / "unanswered" / "none"
  // ・cscs_fav_map  : 数値版   1 / 2 / 3
  function readFavLabelAndType() {
    const dayPath = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1] || "";
    const n3 = (location.pathname.match(/q(\d{3})_[ab]/i) || [])[1] || "";
    const qid = dayPath && n3 ? `${dayPath}-${n3}` : "";
    if (!qid) return { label: "★ー", type: "unset", qid: "" };

    // 1) まず cscs_fav（文字列版）を参照
    try {
      const obj = JSON.parse(localStorage.getItem("cscs_fav") || "{}");
      if (obj && Object.prototype.hasOwnProperty.call(obj, qid)) {
        const raw = String(obj[qid] || "unset");
        return { label: favLabelFromString(raw), type: raw, qid };
      }
    } catch {}

    // 2) 次に cscs_fav_map（数値版）を参照
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
        return { label, type, qid };
      }
    } catch {}

    // どちらにも無ければ「未設定」
    return { label: "★ー", type: "unset", qid };
  }

  // ===== topmeta-left 内に「お気に入り」表示用の箱を用意 =====
  function ensureFixedBox() {
    let box = document.querySelector(".topmeta-left");

    // 無い場合はフォールバックとして生成
    if (!box) {
      box = document.createElement("div");
      box.className = "topmeta-left";

      const topmeta = document.querySelector(".topmeta");
      if (topmeta) {
        topmeta.appendChild(box);
      } else {
        document.body.appendChild(box);
      }
    }

    // お気に入りステータス表示を生成（なければ作る）
    let favEl = box.querySelector(".fav-status");
    if (!favEl) {
      favEl = document.createElement("span");
      favEl.className = "fav-status";
      favEl.textContent = "［--］";
      box.appendChild(favEl);
    }

    return box;
  }

  // ===== 描画 =====
  // 左上 box に「お気に入りステータス」を表示するだけ
  function render() {
    const { label, type, qid } = readFavLabelAndType();

    const box = ensureFixedBox();
    const favSpan = box.querySelector(".fav-status");

    if (favSpan) {
      favSpan.textContent = `［${label}］`;
      favSpan.className = `fav-status fav-${type}`;
    }

    // 現在の★ステータスをデバッグログに出力
    try {
      console.log("★ fav badge status:", { qid, label, type });
    } catch (_) {}
  }

  // ===== 監視 =====
  // DOM構築完了時・storageイベント・タブ復帰・定期タイマーで render を回し続ける

  // 初期描画
  window.addEventListener("DOMContentLoaded", render);

  // 他タブなどから localStorage が書き換わったときも再描画
  window.addEventListener("storage", render);

  // タブ復帰時（非表示→可視）に再描画
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });

  // 2秒おきに再描画（保険としてのポーリング）
  setInterval(render, 2000);
})();