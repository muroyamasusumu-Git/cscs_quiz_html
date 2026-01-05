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
 * 最終更新: 2026-01-01
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
// │             │ cscs_q_correct_streak_max:{qid}       │ その問題における最高連続正解数（過去最高を更新した瞬間に保存） │
// │             │ cscs_q_correct_streak_max_day:{qid}   │ 上記「最高連続正解数」を最後に更新した達成日（JST YYYYMMDD）   │
// │             │ cscs_q_correct_streak3_total:{qid}    │ その問題における3連正解達成回数の累計                     │
// │             │ cscs_q_correct_streak3_log:{qid}      │ その問題で3連正解を達成した履歴。{ts,qid,day,choice} の配列 │
// ├────────────┼───────────────────────────────┼───────────────────────────────────────────────────────┤
// │ 連続不正解 │ cscs_wrong_streak_len                 │ 現在の連続不正解数                                         │
// │             │ cscs_wrong_streak3_total              │ 3連不正解達成回数の累計                                   │
// │             │ cscs_wrong_streak3_log                │ 3連不正解達成履歴。{ts,qid,day,choice} の配列              │
// │             │ cscs_q_wrong_streak_len:{qid}         │ その問題における現在の連続不正解数                         │
// │             │ cscs_q_wrong_streak_max:{qid}         │ その問題における最高連続不正解数（過去最高を更新した瞬間に保存） │
// │             │ cscs_q_wrong_streak_max_day:{qid}     │ 上記「最高連続不正解数」を最後に更新した達成日（JST YYYYMMDD）   │
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
// │ 問題別最終日│ cscs_q_last_seen_day:{qid}           │ その問題を最後に解いたJST日付（YYYYMMDD）。正誤を問わず更新。     │
// │             │ cscs_q_last_correct_day:{qid}         │ その問題で最後に正解したJST日付（YYYYMMDD）。正解時のみ更新。     │
// │             │ cscs_q_last_wrong_day:{qid}           │ その問題で最後に不正解となったJST日付（YYYYMMDD）。不正解時のみ更新。│
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
// - 正解: streak_len++、不正解: streak_len=0（反対結果で 0 にリセット）
// - 3連正解/3連不正解のカウントは「3,6,9...」到達ごとに +1（非重複カウント）
// - 重要: streak_len（全体/問題別）は 3 到達でリセットせず伸ばし続ける（連続回数の実数）
// - streak_max / streak_max_day（問題別）は、この「リセットなしの streak_len」と整合する方式で更新する
//   - 現ストリークが過去最高を上回った瞬間にのみ streak_max を更新
//   - streak_max_day は達成日（JST YYYYMMDD）を number として保存（localStorage 上は数値文字列）
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
// ・各問題ごとの「最終学習日」「最終正解日」「最終不正解日」を記録する per-problem 日付情報を追加。
// ・localStorage 上で以下のキーを管理：
//     cscs_q_last_seen_day:{qid}      … その問題を最後に解いたJST日付（YYYYMMDD）。正誤を問わず毎回更新。
//     cscs_q_last_correct_day:{qid}   … その問題で最後に正解したJST日付（YYYYMMDD）。正解時のみ更新。
//     cscs_q_last_wrong_day:{qid}     … その問題で最後に不正解となったJST日付（YYYYMMDD）。不正解時のみ更新。
// ・値はすべて dayPlay（実際にプレイしたJST "YYYYMMDD"）を保存する。
// ・HUD や field_summary.js などから「最終記録日」「最終正解日／最終不正解日」を表示・集計する際の唯一のソースとする。
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
// 🆕 2025-12-20 追加
// ・各問題ごとの「最高連続正解数」と「その達成日（JST YYYYMMDD）」を記録する per-problem ストリーク最大値情報を追加。
// ・localStorage 上で以下のキーを管理：
//     cscs_q_correct_streak_max:{qid}       … その問題の最高連続正解数（現ストリークが過去最高を上回った瞬間に更新）。
//     cscs_q_correct_streak_max_day:{qid}   … 上記の最高連続正解数を最後に更新した達成日（JST YYYYMMDD）。
// ・注意：問題別の現ストリーク cscs_q_correct_streak_len:{qid} は「3到達で0にリセットする非重複カウント方式」だが、
//   最高値はリセット前の値（例: 3）を確実に記録するため、ストリーク加算直後に最大値更新判定を行う。
// 🆕 2025-12-20 追加
// ・各問題ごとの「最高連続不正解数」と「その達成日（JST YYYYMMDD）」を記録する per-problem ストリーク最大値情報を追加。
// ・localStorage 上で以下のキーを管理：
//     cscs_q_wrong_streak_max:{qid}         … その問題の最高連続不正解数（現ストリークが過去最高を上回った瞬間に更新）。
//     cscs_q_wrong_streak_max_day:{qid}     … 上記の最高連続不正解数を最後に更新した達成日（JST YYYYMMDD）。
// ・注意：問題別の現ストリーク cscs_q_wrong_streak_len:{qid} は「3到達で0にリセットする非重複カウント方式」だが、
//   最高値はリセット前の値（例: 3）を確実に記録するため、ストリーク加算直後に最大値更新判定を行う。
// 🆕 2026-01-01 更新
// ・ストリーク長（streak_len / cscs_q_*_streak_len:{qid}）の扱いを「3到達でリセットしない（連続回数として伸ばし続ける）」方式に統一。
// ・反対結果が出た場合のみ、該当ストリーク長を 0 にリセットする（既存のリセット処理を活かす）。
// ・3連達成回数（streak3_total / cscs_q_*_streak3_total:{qid}）は「3,6,9...」到達ごとに +1 の非重複カウントを維持。
// ・最高値（cscs_q_correct_streak_max:{qid} / cscs_q_wrong_streak_max:{qid}）と達成日（*_streak_max_day:{qid}）は、
//   「リセットなしで伸び続ける streak_len」と整合するロジックで更新（過去最高を上回った瞬間のみ更新）。
// ・*_streak_max_day:{qid} は JST YYYYMMDD を number として保存（localStorage 上は数値文字列、例: "20251231"）。
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

      // ★ 追加: 問題別の「最終日」情報を更新するヘルパー
      //   - dayPlay: JST YYYYMMDD（文字列）。実際にプレイした日付。
      //   - qid    : "YYYYMMDD-NNN" 形式の問題ID。
      //   - isCorrect: true なら「最終正解日」を更新、false なら「最終不正解日」を更新する。
      //   - 共通して「最終学習日（last_seen）」は正誤に関係なく毎回 dayPlay で上書きする。
      function updatePerProblemLastDay(dayPlay, qid, isCorrect){
        // dayPlay / qid が不明な場合は何もしない
        if(!dayPlay || dayPlay === "unknown"){ return; }
        if(!qid || qid === "unknown"){ return; }

        try{
          // 最終学習日（その問題を最後に解いた日）は、正誤を問わず常に dayPlay で上書きする
          var keyLastSeen = "cscs_q_last_seen_day:" + qid;
          localStorage.setItem(keyLastSeen, String(dayPlay));
        }catch(_){}

        // 正解・不正解に応じて、最終正解日／最終不正解日を更新する
        try{
          if(isCorrect){
            // 最終正解日: その問題で最後に正解したJST日付（YYYYMMDD）
            var keyLastCorrect = "cscs_q_last_correct_day:" + qid;
            localStorage.setItem(keyLastCorrect, String(dayPlay));
          }else{
            // 最終不正解日: その問題で最後に不正解だったJST日付（YYYYMMDD）
            var keyLastWrong = "cscs_q_last_wrong_day:" + qid;
            localStorage.setItem(keyLastWrong, String(dayPlay));
          }
        }catch(_){}
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

      // ★ 追加: 正誤が確定し、計測を行うことが決まったタイミングで
      //   問題別の「最終学習日」「最終正解日／最終不正解日」を更新する。
      //   - dayPlay: 実際のプレイ日（JST YYYYMMDD）
      //   - qid    : 問題ID
      //   - isCorrect: 正解なら最終正解日、不正解なら最終不正解日を更新
      try{
        updatePerProblemLastDay(dayPlay, qid, isCorrect);
        console.log("[B:lastDay] UPDATED last_seen / last_correct / last_wrong", {
          dayPlay: dayPlay,
          qid: qid,
          isCorrect: isCorrect
        });
      }catch(_e){
        console.error("[B:lastDay] ERROR while updating per-problem last day info", _e);
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

          // 1) 正解のたびに「全体の連続正解数」を +1 する
          sLen += 1;

          // 2) 3連到達は「3,6,9...」のタイミングでのみカウント（非重複のまま）
          //    ※ streak_len 自体はリセットせず、連続回数として伸ばし続ける
          if((sLen % 3) === 0){
            incIntLS("cscs_correct_streak3_total", 1);

            var afterGlobalStreak3Total = getIntLS("cscs_correct_streak3_total");
            console.log("[B:streak3/global] HIT 3連正解", {
              qid: qid,
              day: dayPlay,
              streak3_total_before: beforeGlobalStreak3Total,
              streak3_total_after: afterGlobalStreak3Total
            });

            // 3) 3連達成ログを追加（到達した瞬間を残す）
            var sLogKey = "cscs_correct_streak3_log";
            var sLog = []; try{ sLog = JSON.parse(localStorage.getItem(sLogKey)||"[]"); }catch(_){ sLog = []; }
            sLog.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKey, JSON.stringify(sLog));
          }

          // 4) 現在の連続正解数（全体）を保存（不正解時に 0 リセットされる）
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

          // ★ 追加: 「その問題の最高連続正解数」と「達成日（JST YYYYMMDD）」を記録する
          //   - 最高値は、現ストリークが過去最高を上回った瞬間にのみ更新する（同値は更新しない）
          //   - 3連到達時はこの時点で sLenQ=3 になっているため、リセット前に確実に 3 を記録できる
          var maxKeyQ = "cscs_q_correct_streak_max:" + qid;
          var maxDayKeyQ = "cscs_q_correct_streak_max_day:" + qid;

          var beforeMaxQ = getIntLS(maxKeyQ);
          var beforeMaxDayQ = null;
          try{ beforeMaxDayQ = localStorage.getItem(maxDayKeyQ); }catch(_){ beforeMaxDayQ = null; }

          if(sLenQ > beforeMaxQ){
            setIntLS(maxKeyQ, sLenQ);
            // 1) streak_max_day は「number YYYYMMDD」として保存する（localStorage なので数値文字列）
            try{ localStorage.setItem(maxDayKeyQ, String(parseInt(dayPlay, 10))); }catch(_){}

            console.log("[B:streakMax/q] UPDATED", {
              qid: qid,
              day: dayPlay,
              streak_len_q_now: sLenQ,
              max_before: beforeMaxQ,
              max_after: getIntLS(maxKeyQ),
              max_day_before: beforeMaxDayQ,
              max_day_after: (function(){ try{ return localStorage.getItem(maxDayKeyQ); }catch(_){ return null; } })()
            });
          }else{
            console.log("[B:streakMax/q] NO CHANGE", {
              qid: qid,
              day: dayPlay,
              streak_len_q_now: sLenQ,
              max_current: beforeMaxQ,
              max_day_current: beforeMaxDayQ
            });
          }

          // 1) 3連到達は「3,6,9...」のタイミングでのみカウント（非重複）
          //    ※ streak_len（連続正解数）自体はリセットせず、連続回数として伸ばし続ける
          if((sLenQ % 3) === 0){
            incIntLS(streak3KeyQ, 1);

            var afterStreak3TotalQ = getIntLS(streak3KeyQ);
            console.log("[B:streak3/q] HIT 3連正解", {
              qid: qid,
              day: dayPlay,
              streak_len_q_before: sLenQ,
              streak3_total_q_before: beforeStreak3TotalQ,
              streak3_total_q_after: afterStreak3TotalQ
            });

            // 2) 問題別の3連達成ログを追加（到達した瞬間を残す）
            var sLogKeyQ = "cscs_q_correct_streak3_log:" + qid;
            var sLogQ = []; try{ sLogQ = JSON.parse(localStorage.getItem(sLogKeyQ)||"[]"); }catch(_){ sLogQ = []; }
            sLogQ.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(sLogKeyQ, JSON.stringify(sLogQ));

            // 3) ⭐️0→1（=最初の3連達成）になった問題だけ「今日の新規⭐️」としてカウント
            if(beforeStreak3TotalQ === 0){
              var todayDayKey = "cscs_streak3_today_day";
              var todayQidsKey = "cscs_streak3_today_qids";
              var todayCountKey = "cscs_streak3_today_unique_count";

              var storedDay = null;
              try{ storedDay = localStorage.getItem(todayDayKey); }catch(_){}

              // 4) 日付が変わっていたら、その日の集計としてリセット
              if(storedDay !== dayPlay){
                try{ localStorage.setItem(todayDayKey, dayPlay); }catch(_){}
                try{ localStorage.removeItem(todayQidsKey); }catch(_){}
                try{ localStorage.setItem(todayCountKey, "0"); }catch(_){}
              }

              // 5) その日の「新規⭐️獲得 qid 配列」をユニークに更新
              var todayQids = [];
              try{ todayQids = JSON.parse(localStorage.getItem(todayQidsKey)||"[]"); }catch(_){ todayQids = []; }
              if(!Array.isArray(todayQids)){ todayQids = []; }

              if(todayQids.indexOf(qid) === -1){
                todayQids.push(qid);
                try{ localStorage.setItem(todayQidsKey, JSON.stringify(todayQids)); }catch(_){}
                incIntLS(todayCountKey, 1);
              }

              // 6) デバッグ用スナップショット
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

              // 7) SYNC 送信用トリガー
              if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3TodayUnique === "function") {
                window.CSCS_SYNC.recordStreak3TodayUnique();
              }
            }
          }

          // 8) 現在の連続正解数（問題別）を保存（不正解時に 0 リセットされる）
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

          // 1) 不正解のたびに「全体の連続不正解数」を +1 する
          wLen += 1;

          // 2) 3連到達は「3,6,9...」のタイミングでのみカウント（非重複のまま）
          //    ※ streak_len 自体はリセットせず、連続回数として伸ばし続ける
          if((wLen % 3) === 0){
            incIntLS("cscs_wrong_streak3_total", 1);

            var afterGlobalWrongStreak3Total = getIntLS("cscs_wrong_streak3_total");
            console.log("[B:streak3_wrong/global] HIT 3連不正解", {
              qid: qid,
              day: dayPlay,
              wrong_streak3_total_before: beforeGlobalWrongStreak3Total,
              wrong_streak3_total_after: afterGlobalWrongStreak3Total
            });

            // 3) 3連達成ログを追加（到達した瞬間を残す）
            var wLogKey = "cscs_wrong_streak3_log";
            var wLog = []; try{ wLog = JSON.parse(localStorage.getItem(wLogKey)||"[]"); }catch(_){ wLog = []; }
            wLog.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(wLogKey, JSON.stringify(wLog));
          }

          // 4) 現在の連続不正解数（全体）を保存（正解時に 0 リセットされる）
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

          // ★ 追加: 「その問題の最高連続不正解数」と「達成日（JST YYYYMMDD）」を記録する
          //   - 最高値は、現ストリークが過去最高を上回った瞬間にのみ更新する（同値は更新しない）
          //   - 3連到達時はこの時点で wLenQ=3 になっているため、リセット前に確実に 3 を記録できる
          //   - コンソールで更新の成否（UPDATED / NO CHANGE）を必ず確認できるようにする
          var wMaxKeyQ = "cscs_q_wrong_streak_max:" + qid;
          var wMaxDayKeyQ = "cscs_q_wrong_streak_max_day:" + qid;

          var beforeWrongMaxQ = getIntLS(wMaxKeyQ);
          var beforeWrongMaxDayQ = null;
          try{ beforeWrongMaxDayQ = localStorage.getItem(wMaxDayKeyQ); }catch(_){ beforeWrongMaxDayQ = null; }

          if(wLenQ > beforeWrongMaxQ){
            setIntLS(wMaxKeyQ, wLenQ);
            // 1) streak_max_day は「number YYYYMMDD」として保存する（localStorage なので数値文字列）
            try{ localStorage.setItem(wMaxDayKeyQ, String(parseInt(dayPlay, 10))); }catch(_){}

            console.log("[B:streakMax_wrong/q] UPDATED", {
              qid: qid,
              day: dayPlay,
              wrong_streak_len_q_now: wLenQ,
              max_before: beforeWrongMaxQ,
              max_after: getIntLS(wMaxKeyQ),
              max_day_before: beforeWrongMaxDayQ,
              max_day_after: (function(){ try{ return localStorage.getItem(wMaxDayKeyQ); }catch(_){ return null; } })()
            });
          }else{
            console.log("[B:streakMax_wrong/q] NO CHANGE", {
              qid: qid,
              day: dayPlay,
              wrong_streak_len_q_now: wLenQ,
              max_current: beforeWrongMaxQ,
              max_day_current: beforeWrongMaxDayQ
            });
          }

          // 1) 3連到達は「3,6,9...」のタイミングでのみカウント（非重複）
          //    ※ streak_len（連続不正解数）自体はリセットせず、連続回数として伸ばし続ける
          if((wLenQ % 3) === 0){
            incIntLS(wrongStreak3KeyQ, 1);

            var afterWrongStreak3TotalQ = getIntLS(wrongStreak3KeyQ);
            console.log("[B:streak3_wrong/q] HIT 3連不正解", {
              qid: qid,
              day: dayPlay,
              wrong_streak_len_q_before: wLenQ,
              wrong_streak3_total_q_before: beforeWrongStreak3TotalQ,
              wrong_streak3_total_q_after: afterWrongStreak3TotalQ
            });

            // 2) 3連続不正解を達成した履歴を問題別ログに追加する
            var wLogKeyQ = "cscs_q_wrong_streak3_log:" + qid;
            var wLogQ = []; try{ wLogQ = JSON.parse(localStorage.getItem(wLogKeyQ)||"[]"); }catch(_){ wLogQ = []; }
            wLogQ.push({ ts: Date.now(), qid: qid, day: dayPlay, choice: choice });
            localStorage.setItem(wLogKeyQ, JSON.stringify(wLogQ));

            // 3) 「今日新しく3連続不正解を達成した問題」を日別ユニークとして記録する
            try{
              var wrongTodayDayKey   = "cscs_streak3_wrong_today_day";
              var wrongTodayQidsKey  = "cscs_streak3_wrong_today_qids";
              var wrongTodayCountKey = "cscs_streak3_wrong_today_unique_count";

              // 4) 日付が変わっていたら、その日の集計として day / qids / count をリセットする
              var storedWrongTodayDay = null;
              try{ storedWrongTodayDay = localStorage.getItem(wrongTodayDayKey); }catch(_){}
              if(storedWrongTodayDay !== dayPlay){
                try{ localStorage.setItem(wrongTodayDayKey, dayPlay); }catch(_){}
                try{ localStorage.removeItem(wrongTodayQidsKey); }catch(_){}
                try{ localStorage.setItem(wrongTodayCountKey, "0"); }catch(_){}
              }

              // 5) その日の「3連続不正解を初めて達成した qid 配列」を取得する
              var wrongTodayQids = [];
              try{ wrongTodayQids = JSON.parse(localStorage.getItem(wrongTodayQidsKey) || "[]"); }catch(_){ wrongTodayQids = []; }
              if(!Array.isArray(wrongTodayQids)){ wrongTodayQids = []; }

              // 6) まだ登録されていない qid なら配列に追加し、ユニークカウンタを +1 する
              if(wrongTodayQids.indexOf(qid) === -1){
                wrongTodayQids.push(qid);
                try{ localStorage.setItem(wrongTodayQidsKey, JSON.stringify(wrongTodayQids)); }catch(_){}
                incIntLS(wrongTodayCountKey, 1);
              }

              // 7) デバッグ用スナップショット
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

              // 8) SYNC 送信用トリガー
              if (window && window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3WrongTodayUnique === "function") {
                window.CSCS_SYNC.recordStreak3WrongTodayUnique();
              }
            }catch(_){}
          }

          // 9) 現在の連続不正解数（問題別）を保存（正解時に 0 リセットされる）
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