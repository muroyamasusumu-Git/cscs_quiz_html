/**
 * === SPEC HEADER: DO NOT REMOVE ===
 * このコメントブロックは b_judge_record.js の公式仕様定義（同期対象）です。
 * ChatGPT や他AIが本ファイルを解析・改修する際は、
 * 下記ドキュメントを実装と常に整合させて更新してください。
 *
 * 仕様更新ルール:
 *  - このブロックはスクリプトの「機能・責務・構造・排他設計」を示す。
 *  - スクリプトの挙動を変更した場合は、必ず該当箇所の説明文を更新すること。
 *  - ChatGPTはこのブロックを優先的に参照し、更新内容をここに反映する。
 *
 * ファイル: b_judge_record.js
 * 最終更新: 2025-11-24
 *
 * === SPEC CONTENT ===
 */
// assets/b_judge_record.js
// -------------------------------------------
// Bパート：正誤判定＋日替わり集計＋問題別3連正解トラッキング
// JST対応・問題別総試行／計測済み／未計測・問題別連続正解付き
// -------------------------------------------
// ===========================================================
// 📊 CSCS 計測仕様サマリー（b_judge_record.js）
// JST基準：YYYYMMDD
//
// 🧮 記録対象とキー一覧
//
// ┌────────────┬───────────────────────────────┬───────────────────────────────────────────────────────┐
// │ 区分       │ キー名（prefix）                      │ 内容・カウント条件・備考                                │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 日次試行系 │ cscs_correct_attempts_<日付>         │ 当日中の正解試行数（Bパート到達・正解ごとに +1）            │
// │             │ cscs_wrong_attempts_<日付>           │ 当日中の不正解試行数（Bパート到達・不正解ごとに +1）        │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 日次ユニーク│ cscs_correct_done:<日付>              │ 当日に1回でも正解した印。初回のみ "1"                     │
// │             │ cscs_wrong_done:<日付>                │ 当日に1回でも不正解した印。初回のみ "1"                   │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 日数カウンタ│ cscs_correct_days_total              │ 正解した「日」の累計数。*_done 新規立ち上げ時 +1             │
// │             │ cscs_wrong_days_total                │ 不正解した「日」の累計数。同上                            │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 日別ログ    │ cscs_correct_attempt_log_<日付>       │ 当日の全正解ログ。{ts,qid,choice,counted} の配列            │
// │             │ cscs_wrong_attempt_log_<日付>         │ 当日の全不正解ログ。同構造                                 │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 問題別累計 │ cscs_q_correct_total:{qid}           │ その問題が正解した延べ回数（正規ルートに統合。毎回 +1）     │
// │             │ cscs_q_wrong_total:{qid}             │ その問題が不正解した延べ回数（正規ルートに統合。毎回 +1）   │
// │             │ cscs_q_correct_counted_total:{qid}    │ “ユニーク採用”正解（同日初回の正解時 +1。日次と同期）        │
// │             │ cscs_q_wrong_counted_total:{qid}      │ “ユニーク採用”不正解（同日初回の不正解時 +1。日次と同期）    │
// │             │ cscs_q_correct_uncounted_total:{qid}  │ 同日2回目以降の正解（正規ルートに統合）                      │
// │             │ cscs_q_wrong_uncounted_total:{qid}    │ 同日2回目以降の不正解（正規ルートに統合）                    │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 不正解履歴 │ cscs_wrong_log                        │ {qid: 累積不正回数} の連想配列形式（軽量マップ）            │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 連続正解   │ cscs_correct_streak_len               │ 現在の連続正解数                                           │
// │             │ cscs_correct_streak3_total            │ 3連正解達成回数の累計                                     │
// │             │ cscs_correct_streak3_log              │ 3連正解達成履歴。{ts,qid,day,choice} の配列                │
// │             │ cscs_q_correct_streak_len:{qid}       │ その問題における現在の連続正解数                           │
// │             │ cscs_q_correct_streak3_total:{qid}    │ その問題における3連正解達成回数の累計                     │
// │             │ cscs_q_correct_streak3_log:{qid}      │ その問題で3連正解を達成した履歴。{ts,qid,day,choice} の配列 │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 実行メタ   │ cscs_current_runId_<日付>            │ その日の一意ランID（セッション識別用）                     │
// │             │ cscs_last_seen_day                   │ 直近に計測した日付（JST基準）                              │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 問題別累計 │ cscs_q_correct_total:{qid}           │ その問題が正解した延べ回数（全日通算。毎回 +1）             │
// │             │ cscs_q_wrong_total:{qid}             │ その問題が不正解した延べ回数（全日通算。毎回 +1）           │
// │             │ cscs_q_correct_counted_total:{qid}    │ “ユニーク採用”正解（同日に初回のみ +1）                     │
// │             │ cscs_q_wrong_counted_total:{qid}      │ “ユニーク採用”不正解（同日に初回のみ +1）                   │
// │             │ cscs_q_correct_uncounted_total:{qid}  │ 同日2回目以降の正解                                         │
// │             │ cscs_q_wrong_uncounted_total:{qid}    │ 同日2回目以降の不正解                                       │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
//
// ⚙️ カウント条件まとめ
// - A→B 正規遷移かつトークン存在時のみ有効
// - B直叩き／リロード時はノーカウント
// - その日初めての正解/不正解時 → *_done フラグを立てる + *_counted_total 加算
// - 同日2回目以降 → *_uncounted_total のみ加算
// - 正解: streak_len++、不正解: streak_len=0
// - 3連正解時に streak3_total +1、ログに記録
//
// 🕒 日付基準
// JST (UTC+9) の "YYYYMMDD" 文字列で集計
// 🆕 2025-11-12 更新
// ・各問題ごとの総正解数 / 総不正解数を個別キー（cscs_q_correct_total:QID, cscs_q_wrong_total:QID）として集計追加
// 🆕 2025-11-12 修正
// ・QID（例: 20250926-001）のハイフンを常に ASCII "-" に統一。
//   全角ハイフン混入による localStorage キー不一致を防止。
// 🆕 2025-11-13 正規化
// ・問題別集計（cscs_q_* 系）を日別・全体集計と同一フローに統合。
// ・これにより、各問題ごとの延べ試行・ユニーク試行も
//   日別・全体カウンタと同一ロジックで同期。
// ・正解抽出ロジックを本流 (b_judge.js) と完全統一。
//   → pickCorrectLetter() が ol.opts li.is-correct を最優先に参照。
//   → #judge（空 .answer）を除外して誤検出を防止。
//   → メタ情報 (#cscs-meta) およびテキスト抽出はフォールバック扱い。
// 🆕 2025-11-22 追加
// ・⭐️仕様「問題別 3 回連続正解で付与」を正式ルール化。
// ・問題別連続正解トラッキングキーを新設：
//     cscs_q_correct_streak_len:{qid}
//     cscs_q_correct_streak3_total:{qid}
//     cscs_q_correct_streak3_log:{qid}
// ・全体ストリーク（cscs_correct_streak_len 等）とは独立し、
//   各 qid 単位で連続正解を個別計測する方式に変更。
// 🆕 2025-11-24 更新
// ・A/Bパート間で「現在の問題別連続正解数（streakLen）」を
//   SYNC に正しく反映するため、正解処理（isCorrect=true）で
//   問題別ストリーク更新直後に
//     window.CSCS_SYNC.recordStreakLen()
//   を呼び出す実装を追加。
// ・これにより、1/3 → 2/3 → 3/3 の “3連続正解進捗” が
//   端末A ↔ 端末B をまたいでも正しく同期される仕様に拡張。
// ・streak3_total（3連達成回数）と streak3Delta に加え、
//   streakLenDelta（現在の連続正解数の差分）を
//   /api/sync/merge へ送信できるようになる。
// ・SYNC Worker 側の streakLen[qid] と UI（A/B）の
//   「(進捗 a/3) 表示」と整合するための必須改修。
// ===========================================================
// === END SPEC HEADER (keep synchronized with implementation) ===
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
        // 0) 本流と同じ方式：ol.opts li.is-correct から判定（最優先）
        try{
          var ol = document.querySelector('ol.opts');
          if (ol) {
            // A起点の並びを前提に、is-correct の li のインデックスから A/B/C/D を算出
            var lis = Array.prototype.slice.call(ol.querySelectorAll('li'));
            var idx = lis.findIndex(function(li){ return li.classList.contains('is-correct'); });
            if (idx >= 0) {
              var base = 65; // 'A'.charCodeAt(0)
              var letter = String.fromCharCode(base + idx);
              if (/^[ABCD]$/.test(letter)) return letter;
            }
          }
        }catch(_){}

        // 1) cscs-meta フォールバック
        try{
          var el = document.getElementById('cscs-meta');
          if(el){
            var meta = JSON.parse(el.textContent||"{}");
            var c = (meta.Correct||meta.correct||"").toString().trim().toUpperCase();
            if(/^[ABCD]$/.test(c)) return c;
          }
        }catch(_){}

        // 2) テキスト抽出フォールバック
        try{
          var t = "";
          var j = document.getElementById('judge');
          if(j) t += " " + (j.textContent||j.innerText||"");
          // 空の #judge.answer を避けるため、「#judge 以外の .answer」を優先
          var a = document.querySelector('.answer:not(#judge)');
          if(!a){ a = document.querySelector('.answer'); }
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
      // ⚙️ 2025-11-12 修正: QID のハイフンを常に ASCII "-" に統一（全角・異体字対策）
      var qid      = (dayPath + "-" + qnum).replace(/[^\x20-\x7E]/g, "-");  // 例 "20250926-001"

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
      //  3連正解:  現在の連続長 -> cscs_q_correct_streak_len
      //            3連達成回数合計 -> cscs_q_correct_streak3_total
      //            ログ -> cscs_q_correct_streak3_log (配列)

      if(isCorrect){
        // 今日の試行回数（正解：全体＋問題別総試行を正規フローに統合）
        incIntLS("cscs_correct_attempts_" + dayPlay, 1);
        incIntLS("cscs_q_correct_total:" + qid, 1);

        // その日の"正解"ユニーク消費状況
        var cFlag = "cscs_correct_done:" + dayPlay;
        var cDone = null; try{ cDone = localStorage.getItem(cFlag); }catch(_){}
        if(!cDone){
          // 全体：日数の累計＋今日のユニーク消費
          incIntLS("cscs_correct_days_total", 1);
          try{ localStorage.setItem(cFlag, "1"); }catch(_){}
          // 問題別："計測された"正解（正規フローに統合）
          incIntLS("cscs_q_correct_counted_total:" + qid, 1);
        }else{
          // 問題別："計測されない"正解（同日2回目以降や他問題で既に消費済み）
          incIntLS("cscs_q_correct_uncounted_total:" + qid, 1);
        }

        // ---- 3連正解ストリーク（全体＋問題別。非重複：3達成ごとに1加算、達成時に長さを0にリセット）----
        try{
          // 全体ストリーク
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

          // 問題別ストリーク
          var sKeyQ = "cscs_q_correct_streak_len:" + qid;
          var sLenQ = getIntLS(sKeyQ);
          sLenQ += 1;
          if(sLenQ >= 3){
            incIntLS("cscs_q_correct_streak3_total:" + qid, 1);
            var sLogKeyQ = "cscs_q_correct_streak3_log:" + qid;
            var sLogQ = []; try{ sLogQ = JSON.parse(localStorage.getItem(sLogKeyQ)||"[]"); }catch(_){ sLogQ = []; }
            sLogQ.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKeyQ, JSON.stringify(sLogQ));
            sLenQ = 0;
          }
          setIntLS(sKeyQ, sLenQ);

          if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreakLen === "function") {
            window.CSCS_SYNC.recordStreakLen();
          }
        }catch(_){}

        // ログ（day単位）※選択肢も保持
        try{
          var ck = "cscs_correct_attempt_log_" + dayPlay;
          var carr = []; try{ carr = JSON.parse(localStorage.getItem(ck)||"[]"); }catch(_){ carr = []; }
          carr.push({ ts: Date.now(), qid: qid, choice: choice, counted: (!cDone ? 1 : 0) });
          localStorage.setItem(ck, JSON.stringify(carr));
        }catch(_){}

        // （重複加算防止）問題別の総正解は incPerProblem("cscs_q_correct_total:", qid, 1) で既に加算済み
      }else{
        // 今日の試行回数（不正：全体＋問題別総試行を正規フローに統合）
        incIntLS("cscs_wrong_attempts_" + dayPlay, 1);
        incIntLS("cscs_q_wrong_total:" + qid, 1);

        // その日の"不正"ユニーク消費状況
        var wFlag = "cscs_wrong_done:" + dayPlay;
        var wDone = null; try{ wDone = localStorage.getItem(wFlag); }catch(_){}
        if(!wDone){
          // 全体：日数の累計＋今日のユニーク消費
          incIntLS("cscs_wrong_days_total", 1);
          try{ localStorage.setItem(wFlag, "1"); }catch(_){}
          // 問題別："計測された"不正（正規フローに統合）
          incIntLS("cscs_q_wrong_counted_total:" + qid, 1);
        }else{
          // 問題別："計測されない"不正
          incIntLS("cscs_q_wrong_uncounted_total:" + qid, 1);
        }

        // 不正解が出たらストリークはリセット
        try{
          setIntLS("cscs_correct_streak_len", 0);
          setIntLS("cscs_q_correct_streak_len:" + qid, 0);
        }catch(_){}

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

        // （重複加算防止）問題別の総不正解は incPerProblem("cscs_q_wrong_total:", qid, 1) で既に加算済み
      }
    })();
})();