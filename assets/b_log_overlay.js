// assets/b_log_overlay.js
(function () {
  "use strict";

  if (window.CSCS_LOG_OVERLAY_INITIALIZED) {
    return;
  }
  window.CSCS_LOG_OVERLAY_INITIALIZED = true;

  // body が確実に存在してから初期化する
    // ---- 背景オーバーレイ本体 ----
    var overlay = document.createElement("div");
    overlay.id = "cscs-log-bg";

    overlay.style.position = "fixed";
    overlay.style.top = "580px";      // ★ 位置：下寄り
    overlay.style.left = "20px";      // ★ 左20px
    overlay.style.width = "66%";      // ★ 幅66%
    overlay.style.height = "190px";   // ★ 高さ190px

    overlay.style.zIndex = "9999";    // ★ 最前面
    overlay.style.pointerEvents = "none";

    // レイアウト（中央寄せだが text は左寄せ）
    overlay.style.display = "flex";
    overlay.style.justifyContent = "center";
    overlay.style.textAlign = "left";
    overlay.style.whiteSpace = "pre-wrap";

    overlay.style.overflow = "hidden";
    overlay.style.boxSizing = "border-box";

    // 視認性
    overlay.style.opacity = "0.16";
    overlay.style.fontSize = "11px";
    overlay.style.fontFamily = "Menlo, Consolas, Monaco, monospace";
    overlay.style.lineHeight = "2.0";
    overlay.style.color = "rgb(255,255,255)";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";

    // === inner ===
    var inner = document.createElement("div");
    inner.id = "cscs-log-bg-inner";

    // inner は幅100%でOK
    inner.style.maxWidth = "100%";

    overlay.appendChild(inner);

    // ★ 中央の大きめボックス
    inner.style.maxWidth = "80%";
    inner.style.maxHeight = "80%";
    inner.style.margin = "0 auto";
    inner.style.overflow = "auto";
    inner.style.transform = "none";

    overlay.appendChild(inner);

    var body = document.body;
    body.insertBefore(overlay, body.firstChild);

    var root = document.getElementById("root");
    if (root) {
      if (!root.style.position) {
        root.style.position = "relative";
      }
      root.style.zIndex = "1";
    }

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

    // console.log フック
    var originalLog = console.log;
    console.log = function () {
      try {
        // 元のログはそのままコンソールにも出す
        originalLog.apply(console, arguments);

        if (!enabled) return;

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

        // ★いったん全ての console.log をオーバーレイに流す
        appendLogLine(text);
      } catch (_e) {
        try { originalLog.apply(console, arguments); } catch (_e2) {}
      }
    };

    // ★ページ遷移直後にも背景に文字を出す
    appendLogLine("[B-LOG] overlay ready. streak logs will appear here.");
  }

  // すでに body がある → 即実行
  if (document.body) {
    initOverlay();
  } else {
    // まだ body が無い → DOMContentLoaded 待ち
    document.addEventListener("DOMContentLoaded", initOverlay);
  }
})();