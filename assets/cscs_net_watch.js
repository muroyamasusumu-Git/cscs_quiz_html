// assets/cscs_net_watch.js
// 目的:
//   DevTools の Network を開かなくても、/api/sync/merge と /api/sync/state の
//   Status / Response body / Response headers を console に確実に出す。
// 注意:
//   - fetch のレスポンスは clone() して読む（本体消費を避ける）
//   - request body は読める範囲だけ（文字列/JSON なら先頭だけ）
//   - 必要なら localStorage "cscs_net_watch" === "1" でON/OFFできる

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
      // 相対パスなどで URL() が落ちたとき用
      if (typeof u === "string") return u;
      return "";
    }
  }

  function isTarget(url) {
    var p = normalizePath(url);
    return p === "/api/sync/merge" || p === "/api/sync/state";
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
    // fetch(input, init) の init.body を “見える範囲で” 取り出す（完全再現は狙わない）
    try {
      if (!init || !("body" in init)) return null;
      var b = init.body;
      if (b === undefined || b === null) return null;

      // 文字列
      if (typeof b === "string") {
        return { type: "string", preview: shorten(b, 4000) };
      }

      // URLSearchParams
      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) {
        return { type: "URLSearchParams", preview: shorten(b.toString(), 4000) };
      }

      // FormData（中身は列挙しない：安全のため）
      if (typeof FormData !== "undefined" && b instanceof FormData) {
        var keys = [];
        try {
          b.forEach(function (_v, k) { keys.push(k); });
        } catch (e) {}
        return { type: "FormData", keys: keys.slice(0, 50) };
      }

      // Blob / ArrayBuffer などは中身読まない
      var tag = Object.prototype.toString.call(b);
      return { type: tag, preview: "[binary body omitted]" };
    } catch (e) {
      return { type: "error", preview: "request body extract failed: " + safeToString(e) };
    }
  }

  async function readBodyPreview(resp) {
    // clone したレスポンスから body を読む（JSON優先）
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
      // group が無い環境でも落とさない
      try { console.log(tag, data); } catch (_e) {}
    }
  }

  function logBlockEnd() {
    try { console.groupEnd(); } catch (e) {}
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

      var tag = "[CSCS][NET_WATCH][fetch] " + method + " " + normalizePath(url);

      try {
        var resp = await _fetch.apply(this, arguments);
        var dt = Math.round(nowMs() - t0);

        var hdrObj = headersToObject(resp.headers);
        var cloned = null;
        try { cloned = resp.clone(); } catch (e) { cloned = null; }

        var bodyPrev = { kind: "unavailable", value: "resp.clone() failed" };
        if (cloned) {
          bodyPrev = await readBodyPreview(cloned);
        }

        logBlockStart(tag, {
          url: url,
          method: method,
          status: resp.status,
          ok: resp.ok,
          elapsed_ms: dt,
          request_body: reqBodyInfo,
          response_headers: hdrObj,
          response_body: bodyPrev
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
        var tag = "[CSCS][NET_WATCH][xhr] " + (self.__cscs_nw_method || "GET") + " " + normalizePath(url);

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

            var respText = "";
            try { respText = typeof self.responseText === "string" ? self.responseText : ""; } catch (e) { respText = ""; }

            var bodyPrev = { kind: "text", value: shorten(respText, 6000) };
            try {
              // JSONっぽければ parse も試す
              if (respText && respText[0] === "{") {
                bodyPrev = { kind: "json", value: JSON.parse(respText) };
              }
            } catch (e) {}

            logBlockStart(tag, {
              url: url,
              method: self.__cscs_nw_method,
              status: self.status,
              ok: (self.status >= 200 && self.status < 300),
              elapsed_ms: dt,
              request_headers: self.__cscs_nw_headers || {},
              request_body: (typeof body === "string") ? shorten(body, 4000) : "[non-string body omitted]",
              response_headers: respHeaders,
              response_body: bodyPrev
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