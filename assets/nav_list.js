/* nav_list.js — Aパート専用：問題一覧（nav_manifest.json版 / 2カラム表示） */
(function(){
  "use strict";

  function isAPart(){
    return /_a(?:\.html)?(?:\?.*)?(?:#.*)?$/i.test(String(location.href || ""));
  }
  function getDayFromPath(){
    var m = (window.location.pathname || "").match(/_build_cscs_(\d{8})/);
    return m ? m[1] : "unknown";
  }
  function pad2(n){ return String(n).padStart(2, "0"); }
  function pad3(n){ return String(n).padStart(3, "0"); }

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

  /* Aパート下部中央のトグルボタンを挿入（開いている間は✖️ 閉じる　に変化） */
  function ensureToggle(){
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

    document.body.appendChild(panel);

    /* クリックバブリング抑止（内部以外のクリックで閉じない設計） */
    panel.addEventListener("click", function(e){
      var inside = e.target && e.target.closest("#nl-panel");
      if (!inside) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  /* メイン描画：nav_manifest.json から構築 */
  async function renderListInto(panel){
    const day = getDayFromPath();
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

    const headerHtml =
      '<div class="nl-head">' +
        '<div>' +
          '<div class="nl-title">' + title + '</div>' +
          '<div class="nl-crumbs">' + day + ' ／ ' + field + ' ／ ' + theme + '</div>' +
        '</div>' +
        '<div class="nl-note">★＝3連続正解（2連続不正解で取消）</div>' +
      '</div>';

    const gridHost = document.createElement("div");
    gridHost.className = "quiz-list-grid";

    (manifest.questions || []).forEach((q, idx) => {
      const i = idx + 1;
      const n3 = pad3(i);
      const stats = readStats(day, n3);
      const total = stats.correct + stats.wrong;
      const rate  = (total > 0) ? Math.round((stats.correct / total) * 100) : null;
      const mark  = stats.cleared ? "★Clear" : "—";
      const url   = "q" + n3 + "_a.html?nav=manual";

      const snippet = (q.Question || "").slice(0,10) + ((q.Question||"").length>10?"…":"");
      const line1Text = pad2(i) + " [" + (q.Level || "Lv?") + "｜" + (q.Theme || "—") + "]　" + snippet;

      const wrongText = "×" + String(stats.wrong).padStart(1,"0") + "（累計 " + String(stats.wrongLog).padStart(1,"0") + "）";
      const rateText  = (rate != null) ? ("正解率 " + String(rate).padStart(2, " ") + "%") : "正解率 —";
      const line2Text = rateText + " ／ " + wrongText + " ／ " + mark;

      const item = document.createElement("div");
      item.className = "quiz-item";

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
    panel.innerHTML = headerHtml + '<div id="nl-body"></div>';

    const bodyHost = panel.querySelector("#nl-body");
    if (bodyHost) bodyHost.appendChild(gridHost);
  }

  async function mountAndOpenPanel(){
    ensurePanel();
    const panel = document.getElementById("nl-panel");
    await renderListInto(panel);
    panel.style.display = "block";
    lockBodyScroll();
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
  });
})();