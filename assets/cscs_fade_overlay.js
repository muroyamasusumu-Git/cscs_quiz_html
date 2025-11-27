// assets/cscs_fade_overlay.js
(function () {
  "use strict";

  // ここだけいじれば全体の“クロスフェード感”を調整できる
  var FADE_DURATION_MS = 800;      // フェード時間
  var FADE_MAX_OPACITY = 0.7;      // どれくらい暗くするか
  var FADE_EASING = "ease-in-out"; // イージング
  var SESSION_KEY = "cscs_page_fade_pending";

  function getOrCreateFadeOverlay() {
    var overlay = document.getElementById("cscs-global-fade-overlay");
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "cscs-global-fade-overlay";
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.backgroundColor = "#000000";
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "9998";
    overlay.style.transition = "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);
    document.body.appendChild(overlay);
    return overlay;
  }

  // 画面を暗くしてから指定URLに遷移
  function fadeOutTo(nextUrl, reason) {
    if (!nextUrl) {
      return;
    }

    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "auto";
    overlay.style.transition = "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    // 少し遅らせてからフェード開始
    window.setTimeout(function () {
      overlay.style.opacity = String(FADE_MAX_OPACITY);
    }, 20);

    // フェード完了後にページ遷移
    window.setTimeout(function () {
      try {
        var payload = {
          reason: reason || "",
          timestamp: Date.now()
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      } catch (_e) {
      }
      location.href = nextUrl;
    }, FADE_DURATION_MS + 40);
  }

  // 遷移後のページで黒からフェードイン
  function runFadeInIfNeeded() {
    var needFade = false;
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        needFade = true;
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (_e) {
      needFade = false;
    }

    if (!needFade) {
      return;
    }

    var overlay = getOrCreateFadeOverlay();
    overlay.style.opacity = String(FADE_MAX_OPACITY);
    overlay.style.pointerEvents = "none";
    overlay.style.transition = "opacity " + String(FADE_DURATION_MS) + "ms " + String(FADE_EASING);

    window.setTimeout(function () {
      overlay.style.opacity = "0";
    }, 20);

    window.setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, FADE_DURATION_MS + 60);
  }

  // reload 用のヘルパー（今いるページをフェードアウトしつつ reload）
  function fadeReload(reason) {
    fadeOutTo(location.href, reason || "reload");
  }

  window.CSCS_FADE = {
    fadeOutTo: fadeOutTo,
    runFadeInIfNeeded: runFadeInIfNeeded,
    fadeReload: fadeReload
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    runFadeInIfNeeded();
  } else {
    document.addEventListener("DOMContentLoaded", runFadeInIfNeeded);
  }
})();