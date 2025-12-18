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

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "similar_list"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
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
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }

  // ====== 小物（ユーティリティ関数群） ======

  // 簡易 querySelector
  function $(sel, root){ return (root||document).querySelector(sel); }

  // 数値変換 + フォールバック
  function toInt(x, def){ x=Number(x); return Number.isFinite(x)?x:def; }

  // 整数を3桁ゼロ埋め（1→"001"）
  function pad3(n){ return String(n).padStart(3,"0"); }

  // HTMLエスケープ（タイトル文字列の安全な埋め込み用）
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => (
      c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c==='"'?"&quot;":"&#39;"
    ));
  }

  // Fisher-Yates シャッフル（元配列は壊さない）
  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  // 配列からランダムに k件サンプル
  function sample(arr, k){
    if (!arr || !arr.length) return [];
    return shuffle(arr).slice(0, k);
  }

  // 文字列→英数字トークンに分解（英語系の類似度用）
  function tokenizeLatin(s){
    return String(s||"")
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u) // 文字・数字以外で区切る
      .filter(w => w && w.length >= 3);   // 長さ3以上のみ採用
  }

  // 日本語向けバイグラム（2文字ずつの連続文字列）
  function bigrams(s){
    const t = String(s||"").replace(/\s+/g, "");
    const out = [];
    for (let i=0; i<t.length-1; i++){
      const g = t.slice(i, i+2);
      // 記号などは除外
      if (!/[^\p{Letter}\p{Number}]/u.test(g)) out.push(g);
    }
    return out;
  }

  // JSON正規化: cscs_meta_all.json がどの形式でも同じ形に整形する
  function normalizeMeta(meta){
    let rows = [];
    // パターン1: { items: [...] }
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
    // パターン2: { questions: [...] } （CSV由来想定）
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
    // パターン3: 配列そのもの
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
    // 必須項目が揃っていないものは除外
    return rows.filter(r => r.q && r.url && r.day && r.n3);
  }

  // 類似スコア計算: queryText と全 rows の類似度を計算し、score付きで返す
  function scoreAll(queryText, rows, base){
    const latin = tokenizeLatin(queryText); // 英語トークン
    const jps   = bigrams(queryText);       // 日本語バイグラム
    const out   = [];

    for (const r of rows){
      const textLower = r.q.toLowerCase();
      let s = 0;

      // 英語トークンが含まれていれば +2
      for (const w of latin){ if (textLower.includes(w)) s += 2; }

      // バイグラムが含まれていれば +1
      for (const bg of jps){ if (r.q.includes(bg)) s += 1; }

      // 現在の問題と同じ Field なら +0.5
      if (base){
        if (base.field && (r.field||"") === base.field) s += 0.5;

        // Level が完全一致なら +0.25
        const lv = (r.level||"").replace(/\s+/g,"").toLowerCase();
        const bl = (base.level||"").replace(/\s+/g,"").toLowerCase();
        if (bl && lv === bl) s += 0.25;
      }
      out.push({row:r, score:s});
    }
    // スコア高い順
    out.sort((a,b)=> b.score - a.score);
    return out;
  }

  // 自ページの設問テキストを推定
  function resolveQText(hostEl){
    const ds = hostEl ? hostEl.dataset : {};
    // data-qtext があればそれを優先
    if (ds && ds.qtext && ds.qtext.trim()) return ds.qtext.trim();

    // 無ければ DOM からそれっぽいテキストを拾う
    const pick = $('.question')?.textContent?.trim()
             || $('h1')?.textContent?.trim()
             || document.body.innerText.trim().split('\n').find(s=>s.length>8)
             || "";
    return pick;
  }

  // nav_manifest.json から現在問題の Field/Theme/Level を取得
  async function tryGetSelfMeta(){
    try{
      const mDay = (location.pathname||"").match(/_build_cscs_(\d{8})/);
      if (!mDay) return null;
      const day = mDay[1];

      // 同日の nav_manifest.json を読み込む
      const navUrl = new URL(`../slides/nav_manifest.json`, location.href).href;
      const res = await fetch(navUrl, {cache:"no-store"});
      if (!res.ok) return null;
      const j = await res.json();

      // 現在の qNNN_a/b から NNN を取得
      const qnum = (location.pathname.match(/q(\d{3})_[ab]/i)||[])[1];
      if (!qnum || !Array.isArray(j.questions)) return null;

      // nav_manifest.questions から該当行を検索
      const row = j.questions.find(x => String(x.Number).padStart(3,'0') === qnum);
      if (!row) return null;

      return { field: row.Field||"", theme: row.Theme||"", level: row.Level||"", day, n3: qnum };
    }catch(_){ return null; }
  }

  // 回答履歴を day-n3 単位に集計（total / correct）
  function readResultsAgg(){
    const KEY="cscs_results";
    let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY)||"[]"); }catch(_){ arr=[]; }
    const map = new Map(); // key: "YYYYMMDD-NNN" -> {total, correct}
    arr.forEach(r=>{
      if (!r || !r.day || !r.stem) return;
      const n3 = String(r.stem||"").slice(1).padStart(3,"0"); // stem="q013" → "013"
      const key = `${r.day}-${n3}`;
      const o = map.get(key) || { total:0, correct:0 };
      o.total += 1;
      if (r.correct) o.correct += 1;
      map.set(key, o);
    });
    return map;
  }

  // 不正解ログ（問題別 wrong 回数）を読む
  function readWrongLog(){
    try { return JSON.parse(localStorage.getItem("cscs_wrong_log") || "{}"); }
    catch (_){ return {}; }
  }

  // メイン処理
  async function run(){
    // host: similar-list 埋め込み先要素（あれば）
    let host = document.getElementById("similar-list");
    let ds   = host ? host.dataset : null;

    // host が無い場合は、自分自身の <script>タグの data-* を参照する
    if (!host) {
      const me = [...document.scripts].find(s => (s.src||"").includes("similar_list.js"));
      if (me) ds = me.dataset || null;
    }
    if (!ds) return; // data-src等が無ければ何もしない

    const src   = ds.src || "../../assets/cscs_meta_all.json"; // メタJSONのパス
    const debug = ds.debug === "1";
    const qtext = resolveQText(host || document.body);         // 自問題テキスト

    // ===== メタデータ読み込み =====
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

    // 自身の Field/Level 等を nav_manifest から取得
    const selfMeta = await tryGetSelfMeta();
    const selfKey = selfMeta && selfMeta.day && selfMeta.n3 ? `${selfMeta.day}-${selfMeta.n3}` : null;
    if (debug) console.log("[mix8] selfMeta:", selfMeta);

    // ===== カテゴリ用の下準備 =====

    // すべての問題に対して類似スコアを計算（高い順）
    const scoredAll = scoreAll(qtext, rows, selfMeta);  // 高→低
    const onlyRows  = scoredAll.map(o => o.row);        // 行だけ取り出し

    // 1) 類似（似ている問題）候補。
    //    自分自身(selfKey)は除外。
    let similarPool = onlyRows;
    if (selfKey) similarPool = similarPool.filter(r => `${r.day}-${r.n3}` !== selfKey);

    // 2) 未着手（回答回数 0 or ≤1回）— 同分野×同レベル優先
    const agg = readResultsAgg();        // { "day-n3": {total, correct} }
    const wrongLog = readWrongLog();     // { "day-n3": wrongCount }

    function attempts(key){
      const o = agg.get(key);
      return o ? o.total : 0;
    }
    function accuracy(key){
      const o = agg.get(key);
      if (!o || !o.total) return 0;
      return o.correct / o.total;
    }

    // 自分と同じ Field & Level の問題リスト
    const sameFieldLevel = rows.filter(r=>{
      if (!selfMeta) return false;
      const sameF = (r.field||"").trim() === (selfMeta.field||"").trim();
      const sameL = (r.level||"").replace(/\s+/g,"").toLowerCase() === (selfMeta.level||"").replace(/\s+/g,"").toLowerCase();
      return sameF && sameL;
    });

    // 未着手候補:
    //   - 同Field&Levelがあればそれを優先
    //   - 回答回数 0 or ≤1
    let untriedPool = (sameFieldLevel.length ? sameFieldLevel : rows).filter(r=>{
      const key = `${r.day}-${r.n3}`;
      if (selfKey && key === selfKey) return false;  // 自分自身は除外
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
      if (selfKey && key === selfKey) return false;   // 自分自身は除外
      const wrong = Number(wrongLog[key]||0);
      const acc   = accuracy(key);
      return wrong >= 2 && acc < 0.6;                 // 不正解2回以上 & 正答率60%未満
    });

    // 4) 別分野（低類似）— 分野が異なる & 類似スコアが低い
    //    まずスコア0 & 別分野を優先、無ければスコア下位50 & 別分野から
    const baseField = (selfMeta && selfMeta.field) || "";
    const lowSimZero = scoredAll
      .filter(o => o.score <= 0 && (o.row.field||")") !== baseField && (!selfKey || `${o.row.day}-${o.row.n3}` !== selfKey))
      .map(o => o.row);

    let diffFieldPool = lowSimZero;
    if (!diffFieldPool.length){
      const bottom = scoredAll.slice(-Math.min(50, scoredAll.length)); // スコア下位50件
      diffFieldPool = bottom
        .filter(o => (o.row.field||"") !== baseField && (!selfKey || `${o.row.day}-${o.row.n3}` !== selfKey))
        .map(o => o.row);
    }

    // ===== 抽出（各カテゴリ指定数、重複排除）=====

    // カテゴリごとの件数指定から表示リストを組み立てる関数
    function buildListByCounts(counts){
      const { sim, diff, untried, rev, limit } = counts;

      // まず「類似」をピックアップ
      const pickSimilar = sample(similarPool, sim);
      const used = new Set(pickSimilar.map(r => `${r.day}-${r.n3}`)); // すでに使ったqID

      // 次に「別分野」から使用済み以外を抽出
      const pickDiff = sample(diffFieldPool.filter(r => !used.has(`${r.day}-${r.n3}`)), diff);
      pickDiff.forEach(r => used.add(`${r.day}-${r.n3}`));

      // 次に「未着手」から
      const pickUntried = sample(untriedPool.filter(r => !used.has(`${r.day}-${r.n3}`)), untried);
      pickUntried.forEach(r => used.add(`${r.day}-${r.n3}`));

      // 最後に「要復習」から
      const pickReview = sample(reviewPool.filter(r => !used.has(`${r.day}-${r.n3}`)), rev);
      pickReview.forEach(r => used.add(`${r.day}-${r.n3}`));

      // 表示順を「別分野 → 類似 → 未着手 → 要復習」に固定
      let combined = [
        ...pickDiff.map(r    => ({ tag:"別分野", cls:"diff", row:r })),
        ...pickSimilar.map(r => ({ tag:"類似",   cls:"sim",  row:r })),
        ...pickUntried.map(r => ({ tag:"未着手", cls:"new",  row:r })),
        ...pickReview.map(r  => ({ tag:"要復習", cls:"rev",  row:r })),
      ];

      // 件数が足りなければ「別分野」から補充
      if (combined.length < limit) {
        const need = limit - combined.length;
        const filler1 = sample(diffFieldPool.filter(r => !used.has(`${r.day}-${r.n3}`)), need);
        filler1.forEach(r => {
          used.add(`${r.day}-${r.n3}`);
          combined.push({ tag:"別分野", cls:"diff", row:r });
        });
      }
      // まだ足りなければ「未着手」で補充
      if (combined.length < limit) {
        const need = limit - combined.length;
        const filler2 = sample(untriedPool.filter(r => !used.has(`${r.day}-${r.n3}`)), need);
        filler2.forEach(r => {
          used.add(`${r.day}-${r.n3}`);
          combined.push({ tag:"未着手", cls:"new", row:r });
        });
      }

      // 展開時（limit>4）は一覧をシャッフルしてから limit 件
      // 折りたたみ時（limit<=4）はカテゴリ順そのまま
      if (limit > 4) {
        return shuffle(combined).slice(0, limit);
      }
      return combined.slice(0, limit);
    }

    // 折りたたみ時: 別分野1 / 類似1 / 未着手1 / 要復習0 = 計3件
    const countsCollapsed = { sim:1, diff:1, untried:1, rev:0, limit:3 };
    // 展開時: 各4件×4カテゴリ = 16件
    const countsExpanded  = { sim:4, diff:4, untried:4, rev:4, limit:16 };

    // 初期状態は折りたたみ
    let expanded = false;
    let finalList = buildListByCounts(countsCollapsed);

    // ====== DOM配置・スタイル ======
    const wrap = document.querySelector(".wrap");

    // 既存 host があれば .wrap の末尾へ移動
    if (host) {
      if (wrap && host.parentElement !== wrap) wrap.appendChild(host);
    } else {
      // 無ければ新規作成
      host = document.createElement("div");
      host.id = "similar-list";
      (wrap || document.body).appendChild(host);
    }

    // スタイルタグを一度だけ挿入
    const styleId = "similar-list-style";
    if (!document.getElementById(styleId)) {
      const st = document.createElement("style");
      st.id = styleId;
      st.textContent = `
#similar-list {
    line-height: 1.5;
    color: #fff;
    border-top: 0 solid #555;
    width: 57%;
}

#similar-list .sl-head{ color:#cfe8ff; margin-bottom:8px; font-size:15px; }
#similar-list .sl-head .sl-toggle{
  color:#cfe8ff;
  text-decoration:underline;   /* テキストリンク風 */
  cursor:pointer;
}
#similar-list .sl-head .sl-toggle:hover{ opacity:0.9; }

#similar-list ul{
  margin:0;
  padding-left:0;
  list-style:none;   /* ← ドット削除 */
}
#similar-list li{
  margin:4px 0;
  font-size:14px;
  font-weight:300;

  display:flex;
  align-items:center;
  gap:0;
}
#similar-list a{
  color:#fff;
  text-decoration:none;

  /* 追加：1行固定＋省略表示 */
  display:inline-block;
  max-width: calc(100% - 70px); /* タグ分を除外（微調整可） */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
#similar-list a:hover{ text-decoration:underline; }
#similar-list .tag{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:52px;
  padding:0px 0px;
  margin-right:8px;
  border:1px solid #444;
  border-radius:6px;
  font-size:11px;
  vertical-align:middle;
  color:#e0e0e0;
  background:#2b2b2b;
}
#similar-list .tag.sim{  background:#2b2b2b; color:#e0e0e0; border-color:#444; }   /* 類似: 濃いめグレー */
#similar-list .tag.diff{ background:#3a3a3a; color:#e6e6e6; border-color:#555; }   /* 別分野 */
#similar-list .tag.new{  background:#4a4a4a; color:#efefef; border-color:#666; }   /* 未着手 */
#similar-list .tag.rev{  background:#5a5a5a; color:#fafafa; border-color:#777; }   /* 要復習 */

#similar-list .sl-clear{
  margin-top:13px;
  text-align:left;
  line-height:0;
  font-weight:300;
}
#similar-list .sl-clear .sl-clear-btn{
  display:inline;
  font-size:18px;
  font-weight:400;
  color:#ccc;
  text-decoration:underline;
  cursor:pointer;
}
#similar-list .sl-clear .sl-clear-btn:hover{
  color:#fff;
  opacity:0.9;
}
      `.trim();
      document.head.appendChild(st);
    }

    // ====== 描画関数 ======
    function render(){
      const titleText = "類似／別分野／未着手／要復習問題を一覧表示";
      let html = `<div class="sl-head"><a href="#" class="sl-toggle" aria-label="${titleText}">${titleText}</a></div>`;

      if (!finalList.length) {
        html += `<div style="color:#888;">候補なし</div>`;
      } else {
        html += `<ul>` + finalList.map(({tag,cls,row})=>{
          return `<li><span class="tag ${cls}">［${tag}］</span><a href="${row.url}">${escapeHtml(row.q)}</a></li>`;
        }).join("") + `</ul>`;
      }

      // 展開中のみ、最下部に [× 一覧を消去する] を出す
      if (expanded) {
        html += `<div class="sl-clear"><a href="#" class="sl-clear-btn">[× 一覧を消去する]</a></div>`;
      }

      host.innerHTML = html;

      // 見出しクリックで「折りたたみ ↔ 展開」トグル
      const toggle = host.querySelector(".sl-toggle");
      if (toggle) {
        toggle.addEventListener("click", (e)=>{
          e.preventDefault();
          expanded = !expanded;
          finalList = buildListByCounts(expanded ? countsExpanded : countsCollapsed);
          render();
        });
      }

      // [× 一覧を消去する] で折りたたみ状態に戻す
      const clearBtn = host.querySelector(".sl-clear-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", (e)=>{
          e.preventDefault();
          expanded = false;
          finalList = buildListByCounts(countsCollapsed);
          render();
        });
      }
    }

    // 初回描画
    render();

    if (debug){
      // debug=1 のときに、必要ならここに追加ログを書く想定
    }
  }

  // DOM準備ができてから run() を呼ぶ
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();