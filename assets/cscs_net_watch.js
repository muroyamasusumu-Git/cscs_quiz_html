// assets/cscs_net_watch.js
//
// 【読み込み範囲に関する重要な注意（設計前提）】
//   - 本ファイルは **Aパート専用** のデバッグ監視JSであり、Bパートには読み込まれない。
//   - Aパートの挙動・通信・レスポンスを観測・診断する目的でのみ使用する。
//   - Bパート固有の判定・SYNC加算・UI挙動には一切関与しない。
//
// 目的:
//   - /api/sync/init /api/sync/state /api/sync/merge を常時監視し、
//     DevTools の Network を開かなくても “最小限の要点” を console に出す。
//   - INIT→STATE の整合から KV-SPLIT 疑い（別デプロイ/別KV/別経路参照）を検知し、
//     検知時は検索用に「必ず1行だけ」出す。
//
// 方針:
//   - 常にON（localStorageトグル無し）
//   - ログは軽量（1リクエスト = 1行サマリ）
//   - 詳細dumpは既定OFF（必要なら切替可能）
//   - 観測のみ（通信改変やフォールバックは一切しない）

(function () {
  "use strict";

  if (window.__CSCS_NET_WATCH_INSTALLED__) return;
  window.__CSCS_NET_WATCH_INSTALLED__ = true;

  // ============================================================
  // 設定（必要ならここだけ触ればOK）
  // ============================================================
  var ENABLED_ALWAYS = true;          // 常にON
  var ENABLE_VERBOSE_DUMP = false;    // 詳細dump（groupCollapsed）を出したい時だけ true
  var EMIT_ONE_LINE_EACH_TIME = true; // 1行サマリを常に出す

  // ============================================================
  // ユーティリティ
  // ============================================================
  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function safeToString(v) {
    try { return String(v); } catch (_e) { return "[unstringifiable]"; }
  }

  function shorten(s, n) {
    if (typeof s !== "string") s = safeToString(s);
    if (s.length <= n) return s;
    return s.slice(0, n) + " ...(truncated)";
  }

  function pickUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;
      return "";
    } catch (_e) {
      return "";
    }
  }

  function normalizePath(u) {
    try {
      var url = new URL(u, location.origin);
      return url.pathname;
    } catch (_e) {
      if (typeof u === "string") return u;
      return "";
    }
  }

  function isTarget(url) {
    var p = normalizePath(url);
    return (p === "/api/sync/init" || p === "/api/sync/state" || p === "/api/sync/merge");
  }

  function headerGetSafe(h, name) {
    try {
      if (!h || typeof h.get !== "function") return "";
      var v = h.get(name);
      return v == null ? "" : String(v);
    } catch (_e) {
      return "";
    }
  }

  function pickImportantHeadersFetch(h) {
    return {
      "x-cscs-user": headerGetSafe(h, "x-cscs-user"),
      "x-cscs-key": headerGetSafe(h, "x-cscs-key"),
      "x-cscs-kv-binding": headerGetSafe(h, "x-cscs-kv-binding"),
      "x-cscs-kv-identity": headerGetSafe(h, "x-cscs-kv-identity"),
      "x-cscs-env": headerGetSafe(h, "x-cscs-env"),
      "x-cscs-deploy": headerGetSafe(h, "x-cscs-deploy"),
      "x-cscs-version": headerGetSafe(h, "x-cscs-version"),
      "x-cscs-commit": headerGetSafe(h, "x-cscs-commit"),
      "x-cscs-tenant": headerGetSafe(h, "x-cscs-tenant"),
      "x-cscs-reset": headerGetSafe(h, "x-cscs-reset"),
      "x-cscs-isemptytemplate": headerGetSafe(h, "x-cscs-isemptytemplate"),
      "cf-ray": headerGetSafe(h, "cf-ray")
    };
  }
  
  function pickImportantRequestHeadersFromInit(init) {
    // fetch(input, init) の「送信ヘッダ」を “見える範囲で” 抜く（Cookie等は見えない）
    var out = {
      "x-cscs-key": "",
      "x-cscs-user": "",
      "content-type": ""
    };

    try {
      if (!init || !init.headers) return out;

      var h = init.headers;

      // Headers
      if (typeof Headers !== "undefined" && h instanceof Headers) {
        out["x-cscs-key"] = headerGetSafe(h, "x-cscs-key");
        out["x-cscs-user"] = headerGetSafe(h, "x-cscs-user");
        out["content-type"] = headerGetSafe(h, "content-type");
        return out;
      }

      // Array<[k,v]> 形式
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          var kv = h[i];
          if (!kv || kv.length < 2) continue;
          var k = String(kv[0] || "").toLowerCase();
          var v = String(kv[1] || "");
          if (k === "x-cscs-key") out["x-cscs-key"] = v;
          if (k === "x-cscs-user") out["x-cscs-user"] = v;
          if (k === "content-type") out["content-type"] = v;
        }
        return out;
      }

      // Plain object
      if (typeof h === "object") {
        Object.keys(h).forEach(function (k0) {
          var k = String(k0 || "").toLowerCase();
          var v = h[k0];
          if (v == null) v = "";
          v = String(v);

          if (k === "x-cscs-key") out["x-cscs-key"] = v;
          if (k === "x-cscs-user") out["x-cscs-user"] = v;
          if (k === "content-type") out["content-type"] = v;
        });
        return out;
      }
    } catch (_e) {}

    return out;
  }

  function emitStateRequestHeadersOneLine(kind, path, method, reqHeaders) {
    // “犯人炙り出し” 用：state を叩いた瞬間に 1行ログ
    try {
      if (path !== "/api/sync/state") return;

      var key = (reqHeaders && reqHeaders["x-cscs-key"]) ? String(reqHeaders["x-cscs-key"]) : "";
      var ctype = (reqHeaders && reqHeaders["content-type"]) ? String(reqHeaders["content-type"]) : "";

      // ★ 追加：呼び出し元（assets/...js:line）をスタックから1本だけ抜く
      var caller = "";
      try {
        var st = (new Error("CSCS_STATE_REQ_HEADERS")).stack;
        if (typeof st === "string" && st) {
          var lines = st.split("\n").map(function (s) { return String(s || "").trim(); });

          // 1) assets/ を含む行（最優先）
          for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            if (!ln) continue;
            if (ln.indexOf("assets/") >= 0) { caller = ln; break; }
          }

          // 2) 無ければ slides/ を含む行（次点）
          if (!caller) {
            for (var j = 0; j < lines.length; j++) {
              var ln2 = lines[j];
              if (!ln2) continue;
              if (ln2.indexOf("/slides/") >= 0) { caller = ln2; break; }
            }
          }

          // 3) それも無ければ stack の先頭っぽい行を1本（保険）
          if (!caller && lines.length >= 2) {
            caller = lines[1] || "";
          }
        }
      } catch (_eCaller) {
        caller = "";
      }

      // key が空なら特に重要（MISSING_KEY の原因）
      var line =
        "[CSCS][STATE_REQ_HEADERS] " +
        kind + " " + method + " " + path +
        " x-cscs-key=" + (key ? shorten(key, 60) : "(EMPTY)") +
        (ctype ? (" content-type=" + ctype) : "") +
        (caller ? (" caller=" + caller) : "");

      console.log(line);
    } catch (_e) {}
  }

  function looksLikeDeterministicKey(k) {
    try {
      if (typeof k !== "string") return false;
      if (k.indexOf("sync:") !== 0) return false;
      var rest = k.slice(5);
      if (!rest) return false;
      if (rest !== rest.toLowerCase()) return false;
      return true;
    } catch (_e) {
      return false;
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
      return { kind: "text", value: shorten(t, 2000) };
    } catch (e) {
      return { kind: "read_error", value: safeToString(e) };
    }
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
    } catch (_e) {
      return "";
    }
  }

  // ============================================================
  // 診断ストア（観測のみ）
  // ============================================================
  var diagStore = { init: null, state: null, merge: null };

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
    } catch (_e) {}
  }

  function computeKvSplitSuspect() {
    try {
      var init = diagStore.init;
      var state = diagStore.state;
      if (!init || !state) return null;

      var issuedKey = (init.important_headers && init.important_headers["x-cscs-key"]) ? String(init.important_headers["x-cscs-key"]) : "";
      var stateWarn = (state.body_warn_code ? String(state.body_warn_code) : "");

      var mismatchHit = false;
      if (stateWarn && stateWarn.indexOf("MISMATCH") >= 0) mismatchHit = true;
      if (stateWarn && stateWarn.indexOf("KEY_MISMATCH") >= 0) mismatchHit = true;

      var suspect =
        init.status === 200 &&
        issuedKey &&
        state.status === 403 &&
        mismatchHit;

      return {
        init_status: init.status,
        state_status: state.status,
        issued_key: issuedKey,
        state_warn_code: stateWarn,
        kv_split_suspect: suspect ? "HIGH" : "NOT HIGH",
        deterministic_key_ok: looksLikeDeterministicKey(issuedKey) ? "YES" : "NO"
      };
    } catch (_e) {
      return null;
    }
  }

  // ============================================================
  // 1行ログ（常時）
  // ============================================================
  var lastOneLine = "";
  function emitOneLineSummary(kind, path, status, ms, importantHeaders, warnCode) {
    try {
      if (!EMIT_ONE_LINE_EACH_TIME) return;

      var bind = importantHeaders["x-cscs-kv-binding"] || "";
      var ident = importantHeaders["x-cscs-kv-identity"] || "";
      var env = importantHeaders["x-cscs-env"] || "";
      var deploy = importantHeaders["x-cscs-deploy"] || "";
      var key = importantHeaders["x-cscs-key"] || "";

      var line =
        "[CSCS][NET] " +
        kind + " " + path +
        " st=" + String(status) +
        " ms=" + String(ms) +
        (warnCode ? (" warn=" + warnCode) : "") +
        (bind ? (" kv=" + bind) : "") +
        (ident ? (" kvId=" + shorten(ident, 24)) : "") +
        (env ? (" env=" + env) : "") +
        (deploy ? (" dep=" + shorten(deploy, 18)) : "") +
        (key ? (" key=" + shorten(key, 40)) : "");

      // 同一行の連打は抑制（でも「状況変わったら出る」）
      if (line === lastOneLine) return;
      lastOneLine = line;

      console.log(line);
    } catch (_e) {}
  }

  // ============================================================
  // KV-SPLIT 1行アラート（検知時だけ）
  // ============================================================
  var lastKvSplitLine = "";
  function emitKvSplitSuspectOneLine(kvSplit) {
    try {
      if (!kvSplit) return;
      if (String(kvSplit.kv_split_suspect) !== "HIGH") return;

      var line =
        "[CSCS][KV-SPLIT-SUSPECT] " +
        "level=" + String(kvSplit.kv_split_suspect || "") +
        " init=" + String(kvSplit.init_status || "") +
        " state=" + String(kvSplit.state_status || "") +
        " warn=" + String(kvSplit.state_warn_code || "") +
        " deterministic=" + String(kvSplit.deterministic_key_ok || "") +
        " key=" + String(kvSplit.issued_key || "");

      if (line === lastKvSplitLine) return;
      lastKvSplitLine = line;

      console.log(line);
    } catch (_e) {}
  }

  function logVerboseBlock(tag, data) {
    if (!ENABLE_VERBOSE_DUMP) return;
    try {
      console.groupCollapsed(tag);
      console.log(data);
      console.groupEnd();
    } catch (_e) {
      try { console.log(tag, data); } catch (__e) {}
    }
  }

  // ============================================================
  // fetch フック（常時ON）
  // ============================================================
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = async function (input, init) {
      if (!ENABLED_ALWAYS) return _fetch.apply(this, arguments);

      var url = pickUrl(input);
      if (!isTarget(url)) return _fetch.apply(this, arguments);

      var method = "GET";
      try {
        if (init && init.method) method = safeToString(init.method).toUpperCase();
        else if (input && input.method) method = safeToString(input.method).toUpperCase();
      } catch (_e) {}

      var t0 = nowMs();
      var path = normalizePath(url);
      var tag = "[CSCS][NET_WATCH][fetch] " + method + " " + path;

      // ★ 追加：送信時点の request headers を 1行で必ず出す（state犯人特定）
      var reqHeaders = pickImportantRequestHeadersFromInit(init);
      emitStateRequestHeadersOneLine("fetch", path, method, reqHeaders);

      try {
        var resp = await _fetch.apply(this, arguments);
        var ms = Math.round(nowMs() - t0);

        var important = pickImportantHeadersFetch(resp.headers);

        var cloned = null;
        try { cloned = resp.clone(); } catch (_e) { cloned = null; }
        var bodyPrev = cloned ? await readBodyPreview(cloned) : { kind: "unavailable", value: "resp.clone() failed" };

        var warnCode = extractWarnCodeFromBody(bodyPrev);

        var diagTagName =
          path === "/api/sync/init" ? "init" :
          path === "/api/sync/state" ? "state" :
          path === "/api/sync/merge" ? "merge" :
          "";

        if (diagTagName) {
          updateDiag(diagTagName, resp.status, resp.ok, important, bodyPrev);
        }

        emitOneLineSummary("fetch", path, resp.status, ms, important, warnCode);

        var kvSplit = computeKvSplitSuspect();
        emitKvSplitSuspectOneLine(kvSplit);

        logVerboseBlock(tag, {
          url: url,
          method: method,
          status: resp.status,
          ok: resp.ok,
          elapsed_ms: ms,
          important_headers: important,
          response_body: bodyPrev,
          diag_kv_split_suspect: kvSplit
        });

        return resp;
      } catch (e) {
        var ms2 = Math.round(nowMs() - t0);
        try {
          console.log("[CSCS][NET] fetch " + path + " THROW ms=" + String(ms2) + " err=" + safeToString(e));
        } catch (_e2) {}
        throw e;
      }
    };
  }

  // ============================================================
  // 初期ログ
  // ============================================================
  try {
    console.log("[CSCS][NET_WATCH] installed. always_on =", ENABLED_ALWAYS, "verbose =", ENABLE_VERBOSE_DUMP);
  } catch (_e) {}
})();