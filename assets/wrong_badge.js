// /assets/wrong_badge.js （お気に入りの種別ごとに色分け）
(() => {
  "use strict";

  function getDayAndN3() {
    const day = (location.pathname.match(/_build_cscs_(\d{8})/)||[])[1] || "";
    const n3  = (location.pathname.match(/q(\d{3})_[ab]/)||[])[1] || "";
    return { day, n3, key: day && n3 ? `${day}-${n3}` : "" };
  }

  function readWrongCount() {
    try {
      const m = JSON.parse(localStorage.getItem("cscs_wrong_log")||"{}");
      const { key } = getDayAndN3();
      if (!key) return "--";
      const v = m[key];
      return (typeof v === "number" && isFinite(v)) ? v : "--";
    } catch { return "--"; }
  }

  // 文字列版 → ラベル
  function favLabelFromString(s){
    switch(String(s||"unset")){
      case "understood": return "理解済";
      case "unanswered": return "要復習";
      case "none":       return "重要";
      case "unset":
      default:           return "未設定";
    }
  }

  // 数値版 → ラベル
  function favLabelFromNumber(n){
    switch((n|0)){
      case 1: return "理解済";
      case 2: return "要復習";
      case 3: return "重要";
      default: return "未設定";
    }
  }

  function readFavLabelAndKey(){
    const { key } = getDayAndN3();
    if (!key) return { label: "未設定", type: "unset" };

    // 新フォーマット優先
    try{
      const obj = JSON.parse(localStorage.getItem("cscs_fav")||"{}");
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)){
        const raw = String(obj[key]||"unset");
        return { label: favLabelFromString(raw), type: raw };
      }
    }catch(_){}

    // 旧フォーマット互換
    try{
      const m = JSON.parse(localStorage.getItem("cscs_fav_map")||"{}");
      if (m && Object.prototype.hasOwnProperty.call(m, key)){
        const n = m[key];
        const label = favLabelFromNumber(n);
        const type =
          n === 1 ? "understood" :
          n === 2 ? "unanswered" :
          n === 3 ? "none" :
          "unset";
        return { label, type };
      }
    }catch(_){}

    return { label: "未設定", type: "unset" };
  }

  // ===== 固定表示エリア作成 =====
  function ensureFixedBox() {
    const boxId = "cscs-fixed-status";
    let box = document.getElementById(boxId);
    if (box) return box;

    box = document.createElement("div");
    box.id = boxId;
    box.innerHTML = `
      <span class="fav-status">［--］</span>
      <span class="wrong-status">（不正解:--回）</span>
    `;
    document.body.appendChild(box);
    return box;
  }

  function render() {
    const { label, type } = readFavLabelAndKey();
    const wrong = readWrongCount();
    const box = ensureFixedBox();
    const favSpan = box.querySelector(".fav-status");
    const wrongSpan = box.querySelector(".wrong-status");

    if (favSpan) {
      favSpan.textContent = `［${label}］`;
      favSpan.className = `fav-status fav-${type}`; // ← 色分けクラスを追加
    }
    if (wrongSpan) wrongSpan.textContent = `（不正解:${wrong}回）`;
  }

  // 初回描画
  window.addEventListener("DOMContentLoaded", render);
  // 値変更で再描画
  window.addEventListener("storage", (e) => {
    if (["cscs_fav", "cscs_fav_map", "cscs_wrong_log"].includes(e.key)) render();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });

})();