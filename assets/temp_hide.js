// assets/temp_hide.js
// 目的:
//   - 指定した要素（#から始まるID）を「一時的に視覚的に非表示」にするだけのUI。
//   - display:none は使わず、DOM上は“存在する”まま（opacity:0 + pointer-events:none）。
//   - ウィンドウ（パネル）はユーザーが閉じるまで開いたまま（localStorageで開閉状態を永続化）。
//   - 各要素のON/OFF状態もlocalStorageで永続化。

(function(){
  "use strict";

  // 二重初期化防止
  if (window.__CSCS_TEMP_HIDE_INSTALLED__) return;
  window.__CSCS_TEMP_HIDE_INSTALLED__ = true;

  // ========= 設定：ここに隠したいIDを登録 =========
  // 例: "#nl-panel" のように必ず # 付きで。
  const TARGET_IDS = [
    "#nl-panel",
    "#cscs_sync_monitor_a",
    "#cscs_sync_monitor_b",
    "#similar-list",
    "#cscs-field-star-summary",
    "#judge",
  ];
  // ==============================================

  // 設定：h1（ページ内に1つ想定）をON/OFF対象に含めるか
  const ENABLE_HIDE_H1 = true;

  // h1用：hidden_map に保存するキー（IDと衝突しない名前空間）
  const H1_MAP_KEY = "tag:h1";

  // 設定：<ol class="opts">（ページ内に1つ想定）をON/OFF対象に含めるか
  const ENABLE_HIDE_OL_OPTS = true;

  // <ol class="opts">用：hidden_map に保存するキー（IDと衝突しない名前空間）
  const OL_OPTS_MAP_KEY = "sel:ol.opts";

  // 設定：.answer / .explain（ページ内1セット想定）をON/OFF対象に含めるか
  const ENABLE_HIDE_ANSWER_EXPLAIN = true;

  // .answer / .explain 用：hidden_map に保存するキー
  const ANSWER_EXPLAIN_MAP_KEY = "cls:answer_explain";

  // 設定：field summary の一部（ページ内1セット想定）をON/OFF対象に含めるか
  const ENABLE_HIDE_FIELD_SUMMARY_PARTS = true;

  // field summary 用：hidden_map に保存するキー（それぞれ個別）
  const STAR_SUMMARY_LINE_MAP_KEY = "cls:cscs_star_summary_line_compact";
  const FIELD_HINT_MAP_KEY = "cls:hint";
  const TOPMETA_LEFT_MAP_KEY = "cls:topmeta_left";
  const QNO_MAP_KEY = "cls:qno";

  const LS_KEY_PREFIX = "cscs_temp_hide_v1:";
  const LS_KEY_PANEL_OPEN = LS_KEY_PREFIX + "panel_open";
  const LS_KEY_HIDDEN_MAP = LS_KEY_PREFIX + "hidden_map";

  const HIDDEN_CLASS = "cscs-temp-hide-hidden";
  const PANEL_ID = "cscs-temp-hide-panel";
  const BTN_ID = "cscs-temp-hide-openbtn";
  const STYLE_ID = "cscs-temp-hide-style";

  function safeJsonParse(s, fallback){
    try { return JSON.parse(s); } catch(e){ return fallback; }
  }

  function loadHiddenMap(){
    const raw = localStorage.getItem(LS_KEY_HIDDEN_MAP);
    const obj = safeJsonParse(raw, {});
    return (obj && typeof obj === "object") ? obj : {};
  }

  function saveHiddenMap(map){
    localStorage.setItem(LS_KEY_HIDDEN_MAP, JSON.stringify(map));
  }

  function normIdHash(id){
    // "#foo" → "foo"
    return String(id || "").trim().replace(/^#/, "");
  }

  function cssEscapeId(idHash){
    // CSS.escape があれば使う。無ければ最低限のエスケープ。
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(idHash);
    return idHash.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  }

  function getElByHash(idHash){
    if (!idHash) return null;
    return document.getElementById(idHash);
  }

  function getH1Elements(){
    // h1（タグ）を直接取得する。存在しなければ空配列。
    // ※フォールバックで別セレクタを探す等はしない（安全・単純）。
    const els = document.getElementsByTagName("h1");
    return Array.from(els || []);
  }

  function getOlOptsElements(){
    // <ol class="opts"> を直接取得する。存在しなければ空配列。
    // ※フォールバックで別セレクタを探す等はしない（安全・単純）。
    const els = document.querySelectorAll("ol.opts");
    return Array.from(els || []);
  }

  function getAnswerExplainElements(){
    // .answer / .explain を直接取得する（ページ内1セット想定）
    // ※フォールバックなし
    const els = document.querySelectorAll(".answer, .explain");
    return Array.from(els || []);
  }

  function getStarSummaryLineElements(){
    // .cscs-star-summary-line-compact を直接取得する（フォールバックなし）
    const els = document.querySelectorAll(".cscs-star-summary-line-compact");
    return Array.from(els || []);
  }

  function getHintElements(){
    // .hint を直接取得する（フォールバックなし）
    const els = document.querySelectorAll(".hint");
    return Array.from(els || []);
  }

  function getTopmetaLeftElements(){
    // .topmeta-left を直接取得する（フォールバックなし）
    const els = document.querySelectorAll(".topmeta-left");
    return Array.from(els || []);
  }

  function getQnoElements(){
    // .qno を直接取得する（フォールバックなし）
    const els = document.querySelectorAll(".qno");
    return Array.from(els || []);
  }

  function applyHiddenStateToElement(el, isHidden){
    if (!el) return;
    if (isHidden) el.classList.add(HIDDEN_CLASS);
    else el.classList.remove(HIDDEN_CLASS);
  }

  function applyHiddenStateToElements(els, isHidden){
    // 複数要素（h1など）に同じ非表示クラスを付与/解除するだけ
    if (!els || !els.length) return;
    for (const el of els){
      applyHiddenStateToElement(el, isHidden);
    }
  }

  function applyAllHiddenStates(){
    const map = loadHiddenMap();

    for (const idSel of TARGET_IDS){
      const idHash = normIdHash(idSel);
      const el = getElByHash(idHash);
      const isHidden = !!map[idHash];
      applyHiddenStateToElement(el, isHidden);
    }

    // h1（タグ）にも同じ非表示クラスを適用する（設定ONのときだけ）
    if (ENABLE_HIDE_H1){
      const isHiddenH1 = !!map[H1_MAP_KEY];
      applyHiddenStateToElements(getH1Elements(), isHiddenH1);
    }

    // <ol class="opts"> にも同じ非表示クラスを適用する（設定ONのときだけ）
    if (ENABLE_HIDE_OL_OPTS){
      const isHiddenOl = !!map[OL_OPTS_MAP_KEY];
      applyHiddenStateToElements(getOlOptsElements(), isHiddenOl);
    }

    // .answer / .explain にも同じ非表示クラスを適用する（設定ONのときだけ）
    if (ENABLE_HIDE_ANSWER_EXPLAIN){
      const isHiddenAE = !!map[ANSWER_EXPLAIN_MAP_KEY];
      applyHiddenStateToElements(getAnswerExplainElements(), isHiddenAE);
    }

    // 追加した処理:
    // - field summary の一部（4要素）も hidden_map の値に従って非表示クラスを付与/解除する
    if (ENABLE_HIDE_FIELD_SUMMARY_PARTS){
      const isHiddenStarLine = !!map[STAR_SUMMARY_LINE_MAP_KEY];
      applyHiddenStateToElements(getStarSummaryLineElements(), isHiddenStarLine);

      const isHiddenHint = !!map[FIELD_HINT_MAP_KEY];
      applyHiddenStateToElements(getHintElements(), isHiddenHint);

      const isHiddenTopLeft = !!map[TOPMETA_LEFT_MAP_KEY];
      applyHiddenStateToElements(getTopmetaLeftElements(), isHiddenTopLeft);

      const isHiddenQno = !!map[QNO_MAP_KEY];
      applyHiddenStateToElements(getQnoElements(), isHiddenQno);
    }
  }

  function ensureStyleOnce(){
    if (document.getElementById(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
/* temp_hide.js */
.${HIDDEN_CLASS}{
  opacity: 0 !important;
  pointer-events: none !important;
}

#${PANEL_ID}{
  position: fixed !important;
  right: 190px;
  bottom: 54px;
  width: 320px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 110px);
  z-index: 999999 !important;
  background: rgba(0,0,0,0.70);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 12px;
  color: #fff;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  overflow: hidden;

  /* 追加した処理:
     - パネル全体を画面内に収めるため、内部を3段（ヘッド/ボディ/フッター）構造で高さ制御する */
  display: flex;
  flex-direction: column;
}

#${PANEL_ID} .th-head{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}

#${PANEL_ID} .th-title{
  font-weight: 700;
  font-size: 12px;
  opacity: 0.95;
}

#${PANEL_ID} .th-close{
  appearance: none;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06);
  color: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

#${PANEL_ID} .th-body{
  padding: 10px 12px 12px 12px;

  /* 追加した処理:
     - パネルの高さ上限の中で、ボディ部分だけ伸縮させる（スクロール担当） */
  flex: 1 1 auto;
  min-height: 0;

  /* 追加した処理:
     - 内容が多い時にボディだけスクロールできるようにする */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

#${PANEL_ID} .th-note{
  font-size: 11px;
  opacity: 0.75;
  margin: 0 0 10px 0;
}

#${PANEL_ID} .th-list{
  display: flex;
  flex-direction: column;
  gap: 8px;
}

#${PANEL_ID} .th-row{
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.10);
}

#${PANEL_ID} .th-left{
  min-width: 0;
}

#${PANEL_ID} .th-id{
  font-weight: 700;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#${PANEL_ID} .th-status{
  font-size: 11px;
  opacity: 0.75;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#${PANEL_ID} .th-toggle{
  appearance: none;
  width: 54px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(0,0,0,0.35);
  position: relative;
  cursor: pointer;
  outline: none;
}

#${PANEL_ID} .th-toggle::after{
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255,255,255,0.75);
  transition: transform 160ms ease;
}

#${PANEL_ID} .th-toggle:checked{
  background: rgba(255,255,255,0.12);
}

#${PANEL_ID} .th-toggle:checked::after{
  transform: translateX(26px);
}

#${PANEL_ID} .th-footer{
  margin-top: 10px;
  display: flex;
  gap: 8px;

  /* 追加した処理:
     - スクロール領域（th-body）の中でもフッターが最後に固定されて見えるようにする */
  flex: 0 0 auto;
}

#${PANEL_ID} .th-btn{
  appearance: none;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06);
  color: #fff;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 11px;
  cursor: pointer;
  flex: 1;
}

#${BTN_ID}{
  position: fixed !important;
  right: 190px;
  bottom: 10px;
  z-index: 999999 !important;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.55);
  color: rgb(255, 255, 255);
  height: 34px;
  cursor: pointer;
  user-select: none;
}
    `.trim();

    document.head.appendChild(st);
  }

  function setPanelOpen(isOpen){
    localStorage.setItem(LS_KEY_PANEL_OPEN, isOpen ? "1" : "0");
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = isOpen ? "block" : "none";
  }

  function isPanelOpen(){
    return localStorage.getItem(LS_KEY_PANEL_OPEN) === "1";
  }

  function buildPanelOnce(){
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const head = document.createElement("div");
    head.className = "th-head";

    const title = document.createElement("div");
    title.className = "th-title";
    title.textContent = "HIDE";

    const closeBtn = document.createElement("button");
    closeBtn.className = "th-close";
    closeBtn.type = "button";
    closeBtn.textContent = "CLOSE";
    closeBtn.addEventListener("click", function(){
      setPanelOpen(false);
    });

    head.appendChild(title);
    head.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "th-body";

    const note = document.createElement("div");
    note.className = "th-note";
    note.textContent = "表示ON/OFF（視覚だけ）— DOMは残ります。";

    const list = document.createElement("div");
    list.className = "th-list";

    body.appendChild(note);
    body.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "th-footer";

    const btnAllShow = document.createElement("button");
    btnAllShow.className = "th-btn";
    btnAllShow.type = "button";
    btnAllShow.textContent = "ALL: 表示ON";
    btnAllShow.addEventListener("click", function(){
      const map = loadHiddenMap();
      for (const idSel of TARGET_IDS){
        const idHash = normIdHash(idSel);
        map[idHash] = false;
        applyHiddenStateToElement(getElByHash(idHash), false);
      }

      // h1（タグ）も一括で表示ONに戻す（設定ONのときだけ）
      if (ENABLE_HIDE_H1){
        map[H1_MAP_KEY] = false;
        applyHiddenStateToElements(getH1Elements(), false);
      }

      // <ol class="opts"> も一括で表示ONに戻す（設定ONのときだけ）
      if (ENABLE_HIDE_OL_OPTS){
        map[OL_OPTS_MAP_KEY] = false;
        applyHiddenStateToElements(getOlOptsElements(), false);
      }

      // .answer / .explain も一括で表示ONに戻す（設定ONのときだけ）
      if (ENABLE_HIDE_ANSWER_EXPLAIN){
        map[ANSWER_EXPLAIN_MAP_KEY] = false;
        applyHiddenStateToElements(getAnswerExplainElements(), false);
      }

      // 追加した処理:
      // - field summary の一部（4要素）も一括で表示ONに戻す
      if (ENABLE_HIDE_FIELD_SUMMARY_PARTS){
        map[STAR_SUMMARY_LINE_MAP_KEY] = false;
        applyHiddenStateToElements(getStarSummaryLineElements(), false);

        map[FIELD_HINT_MAP_KEY] = false;
        applyHiddenStateToElements(getHintElements(), false);

        map[TOPMETA_LEFT_MAP_KEY] = false;
        applyHiddenStateToElements(getTopmetaLeftElements(), false);

        map[QNO_MAP_KEY] = false;
        applyHiddenStateToElements(getQnoElements(), false);
      }

      saveHiddenMap(map);
      refreshRows();
    });

    const btnAllHide = document.createElement("button");
    btnAllHide.className = "th-btn";
    btnAllHide.type = "button";
    btnAllHide.textContent = "ALL: 表示OFF";
    btnAllHide.addEventListener("click", function(){
      const map = loadHiddenMap();
      for (const idSel of TARGET_IDS){
        const idHash = normIdHash(idSel);
        map[idHash] = true;
        applyHiddenStateToElement(getElByHash(idHash), true);
      }

      // h1（タグ）も一括で表示OFFにする（設定ONのときだけ）
      if (ENABLE_HIDE_H1){
        map[H1_MAP_KEY] = true;
        applyHiddenStateToElements(getH1Elements(), true);
      }

      // <ol class="opts"> も一括で表示OFFにする（設定ONのときだけ）
      if (ENABLE_HIDE_OL_OPTS){
        map[OL_OPTS_MAP_KEY] = true;
        applyHiddenStateToElements(getOlOptsElements(), true);
      }

      // .answer / .explain も一括で表示OFFにする（設定ONのときだけ）
      if (ENABLE_HIDE_ANSWER_EXPLAIN){
        map[ANSWER_EXPLAIN_MAP_KEY] = true;
        applyHiddenStateToElements(getAnswerExplainElements(), true);
      }

      // 追加した処理:
      // - field summary の一部（4要素）も一括で表示OFFにする
      if (ENABLE_HIDE_FIELD_SUMMARY_PARTS){
        map[STAR_SUMMARY_LINE_MAP_KEY] = true;
        applyHiddenStateToElements(getStarSummaryLineElements(), true);

        map[FIELD_HINT_MAP_KEY] = true;
        applyHiddenStateToElements(getHintElements(), true);

        map[TOPMETA_LEFT_MAP_KEY] = true;
        applyHiddenStateToElements(getTopmetaLeftElements(), true);

        map[QNO_MAP_KEY] = true;
        applyHiddenStateToElements(getQnoElements(), true);
      }

      saveHiddenMap(map);
      refreshRows();
    });

    footer.appendChild(btnAllShow);
    footer.appendChild(btnAllHide);
    body.appendChild(footer);

    panel.appendChild(head);
    panel.appendChild(body);
    document.body.appendChild(panel);

    function getStatusText(idHash){
      const el = getElByHash(idHash);
      if (!el) return "要素が見つかりません（ID不一致）";
      const tag = el.tagName ? el.tagName.toLowerCase() : "element";
      const cls = (el.className && String(el.className).trim()) ? String(el.className).trim() : "";
      return cls ? `<${tag}> .${cls.split(/\s+/).slice(0,3).join(".")}` : `<${tag}>`;
    }

    function refreshRows(){
      const map = loadHiddenMap();
      list.innerHTML = "";

      for (const idSel of TARGET_IDS){
        const idHash = normIdHash(idSel);

        const row = document.createElement("div");
        row.className = "th-row";

        const left = document.createElement("div");
        left.className = "th-left";

        const idLine = document.createElement("div");
        idLine.className = "th-id";
        idLine.textContent = "#" + idHash;

        const stLine = document.createElement("div");
        stLine.className = "th-status";
        stLine.textContent = getStatusText(idHash);

        left.appendChild(idLine);
        left.appendChild(stLine);

        const toggle = document.createElement("input");
        toggle.className = "th-toggle";
        toggle.type = "checkbox";
        // checked=true を「非表示」にする（スイッチが右に行く＝OFF感）
        toggle.checked = !!map[idHash];

        toggle.addEventListener("change", function(){
          const m = loadHiddenMap();
          m[idHash] = !!toggle.checked;
          saveHiddenMap(m);
          applyHiddenStateToElement(getElByHash(idHash), !!toggle.checked);
        });

        row.appendChild(left);
        row.appendChild(toggle);
        list.appendChild(row);
      }

      // h1（タグ）をリストに追加して個別にON/OFFできるようにする（設定ONのときだけ）
      if (ENABLE_HIDE_H1){
        const row = document.createElement("div");
        row.className = "th-row";

        const left = document.createElement("div");
        left.className = "th-left";

        const idLine = document.createElement("div");
        idLine.className = "th-id";
        idLine.textContent = "h1";

        const stLine = document.createElement("div");
        stLine.className = "th-status";
        stLine.textContent = getH1Elements().length ? "<h1>" : "要素が見つかりません（h1なし）";

        left.appendChild(idLine);
        left.appendChild(stLine);

        const toggle = document.createElement("input");
        toggle.className = "th-toggle";
        toggle.type = "checkbox";
        // checked=true を「非表示」にする
        toggle.checked = !!map[H1_MAP_KEY];

        toggle.addEventListener("change", function(){
          const m = loadHiddenMap();
          m[H1_MAP_KEY] = !!toggle.checked;
          saveHiddenMap(m);
          applyHiddenStateToElements(getH1Elements(), !!toggle.checked);
        });

        row.appendChild(left);
        row.appendChild(toggle);
        list.appendChild(row);
      }

      // <ol class="opts"> をリストに追加して個別にON/OFFできるようにする（設定ONのときだけ）
      if (ENABLE_HIDE_OL_OPTS){
        const row = document.createElement("div");
        row.className = "th-row";

        const left = document.createElement("div");
        left.className = "th-left";

        const idLine = document.createElement("div");
        idLine.className = "th-id";
        idLine.textContent = "ol.opts";

        const stLine = document.createElement("div");
        stLine.className = "th-status";
        stLine.textContent = getOlOptsElements().length ? "<ol.opts>" : "要素が見つかりません（ol.optsなし）";

        left.appendChild(idLine);
        left.appendChild(stLine);

        const toggle = document.createElement("input");
        toggle.className = "th-toggle";
        toggle.type = "checkbox";
        // checked=true を「非表示」にする
        toggle.checked = !!map[OL_OPTS_MAP_KEY];

        toggle.addEventListener("change", function(){
          const m = loadHiddenMap();
          m[OL_OPTS_MAP_KEY] = !!toggle.checked;
          saveHiddenMap(m);
          applyHiddenStateToElements(getOlOptsElements(), !!toggle.checked);
        });

        row.appendChild(left);
        row.appendChild(toggle);
        list.appendChild(row);
      }

      // .answer / .explain をリストに追加して個別にON/OFFできるようにする（設定ONのときだけ）
      if (ENABLE_HIDE_ANSWER_EXPLAIN){
        const row = document.createElement("div");
        row.className = "th-row";

        const left = document.createElement("div");
        left.className = "th-left";

        const idLine = document.createElement("div");
        idLine.className = "th-id";
        idLine.textContent = ".answer / .explain";

        const stLine = document.createElement("div");
        stLine.className = "th-status";
        stLine.textContent = getAnswerExplainElements().length ? "<answer+explain>" : "要素が見つかりません";

        left.appendChild(idLine);
        left.appendChild(stLine);

        const toggle = document.createElement("input");
        toggle.className = "th-toggle";
        toggle.type = "checkbox";
        toggle.checked = !!map[ANSWER_EXPLAIN_MAP_KEY];

        toggle.addEventListener("change", function(){
          const m = loadHiddenMap();
          m[ANSWER_EXPLAIN_MAP_KEY] = !!toggle.checked;
          saveHiddenMap(m);
          applyHiddenStateToElements(getAnswerExplainElements(), !!toggle.checked);
        });

        row.appendChild(left);
        row.appendChild(toggle);
        list.appendChild(row);
      }

      // 追加した処理:
      // - field summary の一部（4要素）をリストに追加して個別にON/OFFできるようにする
      if (ENABLE_HIDE_FIELD_SUMMARY_PARTS){
        (function(){
          const row = document.createElement("div");
          row.className = "th-row";

          const left = document.createElement("div");
          left.className = "th-left";

          const idLine = document.createElement("div");
          idLine.className = "th-id";
          idLine.textContent = ".cscs-star-summary-line-compact";

          const stLine = document.createElement("div");
          stLine.className = "th-status";
          stLine.textContent = getStarSummaryLineElements().length ? "<star-summary-line>" : "要素が見つかりません";

          left.appendChild(idLine);
          left.appendChild(stLine);

          const toggle = document.createElement("input");
          toggle.className = "th-toggle";
          toggle.type = "checkbox";
          toggle.checked = !!map[STAR_SUMMARY_LINE_MAP_KEY];

          toggle.addEventListener("change", function(){
            const m = loadHiddenMap();
            m[STAR_SUMMARY_LINE_MAP_KEY] = !!toggle.checked;
            saveHiddenMap(m);
            applyHiddenStateToElements(getStarSummaryLineElements(), !!toggle.checked);
          });

          row.appendChild(left);
          row.appendChild(toggle);
          list.appendChild(row);
        })();

        (function(){
          const row = document.createElement("div");
          row.className = "th-row";

          const left = document.createElement("div");
          left.className = "th-left";

          const idLine = document.createElement("div");
          idLine.className = "th-id";
          idLine.textContent = ".hint";

          const stLine = document.createElement("div");
          stLine.className = "th-status";
          stLine.textContent = getHintElements().length ? "<hint>" : "要素が見つかりません";

          left.appendChild(idLine);
          left.appendChild(stLine);

          const toggle = document.createElement("input");
          toggle.className = "th-toggle";
          toggle.type = "checkbox";
          toggle.checked = !!map[FIELD_HINT_MAP_KEY];

          toggle.addEventListener("change", function(){
            const m = loadHiddenMap();
            m[FIELD_HINT_MAP_KEY] = !!toggle.checked;
            saveHiddenMap(m);
            applyHiddenStateToElements(getHintElements(), !!toggle.checked);
          });

          row.appendChild(left);
          row.appendChild(toggle);
          list.appendChild(row);
        })();

        (function(){
          const row = document.createElement("div");
          row.className = "th-row";

          const left = document.createElement("div");
          left.className = "th-left";

          const idLine = document.createElement("div");
          idLine.className = "th-id";
          idLine.textContent = ".topmeta-left";

          const stLine = document.createElement("div");
          stLine.className = "th-status";
          stLine.textContent = getTopmetaLeftElements().length ? "<topmeta-left>" : "要素が見つかりません";

          left.appendChild(idLine);
          left.appendChild(stLine);

          const toggle = document.createElement("input");
          toggle.className = "th-toggle";
          toggle.type = "checkbox";
          toggle.checked = !!map[TOPMETA_LEFT_MAP_KEY];

          toggle.addEventListener("change", function(){
            const m = loadHiddenMap();
            m[TOPMETA_LEFT_MAP_KEY] = !!toggle.checked;
            saveHiddenMap(m);
            applyHiddenStateToElements(getTopmetaLeftElements(), !!toggle.checked);
          });

          row.appendChild(left);
          row.appendChild(toggle);
          list.appendChild(row);
        })();

        (function(){
          const row = document.createElement("div");
          row.className = "th-row";

          const left = document.createElement("div");
          left.className = "th-left";

          const idLine = document.createElement("div");
          idLine.className = "th-id";
          idLine.textContent = ".qno";

          const stLine = document.createElement("div");
          stLine.className = "th-status";
          stLine.textContent = getQnoElements().length ? "<qno>" : "要素が見つかりません";

          left.appendChild(idLine);
          left.appendChild(stLine);

          const toggle = document.createElement("input");
          toggle.className = "th-toggle";
          toggle.type = "checkbox";
          toggle.checked = !!map[QNO_MAP_KEY];

          toggle.addEventListener("change", function(){
            const m = loadHiddenMap();
            m[QNO_MAP_KEY] = !!toggle.checked;
            saveHiddenMap(m);
            applyHiddenStateToElements(getQnoElements(), !!toggle.checked);
          });

          row.appendChild(left);
          row.appendChild(toggle);
          list.appendChild(row);
        })();
      }
    }

    refreshRows();

    // DOMが後から差し替わるページでも、見つかったら適用されるように軽く監視
    // （“別ルートから埋め合わせ”ではなく、同じIDが出現したらクラスを付けるだけ）
    const mo = new MutationObserver(function(){
      applyAllHiddenStates();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // パネル初期表示
    panel.style.display = isPanelOpen() ? "block" : "none";
  }

  function buildOpenButtonOnce(){
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "HIDE";
    btn.addEventListener("click", function(){
      const open = isPanelOpen();
      setPanelOpen(!open);
    });

    document.body.appendChild(btn);
  }

  function validateTargetsOnce(){
    // IDの重複/空を軽く除去（挙動を安定させる）
    const seen = new Set();
    const cleaned = [];
    for (const idSel of TARGET_IDS){
      const s = String(idSel || "").trim();
      if (!s) continue;
      if (!s.startsWith("#")) continue;
      const h = normIdHash(s);
      if (!h) continue;
      if (seen.has(h)) continue;
      seen.add(h);
      cleaned.push("#" + h);
    }
    TARGET_IDS.length = 0;
    for (const x of cleaned) TARGET_IDS.push(x);
  }

  function init(){
    ensureStyleOnce();
    validateTargetsOnce();
    applyAllHiddenStates();
    buildPanelOnce();
    buildOpenButtonOnce();

    // 初回ロード時に「開いたまま」を復元
    setPanelOpen(isPanelOpen());
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();