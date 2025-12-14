/**
 * nav_list.js —：問題一覧（nav_manifest.json版 / 2カラム表示）
 *
 * このファイルで使用する LocalStorage / SYNC(JSON) のキー対応表をここに一覧する。
 *
 * 【重要：開発ルール（恒久）】
 *   📌 このファイル内で LocalStorage / SYNC のキー名に
 *       「変更」または「新規追加」が発生した場合は、
 *       必ずこのキー対応表コメントを更新すること。
 *
 * ▼ LocalStorage キー
 *   - "cscs_fav"
 *   - "cscs_fav_map"
 *   - "cscs_results"
 *   - "cscs_wrong_log"
 *   - "cscs_q_correct_total:" + qid      // b_judge_record.js 由来の問題別「正解」累計
 *   - "cscs_q_wrong_total:"   + qid      // b_judge_record.js 由来の問題別「不正解」累計
 *   - "cscs_exam_date"                    // 試験日カレンダー用
 *
 * ▼ SYNC state(JSON) 内で参照するキー
 *   - root.streak3[qid]                   // 3連続「正解」達成回数（累計）
 *   - root.streakLen[qid]                 // 現在の連続「正解」長
 *   - root.streak3Wrong[qid]              // 3連続「不正解」達成回数（累計）
 *   - root.streakWrongLen[qid]            // 現在の連続「不正解」長
 *   - root.consistency_status[qidJp].status_mark  // 整合性チェックの記号（◎/○/△/×など）
 *   - root.oncePerDayToday.day
 *   - root.oncePerDayToday.results[qid]   // 本日の oncePerDay 計測結果
 *   - root.global.totalQuestions          // 全問題数（任意）
 *   - root.exam_date                      // 試験日 (ISO8601文字列)
 *
 *   ※ window.CSCS_SYNC_DATA.data が存在する場合はそれを root として扱い、
 *     無い場合は window.CSCS_SYNC_DATA を root として扱う。
 */
(function(){
  "use strict";

  // ナビパネルを「常時表示」にするかどうか
  // true  : A/B 両方で常時表示（トグルボタンなし / パネルは自動表示）
  // false : 画面下部の「📋 問題一覧表示」ボタンで開閉
  const NAV_ALWAYS_OPEN = true;

  // =========================
  // デバッグフラグ（ナビリストの1問ごとのログ出力）
  // true にすると streak/oncePerDay の詳細ログを全問分出す
  // =========================
  var DEBUG_NAV_LIST_STREAK_LOG = false;

  // =========================
  // SYNC状態のロード
  // =========================
  async function loadSyncDataForNavList(){
    try{
      // /api/sync/state から最新の SYNC データを取得
      const res = await fetch(location.origin + "/api/sync/state", { cache: "no-store" });
      const json = await res.json();
      // 正常なオブジェクトでなければ空にしておく
      if (!json || typeof json !== "object") {
        window.CSCS_SYNC_DATA = {};
      } else {
        window.CSCS_SYNC_DATA = json;
      }
    }catch(e){
      console.error("nav_list.js: SYNC 読み込み失敗:", e);
      window.CSCS_SYNC_DATA = {};
    }
    return window.CSCS_SYNC_DATA;
  }

  // =========================
  // 位置やパスに関するユーティリティ
  // =========================

  // A/BパートのURLかどうか（qNNN_a.html / qNNN_b.html 判定）
  function isAPart(){
    return /_(a|b)(?:\.html)?(?:\?.*)?(?:#.*)?$/i.test(String(location.href || ""));
  }

  // 現在開いている日付（_build_cscs_YYYYMMDD から YYYYMMDD を抜き出す）
  function getDayFromPath(){
    var m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }

  // ゼロ埋めユーティリティ
  function pad2(n){ return String(n).padStart(2, "0"); }
  function pad3(n){ return String(n).padStart(3, "0"); }

  // "YYYYMMDD" + "NNN" → "YYYY年M月D日-NNN" の日本語QID形式に変換
  function toJpDateQid(day, n3){
    var y = day.slice(0, 4);
    var m = String(Number(day.slice(4, 6)));
    var d = String(Number(day.slice(6, 8)));
    return y + "年" + m + "月" + d + "日-" + n3;
  }

  // SYNCの consistency_status から「◎/○/△/×」などのステータスマークを取り出す
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

  // 現在開いている A/B の問題番号（q013_a.html / q013_b.html → "013"）を取得
  function getCurrentQuestionNumber3(){
    try{
      var path = window.location.pathname || "";
      var m = path.match(/(?:^|\/)q(\d{3})_[ab](?:\.html)?$/);
      return m ? m[1] : null;
    }catch(_){
      return null;
    }
  }

  // =========================
  // 背景スクロールロック制御（モーダル風）
  // =========================

  /* 背景スクロールロック */
  function lockBodyScroll(){
    try{
      var y = window.scrollY || 0;
      // HTMLに「data-nl-open」を付与（CSS側で状態に使える）
      document.documentElement.setAttribute("data-nl-open", "1");
      // bodyを固定して、現在位置を top に記憶
      Object.assign(document.body.style, {
        position: "fixed",
        top: "-" + y + "px",
        left: "0",
        right: "0",
        width: "100%"
      });
      document.body.dataset.nlLockY = String(y);
    }catch(_){}
  }

  // ロック解除（元のスクロール位置に戻す）
  function unlockBodyScroll(){
    try{
      var y = Number(document.body.dataset.nlLockY || "0") || 0;
      Object.assign(document.body.style, {
        position: "",
        top: "",
        left: "",
        right: "",
        width: ""
      });
      document.documentElement.removeAttribute("data-nl-open");
      window.scrollTo(0, y);
    }catch(_){}
  }

  // =========================
  // 成績読み取り（localStorage / cscs_results / cscs_wrong_log）
  // =========================

  /* 成績読み取り（localStorageから） */
  function readStats(day, n3){
    var stem = "q" + n3;

    // 1日の中で「最大の runId（最後にプレイした周回）」を取得
    function getMaxRunIdForDay(day, all){
      var runs = all.filter(function(r){
        return r && r.day === day && Number.isInteger(r.runId);
      }).map(function(r){ return r.runId; });
      return runs.length ? Math.max.apply(null, runs) : 0;
    }

    var all = [];
    try { all = JSON.parse(localStorage.getItem("cscs_results") || "[]"); } catch(_){ all = []; }
    var latestRun = getMaxRunIdForDay(day, all) || 1;

    // 当日・当該問題・最後の runId に絞った履歴を取得（時系列順）
    var rows = all.filter(function(r){
      return r && r.day === day && r.runId === latestRun && r.stem === stem;
    }).sort(function(a,b){ return a.ts - b.ts; });

    // 正解・不正解の累計回数
    var correct = rows.filter(function(r){ return !!r.correct; }).length;
    var wrong   = rows.filter(function(r){ return !r.correct; }).length;

    // sc/sw: 末尾から見た直近の「連続正/連続誤」の数
    var sc = 0, sw = 0;
    for (var i = rows.length - 1; i >= 0; i--){
      if (rows[i].correct) {
        if (sw > 0) break;
        sc += 1;
      } else {
        if (sc > 0) break;
        sw += 1;
      }
    }

    // 「この問題は⭐️クリア済みか？」（3連続正解を達成したことがあるか）
    var cleared = false;
    if (rows.length){
      var maxStreak = 0, cur = 0;
      for (var j=0;j<rows.length;j++){
        if (rows[j].correct){ cur += 1; maxStreak = Math.max(maxStreak, cur); }
        else { cur = 0; }
      }
      cleared = (maxStreak >= 3);
      // ただし末尾2回連続で不正解なら「クリア扱いは解除」
      if (cleared && rows.length >= 2){
        var n = rows.length;
        if (!rows[n-1].correct && !rows[n-2].correct){
          cleared = false;
        }
      }
    }

    // 不正解回数ログ（day-n3 単位）の参照
    var wrongLogCount = 0;
    try{
      var log = JSON.parse(localStorage.getItem("cscs_wrong_log") || "{}");
      var qnum = n3;
      var qid  = day + "-" + qnum;
      wrongLogCount = Number(log[qid] || 0);
    }catch(_){ wrongLogCount = 0; }

    return { correct: correct, wrong: wrong, sc: sc, sw: sw, cleared: cleared, wrongLog: wrongLogCount };
  }

  // =========================
  // 右カラム：DAY一覧の描画
  // =========================

  // 日別リスト（DAY-01〜）を右カラムに描画
  function renderDayList(rightCol, currentDay){
    if (!rightCol) {
      return;
    }

    // 開始日〜終了日までの "YYYYMMDD" の配列を作る
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

    // ★ CSCS日程（ここを変えればレンジも変えられる）
    var days = buildDayArray("20250926", "20251224");

    // SYNC データから streak3（3連続正解総回数）を参照するためのルートを取得
    var syncRoot = {};
    try{
      if (window.CSCS_SYNC_DATA && typeof window.CSCS_SYNC_DATA === "object") {
        if (window.CSCS_SYNC_DATA.data && typeof window.CSCS_SYNC_DATA.data === "object") {
          syncRoot = window.CSCS_SYNC_DATA.data;
        } else {
          syncRoot = window.CSCS_SYNC_DATA;
        }
      }
    }catch(_){
      syncRoot = {};
    }

    // 各日ごとに「DAY / 日付 / ★獲得率 / 日別⭐️〜💫」を表示
    days.forEach(function(dayStr, idx){
      var isCurrent = (dayStr === currentDay);

      var TOTAL_QUESTIONS = 30;

      // その日30問分のスター状況を集計
      var anyStarCount = 0;   // 3連続正解を1回以上達成している問題数
      var starGe1 = 0;        // ランク1以上（⭐️以上）の問題数
      var starGe2 = 0;        // ランク2以上（🌟以上）
      var starGe3 = 0;        // ランク3以上（💫）

      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS; qIndex++){
        var n3 = pad3(qIndex);
        var qid = dayStr + "-" + n3;
        var streakTotal = 0;

        // SYNC上の streak3[qid] が「この問題の3連続正解達成回数」
        if (syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)) {
          streakTotal = Number(syncRoot.streak3[qid] || 0);
        }

        // 3連続正解達成回数 0 の問題は「★なし」とみなしてカウントしない
        if (!(streakTotal > 0)) {
          continue;
        }

        // streakTotal から「⭐️/🌟/💫」に変換（関数が無い場合はとりあえず⭐️）
        var symbol = "";
        if (typeof window !== "undefined" && typeof window.cscsGetStarSymbolFromStreakCount === "function") {
          symbol = window.cscsGetStarSymbolFromStreakCount(streakTotal) || "⭐️";
        } else {
          symbol = "⭐️";
        }

        anyStarCount += 1;

        // ランク別にカウント（⭐️,🌟,💫）
        if (symbol === "⭐️") {
          starGe1 += 1;
        } else if (symbol === "🌟") {
          starGe1 += 1;
          starGe2 += 1;
        } else if (symbol === "💫") {
          starGe1 += 1;
          starGe2 += 1;
          starGe3 += 1;
        }
      }

      // その日の「★付き問題割合」をパーセントで算出
      var ratePercent = TOTAL_QUESTIONS > 0 ? Math.round((anyStarCount / TOTAL_QUESTIONS) * 100) : 0;

      // DAY 見出しに付けるシンボル（30/30 の場合のみ）
      var daySuffix = "";
      if (anyStarCount === TOTAL_QUESTIONS) {
        if (starGe3 === TOTAL_QUESTIONS) {
          // 全30問が 💫
          daySuffix = "💫";
        } else if (starGe2 === TOTAL_QUESTIONS) {
          // 全30問が 🌟（以上）
          daySuffix = "🌟";
        } else if (starGe1 === TOTAL_QUESTIONS) {
          // 全30問が ⭐️（以上）
          daySuffix = "⭐️";
        }
      }

      // 1日分の表示ブロックをDOM構築
      var item = document.createElement("div");
      item.className = "nl-day-item" + (isCurrent ? " is-current" : "");

      var link = document.createElement("a");
      // その日の1問目Aパートへのリンク（手動ナビモード）
      var dayUrl = "/_build_cscs_" + dayStr + "/slides/q001_a.html?nav=manual";
      link.href = dayUrl;
      link.setAttribute("data-nl-allow", "1");
      link.style.display = "block";
      link.style.textDecoration = "none";
      link.addEventListener("click", function(ev){
        // 修飾キー（Cmd/Ctrl/Shift/Alt）付きや中クリックなどはブラウザ標準の挙動に任せる
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        try{
          window.location.assign(dayUrl);
        }catch(_){}
      });

      // 1行目: DAY-XX + 全クリ度シンボル
      var titleRow = document.createElement("div");
      titleRow.className = "nl-day-title";
      titleRow.textContent = "DAY-" + pad2(idx + 1) + daySuffix;

      // 2行目: 実際の日付 YYYYMMDD
      var dateRow = document.createElement("div");
      dateRow.textContent = dayStr;

      // 3行目: 獲得：X/30
      // 4行目: 達成(YY%)
      var rateRow = document.createElement("div");
      rateRow.textContent =
        "獲得：" +
        String(anyStarCount) +
        "/" +
        String(TOTAL_QUESTIONS);

      var percentRow = document.createElement("div");
      percentRow.textContent =
        "達成(" +
        String(ratePercent) +
        "%)";

      // 表示順:
      // DAY-XX(⭐️) / YYYYMMDD / 獲得：X/30 / 達成(YY%)
      link.appendChild(titleRow);
      link.appendChild(dateRow);
      link.appendChild(rateRow);
      link.appendChild(percentRow);

      item.appendChild(link);
      rightCol.appendChild(item);
    });
  }

  // =========================
  // 下部の「📋 問題一覧表示」トグルボタン生成
  // =========================

  /* Aパート下部中央のトグルボタンを挿入（開いている間は✖️ 閉じる　に変化） */
  function ensureToggle(){
    // 常時表示モードのときはトグルボタン自体を出さない
    if (NAV_ALWAYS_OPEN) return;

    // A/Bパート以外ではボタン不要
    if (!isAPart()) return;
    if (document.getElementById("nl-toggle")) return;

    var btn = document.createElement("button");
    btn.id = "nl-toggle";
    btn.textContent = "📋 問題一覧表示";

    // ボタンのラベルを、パネルの開閉状態に合わせて同期
    function syncLabel(){
      const panel = document.getElementById("nl-panel");
      const opened = panel && panel.style.display === "block";
      btn.textContent = opened ? "✖️ 閉じる　" : "📋 問題一覧表示";
      btn.setAttribute("aria-pressed", opened ? "true" : "false");
    }

    // hover時に少し明るく
    btn.addEventListener("mouseenter", function(){ try { btn.style.filter = "brightness(1.1)"; } catch(_){ } });
    btn.addEventListener("mouseleave", function(){ try { btn.style.filter = ""; } catch(_){ } });

    // クリックでパネル開閉（必要に応じて mount ）
    btn.addEventListener("click", async function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      const panel = document.getElementById("nl-panel");
      const willOpen = !panel || panel.style.display === "none";
      if (willOpen){
        await mountAndOpenPanel();
      } else {
        panel.style.display = "none";
        unlockBodyScroll();
      }
      syncLabel();
    });

    document.body.appendChild(btn);
  }

  // =========================
  // パネル生成（DOMだけ用意して、中身は別関数で描画）
  // =========================

  /* パネル生成 */
  function ensurePanel(){
    if (document.getElementById("nl-panel")) return;

    var panel = document.createElement("div");
    panel.id  = "nl-panel";

    // パネルの見た目・位置（画面上部固定 / 半透明 / スクロール領域を中に持つ）
    Object.assign(panel.style, {
      position: "fixed",
      left: "16px",
      right: "16px",
      top: "12px",
      bottom: "66px",
      overflow: "hidden",
      background: "rgba(0, 0, 0, 0.6)",
      border: "1px solid rgb(51, 51, 51)",
      borderRadius: "12px",
      padding: "14px 16px 0px",
      zIndex: "99999",
      display: "none",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      maxHeight: "calc(100vh - 24px)",
      opacity: "0.5",
      pointerEvents: "none",
      transition: "opacity 0.5s ease-in-out"
    });

    // #root があればその中に、それ以外は body 直下に追加
    var root = document.getElementById("root");
    if (root){
      root.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }

    /* クリックバブリング抑止（内部以外のクリックで閉じない設計） */
    panel.addEventListener("click", function(e){
      var inside = e.target && e.target.closest("#nl-panel");
      if (!inside) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  // =========================
  // nav_manifest.json からリストを構築してパネルに描画
  // =========================

  /* メイン描画：nav_manifest.json から構築 */
  async function renderListInto(panel){
    // パネル内を一度クリア
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    const day = getDayFromPath();              // このページの日付
    const currentN3 = getCurrentQuestionNumber3(); // 現在の問題番号 3桁
    let manifest = null;
    try {
      // 同じフォルダ内の nav_manifest.json を取得
      const res = await fetch("nav_manifest.json", { cache: "no-store" });
      manifest = await res.json();
    } catch (e) {
      console.error("nav_manifest.json 読み込み失敗:", e);
      panel.innerHTML = "<p style='color:red;padding:16px;'>nav_manifest.json の読み込みに失敗しました。</p>";
      return;
    }

    // nav_manifest 先頭行から「タイトル/分野/テーマ」を拾う
    const title = manifest.questions?.[0]?.Title || "NSCA CSCS 試験対策問題集";
    const field = manifest.questions?.[0]?.Field || "—";
    const theme = manifest.questions?.[0]?.Theme || "—";

    // SYNC ルート取得（streak3 / consistency_status / exam_date などをまとめて見る）
    var syncRoot = {};
    try {
      if (window.CSCS_SYNC_DATA && typeof window.CSCS_SYNC_DATA === "object") {
        if (window.CSCS_SYNC_DATA.data && typeof window.CSCS_SYNC_DATA.data === "object") {
          syncRoot = window.CSCS_SYNC_DATA.data;
        } else {
          syncRoot = window.CSCS_SYNC_DATA;
        }
      }
    } catch (_) {
      syncRoot = {};
    }

    // =========================
    // CSCS 全体サマリー（★／◎）の集計
    // =========================

    // ★ CSCS全体サマリー用：日付配列生成（90日分）
    function buildDayArrayForSummary(startStr, endStr){
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

    // 全日付リスト（ここも nav_list 内で固定）
    var allDays = buildDayArrayForSummary("20250926", "20251224");
    var TOTAL_QUESTIONS_PER_DAY = 30;

    // ★総問題数
    //   - デフォルト : allDays.length * 30
    //   - ただし SYNC の global.totalQuestions があればそちらを優先して採用
    var totalQuestionsAll = 0;
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
    if (syncTotalQuestions !== null) {
      totalQuestionsAll = syncTotalQuestions;
    } else {
      totalQuestionsAll = allDays.length * TOTAL_QUESTIONS_PER_DAY;
    }

    // ★ 獲得済（3連続正解1回以上）の集計（問題単位/日単位）
    var starQuestionCount = 0;  // 「★付き問題」の総数
    var starFullDayCount = 0;   // 「その日30問すべて★付き」の日数

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

    // ◎ 整合性集計（status_mark が「◎」の問題数 / 日数）
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

    // パーセント表示用（小数1桁）
    function formatPercent1(value){
      var n = Number(value) || 0;
      return n.toFixed(1);
    }

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

    // ▼ 全体サマリー（画面上部に固定されるヘッダー）DOM構築
    // ▼（仮）日別/問題別 達成ゲージ（ダミー値）を summary の上に置く
    var progressHost = document.createElement("div");
    progressHost.id = "nl-progress-header";
    try{
      Object.assign(progressHost.style, {
        position: "sticky",
        top: "0px",
        zIndex: "100001",
        background: "none",
        padding: "8px 10px 10px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgb(42, 42, 42)",
        textAlign: "left",
        opacity: "0.9"
      });
    }catch(_){}

    // ▼（仮）見た目用CSS（ヘッダー内のマス目とバー）
    // ここは「nav_list 内だけ」に閉じるため、クラスは nl- 接頭辞で統一
    try{
      var style2 = document.createElement("style");
      style2.textContent =
        "#nl-progress-header{ font-family: ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif; }" +
        "#nl-progress-header .nl-ph-row{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; }" +
        "#nl-progress-header .nl-ph-title{ font-size:12px; letter-spacing:0.02em; opacity:0.85; }" +
        "#nl-progress-header .nl-ph-value{ font-size:12px; font-variant-numeric: tabular-nums; opacity:0.7; }" +
        "#nl-progress-header .nl-ph-grid{ margin-top:6px; display:grid; gap:2px; }" +
        "#nl-progress-header .nl-ph-cell{ width:6px; height:6px; border-radius:2px; background: rgba(255,255,255,0.10); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }" +
        "#nl-progress-header .nl-ph-cell.is-on{ background: rgba(255,255,255,0.78); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }" +
        "#nl-progress-header .nl-ph-cell.is-today{ background: rgba(255,255,255,0.92); box-shadow: 0 0 0 1px rgba(255,255,255,0.10), 0 0 10px rgba(255,255,255,0.10); }" +
        "#nl-progress-header .nl-ph-spacer{ height:10px; }" +
        "#nl-progress-header .nl-ph-bar{ margin-top:6px; height:8px; border-radius:999px; background: rgba(255,255,255,0.10); overflow:hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }" +
        "#nl-progress-header .nl-ph-bar > div{ height:100%; width:0%; background: rgba(255,255,255,0.80); border-radius:999px; }";
      document.head.appendChild(style2);
    }catch(_){}

    // ▼（仮）マス目を作るヘルパー（ダミー値）
    // - total=90 のマスを grid に並べ、filled 個だけ is-on で埋める
    // - todayIndex は「今日のマス」を少し強調する（見た目だけ）
    function buildProgressGrid(total, filled, cols, todayIndex){
      var grid = document.createElement("div");
      grid.className = "nl-ph-grid";
      try{
        grid.style.gridTemplateColumns = "repeat(" + String(cols) + ", 6px)";
      }catch(_){}

      var i;
      for (i = 0; i < total; i++){
        var cell = document.createElement("div");
        cell.className = "nl-ph-cell";
        if (i < filled) cell.className += " is-on";
        if (typeof todayIndex === "number" && i === todayIndex) cell.className += " is-today";
        grid.appendChild(cell);
      }
      return grid;
    }

    // ▼（仮）バーを作るヘルパー（ダミー値）
    function buildProgressBar(total, filled){
      var outer = document.createElement("div");
      outer.className = "nl-ph-bar";
      var inner = document.createElement("div");
      var pct = total > 0 ? Math.max(0, Math.min(100, (filled / total) * 100)) : 0;
      inner.style.width = String(pct) + "%";
      outer.appendChild(inner);
      return outer;
    }

    // ▼（仮）日別 63/90（90マスをそのまま表示）
    var dayRow = document.createElement("div");
    dayRow.className = "nl-ph-row";
    var dayTitle = document.createElement("div");
    dayTitle.className = "nl-ph-title";
    dayTitle.textContent = "日別";
    var dayValue = document.createElement("div");
    dayValue.className = "nl-ph-value";
    dayValue.textContent = "63 / 90";
    dayRow.appendChild(dayTitle);
    dayRow.appendChild(dayValue);
    progressHost.appendChild(dayRow);
    // 15×6=90 マス（“1マス=1日”を守る）
    progressHost.appendChild(buildProgressGrid(90, 63, 15, 62));

    // スペーサー
    var sp = document.createElement("div");
    sp.className = "nl-ph-spacer";
    progressHost.appendChild(sp);

    // ▼（仮）問題 18/30（バー）
    var qRow = document.createElement("div");
    qRow.className = "nl-ph-row";
    var qTitle = document.createElement("div");
    qTitle.className = "nl-ph-title";
    qTitle.textContent = "問題";
    var qValue = document.createElement("div");
    qValue.className = "nl-ph-value";
    qValue.textContent = "18 / 30";
    qRow.appendChild(qTitle);
    qRow.appendChild(qValue);
    progressHost.appendChild(qRow);
    progressHost.appendChild(buildProgressBar(30, 18));

    var summaryHost = document.createElement("div");
    summaryHost.id = "nl-summary-header";
    try{
      Object.assign(summaryHost.style, {
        position: "sticky",
        top: "0px",
        zIndex: "100000",
        background: "none",
        padding: "0px 10px 5px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgb(42, 42, 42)",
        fontSize: "13px",
        fontWeight: "300",
        lineHeight: "1.3",
        textAlign: "right",
        opacity: "0.5"
      });
    }catch(_){}

    var summaryLine2 = document.createElement("div");
    var summaryLine3 = document.createElement("div");
    var summaryLine4 = document.createElement("div");

    // 試験日設定ボタン（カレンダーモーダルを開く）
    var examButtonSpan = document.createElement("span");
    examButtonSpan.textContent = "[試験日設定]";
    examButtonSpan.style.cursor = "pointer";
    examButtonSpan.style.fontSize = "13px";
    examButtonSpan.style.marginLeft = "4px";

    // SYNC / localStorage の exam_date から「試験まであと◯日」の表示文を生成
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
          // 今日と試験日の日付差分（日単位）を計算
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
      // 未設定時の表示
      return "試験日未設定";
    }

    var now = new Date();

    // ★サマリー行2: 「⭐️｜獲得済｜0000／2700｜00／90｜00.0% 達成」
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

    // ◎サマリー行3: 「◎｜整合性｜0000／2700｜00／90｜00.0% 達成」
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

    // 試験日表示（＋ [試験日設定] ボタン）
    summaryLine4.innerHTML = buildExamLineText(now, syncRoot);
    summaryLine4.appendChild(document.createTextNode("｜"));
    summaryLine4.appendChild(examButtonSpan);

    // 「残り日数」を少し大きく見せるためのスタイル
    try{
      var style = document.createElement("style");
      style.textContent = ".nl-exam-days { font-size: 26px; font-weight: 600; padding: 0 2px; line-height: 0.9; display: inline-block; }";
      document.head.appendChild(style);
    }catch(_){}

    // =========================
    // 試験日カレンダーモーダルの実装
    // =========================

    examButtonSpan.addEventListener("click", function(){
      try{
        // 現在の試験日（localStorage側）を取得して初期選択に反映
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

        // 既にモーダルが開いていたら一度除去
        var existingBackdrop = document.getElementById("nl-exam-calendar-backdrop");
        if (existingBackdrop && existingBackdrop.parentNode) {
          existingBackdrop.parentNode.removeChild(existingBackdrop);
        }

        // 背景のオーバーレイ
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

        // カレンダーパネル本体
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

        // ヘッダー（← 2025年11月 →）
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

        // カレンダーのグリッド領域（7列×行）
        var grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(7, 1fr)";
        grid.style.columnGap = "4px";
        grid.style.rowGap = "4px";
        grid.style.marginBottom = "8px";

        // 曜日ヘッダー（日〜土）
        var weekdays = ["日","月","火","水","木","金","土"];
        for (var w = 0; w < 7; w++) {
          var wdCell = document.createElement("div");
          wdCell.textContent = weekdays[w];
          wdCell.style.textAlign = "center";
          wdCell.style.fontSize = "11px";
          wdCell.style.opacity = "0.5";
          grid.appendChild(wdCell);
        }

        // フッター（キャンセルボタンのみ）
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

        // モーダル全体を閉じる共通関数
        function closeCalendar(){
          try{
            if (backdrop && backdrop.parentNode) {
              backdrop.parentNode.removeChild(backdrop);
            }
          }catch(_){}
        }

        // 選択された試験日を SYNC / localStorage に送る
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
                  // サーバーから返ってきた新しい SYNC 状態を反映
                  if (json && typeof window !== "undefined"){
                    window.CSCS_SYNC_DATA = json;
                    try{
                      var ev = new CustomEvent("cscs-sync-updated", { detail: { source: "nav_list_exam" } });
                      window.dispatchEvent(ev);
                    }catch(_){}
                  }
                }catch(_){}
                // ★ 試験日が更新されたので、画面全体をリロードする
                try{
                  window.location.reload();
                }catch(_){}
              })
              .catch(function(_){});
          }catch(_){}
        }

        // 日付クリック時の処理
        function handleSelectDate(dateStr){
          // localStorage 側にも exam_date を保存
          try{
            localStorage.setItem("cscs_exam_date", dateStr);
          }catch(_){}
          // SYNCサーバーに送信 → HUD更新 & reload
          try{
            sendExamDateToSync(dateStr);
          }catch(_){}
          // サマリー行の「試験まであと◯日」の表示も即時更新（ローカル側）
          try{
            var tmpRoot = { exam_date: dateStr };
            // ★ SYNC と同じ仕様（exam_date を持つオブジェクト）で表示を更新
            summaryLine4.innerHTML = buildExamLineText(new Date(), tmpRoot);
            summaryLine4.appendChild(document.createTextNode("｜"));
            summaryLine4.appendChild(examButtonSpan);
          }catch(_){}
          closeCalendar();
        }

        function pad2Int(n){
          return String(n).padStart(2, "0");
        }

        // カレンダーの月を描画する関数
        function renderCalendar(){
          // 以前のセル（曜日ヘッダー以降）を削除
          while (grid.childNodes.length > 7) {
            grid.removeChild(grid.lastChild);
          }

          // 「2025年11月」のような見出し
          monthLabel.textContent = String(currentYear) + "年" + String(currentMonth + 1) + "月";

          // 月初の曜日と、その月の日数を取得
          var first = new Date(currentYear, currentMonth, 1);
          var startDow = first.getDay();
          var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

          // すでに保存されている試験日がこの月なら、その日だけ強調表示
          var selectedDay = null;
          if (currentValue) {
            var sd = new Date(currentValue);
            if (!isNaN(sd.getTime()) && sd.getFullYear() === currentYear && sd.getMonth() === currentMonth) {
              selectedDay = sd.getDate();
            }
          }

          // 最初の週の空白セル（1日が水曜なら日月は空白など）
          var i;
          for (i = 0; i < startDow; i++) {
            var emptyCell = document.createElement("div");
            emptyCell.textContent = "";
            grid.appendChild(emptyCell);
          }

          // 各日付セル（1〜日数分）をボタンとして配置
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

              // すでに選択済みの日付は色を変える
              if (selectedDay === d) {
                btn.style.background = "#3a6fd8";
                btn.style.borderColor = "#3a6fd8";
              }

              // 日付クリックで exam_date 設定
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

        // 月送りボタンのハンドラ
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

        // キャンセルボタンでモーダル閉じる
        cancelBtn.addEventListener("click", function(){
          closeCalendar();
        });

        // オーバーレイ背景クリックでも閉じる（中身クリック時は閉じない）
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
    });

    // サマリー行3本をまとめてパネル上部に追加
    summaryHost.appendChild(summaryLine2);
    summaryHost.appendChild(summaryLine3);
    summaryHost.appendChild(summaryLine4);

    // =========================
    // 左カラム：問題一覧グリッドの準備
    // =========================

    // ▼ 問題リスト（左カラム）用コンテナ
    const gridHost = document.createElement("div");
    gridHost.className = "quiz-list-grid";

    // お気に入り（fav_modal.js 準拠）の現在値をまとめて読み込む
    let favObj = {};
    let favMap = {};
    try{
      favObj = JSON.parse(localStorage.getItem("cscs_fav") || "{}");
    }catch(_){
      favObj = {};
    }
    try{
      favMap = JSON.parse(localStorage.getItem("cscs_fav_map") || "{}");
    }catch(_){
      favMap = {};
    }

    // qid / qidJp から「★１/★２/★３/★ー」の表示文字列を返す
    function getFavTextForQid(qid, qidJp){
      var num = 0;

      // 数値マップがあればそれを最優先
      if (favMap && Object.prototype.hasOwnProperty.call(favMap, qid)) {
        num = Number(favMap[qid] || 0);
      } else if (favMap && qidJp && Object.prototype.hasOwnProperty.call(favMap, qidJp)) {
        num = Number(favMap[qidJp] || 0);
      } else {
        // 旧形式（文字列）マップから判定
        var v = null;
        if (favObj && Object.prototype.hasOwnProperty.call(favObj, qid)) {
          v = favObj[qid];
        } else if (favObj && qidJp && Object.prototype.hasOwnProperty.call(favObj, qidJp)) {
          v = favObj[qidJp];
        }
        if (v === "understood") {
          num = 1;
        } else if (v === "unanswered") {
          num = 2;
        } else if (v === "none") {
          num = 3;
        } else {
          num = 0;
        }
      }

      if (num === 1) return "★１";
      if (num === 2) return "★２";
      if (num === 3) return "★３";
      return "★ー";
    }

    // =========================
    // 左カラム：1〜30問ぶんの行を構築
    // =========================

    (manifest.questions || []).forEach((q, idx) => {
      const i = idx + 1;
      const n3 = pad3(i);
      const qid = day + "-" + n3;
      const qidJp = toJpDateQid(day, n3);

      // SYNCから、その問題の「現在の連続正解数 (streakLen[qid])」を取得
      const streakLenSync =
        syncRoot && syncRoot.streakLen && Object.prototype.hasOwnProperty.call(syncRoot.streakLen, qid)
          ? Number(syncRoot.streakLen[qid] || 0)
          : 0;

      // SYNCから、その問題の「累積3連続正解回数 (streak3[qid])」を取得
      const streakTotalSync =
        syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)
          ? Number(syncRoot.streak3[qid] || 0)
          : 0;

      // SYNCから、その問題の「現在の連続不正解数 (streakWrongLen[qid])」を取得
      const wrongStreakLenSync =
        syncRoot && syncRoot.streakWrongLen && Object.prototype.hasOwnProperty.call(syncRoot.streakWrongLen, qid)
          ? Number(syncRoot.streakWrongLen[qid] || 0)
          : 0;

      // SYNCから、その問題の「累積3連続不正解回数 (streak3Wrong[qid])」を取得
      const wrongStreakTotalSync =
        syncRoot && syncRoot.streak3Wrong && Object.prototype.hasOwnProperty.call(syncRoot.streak3Wrong, qid)
          ? Number(syncRoot.streak3Wrong[qid] || 0)
          : 0;

      // SYNCから oncePerDayToday（cscs_sync_view_b.js と同じ { day, results } 構造）を参照し、
      // この qid の本日の oncePerDayStatus ("correct" / "wrong" / "nocount"...) を取得
      // ※ correct_star.js と同様に「ストリークが両方 0 のとき、正解側/不正解側どちらの
      //    3連続累計を優先して表示するか」を決めるために利用する。
      //    nav_list.js でも一覧用マーカー決定ロジックで同じ値を使う。
      let oncePerDayStatus = null;
      (function () {
        try {
          if (syncRoot && typeof syncRoot === "object" && syncRoot.oncePerDayToday && typeof syncRoot.oncePerDayToday === "object") {
            const opd = syncRoot.oncePerDayToday;
            if (opd.results && typeof opd.results === "object" && Object.prototype.hasOwnProperty.call(opd.results, qid)) {
              const raw = opd.results[qid];
              if (typeof raw === "string") {
                oncePerDayStatus = raw;
              }
            }
          }
        } catch (e) {
          console.error("nav_list.js: oncePerDayToday 読み取り中に例外:", e);
          oncePerDayStatus = null;
        }
      })();

      /**
       * correct_star.js に定義されている表示ルールと同じ優先順位で
       * 「現在の連続正解数 / 連続不正解数 / 累積3連続正解 / 累積3連続不正解 /
       *   本日の oncePerDayStatus（直近の正誤結果）」から
       * 表示用マーカー絵文字を決定するヘルパー。
       *
       * 優先度：
       *  1) 現在の連続不正解 (streakWrongLen)
       *       1連続不正解  → 🔧
       *       2連続不正解  → 🛠️
       *       3連続以上    → 💣
       *
       *  2) 現在の連続不正解が 0 で、現在の連続正解 (streakLen) が 1 以上のとき
       *       1連続正解    → ✨
       *       2連続正解    → ⚡️
       *       3連続以上    → ⭐️
       *
       *  3) 正解・不正解のストリークが両方 0 のときにのみ、
       *     「本日の oncePerDayStatus（直近の正誤結果）」に従って
       *     3連続達成“累計”のバッジを表示する：
       *
       *     oncePerDayStatus === "correct" の場合：
       *       正解側 3連続累計 (streak3)：
       *         累計 1〜2回   → ⭐️
       *         累計 3〜8回   → 🌟
       *         累計 9回以上  → 💫
       *
       *     oncePerDayStatus === "wrong" の場合：
       *       不正解側 3連続累計 (streak3Wrong)：
       *         累計 1〜2回   → 💣
       *         累計 3〜8回   → 💥
       *         累計 9回以上  → 🔥
       *
       *     上記いずれにも該当しない場合（oncePerDayStatus が無い等）：
       *       - 正解側 3連続累計があれば ⭐️/🌟/💫 を優先して表示
       *       - なければ不正解側 3連続累計（💣/💥/🔥）を表示
       *
       *  4) ストリークも累計も無い場合
       *       nav_list.js の一覧ビューでは「まだ何も起きていない問題」を
       *       視覚的に区別しやすくするため "—" で表示する。
       *
       *   ※ correct_star.js 本体では OFF 状態も「空欄」で扱うが、
       *      一覧ビューでの可読性を優先して "—" を採用している以外、
       *      優先順位ロジック自体は同一。
       */
      function decideStreakMarkFromStats(streakLenCorrect, streakLenWrong, correct3Total, wrong3Total) {
        var cLen = Number(streakLenCorrect || 0);
        var wLen = Number(streakLenWrong || 0);
        var c3   = Number(correct3Total || 0);
        var w3   = Number(wrong3Total || 0);

        if (!Number.isFinite(cLen) || cLen < 0) cLen = 0;
        if (!Number.isFinite(wLen) || wLen < 0) wLen = 0;
        if (!Number.isFinite(c3)   || c3   < 0) c3   = 0;
        if (!Number.isFinite(w3)   || w3   < 0) w3   = 0;

        // 1) 現在の不正解ストリークを最優先（直近が連続で外れている状態）
        if (wLen >= 1) {
          if (wLen >= 3) {
            return "💣"; // 3連続以上不正解
          }
          if (wLen === 2) {
            return "🛠️"; // 2連続不正解
          }
          return "🔧";    // 1連続不正解
        }

        // 2) 現在の正解ストリーク（不正解ストリークが 0 のときのみ到達）
        if (cLen >= 1) {
          if (cLen >= 3) {
            return "⭐️"; // 3連続以上正解（正解ストリーク中）
          }
          if (cLen === 2) {
            return "⚡️"; // 2連続正解中
          }
          return "✨";   // 1連続正解中
        }

        // 3) 正解・不正解ストリークが両方 0 の場合：
        //    「直近の結果（oncePerDayStatus）」に従って 3連続達成“累計”バッジを決める

        // 3-1) 直近が正解で、正解側の3連続累計がある場合 → ⭐️/🌟/💫
        if (oncePerDayStatus === "correct" && c3 >= 1) {
          if (c3 >= 9) {
            return "💫";
          }
          if (c3 >= 3) {
            return "🌟";
          }
          return "⭐️";
        }

        // 3-2) 直近が不正解で、不正解側の3連続累計がある場合 → 💣/💥/🔥
        if (oncePerDayStatus === "wrong" && w3 >= 1) {
          if (w3 >= 9) {
            return "🔥";
          }
          if (w3 >= 3) {
            return "💥";
          }
          return "💣";
        }

        // 3-3) oncePerDayStatus が無い等の場合のフォールバック：
        //      正解側 3連続累計があればそれを優先
        if (c3 >= 1) {
          if (c3 >= 9) {
            return "💫";
          }
          if (c3 >= 3) {
            return "🌟";
          }
          return "⭐️";
        }

        // 3-4) 正解側に 3連続累計が無く、不正解側のみある場合
        if (w3 >= 1) {
          if (w3 >= 9) {
            return "🔥";
          }
          if (w3 >= 3) {
            return "💥";
          }
          return "💣";
        }

        // 4) ストリークも累計も無い → 一覧ビューでは "—"
        return "—";
      }

      // correct_star.js の優先順位ルールに基づいてマーカーを決定
      const streakMark = decideStreakMarkFromStats(
        streakLenSync,
        wrongStreakLenSync,
        streakTotalSync,
        wrongStreakTotalSync
      );

      // 進捗表示は「直近の連続記録」を優先して反映させる：
      //   - 連続不正解中なら wrongStreakLenSync
      //   - それ以外で連続正解中なら streakLenSync
      //   - どちらも 0 のときは 0
      let streakProgressCount = 0;
      if (wrongStreakLenSync > 0) {
        streakProgressCount = wrongStreakLenSync;
      } else if (streakLenSync > 0) {
        streakProgressCount = streakLenSync;
      }
      const streakProgress = "(" + streakProgressCount + "/3)";

      // デバッグ用ログ（ナビリスト行ごとに、各ストリーク情報とマークを確認）
      if (DEBUG_NAV_LIST_STREAK_LOG) {
        console.log("nav_list.js: streak マーク決定 (correct_star.js ルール準拠)", {
          qid: qid,
          streakLenSync: streakLenSync,
          streakTotalSync: streakTotalSync,
          wrongStreakLenSync: wrongStreakLenSync,
          wrongStreakTotalSync: wrongStreakTotalSync,
          oncePerDayStatus: oncePerDayStatus,
          streakMark: streakMark,
          streakProgress: streakProgress
        });
      }

      // 整合性マーク（◎/○/△/×）を取得
      var consistencyInfo = getConsistencyInfoFromSync(day, n3, syncRoot);
      const consistencyRawSync = consistencyInfo.statusMark;

      let consistencyMark = "—";

      if (consistencyRawSync === "◎") {
        consistencyMark = "◎";
      } else if (consistencyRawSync === "○") {
        consistencyMark = "○";
      } else if (consistencyRawSync === "△") {
        consistencyMark = "△";
      } else if (consistencyRawSync === "×") {
        consistencyMark = "×";
      }

      // ローカルの per-problem 累積回数（b_judge_record.js 仕様）
      const correctTotalRaw = localStorage.getItem("cscs_q_correct_total:" + qid);
      const wrongTotalRaw = localStorage.getItem("cscs_q_wrong_total:" + qid);
      const correctTotal = Number(correctTotalRaw || "0");
      const wrongTotal = Number(wrongTotalRaw || "0");

      // お気に入り（★1〜3 / 未設定）
      const favText = getFavTextForQid(qid, qidJp);

      // Aパートへのリンク
      const url = "q" + n3 + "_a.html?nav=manual";

      // 問題文の冒頭だけを短くスニペットとして表示
      const snippet = (q.Question || "").slice(0, 18) + ((q.Question || "").length > 18 ? "…" : "");
      const line1Text = snippet;

      // レベル表記（"Level 2" → "Lv2" のように整形）
      let rawLevel = q.Level || "—";
      rawLevel = String(rawLevel).replace(/Level\s*/i, "").trim();

      const levelText = "Lv" + rawLevel;

      // 2行目に表示する情報をまとめる
      // 例: 01／💫(1/3)／◎／Lv1／正×100／不×0／★１
      // → 問題番号(01)は span.nl-qnum でラップして CSS で太字にする
      const line2RightText =
        "／" +
        streakMark +
        streakProgress +
        "／" +
        consistencyMark +
        "／" +
        levelText +
        "／正×" +
        String(correctTotal) +
        "／不×" +
        String(wrongTotal) +
        "／" +
        favText;

      // DOM構築
      const item = document.createElement("div");
      const isCurrent = currentN3 && n3 === currentN3;
      item.className = "quiz-item" + (isCurrent ? " is-current" : "");

      // 1行目: 問題文スニペット（リンク）
      const l1 = document.createElement("div");
      l1.className = "line1";
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("data-nl-allow", "1");
      a.textContent = line1Text;
      a.addEventListener("click", function(ev){
        // 修飾キー（Cmd/Ctrl/Shift/Alt）付きや中クリックなどはブラウザ標準の挙動に任せる
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        try{
          window.location.assign(url);
        }catch(_){}
      });
      l1.appendChild(a);

      // 2行目: ステータス（問題番号／💫(1/3)／◎／Lv/正誤回数/お気に入り）
      const l2 = document.createElement("div");
      l2.className = "line2";

      // 問題番号だけ span.nl-qnum で太字にできるように分離
      const qnumSpan = document.createElement("span");
      qnumSpan.className = "nl-qnum";
      qnumSpan.textContent = pad2(i);

      // 残り部分はテキストノードとして後ろに続ける
      const restTextNode = document.createTextNode(line2RightText);

      l2.appendChild(qnumSpan);
      l2.appendChild(restTextNode);

      item.appendChild(l1);
      item.appendChild(l2);
      gridHost.appendChild(item);
    });

    // =========================
    // パネル内レイアウト（上：サマリー / 左：問題 / 右：DAY一覧）
    // =========================

    var bodyHost = document.createElement("div");
    bodyHost.id = "nl-body";
    bodyHost.className = "nl-body-grid";
    bodyHost.style.flex = "1 1 auto";
    bodyHost.style.overflow = "auto";

    var leftCol = document.createElement("div");
    leftCol.className = "nl-left-col";
    leftCol.id = "nl-left-col";

    var rightCol = document.createElement("div");
    rightCol.className = "nl-right-col";
    rightCol.id = "nl-right-col";

    bodyHost.appendChild(leftCol);
    bodyHost.appendChild(rightCol);

    panel.appendChild(progressHost);
    panel.appendChild(summaryHost);
    panel.appendChild(bodyHost);

    bodyHost.appendChild(leftCol);
    bodyHost.appendChild(rightCol);

    panel.appendChild(summaryHost);
    panel.appendChild(bodyHost);

    leftCol.appendChild(gridHost);
    renderDayList(rightCol, day);

    // 左右カラムのスクロール位置を「現在の問題 / 現在の日付」が見える位置にオートスクロール
    try {
      var quizContainer = panel.querySelector("#nl-left-col");
      var currentItem = quizContainer ? quizContainer.querySelector(".quiz-item.is-current") : null;
      if (quizContainer){
        if (currentItem){
          var itemRect  = currentItem.getBoundingClientRect();
          var contRect  = quizContainer.getBoundingClientRect();
          var offset    = itemRect.top - contRect.top - (contRect.height / 2) + (itemRect.height / 2);
          quizContainer.scrollTop += offset;
        } else {
          quizContainer.scrollTop = 0;
        }
      }

      var dayContainer = panel.querySelector("#nl-right-col");
      var currentDayItem = dayContainer ? dayContainer.querySelector(".nl-day-item.is-current") : null;
      if (dayContainer){
        if (currentDayItem){
          var dItemRect  = currentDayItem.getBoundingClientRect();
          var dContRect  = dayContainer.getBoundingClientRect();
          var dOffset    = dItemRect.top - dContRect.top - (dContRect.height / 2) + (dItemRect.height / 2);
          dayContainer.scrollTop += dOffset;
        } else {
          dayContainer.scrollTop = 0;
        }
      }
    } catch (_){}
  }

  // =========================
  // パネルのマウント＆表示処理
  // =========================

  async function mountAndOpenPanel(){
    // パネルDOMを確保
    ensurePanel();
    const panel = document.getElementById("nl-panel");

    // SYNC状態をロード（streak3 / exam_date / consistency など）
    await loadSyncDataForNavList();

    // ▼ 一覧パネルを表示状態にしてからレイアウト計測＆スクロール
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.pointerEvents = "auto";
    panel.style.opacity = "0.5";

    // nav_manifest.json を読み込んで中身を描画
    await renderListInto(panel);

    // 常時表示モードでなければ、従来通りスクロールロック＋トグルラベル更新
    if (!NAV_ALWAYS_OPEN){
      lockBodyScroll();

      var toggle = document.getElementById("nl-toggle");
      if (toggle){
        var opened = panel && panel.style.display === "block";
        toggle.textContent = opened ? "✖️ 閉じる　" : "📋 問題一覧表示";
        toggle.setAttribute("aria-pressed", opened ? "true" : "false");
      }
    }
  }

  // =========================
  // 他スクリプトから呼べるフェード制御API
  // =========================

  function navListFadeOut(){
    try{
      var panel = document.getElementById("nl-panel");
      if (!panel) {
        return;
      }
      // 透明度を下げて反応を殺す（裏で動いていてほしい時用）
      panel.style.opacity = "0.5"; // フェードアウト時の最大透明設定
      panel.style.pointerEvents = "none";
    }catch(_){}
  }

  function navListFadeIn(){
    try{
      var panel = document.getElementById("nl-panel");
      if (!panel) {
        return;
      }
      panel.style.display = "flex";
      panel.style.flexDirection = "column";
      panel.style.pointerEvents = "auto";
      panel.style.opacity = "0.5";
    }catch(_){}
  }

  // グローバル名前空間に NAV_LIST の小さなAPIを生やす
  if (!window.CSCS_NAV_LIST) {
    window.CSCS_NAV_LIST = {};
  }
  window.CSCS_NAV_LIST.fadeOut = navListFadeOut;
  window.CSCS_NAV_LIST.fadeIn = navListFadeIn;

  // =========================
  // SYNC更新イベントを受けて一覧を再構築
  // =========================

  window.addEventListener("cscs-sync-updated", function(){
    try{
      // 1秒だけ待ってから mount & 再描画（HUD更新などとタイミングをずらす）
      setTimeout(function(){
        mountAndOpenPanel();
      }, 1000);
    }catch(_){}
  });

  // =========================
  // 初期化（DOMContentLoaded時）
  // =========================

  window.addEventListener("DOMContentLoaded", function(){
    if (!isAPart()) return;
    try {
      // scriptタグに data-a-nav="0" が付いていたら nav_list 自体を無効化
      const tag = document.currentScript || document.querySelector('script[src*="nav_list.js"]');
      let isEnabled = true;
      if (tag && tag.dataset && tag.dataset.aNav === "0") isEnabled = false;
      if (!isEnabled) return;
    } catch(_){}
    // トグルボタン生成（NAV_ALWAYS_OPEN=false の場合のみ意味あり）
    ensureToggle();
    // 常時表示設定なので、ページ読み込み時に即パネルを開く
    mountAndOpenPanel();
  });
})();