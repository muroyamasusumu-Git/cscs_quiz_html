// 今日の日付（_build_cscs_YYYYMMDD から）
function getDayFromPath(){
  const m = (window.location.pathname||"").match(/_build_cscs_(\d{8})/);
  return m ? m[1] : "unknown";
}
// その日の「現在の runId」を保存/取得するキー
function runKey(day){ return `cscs_current_runId_${day}`; }

// 既存データから、その日の最大 runId を得る
function getMaxRunIdForDay(day, all){
  const runs = all.filter(r => r && r.day === day && Number.isInteger(r.runId)).map(r => r.runId);
  return runs.length ? Math.max.apply(null, runs) : 0;
}

// その日の現在の runId を取得（なければ新規で採番して保存）
function ensureCurrentRunId(day){
  const KEY = "cscs_results";
  let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY) || "[]"); }catch(_){ arr = []; }

  const k = runKey(day);
  const exists = localStorage.getItem(k);
  if (exists) return parseInt(exists, 10);

  const next = getMaxRunIdForDay(day, arr) + 1;
  localStorage.setItem(k, String(next));
  return next;
}

// 「新しい履歴で開始」指定があれば runId を進める
function maybeStartNewRunIfRequested(){
  const day = getDayFromPath();
  const params = new URLSearchParams(window.location.search);
  if (params.get("newrun") === "1"){
    const KEY = "cscs_results";
    let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY) || "[]"); }catch(_){ arr = []; }
    const next = getMaxRunIdForDay(day, arr) + 1;
    localStorage.setItem(runKey(day), String(next));
  }
}

// その日の最新 runId を取得（なければ 1）
function getLatestRunId(day){
  const KEY = "cscs_results";
  let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY) || "[]"); }catch(_){ arr = []; }
  const m = getMaxRunIdForDay(day, arr);
  return m || 1;
}