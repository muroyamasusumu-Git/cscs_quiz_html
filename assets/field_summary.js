// field_summary.js

(function () {
  "use strict";

  // ★ ここで CSS を自動注入
  var style = document.createElement("style");
  style.textContent = `
    #cscs-field-star-summary {
        font-size: 11px;
        margin-top: 0;
        padding: 10px 10px 10px 5px;
        color: rgb(255, 255, 255);
        opacity: 0.55;
        width: 69%;
        font-weight: 300;
    }
  `;
  document.head.appendChild(style);

  var DUMMY_TOTAL = 2700;
  var DUMMY_STAR_DONE = 500;
  var DUMMY_DAYS_LEFT = 120;

  // ★ cscs_meta_all.json から Field 名一覧＋各 Field の総問題数を取得（similar_list.js と同系統の正規化）
  function normalizeMetaForFields(meta) {
    var rows = [];
    if (meta && Array.isArray(meta.items)) {
      rows = meta.items;
    } else if (meta && Array.isArray(meta.questions)) {
      rows = meta.questions;
    } else if (Array.isArray(meta)) {
      rows = meta;
    } else {
      return { names: [], totals: {}, qidToField: {} };
    }

    var set = new Set();
    var totals = Object.create(null);
    var qidMap = Object.create(null);

    rows.forEach(function (x) {
      var f = x.Field || x.field || "";
      f = String(f).trim();
      if (!f) {
        return;
      }
      set.add(f);
      if (totals[f] == null) {
        totals[f] = 1;
      } else {
        totals[f] += 1;
      }

      var day = x.Date || x.day || "";
      day = String(day).trim();

      var numRaw = null;
      if (x.n3 != null) {
        numRaw = x.n3;
      } else if (x.Number != null) {
        numRaw = x.Number;
      }

      var n3 = "";
      if (numRaw != null) {
        n3 = String(numRaw);
        if (n3.length < 3) {
          n3 = ("00" + n3).slice(-3);
        }
      }

      if (day && n3) {
        var qid = day + "-" + n3;
        if (!qidMap[qid]) {
          qidMap[qid] = f;
        }
      }
    });

    return {
      names: Array.from(set),
      totals: totals,
      qidToField: qidMap
    };
  }

  async function loadFieldNamesFromMetaStrict() {
    try {
      // デフォルトは similar_list.js と同じ assets/cscs_meta_all.json
      var src = "../../assets/cscs_meta_all.json";
      // <script src="...field_summary.js" data-src="..."> があればそちらを優先
      (function () {
        var scripts = document.scripts;
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          if ((s.src || "").indexOf("field_summary.js") !== -1 && s.dataset && s.dataset.src) {
            src = s.dataset.src;
            break;
          }
        }
      })();

      var url = new URL(src, location.href).href;
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("field_summary.js: meta JSON fetch failed: " + res.status);
        return null;
      }
      var meta = await res.json();
      var info = normalizeMetaForFields(meta);
      if (!info || !info.names || !info.names.length) {
        console.error("field_summary.js: meta に有効な Field がありません");
        return null;
      }
      fieldTotals = info.totals || {};
      qidToField = info.qidToField || {};
      return info.names;
    } catch (e) {
      console.error("field_summary.js: meta 読み込み失敗", e);
      return null;
    }
  }

  async function loadStarFieldCountsStrict() {
    try {
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("field_summary.js: /api/sync/state 取得失敗: " + res.status);
        return null;
      }
      var json = await res.json();
      if (!json || typeof json !== "object") {
        console.error("field_summary.js: SYNC データ形式が不正です", json);
        return null;
      }
      var root = json.data || json;
      if (!root.streak3 || typeof root.streak3 !== "object") {
        console.error("field_summary.js: SYNC に streak3 がありません", root);
        return null;
      }
      var streak3 = root.streak3;
      var counts = Object.create(null);
      var totalStarQ = 0;

      Object.keys(streak3).forEach(function (qid) {
        var cnt = Number(streak3[qid] || 0);
        if (!Number.isFinite(cnt) || cnt <= 0) {
          return;
        }
        if (!qidToField || !Object.prototype.hasOwnProperty.call(qidToField, qid)) {
          return;
        }
        var field = qidToField[qid];
        if (!field) {
          return;
        }
        if (counts[field] == null) {
          counts[field] = 1;
        } else {
          counts[field] += 1;
        }
        totalStarQ += 1;
      });

      var examDate = null;
      if (typeof root.exam_date === "string") {
        var m = root.exam_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          var y = Number(m[1]);
          var mo = Number(m[2]) - 1;
          var d = Number(m[3]);
          var dt = new Date(y, mo, d);
          if (
            !Number.isNaN(dt.getTime()) &&
            dt.getFullYear() === y &&
            dt.getMonth() === mo &&
            dt.getDate() === d
          ) {
            examDate = dt;
          }
        }
      }

      var remainingDays = 0;
      if (examDate) {
        var now = new Date();
        var todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var deadline = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
        deadline.setDate(deadline.getDate() - 14);
        var diffMs = deadline.getTime() - todayBase.getTime();
        remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (!Number.isFinite(remainingDays) || remainingDays < 0) {
          remainingDays = 0;
        }
      }

      var targetPerDay = 0;
      var TOTAL_Q = 2700;
      if (remainingDays > 0) {
        var remainingStar = TOTAL_Q - totalStarQ;
        if (remainingStar < 0) {
          remainingStar = 0;
        }
        targetPerDay = Math.ceil(remainingStar / remainingDays);
      } else {
        targetPerDay = 0;
      }

      starFieldCounts = counts;
      starTotalSolvedQuestions = totalStarQ;
      starRemainingDays = remainingDays;
      starTargetPerDay = targetPerDay;
      return counts;
    } catch (e) {
      console.error("field_summary.js: SYNC 読み込み失敗", e);
      return null;
    }
  }

  var fieldNames = null;
  var fieldTotals = null;
  var qidToField = null;
  var starFieldCounts = null;
  var starTotalSolvedQuestions = 0;
  var starRemainingDays = 0;
  var starTargetPerDay = 0;

  function makeStats(name) {
    var total = 0;
    if (fieldTotals && Object.prototype.hasOwnProperty.call(fieldTotals, name)) {
      total = Number(fieldTotals[name]) || 0;
    }
    var star = 0;
    if (starFieldCounts && Object.prototype.hasOwnProperty.call(starFieldCounts, name)) {
      star = Number(starFieldCounts[name]) || 0;
    }
    return { field: name, star: star, total: total };
  }

  var dummyFieldStats = null;

  var remainStar = DUMMY_TOTAL - DUMMY_STAR_DONE;
  var needPerDay = Math.ceil(remainStar / DUMMY_DAYS_LEFT);

  async function renderFieldStarSummary() {
    var wrapContainer = document.querySelector(".wrap");
    if (!wrapContainer) {
      console.warn(".wrap が見つからないため field_summary を表示できませんでした。");
      return;
    }

    if (document.getElementById("cscs-field-star-summary")) return;

    if (!fieldNames) {
      fieldNames = await loadFieldNamesFromMetaStrict();
      if (!fieldNames || !Array.isArray(fieldNames) || !fieldNames.length) {
        var errorPanel = document.createElement("div");
        errorPanel.id = "cscs-field-star-summary";
        errorPanel.textContent = "field_summary: /assets/cscs_meta_all.json から分野一覧を取得できませんでした。";
        errorPanel.style.fontSize = "11px";
        errorPanel.style.opacity = "0.7";
        wrapContainer.insertAdjacentElement("afterend", errorPanel);
        return;
      }
    }

    if (!starFieldCounts) {
      var counts = await loadStarFieldCountsStrict();
      if (!counts) {
        var errorPanelSync = document.createElement("div");
        errorPanelSync.id = "cscs-field-star-summary";
        errorPanelSync.textContent = "field_summary: /api/sync/state から streak3 を取得できませんでした。";
        errorPanelSync.style.fontSize = "11px";
        errorPanelSync.style.opacity = "0.7";
        wrapContainer.insertAdjacentElement("afterend", errorPanelSync);
        return;
      }
    }

    if (!dummyFieldStats) {
      dummyFieldStats = fieldNames.map(makeStats);
    }

    var panel = document.createElement("div");
    panel.id = "cscs-field-star-summary";

    var basePerDay = 30;
    var diff = needPerDay - basePerDay;
    var mood = "";
    if (needPerDay <= basePerDay * 0.8) {
      mood = "余裕";
    } else if (needPerDay <= basePerDay * 1.1) {
      mood = "順調";
    } else if (needPerDay <= basePerDay * 1.4) {
      mood = "巻き返し";
    } else {
      mood = "要注意";
    }

    var needLine = document.createElement("div");
    var targetNum = Number(starTargetPerDay);
    if (!Number.isFinite(targetNum) || targetNum < 0) {
      targetNum = 0;
    }
    needLine.textContent =
      "⭐️本日の目標" + String(targetNum) + "/日(基準比:順調)｜獲得数+5［■■■■■■□□□□□］19%｜全体［■■■■■■□□□□□］42%";
    needLine.style.marginBottom = "10px";
    needLine.style.marginLeft = "-8px";
    needLine.style.fontWeight = "500";
    needLine.style.fontSize = "15px";
    panel.appendChild(needLine);

    var list = document.createElement("ul");
    list.style.listStyleType = "disc";
    list.style.listStylePosition = "outside";
    list.style.margin = "0";
    list.style.padding = "0";

    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(3, 1fr)";
    list.style.columnGap = "0";
    list.style.rowGap = "4px";

    dummyFieldStats.forEach(function (row) {
      var rate = (row.total > 0)
        ? ((row.star / row.total) * 100).toFixed(0)
        : "0";

      var item = document.createElement("li");

      var isPerfect = (rate === "100");

      if (isPerfect) {
        item.style.listStyleType = "none";
        item.style.textIndent = "-1.5em";
        item.style.paddingLeft = "0px";
        item.style.justifySelf = "start";
        item.style.margin = "0px 0px 6px";
      } else {
        item.style.listStyleType = "none";
        item.style.paddingLeft = "0";
        item.style.textIndent = "0";
        item.style.margin = "0 0 6px 0";
      }

      if (!window.__cscsStarListPrepared__) {
        window.__cscsStarListPrepared__ = true;
        window.__cscsPerfectFields__ = dummyFieldStats
          .filter(function (r) { return ((r.star / r.total) * 100).toFixed(0) === "100"; })
          .map(function (r) { return r.field; });
        window.__cscsPerfectFields__ = window.__cscsPerfectFields__.slice(0, 4);
        if (window.__cscsPerfectFields__.length > 0) {
          var randomIndex = Math.floor(Math.random() * window.__cscsPerfectFields__.length);
          window.__cscsPerfectSpecial__ = window.__cscsPerfectFields__[randomIndex];
        } else {
          window.__cscsPerfectSpecial__ = null;
        }
      }

      var headMark;
      if (((row.star / row.total) * 100).toFixed(0) === "100") {
        if (row.field === window.__cscsPerfectSpecial__) {
          headMark = "🌟";
        } else {
          headMark = "⭐️";
        }
      } else {
        headMark = "";
      }

      var label = document.createElement("div");
      label.textContent =
        headMark +
        row.field +
        ": " +
        row.star + " / " + row.total +
        "(" + rate + "%)";

      var barOuter = document.createElement("div");
      barOuter.style.marginTop = "1px";
      barOuter.style.width = "170px";
      barOuter.style.maxWidth = "170px";
      barOuter.style.height = "3px";
      barOuter.style.background = "rgba(255, 255, 255, 0.30)";
      barOuter.style.borderRadius = "999px";
      barOuter.style.overflow = "hidden";

      var barInner = document.createElement("div");
      barInner.style.height = "100%";
      barInner.style.width = rate + "%";
      barInner.style.background = "rgba(255, 255, 255, 0.55)";
      barInner.style.borderRadius = "999px";

      barOuter.appendChild(barInner);

      item.appendChild(label);
      item.appendChild(barOuter);

      list.appendChild(item);
    });

    panel.appendChild(list);
    wrapContainer.insertAdjacentElement("afterend", panel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFieldStarSummary);
  } else {
    renderFieldStarSummary();
  }

})();