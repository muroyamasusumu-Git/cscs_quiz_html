// field_summary.js

(function () {
  "use strict";

  // ★ ここで CSS を自動注入
  var style = document.createElement("style");
  style.textContent = `
    #cscs-field-star-summary {
        font-size: 13px;
        margin-top: 8px;
        padding: 8px 10px;
        border-top-width: 1px;
        border-top-style: solid;
        border-top-color: rgba(255, 255, 255, 0.3);
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
  var dummyFieldStats = [
    { field: "エクササイズテクニック", star: 0, total: 0 },
    { field: "スポーツ心理学", star: 0, total: 0 },
    { field: "テストと評価", star: 0, total: 0 },
    { field: "テスト評価・測定", star: 0, total: 0 },
    { field: "バイオメカニクス", star: 0, total: 0 },
    { field: "パフォーマンス向上物質", star: 0, total: 0 },
    { field: "プログラムデザイン", star: 0, total: 0 },
    { field: "プログラム実施", star: 0, total: 0 },
    { field: "リハビリテーションと再調整", star: 0, total: 0 },
    { field: "指導・安全管理", star: 0, total: 0 },
    { field: "指導実施", star: 0, total: 0 },
    { field: "施設管理と運営", star: 0, total: 0 },
    { field: "栄養学", star: 0, total: 0 },
    { field: "特殊集団の考慮", star: 0, total: 0 },
    { field: "運動生理学", star: 0, total: 0 },
    { field: "運営管理", star: 0, total: 0 }
  ];

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

    var needLine = document.createElement("div");
    needLine.textContent =
      "試験まで残り " + DUMMY_DAYS_LEFT + " 日 → 1日あたり必要 ⭐️: " + needPerDay + " 個（ダミー）";
    needLine.style.marginBottom = "6px";
    needLine.style.fontWeight = "bold";
    panel.appendChild(needLine);

    var title = document.createElement("div");
    title.textContent = "分野別 ⭐️ 獲得状況（ダミー）";
    title.style.fontWeight = "bold";
    title.style.marginBottom = "6px";
    panel.appendChild(title);

    var grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(3, 1fr)";
    grid.style.gap = "4px 12px";

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFieldStarSummary);
  } else {
    renderFieldStarSummary();
  }

})();