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

  // ★ 分野名は localStorage.cscs_field_names から取得する（フォールバック無し）
  function loadFieldNamesFromLocalStorageStrict() {
    try {
      var raw = localStorage.getItem("cscs_field_names");
      if (!raw) {
        console.error("field_summary.js: localStorage.cscs_field_names が存在しません");
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.error("field_summary.js: cscs_field_names が配列ではありません");
        return null;
      }
      var filtered = parsed.filter(function (v) {
        return typeof v === "string" && v.trim() !== "";
      });
      if (filtered.length === 0) {
        console.error("field_summary.js: cscs_field_names に有効な分野名がありません");
        return null;
      }
      return filtered;
    } catch (e) {
      console.error("field_summary.js: cscs_field_names の読み込みに失敗しました", e);
      return null;
    }
  }

  var fieldNames = loadFieldNamesFromLocalStorageStrict();

  function makeStats(name) {
    var total = Math.floor(Math.random() * 140) + 60;      // 60〜199
    var star  = Math.floor(total * (Math.random() * 0.8)); // total の 0〜80%
    return { field: name, star: star, total: total };
  }

  var dummyFieldStats = fieldNames.map(makeStats);

  // ★ ダミーで2つを100%達成状態にする
  if (dummyFieldStats.length >= 2) {
    dummyFieldStats[1].star = dummyFieldStats[1].total;
    dummyFieldStats[4].star = dummyFieldStats[4].total;
  }

  var remainStar = DUMMY_TOTAL - DUMMY_STAR_DONE;
  var needPerDay = Math.ceil(remainStar / DUMMY_DAYS_LEFT);

  function renderFieldStarSummary() {
    var wrapContainer = document.querySelector(".wrap");
    if (!wrapContainer) {
      console.warn(".wrap が見つからないため field_summary を表示できませんでした。");
      return;
    }

    if (document.getElementById("cscs-field-star-summary")) return;

    // ★ 分野名が正しく取得できなかった場合は、その旨だけ表示して終了（フォールバック無し）
    if (!fieldNames || !Array.isArray(fieldNames) || fieldNames.length === 0) {
      var errorPanel = document.createElement("div");
      errorPanel.id = "cscs-field-star-summary";
      errorPanel.textContent = "field_summary: localStorage.cscs_field_names が見つからないか不正です。";
      errorPanel.style.fontSize = "11px";
      errorPanel.style.opacity = "0.7";
      wrapContainer.insertAdjacentElement("afterend", errorPanel);
      return;
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
    needLine.textContent =
      "⭐️本日の目標19/日(基準比:順調)｜獲得数+5［■■■■■■□□□□□］19%｜全体［■■■■■■□□□□□］42%";
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
      barOuter.style.marginTop = "2px";
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