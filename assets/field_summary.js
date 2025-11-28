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
      "試験まで残り " + DUMMY_DAYS_LEFT +
      " 日 → 必要⭐️" + needPerDay + "個/日" +
      "（基準" + basePerDay + "との差: " + diff + "｜" + mood + "）";
    needLine.style.marginBottom = "10px";
    needLine.style.fontWeight = "500";
    needLine.style.fontSize = "15px";
    panel.appendChild(needLine);

    var grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(3, 1fr)";
    grid.style.gap = "4px 0";

    dummyFieldStats.forEach(function (row) {
      var rate = (row.total > 0)
        ? ((row.star / row.total) * 100).toFixed(1)
        : "0.0";

      var box = document.createElement("div");
      box.textContent = row.field + ": ⭐️ " + row.star + " / " + row.total + "（" + rate + "%）";
      box.style.marginBottom = "2px";
      grid.appendChild(box);
    });

    panel.appendChild(grid);
    wrapContainer.insertAdjacentElement("afterend", panel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFieldStarSummary);
  } else {
    renderFieldStarSummary();
  }

})();