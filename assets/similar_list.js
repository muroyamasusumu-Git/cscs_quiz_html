/* similar_list.js — Aパート下部に「類似／別分野／未着手／要復習問題」を8件（各2件×4カテゴリ）ランダム表示
   参照:
     ・/assets/cscs_meta_all.json（全2700問メタ）
     ・localStorage.cscs_results（回答履歴）
     ・localStorage.cscs_wrong_log（不正解回数）
   表示:
     見出し: 「類似／別分野／未着手／要復習問題」
     中身:   ［類似］［別分野（低類似）］［未着手］［要復習］を各2件、計8件。毎回シャッフル
   定義:
     未着手: 回答回数 0 または ≤1
     要復習: wrong>=2 かつ 正答率<60%（正解率が高いものは除外）
     別分野: 現在の問題と分野が異なり、かつ「類似スコア」が低い候補（0を優先、無ければ下位10から抽出）
*/
(function(){
  "use strict";

  // ====== 小物 ======
  function $(sel, root){ return (root||document).querySelector(sel); }
  function toInt(x, def){ x=Number(x); return Number.isFinite(x)?x:def; }
  function pad3(n){ return String(n).padStart(3,"0"); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => (
      c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c==='"'?"&quot;":"&#39;"
    ));
  }
  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }
  function sample(arr, k){
    if (!arr || !arr.length) return [];
    return shuffle(arr).slice(0, k);
  }

  // 文字列→英数トークン分割
  function tokenizeLatin(s){
    return String(s||"")
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter(w => w && w.length >= 3);
  }
  // JP向けバイグラム
  function bigrams(s){
    const t = String(s||"").replace(/\s+/g, "");
    const out = [];
    for (let i=0; i<t.length-1; i++){
      const g = t.slice(i, i+2);
      if (!/[^\p{Letter}\p{Number}]/u.test(g)) out.push(g);
    }
    return out;
  }

  // JSON正規化
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
    return rows.filter(r => r.q && r.url && r.day && r.n3);
  }

  // 類似スコア（行＋スコアを返す）
  function scoreAll(queryText, rows, base){
    const latin = tokenizeLatin(queryText);
    const jps   = bigrams(queryText);
    const out   = [];

    for (const r of rows){
      const textLower = r.q.toLowerCase();
      let s = 0;
      for (const w of latin){ if (textLower.includes(w)) s += 2; }
      for (const bg of jps){ if (r.q.includes(bg)) s += 1; }
      if (base){
        if (base.field && (r.field||"") === base.field) s += 0.5;
        const lv = (r.level||"").replace(/\s+/g,"").toLowerCase();
        const bl = (base.level||"").replace(/\s+/g,"").toLowerCase();
        if (bl && lv === bl) s += 0.25;
      }
      out.push({row:r, score:s});
    }
    // 高スコア順
    out.sort((a,b)=> b.score - a.score);
    return out;
  }

  // 自ページの設問テキスト
  function resolveQText(hostEl){
    const ds = hostEl ? hostEl.dataset : {};
    if (ds && ds.qtext && ds.qtext.trim()) return ds.qtext.trim();
    const pick = $('.question')?.textContent?.trim()
             || $('h1')?.textContent?.trim()
             || document.body.innerText.trim().split('\n').find(s=>s.length>8)
             || "";
    return pick;
  }

  // nav_manifest.json から Field/Level を拾う
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
      return { field: row.Field||"", theme: row.Theme||"", level: row.Level||"", day, n3: qnum };
    }catch(_){ return null; }
  }

  // 回答履歴を集計（day-n3 単位）
  function readResultsAgg(){
    const KEY="cscs_results";
    let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY)||"[]"); }catch(_){ arr=[]; }
    const map = new Map(); // key: "YYYYMMDD-NNN" -> {total, correct}
    arr.forEach(r=>{
      if (!r || !r.day || !r.stem) return;
      const n3 = String(r.stem||"").slice(1).padStart(3,"0");
      const key = `${r.day}-${n3}`;
      const o = map.get(key) || { total:0, correct:0 };
      o.total += 1;
      if (r.correct) o.correct += 1;
      map.set(key, o);
    });
    return map;
  }

  // 不正解ログを読む
  function readWrongLog(){
    try { return JSON.parse(localStorage.getItem("cscs_wrong_log") || "{}"); }
    catch (_){ return {}; }
  }

  async function run(){
    // 配置場所
    let host = document.getElementById("similar-list");
    let ds   = host ? host.dataset : null;
    if (!host) {
      const me = [...document.scripts].find(s => (s.src||"").includes("similar_list.js"));
      if (me) ds = me.dataset || null;
    }
    if (!ds) return;

    const src   = ds.src || "../../assets/cscs_meta_all.json";
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
    if (!rows.length) return;

    const selfMeta = await tryGetSelfMeta();
    const selfKey = selfMeta && selfMeta.day && selfMeta.n3 ? `${selfMeta.day}-${selfMeta.n3}` : null;
    if (debug) console.log("[mix8] selfMeta:", selfMeta);

    // ===== カテゴリ用の下準備 =====
    const scoredAll = scoreAll(qtext, rows, selfMeta);  // 高→低
    const onlyRows  = scoredAll.map(o => o.row);

    // 1) 類似（上位からランダム2件）— 自分は除外
    let similarPool = onlyRows;
    if (selfKey) similarPool = similarPool.filter(r => `${r.day}-${r.n3}` !== selfKey);

    // 2) 未着手（回答0 or ≤1回）— 同分野×同レベル優先
    const agg = readResultsAgg();
    const wrongLog = readWrongLog();
    function attempts(key){
      const o = agg.get(key);
      return o ? o.total : 0;
    }
    function accuracy(key){
      const o = agg.get(key);
      if (!o || !o.total) return 0;
      return o.correct / o.total;
    }
    const sameFieldLevel = rows.filter(r=>{
      if (!selfMeta) return false;
      const sameF = (r.field||"").trim() === (selfMeta.field||"").trim();
      const sameL = (r.level||"").replace(/\s+/g,"").toLowerCase() === (selfMeta.level||"").replace(/\s+/g,"").toLowerCase();
      return sameF && sameL;
    });
    let untriedPool = (sameFieldLevel.length ? sameFieldLevel : rows).filter(r=>{
      const key = `${r.day}-${r.n3}`;
      if (selfKey && key === selfKey) return false;
      const att = attempts(key);
      return att === 0 || att <= 1;
    });

    // 3) 要復習（wrong>=2 かつ acc<0.6）— 同分野優先
    const sameField = rows.filter(r=>{
      if (!selfMeta) return false;
      return (r.field||"").trim() === (selfMeta.field||"").trim();
    });
    let reviewPool = (sameField.length ? sameField : rows).filter(r=>{
      const key = `${r.day}-${r.n3}`;
      if (selfKey && key === selfKey) return false;
      const wrong = Number(wrongLog[key]||0);
      const acc   = accuracy(key);
      return wrong >= 2 && acc < 0.6;
    });

    // 4) 別分野（低類似）— 分野が異なる & 類似スコアが低い
    //    まずスコア0 & 別分野を優先、無ければスコア下位10 & 別分野から抽出
    const baseField = (selfMeta && selfMeta.field) || "";
    const lowSimZero = scoredAll
      .filter(o => o.score <= 0 && (o.row.field||"") !== baseField && (!selfKey || `${o.row.day}-${o.row.n3}` !== selfKey))
      .map(o => o.row);

    let diffFieldPool = lowSimZero;
    if (!diffFieldPool.length){
      const bottom = scoredAll.slice(-Math.min(50, scoredAll.length)); // 下位50から
      diffFieldPool = bottom
        .filter(o => (o.row.field||"") !== baseField && (!selfKey || `${o.row.day}-${o.row.n3}` !== selfKey))
        .map(o => o.row);
    }

    // ===== 抽出（各2件、重複排除）=====
    const pickSimilar = sample(similarPool, 2);
    const used = new Set(pickSimilar.map(r => `${r.day}-${r.n3}`));

    const pickDiff = sample(diffFieldPool.filter(r => !used.has(`${r.day}-${r.n3}`)), 2);
    pickDiff.forEach(r => used.add(`${r.day}-${r.n3}`));

    const pickUntried = sample(untriedPool.filter(r => !used.has(`${r.day}-${r.n3}`)), 2);
    pickUntried.forEach(r => used.add(`${r.day}-${r.n3}`));

    const pickReview = sample(reviewPool.filter(r => !used.has(`${r.day}-${r.n3}`)), 2);
    pickReview.forEach(r => used.add(`${r.day}-${r.n3}`));

    // --- 足りない分を「別分野→未着手」で補充して8件にする ---
    let combined = [
      ...pickSimilar.map(r => ({ tag:"類似",   cls:"sim",  row:r })),
      ...pickDiff.map(r    => ({ tag:"別分野", cls:"diff", row:r })),
      ...pickUntried.map(r => ({ tag:"未着手", cls:"new",  row:r })),
      ...pickReview.map(r  => ({ tag:"要復習", cls:"rev",  row:r })),
    ];

    if (combined.length < 8) {
      const need = 8 - combined.length;
      const filler1 = sample(diffFieldPool.filter(r => !used.has(`${r.day}-${r.n3}`)), need);
      filler1.forEach(r => {
        used.add(`${r.day}-${r.n3}`);
        combined.push({ tag:"別分野", cls:"diff", row:r });
      });
    }

    if (combined.length < 8) {
      const need = 8 - combined.length;
      const filler2 = sample(untriedPool.filter(r => !used.has(`${r.day}-${r.n3}`)), need);
      filler2.forEach(r => {
        used.add(`${r.day}-${r.n3}`);
        combined.push({ tag:"未着手", cls:"new", row:r });
      });
    }

    const finalList = shuffle(combined).slice(0, 8);

    // ====== 描画 ======
    const wrap = document.querySelector(".wrap");
    if (host) {
      if (wrap && host.parentElement !== wrap) wrap.appendChild(host);
    } else {
      host = document.createElement("div");
      host.id = "similar-list";
      (wrap || document.body).appendChild(host);
    }

    // スタイル
    const styleId = "similar-list-style";
    if (!document.getElementById(styleId)) {
      const st = document.createElement("style");
      st.id = styleId;
      st.textContent = `
#similar-list{ margin:20px 0 0; line-height:1.5; color:#fff; border-top:1px solid #555; padding-top:16px; }
#similar-list .sl-head{ color:#cfe8ff; margin-bottom:8px; font-size:20px; }
#similar-list ul{
  margin:0;
  padding-left:0;
  list-style:none;   /* ← ドット削除 */
}
#similar-list li{ margin:4px 0; font-size:14px; font-weight:300; }
#similar-list a{ color:#fff; text-decoration:none; }
#similar-list a:hover{ text-decoration:underline; }
#similar-list .tag{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:58px;
  padding:2px 6px;
  margin-right:8px;
  border:1px solid #444;
  border-radius:6px;
  font-size:12px;
  vertical-align:middle;
  color:#e0e0e0;
  background:#2b2b2b;
}
#similar-list .tag.sim{  background:#2b2b2b; color:#e0e0e0; border-color:#444; }   /* 濃いめグレー */
#similar-list .tag.diff{ background:#3a3a3a; color:#e6e6e6; border-color:#555; }   /* 少し明るい */
#similar-list .tag.new{  background:#4a4a4a; color:#efefef; border-color:#666; }   /* さらに明るい */
#similar-list .tag.rev{  background:#5a5a5a; color:#fafafa; border-color:#777; }   /* 最も明るい */
      `.trim();
      document.head.appendChild(st);
    }

    let html = `<div class="sl-head">類似／別分野／未着手／要復習問題</div>`;
    if (!finalList.length) {
      html += `<div style="color:#888;">候補なし</div>`;
    } else {
      html += `<ul>` + finalList.map(({tag,cls,row})=>{
        return `<li><span class="tag ${cls}">［${tag}］</span><a href="${row.url}">${escapeHtml(row.q)}</a></li>`;
      }).join("") + `</ul>`;
    }
    host.innerHTML = html;

    if (debug){
      console.log("[mix8] similar:", pickSimilar);
      console.log("[mix8] diffField(low-sim):", pickDiff);
      console.log("[mix8] untried:", pickUntried);
      console.log("[mix8] review:", pickReview);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();