// assets/cscs_debug_trace.js
(function () {
  "use strict";
  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "cscs_debug_trace"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }
  
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
  var ENABLED_KEY = "__CSCS_TRACE_ENABLED__"; // ★ enabled 状態も localStorage に保持（リロード/遷移でも維持）

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
      var raw = localStorage.getItem(HEADER_KEY);
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
      localStorage.setItem(HEADER_KEY, JSON.stringify(h));
    } catch (e) {
      // 失敗しても動作継続（ログ収集は可能）
    }
  }

  function loadLines() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch (e) {
      // 容量超過などでも落とさない
    }
  }

  // ★ enabled 状態を localStorage から復元/保存する（ローカルストレージのみ）
  function loadEnabled() {
    try {
      var v = localStorage.getItem(ENABLED_KEY);
      return v === "1";
    } catch (e) {
      return false;
    }
  }

  function saveEnabled(v) {
    try {
      localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
    } catch (e) {
      // 失敗しても動作継続（ログ収集自体は可能）
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
  var enabled = loadEnabled(); // ★変更: A→B遷移後もトレースON/OFFを復元
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
              "Content-Type": res.headers.get("Content-Type"),
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
      // ★変更: トレースを ON にして、その状態を sessionStorage に保存する
      enabled = true;
      saveEnabled(true);

      header.url = location.href;
      saveHeader(header);

      console.log("[CSCS][TRACE] START (enabled=true)");
      return true;
    },

    stop: async function () {
      // ★処理1: まず「完全なスナップショット」を作る（以後 lines を触らない）
      var snapshot = this.exportText();

      // ★処理2: スナップショットをコピー（非同期完了を必ず待つ）
      var ok = await copyToClipboard(snapshot);

      // ★処理3: コピー完了後にトレース停止のみ（ログは保持）
      enabled = false;
      saveEnabled(false);

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
      try { localStorage.removeItem(STORAGE_KEY); } catch (e0) {}
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
      try { headerRaw = localStorage.getItem(HEADER_KEY) || ""; } catch (e1) { headerRaw = ""; }
      var bufRaw = "";
      try { bufRaw = localStorage.getItem(STORAGE_KEY) || ""; } catch (e2) { bufRaw = ""; }

      console.log("[CSCS][TRACE] status =", {
        enabled: enabled,
        lines: lines.length,
        maxLines: MAX_LINES,
        storage: "localStorage",
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

  // -----------------------------
  // UI（常駐ミニパネル）
  // -----------------------------
  var ui = {
    root: null,
    statusEl: null,
    btnStart: null,
    btnStop: null,
    btnReset: null,
    openBtn: null
  };

  // 追加した処理:
  // - #cscs-trace-ui の表示/非表示を切り替える（temp_hide.js の「開閉」相当）
  // - 表示状態は「このJS内部の変数」で管理し、余計な永続キーは増やさない
  // - デフォルトは「閉」
  var __traceUiVisible = false;

  function setTraceUiVisible(isVisible) {
    // 追加した処理:
    // - 既に mount 済みなら display を切り替えるだけ
    // - mount 前に呼ばれても落とさない（参照できる範囲で反映）
    __traceUiVisible = !!isVisible;

    if (ui.root) {
      ui.root.style.display = __traceUiVisible ? "block" : "none";
    }

    if (ui.openBtn) {
      ui.openBtn.textContent = "LOG";
    }
  }

  function toggleTraceUiVisible() {
    // 追加した処理:
    // - trace UI がまだ無ければ先に mount してから表示切替を反映する
    // - ここでは「探して補完」などはせず、同一要素（#cscs-trace-ui）のみを対象にする
    if (!ui.root) {
      try { mountTraceUi(); } catch (_eMount) {}
    }
    setTraceUiVisible(!__traceUiVisible);
  }

  function buildLogOpenButtonOnce() {
    // 追加した処理:
    // - LOGボタン（#cscs-log-openbtn）を1回だけ生成
    // - クリックで trace UI を表示/非表示トグル
    if (!document || !document.body) return;
    if (document.getElementById("cscs-log-openbtn")) return;

    var btn = document.createElement("button");
    btn.id = "cscs-log-openbtn";
    btn.type = "button";
    btn.textContent = "LOG";

    btn.addEventListener("click", function () {
      toggleTraceUiVisible();
    });

    document.body.appendChild(btn);
    ui.openBtn = btn;
  }

  function formatBytes(n) {
    if (!n || n <= 0) return "0B";
    if (n < 1024) return n + "B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
    return (n / (1024 * 1024)).toFixed(1) + "MB";
  }

  function computeBufferBytes() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY) || "";
      return raw.length;
    } catch (e) {
      return 0;
    }
  }

  function updateTraceUi() {
    if (!ui.root || !ui.statusEl) return;

    var stateText = enabled ? "RUNNING" : "STOPPED";
    var lineCount = lines.length;
    var bytes = computeBufferBytes();

    ui.statusEl.textContent =
      "TRACE: " + stateText + "\n" +
      "lines: " + lineCount + " / " + MAX_LINES + "\n" +
      "storage: localStorage (" + formatBytes(bytes) + ")";
  }

  async function onUiStart() {
    try {
      window.__CSCS_TRACE__.start();
    } finally {
      updateTraceUi();
    }
  }

  async function onUiStop() {
    try {
      await window.__CSCS_TRACE__.stop();
    } finally {
      updateTraceUi();
    }
  }

  async function onUiReset() {
    // ★処理1: トレース停止（以後増えないようにする）
    enabled = false;
    saveEnabled(false);

    // ★処理2: ログ本体を無言で消す（localStorage）
    lines.length = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e0) {}

    // ★処理3: ヘッダ(Action/Reset/URL)を初期化して保存
    header.url = location.href;
    header.action = "";
    header.reset = "";
    saveHeader(header);

    // ★処理4: UI表示更新
    updateTraceUi();

    // ★処理5: ログとして残したい場合のみ（STOP状態なので保存されない）
    origConsole.log("[CSCS][TRACE] RESET by UI (enabled=false, buffer cleared, header reset)");
    return true;
  }

  function onUiStatus() {
    try {
      window.__CSCS_TRACE__.status();
    } finally {
      updateTraceUi();
    }
  }

  function mountTraceUi() {
    if (ui.root) return;
    if (!document || !document.body) return;

    var css = `
/* ============================================================================
 * CSCS Debug Trace UI (Monochrome)
 * ========================================================================== */

#cscs-trace-ui {
    position: fixed !important;
    right: 10px;
    bottom: 55px;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.70);
    border: 1px solid rgba(255, 255, 255, 0.20);
    border-radius: 10px;
    padding: 7px 14px 5px;
    width: 25.5%;
    color: #eaeaea;
    font: 12px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    backdrop-filter: blur(6px);
    opacity: 0.5;
}

/* タイトル */
#cscs-trace-ui .t {
    font-weight: 600;
    text-align: center;
    margin: 0 0 4px 0;

    color: #f0f0f0;
    opacity: 0.9;
}

/* ステータス表示 */
#cscs-trace-ui pre {
    margin: 0 0 8px 0;
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 120px;
    overflow: auto;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: #dcdcdc;
    line-height: 1;

    /* ★追加: クリック可能であることを示す（Statusボタン相当の操作をここに集約） */
    cursor: pointer;
}

/* ボタン行 */
#cscs-trace-ui .row {
    display: flex;
    gap: 6px;

    /* ★変更: 3ボタンを必ず1行に固定して均等割りにする */
    flex-wrap: nowrap;
}

/* ボタン共通 */
#cscs-trace-ui button {
    /* ★変更: 3つを完全に同率で均等割り */
    flex: 1 1 0%;
    min-width: 0;

    appearance: none;
    padding: 3px 8px;
    margin-bottom: 5px;

    font-size: 10px;
    color: #eeeeee;

    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.20);
    border-radius: 8px;

    cursor: pointer;
}

/* hover / active */
#cscs-trace-ui button:hover {
    background: rgba(255, 255, 255, 0.12);
}

#cscs-trace-ui button:active {
    background: rgba(255, 255, 255, 0.18);
    transform: translateY(1px);
}

/* ============================================================================
 * LOGボタン（#cscs-log-openbtn）
 * - 右下固定で、temp_hide.js の HIDE ボタンの左隣に配置する
 * - クリックで #cscs-trace-ui の表示/非表示を切り替える
 * ========================================================================== */
#cscs-log-openbtn {
    position: fixed !important;
    right: 243px;
    bottom: 10px;
    z-index: 999999 !important;
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.55);
    color: rgb(255, 255, 255);
    height: 34px;
    cursor: pointer;
    user-select: none;
}

/* ============================================================================
 * 追記用エリア（将来拡張）
 *
 * 例:
 * #cscs-trace-ui.is-running { outline: 1px solid #4caf50; }
 * #cscs-trace-ui .btn-danger { background: rgba(255,0,0,0.2); }
 * ========================================================================== */
`;

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var root = document.createElement("div");
    root.id = "cscs-trace-ui";

    var title = document.createElement("div");
    title.className = "t";
    title.textContent = "Console Log TRACE";
    root.appendChild(title);

    var pre = document.createElement("pre");
    pre.id = "cscs-trace-ui-status";
    pre.textContent = "";
    root.appendChild(pre);

    var rowButtons = document.createElement("div");
    rowButtons.className = "row";

    var btnStart = document.createElement("button");
    btnStart.id = "cscs-trace-ui-btn-start";
    btnStart.textContent = "Start";
    rowButtons.appendChild(btnStart);

    var btnStop = document.createElement("button");
    btnStop.id = "cscs-trace-ui-btn-stop";
    btnStop.textContent = "Stop (Copy)";
    rowButtons.appendChild(btnStop);

    var btnReset = document.createElement("button");
    btnReset.id = "cscs-trace-ui-btn-reset";
    btnReset.textContent = "Reset";
    rowButtons.appendChild(btnReset);

    root.appendChild(rowButtons);

    document.body.appendChild(root);

    ui.root = root;
    ui.statusEl = pre;
    ui.btnStart = btnStart;
    ui.btnStop = btnStop;
    ui.btnReset = btnReset;

    btnStart.addEventListener("click", function () { onUiStart(); });
    btnStop.addEventListener("click", function () { onUiStop(); });
    btnReset.addEventListener("click", function () { onUiReset(); });

    /* ★追加: Statusボタンを廃止し、テキストエリアクリックを Status 相当にする
       - consoleへ status() を出す（従来の onUiStatus と同じ）
       - クリック後はUI表示も更新する（updateTraceUi は onUiStatus 側で実施）
    */
    pre.addEventListener("click", function () { onUiStatus(); });

    updateTraceUi();

    // 追加した処理:
    // - LOGボタンを生成（右下固定・HIDEの左隣）
    // - 現在の表示状態（__traceUiVisible）を UI に反映
    buildLogOpenButtonOnce();
    setTraceUiVisible(__traceUiVisible);
  }

  if (document && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTraceUi);
  } else {
    mountTraceUi();
  }

  // ★UIの表示をログ発生に追従させる（pushLine時にも更新）
  //   - ここは軽くするため、pushLineの最後で updateTraceUi() を呼ぶ
  var _origPushLine = pushLine;
  pushLine = function (linesArg, lineArg) {
    var r = _origPushLine(linesArg, lineArg);
    updateTraceUi();
    return r;
  };

  // “導入できた”ことを確実に残す（このログもバッファに入る）
  console.log("[CSCS][TRACE] installed (resident, localStorage-backed)");
  console.log("[CSCS][TRACE] try: window.__CSCS_TRACE__.setAction('...'); window.__CSCS_TRACE__.setReset('...');");
  console.log("[CSCS][TRACE] export: window.__CSCS_TRACE__.copy() or window.__CSCS_TRACE__.download()");
})();