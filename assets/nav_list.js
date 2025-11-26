/* nav_list.js —：問題一覧（nav_manifest.json版 / 2カラム表示） */
(function(){
  "use strict";

  // true: A/B 両方で常時表示（開閉ボタンなし）
  // false: これまで通り、トグルボタンで開閉
  const NAV_ALWAYS_OPEN = true;

  async function loadSyncDataForNavList(){
    try{
      const res = await fetch(location.origin + "/api/sync/state", { cache: "no-store" });
      const json = await res.json();
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

  function isAPart(){
    return /_(a|b)(?:\.html)?(?:\?.*)?(?:#.*)?$/i.test(String(location.href || ""));
  }
  function getDayFromPath(){
    var m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }
  function pad2(n){ return String(n).padStart(2, "0"); }
  function pad3(n){ return String(n).padStart(3, "0"); }

  function toJpDateQid(day, n3){
    var y = day.slice(0, 4);
    var m = String(Number(day.slice(4, 6)));
    var d = String(Number(day.slice(6, 8)));
    return y + "年" + m + "月" + d + "日-" + n3;
  }

  // 現在開いている A/Bパートの問題番号（q013_a.html / q013_b.html → "013"）を取得
  function getCurrentQuestionNumber3(){
    try{
      var path = window.location.pathname || "";
      var m = path.match(/(?:^|\/)q(\d{3})_[ab](?:\.html)?$/);
      return m ? m[1] : null;
    }catch(_){
      return null;
    }
  }

  /* 背景スクロールロック */
  function lockBodyScroll(){
    try{
      var y = window.scrollY || 0;
      document.documentElement.setAttribute("data-nl-open", "1");
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

  /* 成績読み取り（localStorageから） */
  function readStats(day, n3){
    var stem = "q" + n3;

    function getMaxRunIdForDay(day, all){
      var runs = all.filter(function(r){
        return r && r.day === day && Number.isInteger(r.runId);
      }).map(function(r){ return r.runId; });
      return runs.length ? Math.max.apply(null, runs) : 0;
    }

    var all = [];
    try { all = JSON.parse(localStorage.getItem("cscs_results") || "[]"); } catch(_){ all = []; }
    var latestRun = getMaxRunIdForDay(day, all) || 1;

    var rows = all.filter(function(r){
      return r && r.day === day && r.runId === latestRun && r.stem === stem;
    }).sort(function(a,b){ return a.ts - b.ts; });

    var correct = rows.filter(function(r){ return !!r.correct; }).length;
    var wrong   = rows.filter(function(r){ return !r.correct; }).length;

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

    var cleared = false;
    if (rows.length){
      var maxStreak = 0, cur = 0;
      for (var j=0;j<rows.length;j++){
        if (rows[j].correct){ cur += 1; maxStreak = Math.max(maxStreak, cur); }
        else { cur = 0; }
      }
      cleared = (maxStreak >= 3);
      if (cleared && rows.length >= 2){
        var n = rows.length;
        if (!rows[n-1].correct && !rows[n-2].correct){
          cleared = false;
        }
      }
    }

    var wrongLogCount = 0;
    try{
      var log = JSON.parse(localStorage.getItem("cscs_wrong_log") || "{}");
      var qnum = n3;
      var qid  = day + "-" + qnum;
      wrongLogCount = Number(log[qid] || 0);
    }catch(_){ wrongLogCount = 0; }

    return { correct: correct, wrong: wrong, sc: sc, sw: sw, cleared: cleared, wrongLog: wrongLogCount };
  }

  // 日別リスト（DAY-01〜）を右カラムに描画
  function renderDayList(rightCol, currentDay){
    if (!rightCol) {
      return;
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

    // TODO: セット数や日付レンジを変更したくなったらここを書き換える
    var days = buildDayArray("20250926", "20251224");

    // SYNC データから streak3（3連続正解達成回数）を参照するためのルートを取得
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
      var anyStarCount = 0;   // 「何らかの★（⭐️/🌟/💫）」が付いている問題数
      var starGe1 = 0;        // ランク1以上（⭐️以上）
      var starGe2 = 0;        // ランク2以上（🌟以上）
      var starGe3 = 0;        // ランク3以上（💫）

      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS; qIndex++){
        var n3 = pad3(qIndex);
        var qid = dayStr + "-" + n3;
        var streakTotal = 0;

        if (syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)) {
          streakTotal = Number(syncRoot.streak3[qid] || 0);
        }

        // 3連続正解達成回数が 0 の問題は一切カウントしない
        if (!(streakTotal > 0)) {
          continue;
        }

        var symbol = "";
        if (typeof window !== "undefined" && typeof window.cscsGetStarSymbolFromStreakCount === "function") {
          symbol = window.cscsGetStarSymbolFromStreakCount(streakTotal) || "⭐️";
        } else {
          symbol = "⭐️";
        }

        anyStarCount += 1;

        // ランクを判定
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

      var ratePercent = TOTAL_QUESTIONS > 0 ? Math.round((anyStarCount / TOTAL_QUESTIONS) * 100) : 0;

      // DAY 見出しに付けるシンボル（30/30 の場合のみ）
      var daySuffix = "";
      if (anyStarCount === TOTAL_QUESTIONS) {
        if (starGe3 === TOTAL_QUESTIONS) {
          // 全 30 問が 💫
          daySuffix = "💫";
        } else if (starGe2 === TOTAL_QUESTIONS) {
          // 全 30 問が 🌟（または🌟以上）
          daySuffix = "🌟";
        } else if (starGe1 === TOTAL_QUESTIONS) {
          // 全 30 問が ⭐️（または⭐️以上）
          daySuffix = "⭐️";
        }
      }

      var item = document.createElement("div");
      item.className = "nl-day-item" + (isCurrent ? " is-current" : "");

      var link = document.createElement("a");
      link.href = "/_build_cscs_" + dayStr + "/slides/q001_a.html?nav=manual";
      link.setAttribute("data-nl-allow", "1");
      link.style.display = "block";
      link.style.textDecoration = "none";

      var titleRow = document.createElement("div");
      titleRow.className = "nl-day-title";
      titleRow.textContent = "DAY-" + pad2(idx + 1) + daySuffix;

      var dateRow = document.createElement("div");
      dateRow.textContent = dayStr;

      var rateRow = document.createElement("div");
      rateRow.textContent =
        "★獲得：" +
        String(anyStarCount) +
        "/" +
        String(TOTAL_QUESTIONS) +
        "(" +
        String(ratePercent) +
        "%)";

      link.appendChild(titleRow);
      link.appendChild(dateRow);
      link.appendChild(rateRow);

      item.appendChild(link);
      rightCol.appendChild(item);
    });
  }

  /* Aパート下部中央のトグルボタンを挿入（開いている間は✖️ 閉じる　に変化） */
  function ensureToggle(){
    // 常時表示モードのときはトグルボタン自体を出さない
    if (NAV_ALWAYS_OPEN) return;

    if (!isAPart()) return;
    if (document.getElementById("nl-toggle")) return;

    var btn = document.createElement("button");
    btn.id = "nl-toggle";
    btn.textContent = "📋 問題一覧表示";

    function syncLabel(){
      const panel = document.getElementById("nl-panel");
      const opened = panel && panel.style.display === "block";
      btn.textContent = opened ? "✖️ 閉じる　" : "📋 問題一覧表示";
      btn.setAttribute("aria-pressed", opened ? "true" : "false");
    }

    btn.addEventListener("mouseenter", function(){ try { btn.style.filter = "brightness(1.1)"; } catch(_){ } });
    btn.addEventListener("mouseleave", function(){ try { btn.style.filter = ""; } catch(_){ } });

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

  /* パネル生成 */
  function ensurePanel(){
    if (document.getElementById("nl-panel")) return;

    var panel = document.createElement("div");
    panel.id  = "nl-panel";

    // ★ スクロール有効化＋見た目調整
    Object.assign(panel.style, {
      position: "fixed",
      left: "16px",
      right: "16px",
      top: "12px",
      bottom: "66px",
      overflow: "auto",
      background: "rgba(0, 0, 0, 0.86)",
      border: "1px solid rgb(51, 51, 51)",
      borderRadius: "12px",
      padding: "14px 16px 0px",
      zIndex: "99999",
      display: "none",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      maxHeight: "calc(100vh - 24px)"
    });

    // ▼ 可能なら #root の中に挿入し、無い場合のみ body 直下に挿入
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

  /* メイン描画：nav_manifest.json から構築 */
  async function renderListInto(panel){
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    const day = getDayFromPath();
    const currentN3 = getCurrentQuestionNumber3();
    let manifest = null;
    try {
      const res = await fetch("nav_manifest.json", { cache: "no-store" });
      manifest = await res.json();
    } catch (e) {
      console.error("nav_manifest.json 読み込み失敗:", e);
      panel.innerHTML = "<p style='color:red;padding:16px;'>nav_manifest.json の読み込みに失敗しました。</p>";
      return;
    }

    const title = manifest.questions?.[0]?.Title || "NSCA CSCS 試験対策問題集";
    const field = manifest.questions?.[0]?.Field || "—";
    const theme = manifest.questions?.[0]?.Theme || "—";

    // SYNC ルート取得（streak3 / consistency_status など）
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

    var allDays = buildDayArrayForSummary("20250926", "20251224");
    var TOTAL_QUESTIONS_PER_DAY = 30;
    var totalQuestionsAll = allDays.length * TOTAL_QUESTIONS_PER_DAY;

    // ★ 獲得済（3連続正解1回以上）集計
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

    // ◎ 整合性集計（status_mark が「◎」のもの）
    var consistencyQuestionCount = 0;
    var consistencyFullDayCount = 0;

    allDays.forEach(function(dayStr){
      var dayConsistentCount = 0;
      var qIndex;
      for (qIndex = 1; qIndex <= TOTAL_QUESTIONS_PER_DAY; qIndex++){
        var n3 = pad3(qIndex);
        var qidJp = toJpDateQid(dayStr, n3);
        var statusObj = null;
        var statusMark = "";

        if (syncRoot && syncRoot.consistency_status && Object.prototype.hasOwnProperty.call(syncRoot.consistency_status, qidJp)) {
          statusObj = syncRoot.consistency_status[qidJp];
        }

        if (statusObj && typeof statusObj.status_mark === "string"){
          statusMark = statusObj.status_mark;
        }

        if (statusMark === "◎"){
          consistencyQuestionCount += 1;
          dayConsistentCount += 1;
        }
      }
      if (dayConsistentCount === TOTAL_QUESTIONS_PER_DAY){
        consistencyFullDayCount += 1;
      }
    });

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

    // ▼ 全体サマリー（固定ヘッダー）DOM構築
    var summaryHost = document.createElement("div");
    summaryHost.id = "nl-summary-header";
    try{
      Object.assign(summaryHost.style, {
        position: "sticky",
        top: "0px",
        zIndex: "100000",
        background: "rgb(17, 17, 17)",
        padding: "6px 17px 10px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgb(42, 42, 42)",
        fontSize: "13px",
        fontWeight: "400",
        lineHeight: "1.2"
      });
    }catch(_){}

    var summaryLine1 = document.createElement("div");
    var summaryLine2 = document.createElement("div");
    var summaryLine3 = document.createElement("div");
    var summaryLine4 = document.createElement("div");

    summaryLine1.style.display = "flex";
    summaryLine1.style.justifyContent = "space-between";
    summaryLine1.style.alignItems = "center";

    var summaryTitleSpan = document.createElement("span");
    summaryTitleSpan.textContent = "全体サマリー（総数" + totalQuestionsStr + "問・" + totalDaysStr + "日分）";
    summaryTitleSpan.style.fontSize = "14px";
    summaryTitleSpan.style.fontWeight = "500";

    var examButtonSpan = document.createElement("span");
    examButtonSpan.textContent = "[試験日設定]";
    examButtonSpan.style.cursor = "pointer";
    examButtonSpan.style.fontSize = "12px";
    examButtonSpan.style.marginLeft = "8px";

    summaryLine1.appendChild(summaryTitleSpan);
    summaryLine1.appendChild(examButtonSpan);

    function buildExamLineText(nowDate){
      var y = nowDate.getFullYear();
      var m = String(nowDate.getMonth() + 1).padStart(2, "0");
      var d = String(nowDate.getDate()).padStart(2, "0");
      var wdList = ["日","月","火","水","木","金","土"];
      var wd = wdList[nowDate.getDay()];
      var hh = nowDate.getHours();
      var ap = hh >= 12 ? "pm" : "am";
      var h12 = hh % 12;
      if (h12 === 0) h12 = 12;
      var h12Str = String(h12).padStart(2, "0");
      var mm = String(nowDate.getMinutes()).padStart(2, "0");
      var dateStr = y + "." + m + "." + d + "(" + wd + ")" + h12Str + ":" + mm + ap;

      var examRaw = "";
      try{
        examRaw = localStorage.getItem("cscs_exam_date") || "";
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
          var examLabel = "試験(" + String(em) + "/" + String(ed) + ")まであと" + String(diffDays) + "日";
          return examLabel + "｜" + dateStr;
        }
      }
      return "試験日未設定｜" + dateStr;
    }

    var now = new Date();

    summaryLine2.textContent =
      "★｜獲得済｜" +
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

    summaryLine4.textContent = buildExamLineText(now);

    examButtonSpan.addEventListener("click", function(){
      try{
        var currentValue = "";
        try{
          currentValue = localStorage.getItem("cscs_exam_date") || "";
        }catch(_){
          currentValue = "";
        }

        var input = document.createElement("input");
        input.type = "date";
        input.style.position = "fixed";
        input.style.left = "-9999px";
        input.style.top = "0";
        if (currentValue) {
          input.value = currentValue;
        }

        function handleChange(){
          try{
            if (!input.value){
              try{
                document.body.removeChild(input);
              }catch(_){}
              input.removeEventListener("change", handleChange);
              input.removeEventListener("blur", handleBlur);
              return;
            }
            var dt = new Date(input.value);
            if (isNaN(dt.getTime())){
              window.alert("日付の形式が正しくありません。");
              try{
                document.body.removeChild(input);
              }catch(_){}
              input.removeEventListener("change", handleChange);
              input.removeEventListener("blur", handleBlur);
              return;
            }
            localStorage.setItem("cscs_exam_date", input.value);
            summaryLine4.textContent = buildExamLineText(new Date());
            try{
              document.body.removeChild(input);
            }catch(_){}
          }catch(_){}
          input.removeEventListener("change", handleChange);
          input.removeEventListener("blur", handleBlur);
        }

        function handleBlur(){
          try{
            if (document.body.contains(input)){
              document.body.removeChild(input);
            }
          }catch(_){}
          input.removeEventListener("change", handleChange);
          input.removeEventListener("blur", handleBlur);
        }

        input.addEventListener("change", handleChange);
        input.addEventListener("blur", handleBlur);

        document.body.appendChild(input);
        input.focus();
        input.click();
      }catch(_){}
    });

    summaryHost.appendChild(summaryLine1);
    summaryHost.appendChild(summaryLine2);
    summaryHost.appendChild(summaryLine3);
    summaryHost.appendChild(summaryLine4);

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

    // qid / qidJp から「★1/★2/★3/未設定」の表示文字列を返す
    function getFavTextForQid(qid, qidJp){
      var num = 0;

      if (favMap && Object.prototype.hasOwnProperty.call(favMap, qid)) {
        num = Number(favMap[qid] || 0);
      } else if (favMap && qidJp && Object.prototype.hasOwnProperty.call(favMap, qidJp)) {
        num = Number(favMap[qidJp] || 0);
      } else {
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

      if (num === 1) return "★1";
      if (num === 2) return "★2";
      if (num === 3) return "★3";
      return "未設定";
    }

    (manifest.questions || []).forEach((q, idx) => {
      const i = idx + 1;
      const n3 = pad3(i);
      const qid = day + "-" + n3;
      const qidJp = toJpDateQid(day, n3);

      const streakTotalSync =
        syncRoot && syncRoot.streak3 && Object.prototype.hasOwnProperty.call(syncRoot.streak3, qid)
          ? Number(syncRoot.streak3[qid] || 0)
          : 0;

      let streakMark = "—";
      if (typeof window !== "undefined" && typeof window.cscsGetStarSymbolFromStreakCount === "function") {
        var starSymbol = window.cscsGetStarSymbolFromStreakCount(streakTotalSync);
        if (streakTotalSync > 0) {
          streakMark = starSymbol || "⭐️";
        }
      }

      const streakLenSync =
        syncRoot && syncRoot.streakLen && Object.prototype.hasOwnProperty.call(syncRoot.streakLen, qid)
          ? Number(syncRoot.streakLen[qid] || 0)
          : 0;
      const streakProgress = "(" + streakLenSync + "/3)";

      const consistencyObjSync =
        syncRoot && syncRoot.consistency_status
          ? syncRoot.consistency_status[qidJp]
          : null;
      const consistencyRawSync =
        consistencyObjSync && typeof consistencyObjSync.status_mark === "string"
          ? consistencyObjSync.status_mark
          : "";

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

      const correctTotalRaw = localStorage.getItem("cscs_q_correct_total:" + qid);
      const wrongTotalRaw = localStorage.getItem("cscs_q_wrong_total:" + qid);
      const correctTotal = Number(correctTotalRaw || "0");
      const wrongTotal = Number(wrongTotalRaw || "0");

      const favText = getFavTextForQid(qid, qidJp);

      const url = "q" + n3 + "_a.html?nav=manual";

      const snippet = (q.Question || "").slice(0, 18) + ((q.Question || "").length > 18 ? "…" : "");
      const line1Text = snippet;

      let rawLevel = q.Level || "—";
      rawLevel = String(rawLevel).replace(/Level\s*/i, "").trim();

      const levelText = "Lv" + rawLevel;
      const line2Text =
        streakMark +
        streakProgress +
        "／" +
        consistencyMark +
        "／" +
        pad2(i) +
        "／" +
        levelText +
        "／正×" +
        String(correctTotal) +
        "／不×" +
        String(wrongTotal) +
        "／" +
        favText;

      const item = document.createElement("div");
      const isCurrent = currentN3 && n3 === currentN3;
      item.className = "quiz-item" + (isCurrent ? " is-current" : "");

      const l1 = document.createElement("div");
      l1.className = "line1";
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("data-nl-allow", "1");
      a.textContent = line1Text;
      l1.appendChild(a);

      const l2 = document.createElement("div");
      l2.className = "line2";
      l2.textContent = line2Text;

      item.appendChild(l1);
      item.appendChild(l2);
      gridHost.appendChild(item);
    });

    // ▼ パネル本体のレイアウト（上部に全体サマリー、その下に2カラム）
    var bodyHost = document.createElement("div");
    bodyHost.id = "nl-body";
    bodyHost.className = "nl-body-grid";

    var leftCol = document.createElement("div");
    leftCol.className = "nl-left-col";
    leftCol.id = "nl-left-col";

    var rightCol = document.createElement("div");
    rightCol.className = "nl-right-col";
    rightCol.id = "nl-right-col";

    bodyHost.appendChild(leftCol);
    bodyHost.appendChild(rightCol);

    panel.appendChild(summaryHost);
    panel.appendChild(bodyHost);

    leftCol.appendChild(gridHost);
    renderDayList(rightCol, day);

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

  async function mountAndOpenPanel(){
    ensurePanel();
    const panel = document.getElementById("nl-panel");

    await loadSyncDataForNavList();

    // ▼ 一覧パネルを表示状態にしてからレイアウト計測＆スクロール
    panel.style.display = "block";

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

  window.addEventListener("cscs-sync-updated", function(){
    try{
      // ★ SYNC 側の /api/sync/state 反映にラグがあることがあるので、
      //   少し待ってから nav_list を再構築する
      setTimeout(function(){
        mountAndOpenPanel();
      }, 1000); // Cloudflare KV / SYNC 反映ラグ対策のため、1秒待ってから再描画
    }catch(_){}
  });

  window.addEventListener("DOMContentLoaded", function(){
    if (!isAPart()) return;
    try {
      const tag = document.currentScript || document.querySelector('script[src*="nav_list.js"]');
      let isEnabled = true;
      if (tag && tag.dataset && tag.dataset.aNav === "0") isEnabled = false;
      if (!isEnabled) return;
    } catch(_){}
    ensureToggle();
    mountAndOpenPanel();
  });
})();