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
 * 最終更新: 2025-12-09
 *
 * === SPEC CONTENT ===
 */
// assets/b_judge_record.js
// -------------------------------------------
// Bパート：正誤判定＋日替わり集計＋問題別3連正解／3連不正解トラッキング
// JST対応・問題別総試行／計測済み／未計測・問題別連続正解／連続不正解＋1日1回制限用結果マップ付き
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
// │ 連続不正解 │ cscs_wrong_streak_len                 │ 現在の連続不正解数                                         │
// │             │ cscs_wrong_streak3_total              │ 3連不正解達成回数の累計                                   │
// │             │ cscc_wrong_streak3_log                │ 3連不正解達成履歴。{ts,qid,day,choice} の配列              │
// │             │ cscs_q_wrong_streak_len:{qid}         │ その問題における現在の連続不正解数                         │
// │             │ cscs_q_wrong_streak3_total:{qid}      │ その問題における3連不正解達成回数の累計                   │
// │             │ cscs_q_wrong_streak3_log:{qid}        │ その問題で3連不正解を達成した履歴。{ts,qid,day,choice} の配列 │
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
// │ 一日一回系 │ cscs_once_per_day_today_day       │ JST YYYYMMDD。b_judge_record.js が管理する「1日1回」用の当日識別子。 │
// │             │ cscs_once_per_day_today_results   │ {qid: "correct"/"wrong"}。当日中に一度でも計測対象となった問題と最終結果。│
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ SYNC連携   │ (SYNC) oncePerDayToday           │ /api/sync/state で返すサーバ状態。{ day, results }。local の once_per_day 系を同期。│
// │             │ (SYNC) oncePerDayToday.day       │ JST YYYYMMDD（数値）。当日以外の場合は別日の状態として扱う。                     │
// │             │ (SYNC) oncePerDayToday.results   │ {qid: "correct"/"wrong"}。その日、その qid が計測済みであることを示す。         │
// │             │ (SYNC) oncePerDayTodayDelta      │ /api/sync/merge に送る差分。{ day, results } の部分更新専用。                  │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ グローバル │ cscs_total_questions              │ CSCS問題集全体の総問題数。manifest.json の days.length × 30 を唯一のソースとして算出。 │
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
//   SYNC に正しく反映するため、正解処理（isCorrect=true）と
//   不正解処理（isCorrect=false）の両方で、問題別ストリーク更新直後に
//     window.CSCS_SYNC.recordStreakLen()
//   を呼び出す実装を追加。
// ・これにより、1/3 → 2/3 → 3/3 の “3連続正解進捗” や
//   不正解による 0/3 リセットが、端末A ↔ 端末B をまたいでも
//   正しく同期される仕様に拡張。
// ・streak3_total（3連達成回数）と streak3Delta に加え、
//   streakLenDelta（現在の連続正解数の差分）を
//   /api/sync/merge へ送信できるようになる。
// ・SYNC Worker 側の streakLen[qid] と UI（A/B）の
//   「(進捗 a/3) 表示」と整合するための必須改修。
// ・streakLen 更新直後に UI 連動用 CustomEvent
//     window.dispatchEvent(new CustomEvent("cscs-sync-updated"))
//   を発火し、ナビリスト等から SYNC 状態の再読込をトリガーできるようにした。
// 🆕 2025-11-30 追加
// ・「今日、新規に⭐️を獲得した問題数（0→1となった qid の個数）」を計測。
// ・対象は、問題別3連正解回数 cscs_q_correct_streak3_total:{qid} が 0→1 となる瞬間のみ。
// ・JSTの日付ごとに、localStorage 上で以下のキーを管理：
//     cscs_streak3_today_day
//     cscs_streak3_today_qids
//     cscs_streak3_today_unique_count
// ・値は CSCS_SYNC.recordStreak3TodayUnique() を通じて /api/sync/merge の streak3Today に同期し、
//   「今日⭐️を新規獲得したユニーク問題数」の進捗として利用する。
// 🆕 2025-12-02 追加
// ・「1問題につき,1日1回のみ計測モード」で使用する当日結果マップを b_judge_record.js で一元管理。
// ・JSTの日付ごとに、localStorage 上で以下のキーを管理：
//     cscs_once_per_day_today_day        … 当日の JST YYYYMMDD 文字列。
//     cscs_once_per_day_today_results    … {qid: "correct" | "wrong"} 形式のマップ。
// ・Bパートで正誤判定が確定したタイミングで、該当 qid の結果を上記マップに反映する。
// ・このマップをもとに、Aパートや SYNC は「当日すでに計測済みかどうか」を判定できる。
// ・SYNC Worker 側とは、/api/sync/state の oncePerDayToday（{ day: number, results: {qid: "correct"|"wrong"} }）
//   および /api/sync/merge の oncePerDayTodayDelta（同構造の差分）を通じて連携する。
// 🆕 2025-12-05 追加
// ・CSCS問題集全体の総問題数を「cscs_total_questions」として localStorage に一元管理する。
// ・総問題数は manifest.json の days.length × 30 を唯一のソースとし、b_judge_record.js 起動時に必要に応じて計算・保存する。
// ・他ファイルや SYNC Worker は、このキーを参照して「全体の分母」として利用し、フォールバック値や別ソースは持たない。
// 🆕 2025-12-08 追加
// ・連続不正解トラッキング機能を追加（正解ストリークと同一方式で「3連続で1カウント」する非重複カウント）。
// ・全体用キー: cscs_wrong_streak_len / cscs_wrong_streak3_total / cscs_wrong_streak3_log。
// ・問題別キー: cscs_q_wrong_streak_len:{qid} / cscs_q_wrong_streak3_total:{qid} / cscs_q_wrong_streak3_log:{qid}。
// ・正解が出たタイミングで不正解ストリークをリセットし、不正解が出たタイミングで正解ストリークをリセットする対称設計とする。
// 🆕 2025-12-09 追加
// ・「今日、新規に💣（3連続不正解）を達成した問題数（ユニーク qid 数）」を計測。
// ・対象は、問題別3連不正解回数 cscs_q_wrong_streak3_total:{qid} が 2→3 となる瞬間ごとに、同一日内で一度だけカウントする。
// ・JST の各日について、localStorage 上で以下のキーを管理：
//     cscs_streak3_wrong_today_day
//     cscs_streak3_wrong_today_qids
//     cscs_streak3_wrong_today_unique_count
// ・cscs_streak3_wrong_today_qids には、その日に 3連続不正解を初めて達成した qid をユニークに追加し、
//   cscs_streak3_wrong_today_unique_count には配列長と整合する値を保持する。
// ・CSCS_SYNC.recordStreak3WrongTodayUnique() を通じて /api/sync/merge の streak3WrongTodayDelta に反映し、
//   サーバ側 state.streak3WrongToday（{ day, qids }）と HUD 側の「今日の3連続不正解ユニーク数」表示に利用する。
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

      // ★ 追加: 総問題数（cscs_total_questions）を manifest.json から一度だけ計算して保存
      function cscsEnsureTotalQuestions(){
        var LS_KEY = "cscs_total_questions";

        // すでに有効な値があれば何もしない
        try{
          var raw = localStorage.getItem(LS_KEY);
          if(raw !== null && raw !== undefined){
            var n = parseInt(raw, 10);
            if(Number.isFinite(n) && n > 0){
              return;
            }
          }
        }catch(_){}

        // manifest.json を唯一のソースとして days.length × 30 を計算
        try{
          fetch("/manifest.json", { cache: "no-store" })
            .then(function(res){
              if(!res || !res.ok){
                try{
                  console.log("[B:totalQ] manifest fetch failed", {
                    status: res ? res.status : "no-response"
                  });
                }catch(_){}
                return null;
              }
              return res.json();
            })
            .then(function(json){
              if(!json || !Array.isArray(json.days)){
                try{
                  console.log("[B:totalQ] manifest.json invalid structure", {
                    json: json
                  });
                }catch(_){}
                return;
              }
              var total = json.days.length * 30;
              if(!Number.isFinite(total) || total <= 0){
                try{
                  console.log("[B:totalQ] computed invalid total", {
                    total: total
                  });
                }catch(_){}
                return;
              }
              try{
                localStorage.setItem(LS_KEY, String(total));
              }catch(_){}
              try{
                console.log("[B:totalQ] cscs_total_questions set", {
                  total: total
                });
              }catch(_){}
            })
            .catch(function(err){
              try{
                console.log("[B:totalQ] manifest fetch error", {
                  error: String(err)
                });
              }catch(_){}
            });
        }catch(_){}
      }

      // ★ 追加: 「1日1回計測モード」用の当日結果マップを管理
      //   - dayPlay: JST YYYYMMDD（文字列）
      //   - qid: "YYYYMMDD-NNN"
      //   - isCorrect: true なら "correct"、false なら "wrong" として記録
      function updateOncePerDayMap(dayPlay, qid, isCorrect){
        var onceDayKey = "cscs_once_per_day_today_day";
        var onceMapKey = "cscs_once_per_day_today_results";

        var storedDay = null;
        try{
          storedDay = localStorage.getItem(onceDayKey);
        }catch(_){
          storedDay = null;
        }

        if(storedDay !== dayPlay){
          try{
            localStorage.setItem(onceDayKey, dayPlay);
          }catch(_){}
          try{
            localStorage.setItem(onceMapKey, "{}");
          }catch(_){}
          try{
            console.log("[B:oncePerDay] RESET DAY", {
              prevDay: storedDay,
              newDay: dayPlay
            });
          }catch(_){}
        }

        var map = {};
        try{
          map = JSON.parse(localStorage.getItem(onceMapKey) || "{}");
        }catch(_){
          map = {};
        }
        if(!map || typeof map !== "object"){
          map = {};
        }

        var result = isCorrect ? "correct" : "wrong";
        map[qid] = result;

        try{
          localStorage.setItem(onceMapKey, JSON.stringify(map));
        }catch(_){}

        try{
          console.log("[B:oncePerDay] UPDATED", {
            day: dayPlay,
            qid: qid,
            result: result,
            mapSnapshot: map
          });
        }catch(_){}
      }

      // ---- 本体 ----
      var dayPath  = getDayFromPath();           // 例 "20250926"（qid用・後方互換）
      var dayPlay  = getTodayYYYYMMDD_JST();     // 例 "20251110"（JSTの実プレイ日ベース）
      var qnum     = getQNumFromPath();          // 例 "001"
      // ⚙️ 2025-11-12 修正: QID のハイフンを常に ASCII "-" に統一（全角・異体字対策）
      var qid      = (dayPath + "-" + qnum).replace(/[^\x20-\x7E]/g, "-");  // 例 "20250926-001"

      // 総問題数（cscs_total_questions）の計算・保存を一度だけトリガー
      try{
        cscsEnsureTotalQuestions();
      }catch(_){}

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

      // ★ 追加ガード: O.D.O.A = on_nocount のときは b_judge_record.js 側の計測を完全停止する
      // ★ さらに、自動検証モード（CSCS_VERIFY_MODE === "on"）中も b_judge_record.js の計測を完全停止する
      var skipCountingForOdoa = false;    // SYNC 側の ODOA モード on_nocount 用
      var skipCountingForVerify = false;  // 自動検証モード（A→B 自動遷移／計測なし）用

      (function(){
        var state = null;
        try{
          state = (typeof window !== "undefined" && window.__cscs_sync_state) ? window.__cscs_sync_state : null;
        }catch(_e){
          state = null;
        }

        var rawMode = null;
        if(state){
          if(typeof state.odoaMode === "string"){
            rawMode = state.odoaMode;
          }else if(typeof state.odoa_mode === "string"){
            rawMode = state.odoa_mode;
          }
        }

        // ガード判定前の状態をログに残す（デバッグ用）
        console.log("[B:judge] ODOA check before counting", {
          qid: qid,
          dayPlay: dayPlay,
          rawMode: rawMode
        });

        // Workers 側で on_nocount が指定されている場合のみ、以降の計測処理を完全停止
        if(rawMode === "on_nocount"){
          skipCountingForOdoa = true;
          console.log("[B:judge] O.D.O.A = on_nocount → mark skip ALL counting for", {
            qid: qid,
            dayPlay: dayPlay,
            isCorrect: isCorrect
          });
        }
      })();

      // ★ 追加: 自動検証モード（A→B 自動遷移／計測なし）のときは b_judge_record.js 側での計測を完全停止する
      (function(){
        var verifyMode = null;
        try{
          if (typeof window !== "undefined" && typeof window.CSCS_VERIFY_MODE === "string") {
            verifyMode = window.CSCS_VERIFY_MODE;
          }
        }catch(_e){
          verifyMode = null;
        }

        // 自動検証モードの状態をログに残す（デバッグ用）
        console.log("[B:judge] VerifyMode check before counting", {
          qid: qid,
          dayPlay: dayPlay,
          verifyMode: verifyMode
        });

        // CSCS_VERIFY_MODE が "on" の場合、この問題の oncePerDay / attempts / streak / ⭐️ / ログ をすべてスキップ
        if(verifyMode === "on"){
          skipCountingForVerify = true;
          console.log("[B:judge] VerifyMode = on → mark skip ALL counting for", {
            qid: qid,
            dayPlay: dayPlay,
            isCorrect: isCorrect
          });
        }
      })();

      // on_nocount または 自動検証モード のときは、oncePerDay / attempts / streak / ⭐️ / ログ をすべてスキップして終了
      if(skipCountingForOdoa || skipCountingForVerify){
        console.log("[B:judge] SKIP ALL counting by guard", {
          qid: qid,
          dayPlay: dayPlay,
          skipByOdoaOnNoCount: skipCountingForOdoa,
          skipByVerifyMode: skipCountingForVerify
        });
        return;
      }

      // ★ 「1日1回計測モード」用: 正誤が確定したタイミングで当日マップを更新
      try{
        if(dayPlay && dayPlay !== "unknown" && qid && qid !== "unknown"){
          updateOncePerDayMap(dayPlay, qid, isCorrect);
          console.log("[B:oncePerDay] UPDATED via b_judge_record.js", {
            dayPlay: dayPlay,
            qid: qid,
            isCorrect: isCorrect
          });
        }else{
          console.log("[B:oncePerDay] SKIP (invalid dayPlay or qid)", {
            dayPlay: dayPlay,
            qid: qid,
            isCorrect: isCorrect
          });
        }
      }catch(_e){
        console.error("[B:oncePerDay] ERROR while updating oncePerDay map", _e);
      }
      
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
          // 全体ストリーク（debug 付き）
          var sLen = getIntLS("cscs_correct_streak_len");
          var beforeGlobalStreak3Total = getIntLS("cscs_correct_streak3_total");
          console.log("[B:streak3/global] BEFORE", {
            qid: qid,
            day: dayPlay,
            streak_len: sLen,
            streak3_total: beforeGlobalStreak3Total
          });

          sLen += 1;
          if(sLen >= 3){
            incIntLS("cscs_correct_streak3_total", 1);

            var afterGlobalStreak3Total = getIntLS("cscs_correct_streak3_total");
            console.log("[B:streak3/global] HIT 3連正解", {
              qid: qid,
              day: dayPlay,
              streak3_total_before: beforeGlobalStreak3Total,
              streak3_total_after: afterGlobalStreak3Total
            });

            // ログ（いつ/どの問題で3連目に到達したか）
            var sLogKey = "cscs_correct_streak3_log";
            var sLog = []; try{ sLog = JSON.parse(localStorage.getItem(sLogKey)||"[]"); }catch(_){ sLog = []; }
            sLog.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKey, JSON.stringify(sLog));
            // 非重複とするためリセット（オーバーラップ不要の場合）
            sLen = 0;
          }
          setIntLS("cscs_correct_streak_len", sLen);
          console.log("[B:streak3/global] AFTER", {
            qid: qid,
            day: dayPlay,
            streak_len: sLen,
            streak3_total: getIntLS("cscs_correct_streak3_total")
          });

          // 問題別ストリーク（debug 付き）
          var sKeyQ = "cscs_q_correct_streak_len:" + qid;
          var sLenQ = getIntLS(sKeyQ);
          var streak3KeyQ = "cscs_q_correct_streak3_total:" + qid;
          var beforeStreak3TotalQ = getIntLS(streak3KeyQ);

          console.log("[B:streak3/q] BEFORE", {
            qid: qid,
            day: dayPlay,
            streak_len_q: sLenQ,
            streak3_total_q: beforeStreak3TotalQ
          });

          sLenQ += 1;
          if(sLenQ >= 3){
            incIntLS(streak3KeyQ, 1);

            var afterStreak3TotalQ = getIntLS(streak3KeyQ);
            console.log("[B:streak3/q] HIT 3連正解", {
              qid: qid,
              day: dayPlay,
              streak_len_q_before: sLenQ,
              streak3_total_q_before: beforeStreak3TotalQ,
              streak3_total_q_after: afterStreak3TotalQ
            });

            var sLogKeyQ = "cscs_q_correct_streak3_log:" + qid;
            var sLogQ = []; try{ sLogQ = JSON.parse(localStorage.getItem(sLogKeyQ)||"[]"); }catch(_){ sLogQ = []; }
            sLogQ.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKeyQ, JSON.stringify(sLogQ));

            // ⭐️0→1 になった問題だけ「今日の新規⭐️」としてカウント
            if(beforeStreak3TotalQ === 0){
              var todayDayKey = "cscs_streak3_today_day";
              var todayQidsKey = "cscs_streak3_today_qids";
              var todayCountKey = "cscs_streak3_today_unique_count";

              var storedDay = null;
              try{ storedDay = localStorage.getItem(todayDayKey); }catch(_){}

              // 日付が変わっていたら、その日の集計としてリセット
              if(storedDay !== dayPlay){
                try{ localStorage.setItem(todayDayKey, dayPlay); }catch(_){}
                try{ localStorage.removeItem(todayQidsKey); }catch(_){}
                try{ localStorage.setItem(todayCountKey, "0"); }catch(_){}
              }

              var todayQids = [];
              try{ todayQids = JSON.parse(localStorage.getItem(todayQidsKey)||"[]"); }catch(_){ todayQids = []; }
              if(!Array.isArray(todayQids)){ todayQids = []; }

              if(todayQids.indexOf(qid) === -1){
                todayQids.push(qid);
                try{ localStorage.setItem(todayQidsKey, JSON.stringify(todayQids)); }catch(_){}
                incIntLS(todayCountKey, 1);
              }

              var todayCountVal = 0;
              try{
                todayCountVal = parseInt(localStorage.getItem(todayCountKey)||"0",10);
                if(!Number.isFinite(todayCountVal)) todayCountVal = 0;
              }catch(_){ todayCountVal = 0; }

              console.log("[B:streak3/q] TODAY UNIQUE STAR +1", {
                day: dayPlay,
                qid: qid,
                today_day: localStorage.getItem(todayDayKey),
                today_qids: todayQids,
                today_count: todayCountVal
              });

              if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3TodayUnique === "function") {
                window.CSCS_SYNC.recordStreak3TodayUnique();
              }
            }

            sLenQ = 0;
          }
          setIntLS(sKeyQ, sLenQ);

          console.log("[B:streak3/q] AFTER", {
            qid: qid,
            day: dayPlay,
            streak_len_q: sLenQ,
            streak3_total_q: getIntLS(streak3KeyQ)
          });

          if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreakLen === "function") {
            window.CSCS_SYNC.recordStreakLen();
          }
          try{
            window.dispatchEvent(new CustomEvent("cscs-sync-updated"));
          }catch(_){}
        }catch(_){}

        // ★ 追加: 正解が出たタイミングで「連続不正解ストリーク」をリセット
        //   - cscs_wrong_streak_len / cscs_q_wrong_streak_len:{qid} を 0 に戻す
        //   - コンソールログでリセット前後の値を確認できるようにする
        try{
          var beforeWrongStreakGlobal = getIntLS("cscs_wrong_streak_len");
          var beforeWrongStreakQ = getIntLS("cscs_q_wrong_streak_len:" + qid);

          setIntLS("cscs_wrong_streak_len", 0);
          setIntLS("cscs_q_wrong_streak_len:" + qid, 0);

          console.log("[B:streak3_wrong/reset_on_correct] RESET wrong streak by correct answer", {
            qid: qid,
            day: dayPlay,
            wrong_streak_global_before: beforeWrongStreakGlobal,
            wrong_streak_q_before: beforeWrongStreakQ,
            wrong_streak_global_after: getIntLS("cscs_wrong_streak_len"),
            wrong_streak_q_after: getIntLS("cscs_q_wrong_streak_len:" + qid)
          });
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

        // ★ 追加: 3連不正解ストリーク（全体＋問題別。正解ストリークと対称の非重複カウント）
        //   - cscs_wrong_streak_len / cscs_wrong_streak3_total / cscs_wrong_streak3_log
        //   - cscs_q_wrong_streak_len:{qid} / cscs_q_wrong_streak3_total:{qid} / cscs_q_wrong_streak3_log:{qid}
        //   - 3回連続不正解ごとに +1 し、達成時にストリーク長を 0 にリセットする
        try{
          // 全体ストリーク（debug 付き）
          var wLen = getIntLS("cscs_wrong_streak_len");
          var beforeGlobalWrongStreak3Total = getIntLS("cscs_wrong_streak3_total");

          console.log("[B:streak3_wrong/global] BEFORE", {
            qid: qid,
            day: dayPlay,
            wrong_streak_len: wLen,
            wrong_streak3_total: beforeGlobalWrongStreak3Total
          });

          wLen += 1;
          if(wLen >= 3){
            incIntLS("cscs_wrong_streak3_total", 1);

            var afterGlobalWrongStreak3Total = getIntLS("cscs_wrong_streak3_total");
            console.log("[B:streak3_wrong/global] HIT 3連不正解", {
              qid: qid,
              day: dayPlay,
              wrong_streak3_total_before: beforeGlobalWrongStreak3Total,
              wrong_streak3_total_after: afterGlobalWrongStreak3Total
            });

            var wLogKey = "cscs_wrong_streak3_log";
            var wLog = []; try{ wLog = JSON.parse(localStorage.getItem(wLogKey)||"[]"); }catch(_){ wLog = []; }
            wLog.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(wLogKey, JSON.stringify(wLog));

            // 非重複カウントとするため 3連達成時にストリーク長をリセット
            wLen = 0;
          }
          setIntLS("cscs_wrong_streak_len", wLen);

          console.log("[B:streak3_wrong/global] AFTER", {
            qid: qid,
            day: dayPlay,
            wrong_streak_len: wLen,
            wrong_streak3_total: getIntLS("cscs_wrong_streak3_total")
          });

          // 問題別ストリーク（debug 付き）
          var wKeyQ = "cscs_q_wrong_streak_len:" + qid;
          var wLenQ = getIntLS(wKeyQ);
          var wrongStreak3KeyQ = "cscs_q_wrong_streak3_total:" + qid;
          var beforeWrongStreak3TotalQ = getIntLS(wrongStreak3KeyQ);

          console.log("[B:streak3_wrong/q] BEFORE", {
            qid: qid,
            day: dayPlay,
            wrong_streak_len_q: wLenQ,
            wrong_streak3_total_q: beforeWrongStreak3TotalQ
          });

          wLenQ += 1;
          if(wLenQ >= 3){
            incIntLS(wrongStreak3KeyQ, 1);

            var afterWrongStreak3TotalQ = getIntLS(wrongStreak3KeyQ);
            console.log("[B:streak3_wrong/q] HIT 3連不正解", {
              qid: qid,
              day: dayPlay,
              wrong_streak_len_q_before: wLenQ,
              wrong_streak3_total_q_before: beforeWrongStreak3TotalQ,
              wrong_streak3_total_q_after: afterWrongStreak3TotalQ
            });

            // 3連続不正解を達成した履歴を問題別ログに追加する
            var wLogKeyQ = "cscs_q_wrong_streak3_log:" + qid;
            var wLogQ = []; try{ wLogQ = JSON.parse(localStorage.getItem(wLogKeyQ)||"[]"); }catch(_){ wLogQ = []; }
            wLogQ.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(wLogKeyQ, JSON.stringify(wLogQ));

            // ★ 追加: 「今日新しく3連続不正解を達成した問題」を日別ユニークとして記録する
            //   - JST dayPlay 単位で、初めて3連続不正解になった qid を配列に積む
            //   - HUD / SYNC 側の streak3WrongToday（今日の💣ユニーク数）と連携するためのローカル集計
            try{
              var wrongTodayDayKey   = "cscs_streak3_wrong_today_day";
              var wrongTodayQidsKey  = "cscs_streak3_wrong_today_qids";
              var wrongTodayCountKey = "cscs_streak3_wrong_today_unique_count";

              // 日付が変わっていたら、その日の集計として day / qids / count をリセットする
              var storedWrongTodayDay = null;
              try{ storedWrongTodayDay = localStorage.getItem(wrongTodayDayKey); }catch(_){}
              if(storedWrongTodayDay !== dayPlay){
                try{ localStorage.setItem(wrongTodayDayKey, dayPlay); }catch(_){}
                try{ localStorage.removeItem(wrongTodayQidsKey); }catch(_){}
                try{ localStorage.setItem(wrongTodayCountKey, "0"); }catch(_){}
              }

              // その日の「3連続不正解を初めて達成した qid 配列」を取得する
              var wrongTodayQids = [];
              try{ wrongTodayQids = JSON.parse(localStorage.getItem(wrongTodayQidsKey) || "[]"); }catch(_){ wrongTodayQids = []; }
              if(!Array.isArray(wrongTodayQids)){ wrongTodayQids = []; }

              // まだ登録されていない qid なら配列に追加し、ユニークカウンタを +1 する
              if(wrongTodayQids.indexOf(qid) === -1){
                wrongTodayQids.push(qid);
                try{ localStorage.setItem(wrongTodayQidsKey, JSON.stringify(wrongTodayQids)); }catch(_){}
                incIntLS(wrongTodayCountKey, 1);
              }

              // デバッグ用に「今日の💣ユニーク集計」のスナップショットを出す
              var wrongTodayCountVal = 0;
              try{
                wrongTodayCountVal = parseInt(localStorage.getItem(wrongTodayCountKey) || "0", 10);
                if(!Number.isFinite(wrongTodayCountVal)) wrongTodayCountVal = 0;
              }catch(_){ wrongTodayCountVal = 0; }

              console.log("[B:streak3_wrong/q] TODAY UNIQUE WRONG +1", {
                day: dayPlay,
                qid: qid,
                today_day: localStorage.getItem(wrongTodayDayKey),
                today_qids: wrongTodayQids,
                today_count: wrongTodayCountVal
              });

              // SYNC 側に「今日の3連続不正解ユニーク」を送るトリガーを投げる
              if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3WrongTodayUnique === "function") {
                window.CSCS_SYNC.recordStreak3WrongTodayUnique();
              }
            }catch(_){}

            // 非重複カウントとするため 3連達成時にストリーク長をリセット
            wLenQ = 0;
          }
          setIntLS(wKeyQ, wLenQ);

          console.log("[B:streak3_wrong/q] AFTER", {
            qid: qid,
            day: dayPlay,
            wrong_streak_len_q: wLenQ,
            wrong_streak3_total_q: getIntLS(wrongStreak3KeyQ)
          });
        }catch(_){}

        // 不正解が出たら正解ストリークはリセット
        //   - cscs_correct_streak_len / cscs_q_correct_streak_len:{qid} を 0 に戻す
        //   - SYNC 側の streakLen 更新と連動させる
        try{
          setIntLS("cscs_correct_streak_len", 0);
          setIntLS("cscs_q_correct_streak_len:" + qid, 0);
          if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreakLen === "function") {
            window.CSCS_SYNC.recordStreakLen();
          }
          try{
            window.dispatchEvent(new CustomEvent("cscs-sync-updated"));
          }catch(_){}
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