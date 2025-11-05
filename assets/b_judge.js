// assets/b_judge.js — Bパート：判定・記録・音声再生（自己完結）
// 要件：A/B共通のローカルストレージ仕様 / 旧B_JUDGE_SCRIPTと同等の表示
(function(){
  "use strict";

  // ====== ヘルパ（自己完結・外部依存なし） ======
  function getDayFromPath(){
    const m = (window.location.pathname||"").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }
  function getQNumFromPath(){
    const m = (window.location.pathname||"").match(/q(\d{3})_[ab](?:\.html)?$/i);
    return (m && m[1]) ? m[1] : "000";
  }
  function getQid(){ return `${getDayFromPath()}-${getQNumFromPath()}`; }

  // --- run 管理（B側で自己完結） ---
  function runKey(day){ return `cscs_current_runId_${day}`; }
  function getMaxRunIdForDay(day, all){
    const runs = all.filter(r => r && r.day===day && Number.isInteger(r.runId)).map(r => r.runId);
    return runs.length ? Math.max.apply(null, runs) : 0;
  }
  function ensureCurrentRunId(day){
    const KEY = "cscs_results";
    let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY) || "[]"); }catch(_){ arr = []; }
    const k = runKey(day);
    const exists = localStorage.getItem(k);
    if (exists) return parseInt(exists,10);
    const next = getMaxRunIdForDay(day, arr) + 1;
    localStorage.setItem(k, String(next));
    return next;
  }
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

  // ====== メイン ======
  window.addEventListener("DOMContentLoaded", () => {
    // data-* を自身のscript要素から取得
    const me = (document.currentScript || Array.from(document.scripts).find(s => /b_judge\.js(\?|$)/.test(s.src)) );
    const stem       = (me && me.dataset.stem) || `q${getQNumFromPath()}`;
    const audioBase  = (me && me.dataset.audioBase) || "../audio";
    const ext        = (me && me.dataset.ext) || ".m4a";
    const day        = getDayFromPath();

    // (0) newrun 指定があれば採番
    try { maybeStartNewRunIfRequested(); } catch(_){}

    // (1) B音声の自動再生（失敗時は小ボタン）
    (function autoPlayB(){
      const src = `${audioBase}/${stem}_b${ext}`;
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.playsInline = true;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          const btn = document.createElement("button");
          btn.textContent = "🔊 音声を再生";
          btn.className = "audio-fallback-btn";
          btn.addEventListener("click", () => {
            const a2 = new Audio(src);
            a2.preload = "auto";
            a2.playsInline = true;
            a2.play()
              .then(() => btn.remove())
              .catch(() => { btn.textContent = "再生できません（ブラウザ設定を確認）"; });
          });
          document.body.appendChild(btn);
        });
      }
    })();

    // (2) 選択肢ラベル抽出・正解抽出
    const letters = ["A","B","C","D"];
    const items   = Array.from(document.querySelectorAll("ol.opts li"));
    const LABELS  = Object.fromEntries(items.slice(0,4).map((li,i)=>[letters[i], (li.textContent||"").trim()]));

    let CORRECT_CHOICE = "A";
    const ansEl = Array.from(document.querySelectorAll(".answer"))
      .find(el => /正解\s*:/.test(el.textContent||""));
    if (ansEl) {
      const m = (ansEl.innerHTML||"").match(/正解\s*:\s*([A-D])/i);
      if (m) CORRECT_CHOICE = m[1].toUpperCase();
    }

    // (3) 判定表示
    const params  = new URLSearchParams(window.location.search);
    const choice  = (params.get("choice") || "").toUpperCase();
    const judgeEl = document.getElementById("judge");
    if (!judgeEl) return;

    if (!choice || !["A","B","C","D"].includes(choice)) {
      judgeEl.textContent = "（選択が受け取れませんでした）";
      judgeEl.style.color = "#ccc";
      return;
    }

    const isCorrect = (choice === CORRECT_CHOICE);
    if (isCorrect) {
      judgeEl.textContent = "◎ 正解!!";
      judgeEl.style.color = "#fff34d";
      judgeEl.style.fontSize = "1.1em";
    } else {
      const wrongHTML = `
        <span style="color:#c9c9c9;">× 不正解</span>
        <span style="color:#c9c9c9"> / <span style="font-size:0.85em;">あなたの選択:</span> ${choice}（${LABELS[choice] || ""}）</span>
      `;
      judgeEl.innerHTML = wrongHTML.trim();

      // 不正解回数ログ（qid: YYYYMMDD-NNN）
      try{
        const KEY="cscs_wrong_log";
        let log={}; try{ log=JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(_){ log={}; }
        const qid = `${day}-${(stem||"q000").slice(1)}`;
        log[qid]=(log[qid]||0)+1;
        localStorage.setItem(KEY, JSON.stringify(log));
      }catch(e){ console && console.warn && console.warn("wrong_log save failed", e); }
    }

    // (4) 結果保存（runId 付き）
    try {
      const KEY = "cscs_results";
      let arr=[]; try{ arr = JSON.parse(localStorage.getItem(KEY) || "[]"); }catch(_){ arr = []; }
      const runId = ensureCurrentRunId(day);
      const record = {
        day,
        runId,
        stem,                 // "q001"
        choice,               // "A".."D"
        correct: isCorrect,
        correctChoice: CORRECT_CHOICE,
        label: (LABELS[choice] || ""),
        ts: Date.now()
      };
      // 同一 (day, runId, stem) を最後の回答で置換
      arr = arr.filter(r => !(r && r.day===day && r.runId===runId && r.stem===stem));
      arr.push(record);
      localStorage.setItem(KEY, JSON.stringify(arr));

      // 互換キー
      localStorage.setItem(`cscs_${day}_${stem}`, JSON.stringify(record));
      localStorage.setItem("cscs_last_day", day);
    } catch (e) {
      console && console.warn && console.warn("save result failed:", e);
    }
  });
})();