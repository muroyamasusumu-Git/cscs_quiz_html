// assets/b_log_overlay.js
(function () {
  "use strict";

  // 二重初期化防止
  if (window.CSCS_LOG_OVERLAY_INITIALIZED) return;
  window.CSCS_LOG_OVERLAY_INITIALIZED = true;

  function initOverlay() {
    var body = document.body;
    if (!body) return;

    // ---- オーバーレイ要素（CSS に任せる）----
    var overlay = document.getElementById("cscs-log-bg");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "cscs-log-bg";
      body.insertBefore(overlay, body.firstChild);
    }

    var inner = document.getElementById("cscs-log-bg-inner");
    if (!inner) {
      inner = document.createElement("div");
      inner.id = "cscs-log-bg-inner";
      overlay.appendChild(inner);
    }

    // ※ここでは overlay.style.xxx を一切しない
    //   すべて外側の CSS (#cscs-log-bg {...}) が担当する

    var MAX_LINES = 80;
    var lines = [];

    function updateText() {
      inner.textContent = lines.join("\n");
    }

    function appendLogLine(text) {
      lines.push(text);
      if (lines.length > MAX_LINES) {
        lines = lines.slice(lines.length - MAX_LINES);
      }
      updateText();
    }

    // ON/OFF
    var enabled = true;
    window.CSCS_LOG_OVERLAY_ENABLE = function (flag) {
      enabled = !!flag;
      overlay.style.display = enabled ? "block" : "none";
    };

    // ---- console.log フック ----
    var originalLog = console.log;
    console.log = function () {
      // 元ログ
      try { originalLog.apply(console, arguments); } catch (_) {}

      if (!enabled) return;

      // 全て文字列化
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (typeof arg === "string") parts.push(arg);
        else {
          try { parts.push(JSON.stringify(arg)); }
          catch (_) { parts.push(String(arg)); }
        }
      }
      appendLogLine(parts.join(" "));
    };

    appendLogLine("[B-LOG] overlay ready. all console.log captured.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOverlay);
  } else {
    initOverlay();
  }
})();