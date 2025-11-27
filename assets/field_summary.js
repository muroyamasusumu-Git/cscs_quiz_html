// field_summary.js

(function () {
  "use strict";

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
    var similar = document.querySelector(".similar-list") || document.getElementById("similar-list");
    if (!similar) {
      console.warn("similar-list が見つからないため表示されませんでした。");
      return;
    }

    if (document.getElementById("cscs-field-star-summary")) return;

    var wrap = document.createElement("div");
    wrap.id = "cscs-field-star-summary";
    wrap.style.fontSize = "11px";
    wrap.style.marginTop = "8px";
    wrap.style.padding = "8px 10px";
    wrap.style.borderTop = "1px solid rgba(255,255,255,0.3)";
    wrap.style.color = "#fff";
    wrap.style.opacity = "0.95";

    var needLine = document.createElement("div");
    needLine.textContent =
      "試験まで残り " + DUMMY_DAYS_LEFT + " 日 → 1日あたり必要 ⭐️: " + needPerDay + " 個（ダミー）";
    needLine.style.marginBottom = "6px";
    needLine.style.fontWeight = "bold";
    wrap.appendChild(needLine);

    var title = document.createElement("div");
    title.textContent = "分野別 ⭐️ 獲得状況（ダミー）";
    title.style.fontWeight = "bold";
    title.style.marginBottom = "6px";
    wrap.appendChild(title);

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

    wrap.appendChild(grid);
    similar.parentNode.insertBefore(wrap, similar.nextSibling);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFieldStarSummary);
  } else {
    renderFieldStarSummary();
  }
})();