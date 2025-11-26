(function () {
  "use strict";

  // Aパート自動遷移までの待ち時間（ミリ秒）
  var AUTO_ADVANCE_MS = 30000;
  var COUNTER_INTERVAL_MS = 1000;
  var AUTO_ENABLED_KEY = "cscs_auto_next_enabled";

  // グローバル状態
  var autoEnabled = loadAutoAdvanceEnabled();
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
    "left: 265px;"+
    "bottom: 16px;"+
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

  // フェード用オーバーレイ生成（共通）
  function getOrCreateFadeOverlay() {
    var overlay = document.getElementById("auto-next-fade-overlay");
    if (overlay) {
      return overlay;
    }
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
    return overlay;
  }

  // 画面をふわっと暗転させてから遷移する（フェードアウト側）
  function fadeOutAndNavigate(nextUrl) {
    if (!nextUrl) {
      return;
    }

    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "auto";
    overlay.style.transition = "opacity 300ms linear";

    // 少し遅らせてからフェード開始（レイアウト確定のため）
    window.setTimeout(function () {
      overlay.style.opacity = "1";
    }, 20);

    // フェード完了後にページ遷移
    window.setTimeout(function () {
      try {
        sessionStorage.setItem("cscs_auto_next_fade", "1");
      } catch (_e) {
        // sessionStorage が使えない場合は何もしない
      }
      location.href = nextUrl;
    }, 340);
  }

  // 遷移後のページで、黒からフェードインする
  function runFadeInIfNeeded() {
    var needFade = false;
    try {
      if (sessionStorage.getItem("cscs_auto_next_fade") === "1") {
        needFade = true;
        sessionStorage.removeItem("cscs_auto_next_fade");
      }
    } catch (_e) {
      needFade = false;
    }

    if (!needFade) {
      return;
    }

    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "none";
    overlay.style.transition = "opacity 400ms linear";

    // 少し遅らせてからフェードイン開始
    window.setTimeout(function () {
      overlay.style.opacity = "0";
    }, 20);

    // 完全に透明になったあとでDOMから取り除く（任意）
    window.setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 450);
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
    // 必要ならフェードイン
    runFadeInIfNeeded();

    // 次URL決定
    NEXT_URL = buildNextUrl();
    if (!NEXT_URL) {
      return;
    }

    // トグルボタン生成
    createAutoNextToggleButton();

    // 自動送りの状態に応じて挙動
    if (autoEnabled) {
      startAutoAdvanceCountdown();
    } else {
      cancelAutoAdvanceCountdown(true);
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    onReady();
  } else {
    document.addEventListener("DOMContentLoaded", onReady);
  }
})();