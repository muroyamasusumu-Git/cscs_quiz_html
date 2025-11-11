// assets/b_judge_record.js
// -------------------------------------------
// Bパート：正誤判定＋日替わり集計＋3連正解トラッキング
// JST対応・問題別総試行／計測済み／未計測付き
// -------------------------------------------
(function(){
  // …（ここに前回の修正版スクリプト全文をそのまま貼り付け）…
    (function(){
      // ---- helpers ----
      function getDayFromPath(){
        var m=(location.pathname||"").match(/_build_cscs_(\d{8})/);
        return m?m[1]:"unknown";
      }
      // JSTで "YYYYMMDD" を返す
      function getTodayYYYYMMDD_JST(){
        try{
          var now = new Date();
          var jst = new Date(now.getTime() + 9*60*60*1000);
          return jst.toISOString().slice(0,10).replace(/-/g,"");
        }catch(_){ return "unknown"; }
      }
      function getQNumFromPath() {
        // Bパート専用として _b 固定で抽出する
        var m = (location.pathname || "").match(/q(\d{3})_b(?:\.html)?$/i);
        return (m && m[1]) ? m[1] : "000";
      }
      function getChoiceFromQuery(){
        var sp = new URLSearchParams(location.search);
        var c = (sp.get("choice")||"").trim().toUpperCase();
        return /^[ABCD]$/.test(c) ? c : "";
      }
      function pickCorrectLetter(){
        // 1) cscs-meta 最優先
        try{
          var el = document.getElementById('cscs-meta');
          if(el){
            var meta = JSON.parse(el.textContent||"{}");
            var c = (meta.Correct||meta.correct||"").toString().trim().toUpperCase();
            if(/^[ABCD]$/.test(c)) return c;
          }
        }catch(_){}
        // 2) #judge / .answer からテキスト抽出
        try{
          var t = "";
          var j = document.getElementById('judge');
          if(j) t += " " + (j.textContent||j.innerText||"");
          var a = document.querySelector('.answer');
          if(a) t += " " + (a.textContent||"");
          var m = t.match(/[正せ][解い]\s*[:：]?\s*([ABCD])/i);
          if(m && m[1]) return m[1].toUpperCase();
        }catch(_){}
        return "";
      }
      function incIntLS(key, by){
        try{
          var n = parseInt(localStorage.getItem(key)||"0",10);
          if(!Number.isFinite(n)) n = 0;
          n += by;
          localStorage.setItem(key, String(n));
        }catch(_){}
      }
      function getJSON(key, fallback){
        try{
          return JSON.parse(localStorage.getItem(key)||"");
        }catch(_){ return (fallback===undefined?null:fallback); }
      }
      function setJSON(key, val){
        try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){}
      }
      function incPerProblem(base, qid, by){
        incIntLS(base + qid, by);
      }
      function getIntLS(key){
        try{
          var v = parseInt(localStorage.getItem(key)||"0",10);
          return Number.isFinite(v) ? v : 0;
        }catch(_){ return 0; }
      }
      function setIntLS(key, val){
        try{ localStorage.setItem(key, String(val|0)); }catch(_){}
      }

      // ---- 本体 ----
      var dayPath  = getDayFromPath();           // 例 "20250926"（qid用・後方互換）
      var dayPlay  = getTodayYYYYMMDD_JST();     // 例 "20251110"（JSTの実プレイ日ベース）
      var qnum     = getQNumFromPath();          // 例 "001"
      var qid      = dayPath + "-" + qnum;       // 例 "20250926-001"（既存互換）

      // A→Bトークンが無ければ（直叩き・リロード）はノーカウント
      // 後方互換：旧 "cscs_from_a:" と新 "cscs_from_a_token:" の両方を許可
      // 両ストレージ対応：A側は localStorage を使うので、session/local の両方を参照・削除する
      var tokenKeyNew = "cscs_from_a_token:" + qid;
      var tokenKeyOld = "cscs_from_a:" + qid;

      function readFromStorage(getter) {
        try {
          return getter();
        } catch (_) {
          return null;
        }
      }

      function removeFromStorage(remover) {
        try {
          remover();
        } catch (_) {}
      }

      var token =
        readFromStorage(() => sessionStorage.getItem(tokenKeyNew)) ||
        readFromStorage(() => sessionStorage.getItem(tokenKeyOld)) ||
        readFromStorage(() => localStorage.getItem(tokenKeyNew)) ||
        readFromStorage(() => localStorage.getItem(tokenKeyOld));

      if (!token) {
        // A を踏まずに B を直叩き or リロード → 計測しない
        return;
      }

      // どこにあっても消して再利用を防止
      removeFromStorage(() => sessionStorage.removeItem(tokenKeyNew));
      removeFromStorage(() => sessionStorage.removeItem(tokenKeyOld));
      removeFromStorage(() => localStorage.removeItem(tokenKeyNew));
      removeFromStorage(() => localStorage.removeItem(tokenKeyOld));

      // 正誤判定
      var choice  = getChoiceFromQuery();        // A/B/C/D
      var correct = pickCorrectLetter();         // A/B/C/D
      if(!choice || !correct){ return; }
      var isCorrect = (choice === correct);

      // ---- 正誤どちらも「日替わり1回＋試行回数」へ統一 ----
      // 全体（その日ぶん）
      //  正解: attempts -> cscs_correct_attempts_YYYYMMDD
      //        unique   -> cscs_correct_done:YYYYMMDD, total -> cscs_correct_days_total
      //        log      -> cscs_correct_attempt_log_YYYYMMDD
      //  不正: attempts -> cscs_wrong_attempts_YYYYMMDD
      //        unique   -> cscs_wrong_done:YYYYMMDD,  total -> cscs_wrong_days_total
      //        log      -> cscs_wrong_attempt_log_YYYYMMDD
      // 問題別（qidごと）
      //  総試行:   cscs_q_correct_total:{qid} / cscs_q_wrong_total:{qid}
      //  計測された:   cscs_q_correct_counted_total:{qid} / cscs_q_wrong_counted_total:{qid}
      //  計測されない: cscs_q_correct_uncounted_total:{qid} / cscs_q_wrong_uncounted_total:{qid}
      //  3連正解:  現在の連続長 -> cscs_correct_streak_len
      //            3連達成回数合計 -> cscs_correct_streak3_total
      //            ログ -> cscs_correct_streak3_log (配列)

      if(isCorrect){
        // 今日の試行回数（正解：全体）
        incIntLS("cscs_correct_attempts_" + dayPlay, 1);

        // 問題別：総試行（正解）
        incPerProblem("cscs_q_correct_total:", qid, 1);

        // その日の"正解"ユニーク消費状況
        var cFlag = "cscs_correct_done:" + dayPlay;
        var cDone = null; try{ cDone = localStorage.getItem(cFlag); }catch(_){}
        if(!cDone){
          // 全体：日数の累計＋今日のユニーク消費
          incIntLS("cscs_correct_days_total", 1);
          try{ localStorage.setItem(cFlag, "1"); }catch(_){}
          // 問題別："計測された"正解
          incPerProblem("cscs_q_correct_counted_total:", qid, 1);
        }else{
          // 問題別："計測されない"正解（同日2回目以降や他問題で既に消費済み）
          incPerProblem("cscs_q_correct_uncounted_total:", qid, 1);
        }

        // ---- 3連正解ストリーク（非重複：3達成ごとに1加算、達成時に長さを0にリセット）----
        try{
          var sLen = getIntLS("cscs_correct_streak_len");
          sLen += 1;
          if(sLen >= 3){
            incIntLS("cscs_correct_streak3_total", 1);
            // ログ（いつ/どの問題で3連目に到達したか）
            var sLogKey = "cscs_correct_streak3_log";
            var sLog = []; try{ sLog = JSON.parse(localStorage.getItem(sLogKey)||"[]"); }catch(_){ sLog = []; }
            sLog.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKey, JSON.stringify(sLog));
            // 非重複とするためリセット（オーバーラップ不要の場合）
            sLen = 0;
          }
          setIntLS("cscs_correct_streak_len", sLen);
        }catch(_){}

        // ログ（day単位）※選択肢も保持
        try{
          var ck = "cscs_correct_attempt_log_" + dayPlay;
          var carr = []; try{ carr = JSON.parse(localStorage.getItem(ck)||"[]"); }catch(_){ carr = []; }
          carr.push({ ts: Date.now(), qid: qid, choice: choice, counted: (!cDone ? 1 : 0) });
          localStorage.setItem(ck, JSON.stringify(carr));
        }catch(_){}
      }else{
        // 今日の試行回数（不正：全体）
        incIntLS("cscs_wrong_attempts_" + dayPlay, 1);

        // 問題別：総試行（不正）
        incPerProblem("cscs_q_wrong_total:", qid, 1);

        // その日の"不正"ユニーク消費状況
        var wFlag = "cscs_wrong_done:" + dayPlay;
        var wDone = null; try{ wDone = localStorage.getItem(wFlag); }catch(_){}
        if(!wDone){
          // 全体：日数の累計＋今日のユニーク消費
          incIntLS("cscs_wrong_days_total", 1);
          try{ localStorage.setItem(wFlag, "1"); }catch(_){}
          // 問題別："計測された"不正
          incPerProblem("cscs_q_wrong_counted_total:", qid, 1);
        }else{
          // 問題別："計測されない"不正
          incPerProblem("cscs_q_wrong_uncounted_total:", qid, 1);
        }

        // 不正解が出たらストリークはリセット
        try{ setIntLS("cscs_correct_streak_len", 0); }catch(_){}

        // 互換: 従来の通算集計 cscs_wrong_log[qid]++
        try{
          var wl = getJSON("cscs_wrong_log", {});
          if(!wl || typeof wl!=="object") wl = {};
          wl[qid] = (parseInt(wl[qid]||"0",10) + 1);
          setJSON("cscs_wrong_log", wl);
        }catch(_){}

        // ログ（day単位）※選択肢も保持
        try{
          var wk = "cscs_wrong_attempt_log_" + dayPlay;
          var warr = []; try{ warr = JSON.parse(localStorage.getItem(wk)||"[]"); }catch(_){ warr = []; }
          warr.push({ ts: Date.now(), qid: qid, choice: choice, counted: (!wDone ? 1 : 0) });
          localStorage.setItem(wk, JSON.stringify(warr));
        }catch(_){}
      }
    })();
})();