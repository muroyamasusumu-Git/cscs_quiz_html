(function () {
  "use strict";

  // Aパート自動遷移までの待ち時間（ミリ秒）
  var AUTO_ADVANCE_MS = 30000;
  var COUNTER_INTERVAL_MS = 1000; // カウントダウンの更新間隔（ミリ秒）

  // 現在のURLから「日付」「問題番号(NNN)」を取得
  function parseSlideInfo() {
    var path = String(location.pathname || "");
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_a(?:\.html)?$/);
    if (!m) {
      return null;
    }
    var day = m[1];           // "20250926"
    var num3 = m[2];          // "001"〜"030"
    var idx = parseInt(num3, 10);
    if (!idx || idx < 1 || idx > 999) {
      return null;
    }
    return {
      day: day,
      idx: idx
    };
  }

  // "YYYYMMDD" 文字列に dayOffset（日数）を加算して新しい "YYYYMMDD" を返す
  function addDaysToDayString(dayStr, dayOffset) {
    var y = parseInt(dayStr.slice(0, 4), 10);
    var m = parseInt(dayStr.slice(4, 6), 10);
    var d = parseInt(dayStr.slice(6, 8), 10);
    if (!y || !m || !d) {
      return null;
    }
    // UTC基準の日付計算（タイムゾーンの影響を受けにくいように）
    var date = new Date(Date.UTC(y, m - 1, d));
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }
    date.setUTCDate(date.getUTCDate() + dayOffset);
    var yy = date.getUTCFullYear();
    var mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(date.getUTCDate()).padStart(2, "0");
    return String(yy) + String(mm) + String(dd);
  }

  // 自動遷移先のURLを組み立てる
  function buildNextUrl() {
    var info = parseSlideInfo();
    if (!info) {
      return null;
    }

    var path = String(location.pathname || "");
    var day = info.day;
    var idx = info.idx;

    // 1〜29問目：同じ日付の次のAパートへ
    if (idx < 30) {
      var nextIdx = idx + 1;
      var nextNum3 = String(nextIdx).padStart(3, "0");
      // qNNN_a.html の NNN 部分だけ差し替え
      var nextPath = path.replace(/q\d{3}_a(?:\.html)?$/, "q" + nextNum3 + "_a.html");
      return nextPath;
    }

    // 30問目：翌日の 1問目 (q001_a.html) へ
    if (idx === 30) {
      var nextDay = addDaysToDayString(day, 1);
      if (!nextDay) {
        return null;
      }

      // "/.../_build_cscs_YYYYMMDD/slides/qNNN_a.html" の
      // "_build_cscs_YYYYMMDD/slides/qNNN_a.html" 以降を丸ごと置き換える
      var prefix = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_a(?:\.html)?$/, "");
      var nextPath2 = prefix + "_build_cscs_" + nextDay + "/slides/q001_a.html";
      return nextPath2;
    }

    // 想定外（31問目以降など）は何もしない
    return null;
  }

  // 画面右下あたりにカウンター用の要素を作る
  function createAutoNextCounterElement() {
    var existing = document.getElementById("auto-next-counter");
    if (existing) {
      return existing;
    }
    var div = document.createElement("div");
    div.id = "auto-next-counter";
    div.textContent = "";
    div.style.cssText =
      "position:fixed;" +
      "right:12px;" +
      "bottom:12px;" +
      "padding:6px 10px;" +
      "font-size:12px;" +
      "background:rgba(0,0,0,0.6);" +
      "color:#fff;" +
      "border-radius:12px;" +
      "z-index:9999;" +
      "pointer-events:none;";
    document.body.appendChild(div);
    return div;
  }

  // HEAD で存在確認してから遷移（404なら何もしない）
  function goNextIfExists(nextUrl) {
    if (!nextUrl) {
      return;
    }
    try {
      fetch(nextUrl, { method: "HEAD" }).then(function (res) {
        if (res && res.ok) {
          location.href = nextUrl;
        }
      }).catch(function (_err) {
        // 404 やネットワークエラー時は静かに何もしない
      });
    } catch (_e) {
      // fetch が使えないような環境では安全のため何もしない
    }
  }

  function scheduleAutoAdvance() {
    var nextUrl = buildNextUrl();
    if (!nextUrl) {
      return;
    }

    var startTime = Date.now();
    var endTime = startTime + AUTO_ADVANCE_MS;
    var counterEl = null;
    var counterTimerId = null;

    function updateCounter() {
      if (!counterEl) {
        counterEl = createAutoNextCounterElement();
      }
      var now = Date.now();
      var remainingMs = endTime - now;
      if (remainingMs <= 0) {
        counterEl.textContent = "まもなく次の問題へ移動します…";
        if (counterTimerId !== null) {
          window.clearInterval(counterTimerId);
          counterTimerId = null;
        }
        return;
      }
      var remainingSec = Math.ceil(remainingMs / 1000);
      counterEl.textContent = "次の問題まで " + remainingSec + " 秒";
    }

    // 最初に即時表示
    updateCounter();
    // 1秒ごとにカウントダウン更新
    counterTimerId = window.setInterval(updateCounter, COUNTER_INTERVAL_MS);

    // 一定時間後に実際の遷移を実行
    window.setTimeout(function () {
      if (counterTimerId !== null) {
        window.clearInterval(counterTimerId);
        counterTimerId = null;
      }
      goNextIfExists(nextUrl);
    }, AUTO_ADVANCE_MS);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    scheduleAutoAdvance();
  } else {
    document.addEventListener("DOMContentLoaded", scheduleAutoAdvance);
  }
})();