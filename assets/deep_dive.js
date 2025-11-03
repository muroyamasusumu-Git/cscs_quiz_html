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
  function isApiDisabled() {
    try { return localStorage.getItem('dd_api_disabled') === '1'; } catch (_) { return false; }
  }
  function setApiDisabled(v) {
    try {
      if (v) localStorage.setItem('dd_api_disabled', '1');
      else localStorage.removeItem('dd_api_disabled');
    } catch (_){}
  }

  /**
   * 優先度: data-gemini-key → /api-key(Cloudflare Functions) → localStorage("gemini_api_key")
   * ただし、ユーザーが明示的に「作動解除」している場合は常に例外。
   */
  async function getApiKey() {
    // 事前に「作動解除」なら常に失敗させる（UI側で再有効化を促す）
    if (isApiDisabled()) {
      throw new Error('DISABLED_BY_USER');
    }

    // 0) メモリキャッシュ
    if (typeof __GEMINI_KEY_CACHE === 'string' && __GEMINI_KEY_CACHE) {
      return __GEMINI_KEY_CACHE;
    }

    // 1) <script src="...deep_dive.js" data-gemini-key="...">
    const me =
      document.currentScript ||
      document.querySelector('script[src*="deep_dive.js"]') ||
      document.querySelector('script[data-mode][src*="deep_dive.js"]');
    const attr = me && me.dataset ? (me.dataset.geminiKey || '').trim() : '';
    if (attr) {
      __GEMINI_KEY_CACHE = attr;
      return __GEMINI_KEY_CACHE;
    }

    // 2) Cloudflare Functions 経由（/api-key が { key: "AIza..." } を返す想定）
    try {
      const res = await fetch('/api-key', {
        method: 'GET',
        headers: { 'accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && typeof data.key === 'string' && data.key.trim()) {
          __GEMINI_KEY_CACHE = data.key.trim();
          return __GEMINI_KEY_CACHE;
        }
      }
    } catch (_) {
      // ネットワークエラー時は次の手段へフォールバック
    }

    // 3) localStorage フォールバック
    try {
      const ls = (localStorage.getItem('gemini_api_key') || '').trim();
      if (ls) {
        __GEMINI_KEY_CACHE = ls;
        return __GEMINI_KEY_CACHE;
      }
    } catch (_){}

    // 4) どれも無い
    throw new Error('GEMINI_API_KEY not found (data-attr, /api-key, localStorage)');
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
  async function updateApiBadge() {
    const disabled = isApiDisabled();
    let ok = false;
    if (!disabled) {
      try {
        const k = await getApiKey();
        ok = !!(k && k.trim());
      } catch (_){ ok = false; }
    }

    const badge = document.querySelector("[data-dd-api-badge]") || document.getElementById("dd-api-badge");
    if (badge) {
      if (disabled) {
        badge.textContent = "API: ⏸";
      } else {
        badge.textContent = ok ? "API: ✅" : "API: ー";
      }
      badge.classList.toggle("dd-api-ok", ok && !disabled);
      badge.classList.toggle("dd-api-paused", disabled);
      badge.classList.toggle("dd-api-ng", !ok && !disabled);
    }
    try { window.dispatchEvent(new CustomEvent("dd:apikey-changed", { detail: { ok: ok && !disabled, disabled } })); } catch(_){}
  }

  // ====== APIキー状態表示UI（上部固定・テキスト形式） ======
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
    badge.textContent = "API : ⏸️ （未設定）";
    link.textContent = "APIを有効化";

    // 状態更新
    async function refreshLabel() {
      try {
        const disabled = isApiDisabled();
        const badgeEl = document.getElementById("dd-api-badge");
        const linkEl = document.getElementById("dd-api-toggle");

        if (!badgeEl || !linkEl) return;

        if (disabled) {
          badgeEl.textContent = "API : ⏸️ （未設定）";
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            try {
              const res = await fetch("/api-key", { method: "GET", headers: { accept: "application/json" } });
              if (!res || !res.ok) throw new Error("fetch failed");
              const data = await res.json().catch(() => ({}));
              const k = (data && typeof data.key === "string") ? data.key.trim() : "";
              if (!k) throw new Error("empty key");
              localStorage.setItem("gemini_api_key", k);
              setApiDisabled(false);
              __GEMINI_KEY_CACHE = null;
              await updateApiBadge();
              await refreshLabel();
              toast("✅ APIを有効化しました");
            } catch (_) {
              toast("⚠️ APIの有効化に失敗しました");
            }
          };
        } else {
          const k = (localStorage.getItem("gemini_api_key") || "").trim();
          const ok = !!k;
          badgeEl.textContent = ok ? "API : ✅ （保存済）" : "API : ⏸️ （未設定）";
          linkEl.textContent = ok ? "API解除する" : "APIを有効化";
          linkEl.onclick = async () => {
            if (ok) {
              try {
                localStorage.removeItem("gemini_api_key");
                setApiDisabled(true);
                __GEMINI_KEY_CACHE = null;
                await updateApiBadge();
                await refreshLabel();
                toast("⏸ APIを解除しました");
              } catch (_) {
                toast("⚠️ 解除に失敗しました");
              }
            } else {
              // 未設定→有効化へ誘導
              const evt = new MouseEvent("click");
              linkEl.dispatchEvent(evt);
            }
          };
        }
      } catch (_) {
        // 安全側フォールバック
        const badgeEl = document.getElementById("dd-api-badge");
        const linkEl = document.getElementById("dd-api-toggle");
        if (badgeEl) badgeEl.textContent = "API : ⏸️ （未設定）";
        if (linkEl) linkEl.textContent = "APIを有効化";
      }
    }

    // URLパラメータ経由の自動保存（?key=... or ?gemini_key=...）
    (async function () {
      try {
        const p = new URLSearchParams(location.search);
        const k = (p.get("gemini_key") || p.get("key") || "").trim();
        if (k) {
          localStorage.setItem("gemini_api_key", k);
          setApiDisabled(false);
          __GEMINI_KEY_CACHE = null;
          history.replaceState({}, "", location.pathname + location.hash);
          await updateApiBadge();
        }
      } catch (_) {}
      await refreshLabel();
    })();

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
      <div class="dd-toolbar">
        <!-- APIボタンは上部固定UIに統合（ここでは生成しない） -->
        <button class="dd-btn" id="dd-prompt">指示</button>
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

    // ヘッダー右上のテキストUIとして有効化/解除を提供（ツールバーには出さない）
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
          if (badgeEl) badgeEl.textContent = "API : ⏸️（未設定）";
          linkEl.textContent = "APIを有効化";
          linkEl.onclick = async () => {
            try {
              const res = await fetch("/api-key", { method: "GET", headers: { accept: "application/json" } });
              if (!res || !res.ok) throw new Error("fetch failed");
              const data = await res.json().catch(() => ({}));
              const k = (data && typeof data.key === "string") ? data.key.trim() : "";
              if (!k) throw new Error("empty key");
              localStorage.setItem("gemini_api_key", k);
              setApiDisabled(false);
              __GEMINI_KEY_CACHE = null;
              updateApiBadge();
              refreshApiPanel();
              toast("✅ APIを有効化しました");
            } catch (_) {
              toast("⚠️ APIの有効化に失敗しました");
            }
          };
        } else {
          const k = (localStorage.getItem("gemini_api_key") || "").trim();
          const ok = !!k;
          if (badgeEl) badgeEl.textContent = ok ? "API : ✅（保存済）" : "API : ⏸️（未設定）";
          linkEl.textContent = ok ? "API解除する" : "APIを有効化";
          linkEl.onclick = async () => {
            if (ok) {
              try {
                localStorage.removeItem("gemini_api_key");
                setApiDisabled(true);
                __GEMINI_KEY_CACHE = null;
                updateApiBadge();
                refreshApiPanel();
                toast("⏸ APIを解除しました");
              } catch (_) {
                toast("⚠️ 解除に失敗しました");
              }
            } else {
              // 未設定→有効化へ誘導
              try {
                const res = await fetch("/api-key", { method: "GET", headers: { accept: "application/json" } });
                if (!res || !res.ok) throw new Error("fetch failed");
                const data = await res.json().catch(() => ({}));
                const k2 = (data && typeof data.key === "string") ? data.key.trim() : "";
                if (!k2) throw new Error("empty key");
                localStorage.setItem("gemini_api_key", k2);
                setApiDisabled(false);
                __GEMINI_KEY_CACHE = null;
                updateApiBadge();
                refreshApiPanel();
                toast("✅ APIを有効化しました");
              } catch (_) {
                toast("⚠️ APIの有効化に失敗しました");
              }
            }
          };
        }
      } catch (_) {
        if (badgeEl) badgeEl.textContent = "API : ⏸️ （未設定）";
        if (linkEl) { linkEl.textContent = "APIを有効化"; linkEl.onclick = null; }
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
    wrap.innerHTML = `
      <h3 class="dd-lazy-h3">
        <a href="#dd=${section.id}" class="dd-lazy-link" data-act="open">${section.label}</a>
        <span class="dd-lazy-actions">
          <button class="dd-btn dd-s-btn" data-act="gen">↓深掘り生成</button>
          <button class="dd-btn dd-s-btn" data-act="clear" disabled>消去</button>
        </span>
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

    // コンテナ（先に mountAndWire が #dd-lazy-host を作る想定。なければ作る）
    let host = document.getElementById("dd-lazy-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "dd-lazy-host";
      host.style.marginTop = "10px";
      body.appendChild(host);
    } else {
      // 二重生成防止（再マウント時は一度空にする）
      host.innerHTML = "";
    }

    // 生成ヘルパ（クロージャで row 単位に閉じ込める）
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
        btnClr.disabled = false;
        btnGen.textContent = "再生成";
      }

      const click = (h)=> (ev)=>{ ev.preventDefault(); ev.stopPropagation(); h().catch(console.error); };

      const ensureOpen = ()=>{
        if (bodyEl.style.display === "none") bodyEl.style.display = "";
      };

      const generate = async ()=>{
        btnGen.disabled = true; btnClr.disabled = true;
        ensureOpen();
        bodyEl.innerHTML = `<span class="dd-spinner"></span>生成中…`;

        const dom  = await (window.readDom? window.readDom(): {question:"",options:[],correct:""});
        const prompt = await buildSectionPrompt(meta||{field:"",theme:"",tagsCause:[],tagsProc:[],tagsOut:[]}, dom, sid);

        try{
          const html = await window.callGemini(prompt, { model: "models/gemini-2.5-flash" });
          const cleaned = String(html || "")
            .replace(/```html|```/g, "")
            .replace(/^\s*<h3[^>]*>[\s\S]*?<\/h3>\s*/i, "")
            .replace(/<\/?section[^>]*>/gi, "")
            .trim() || `<div class="dd-note">（空の出力）</div>`;
          bodyEl.innerHTML = cleaned;
          localStorage.setItem(sectionStoreKey(sid), cleaned);
          btnClr.disabled = false;
          btnGen.textContent = "再生成";
        }catch(e){
          bodyEl.innerHTML = `<div class="dd-note">生成に失敗：<span class="dd-mono">${String(e&&e.message||e)}</span></div>`;
        }finally{
          btnGen.disabled = false;
        }
      };

      // 見出しリンク：初回は生成、以降は開閉（⌥/Alt/⌘で「再生成」動作）
      link.addEventListener("click", click(async (ev)=>{
        const alt = ev && (ev.altKey || ev.metaKey);
        const has = !!localStorage.getItem(sectionStoreKey(sid));
        if (!has || alt){
          await generate();
        } else {
          bodyEl.style.display = (bodyEl.style.display === "none") ? "" : "none";
        }
        try { history.replaceState({}, "", `#dd=${sid}`); } catch(_){}
      }));

      btnGen.addEventListener("click", click(()=>generate()));
      btnClr.addEventListener("click", click(async ()=>{
        localStorage.removeItem(sectionStoreKey(sid));
        bodyEl.textContent = "（未生成）";
        btnClr.disabled = true;
        btnGen.textContent = "↓深掘り生成";
        bodyEl.style.display = "none";
      }));

      // セクション直リンク（#dd=theory 等）
      const hash = (location.hash || "").trim();
      if (hash === `#dd=${sid}`){
        if (!saved) { generate(); }
        else { bodyEl.style.display = ""; }
        setTimeout(()=> row.scrollIntoView({ block:"start", behavior:"smooth" }), 10);
      }
    }

    // 行追加
    for (const s of DD_SECTIONS){
      const row = sectionRow(s);
      host.appendChild(row);
      wireRow(row, s);
    }

    // 位置合わせ：ハッシュが変わったら対象を開く
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
    `;
    document.head.appendChild(st);
  }
})();
  
  window.DeepDive = window.DeepDive || { init(){} };
})();