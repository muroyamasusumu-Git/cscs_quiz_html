(function () {
  "use strict";

  var AUTO_ADVANCE_MS = 30000;
  var COUNTER_INTERVAL_MS = 1000;

  function parseSlideInfo() {
    var path = String(location.pathname || "");
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_a(?:\.html)?$/);
    if (!m) return null;
    var day = m[1];
    var num3 = m[2];
    var idx = parseInt(num3, 10);
    if (!idx || idx < 1 || idx > 999) return null;
    return { day: day, idx: idx };
  }

  function addDaysToDayString(dayStr, dayOffset) {
    var y = parseInt(dayStr.slice(0, 4), 10);
    var m = parseInt(dayStr.slice(4, 6), 10);
    var d = parseInt(dayStr.slice(6, 8), 10);
    if (!y || !m || !d) return null;
    var date = new Date(Date.UTC(y, m - 1, d));
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + dayOffset);
    var yy = date.getUTCFullYear();
    var mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(date.getUTCDate()).padStart(2, "0");
    return String(yy) + String(mm) + String(dd);
  }

  function buildNextUrl() {
    var info = parseSlideInfo();
    if (!info) return null;

    var path = String(location.pathname || "");
    var day = info.day;
    var idx = info.idx;

    if (idx < 30) {
      var nextIdx = idx + 1;
      var nextNum3 = String(nextIdx).padStart(3, "0");
      return path.replace(/q\d{3}_a(?:\.html)?$/, "q" + nextNum3 + "_a.html");
    }

    if (idx === 30) {
      var nextDay = addDaysToDayString(day, 1);
      if (!nextDay) return null;
      var prefix = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_a(?:\.html)?$/, "");
      return prefix + "_build_cscs_" + nextDay + "/slides/q001_a.html";
    }

    return null;
  }

  function createAutoNextCounterElement() {
    var existing = document.getElementById("auto-next-counter");
    if (existing) return existing;

    var div = document.createElement("div");
    div.id = "auto-next-counter";
    div.textContent = "";

    // ★ ユーザー指定のスタイルをそのまま反映 ★
    div.style.cssText =
      "position: fixed;" +
      "left: 146px;" +
      "bottom: 16px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: #fff;" +          // ← ★白文字
      "z-index: 9999;" +
      "pointer-events: none;" +
      "font-weight: 300;";

    document.body.appendChild(div);
    return div;
  }

  function goNextIfExists(nextUrl) {
    if (!nextUrl) return;
    try {
      fetch(nextUrl, { method: "HEAD" }).then(function (res) {
        if (res && res.ok) location.href = nextUrl;
      }).catch(function () {});
    } catch (_e) {}
  }

  function scheduleAutoAdvance() {
    var nextUrl = buildNextUrl();
    if (!nextUrl) return;

    var startTime = Date.now();
    var endTime = startTime + AUTO_ADVANCE_MS;
    var counterEl = null;
    var counterTimerId = null;

    function updateCounter() {
      if (!counterEl) counterEl = createAutoNextCounterElement();
      var now = Date.now();
      var remainingMs = endTime - now;

      if (remainingMs <= 0) {
        counterEl.textContent = "まもなく次へ…";
        window.clearInterval(counterTimerId);
        counterTimerId = null;
        return;
      }

      var remainingSec = Math.ceil(remainingMs / 1000);
      counterEl.textContent = "次の問題まで " + remainingSec + " 秒";
    }

    updateCounter();
    counterTimerId = window.setInterval(updateCounter, COUNTER_INTERVAL_MS);

    window.setTimeout(function () {
      if (counterTimerId) window.clearInterval(counterTimerId);
      goNextIfExists(nextUrl);
    }, AUTO_ADVANCE_MS);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    scheduleAutoAdvance();
  } else {
    document.addEventListener("DOMContentLoaded", scheduleAutoAdvance);
  }
})();