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
        <span class="judge-msg judge-msg-wrong">× 不正解</span>
        <span class="your-choice">
          / <span class="your-choice-label">あなたの選択:</span>
          <span class="your-choice-value">
            <span class="your-choice-letter">${choice}</span>
            <span class="your-choice-text">（${LABELS[choice] || ""}）</span>
          </span>
        </span>
      `;
      judgeEl.innerHTML = wrongHTML.trim();

      // 不正解回数ログ（内部raw＋日次counted）— localStorageトークン（TTL付き）
      // - per-question（内部分析用）: cscs_wrong_log[qid] を累積
      // - per-day（表示用）        : cscs_wrong_daily_log[day].raw を累積し、counted は最初の1回だけ 1
      // どちらも A→B 遷移トークンが有効なときだけ加算し、即トークンを消費（リロード二重防止）
      try {
        const qnum = (stem || "q000").slice(1);
        const qid  = `${day}-${qnum}`;
        const TKEY = `cscs_from_a_token:${qid}`;

        // トークン検証（存在＋期限内）
        let ok = false;
        try {
          const raw = localStorage.getItem(TKEY);
          if (raw) {
            const obj = JSON.parse(raw);
            const ts  = (obj && obj.ts) || 0;
            const ttl = (obj && obj.ttl_ms) || (3 * 60 * 1000);
            if (Date.now() - ts <= ttl) ok = true;
          }
        } catch (_) {}

        if (ok) {
          // --- 1) 内部：問題単位の原始ログ（分析用に回数を全部保持）
          {
            const KEY_Q = "cscs_wrong_log";
            let logQ; try { logQ = JSON.parse(localStorage.getItem(KEY_Q) || "{}"); } catch (_) {}
            if (!logQ || typeof logQ !== "object" || Array.isArray(logQ)) logQ = {};
            logQ[qid] = (logQ[qid] || 0) + 1;
            localStorage.setItem(KEY_Q, JSON.stringify(logQ));
          }

          // --- 2) 日次：表示用の「1日1回だけカウント」＋内部raw（回数）
          {
            const KEY_D = "cscs_wrong_daily_log";
            let logD; try { logD = JSON.parse(localStorage.getItem(KEY_D) || "{}"); } catch (_) {}
            if (!logD || typeof logD !== "object" || Array.isArray(logD)) logD = {};
            const rec = logD[day] || { raw: 0, counted: 0 };
            rec.raw += 1;                 // 内部：当日誤答回数を累積
            if (!rec.counted) rec.counted = 1; // 表示：最初の1回だけ 1
            logD[day] = rec;
            localStorage.setItem(KEY_D, JSON.stringify(logD));
          }

          // 二重加算防止：今回のA→Bトークンを消費
          localStorage.removeItem(TKEY);
        } else {
          console.debug("[CSCS] wrong tally skipped (no A->B token)", qid);
        }
      } catch (e) {
        console && console.warn && console.warn("wrong tally failed", e);
      }
    }

    // (3.5) 正解の集計（A→B 遷移時のみ）
    // 仕様:
    //  - raw … その日の正解回数を累積（記録用途）
    //  - counted … その日の「表計測」フラグ（初回だけ 1）
    try {
      const qnum = (stem||"q000").slice(1);
      const qid  = `${day}-${qnum}`;
      const TKEY = `cscs_from_a_token:${qid}`;

      // トークン検証（存在＋期限内）
      let ok = false;
      try {
        const raw = localStorage.getItem(TKEY);
        if (raw) {
          const obj = JSON.parse(raw);
          const ts  = (obj && obj.ts) || 0;
          const ttl = (obj && obj.ttl_ms) || (3 * 60 * 1000);
          if (Date.now() - ts <= ttl) ok = true;
        }
      } catch (_) {}

      if (ok && isCorrect) {
        const KEY = "cscs_correct_daily_log";
        let log; try { log = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch(_) {}
        if (!log || typeof log !== "object" || Array.isArray(log)) log = {};
        const rec = log[day] || { raw: 0, counted: 0 };

        rec.raw += 1;
        if (!rec.counted) rec.counted = 1;

        log[day] = rec;
        localStorage.setItem(KEY, JSON.stringify(log));

        // 消費（Bリロードでの再加算防止）
        localStorage.removeItem(TKEY);
      }
    } catch(e) {
      console && console.warn && console.warn("daily correct tally failed:", e);
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