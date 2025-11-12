async function run(){// b_judge.js — 正答判定＋日次/全期間リアルタイム集計（A→Bトークン連携）
(function(){
  if (window.__cscsBJudgeInstalled) return;
  window.__cscsBJudgeInstalled = true;

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
    try{
      if(localStorage.getItem(Kt)) return false;
      const sq=sessionStorage.getItem('cscs_last_token_qid');
      const sv=sessionStorage.getItem('cscs_last_token_value');
      const sc=sessionStorage.getItem('cscs_last_choice');
      if(sq===qid && sv){
        try{localStorage.setItem(Kt,sv);}catch(_){}
        if(sc){try{localStorage.setItem(Kc,sc);}catch(_){}}
        dlog('backfilled from sessionStorage', {qid});
        return true;
      }
    }catch(e){wlog('backfill error',e);}
    return false;
  }

  async function readTokenWithRetries({retries=6,delayMs=30}={}){
    backfillFromSessionIfNeeded();
    for(let i=0;i<=retries;i++){
      try{
        const t=localStorage.getItem(Kt);
        const c=localStorage.getItem(Kc);
        if(t) return {token:t,choice:(c||null)};
      }catch(e){wlog('read token fail',e);}
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

      // 表示をクリア
      host.innerHTML='';
      host.removeAttribute('style');

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
    // --- Reload Guard（同一タブ内の再読込での再加算を抑止） ---
    // qid は上で確定済み。ページ固有性を持たせるため pathname+search を含める
    const guardKey = `cscs_ab_consumed:${qid}:${location.pathname}${location.search}`;
    let alreadyConsumed = false;
    try { alreadyConsumed = sessionStorage.getItem(guardKey) === '1'; } catch(_) {}

    // 既にこのタブで消費済み（＝リロード）の場合は、先に A→B トークンを除去して以降の加算条件を不成立にする
    if (alreadyConsumed) {
      try { localStorage.removeItem(Kt); } catch(_) {}
      try { localStorage.removeItem(Kc); } catch(_) {}
    }

    // 従来どおりトークン読み取り（上で除去されていれば token は null になる）
    const {token,choice}=await readTokenWithRetries({retries:6,delayMs:30});
    if(!token){wlog('no token (skip tally)',{qid});return;}

    // 初回到着（＝このタブで未消費）なら consumed mark を立てる
    if (!alreadyConsumed) {
      try { sessionStorage.setItem(guardKey, '1'); } catch(_) {}
    }

    const userChoice=(choice||getChoiceFallbackFromURL()||'').toUpperCase();
    if(!/^[A-E]$/.test(userChoice)){wlog('no choice (skip)',{qid});return;}

    const correct=getCorrectChoiceFromDOM();
    if(!correct){wlog('no correct label (skip)',{qid});return;}

    const result=(userChoice===correct)?'correct':'wrong';
    updateUI(result,userChoice,correct);
    tally(result,userChoice);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run,{once:true});
  else run();
})();