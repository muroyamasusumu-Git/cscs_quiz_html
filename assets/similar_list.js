/* similar_list.js — Aパート下部に「類似問題（全2700問横断）」を表示（JPバイグラム対応版）
   - cscs_meta_all.json 2系統どちらでも動く:
     1) { items: [{ day, n3, url, field, theme, level, text }, ...] }
     2) { questions: [{ Date, Number, Field, Theme, Level, Question }, ...] }
   - #similar-list 要素 or <script src=...> の data-* で制御:
     data-k=候補数 / data-src=JSONパス / data-mode=similar|same-field|same-level / data-debug=1 でログ
     data-qtext=このページの設問（無ければ .question/h1 → body先頭行から自動抽出）
*/
(function(){
  "use strict";

  // ====== 小物 ======
  function $(sel, root){ return (root||document).querySelector(sel); }
  function toInt(x, def){ x=Number(x); return Number.isFinite(x)?x:def; }
  function pad3(n){ return String(n).padStart(3,"0"); }

  // 文字列→英数トークン分割（空白言語は分割されにくいので補助で使う）
  function tokenizeLatin(s){
    return String(s||"")
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter(w => w && w.length >= 3); // 英数は3文字以上で
  }

  // JP向け：連続文字からバイグラム配列を作る（漢字・ひら・カタ・英数すべて対象）
  function bigrams(s){
    const t = String(s||"").replace(/\s+/g, "");
    const out = [];
    for (let i=0; i<t.length-1; i++){
      const g = t.slice(i, i+2);
      // 記号だらけは除外
      if (!/[^\p{Letter}\p{Number}]/u.test(g)) out.push(g);
    }
    // 重複はOK（スコアで数える）
    return out;
  }

  // JSON正規化：{q, url, field, theme, level, day, n3} に揃える
  function normalizeMeta(meta){
    let rows = [];
    if (meta && Array.isArray(meta.items)) {
      rows = meta.items.map(x => ({
        q:     String(x.text || ""),
        url:   x.url || (x.day && x.n3 ? `/_build_cscs_${x.day}/slides/q${x.n3}_a.html` : ""),
        field: x.field || "",
        theme: x.theme || "",
        level: x.level || "",
        day:   x.day || "",
        n3:    x.n3  || ""
      }));
    } else if (meta && Array.isArray(meta.questions)) {
      rows = meta.questions.map(x => ({
        q:     String(x.Question || ""),
        url:   (x.Date && x.Number!=null)
                 ? `/_build_cscs_${x.Date}/slides/q${pad3(Number(x.Number))}_a.html`
                 : "",
        field: x.Field || "",
        theme: x.Theme || "",
        level: x.Level || "",
        day:   x.Date  || "",
        n3:    pad3(Number(x.Number||0))
      }));
    } else if (Array.isArray(meta)) {
      rows = meta.map(x => ({
        q:     String(x.Question || x.text || ""),
        url:   x.url || (x.Date && x.Number!=null ? `/_build_cscs_${x.Date}/slides/q${pad3(Number(x.Number))}_a.html` : ""),
        field: x.Field || x.field || "",
        theme: x.Theme || x.theme || "",
        level: x.Level || x.level || "",
        day:   x.Date  || x.day   || "",
        n3:    x.n3 || pad3(Number(x.Number||0))
      }));
    }
    return rows.filter(r => r.q && r.url);
  }

  // 類似度（軽量）：
  //  - クエリから [latin token] と [JPバイグラム] を作成
  //  - 各候補の問題文に含まれる一致個数を集計（latinは大小無視一致）
  function scoreSimilar(queryText, rows){
    const latin = tokenizeLatin(queryText);
    const jps   = bigrams(queryText);
    if (!latin.length && !jps.length) return [];

    const scored = rows.map(r => {
      const textLower = r.q.toLowerCase();
      let s = 0;
      for (const w of latin){ if (textLower.includes(w)) s += 2; } // 英数一致は重み2
      for (const bg of jps){ if (r.q.includes(bg)) s += 1; }       // JPバイグラムは重み1
      return { score: s, row: r };
    }).filter(o => o.score > 0);

    // 同点なら「同分野/同レベル」を微加点して安定化
    const baseField = (window.__SIM_BASE__ && window.__SIM_BASE__.field) || "";
    const baseLevel = (window.__SIM_BASE__ && window.__SIM_BASE__.level) || "";
    for (const o of scored){
      if (baseField && (o.row.field||"") === baseField) o.score += 0.5;
      if (baseLevel && (o.row.level||"") === baseLevel) o.score += 0.25;
    }

    scored.sort((a,b)=> b.score - a.score);
    return scored;
  }

  // モード別の絞り込み
  function filterByMode(mode, baseRow, rows){
    if (mode === "same-field") {
      const f = (baseRow.field||"").trim();
      return rows.filter(r => (r.field||"").trim() === f);
    }
    if (mode === "same-level") {
      const lv = (baseRow.level||"").replace(/\s+/g,"").toLowerCase();
      return rows.filter(r => (r.level||"").replace(/\s+/g,"").toLowerCase() === lv);
    }
    return rows; // "similar" はそのまま
  }

  // このページの設問テキスト（data-qtext → .question/h1 → body先頭行）
  function resolveQText(hostEl){
    const ds = hostEl ? hostEl.dataset : {};
    if (ds && ds.qtext && ds.qtext.trim()) return ds.qtext.trim();
    const pick = $('.question')?.textContent?.trim()
             || $('h1')?.textContent?.trim()
             || document.body.innerText.trim().split('\n').find(s=>s.length>8)
             || "";
    return pick;
  }

  // nav_manifest.json からこのページの Field/Level 等を拾う（スコア安定用）
  async function tryGetSelfMeta(){
    try{
      const mDay = (location.pathname||"").match(/_build_cscs_(\d{8})/);
      if (!mDay) return null;
      const day = mDay[1];
      const navUrl = new URL(`../slides/nav_manifest.json`, location.href).href;
      const res = await fetch(navUrl, {cache:"no-store"});
      if (!res.ok) return null;
      const j = await res.json();
      const qnum = (location.pathname.match(/q(\d{3})_[ab]/i)||[])[1];
      if (!qnum || !Array.isArray(j.questions)) return null;
      const row = j.questions.find(x => String(x.Number).padStart(3,'0') === qnum);
      if (!row) return null;
      return {
        field: row.Field || "",
        theme: row.Theme || "",
        level: row.Level || "",
        day, n3: qnum
      };
    }catch(_){ return null; }
  }

  async function run(){
    // 配置場所（#similar-list があれば優先。無ければ <script src=...> の data-* ）
    let host = document.getElementById("similar-list");
    let ds   = host ? host.dataset : null;

    if (!host) {
      const me = [...document.scripts].find(s => (s.src||"").includes("similar_list.js"));
      if (me) ds = me.dataset || null;
    }
    if (!ds) return;

    const k     = toInt(ds.k, 5);
    const src   = ds.src || "../../assets/cscs_meta_all.json";
    const mode  = (ds.mode || "similar").toLowerCase(); // similar | same-field | same-level
    const debug = ds.debug === "1";
    const qtext = resolveQText(host || document.body);

    // データ読み込み
    let meta = null;
    try{
      const url = new URL(src, location.href);
      const res = await fetch(url, {cache:"no-store"});
      meta = await res.json();
    }catch(e){
      console.warn("similar_list: JSON load failed:", e);
      return;
    }
    const rows = normalizeMeta(meta);
    if (!rows.length) {
      console.warn("similar_list: no rows in JSON (items/questions not found)");
      return;
    }

    // 自ページの field/level を控える
    const selfMeta = await tryGetSelfMeta();
    window.__SIM_BASE__ = selfMeta || {};
    if (debug){
      console.log("[similar] qtext:", qtext);
      console.log("[similar] rows:", rows.length, rows.slice(0,3));
      console.log("[similar] selfMeta:", selfMeta);
    }

    // モード適用
    let cand = rows;
    if (mode !== "similar") cand = filterByMode(mode, (selfMeta||{}), rows);

    // 類似スコア
    let list = [];
    if (mode === "similar") {
      const scored = scoreSimilar(qtext, cand);
      if (debug){
        console.log("[similar] scored top5:", scored.slice(0,5));
      }
      list = scored.map(o => o.row);
    } else {
      list = cand.slice().sort((a,b)=> b.q.length - a.q.length);
    }

    // 自分自身(同day+n3)は除外
    if (selfMeta && selfMeta.day && selfMeta.n3) {
      list = list.filter(r => !(r.day===selfMeta.day && r.n3===selfMeta.n3));
    }

    // 先頭 k 件
    list = list.slice(0, k);

    // ====== 描画 ======
    const wrap = document.querySelector(".wrap");

    if (host) {
      // 既に存在していて .wrap の外にあるなら、.wrap の末尾へ“移動”
      if (wrap && host.parentElement !== wrap) {
        wrap.appendChild(host); // appendChild は既存ノードなら移動になる
      }
    } else {
      // なければ作って .wrap の末尾（なければ body）に追加
      host = document.createElement("div");
      host.id = "similar-list";
      (wrap || document.body).appendChild(host);
    }

    // スタイル（軽量）
    const styleId = "similar-list-style";
    if (!document.getElementById(styleId)) {
      const st = document.createElement("style");
      st.id = styleId;
      st.textContent = `
#similar-list {
  margin: 20px 0 0;
  line-height: 1.6;
  color: #fff;
}
#similar-list .sl-head {
  color: #cfe8ff;
  margin-bottom: 6px;
  font-size: 20px;
}
#similar-list ul {
  margin: 0;
  padding-left: 0.7em;
}
#similar-list li {
  margin: 2px 0;
  font-size: 17px;
  font-weight: 300;
}
#similar-list a {
  color: #fff;
  text-decoration: none;
}
#similar-list a:hover {
  text-decoration: underline;
}
      `.trim();
      document.head.appendChild(st);
    }

    const label =
      mode === "same-field" ? "同分野の他問題"
    : mode === "same-level" ? "同レベルの他問題"
    : "類似問題（別日から抜粋）";

    let html = `<div class="sl-head">${label}</div>`;
    if (!list.length) {
      html += `<div style="color:#888;">候補なし</div>`;
      if (debug){
        const ltok = tokenizeLatin(qtext);
        const jtok = bigrams(qtext);
        console.log("[similar] no candidates. latinTokens:", ltok, "jpBigrams:", jtok);
      }
    } else {
      html += `<ul>` + list.map(r => (
        `<li><a href="${r.url}">${escapeHtml(r.q)}</a></li>`
      )).join("") + `</ul>`;
    }
    host.innerHTML = html;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => (
      c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c==='"'?"&quot;":"&#39;"
    ));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();