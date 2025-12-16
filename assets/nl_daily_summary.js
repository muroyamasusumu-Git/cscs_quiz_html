// assets/nl_daily_summary.js
// 目的:
//   nav_list.js から独立した「日別・問題集サマリー」ヘッダー描画。
//   - #nl-progress-header（進捗マス目）
//   - #nl-summary-header（⭐️/◎/試験日）
//
// 依存:
//   - /api/sync/state（SYNC 状態）
//   - localStorage "cscs_exam_date"（試験日ローカル保存）
//
// 方針:
//   - nav_list.js の中でヘッダーDOMを作らない（このJSが担当）
//   - フォールバックで別ソースから埋め合わせない（取れなければ取れない表示にする）
(function () {
  "use strict";

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "nl_daily_summary"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }
  
  // このヘッダーを出す対象ページ判定（#root があるページ）
  // 目的:
  // - nav_list.js / #nl-panel に依存しない
  // - どのページでも #root があれば描画できるようにする
  function hasRoot(){
    return !!document.getElementById("root");
  }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function pad3(n){ return String(n).padStart(3, "0"); }

  function getDayFromPath(){
    var m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }

  // 現在表示中の問題番号（1始まり）を URL から取得
  // 例:
  //   /slides/q013_a.html
  //   /slides/q013_b
  //   /slides/q013_b?choice=A   ※ query は pathname からは消えるが、拡張子なしに対応する
  function getQuestionIndexFromPath(){
    var path = String(window.location.pathname || "");

    // 末尾の形式ゆれに対応：
    // - q013_a.html
    // - q013_a
    // - q013_b.html
    // - q013_b
    var m = path.match(/\/?q(\d{3})_([ab])(?:\.html)?$/);
    if (!m) return null;

    var n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;

    // buildProgressGrid は 0始まりで扱うため -1 する
    return n - 1;
  }

  function toJpDateQid(day, n3){
    var y = day.slice(0, 4);
    var m = String(Number(day.slice(4, 6)));
    var d = String(Number(day.slice(6, 8)));
    return y + "年" + m + "月" + d + "日-" + n3;
  }

  function getConsistencyInfoFromSync(day, n3, syncRoot){
    var qidJp = toJpDateQid(day, n3);
    var obj = null;
    var mark = "";
    if (
      syncRoot &&
      syncRoot.consistency_status &&
      Object.prototype.hasOwnProperty.call(syncRoot.consistency_status, qidJp)
    ){
      obj = syncRoot.consistency_status[qidJp];
    }
    if (obj && typeof obj.status_mark === "string"){
      mark = obj.status_mark;
    }
    return { qidJp: qidJp, statusMark: mark };
  }

  async function loadSyncData(){
    try{
      const res = await fetch(location.origin + "/api/sync/state", { cache: "no-store" });
      const json = await res.json();
      if (!json || typeof json !== "object") return {};
      return json;
    }catch(e){
      console.error("nl_daily_summary.js: SYNC 読み込み失敗:", e);
      return {};
    }
  }

  function getSyncRoot(syncJson){
    try{
      if (syncJson && typeof syncJson === "object"){
        if (syncJson.data && typeof syncJson.data === "object") return syncJson.data;
        return syncJson;
      }
    }catch(_){}
    return {};
  }

  function buildDayArray(startStr, endStr){
    var list = [];

    var sy = Number(startStr.slice(0, 4));
    var sm = Number(startStr.slice(4, 6)) - 1;
    var sd = Number(startStr.slice(6, 8));

    var ey = Number(endStr.slice(0, 4));
    var em = Number(endStr.slice(4, 6)) - 1;
    var ed = Number(endStr.slice(6, 8));

    var cur = new Date(sy, sm, sd);
    var end = new Date(ey, em, ed);

    while (cur.getTime() <= end.getTime()){
      var y = cur.getFullYear();
      var m = pad2(cur.getMonth() + 1);
      var d = pad2(cur.getDate());
      var s = String(y) + m + d;
      list.push(s);
      cur.setDate(cur.getDate() + 1);
    }

    return list;
  }

  function formatPercent1(value){
    var n = Number(value) || 0;
    return n.toFixed(1);
  }

  // ▼ SYNC更新時に ⭐️/◎ 行だけを書き換えるための関数
  async function refreshSummaryStatBlock(){
    var block = document.getElementById("nl-summary-stat-block");
    if (!block) return;

    var syncJson = await loadSyncData();
    var syncRoot = getSyncRoot(syncJson);

    var allDays = buildDayArray("20250926", "20251224");
    var TOTAL_QUESTIONS_PER_DAY = 30;

    var totalQuestionsAll = allDays.length * TOTAL_QUESTIONS_PER_DAY;

    var starQuestionCount = 0;
    var starFullDayCount = 0;

    allDays.forEach(function(dayStr){
      var dayStarCount = 0;
      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS_PER_DAY; qIndex++){
        var n3 = pad3(qIndex);
        var qid = dayStr + "-" + n3;
        var streakTotal = 0;
        if (syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)){
          streakTotal = Number(syncRoot.streak3[qid] || 0);
        }
        if (streakTotal > 0){
          starQuestionCount += 1;
          dayStarCount += 1;
        }
      }
      if (dayStarCount === TOTAL_QUESTIONS_PER_DAY){
        starFullDayCount += 1;
      }
    });

    var consistencyQuestionCount = 0;
    var consistencyFullDayCount = 0;

    allDays.forEach(function(dayStr){
      var dayConsistentCount = 0;
      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS_PER_DAY; qIndex++){
        var n3 = pad3(qIndex);
        var info = getConsistencyInfoFromSync(dayStr, n3, syncRoot);
        if (info.statusMark === "◎"){
          consistencyQuestionCount += 1;
          dayConsistentCount += 1;
        }
      }
      if (dayConsistentCount === TOTAL_QUESTIONS_PER_DAY){
        consistencyFullDayCount += 1;
      }
    });

    var starRate = totalQuestionsAll > 0 ? (starQuestionCount / totalQuestionsAll) * 100 : 0;
    var consRate = totalQuestionsAll > 0 ? (consistencyQuestionCount / totalQuestionsAll) * 100 : 0;

    block.innerHTML = "";

    var lineStar = document.createElement("div");
    lineStar.style.marginTop = "0px";
    lineStar.textContent =
      "⭐️｜獲得済｜" +
      String(starQuestionCount).padStart(4, "0") +
      "／" +
      String(totalQuestionsAll) +
      "｜" +
      pad2(starFullDayCount) +
      "／" +
      pad2(allDays.length) +
      "｜" +
      formatPercent1(starRate) +
      "% 達成";

    var lineCons = document.createElement("div");
    lineCons.style.marginBottom = "0px";
    lineCons.textContent =
      "◎｜整合性｜" +
      String(consistencyQuestionCount).padStart(4, "0") +
      "／" +
      String(totalQuestionsAll) +
      "｜" +
      pad2(consistencyFullDayCount) +
      "／" +
      pad2(allDays.length) +
      "｜" +
      formatPercent1(consRate) +
      "% 達成";

    block.appendChild(lineStar);
    block.appendChild(lineCons);
  }

  function ensureHeaderStyles(){
    if (document.getElementById("nl-daily-summary-style")) return;

    var style = document.createElement("style");
    style.id = "nl-daily-summary-style";
    style.type = "text/css";

    // ▼ 見た目はここ（CSS）に集約：変数は使わず、直接値を書く
    // 目的: 「今は細かく調整したい」フェーズで、編集コストを最小化する
    style.textContent = `
/* =========================
   NL Daily Summary Styles
   - 見た目はここだけ編集
   ========================= */

/* ---- host（右側固定） ---- */
#nl-daily-summary-host{
  display: block;
  position: fixed;
  inset: 10px 20px 10px 0;
  margin-left: 71%;
}

/* ---- progress header ---- */
#nl-progress-header{
  font-family: ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  background: none;
  padding: 0px 0px 0px 2px;
  border-bottom: 0;
  text-align: left;
  opacity: 0.7;
  margin: 0 0 5px 0;
}


#nl-progress-header .nl-ph-row{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:10px;
  margin-top: 0px;
}

#nl-progress-header .nl-ph-title{
  font-size:12px;
  letter-spacing:0.02em;
  opacity:0.85;
}

#nl-progress-header .nl-ph-value{
  font-size:12px;
  font-variant-numeric: tabular-nums;
  opacity:0.7;
}

/* ---- grids (shared base) ---- */
#nl-progress-header .nl-ph-grid{
  margin-top: 0px;
  display:grid;
  width:100%;
}

/* ---- cells (shared base) ---- */
#nl-progress-header .nl-ph-cell{
  height: 8px;
  border-radius: 2px;
  background: rgba(255,255,255,0.02);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28);
}

#nl-progress-header .nl-ph-cell.is-on{
  background: rgba(255,255,255,0.18);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.30);
}

#nl-progress-header .nl-ph-cell.is-today{
  background: linear-gradient(
    to bottom,
    rgba(255,255,255,0.26),
    rgba(255,255,255,0.18)
  );
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.65),
    0 0 4px rgba(255,255,255,0.28);
  animation: nl-ph-today-pulse 4.2s ease-in-out infinite;
}

/* 現在地マス用：強めの呼吸＋発光点滅 */
@keyframes nl-ph-today-pulse{
  0%{
    opacity: 0.75;
    transform: scaleY(0.9);
  }
  50%{
    opacity: 1;
    transform: scaleY(1);
  }
  100%{
    opacity: 0.75;
    transform: scaleY(0.9);
  }
}

/* =========================================================
   問題別 is-today（現在地）だけは “常に白”
   - 目的1: 現在地は常に白（正解/不正解の色を完全遮断）
   - 目的2: 今日解いたが現在地ではない問題は is-solved-* の色が乗る（遮断しない）
   実装:
   - is-today（= currentQIndex の1マスだけ）を fail-safe で強制上書き
   - solved/on/lite が付いても最終的に白へ戻す
   ========================================================= */

/* 現在地の基本見た目：白だけ（グラデ・フィルタ・色味を排除） */
#nl-progress-header .nl-ph-cell-q.is-today{
  background: rgba(255,255,255,0.22) !important; /* 白の面（薄め） */
  background-image: none !important;             /* 既存グラデを確実に無効化 */
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.82) !important, /* 白い縁 */
    0 0 5px rgba(255,255,255,0.22) !important;         /* 白い弱発光 */
  filter: none !important;                       /* 色補正を遮断 */
  animation: nl-ph-today-pulse 3.2s ease-in-out infinite !important; /* “白の呼吸” */
}

/* 最終防衛：現在地に solved/on が重なっても、必ず “明るい白の点滅” を優先する */
#nl-progress-header .nl-ph-cell-q.is-today.is-on,
#nl-progress-header .nl-ph-cell-q.is-today.is-solved-today{
  background: rgba(255,255,255,0.30) !important; /* 現在地は明るい白 */
  background-image: none !important;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.88) !important,
    0 0 6px rgba(255,255,255,0.26) !important;
  filter: none !important;
  animation: nl-ph-today-pulse 3.0s ease-in-out infinite !important;
}

/* =========================================================
   問題別マス：三段階のみ
   1) 現在地            : is-today（明るい白で点滅）※上で定義
   2) 今日解いた問題     : is-solved-today（白マス）
   3) 今日解いてない問題 : デフォルト（暗めのマス）
   ========================================================= */

/* 今日解いてない問題（デフォルト）を “黒に近い” 方へ寄せる */
#nl-progress-header .nl-ph-cell-q{
  background: rgba(0,0,0,0.22);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
}

/* 今日解いた問題：白マス（.nl-ph-cell.is-on と同じトーンに揃える） */
#nl-progress-header .nl-ph-cell-q.is-solved-today{
  background: rgba(255,255,255,0.18);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.30);
}

/* 現在地の「色被り」最終防衛：
   - セルをスタッキング可能にして
   - is-today を常に最前面に固定（隣の影や描画誤差より上に出す） */
#nl-progress-header .nl-ph-cell-q{
  position: relative;
  z-index: 1;
}

#nl-progress-header .nl-ph-cell-q.is-today{
  z-index: 3 !important;
}


/* ---- day / question : 個別調整用（必要ならここをいじる） ----
   ここは “数値を後から変える” 前提の調整ポイント。

   例：
   - 日別だけマスを少し大きくしたい → .nl-ph-cell-day の height を上げる
   - 問題別だけマスを詰めたい       → .nl-ph-grid-q の gap を下げる
   - 問題別だけ角丸を弱めたい       → .nl-ph-cell-q の border-radius を下げる

   JS側は kind="day"/"q" を付けるだけにしてあり、
   見た目のチューニングはここに集約する方針。
*/
#nl-progress-header .nl-ph-grid-day {
    gap: 2px 4px;
    margin-bottom: 5px;
}

#nl-progress-header .nl-ph-grid-q {
    gap: 1px 2px !important;
    margin-bottom: 5px;
}

#nl-progress-header .nl-ph-cell-day {
    border-radius: 0px;
    background: linear-gradient(
      to bottom,
      rgba(255,255,255,0.03),
      rgba(255,255,255,0.015)
    );
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.18),
      inset 0 1px 0 rgba(255,255,255,0.06);
    border-bottom-left-radius: 20px;
    height: 12px;
    transition: background 180ms ease, box-shadow 180ms ease;
}

#nl-progress-header .nl-ph-cell-day.is-on{
    background: linear-gradient(
      to bottom,
      rgba(255,255,255,0.10),
      rgba(255,255,255,0.05)
    );
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.28),
      inset 0 1px 0 rgba(255,255,255,0.10);
}


/* ---- day / question : 例（差を付けたい場合に使う） ---- */
/*
#nl-progress-header .nl-ph-cell-day{ height: 6px; }
#nl-progress-header .nl-ph-cell-q{ height: 5px; }
#nl-progress-header .nl-ph-grid-q{ gap: 1px; }
*/

/* ---- summary header ---- */
#nl-summary-header{
  background:none;
  padding: 0px 0px 10px;
  border-bottom: 0px solid rgb(42, 42, 42);
  font-size: 13px;
  font-weight: 300;
  line-height: 1.3;
  text-align: right;
  opacity: 0.5;
}

/* ---- exam ---- */
.nl-exam-days{
  font-size: 26px;
  font-weight: 600;
  padding: 0 2px;
  line-height: 0.9;
  display:inline-block;
}

.nl-exam-line{
  margin-top: 5px;
}
`.trim();

    document.head.appendChild(style);
  }

  function buildProgressGrid(total, filled, cols, todayIndex, kind, todaySolvedIndexMap){
    // =========================================================
    // 進捗マス（グリッド）を生成する共通関数
    //
    // - kind="day" : 日別進捗（全期間の「日」単位の進捗）
    // - kind="q"   : 問題別進捗（当日の「問題」単位の進捗）
    //
    // 追加:
    // - todaySolvedIndexMap（問題別のみ）
    //   { 0: "correct", 1: "wrong", ... } のような
    //   “0始まりindex → 当日計測結果” のマップを受け取り、
    //   マスの色を correct/wrong で塗り分ける。
    // =========================================================

    var k = (typeof kind === "string" && kind) ? kind : "day";

    var grid = document.createElement("div");
    grid.className = "nl-ph-grid nl-ph-grid-" + k;

    try{
      grid.style.gridTemplateColumns = "repeat(" + String(cols) + ", 1fr)";
    }catch(_){}

    var i;
    for (i = 0; i < total; i++){
      var cell = document.createElement("div");
      cell.className = "nl-ph-cell nl-ph-cell-" + k;

      if (i < filled) cell.className += " is-on";

      // =========================================================
      // 変更: 問題別（kind="q"）のみ
      // - 正解/不正解の色分けは廃止
      // - 「今日解いたかどうか」だけを 1クラスで表現する
      //
      // 目的:
      // - 三段階表示（現在地 / 今日解いた / 今日解いてない）に一本化する
      // - todaySolvedIndexMap は "correct"/"wrong" を持っていても、
      //   UIでは「今日解いた」扱いに統合する
      // =========================================================
      if (k === "q" && todaySolvedIndexMap && typeof todaySolvedIndexMap === "object") {
        if (Object.prototype.hasOwnProperty.call(todaySolvedIndexMap, String(i))) {
          cell.className += " is-solved-today";
        } else if (Object.prototype.hasOwnProperty.call(todaySolvedIndexMap, i)) {
          cell.className += " is-solved-today";
        }
      }

      if (typeof todayIndex === "number" && i === todayIndex) {
        cell.className += " is-today";
      }

      grid.appendChild(cell);
    }
    return grid;
  }

  function buildExamLineText(nowDate, syncRoot){
    var examRaw = "";
    try{
      if (syncRoot && typeof syncRoot === "object" && typeof syncRoot.exam_date === "string") {
        examRaw = syncRoot.exam_date || "";
      } else {
        examRaw = "";
      }
    }catch(_){
      examRaw = "";
    }

    if (examRaw){
      var examDate = new Date(examRaw);
      if (!isNaN(examDate.getTime())){
        var todayBase = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
        var examBase = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
        var diffMs = examBase.getTime() - todayBase.getTime();
        var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        var em = examDate.getMonth() + 1;
        var ed = examDate.getDate();
        var examLabel =
          "試験(" +
          String(em) +
          "/" +
          String(ed) +
          ")まであと" +
          "<span class='nl-exam-days'>" +
          String(diffDays) +
          "</span>" +
          "日";
        return examLabel;
      }
    }
    return "試験日未設定";
  }

  function openExamCalendar(summaryLine4, examButtonSpan){
    try{
      var currentValue = "";
      try{
        currentValue = localStorage.getItem("cscs_exam_date") || "";
      }catch(_){
        currentValue = "";
      }

      var baseDate = new Date();
      if (currentValue) {
        var storedDate = new Date(currentValue);
        if (!isNaN(storedDate.getTime())) {
          baseDate = storedDate;
        }
      }
      var currentYear = baseDate.getFullYear();
      var currentMonth = baseDate.getMonth();

      var existingBackdrop = document.getElementById("nl-exam-calendar-backdrop");
      if (existingBackdrop && existingBackdrop.parentNode) {
        existingBackdrop.parentNode.removeChild(existingBackdrop);
      }

      var backdrop = document.createElement("div");
      backdrop.id = "nl-exam-calendar-backdrop";
      backdrop.style.position = "fixed";
      backdrop.style.left = "0";
      backdrop.style.top = "0";
      backdrop.style.right = "0";
      backdrop.style.bottom = "0";
      backdrop.style.background = "rgba(0, 0, 0, 0.4)";
      backdrop.style.zIndex = "100001";
      backdrop.style.display = "flex";
      backdrop.style.alignItems = "center";
      backdrop.style.justifyContent = "center";

      var box = document.createElement("div");
      box.id = "nl-exam-calendar";
      box.style.background = "rgb(17, 17, 17)";
      box.style.color = "#fff";
      box.style.border = "1px solid #444";
      box.style.borderRadius = "8px";
      box.style.padding = "12px";
      box.style.minWidth = "260px";
      box.style.fontSize = "13px";
      box.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.6)";

      var headerRow = document.createElement("div");
      headerRow.style.display = "flex";
      headerRow.style.justifyContent = "space-between";
      headerRow.style.alignItems = "center";
      headerRow.style.marginBottom = "8px";

      var prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.textContent = "◀";
      prevBtn.style.padding = "2px 6px";
      prevBtn.style.fontSize = "12px";
      prevBtn.style.background = "#222";
      prevBtn.style.color = "#fff";
      prevBtn.style.border = "1px solid #444";
      prevBtn.style.borderRadius = "4px";
      prevBtn.style.cursor = "pointer";

      var monthLabel = document.createElement("span");
      monthLabel.style.fontWeight = "500";

      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.textContent = "▶";
      nextBtn.style.padding = "2px 6px";
      nextBtn.style.fontSize = "12px";
      nextBtn.style.background = "#222";
      nextBtn.style.color = "#fff";
      nextBtn.style.border = "1px solid #444";
      nextBtn.style.borderRadius = "4px";
      nextBtn.style.cursor = "pointer";

      headerRow.appendChild(prevBtn);
      headerRow.appendChild(monthLabel);
      headerRow.appendChild(nextBtn);

      var grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(7, 1fr)";
      grid.style.columnGap = "4px";
      grid.style.rowGap = "4px";
      grid.style.marginBottom = "8px";

      var weekdays = ["日","月","火","水","木","金","土"];
      for (var w = 0; w < 7; w++) {
        var wdCell = document.createElement("div");
        wdCell.textContent = weekdays[w];
        wdCell.style.textAlign = "center";
        wdCell.style.fontSize = "11px";
        wdCell.style.opacity = "0.5";
        grid.appendChild(wdCell);
      }

      var footerRow = document.createElement("div");
      footerRow.style.display = "flex";
      footerRow.style.justifyContent = "flex-end";
      footerRow.style.columnGap = "8px";

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "キャンセル";
      cancelBtn.style.padding = "4px 10px";
      cancelBtn.style.fontSize = "12px";
      cancelBtn.style.background = "#222";
      cancelBtn.style.color = "#fff";
      cancelBtn.style.border = "1px solid #444";
      cancelBtn.style.borderRadius = "4px";
      cancelBtn.style.cursor = "pointer";

      footerRow.appendChild(cancelBtn);

      function closeCalendar(){
        try{
          if (backdrop && backdrop.parentNode) {
            backdrop.parentNode.removeChild(backdrop);
          }
        }catch(_){}
      }

      function sendExamDateToSync(dateStr){
        try{
          fetch("/api/sync/merge", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              exam_date_iso: String(dateStr || "")
            })
          })
            .then(function(res){
              try{
                if (!res || !res.ok) return null;
                return res.json().catch(function(){ return null; });
              }catch(_){
                return null;
              }
            })
            .then(function(json){
              try{
                if (json && typeof window !== "undefined"){
                  window.CSCS_SYNC_DATA = json;
                  try{
                    var ev = new CustomEvent("cscs-sync-updated", { detail: { source: "nl_daily_summary_exam" } });
                    window.dispatchEvent(ev);
                  }catch(_){}
                }
              }catch(_){}
              try{
                window.location.reload();
              }catch(_){}
            })
            .catch(function(_){});
        }catch(_){}
      }

      function handleSelectDate(dateStr){
        try{
          localStorage.setItem("cscs_exam_date", dateStr);
        }catch(_){}
        try{
          sendExamDateToSync(dateStr);
        }catch(_){}
        try{
          var tmpRoot = { exam_date: dateStr };
          summaryLine4.innerHTML = buildExamLineText(new Date(), tmpRoot);
          summaryLine4.appendChild(document.createTextNode("｜"));
          summaryLine4.appendChild(examButtonSpan);
        }catch(_){}
        closeCalendar();
      }

      function pad2Int(n){
        return String(n).padStart(2, "0");
      }

      function renderCalendar(){
        while (grid.childNodes.length > 7) {
          grid.removeChild(grid.lastChild);
        }

        monthLabel.textContent = String(currentYear) + "年" + String(currentMonth + 1) + "月";

        var first = new Date(currentYear, currentMonth, 1);
        var startDow = first.getDay();
        var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

        var selectedDay = null;
        if (currentValue) {
          var sd = new Date(currentValue);
          if (!isNaN(sd.getTime()) && sd.getFullYear() === currentYear && sd.getMonth() === currentMonth) {
            selectedDay = sd.getDate();
          }
        }

        var i;
        for (i = 0; i < startDow; i++) {
          var emptyCell = document.createElement("div");
          emptyCell.textContent = "";
          grid.appendChild(emptyCell);
        }

        var day;
        for (day = 1; day <= daysInMonth; day++) {
          (function(d){
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = String(d);
            btn.style.width = "100%";
            btn.style.padding = "4px 0";
            btn.style.fontSize = "12px";
            btn.style.background = "#222";
            btn.style.color = "#fff";
            btn.style.border = "1px solid #444";
            btn.style.borderRadius = "4px";
            btn.style.cursor = "pointer";

            if (selectedDay === d) {
              btn.style.background = "#3a6fd8";
              btn.style.borderColor = "#3a6fd8";
            }

            btn.addEventListener("click", function(){
              var monthStr = pad2Int(currentMonth + 1);
              var dayStr = pad2Int(d);
              var dateStr = String(currentYear) + "-" + monthStr + "-" + dayStr;
              handleSelectDate(dateStr);
            });

            grid.appendChild(btn);
          })(day);
        }
      }

      prevBtn.addEventListener("click", function(){
        currentMonth -= 1;
        if (currentMonth < 0) {
          currentMonth = 11;
          currentYear -= 1;
        }
        renderCalendar();
      });

      nextBtn.addEventListener("click", function(){
        currentMonth += 1;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear += 1;
        }
        renderCalendar();
      });

      cancelBtn.addEventListener("click", function(){
        closeCalendar();
      });

      backdrop.addEventListener("click", function(ev){
        if (ev.target === backdrop) {
          closeCalendar();
        }
      });

      box.appendChild(headerRow);
      box.appendChild(grid);
      box.appendChild(footerRow);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      renderCalendar();
    }catch(_){}
  }

  function removeExistingHeaders(){
    // 既存ヘッダーを確実に除去（過去にどこへ挿入されていても消す）
    // 目的:
    // - #nl-panel 前提を廃止しても、重複生成だけは確実に防ぐ
    try{
      var a = document.getElementById("nl-progress-header");
      if (a && a.parentNode) a.parentNode.removeChild(a);
    }catch(_){}
    try{
      var b = document.getElementById("nl-summary-header");
      if (b && b.parentNode) b.parentNode.removeChild(b);
    }catch(_){}
    try{
      var h = document.getElementById("nl-daily-summary-host");
      if (h && h.parentNode) h.parentNode.removeChild(h);
    }catch(_){}
  }

  async function mountHeaders(){
    // 追加:
    // - nav_list.js / #nl-panel 依存を断つため、#root が無いページでは何もしない
    if (!hasRoot()) return;

    ensureHeaderStyles();

    // 追加:
    // - ヘッダーの挿入先を #root に固定する（#nl-panel を一切参照しない）
    var root = document.getElementById("root");
    if (!root) return;

    // 変更:
    // - removeExistingHeaders の panel 引数依存を廃止した前提で呼ぶ
    removeExistingHeaders();

    var day = getDayFromPath();
    var syncJson = await loadSyncData();
    var syncRoot = getSyncRoot(syncJson);

    var allDays = buildDayArray("20250926", "20251224");
    var TOTAL_QUESTIONS_PER_DAY = 30;

    var syncTotalQuestions = null;
    try {
      if (syncRoot && typeof syncRoot === "object" && syncRoot.global && typeof syncRoot.global === "object") {
        var tqRaw = syncRoot.global.totalQuestions;
        if (typeof tqRaw === "number" && Number.isFinite(tqRaw) && tqRaw > 0) {
          syncTotalQuestions = tqRaw;
        }
      }
    } catch (_){
      syncTotalQuestions = null;
    }

    var totalQuestionsAll = 0;
    if (syncTotalQuestions !== null) {
      totalQuestionsAll = syncTotalQuestions;
    } else {
      totalQuestionsAll = allDays.length * TOTAL_QUESTIONS_PER_DAY;
    }

    var starQuestionCount = 0;
    var starFullDayCount = 0;

    allDays.forEach(function(dayStr){
      var dayStarCount = 0;
      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS_PER_DAY; qIndex++){
        var n3 = pad3(qIndex);
        var qid = dayStr + "-" + n3;
        var streakTotal = 0;

        if (syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)) {
          streakTotal = Number(syncRoot.streak3[qid] || 0);
        }

        if (streakTotal > 0){
          starQuestionCount += 1;
          dayStarCount += 1;
        }
      }
      if (dayStarCount === TOTAL_QUESTIONS_PER_DAY){
        starFullDayCount += 1;
      }
    });

    var consistencyQuestionCount = 0;
    var consistencyFullDayCount = 0;

    allDays.forEach(function(dayStr){
      var dayConsistentCount = 0;
      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS_PER_DAY; qIndex++){
        var n3 = pad3(qIndex);
        var info = getConsistencyInfoFromSync(dayStr, n3, syncRoot);
        var statusMark = info.statusMark;

        if (statusMark === "◎"){
          consistencyQuestionCount += 1;
          dayConsistentCount += 1;
        }
      }
      if (dayConsistentCount === TOTAL_QUESTIONS_PER_DAY){
        consistencyFullDayCount += 1;
      }
    });

    var totalQuestionsStr = String(totalQuestionsAll);
    var totalDaysStr = String(allDays.length);

    var starQStr = String(starQuestionCount).padStart(4, "0");
    var starDayStr = pad2(starFullDayCount);
    var starRate = totalQuestionsAll > 0 ? (starQuestionCount / totalQuestionsAll) * 100 : 0;
    var starRateStr = formatPercent1(starRate);

    var consQStr = String(consistencyQuestionCount).padStart(4, "0");
    var consDayStr = pad2(consistencyFullDayCount);
    var consRate = totalQuestionsAll > 0 ? (consistencyQuestionCount / totalQuestionsAll) * 100 : 0;
    var consRateStr = formatPercent1(consRate);

    // 日別進捗（allDays のうち “30/30 ★付き” の日数）
    var dayFilled = starFullDayCount;
    var dayTotal = allDays.length;
    var todayIndex = (function(){
      try{
        var idx = allDays.indexOf(day);
        return idx >= 0 ? idx : null;
      }catch(_){
        return null;
      }
    })();

    // 問題進捗（当日の30問のうち “★付き” の問題数）
    var qFilled = 0;
    if (day && day !== "unknown"){
      var i;
      for (i = 1; i <= TOTAL_QUESTIONS_PER_DAY; i++){
        var n3 = pad3(i);
        var qid = day + "-" + n3;
        var streakTotal = 0;
        if (syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)) {
          streakTotal = Number(syncRoot.streak3[qid] || 0);
        }
        if (streakTotal > 0) qFilled += 1;
      }
    }

    // progress header
    var progressHost = document.createElement("div");
    progressHost.id = "nl-progress-header";
    try{
      // ▼ 見た目は ensureHeaderStyles() に集約（ここでは style を触らない）
      // 目的: スタイル管理の分散を防ぐ
    }catch(_){}

    // =========================================================
    // 進捗ヘッダー（マス目）構築
    //
    // ここで表示しているのは2種類：
    // 1) 日別進捗マス：期間全体（allDays）の進捗
    //    - 1マス = 1日
    //    - “30/30 ★” 達成日だけが進捗として埋まる（dayFilled）
    //
    // 2) 問題別進捗マス：当日の進捗
    //    - 1マス = 1問
    //    - “★（streak3 > 0）” の問題数だけが進捗として埋まる（qFilled）
    //
    // ※ このファイルは「取れないものを別ソースで埋め合わせない」方針なので、
    //    day が unknown の時は問題別進捗が 0 のままになる（＝取れない表示）。
    // =========================================================

    // =========================================================
    // 日別マス（kind="day"）
    //
    // 第3引数 cols=15 は “見た目の列数”。
    // - 今は 15 列にしているので、日数が多い場合は複数行に折り返される。
    //
    // ※ todayIndex は “日別だけ” ハイライト表示に使う（当日位置の強調）。
    // =========================================================
    progressHost.appendChild(buildProgressGrid(dayTotal, dayFilled, 15, todayIndex, "day"));

    // =========================================================
    // 問題別マス（kind="q"）
    //
    // 「30個横一列」を成立させるために cols=30 にしている。
    // =========================================================
    // 現在表示中の問題インデックス（0始まり）
    var currentQIndex = getQuestionIndexFromPath();

    // 今日解いた問題（oncePerDayToday.results）を取得
    // - results は { "YYYYMMDD-NNN": "correct"/"wrong" } を想定
    // - 表示マスは 0始まりindex（0..29）なので、indexMap に変換して渡す
    var todaySolvedMap = {};
    try{
      if (
        syncRoot &&
        syncRoot.oncePerDayToday &&
        String(syncRoot.oncePerDayToday.day) === String(day) &&
        syncRoot.oncePerDayToday.results &&
        typeof syncRoot.oncePerDayToday.results === "object"
      ){
        todaySolvedMap = syncRoot.oncePerDayToday.results;
      }
    }catch(_){
      todaySolvedMap = {};
    }

    // { index(0..29): "correct"/"wrong" } に変換
    var todaySolvedIndexMap = {};
    try{
      if (todaySolvedMap && typeof todaySolvedMap === "object"){
        Object.keys(todaySolvedMap).forEach(function(qid){
          var m = String(qid || "").match(/-(\d{3})$/);
          if (!m) return;
          var n = Number(m[1]);
          if (!Number.isFinite(n) || n <= 0) return;
          var idx0 = n - 1;
          if (idx0 < 0 || idx0 >= 30) return;
          todaySolvedIndexMap[idx0] = todaySolvedMap[qid];
        });
      }
    }catch(_){
      todaySolvedIndexMap = {};
    }

    // 今日解いた問題だけ色を付ける（過去日の痕跡は一切出さない）
    var qSolvedIndexMapForUi = {};
    try{
      if (todaySolvedIndexMap && typeof todaySolvedIndexMap === "object") {
        Object.keys(todaySolvedIndexMap).forEach(function(k){
          qSolvedIndexMapForUi[k] = todaySolvedIndexMap[k];
        });
      }
    }catch(_){
      qSolvedIndexMapForUi = {};
    }

    progressHost.appendChild(
      buildProgressGrid(
        30,                    // total（問題数）
        qFilled,               // filled（★獲得済み数）
        30,                    // cols（横一列）
        currentQIndex,         // 現在位置（点滅）
        "q",
        qSolvedIndexMapForUi    // 今日(強)＋過去(薄) の合成マップ
      )
    );

    // =========================================================
    // 進捗テキスト（数字の行）を “問題別マスの下” に統合表示する
    // =========================================================
    var progressRow = document.createElement("div");
    progressRow.className = "nl-ph-row";

    // 左側ラベル（現状は「問題」を代表ラベルとしている）
    var qTitle = document.createElement("div");
    qTitle.className = "nl-ph-title";
    qTitle.textContent = "問題";

    // 右側：現在位置＋日付＋進捗の統合表示
    var mergedValue = document.createElement("div");
    mergedValue.className = "nl-ph-value";

    // 現在の問題番号（1始まり）
    var currentQNo = null;
    if (typeof currentQIndex === "number" && currentQIndex >= 0) {
      currentQNo = currentQIndex + 1;
    }

    // 日付（YYYYMMDD → YYYY年M月D日）
    var dayLabel = "";
    if (day && day !== "unknown") {
      dayLabel =
        day.slice(0, 4) +
        "年" +
        String(Number(day.slice(4, 6))) +
        "月" +
        String(Number(day.slice(6, 8))) +
        "日";
    }

    // ▼ 全体日数の中で「何日目か」を計算する
    // - allDays は buildDayArray() で作られた全日付配列
    // - indexOf(day) は 0始まりなので +1 する
    var dayIndexInAll = null;
    if (day && day !== "unknown") {
      try {
        var idx = allDays.indexOf(day);
        if (idx >= 0) {
          dayIndexInAll = idx + 1;
        }
      } catch (_){}
    }

    mergedValue.textContent =
      (currentQNo !== null ? "Q" + String(currentQNo) + " / 30" : "Q? / 30") +
      (dayLabel ? " ｜ " + dayLabel : "") +
      " ｜ 日別 " +
      (dayIndexInAll !== null ? String(dayIndexInAll) : "?") +
      " / " +
      String(dayTotal);

    progressRow.appendChild(qTitle);
    progressRow.appendChild(mergedValue);
    progressHost.appendChild(progressRow);

    // summary header
    var summaryHost = document.createElement("div");
    summaryHost.id = "nl-summary-header";
    try{
      // ▼ 見た目は ensureHeaderStyles() に集約（ここでは style を触らない）
      // 目的: スタイル管理の分散を防ぐ
    }catch(_){}

    // ▼ ⭐️行・◎行をまとめて再描画できるように専用ラッパーを作る
    var summaryStatBlock = document.createElement("div");
    summaryStatBlock.id = "nl-summary-stat-block";

    var summaryLine2 = document.createElement("div");
    var summaryLine3 = document.createElement("div");
    var summaryLine4 = document.createElement("div");

    // 試験日行：クラス付与（見た目調整はCSS側で扱う）
    summaryLine4.className = "nl-exam-line";

    var examButtonSpan = document.createElement("span");
    examButtonSpan.textContent = "[試験日設定]";
    examButtonSpan.style.cursor = "pointer";
    examButtonSpan.style.fontSize = "13px";
    examButtonSpan.style.marginLeft = "4px";

    var now = new Date();

    summaryLine2.style.marginTop = "0";
    summaryLine2.textContent =
      "⭐️｜獲得済｜" +
      starQStr +
      "／" +
      totalQuestionsStr +
      "｜" +
      starDayStr +
      "／" +
      totalDaysStr +
      "｜" +
      starRateStr +
      "% 達成";

    summaryLine3.textContent =
      "◎｜整合性｜" +
      consQStr +
      "／" +
      totalQuestionsStr +
      "｜" +
      consDayStr +
      "／" +
      totalDaysStr +
      "｜" +
      consRateStr +
      "% 達成";
    summaryLine3.style.marginBottom = "0";

    summaryLine4.innerHTML = buildExamLineText(now, syncRoot);
    summaryLine4.appendChild(document.createTextNode("｜"));
    summaryLine4.appendChild(examButtonSpan);

    examButtonSpan.addEventListener("click", function(){
      openExamCalendar(summaryLine4, examButtonSpan);
    });

    // ▼ ⭐️/◎ 行はラッパーにまとめてから summaryHost に入れる
    summaryStatBlock.appendChild(summaryLine2);
    summaryStatBlock.appendChild(summaryLine3);

    summaryHost.appendChild(summaryStatBlock);
    summaryHost.appendChild(summaryLine4);

    // 変更:
    // - #root 内に host を作ってそこにヘッダーを積む（#nl-panel を一切参照しない）
    var host = document.createElement("div");
    host.id = "nl-daily-summary-host";

    try{
      // ▼ #nl-daily-summary-host の配置/見た目は ensureHeaderStyles() に集約
      // 目的: 固定座標や余白の管理をCSS側に寄せる
    }catch(_){}

    // 追加:
    // - #root の先頭へ挿入する（#root 内に入れる）
    try{
      if (root.firstChild) {
        root.insertBefore(host, root.firstChild);
      } else {
        root.appendChild(host);
      }
    }catch(_){
      return;
    }

    // host の中にヘッダーを積む（#root 内で完結）
    host.appendChild(progressHost);
    host.appendChild(summaryHost);
  }

  window.CSCS_NL_DAILY_SUMMARY = {
    mount: mountHeaders
  };

  window.addEventListener("DOMContentLoaded", function(){
    if (!hasRoot()) return;
    mountHeaders();
  });

  window.addEventListener("cscs-sync-updated", function(){
    try{
      setTimeout(function(){
        refreshSummaryStatBlock();
      }, 1000);
    }catch(_){}
  });
})();