// assets/cscs_sync_view_b.js
(function () {
  "use strict";

  var SYNC_STATE_ENDPOINT = "/api/sync/state";
  var SYNC_MERGE_ENDPOINT = "/api/sync/merge";

  /**
   * CSCS SYNC ビュー（Bパート）で使用しているキー対応表
   * LocalStorage ⇔ SYNC(JSON) / payload の対応（qid は "YYYYMMDD-NNN"）
   *
   * 【重要：開発ルール（恒久）】
   *   📌 このファイルで使用する LocalStorage / SYNC キー名に
   *       「変更」または「新規追加」が発生した場合は、
   *       必ず **本キー対応表コメントに追記すること**。
   *   - b_judge_record.js・SYNC Worker（merge/state.ts）側と
   *     キー仕様の不整合が生じることを防ぐ目的。
   *   - ここに書かれていないキーは原則として使用禁止。
   *
   * ▼ 問題別累計
   *   - localStorage: "cscs_q_correct_total:" + qid
   *       ⇔ SYNC state: state.correct[qid]
   *   - localStorage: "cscs_q_wrong_total:" + qid
   *       ⇔ SYNC state: state.incorrect[qid]
   *
   * ▼ 問題別 3 連続正解（⭐️用）
   *   - localStorage: "cscs_q_correct_streak3_total:" + qid
   *       ⇔ SYNC state: state.streak3[qid]
   *   - localStorage: "cscs_q_correct_streak_len:" + qid
   *       ⇔ SYNC state: state.streakLen[qid]
   *   - payload(merge): streak3Delta[qid] / streakLenDelta[qid]
   *
   * ▼ 問題別 3 連続不正解
   *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
   *       ⇔ SYNC state: state.streak3Wrong[qid]
   *   - localStorage: "cscs_q_wrong_streak_len:" + qid
   *       ⇔ SYNC state: state.streakWrongLen[qid]
   *   - payload(merge): streak3WrongDelta[qid] / streakWrongLenDelta[qid]
   *
   * ▼ 問題別 連続不正解（ローカル計測：b_judge_record.js）
   *   - localStorage: "cscs_q_wrong_streak_max:" + qid
   *       （最高連続不正解数）
   *   - localStorage: "cscs_q_wrong_streak_max_day:" + qid
   *       （その達成日 JST YYYYMMDD）
   *
   * ▼ 今日の⭐️ユニーク数（Streak3Today）
   *   - localStorage: "cscs_streak3_today_day"
   *       ⇔ SYNC state: state.streak3Today.day
   *   - localStorage: "cscs_streak3_today_qids"
   *       ⇔ SYNC state: state.streak3Today.qids
   *   - localStorage: "cscs_streak3_today_unique_count"
   *       ⇔ SYNC state: state.streak3Today.unique_count
   *   - payload(merge): streak3TodayDelta { day, qids }
   *
   * ▼ 今日の3連続不正解ユニーク数（Streak3WrongToday）
   *   - localStorage: "cscs_streak3_wrong_today_day"
   *       ⇔ SYNC state: state.streak3WrongToday.day
   *   - localStorage: "cscs_streak3_wrong_today_qids"
   *       ⇔ SYNC state: state.streak3WrongToday.qids
   *   - localStorage: "cscs_streak3_wrong_today_unique_count"
   *       ⇔ SYNC state: state.streak3WrongToday.unique_count
   *   - payload(merge): streak3WrongTodayDelta { day, qids }
   *
   * ▼ 1 日 1 回計測モード（oncePerDayToday）
   *   - localStorage: "cscs_once_per_day_today_day"
   *       ⇔ SYNC state: state.oncePerDayToday.day
   *   - localStorage: "cscs_once_per_day_today_results"
   *       ⇔ SYNC state: state.oncePerDayToday.results[qid]
   *   - payload(merge): oncePerDayTodayDelta { day, results }
   *
   * ▼ 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）
   *   - localStorage: "cscs_q_last_seen_day:" + qid
   *       ⇔ SYNC state: state.lastSeenDay[qid]
   *   - localStorage: "cscs_q_last_correct_day:" + qid
   *       ⇔ SYNC state: state.lastCorrectDay[qid]
   *   - localStorage: "cscs_q_last_wrong_day:" + qid
   *       ⇔ SYNC state: state.lastWrongDay[qid]
   *   - payload(merge): lastSeenDayDelta[qid] / lastCorrectDayDelta[qid] / lastWrongDayDelta[qid]
   *
   * ▼ グローバル情報
   *   - localStorage: "cscs_total_questions"
   *       ⇔ payload(merge): global.totalQuestions
   *
   * ▼ O.D.O.A / 検証モード関連
   *   - SYNC state: state.odoaMode / state.odoa_mode / state.ODOA_MODE
   *   - SYNC state: state.debug.odoaMode / state.debug.odoa_mode / state.debug.ODOA_MODE
   *   - SYNC state: state.navGuard.odoaMode / state.navGuard.odoa_mode
   *   - runtime: window.CSCS_VERIFY_MODE ("on" / "off")
   *
   * ▼ HUD(Bビュー) 表示状態
   *   - localStorage: "cscs_sync_view_b_pending_collapsed"
   *       → "1" のとき Pending (unsent) を折りたたみ表示にする
   *   - localStorage: "cscs_sync_view_b_correct_streak_collapsed"
   *       → "1" のとき Correct Streak を折りたたみ表示にする
   *   - localStorage: "cscs_sync_view_b_once_odoa_collapsed"
   *       → "1" のとき OncePerDayToday / O.D.O.A Mode を折りたたみ表示にする（見出し＋1行目のみ）
   */

  // ★ HUD 用：直近に表示した O.D.O.A ステータス文字列を保持しておく
  var LAST_ODOA_STATUS = "";

  // ★ このファイル内で管理する CSS（ここにどんどん追記していく）
  //   - #cscs_sync_view_b が現行のパネルID
  //   - 将来 #cscs_sync_monitor_b に変えても同じCSSが効くよう、両方を対象にしている
  var CSCS_SYNC_VIEW_B_CSS = [
    "/* cscs_sync_view_b.js injected CSS */",
    "#cscs_sync_view_b,",
    "#cscs_sync_monitor_b {",
    "  position: fixed;",
    "  right: 10px;",
    "  top: 110px;",
    "  color: #eee;",
    "  padding: 8px;",
    "  font: 11px/1.2 system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;",
    "  max-width: 46vw;",
    "  width: 310px;",
    "  opacity: 0.55;",
    "  z-index: 2147483647;",
    "}",
    "",
    "/* --- card layout for status body --- */",
    "#cscs_sync_view_b_title {",
    "  text-align: right;",
    "  margin-right: 7px;",
    "  opacity: 0.60;",
    "  font-size: 10px;",
    "  font-weight: 400;",
    "}",
    "",
    "#cscs_sync_view_b_body {",
    "  display: grid;",
    "  grid-template-columns: 1fr;",
    "  gap: 1px;",
    "  margin-top: 6px;",
    "  padding-top: 0px;",
    "  border-top: none;",
    "}",
    "",
    "/* --- 3連続（正解/不正解）4枚を 2列×2段で固定配置 --- */",
    "#cscs_sync_view_b_body .svb-streak-quad {",
    "  display: grid;",
    "  grid-template-columns: 1fr 1fr;",
    "  gap: 1px 1px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-streak-quad .svb-streak-card {",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card {",
    "    background: rgba(0,0,0,0.52);",
    "    border: 1px solid rgba(255,255,255,0.14);",
    "    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);",
    "    border-radius: 10px;",
    "    padding: 10px 10px;",
    "    width: 100%;",
    "    box-sizing: border-box;",
    "    line-height: 1;",
    "}",
    "",
    "/* --- Counts card only: tighter padding --- */",
    "#cscs_sync_view_b_body .cscs-svb-card.svb-counts {",
    "  padding: 5px 10px;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card.is-wide {",
    "  grid-column: 1 / -1;",
    "  font-weight: 350;",
    "}",
    "",
    "/* --- wide card: 左右カラム幅を同一に固定（key/value を等幅） --- */",
    "#cscs_sync_view_b_body .cscs-svb-card.is-wide .cscs-svb-card-grid {",
    "  grid-template-columns: minmax(0, 1fr) auto;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card-title {",
    "  font-weight: 500;",
    "  opacity: 0.90;",
    "  margin-bottom: 5px;",
    "  letter-spacing: 0.2px;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-title-suffix {",
    "  font-size: 9px;",
    "  font-weight: 600;",
    "  opacity: 0.55;",
    "  margin-left: 6px;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card-grid {",
    "  display: grid;",
    "  grid-template-columns: minmax(0, 1fr) auto;",
    "  column-gap: 0px;",
    "  row-gap: 3px;",
    "  opacity: 0.60;",
    "}",
    "",
    "/* --- Pending card only: 縦積み（key→value→...） --- */",
    "#cscs_sync_view_b_body .svb-pending-grid {",
    "  display: grid;",
    "  grid-template-columns: 1fr;",
    "  row-gap: 4px;",
    "  opacity: 0.60;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-grid .cscs-svb-k {",
    "  opacity: 0.85;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-grid .cscs-svb-v {",
    "  text-align: left;",
    "  white-space: pre-line;",
    "}",
    "",
    "/* --- Pending fold (collapsible) --- */",
    "#cscs_sync_view_b_body .svb-pending-head {",
    "  display: flex;",
    "  align-items: baseline;",
    "  justify-content: space-between;",
    "  gap: 10px;",
    "  height: 13px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-toggle {",
    "  appearance: none;",
    "  -webkit-appearance: none;",
    "  border: none;",
    "  background: transparent;",
    "  color: inherit;",
    "  padding: 0;",
    "  margin: 0;",
    "  font: inherit;",
    "  cursor: pointer;",
    "  opacity: 0.80;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-toggle:hover {",
    "  opacity: 0.95;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-toggle .svb-pending-chev {",
    "  display: inline-block;",
    "  width: 1.2em;",
    "  text-align: center;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-pending-card.is-collapsed .svb-pending-grid {",
    "  display: none;",
    "}",
    "",
    "/* --- Correct Streak fold (collapsible) --- */",
    "#cscs_sync_view_b_body .svb-correct-streak-head {",
    "  display: flex;",
    "  align-items: baseline;",
    "  justify-content: space-between;",
    "  gap: 10px;",
    "  height: 13px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-correct-streak-toggle {",
    "  appearance: none;",
    "  -webkit-appearance: none;",
    "  border: none;",
    "  background: transparent;",
    "  color: inherit;",
    "  padding: 0;",
    "  margin: 0;",
    "  font: inherit;",
    "  cursor: pointer;",
    "  opacity: 0.80;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-correct-streak-toggle:hover {",
    "  opacity: 0.95;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-correct-streak-toggle .svb-correct-streak-chev {",
    "  display: inline-block;",
    "  width: 1.2em;",
    "  text-align: center;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-correct-streak-card.is-collapsed .cscs-svb-card-grid {",
    "  display: none;",
    "}",
    "",
    "/* --- OncePerDayToday / O.D.O.A fold (collapsible) --- */",
    "#cscs_sync_view_b_body .svb-once-odoa-head {",
    "  display: flex;",
    "  align-items: baseline;",
    "  justify-content: space-between;",
    "  gap: 10px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-once-odoa-toggle {",
    "  appearance: none;",
    "  -webkit-appearance: none;",
    "  border: none;",
    "  background: transparent;",
    "  color: inherit;",
    "  padding: 0;",
    "  margin: 0;",
    "  font: inherit;",
    "  cursor: pointer;",
    "  opacity: 0.80;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-once-odoa-toggle:hover {",
    "  opacity: 0.95;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-once-odoa-toggle .svb-once-odoa-chev {",
    "  display: inline-block;",
    "  width: 1.2em;",
    "  text-align: center;",
    "}",
    "",
    "/* 折りたたみ時：1行目（最初の2セル）だけ残す */",
    "#cscs_sync_view_b_body .svb-once-odoa-card.is-collapsed .svb-wide-dual-grid > :nth-child(n+3) {",
    "  display: none;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-k {",
    "  opacity: 0.85;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-v {",
    "  text-align: right;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "  min-width: 0;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-muted {",
    "  opacity: 0.70;",
    "}",
    "",
    "/* --- Counts: 1行（Counts + SYNC/local/diff を横一列） --- */",
    "#cscs_sync_view_b_body .svb-counts-inline {",
    "  display: flex;",
    "  align-items: baseline;",
    "  gap: 10px;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-head {",
    "  font-weight: 800;",
    "  opacity: 0.90;",
    "  min-width: 0;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-head {",
    "  font-weight: 800;",
    "  opacity: 0.90;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-part {",
    "  display: inline-flex;",
    "  align-items: baseline;",
    "  justify-content: center;",
    "  gap: 6px;",
    "  flex: 1 1 0;",
    "  min-width: 0;",
    "  text-align: center;",
    "  box-shadow: none;",
    "  background: transparent;",
    "  border: none;",
    "  padding: 0;",
    "  overflow: hidden;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-part.is-muted {",
    "  opacity: 0.78;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-k {",
    "  opacity: 0.85;",
    "  white-space: nowrap;",
    "  min-width: 0;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-v {",
    "  text-align: left;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "  min-width: 0;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "/* --- Wide card: dual-column text rows (OncePerDayToday / O.D.O.A) --- */",
    "#cscs_sync_view_b_body .svb-wide-dual-grid {",
    "  display: grid;",
    "  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);",
    "  column-gap: 10px;",
    "  row-gap: 3px;",
    "  opacity: 0.60;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-wide-dual-cell {",
    "  min-width: 0;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-wide-dual-cell.is-right {",
    "  text-align: right;",
    "  font-variant-numeric: tabular-nums;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-wide-dual-strong {",
    "  opacity: 0.70;",
    "  font-weight: 500;",
    "}",
    "",
    "/* --- Wide card: single full-width row (ODOA line) --- */",
    "#cscs_sync_view_b_body .svb-wide-single {",
    "  grid-column: 1 / -1;",
    "  min-width: 0;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "/* --- LastDay: 3 columns (label / SYNC / local) --- */",
    "#cscs_sync_view_b_body {",
    "  /* 何をしているか: LastDayの列幅ルールをCSS変数として1箇所に集約し、見出し/本文のズレ要因を排除する */",
    "  --svb-lastday-col-1: minmax(0, 1fr);",
    "  --svb-lastday-col-2: minmax(0, 14ch);",
    "  --svb-lastday-col-3: minmax(0, 14ch);",
    "  /* 何をしているか: 見出し/本文で同一の列間ギャップを“共有”し、微妙なズレを防ぐ */",
    "  --svb-lastday-col-gap: 10px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-head {",
    "  display: grid;",
    "  /* 何をしているか: 見出し/本文で同一の列定義(変数)を使い、列幅を完全一致させる */",
    "  grid-template-columns: var(--svb-lastday-col-1) var(--svb-lastday-col-2) var(--svb-lastday-col-3);",
    "  /* 何をしているか: グリッドがカード幅いっぱいに伸びるように明示し、左端起点を揃える */",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  /* 何をしているか: 3列ブロック内の“開始位置”を固定する（縮小時のズレ抑制） */",
    "  justify-items: stretch;",
    "  column-gap: var(--svb-lastday-col-gap);",
    "  row-gap: 3px;",
    "  align-items: baseline;",
    "  opacity: 0.90;",
    "  font-weight: 500;",
    "  margin-bottom: 5px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-head .svb-lastday-k {",
    "  min-width: 0;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-head .svb-lastday-v {",
    "  /* 何をしているか: 見出し側も本文側と同様に縮小耐性(min-width:0)を持たせ、列幅計算の差を消す */",
    "  min-width: 0;",
    "  text-align: right;",
    "  justify-self: end;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "/* --- LastDay: 見出しの真ん中列（SYNC列）だけ“センター寄り”に固定 --- */",
    "#cscs_sync_view_b_body .svb-lastday-head .svb-lastday-v.svb-lastday-mid {",
    "  text-align: center;",
    "  justify-self: center;",
    "}",
    "",
    "/* --- LastDay: 真ん中列（SYNC）だけ中央揃え（nth-child依存をやめてclass指定にする） --- */",
    "/* 何をしているか: LastDayの真ん中列に付与する .svb-lastday-mid を中央寄せに固定する */",
    "#cscs_sync_view_b_body .svb-lastday-mid {",
    "  text-align: center;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-grid {",
    "  display: grid;",
    "  /* 何をしているか: 見出しと同一の列定義(変数)を使い、本文の3列ブロック位置を完全一致させる */",
    "  grid-template-columns: var(--svb-lastday-col-1) var(--svb-lastday-col-2) var(--svb-lastday-col-3);",
    "  /* 何をしているか: 本文側もカード幅いっぱいに伸ばし、列幅計算の起点を一致させる */",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  /* 何をしているか: 見出しと同一の“列間ギャップ(変数)”を使い、横位置を揃える */",
    "  column-gap: var(--svb-lastday-col-gap);",
    "  row-gap: 3px;",
    "  opacity: 0.60;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-grid .svb-lastday-k {",
    "  opacity: 0.85;",
    "  min-width: 0;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-lastday-grid .svb-lastday-v {",
    "  text-align: right;",
    "  justify-self: end;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "  min-width: 0;",
    "}",
    "",
    "/* --- LastDay: 本文の真ん中列（SYNC列）だけ“センター寄り”に固定 --- */",
    "#cscs_sync_view_b_body .svb-lastday-grid .svb-lastday-v.svb-lastday-mid {",
    "  text-align: center;",
    "  justify-self: center;",
    "}",
    "",
    "/* --- O.D.O.A status line: 表示しない（DOMは残す） --- */",
    "#cscs_sync_view_b_status {",
    "  display: none !important;",
    "}",
    "/* --- SYNC send button (manual) --- */",
    "#cscs_sync_view_b_send_btn {",
    "  margin-top: 6px;",
    "  width: 100%;",
    "  padding: 8px 10px;",
    "  border-radius: 10px;",
    "  border: 1px solid rgba(255,255,255,0.14);",
    "  background: rgba(0,0,0,0.52);",
    "  color: #eee;",
    "  font: 11px/1.2 system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;",
    "  opacity: 0.85;",
    "  cursor: pointer;",
    "}",
    "",
    "#cscs_sync_view_b_send_btn:hover {",
    "  opacity: 0.98;",
    "}",
    "",
    "#cscs_sync_view_b_send_btn:active {",
    "  transform: translateY(1px);",
    "}",
    ""
  ].join("\n");

  // ★ styleタグを1回だけ注入（同じidがあれば中身を更新して上書き）
  function upsertStyleTag(styleId, cssText) {
    try {
      var head = document.head || document.getElementsByTagName("head")[0] || null;
      if (!head) {
        return;
      }

      var el = document.getElementById(styleId);
      if (!el) {
        el = document.createElement("style");
        el.id = styleId;
        el.type = "text/css";
        head.appendChild(el);
      }

      if (el.textContent !== cssText) {
        el.textContent = cssText;
      }
    } catch (e) {
      console.error("[SYNC-B:view] upsertStyleTag failed:", e);
    }
  }

  function ensureSyncViewBStyles() {
    upsertStyleTag("cscs_sync_view_b_inline_css", CSCS_SYNC_VIEW_B_CSS);
  }

  function detectInfo() {
    var path = window.location.pathname || "";
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) return null;
    var day = m[1];
    var num3 = m[2];
    var qid = day + "-" + num3;
    return { day: day, num3: num3, qid: qid };
  }

  var info = detectInfo();
  if (!info) {
    return;
  }

  function readIntFromLocalStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        return 0;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        return 0;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read int from localStorage:", key, e);
      return 0;
    }
  }

  // ★ JST 日付(YYYYMMDD) を localStorage から安全に読み出すヘルパー
  //   - 正規の "YYYYMMDD" でなければ null を返し、SYNC には載せない
  function readDayFromLocalStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined || raw === "") {
        return null;
      }
      if (!/^\d{8}$/.test(raw)) {
        return null;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read day from localStorage:", key, e);
      return null;
    }
  }

  // ★ 総問題数 cscs_total_questions を安全に読み出す専用ヘルパー
  //   - 正の整数として保存されていなければ null を返し、送信しない
  function readTotalQuestionsFromLocalStorage() {
    var key = "cscs_total_questions";
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        return null;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read cscs_total_questions:", e);
      return null;
    }
  }

  // ★ oncePerDay ローカル状態を読み出す
  //   - day: number | null（YYYYMMDD）
  //   - results: { qid: "correct" | "wrong" }
  function readOncePerDayTodayFromLocal() {
    var dayStr = null;
    try {
      dayStr = window.localStorage.getItem("cscs_once_per_day_today_day");
    } catch (_e) {
      dayStr = null;
    }

    var results = {};
    try {
      var raw = window.localStorage.getItem("cscs_once_per_day_today_results") || "{}";
      results = JSON.parse(raw);
    } catch (_e2) {
      results = {};
    }
    if (!results || typeof results !== "object") {
      results = {};
    }

    var dayNum = null;
    if (dayStr && /^\d{8}$/.test(dayStr)) {
      var n = parseInt(dayStr, 10);
      if (Number.isFinite(n)) {
        dayNum = n;
      }
    }

    return {
      day: dayNum,
      results: results
    };
  }
  
    // ★ HUD用：送信待機（SYNC未反映っぽいもの）を判定して返す
  //   - ローカルと SYNC(state) を比較して「未反映の可能性」を拾う
  //   - フォールバックで別ソースを見ない（localStorage と window.__cscs_sync_state のみ）
  function computePendingFlags(syncState, qid) {
    var flags = {
      pendingDiffCounts: false,
      pendingOncePerDayToday: false,
      pendingLastSeenDay: false,
      pendingLastCorrectDay: false,
      pendingLastWrongDay: false,
      pendingStreak3Today: false,
      pendingStreak3WrongToday: false,
      details: []
    };

    try {
      // ---- oncePerDayToday（このqidがSYNCに入ってるか）----
      try {
        var localOnce = readOncePerDayTodayFromLocal();
        if (localOnce && typeof localOnce.day === "number" && localOnce.results && typeof localOnce.results === "object") {
          var localOnceVal = localOnce.results[qid];
          if (localOnceVal === "correct" || localOnceVal === "wrong") {
            var serverOnceVal = null;
            if (syncState &&
                syncState.oncePerDayToday &&
                typeof syncState.oncePerDayToday === "object" &&
                typeof syncState.oncePerDayToday.day === "number" &&
                syncState.oncePerDayToday.results &&
                typeof syncState.oncePerDayToday.results === "object") {
              if (syncState.oncePerDayToday.day === localOnce.day) {
                if (Object.prototype.hasOwnProperty.call(syncState.oncePerDayToday.results, qid)) {
                  serverOnceVal = syncState.oncePerDayToday.results[qid];
                }
              }
            }
            if (serverOnceVal !== localOnceVal) {
              flags.pendingOncePerDayToday = true;
              flags.details.push("oncePerDayToday");
            }
          }
        }
      } catch (_eOnce) {}

      // ---- lastDay（localに値があり、SYNCと違う）----
      try {
        var locSeen = readDayFromLocalStorage("cscs_q_last_seen_day:" + qid);
        var locCor  = readDayFromLocalStorage("cscs_q_last_correct_day:" + qid);
        var locWro  = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qid);

        var srvSeen = null;
        var srvCor  = null;
        var srvWro  = null;

        if (syncState) {
          if (syncState.lastSeenDay && typeof syncState.lastSeenDay === "object" && syncState.lastSeenDay[qid] != null) {
            if (typeof syncState.lastSeenDay[qid] === "number" && Number.isFinite(syncState.lastSeenDay[qid]) && syncState.lastSeenDay[qid] > 0) {
              srvSeen = syncState.lastSeenDay[qid];
            }
          }
          if (syncState.lastCorrectDay && typeof syncState.lastCorrectDay === "object" && syncState.lastCorrectDay[qid] != null) {
            if (typeof syncState.lastCorrectDay[qid] === "number" && Number.isFinite(syncState.lastCorrectDay[qid]) && syncState.lastCorrectDay[qid] > 0) {
              srvCor = syncState.lastCorrectDay[qid];
            }
          }
          if (syncState.lastWrongDay && typeof syncState.lastWrongDay === "object" && syncState.lastWrongDay[qid] != null) {
            if (typeof syncState.lastWrongDay[qid] === "number" && Number.isFinite(syncState.lastWrongDay[qid]) && syncState.lastWrongDay[qid] > 0) {
              srvWro = syncState.lastWrongDay[qid];
            }
          }
        }

        if (locSeen !== null && locSeen !== srvSeen) {
          flags.pendingLastSeenDay = true;
          flags.details.push("lastSeenDay");
        }
        if (locCor !== null && locCor !== srvCor) {
          flags.pendingLastCorrectDay = true;
          flags.details.push("lastCorrectDay");
        }
        if (locWro !== null && locWro !== srvWro) {
          flags.pendingLastWrongDay = true;
          flags.details.push("lastWrongDay");
        }
      } catch (_eLast) {}

      // ---- streak3Today（local qidsがあるのにSYNC側に反映されてなさそう）----
      try {
        var localDay = "";
        var localQids = [];
        try {
          localDay = localStorage.getItem("cscs_streak3_today_day") || "";
          var raw = localStorage.getItem("cscs_streak3_today_qids");
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              localQids = parsed.filter(function (x) { return typeof x === "string" && x; });
            }
          }
        } catch (_eS3t) {
          localDay = "";
          localQids = [];
        }

        if (localDay && localQids.length > 0) {
          var syncDay = "";
          var syncQids = [];
          if (syncState && syncState.streak3Today && typeof syncState.streak3Today === "object") {
            if (typeof syncState.streak3Today.day === "number" && Number.isFinite(syncState.streak3Today.day)) {
              syncDay = String(syncState.streak3Today.day);
            }
            if (Array.isArray(syncState.streak3Today.qids)) {
              syncQids = syncState.streak3Today.qids.filter(function (x) { return typeof x === "string" && x; });
            }
          }

          var missing = false;
          if (syncDay !== localDay) {
            missing = true;
          } else {
            var set = Object.create(null);
            for (var i = 0; i < syncQids.length; i++) {
              set[syncQids[i]] = 1;
            }
            for (var j = 0; j < localQids.length; j++) {
              if (!set[localQids[j]]) {
                missing = true;
                break;
              }
            }
          }

          if (missing) {
            flags.pendingStreak3Today = true;
            flags.details.push("streak3Today");
          }
        }
      } catch (_eS3t2) {}

      // ---- streak3WrongToday（local qidsがあるのにSYNC側に反映されてなさそう）----
      try {
        var localDayW = "";
        var localQidsW = [];
        try {
          localDayW = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
          var rawW = localStorage.getItem("cscs_streak3_wrong_today_qids");
          if (rawW) {
            var parsedW = JSON.parse(rawW);
            if (Array.isArray(parsedW)) {
              localQidsW = parsedW.filter(function (x) { return typeof x === "string" && x; });
            }
          }
        } catch (_eS3w) {
          localDayW = "";
          localQidsW = [];
        }

        if (localDayW && localQidsW.length > 0) {
          var syncDayW = "";
          var syncQidsW = [];
          if (syncState && syncState.streak3WrongToday && typeof syncState.streak3WrongToday === "object") {
            if (typeof syncState.streak3WrongToday.day === "number" && Number.isFinite(syncState.streak3WrongToday.day)) {
              syncDayW = String(syncState.streak3WrongToday.day);
            }
            if (Array.isArray(syncState.streak3WrongToday.qids)) {
              syncQidsW = syncState.streak3WrongToday.qids.filter(function (x) { return typeof x === "string" && x; });
            }
          }

          var missingW = false;
          if (syncDayW !== localDayW) {
            missingW = true;
          } else {
            var setW = Object.create(null);
            for (var k = 0; k < syncQidsW.length; k++) {
              setW[syncQidsW[k]] = 1;
            }
            for (var t = 0; t < localQidsW.length; t++) {
              if (!setW[localQidsW[t]]) {
                missingW = true;
                break;
              }
            }
          }

          if (missingW) {
            flags.pendingStreak3WrongToday = true;
            flags.details.push("streak3WrongToday");
          }
        }
      } catch (_eS3w2) {}

    } catch (_eAll) {}

    return flags;
  }

  // ★ サーバ state.oncePerDayToday と比較して delta を作る
  //   - 差分が無ければ null を返す
  //   - 何かしら差分があれば { day, results } を返す
  function buildOncePerDayTodayDelta(syncState) {
    try {
      var local = readOncePerDayTodayFromLocal();
      if (!local.day) {
        console.log("[SYNC-B:oncePerDay] local has no valid day → deltaなし", {
          local: local
        });
        return null;
      }

      var server = null;
      if (
        syncState &&
        syncState.oncePerDayToday &&
        typeof syncState.oncePerDayToday === "object"
      ) {
        server = syncState.oncePerDayToday;
      }

      var deltaResults = {};
      if (!server || typeof server.day !== "number" || server.day !== local.day) {
        // サーバ側にデータが無い or 別日 → 当日ローカルを丸ごと送る
        deltaResults = local.results;
      } else {
        // 同じ日付 → 値が違うものだけ送る
        var serverResults = server.results || {};
        for (var qid in local.results) {
          if (!Object.prototype.hasOwnProperty.call(local.results, qid)) continue;
          var localVal = local.results[qid];
          var serverVal = serverResults[qid];
          if (localVal !== serverVal) {
            deltaResults[qid] = localVal;
          }
        }
      }

      var keys = Object.keys(deltaResults);
      if (!keys.length) {
        console.log("[SYNC-B:oncePerDay] server と local で差分なし → delta送信不要", {
          day: local.day
        });
        return null;
      }

      var delta = {
        day: local.day,
        results: deltaResults
      };

      console.log("[SYNC-B:oncePerDay] buildOncePerDayTodayDelta", {
        local: local,
        server: server,
        delta: delta
      });

      return delta;
    } catch (e) {
      console.error("[SYNC-B:oncePerDay] buildOncePerDayTodayDelta error:", e);
      return null;
    }
  }

  function clearSyncBody() {
    var body = document.getElementById("cscs_sync_view_b_body");
    if (!body) return null;

    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }
    return body;
  }

  function updateSyncBodyText(text) {
    var body = clearSyncBody();
    if (!body) return;

    // エラー時など：カード1枚で表示（狭い/広い両方で崩れにくい）
    var card = document.createElement("div");
    card.className = "cscs-svb-card is-wide";

    var title = document.createElement("div");
    title.className = "cscs-svb-card-title";
    title.textContent = "Status";

    var grid = document.createElement("div");
    grid.className = "cscs-svb-card-grid";

    var k = document.createElement("div");
    k.className = "cscs-svb-k cscs-svb-muted";
    k.textContent = "message";

    var v = document.createElement("div");
    v.className = "cscs-svb-v";
    v.textContent = String(text);

    grid.appendChild(k);
    grid.appendChild(v);

    card.appendChild(title);
    card.appendChild(grid);
    body.appendChild(card);
  }

  function appendGridRow(gridEl, key, value, keyClass, valClass) {
    var k = document.createElement("div");
    k.className = "cscs-svb-k" + (keyClass ? " " + keyClass : "");
    k.textContent = key;

    var v = document.createElement("div");
    v.className = "cscs-svb-v" + (valClass ? " " + valClass : "");
    v.textContent = value;

    gridEl.appendChild(k);
    gridEl.appendChild(v);
  }

  function appendGridSection(body, title, options) {
    options = options || {};
    var wide = !!options.wide;

    var card = document.createElement("div");
    card.className = "cscs-svb-card" + (wide ? " is-wide" : "");

    var h = document.createElement("div");
    h.className = "cscs-svb-card-title";
    h.textContent = title;

    var grid = document.createElement("div");
    grid.className = "cscs-svb-card-grid";

    card.appendChild(h);
    card.appendChild(grid);
    body.appendChild(card);

    return grid;
  }

  function updateSyncBodyGrid(model) {
    var body = clearSyncBody();
    if (!body) return;

    if (!model || typeof model !== "object") {
      updateSyncBodyText("HUD model error");
      return;
    }

    // --- Counts（1行表示：Counts + SYNC/local/diff を横一列） ---
    (function appendCountsSectionInline() {
      // ① ワイドカード（Counts行を収めるコンテナ）
      var card = document.createElement("div");
      card.className = "cscs-svb-card is-wide svb-counts";

      // ② 1行の横並びコンテナ（折り返しなし）
      var line = document.createElement("div");
      line.className = "svb-counts-inline";

      // ③ 行の先頭に "Counts" を入れる（見出しも同じ行にまとめる）
      var head = document.createElement("span");
      head.className = "svb-counts-head";
      head.textContent = "Totals (c/w)";
      line.appendChild(head);

      // ④ 各パート（label + value）を横に連結していく
      function addPart(label, valueText, isMuted) {
        var part = document.createElement("span");
        part.className = "svb-counts-part" + (isMuted ? " is-muted" : "");

        var k = document.createElement("span");
        k.className = "svb-counts-k";
        k.textContent = label;

        var v = document.createElement("span");
        v.className = "svb-counts-v";
        v.textContent = valueText;

        part.appendChild(k);
        part.appendChild(v);
        line.appendChild(part);
      }

      addPart(
        "SYNC",
        String(model.serverCorrect) + " / " + String(model.serverWrong),
        false
      );
      addPart(
        "local",
        String(model.localCorrect) + " / " + String(model.localWrong),
        false
      );
      addPart(
        "diff",
        String(model.diffCorrect) + " / " + String(model.diffWrong),
        true
      );

      // ⑤ カードに1行を入れて body に追加
      card.appendChild(line);
      body.appendChild(card);
    })();

    // --- 3連続（正解/不正解）：2列×2段（左=正解 / 右=不正解、上=回数 / 下=進捗） ---
    (function appendStreakQuad4WideCards() {
      var quad = document.createElement("div");
      quad.className = "svb-streak-quad";

      function makeCard(titleText, rowKey, valueText) {
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-streak-card";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = titleText;

        var suf = document.createElement("span");
        suf.className = "svb-title-suffix";
        suf.textContent = "Syc/Lcl/Df";
        h.appendChild(suf);

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, rowKey, valueText);

        card.appendChild(h);
        card.appendChild(grid);
        return card;
      }

      // 左上：3連続正解（回数）
      quad.appendChild(
        makeCard(
          "⭐️3連続正解数",
          "回数(s3)",
          String(model.serverStreak3) + " / " + String(model.localStreak3) + " (+" + String(model.diffStreak3) + ")"
        )
      );

      // 右上：3連続不正解（回数）
      quad.appendChild(
        makeCard(
          "💣3連続不正解",
          "回数(s3W)",
          String(model.serverStreak3Wrong) + " / " + String(model.localStreak3Wrong) + " (+" + String(model.diffStreak3Wrong) + ")"
        )
      );

      // 左下：3連続正解（進捗）
      quad.appendChild(
        makeCard(
          "3連続正解進捗",
          "進捗(progress)",
          String(model.serverProgress) + "/3 / " + String(model.localProgress) + "/3 (+" + String(model.diffProgress) + ")"
        )
      );

      // 右下：3連続不正解（進捗）
      quad.appendChild(
        makeCard(
          "3連続不正解進捗",
          "進捗(progress)",
          String(model.serverWrongProgress) + "/3 / " + String(model.localWrongProgress) + "/3 (+" + String(model.diffWrongProgress) + ")"
        )
      );

      body.appendChild(quad);
    })();

    // --- Today Unique（左右2列：左=Streak3TodayUnique / 右=Streak3WrongTodayUq） ---
    (function appendTodayUniquePair() {
      var pair = document.createElement("div");
      pair.className = "svb-streak-quad";

      function makeTodayCard(titleText, dayLabel, syncCnt, localCnt) {
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-streak-card";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = titleText;

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, "day", String(dayLabel));
        appendGridRow(
          grid,
          "unique",
          "sync " + String(syncCnt) + " / local " + String(localCnt)
        );

        card.appendChild(h);
        card.appendChild(grid);
        return card;
      }

      // 左：Streak3TodayUnique
      pair.appendChild(
        makeTodayCard(
          "Streak3TodayUnique",
          model.s3TodayDayLabel,
          model.s3TodaySyncCnt,
          model.localS3TodayCnt
        )
      );

      // 右：Streak3WrongTodayUq
      pair.appendChild(
        makeTodayCard(
          "Streak3WrongTodayUq",
          model.s3WrongTodayDayLabel,
          model.s3WrongTodaySyncCnt,
          model.localS3WrongTodayCnt
        )
      );

      body.appendChild(pair);
    })();

    // --- Correct/Wrong Streak (local / b_judge_record.js) : 2列横並び ---
    (function appendStreakMaxPairCards() {
      // ★ 何をしているか:
      //   連続正解ブロックと、連続不正解ブロックを「左右2列」で横並びにする。
      //   - 既存の .svb-streak-quad を再利用（2列グリッド）
      //   - 両カードとも、同じUI（タイトル＋折りたたみ＋3行）で統一する
      var pair = document.createElement("div");
      pair.className = "svb-streak-quad";

      // ==========================
      // 左：連続正解 (local)
      // ==========================
      (function buildCorrectCard() {
        // ★ 何をしているか:
        //   「連続正解」カードは折りたたみ機能を持たず、常に内容を表示する。
        //   localStorage の collapsed 状態は参照/更新しない。
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-correct-streak-card";

        // ヘッダー（タイトルのみ）
        var head = document.createElement("div");
        head.className = "svb-correct-streak-head";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = "連続正解 (local)";

        head.appendChild(h);

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, "streak_len", String(model.localStreakLen));
        appendGridRow(grid, "streak_max", String(model.localCorrectStreakMax));
        appendGridRow(grid, "max_day", String(model.localCorrectStreakMaxDayLabel));

        card.appendChild(head);
        card.appendChild(grid);
        pair.appendChild(card);

        console.log("[SYNC-B:view] appended Correct Streak card (pair)", {
          qid: (info && info.qid) ? info.qid : "-",
          streak_len: model.localStreakLen,
          streak_max: model.localCorrectStreakMax,
          max_day: model.localCorrectStreakMaxDayLabel
        });
      })();

      // ==========================
      // 右：連続不正解 (local)
      // ==========================
      (function buildWrongCard() {
        // ★ 何をしているか:
        //   「連続不正解」カードは折りたたみ機能を持たず、常に内容を表示する。
        //   localStorage の collapsed 状態は参照/更新しない。
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-wrong-streak-card";

        // ヘッダー（タイトルのみ）
        var head = document.createElement("div");
        head.className = "svb-correct-streak-head";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = "連続不正解 (local)";

        head.appendChild(h);

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, "streak_len", String(model.localWrongStreakLen));
        appendGridRow(grid, "streak_max", String(model.localWrongStreakMax));
        appendGridRow(grid, "max_day", String(model.localWrongStreakMaxDayLabel));

        card.appendChild(head);
        card.appendChild(grid);
        pair.appendChild(card);

        console.log("[SYNC-B:view] appended Wrong Streak card (pair)", {
          qid: (info && info.qid) ? info.qid : "-",
          streak_len: model.localWrongStreakLen,
          streak_max: model.localWrongStreakMax,
          max_day: model.localWrongStreakMaxDayLabel
        });
      })();

      body.appendChild(pair);

      // ★ 何をしているか:
      //   2列ペア全体の追加が完了したことをログで確認できるようにする
      console.log("[SYNC-B:view] appended Streak Max pair (correct/wrong)", {
        qid: (info && info.qid) ? info.qid : "-"
      });
    })();

    // --- OncePerDayToday / O.D.O.A Mode（ワイドカード：折りたたみ対応） ---
    (function appendOncePerDayAndOdoaWideCard() {
      var card = document.createElement("div");
      card.className = "cscs-svb-card is-wide svb-once-odoa-card";

      // 折りたたみ状態（永続）
      var onceCollapsed = false;
      try {
        onceCollapsed = (localStorage.getItem("cscs_sync_view_b_once_odoa_collapsed") === "1");
      } catch (_eOnceCollapsed) {
        onceCollapsed = false;
      }

      if (onceCollapsed) {
        card.className += " is-collapsed";
      }

      // ヘッダー行（タイトル + トグル）
      var head = document.createElement("div");
      head.className = "svb-once-odoa-head";

      var h = document.createElement("div");
      h.className = "cscs-svb-card-title";
      h.textContent = "OncePerDayToday / O.D.O.A Mode";

      var btn = document.createElement("button");
      btn.className = "svb-once-odoa-toggle";
      btn.type = "button";
      btn.setAttribute("aria-expanded", onceCollapsed ? "false" : "true");

      function updateOnceBtnLabel() {
        var chev = onceCollapsed ? "▶" : "▼";
        var label = onceCollapsed ? "show" : "hide";
        btn.innerHTML = "<span class=\"svb-once-odoa-chev\">" + chev + "</span>" + label;
        btn.setAttribute("aria-expanded", onceCollapsed ? "false" : "true");
      }

      updateOnceBtnLabel();

      btn.addEventListener("click", function () {
        onceCollapsed = !onceCollapsed;

        if (onceCollapsed) {
          if (card.className.indexOf("is-collapsed") === -1) {
            card.className += " is-collapsed";
          }
        } else {
          card.className = card.className.replace(/\bis-collapsed\b/g, "").replace(/\s{2,}/g, " ").trim();
        }

        try {
          localStorage.setItem("cscs_sync_view_b_once_odoa_collapsed", onceCollapsed ? "1" : "0");
        } catch (_eSaveOnce) {}

        updateOnceBtnLabel();
      });

      head.appendChild(h);
      head.appendChild(btn);

      var grid = document.createElement("div");
      grid.className = "svb-wide-dual-grid";

      function addRow(leftText, rightText, strongLeft, strongRight) {
        var l = document.createElement("div");
        l.className = "svb-wide-dual-cell" + (strongLeft ? " svb-wide-dual-strong" : "");
        l.textContent = leftText;

        var r = document.createElement("div");
        r.className = "svb-wide-dual-cell is-right" + (strongRight ? " svb-wide-dual-strong" : "");
        r.textContent = rightText;

        grid.appendChild(l);
        grid.appendChild(r);
      }

      // 1行目（折りたたみ時も表示される行）
      addRow(
        "oncePerDayToday   " + String(model.onceStateLabel),
        "計測: " + String(model.onceMeasureOkLabel) + " ｜結果: " + String(model.onceResultLabel),
        true,
        false
      );

      // 2行目以降（折りたたみ時はCSSで非表示）
      addRow(
        "Today             " + String(model.onceTodayDateLabel),
        "qid: " + String(model.onceQidLabel),
        false,
        false
      );
      addRow(
        "count対象         " + String(model.onceCountableLabel),
        "記録: " + String(model.onceRecordLabel),
        false,
        false
      );

      // ODOA 行は「右カラム無し」で全幅1行にする（右側ブロック削除）
      (function addOdoaSingleRow() {
        var line = document.createElement("div");
        line.className = "svb-wide-single";
        line.textContent = "ODOA              " + String(model.onceOdoaLabel);
        grid.appendChild(line);
      })();

      card.appendChild(head);
      card.appendChild(grid);
      body.appendChild(card);

      // ★ 何をしているか:
      //   カードの追加位置が「連続正解/連続不正解ペアの直下」になったことをログで確認する
      console.log("[SYNC-B:view] appended OncePerDayToday / O.D.O.A card (moved under streak pair)", {
        qid: (info && info.qid) ? info.qid : "-"
      });
    })();

    // --- LastDay（ヘッダー=最新レコード / 3列=項目・SYNC・local） ---
    (function appendLastDayCard() {
      function asDayNum(s) {
        if (s == null) return null;
        var t = String(s);
        if (!/^\d{8}$/.test(t)) return null;
        var n = parseInt(t, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      }

      function max2(a, b) {
        if (a == null && b == null) return null;
        if (a == null) return b;
        if (b == null) return a;
        return a > b ? a : b;
      }

      var seenS = asDayNum(model.lastSeenSyncLabel);
      var seenL = asDayNum(model.lastSeenLocalLabel);
      var corS  = asDayNum(model.lastCorrectSyncLabel);
      var corL  = asDayNum(model.lastCorrectLocalLabel);
      var wroS  = asDayNum(model.lastWrongSyncLabel);
      var wroL  = asDayNum(model.lastWrongLocalLabel);

      var seenMax = max2(seenS, seenL);
      var corMax  = max2(corS, corL);
      var wroMax  = max2(wroS, wroL);

      var headKey = "LastDay";
      var best = null;

      if (seenMax != null) {
        headKey = "lastSeen";
        best = seenMax;
      }
      if (corMax != null && (best == null || corMax > best)) {
        headKey = "lastCorrect";
        best = corMax;
      }
      if (wroMax != null && (best == null || wroMax > best)) {
        headKey = "lastWrong";
        best = wroMax;
      }

      function showLabel(n, fallback) {
        if (n == null) return fallback;
        return String(n);
      }

      var headSync = "-";
      var headLocal = "-";

      if (headKey === "lastSeen") {
        headSync = showLabel(seenS, "-");
        headLocal = showLabel(seenL, "-");
      } else if (headKey === "lastCorrect") {
        headSync = showLabel(corS, "-");
        headLocal = showLabel(corL, "-");
      } else if (headKey === "lastWrong") {
        headSync = showLabel(wroS, "-");
        headLocal = showLabel(wroL, "-");
      }

      var card = document.createElement("div");
      card.className = "cscs-svb-card is-wide";

      // ヘッダー（最新レコード行：横3列）
      var head = document.createElement("div");
      head.className = "svb-lastday-head";

      var hk = document.createElement("div");
      hk.className = "svb-lastday-k";
      hk.textContent = headKey;

      var hs = document.createElement("div");
      // 何をしているか: LastDayの真ん中列（SYNC列）だと明示するclassを付与する（CSSで中央寄せ固定）
      hs.className = "svb-lastday-v svb-lastday-mid";
      hs.textContent = "SYNC " + String(headSync);

      var hl = document.createElement("div");
      // 何をしているか: 右列（local列）として通常の右寄せスタイルを維持する
      hl.className = "svb-lastday-v";
      hl.textContent = "local " + String(headLocal);

      head.appendChild(hk);
      head.appendChild(hs);
      head.appendChild(hl);
      card.appendChild(head);

      // 本体（見出しと同じ項目は表示しない）
      var grid = document.createElement("div");
      grid.className = "svb-lastday-grid";

      function addRow(kText, syncText, localText) {
        if (kText === headKey) return;

        var k = document.createElement("div");
        k.className = "svb-lastday-k";
        k.textContent = kText;

        var s = document.createElement("div");
        // 何をしているか: LastDayの真ん中列（SYNC列）だと明示するclassを付与する（CSSで中央寄せ固定）
        s.className = "svb-lastday-v svb-lastday-mid";
        s.textContent = showLabel(asDayNum(syncText), "-");

        var l = document.createElement("div");
        // 何をしているか: 右列（local列）は従来通り右寄せのまま
        l.className = "svb-lastday-v";
        l.textContent = showLabel(asDayNum(localText), "-");

        grid.appendChild(k);
        grid.appendChild(s);
        grid.appendChild(l);
      }

      addRow("lastCorrect", model.lastCorrectSyncLabel, model.lastCorrectLocalLabel);
      addRow("lastSeen", model.lastSeenSyncLabel, model.lastSeenLocalLabel);
      addRow("lastWrong", model.lastWrongSyncLabel, model.lastWrongLocalLabel);

      if (grid.childNodes.length > 0) {
        card.appendChild(grid);
      }

      body.appendChild(card);

      // ★ 何をしているか:
      //   LastDayカードも「連続正解/連続不正解ペアの直下（OncePerDayの次）」に来たことをログで確認する
      console.log("[SYNC-B:view] appended LastDay card (moved under streak pair, after once/odoa)", {
        qid: (info && info.qid) ? info.qid : "-",
        headKey: headKey,
        headSync: headSync,
        headLocal: headLocal
      });
    })();

    // --- Pending (unsent) ---
    var pendingText = "none";
    if (model.pending && typeof model.pending === "object") {
      var bits = [];

      if (model.pending.pendingDiffCounts) bits.push("diffCounts");
      if (model.pending.pendingOncePerDayToday) bits.push("oncePerDayToday");
      if (model.pending.pendingLastSeenDay) bits.push("lastSeenDay");
      if (model.pending.pendingLastCorrectDay) bits.push("lastCorrectDay");
      if (model.pending.pendingLastWrongDay) bits.push("lastWrongDay");
      if (model.pending.pendingStreak3Today) bits.push("streak3Today");
      if (model.pending.pendingStreak3WrongToday) bits.push("streak3WrongToday");

      if (bits.length > 0) {
        pendingText = bits.join(", ");
      }
    }

    // --- Pending (unsent) ---
    var pendingCard = document.createElement("div");
    pendingCard.className = "cscs-svb-card is-wide svb-pending-card";

    // 折りたたみ状態（永続）
    var pendingCollapsed = false;
    try {
      pendingCollapsed = (localStorage.getItem("cscs_sync_view_b_pending_collapsed") === "1");
    } catch (_ePendingCollapsed) {
      pendingCollapsed = false;
    }

    if (pendingCollapsed) {
      pendingCard.className += " is-collapsed";
    }

    // ヘッダー行（タイトル + トグル）
    var pendingHead = document.createElement("div");
    pendingHead.className = "svb-pending-head";

    var pendingH = document.createElement("div");
    pendingH.className = "cscs-svb-card-title";
    pendingH.textContent = "Pending (unsent)";

    var pendingBtn = document.createElement("button");
    pendingBtn.className = "svb-pending-toggle";
    pendingBtn.type = "button";
    pendingBtn.setAttribute("aria-expanded", pendingCollapsed ? "false" : "true");

    function updatePendingBtnLabel() {
      var chev = pendingCollapsed ? "▶" : "▼";
      var label = pendingCollapsed ? "show" : "hide";
      pendingBtn.innerHTML = "<span class=\"svb-pending-chev\">" + chev + "</span>" + label;
      pendingBtn.setAttribute("aria-expanded", pendingCollapsed ? "false" : "true");
    }

    updatePendingBtnLabel();

    pendingBtn.addEventListener("click", function () {
      pendingCollapsed = !pendingCollapsed;

      if (pendingCollapsed) {
        if (pendingCard.className.indexOf("is-collapsed") === -1) {
          pendingCard.className += " is-collapsed";
        }
      } else {
        pendingCard.className = pendingCard.className.replace(/\bis-collapsed\b/g, "").replace(/\s{2,}/g, " ").trim();
      }

      try {
        localStorage.setItem("cscs_sync_view_b_pending_collapsed", pendingCollapsed ? "1" : "0");
      } catch (_eSavePending) {}

      updatePendingBtnLabel();
    });

    pendingHead.appendChild(pendingH);
    pendingHead.appendChild(pendingBtn);

    var gPending = document.createElement("div");
    gPending.className = "svb-pending-grid";

    pendingCard.appendChild(pendingHead);
    pendingCard.appendChild(gPending);
    body.appendChild(pendingCard);

    appendGridRow(gPending, "status", pendingText);

    function fmtDayPair(syncDay, localDay) {
      var s = (syncDay == null ? "-" : String(syncDay));
      var l = (localDay == null ? "-" : String(localDay));
      return "sync " + s + " / local " + l;
    }

    function fmtNumPair(syncNum, localNum) {
      var s = (syncNum == null ? 0 : Number(syncNum));
      var l = (localNum == null ? 0 : Number(localNum));
      if (!Number.isFinite(s)) s = 0;
      if (!Number.isFinite(l)) l = 0;
      return "sync " + String(s) + " / local " + String(l);
    }

    function fmtQidsPreview(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return "-";
      var head = arr.slice(0, 3).join(", ");
      if (arr.length <= 3) return String(arr.length) + " [" + head + "]";
      return String(arr.length) + " [" + head + ", …]";
    }

    // ★ 何をしているか:
    //   local に居て sync に居ない qid を抽出して「未反映の差分(qids)」として可視化する
    //   （フォールバック無し：引数で渡された配列だけを使う）
    function pickLocalOnlyQids(syncArr, localArr) {
      if (!Array.isArray(localArr) || localArr.length === 0) return [];
      var set = Object.create(null);
      if (Array.isArray(syncArr) && syncArr.length > 0) {
        for (var i = 0; i < syncArr.length; i++) {
          var s = syncArr[i];
          if (typeof s === "string" && s) set[s] = 1;
        }
      }
      var out = [];
      for (var j = 0; j < localArr.length; j++) {
        var l = localArr[j];
        if (typeof l !== "string" || !l) continue;
        if (!set[l]) out.push(l);
      }
      return out;
    }

    if (model.pending && typeof model.pending === "object") {
      if (model.pending.pendingStreak3Today) {
        appendGridRow(
          gPending,
          "streak3Today.day",
          fmtDayPair(
            (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today ? window.__cscs_sync_state.streak3Today.day : "-"),
            (function () { try { return localStorage.getItem("cscs_streak3_today_day") || "-"; } catch (_e) { return "-"; } })()
          )
        );
        appendGridRow(
          gPending,
          "streak3Today.unique",
          fmtNumPair(
            (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today ? window.__cscs_sync_state.streak3Today.unique_count : 0),
            model.localS3TodayCnt
          )
        );
        appendGridRow(
          gPending,
          "streak3Today.qids",
          "sync " + fmtQidsPreview(model.s3TodaySyncQids) + " / local " + fmtQidsPreview(model.localS3TodayQids)
        );

        // ★ 何をしているか:
        //   「local-only（sync未反映）」の qids を行として追加して、差分が即わかるようにする
        var s3TodayMissing = pickLocalOnlyQids(model.s3TodaySyncQids, model.localS3TodayQids);
        appendGridRow(
          gPending,
          "streak3Today.missing",
          "local-only " + fmtQidsPreview(s3TodayMissing)
        );
      }

      if (model.pending.pendingStreak3WrongToday) {
        appendGridRow(
          gPending,
          "streak3WrongToday.day",
          fmtDayPair(
            (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday ? window.__cscs_sync_state.streak3WrongToday.day : "-"),
            (function () { try { return localStorage.getItem("cscs_streak3_wrong_today_day") || "-"; } catch (_e2) { return "-"; } })()
          )
        );
        appendGridRow(
          gPending,
          "streak3WrongToday.unique",
          fmtNumPair(
            (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday ? window.__cscs_sync_state.streak3WrongToday.unique_count : 0),
            model.localS3WrongTodayCnt
          )
        );
        appendGridRow(
          gPending,
          "streak3WrongToday.qids",
          "sync " + fmtQidsPreview(model.s3WrongTodaySyncQids) + " / local " + fmtQidsPreview(model.localS3WrongTodayQids)
        );

        // ★ 何をしているか:
        //   「local-only（sync未反映）」の qids を行として追加して、差分が即わかるようにする
        var s3WrongTodayMissing = pickLocalOnlyQids(model.s3WrongTodaySyncQids, model.localS3WrongTodayQids);
        appendGridRow(
          gPending,
          "streak3WrongToday.missing",
          "local-only " + fmtQidsPreview(s3WrongTodayMissing)
        );
      }
    }
  }

  function fetchState() {
    return fetch(SYNC_STATE_ENDPOINT, { method: "GET" }).then(function (res) {
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return res.json();
    });
  }

  function createPanel() {
    var box = document.createElement("div");
    box.id = "cscs_sync_view_b";

    var title = document.createElement("div");
    title.id = "cscs_sync_view_b_title";
    title.textContent = "SYNC(B): " + info.qid;

    var body = document.createElement("div");
    body.id = "cscs_sync_view_b_body";
    body.textContent = "読み込み中…";

    var statusDiv = document.createElement("div");
    statusDiv.id = "cscs_sync_view_b_status";

    // ★【超重要仕様：このボタンは「削除禁止」】
    //   - DOM 上に存在していることが絶対条件（ID変更も禁止）。
    //   - setTimeout(... btn.click()) のターゲットでもある。
    //   - ここでは「手動送信用に表示」するが、DOM/ID/ボタン形状は維持すること。
    var btn = document.createElement("button");
    btn.id = "cscs_sync_view_b_send_btn";
    btn.type = "button";
    btn.textContent = "SYNC送信";
    btn.className = "cscs-svb-send-btn";

    // ★ 手動送信ボタンが押されたら「直近が手動送信である」ことを記録する
    //   - sendDiffToServer 側でこのフラグを見て「差分ゼロでも必ず送信」に切り替える
    //   - ここでは“送信処理そのもの”は触らない（既存のクリック処理と共存させる）
    //   - 追加: ボタン押下直後に /api/sync/state を取り直して HUD を即時再描画し、
    //          パネル内の全値が「押した瞬間に更新された」ことを保証する（ログで確認可能）
    btn.addEventListener("click", function () {
      try {
        window.__cscs_sync_b_manual_send_ts = Date.now();
      } catch (_eManual) {}

      // ★ 何をしているか:
      //   1) 最新 state を取得して window.__cscs_sync_state を更新
      //   2) state + localStorage から「今この瞬間の」表示用payloadを再構築
      //   3) renderPanel() を呼び、ステータスパネル内の全値をまとめて更新
      (function refreshHudAllValuesAfterManualSendClick() {
        var qid = info.qid;

        console.log("[SYNC-B:view] manual send clicked → refresh HUD start", {
          qid: qid,
          ts: (function () { try { return window.__cscs_sync_b_manual_send_ts || 0; } catch (_e) { return 0; } })()
        });

        fetchState().then(function (st) {
          try {
            window.__cscs_sync_state = st;
          } catch (_eAssign) {}

          console.log("[SYNC-B:view] fetchState success → window.__cscs_sync_state updated", {
            qid: qid,
            hasState: !!st
          });

          // ★ 何をしているか:
          //   server値（SYNC側）を state から拾う（無ければ 0 / "-"）
          var serverCorrect = 0;
          var serverWrong = 0;
          var serverStreak3 = 0;
          var serverStreakLen = 0;
          var serverStreak3Wrong = 0;
          var serverWrongStreakLen = 0;

          try {
            if (st && st.correct && typeof st.correct === "object" && st.correct[qid] != null) {
              if (typeof st.correct[qid] === "number" && Number.isFinite(st.correct[qid]) && st.correct[qid] >= 0) {
                serverCorrect = st.correct[qid];
              }
            }
            if (st && st.incorrect && typeof st.incorrect === "object" && st.incorrect[qid] != null) {
              if (typeof st.incorrect[qid] === "number" && Number.isFinite(st.incorrect[qid]) && st.incorrect[qid] >= 0) {
                serverWrong = st.incorrect[qid];
              }
            }
            if (st && st.streak3 && typeof st.streak3 === "object" && st.streak3[qid] != null) {
              if (typeof st.streak3[qid] === "number" && Number.isFinite(st.streak3[qid]) && st.streak3[qid] >= 0) {
                serverStreak3 = st.streak3[qid];
              }
            }
            if (st && st.streakLen && typeof st.streakLen === "object" && st.streakLen[qid] != null) {
              if (typeof st.streakLen[qid] === "number" && Number.isFinite(st.streakLen[qid]) && st.streakLen[qid] >= 0) {
                serverStreakLen = st.streakLen[qid];
              }
            }
            if (st && st.streak3Wrong && typeof st.streak3Wrong === "object" && st.streak3Wrong[qid] != null) {
              if (typeof st.streak3Wrong[qid] === "number" && Number.isFinite(st.streak3Wrong[qid]) && st.streak3Wrong[qid] >= 0) {
                serverStreak3Wrong = st.streak3Wrong[qid];
              }
            }
            if (st && st.streakWrongLen && typeof st.streakWrongLen === "object" && st.streakWrongLen[qid] != null) {
              if (typeof st.streakWrongLen[qid] === "number" && Number.isFinite(st.streakWrongLen[qid]) && st.streakWrongLen[qid] >= 0) {
                serverWrongStreakLen = st.streakWrongLen[qid];
              }
            }
          } catch (eSrvPick) {
            console.error("[SYNC-B:view] refresh pick server values error:", eSrvPick);
          }

          // ★ 何をしているか:
          //   local値（ローカル側）を localStorage から拾う（確定キーのみ）
          var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + qid);
          var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + qid);
          var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + qid);
          var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + qid);
          var localStreak3Wrong = readIntFromLocalStorage("cscs_q_wrong_streak3_total:" + qid);
          var localWrongStreakLen = readIntFromLocalStorage("cscs_q_wrong_streak_len:" + qid);

          // ★ 何をしているか:
          //   diff（local - server）を計算（マイナスは 0 に丸める）
          var diffCorrect = Math.max(0, localCorrect - serverCorrect);
          var diffWrong = Math.max(0, localWrong - serverWrong);
          var diffStreak3 = Math.max(0, localStreak3 - serverStreak3);
          var diffStreakLen = Math.max(0, localStreakLen - serverStreakLen);
          var diffStreak3Wrong = Math.max(0, localStreak3Wrong - serverStreak3Wrong);
          var diffWrongStreakLen = Math.max(0, localWrongStreakLen - serverWrongStreakLen);

          // ★ 何をしているか:
          //   Pending（未送信っぽい差分）を再計算して payload に載せる
          var pending = null;
          try {
            pending = computePendingFlags(st, qid);
          } catch (_ePending) {
            pending = null;
          }

          console.log("[SYNC-B:view] manual send clicked → refresh HUD computed", {
            qid: qid,
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            serverStreak3: serverStreak3,
            localStreak3: localStreak3,
            diffStreak3: diffStreak3,
            serverStreakLen: serverStreakLen,
            localStreakLen: localStreakLen,
            diffStreakLen: diffStreakLen,
            serverStreak3Wrong: serverStreak3Wrong,
            localStreak3Wrong: localStreak3Wrong,
            diffStreak3Wrong: diffStreak3Wrong,
            serverWrongStreakLen: serverWrongStreakLen,
            localWrongStreakLen: localWrongStreakLen,
            diffWrongStreakLen: diffWrongStreakLen,
            pending: pending
          });

          // ★ 何をしているか:
          //   renderPanel() に payload を渡して「パネル内の全値」をまとめて更新
          renderPanel(box, {
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            serverStreak3: serverStreak3,
            localStreak3: localStreak3,
            diffStreak3: diffStreak3,
            serverStreakLen: serverStreakLen,
            localStreakLen: localStreakLen,
            diffStreakLen: diffStreakLen,
            serverStreak3Wrong: serverStreak3Wrong,
            localStreak3Wrong: localStreak3Wrong,
            diffStreak3Wrong: diffStreak3Wrong,
            serverWrongStreakLen: serverWrongStreakLen,
            localWrongStreakLen: localWrongStreakLen,
            diffWrongStreakLen: diffWrongStreakLen,
            statusText: "manual click → HUD refreshed",
            pending: pending,
            odoaStatusText: "__keep__"
          });

          console.log("[SYNC-B:view] manual send clicked → refresh HUD done", {
            qid: qid
          });
        }).catch(function (e) {
          console.error("[SYNC-B:view] manual send clicked → fetchState failed:", e);
        });
      })();
    });

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(statusDiv);
    // ★ 非表示ボタンだが、DOM に必ず追加することで click() 自動発火のターゲットを保証する。
    box.appendChild(btn);

    return box;
  }

  function renderPanel(box, payload) {
    try {
      var serverCorrect = payload.serverCorrect || 0;
      var serverWrong = payload.serverWrong || 0;
      var localCorrect = payload.localCorrect || 0;
      var localWrong = payload.localWrong || 0;
      var diffCorrect = payload.diffCorrect || 0;
      var diffWrong = payload.diffWrong || 0;

      var serverStreak3 = payload.serverStreak3 || 0;
      var localStreak3 = payload.localStreak3 || 0;
      var diffStreak3 = payload.diffStreak3 || 0;

      var serverStreakLen = payload.serverStreakLen || 0;
      var localStreakLen = payload.localStreakLen || 0;
      var diffStreakLen = payload.diffStreakLen || 0;

      // ★ 追加: b_judge_record.js のローカル計測（問題別：最高連続正解数 / 更新日）を読み出す
      //   何をしているか: localStorage の確定キーから「現在/最高/達成日」を取得し、HUD model に載せる
      //   フォールバックはしない（キーが無い/不正なら 0 または （データなし））
      var localCorrectStreakMax = 0;
      var localCorrectStreakMaxDayLabel = "（データなし）";
      try {
        localCorrectStreakMax = readIntFromLocalStorage("cscs_q_correct_streak_max:" + info.qid);
        var maxDayNum = readDayFromLocalStorage("cscs_q_correct_streak_max_day:" + info.qid);
        if (maxDayNum !== null) {
          localCorrectStreakMaxDayLabel = String(maxDayNum);
        }

        console.log("[SYNC-B:view] correct-streak max from localStorage", {
          qid: info.qid,
          localCorrectStreakLen: localStreakLen,
          localCorrectStreakMax: localCorrectStreakMax,
          localCorrectStreakMaxDay: localCorrectStreakMaxDayLabel
        });
      } catch (eStreakMax) {
        console.error("[SYNC-B:view] correct-streak max read error:", eStreakMax);
      }

      // ★ 追加: b_judge_record.js のローカル計測（問題別：最高連続不正解数 / 達成日）を読み出す
      //   何をしているか: localStorage の確定キーから「最高/達成日」を取得し、HUD model に載せる
      //   フォールバックはしない（キーが無い/不正なら 0 または （データなし））
      var localWrongStreakMax = 0;
      var localWrongStreakMaxDayLabel = "（データなし）";
      try {
        localWrongStreakMax = readIntFromLocalStorage("cscs_q_wrong_streak_max:" + info.qid);
        var maxWrongDayNum = readDayFromLocalStorage("cscs_q_wrong_streak_max_day:" + info.qid);
        if (maxWrongDayNum !== null) {
          localWrongStreakMaxDayLabel = String(maxWrongDayNum);
        }

        console.log("[SYNC-B:view] wrong-streak max from localStorage", {
          qid: info.qid,
          localWrongStreakLen: localWrongStreakLen,
          localWrongStreakMax: localWrongStreakMax,
          localWrongStreakMaxDay: localWrongStreakMaxDayLabel
        });
      } catch (eWrongStreakMax) {
        console.error("[SYNC-B:view] wrong-streak max read error:", eWrongStreakMax);
      }

      // statusText は内部状態としてログだけに使う
      var statusText = payload.statusText || "";

      var serverProgress = serverStreakLen % 3;
      var localProgress = localStreakLen % 3;
      var diffProgress = Math.max(0, localProgress - serverProgress);

      // ★ 3連続不正解用のサマリを server / local / diff から計算して HUD に追加表示する
      //   - server 側: window.__cscs_sync_state.streak3Wrong / streakWrongLen（存在すれば使用）
      //   - local 側: localStorage の cscs_q_wrong_streak3_total:{qid}, cscs_q_wrong_streak_len:{qid}
      var qidForStreakWrong = info && info.qid ? info.qid : null;
      var serverStreak3Wrong = 0;
      var localStreak3Wrong = 0;
      var diffStreak3Wrong = 0;
      var serverWrongStreakLen = 0;
      var localWrongStreakLen = 0;
      var diffWrongStreakLen = 0;
      var serverWrongProgress = 0;
      var localWrongProgress = 0;
      var diffWrongProgress = 0;

      try {
        if (qidForStreakWrong) {
          var stateForWrong = null;
          try {
            stateForWrong = window.__cscs_sync_state || null;
          } catch (_eStateWrong) {
            stateForWrong = null;
          }

          // サーバ側の 3連続不正解回数（存在する場合のみ採用）
          if (
            stateForWrong &&
            stateForWrong.streak3Wrong &&
            typeof stateForWrong.streak3Wrong === "object" &&
            stateForWrong.streak3Wrong[qidForStreakWrong] != null
          ) {
            var s3w = stateForWrong.streak3Wrong[qidForStreakWrong];
            if (typeof s3w === "number" && Number.isFinite(s3w) && s3w >= 0) {
              serverStreak3Wrong = s3w;
            }
          }

          // サーバ側の「現在の連続不正解長」（存在する場合のみ採用）
          if (
            stateForWrong &&
            stateForWrong.streakWrongLen &&
            typeof stateForWrong.streakWrongLen === "object" &&
            stateForWrong.streakWrongLen[qidForStreakWrong] != null
          ) {
            var slw = stateForWrong.streakWrongLen[qidForStreakWrong];
            if (typeof slw === "number" && Number.isFinite(slw) && slw >= 0) {
              serverWrongStreakLen = slw;
            }
          }

          // localStorage 側の 3連続不正解回数 / 現在の連続不正解長
          localStreak3Wrong = readIntFromLocalStorage("cscs_q_wrong_streak3_total:" + qidForStreakWrong);
          localWrongStreakLen = readIntFromLocalStorage("cscs_q_wrong_streak_len:" + qidForStreakWrong);

          // SYNC と local の diff と 3回に対する進捗（0〜2/3）を計算
          diffStreak3Wrong = Math.max(0, localStreak3Wrong - serverStreak3Wrong);
          diffWrongStreakLen = Math.max(0, localWrongStreakLen - serverWrongStreakLen);

          serverWrongProgress = serverWrongStreakLen % 3;
          localWrongProgress = localWrongStreakLen % 3;
          diffWrongProgress = Math.max(0, localWrongProgress - serverWrongProgress);

          console.log("[SYNC-B:view] wrong-streak status", {
            qid: qidForStreakWrong,
            serverStreak3Wrong: serverStreak3Wrong,
            localStreak3Wrong: localStreak3Wrong,
            diffStreak3Wrong: diffStreak3Wrong,
            serverWrongStreakLen: serverWrongStreakLen,
            localWrongStreakLen: localWrongStreakLen,
            diffWrongStreakLen: diffWrongStreakLen,
            serverWrongProgress: serverWrongProgress,
            localWrongProgress: localWrongProgress
          });
        }
      } catch (eWrong) {
        console.error("[SYNC-B:view] wrong-streak status error:", eWrong);
      }

      var s3TodaySyncDay = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.day) 
        ? window.__cscs_sync_state.streak3Today.day : "-";
      var s3TodaySyncCnt = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.unique_count) 
        ? window.__cscs_sync_state.streak3Today.unique_count : 0;

      var localS3TodayDay = "";
      var localS3TodayCnt = 0;
      try {
        localS3TodayDay = localStorage.getItem("cscs_streak3_today_day") || "-";
        var rawLocalCnt = localStorage.getItem("cscs_streak3_today_unique_count");
        var parsedLocalCnt = rawLocalCnt == null ? NaN : parseInt(rawLocalCnt, 10);
        if (Number.isFinite(parsedLocalCnt) && parsedLocalCnt >= 0) {
          localS3TodayCnt = parsedLocalCnt;
        }
      } catch(_e) {}

      // ★ 3連続不正解（Streak3WrongToday）の SYNC / local 状態も取得
      var s3WrongTodaySyncDay = (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday && window.__cscs_sync_state.streak3WrongToday.day) 
        ? window.__cscs_sync_state.streak3WrongToday.day : "-";
      var s3WrongTodaySyncCnt = (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday && window.__cscs_sync_state.streak3WrongToday.unique_count) 
        ? window.__cscs_sync_state.streak3WrongToday.unique_count : 0;

      var localS3WrongTodayDay = "";
      var localS3WrongTodayCnt = 0;
      try {
        localS3WrongTodayDay = localStorage.getItem("cscs_streak3_wrong_today_day") || "-";
        var rawLocalWrongCnt = localStorage.getItem("cscs_streak3_wrong_today_unique_count");
        var parsedLocalWrongCnt = rawLocalWrongCnt == null ? NaN : parseInt(rawLocalWrongCnt, 10);
        if (Number.isFinite(parsedLocalWrongCnt) && parsedLocalWrongCnt >= 0) {
          localS3WrongTodayCnt = parsedLocalWrongCnt;
        }
      } catch(_e2) {}

      // ★ Pending 詳細表示用：Today系 qids（SYNC / local）を取得して model に載せる
      var s3TodaySyncQids = [];
      var s3WrongTodaySyncQids = [];
      try {
        if (window.__cscs_sync_state &&
            window.__cscs_sync_state.streak3Today &&
            Array.isArray(window.__cscs_sync_state.streak3Today.qids)) {
          s3TodaySyncQids = window.__cscs_sync_state.streak3Today.qids
            .filter(function (x) { return typeof x === "string" && x; });
        }
      } catch (_eS3TodaySyncQids) {
        s3TodaySyncQids = [];
      }

      try {
        if (window.__cscs_sync_state &&
            window.__cscs_sync_state.streak3WrongToday &&
            Array.isArray(window.__cscs_sync_state.streak3WrongToday.qids)) {
          s3WrongTodaySyncQids = window.__cscs_sync_state.streak3WrongToday.qids
            .filter(function (x) { return typeof x === "string" && x; });
        }
      } catch (_eS3WrongTodaySyncQids) {
        s3WrongTodaySyncQids = [];
      }

      var localS3TodayQids = [];
      try {
        var rawLocalS3TodayQids = localStorage.getItem("cscs_streak3_today_qids");
        if (rawLocalS3TodayQids) {
          var parsedLocalS3TodayQids = JSON.parse(rawLocalS3TodayQids);
          if (Array.isArray(parsedLocalS3TodayQids)) {
            localS3TodayQids = parsedLocalS3TodayQids
              .filter(function (x) { return typeof x === "string" && x; });
          }
        }
      } catch (_eLocalS3TodayQids) {
        localS3TodayQids = [];
      }

      var localS3WrongTodayQids = [];
      try {
        var rawLocalS3WrongTodayQids = localStorage.getItem("cscs_streak3_wrong_today_qids");
        if (rawLocalS3WrongTodayQids) {
          var parsedLocalS3WrongTodayQids = JSON.parse(rawLocalS3WrongTodayQids);
          if (Array.isArray(parsedLocalS3WrongTodayQids)) {
            localS3WrongTodayQids = parsedLocalS3WrongTodayQids
              .filter(function (x) { return typeof x === "string" && x; });
          }
        }
      } catch (_eLocalS3WrongTodayQids) {
        localS3WrongTodayQids = [];
      }

      // ★ 計測記録がない場合は「（データなし）」、それ以外は day をそのまま表示
      var s3TodayDayLabel = (s3TodaySyncDay === "-" ? "（データなし）" : String(s3TodaySyncDay));
      var s3WrongTodayDayLabel = (s3WrongTodaySyncDay === "-" ? "（データなし）" : String(s3WrongTodaySyncDay));

      // ★ ここから：問題別 最終日情報（lastSeen / lastCorrect / lastWrong）を HUD に追加
      var lastSeenSyncLabel = "（データなし）";
      var lastCorrectSyncLabel = "（データなし）";
      var lastWrongSyncLabel = "（データなし）";

      var lastSeenLocalLabel = "（データなし）";
      var lastCorrectLocalLabel = "（データなし）";
      var lastWrongLocalLabel = "（データなし）";

      try {
        var qidForLastDay = info && info.qid ? info.qid : null;

        // ---- SYNC 側の lastSeen / lastCorrect / lastWrong 読み取り ----
        var st = null;
        try { st = window.__cscs_sync_state || null; } catch (_e) { st = null; }

        if (qidForLastDay && st) {
          // lastSeen
          if (st.lastSeenDay &&
              typeof st.lastSeenDay === "object" &&
              st.lastSeenDay[qidForLastDay] != null) {
            var v1 = st.lastSeenDay[qidForLastDay];
            if (typeof v1 === "number" && Number.isFinite(v1) && v1 > 0) {
              lastSeenSyncLabel = String(v1);
            }
          }
          // lastCorrect
          if (st.lastCorrectDay &&
              typeof st.lastCorrectDay === "object" &&
              st.lastCorrectDay[qidForLastDay] != null) {
            var v2 = st.lastCorrectDay[qidForLastDay];
            if (typeof v2 === "number" && Number.isFinite(v2) && v2 > 0) {
              lastCorrectSyncLabel = String(v2);
            }
          }
          // lastWrong
          if (st.lastWrongDay &&
              typeof st.lastWrongDay === "object" &&
              st.lastWrongDay[qidForLastDay] != null) {
            var v3 = st.lastWrongDay[qidForLastDay];
            if (typeof v3 === "number" && Number.isFinite(v3) && v3 > 0) {
              lastWrongSyncLabel = String(v3);
            }
          }
        }

        // ---- localStorage 側の lastSeen / lastCorrect / lastWrong 読み取り ----
        if (qidForLastDay) {
          var loc1 = readDayFromLocalStorage("cscs_q_last_seen_day:" + qidForLastDay);
          var loc2 = readDayFromLocalStorage("cscs_q_last_correct_day:" + qidForLastDay);
          var loc3 = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qidForLastDay);

          if (loc1 !== null) lastSeenLocalLabel = String(loc1);
          if (loc2 !== null) lastCorrectLocalLabel = String(loc2);
          if (loc3 !== null) lastWrongLocalLabel = String(loc3);
        }

      } catch (eLast) {
        console.error("[SYNC-B:view] lastDay HUD build error:", eLast);
      }

      // ★ OncePerDayToday / O.D.O.A 表示用の値を localStorage + window.__cscs_sync_state から組み立て
      var onceStateLabel = "未開始";
      var onceMeasureOkLabel = "-";
      var onceResultLabel = "-";
      var onceTodayDateLabel = "-";
      var onceQidLabel = (info && info.qid) ? info.qid : "-";
      var onceCountableLabel = "-";
      var onceRecordLabel = "-";
      var onceOdoaLabel = "-";

      try {
        // 今日(YYYY-MM-DD) は JST の「日付だけ」表示
        try {
          var now = new Date();
          var y = now.getFullYear();
          var m = String(now.getMonth() + 1).padStart(2, "0");
          var d = String(now.getDate()).padStart(2, "0");
          onceTodayDateLabel = String(y) + "-" + String(m) + "-" + String(d);
        } catch (_eDate) {
          onceTodayDateLabel = "-";
        }

        var stOnce = null;
        try { stOnce = window.__cscs_sync_state || null; } catch (_eSt) { stOnce = null; }

        // --- 何をしているか:
        //   今日の「計測済み判定」は唯一の参照元として window.__cscs_sync_state.oncePerDayToday だけを見る
        //   （localStorage の oncePerDayToday は HUD 判定に一切使わない）
        var serverOnceVal = null;
        var serverOnceDay = null;

        if (stOnce && stOnce.oncePerDayToday && typeof stOnce.oncePerDayToday === "object") {
          var s = stOnce.oncePerDayToday;
          if (typeof s.day === "number" && Number.isFinite(s.day)) {
            serverOnceDay = s.day;
          }
          if (s.results && typeof s.results === "object" && Object.prototype.hasOwnProperty.call(s.results, onceQidLabel)) {
            serverOnceVal = s.results[onceQidLabel];
          }
        }

        // --- 何をしているか:
        //   HUD 表示用の状態文字列を serverOnceVal だけで作る（フォールバックしない）
        if (serverOnceVal === "correct" || serverOnceVal === "wrong") {
          onceStateLabel = "計測済";
        } else {
          onceStateLabel = "未開始";
        }

        // --- 何をしているか:
        //   localの記録表示は “today 判定” の参照元から外すため、HUDでは常に "-" に固定
        onceRecordLabel = "-";

        // --- 何をしているか:
        //   結果表示も serverOnceVal のみ（フォールバックしない）
        if (serverOnceVal === "correct" || serverOnceVal === "wrong") {
          onceResultLabel = String(serverOnceVal);
        } else {
          onceResultLabel = "-";
        }

        // --- 何をしているか:
        //   計測OKは「serverOnceVal が存在するか」だけで決める（ローカル照合はしない）
        if (serverOnceVal === "correct" || serverOnceVal === "wrong") {
          onceMeasureOkLabel = "OK";
        } else {
          onceMeasureOkLabel = "NG";
        }

        // --- 何をしているか:
        //   すでに計測済みかどうかも唯一の参照元（serverOnceVal）だけで判定
        var alreadyCounted = false;
        if (serverOnceVal === "correct" || serverOnceVal === "wrong") {
          alreadyCounted = true;
        }

        // --- 何をしているか:
        //   VERIFYモードは常に count対象 NO（ガード）
        var verifyModeOn =
          typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";

        // --- 何をしているか:
        //   ODOAモードは唯一の参照元 window.CSCS_ODOA_MODE（"on"/"off"）のみを見る
        var odoaRaw = null;
        try {
          if (typeof window.CSCS_ODOA_MODE === "string") {
            odoaRaw = window.CSCS_ODOA_MODE;
          }
        } catch (_eOdoaPick) {
          odoaRaw = null;
        }

        var odoaLower = "";
        try {
          odoaLower = (odoaRaw == null ? "" : String(odoaRaw)).trim().toLowerCase();
        } catch (_eOdoaLower) {
          odoaLower = "";
        }

        // --- 何をしているか:
        //   "on"/"off" 以外は未知扱いにせず OFF に寄せる（参照元は変えない）
        var odoaIsOn = (odoaLower === "on");

        // --- 何をしているか:
        //   count対象は「計測済」「VERIFY」「ODOA」で No、それ以外のみ Yes
        if (alreadyCounted) {
          onceCountableLabel = "No（計測済）";
        } else if (verifyModeOn) {
          onceCountableLabel = "No（ガード）";
        } else if (odoaIsOn) {
          onceCountableLabel = "No（ガード）";
        } else {
          onceCountableLabel = "Yes（未計測）";
        }

        // --- 何をしているか:
        //   ODOA行の末尾ステータスは「oncePerDayToday の結果」だけを採用（フォールバックしない）
        var odoaResultSuffix = "nocount";
        if (serverOnceVal === "correct") {
          odoaResultSuffix = "Correct";
        } else if (serverOnceVal === "wrong") {
          odoaResultSuffix = "Wrong";
        }

        // --- 何をしているか:
        //   VERIFY/ODOA は累計加算 No として表示する（ガード理由の明示）
        var addNo = false;
        if (verifyModeOn) addNo = true;
        if (odoaIsOn) addNo = true;

        if (odoaIsOn) {
          onceOdoaLabel = "ON（累計加算: " + (addNo ? "No" : "Yes") + "）  " + odoaResultSuffix;
        } else {
          onceOdoaLabel = "OFF（累計加算: Yes）  " + odoaResultSuffix;
        }
      } catch (_eOnceAll) {
        onceStateLabel = "未開始";
        onceMeasureOkLabel = "-";
        onceResultLabel = "-";
        onceTodayDateLabel = "-";
        onceQidLabel = (info && info.qid) ? info.qid : "-";
        onceCountableLabel = "-";
        onceRecordLabel = "-";
        onceOdoaLabel = "-";
      }

      // ★ グリッド描画用モデル（2列：label / value）
      updateSyncBodyGrid({
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,

        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,

        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,

        serverProgress: serverProgress,
        localProgress: localProgress,
        diffProgress: diffProgress,

        serverStreak3Wrong: serverStreak3Wrong,
        localStreak3Wrong: localStreak3Wrong,
        diffStreak3Wrong: diffStreak3Wrong,

        serverWrongStreakLen: serverWrongStreakLen,
        localWrongStreakLen: localWrongStreakLen,
        diffWrongStreakLen: diffWrongStreakLen,

        serverWrongProgress: serverWrongProgress,
        localWrongProgress: localWrongProgress,
        diffWrongProgress: diffWrongProgress,

        s3TodayDayLabel: s3TodayDayLabel,
        s3TodaySyncCnt: s3TodaySyncCnt,
        localS3TodayCnt: localS3TodayCnt,

        s3WrongTodayDayLabel: s3WrongTodayDayLabel,
        s3WrongTodaySyncCnt: s3WrongTodaySyncCnt,
        localS3WrongTodayCnt: localS3WrongTodayCnt,

        // ★ Pending 詳細表示用：qids（SYNC / local）
        s3TodaySyncQids: s3TodaySyncQids,
        localS3TodayQids: localS3TodayQids,
        s3WrongTodaySyncQids: s3WrongTodaySyncQids,
        localS3WrongTodayQids: localS3WrongTodayQids,

        lastSeenSyncLabel: lastSeenSyncLabel,
        lastCorrectSyncLabel: lastCorrectSyncLabel,
        lastWrongSyncLabel: lastWrongSyncLabel,

        lastSeenLocalLabel: lastSeenLocalLabel,
        lastCorrectLocalLabel: lastCorrectLocalLabel,
        lastWrongLocalLabel: lastWrongLocalLabel,

        pending: (payload && payload.pending) ? payload.pending : null,

        onceStateLabel: onceStateLabel,
        onceMeasureOkLabel: onceMeasureOkLabel,
        onceResultLabel: onceResultLabel,
        onceTodayDateLabel: onceTodayDateLabel,
        onceQidLabel: onceQidLabel,
        onceCountableLabel: onceCountableLabel,
        onceRecordLabel: onceRecordLabel,
        onceOdoaLabel: onceOdoaLabel,

        // ★ 追加: b_judge_record.js 由来のローカル計測（最高連続正解数 / 更新日）
        localCorrectStreakMax: localCorrectStreakMax,
        localCorrectStreakMaxDayLabel: localCorrectStreakMaxDayLabel,

        // ★ 追加: b_judge_record.js 由来のローカル計測（最高連続不正解数 / 達成日）
        localWrongStreakMax: localWrongStreakMax,
        localWrongStreakMaxDayLabel: localWrongStreakMaxDayLabel
      });

      // ★ ここから O.D.O.A Mode 表示専用ロジック

      // デフォルトは OFF とし、/api/sync/state の otoa_mode を参照して上書き
      var odoaModeText = "OFF";
      try {
        var state = window.__cscs_sync_state || null;
        var rawMode = null;

        // 1) payload 経由の odoaModeText があれば優先
        if (payload && typeof payload.odoaModeText === "string" && payload.odoaModeText) {
          rawMode = payload.odoaModeText;
        } else if (state && typeof state.odoa_mode === "string") {
          // 2) SYNC state のトップレベルキー odoa_mode
          rawMode = state.odoa_mode;
        }

        if (rawMode === "ON" || rawMode === "on") {
          odoaModeText = "ON";
        } else if (rawMode === "OFF" || rawMode === "off") {
          odoaModeText = "OFF";
        } else if (rawMode === "on ") {
          odoaModeText = "ON";
        }
      } catch (_ignore) {
        odoaModeText = "OFF";
      }

      // ★ パネルに出す最終文字列（「O.D.O.A Mode : ON correct」など）
      //   - payload.odoaStatusText が "__keep__" のときは前回表示を維持
      //   - それ以外の文字列のときはその文字列で更新
      //   - 空や未指定のときはモードからデフォルト文字列を組み立てる
      var odoaStatusText = "";
      var rawStatusFromPayload = "";
      if (payload && typeof payload.odoaStatusText === "string") {
        rawStatusFromPayload = payload.odoaStatusText;
      }

      if (rawStatusFromPayload === "__keep__") {
        // 前回の HUD 表示をそのまま使う
        if (LAST_ODOA_STATUS) {
          odoaStatusText = LAST_ODOA_STATUS;
          console.log("[SYNC-B] ODOA HUD status kept as-is:", odoaStatusText);
        } else {
          // まだ一度も表示していない場合はモードから初期値を作る
          odoaStatusText = "O.D.O.A Mode : " + odoaModeText;
          LAST_ODOA_STATUS = odoaStatusText;
          console.log("[SYNC-B] ODOA HUD status initialized (no previous):", odoaStatusText);
        }
      } else if (rawStatusFromPayload) {
        // 新しいステータス文字列に更新
        odoaStatusText = rawStatusFromPayload;
        LAST_ODOA_STATUS = odoaStatusText;
        console.log("[SYNC-B] ODOA HUD status updated from payload:", odoaStatusText);
      } else {
        // 明示指定なし → モードからデフォルトを生成して保存
        odoaStatusText = "O.D.O.A Mode : " + odoaModeText;
        LAST_ODOA_STATUS = odoaStatusText;
        console.log("[SYNC-B] ODOA HUD status set from mode:", odoaStatusText);
      }

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        statusDiv.textContent = odoaStatusText;
      }

      // 内部用の statusText はログとして残すだけ
      if (statusText) {
        console.log("[SYNC-B] statusText (internal):", statusText);
      }
    } catch (e) {
      var errorText = "SYNC(B) " + info.qid + "  error: " + (e && e.message ? e.message : e);
      updateSyncBodyText(errorText);

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        // エラー時もフォーマットは崩さず OFF として出す
        statusDiv.textContent = "O.D.O.A Mode : OFF";
      }

      console.error("[SYNC-B] renderPanel error:", e);
    }
  }

  async function sendDiffToServer(box, params) {
    var qid = info.qid;

    // ★ 手動送信の強制フラグ
    //   - ボタン押下直後（2秒以内）なら forceSend=true 扱い
    //   - params.forceSend === true が明示されていればそれも優先
    var forceSend = false;
    try {
      if (params && params.forceSend === true) {
        forceSend = true;
      } else {
        var ts = window.__cscs_sync_b_manual_send_ts || 0;
        if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
          if ((Date.now() - ts) <= 2000) {
            forceSend = true;
          }
        }
      }
    } catch (_eForce) {
      forceSend = false;
    }

    // ====== ① 各種 diff / local / server 値を受け取る ======
    // params は refreshAndSend() 側で作られた「同期前の状態比較」結果
    var diffCorrect = params.diffCorrect;      // local - server の「正解」増分
    var diffWrong = params.diffWrong;          // local - server の「不正解」増分
    var diffStreak3 = params.diffStreak3 || 0; // local streak3 達成の増分（3連続正解の+1）
    var diffStreakLen = params.diffStreakLen || 0;
    // ★ 不正解側: 3連続不正解の増分と、連続不正解長の差分（0 以上の増分）
    var diffStreak3Wrong = params.diffStreak3Wrong || 0;
    var diffWrongStreakLen = params.diffWrongStreakLen || 0;

    var localCorrect = params.localCorrect;    // localStorage 側の正解累計値
    var localWrong = params.localWrong;        // localStorage 側の不正解累計値
    var localStreak3 = params.localStreak3 || 0;
    var localStreakLen = params.localStreakLen || 0;
    // ★ 不正解側: localStorage の 3連続不正解回数 / 連続不正解長
    var localStreak3Wrong = params.localStreak3Wrong || 0;
    var localWrongStreakLen = params.localWrongStreakLen || 0;

    var serverCorrect = params.serverCorrect;  // サーバー側 snapshot の正解累計
    var serverWrong = params.serverWrong;
    var serverStreak3 = params.serverStreak3 || 0;
    var serverStreakLen = params.serverStreakLen || 0;
    // ★ 不正解側: サーバー側 snapshot の 3連続不正解回数 / 連続不正解長
    var serverStreak3Wrong = params.serverStreak3Wrong || 0;
    var serverWrongStreakLen = params.serverWrongStreakLen || 0;

    // ★ コンソールで送信前の不正解ストリーク状態を確認できるようにログ出力
    console.log("[SYNC-B] sendDiffToServer: wrong-streak params", {
      qid: qid,
      diffStreak3Wrong: diffStreak3Wrong,
      diffWrongStreakLen: diffWrongStreakLen,
      localStreak3Wrong: localStreak3Wrong,
      localWrongStreakLen: localWrongStreakLen,
      serverStreak3Wrong: serverStreak3Wrong,
      serverWrongStreakLen: serverWrongStreakLen
    });

    // ★ 何をしているか:
    //   ODOAモードは唯一の参照元 window.CSCS_ODOA_MODE（"on"/"off"）のみを見る（params には依存しない）
    var odoaModeText = "OFF";
    try {
      var t = (typeof window.CSCS_ODOA_MODE === "string" ? window.CSCS_ODOA_MODE : "").trim().toLowerCase();
      if (t === "on") {
        odoaModeText = "ON";
      } else if (t === "off") {
        odoaModeText = "OFF";
      }
    } catch (_eOdoaModeText) {
      odoaModeText = "OFF";
    }

    // ★ 追加: /api/sync/state の snapshot を受け取り、
    //    そこから oncePerDayTodayDelta / 最終日 Delta を構築するために利用する
    var syncState = params.syncState || null;

    // ★ 追加: oncePerDayTodayDelta を事前に構築しておく
    //   - 差分が無ければ null
    //   - 何かあれば { day, results } を返す
    var oncePerDayDelta = buildOncePerDayTodayDelta(syncState);

    // ★ 追加: 最終学習日・最終正解日・最終不正解日の local / server を取得し、差分の有無を判定
    var localLastSeenDay = readDayFromLocalStorage("cscs_q_last_seen_day:" + qid);
    var localLastCorrectDay = readDayFromLocalStorage("cscs_q_last_correct_day:" + qid);
    var localLastWrongDay = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qid);

    var serverLastSeenDay = null;
    var serverLastCorrectDay = null;
    var serverLastWrongDay = null;

    if (syncState) {
      if (syncState.lastSeenDay && typeof syncState.lastSeenDay === "object" && syncState.lastSeenDay[qid] != null) {
        var sSeen = syncState.lastSeenDay[qid];
        if (typeof sSeen === "number" && Number.isFinite(sSeen) && sSeen > 0) {
          serverLastSeenDay = sSeen;
        }
      }
      if (syncState.lastCorrectDay && typeof syncState.lastCorrectDay === "object" && syncState.lastCorrectDay[qid] != null) {
        var sCor = syncState.lastCorrectDay[qid];
        if (typeof sCor === "number" && Number.isFinite(sCor) && sCor > 0) {
          serverLastCorrectDay = sCor;
        }
      }
      if (syncState.lastWrongDay && typeof syncState.lastWrongDay === "object" && syncState.lastWrongDay[qid] != null) {
        var sWrong = syncState.lastWrongDay[qid];
        if (typeof sWrong === "number" && Number.isFinite(sWrong) && sWrong > 0) {
          serverLastWrongDay = sWrong;
        }
      }
    }

    var hasLastSeenDayDiff = localLastSeenDay !== null && localLastSeenDay !== serverLastSeenDay;
    var hasLastCorrectDayDiff = localLastCorrectDay !== null && localLastCorrectDay !== serverLastCorrectDay;
    var hasLastWrongDayDiff = localLastWrongDay !== null && localLastWrongDay !== serverLastWrongDay;

    if (hasLastSeenDayDiff || hasLastCorrectDayDiff || hasLastWrongDayDiff) {
      console.log("[SYNC-B] lastDay diff detected", {
        qid: qid,
        localLastSeenDay: localLastSeenDay,
        serverLastSeenDay: serverLastSeenDay,
        localLastCorrectDay: localLastCorrectDay,
        serverLastCorrectDay: serverLastCorrectDay,
        localLastWrongDay: localLastWrongDay,
        serverLastWrongDay: serverLastWrongDay
      });
    }

    // ★ 何をしているか:
    //   HUD再描画などで suppressDiffSend が立っている場合でも、
    //   diff が非ゼロなら「送信は抑止しない」方針に寄せる。
    //   つまり suppressDiffSend は「diff がゼロのときだけ return」できる。
    var suppressDiffSend = false;
    try {
      suppressDiffSend = !!(params && params.suppressDiffSend);
    } catch (_eSuppressPick) {
      suppressDiffSend = false;
    }

    // ★ 何をしているか:
    //   送るべき差分が“完全にゼロ”かどうかを 1 個の真偽値に集約する。
    //   （forceSend は別枠なので、ここでは forceSend の判定式と同等条件にしている）
    var diffIsZero =
      (!forceSend &&
       diffCorrect <= 0 &&
       diffWrong <= 0 &&
       diffStreak3 <= 0 &&
       diffStreak3Wrong <= 0 &&
       localStreakLen === serverStreakLen &&
       localWrongStreakLen === serverWrongStreakLen &&
       !oncePerDayDelta &&
       !hasLastSeenDayDiff &&
       !hasLastCorrectDayDiff &&
       !hasLastWrongDayDiff);

    // ★ 何をしているか:
    //   suppressDiffSend が true の場合でも、
    //   diffIsZero のときだけ return（＝HUD再描画由来の無駄送信を止める）。
    //   diffIsZero が false のときは「抑止せず送信へ進む」ことをログで保証する。
    if (suppressDiffSend && diffIsZero) {
      console.log("[SYNC-B] suppressDiffSend=ON & diffIsZero=TRUE → return (send suppressed)", {
        qid: qid,
        suppressDiffSend: suppressDiffSend,
        diffIsZero: diffIsZero
      });
      return;
    }

    if (suppressDiffSend && !diffIsZero) {
      console.log("[SYNC-B] suppressDiffSend=ON but diffIsZero=FALSE → continue (send NOT suppressed)", {
        qid: qid,
        suppressDiffSend: suppressDiffSend,
        diffIsZero: diffIsZero,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        diffStreak3: diffStreak3,
        diffStreak3Wrong: diffStreak3Wrong,
        localStreakLen: localStreakLen,
        serverStreakLen: serverStreakLen,
        localWrongStreakLen: localWrongStreakLen,
        serverWrongStreakLen: serverWrongStreakLen,
        hasOncePerDayDelta: !!oncePerDayDelta,
        hasLastSeenDayDiff: hasLastSeenDayDiff,
        hasLastCorrectDayDiff: hasLastCorrectDayDiff,
        hasLastWrongDayDiff: hasLastWrongDayDiff
      });
    }

    // ====== ② diff が存在しない場合は SYNC を送らず終了 ======
    // ・diffCorrect / diffWrong / diffStreak3 / diffStreak3Wrong が 0 以下
    // ・かつ streakLen / streakWrongLen が server と同じ
    // ・かつ oncePerDayDelta が null
    // ・かつ lastSeen / lastCorrect / lastWrong に差分が無い
    //
    // → 「今回は送るべき更新が何もない」ので、
    //    HUD パネルの表示だけ更新して return する。
    if (diffIsZero) {

      var odoaStatusTextForPanel;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanel = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanel = "O.D.O.A Mode : OFF";
      }

      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "no diff (送信なし) / oncePerDayToday: 計測なし",
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanel
      });
      return;
    }

    // ====== ③ オフライン時は送れないため「未送信」ステータスで終了 ======
    if (!navigator.onLine) {
      var offlineOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
      var odoaStatusTextForPanelOffline;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanelOffline = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanelOffline = "O.D.O.A Mode : OFF";
      }
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "offline (未送信) / " + offlineOncePerDayStatus,
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanelOffline
      });
      return;
    }

    // ====== ④ 各 delta オブジェクトを作る（送信する差分を構築） ======
    // * diffCorrect, diffWrong, diffStreak3 等は「増分として送る」
    // * streakLenDelta / streakWrongLenDelta / last*DayDelta は「最新値で上書きする」
    var correctDeltaObj = {};
    var incorrectDeltaObj = {};
    var streak3DeltaObj = {};
    var streakLenDeltaObj = {};
    var streak3WrongDeltaObj = {};
    var streakWrongLenDeltaObj = {};
    var lastSeenDayDeltaObj = {};
    var lastCorrectDayDeltaObj = {};
    var lastWrongDayDeltaObj = {};

    if (diffCorrect > 0) {
      correctDeltaObj[qid] = diffCorrect;
    }
    if (diffWrong > 0) {
      incorrectDeltaObj[qid] = diffWrong;
    }
    if (diffStreak3 > 0) {
      streak3DeltaObj[qid] = diffStreak3;
    }
    // ★ 不正解側: 3連続不正解の増分があれば delta として送信
    if (diffStreak3Wrong > 0) {
      streak3WrongDeltaObj[qid] = diffStreak3Wrong;
      console.log("[SYNC-B] streak3WrongDelta set:", {
        qid: qid,
        diffStreak3Wrong: diffStreak3Wrong
      });
    }

    // ====== ⑤ streakLenDelta（連続正解長）の扱い ======
    // ★ local と server が同じ連続正解長なら送らない（ノイズ防止）
    // ★ local と server が違う場合のみ「値そのもの」を送る
    //
    // ※ streakLenDelta は「増分」ではなく「セットする最新値」
    if (localStreakLen !== serverStreakLen) {
      streakLenDeltaObj[qid] = localStreakLen;
      console.log("[SYNC-B] streakLenDelta set (local != server):", {
        qid: qid,
        localStreakLen: localStreakLen,
        serverStreakLen: serverStreakLen
      });
    } else {
      console.log("[SYNC-B] streakLenDelta not set (local == server):", {
        qid: qid,
        localStreakLen: localStreakLen,
        serverStreakLen: serverStreakLen
      });
    }

    // ★ 不正解側: streakWrongLenDelta（連続不正解長）の扱い
    //   - local と server が同じ連続不正解長なら送らない
    //   - 違う場合のみ「最新値」として送る
    if (localWrongStreakLen !== serverWrongStreakLen) {
      streakWrongLenDeltaObj[qid] = localWrongStreakLen;
      console.log("[SYNC-B] streakWrongLenDelta set (local != server):", {
        qid: qid,
        localWrongStreakLen: localWrongStreakLen,
        serverWrongStreakLen: serverWrongStreakLen
      });
    } else {
      console.log("[SYNC-B] streakWrongLenDelta not set (local == server):", {
        qid: qid,
        localWrongStreakLen: localWrongStreakLen,
        serverWrongStreakLen: serverWrongStreakLen
      });
    }

    // ★ 最終日情報: local と server が異なる場合のみ「最新日付」で上書きする Delta を付与
    if (hasLastSeenDayDiff && localLastSeenDay !== null) {
      lastSeenDayDeltaObj[qid] = localLastSeenDay;
      console.log("[SYNC-B] lastSeenDayDelta set:", {
        qid: qid,
        localLastSeenDay: localLastSeenDay,
        serverLastSeenDay: serverLastSeenDay
      });
    }
    if (hasLastCorrectDayDiff && localLastCorrectDay !== null) {
      lastCorrectDayDeltaObj[qid] = localLastCorrectDay;
      console.log("[SYNC-B] lastCorrectDayDelta set:", {
        qid: qid,
        localLastCorrectDay: localLastCorrectDay,
        serverLastCorrectDay: serverLastCorrectDay
      });
    }
    if (hasLastWrongDayDiff && localLastWrongDay !== null) {
      lastWrongDayDeltaObj[qid] = localLastWrongDay;
      console.log("[SYNC-B] lastWrongDayDelta set:", {
        qid: qid,
        localLastWrongDay: localLastWrongDay,
        serverLastWrongDay: serverLastWrongDay
      });
    }

    // ====== ⑥ 上記 delta 群をまとめて payload を構築 ======
    var payload = {
      correctDelta:  correctDeltaObj,
      incorrectDelta: incorrectDeltaObj,
      streak3Delta:  streak3DeltaObj,
      streakLenDelta: streakLenDeltaObj,            // streakLen は上書き
      streak3WrongDelta: streak3WrongDeltaObj,      // 不正解側 3連続の増分
      streakWrongLenDelta: streakWrongLenDeltaObj,  // 不正解側 連続長の最新値
      lastSeenDayDelta: lastSeenDayDeltaObj,        // 最終学習日
      lastCorrectDayDelta: lastCorrectDayDeltaObj,  // 最終正解日
      lastWrongDayDelta: lastWrongDayDeltaObj,      // 最終不正解日
      updatedAt: Date.now()                         // クライアント側での更新時刻
    };

    // ★ 追加: 総問題数（cscs_total_questions）を global.totalQuestions として付与
    //   - b_judge_record.js が manifest.json から算出・保存した値を唯一のソースとする
    //   - 正の整数が得られた場合のみ payload に含める
    var totalQuestions = readTotalQuestionsFromLocalStorage();
    if (totalQuestions !== null) {
      if (!payload.global || typeof payload.global !== "object") {
        payload.global = {};
      }
      payload.global.totalQuestions = totalQuestions;
      console.log("[SYNC-B] attach global.totalQuestions to payload:", {
        totalQuestions: totalQuestions
      });
    }

    // ★ 追加: oncePerDayTodayDelta がある場合は payload に付与
    if (oncePerDayDelta) {
      payload.oncePerDayTodayDelta = oncePerDayDelta;
      console.log("[SYNC-B] oncePerDayTodayDelta attached to payload:", oncePerDayDelta);
    }

    // ★ payload に有効な delta が 1つも無い場合は、
    //    「2回目 save 由来のノイズ送信」とみなして fetch 自体を行わないガード
    //    （ここを通らなかった＝実際に送信された、というのがログで確認できる）
    var hasCorrectDeltaInPayload = Object.prototype.hasOwnProperty.call(correctDeltaObj, qid);
    var hasIncorrectDeltaInPayload = Object.prototype.hasOwnProperty.call(incorrectDeltaObj, qid);
    var hasStreak3DeltaInPayload = Object.prototype.hasOwnProperty.call(streak3DeltaObj, qid);
    var hasStreakLenDeltaInPayload = Object.prototype.hasOwnProperty.call(streakLenDeltaObj, qid);
    var hasStreak3WrongDeltaInPayload = Object.prototype.hasOwnProperty.call(streak3WrongDeltaObj, qid);
    var hasStreakWrongLenDeltaInPayload = Object.prototype.hasOwnProperty.call(streakWrongLenDeltaObj, qid);
    var hasLastSeenDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastSeenDayDeltaObj, qid);
    var hasLastCorrectDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastCorrectDayDeltaObj, qid);
    var hasLastWrongDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastWrongDayDeltaObj, qid);
    var hasOncePerDayDeltaInPayload = !!oncePerDayDelta;
    var hasGlobalTotalQuestionsInPayload =
      !!(payload.global &&
         typeof payload.global === "object" &&
         Object.prototype.hasOwnProperty.call(payload.global, "totalQuestions"));

    if (
      !forceSend &&
      !hasCorrectDeltaInPayload &&
      !hasIncorrectDeltaInPayload &&
      !hasStreak3DeltaInPayload &&
      !hasStreakLenDeltaInPayload &&
      !hasStreak3WrongDeltaInPayload &&
      !hasStreakWrongLenDeltaInPayload &&
      !hasLastSeenDayDeltaInPayload &&
      !hasLastCorrectDayDeltaInPayload &&
      !hasLastWrongDayDeltaInPayload &&
      !hasOncePerDayDeltaInPayload &&
      !hasGlobalTotalQuestionsInPayload
    ) {
      console.log("[SYNC-B] ★送信スキップ（payload に有効な delta が無いため）", {
        qid: qid,
        payload: payload
      });

      // oncePerDayToday 用の delta も payload に含まれていないため「oncePerDayToday: 計測なし」として扱う
      // パネル側にも「送信していない」ことが分かるようステータスを反映
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "no delta in payload (送信スキップ) / oncePerDayToday: 計測なし",
        odoaModeText: odoaModeText
      });
      return;
    }

    // ★ 手動送信の場合：差分がゼロでも「送信ボタン押下」をサーバへ必ず到達させる
    //   - 既存の delta 仕様は壊さず、追加フィールドだけ付与する
    if (forceSend) {
      payload.forceSend = true;
      payload.forceReason = "manual_button";
      payload.forceQid = qid;
      console.log("[SYNC-B] forceSend ON → send request even if no delta", {
        qid: qid
      });
    }

    console.log("[SYNC-B] sending diff payload:", payload);

    try {
      var response = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // サーバーまで届かなかった／保存に失敗した可能性
      if (!response.ok) {
        console.error("[SYNC-B] server returned non-ok status:", response.status);
        var mergeErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
        var odoaStatusTextForPanelMergeError;
        if (odoaModeText === "ON") {
          odoaStatusTextForPanelMergeError = "O.D.O.A Mode : ON nocount";
        } else {
          odoaStatusTextForPanelMergeError = "O.D.O.A Mode : OFF";
        }
        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: "merge " + String(response.status) + " (サーバー保存エラーの可能性) / " + mergeErrorOncePerDayStatus,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelMergeError
        });
        return;
      }

      // ★ 何をしているか:
      //   POST が「ok」で返ってきた（＝HTTPレベルでは到達した）ことをログで確定させる
      console.log("[SYNC-B] POST ok → now fetchState before renderPanel", {
        qid: qid
      });

      // ★ 何をしているか:
      //   POST 完了後に /api/sync/state を取り直し、「最新state」を window.__cscs_sync_state に反映する
      var freshState = null;
      try {
        freshState = await fetchState();
        try {
          window.__cscs_sync_state = freshState;
        } catch (_eAssignFresh) {}

        console.log("[SYNC-B] fetchState ok (after POST) → window.__cscs_sync_state updated", {
          qid: qid,
          hasState: !!freshState
        });
      } catch (eFetchAfterPost) {
        console.error("[SYNC-B] fetchState failed (after POST) → renderPanel uses previous snapshot", {
          qid: qid,
          error: eFetchAfterPost
        });
        freshState = null;
      }

      // ★ 何をしているか:
      //   最新state（freshState優先。無ければ従来の params.server* を使用）からサーバ値を再確定する
      var serverCorrect2 = serverCorrect;
      var serverWrong2 = serverWrong;
      var serverStreak3_2 = serverStreak3;
      var serverStreakLen_2 = serverStreakLen;
      var serverStreak3Wrong2 = serverStreak3Wrong;
      var serverWrongStreakLen2 = serverWrongStreakLen;

      try {
        if (freshState) {
          if (freshState.correct && typeof freshState.correct === "object" && freshState.correct[qid] != null) {
            if (typeof freshState.correct[qid] === "number" && Number.isFinite(freshState.correct[qid]) && freshState.correct[qid] >= 0) {
              serverCorrect2 = freshState.correct[qid];
            }
          }
          if (freshState.incorrect && typeof freshState.incorrect === "object" && freshState.incorrect[qid] != null) {
            if (typeof freshState.incorrect[qid] === "number" && Number.isFinite(freshState.incorrect[qid]) && freshState.incorrect[qid] >= 0) {
              serverWrong2 = freshState.incorrect[qid];
            }
          }
          if (freshState.streak3 && typeof freshState.streak3 === "object" && freshState.streak3[qid] != null) {
            if (typeof freshState.streak3[qid] === "number" && Number.isFinite(freshState.streak3[qid]) && freshState.streak3[qid] >= 0) {
              serverStreak3_2 = freshState.streak3[qid];
            }
          }
          if (freshState.streakLen && typeof freshState.streakLen === "object" && freshState.streakLen[qid] != null) {
            if (typeof freshState.streakLen[qid] === "number" && Number.isFinite(freshState.streakLen[qid]) && freshState.streakLen[qid] >= 0) {
              serverStreakLen_2 = freshState.streakLen[qid];
            }
          }
          if (freshState.streak3Wrong && typeof freshState.streak3Wrong === "object" && freshState.streak3Wrong[qid] != null) {
            if (typeof freshState.streak3Wrong[qid] === "number" && Number.isFinite(freshState.streak3Wrong[qid]) && freshState.streak3Wrong[qid] >= 0) {
              serverStreak3Wrong2 = freshState.streak3Wrong[qid];
            }
          }
          if (freshState.streakWrongLen && typeof freshState.streakWrongLen === "object" && freshState.streakWrongLen[qid] != null) {
            if (typeof freshState.streakWrongLen[qid] === "number" && Number.isFinite(freshState.streakWrongLen[qid]) && freshState.streakWrongLen[qid] >= 0) {
              serverWrongStreakLen2 = freshState.streakWrongLen[qid];
            }
          }
        }
      } catch (ePickFresh) {
        console.error("[SYNC-B] pick server values from freshState failed:", ePickFresh);
      }

      // ★ 何をしているか:
      //   最新の server 値で diff を再計算し、HUDの「送信後の見た目」を確実に最新化する
      var diffCorrect2 = Math.max(0, localCorrect - serverCorrect2);
      var diffWrong2 = Math.max(0, localWrong - serverWrong2);
      var diffStreak3_2 = Math.max(0, localStreak3 - serverStreak3_2);
      var diffStreakLen_2 = Math.max(0, localStreakLen - serverStreakLen_2);
      var diffStreak3Wrong2 = Math.max(0, localStreak3Wrong - serverStreak3Wrong2);
      var diffWrongStreakLen2 = Math.max(0, localWrongStreakLen - serverWrongStreakLen2);

      // ★ 何をしているか:
      //   Pending（未反映っぽい差分）も「最新state基準」で再計算して表示に反映する
      var pendingAfterPost = null;
      try {
        pendingAfterPost = computePendingFlags(freshState || (params && params.syncState ? params.syncState : null), qid);
      } catch (_ePendingAfterPost) {
        pendingAfterPost = null;
      }

      console.log("[SYNC-B] after POST → server snapshot refreshed", {
        qid: qid,
        serverCorrect: serverCorrect2,
        serverWrong: serverWrong2,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect2,
        diffWrong: diffWrong2,
        pending: pendingAfterPost
      });

      // ★ 何をしているか:
      //   POST完了→fetchState完了（または失敗）後に renderPanel を呼び、表示更新の順序を確定させる
      renderPanel(box, {
        serverCorrect: serverCorrect2,
        serverWrong: serverWrong2,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect2,
        diffWrong: diffWrong2,
        serverStreak3: serverStreak3_2,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3_2,
        serverStreakLen: serverStreakLen_2,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen_2,
        statusText: "POST ok → fetchState → renderPanel",
        pending: pendingAfterPost,
        odoaModeText: odoaModeText,
        odoaStatusText: "__keep__"
      });

      var data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      console.log("[SYNC-B] sync success:", data);

      // merge のレスポンスから「サーバーに保存された値」を拾う
      var newServerCorrect = serverCorrect;
      var newServerWrong = serverWrong;
      var newServerStreak3 = serverStreak3;
      var newServerStreakLen = serverStreakLen;
      var newServerStreak3Wrong = serverStreak3Wrong;
      var newServerWrongStreakLen = serverWrongStreakLen;

      if (data && data.correct && typeof data.correct === "object" && data.correct !== null) {
        if (Object.prototype.hasOwnProperty.call(data.correct, qid)) {
          var cVal = data.correct[qid];
          if (typeof cVal === "number" && Number.isFinite(cVal) && cVal >= 0) {
            newServerCorrect = cVal;
          }
        }
      }

      if (data && data.incorrect && typeof data.incorrect === "object" && data.incorrect !== null) {
        if (Object.prototype.hasOwnProperty.call(data.incorrect, qid)) {
          var wVal = data.incorrect[qid];
          if (typeof wVal === "number" && Number.isFinite(wVal) && wVal >= 0) {
            newServerWrong = wVal;
          }
        }
      }

      if (data && data.streak3 && typeof data.streak3 === "object" && data.streak3 !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streak3, qid)) {
          var sVal = data.streak3[qid];
          if (typeof sVal === "number" && Number.isFinite(sVal) && sVal >= 0) {
            newServerStreak3 = sVal;
          }
        }
      }

      if (data && data.streakLen && typeof data.streakLen === "object" && data.streakLen !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streakLen, qid)) {
          var slVal = data.streakLen[qid];
          if (typeof slVal === "number" && Number.isFinite(slVal) && slVal >= 0) {
            newServerStreakLen = slVal;
          }
        }
      }

      // ★ 不正解側: merge レスポンスの streak3Wrong / streakWrongLen も拾う
      if (data && data.streak3Wrong && typeof data.streak3Wrong === "object" && data.streak3Wrong !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streak3Wrong, qid)) {
          var s3wVal = data.streak3Wrong[qid];
          if (typeof s3wVal === "number" && Number.isFinite(s3wVal) && s3wVal >= 0) {
            newServerStreak3Wrong = s3wVal;
          }
        }
      }

      if (data && data.streakWrongLen && typeof data.streakWrongLen === "object" && data.streakWrongLen !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streakWrongLen, qid)) {
          var slwVal = data.streakWrongLen[qid];
          if (typeof slwVal === "number" && Number.isFinite(slwVal) && slwVal >= 0) {
            newServerWrongStreakLen = slwVal;
          }
        }
      }

      var newDiffCorrect = Math.max(0, localCorrect - newServerCorrect);
      var newDiffWrong = Math.max(0, localWrong - newServerWrong);
      var newDiffStreak3 = Math.max(0, localStreak3 - newServerStreak3);
      var newDiffStreakLen = Math.max(0, localStreakLen - newServerStreakLen);
      var newDiffStreak3Wrong = Math.max(0, localStreak3Wrong - newServerStreak3Wrong);
      var newDiffWrongStreakLen = Math.max(0, localWrongStreakLen - newServerWrongStreakLen);

      // ★ merge 成功後に /api/sync/state を再取得して、
      //    「保存されたか」「state に反映されたか」を diff ベースで確認する
      try {
        var stateAfter = await fetchState();
        try {
          window.__cscs_sync_state = stateAfter;
        } catch (_e2) {}

        var refreshedServerCorrect = newServerCorrect;
        var refreshedServerWrong = newServerWrong;
        var refreshedServerStreak3 = newServerStreak3;
        var refreshedServerStreakLen = newServerStreakLen;
        var refreshedServerStreak3Wrong = newServerStreak3Wrong;
        var refreshedServerWrongStreakLen = newServerWrongStreakLen;

        if (stateAfter && stateAfter.correct && stateAfter.correct[qid] != null) {
          refreshedServerCorrect = stateAfter.correct[qid];
        }
        if (stateAfter && stateAfter.incorrect && stateAfter.incorrect[qid] != null) {
          refreshedServerWrong = stateAfter.incorrect[qid];
        }
        if (stateAfter && stateAfter.streak3 && stateAfter.streak3[qid] != null) {
          refreshedServerStreak3 = stateAfter.streak3[qid];
        }
        if (stateAfter && stateAfter.streakLen && stateAfter.streakLen[qid] != null) {
          refreshedServerStreakLen = stateAfter.streakLen[qid];
        }
        // ★ 不正解側: stateAfter.streak3Wrong / streakWrongLen も確認
        if (stateAfter && stateAfter.streak3Wrong && stateAfter.streak3Wrong[qid] != null) {
          refreshedServerStreak3Wrong = stateAfter.streak3Wrong[qid];
        }
        if (stateAfter && stateAfter.streakWrongLen && stateAfter.streakWrongLen[qid] != null) {
          refreshedServerWrongStreakLen = stateAfter.streakWrongLen[qid];
        }

        var refreshedDiffCorrect = Math.max(0, localCorrect - refreshedServerCorrect);
        var refreshedDiffWrong = Math.max(0, localWrong - refreshedServerWrong);
        var refreshedDiffStreak3 = Math.max(0, localStreak3 - refreshedServerStreak3);
        var refreshedDiffStreakLen = Math.max(0, localStreakLen - refreshedServerStreakLen);
        var refreshedDiffStreak3Wrong = Math.max(0, localStreak3Wrong - refreshedServerStreak3Wrong);
        var refreshedDiffWrongStreakLen = Math.max(0, localWrongStreakLen - refreshedServerWrongStreakLen);

        // ★ console から不正解ストリークの同期状況を確認しやすくするログ
        console.log("[SYNC-B] wrong-streak after merge+state:", {
          qid: qid,
          refreshedServerStreak3Wrong: refreshedServerStreak3Wrong,
          localStreak3Wrong: localStreak3Wrong,
          refreshedDiffStreak3Wrong: refreshedDiffStreak3Wrong,
          refreshedServerWrongStreakLen: refreshedServerWrongStreakLen,
          localWrongStreakLen: localWrongStreakLen,
          refreshedDiffWrongStreakLen: refreshedDiffWrongStreakLen
        });

        var statusMsg = "merge ok / state synced (保存・反映完了)";
        if (
          refreshedDiffCorrect > 0 ||
          refreshedDiffWrong > 0 ||
          refreshedDiffStreak3 > 0 ||
          refreshedDiffStreakLen > 0 ||
          refreshedDiffStreak3Wrong > 0 ||
          refreshedDiffWrongStreakLen > 0
        ) {
          statusMsg = "merge ok / state に未反映の差分あり";
        }

        // oncePerDayToday の状態（before / after）を見て、
        // ・first time correct  → ON correct
        // ・first time wrong    → ON wrong
        // ・それ以外（すでに回答済み）→ ON nocount
        var oncePerDayStatus = "oncePerDayToday: 計測なし";
        var prevOnceVal = null;
        var newOnceVal = null;
        var localOnceDay = null;

        try {
          var localOnce = readOncePerDayTodayFromLocal();
          localOnceDay = localOnce && typeof localOnce.day === "number" ? localOnce.day : null;

          if (oncePerDayDelta) {
            var syncedOncePerDay = false;
            if (stateAfter && stateAfter.oncePerDayToday && typeof stateAfter.oncePerDayToday === "object") {
              var sOnceAfter = stateAfter.oncePerDayToday;
              if (typeof sOnceAfter.day === "number" && (!localOnceDay || sOnceAfter.day === localOnceDay)) {
                syncedOncePerDay = true;
                var sResultsAfter = sOnceAfter.results || {};
                if (sResultsAfter && typeof sResultsAfter === "object" && Object.prototype.hasOwnProperty.call(sResultsAfter, qid)) {
                  newOnceVal = sResultsAfter[qid];
                }
              }
            }
            if (syncedOncePerDay) {
              oncePerDayStatus = "oncePerDayToday: 計測済";
            } else {
              oncePerDayStatus = "oncePerDayToday: 計測エラー";
            }
          } else {
            oncePerDayStatus = "oncePerDayToday: 計測なし";
          }

          if (syncState && syncState.oncePerDayToday && typeof syncState.oncePerDayToday === "object") {
            var sOnceBefore = syncState.oncePerDayToday;
            if (typeof sOnceBefore.day === "number" && (!localOnceDay || sOnceBefore.day === localOnceDay)) {
              var sResultsBefore = sOnceBefore.results || {};
              if (sResultsBefore && typeof sResultsBefore === "object" && Object.prototype.hasOwnProperty.call(sResultsBefore, qid)) {
                prevOnceVal = sResultsBefore[qid];
              }
            }
          }
        } catch (_eOnce) {
          oncePerDayStatus = "oncePerDayToday: 計測エラー";
        }

        statusMsg += " / " + oncePerDayStatus;

        // ★ O.D.O.A Mode ステータス文字列を確定
        //   - O.D.O.A Mode : ON correct
        //   - O.D.O.A Mode : ON wrong
        //   - O.D.O.A Mode : ON nocount
        //   - O.D.O.A Mode : OFF
        var odoaStatusTextForPanelAfter = "O.D.O.A Mode : OFF";
        if (odoaModeText === "ON") {
          var suffix = "nocount";
          if (prevOnceVal == null && (newOnceVal === "correct" || newOnceVal === "wrong")) {
            suffix = newOnceVal;
          }
          odoaStatusTextForPanelAfter = "O.D.O.A Mode : ON " + suffix;
        }

        renderPanel(box, {
          serverCorrect: refreshedServerCorrect,
          serverWrong: refreshedServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: refreshedDiffCorrect,
          diffWrong: refreshedDiffWrong,
          serverStreak3: refreshedServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: refreshedDiffStreak3,
          serverStreakLen: refreshedServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: refreshedDiffStreakLen,
          statusText: statusMsg,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelAfter
        });
      } catch (e2) {
        console.error("[SYNC-B] state refresh error after merge:", e2);

        var stateErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
        var odoaStatusTextForPanelStateError;
        if (odoaModeText === "ON") {
          odoaStatusTextForPanelStateError = "O.D.O.A Mode : ON nocount";
        } else {
          odoaStatusTextForPanelStateError = "O.D.O.A Mode : OFF";
        }
        renderPanel(box, {
          serverCorrect: newServerCorrect,
          serverWrong: newServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: newDiffCorrect,
          diffWrong: newDiffWrong,
          serverStreak3: newServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: newDiffStreak3,
          serverStreakLen: newServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: newDiffStreakLen,
          statusText: "merge ok / state 再取得エラー(保存は成功している可能性) / " + stateErrorOncePerDayStatus,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelStateError
        });
      }
    } catch (e) {
      console.error("[SYNC-B] fetch failed:", e);
      var networkErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
      var odoaStatusTextForPanelNetworkError;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanelNetworkError = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanelNetworkError = "O.D.O.A Mode : OFF";
      }
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "network error (送信失敗) / " + networkErrorOncePerDayStatus,
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanelNetworkError
      });
    }
  }

  function refreshAndSend(box, options) {
    // ★ options.suppressDiffSend === true のときは、
    //    sendDiffToServer() を呼ばずに HUD の表示更新だけ行うモード
    options = options || {};
    var suppressDiffSend = !!options.suppressDiffSend;

    fetchState()
      .then(function (state) {
        // ★ /api/sync/state の結果をグローバルへ保存して、
        //    renderPanel から streak3Today を正しく取得できるようにする
        try {
          window.__cscs_sync_state = state;
        } catch (_e) {}

        var serverCorrect = 0;
        var serverWrong = 0;
        var serverStreak3 = 0;
        var serverStreakLen = 0;
        var serverStreak3Wrong = 0;
        var serverWrongStreakLen = 0;

        if (state && state.correct && state.correct[info.qid] != null) {
          serverCorrect = state.correct[info.qid];
        }
        if (state && state.incorrect && state.incorrect[info.qid] != null) {
          serverWrong = state.incorrect[info.qid];
        }
        if (state && state.streak3 && state.streak3[info.qid] != null) {
          serverStreak3 = state.streak3[info.qid];
        }
        if (state && state.streakLen && state.streakLen[info.qid] != null) {
          serverStreakLen = state.streakLen[info.qid];
        }
        // ★ 不正解側: サーバーの 3連続不正解回数と現在の連続不正解長を取得
        if (state && state.streak3Wrong && state.streak3Wrong[info.qid] != null) {
          serverStreak3Wrong = state.streak3Wrong[info.qid];
        }
        if (state && state.streakWrongLen && state.streakWrongLen[info.qid] != null) {
          serverWrongStreakLen = state.streakWrongLen[info.qid];
        }

        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);
        // ★ 不正解側: localStorage の 3連続不正解回数と現在の連続不正解長を取得
        var localStreak3Wrong = readIntFromLocalStorage("cscs_q_wrong_streak3_total:" + info.qid);
        var localWrongStreakLen = readIntFromLocalStorage("cscs_q_wrong_streak_len:" + info.qid);

        var diffCorrect = Math.max(0, localCorrect - serverCorrect);
        var diffWrong = Math.max(0, localWrong - serverWrong);
        var diffStreak3 = Math.max(0, localStreak3 - serverStreak3);
        var diffStreakLen = Math.max(0, localStreakLen - serverStreakLen);
        // ★ 不正解側: SYNC と local の差分（0 以上の増分）を計算
        var diffStreak3Wrong = Math.max(0, localStreak3Wrong - serverStreak3Wrong);
        var diffWrongStreakLen = Math.max(0, localWrongStreakLen - serverWrongStreakLen);

        // ★ コンソールで不正解ストリーク同期対象を確認できるようにログ出力
        console.log("[SYNC-B] wrong-streak diff (local vs server):", {
          qid: info.qid,
          serverStreak3Wrong: serverStreak3Wrong,
          localStreak3Wrong: localStreak3Wrong,
          diffStreak3Wrong: diffStreak3Wrong,
          serverWrongStreakLen: serverWrongStreakLen,
          localWrongStreakLen: localWrongStreakLen,
          diffWrongStreakLen: diffWrongStreakLen
        });

        // ★ 何をしているか:
        //   ODOAモードは唯一の参照元 window.CSCS_ODOA_MODE（"on"/"off"）のみを見る
        var odoaModeRaw = null;
        try {
          if (typeof window.CSCS_ODOA_MODE === "string") {
            odoaModeRaw = window.CSCS_ODOA_MODE;
          }
        } catch (_eOdoaModeRaw) {
          odoaModeRaw = null;
        }

        // ★ 何をしているか:
        //   HUDで使う表記を "ON"/"OFF" に正規化（他ソースへはフォールバックしない）
        var odoaModeText = "OFF";
        try {
          var t = (odoaModeRaw == null ? "" : String(odoaModeRaw)).trim().toLowerCase();
          if (t === "on") {
            odoaModeText = "ON";
          } else if (t === "off") {
            odoaModeText = "OFF";
          }
        } catch (_eOdoaModeText) {
          odoaModeText = "OFF";
        }

        console.log("[SYNC-B] detected O.D.O.A from window.CSCS_ODOA_MODE:", {
          odoaModeRaw: odoaModeRaw,
          odoaModeText: odoaModeText
        });

        var statusTextForRender = suppressDiffSend ? "__keep__" : "state ok";

        // ★ 自動検証モード（CSCS_VERIFY_MODE=on）のときは、
        //   b_judge_record.js と同じく「計測ガード中」であることが分かるように
        //   statusText に明示しておく（diff の送信自体は後段でブロックする）
        var verifyModeOn =
          typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
        if (!suppressDiffSend && verifyModeOn) {
          statusTextForRender = "state ok / verify-mode: 計測ガード中(diff送信なし)";
        }

        // 初期表示や diff 送信前の HUD:
        //   - suppressDiffSend===true のときは "__keep__" を渡し、既存表示を維持
        //   - 通常モードでは「ON nocount」/「OFF」で初期表示を行う
        var odoaStatusTextForPanelInit;
        if (suppressDiffSend) {
          odoaStatusTextForPanelInit = "__keep__";
          console.log("[SYNC-B] ODOA HUD: suppressDiffSend=true → '__keep__' で再描画要求");
        } else {
          if (odoaModeText === "ON") {
            odoaStatusTextForPanelInit = "O.D.O.A Mode : ON nocount";
          } else {
            odoaStatusTextForPanelInit = "O.D.O.A Mode : OFF";
          }
          console.log("[SYNC-B] ODOA HUD: initial status set from mode:", odoaStatusTextForPanelInit);
        }

        var pending = computePendingFlags(state, info.qid);
        pending.pendingDiffCounts = (diffCorrect > 0 || diffWrong > 0 || diffStreak3 > 0 || diffStreakLen > 0 || diffStreak3Wrong > 0 || diffWrongStreakLen > 0);

        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: statusTextForRender,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelInit,
          pending: pending
        });

        // ★ 何をしているか:
        //   localStorage 由来の OncePerDayToday / O.D.O.A Mode を「local専用カード」に反映する
        //   （SYNCカードとは独立した表示。diff送信の有無に関係なく、毎回更新する）
        refreshLocalOnceOdoaCard(box, {
          qid: info.qid,
          odoaModeText: odoaModeText
        });

        // ★ suppressDiffSend===true の場合は diff の POST を完全に止め、
        //    HUD 表示のみ更新した状態で終了する（手動 streak3Today テスト用）
        if (suppressDiffSend) {
          console.log("[SYNC-B] refreshAndSend: suppressDiffSend=true → diff POST を実行せず HUD 表示のみ更新", {
            qid: info.qid,
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            diffStreak3: diffStreak3,
            diffStreakLen: diffStreakLen,
            odoaModeText: odoaModeText
          });
          return;
        }

        // ★ 自動検証モード中（CSCS_VERIFY_MODE=on）は、
        //    b_judge_record.js と同様「計測ガード」として diff POST を完全にブロックする。
        //    これにより、verify モードで流した A→B 自動遷移では
        //    localStorage 側の計測を行わないだけでなく、
        //    SYNC 側の累計・streak3・oncePerDayToday も一切更新されない。
        if (verifyModeOn) {
          console.log("[SYNC-B] refreshAndSend: verify-mode ON → diff POST を実行せず HUD 表示のみ更新（計測ガード）", {
            qid: info.qid,
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            diffStreak3: diffStreak3,
            diffStreakLen: diffStreakLen,
            odoaModeText: odoaModeText
          });
          return;
        }

        return sendDiffToServer(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          serverStreak3: serverStreak3,
          serverStreakLen: serverStreakLen,
          serverStreak3Wrong: serverStreak3Wrong,
          serverWrongStreakLen: serverWrongStreakLen,
          localCorrect: localCorrect,
          localWrong: localWrong,
          localStreak3: localStreak3,
          localStreakLen: localStreakLen,
          localStreak3Wrong: localStreak3Wrong,
          localWrongStreakLen: localWrongStreakLen,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          diffStreak3: diffStreak3,
          diffStreakLen: diffStreakLen,
          diffStreak3Wrong: diffStreak3Wrong,
          diffWrongStreakLen: diffWrongStreakLen,
          // ★ oncePerDayTodayDelta を作るために /api/sync/state の snapshot を渡す
          syncState: state,
          // ★ O.D.O.A Mode 表示用テキストも sendDiffToServer に引き継ぎ
          odoaModeText: odoaModeText
        });
      })
      .catch(function (e) {
        console.error("[SYNC-B] state fetch error:", e);
        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);

        var odoaModeText = "不明(state error)";
        var odoaStatusTextForPanelStateError;
        odoaStatusTextForPanelStateError = "O.D.O.A Mode : OFF";

        renderPanel(box, {
          serverCorrect: 0,
          serverWrong: 0,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: 0,
          diffWrong: 0,
          serverStreak3: 0,
          localStreak3: localStreak3,
          diffStreak3: 0,
          serverStreakLen: 0,
          localStreakLen: localStreakLen,
          diffStreakLen: 0,
          statusText: "state error",
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelStateError
        });
      });
  }

  function ensureOnceOdoaWideTitles(box) {
    // ★ 何をしているか:
    //   既存の（SYNC由来）OncePerDayToday / O.D.O.A Mode ワイドカードの見出しに "(SYNC)" を付与する
    //   既存カードは class="svb-once-odoa-card" を持つ前提で、そのうち先頭を SYNC 扱いにする
    try {
      if (!box) return;
      var cards = box.querySelectorAll(".svb-once-odoa-card");
      if (!cards || cards.length === 0) return;

      var syncCard = cards[0];
      var title = syncCard.querySelector(".cscs-svb-card-title");
      if (title) {
        var base = "OncePerDayToday / O.D.O.A Mode";
        if (title.textContent && title.textContent.indexOf(base) >= 0) {
          title.textContent = "OncePerDayToday / O.D.O.A Mode (SYNC)";
        }
      }
    } catch (_e) {}
  }

  function ensureLocalOnceOdoaWideCard(box) {
    // ★ 何をしているか:
    //   SYNCカードの直下に、localStorage由来の値だけを表示する「local専用ワイドカード」を1枚作る（重複作成しない）
    try {
      if (!box) return;

      var body = document.getElementById("cscs_sync_view_b_body");
      if (!body) return;

      // 既存の once/odoa カード（SYNC）を探し、その直後に差し込む
      var syncCard = body.querySelector(".svb-once-odoa-card");
      if (!syncCard) return;

      // すでに local 用が存在するなら何もしない
      if (body.querySelector(".svb-once-odoa-card-local")) return;

      var card = document.createElement("div");
      card.className = "cscs-svb-card is-wide svb-once-odoa-card svb-once-odoa-card-local";

      var head = document.createElement("div");
      head.className = "cscs-svb-card-head";

      var title = document.createElement("div");
      title.className = "cscs-svb-card-title";
      title.textContent = "OncePerDayToday / O.D.O.A Mode (local)";

      var btn = document.createElement("button");
      btn.className = "cscs-svb-mini-btn";
      btn.type = "button";
      btn.textContent = "▶︎show";

      var details = document.createElement("div");
      details.className = "cscs-svb-card-details";

      var collapsedKey = "cscs_sync_view_b_once_odoa_local_collapsed";
      var isCollapsed = false;
      try {
        isCollapsed = (localStorage.getItem(collapsedKey) === "1");
      } catch (_e0) {
        isCollapsed = false;
      }

      function applyCollapsed() {
        if (isCollapsed) {
          details.style.display = "none";
          btn.textContent = "▶︎show";
        } else {
          details.style.display = "";
          btn.textContent = "▼hide";
        }
      }

      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();

        isCollapsed = !isCollapsed;
        try {
          localStorage.setItem(collapsedKey, isCollapsed ? "1" : "0");
        } catch (_e1) {}
        applyCollapsed();
      });

      // グリッド（2列）
      var grid = document.createElement("div");
      grid.className = "cscs-svb-grid2";

      function addRow(labelText, valueText) {
        var l = document.createElement("div");
        l.className = "cscs-svb-grid2-label";
        l.textContent = labelText;

        var v = document.createElement("div");
        v.className = "cscs-svb-grid2-value";
        v.textContent = valueText;

        grid.appendChild(l);
        grid.appendChild(v);
      }

      addRow("oncePerDayToday", "-");
      addRow("Today", "-");
      addRow("qid", "-");
      addRow("count対象", "-");
      addRow("記録", "-");
      addRow("ODOA", "-");

      details.appendChild(grid);

      head.appendChild(title);
      head.appendChild(btn);

      card.appendChild(head);
      card.appendChild(details);

      // SYNCカードの直後に挿入
      if (syncCard.nextSibling) {
        body.insertBefore(card, syncCard.nextSibling);
      } else {
        body.appendChild(card);
      }

      applyCollapsed();
    } catch (_e) {}
  }

  function refreshLocalOnceOdoaCard(box, params) {
    // ★ 何をしているか:
    //   local専用カードの行テキストを、localStorage由来の値だけで更新する
    try {
      if (!box) return;

      var body = document.getElementById("cscs_sync_view_b_body");
      if (!body) return;

      var card = body.querySelector(".svb-once-odoa-card-local");
      if (!card) return;

      var qid = (params && typeof params.qid === "string") ? params.qid : "";
      var odoaModeText = (params && typeof params.odoaModeText === "string") ? params.odoaModeText : "OFF";

      // local oncePerDayToday を読む（既存ヘルパーがあればそれを優先）
      var localOnceDay = null;
      var localOnceVal = null;

      try {
        if (typeof readOncePerDayTodayFromLocal === "function") {
          var localOnce = readOncePerDayTodayFromLocal();
          if (localOnce && typeof localOnce.day === "number") {
            localOnceDay = localOnce.day;
          }
          if (localOnce && localOnce.results && typeof localOnce.results === "object" && qid) {
            if (Object.prototype.hasOwnProperty.call(localOnce.results, qid)) {
              localOnceVal = localOnce.results[qid];
            }
          }
        }
      } catch (_eOnce) {
        localOnceDay = null;
        localOnceVal = null;
      }

      function fmtDay8ToDateText(dayNum) {
        if (typeof dayNum !== "number" || !Number.isFinite(dayNum) || dayNum <= 0) return "-";
        var s = String(dayNum);
        if (s.length !== 8) return s;
        return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
      }

      var onceStateLabel = (localOnceVal === "correct" || localOnceVal === "wrong") ? "計測済" : "未開始";
      var onceTodayDateLabel = (localOnceDay != null) ? fmtDay8ToDateText(localOnceDay) : "-";
      var onceQidLabel = qid || "-";
      var onceCountableLabel = (localOnceVal === "correct" || localOnceVal === "wrong") ? "No（計測済）" : "Yes（未計測）";
      var onceRecordLabel = (localOnceVal === "correct" || localOnceVal === "wrong") ? String(localOnceVal) : "-";

      var onceOdoaLabel = "-";
      if (odoaModeText === "ON") {
        if (onceRecordLabel !== "-") {
          onceOdoaLabel = "ON（累計加算: No）  " + onceRecordLabel;
        } else {
          onceOdoaLabel = "ON（累計加算: No）";
        }
      } else if (odoaModeText === "OFF") {
        onceOdoaLabel = "OFF（累計加算: Yes）";
      } else {
        onceOdoaLabel = String(odoaModeText);
      }

      // grid の 2列を先頭から順に上書き
      var values = card.querySelectorAll(".cscs-svb-grid2-value");
      if (!values || values.length < 6) return;

      values[0].textContent = onceStateLabel;
      values[1].textContent = onceTodayDateLabel;
      values[2].textContent = onceQidLabel;
      values[3].textContent = onceCountableLabel;
      values[4].textContent = onceRecordLabel;
      values[5].textContent = onceOdoaLabel;

    } catch (_e) {}
  }

  function init() {
    // ★ パネル生成より先にCSSを注入（初回表示から確実に適用）
    ensureSyncViewBStyles();

    var box = createPanel();

    function append() {
      var wrap = document.querySelector("div.wrap");
      if (wrap) {
        if (!wrap.contains(box)) {
          wrap.appendChild(box);
        }
      } else {
        if (!document.body.contains(box)) {
          document.body.appendChild(box);
        }
      }

      // ★ 何をしているか:
      //   既存(SYNC)カードの見出しを "(SYNC)" にし、直下に local専用カードを追加する
      ensureOnceOdoaWideTitles(box);
      ensureLocalOnceOdoaWideCard(box);

      var btn = document.getElementById("cscs_sync_view_b_send_btn");
      if (btn) {
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();

          // ① 手動テスト時は HUD の表示だけ更新し、diff のサーバー送信は抑制する
          //    → 最初の refreshAndSend では「現在の state」に基づく HUD を表示するだけ
          refreshAndSend(box, { suppressDiffSend: true });

          // ② Local streak3Today / streak3WrongToday 情報を「手動送信」するテスト用トリガー
          //    - それぞれの merge 完了後にもう一度 HUD を更新して、
          //      /api/sync/state に反映された最新の streak3Today / streak3WrongToday を HUD に出す
          var promises = [];

          if (window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3TodayUnique === "function") {
            console.log("[SYNC-B:HUD] manual streak3Today SEND requested from button (diff POST suppressed)");
            var pToday = window.CSCS_SYNC.recordStreak3TodayUnique();
            if (pToday && typeof pToday.then === "function") {
              promises.push(pToday);
            }
          } else {
            console.warn("[SYNC-B:HUD] recordStreak3TodayUnique is not available (手動送信不可)");
          }

          if (window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3WrongTodayUnique === "function") {
            console.log("[SYNC-B:HUD] manual streak3WrongToday SEND requested from button (diff POST suppressed)");
            var pWrongToday = window.CSCS_SYNC.recordStreak3WrongTodayUnique();
            if (pWrongToday && typeof pWrongToday.then === "function") {
              promises.push(pWrongToday);
            }
          } else {
            console.warn("[SYNC-B:HUD] recordStreak3WrongTodayUnique is not available (手動送信不可)");
          }

          if (promises.length > 0) {
            Promise.all(promises).then(function () {
              console.log("[SYNC-B:HUD] streak3Today / streak3WrongToday merge completed → HUD 再取得＋再描画（diff POST 抑制）");
              refreshAndSend(box, { suppressDiffSend: true });
            }).catch(function (e) {
              console.error("[SYNC-B:HUD] streak3Today / streak3WrongToday manual send error:", e);
            });
          }
        });
      }
      // ③ 初期表示時の HUD 更新（diff 送信ありの通常モード）
      refreshAndSend(box);

      // ★【超重要仕様：この自動クリックも「削除禁止」】
      //   - 下の setTimeout で呼ばれる btn.click() は、単なるデバッグ用ではなく、
      //     「streak3Today / streak3WrongToday を Bパートから SYNC に送信するための正式な起動トリガー」。
      //   - click ハンドラ内では diff POST を抑制した上で
      //       window.CSCS_SYNC.recordStreak3TodayUnique()
      //       window.CSCS_SYNC.recordStreak3WrongTodayUnique()
      //     を呼び出し、/api/sync/merge に streak3TodayDelta / streak3WrongTodayDelta を送っている。
      //   - つまり、ここを削除・コメントアウト・条件分岐で無効化すると、
      //     「localStorage 側では計測されているのに、SYNC 側の今日の⭐️/💣ユニーク数が一切増えない」
      //     という不可視な不具合が発生する。
      //   - ChatGPT などが「テスト用の自動クリックだから不要」と誤認して消さないよう、
      //     このコメントで意図を明示している。
      //
      // ④ 追加: ページロード後約1.0秒で「SYNC送信ボタン」を自動クリックして、
      //    手動クリックと同じ挙動（diff POST 抑制 + streak3TodayDelta / streak3WrongTodayDelta 送信）を一度だけ実行する
      if (btn) {
        setTimeout(function () {
          console.log("[SYNC-B:auto] 1.0秒後に SYNC 送信ボタンを自動クリックします");
          btn.click();
        }, 1000);
      } else {
        console.log("[SYNC-B:auto] SYNC 送信ボタンが見つからないため、自動クリックを行いません");
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", append);
    } else {
      append();
    }
  }

  if (typeof window.CSCS_SYNC === "undefined" || window.CSCS_SYNC === null) {
    window.CSCS_SYNC = {};
  }

  window.CSCS_SYNC.recordStreak3TodayUnique = async function () {
    try {
      // ★ 追加ガード: O.D.O.A が nocount のときは streak3Today を一切送らない
      var state = null;
      try {
        state = window.__cscs_sync_state || null;
      } catch(_e) {
        state = null;
      }
      if (state && (state.odoaMode === "on_nocount" || state.odoa_mode === "on_nocount")) {
        // 補足: nocount 中に streak3Today が送信されると「正誤を計測していないのに★だけ増える事故」が発生するため、
        //       ここで必ずブロックする。
        console.log("[SYNC-B:streak3Today] skip because O.D.O.A = on_nocount");
        return;
      }

      // 1) オフラインならそもそも送信しない（Bパートからの streak3TodayDelta は「オンライン時だけ」）
      if (!navigator.onLine) {
        console.warn("[SYNC-B:streak3Today] offline → 送信スキップ");
        return;
      }

      // 2) localStorage に溜まっている「今日の⭐️情報」を読み出すための一時変数
      var day = "";
      var qids = [];
      var localCount = 0;

      try {
        // 2-1) 「今日が何日か」を表す文字列（例: "20251201"）
        day = localStorage.getItem("cscs_streak3_today_day") || "";
        // 2-2) 今日⭐️を新規獲得した qid の配列をシリアライズした文字列
        var rawQids = localStorage.getItem("cscs_streak3_today_qids");
        // 2-3) 今日の⭐️ユニーク数（local 側カウンタ）
        var rawCnt = localStorage.getItem("cscs_streak3_today_unique_count");

        // 2-4) qids の JSON をパースして「妥当な文字列だけ」の配列にクリーンアップ
        if (rawQids) {
          var parsed = JSON.parse(rawQids);
          if (Array.isArray(parsed)) {
            qids = parsed.filter(function (x) {
              return typeof x === "string" && x;
            });
          }
        }

        // 2-5) ユニーク数を数値にパース（不正値や負数は 0 扱い）
        var cnt = parseInt(rawCnt || "0", 10);
        if (Number.isFinite(cnt) && cnt >= 0) {
          localCount = cnt;
        }
      } catch (_e) {
        // localStorage / JSON パースのどこかで失敗した場合は「空データ」として扱う
        day = "";
        qids = [];
        localCount = 0;
      }

      // 3) 読み出したローカル状態をコンソールにフル出力（デバッグ用）
      console.group("[SYNC-B:streak3Today] recordStreak3TodayUnique CALLED");
      console.log("local.day =", day);
      console.log("local.qids =", qids);
      console.log("local.unique_count =", localCount);
      console.groupEnd();

      // 4) 日付か qid 配列が空なら、サーバー側を壊さないために送信しない
      //    - 初回起動直後など「まだ streak3Today 情報が無い」ケースは正常なスキップとして扱う
      if (!day || qids.length === 0) {
        console.log("[SYNC-B:streak3Today] day 又は qids が空 → 正常スキップ（まだ送るべきデータがない）", {
          day: day,
          qidsLength: qids.length
        });
        return;
      }

      // 5) Workers 側の merge.ts に渡す streak3TodayDelta のペイロードを組み立て
      //    - day: "YYYYMMDD" 形式
      //    - qids: その日に⭐️を初めて取った問題の qid 配列
      var payload = {
        streak3TodayDelta: {
          day: day,
          qids: qids
        },
        updatedAt: Date.now()
      };

      // 6) 送信直前の payload を丸ごとログに出しておく
      console.group("[SYNC-B:streak3Today] SEND payload");
      console.log(payload);
      console.groupEnd();

      // 7) /api/sync/merge に対して streak3TodayDelta 専用のリクエストを送信
      var res = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // 8) HTTP レベルでエラーならここで終了（サーバー保存失敗の可能性）
      if (!res.ok) {
        console.error("[SYNC-B:streak3Today] merge FAILED:", res.status);
        return;
      }

      // 9) merge.ts が返してきた最新の SYNC スナップショットを取得（失敗しても致命的ではない）
      var merged = null;
      try {
        merged = await res.json();
      } catch (_e2) {
        merged = null;
      }

      // 10) merge のレスポンスをログに残しておく（Workers 側でどう保存されたかの確認用）
      console.group("[SYNC-B:streak3Today] MERGE result");
      console.log("mergeResponse =", merged);
      console.groupEnd();

      // 11) さらに /api/sync/state を叩いて、KV に反映された最終形の streak3Today を確認する
      try {
        var stateAfter = await fetchState();
        try {
          // 11-1) 取得した state 全体をグローバルに保持して、
          //       Bパート HUD や他のビューからも streak3Today を参照できるようにする
          window.__cscs_sync_state = stateAfter;
        } catch (_e3) {}

        // 11-2) stateAfter.streak3Today の中身をそのままログに出して、
        //       「day / unique_count / qids がどのように保存されたか」を確認できるようにする
        console.group("[SYNC-B:streak3Today] UPDATED state.streak3Today");
        console.log(stateAfter && stateAfter.streak3Today);
        console.groupEnd();

      } catch (e4) {
        // state の再取得自体が失敗したケース（merge 自体は成功している可能性あり）
        console.error("[SYNC-B:streak3Today] state refresh ERROR:", e4);
      }

    } catch (e) {
      // 想定外の例外が起きた場合も握りつぶさずログに出す
      console.error("[SYNC-B:streak3Today] fatal error:", e);
    }
  };

  // ★ 不正解版: 今日の3連続不正解ユニーク（Streak3WrongToday）を SYNC 側に送信する
  window.CSCS_SYNC.recordStreak3WrongTodayUnique = async function () {
    try {
      // ★ 追加ガード: O.D.O.A が nocount のときは streak3WrongToday を一切送らない
      var state = null;
      try {
        state = window.__cscs_sync_state || null;
      } catch(_e) {
        state = null;
      }
      if (state && (state.odoaMode === "on_nocount" || state.odoa_mode === "on_nocount")) {
        // 補足: nocount 中に streak3WrongToday が送信されると
        //       「正誤を計測していないのに💣だけ増える事故」が発生するため、ここで必ずブロックする。
        console.log("[SYNC-B:streak3WrongToday] skip because O.D.O.A = on_nocount");
        return;
      }

      // 1) オフラインならそもそも送信しない（Bパートからの streak3WrongTodayDelta は「オンライン時だけ」）
      if (!navigator.onLine) {
        console.warn("[SYNC-B:streak3WrongToday] offline → 送信スキップ");
        return;
      }

      // 2) localStorage に溜まっている「今日の3連続不正解情報」を読み出すための一時変数
      var day = "";
      var qids = [];
      var localCount = 0;

      try {
        // 2-1) 「今日が何日か」を表す文字列（例: "20251201"）
        day = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
        // 2-2) 今日💣を新規獲得した qid の配列をシリアライズした文字列
        var rawQids = localStorage.getItem("cscs_streak3_wrong_today_qids");
        // 2-3) 今日の3連続不正解ユニーク数（local 側カウンタ）
        var rawCnt = localStorage.getItem("cscs_streak3_wrong_today_unique_count");

        // 2-4) qids の JSON をパースして「妥当な文字列だけ」の配列にクリーンアップ
        if (rawQids) {
          var parsed = JSON.parse(rawQids);
          if (Array.isArray(parsed)) {
            qids = parsed.filter(function (x) {
              return typeof x === "string" && x;
            });
          }
        }

        // 2-5) ユニーク数を数値にパース（不正値や負数は 0 扱い）
        var cnt = parseInt(rawCnt || "0", 10);
        if (Number.isFinite(cnt) && cnt >= 0) {
          localCount = cnt;
        }
      } catch (_e2) {
        // localStorage / JSON パースのどこかで失敗した場合は「空データ」として扱う
        day = "";
        qids = [];
        localCount = 0;
      }

      // 3) 読み出したローカル状態をコンソールにフル出力（デバッグ用）
      console.group("[SYNC-B:streak3WrongToday] recordStreak3WrongTodayUnique CALLED");
      console.log("local.day =", day);
      console.log("local.qids =", qids);
      console.log("local.unique_count =", localCount);
      console.groupEnd();

      // 4) 日付か qid 配列が空なら、サーバー側を壊さないために送信しない
      //    - 初回起動直後など「まだ streak3WrongToday 情報が無い」ケースは正常なスキップとして扱う
      if (!day || qids.length === 0) {
        console.log("[SYNC-B:streak3WrongToday] day 又は qids が空 → 正常スキップ（まだ送るべきデータがない）", {
          day: day,
          qidsLength: qids.length
        });
        return;
      }

      // 5) Workers 側の merge.ts に渡す streak3WrongTodayDelta のペイロードを組み立て
      //    - day: "YYYYMMDD" 形式
      //    - qids: その日に💣を初めて取った問題の qid 配列
      var payload = {
        streak3WrongTodayDelta: {
          day: day,
          qids: qids
        },
        updatedAt: Date.now()
      };

      // 6) 送信直前の payload を丸ごとログに出しておく
      console.group("[SYNC-B:streak3WrongToday] SEND payload");
      console.log(payload);
      console.groupEnd();

      // 7) /api/sync/merge に対して streak3WrongTodayDelta 専用のリクエストを送信
      var res = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // 8) HTTP レベルでエラーならここで終了（サーバー保存失敗の可能性）
      if (!res.ok) {
        console.error("[SYNC-B:streak3WrongToday] merge FAILED:", res.status);
        return;
      }

      // 9) merge.ts が返してきた最新の SYNC スナップショットを取得（失敗しても致命的ではない）
      var merged = null;
      try {
        merged = await res.json();
      } catch (_e3) {
        merged = null;
      }

      // 10) merge のレスポンスをログに残しておく（Workers 側でどう保存されたかの確認用）
      console.group("[SYNC-B:streak3WrongToday] MERGE result");
      console.log("mergeResponse =", merged);
      console.groupEnd();

      // 11) さらに /api/sync/state を叩いて、KV に反映された最終形の streak3WrongToday を確認する
      try {
        var stateAfter = await fetchState();
        try {
          // 11-1) 取得した state 全体をグローバルに保持して、
          //       Bパート HUD や他のビューからも streak3WrongToday を参照できるようにする
          window.__cscs_sync_state = stateAfter;
        } catch (_e4) {}

        // 11-2) stateAfter.streak3WrongToday の中身をそのままログに出して、
        //       「day / unique_count / qids がどのように保存されたか」を確認できるようにする
        console.group("[SYNC-B:streak3WrongToday] UPDATED state.streak3WrongToday");
        console.log(stateAfter && stateAfter.streak3WrongToday);
        console.groupEnd();

      } catch (e5) {
        // state の再取得自体が失敗したケース（merge 自体は成功している可能性あり）
        console.error("[SYNC-B:streak3WrongToday] state refresh ERROR:", e5);
      }

    } catch (e) {
      // 想定外の例外が起きた場合も握りつぶさずログに出す
      console.error("[SYNC-B:streak3WrongToday] fatal error:", e);
    }
  };

  window.addEventListener("online", function () {
    var box = document.getElementById("cscs_sync_view_b");
    if (!box) return;
    refreshAndSend(box);
  });

  init();
})();