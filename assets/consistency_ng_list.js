// assets/consistency_ng_list.js
// 目的:
//   SYNC(/api/sync/state) から「整合性チェック ×」になっている問題の一覧を取得し、
//   ページ内でオンデマンド表示するトグル機能を提供する。
// 仕様:
//   - デフォルト非表示
//   - <div class="topmeta-left"> の末端に 「×NGlist(N)」 を白文字リンクとして追加
//   - クリックで .wrap の末端に一覧パネルを表示 / 非表示 (toggle)
//   - N は SYNC から取得した × の総数

(function () {
  "use strict";

  // =========================
  // 内部状態
  // =========================

  var cngListCache = null;
  var cngFetchError = null;
  var cngPanelVisible = false;
  // 現在のソートモードを保持する（"mark_x_first" = ×優先, "mark_delta_first" = △優先）
  // 初期状態では × を上に並べるモードでスタートさせる
  var cngSortMode = "mark_x_first";

  // =========================
  // スタイル挿入
  // =========================

  function injectConsistencyNgStyles() {
    if (document.getElementById("cscs-consistency-ng-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "cscs-consistency-ng-style";

    style.textContent =
      // ▼ パネル本体（ユーザー指定済）
      "#cscs-consistency-ng-panel {\n" +
      "  font-size: 11px;\n" +
      "  line-height: 1.5;\n" +
      "  margin: 0;\n" +
      "  padding: 8px 10px 8px 2px;\n" +
      "  width: 600px;\n" +
      "  color: rgba(255, 220, 220, 0.85);\n" +
      "  opacity: 0.80;\n" +
      "}\n" +

      "#cscs-consistency-ng-panel h3 {\n" +
      "  margin: 0 0 6px 0;\n" +
      "  font-size: 15px;\n" +
      "  font-weight: 600;\n" +
      "  opacity: 0.85;\n" +
      "}\n" +

      "#cscs-consistency-ng-panel .cng-summary {\n" +
      "  margin-bottom: 6px;\n" +
      "  opacity: 0.90;\n" +
      "  font-size: 13px;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel .cng-summary a {\n" +
      "  color: rgba(255, 220, 220, 0.85);\n" +
      "  text-decoration: underline;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel .cng-summary a:hover {\n" +
      "  opacity: 1.0;\n" +
      "}\n" +

      "#cscs-consistency-ng-panel table {\n" +
      "  width: 100%;\n" +
      "  border-collapse: collapse;\n" +
      "  background: rgba(255, 120, 120, 0.08);\n" +
      "  opacity: 0.90;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel th,\n" +
      "#cscs-consistency-ng-panel td {\n" +
      "  border: 1px solid rgba(255, 200, 200, 0.18);\n" +
      "  padding: 2px 4px;\n" +
      "  text-align: left;\n" +
      "  font-size: 10px;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel th {\n" +
      "  background: rgba(255, 120, 120, 0.15);\n" +
      "  font-weight: 600;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel .cng-qid {\n" +
      "  white-space: nowrap;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel .cng-empty {\n" +
      "  font-size: 11px;\n" +
      "  opacity: 0.7;\n" +
      "}\n" +
      "#cscs-consistency-ng-panel .cng-footer {\n" +
      "  margin-top: 4px;\n" +
      "  font-size: 10px;\n" +
      "  opacity: 0.6;\n" +
      "}\n" +

      // ▼ ★あなたが指定したトグルリンクの新スタイル★
      "#cscs-consistency-ng-toggle:hover {\n" +
      "  text-decoration: underline;\n" +
      "}\n" +
      "#cscs-consistency-ng-toggle {\n" +
      "  color: #ffffff;\n" +
      "  font-size: 14px;\n" +
      "  margin-left: 0;\n" +
      "  text-decoration: underline;\n" +
      "  cursor: pointer;\n" +
      "  opacity: 0.7;\n" + 
      "}\n";

    document.head.appendChild(style);
  }

  // =========================
  // パネル DOM を生成
  // =========================

  function ensureConsistencyNgPanel() {
    var existing = document.getElementById("cscs-consistency-ng-panel");
    if (existing) return existing;

    var panel = document.createElement("div");
    panel.id = "cscs-consistency-ng-panel";
    panel.style.display = "none";

    var wrap = document.querySelector(".wrap") || document.body;
    wrap.appendChild(panel);

    return panel;
  }

  // =========================
  // トグルリンク生成
  // =========================

  function createOrUpdateToggleLink(count) {
    var parent = document.querySelector(".topmeta-left") || document.body;
    var link = document.getElementById("cscs-consistency-ng-toggle");

    var label = "×/△list(" + String(count) + ")";

    if (!link) {
      link = document.createElement("a");
      link.id = "cscs-consistency-ng-toggle";
      link.href = "#";
      link.textContent = label;
      parent.appendChild(link);

      link.addEventListener("click", function (e) {
        e.preventDefault();
        toggleConsistencyNgPanel();
      });
    } else {
      link.textContent = label;
      if (!link.parentNode) parent.appendChild(link);
    }
  }

  // =========================
  // SYNCから × 問題一覧を取得
  // =========================

  async function fetchConsistencyNgListFromSync() {
    var res = await fetch(location.origin + "/api/sync/state", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);

    var root = await res.json();
    var list = [];
    var i;

    // root.consistency_status
    if (root.consistency_status && typeof root.consistency_status === "object") {
      var map = root.consistency_status;
      for (var qid in map) {
        var st = map[qid];
        var mark = st.status_mark || st.severity_mark;
        if (mark === "×" || mark === "△") {
          list.push({
            qid: qid,
            status_mark: mark,
            status_label: st.status_label || "",
            classification_code: st.classification_code || "",
            classification_detail: st.classification_detail || "",
            saved_at: st.saved_at || ""
          });
        }
      }
    }

    // root.items
    if (Array.isArray(root.items)) {
      for (i = 0; i < root.items.length; i++) {
        var item = root.items[i];
        if (item.kind !== "consistency_status") continue;
        var st2 = item.status || {};
        var mark2 = st2.status_mark || st2.severity_mark;
        if (mark2 === "×" || mark2 === "△") {
          list.push({
            qid: item.qid || "",
            status_mark: mark2,
            status_label: st2.status_label || "",
            classification_code: st2.classification_code || "",
            classification_detail: st2.classification_detail || "",
            saved_at: st2.saved_at || ""
          });
        }
      }
    }

    list.sort((a, b) => String(a.qid).localeCompare(String(b.qid)));
    return list;
  }

  // =========================
  // 表示用のデータ整形
  // =========================

  function formatSavedAt(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    var h = ("0" + d.getHours()).slice(-2);
    var min = ("0" + d.getMinutes()).slice(-2);
    return `${y}-${m}-${day} ${h}:${min}`;
  }

  // =========================
  // パネルHTML生成
  // =========================

  // ソートモードと QID に従って、表示用のリストを並び替える
  // - cngSortMode が "mark_x_first" の場合: 記号 "×" を上に、その次に "△" を並べる
  // - cngSortMode が "mark_delta_first" の場合: 記号 "△" を上に、その次に "×" を並べる
  // - 同じ記号同士は QID 昇順でソートする
  function getSortedListForRender(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    // 元配列を書き換えないようにコピーを作成する
    var sorted = list.slice();

    sorted.sort(function (a, b) {
      var ma = a.status_mark || "";
      var mb = b.status_mark || "";

      // まずは記号の優先順位でソート
      if (ma !== mb) {
        if (cngSortMode === "mark_delta_first") {
          // △優先モード: △ → × → その他
          if (ma === "△") return -1;
          if (mb === "△") return 1;
          if (ma === "×") return -1;
          if (mb === "×") return 1;
        } else {
          // ×優先モード: × → △ → その他
          if (ma === "×") return -1;
          if (mb === "×") return 1;
          if (ma === "△") return -1;
          if (mb === "△") return 1;
        }
      }

      // 記号が同じ場合は QID 文字列の昇順でソートする
      return String(a.qid).localeCompare(String(b.qid));
    });

    return sorted;
  }

  function buildConsistencyNgPanelHtml(list, sortMode) {
    var html = "";

    html += "<h3>× / △ 整合性要対応問題リスト（SYNC）</h3>";

    if (!list.length) {
      html += '<div class="cng-summary cng-empty">現在SYNCに「×」「△」の問題はありません。</div>';
      return html;
    }

    // × と △ の件数をカウント
    var countX = list.filter(function (x) { return x.status_mark === "×"; }).length;
    var countD = list.filter(function (x) { return x.status_mark === "△"; }).length;

    // 現在のソートモードに応じてラベルを切り替える
    var isXFirst = sortMode === "mark_x_first";
    var xLabel = isXFirst ? "×→△（現在）" : "×→△";
    var dLabel = !isXFirst ? "△→×（現在）" : "△→×";

    // 件数と、並び替えトグルリンクをまとめて表示する
    html += '<div class="cng-summary">';
    html += "SYNCに保存されている ×:<strong>" + countX + "</strong> 件 / ";
    html += "△:<strong>" + countD + "</strong> 件（計 <strong>" + list.length + "</strong> 件）";
    html += " / 並び替え: ";
    html += '<a href="#" id="cng-sort-x-first">' + xLabel + "</a>";
    html += " | ";
    html += '<a href="#" id="cng-sort-d-first">' + dLabel + "</a>";
    html += "</div>";

    html += "<table><thead><tr>";
    html += "<th>QID</th>";
    html += "<th>記号</th>";
    html += "<th>ステータス</th>";
    html += "<th>種別</th>";
    html += "<th>対象</th>";
    html += "<th>最終更新</th>";
    html += "</tr></thead><tbody>";

    for (var row of list) {
      var detail = row.classification_detail;
      if (!detail && row.classification_code) {
        detail =
          row.classification_code === "A" ? "正解" :
          row.classification_code === "B" ? "解説" :
          row.classification_code === "C" ? "選択肢" :
          row.classification_code === "D" ? "問題" : "";
      }

      html += "<tr>";
      html += '<td class="cng-qid">' + row.qid + "</td>";
      html += "<td>" + row.status_mark + "</td>";
      html += "<td>" + row.status_label + "</td>";
      html += "<td>" + row.classification_code + "</td>";
      html += "<td>" + detail + "</td>";
      html += "<td>" + formatSavedAt(row.saved_at) + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
    html += '<div class="cng-footer">※ この一覧は /api/sync/state の内容を直接参照しています。</div>';

    return html;
  }

  // =========================
  // パネル描画
  // =========================

  function renderConsistencyNgPanel(list) {
    var panel = ensureConsistencyNgPanel();

    // 現在のソートモードに従って、表示用のリストを並び替える
    var sorted = getSortedListForRender(list);

    // 並び替え済みのリストと現在のソートモードを渡して HTML を生成する
    panel.innerHTML = buildConsistencyNgPanelHtml(sorted, cngSortMode);

    // 「×→△」「△→×」のトグルリンクにクリックイベントを付与する
    var sortX = panel.querySelector("#cng-sort-x-first");
    var sortD = panel.querySelector("#cng-sort-d-first");

    if (sortX) {
      sortX.addEventListener("click", function (e) {
        e.preventDefault();
        // ソートモードを「×優先」に変更してパネルを再描画する
        cngSortMode = "mark_x_first";
        renderConsistencyNgPanel(cngListCache);
      });
    }

    if (sortD) {
      sortD.addEventListener("click", function (e) {
        e.preventDefault();
        // ソートモードを「△優先」に変更してパネルを再描画する
        cngSortMode = "mark_delta_first";
        renderConsistencyNgPanel(cngListCache);
      });
    }
  }

  // =========================
  // トグル動作
  // =========================

  function toggleConsistencyNgPanel() {
    var panel = ensureConsistencyNgPanel();

    if (cngPanelVisible) {
      panel.style.display = "none";
      cngPanelVisible = false;
      return;
    }

    if (!cngListCache && !cngFetchError) {
      panel.innerHTML =
        "<h3>× / △ 整合性要対応問題リスト（SYNC）</h3>" +
        '<div class="cng-summary cng-empty">一覧データがまだ準備されていません。</div>';
      panel.style.display = "";
      cngPanelVisible = true;
      return;
    }

    if (cngFetchError) {
      panel.innerHTML =
        "<h3>× / △ 整合性要対応問題リスト（SYNC）</h3>" +
        '<div class="cng-summary cng-empty">SYNC取得中にエラーが発生しました。</div>';
      panel.style.display = "";
      cngPanelVisible = true;
      return;
    }

    renderConsistencyNgPanel(cngListCache);
    panel.style.display = "";
    cngPanelVisible = true;
  }

  // =========================
  // 初期化
  // =========================

  async function initConsistencyNgList() {
    injectConsistencyNgStyles();

    try {
      var list = await fetchConsistencyNgListFromSync();
      cngListCache = list;
      createOrUpdateToggleLink(list.length);
    } catch (e) {
      console.error("[consistency NG list] error:", e);
      cngFetchError = e;
      createOrUpdateToggleLink(0);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsistencyNgList);
  } else {
    initConsistencyNgList();
  }
})();