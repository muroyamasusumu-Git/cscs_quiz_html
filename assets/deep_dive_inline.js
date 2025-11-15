// deep_dive_inline.js — Bパート解説直下に“生成/再生成/消去”UIを自動挿入（ウィンドウ不要版）
// 依存: ページ内の cscs-meta(JSON) または DOMから取得できる問題文/タグ
// 既存 deep_dive.js がある場合は、window.deepDiveGenerate / window.deepDiveLocalGenerate を優先的に利用。
// それが無い場合は簡易フォールバックを表示。

(function(){
  "use strict";

  const SEL_EXPLANATIONS = [
    "#explanation", "#explain", ".explanation", ".explain", "#b-explain", ".b-explain"
  ];

  function $(sel, root=document){ return root.querySelector(sel); }
  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function findExplanationRoot(){
    for(const s of SEL_EXPLANATIONS){
      const el = $(s);
      if(el) return el;
    }
    const h1 = $("h1");
    if(h1 && h1.parentElement) return h1.parentElement;
    return null;
  }

  function loadCscsMeta(){
    // 共通ユーティリティ
    const pick = (obj, keys) => {
      for (const k of keys) {
        const v = obj && typeof obj[k] === "string" ? obj[k].trim() : "";
        if (v) return v;
      }
      return "";
    };
    const upperABCD = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      if (/^[a-dA-D]$/.test(s)) return s.toUpperCase();
      return s;
    };

    // 0) window.CSCS_META（最優先）
    if (window.CSCS_META && typeof window.CSCS_META === "object") {
      const raw = window.CSCS_META || {};
      const tags0 = raw.tags && typeof raw.tags === "object" ? raw.tags : {};
      const tags = {
        cause: pick(raw, ["Tag_Cause","tag_cause","Cause","上流"]) || pick(tags0, ["cause","Cause","上流"]),
        process: pick(raw, ["Tag_Process","tag_process","Process","中流"]) || pick(tags0, ["process","Process","中流"]),
        outcome: pick(raw, ["Tag_Outcome","tag_outcome","Outcome","下流"]) || pick(tags0, ["outcome","Outcome","下流"])
      };
      return {
        day:        pick(raw, ["Date","date","day"]),
        number:     pick(raw, ["Number","number","n","n3"]),
        field:      pick(raw, ["Field","field","分野"]),
        theme:      pick(raw, ["Theme","theme","テーマ"]),
        level:      pick(raw, ["Level","level","レベル"]),
        question:   pick(raw, ["Question","question","設問","text"]),
        correct:    upperABCD(pick(raw, ["Correct","correct","正解","correctChoice","answer"])),
        explanation: pick(raw, ["Explanation","explanation","解説"]),
        tags
      };
    }

    // 1) <script id="cscs-meta" type="application/json">
    const metaScript = $("#cscs-meta[type='application/json']");
    if (metaScript) {
      try {
        const raw = JSON.parse(metaScript.textContent || "{}");
        const tags0 = raw.tags && typeof raw.tags === "object" ? raw.tags : {};
        const tags = {
          cause: pick(raw, ["Tag_Cause","tag_cause","Cause","上流"]) || pick(tags0, ["cause","Cause","上流"]),
          process: pick(raw, ["Tag_Process","tag_process","Process","中流"]) || pick(tags0, ["process","Process","中流"]),
          outcome: pick(raw, ["Tag_Outcome","tag_outcome","Outcome","下流"]) || pick(tags0, ["outcome","Outcome","下流"])
        };
        return {
          day:        pick(raw, ["Date","date","day"]),
          number:     pick(raw, ["Number","number","n","n3"]),
          field:      pick(raw, ["Field","field","分野"]),
          theme:      pick(raw, ["Theme","theme","テーマ"]),
          level:      pick(raw, ["Level","level","レベル"]),
          question:   pick(raw, ["Question","question","設問","text"]),
          correct:    upperABCD(pick(raw, ["Correct","correct","正解","correctChoice","answer"])),
          explanation: pick(raw, ["Explanation","explanation","解説"]),
          tags
        };
      } catch (e) {
        console.warn("cscs-meta parse error", e);
      }
    }

    // 2) deep_dive.js と同等の“多段フォールバック”
    const day = (location.pathname.match(/_build_cscs_(\d{8})/)||[])[1] || "";
    const num = (location.pathname.match(/q(\d{3})_b(?:\.html)?/i)||[])[1] || "";

    const field = $("[data-field]")?.getAttribute("data-field") || "";
    const theme = $("[data-theme]")?.getAttribute("data-theme") || "";
    const level = $("[data-level]")?.getAttribute("data-level") || "";
    const question = $("h1")?.textContent?.trim() || "";

    // 候補：script → data-attr → URL(?choice=) → #judge → localStorage → .answer(HTML内「正解: A」)
    const fromScriptTag = (() => {
      const el = $("#cscs-meta[type='application/json']");
      if (!el) return "";
      try {
        const raw = JSON.parse(el.textContent || "{}");
        return pick(raw, ["Correct","correct","正解","correctChoice","answer"]) || "";
      } catch(_){ return ""; }
    })();

    const fromDataAttr    = ($("[data-correct]") && $("[data-correct]").getAttribute("data-correct")) || "";
    const fromQueryParam  = (new URLSearchParams(location.search).get("choice") || "");
    const fromJudgeText   = ($("#judge") && $("#judge").textContent) || "";
    const fromLocalStorage = (() => {
      try{
        const arr = JSON.parse(localStorage.getItem("cscs_results")||"[]");
        const rows = arr.filter(r => r && r.day===day && r.stem===(`q${num}`)).sort((a,b)=>(a.ts||0)-(b.ts||0));
        const last = rows[rows.length-1] || {};
        return last.correctChoice || last.correct_label || last.answer || "";
      }catch(_){ return ""; }
    })();

    // deep_dive.js と同様：.answer 内の「正解: A〜D」を抽出
    const fromAnswerHTML = (() => {
      try {
        const ansEls = Array.from(document.querySelectorAll(".answer"));
        for (const el of ansEls) {
          const html = el.innerHTML || "";
          const m = html.match(/正解\s*[:：]\s*([A-DＡ-Ｄ])/i);
          if (m) {
            const ch = String(m[1]).replace(/[Ａ-Ｄ]/g, z => String.fromCharCode(z.charCodeAt(0) - 0xFEE0));
            return ch.toUpperCase();
          }
        }
      } catch(_){}
      return "";
    })();

    let correct = upperABCD(
      fromScriptTag ||
      fromDataAttr ||
      fromQueryParam ||
      fromJudgeText ||
      fromLocalStorage ||
      fromAnswerHTML ||
      ""
    );

    // #judge テキストからの保険（単独文字抽出）
    if (!/^[ABCD]$/.test(correct) && fromJudgeText) {
      const m = fromJudgeText.match(/[A-D]/i);
      if (m) correct = upperABCD(m[0]);
    }

    const explanation = $("#explanation, .explanation, #explain, .explain")?.textContent?.trim() || "";

    const tags = {
      cause: $("[data-tag-cause]")?.getAttribute("data-tag-cause") || "",
      process: $("[data-tag-process]")?.getAttribute("data-tag-process") || "",
      outcome: $("[data-tag-outcome]")?.getAttribute("data-tag-outcome") || ""
    };

    return { day, number: num, field, theme, level, question, correct, explanation, tags };
  }

  // API 一時停止フラグ（deep_dive.js と共通運用）
  function isApiDisabled(){
    try {
      return localStorage.getItem("dd_api_disabled") === "1";
    } catch(_){
      return false;
    }
  }

  function nowTs(){ return Date.now(); }

  function getCacheKey(section, ctx){
    const day = ctx?.day || "NA";
    const num = ctx?.number || "NA";
    return `dd:${day}:${num}:${section}`;
  }

  function saveSession(section, ctx, payload){
    try { sessionStorage.setItem(getCacheKey(section, ctx), JSON.stringify(payload)); } catch(_){}
  }

  function loadSession(section, ctx){
    try {
      const txt = sessionStorage.getItem(getCacheKey(section, ctx));
      return txt ? JSON.parse(txt) : null;
    } catch(_){ return null; }
  }

  function deleteSession(section, ctx){
    try { sessionStorage.removeItem(getCacheKey(section, ctx)); } catch(_){}
  }

  function sanitizeText(s){ return (s||"").replace(/\u0000/g,""); }
  function setLoading(el, isLoading){ isLoading ? el.setAttribute("aria-busy","true") : el.removeAttribute("aria-busy"); }

  async function generateDeepDive(section, context){
    // 1) 既存 deep_dive.js の API / ローカル生成があればそちらを最優先
    if(typeof window.deepDiveGenerate === "function"){
      try{
        const text = await window.deepDiveGenerate(section, context);
        return { text: sanitizeText(text||""), model: "external", source: "api/local", ts: nowTs() };
      }catch(e){ console.warn("deepDiveGenerate failed:", e); }
    }
    if(typeof window.deepDiveLocalGenerate === "function"){
      try{
        const text = await window.deepDiveLocalGenerate(section, context);
        return { text: sanitizeText(text||""), model: "local", source: "local", ts: nowTs() };
      }catch(e){ console.warn("deepDiveLocalGenerate failed:", e); }
    }

    // 2) API が一時停止されている場合はここで終了
    if (isApiDisabled()) {
      return {
        text: "APIが一時停止中のため、この場での生成は行いません（必要であれば上部のAPI設定から再有効化してください）。",
        model: "none",
        source: "none",
        ts: nowTs()
      };
    }

    // 3) サーバー側 /generate 経由で Gemini に問い合わせ（キーはサーバーのみが保持）
    try{
      // deep_dive.js と同等のプロンプト生成を保証するため、明示的に解説全文を補填
      const explainText = document.querySelector(".explain, .explanation")?.textContent?.trim() || "";
      if (explainText && (!context.explanation || context.explanation.length < 50)) {
        context.explanation = explainText;
      }

      // deep_dive.js と同じ dom 抜粋関数（完全移植）
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

      // タグを配列化（全角区切りやスラッシュ等も許容）
      const split = (s) => !s ? [] : String(s).split(/[\|\uFF5C／\/、,，\s]+/).map(t=>t.trim()).filter(Boolean);

      // deep_dive.js の buildPrompt(meta, dom) へ渡すメタを組み立て
      const meta = {
        field: context.field || "",
        theme: context.theme || "",
        tagsCause: split(context?.tags?.cause || ""),
        tagsProc:  split(context?.tags?.process || ""),
        tagsOut:   split(context?.tags?.outcome || "")
      };

      const dom = await readDom();
      const prompt = buildPrompt(meta, dom, section);
      const text = await callGemini(prompt);
      return { text: sanitizeText(text||""), model: "gemini", source: "api", ts: nowTs() };
    }catch(e){
      console.warn("Gemini call failed:", e);
      return {
        text: "生成に失敗しました。時間をおいて再度お試しください。",
        model: "gemini",
        source: "api",
        ts: nowTs()
      };
    }
  }

  // deep_dive.js の buildPrompt を改良して「単一セクション専用」に変更
  function buildPrompt(meta, dom, sectionId){
    const j=(xs,sep=" → ")=>(xs&&xs.length)?xs.join(sep):"（該当なし）";
    const opts=(dom.options||[]).map((t,i)=>String.fromCharCode(65+i)+") "+t).join("\n");

    // ベース共通プロンプト
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

    // セクション別に出力指示を切り替える
    let sectionSpec = "";
    if (sectionId === "theory"){
      sectionSpec = `
【厳守事項】
- 「理論深掘り（上流）」の内容のみ出力する。他のセクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。
- 背景となる原因・原理を因果関係で2〜4文にまとめる。
`;
    } else if (sectionId === "process"){
      sectionSpec = `
【厳守事項】
- 「事例深掘り（中流）」の内容のみ出力する。他のセクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。
- 実際のプロセスや具体的な経路を2〜4文で簡潔に説明する。
`;
    } else if (sectionId === "definition"){
      sectionSpec = `
【厳守事項】
- 「定義深掘り（下流）」の内容のみ出力する。他のセクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。
- 結果や定義を明文化し、要点を整理する。
`;
    } else if (sectionId === "apply"){
      sectionSpec = `
【厳守事項】
- 「この問題への当てはめ」の内容のみ出力する。他のセクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。
- 本問の<span class="dd-answer">正解は ${dom.correct||"（不明）"}</span>です。その根拠を因果関係に基づいて説明し、他の選択肢が誤る理由も一言で触れる。
`;
    } else if (sectionId === "review3"){
      sectionSpec = `
【厳守事項】
- 「3行復習」の内容のみ出力する。他のセクションは出力しない。
- <h3>や<section>などの見出しタグは出力しない。
- 本問の内容を3行（3文）で要約する。
`;
    } else {
      sectionSpec = `
【厳守事項】
- 該当するセクション名が指定されていない場合は出力しない。
`;
    }

    return [base, sectionSpec].join("\n\n");
  }

  async function callGemini(prompt){
    // deep_dive.js と同様に、フロントは /api/deep-dive にプロンプトだけ送る。
    // API キーは Cloudflare Functions / Workers 側の環境変数で保持。
    const payload = {
      prompt: prompt,
      // model はサーバー側でデフォルトを持っているなら省略可。
      // 必要ならコメントアウト解除して送る：
      // model: "models/gemini-2.5-flash"
    };

    let text = "";
    let lastErr = null;

    try {
      const resp = await fetch("/api/deep-dive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp || !resp.ok) {
        lastErr = new Error(`deep-dive endpoint error: ${resp && resp.status}`);
      } else {
        const data = await resp.json().catch(() => ({}));
        // deep_dive.js 側とインターフェースを揃え、「{ output: string }」形式を期待
        text = (data && typeof data.output === "string") ? data.output : "";
      }
    } catch (e) {
      lastErr = e;
    }

    if (!text) {
      if (lastErr) throw lastErr;
      throw new Error("Gemini call failed via /api/deep-dive");
    }

    // 念のため ``` ～ ``` のコードフェンスは除去
    text = (text || "").replace(/```[\s\S]*?```/g, "").trim();
    return text;
  }

  function createInlineUI(root, ctx){
    const wrap = document.createElement("section");
    wrap.id = "dd-inline";
    wrap.setAttribute("aria-live","polite");
    // すべてのマージンを解除して、外側の余白に干渉しないようにする
    wrap.style.margin = "0";
    wrap.style.padding = "0";
    wrap.style.lineHeight = "1.7";

    // 内部すべての要素の余白を完全リセット＋ブロック改行を無効化（#dd-inline 限定）
    const styleReset = document.createElement("style");
    styleReset.textContent = `
      #dd-inline, #dd-inline * {
        margin: 12px 0 0 !important;
        padding: 0 !important;
        border: 0 !important;
        line-height: 20px !important;
      }
      /* ブロック要素による改行を排除 */
      #dd-inline section { display: contents !important; }  /* 親ボックスを消して子だけ残す */
      #dd-inline p       { display: inline !important; }    /* 段落改行を消す */
      #dd-inline ul, 
      #dd-inline ol      { display: inline !important; list-style: none !important; }
      #dd-inline li      { display: inline !important; }

      /* 強調色（deep_dive.js と整合）： */
      #dd-inline .dd-key    { color: #6cc7ff !important; }
      #dd-inline .dd-answer { color: #8fdcff !important; }
      /* 消去ボタン */
      #dd-inline .dd-clear  {
        color: #ffffff !important;
        text-decoration: underline !important;
      }

      /* 見出しリンク */
      #dd-inline .dd-head {
        color: #ffffff !important;
        text-decoration: underline !important;
        cursor: pointer !important;
        font-size: 18px !important;
        font-weight: 300 !important;
      }

      /* 念のため <strong>/<b> も軽く色付け */
      #dd-inline strong, #dd-inline b { color: #6cc7ff !important; }

      /* 「[理論深掘り｜上流（原因・原理）を生成]」を小さく */
      #dd-inline .dd-body-cause {
        font-size: 16px !important;
      }

      /* 「この問題への当てはめ」を小さく */
      #dd-inline .dd-body-apply {
        font-size: 13px !important;
        line-height: 1.0 !important;
      }
    `;
    wrap.appendChild(styleReset);

    const mkRow = (sectionKey, headLabel) => {
      const row = document.createElement("div");
      row.className = `dd-row dd-${sectionKey}`;
      row.style.margin = "0";

      const head = document.createElement("a");
      head.href = "javascript:void(0)";
      head.className = `dd-head dd-head-${sectionKey}`;
      head.setAttribute("role","button");
      head.setAttribute("tabindex","0");
      head.style.textDecoration = "underline";
      head.style.cursor = "pointer";
      head.textContent = `[${headLabel}を生成]`;

      const body = document.createElement("div");
      body.className = `dd-body dd-body-${sectionKey}`;
      body.style.margin = "0";
      body.style.fontWeight = "300";
      body.style.fontSize = "16px";

      let generating = false;

      async function doGenerate(){
        if(generating) return;
        generating = true;
        setLoading(body, true);
        body.innerHTML = "生成中…";

        try{
          body.innerHTML = "生成中…";
          const result = await generateDeepDive(sectionKey, ctx);
          const text = result?.text || "";
          // 本文を表示
          body.innerHTML = text || "(内容なし)";

          // 末尾：消去ボタン
          const clear = document.createElement("a");
          clear.href = "javascript:void(0)";
          clear.className = "dd-clear";
          clear.style.marginLeft = "0.5rem";
          clear.style.textDecoration = "underline";
          clear.textContent = "[×消去]";
          clear.addEventListener("click", () => {
            // セッションキャッシュも削除して完全に消去
            deleteSession(sectionKey, ctx);

            // UIを消去
            body.innerHTML = "";

            // 見出しを再表示（再生成フローは廃止）
            head.style.display = "";
            head.textContent = `[${headLabel}を生成]`;
          });
          // 末尾の段落/リスト内に消去リンクを内包させる（改行防止）
          let container = body;
          const deepLastP = body.querySelector("section p:last-of-type, div p:last-of-type, p:last-of-type");
          if (deepLastP) {
            container = deepLastP;
          } else {
            const lastEl = body.lastElementChild;
            if (lastEl && /^(P|UL|OL)$/i.test(lastEl.tagName)) container = lastEl;
          }
          container.insertAdjacentHTML("beforeend", "&nbsp;");
          container.appendChild(clear);

          // 見出しは消してスペース節約
          head.style.display = "none";

          // セッションキャッシュ保存
          saveSession(sectionKey, ctx, result);

        }catch(e){
          console.warn("generate failed", e);
          body.innerHTML = "生成に失敗しました。もう一度お試しください。";
          // 失敗時は見出しを表示して再試行可能に
          head.style.display = "";
          head.textContent = `[${headLabel}を生成]`;
        }finally{
          setLoading(body, false);
          generating = false;
        }
      }

      head.addEventListener("click", () => { doGenerate(); });
      head.addEventListener("keydown",(ev)=>{
        if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); doGenerate(); }
      });

      // 復元（あれば）…復元時は見出しは非表示で、本文＋[×消去]のみ表示
      const cached = loadSession(sectionKey, ctx);
      if(cached && cached.text){
        body.innerHTML = cached.text;
        const clear = document.createElement("a");
        clear.href = "javascript:void(0)";
        clear.className = "dd-clear";
        clear.style.marginLeft = "0.5rem";
        clear.style.textDecoration = "underline";
        clear.textContent = "[×消去]";
        clear.addEventListener("click", () => {
          // セッションキャッシュも削除
          deleteSession(sectionKey, ctx);

          // UIをクリア
          body.innerHTML = "";
          head.style.display = "";
          head.textContent = `[${headLabel}を生成]`;
        });
        // 末尾の段落/リスト内に消去リンクを内包させる（改行防止）
        let container = body;
        const deepLastP = body.querySelector("section p:last-of-type, div p:last-of-type, p:last-of-type");
        if (deepLastP) {
          container = deepLastP;
        } else {
          const lastEl = body.lastElementChild;
          if (lastEl && /^(P|UL|OL)$/i.test(lastEl.tagName)) container = lastEl;
        }
        container.insertAdjacentHTML("beforeend", "&nbsp;");
        container.appendChild(clear);
        head.style.display = "none";
      }

      row.appendChild(head);
      row.appendChild(body);
      return row;
    };

    wrap.appendChild(mkRow("cause", "理論深掘り｜上流（原因・原理）"));
    wrap.appendChild(mkRow("apply", "この問題への当てはめ"));

    // .explain が pre-wrap の場合、末尾の改行テキストが空行になるので除去
    (function nukeTrailingWhitespace(node){
      try{
        let c = node.lastChild;
        while (c && c.nodeType === 3 && /^\s+$/.test(c.nodeValue)) {
          const prev = c.previousSibling;
          node.removeChild(c);
          c = prev;
        }
      } catch(_){}
    })(root);

    root.appendChild(wrap);
  }

  function boot(){
    const explainRoot = findExplanationRoot();
    if(!explainRoot) return;

    // ★ Bパートの pre-wrap を解除（深掘りで空行が出るのを防ぐ）
    try {
      const ex = document.querySelector('.explain, .explanation');
      if (ex) ex.style.whiteSpace = 'normal';
    } catch (_) {}

    if($("#dd-inline", explainRoot)) return;
    const ctx = loadCscsMeta();
    createInlineUI(explainRoot, ctx);

    // ▼ 追加：パネルを開かなくても “theory” を自動生成（未生成時のみ）
    try {
      maybeAutoGenerate(ctx);
    } catch (_) {}
  }

// === 自動生成ヘルパ（パネル非依存） ==========================
function maybeAutoGenerate(ctx){
  try{
    const day  = ctx.day || (location.pathname.match(/_build_cscs_(\d{8})/)||[])[1];
    const stem = ctx.stem || (location.pathname.match(/(q\d{3})_b/i)||[])[1];
    if(!day || !stem) return;

    // 既に localStorage に保存済みなら生成しない
    const lsKey = `cscs_dd_${day}_${stem}:theory`;
    const cached = localStorage.getItem(lsKey);
    if (cached && cached.trim()) return;

    // UI がまだ構築されていない場合は終了
    const head = document.querySelector('#dd-inline .dd-head[data-section="theory"]');
    const body = document.querySelector('#dd-inline .dd-body[data-section="theory"]');
    if (!head || !body) return;

    // 既に中身がある（=手動生成済み）ならスキップ
    if (body.innerHTML && body.innerHTML.trim() !== "") return;

    // クリックハンドラに委譲して既存フローをそのまま利用
    head.click();
  }catch(e){
    console && console.warn && console.warn('[inline:auto]', e);
  }
}

  // 即時起動版：DeepDive の準備を待たずに UI（見出し）を先に出す
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();