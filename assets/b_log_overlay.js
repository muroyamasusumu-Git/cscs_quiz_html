// assets/b_log_overlay.js
// Bパート用：console.log の一部を画面右下に半透明で表示するデバッグ用オーバーレイ
(function () {
  "use strict";

  if (window.CSCS_LOG_OVERLAY_INITIALIZED) {
    return;
  }
  window.CSCS_LOG_OVERLAY_INITIALIZED = true;

  // ---- オーバーレイ本体 ----
  var overlay = document.createElement("div");
  overlay.id = "cscs-log-overlay";
  overlay.style.position = "fixed";
  overlay.style.right = "8px";
  overlay.style.bottom = "8px";
  overlay.style.width = "38vw";
  overlay.style.maxWidth = "480px";
  overlay.style.maxHeight = "35vh";
  overlay.style.overflow = "hidden";
  overlay.style.padding = "6px 8px";
  overlay.style.boxSizing = "border-box";
  overlay.style.background = "rgba(0, 0, 0, 0.4)";
  overlay.style.color = "#ffffff";
  overlay.style.fontSize = "10px";
  overlay.style.fontFamily = "Menlo, Consolas, Monaco, monospace";
  overlay.style.lineHeight = "1.4";
  overlay.style.borderRadius = "6px";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999";
  overlay.style.opacity = "0.65";
  overlay.style.backdropFilter = "blur(2px)";
  overlay.style.webkitBackdropFilter = "blur(2px)";
  overlay.style.boxShadow = "0 0 8px rgba(0,0,0,0.35)";

  var inner = document.createElement("div");
  inner.style.maxHeight = "100%";
  inner.style.overflowY = "auto";
  inner.style.paddingRight = "2px";
  overlay.appendChild(inner);

  document.body.appendChild(overlay);

  var MAX_LINES = 40;

  function appendLogLine(text) {
    var line = document.createElement("div");
    line.textContent = text;
    inner.appendChild(line);

    while (inner.childNodes.length > MAX_LINES) {
      inner.removeChild(inner.firstChild);
    }
    inner.scrollTop = inner.scrollHeight;
  }

  var enabled = true;
  window.CSCS_LOG_OVERLAY_ENABLE = function (flag) {
    enabled = !!flag;
    overlay.style.display = enabled ? "block" : "none";
  };

  var originalLog = console.log;

  console.log = function () {
    try {
      originalLog.apply(console, arguments);

      if (!enabled) {
        return;
      }

      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (typeof arg === "string") {
          parts.push(arg);
        } else {
          try {
            parts.push(JSON.stringify(arg));
          } catch (_e) {
            parts.push(String(arg));
          }
        }
      }
      var text = parts.join(" ");

      // ★ここで「画面に出したいログ」だけをフィルタする
      if (
        text.indexOf("[B:streak3/global]") === 0 ||
        text.indexOf("[B:streak3/q]") === 0 ||
        text.indexOf("[SYNC-B:streak3Today]") === 0
      ) {
        appendLogLine(text);
      }
    } catch (_e) {
      try {
        originalLog.apply(console, arguments);
      } catch (_e2) {}
    }
  };
})();