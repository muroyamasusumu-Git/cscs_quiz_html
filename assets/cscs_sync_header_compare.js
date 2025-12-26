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

  if (window.__CSCS_SYNC_HEADER_COMPARE__) return;
  window.__CSCS_SYNC_HEADER_COMPARE__ = true;

  var store = {
    merge: null,
    state: null
  };

  function normalizePath(url) {
    try {
      return new URL(url, location.origin).pathname;
    } catch (e) {
      return "";
    }
  }

  function isTarget(path) {
    return path === "/api/sync/merge" || path === "/api/sync/state";
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

  function compareAndReport() {
    if (!store.merge || !store.state) return;

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

    console.groupCollapsed("[CSCS][SYNC][HEADER_COMPARE] 結論確定");
    console.table({
      merge: m,
      state: s
    });
    console.log("key_same:", keySame);
    console.log("kv_identity_same:", kvSame);
    console.log("VERDICT:", verdict);
    console.groupEnd();
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
    return path === "/api/sync/merge" || path === "/api/sync/state";
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
      // 追加した処理: fetch の「呼び出し時点」で method/key/stack を確定しログを出す
      try {
        var url0 = _urlOf(input);
        var path0 = normalizePath(url0);
        if (_wantReq(path0)) {
          var method0 = _methodOf(input, init);
          var key0 = _pickReqKey(input, init);
          var stack0 = (new Error("[CSCS_SYNC_REQ_WATCH][FETCH] stack")).stack || "";
          var tag0 = path0.endsWith("merge") ? "merge" : "state";
          _logReq(tag0, method0, url0, key0, stack0, init);
        }
      } catch (_eReq) {}

      var resp = await _fetch.apply(this, arguments);

      try {
        var path = normalizePath(_urlOf(input));
        if (isTarget(path)) {
          var tag = path.endsWith("merge") ? "merge" : "state";
          store[tag] = pick(resp.headers);

          if (tag === "merge" && (resp.status === 400 || resp.status === 401)) {
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

          compareAndReport();
        }
      } catch (e) {}

      return resp;
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
        } catch (_e0) {}
        return _open.apply(this, arguments);
      };

      X.prototype.setRequestHeader = function (name, value) {
        try {
          if (String(name || "").toLowerCase() === "x-cscs-key") {
            this.__cscs_xhr_key = value == null ? "" : String(value);
          }
        } catch (_e1) {}
        return _setHeader.apply(this, arguments);
      };

      X.prototype.send = function (body) {
        try {
          var url1 = this.__cscs_xhr_url || "";
          var path1 = normalizePath(url1);
          if (_wantReq(path1)) {
            var tag1 = path1.endsWith("merge") ? "merge" : "state";
            var stack1 = (new Error("[CSCS_SYNC_REQ_WATCH][XHR] stack")).stack || "";
            _logReq(tag1, this.__cscs_xhr_method || "GET", url1, this.__cscs_xhr_key || "", stack1, null);
          }
        } catch (_e2) {}
        return _send.apply(this, arguments);
      };
    }
  } catch (_eXHR) {}

  console.log("[CSCS][SYNC][HEADER_COMPARE] installed");
})();