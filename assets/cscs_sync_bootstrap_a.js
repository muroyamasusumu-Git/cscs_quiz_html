// assets/cscs_sync_bootstrap_a.js
// 目的:
//   - /api/sync/init (POST) を叩いて sync key を確定する
//   - key を localStorage と window 共有 Promise に格納する
//   - 後続が待てるように window.dispatchEvent(new Event("cscs:syncKeyReady")) を投げる
//
// 【最重要ルール（プロジェクト恒久・見落とし防止）】
//   /api/sync/state を叩く処理を含む JS は、必ずこの bootstrap の「処理完了後」に起動すること。
//   ここでいう「処理完了」は、次のいずれかを満たしたタイミングを指す（同値）:
//     1) window.__CSCS_SYNC_KEY_PROMISE__ が resolve した後
//     2) window に sync key が確定し、"cscs:syncKeyReady" イベントが dispatch された後
//
//   理由:
//     state.ts は "X-CSCS-Key" 必須で、キー未確定のまま /api/sync/state を叩くと
//     missing key / 403 等で落ち、ODOA / oncePerDayToday / consistency_status の参照が破綻する。
//     よって、後続は必ず window.__CSCS_SYNC_KEY_PROMISE__.then(...) で待ってから実行する。
//     （localStorage の値だけで確定扱いして開始するのは禁止。最終確定はサーバー init の結果。）
//
// 整合性（必須）:
//   - init.ts は key を `sync:<lowercase email>` で確定して返す
//   - state.ts は X-CSCS-Key を必須とし、かつ `sync:<authenticated user>` と一致しないと 403
//
// 方針（プロジェクト恒久）:
//   - 推測フォールバックはしない（失敗は失敗として console.error で確定させる）
//   - ただし「同一ページ内の多重起動」は window 共有 Promise で抑止する
//
// ★ 追加（統合）:
//   - window.CSCS_BOOTSTRAP_GATE_QUEUE に列挙された JS を
//     「bootstrap 完了後にだけ」逐次 inject する（gate 機能を内蔵）
//   - bootstrap が失敗した場合は inject しない（フォールバック無し）
//
// ============================================================
// 全体像（このファイルがやっていること / 実行順）
// ------------------------------------------------------------
// 0) 二重起動防止:
//    - 既に window.__CSCS_SYNC_KEY_PROMISE__ があれば何もせず終了
//
// 1) bootstrap 本体（SYNCキー確定）:
//    - /api/sync/init を POST して「サーバー確定の sync key」を取得
//    - 取得した key を window と localStorage に保存
//    - "cscs:syncKeyReady" を dispatch して「完了」を通知
//    - これらを window.__CSCS_SYNC_KEY_PROMISE__ の resolve で表現する
//
// 2) 診断UI（A側の手動initボタン）:
//    - UIから init→state の確認を行う補助導線
//    - ただし /api/sync/state は必ず Promise resolve 後にだけ叩く
//
// 3) gate（統合機能: 後続JSの遅延ロード）:
//    - window.CSCS_BOOTSTRAP_GATE_QUEUE に列挙されたJSを
//      「bootstrap Promise resolve後」にだけ順番に <script> 注入
//    - つまり /api/sync/state を叩くJSを HTML直読みせず、必ず bootstrap 待ちにできる
// ============================================================

(function () {
  "use strict";

  var INIT_ENDPOINT = "/api/sync/init";

  // localStorage に保存するキー名（フロント側の “唯一の保管場所” として扱う）
  var LS_SYNC_KEY = "cscs_sync_key";

  // window に保存する共有スロット（同一ページ内の多重起動を防ぐ）
  var WIN_PROMISE = "__CSCS_SYNC_KEY_PROMISE__";
  var WIN_KEY = "__CSCS_SYNC_KEY__";
  var WIN_USER = "__CSCS_SYNC_USER__";

  // ============================================================
  // ★ Gate: 二重起動防止フラグ（統合機能）
  //   - gate は bootstrap 完了後に queue を注入するだけなので、
  //     これも二重起動すると script を二重注入しうる
  // ============================================================
  var WIN_GATE_INSTALLED = "__CSCS_BOOTSTRAP_GATE_INSTALLED__";

  // ============================================================
  // 0) 二重起動防止（bootstrapの多重実行を抑止）
  //   - SPA遷移・再評価・A/B遷移などで同じJSが複数回実行されても、
  //     既存の Promise を“唯一の真実”として再利用する
  // ============================================================
  if (window[WIN_PROMISE] && typeof window[WIN_PROMISE].then === "function") {
    return;
  }

  // ============================================================
  // 文字列ユーティリティ
  //   - ここでの判定は「推測確定」ではなく “最小限の検査” だけ
  // ============================================================
  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  // ============================================================
  // key 形式の最小検証
  //   - サーバーが返すべき形式は sync:<email>
  //   - 厳密なメール形式の検証はしない（クライアント推測を増やさない）
  // ============================================================
  function looksLikeSyncKey(v) {
    if (!isNonEmptyString(v)) return false;
    return v.indexOf("sync:") === 0 && v.length > "sync:".length;
  }

  // ============================================================
  // 2) 診断UI（A側UIバインド / strict）
  //   - 目的: UI で「init済みか？stateは200か？」を一発で把握する
  //   - ルール: /api/sync/state は必ず bootstrap 完了後のみ
  // ============================================================
  window.CSCS_SYNC_INIT_BIND_A_STRICT = function (box) {
    try {
      const initBtn = box.querySelector('button[data-sync-init="1"]');

      function ensureMiniStatusWindow() {
        const WIN_ID = "cscs_sync_mini_status_window";
        const STYLE_ID = "cscs_sync_mini_status_style";

        function ensureMiniStatusStyle() {
          try {
            if (document.getElementById(STYLE_ID)) return;

            const css = `
.cscs-sync-mini{
  background: rgba(0,0,0,.75);
  color: #fff;
  padding: 6px 8px;
  border-radius: 8px;
  font: 12px/1.2 ui-monospace, Menlo, Consolas, monospace;
  box-shadow: 0 6px 18px rgba(0,0,0,.25);
  pointer-events: none;
}

.cscs-sync-mini-row{
  display: flex;
  gap: 6px;
}

.cscs-sync-mini-label{
  opacity: .8;
}
`.trim();

            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.type = "text/css";
            style.appendChild(document.createTextNode(css));

            const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
            head.appendChild(style);
          } catch (_) {}
        }

        ensureMiniStatusStyle();

        const existing = document.getElementById(WIN_ID);
        if (existing) {
          return {
            root: existing,
            elKey: existing.querySelector('[data-mini="key"]'),
            elState: existing.querySelector('[data-mini="state"]')
          };
        }

        const root = document.createElement("div");
        root.id = WIN_ID;
        root.setAttribute("role", "status");
        root.className = "cscs-sync-mini";

        // ★ 最低限だけJSで固定（位置や重なり）
        root.style.position = "fixed";
        root.style.right = "10px";
        root.style.bottom = "10px";
        root.style.zIndex = "2147483647";

        const rowKey = document.createElement("div");
        rowKey.className = "cscs-sync-mini-row cscs-sync-mini-row-key";
        const labelKey = document.createElement("span");
        labelKey.className = "cscs-sync-mini-label cscs-sync-mini-label-key";
        labelKey.textContent = "key:";
        const vKey = document.createElement("span");
        vKey.className = "cscs-sync-mini-value cscs-sync-mini-value-key";
        vKey.setAttribute("data-mini", "key");
        vKey.textContent = "-";
        rowKey.appendChild(labelKey);
        rowKey.appendChild(vKey);
        root.appendChild(rowKey);

        const rowState = document.createElement("div");
        rowState.className = "cscs-sync-mini-row cscs-sync-mini-row-state";
        const labelState = document.createElement("span");
        labelState.className = "cscs-sync-mini-label cscs-sync-mini-label-state";
        labelState.textContent = "state:";
        const vState = document.createElement("span");
        vState.className = "cscs-sync-mini-value cscs-sync-mini-value-state";
        vState.setAttribute("data-mini", "state");
        vState.textContent = "-";
        rowState.appendChild(labelState);
        rowState.appendChild(vState);
        root.appendChild(rowState);

        const mount = document.body || document.documentElement;
        mount.appendChild(root);

        return { root: root, elKey: vKey, elState: vState };
      }

      const mini = ensureMiniStatusWindow();
      const elKey = mini && mini.elKey ? mini.elKey : null;
      const elState = mini && mini.elState ? mini.elState : null;

      // localStorage の key を「空文字は欠損」として読む（推測はしない）
      function readLocalSyncKeyStrict() {
        try {
          const v = localStorage.getItem(LS_SYNC_KEY);
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          return s === "" ? null : s;
        } catch (_) {
          return null;
        }
      }

      // UI の現在値を更新する（欠損は欠損のまま出す）
      function refreshInitUiSnapshotStrict(stateStatus, userEmailFromHeader) {
        try {
          const k = readLocalSyncKeyStrict();
          if (elKey) elKey.textContent = (k !== null) ? "present" : "missing";
        } catch (_) {}

        try {
          if (elState) {
            if (typeof stateStatus === "number" && Number.isFinite(stateStatus)) {
              elState.textContent = String(stateStatus);
            } else {
              elState.textContent = "MISSING";
            }
          }
        } catch (_) {}
      }

      // /api/sync/state を叩いて「ヘッダの user」「HTTP status」を返す
      // ★ 重要: bootstrap Promise を必ず await する（= key確定待ち）
      async function fetchStateWithKeyStrict() {
        if (window[WIN_PROMISE] && typeof window[WIN_PROMISE].then === "function") {
          await window[WIN_PROMISE];
        }

        const k = readLocalSyncKeyStrict();
        if (k === null) {
          return { ok: false, status: null, user: null };
        }

        const r = await fetch("/api/sync/state", {
          method: "GET",
          credentials: "include",
          headers: {
            "X-CSCS-Key": k
          }
        });

        let userEmail = null;
        try {
          const u = r.headers ? r.headers.get("X-CSCS-User") : null;
          if (u !== null && u !== undefined) {
            const s = String(u).trim();
            userEmail = (s === "") ? null : s;
          }
        } catch (_) {
          userEmail = null;
        }

        return { ok: (r.status === 200), status: r.status, user: userEmail };
      }

      // 手動 init ボタン: init(POST) → 保存 → state(GET) で整合確認 → UI更新
      async function runInitFlowStrict() {
        const existedKey = (readLocalSyncKeyStrict() !== null);
        const force = existedKey ? true : false;

        let initStatus = null;
        let stateStatus = null;
        let userEmail = null;

        try {
          const initRes = await fetch(INIT_ENDPOINT, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: force })
          });

          initStatus = initRes.status;

          if (initRes.status === 200) {
            let key = null;
            try {
              const j = await initRes.json();
              if (j && Object.prototype.hasOwnProperty.call(j, "key")) {
                const raw = j.key;
                if (raw !== null && raw !== undefined) {
                  const s = String(raw).trim();
                  key = (s === "") ? null : s;
                }
              }
            } catch (_) {
              key = null;
            }

            if (key !== null) {
              try {
                localStorage.setItem(LS_SYNC_KEY, key);
              } catch (_) {}
              try {
                window[WIN_KEY] = key;
              } catch (_) {}
            }
          }

          const st = await fetchStateWithKeyStrict();
          stateStatus = st.status;
          userEmail = st.user;

          refreshInitUiSnapshotStrict(stateStatus, userEmail);

          if (initStatus === 200 && stateStatus === 200) {
            console.log("✅ INIT+STATE OK (init=" + initStatus + ", state=" + stateStatus + ")");
          } else {
            console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
          }
        } catch (e) {
          refreshInitUiSnapshotStrict(stateStatus, userEmail);
          console.log("❌ INIT+STATE FAILED (init=" + initStatus + ", state=" + stateStatus + ")");
        }
      }

      // 起動直後: まず key の present/missing を表示（state はまだ叩かない）
      refreshInitUiSnapshotStrict(null, null);

      // 起動直後: bootstrap 完了後にだけ state を叩いて status を埋める
      try {
        (async function () {
          try {
            const st0 = await fetchStateWithKeyStrict();
            refreshInitUiSnapshotStrict(st0.status, st0.user);
          } catch (_e0) {
            refreshInitUiSnapshotStrict(null, null);
          }
        })();
      } catch (_e1) {}

      if (initBtn) {
        initBtn.addEventListener("click", function () {
          runInitFlowStrict();
        });
      }
    } catch (_) {}
  };

  // ============================================================
  // localStorage I/O（例外を外へ出さない）
  //   - “保存に失敗” は起こりうるので boolean を返す（診断ログ用）
  // ============================================================
  function writeLocalStorage(key, val) {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function readLocalStorage(key) {
    try {
      var v = localStorage.getItem(key);
      return typeof v === "string" ? v : "";
    } catch (_e) {
      return "";
    }
  }

  // ============================================================
  // bootstrap 確定処理:
  //   - window と localStorage を更新し、event を dispatch する
  //   - “この時点で bootstrap 完了” とみなせる（後続が待てる）
  // ============================================================
  function commitResolvedKey(user, key) {
    window[WIN_USER] = user;
    window[WIN_KEY] = key;

    var lsOk = writeLocalStorage(LS_SYNC_KEY, key);

    var eventOk = false;
    try {
      window.dispatchEvent(new Event("cscs:syncKeyReady"));
      eventOk = true;
    } catch (_e) {
      try {
        var ev = document.createEvent("Event");
        ev.initEvent("cscs:syncKeyReady", true, true);
        window.dispatchEvent(ev);
        eventOk = true;
      } catch (_e2) {
        eventOk = false;
      }
    }

    try {
      console.log("[CSCS][sync_bootstrap] OK: sync key resolved + stored + event dispatched", {
        endpoint: INIT_ENDPOINT,
        key: key,
        user: typeof user === "string" ? user : "",
        lsOk: lsOk ? "1" : "0",
        eventOk: eventOk ? "1" : "0"
      });
    } catch (_e3) {}
  }

  // ============================================================
  // 1) /api/sync/init を叩いて key をサーバー確定する（bootstrapの心臓部）
  //   - 15秒で abort（長時間待つようなフォールバックはしない）
  //   - header または body から key を取り、形式をチェックして確定
  //   - 失敗時は Promise reject（後続は “動かない” のが正）
  // ============================================================
  function fetchInitAndResolve() {
    var ctrl = null;
    var timer = null;

    try {
      ctrl = new AbortController();
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_e) {}
      }, 15000);
    } catch (_e) {
      ctrl = null;
      timer = null;
    }

    var fetchOpts = {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    };

    if (ctrl && ctrl.signal) {
      fetchOpts.signal = ctrl.signal;
    }

    return fetch(INIT_ENDPOINT, fetchOpts)
      .then(function (res) {
        if (timer) {
          try {
            clearTimeout(timer);
          } catch (_e) {}
        }

        var hk = "";
        var hu = "";

        try {
          hk = res.headers.get("X-CSCS-Key") || "";
        } catch (_e) {
          hk = "";
        }

        try {
          hu = res.headers.get("X-CSCS-User") || "";
        } catch (_e2) {
          hu = "";
        }

        if (!res.ok) {
          return res.text().then(function (t) {
            var msg = "[CSCS][sync_bootstrap] /api/sync/init failed: status=" + res.status + " body=" + String(t || "");
            throw new Error(msg);
          });
        }

        return res.json().then(function (data) {
          var keyFromBody = "";
          var userFromBody = "";

          if (data && typeof data === "object") {
            if (typeof data.key === "string") keyFromBody = data.key;
            if (typeof data.user === "string") userFromBody = data.user;
          }

          var finalKey = isNonEmptyString(hk) ? hk.trim() : String(keyFromBody || "").trim();
          var finalUser = isNonEmptyString(hu) ? hu.trim() : String(userFromBody || "").trim();

          if (!looksLikeSyncKey(finalKey)) {
            throw new Error("[CSCS][sync_bootstrap] init returned invalid key: " + String(finalKey || ""));
          }

          commitResolvedKey(finalUser, finalKey);
          return finalKey;
        });
      })
      .catch(function (e) {
        if (timer) {
          try {
            clearTimeout(timer);
          } catch (_e) {}
        }

        try {
          console.error("[CSCS][sync_bootstrap] init failed:", e);
        } catch (_e2) {}

        throw e;
      });
  }

  // ============================================================
  // 3) Gate（統合機能）:
  //   - queue に入れた JS を bootstrap 完了後にだけ順番に inject する
  //   - HTML直読みの <script src="..."> をやめてここに集約すれば、
  //     “stateを叩くJSがbootstrap前に走る”事故を構造的に防げる
  // ============================================================
  function gateLog() {
    try {
      console.log.apply(console, arguments);
    } catch (_) {}
  }

  function gateErr() {
    try {
      console.error.apply(console, arguments);
    } catch (_) {}
  }

  // queue 取得（未定義なら空）: {src, id} の配列
  function getGateQueue() {
    var q = window.CSCS_BOOTSTRAP_GATE_QUEUE;
    if (!Array.isArray(q)) return [];
    return q;
  }

  // 既に読み込まれた script を検出（id優先 / なければsrc一致）
  function gateAlreadyLoaded(item) {
    try {
      var id = item && item.id ? String(item.id) : "";
      var src = item && item.src ? String(item.src) : "";
      if (id) {
        if (document.getElementById(id)) return true;
      }
      if (src) {
        var scripts = document.getElementsByTagName("script");
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          var ssrc = s && s.getAttribute ? (s.getAttribute("src") || "") : "";
          if (ssrc && ssrc === src) return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  // script を1つ注入（defer/async無し：順序を守るため）
  function gateInjectOne(item) {
    return new Promise(function (resolve, reject) {
      try {
        if (!item || !item.src) {
          reject(new Error("missing src"));
          return;
        }

        if (gateAlreadyLoaded(item)) {
          resolve({ ok: true, skipped: true, src: String(item.src) });
          return;
        }

        var s = document.createElement("script");
        s.src = String(item.src);

        if (item.id) {
          s.id = String(item.id);
        }

        s.onload = function () {
          resolve({ ok: true, skipped: false, src: String(item.src) });
        };
        s.onerror = function () {
          reject(new Error("failed to load: " + String(item.src)));
        };

        var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
        head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  // queue を順番通りに逐次 inject（A→Bみたいに順序が重要なJS向け）
  function gateInjectAllInOrder(queue) {
    var p = Promise.resolve();
    for (var i = 0; i < queue.length; i++) {
      (function (item) {
        p = p.then(function () {
          return gateInjectOne(item).then(function (r) {
            gateLog("[CSCS][gate] loaded:", r);
            return r;
          });
        });
      })(queue[i]);
    }
    return p;
  }

  // bootstrap 完了後に gate を走らせる（bootstrap失敗なら inject しない）
  function runGateAfterBootstrap() {
    if (window[WIN_GATE_INSTALLED]) return;
    window[WIN_GATE_INSTALLED] = true;

    var queue = getGateQueue();
    if (queue.length === 0) {
      return;
    }

    if (!window[WIN_PROMISE] || typeof window[WIN_PROMISE].then !== "function") {
      gateErr("[CSCS][gate] __CSCS_SYNC_KEY_PROMISE__ not found. scripts NOT injected.");
      return;
    }

    window[WIN_PROMISE]
      .then(function (reasonKey) {
        gateLog("[CSCS][gate] bootstrap ready -> inject queue", { resolvedKey: String(reasonKey || "") });
        return gateInjectAllInOrder(queue);
      })
      .then(function () {
        gateLog("[CSCS][gate] all scripts injected.");
      })
      .catch(function (e) {
        gateErr("[CSCS][gate] bootstrap failed. scripts NOT injected.", e);
      });
  }

  // ============================================================
  // 1) bootstrap Promise を window にセット（後続はこれを待てる）
  //   - localStorage の key があっても “それだけで確定扱いしない”
  //   - 必ず /api/sync/init の結果で確定して resolve する
  // ============================================================
  window[WIN_PROMISE] = new Promise(function (resolve, reject) {
    // localStorage は “観測用の値” として window に一旦置くだけ（最終確定はサーバー）
    var lsKey = readLocalStorage(LS_SYNC_KEY);
    if (looksLikeSyncKey(lsKey)) {
      window[WIN_KEY] = lsKey;
    }

    fetchInitAndResolve()
      .then(function (key) {
        resolve(key);
      })
      .catch(function (e) {
        reject(e);
      });
  });

  // 3) gate 起動（Promise作成後に必ず実行）
  runGateAfterBootstrap();

})();