// field_summary.js

(function () {
  "use strict";

  // ★ ここで CSS を自動注入
  var style = document.createElement("style");
  style.textContent = `
    #cscs-field-star-summary {
        font-size: 11px;
        margin-top: 10px;
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

  // ★ merged_all.csv から抽出した正式な 16分野
  var fieldNames = [
    "エクササイズテクニック",
    "スポーツ心理学",
    "テストと評価",
    "テスト評価・測定",
    "バイオメカニクス",
    "パフォーマンス向上物質",
    "プログラムデザイン",
    "プログラム実施",
    "リハビリテーションと再調整",
    "指導・安全管理",
    "指導実施",
    "施設管理と運営",
    "栄養学",
    "特殊集団の考慮",
    "運動生理学",
    "運営管理"
  ];

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
      "⭐️目標19/日(基準比:順調)｜日別+5［■■■■■□□□□□□］19%｜全体［■■■■■■■□□□□□□］42%";
    needLine.style.marginBottom = "10px";
    needLine.style.fontWeight = "500";
    needLine.style.fontSize = "15px";
    panel.appendChild(needLine);

    var list = document.createElement("ul");
    list.style.listStyleType = "disc";
    list.style.listStylePosition = "inside";
    list.style.margin = "0";
    list.style.padding = "0";

    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(3, 1fr)";
    list.style.columnGap = "0";
    list.style.rowGap = "4px";

    dummyFieldStats.forEach(function (row) {
      var rate = (row.total > 0)
        ? ((row.star / row.total) * 100).toFixed(1)
        : "0.0";

      var item = document.createElement("li");

      // 100% 達成 → bullet を消す
      var isPerfect = (rate === "100.0");

        if (isPerfect) {
        item.style.listStyleType = "none";
        item.style.paddingLeft = "0.9em";
        item.style.textIndent = "-0.9em";

        item.style.justifySelf = "start";
        item.style.transform = "translateX(-5px)";
        item.style.margin = "0 0 2px 0";
        } else {
        item.style.listStyleType = "disc";
        item.style.listStylePosition = "inside";
        item.style.paddingLeft = "0";
        item.style.textIndent = "0";
        item.style.margin = "0 0 2px 0";
        }

      // 100% 達成した分野を事前に抽出しておき、最大4つに制限
      if (!window.__cscsStarListPrepared__) {
        window.__cscsStarListPrepared__ = true;
        window.__cscsPerfectFields__ = dummyFieldStats
          .filter(function (r) { return ((r.star / r.total) * 100).toFixed(1) === "100.0"; })
          .map(function (r) { return r.field; });

        // 最大4つまでに制限
        window.__cscsPerfectFields__ = window.__cscsPerfectFields__.slice(0, 4);

        // 1つだけ 🌟 にする
        if (window.__cscsPerfectFields__.length > 0) {
          var randomIndex = Math.floor(Math.random() * window.__cscsPerfectFields__.length);
          window.__cscsPerfectSpecial__ = window.__cscsPerfectFields__[randomIndex];
        } else {
          window.__cscsPerfectSpecial__ = null;
        }
      }

      var headMark;
      if (((row.star / row.total) * 100).toFixed(1) === "100.0") {
        if (row.field === window.__cscsPerfectSpecial__) {
          headMark = "🌟";
        } else {
          headMark = "⭐️";
        }
      } else {
        headMark = "";
      }

      item.textContent =
        headMark +
        row.field +
        ": " +
        row.star + " / " + row.total +
        "（" + rate + "%）";

      item.style.margin = "0 0 2px 0";
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