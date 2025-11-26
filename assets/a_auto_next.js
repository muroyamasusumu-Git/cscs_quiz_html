(function () {
  "use strict";

  // Aパート自動遷移までの待ち時間（ミリ秒）
  var AUTO_ADVANCE_MS = 30000;
  var COUNTER_INTERVAL_MS = 1000;

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

  function addDaysToDayString(dayStr, dayOffset) {
    var y = parseInt(dayStr.slice(0, 4), 10);
    var m = parseInt(dayStr.slice(4, 6), 10);
    var d = parseInt(dayStr.slice(6, 8), 10);
    if (!y || !m || !d) {
      return null;
    }
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
      var nextPath = path.replace(/q\d{3}_a(?:\.html)?$/, "q" + nextNum3 + "_a.html");
      return nextPath;
    }

    // 30問目：翌日の 1問目 (q001_a.html) へ
    if (idx === 30) {
      var nextDay = addDaysToDayString(day, 1);
      if (!nextDay) {
        return null;
      }
      var prefix = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_a(?:\.html)?$/, "");
      var nextPath2 = prefix + "_build_cscs_" + nextDay + "/slides/q001_a.html";
      return nextPath2;
    }

    // 想定外（31問目以降など）は何もしない
    return null;
  }

  // 左下カウンターの生成
  function createAutoNextCounterElement() {
    var existing = document.getElementById("auto-next-counter");
    if (existing) {
      return existing;
    }

    var div = document.createElement("div");
    div.id = "auto-next-counter";
    div.textContent = "";

    div.style.cssText =
      "position: fixed;" +
      "left: 140px;" +
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

  // 画面をふわっと暗転させてから遷移する
  function fadeOutAndNavigate(nextUrl) {
    if (!nextUrl) {
      return;
    }

    var overlay = document.getElementById("auto-next-fade-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "auto-next-fade-overlay";
      overlay.style.position = "fixed";
      overlay.style.left = "0";
      overlay.style.top = "0";
      overlay.style.right = "0";
      overlay.style.bottom = "0";
      overlay.style.backgroundColor = "#000000";
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "9998";
      overlay.style.transition = "opacity 300ms linear";
      document.body.appendChild(overlay);
    }

    // クリックなどを誤って拾わないようにする
    overlay.style.pointerEvents = "auto";

    // 少し遅らせてからフェード開始（レイアウト確定のため）
    window.setTimeout(function () {
      overlay.style.opacity = "1";
    }, 20);

    // フェード完了後にページ遷移
    window.setTimeout(function () {
      location.href = nextUrl;
    }, 340);
  }

  // HEAD で存在確認してからフェード遷移
  function goNextIfExists(nextUrl) {
    if (!nextUrl) {
      return;
    }
    try {
      fetch(nextUrl, { method: "HEAD" }).then(function (res) {
        if (res && res.ok) {
          fadeOutAndNavigate(nextUrl);
        }
      }).catch(function (_err) {
        // 404 やネットワークエラー時は静かに何もしない
      });
    } catch (_e) {
      // fetch が使えない環境では、そのまま遷移（最悪のときも真っ白フラッシュよりはマシ）
      fadeOutAndNavigate(nextUrl);
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
        counterEl.textContent = "まもなく次へ…";
        window.clearInterval(counterTimerId);
        counterTimerId = null;
        return;
      }

      var remainingSec = Math.ceil(remainingMs / 1000);
      counterEl.textContent = "次の問題まで " + remainingSec + " 秒";
    }

    // 初期表示
    updateCounter();
    // 1秒ごとにカウンタ更新
    counterTimerId = window.setInterval(updateCounter, COUNTER_INTERVAL_MS);

    // 一定時間後にフェード付きで次へ
    window.setTimeout(function () {
      if (counterTimerId) {
        window.clearInterval(counterTimerId);
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