// assets/b_log_overlay.js
// Bパート用：console.log の一部を画面全体の“背景テキスト”として表示するデバッグ用オーバーレイ
(function () {
  "use strict";

  if (window.CSCS_LOG_OVERLAY_INITIALIZED) {
    return;
  }
  window.CSCS_LOG_OVERLAY_INITIALIZED = true;

  // ---- 背景オーバーレイ本体 ----
  var overlay = document.createElement("div");
  overlay.id = "cscs-log-bg";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.zIndex = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.whiteSpace = "pre-wrap";
  overlay.style.overflow = "hidden";
  overlay.style.padding = "40px";
  overlay.style.boxSizing = "border-box";
  // かなり薄くする（背景的な存在）
  overlay.style.opacity = "0.12";
  overlay.style.fontSize = "11px";
  overlay.style.fontFamily = "Menlo, Consolas, Monaco, monospace";
  overlay.style.lineHeight = "1.4";
  overlay.style.color = "#888888";

  // 背景に敷くテキストラッパ
  var inner = document.createElement("div");
  inner.id = "cscs-log-bg-inner";
  inner.style.width = "200%";          // 少し広げて全体に敷き詰める
  inner.style.height = "200%";
  inner.style.transform = "translate(-10%, -10%)";
  overlay.appendChild(inner);

  // body直下に追加（#root より背面になるよう z-index は 0 に固定）
  var body = document.body || document.getElementsByTagName("body")[0];
  if (body.firstChild) {
    body.insertBefore(overlay, body.firstChild);
  } else {
    body.appendChild(overlay);
  }

  // #root を前面に出す（build_quiz.py で id="root" ラップ済み想定）
  var root = document.getElementById("root");
  if (root) {
    if (!root.style.position) {
      root.style.position = "relative";
    }
    root.style.zIndex = "1";
  }

  // 全体テキストを溜める
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

  // ON/OFF 切り替え用フラグ
  var enabled = true;
  window.CSCS_LOG_OVERLAY_ENABLE = function (flag) {
    enabled = !!flag;
    overlay.style.display = enabled ? "block" : "none";
  };

  // console.log をフック
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

      // ★ここで「背景に出したいログ」だけをフィルタ
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