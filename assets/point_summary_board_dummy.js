// assets/point_summary_board_dummy.js
// CSCS: リッチなポイントサマリーボード（固定ミニパネル）
// - ダミー値で表示（後で実データに差し替え可能）
// - 依存なし（単体で動く）
// - 画面右上固定 / 展開・折りたたみ / ミニグラフ / 内訳 / 差分 / 明日の提案 を表示

(function () {
  "use strict";

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    __effectsDisabled = false;
  }
  if (__effectsDisabled) {
    return;
  }

// assets/point_summary_board_dummy.js
// 目的:
//   問題画面に「ポイントサマリ（ダミー）」を一旦組み込み、見た目と配置を確認する。
// 方針:
//   - 依存なし（他JSの結果を参照しない）
//   - 既存DOMを壊さない（1回だけ生成）
//   - A/Bどちらでも表示


  function qs(sel, root){ return (root || document).querySelector(sel); }

  function ensureStyle(){
    if (qs("#psb-dummy-style")) return;
    var style = document.createElement("style");
    style.id = "psb-dummy-style";
    style.textContent = [
      "#psb-dummy{",
      "  position: fixed;",
      "  top: 10px;",
      "  right: 10px;",
      "  z-index: 99999;",
      "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;",
      "  font-size: 12px;",
      "  line-height: 1.25;",
      "  color: rgba(255,255,255,0.92);",
      "  background: rgba(0,0,0,0.35);",
      "  border: 1px solid rgba(255,255,255,0.10);",
      "  border-radius: 12px;",
      "  padding: 10px 12px;",
      "  backdrop-filter: blur(6px);",
      "  -webkit-backdrop-filter: blur(6px);",
      "  box-shadow: none;",
      "  user-select: none;",
      "  max-width: min(320px, calc(100vw - 24px));",
      "}",
      "#psb-dummy .psb-title{",
      "  font-size: 11px;",
      "  opacity: 0.85;",
      "  margin-bottom: 6px;",
      "  letter-spacing: 0.02em;",
      "}",
      "#psb-dummy .psb-grid{",
      "  display: grid;",
      "  grid-template-columns: 1fr 1fr;",
      "  gap: 6px 10px;",
      "}",
      "#psb-dummy .psb-item{",
      "  display: flex;",
      "  justify-content: space-between;",
      "  gap: 8px;",
      "  white-space: nowrap;",
      "}",
      "#psb-dummy .psb-k{",
      "  opacity: 0.80;",
      "}",
      "#psb-dummy .psb-v{",
      "  font-weight: 700;",
      "  opacity: 0.98;",
      "}",
      "#psb-dummy .psb-note{",
      "  margin-top: 8px;",
      "  font-size: 10px;",
      "  opacity: 0.60;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function buildDummyData(){
    // ここが“ダミー値”。あとで本番ロジックに置き換える想定。
    return {
      todayPoints: 37,
      todayAnswered: 12,
      streak3Unique: 4,
      favCount: 18,
      synced: true,
      mode: (document.body && document.body.classList.contains("mode-b")) ? "B" : "A"
    };
  }

  function render(){
    if (qs("#psb-dummy")) return;

    ensureStyle();

    var d = buildDummyData();

    var box = document.createElement("div");
    box.id = "psb-dummy";

    var title = document.createElement("div");
    title.className = "psb-title";
    title.textContent = "Point Summary (dummy) / Part " + d.mode;

    var grid = document.createElement("div");
    grid.className = "psb-grid";

    function addItem(k, v){
      var item = document.createElement("div");
      item.className = "psb-item";
      var kk = document.createElement("div");
      kk.className = "psb-k";
      kk.textContent = k;
      var vv = document.createElement("div");
      vv.className = "psb-v";
      vv.textContent = String(v);
      item.appendChild(kk);
      item.appendChild(vv);
      grid.appendChild(item);
    }

    addItem("Today Points", d.todayPoints);
    addItem("Today Answered", d.todayAnswered);
    addItem("Streak3 Unique", d.streak3Unique);
    addItem("Fav (total)", d.favCount);
    addItem("SYNC", d.synced ? "ON" : "OFF");

    var note = document.createElement("div");
    note.className = "psb-note";
    note.textContent = "※ dummy values / layout check";

    box.appendChild(title);
    box.appendChild(grid);
    box.appendChild(note);

    document.body.appendChild(box);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();