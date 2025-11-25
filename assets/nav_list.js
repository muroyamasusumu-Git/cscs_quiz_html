/* nav_list.js —：問題一覧（nav_manifest.json版 / 2カラム表示） */
(function(){
  "use strict";

  // true: A/B 両方で常時表示（開閉ボタンなし）
  // false: これまで通り、トグルボタンで開閉
  const NAV_ALWAYS_OPEN = true;

  async function loadSyncDataForNavList(){
    if (window.CSCS_SYNC && typeof window.CSCS_SYNC.loadAllSyncData === "function") {
      return window.CSCS_SYNC.loadAllSyncData();
    }
    throw new Error("CSCS_SYNC.loadAllSyncData が定義されていません。");
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

    // いったん達成率は未定のためダミー表示
    days.forEach(function(dayStr, idx){
      var isCurrent = (dayStr === currentDay);

      var item = document.createElement("div");
      item.className = "nl-day-item" + (isCurrent ? " is-current" : "");

      var link = document.createElement("a");
      link.href = "/_build_cscs_" + dayStr + "/slides/q001_a.html?nav=manual";
      link.setAttribute("data-nl-allow", "1");
      link.style.display = "block";
      link.style.textDecoration = "none";

      var titleRow = document.createElement("div");
      titleRow.className = "nl-day-title";
      titleRow.textContent = "DAY-" + pad2(idx + 1);

      var fieldRow = document.createElement("div");
      // 分野名は未定のため一旦プレースホルダ
      fieldRow.textContent = "（分野名）";

      var dateRow = document.createElement("div");
      dateRow.textContent = dayStr;

      var rateRow = document.createElement("div");
      rateRow.textContent = "達成率：—%";

      link.appendChild(titleRow);
      link.appendChild(fieldRow);
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
    const day = getDayFromPath();
    const currentN3 = getCurrentQuestionNumber3();
    let manifest = null;
    try {
      const res = await fetch("nav_manifest.json", {cache:"no-store"});
      manifest = await res.json();
    } catch (e) {
      console.error("nav_manifest.json 読み込み失敗:", e);
      panel.innerHTML = "<p style='color:red;padding:16px;'>nav_manifest.json の読み込みに失敗しました。</p>";
      return;
    }

    const title = manifest.questions?.[0]?.Title || "NSCA CSCS 試験対策問題集";
    const field = manifest.questions?.[0]?.Field || "—";
    const theme = manifest.questions?.[0]?.Theme || "—";
        
    // ヘッダーを一時的に消去。必要な場合は復活させる
    const headerHtml =
      '<!-- <div class="nl-head">' +
        '<div class="nl-title">' + title + '</div>' +
        '<div class="nl-crumbs">' + day + ' ／ ' + field + ' ／ ' + theme + '</div>' +
        '<div class="nl-note">★＝3連続正解（2連続不正解で取消）</div>' +
      '</div> -->';

    const gridHost = document.createElement("div");
    gridHost.className = "quiz-list-grid";

    (manifest.questions || []).forEach((q, idx) => {
      const i = idx + 1;
      const n3 = pad3(i);
      const qid = day + "-" + n3;

      const streak3Total = window.CSCS_SYNC.getStreak3Total(qid);
      const streakMark = streak3Total > 0 ? "⭐️" : "—";

      const consistencyStatus = window.CSCS_SYNC.getConsistencyStatus(qid);

      let consistencyMark = "—";

      if (consistencyStatus === "◎") {
        consistencyMark = "◎";
      } else if (consistencyStatus === "○") {
        consistencyMark = "○";
      } else if (consistencyStatus === "△") {
        consistencyMark = "△";
      } else if (consistencyStatus === "×") {
        consistencyMark = "×";
      }

      const correctTotal = window.CSCS_SYNC.getCorrectTotal(qid);
      const wrongTotal = window.CSCS_SYNC.getWrongTotal(qid);

      const favRaw = localStorage.getItem("cscs_fav:" + qid);
      let favText = "未設定";
      if (favRaw === "1") {
        favText = "★1";
      } else if (favRaw === "2") {
        favText = "★2";
      } else if (favRaw === "3") {
        favText = "★3";
      }

      const url   = "q" + n3 + "_a.html?nav=manual";

      const snippet = (q.Question || "").slice(0, 18) + ((q.Question || "").length > 18 ? "…" : "");
      // 1行目は「[テーマ]＋問題文」に変更（番号は下段へ）
      const line1Text = "[" + (q.Theme || "—") + "] " + snippet;

      // ▼ Level の表記を「Level 1」→「1」へ正規化
      let rawLevel = q.Level || "—";
      rawLevel = String(rawLevel).replace(/Level\s*/i, "").trim();

      const levelText  = "Lvl " + rawLevel;
      const line2Text  =
        streakMark +
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
      const isCurrent = (currentN3 && n3 === currentN3);
      item.className = "quiz-item" + (isCurrent ? " is-current" : "");

      const l1 = document.createElement("div");
      l1.className = "line1";
      const a  = document.createElement("a");
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

    // nl-toolbar（閉じるボタン）は廃止。トグルボタンで開閉する。
    panel.innerHTML =
      '<div id="nl-body" class="nl-body-grid">' +
        '<div class="nl-left-col" id="nl-left-col">' +
          headerHtml +
        '</div>' +
        '<div class="nl-right-col" id="nl-right-col"></div>' +
      '</div>';

    const bodyHost = panel.querySelector("#nl-body");
    const leftCol  = panel.querySelector("#nl-left-col");
    const rightCol = panel.querySelector("#nl-right-col");

    if (bodyHost){
      try{
      }catch(_){}
    }

    if (leftCol){
      try{
      }catch(_){}
      leftCol.appendChild(gridHost);
    }

    if (rightCol){
      try{
      }catch(_){}
      renderDayList(rightCol, day);
    }

    // ▼ 現在の問題（.quiz-item.is-current）と現在の日（.nl-day-item.is-current）が見えるように自動スクロール
    try{
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
    }catch(_){}
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