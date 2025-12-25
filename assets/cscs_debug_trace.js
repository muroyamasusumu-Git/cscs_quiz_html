// assets/cscs_debug_trace.js
(function () {
  "use strict";
  // ============================================================================
  // CSCS Debug Trace (Resident, sessionStorage-backed)
  //
  // 目的:
  //   - console.* を “強制テキスト化(JSON化)” して蓄積する（Safariの Object 展開欠落対策）
  //   - 「ヘッダ3行（URL / Action / Reset）」をログ出力に必ず含めて、共有しやすくする
  //   - /api/sync/state のレスポンス本文（生文字）を自動で採取し、ログへ追記する
  //   - リロード・A→B遷移などが起きても、同一タブ内ならログを保持する（sessionStorage）
  //
  // 重要な性質:
  //   - デフォルトでは “トレースOFF”（enabled=false）で、ログは収集しない
  //   - “この JS が読み込まれた後” のログのみ収集できる（過去ログは回収不可）
  //   - sessionStorage は「同一タブ内」で保持される
  //     → タブを閉じると消える（デバッグ向け）
  //   - STOP は「コピー → トレース停止」のみ（ログは保持する）
  //
  // 操作API（コンソールから使える）:
  //   - window.__CSCS_TRACE__.start()            : トレース開始＋バッファクリア（保存ログも消す）
  //   - window.__CSCS_TRACE__.stop()             : トレース停止＋ログをコピー（コピー後もログは保持）
  //   - window.__CSCS_TRACE__.setAction("...")   : ヘッダ Action を更新
  //   - window.__CSCS_TRACE__.setReset("...")    : ヘッダ Reset を更新
  //   - window.__CSCS_TRACE__.refreshUrl()       : ヘッダ URL を現URLへ更新
  //   - window.__CSCS_TRACE__.exportText()       : 送信用テキスト生成（返り値=文字列）
  //   - window.__CSCS_TRACE__.copy()             : exportText() をクリップボードへ（トレース状態は変えない）
  //   - window.__CSCS_TRACE__.download()         : txt ダウンロード（ブラウザ許可が必要な場合あり）
  //   - window.__CSCS_TRACE__.clearStored()      : 保存されているログだけを “無言で” クリア（enabledは変えない）
  //   - window.__CSCS_TRACE__.clear()            : 保存ログをクリア＋通知（通知はバッファに残さない）
  //   - window.__CSCS_TRACE__.status()           : 現在の統計（行数等）
  //
  // ============================================================================
  // 二重初期化防止（同一ページで二度読み込まれてもフックが重ならない）
  if (window.__CSCS_TRACE__ && window.__CSCS_TRACE__.installed) {
    return;
  }

  // -----------------------------
  // 設定
  // -----------------------------
  var STORAGE_KEY = "__CSCS_TRACE_BUFFER__";
  var HEADER_KEY = "__CSCS_TRACE_HEADER__";

  // 取りすぎると重いので上限（必要なら増やせる）
  var MAX_LINES = 20000;

  // stateレスポンス採取対象
  var CAPTURE_STATE_PATH = "/api/sync/state";

  // -----------------------------
  // ユーティリティ
  // -----------------------------
  function nowISO() {
    return new Date().toISOString();
  }

  function safeJsonParse(raw) {
    try {
      return { ok: true, json: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function loadHeader() {
    try {
      var raw = sessionStorage.getItem(HEADER_KEY);
      if (!raw) {
        return {
          url: location.href,
          action: "",
          reset: ""
        };
      }
      var parsed = safeJsonParse(raw);
      if (!parsed.ok || !parsed.json || typeof parsed.json !== "object") {
        return {
          url: location.href,
          action: "",
          reset: ""
        };
      }
      var h = parsed.json;
      return {
        url: typeof h.url === "string" ? h.url : location.href,
        action: typeof h.action === "string" ? h.action : "",
        reset: typeof h.reset === "string" ? h.reset : ""
      };
    } catch (e2) {
      return {
        url: location.href,
        action: "",
        reset: ""
      };
    }
  }

  function saveHeader(h) {
    try {
      sessionStorage.setItem(HEADER_KEY, JSON.stringify(h));
    } catch (e) {
      // 失敗しても動作継続（ログ収集は可能）
    }
  }

  function loadLines() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = safeJsonParse(raw);
      if (!parsed.ok || !Array.isArray(parsed.json)) return [];
      return parsed.json;
    } catch (e) {
      return [];
    }
  }

  function saveLines(lines) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch (e) {
      // 容量超過などでも落とさない
    }
  }

  function trimLines(lines) {
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES);
    }
  }

  function safeStringify(obj) {
    var seen = new WeakSet();
    try {
      return JSON.stringify(obj, function (k, v) {
        if (typeof v === "bigint") return String(v) + "n";
        if (typeof v === "function") return "[Function]";
        if (v && typeof v === "object") {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      });
    } catch (e) {
      try {
        return String(obj);
      } catch (e2) {
        return "[Unstringifiable]";
      }
    }
  }

  function normalizeArg(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";

    var t = typeof v;
    if (t === "string") return v;
    if (t === "number" || t === "boolean") return String(v);
    if (t === "bigint") return String(v) + "n";
    if (t === "function") return "[Function]";

    if (v instanceof Error) {
      return v.stack ? v.stack : (v.name + ": " + v.message);
    }

    // window/document など巨大オブジェクトは短縮
    try {
      if (typeof Window !== "undefined" && v === window) return "[Window]";
      if (typeof Document !== "undefined" && v === document) return "[Document]";
    } catch (e0) {}

    return safeStringify(v);
  }

  function joinArgs(argsLike) {
    var arr = Array.prototype.slice.call(argsLike);
    return arr.map(normalizeArg).join(" ");
  }

  function pushLine(lines, line) {
    if (!enabled) return;
    lines.push(line);
    trimLines(lines);
    saveLines(lines);
  }

  function headerText(h) {
    return [
      "URL: " + h.url,
      "Action: " + (h.action || "(not set)"),
      "Reset: " + (h.reset || "(not set)")
    ].join("\n");
  }

  async function copyToClipboard(text) {
    // Safari Web Inspector に copy() がある場合は最優先
    if (typeof copy === "function") {
      copy(text);
      return true;
    }
    // Clipboard API fallback（環境/権限で失敗することがある）
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function downloadTextFile(filename, text) {
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      return false;
    }
  }

  // -----------------------------
  // 状態
  // -----------------------------
  var enabled = false;
  var header = loadHeader();
  var lines = loadLines();

  // 読み込み時点で URL は最新へ更新しておく（遷移後も追いやすい）
  header.url = location.href;
  saveHeader(header);

  // -----------------------------
  // console フック（常駐）
  // -----------------------------
  var origConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  function makeConsoleHook(level) {
    return function () {
      var msg = joinArgs(arguments);
      pushLine(lines, "[" + nowISO() + "][" + level.toUpperCase() + "] " + msg);
      return origConsole[level].apply(console, arguments);
    };
  }

  console.log = makeConsoleHook("log");
  console.warn = makeConsoleHook("warn");
  console.error = makeConsoleHook("error");
  console.debug = makeConsoleHook("debug");

  // window.onerror も取る（アプリが落ちる系の検証で助かる）
  var origOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    var errText = "";
    if (error && error.stack) errText = error.stack;
    else if (error) errText = String(error);
    else errText = "";

    pushLine(
      lines,
      "[" + nowISO() + "][WINDOW_ONERROR] " +
        normalizeArg(message) + " | " +
        normalizeArg(source) + ":" + normalizeArg(lineno) + ":" + normalizeArg(colno) +
        (errText ? " | " + errText : "")
    );

    if (typeof origOnError === "function") {
      try {
        return origOnError.apply(this, arguments);
      } catch (e) {
        return false;
      }
    }
    return false;
  };

  // unhandledrejection も取る（async/fetch 失敗で出ることがある）
  var unhandledHandler = function (ev) {
    try {
      var reason = ev && ev.reason ? ev.reason : "(no reason)";
      pushLine(lines, "[" + nowISO() + "][UNHANDLED_REJECTION] " + normalizeArg(reason));
    } catch (e) {
      pushLine(lines, "[" + nowISO() + "][UNHANDLED_REJECTION] (failed to serialize)");
    }
  };
  window.addEventListener("unhandledrejection", unhandledHandler);

  // -----------------------------
  // fetch フック（/api/sync/state の “生本文” を採取）
  // -----------------------------
  var origFetch = window.fetch;

  if (typeof origFetch === "function") {
    window.fetch = async function (input, init) {
      var url = "";
      try {
        if (typeof input === "string") url = input;
        else if (input && typeof input.url === "string") url = input.url;
      } catch (e0) {
        url = "";
      }

      var res = await origFetch.apply(this, arguments);

      // /api/sync/state だけを対象にする（誤爆を避ける）
      try {
        var u = url ? new URL(url, location.origin) : null;
        if (u && u.origin === location.origin && u.pathname === CAPTURE_STATE_PATH) {
          var clone = res.clone();
          var bodyText = "";
          try {
            bodyText = await clone.text();
          } catch (eText) {
            bodyText = "[Failed to read response body]";
          }

          pushLine(lines, "[" + nowISO() + "][STATE_RAW] GET " + u.pathname + " -> " + res.status + " " + res.statusText);

          pushLine(
            lines,
            "[" + nowISO() + "][STATE_RAW_HEADERS] " + safeStringify({
              "content-type": res.headers.get("content-type"),
              "x-cscs-isemptytemplate": res.headers.get("x-cscs-isemptytemplate"),
              "x-cscs-reset": res.headers.get("x-cscs-reset")
            })
          );

          // 生本文は長くなりがちなので、行としてはそのまま残す（共有用）
          pushLine(lines, "[" + nowISO() + "][STATE_RAW_BODY] " + bodyText);
        }
      } catch (e2) {
        pushLine(lines, "[" + nowISO() + "][TRACE_WARN] state capture failed: " + normalizeArg(e2 && e2.message ? e2.message : e2));
      }

      return res;
    };
  }

  // -----------------------------
  // 公開API
  // -----------------------------
  window.__CSCS_TRACE__ = {
    installed: true,

    start: function () {
      enabled = true;

      header.url = location.href;
      saveHeader(header);

      console.log("[CSCS][TRACE] START (enabled=true)");
      return true;
    },

    stop: async function () {
      // ① まず「完全なスナップショット」を作る（以後 lines を触らない）
      var snapshot = this.exportText();

      // ② スナップショットをコピー（非同期完了を必ず待つ）
      var ok = await copyToClipboard(snapshot);

      // ③ コピー完了後にトレース停止のみ（ログは保持）
      enabled = false;

      console.log(
        "[CSCS][TRACE] STOP (copied=" +
          (ok ? "YES" : "NO") +
          ", enabled=false, buffer kept)"
      );

      return ok;
    },

    setAction: function (s) {
      header.action = String(s || "");
      saveHeader(header);
      pushLine(lines, "[" + nowISO() + "][TRACE] header Action set: " + header.action);
    },

    setReset: function (s) {
      header.reset = String(s || "");
      saveHeader(header);
      pushLine(lines, "[" + nowISO() + "][TRACE] header Reset set: " + header.reset);
    },

    refreshUrl: function () {
      header.url = location.href;
      saveHeader(header);
      pushLine(lines, "[" + nowISO() + "][TRACE] header URL refreshed: " + header.url);
    },

    exportText: function () {
      // export時は header.url を最新へ寄せる（共有時にズレないように）
      header.url = location.href;
      saveHeader(header);
      return headerText(header) + "\n\n" + lines.join("\n");
    },

    copy: async function () {
      var text = this.exportText();
      var ok = await copyToClipboard(text);

      if (ok) {
        console.log("[CSCS][TRACE] copied to clipboard (" + lines.length + " lines + header)");
      } else {
        console.warn("[CSCS][TRACE] copy failed. Use window.__CSCS_TRACE__.exportText() and copy manually.");
      }
      return ok;
    },

    download: function () {
      var text = this.exportText();
      var ts = new Date();
      var pad2 = function (n) { return String(n).padStart(2, "0"); };
      var filename =
        "cscs_trace_" +
        ts.getFullYear() +
        pad2(ts.getMonth() + 1) +
        pad2(ts.getDate()) +
        "_" +
        pad2(ts.getHours()) +
        pad2(ts.getMinutes()) +
        pad2(ts.getSeconds()) +
        ".txt";

      var ok = downloadTextFile(filename, text);
      if (ok) {
        console.log("[CSCS][TRACE] download started:", filename);
      } else {
        console.warn("[CSCS][TRACE] download failed. Use copy() or exportText().");
      }
      return ok;
    },

    // 保存されているログ（sessionStorage）だけを “無言で” クリアする
    // - enabled の ON/OFF は変えない
    // - console.log を使わない（enabled=true の時にクリアログが再混入するのを防ぐ）
    clearStored: function () {
      lines.length = 0;
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (e0) {}
      return true;
    },

    // 後方互換: クリアして、通知だけ出す（通知は origConsole なのでバッファに入らない）
    clear: function () {
      var ok = this.clearStored();
      origConsole.log("[CSCS][TRACE] cleared (sessionStorage)");
      return ok;
    },

    status: function () {
      var headerRaw = "";
      try { headerRaw = sessionStorage.getItem(HEADER_KEY) || ""; } catch (e1) { headerRaw = ""; }
      var bufRaw = "";
      try { bufRaw = sessionStorage.getItem(STORAGE_KEY) || ""; } catch (e2) { bufRaw = ""; }

      console.log("[CSCS][TRACE] status =", {
        enabled: enabled,
        lines: lines.length,
        maxLines: MAX_LINES,
        headerBytes: headerRaw.length,
        bufferBytes: bufRaw.length,
        url: header.url,
        action: header.action,
        reset: header.reset
      });
      return true;
    },

    // “完全停止”したい時用（デバッグ後に戻せる）
    // ※ 常駐版なので通常は使わない想定
    uninstall: function () {
      try { console.log = origConsole.log; } catch (e0) {}
      try { console.warn = origConsole.warn; } catch (e1) {}
      try { console.error = origConsole.error; } catch (e2) {}
      try { console.debug = origConsole.debug; } catch (e3) {}

      try { window.fetch = origFetch; } catch (e4) {}

      try { window.onerror = origOnError; } catch (e5) {}
      try { window.removeEventListener("unhandledrejection", unhandledHandler); } catch (e6) {}

      window.__CSCS_TRACE__ = { installed: false };
      origConsole.log("[CSCS][TRACE] uninstalled");
      return true;
    }
  };

  // “導入できた”ことを確実に残す（このログもバッファに入る）
  console.log("[CSCS][TRACE] installed (resident, sessionStorage-backed)");
  console.log("[CSCS][TRACE] try: window.__CSCS_TRACE__.setAction('...'); window.__CSCS_TRACE__.setReset('...');");
  console.log("[CSCS][TRACE] export: window.__CSCS_TRACE__.copy() or window.__CSCS_TRACE__.download()");
})();