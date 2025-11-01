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

  // ▼ ワンクリ保存で使うハードコードキー（公開コミット厳禁）
  const DEFAULT_HARDCODED_KEY = "AIzaSyAItFa6e7Q5psu7P7jww89fmMUy89bagXM";

  // ====== パス/ストレージヘルパ ======
  function getDayFromPathDD(){
    const m = (window.location.pathname||"").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }
  function getStemFromPathDD(){
    const m = (window.location.pathname||"").match(/\/(q\d{3})_[ab]\.html$/i);
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
  function getApiKey(){
    const self = document.querySelector('script[src*="deep_dive.js"]');
    if (self && self.dataset.geminiKey) return self.dataset.gemini_key?.trim?.() || self.dataset.geminiKey.trim();
    try {
      const k = localStorage.getItem("gemini_api_key");
      if (k) return k.trim();
    } catch(_){}
    return "";
  }
  function maskKey(k) {
    if (!k) return "未設定";
    if (k.length <= 8) return k.replace(/.(?=.{2})/g, "•");
    return k.slice(0, 4) + "…" + k.slice(-4);
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
  function updateApiBadge() {
    const ok = !!getApiKey();
    const badge = document.querySelector("[data-dd-api-badge]") || document.getElementById("dd-api-badge");
    if (badge) {
      badge.textContent = ok ? "API: ✅" : "API: ー";
      badge.classList.toggle("dd-api-ok", ok);
      badge.classList.toggle("dd-api-ng", !ok);
    }
    // 他処理へ通知
    try { window.dispatchEvent(new CustomEvent("dd:apikey-changed", { detail: { ok } })); } catch(_){}
  }

  // ====== APIキー設定UI（ツールバー左端の「API」ボタン） ======
  function addApiButton(toolbarEl) {
    if (!toolbarEl || toolbarEl.__ddApiReady) return;
    toolbarEl.__ddApiReady = true;

    const apiBtn = document.createElement("button");
    apiBtn.className = "dd-btn dd-btn--ghost";
    apiBtn.textContent = "API保存";
    apiBtn.title = "Gemini APIキーをワンクリ保存";
    apiBtn.style.marginRight = "";
    toolbarEl.prepend(apiBtn);

    // ▼ ワンクリ保存（押したら即保存・上書き）
    apiBtn.addEventListener("click", () => {
      try {
        localStorage.setItem("gemini_api_key", DEFAULT_HARDCODED_KEY);
        updateApiBadge();
        toast("✅ APIキーを保存しました（この端末のブラウザに保存）");
      } catch (e) {
        toast("⚠️ 保存に失敗しました（ブラウザの制限）");
      }
    });

    // URLパラメータ経由での自動保存（?key=... or ?gemini_key=...）も併用可
    (function () {
      const p = new URLSearchParams(location.search);
      const k = (p.get("gemini_key") || p.get("key") || "").trim();
      if (k) {
        try {
          localStorage.setItem("gemini_api_key", k);
          history.replaceState({}, "", location.pathname + location.hash); // クエリ隠す
          updateApiBadge();
          toast("✅ APIキーを保存しました（URLパラメータ）");
        } catch (_) {
          toast("⚠️ 保存に失敗しました（ブラウザの制限）");
        }
      }
    })();

    updateApiBadge();
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
      if (e.target.closest('.dd-btn') || e.target.closest('input,textarea,select,button')) return;
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
      btn.textContent='🔍この問題を深掘り';
      Object.assign(btn.style,{
        position:'fixed',bottom:'16px',left:'50%',transform:'translateX(-50%)',
        zIndex:10060,background:'#20232a',border:'1px solid #3a3f4b',color:'#fff',
        borderRadius:'10px',fontSize:'15px',padding:'8px 18px',cursor:'pointer',
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
        html[data-dd-open="1"]{overscroll-beavior:contain;}
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

    // プロンプト表示用モーダル（フォールバック用）
    if(!document.getElementById('dd-prompt-modal')){
      const wrap = document.createElement('div');
      wrap.id = 'dd-prompt-modal';
      wrap.innerHTML = `
        <div id="dd-prompt-box">
          <h4>送信プロンプト（コピー不可環境フォールバック）</h4>
          <textarea id="dd-prompt-text" readonly></textarea>
          <div id="dd-prompt-actions">
            <button class="dd-btn" id="dd-prompt-copy">コピーを再試行</button>
            <button class="dd-btn" id="dd-prompt-close">閉じる</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e)=>{ if(e.target===wrap) wrap.style.display='none'; });
      document.addEventListener('click', (e)=>{
        if (e.target && e.target.id === 'dd-prompt-close') wrap.style.display='none';
      });
      document.addEventListener('click', async (e)=>{
        if (e.target && e.target.id === 'dd-prompt-copy') {
          const t = document.getElementById('dd-prompt-text').value;
          const ok = await copyTextSmart(t);
          alert(ok ? "コピーできました。" : "コピーがブロックされています。手動で Cmd/Ctrl+A → C を使ってください。");
        }
      });
    }

    // トグル
    const btn=document.getElementById('dd-toggle');
    if(btn && !btn.dataset.ddBound){
      btn.addEventListener('click',(e)=>{
        e.stopPropagation();e.preventDefault();
        const panel=document.getElementById('dd-panel');
        const willOpen=panel.style.display==='none'||!panel.style.display;
        panel.style.display=willOpen?'block':'none';
        if(willOpen){panel.__ddGuards?.enable?.();panel.focus();}
        else{panel.__ddGuards?.disable?.();}
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

  // ====== Gemini呼び出し ======
  async function callGemini(prompt,{apiKey,model}){
    const body={ contents:[{ role:"user", parts:[{ text:prompt }]}] };
    let lastErr;
    for(const base of ENDPOINTS){
      const url=`${base}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      try{
        const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        if(!res.ok){
          const t = await res.text().catch(()=>String(res.status));
          if (res.status===403 || res.status===404){
            throw new Error(`HTTP ${res.status} ${base}\nRaw: ${t}`);
          }
          throw new Error(`Gemini API error ${res.status}: ${t}`);
        }
        const j=await res.json();
        const text=(j?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("");
        if(!text) throw new Error("空の応答でした。");
        return text;
      }catch(e){ lastErr = e; }
    }
    throw lastErr || new Error("Gemini呼び出しに失敗しました。");
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
          <span id="dd-keystate" style="margin-left:10px;"></span>
        </div>
      </div>
      <div id="dd-body" class="dd-small">
        ${meta ? `<div style="opacity:.9">「深掘り生成」を押すとAIが深掘り解説を作ります。</div>`
               : `<div class="dd-note">cscs-meta が見つかりません。メタなしでもプロンプト表示は可能です。</div>`}
      </div>
      <div class="dd-toolbar">
        <!-- 左端に API ボタンを prepend で追加する -->
        <button class="dd-btn" id="dd-generate" ${meta?'':'disabled'}>深掘り生成</button>
        <button class="dd-btn" id="dd-regenerate" disabled>再生成</button>
        <button class="dd-btn" id="dd-copy" disabled>コピー</button>
        <button class="dd-btn" id="dd-prompt">指示</button>
        <button class="dd-btn" id="dd-clear">消去</button>
        <button class="dd-btn" id="dd-close">閉じる</button>
      </div>
    `;

    const keyState=panel.querySelector('#dd-keystate');
    const bodyEl  =panel.querySelector('#dd-body');
    const genBtn  =panel.querySelector('#dd-generate');
    const regenBtn=panel.querySelector('#dd-regenerate');
    const copyBtn =panel.querySelector('#dd-copy');
    const promptBtn=panel.querySelector('#dd-prompt');
    const clearBtn=panel.querySelector('#dd-clear');
    const closeBtn=panel.querySelector('#dd-close');
    const toolbarEl=panel.querySelector('.dd-toolbar');

    // APIボタン（左端）を追加し、バッジ更新
    addApiButton(toolbarEl);
    updateApiBadge();

    const showKeyState=()=>{ keyState.textContent=getApiKey()?"（保存済み）":"（未設定: localStorage.gemini_api_key）"; };
    showKeyState();

    // 既存（前回生成分）があれば表示
    try{
      const saved = localStorage.getItem(key);
      if (saved){
        bodyEl.innerHTML = saved;
        regenBtn.disabled = false;
        copyBtn.disabled  = false;
      }
    }catch(_){}

    const stopAll = (ev)=>{ ev.stopPropagation(); ev.preventDefault(); };

    async function doGenerate(){
      const apiKey = getApiKey();
      if(!apiKey){
        alert("Gemini APIキーが未設定です。\n左下の「API」ボタンから保存してください。");
        return;
      }
      if (!meta){
        alert("cscs-meta が見つからないため、生成はできません。プロンプトで確認してください。");
        return;
      }

      genBtn.disabled = true;
      regenBtn.disabled = true;
      copyBtn.disabled  = true;

      const dom = await readDom();
      const prompt = buildPrompt(meta, dom);
      try { localStorage.setItem(key + ":prompt", prompt); } catch(_){}

      bodyEl.innerHTML = `<span class="dd-spinner"></span>生成中…`;

      try{
        const text = await callGemini(prompt, { apiKey, model: GEMINI_MODEL });
        const html = text.replace(/```html|```/g, "");
        bodyEl.innerHTML = html || `<div class="dd-note">（空の出力）</div>`;
        try { localStorage.setItem(key, bodyEl.innerHTML); } catch(_){}
        regenBtn.disabled  = false;
        copyBtn.disabled   = false;
      }catch(e){
        bodyEl.innerHTML = `<div class="dd-note">生成に失敗：<br><span class="dd-mono">${String(e.message || e)}</span></div>`;
      }finally{
        genBtn.disabled = false;
        showKeyState();
        updateApiBadge();
      }
    }

    genBtn && genBtn.addEventListener('click', (ev)=>{ stopAll(ev); doGenerate(); });
    regenBtn.addEventListener('click', (ev)=>{ stopAll(ev); doGenerate(); });

    copyBtn.addEventListener('click', async (ev)=>{
      stopAll(ev);
      const ok = await copyTextSmart(bodyEl.innerHTML);
      if (ok){
        copyBtn.textContent="コピー済み";
        setTimeout(()=>copyBtn.textContent="コピー",1200);
      }else{
        alert("コピーに失敗しました。（HTTPS/localhostが安定）");
      }
    });

    // ▼ プロンプトコピー：保存→再構築→表示フォールバック
    async function copyOrShowPrompt(){
      const pKey = key + ":prompt";
      let text = localStorage.getItem(pKey);
      if (!text){
        const domNow = await readDom();
        text = buildPrompt(meta||{field:"",theme:"",tagsCause:[],tagsProc:[],tagsOut:[]}, domNow);
        try{ localStorage.setItem(pKey, text); }catch(_){}
      }
      // 不要部分を削除（HTML断片や<section>タグなど）
      const cleaned = text
        .replace(/【出力フォーマット（HTML断片）】[\s\S]*$/i, "")
        .replace(/<section[\s\S]*?<\/section>/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const ok = await copyTextSmart(cleaned);
      if (ok){
        promptBtn.textContent = "コピー済み";
        setTimeout(()=> promptBtn.textContent = "指示", 1200);
        return;
      }
      // フォールバック表示（自動選択済み）
      const wrap = document.getElementById('dd-prompt-modal');
      const ta = document.getElementById('dd-prompt-text');
      ta.value = text;
      wrap.style.display = 'flex';
      ta.focus(); ta.select();
    }
    promptBtn.addEventListener('click', (ev)=>{ stopAll(ev); copyOrShowPrompt(); });

    clearBtn.addEventListener('click', (ev)=>{
      stopAll(ev);
      try{ localStorage.removeItem(key); localStorage.removeItem(key + ":prompt"); }catch(_){}
      bodyEl.innerHTML = `<div class="dd-note">保存内容を消去しました。</div>`;
      regenBtn.disabled = true;
      copyBtn.disabled  = true;
    });

    closeBtn.addEventListener('click', (ev)=>{
      stopAll(ev);
      panel.style.display='none';
      panel.__ddGuards && panel.__ddGuards.disable && panel.__ddGuards.disable();
    });
  }

  // ====== 起動 ======
  window.addEventListener('DOMContentLoaded', ()=>{
    // 先にUIだけ用意（Bならボタン必ず出す）
    ensureMounted();

    // ▼ iPad だけツールバー位置を下固定＆調整（必要に応じて拡張）
    if (isIPadSafari() && !document.getElementById("dd-ipad-style")) {
      const st = document.createElement("style");
      st.id = "dd-ipad-style";
      st.textContent = `
        .dd-toolbar{
          bottom: 18px !important;
        }
      `;
      document.head.appendChild(st);
    }

    if (!isBPart()) return; // B専用

    // メタの有無に関わらず mount（メタが無ければ生成ボタンだけ無効）
    const meta = readInlineData();
    mountAndWire(meta);
  });

  // data-autoload（互換ダミー）
  document.addEventListener("DOMContentLoaded",()=>{
    const s=document.querySelector('script[src*="deep_dive.js"]');
    if(s && s.getAttribute("data-autoload")==="1"){
      // B専用のため追加処理なし
    }
  });

  window.DeepDive = window.DeepDive || { init(){} };
})();