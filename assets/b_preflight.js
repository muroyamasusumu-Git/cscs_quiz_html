(function(){
  if (window.__cscsBPreflightInstalled) return;
  window.__cscsBPreflightInstalled = true;

  // === consumedタブなら最優先で Kt を削除（b_judge_record.js 起動前に潰す） ===
  try {
    const mDay = (location.pathname.match(/_build_cscs_(\d{8})/)||[])[1];
    const n3   = (location.pathname.match(/q(\d{3})_b/i)||[])[1];
    if (mDay && n3) {
      const qid   = `${mDay}-${n3}`;
      const gk    = `cscs_ab_consumed:${qid}`;
      const ktKey = `cscs_from_a_token:${qid}`;
      if (sessionStorage.getItem(gk) === '1') {
        try { localStorage.removeItem(ktKey); } catch(_){}
        console.debug('[B:preflight] removed Kt before record.js', {qid});
      }
    }
  } catch(_){}

  // qid = YYYYMMDD-NNN（Bページ限定）
  const mDay  = location.pathname.match(/_build_cscs_(\d{8})/);
  const mStem = location.pathname.match(/(?:^|\/)(q\d{3})_b(?:\.html)?(?:\/)?$/i);
  if (!mDay || !mStem) return;
  const day  = mDay[1];
  const num3 = mStem[1].slice(1);
  const qid  = `${day}-${num3}`;

  const Kt  = `cscs_from_a_token:${qid}`;
  const Kc  = `cscs_from_a:${qid}`;
  const KsT = `cscs_ab_shadow_token:${qid}`;   // 影トークン（sessionStorage）
  const KsC = `cscs_ab_shadow_choice:${qid}`;  // 影choice（sessionStorage）

  // ★ 初回到着フレームで Kt/Kc を「影」に退避 → localStorage からは見えなくする
  try{
    const hasShadow = sessionStorage.getItem(KsT);
    const lt = localStorage.getItem(Kt);
    const lc = localStorage.getItem(Kc);
    if (!hasShadow && (lt || lc)) {
      if (lt) { try{ sessionStorage.setItem(KsT, lt); }catch(_){} }
      if (lc) { try{ sessionStorage.setItem(KsC, lc); }catch(_){} }
      try{ localStorage.removeItem(Kt); }catch(_){}
      // Kc は UI 復元に使うので local 側も残す（※消さない）
      console.debug('[B:preflight] moved Kt/Kc to session shadow', { qid });
    }
  }catch(_){}

  // 画面左上に診断用パネル（B）
  const diag = document.createElement('div');
  diag.id = 'cscs_token_diag_b';
  diag.style.cssText =
    'position:fixed;z-index:99999;left:8px;top:8px;max-width:46vw;font:12px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:rgba(22,22,22,.8);color:#fff;padding:8px 10px;border-radius:6px;white-space:pre-wrap;word-break:break-word;pointer-events:none;';
  diag.textContent = '[B:preflight] init…';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(diag));

  const blog = (...a) => { try { console.debug('[B:preflight]', ...a); } catch(_){} };
  const setPanel = (o) => { try{
    diag.textContent = '[B:preflight] ' + Object.entries(o).map(([k,v]) => `${k}: ${v}`).join(' | ');
  }catch(_){ } };

  // 到着直後：不足なら sessionStorage から即時バックフィル（★リロード時は実行しない＆一度使ったら即消す）
  let initLocalToken = null, initLocalChoice = null;
  try {
    // 1) 既存 localStorage を確認
    initLocalToken  = localStorage.getItem(Kt);
    initLocalChoice = localStorage.getItem(Kc);

    // 2) ブラウザのナビゲーション種別を判定（reload の場合はバックフィル禁止）
    let isReload = false;
    try {
      const nav = (performance && performance.getEntriesByType)
        ? (performance.getEntriesByType('navigation')[0] || null)
        : null;
      isReload = !!(nav && nav.type === 'reload');
    } catch(_){ /* noop */ }

    // 3) token が無く、かつリロードではない場合のみ sessionStorage から一度だけ補填
    if (!initLocalToken && !isReload) {
      const sq = sessionStorage.getItem('cscs_last_token_qid');
      const sv = sessionStorage.getItem('cscs_last_token_value');
      const sc = sessionStorage.getItem('cscs_last_choice');

      if (sq === qid && sv) {
        // backfill → 直後に sessionStorage を必ず消去（※リロード時の再バックフィル防止）
        try { localStorage.setItem(Kt, sv); } catch(_){}
        if (sc) { try { localStorage.setItem(Kc, sc); } catch(_){ } }

        try {
          sessionStorage.removeItem('cscs_last_token_qid');
          sessionStorage.removeItem('cscs_last_token_value');
          sessionStorage.removeItem('cscs_last_choice');
        } catch(_){}

        initLocalToken  = localStorage.getItem(Kt);
        initLocalChoice = localStorage.getItem(Kc);
        blog('backfilled from sessionStorage (once, then cleared):', { qid, Kt, Kc });
      }
    } else if (isReload) {
      blog('skip backfill on reload');
    }
  } catch (e) {
    blog('localStorage get exception:', String(e));
  }

  // A側がデバッグ用に残したセッションミラーも取得（比較用）
  let sessQid = null, sessToken = null, sessChoice = null;
  try {
    sessQid    = sessionStorage.getItem('cscs_last_token_qid');
    sessToken  = sessionStorage.getItem('cscs_last_token_value');
    sessChoice = sessionStorage.getItem('cscs_last_choice');
  } catch (e) {
    blog('sessionStorage get exception:', String(e));
  }

  const shadowToken  = (function(){ try{ return sessionStorage.getItem(KsT); }catch(_){ return null; } })();
  const shadowChoice = (function(){ try{ return sessionStorage.getItem(KsC); }catch(_){ return null; } })();
  blog('arrived', {
    qid, Kt, Kc,
    initLocalToken, initLocalChoice,
    shadowToken: !!shadowToken,
    shadowChoice: shadowChoice || null,
    sessQid, sessToken: !!sessToken, sessChoice
  });

  // --- ロールアップ（集計）ユーティリティ ---
  function ensureDayIndex(dayStr){
    const dk = `cscs_rollup:${dayStr}`;
    let arr = [];
    try {
      const raw = localStorage.getItem(dk);
      if (raw) arr = JSON.parse(raw);
    } catch(_){}
    if (!Array.isArray(arr)) arr = [];
    if (arr.length < 30) {
      const need = 30 - arr.length;
      for (let i = 0; i < need; i++) arr.push(null);
    }
    return { key: dk, arr };
  }

  function qIndexFromQid(qidStr){
    // qidStr = "YYYYMMDD-NNN"
    const m = qidStr && qidStr.match(/-(\d{3})$/);
    if (!m) return -1;
    const n = parseInt(m[1], 10);
    return (n >= 1 && n <= 30) ? (n - 1) : -1;
  }

  function recordArrival(qidStr, tokenVal, choiceVal){
    const dayStr = qidStr.slice(0, 8);
    const { key, arr } = ensureDayIndex(dayStr);
    const idx = qIndexFromQid(qidStr);
    if (idx < 0) return false;

    const now = Date.now();
    const entry = {
      qid: qidStr,
      token: tokenVal || null,
      choice: choiceVal || null,
      ts: now
    };
    arr[idx] = entry;

    try {
      localStorage.setItem(key, JSON.stringify(arr));
      localStorage.setItem('cscs_last_seen_day', dayStr);
      blog('rollup saved', { key, idx, qid: qidStr });
      return true;
    } catch (e) {
      blog('rollup save exception:', String(e));
      return false;
    }
  }

  // ◆ロールアップへ即時反映（token/choice のどちらかがあれば記録）
  try{
    // consumed タブ、または直後A→B初回（未消費）では rollup を保留
    const gk = `cscs_ab_consumed:${qid}`;
    const alreadyConsumed = sessionStorage.getItem(gk) === '1';
    if (alreadyConsumed) {
      blog('rollup skip: already consumed tab', { qid });
    } else if (!alreadyConsumed) {
      // 初回タブでも、まだ b_judge.js が tally 前の Kt を持つ状態。
      // ここでは rollup を保留し、b_judge.js 側に任せる。
      blog('rollup deferred: let b_judge.js handle tally', { qid });
    }
  }catch(e){
    blog('rollup exception:', String(e));
  }

  setPanel({
    qid,
    localToken:   initLocalToken ? 'set' : 'null',
    localChoice:  initLocalChoice || 'null',
    shadowToken:  (function(){ try{ return sessionStorage.getItem(KsT) ? 'set' : 'null'; }catch(_){ return 'err'; } })(),
    shadowChoice: (function(){ try{ return sessionStorage.getItem(KsC) || 'null'; }catch(_){ return 'err'; } })(),
    sessQid:      sessQid || 'null',
    sessToken:    sessToken ? 'set' : 'null',
    sessChoice:   sessChoice || 'null'
  });

  // 以降、誰が localStorage を書き換えるか監視（stack 付き）
  try{
    const LS = localStorage;
    const _set    = LS.setItem.bind(LS);
    const _remove = LS.removeItem.bind(LS);
    const _clear  = LS.clear.bind(LS);

    LS.setItem = function(k, v){
      blog('setItem', {k, v}, 'stack:', new Error().stack);
      return _set(k, v);
    };
    LS.removeItem = function(k){
      blog('removeItem', {k}, 'stack:', new Error().stack);
      return _remove(k);
    };
    LS.clear = function(){
      blog('clear()', 'stack:', new Error().stack);
      return _clear();
    };
  }catch(e){
    blog('hook localStorage methods failed:', String(e));
  }

  window.addEventListener('beforeunload', (e)=>{ blog('beforeunload (B)', {trusted:e.isTrusted}); }, {capture:true});
  window.addEventListener('unload',       (e)=>{ blog('unload (B)'      , {trusted:e.isTrusted}); }, {capture:true});
})();