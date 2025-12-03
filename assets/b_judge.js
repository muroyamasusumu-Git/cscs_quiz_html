/**
 * === SPEC HEADER: DO NOT REMOVE ===
 * このコメントブロックは b_judge.js の公式仕様定義（同期対象）です。
 * ChatGPT や他AIが本ファイルを解析・改修する際は、
 * 下記ドキュメントを実装と常に整合させて更新してください。
 *
 * 仕様更新ルール:
 *  - このブロックはスクリプトの「機能・責務・構造・排他設計」を示す。
 *  - スクリプトの挙動を変更した場合は、必ず該当箇所の説明文を更新すること。
 *  - ChatGPTはこのブロックを優先的に参照し、更新内容をここに反映する。
 *
 * ファイル: b_judge.js
 * 最終更新: 2025-11-13
 *
 * === SPEC CONTENT ===
 * b_judge.js — Bパート正答判定＋リロード耐性付き集計処理（ver.2025-11）
 *
 * 【責務】
 *  - Bページにおいて A→Bトークンを受け取り、ユーザー選択と正答を照合して集計。
 *  - DOM描画（#judge）と localStorage への集計更新を統合的に管理。
 *  - Aパートで生成されたトークンを確実に一度だけ消費し、リロード時の重複加算を防止。
 *
 * 【構成】
 *  1. Preflight（タブ限定）
 *     - 既に sessionStorage[cscs_ab_consumed:<qid>] がある場合、
 *       localStorage[cscs_from_a_token:<qid>] を削除し再加算を抑止。
 *
 *  2. トークン読取（readTokenWithRetries）
 *     - 影トークン方式（sessionStorage）に対応。
 *       優先順位: KsT/KsC → localStorage[Kt/Kc]。
 *       A側ミラー（cscs_last_token_*）からの復活は常時停止（shadow-mode）。
 *
 *  3. リロードガード（run内）
 *     - qid単位で guardKey=cscs_ab_consumed:<qid> を保持。
 *       初回アクセス時: mark=1 を立て、集計を許可。
 *       再読込時: Ktを除去して tally() をスキップ。
 *
 *  4. 集計（tally）
 *     - 日別（raw / counted）・全期間・ロールアップに反映。
 *     - 各 qid 単位の延べ（cscs_q_*_total）も自動更新。
 *
 *  5. UI更新
 *     - 常に userChoice / correct の比較結果を #judge に描画。
 *     - トークン有無に関わらず視覚出力を保証（責務分離: UIと集計）。
 *
 *  6. トークン破棄
 *     - tally() 後に localStorage[Kt] および sessionStorage[KsT/KsC] を削除。
 *       → 二重加算・他タブ干渉を完全防止。
 *
 * 【排他設計】
 *  - sessionStorageスコープ（タブ単位）での mark によりリロード耐性を確保。
 *  - localStorageはA→B受け渡し専用であり、加算後は即破棄。
 *  - UIは token 状態に依存せず描画（UX分離）。
 *
 * 【関連ファイル】
 *  - b_judge_record.js …… 問題別/日別カウントの正統記録器（変更禁止）
 *  - build_quiz.py …… Bプリフライト (#3.6) で影トークンを注入・rollup監視
 *  - wrong_badge.js …… 延べ値可視化＋リセットモーダル
 */
 // === END SPEC HEADER (keep synchronized with implementation) ===
 
(function(){
  if (window.__cscsBJudgeInstalled) return;
  window.__cscsBJudgeInstalled = true;

  // --- Preflight (tab-scoped): consumed タブなら最優先で Kt を即削除して再加算の芽を潰す ---
  try {
    // Bページの qid を URL から復元（_build_cscs_YYYYMMDD / qNNN_b）
    const mDay  = (location.pathname.match(/_build_cscs_(\d{8})/)||[])[1];
    const n3    = (location.pathname.match(/q(\d{3})_b/i)||[])[1];
    if (mDay && n3) {
      const qid   = `${mDay}-${n3}`;
      const gk    = `cscs_ab_consumed:${qid}`;                  // guardKey は qid 固定
      const ktKey = `cscs_from_a_token:${qid}`;                 // A→B トークン
      if (sessionStorage.getItem(gk) === '1') {
        try { localStorage.removeItem(ktKey); } catch(_) {}
      }
    }
  } catch(_) {}

  const dlog = (...a)=>{ try{ console.debug('[B:judge]', ...a); }catch(_){} };
  const wlog = (...a)=>{ try{ console.warn('[B:judge]', ...a); }catch(_){} };

  // ==== 0) Bページ判定 ====
  const mDay  = location.pathname.match(/_build_cscs_(\d{8})/);
  const mStem = location.pathname.match(/(?:^|\/)(q\d{3})_b(?:\.html)?(?:\/)?$/i);
  if (!mDay || !mStem) return;
  const day  = mDay[1];
  const num3 = mStem[1].slice(1);
  const qid  = `${day}-${num3}`;

  const Kt = `cscs_from_a_token:${qid}`;
  const Kc = `cscs_from_a:${qid}`;
  const KsT = `cscs_ab_shadow_token:${qid}`;   // 影トークン（sessionStorage）
  const KsC = `cscs_ab_shadow_choice:${qid}`;  // 影choice（sessionStorage）

  // ==== 1) util ====
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const readJson=(k,f)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):f;}catch(_){return f;}};
  const writeJson=(k,o)=>{try{localStorage.setItem(k,JSON.stringify(o));}catch(e){wlog('writeJson',k,e);}};

  function addInt(key,delta){
    try{
      const v=parseInt(localStorage.getItem(key)||'0',10);
      localStorage.setItem(key,String((isFinite(v)?v:0)+delta));
    }catch(e){wlog('addInt',key,e);}
  }

  function backfillFromSessionIfNeeded(){
    // 影トークン方式へ移行したため、A側ミラーからの復活は常時停止
    try { dlog('backfill disabled (shadow-mode)', { qid }); } catch(_) {}
    return false;
  }

  async function readTokenWithRetries({retries=6,delayMs=30}={}){
    // 1) 影トークン（sessionStorage）を最優先
    try{
      const st = sessionStorage.getItem(KsT);
      const sc = sessionStorage.getItem(KsC);
      if (st) return { token: st, choice: (sc || null) };
    }catch(_){}

    // 2) backfill は行わない。localStorage に Kt が残っている場合のみ読む
    for(let i=0;i<=retries;i++){
      try{
        const t = localStorage.getItem(Kt);
        const c = localStorage.getItem(Kc);
        if (t) return { token: t, choice: (c || null) };
      }catch(e){ wlog('read token fail', e); }
      if(i<retries) await sleep(delayMs);
    }
    return {token:null,choice:null};
  }

  // ==== 2) 集計キー ====
  const K_WRONG_DAILY='cscs_wrong_daily_log';
  const K_CORR_DAILY='cscs_correct_daily_log';
  const K_WRONG_DAY_Q='cscs_wrong_day_log';
  const K_CORR_DAY_Q='cscs_correct_day_log';
  const K_ALL_WRONG_RAW='cscs_alltime_wrong_raw';
  const K_ALL_CORR_RAW='cscs_alltime_correct_raw';
  const K_LAST_SEEN_DAY='cscs_last_seen_day';
  const K_ROLLUP_PREFIX='cscs_rollup:';
  const K_ROLL_META='cscs_rollup_meta';

  function ensureDayBuckets(){
    const wd=readJson(K_WRONG_DAILY,{});
    const cd=readJson(K_CORR_DAILY,{});
    if(!wd[day]) wd[day]={raw:0,counted:0};
    if(!cd[day]) cd[day]={raw:0,counted:0};
    writeJson(K_WRONG_DAILY,wd);
    writeJson(K_CORR_DAILY,cd);
  }

  function markRollup(qid){
    try{
      localStorage.setItem(K_LAST_SEEN_DAY,day);
      const rollKey=K_ROLLUP_PREFIX+day;
      const roll=readJson(rollKey,{});
      if(!roll[qid]) roll[qid]=1;
      writeJson(rollKey,roll);
      const meta=readJson(K_ROLL_META,{});
      meta.day=day;
      if(!meta.created_at) meta.created_at=new Date().toISOString();
      writeJson(K_ROLL_META,meta);
    }catch(e){wlog('markRollup fail',e);}
  }

  function tally(result,choiceStr){
    ensureDayBuckets();
    const wd=readJson(K_WRONG_DAILY,{});
    const cd=readJson(K_CORR_DAILY,{});
    const wq=readJson(K_WRONG_DAY_Q,{});
    const cq=readJson(K_CORR_DAY_Q,{});
    if(!wd[day]) wd[day]={raw:0,counted:0};
    if(!cd[day]) cd[day]={raw:0,counted:0};
    if(!wq[day]) wq[day]={};
    if(!cq[day]) cq[day]={};

    if(result==='wrong'){
      wd[day].raw++;
      if(!wq[day][qid]) wq[day][qid]=1;
      wd[day].counted=Object.keys(wq[day]).length;
      writeJson(K_WRONG_DAY_Q,wq);
      writeJson(K_WRONG_DAILY,wd);
      addInt(K_ALL_WRONG_RAW,1);
    }else{
      cd[day].raw++;
      if(!cq[day][qid]) cq[day][qid]=1;
      cd[day].counted=Object.keys(cq[day]).length;
      writeJson(K_CORR_DAY_Q,cq);
      writeJson(K_CORR_DAILY,cd);
      addInt(K_ALL_CORR_RAW,1);
    }
    markRollup(qid);
    dlog('tallied',{qid,result,choice:choiceStr});
  }

  // ==== 3) 正答抽出＆判定 ====
  function normAtoE(s){
    return String(s||'').toUpperCase()
      .replace('Ａ','A').replace('Ｂ','B').replace('Ｃ','C').replace('Ｄ','D').replace('Ｅ','E');
  }

  function getCorrectChoiceFromDOM(){
    try{
      // パターン1：「正解: B ...」テキスト
      const t=(document.body.textContent||'').replace(/\s+/g,'');
      const m=t.match(/正解[:：]([A-EＡ-Ｅ])/);
      if(m) return normAtoE(m[1]);

      // パターン2：.answer 要素
      const ans=document.querySelector('.answer,.correct,.judge-ok,.judge-correct');
      if(ans){
        const mm=normAtoE(ans.textContent).match(/[A-E]/);
        if(mm) return mm[0];
      }

      // パターン3：li[data-correct="true"]
      const li=document.querySelector('ol.opts li[data-correct="true"]');
      if(li){
        const h=normAtoE((li.textContent.trim()[0]||''));
        if(/^[A-E]$/.test(h)) return h;
      }

      // パターン4：data-correct 属性
      const el=document.querySelector('[data-correct]');
      if(el){
        const v=normAtoE(el.getAttribute('data-correct'));
        if(/^[A-E]$/.test(v)) return v;
      }
    }catch(e){wlog('correct parse fail',e);}
    return null;
  }

  function getChoiceFallbackFromURL(){
    try{
      const u=new URL(location.href);
      const c=normAtoE(u.searchParams.get('choice')||'');
      return /^[A-E]$/.test(c)?c:null;
    }catch(_){return null;}
  }

  function updateUI(result,choice,correct){
    try{
      const host=document.getElementById('judge');
      if(!host){
        wlog('#judge not found');
        return;
      }

      // 表示をクリアしつつベース高さを維持（レイアウトのガタつき防止）
      host.innerHTML='';
      const BASE = 'min-height:1em;display:block;';
      host.setAttribute('style', BASE);

      const ESC=(s)=> (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
      function findChoiceText(letter){
        if(!letter) return '';
        const idx='ABCD'.indexOf(letter.toUpperCase());
        if(idx<0) return '';
        const li=document.querySelector(`ol.opts li:nth-child(${idx+1})`);
        if(!li) return '';
        const raw=(li.textContent||'').trim().replace(/^[A-D][\s\.\)．】）]\s*/u,'').trim();
        return raw;
      }

      if(result==='correct'){
        host.style.color='rgb(255,243,77)';
        host.style.fontSize='1.1em';
        host.textContent='◎ 正解!!';
      }else if(result==='wrong'){
        const text=findChoiceText(choice);
        host.innerHTML=
          '<span class="judge-msg judge-msg-wrong">× 不正解</span>' +
          '<span class="your-choice">' +
            ' / <span class="your-choice-label">あなたの選択:</span> ' +
            '<span class="your-choice-value">' +
              '<span class="your-choice-letter">'+ESC(choice)+'</span>' +
              '<span class="your-choice-text">（'+ESC(text)+'）</span>' +
            '</span>' +
          '</span>';
      }

      // bodyクラスも更新
      document.body.classList.toggle('is-correct',result==='correct');
      document.body.classList.toggle('is-wrong',result==='wrong');
    }catch(e){
      wlog('UI update fail',e);
    }
  }

  async function run(){
    // 先に #judge のベース高さを確保（描画前のガタつき防止）
    try {
      const host0 = document.getElementById('judge');
      if (host0) {
        host0.setAttribute('style', 'min-height:1em;display:block;');
      }
    } catch(_) {}

    // --- Reload Guard（同一タブ内の再読込での再加算を抑止） ---
    // URL 変化に左右されないよう、qid のみでガードキーを生成（タブ内一意）
    const guardKey = `cscs_ab_consumed:${qid}`;
    let alreadyConsumed = false;
    try { alreadyConsumed = sessionStorage.getItem(guardKey) === '1'; } catch(_) {}

    // 既にこのタブで消費済み（＝リロード）の場合は、再加算を防ぐためトークンのみ除去（選択肢 Kc は残す）
    if (alreadyConsumed) {
      try { localStorage.removeItem(Kt); } catch(_) {}
    }

    // トークンと（あれば）選択肢を読み取り（バックフィルは readTokenWithRetries 内で実施）
    const {token,choice} = await readTokenWithRetries({retries:6,delayMs:30});
    const canTally = !!token && !alreadyConsumed;

    // 初回到着（＝このタブで未消費）なら consumed mark を立てる
    if (!alreadyConsumed) {
      try { sessionStorage.setItem(guardKey, '1'); } catch(_) {}
    }

    // --- Choice の救済フォールバック ---
    // token 無し時は readTokenWithRetries が choice を返さない設計のため、Kc → URL → '' の順で復元
    let finalChoice = choice;
    if (!finalChoice) {
      try { finalChoice = localStorage.getItem(Kc) || null; } catch(_) {}
    }
    if (!finalChoice) {
      finalChoice = getChoiceFallbackFromURL() || '';
    }

    // UI は常に描画（token の有無に依存させない）
    const userChoice = (finalChoice || '').toUpperCase();

    // O.D.O.A Mode 前提の「no choice」ケース:
    // - Aパート側で once-per-day 判定によりトークン／choice が発行されていない状態
    // - この問題はページ遷移のみ（正誤計測なし）とみなし、専用メッセージのみ表示して終了する
    if (!/^[A-E]$/.test(userChoice)) {
      try {
        const host = document.getElementById('judge');
        if (host) {
          // 表示を一旦クリアし、レイアウトが崩れないように min-height を維持
          host.innerHTML = '';
          host.setAttribute('style', 'min-height:1em;display:block;');

          // 不正解表示と同じクラス系を流用しつつ、O.D.O.A Mode 用の説明文を出す
          host.innerHTML =
            '<span class="judge-msg judge-msg-wrong">※O.D.O.A Mode : ON のため、この問題の正誤計測はされていません。</span>';

          // 正解／不正解どちらの状態クラスも外して「判定なし」であることを明示
          document.body.classList.remove('is-correct');
          document.body.classList.remove('is-wrong');

          // コンソール上で、この分岐が確実に通ったことを確認できるログ
          dlog('ODOA no-count message rendered (no choice; no tally)', { qid });
        } else {
          // #judge 自体が見つからない場合もログに残しておく
          wlog('ODOA no-count: #judge not found', { qid });
        }
      } catch (e) {
        // 予期せぬ例外が起きた場合も握りつぶさず内容を確認できるようにする
        wlog('ODOA no-count render error', {
          qid,
          error: e && e.message ? e.message : String(e)
        });
      }
      // この問題は「正誤計測なし」として確定させるため、以降の判定・集計ロジックには進まない
      return;
    }

    const correct = getCorrectChoiceFromDOM();
    if (!correct) {
      wlog('no correct label (skip)', { qid });
      return;
    }

    const result = (userChoice === correct) ? 'correct' : 'wrong';
    updateUI(result, userChoice, correct);

    // 集計は token があり、かつ未消費タブのときだけ実行
    if (canTally) {
      tally(result,userChoice);
      // 初回 tally 後は A→B トークンと影トークンを確実に破棄
      try { localStorage.removeItem(Kt); } catch(_) {}
      try { sessionStorage.removeItem(KsT); } catch(_) {}
      try { sessionStorage.removeItem(KsC); } catch(_) {}
    } else {
      dlog('tally skipped',{qid,alreadyConsumed,hasToken:!!token,hasChoice:!!finalChoice});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();  // ← IIFE を確実に閉じる