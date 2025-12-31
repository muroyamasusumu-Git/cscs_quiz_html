// assets/cscs_sync_header_compare.js
// ============================================================================
// CSCS SYNC Header Compare Monitor (B-part ONLY)
//
// 🎯 用途（重要）:
//   - このスクリプトは **Bパートにのみ読み込ませる前提** の監視ツール。
//   - Aパートの挙動や通信は一切対象にしない。
//   - 「Bで実際に発生している SYNC 挙動」だけを切り出して検証するためのもの。
//
// 目的:
//   - /api/sync/merge と /api/sync/state の Response Headers を捕捉し、
//     以下の3ヘッダを **同一実行文脈（B）で直接比較**する。
//       • X-CSCS-Key
//       • X-CSCS-User
//       • X-CSCS-KV-Identity（存在すれば）
//
// 判定できること:
//   - merge と state が
//       1) 同じ KV namespace を掴んでいるか
//       2) 同じ sync:key（大小含む完全一致）を使っているか
//   を **即座に確定**できる。
//
// 注意事項:
//   - fetch をフックするため、「この JS が読み込まれた後」の通信のみが対象。
//   - 本番常駐用ではなく、**原因切り分け専用の一時デバッグツール**。
//   - UI や SYNC ロジックの挙動は一切変更しない（観測のみ）。
// ============================================================================

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
  var __effectId = "cscs_sync_header_compare"; // ← このJS固有のIDにする
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
  

  if (window.__CSCS_SYNC_HEADER_COMPARE__) return;
  window.__CSCS_SYNC_HEADER_COMPARE__ = true;

  // header_compare 用ストア
  // - merge / state : 相互比較対象
  // - init          : 比較はしないが「key発行の事実確認」に使う
  var store = {
    merge: null,
    state: null,
    init: null
  };

  function normalizePath(url) {
    try {
      return new URL(url, location.origin).pathname;
    } catch (e) {
      return "";
    }
  }

  function isTarget(path) {
    // 監視対象:
    //   - merge / state : 既存の SYNC 本体
    //   - init          : Accessユーザーに対する sync key 発行・再発行
    return (
      path === "/api/sync/merge" ||
      path === "/api/sync/state" ||
      path === "/api/sync/init"
    );
  }

  function pick(headers) {
    function g(name) {
      try {
        var v = headers.get(name);
        return v == null ? "" : String(v);
      } catch (e) {
        return "";
      }
    }
    return {
      "X-CSCS-Key": g("X-CSCS-Key"),
      "X-CSCS-User": g("X-CSCS-User"),
      "X-CSCS-KV-Identity": g("X-CSCS-KV-Identity")
    };
  }

  // 追加した処理: localStorage "cscs_net_watch"==="1" で、REQ/RESPログとheader_compareログをまとめてON/OFF
  function isEnabled() {
    try {
      if (window.CSCS_NET_WATCH_DISABLED === true) return false;
      return localStorage.getItem("cscs_net_watch") === "1";
    } catch (e) {
      return false;
    }
  }

  // 追加した処理: elapsed_ms 計測用
  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  // 追加した処理: 例外になりやすい値の安全な文字列化
  function safeToString(v) {
    try {
      return String(v);
    } catch (e) {
      return "[unstringifiable]";
    }
  }

  // 追加した処理: Response Headers を object 化（console.logしやすくする）
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

  // 追加した処理: 長文をログ向けに短縮（bodyプレビュー用）
  function shorten(s, n) {
    if (typeof s !== "string") s = safeToString(s);
    if (s.length <= n) return s;
    return s.slice(0, n) + " ...(truncated)";
  }

  // 追加した処理: fetch(input, init) の init.body を “見える範囲で” 抽出（完全再現は狙わない）
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

  // 追加した処理: clone() したレスポンスから body を読む（JSON優先 / 本体消費を避ける）
  async function readBodyPreview(resp) {
    try {
      var ct = resp.headers && resp.headers.get ? (resp.headers.get("Content-Type") || "") : "";
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

  function compareAndReport() {
    // 追加した処理: groupCollapsed をここでは作らず、計算結果だけを返す
    // - REQ/RESP を同じ groupCollapsed に統合するため（外側でまとめて出す）
    if (!store.merge || !store.state) return null;

    var m = store.merge;
    var s = store.state;

    var keySame = m["X-CSCS-Key"] === s["X-CSCS-Key"];
    var kvSame =
      m["X-CSCS-KV-Identity"] &&
      s["X-CSCS-KV-Identity"] &&
      m["X-CSCS-KV-Identity"] === s["X-CSCS-KV-Identity"];

    var verdict = "";
    if (!kvSame) {
      verdict = "❌ Case B: KV namespace が違う（binding / deploy / env 不一致）";
    } else if (!keySame) {
      verdict = "⚠️ Case A: KVは同じだが X-CSCS-Key が違う（大小問題・別ユーザー扱い）";
    } else {
      verdict = "✅ Case C: KV / Key ともに一致（今回の原因ではない）";
    }

    return {
      merge: m,
      state: s,
      key_same: keySame,
      kv_identity_same: kvSame,
      verdict: verdict
    };
  }

  // fetch + XHR request/response hook（/api/sync/merge / /api/sync/state のみ）
  // 目的:
  //   - リクエスト側: method + X-CSCS-Key + stack を毎回出す（PUT根絶の証拠）
  //   - レスポンス側: 既存の header compare を維持（KV/Key/Identity 比較）
  function _urlOf(input) {
    try {
      return typeof input === "string" ? input : (input && typeof input.url === "string" ? input.url : "");
    } catch (_e) {
      return "";
    }
  }

  function _methodOf(input, init) {
    try {
      var m =
        (init && init.method) ||
        (input && input.method) ||
        "GET";
      return String(m || "GET").toUpperCase();
    } catch (_e) {
      return "GET";
    }
  }

  function _getHeaderFromAnyHeaders(h, name) {
    try {
      if (!h) return "";
      if (typeof h.get === "function") {
        var v = h.get(name);
        return v == null ? "" : String(v);
      }
      if (typeof h === "object") {
        var k1 = name;
        var k2 = String(name || "").toLowerCase();
        var v1 = h[k1];
        if (v1 != null) return String(v1);
        var v2 = h[k2];
        if (v2 != null) return String(v2);
      }
      return "";
    } catch (_e) {
      return "";
    }
  }

  function _pickReqKey(input, init) {
    try {
      var v = "";
      if (init && init.headers) {
        v = _getHeaderFromAnyHeaders(init.headers, "X-CSCS-Key");
        if (v) return v;
      }
      if (input && input.headers) {
        v = _getHeaderFromAnyHeaders(input.headers, "X-CSCS-Key");
        if (v) return v;
      }
      return "";
    } catch (_e) {
      return "";
    }
  }

  function _wantReq(path) {
    // REQ/RESP を観測する対象（PUT根絶・キー流通確認）
    return (
      path === "/api/sync/merge" ||
      path === "/api/sync/state" ||
      path === "/api/sync/init"
    );
  }

  function _logReq(tag, method, url, key, stack, init) {
    // 追加した処理: 毎回「method + key + stack」を必ず出す（PUT根絶の証拠化）
    var ok = method === "POST";
    var verdict = ok ? "✅" : "❌";
    console.groupCollapsed("[CSCS][SYNC][REQ] " + tag + " " + verdict + " method=" + method + " key=" + (key ? "present" : "MISSING") + " url=" + url);
    console.log("method:", method);
    console.log("X-CSCS-Key:", key ? key : "");
    console.log("url:", url);
    console.log("init:", init || null);
    console.log(stack || "");
    console.groupEnd();
  }

  // fetch hook
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = async function (input, init) {
      // 追加した処理: localStorage "cscs_net_watch"==="1" のときだけ観測ログを出す（header_compareも含めてまとめてON/OFF）
      // - OFF の場合は副作用を避けるため、追加のclone/json/text/headersToObject等を一切行わない
      if (!isEnabled()) {
        return _fetch.apply(this, arguments);
      }

      var url0 = "";
      var path0 = "";
      try {
        url0 = _urlOf(input);
        path0 = normalizePath(url0);
      } catch (_e0) {
        url0 = "";
        path0 = "";
      }

      if (!_wantReq(path0)) {
        return _fetch.apply(this, arguments);
      }

      // 追加した処理: REQ情報（method/key/stack/request_body）を先に確定
      var method0 = "GET";
      var key0 = "";
      var stack0 = "";
      try {
        method0 = _methodOf(input, init);
        key0 = _pickReqKey(input, init);
        stack0 = (new Error("[CSCS_SYNC_REQ_WATCH][FETCH] stack")).stack || "";
      } catch (_eReq) {
        method0 = "GET";
        key0 = "";
        stack0 = "";
      }

      // 追加した処理: request body を “見える範囲” で抽出（完全再現は狙わない）
      var reqBodyInfo = null;
      try {
        reqBodyInfo = tryExtractRequestBody(init);
      } catch (_eBody) {
        reqBodyInfo = null;
      }

      // path に応じた論理タグを決定
      // - merge : 実データ送信
      // - state : 状態参照
      // - init  : Accessユーザーに対する key 発行・再発行
      var tag0 =
        path0.endsWith("/merge") ? "merge" :
        path0.endsWith("/state") ? "state" :
        path0.endsWith("/init")  ? "init"  :
        "other";
      var verdict0 = (method0 === "POST") ? "✅" : "❌";
      var groupTitle = "[CSCS][SYNC][NET] " + tag0 + " " + verdict0 + " method=" + method0 + " key=" + (key0 ? "present" : "MISSING") + " url=" + url0;

      var t0 = nowMs();

      // 追加した処理: REQ+RESP を同じ groupCollapsed に統合
      console.groupCollapsed(groupTitle);
      try {
        console.log("[REQ] method:", method0);
        console.log("[REQ] X-CSCS-Key:", key0 ? key0 : "");
        console.log("[REQ] url:", url0);
        console.log("[REQ] init:", init || null);
        console.log("[REQ] request_body:", reqBodyInfo);
        console.log(stack0 || "");
      } catch (_eLog1) {}

      try {
        var resp = await _fetch.apply(this, arguments);
        var dt = Math.round(nowMs() - t0);

        // 追加した処理: response headers を object 化して出す（net_watch相当）
        var hdrObj = {};
        try {
          hdrObj = headersToObject(resp.headers);
        } catch (_eHdr) {
          hdrObj = {};
        }

        // 追加した処理: response body は clone() から読む（本体消費を避ける）
        var bodyPrev = { kind: "unavailable", value: "resp.clone() failed" };
        try {
          var cloned = null;
          try { cloned = resp.clone(); } catch (_eClone) { cloned = null; }
          if (cloned) {
            bodyPrev = await readBodyPreview(cloned);
          }
        } catch (_eRead) {
          bodyPrev = { kind: "read_error", value: safeToString(_eRead) };
        }

        try {
          console.log("[RESP] status:", resp.status);
          console.log("[RESP] ok:", resp.ok);
          console.log("[RESP] elapsed_ms:", dt);
          console.log("[RESP] response_headers:", hdrObj);
          console.log("[RESP] response_body:", bodyPrev);
        } catch (_eLog2) {}

        // 追加した処理: header_compare 用の store を更新（merge/state のヘッダを同一文脈で比較）
        try {
          if (isTarget(path0)) {
            // merge / state / init の Response Headers を保存
            // init は compare 対象ではないが、
            //   - 発行された X-CSCS-Key
            //   - 認証ユーザー（X-CSCS-User）
            // を Network/Console 上で即確認するために保持する
            store[tag0] = pick(resp.headers);

            // 追加した処理: mergeの 400/401 で SYNC_KEY_REQUIRED を補足（既存挙動の維持）
            if (tag0 === "merge" && (resp.status === 400 || resp.status === 401)) {
              var text = "";
              var json = null;
              try {
                text = await resp.clone().text();
              } catch (_e1) {
                text = "";
              }
              try {
                json = JSON.parse(text);
              } catch (_e2) {
                json = null;
              }

              if (resp.status === 400 && json && json.error === "SYNC_KEY_REQUIRED") {
                console.log("[CSCS][SYNC][merge] key missing (X-CSCS-Key header is required)");
              }
            }

            // 追加した処理: compare結果を同じ group の中で出す（REQ/RESPと統合）
            var cmp = compareAndReport();
            if (cmp) {
              console.log("[COMPARE] key_same:", cmp.key_same);
              console.log("[COMPARE] kv_identity_same:", cmp.kv_identity_same);
              console.log("[COMPARE] VERDICT:", cmp.verdict);
              console.table({
                merge: cmp.merge,
                state: cmp.state
              });
            }
          }
        } catch (_eCmp) {}

        console.groupEnd();
        return resp;
      } catch (e) {
        var dt2 = Math.round(nowMs() - t0);
        try {
          console.log("[RESP] (THROW) elapsed_ms:", dt2);
          console.log("[RESP] error:", safeToString(e));
        } catch (_eLog3) {}
        console.groupEnd();
        throw e;
      }
    };
  }

  // XHR hook
  // 追加した処理: XHR でも method/url/key/stack を毎回出す（fetch以外のPUT残存を潰す）
  try {
    var X = window.XMLHttpRequest;
    if (X && X.prototype && typeof X.prototype.open === "function") {
      var _open = X.prototype.open;
      var _send = X.prototype.send;
      var _setHeader = X.prototype.setRequestHeader;

      X.prototype.open = function (method, url) {
        try {
          this.__cscs_xhr_method = String(method || "GET").toUpperCase();
          this.__cscs_xhr_url = String(url || "");
          this.__cscs_xhr_key = "";
          // 追加した処理: XHRでもREQ/RESP統合ログのために開始時刻を保持
          this.__cscs_xhr_t0 = nowMs();
        } catch (_e0) {}
        return _open.apply(this, arguments);
      };

      X.prototype.setRequestHeader = function (name, value) {
        try {
          if (String(name || "").toLowerCase() === "X-CSCS-Key") {
            this.__cscs_xhr_key = value == null ? "" : String(value);
          }
        } catch (_e1) {}
        return _setHeader.apply(this, arguments);
      };

      X.prototype.send = function (body) {
        // 追加した処理: localStorage "cscs_net_watch"==="1" のときだけ観測ログを出す（header_compareも含めてまとめてON/OFF）
        if (!isEnabled()) {
          return _send.apply(this, arguments);
        }

        try {
          var url1 = this.__cscs_xhr_url || "";
          var path1 = normalizePath(url1);
          if (_wantReq(path1)) {
            var self = this;

            // 追加した処理: send時点のREQ情報（method/key/stack/request_body）を確定
            var method1 = self.__cscs_xhr_method || "GET";
            var key1 = self.__cscs_xhr_key || "";
            var stack1 = (new Error("[CSCS_SYNC_REQ_WATCH][XHR] stack")).stack || "";
            var tag1 = path1.endsWith("merge") ? "merge" : "state";
            var verdict1 = (String(method1) === "POST") ? "✅" : "❌";
            var groupTitle1 = "[CSCS][SYNC][NET][xhr] " + tag1 + " " + verdict1 + " method=" + method1 + " key=" + (key1 ? "present" : "MISSING") + " url=" + url1;

            // 追加した処理: request body は文字列ならプレビュー（それ以外は省略）
            var reqBody1 = null;
            try {
              reqBody1 = (typeof body === "string") ? { type: "string", preview: shorten(body, 4000) } : { type: typeof body, preview: "[non-string body omitted]" };
            } catch (_eBody1) {
              reqBody1 = null;
            }

            // 追加した処理: loadendでRESP観測（headers/body）し、同一groupCollapsedに統合
            function done() {
              try {
                var dt = Math.round(nowMs() - (self.__cscs_xhr_t0 || nowMs()));

                // レスポンスヘッダ取得（getAllResponseHeaders）
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
                } catch (_eH) {}

                // レスポンスボディ（textプレビュー、JSONっぽければ parse）
                var respText = "";
                try { respText = typeof self.responseText === "string" ? self.responseText : ""; } catch (_eT) { respText = ""; }

                var bodyPrev = { kind: "text", value: shorten(respText, 6000) };
                try {
                  if (respText && respText[0] === "{") {
                    bodyPrev = { kind: "json", value: JSON.parse(respText) };
                  }
                } catch (_eJ) {}

                console.groupCollapsed(groupTitle1);
                try {
                  console.log("[REQ] method:", method1);
                  console.log("[REQ] X-CSCS-Key:", key1 ? key1 : "");
                  console.log("[REQ] url:", url1);
                  console.log("[REQ] request_body:", reqBody1);
                  console.log(stack1 || "");
                } catch (_eLogA) {}

                try {
                  console.log("[RESP] status:", self.status);
                  console.log("[RESP] ok:", (self.status >= 200 && self.status < 300));
                  console.log("[RESP] elapsed_ms:", dt);
                  console.log("[RESP] response_headers:", respHeaders);
                  console.log("[RESP] response_body:", bodyPrev);
                } catch (_eLogB) {}

                // 追加した処理: header_compare 用の store 更新（XHRのresponse headersから pick できないため、見える範囲だけ扱う）
                // - XHRでは Headers.get が使えないので、pick相当は “対象キーだけ” を lower-case map から読む
                try {
                  var picked = {
                    "X-CSCS-Key": respHeaders["X-CSCS-Key"] ? String(respHeaders["X-CSCS-Key"]) : "",
                    "X-CSCS-User": respHeaders["x-cscs-user"] ? String(respHeaders["x-cscs-user"]) : "",
                    "X-CSCS-KV-Identity": respHeaders["x-cscs-kv-identity"] ? String(respHeaders["x-cscs-kv-identity"]) : ""
                  };
                  store[tag1] = picked;

                  var cmp = compareAndReport();
                  if (cmp) {
                    console.log("[COMPARE] key_same:", cmp.key_same);
                    console.log("[COMPARE] kv_identity_same:", cmp.kv_identity_same);
                    console.log("[COMPARE] VERDICT:", cmp.verdict);
                    console.table({
                      merge: cmp.merge,
                      state: cmp.state
                    });
                  }
                } catch (_eCmp1) {}

                console.groupEnd();
              } catch (_eDone) {}
            }

            try {
              self.addEventListener("loadend", done);
            } catch (_eAdd) {}
          }
        } catch (_e2) {}

        return _send.apply(this, arguments);
      };
    }
  } catch (_eXHR) {}

  console.log("[CSCS][SYNC][HEADER_COMPARE] installed");
})();