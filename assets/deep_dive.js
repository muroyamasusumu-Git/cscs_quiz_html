// deep_dive.js — DOM + cscs-meta 動的生成（Google Gemini API版 / Bパート専用・CSV&辞書完全排除）
// 使い方：APIボタンを押すだけで localStorage.gemini_api_key に保存（ワンクリ）

(function(){
  "use strict";

  // ====== 設定 ======
  const GEMINI_MODEL  = "models/gemini-2.5-flash";
  const ENDPOINTS = [
    "https://generativelanguage.googleapis.com/v1beta/",
    "https://generativelanguage.googleapis.com/v1/"
  ];
  const PANEL_TOP_GAP = 12;

  // ▼ ハードコードキーは廃止（Cloudflare Functions 経由で配布）
  //   必要なら data-gemini-key / localStorage / /api-key の順で取得します。

  // ====== パス/ストレージヘルパ ======
  function getDayFromPathDD(){
    const m = (window.location.pathname||"").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }
  function getStemFromPathDD(){
    const m = (window.location.pathname||"").match(/\/(q\d{3})_[ab](?:\.html)?(?:\?.*)?(?:#.*)?$/i);
    return m ? m[1] : "q000";
  }
  function isBPart(){
    // Clean URLs（拡張子なし）と .html 両対応
    // 例: q001_b?choice=B / q001_b.html?choice=B / 末尾#hash など
    return /_b(?:\.html)?(?:\?.*)?(?:#.*)?$/i.test(String(location.href||""));
  }
  function ddKey(){
    const day  = getDayFromPathDD();
    const stem = getStemFromPathDD();
    return `cscs_dd_${day}_${stem}`;
  }

  // ====== ユーティリティ（APIキー関連） ======
  let __GEMINI_KEY_CACHE = null;

  // 明示的な「作動解除」フラグ（localStorage）
  // ※ フロントでは API キーそのものは一切保持しない。ここでは
  //    「この端末では一時的に Deep Dive を止めたい」というユーザーの意思だけを保存する。
  function isApiDisabled() {
    try { return localStorage.getItem('dd_api_disabled') === '1'; } catch (_) { return false; }
  }
  function setApiDisabled(v) {
    try {
      if (v) localStorage.setItem('dd_api_disabled', '1');
      else localStorage.removeItem('dd_api_disabled');
    } catch (_){}
  }

  // クライアント側で API キーを扱うことは廃止。
  // 互換用に残しておくが、必ず失敗させるスタブにする。
  async function getApiKey() {
    throw new Error('CLIENT_SIDE_API_KEY_DISABLED');
  }

  function toast(msg) {
    try {
      const el = document.createElement("div");
      el.textContent = msg;
      el.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#333;color:#fff;padding:8px 12px;border-radius:8px;z-index:99999;opacity:.95";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1800);
    } catch {}
  }

  // API バッジは「サーバー経由の Deep Dive が有効か（一時停止か）」だけを表示する。
  // API キーの有無や中身は一切チェックしない。
  async function updateApiBadge() {
    const disabled = isApiDisabled();
    const ok = !disabled;

    const badge = document.querySelector("[data-dd-api-badge]") || document.getElementById("dd-api-badge");
    if (badge) {
      if (disabled) {
        badge.textContent = "API: ⏸";
      } else {
        badge.textContent = "API: ✅（サーバー経由）";
      }
      badge.classList.toggle("dd-api-ok", ok);
      badge.classList.toggle("dd-api-paused", disabled);
      badge.classList.toggle("dd-api-ng", !ok && !disabled);
    }
    try { window.dispatchEvent(new CustomEvent("dd:apikey-changed", { detail: { ok, disabled } })); } catch(_){}
  }

  // ====== API状態表示UI（上部固定・テキスト形式：キーは扱わない） ======
  async function addApiButton() {
    // 既に存在する場合はスキップ
    if (document.getElementById("dd-api-status")) return;

    // 上部に固定表示を作成
    const apiWrap = document.createElement("div");
    apiWrap.id = "dd-api-status";
    apiWrap.style.cssText = "position:fixed;top:6px;left:12px;z-index:10060;font-size:14px;line-height:1.6;color:#222;background:rgba(255,255,255,.9);padding:4px 8px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);";
    const badge = document.createElement("span");
    badge.id = "dd-api-badge";
    const link = document.createElement("span");
    link.id = "dd-api-toggle";
    link.style.cssText = "margin-left:8px;text-decoration:underline;cursor:pointer;display:inline-block;user-select:none;tab-index:0;";
    link.setAttribute("role", "button");
    link.setAttribute("aria-label", "API設定の切り替え");
    apiWrap.appendChild(badge);
    apiWrap.appendChild(link);
    document.body.appendChild(apiWrap);

    // まずは即時プレースホルダー（非同期待ちの間も文言が見える）
    badge.textContent = "API : ⏸️ （停止中）";
    link.textContent = "APIを有効化";

    // 状態更新（有効／一時停止フラグだけを扱う）
    async function refreshLabel() {
      try {
        const disabled = isApiDisabled();
        const badgeEl = document.getElementById("dd-api-badge");
        const linkEl = document.getElementById("dd-api-toggle");

        if (!badgeEl || !linkEl) return;

        if (disabled) {
          badgeEl.textContent = "API : ⏸️ （停止中）";
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            setApiDisabled(false);
            await updateApiBadge();
            await refreshLabel();
            toast("✅ APIを有効化しました");
          };
        } else {
          badgeEl.textContent = "API : ✅ （サーバー経由）";
          linkEl.textContent = "APIを一時停止";
          linkEl.onclick = async () => {
            setApiDisabled(true);
            await updateApiBadge();
            await refreshLabel();
            toast("⏸ APIを一時停止しました");
          };
        }
      } catch (_) {
        // 安全側フォールバック
        const badgeEl = document.getElementById("dd-api-badge");
        const linkEl = document.getElementById("dd-api-toggle");
        if (badgeEl) badgeEl.textContent = "API : ⏸️ （停止中）";
        if (linkEl) {
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            setApiDisabled(false);
            await updateApiBadge();
            await refreshLabel();
          };
        }
      }
    }

    await updateApiBadge();
    await refreshLabel();
  }

  // ====== できるだけ確実にコピーする（HTTPS→ClipboardAPI / それ以外→execCommand） ======
  async function copyTextSmart(text){
    try{
      if (navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(_){}
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.setAttribute("readonly","");
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    }catch(_){}
    return false;
  }

  // ====== iPad Safari 検出 ======
  function isIPadSafari(){
    const ua  = navigator.userAgent || "";
    const iPadUA   = /iPad/.test(ua);
    const macTouch = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return (iPadUA || macTouch) && isSafari;
  }

  // ====== IndexedDB（全日2700問メタ）ユーティリティ ======
  // DB: 'cscs_meta' / store: 'qmeta' / keyPath: 'qid'（例: 20250926-001）
  // レコード想定: {
  //   qid, date, number, field, theme, level, question,
  //   tokens: [...], // 小文字単語群
  // }
  const META_DB_NAME = "cscs_meta";
  const META_DB_VERSION = 1;
  const META_STORE = "qmeta";

  function openMetaDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(META_DB_NAME, META_DB_VERSION);
      req.onupgradeneeded = (ev)=>{
        const db = ev.target.result;
        if(!db.objectStoreNames.contains(META_STORE)){
          const st = db.createObjectStore(META_STORE, { keyPath: "qid" });
          st.createIndex("date","date",{unique:false});
          st.createIndex("field","field",{unique:false});
          st.createIndex("theme","theme",{unique:false});
          st.createIndex("level","level",{unique:false});
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error || new Error("openMetaDB failed"));
    });
  }

  function tokenize(s){
    if(!s) return [];
    // 全角→半角・英数字化は簡易対応、記号と空白で分割、2文字以上のみ
    const z2h = String(s).normalize("NFKC").toLowerCase();
    return z2h.split(/[^a-z0-9一-龠ぁ-んァ-ン]+/).filter(t => t && t.length >= 2);
  }

  async function putManyToDB(db, rows){
    if(!rows || !rows.length) return;
    await new Promise((resolve, reject)=>{
      const tx = db.transaction(META_STORE, "readwrite");
      const st = tx.objectStore(META_STORE);
      rows.forEach(r => st.put(r));
      tx.oncomplete = ()=> resolve();
      tx.onerror = ()=> reject(tx.error || new Error("putMany failed"));
    });
  }

  async function getAllFromDB(db){
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(META_STORE, "readonly");
      const st = tx.objectStore(META_STORE);
      const out = [];
      const req = st.openCursor();
      req.onsuccess = (e)=>{
        const cur = e.target.result;
        if(cur){ out.push(cur.value); cur.continue(); }
        else resolve(out);
      };
      req.onerror = ()=> reject(req.error || new Error("cursor failed"));
    });
  }

  // nav_manifest.json → DB 追加読み込み
  async function ingestDayNavManifest(db, url){
    try{
      const res = await fetch(url, { headers: { "accept":"application/json" }});
      if(!res.ok) return false;
      const j = await res.json();
      const day = j.day || "";
      const items = Array.isArray(j.questions) ? j.questions : [];
      const rows = items.map(it=>{
        const date = (j.day || (it.Date||"")).replace(/\D/g,"");
        const num  = String(it.Number||"").padStart(3,"0");
        const qid  = `${date}-${num}`;
        const field = it.Field || "";
        const theme = it.Theme || "";
        const level = it.Level || "";
        const question = it.Question || "";
        const tags = [it.Tag_Cause||"", it.Tag_Process||"", it.Tag_Outcome||""].join(" ");
        const toks = Array.from(new Set([
          ...tokenize(question), ...tokenize(field), ...tokenize(theme), ...tokenize(level), ...tokenize(tags)
        ]));
        return { qid, date, number: num, field, theme, level, question, tokens: toks };
      });
      await putManyToDB(db, rows);
      return true;
    }catch(_){ return false; }
  }
  
  async function ingestAllDaysFromGlobalManifest(db, opts={}){
    const {
      manifestUrl = "/manifest.json",   // quiz_html 直下に build_quiz.py が出力
      concurrency = 3,                  // 同時取得数（Safari 対策で控えめ）
      delayMs = 80,                     // 1リクエスト間のスロットリング
      logPrefix = "[qmeta]"
    } = opts;

    try{
      console.time(`${logPrefix} import-all`);
      console.log(`${logPrefix} fetch manifest:`, manifestUrl);

      const res = await fetch(manifestUrl, { headers: { "accept":"application/json" }});
      if(!res.ok){
        console.warn(`${logPrefix} manifest fetch failed:`, res.status);
        return false;
      }
      const mani = await res.json();
      const days = Array.isArray(mani.days) ? mani.days : [];
      if(!days.length){
        console.warn(`${logPrefix} manifest has no days`);
        return false;
      }

      // 既に取り込まれている qid を軽く把握（重複投入を避ける）
      const existingQids = new Set();
      await new Promise((resolve,reject)=>{
        const out=[]; const tx=db.transaction('qmeta','readonly');
        tx.objectStore('qmeta').openCursor().onsuccess = e=>{
          const c=e.target.result; if(c){ existingQids.add(c.value.qid); c.continue(); } else resolve(out);
        };
        tx.onerror = ()=>reject(tx.error);
      });

      // days[].path は "/_build_cscs_YYYYMMDD/slides/nav_manifest.json"
      // 並列コントロールしながら順次投入
      let inFlight = 0;
      let idx = 0;
      let ok = 0, ng = 0;

      async function worker(){
        while(idx < days.length){
          const me = idx++;
          const d = days[me];
          const url = d && d.path ? d.path : null;
          if(!url) { ng++; continue; }

          // ingestDayNavManifest は内部で putMany を行うが、
          // 既存 qid が多いと二重投入になるので軽くフィルタするため、
          // 1回だけ先に JSON を取得して差分投入するバージョンで上書き
          try{
            const r = await fetch(url, { headers: { "accept":"application/json" }});
            if(!r.ok){ ng++; await new Promise(r=>setTimeout(r, delayMs)); continue; }
            const j = await r.json();
            const day = j.day || "";
            const items = Array.isArray(j.questions) ? j.questions : [];
            const rows = items.map(it=>{
              const date = (j.day || (it.Date||"")).replace(/\D/g,"");
              const num  = String(it.Number||"").padStart(3,"0");
              const qid  = `${date}-${num}`;
              const field = it.Field || "";
              const theme = it.Theme || "";
              const level = it.Level || "";
              const question = it.Question || "";
              const tags = [it.Tag_Cause||"", it.Tag_Process||"", it.Tag_Outcome||""].join(" ");
              const toks = Array.from(new Set([
                ...tokenize(question),
                ...tokenize(field),
                ...tokenize(theme),
                ...tokenize(level),
                ...tokenize(tags)
              ]));
              return { qid, date, number: num, field, theme, level, question, tokens: toks };
            }).filter(r => !existingQids.has(r.qid));

            if(rows.length){
              await putManyToDB(db, rows);
              rows.forEach(r=>existingQids.add(r.qid));
            }
            ok++;
          }catch(e){
            console.warn(`${logPrefix} fetch/day failed:`, url, e);
            ng++;
          }
          await new Promise(r=>setTimeout(r, delayMs));
        }
      }

      const workers = [];
      for(let k=0;k<concurrency;k++) workers.push(worker());
      await Promise.all(workers);

      console.log(`${logPrefix} done: ok=${ok} ng=${ng} (totalDays=${days.length})`);
      console.timeEnd(`${logPrefix} import-all`);
      return true;
    }catch(e){
      console.warn("[qmeta] import-all error:", e);
      return false;
    }
  }  

  // メタの初期取り込み：
  // 1) まず“その日”の nav_manifest.json（従来挙動）
  // 2) 次に（あれば）/manifest.json を使って “全日分” を取り込み
  async function ensureSomeMetaLoaded(db){
    // 1) 今日の分（slides/ 配下）
    const here = location.pathname.replace(/\/[^\/]+$/, "/nav_manifest.json");
    try { await ingestDayNavManifest(db, here); } catch(_) {}

    // 2) 全日分（quiz_html/manifest.json）
    //    - すでに DB にレコードが十分ある場合はスキップしてもいいが、
    //      ここでは id 重複チェックを中でやるのでそのまま呼ぶ。
    try {
      await ingestAllDaysFromGlobalManifest(db, {
        manifestUrl: "/manifest.json",
        concurrency: 3,
        delayMs: 80,
        logPrefix: "[qmeta]"
      });
    } catch(_){}
  }
  
  // ====== 初回生成タイミングでのみDB投入するワンショット ======
  let __qmetaLoadedOnce = false;
  async function ensureQmetaLoadedOnce(){
    if (__qmetaLoadedOnce) return;
    try {
      const db = await openMetaDB();
      console.log("[qmeta] lazy: ensureSomeMetaLoaded start");
      await ensureSomeMetaLoaded(db);
      console.log("[qmeta] lazy: ensureSomeMetaLoaded done");
    } catch (e) {
      console.warn("[qmeta] lazy: ensureSomeMetaLoaded error:", e);
    }
    __qmetaLoadedOnce = true;
  }

  function jaccardScore(aTokens, bTokens){
    if(!aTokens.length || !bTokens.length) return 0;
    const A = new Set(aTokens);
    const B = new Set(bTokens);
    let inter = 0;
    for(const t of A){ if(B.has(t)) inter++; }
    const uni = A.size + B.size - inter;
    return uni ? inter / uni : 0;
  }

  // 類似検索：Field/Theme一致を強く、Level近さとトークン重なりでスコア
  async function findSimilarQuestions(current, { limit = 5 } = {}){
    const db = await openMetaDB();
    // 初回は最低限の投入を保証
    const all0 = await getAllFromDB(db);
    if (!all0.length) {
      await ensureSomeMetaLoaded(db);
    }
    const all = await getAllFromDB(db);

    // 現在問題のキー情報
    const curQid   = String(current.qid || "");
    const curDate  = String(current.date || "").replace(/\D/g,"");
    const curNum   = String(current.number || "").padStart(3,"0");
    const curField = (current.field || "").trim();
    const curTheme = (current.theme || "").trim();
    const curLevelNum = (String(current.level||"").match(/([0-5])/) || [,""])[1];

    // トークン
    const curTokens = Array.from(new Set([
      ...tokenize(current.question||""),
      ...tokenize(current.field||""),
      ...tokenize(current.theme||""),
      ...tokenize(current.level||""),
      ...tokenize((current.tagsCause||[]).join(" ")),
      ...tokenize((current.tagsProc||[]).join(" ")),
      ...tokenize((current.tagsOut||[]).join(" ")),
    ]));

    // 現在Aページの相対URL（自分判定の保険）
    const currentHrefA = (function(){
      const stem = `q${curNum}_a.html`;
      return `../../_build_cscs_${curDate}/slides/${stem}`;
    })();

    const candidates = all.filter(r=>{
      if (!r) return false;
      // 1) qid 完全一致は除外
      if (r.qid && curQid && r.qid === curQid) return false;
      // 2) date+number 一致も除外（qid欠損対策）
      const rDate = String(r.date||"").replace(/\D/g,"");
      const rNum  = String(r.number||"").padStart(3,"0");
      if (rDate === curDate && rNum === curNum) return false;
      return true;
    });

    const scored = candidates
      .map(r=>{
        const levelNum = (String(r.level||"").match(/([0-5])/)||[,""])[1];
        const levelClose =
          (curLevelNum && levelNum)
            ? (curLevelNum === levelNum ? 1 : (Math.abs(+curLevelNum - +levelNum) === 1 ? 0.6 : 0))
            : 0;

        const ftBonus =
          ((r.field||"").trim() === curField ? 1 : 0) +
          ((r.theme||"").trim() === curTheme ? 1 : 0);

        const tokScore = jaccardScore(curTokens, r.tokens || []);
        const score = ftBonus * 1.2 + levelClose * 0.6 + tokScore * 0.8;

        // 生成時にリンクが自分自身に一致する可能性を保険で弾くため、hrefも付けておく
        const hrefA = buildQuestionHref(r.date, r.number, "a");
        return { ...r, _score: score, _hrefA: hrefA };
      })
      // 3) href一致も除外（配信パス差異などの保険）
      .filter(r => r._score > 0 && r._hrefA !== currentHrefA)
      .sort((a,b)=> b._score - a._score)
      .slice(0, limit);

    return scored;
  }

  function buildQuestionHref(date, number, part /* "a" or "b" */ = "a"){
    // 現在: /.../quiz_html/_build_cscs_YYYYMMDD/slides/qNNN_b.html
    // 目標: ../../_build_cscs_YYYYMMDD/slides/qNNN_a.html への相対リンク
    const stem = `q${String(number||"").padStart(3,"0")}_${part}.html`;
    return `../../_build_cscs_${date}/slides/${stem}`;
  }

  // ====== メタ/DOM 読み取り ======
  function readInlineData(){
    const el = document.getElementById('cscs-meta');
    if(!el) return null;
    let raw;
    try{ raw = JSON.parse(el.textContent || '{}'); }catch(_){ return null; }
    const split = s => !s ? [] :
      String(s).split(/[\|\uFF5C／\/、,，\s]+/).map(t=>t.trim()).filter(Boolean);
    const cause = (raw.tags && raw.tags.cause)   || '';
    const proc  = (raw.tags && raw.tags.process) || '';
    const out   = (raw.tags && raw.tags.outcome) || '';
    return {
      field: raw.field || '',
      theme: raw.theme || '',
      tagsCause: split(cause),
      tagsProc:  split(proc),
      tagsOut:   split(out)
    };
  }

  async function readDom(){
    const qEl = document.querySelector("h1");
    const q   = qEl ? qEl.textContent.trim() : "";
    const items = Array.from(document.querySelectorAll("ol.opts li")).map(li => li.textContent.trim());
    function normalizeLetter(ch){
      return String(ch || "").replace(/[Ａ-Ｄ]/g, z => String.fromCharCode(z.charCodeAt(0) - 0xFEE0)).toUpperCase();
    }
    let correct = "";
    const ansEls = Array.from(document.querySelectorAll(".answer"));
    for (const el of ansEls) {
      const html = el.innerHTML || "";
      const m = html.match(/正解\s*[:：]\s*([A-DＡ-Ｄ])/i);
      if (m) { correct = normalizeLetter(m[1]); break; }
    }
    return { question: q, options: items, correct };
  }

  // ====== パネル内ガード + 背景スクロールロック ======
  function installPanelGuards(panel){
    let active = false;
    let lockScrollY = 0;
    const blockIfInsidePanel = (e) => {
      if (!active) return;
      const inside = e.target && e.target.closest('#dd-panel');
      if (!inside) return;

      // ▼ クリック許可条件を拡張：.dd-btn / フォーム要素 / #dd-api-link / data-dd-allow / a / role=button
      if (
        e.target.closest('.dd-btn') ||
        e.target.closest('input,textarea,select,button') ||
        e.target.closest('#dd-api-link') ||
        e.target.closest('[data-dd-allow]') ||
        e.target.closest('a') ||
        e.target.closest('[role="button"]')
      ) {
        return;
      }

      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    const blockBackgroundScroll = (e) => {
      if (!active) return;
      const inside = e.target && e.target.closest('#dd-panel');
      if (!inside) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
    };
    const blockKeysIfInsidePanel = (e) => {
      if (!active) return;
      const focusInside = document.activeElement?.closest?.('#dd-panel');
      const targetInside = e.target?.closest?.('#dd-panel');
      if (!focusInside && !targetInside) return;
      const k = String(e.key || '').toLowerCase();
      if ([' ', 'enter', 'arrowright', 'arrowleft', 'pagedown', 'pageup'].includes(k)) {
        e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }
    };
    ['click','mousedown','mouseup','touchstart','touchend','pointerdown','pointerup'].forEach(t=>document.addEventListener(t,blockIfInsidePanel,true));
    document.addEventListener('wheel',blockBackgroundScroll,{passive:false,capture:true});
    document.addEventListener('touchmove',blockBackgroundScroll,{passive:false,capture:true});
    document.addEventListener('keydown',blockKeysIfInsidePanel,true);
    function lockBodyScroll(){
      lockScrollY = window.scrollY || 0;
      document.documentElement.setAttribute('data-dd-open','1');
      Object.assign(document.body.style,{position:'fixed',top:`-${lockScrollY}px`,left:'0',right:'0',width:'100%'});
    }
    function unlockBodyScroll(){
      Object.assign(document.body.style,{position:'',top:'',left:'',right:'',width:''});
      document.documentElement.removeAttribute('data-dd-open');
      window.scrollTo(0,lockScrollY||0);
    }
    panel.__ddGuards = {
      enable(){ if(active)return; active=true; lockBodyScroll(); },
      disable(){ if(!active)return; active=false; unlockBodyScroll(); }
    };
  }

  // ====== UI生成 ======
  function ensureMounted(){
    // Bパートなら無条件でトグルを出す（メタの有無に依存しない）
    if (isBPart() && !document.getElementById('dd-toggle')){
      const btn=document.createElement('button');
      btn.id='dd-toggle';
      btn.textContent='🔍問題を深掘り';
      Object.assign(btn.style,{
        position:'fixed',bottom:'16px',left:'50%',transform:'translateX(-50%)',
        zIndex:10060,background:'#20232a',border:'1px solid #3a3f4b',color:'#fff',
        borderRadius:'10px',fontSize:'15px',padding:'8px 12px',cursor:'pointer',
        boxShadow:'0 2px 6px rgba(0,0,0,0.3)',transition:'filter .2s ease'
      });
      btn.className='deep-dive-btn';
      btn.addEventListener('mouseenter',()=>btn.style.filter='brightness(1.1)');
      btn.addEventListener('mouseleave',()=>btn.style.filter='');
      document.body.appendChild(btn);
    }

    // パネル
    if(!document.getElementById('dd-panel')){
      const panel=document.createElement('div');
      panel.id='dd-panel';
      Object.assign(panel.style,{
        position:'fixed',left:'16px',right:'16px',top:`${PANEL_TOP_GAP}px`,
        width:'auto',height:'calc(-36px + 100vh)',overflow:'auto',
        background:'rgba(0,0,0,0.86)',border:'1px solid #333',borderRadius:'12px',
        padding:'14px 16px 70px',zIndex:99999,display:'none',backdropFilter:'blur(2px)',pointerEvents:'auto'
      });
      document.body.appendChild(panel);
      installPanelGuards(panel);
    }

    // スタイル
    if(!document.getElementById('dd-inline-style')){
      const st=document.createElement('style');
      st.id='dd-inline-style';
      st.textContent=`
        .dd-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:0 0 10px 0}
        .dd-title{font-weight:700;color:#fff;font-size:18px}
        .dd-crumbs{color:#aab;opacity:.95;font-size:.95em}
        .dd-sec{margin-top:14px}
        .dd-sec h3{margin:0 0 8px 0;font-size:1.02em;color:#fff}
        .dd-tag{display:inline-block;margin:2px 6px 2px 0;padding:3px 7px;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:999px;color:#cfe8ff;font-size:.95em}
        .dd-note{color:#9aa}
        #dd-panel{display:flex;flex-direction:column;}
        #dd-body{flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;padding-bottom:12px;}
        .dd-toolbar{position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;
          padding:12px 0 10px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.86)55%);
          border-top:1px solid #2a2a2a;z-index:1;}
        .dd-btn{background:#20232a;border:1px solid #3a3f4b;color:#fff;border-radius:8px;font-size:16px;font-weight:600;
          padding:10px 22px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);transition:filter .2s,transform .1s;}
        .dd-btn:hover{filter:brightness(1.15);transform:translateY(-1px);}
        .dd-btn:disabled{opacity:.6;cursor:default;transform:none;filter:none;}
        .dd-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.95em}
        .dd-small{font-size:.92em;opacity:.9}
        .dd-spinner{display:inline-block;width:16px;height:16px;border:2px solid #777;border-top-color:#fff;border-radius:50%;
          animation:ddspin 1s linear infinite;vertical-align:-3px;margin-right:8px}
        @keyframes ddspin{to{transform:rotate(360deg)}}
        html[data-dd-open="1"],html[data-dd-open="1"] body{overflow:hidden!important;}
        html[data-dd-open="1"]{overscroll-behavior:contain;}
        html[data-dd-open="1"] .next-overlay{pointer-events:none!important;}
        /* プロンプト表示モーダル */
        #dd-prompt-modal{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
        #dd-prompt-box{max-width:min(920px,calc(100vw - 40px));width:100%;background:#0f1116;border:1px solid #333;border-radius:10px;padding:12px}
        #dd-prompt-box h4{margin:0 0 8px 0;color:#fff}
        #dd-prompt-text{width:100%;height:40vh;background:#0b0d12;color:#eaeef7;border:1px solid #2a2a2a;border-radius:6px;padding:8px;font-family:ui-monospace,Menlo,Consolas,monospace}
        #dd-prompt-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
      `;
      document.head.appendChild(st);
    }

    // 旧「指示」モーダルは廃止（機能削除に伴いDOM生成を停止）

    // トグル（開いている間は“✖️閉じる　”、閉じたら“🔍問題を深掘り”に戻す）
    const btn=document.getElementById('dd-toggle');
    if(btn && !btn.dataset.ddBound){
      function syncLabel(){
        const panel=document.getElementById('dd-panel');
        const opened = panel && panel.style.display==='block';
        btn.textContent = opened ? '✖️ 閉じる　' : '🔍問題を深掘り';
        btn.setAttribute('aria-pressed', opened ? 'true' : 'false');
      }
      // 初期ラベル
      syncLabel();

      btn.addEventListener('click',(e)=>{
        e.stopPropagation();e.preventDefault();
        const panel=document.getElementById('dd-panel');
        const willOpen=panel.style.display==='none'||!panel.style.display;
        panel.style.display=willOpen?'block':'none';
        if(willOpen){panel.__ddGuards?.enable?.();panel.focus();}
        else{panel.__ddGuards?.disable?.();}
        syncLabel();
      });
      btn.dataset.ddBound='1';
    }
  }

  // ====== プロンプト作成 ======
  function buildPrompt(meta, dom){
    const j=(xs,sep=" → ")=>(xs&&xs.length)?xs.join(sep):"（該当なし）";
    const opts=(dom.options||[]).map((t,i)=>String.fromCharCode(65+i)+") "+t).join("\n");

    return [
`あなたはNSCA-CSCS学習者向けの「因果で理解する深掘りコーチ」です。
専門的な内容を初学者にも理解しやすい形で説明します。
出力は日本語で、文体は平易で明瞭な「です・ます調」を用いてください。
専門用語には簡潔な補足を加え、概念間のつながりが分かるように因果関係を整理して説明します。

【重要な出力ルール】
- 重要語句・キーワードは <span class="dd-key">…</span> で囲む（単語または短い名詞句レベル）。
- 正解やその根拠に関する語句は <span class="dd-answer">…</span> で囲む。
- 文章全体を囲むのではなく、文中の特定の語句だけに適用する。
- HTMLタグはエスケープせず、そのままのHTML断片として出力する。
- コードフェンス（\`\`\`）や不要な前置きは付けず、純粋なHTMLのみを返す。

【文体の指針】
- 情報を整理しつつ、理解を助ける補足も適宜加える。
- 落ち着いた文体で、十分な説明を含む。
- 段落はテーマが変わるごとに分けるが、不要な改行や空行は入れない。
- 1段落の中では文を続けて書き、見出しやリスト以外では改行タグ（<br>）を使わない。
- 一文ごとの長さに制限は設けず、読みやすさを保ちながら自然な流れで説明する。
- 必要であれば1段落を5〜8文程度にしても構わない。
- 論理的に構成しつつ、自然な語りの流れも保つ。
- 学習者が概念の因果関係を理解できるよう、順序立てて説明する。
- 英語表記の単語は <span lang="en">…</span> で囲んで出力する。

【出力内容に関する追加指示】
- 『この問題への当てはめ』では、理論を実際の選択肢にどのように適用できるかを丁寧に説明すること。
- 単に正解を述べるのではなく、なぜその選択肢が正しいのかを因果関係に基づいて論理的に説明する。
- 他の選択肢が誤りとなる理由にも軽く触れ、理解を深める。
- 説明文はやや長めで構わない。段落を分けて、読みやすく自然な日本語で展開する。


【専門語と英語表記の扱い】
- 英語表記は、試験や教科書で頻出する用語（例: motor unit, sarcomere, actin など）のみに限って併記する。
- それ以外の一般的な語（例: energy, movement, signal など）は日本語のみで説明する。
- 英語は括弧内に小さく補足する形式とし、強調は不要（例: 「筋収縮（muscle contraction）」）。
- 英語表記がある場合でも、文の流れを妨げないよう自然に挿入する。

【メタ情報】
分野: ${meta.field||""}
テーマ: ${meta.theme||""}
上流(原因・原理): ${j(meta.tagsCause)}
中流(過程・具体経路): ${j(meta.tagsProc)}
下流(結果・明文化): ${j(meta.tagsOut)}

【問題DOM抜粋】
${dom.question?`設問: ${dom.question}`:"設問: (取得できず)"}
${opts?`選択肢:\n${opts}`:"選択肢: (取得できず)"}
${dom.correct?`正解ラベル: ${dom.correct}`:"正解ラベル: (取得できず)"}

【出力フォーマット（HTML断片）】
<section class="dd-sec"><h3>理論深掘り｜上流（原因・原理）</h3><p>…</p></section>
<section class="dd-sec"><h3>事例深掘り｜中流（プロセス・具体経路）</h3><p>…</p></section>
<section class="dd-sec"><h3>定義深掘り｜下流（結果・明文化）</h3><p>…</p></section>
<section class="dd-sec"><h3>この問題への当てはめ</h3><p>本問の<span class="dd-answer">正解は ${dom.correct||"（不明）"}</span>です。その根拠を、因果関係の流れの中で簡潔に説明します。</p></section>
<section class="dd-sec"><h3>3行復習</h3><ol><li>…</li><li>…</li><li>…</li></ol></section>

重要語句や専門用語は単語レベルで <span class='dd-key'>…</span> で囲む。
特に正解やその根拠に関わる語句は <span class='dd-answer'>…</span> で囲む。
注意：HTMLタグ以外の余計な文は不要。
`
    ].join("\n");
  }

  // ====== Gemini呼び出し（プロキシ /generate 経由・フロントに鍵不要） ======
  async function callGemini(prompt, { model }) {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: model || "models/gemini-2.5-flash",
        prompt
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Proxy /generate ${res.status}: ${t || "error"}`);
    }

    // /generate のレスポンス形式に両対応
    // 1) { text: "..." } 形式
    // 2) { candidates: [ { content:{ parts:[{text:"..."}] } } ] } 形式（Googleの生レスポンス）
    const j = await res.json().catch(() => ({}));

    let text = "";
    if (typeof j.text === "string" && j.text.trim()) {
      // シンプル形式（Functions 側で正規化済み）
      text = j.text.trim();
    } else if (Array.isArray(j.candidates)) {
      // Google生レスポンス形式
      try {
        text = j.candidates
          .flatMap(c => (
            c && c.content && Array.isArray(c.content.parts)
              ? c.content.parts
              : []
          ))
          .map(p => (
            p && typeof p.text === "string"
              ? p.text
              : ""
          ))
          .join("")
          .trim();
      } catch (_) {
        text = "";
      }
    }

    if (!text) throw new Error("空の応答でした。");
    return text;
  }

  // ====== メイン描画 ======
  function mountAndWire(meta){
    ensureMounted();

    const panel=document.getElementById('dd-panel');
    const key=ddKey();

    panel.innerHTML=`
      <div class="dd-head">
        <div>
          <div class="dd-title">Deep Dive</div>
          <div class="dd-crumbs">${[meta?.field,meta?.theme].filter(Boolean).join(' / ')}</div>
        </div>
        <div class="dd-small dd-mono">
          <span id="dd-api-badge" data-dd-api-badge></span>
          <span id="dd-api-link" data-dd-allow="1" role="button" tabindex="0" style="margin-left:8px;text-decoration:underline;cursor:pointer;"></span>
          <span id="dd-keystate" style="margin-left:10px;"></span>
        </div>
      </div>
      <div id="dd-body" class="dd-small">
        <div id="dd-static">
          ${meta ? ``
                 : `<div class="dd-note">cscs-meta が見つかりません。メタなしでもプロンプト表示は可能です。</div>`}
        </div>
        <div id="dd-lazy-host"></div>
      </div>
    `;

    const keyState=panel.querySelector('#dd-keystate');
    const bodyEl  =panel.querySelector('#dd-body');
    const genBtn  =panel.querySelector('#dd-generate');
    const regenBtn=panel.querySelector('#dd-regenerate');
    const copyBtn =panel.querySelector('#dd-copy');
    const clearBtn=panel.querySelector('#dd-clear');
    // 旧 closeBtn / toolbarEl は撤去（トグルボタンで開閉）

    // ヘッダー右上のテキストUIとして有効化/解除を提供（ツールバーには出さない）
    // ※ サーバー側プロキシ（/generate）前提。ここではキーを扱わず、「一時停止フラグ」のみ制御する。
    async function refreshApiPanel(){
      const badgeEl = panel.querySelector('#dd-api-badge');
      let linkEl = panel.querySelector('#dd-api-link');
      if (!linkEl) {
        linkEl = document.createElement('span');
        linkEl.id = 'dd-api-link';
        linkEl.style.cssText = 'margin-left:8px;text-decoration:underline;cursor:pointer;';
        if (badgeEl && badgeEl.parentNode) badgeEl.after(linkEl);
      }

      // 常にクリック許可とアクセシビリティ属性を付与
      linkEl.setAttribute('data-dd-allow', '1');
      linkEl.setAttribute('role', 'button');
      linkEl.setAttribute('tabindex', '0');

      // Enter/Space で click を発火
      linkEl.onkeydown = (ev) => {
        const k = String(ev.key || '').toLowerCase();
        if (k === 'enter' || k === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof linkEl.onclick === 'function') linkEl.onclick();
        }
      };

      try {
        const disabled = isApiDisabled();

        if (disabled) {
          if (badgeEl) badgeEl.textContent = "API : ⏸️（停止中）";
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            setApiDisabled(false);
            await updateApiBadge();
            await refreshApiPanel();
            toast("✅ APIを有効化しました");
          };
        } else {
          if (badgeEl) badgeEl.textContent = "API : ✅（サーバー経由）";
          linkEl.textContent = "APIを一時停止";
          linkEl.onclick = async () => {
            setApiDisabled(true);
            await updateApiBadge();
            await refreshApiPanel();
            toast("⏸ APIを一時停止しました");
          };
        }
      } catch (_) {
        if (badgeEl) badgeEl.textContent = "API : ⏸️ （停止中）";
        if (linkEl) {
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            setApiDisabled(false);
            await updateApiBadge();
            await refreshApiPanel();
          };
        }
      }
    }

    // updateApiBadge() は状態イベントを飛ばすので、同期して文言も更新
    window.addEventListener("dd:apikey-changed", () => { try { refreshApiPanel(); } catch(_){ } });
    refreshApiPanel();
    updateApiBadge();

    // 旧 showKeyState（APIキー状態テキスト表示）は廃止。
    // APIバッジと「APIを有効化／解除」リンクで状態表示を統一。

    const stopAll = (ev)=>{ ev.stopPropagation(); ev.preventDefault(); };

    // 一括生成：各見出しの「生成」ボタンを順に叩く（通常は見出しから個別生成を推奨）
    async function generateAllSections(){
      // 下部メニュー簡素化によりボタンが無い場合は何もしない
      if (!panel || !document.getElementById("dd-lazy-host")) return;

      const host = document.getElementById("dd-lazy-host");
      const rows = Array.from(host.querySelectorAll(".dd-lazy"));
      if (!rows.length) return;

      if (genBtn)  genBtn.disabled  = true;
      if (regenBtn) regenBtn.disabled = true;
      if (copyBtn) copyBtn.disabled = true;

      for (const row of rows){
        const btn = row.querySelector('[data-act="gen"]');
        if (btn && !btn.disabled){
          btn.click();
          // 少し間を空けて連打を避ける（必要に応じて調整）
          await new Promise(r => setTimeout(r, 150));
        }
      }

      if (genBtn)  genBtn.disabled  = false;
      if (regenBtn) regenBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
      await updateApiBadge();
    }

    // 旧「指示」機能は廃止（ボタン・コピー/モーダル関連処理を削除）
    // 旧「閉じる」ボタンは廃止。開閉は画面下部のトグルボタン（dd-toggle）で行います。
  }

// ====== 起動 ======
  window.addEventListener('DOMContentLoaded', async ()=>{
    // 先にUIだけ用意（Bならボタン必ず出す）
    ensureMounted();

/*
  // ====== Bパート補助解説（localStorageの深掘り6セクションをまとめて表示） ======
  async function tryInsertGentleExplain() {
    if (!isBPart()) return;
    const explain = document.querySelector('.explain');
    if (!explain) return;
    if (document.getElementById('dd-extra-explain')) return;

    function getDay() {
      const m = (location.pathname || '').match(/_build_cscs_(\d{8})/);
      return m ? m[1] : '';
    }
    function getStem() {
      const m = (location.pathname || '').match(/(q\d{3})_b(?:\.html)?$/i);
      return m ? m[1] : '';
    }
    const day = getDay();
    const stem = getStem();
    if (!day || !stem) return;

    const sections = [
      { key: 'theory',     label: '［理論深掘り｜上流（原因・原理）］' },
      { key: 'process',    label: '［過程深掘り｜中流（具体経路）］' },
      { key: 'definition', label: '［定義深掘り｜下流（結果・明文化）］' },
      { key: 'apply',      label: '［応用深掘り｜事例・活用］' },
      { key: 'similar',    label: '［類似問題］' },
      { key: 'review3',    label: '［三行復習］' }
    ];

    let html = '';
    for (const s of sections) {
      const v = localStorage.getItem(\`cscs_dd_\${day}_\${stem}:\${s.key}\`);
      if (v && String(v).trim()) {
        const hasTag = /<[^>]+>/.test(v);
        const content = String(v).trim();
        html += \`<div class="dd-extra-block" style="margin-top:12px;">\`;
        html += \`<div style="font-weight:bold;margin-bottom:4px;">\${s.label}</div>\`;
        html += hasTag ? content : \`<div>\${content}</div>\`;
        html += \`</div>\`;
      }
    }

    if (!html) return;
    const box = document.createElement('div');
    box.id = 'dd-extra-explain';
    box.style.fontSize = '18px';
    box.innerHTML = html;
    explain.insertAdjacentElement('afterend', box);
  }

  // window.tryInsertGentleExplain = tryInsertGentleExplain;
*/

    // ▼ iPad だけツールバー位置を下固定＆調整（必要に応じて拡張）
    if (isIPadSafari() && !document.getElementById("dd-ipad-style")) {
      const st = document.createElement("style");
      st.id = "dd-ipad-style";
      st.textContent = `
      
      `;
      document.head.appendChild(st);
    }

    // （起動時のDB投入は廃止。初回［生成］時に遅延ロードします）

    if (!isBPart()) return; // B専用

    // メタの有無に関わらず mount（メタが無ければ生成ボタンだけ無効）
    const meta = readInlineData();
    (window.mountAndWire || mountAndWire)(meta);
  });

  // data-autoload（互換ダミー）
  document.addEventListener("DOMContentLoaded",()=>{
    const s=document.querySelector('script[src*="deep_dive.js"]');
    if(s && s.getAttribute("data-autoload")==="1"){
      // B専用のため追加処理なし
    }
  });
  // === export for lazy sections ===
  window.callGemini = callGemini;
  window.readDom = readDom;
  window.getApiKey = getApiKey;
  window.mountAndWire = mountAndWire;
// === Lazy Deep Dive: 見出しごとオンデマンド生成 ==================================

(function(){
  // 見出しの定義（ID: ラベル）
  const DD_SECTIONS = [
    { id:"similar", label:"類似問題" }, // ← 追加（IndexedDB検索・非API）
    { id:"theory",  label:"理論深掘り｜上流（原因・原理）" },
    { id:"process", label:"事例深掘り｜中流（プロセス・具体経路）" },
    { id:"definition", label:"定義深掘り｜下流（結果・明文化）" },
    { id:"apply",   label:"この問題への当てはめ" },
    { id:"review3", label:"3行復習" }
  ];

  // 見出しごとプロンプト作成（一括版の詳細プロンプトを各セクション用に最適化・見出し非出力）
  async function buildSectionPrompt(meta, dom, sectionId){
    const j=(xs,sep=" → ")=>(xs&&xs.length)?xs.join(sep):"（該当なし）";
    const opts=(dom.options||[]).map((t,i)=>String.fromCharCode(65+i)+") "+t).join("\n");

    const base = `
あなたはNSCA-CSCS学習者向けの「因果で理解する深掘りコーチ」です。
専門的な内容を初学者にも理解しやすい形で説明します。
出力は日本語で、平易で明瞭な「です・ます調」。HTML断片のみを返し、コードフェンスは使わない。
専門用語には簡潔な補足を加え、概念間のつながりが分かるように因果関係を整理して説明します。

【重要な出力ルール】
- 重要語句は <span class="dd-key">…</span> で囲む（単語または短い名詞句レベル）。
- 正解や根拠に関する語句は <span class="dd-answer">…</span> で囲む。
- 文中の特定語句だけに適用し、全体を囲まない。
- HTMLタグはエスケープせず、そのままのHTML断片として出力する。
- コードフェンス（\`\`\`）や不要な前置きは付けない。

【文体の指針】
- 説明は2〜4文で、背景→要因→結果の流れが伝わるように。
- 不要な改行や空行は避け、自然な日本語で書く。
- 情報を整理しつつ、学習者の理解を助ける補足を加える。
- 英語表記の単語は <span lang="en">…</span> で囲み、括弧内で補足する。

【メタ情報】
分野: ${meta.field||""}
テーマ: ${meta.theme||""}
上流(原因・原理): ${j(meta.tagsCause)}
中流(過程・具体経路): ${j(meta.tagsProc)}
下流(結果・明文化): ${j(meta.tagsOut)}

【問題DOM抜粋】
${dom.question?`設問: ${dom.question}`:"設問: (取得できず)"}
${opts?`選択肢:\n${opts}`:"選択肢: (取得できず)"}
${dom.correct?`正解ラベル: ${dom.correct}`:"正解ラベル: (取得できず)"}
`.trim();

    // セクション別指示（見出しを出力しないように変更）
    let sectionSpec = "";
    if (sectionId === "theory"){
      sectionSpec = `<p>「理論深掘り（上流）」の内容を説明してください。上流の原因や原理を、なぜその仕組みが成り立つのかという視点で2〜4文にまとめてください。</p>`;
    } else if (sectionId === "process"){
      sectionSpec = `<p>「事例深掘り（中流）」の内容を説明してください。どのような過程や具体的な経路を経て結果に至るかを、2〜4文で示してください。</p>`;
    } else if (sectionId === "definition"){
      sectionSpec = `<p>「定義深掘り（下流）」の内容を説明してください。結果や定義を2〜4文でまとめ、要点と意味を整理してください。</p>`;
    } else if (sectionId === "apply"){
      sectionSpec = `<p>「この問題への当てはめ」を説明してください。本問の<span class="dd-answer">正解は ${dom.correct||"（不明）"}</span>です。その根拠を因果関係に基づいて2〜4文で説明し、他の選択肢が誤る理由も一言で触れてください。</p>`;
    } else if (sectionId === "review3"){
      sectionSpec = `<p>「3行復習」として、この問題の要点を3行でまとめてください。</p>`;
    }

    const hardRule = `
【厳守事項】
- 指定セクション（${sectionId}）のみを出力する。他セクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。本文（<p>…</p> など）だけを返す。
- 文章は2〜4文に収め、冗長な導入や締めを避ける。
- コードフェンスや注釈文は不要。`.trim();

    return [base, hardRule, "", sectionSpec].join("\n\n");
  }

  // セクション単位の保存キー
  function sectionStoreKey(sectionId){
    return ddKey() + ":" + sectionId;
  }

  // セクション行のDOM（見出しリンク化）
  function sectionRow(section){
    const wrap = document.createElement("div");
    wrap.className = "dd-sec dd-lazy";
    wrap.dataset.sectionId = section.id;

    // 類似問題だけは「テキストボタン（生成／消去）」、他は従来ボタン
    const isSimilar = (section.id === "similar");
    const actionsHTML = `<span class="dd-lazy-actions">
           <button class="dd-btn dd-s-btn" data-act="gen">${isSimilar ? "↓類似問題表示" : "↓深掘り生成"}</button>
           <button class="dd-btn dd-s-btn" data-act="clear" disabled>消去</button>
         </span>`;

    wrap.innerHTML = `
      <h3 class="dd-lazy-h3">
        <a href="#dd=${section.id}" class="dd-lazy-link" data-act="open">${section.label}</a>
        ${actionsHTML}
      </h3>
      <div class="dd-lazy-body dd-small dd-mono" style="opacity:.9;display:none">（未生成）</div>
    `;
    return wrap;
  }

  // セクションUIを描画（panel mount後に呼ぶ）— 見出しリンク/ハッシュ対応
  async function renderLazySections(meta){
    const panel = document.getElementById("dd-panel");
    if (!panel) return;
    const body = panel.querySelector("#dd-body");
    if (!body) return;

    // コンテナ
    let host = document.getElementById("dd-lazy-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "dd-lazy-host";
      host.style.marginTop = "10px";
      body.appendChild(host);
    } else {
      host.innerHTML = "";
    }

    // 現在問題のコンテキスト（類似検索用）
    // ※ クリーンURL（/q001_b）と .html（/q001_b.html）の両方に対応するため、
    //    既存ヘルパー getDayFromPathDD() / getStemFromPathDD() を使用。
    const curDay  = getDayFromPathDD();           // "20250926" など
    const stemRaw = getStemFromPathDD();          // "q001" など
    const curNum  = (/^q(\d{3})$/i.test(stemRaw)) ? stemRaw.replace(/^q/i, "") : "000";

    const currentForSimilar = {
      qid: `${curDay}-${curNum}`,                 // 例: "20250926-001"
      date: curDay,
      number: curNum,                             // "001"
      field: (meta && meta.field) || "",
      theme: (meta && meta.theme) || "",
      level: "", // DOMからは抽出しない（0でもスコアは計算可）
      question: "",
      tagsCause: (meta && meta.tagsCause) || [],
      tagsProc:  (meta && meta.tagsProc)  || [],
      tagsOut:   (meta && meta.tagsOut)   || [],
    };

    // DOMから補強（設問テキスト・正解など）
    try{
      const dom = await (window.readDom ? window.readDom() : {question:"",options:[],correct:""});
      currentForSimilar.question = dom.question || "";
    }catch(_){}

    // 行ごとに配線
    function wireRow(row, section){
      const sid    = section.id;
      const bodyEl = row.querySelector(".dd-lazy-body");
      const btnGen = row.querySelector('[data-act="gen"]');
      const btnClr = row.querySelector('[data-act="clear"]');
      const link   = row.querySelector('[data-act="open"]');

      const saved = localStorage.getItem(sectionStoreKey(sid));
      if (saved){
        bodyEl.innerHTML = saved;
        bodyEl.style.display = "";
        if(btnClr) btnClr.disabled = false;
        if(btnGen && sid !== "similar") btnGen.textContent = "再生成";
      }

      const click = (h)=> (ev)=>{ ev.preventDefault(); ev.stopPropagation(); h(ev).catch(console.error); };
      const ensureOpen = ()=>{ if (bodyEl.style.display === "none") bodyEl.style.display = ""; };

      async function generateGemini(sectionId){
        if(!btnGen || !btnClr) return;

        // ▼ 初回［生成］のときだけDB投入（2,700問メタ）
        await ensureQmetaLoadedOnce();

        btnGen.disabled = true; btnClr.disabled = true;
        ensureOpen();
        bodyEl.innerHTML = `<span class="dd-spinner"></span>生成中…`;
        const dom  = await (window.readDom? window.readDom(): {question:"",options:[],correct:""});
        const prompt = await buildSectionPrompt(meta||{field:"",theme:"",tagsCause:[],tagsProc:[],tagsOut:[]}, dom, sectionId);

        try{
          const html = await window.callGemini(prompt, { model: "models/gemini-2.5-flash" });
          const cleaned = String(html || "")
            .replace(/```html|```/g, "")
            .replace(/^\s*<h3[^>]*>[\s\S]*?<\/h3>\s*/i, "")
            .replace(/<\/?section[^>]*>/gi, "")
            .trim() || `<div class="dd-note">（空の出力）</div>`;
          bodyEl.innerHTML = cleaned;
          localStorage.setItem(sectionStoreKey(sectionId), cleaned);
          btnClr.disabled = false;
          btnGen.textContent = "再生成";
        }catch(e){
          bodyEl.innerHTML = `<div class="dd-note">生成に失敗：<span class="dd-mono">${String(e&&e.message||e)}</span></div>`;
        }finally{
          btnGen.disabled = false;
        }
      }

      async function generateSimilar(){
        if(btnGen) btnGen.disabled = true;
        if(btnClr) btnClr.disabled = true;

        // ▼ 初回［生成］のときだけDB投入（2,700問メタ）
        await ensureQmetaLoadedOnce();

        ensureOpen();
        bodyEl.innerHTML = `<span class="dd-spinner"></span>検索中…`;

        try{
          // 余裕を持って多めに取得 → 最終6件に絞る
          const resultsRaw = await findSimilarQuestions(currentForSimilar, { limit: 12 });
          const curDate  = String(currentForSimilar.date||"").replace(/\D/g,"");
          const curNum   = String(currentForSimilar.number||"").padStart(3,"0");
          const selfHref = buildQuestionHref(curDate, curNum, "a");

          // 最終の自分弾き＆上位6件に整形
          const results = resultsRaw
            .filter(r=>{
              const href = buildQuestionHref(r.date, r.number, "a");
              return href !== selfHref;
            })
            .slice(0,6);

          if(!results.length){
            const none = `<div class="dd-note">（該当する類似問題が見つかりませんでした）</div>`;
            bodyEl.innerHTML = none;
            localStorage.setItem(sectionStoreKey("similar"), none);
          }else{
            const lis = results.map(r=>{
              const href = buildQuestionHref(r.date, r.number, "a");
              const metaLine = [r.field||"", r.theme||"", r.level||""].filter(Boolean).join(" / ");
              const label = `${r.date}｜q${String(r.number||"").padStart(3,"0")}`;
              const qtext = String(r.question||"");
              return `
                <li class="dd-simitem">
                  <a class="dd-simlink" href="${href}">${label}</a>
                  <div class="dd-simmeta dd-small">${metaLine}</div>
                  <div class="dd-simq dd-small"><a class="dd-simqlink" href="${href}">${qtext.slice(0,120)}${qtext.length>120?"…":""}</a></div>
                </li>
              `;
            }).join("");
            const html = `<div class="dd-simwrap"><ul class="dd-simlist">${lis}</ul></div>`;
            bodyEl.innerHTML = html;
            localStorage.setItem(sectionStoreKey("similar"), html);
          }
          if(btnClr) btnClr.disabled = false;
        }catch(e){
          bodyEl.innerHTML = `<div class="dd-note">検索に失敗：<span class="dd-mono">${String(e&&e.message||e)}</span></div>`;
        }finally{
          if(btnGen) btnGen.disabled = false;
        }
      }

      // 見出しクリック：初回生成 or 開閉（⌥/⌘で再生成）
      link.addEventListener("click", click(async (ev)=>{
        const alt = ev && (ev.altKey || ev.metaKey);
        const has = !!localStorage.getItem(sectionStoreKey(sid));
        if (sid === "similar"){
          if (!has || alt){ await generateSimilar(); }
          else { bodyEl.style.display = (bodyEl.style.display === "none") ? "" : "none"; }
        } else {
          if (!has || alt){ await generateGemini(sid); }
          else { bodyEl.style.display = (bodyEl.style.display === "none") ? "" : "none"; }
        }
        try { history.replaceState({}, "", `#dd=${sid}`); } catch(_){}
      }));

      if(btnGen){
        btnGen.addEventListener("click", click(async ()=>{
          if (sid === "similar") await generateSimilar();
          else await generateGemini(sid);
        }));
      }
      if(btnClr){
        btnClr.addEventListener("click", click(async ()=>{
          localStorage.removeItem(sectionStoreKey(sid));
          bodyEl.textContent = "（未生成）";
          btnClr.disabled = true;
          if(sid === "similar"){
            btnGen && (btnGen.textContent = "↓類似問題表示");
          }else{
            btnGen && (btnGen.textContent = "↓深掘り生成");
          }
          bodyEl.style.display = "none";
        }));
      }

      // セクション直リンク（#dd=xxx）
      const hash = (location.hash || "").trim();
      if (hash === `#dd=${sid}`){
        if (!saved) {
          if (sid === "similar") { generateSimilar(); }
          else { generateGemini(sid); }
        } else {
          bodyEl.style.display = "";
        }
        setTimeout(()=> row.scrollIntoView({ block:"start", behavior:"smooth" }), 10);
      }
    }

    // 行追加
    for (const s of DD_SECTIONS){
      const row = sectionRow(s);
      host.appendChild(row);
      wireRow(row, s);
    }

    // ハッシュ遷移での開閉
    window.addEventListener("hashchange", ()=>{
      const m = (location.hash||"").match(/^#dd=([a-z0-9_]+)/i);
      if (!m) return;
      const sid = m[1];
      const row = host.querySelector(`.dd-lazy[data-section-id="${sid}"]`);
      if (!row) return;
      const bodyEl = row.querySelector(".dd-lazy-body");
      if (bodyEl && bodyEl.style.display === "none") bodyEl.style.display = "";
      row.scrollIntoView({ block:"start", behavior:"smooth" });
    });
  }

  // 既存の mount にフック：mountAndWire 呼び出し後に lazy を差し込む
  const _mountAndWire = window.mountAndWire;
  window.mountAndWire = function(meta){
    _mountAndWire && _mountAndWire(meta);
    renderLazySections(meta);
  };

  // ちょっとした見た目
  if(!document.getElementById("dd-lazy-style")){
    const st = document.createElement("style");
    st.id = "dd-lazy-style";
    st.textContent = `
      /* 各見出し行のボタンは指定の見た目に統一（下部ツールバーには影響させない） */
      .dd-s-btn{ font-size:12px; padding:6px 10px; margin-left:6px; }
      .dd-lazy + .dd-lazy{ margin-top:8px; }
      .dd-lazy-body{ padding:8px 0 4px; }
      .dd-lazy-h3{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0; }
      .dd-lazy-link{ color:#cfe8ff; text-decoration:none; }
      .dd-lazy-link:hover{ text-decoration:underline; }
      .dd-lazy-actions{ white-space:nowrap; }

      /* 類似問題のテキストボタン（下線・白） */
      .dd-tbtn{
        background: transparent;
        border: none;
        color: #fff;
        text-decoration: underline;
        padding: 0;
        margin: 0 4px;
        font: inherit;
        cursor: pointer;
      }
      .dd-tbtn:disabled{
        opacity: .6;
        text-decoration: none;
        cursor: default;
      }

      /* 類似問題のグリッド表示（画面幅に応じて横並び） */
      .dd-simwrap{ margin-top:4px; }
      .dd-simlist{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:1fr; gap:10px; }
      .dd-simitem{ border:1px solid #2a2a2a; background:#151515; border-radius:10px; padding:10px; }
      .dd-simlink{ display:block; font-weight:700; color:#cfe8ff; text-decoration:none; margin-bottom:4px; }
      .dd-simlink:hover{ text-decoration:underline; }
      .dd-simmeta{ opacity:.85; }
      .dd-simq{ opacity:.9; }

      /* ▼ 問題文リンクは下線なしに統一 */
      .dd-simqlink{ color:#cfe8ff; text-decoration:none; }
      .dd-simqlink:hover{ text-decoration:none; }

      @media (min-width: 900px){
        .dd-simlist{ grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
      }
      /* iPad縦の幅帯では2列固定 */
      @media (orientation: portrait) and (min-width: 800px){
        .dd-simlist{
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `;
    document.head.appendChild(st);
  }
})();
  
  window.DeepDive = window.DeepDive || { init(){} };
})();