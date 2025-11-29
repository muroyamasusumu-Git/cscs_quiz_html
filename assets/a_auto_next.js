(function () {
  "use strict";

  // Aパート自動遷移までの待ち時間（ミリ秒）
  var AUTO_ADVANCE_MS_CANDIDATES = [20000, 30000, 60000];
  var AUTO_ADVANCE_MS_KEY = "cscs_auto_next_ms";
  var AUTO_ADVANCE_MS = loadAutoAdvanceMs();
  var COUNTER_INTERVAL_MS = 1000;
  var AUTO_ENABLED_KEY = "cscs_auto_next_enabled";
  var RANDOM_MODE_KEY = "cscs_auto_next_random_enabled";
  var RANDOM_MIN_DAY = "20250926";
  var RANDOM_MAX_DAY = "20251224";

  // グローバル状態
  var autoEnabled = loadAutoAdvanceEnabled();
  var randomModeEnabled = loadRandomModeEnabled();
  var NEXT_URL = null;
  var counterEl = null;
  var counterTimerId = null;
  var autoTimeoutId = null;
  var startTime = 0;
  var endTime = 0;

  function loadAutoAdvanceEnabled() {
    try {
      var v = localStorage.getItem(AUTO_ENABLED_KEY);
      if (v === null) {
        return true; // デフォルトは ON
      }
      return v === "1";
    } catch (_e) {
      return true;
    }
  }

  function saveAutoAdvanceEnabled(flag) {
    try {
      localStorage.setItem(AUTO_ENABLED_KEY, flag ? "1" : "0");
    } catch (_e) {
      // 失敗しても無視
    }
  }

  function loadRandomModeEnabled() {
    try {
      var v = localStorage.getItem(RANDOM_MODE_KEY);
      if (v === null) {
        return false; // デフォルトは「順番モード」
      }
      return v === "1";
    } catch (_e) {
      return false;
    }
  }

  function saveRandomModeEnabled(flag) {
    try {
      localStorage.setItem(RANDOM_MODE_KEY, flag ? "1" : "0");
    } catch (_e) {
      // 失敗しても無視
    }
  }

  function loadAutoAdvanceMs() {
    try {
      var v = localStorage.getItem(AUTO_ADVANCE_MS_KEY);
      var ms = parseInt(v, 10);
      if (!ms || ms <= 0) {
        return AUTO_ADVANCE_MS_CANDIDATES[0];
      }
      for (var i = 0; i < AUTO_ADVANCE_MS_CANDIDATES.length; i++) {
        if (AUTO_ADVANCE_MS_CANDIDATES[i] === ms) {
          return ms;
        }
      }
      return AUTO_ADVANCE_MS_CANDIDATES[0];
    } catch (_e) {
      return AUTO_ADVANCE_MS_CANDIDATES[0];
    }
  }

  function saveAutoAdvanceMs(ms) {
    try {
      localStorage.setItem(AUTO_ADVANCE_MS_KEY, String(ms));
    } catch (_e) {
      // 失敗しても無視
    }
  }

  function getCurrentDurationIndex() {
    for (var i = 0; i < AUTO_ADVANCE_MS_CANDIDATES.length; i++) {
      if (AUTO_ADVANCE_MS_CANDIDATES[i] === AUTO_ADVANCE_MS) {
        return i;
      }
    }
    return 0;
  }

  function getNextDurationValue() {
    var idx = getCurrentDurationIndex();
    var nextIdx = idx + 1;
    if (nextIdx >= AUTO_ADVANCE_MS_CANDIDATES.length) {
      nextIdx = 0;
    }
    return AUTO_ADVANCE_MS_CANDIDATES[nextIdx];
  }

  function parseSlideInfo() {
    var path = String(location.pathname || "");
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_([ab])(?:\.html)?$/);
    if (!m) {
      return null;
    }
    var day = m[1];           // "20250926"
    var num3 = m[2];          // "001"〜"030"
    var idx = parseInt(num3, 10);
    var part = m[3];          // "a" または "b"
    if (!idx || idx < 1 || idx > 999) {
      return null;
    }
    return {
      day: day,
      idx: idx,
      part: part
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

  function dayStringToDate(dayStr) {
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
    return date;
  }

  function getRandomDayStringBetween(minDayStr, maxDayStr) {
    var minDate = dayStringToDate(minDayStr);
    var maxDate = dayStringToDate(maxDayStr);
    if (!minDate || !maxDate) {
      return null;
    }
    var minTime = minDate.getTime();
    var maxTime = maxDate.getTime();
    if (maxTime < minTime) {
      var tmp = minTime;
      minTime = maxTime;
      maxTime = tmp;
    }
    var diffMs = maxTime - minTime;
    var diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    var offset = 0;
    if (diffDays > 0) {
      offset = Math.floor(Math.random() * (diffDays + 1));
    }
    var randDate = new Date(minTime);
    randDate.setUTCDate(randDate.getUTCDate() + offset);
    var yy = randDate.getUTCFullYear();
    var mm = String(randDate.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(randDate.getUTCDate()).padStart(2, "0");
    return String(yy) + String(mm) + String(dd);
  }

  function buildNextUrl() {
    var info = parseSlideInfo();
    if (!info) {
      return null;
    }

    if (randomModeEnabled) {
      return buildRandomNextUrl(info);
    } else {
      return buildSequentialNextUrl(info);
    }
  }

  function buildSequentialNextUrl(info) {
    var path = String(location.pathname || "");
    var day = info.day;
    var idx = info.idx;
    var part = info.part || "a";

    if (part === "a") {
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

    if (part === "b") {
      // Bパート：次の問題のAパートへ
      if (idx < 30) {
        var nextIdxB = idx + 1;
        var nextNum3B = String(nextIdxB).padStart(3, "0");
        var nextPathB = path.replace(/q\d{3}_b(?:\.html)?$/, "q" + nextNum3B + "_a.html");
        return nextPathB;
      }

      // 30問目のB：翌日の 1問目Aへ
      if (idx === 30) {
        var nextDayB = addDaysToDayString(day, 1);
        if (!nextDayB) {
          return null;
        }
        var prefixB = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_b(?:\.html)?$/, "");
        var nextPath2B = prefixB + "_build_cscs_" + nextDayB + "/slides/q001_a.html";
        return nextPath2B;
      }

      // 想定外（31問目以降など）は何もしない
      return null;
    }

    // 想定外（part が a/b 以外など）は何もしない
    return null;
  }

  function buildRandomNextUrl(info) {
    var path = String(location.pathname || "");
    var prefixMatch = path.match(/^(.*)_build_cscs_\d{8}\/slides\/q\d{3}_[ab](?:\.html)?$/);
    var prefix = prefixMatch ? prefixMatch[1] : "";
    var currentPath = path;
    var candidatePath = currentPath;
    var safety = 0;

    while (candidatePath === currentPath && safety < 100) {
      var randDay = getRandomDayStringBetween(RANDOM_MIN_DAY, RANDOM_MAX_DAY);
      if (!randDay) {
        break;
      }
      var randIdx = Math.floor(Math.random() * 30) + 1;
      var randNum3 = String(randIdx).padStart(3, "0");
      candidatePath = prefix + "_build_cscs_" + randDay + "/slides/q" + randNum3 + "_a.html";
      safety++;
    }

    if (candidatePath === currentPath) {
      return null;
    }
    return candidatePath;
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
      "left: 140px;" +          // ★ 指定どおり
      "bottom: 16px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: #fff;" +         // 白文字
      "z-index: 9999;" +
      "pointer-events: none;" +
      "font-weight: 300;";

    document.body.appendChild(div);
    return div;
  }

  // 自動送り ON/OFF トグルボタン
  function createAutoNextToggleButton() {
    var btn = document.getElementById("auto-next-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-toggle";
    btn.type = "button";
    btn.textContent = autoEnabled ? "[自動送りON]" : "[自動送りOFF]";
    btn.style.cssText =
    "position: fixed;"+
    "left: 260px;"+
    "bottom: 14px;"+
    "padding: 6px 10px;"+
    "font-size: 13px;"+
    "color: rgb(150, 150, 150);"+
    "border-radius: 0px;"+
    "z-index: 10000;"+
    "cursor: pointer;"+
    "background: none;"+
    "border: none;";

    btn.addEventListener("click", function () {
      autoEnabled = !autoEnabled;
      saveAutoAdvanceEnabled(autoEnabled);
      btn.textContent = autoEnabled ? "[自動送りON]" : "[自動送りOFF]";

      if (autoEnabled) {
        startAutoAdvanceCountdown();
      } else {
        cancelAutoAdvanceCountdown(true);
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // ランダムモード トグルボタン
  function createAutoNextModeToggleButton() {
    var btn = document.getElementById("auto-next-mode-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-mode-toggle";
    btn.type = "button";
    btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番]";
    btn.style.cssText =
    "position: fixed;"+
    "left: 350px;"+
    "bottom: 14px;"+
    "padding: 6px 10px;"+
    "font-size: 13px;"+
    "color: rgb(150, 150, 150);"+
    "border-radius: 0px;"+
    "z-index: 10000;"+
    "cursor: pointer;"+
    "background: none;"+
    "border: none;";

    btn.addEventListener("click", function () {
      randomModeEnabled = !randomModeEnabled;
      saveRandomModeEnabled(randomModeEnabled);
      btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番]";

      cancelAutoAdvanceCountdown(false);

      if (autoEnabled) {
        NEXT_URL = buildNextUrl();
        if (NEXT_URL) {
          startAutoAdvanceCountdown();
        } else {
          cancelAutoAdvanceCountdown(true);
        }
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // 自動送り時間 切り替えボタン
  function createAutoNextDurationButton() {
    var btn = document.getElementById("auto-next-duration-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-duration-toggle";
    btn.type = "button";
    var sec = Math.round(AUTO_ADVANCE_MS / 1000);
    btn.textContent = "[" + sec + "秒]";
    btn.style.cssText =
    "position: fixed;"+
    "left: 416px;"+
    "bottom: 14px;"+
    "padding: 6px 10px;"+
    "font-size: 13px;"+
    "color: rgb(150, 150, 150);"+
    "border-radius: 0px;"+
    "z-index: 10000;"+
    "cursor: pointer;"+
    "background: none;"+
    "border: none;";

    btn.addEventListener("click", function () {
      var nextMs = getNextDurationValue();
      AUTO_ADVANCE_MS = nextMs;
      saveAutoAdvanceMs(AUTO_ADVANCE_MS);
      var secNow = Math.round(AUTO_ADVANCE_MS / 1000);
      btn.textContent = "[" + secNow + "秒]";
      if (autoEnabled) {
        startAutoAdvanceCountdown();
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // フェードアウトしてから遷移する（共通フェードモジュール連携）
  function fadeOutAndNavigate(nextUrl) {
    if (!nextUrl) {
      return;
    }
    if (window.CSCS_NAV_LIST && typeof window.CSCS_NAV_LIST.fadeOut === "function") {
      try {
        window.CSCS_NAV_LIST.fadeOut();
      } catch (_e) {}
    }
    if (window.CSCS_FADE && typeof window.CSCS_FADE.fadeOutTo === "function") {
      window.CSCS_FADE.fadeOutTo(nextUrl, "a_auto_next");
    } else {
      location.href = nextUrl;
    }
  }

  // 遷移後のページで必要ならフェードイン（共通フェードモジュール連携）
  function runFadeInIfNeeded() {
    if (window.CSCS_FADE && typeof window.CSCS_FADE.runFadeInIfNeeded === "function") {
      window.CSCS_FADE.runFadeInIfNeeded("a_auto_next");
    }
    if (window.CSCS_NAV_LIST && typeof window.CSCS_NAV_LIST.fadeIn === "function") {
      try {
        window.CSCS_NAV_LIST.fadeIn();
      } catch (_e) {}
    }
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
      // fetch が使えない環境では、そのまま遷移
      fadeOutAndNavigate(nextUrl);
    }
  }

  function cancelAutoAdvanceCountdown(updateText) {
    if (counterTimerId) {
      window.clearInterval(counterTimerId);
      counterTimerId = null;
    }
    if (autoTimeoutId) {
      window.clearTimeout(autoTimeoutId);
      autoTimeoutId = null;
    }
    if (updateText) {
      if (!counterEl) {
        counterEl = createAutoNextCounterElement();
      }
      counterEl.textContent = "自動送りは OFF です";
    }
  }

  function startAutoAdvanceCountdown() {
    cancelAutoAdvanceCountdown(false);

    NEXT_URL = buildNextUrl();

    if (!NEXT_URL) {
      return;
    }

    if (!autoEnabled) {
      if (!counterEl) {
        counterEl = createAutoNextCounterElement();
      }
      counterEl.textContent = "自動送りは OFF です";
      return;
    }

    startTime = Date.now();
    endTime = startTime + AUTO_ADVANCE_MS;
    if (!counterEl) {
      counterEl = createAutoNextCounterElement();
    }

    function updateCounter() {
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
    autoTimeoutId = window.setTimeout(function () {
      if (counterTimerId) {
        window.clearInterval(counterTimerId);
        counterTimerId = null;
      }
      goNextIfExists(NEXT_URL);
    }, AUTO_ADVANCE_MS);
  }

  function onReady() {
    // 次URL決定
    NEXT_URL = buildNextUrl();
    if (!NEXT_URL) {
      runFadeInIfNeeded();
      return;
    }

    // トグルボタン生成
    createAutoNextToggleButton();
    createAutoNextModeToggleButton();
    createAutoNextDurationButton();

    // 自動送りの状態に応じて挙動
    if (autoEnabled) {
      startAutoAdvanceCountdown();
    } else {
      cancelAutoAdvanceCountdown(true);
    }

    runFadeInIfNeeded();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    onReady();
  } else {
    document.addEventListener("DOMContentLoaded", onReady);
  }
})();