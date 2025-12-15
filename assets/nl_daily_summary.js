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
(function(){
  "use strict";

  // このヘッダーを出す対象ページ判定（#nl-panel があるページ）
  function hasNavPanel(){
    return !!document.getElementById("nl-panel");
  }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function pad3(n){ return String(n).padStart(3, "0"); }

  function getDayFromPath(){
    var m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
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
  inset: 10px 10px 10px auto;
  margin-left: 69%;
}

/* ---- progress header ---- */
#nl-progress-header{
  font-family: ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  background: none;
  padding: 0px 0px 0px;
  border-bottom: 0;
  text-align: left;
  opacity: 0.9;
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

#nl-progress-header .nl-ph-grid{
  margin-top: 6px;
  display:grid;
  gap: 2px;
  width:100%;
}

#nl-progress-header .nl-ph-cell{
  height: 6px;
  border-radius: 2px;
  background: rgba(255,255,255,0.02);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28);
}

#nl-progress-header .nl-ph-cell.is-on{
  background: rgba(255,255,255,0.18);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.45);
}

#nl-progress-header .nl-ph-cell.is-today{
  background: rgba(255,255,255,0.26);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65), 0 0 0 1px rgba(255,255,255,0.35);
}

#nl-progress-header .nl-ph-spacer{
  height:0px;
}

/* ---- summary header ---- */
#nl-summary-header{
  background:none;
  padding: 0px 0px 10px;
  border-bottom: 1px solid rgb(42, 42, 42);
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

  function buildProgressGrid(total, filled, cols, todayIndex){
    var grid = document.createElement("div");
    grid.className = "nl-ph-grid";
    try{
      grid.style.gridTemplateColumns = "repeat(" + String(cols) + ", 1fr)";
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

  function removeExistingHeaders(panel){
    // 既存ヘッダーを確実に除去（過去に #nl-panel 内に入っていたものも含め、どこに居ても消す）
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
    if (!hasNavPanel()) return;

    ensureHeaderStyles();

    var panel = document.getElementById("nl-panel");
    if (!panel) return;

    removeExistingHeaders(panel);

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

    progressHost.appendChild(buildProgressGrid(dayTotal, dayFilled, 15, todayIndex));

    var dayRow = document.createElement("div");
    dayRow.className = "nl-ph-row";
    var dayTitle = document.createElement("div");
    dayTitle.className = "nl-ph-title";
    dayTitle.textContent = "日別";
    var dayValue = document.createElement("div");
    dayValue.className = "nl-ph-value";
    dayValue.textContent = String(dayFilled) + " / " + String(dayTotal);
    dayRow.appendChild(dayTitle);
    dayRow.appendChild(dayValue);
    progressHost.appendChild(dayRow);

    var sp = document.createElement("div");
    sp.className = "nl-ph-spacer";
    progressHost.appendChild(sp);

    // 問題マスは 30 個を横一列に並べる
progressHost.appendChild(buildProgressGrid(30, qFilled, 30, null));

    var qRow = document.createElement("div");
    qRow.className = "nl-ph-row";
    var qTitle = document.createElement("div");
    qTitle.className = "nl-ph-title";
    qTitle.textContent = "問題";
    var qValue = document.createElement("div");
    qValue.className = "nl-ph-value";
    qValue.textContent = String(qFilled) + " / 30";
    qRow.appendChild(qTitle);
    qRow.appendChild(qValue);
    progressHost.appendChild(qRow);

    // summary header
    var summaryHost = document.createElement("div");
    summaryHost.id = "nl-summary-header";
    try{
      // ▼ 見た目は ensureHeaderStyles() に集約（ここでは style を触らない）
      // 目的: スタイル管理の分散を防ぐ
    }catch(_){}

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

    summaryHost.appendChild(summaryLine2);
    summaryHost.appendChild(summaryLine3);
    summaryHost.appendChild(summaryLine4);

    // #nl-panel の外（= #nl-panel の直前）にヘッダーを出すためのホストを用意する
    // - panel 内に入れない（#nl-panel の外に出す）
    // - 親要素は panel.parentNode（= nav_list 側のレイアウト順を維持）
    var host = document.createElement("div");
    host.id = "nl-daily-summary-host";

    try{
      // ▼ #nl-daily-summary-host の配置/見た目は ensureHeaderStyles() に集約
      // 目的: 固定座標や余白の管理をCSS側に寄せる
    }catch(_){}

    // panel の直前に host を差し込む（= #nl-panel の外に出る）
    try{
      if (panel.parentNode) {
        panel.parentNode.insertBefore(host, panel);
      } else {
        document.body.insertBefore(host, document.body.firstChild);
      }
    }catch(_){
      document.body.insertBefore(host, document.body.firstChild);
    }

    // host の中にヘッダーを積む（panel の外に固定）
    host.appendChild(progressHost);
    host.appendChild(summaryHost);
  }

  window.CSCS_NL_DAILY_SUMMARY = {
    mount: mountHeaders
  };

  window.addEventListener("DOMContentLoaded", function(){
    if (!hasNavPanel()) return;
    mountHeaders();
  });

  window.addEventListener("cscs-sync-updated", function(){
    try{
      setTimeout(function(){
        mountHeaders();
      }, 1000);
    }catch(_){}
  });
})();