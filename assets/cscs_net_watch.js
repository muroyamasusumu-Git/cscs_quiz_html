// assets/cscs_net_watch.js
//
// 【読み込み範囲に関する重要な注意（設計前提）】
//   - 本ファイルは **Aパート専用** のデバッグ監視JSであり、Bパートには読み込まれない。
//   - Aパートの挙動・通信・レスポンスを観測する目的でのみ使用する。
//   - Bパート固有の判定・SYNC加算・UI挙動には一切関与しない。
//
// 目的:
//   DevTools の Network を開かなくても、/api/sync/merge と /api/sync/state の
//   Status / Response body / Response headers を console に確実に出す。
//   + 追加: /api/sync/init も対象にし、INIT→STATE の整合（KV-SPLIT疑い等）を診断する。
//
// 注意:
//   - fetch のレスポンスは clone() して読む（本体消費を避ける）
//   - request body は読める範囲だけ（文字列/JSON なら先頭だけ）
//   - 必要なら localStorage "cscs_net_watch" === "1" でON/OFFできる
//   - 診断は“観測のみ”（通信内容の改変やフォールバックは一切しない）

(function () {
  "use strict";

  if (window.__CSCS_NET_WATCH_INSTALLED__) return;
  window.__CSCS_NET_WATCH_INSTALLED__ = true;

  function isEnabled() {
    try {
      if (window.CSCS_NET_WATCH_DISABLED === true) return false;
      return localStorage.getItem("cscs_net_watch") === "1";
    } catch (e) {
      return false;
    }
  }

  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function safeToString(v) {
    try {
      return String(v);
    } catch (e) {
      return "[unstringifiable]";
    }
  }

  function pickUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;
      return "";
    } catch (e) {
      return "";
    }
  }

  function normalizePath(u) {
    try {
      var url = new URL(u, location.origin);
      return url.pathname;
    } catch (e) {
      if (typeof u === "string") return u;
      return "";
    }
  }

  function isTarget(url) {
    var p = normalizePath(url);
    return (
      p === "/api/sync/merge" ||
      p === "/api/sync/state" ||
      p === "/api/sync/init"
    );
  }

  function headersToObject(headers) {
    var out = {};
    try {
      if (!headers || !headers.forEach) return out;
      headers.forEach(function (v, k) {
        out[k] = v;
      });
    } catch (e) {}
    return out;
  }

  function shorten(s, n) {
    if (typeof s !== "string") s = safeToString(s);
    if (s.length <= n) return s;
    return s.slice(0, n) + " ...(truncated)";
  }

  function tryExtractRequestBody(init) {
    try {
      if (!init || !("body" in init)) return null;
      var b = init.body;
      if (b === undefined || b === null) return null;

      if (typeof b === "string") {
        return { type: "string", preview: shorten(b, 4000) };
      }

      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) {
        return { type: "URLSearchParams", preview: shorten(b.toString(), 4000) };
      }

      if (typeof FormData !== "undefined" && b instanceof FormData) {
        var keys = [];
        try {
          b.forEach(function (_v, k) { keys.push(k); });
        } catch (e) {}
        return { type: "FormData", keys: keys.slice(0, 50) };
      }

      var tag = Object.prototype.toString.call(b);
      return { type: tag, preview: "[binary body omitted]" };
    } catch (e) {
      return { type: "error", preview: "request body extract failed: " + safeToString(e) };
    }
  }

  async function readBodyPreview(resp) {
    try {
      var ct = resp.headers && resp.headers.get ? (resp.headers.get("content-type") || "") : "";
      if (ct.indexOf("application/json") !== -1) {
        var j = await resp.json();
        return { kind: "json", value: j };
      }
      var t = await resp.text();
      return { kind: "text", value: shorten(t, 6000) };
    } catch (e) {
      return { kind: "read_error", value: safeToString(e) };
    }
  }

  function logBlockStart(tag, data) {
    try {
      console.groupCollapsed(tag);
      console.log(data);
    } catch (e) {
      try { console.log(tag, data); } catch (_e) {}
    }
  }

  function logBlockEnd() {
    try { console.groupEnd(); } catch (e) {}
  }

  // ============================================================
  // 追加: INIT/STATE 診断ストア（観測のみ）
  // ============================================================
  var diagStore = {
    init: null,
    state: null,
    merge: null
  };

  function pickImportantHeadersFromFetchHeaders(h) {
    function g(name) {
      try {
        var v = h && typeof h.get === "function" ? h.get(name) : null;
        return v == null ? "" : String(v);
      } catch (e) {
        return "";
      }
    }

    return {
      "X-CSCS-Key": g("X-CSCS-Key"),
      "X-CSCS-User": g("X-CSCS-User"),
      "X-CSCS-KV-Binding": g("X-CSCS-KV-Binding"),
      "X-CSCS-KV-Identity": g("X-CSCS-KV-Identity"),
      "X-CSCS-Pages-Project": g("X-CSCS-Pages-Project"),
      "X-CSCS-Pages-Branch": g("X-CSCS-Pages-Branch"),
      "X-CSCS-Pages-Commit": g("X-CSCS-Pages-Commit"),
      "X-CSCS-Pages-Deploy": g("X-CSCS-Pages-Deploy"),
      "X-CSCS-Warn": g("X-CSCS-Warn"),
      "X-CSCS-IsEmptyTemplate": g("X-CSCS-IsEmptyTemplate"),
      "X-CSCS-ExpectedKey": g("X-CSCS-ExpectedKey")
    };
  }

  function pickImportantHeadersFromXhrLowerMap(mapLower) {
    function gLower(nameLower) {
      try {
        var v = mapLower ? mapLower[nameLower] : "";
        return v == null ? "" : String(v);
      } catch (e) {
        return "";
      }
    }

    return {
      "X-CSCS-Key": gLower("x-cscs-key"),
      "X-CSCS-User": gLower("x-cscs-user"),
      "X-CSCS-KV-Binding": gLower("x-cscs-kv-binding"),
      "X-CSCS-KV-Identity": gLower("x-cscs-kv-identity"),
      "X-CSCS-Pages-Project": gLower("x-cscs-pages-project"),
      "X-CSCS-Pages-Branch": gLower("x-cscs-pages-branch"),
      "X-CSCS-Pages-Commit": gLower("x-cscs-pages-commit"),
      "X-CSCS-Pages-Deploy": gLower("x-cscs-pages-deploy"),
      "X-CSCS-Warn": gLower("x-cscs-warn"),
      "X-CSCS-IsEmptyTemplate": gLower("x-cscs-isemptytemplate"),
      "X-CSCS-ExpectedKey": gLower("x-cscs-expectedkey")
    };
  }

  function extractWarnCodeFromBody(bodyPrev) {
    try {
      if (!bodyPrev || bodyPrev.kind !== "json") return "";
      var j = bodyPrev.value;
      if (!j || typeof j !== "object") return "";
      var w = j.__cscs_warn;
      if (!w || typeof w !== "object") return "";
      var c = w.code;
      return (typeof c === "string") ? c : "";
    } catch (e) {
      return "";
    }
  }

  function looksLikeDeterministicKey(k) {
    try {
      if (typeof k !== "string") return false;
      if (k.indexOf("sync:") !== 0) return false;
      var rest = k.slice(5);
      if (!rest) return false;
      if (rest !== rest.toLowerCase()) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateDiag(tagName, status, ok, importantHeaders, bodyPrev) {
    try {
      diagStore[tagName] = {
        at: Date.now(),
        status: status,
        ok: ok,
        important_headers: importantHeaders || {},
        body_warn_code: extractWarnCodeFromBody(bodyPrev),
        body: bodyPrev || null
      };
    } catch (e) {}
  }

  function computeKvSplitSuspect() {
    try {
      var init = diagStore.init;
      var state = diagStore.state;

      var haveInit = !!init;
      var haveState = !!state;

      if (!haveInit && !haveState) return null;

      var initStatus = haveInit ? init.status : "";
      var stateStatus = haveState ? state.status : "";

      var issuedKey =
        haveInit &&
        init.important_headers &&
        typeof init.important_headers["X-CSCS-Key"] === "string"
          ? init.important_headers["X-CSCS-Key"]
          : "";

      var warnFromBody =
        haveState && typeof state.body_warn_code === "string"
          ? state.body_warn_code
          : "";

      var warnFromHeader =
        haveState &&
        state.important_headers &&
        typeof state.important_headers["X-CSCS-Warn"] === "string"
          ? state.important_headers["X-CSCS-Warn"]
          : "";

      var warn = warnFromBody || warnFromHeader || "";

      var mismatchHit = false;
      if (warn && String(warn).indexOf("MISMATCH") >= 0) mismatchHit = true;

      var suspect =
        haveInit &&
        haveState &&
        initStatus === 200 &&
        typeof issuedKey === "string" &&
        issuedKey.length > 0 &&
        stateStatus === 403 &&
        mismatchHit;

      var level = "PENDING";
      if (haveInit && haveState) level = suspect ? "HIGH" : "NOT HIGH";

      return {
        level: level,
        have_init: haveInit ? "YES" : "NO",
        have_state: haveState ? "YES" : "NO",
        init_status: initStatus,
        state_status: stateStatus,
        issued_key: issuedKey,
        warn: warn,
        deterministic_key_ok: looksLikeDeterministicKey(issuedKey) ? "YES" : "NO"
      };
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 追加: KV-SPLIT SUSPECT を「必ず1行だけ」で出す（検索性重視）
  //   - init/state が片方しか無くても PENDING で1行出す
  //   - warn は body(__cscs_warn.code) と header(X-CSCS-Warn) の両方を見る
  // ============================================================
  var lastKvSplitOneLine = "";

  function emitKvSplitSuspectOneLine(kvSplit) {
    try {
      if (!kvSplit) return;

      var line =
        "[CSCS][KV-SPLIT-SUSPECT] " +
        "level=" + String(kvSplit.level || "") +
        " have_init=" + String(kvSplit.have_init || "NO") +
        " have_state=" + String(kvSplit.have_state || "NO") +
        " init=" + String(kvSplit.init_status || "") +
        " state=" + String(kvSplit.state_status || "") +
        " warn=" + String(kvSplit.warn || "") +
        " deterministic=" + String(kvSplit.deterministic_key_ok || "") +
        " key=" + String(kvSplit.issued_key || "");

      if (line === lastKvSplitOneLine) return;
      lastKvSplitOneLine = line;

      console.log(line);
    } catch (e) {}
  }

  // =========================
  // fetch フック
  // =========================
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = async function (input, init) {
      if (!isEnabled()) {
        return _fetch.apply(this, arguments);
      }

      var url = pickUrl(input);
      if (!isTarget(url)) {
        return _fetch.apply(this, arguments);
      }

      var method = "GET";
      try {
        if (init && init.method) method = safeToString(init.method).toUpperCase();
        else if (input && input.method) method = safeToString(input.method).toUpperCase();
      } catch (e) {}

      var t0 = nowMs();
      var reqBodyInfo = tryExtractRequestBody(init);

      var path = normalizePath(url);
      var tag = "[CSCS][NET_WATCH][fetch] " + method + " " + path;

      try {
        var resp = await _fetch.apply(this, arguments);
        var dt = Math.round(nowMs() - t0);

        var hdrObj = headersToObject(resp.headers);
        var importantHeaders = pickImportantHeadersFromFetchHeaders(resp.headers);

        var cloned = null;
        try { cloned = resp.clone(); } catch (e) { cloned = null; }

        var bodyPrev = { kind: "unavailable", value: "resp.clone() failed" };
        if (cloned) {
          bodyPrev = await readBodyPreview(cloned);
        }

        var diagTagName =
          path === "/api/sync/init" ? "init" :
          path === "/api/sync/state" ? "state" :
          path === "/api/sync/merge" ? "merge" :
          "";

        if (diagTagName) {
          updateDiag(diagTagName, resp.status, resp.ok, importantHeaders, bodyPrev);
        }

        var kvSplit = computeKvSplitSuspect();
        emitKvSplitSuspectOneLine(kvSplit);

        logBlockStart(tag, {
          url: url,
          method: method,
          status: resp.status,
          ok: resp.ok,
          elapsed_ms: dt,
          request_body: reqBodyInfo,
          response_headers: hdrObj,
          important_headers: importantHeaders,
          response_body: bodyPrev,
          diag_kv_split_suspect: kvSplit
        });
        logBlockEnd();

        return resp;
      } catch (e) {
        var dt2 = Math.round(nowMs() - t0);
        logBlockStart(tag + " (THROW)", {
          url: url,
          method: method,
          elapsed_ms: dt2,
          request_body: reqBodyInfo,
          error: safeToString(e)
        });
        logBlockEnd();
        throw e;
      }
    };
  }

  // =========================
  // XHR フック（念のため）
  // =========================
  (function hookXHR() {
    if (!window.XMLHttpRequest) return;

    var XHR = window.XMLHttpRequest;
    var _open = XHR.prototype.open;
    var _send = XHR.prototype.send;
    var _setHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      try {
        this.__cscs_nw_method = safeToString(method).toUpperCase();
        this.__cscs_nw_url = safeToString(url);
        this.__cscs_nw_t0 = nowMs();
        this.__cscs_nw_headers = {};
      } catch (e) {}
      return _open.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (k, v) {
      try {
        if (this.__cscs_nw_headers) this.__cscs_nw_headers[safeToString(k)] = safeToString(v);
      } catch (e) {}
      return _setHeader.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      try {
        if (!isEnabled()) return _send.apply(this, arguments);

        var url = this.__cscs_nw_url || "";
        if (!isTarget(url)) return _send.apply(this, arguments);

        var self = this;
        var path = normalizePath(url);
        var tag = "[CSCS][NET_WATCH][xhr] " + (self.__cscs_nw_method || "GET") + " " + path;

        function done() {
          try {
            var dt = Math.round(nowMs() - (self.__cscs_nw_t0 || nowMs()));
            var respHeaders = {};
            try {
              var raw = self.getAllResponseHeaders() || "";
              raw.split(/\r?\n/).forEach(function (line) {
                var idx = line.indexOf(":");
                if (idx > 0) {
                  var k = line.slice(0, idx).trim().toLowerCase();
                  var v = line.slice(idx + 1).trim();
                  if (k) respHeaders[k] = v;
                }
              });
            } catch (e) {}

            var importantHeaders = pickImportantHeadersFromXhrLowerMap(respHeaders);

            var respText = "";
            try { respText = typeof self.responseText === "string" ? self.responseText : ""; } catch (e) { respText = ""; }

            var bodyPrev = { kind: "text", value: shorten(respText, 6000) };
            try {
              if (respText && respText[0] === "{") {
                bodyPrev = { kind: "json", value: JSON.parse(respText) };
              }
            } catch (e) {}

            var diagTagName =
              path === "/api/sync/init" ? "init" :
              path === "/api/sync/state" ? "state" :
              path === "/api/sync/merge" ? "merge" :
              "";

            if (diagTagName) {
              updateDiag(diagTagName, self.status, (self.status >= 200 && self.status < 300), importantHeaders, bodyPrev);
            }

            var kvSplit = computeKvSplitSuspect();
            emitKvSplitSuspectOneLine(kvSplit);

            logBlockStart(tag, {
              url: url,
              method: self.__cscs_nw_method,
              status: self.status,
              ok: (self.status >= 200 && self.status < 300),
              elapsed_ms: dt,
              request_headers: self.__cscs_nw_headers || {},
              request_body: (typeof body === "string") ? shorten(body, 4000) : "[non-string body omitted]",
              response_headers: respHeaders,
              important_headers: importantHeaders,
              response_body: bodyPrev,
              diag_kv_split_suspect: kvSplit
            });
            logBlockEnd();
          } catch (e) {}
        }

        self.addEventListener("loadend", done);
      } catch (e) {}

      return _send.apply(this, arguments);
    };
  })();

  // 初期ログ
  try {
    console.log("[CSCS][NET_WATCH] installed. enabled =", isEnabled(), 'set localStorage "cscs_net_watch"="1" to enable');
  } catch (e) {}
})();