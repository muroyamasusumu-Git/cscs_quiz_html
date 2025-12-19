// assets/cscs_sync_view_b.js
(function () {
  "use strict";

  var SYNC_STATE_ENDPOINT = "/api/sync/state";
  var SYNC_MERGE_ENDPOINT = "/api/sync/merge";

  /**
   * CSCS SYNC ビュー（Bパート）で使用しているキー対応表
   * LocalStorage ⇔ SYNC(JSON) / payload の対応（qid は "YYYYMMDD-NNN"）
   *
   * 【重要：開発ルール（恒久）】
   *   📌 このファイルで使用する LocalStorage / SYNC キー名に
   *       「変更」または「新規追加」が発生した場合は、
   *       必ず **本キー対応表コメントに追記すること**。
   *   - b_judge_record.js・SYNC Worker（merge/state.ts）側と
   *     キー仕様の不整合が生じることを防ぐ目的。
   *   - ここに書かれていないキーは原則として使用禁止。
   *
   * ▼ 問題別累計
   *   - localStorage: "cscs_q_correct_total:" + qid
   *       ⇔ SYNC state: state.correct[qid]
   *   - localStorage: "cscs_q_wrong_total:" + qid
   *       ⇔ SYNC state: state.incorrect[qid]
   *
   * ▼ 問題別 3 連続正解（⭐️用）
   *   - localStorage: "cscs_q_correct_streak3_total:" + qid
   *       ⇔ SYNC state: state.streak3[qid]
   *   - localStorage: "cscs_q_correct_streak_len:" + qid
   *       ⇔ SYNC state: state.streakLen[qid]
   *   - payload(merge): streak3Delta[qid] / streakLenDelta[qid]
   *
   * ▼ 問題別 3 連続不正解
   *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
   *       ⇔ SYNC state: state.streak3Wrong[qid]
   *   - localStorage: "cscs_q_wrong_streak_len:" + qid
   *       ⇔ SYNC state: state.streakWrongLen[qid]
   *   - payload(merge): streak3WrongDelta[qid] / streakWrongLenDelta[qid]
   *
   * ▼ 今日の⭐️ユニーク数（Streak3Today）
   *   - localStorage: "cscs_streak3_today_day"
   *       ⇔ SYNC state: state.streak3Today.day
   *   - localStorage: "cscs_streak3_today_qids"
   *       ⇔ SYNC state: state.streak3Today.qids
   *   - localStorage: "cscs_streak3_today_unique_count"
   *       ⇔ SYNC state: state.streak3Today.unique_count
   *   - payload(merge): streak3TodayDelta { day, qids }
   *
   * ▼ 今日の3連続不正解ユニーク数（Streak3WrongToday）
   *   - localStorage: "cscs_streak3_wrong_today_day"
   *       ⇔ SYNC state: state.streak3WrongToday.day
   *   - localStorage: "cscs_streak3_wrong_today_qids"
   *       ⇔ SYNC state: state.streak3WrongToday.qids
   *   - localStorage: "cscs_streak3_wrong_today_unique_count"
   *       ⇔ SYNC state: state.streak3WrongToday.unique_count
   *   - payload(merge): streak3WrongTodayDelta { day, qids }
   *
   * ▼ 1 日 1 回計測モード（oncePerDayToday）
   *   - localStorage: "cscs_once_per_day_today_day"
   *       ⇔ SYNC state: state.oncePerDayToday.day
   *   - localStorage: "cscs_once_per_day_today_results"
   *       ⇔ SYNC state: state.oncePerDayToday.results[qid]
   *   - payload(merge): oncePerDayTodayDelta { day, results }
   *
   * ▼ 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）
   *   - localStorage: "cscs_q_last_seen_day:" + qid
   *       ⇔ SYNC state: state.lastSeenDay[qid]
   *   - localStorage: "cscs_q_last_correct_day:" + qid
   *       ⇔ SYNC state: state.lastCorrectDay[qid]
   *   - localStorage: "cscs_q_last_wrong_day:" + qid
   *       ⇔ SYNC state: state.lastWrongDay[qid]
   *   - payload(merge): lastSeenDayDelta[qid] / lastCorrectDayDelta[qid] / lastWrongDayDelta[qid]
   *
   * ▼ グローバル情報
   *   - localStorage: "cscs_total_questions"
   *       ⇔ payload(merge): global.totalQuestions
   *
   * ▼ O.D.O.A / 検証モード関連
   *   - SYNC state: state.odoaMode / state.odoa_mode / state.ODOA_MODE
   *   - SYNC state: state.debug.odoaMode / state.debug.odoa_mode / state.debug.ODOA_MODE
   *   - SYNC state: state.navGuard.odoaMode / state.navGuard.odoa_mode
   *   - runtime: window.CSCS_VERIFY_MODE ("on" / "off")
   */

  // ★ HUD 用：直近に表示した O.D.O.A ステータス文字列を保持しておく
  var LAST_ODOA_STATUS = "";

  // ★ このファイル内で管理する CSS（ここにどんどん追記していく）
  //   - #cscs_sync_view_b が現行のパネルID
  //   - 将来 #cscs_sync_monitor_b に変えても同じCSSが効くよう、両方を対象にしている
  var CSCS_SYNC_VIEW_B_CSS = [
    "/* cscs_sync_view_b.js injected CSS */",
    "#cscs_sync_view_b,",
    "#cscs_sync_monitor_b {",
    "  position: fixed;",
    "  right: 15px;",
    "  top: 100px;",
    "  color: #eee;",
    "  padding: 8px;",
    "  font: 11px/1.2 system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;",
    "  max-width: 46vw;",
    "  width: 330px;",
    "  opacity: 0.55;",
    "  z-index: 2147483647;",
    "}",
    "",
    "/* --- card layout for status body --- */",
    "#cscs_sync_view_b_title {",
    "  text-align: right;",
    "  margin-right: 3px;",
    "}",
    "",
    "#cscs_sync_view_b_body {",
    "  display: grid;",
    "  grid-template-columns: 1fr;",
    "  gap: 6px;",
    "  margin-top: 6px;",
    "  padding-top: 0px;",
    "  border-top: none;",
    "}",
    "",
    "/* --- 3連続（正解/不正解）4枚を 2列×2段で固定配置 --- */",
    "#cscs_sync_view_b_body .svb-streak-quad {",
    "  display: grid;",
    "  grid-template-columns: 1fr 1fr;",
    "  gap: 6px;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-streak-quad .svb-streak-card {",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card {",
    "  background: rgba(0,0,0,0.22);",
    "  border: 1px solid rgba(255,255,255,0.10);",
    "  border-radius: 8px;",
    "  padding: 6px 7px;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card.is-wide {",
    "  grid-column: 1 / -1;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card-title {",
    "  font-weight: 800;",
    "  opacity: 0.90;",
    "  margin-bottom: 5px;",
    "  letter-spacing: 0.2px;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-title-suffix {",
    "  font-size: 9px;",
    "  font-weight: 600;",
    "  opacity: 0.55;",
    "  margin-left: 6px;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-card-grid {",
    "  display: grid;",
    "  grid-template-columns: 1fr auto;",
    "  column-gap: 10px;",
    "  row-gap: 2px;",
    "  opacity: 0.60;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-k {",
    "  opacity: 0.85;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-v {",
    "  text-align: right;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .cscs-svb-muted {",
    "  opacity: 0.70;",
    "}",
    "",
    "/* --- Counts: 1行（Counts + SYNC/local/diff を横一列） --- */",
    "#cscs_sync_view_b_body .svb-counts-inline {",
    "  display: flex;",
    "  align-items: baseline;",
    "  gap: 10px;",
    "  white-space: nowrap;",
    "  overflow: hidden;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-head {",
    "  font-weight: 800;",
    "  opacity: 0.90;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-part {",
    "  display: inline-flex;",
    "  align-items: baseline;",
    "  justify-content: center;",
    "  gap: 6px;",
    "  flex: 1 1 0;",
    "  min-width: 0;",
    "  text-align: center;",
    "  box-shadow: none;",
    "  background: transparent;",
    "  border: none;",
    "  padding: 0;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-part.is-muted {",
    "  opacity: 0.78;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-k {",
    "  opacity: 0.85;",
    "  white-space: nowrap;",
    "}",
    "",
    "#cscs_sync_view_b_body .svb-counts-inline .svb-counts-v {",
    "  text-align: left;",
    "  font-variant-numeric: tabular-nums;",
    "  white-space: nowrap;",
    "}",
    ""
  ].join("\n");

  // ★ styleタグを1回だけ注入（同じidがあれば中身を更新して上書き）
  function upsertStyleTag(styleId, cssText) {
    try {
      var head = document.head || document.getElementsByTagName("head")[0] || null;
      if (!head) {
        return;
      }

      var el = document.getElementById(styleId);
      if (!el) {
        el = document.createElement("style");
        el.id = styleId;
        el.type = "text/css";
        head.appendChild(el);
      }

      if (el.textContent !== cssText) {
        el.textContent = cssText;
      }
    } catch (e) {
      console.error("[SYNC-B:view] upsertStyleTag failed:", e);
    }
  }

  function ensureSyncViewBStyles() {
    upsertStyleTag("cscs_sync_view_b_inline_css", CSCS_SYNC_VIEW_B_CSS);
  }

  function detectInfo() {
    var path = window.location.pathname || "";
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) return null;
    var day = m[1];
    var num3 = m[2];
    var qid = day + "-" + num3;
    return { day: day, num3: num3, qid: qid };
  }

  var info = detectInfo();
  if (!info) {
    return;
  }

  function readIntFromLocalStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        return 0;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        return 0;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read int from localStorage:", key, e);
      return 0;
    }
  }

  // ★ JST 日付(YYYYMMDD) を localStorage から安全に読み出すヘルパー
  //   - 正規の "YYYYMMDD" でなければ null を返し、SYNC には載せない
  function readDayFromLocalStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined || raw === "") {
        return null;
      }
      if (!/^\d{8}$/.test(raw)) {
        return null;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read day from localStorage:", key, e);
      return null;
    }
  }

  // ★ 総問題数 cscs_total_questions を安全に読み出す専用ヘルパー
  //   - 正の整数として保存されていなければ null を返し、送信しない
  function readTotalQuestionsFromLocalStorage() {
    var key = "cscs_total_questions";
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        return null;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read cscs_total_questions:", e);
      return null;
    }
  }

  // ★ oncePerDay ローカル状態を読み出す
  //   - day: number | null（YYYYMMDD）
  //   - results: { qid: "correct" | "wrong" }
  function readOncePerDayTodayFromLocal() {
    var dayStr = null;
    try {
      dayStr = window.localStorage.getItem("cscs_once_per_day_today_day");
    } catch (_e) {
      dayStr = null;
    }

    var results = {};
    try {
      var raw = window.localStorage.getItem("cscs_once_per_day_today_results") || "{}";
      results = JSON.parse(raw);
    } catch (_e2) {
      results = {};
    }
    if (!results || typeof results !== "object") {
      results = {};
    }

    var dayNum = null;
    if (dayStr && /^\d{8}$/.test(dayStr)) {
      var n = parseInt(dayStr, 10);
      if (Number.isFinite(n)) {
        dayNum = n;
      }
    }

    return {
      day: dayNum,
      results: results
    };
  }
  
    // ★ HUD用：送信待機（SYNC未反映っぽいもの）を判定して返す
  //   - ローカルと SYNC(state) を比較して「未反映の可能性」を拾う
  //   - フォールバックで別ソースを見ない（localStorage と window.__cscs_sync_state のみ）
  function computePendingFlags(syncState, qid) {
    var flags = {
      pendingDiffCounts: false,
      pendingOncePerDayToday: false,
      pendingLastSeenDay: false,
      pendingLastCorrectDay: false,
      pendingLastWrongDay: false,
      pendingStreak3Today: false,
      pendingStreak3WrongToday: false,
      details: []
    };

    try {
      // ---- oncePerDayToday（このqidがSYNCに入ってるか）----
      try {
        var localOnce = readOncePerDayTodayFromLocal();
        if (localOnce && typeof localOnce.day === "number" && localOnce.results && typeof localOnce.results === "object") {
          var localOnceVal = localOnce.results[qid];
          if (localOnceVal === "correct" || localOnceVal === "wrong") {
            var serverOnceVal = null;
            if (syncState &&
                syncState.oncePerDayToday &&
                typeof syncState.oncePerDayToday === "object" &&
                typeof syncState.oncePerDayToday.day === "number" &&
                syncState.oncePerDayToday.results &&
                typeof syncState.oncePerDayToday.results === "object") {
              if (syncState.oncePerDayToday.day === localOnce.day) {
                if (Object.prototype.hasOwnProperty.call(syncState.oncePerDayToday.results, qid)) {
                  serverOnceVal = syncState.oncePerDayToday.results[qid];
                }
              }
            }
            if (serverOnceVal !== localOnceVal) {
              flags.pendingOncePerDayToday = true;
              flags.details.push("oncePerDayToday");
            }
          }
        }
      } catch (_eOnce) {}

      // ---- lastDay（localに値があり、SYNCと違う）----
      try {
        var locSeen = readDayFromLocalStorage("cscs_q_last_seen_day:" + qid);
        var locCor  = readDayFromLocalStorage("cscs_q_last_correct_day:" + qid);
        var locWro  = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qid);

        var srvSeen = null;
        var srvCor  = null;
        var srvWro  = null;

        if (syncState) {
          if (syncState.lastSeenDay && typeof syncState.lastSeenDay === "object" && syncState.lastSeenDay[qid] != null) {
            if (typeof syncState.lastSeenDay[qid] === "number" && Number.isFinite(syncState.lastSeenDay[qid]) && syncState.lastSeenDay[qid] > 0) {
              srvSeen = syncState.lastSeenDay[qid];
            }
          }
          if (syncState.lastCorrectDay && typeof syncState.lastCorrectDay === "object" && syncState.lastCorrectDay[qid] != null) {
            if (typeof syncState.lastCorrectDay[qid] === "number" && Number.isFinite(syncState.lastCorrectDay[qid]) && syncState.lastCorrectDay[qid] > 0) {
              srvCor = syncState.lastCorrectDay[qid];
            }
          }
          if (syncState.lastWrongDay && typeof syncState.lastWrongDay === "object" && syncState.lastWrongDay[qid] != null) {
            if (typeof syncState.lastWrongDay[qid] === "number" && Number.isFinite(syncState.lastWrongDay[qid]) && syncState.lastWrongDay[qid] > 0) {
              srvWro = syncState.lastWrongDay[qid];
            }
          }
        }

        if (locSeen !== null && locSeen !== srvSeen) {
          flags.pendingLastSeenDay = true;
          flags.details.push("lastSeenDay");
        }
        if (locCor !== null && locCor !== srvCor) {
          flags.pendingLastCorrectDay = true;
          flags.details.push("lastCorrectDay");
        }
        if (locWro !== null && locWro !== srvWro) {
          flags.pendingLastWrongDay = true;
          flags.details.push("lastWrongDay");
        }
      } catch (_eLast) {}

      // ---- streak3Today（local qidsがあるのにSYNC側に反映されてなさそう）----
      try {
        var localDay = "";
        var localQids = [];
        try {
          localDay = localStorage.getItem("cscs_streak3_today_day") || "";
          var raw = localStorage.getItem("cscs_streak3_today_qids");
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              localQids = parsed.filter(function (x) { return typeof x === "string" && x; });
            }
          }
        } catch (_eS3t) {
          localDay = "";
          localQids = [];
        }

        if (localDay && localQids.length > 0) {
          var syncDay = "";
          var syncQids = [];
          if (syncState && syncState.streak3Today && typeof syncState.streak3Today === "object") {
            if (typeof syncState.streak3Today.day === "number" && Number.isFinite(syncState.streak3Today.day)) {
              syncDay = String(syncState.streak3Today.day);
            }
            if (Array.isArray(syncState.streak3Today.qids)) {
              syncQids = syncState.streak3Today.qids.filter(function (x) { return typeof x === "string" && x; });
            }
          }

          var missing = false;
          if (syncDay !== localDay) {
            missing = true;
          } else {
            var set = Object.create(null);
            for (var i = 0; i < syncQids.length; i++) {
              set[syncQids[i]] = 1;
            }
            for (var j = 0; j < localQids.length; j++) {
              if (!set[localQids[j]]) {
                missing = true;
                break;
              }
            }
          }

          if (missing) {
            flags.pendingStreak3Today = true;
            flags.details.push("streak3Today");
          }
        }
      } catch (_eS3t2) {}

      // ---- streak3WrongToday（local qidsがあるのにSYNC側に反映されてなさそう）----
      try {
        var localDayW = "";
        var localQidsW = [];
        try {
          localDayW = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
          var rawW = localStorage.getItem("cscs_streak3_wrong_today_qids");
          if (rawW) {
            var parsedW = JSON.parse(rawW);
            if (Array.isArray(parsedW)) {
              localQidsW = parsedW.filter(function (x) { return typeof x === "string" && x; });
            }
          }
        } catch (_eS3w) {
          localDayW = "";
          localQidsW = [];
        }

        if (localDayW && localQidsW.length > 0) {
          var syncDayW = "";
          var syncQidsW = [];
          if (syncState && syncState.streak3WrongToday && typeof syncState.streak3WrongToday === "object") {
            if (typeof syncState.streak3WrongToday.day === "number" && Number.isFinite(syncState.streak3WrongToday.day)) {
              syncDayW = String(syncState.streak3WrongToday.day);
            }
            if (Array.isArray(syncState.streak3WrongToday.qids)) {
              syncQidsW = syncState.streak3WrongToday.qids.filter(function (x) { return typeof x === "string" && x; });
            }
          }

          var missingW = false;
          if (syncDayW !== localDayW) {
            missingW = true;
          } else {
            var setW = Object.create(null);
            for (var k = 0; k < syncQidsW.length; k++) {
              setW[syncQidsW[k]] = 1;
            }
            for (var t = 0; t < localQidsW.length; t++) {
              if (!setW[localQidsW[t]]) {
                missingW = true;
                break;
              }
            }
          }

          if (missingW) {
            flags.pendingStreak3WrongToday = true;
            flags.details.push("streak3WrongToday");
          }
        }
      } catch (_eS3w2) {}

    } catch (_eAll) {}

    return flags;
  }

  // ★ サーバ state.oncePerDayToday と比較して delta を作る
  //   - 差分が無ければ null を返す
  //   - 何かしら差分があれば { day, results } を返す
  function buildOncePerDayTodayDelta(syncState) {
    try {
      var local = readOncePerDayTodayFromLocal();
      if (!local.day) {
        console.log("[SYNC-B:oncePerDay] local has no valid day → deltaなし", {
          local: local
        });
        return null;
      }

      var server = null;
      if (
        syncState &&
        syncState.oncePerDayToday &&
        typeof syncState.oncePerDayToday === "object"
      ) {
        server = syncState.oncePerDayToday;
      }

      var deltaResults = {};
      if (!server || typeof server.day !== "number" || server.day !== local.day) {
        // サーバ側にデータが無い or 別日 → 当日ローカルを丸ごと送る
        deltaResults = local.results;
      } else {
        // 同じ日付 → 値が違うものだけ送る
        var serverResults = server.results || {};
        for (var qid in local.results) {
          if (!Object.prototype.hasOwnProperty.call(local.results, qid)) continue;
          var localVal = local.results[qid];
          var serverVal = serverResults[qid];
          if (localVal !== serverVal) {
            deltaResults[qid] = localVal;
          }
        }
      }

      var keys = Object.keys(deltaResults);
      if (!keys.length) {
        console.log("[SYNC-B:oncePerDay] server と local で差分なし → delta送信不要", {
          day: local.day
        });
        return null;
      }

      var delta = {
        day: local.day,
        results: deltaResults
      };

      console.log("[SYNC-B:oncePerDay] buildOncePerDayTodayDelta", {
        local: local,
        server: server,
        delta: delta
      });

      return delta;
    } catch (e) {
      console.error("[SYNC-B:oncePerDay] buildOncePerDayTodayDelta error:", e);
      return null;
    }
  }

  function clearSyncBody() {
    var body = document.getElementById("cscs_sync_view_b_body");
    if (!body) return null;

    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }
    return body;
  }

  function updateSyncBodyText(text) {
    var body = clearSyncBody();
    if (!body) return;

    // エラー時など：カード1枚で表示（狭い/広い両方で崩れにくい）
    var card = document.createElement("div");
    card.className = "cscs-svb-card is-wide";

    var title = document.createElement("div");
    title.className = "cscs-svb-card-title";
    title.textContent = "Status";

    var grid = document.createElement("div");
    grid.className = "cscs-svb-card-grid";

    var k = document.createElement("div");
    k.className = "cscs-svb-k cscs-svb-muted";
    k.textContent = "message";

    var v = document.createElement("div");
    v.className = "cscs-svb-v";
    v.textContent = String(text);

    grid.appendChild(k);
    grid.appendChild(v);

    card.appendChild(title);
    card.appendChild(grid);
    body.appendChild(card);
  }

  function appendGridRow(gridEl, key, value, keyClass, valClass) {
    var k = document.createElement("div");
    k.className = "cscs-svb-k" + (keyClass ? " " + keyClass : "");
    k.textContent = key;

    var v = document.createElement("div");
    v.className = "cscs-svb-v" + (valClass ? " " + valClass : "");
    v.textContent = value;

    gridEl.appendChild(k);
    gridEl.appendChild(v);
  }

  function appendGridSection(body, title, options) {
    options = options || {};
    var wide = !!options.wide;

    var card = document.createElement("div");
    card.className = "cscs-svb-card" + (wide ? " is-wide" : "");

    var h = document.createElement("div");
    h.className = "cscs-svb-card-title";
    h.textContent = title;

    var grid = document.createElement("div");
    grid.className = "cscs-svb-card-grid";

    card.appendChild(h);
    card.appendChild(grid);
    body.appendChild(card);

    return grid;
  }

  function updateSyncBodyGrid(model) {
    var body = clearSyncBody();
    if (!body) return;

    if (!model || typeof model !== "object") {
      updateSyncBodyText("HUD model error");
      return;
    }

    // --- Counts（1行表示：Counts + SYNC/local/diff を横一列） ---
    (function appendCountsSectionInline() {
      // ① ワイドカード（Counts行を収めるコンテナ）
      var card = document.createElement("div");
      card.className = "cscs-svb-card is-wide svb-counts";

      // ② 1行の横並びコンテナ（折り返しなし）
      var line = document.createElement("div");
      line.className = "svb-counts-inline";

      // ③ 行の先頭に "Counts" を入れる（見出しも同じ行にまとめる）
      var head = document.createElement("span");
      head.className = "svb-counts-head";
      head.textContent = "Totals (c/w)";
      line.appendChild(head);

      // ④ 各パート（label + value）を横に連結していく
      function addPart(label, valueText, isMuted) {
        var part = document.createElement("span");
        part.className = "svb-counts-part" + (isMuted ? " is-muted" : "");

        var k = document.createElement("span");
        k.className = "svb-counts-k";
        k.textContent = label;

        var v = document.createElement("span");
        v.className = "svb-counts-v";
        v.textContent = valueText;

        part.appendChild(k);
        part.appendChild(v);
        line.appendChild(part);
      }

      addPart(
        "SYNC",
        String(model.serverCorrect) + " / " + String(model.serverWrong),
        false
      );
      addPart(
        "local",
        String(model.localCorrect) + " / " + String(model.localWrong),
        false
      );
      addPart(
        "diff",
        String(model.diffCorrect) + " / " + String(model.diffWrong),
        true
      );

      // ⑤ カードに1行を入れて body に追加
      card.appendChild(line);
      body.appendChild(card);
    })();

    // --- 3連続（正解/不正解）：2列×2段（左=正解 / 右=不正解、上=回数 / 下=進捗） ---
    (function appendStreakQuad4WideCards() {
      var quad = document.createElement("div");
      quad.className = "svb-streak-quad";

      function makeCard(titleText, rowKey, valueText) {
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-streak-card";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = titleText;

        var suf = document.createElement("span");
        suf.className = "svb-title-suffix";
        suf.textContent = "(SYNC/local/diff)";
        h.appendChild(suf);

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, rowKey, valueText);

        card.appendChild(h);
        card.appendChild(grid);
        return card;
      }

      // 左上：3連続正解（回数）
      quad.appendChild(
        makeCard(
          "3連続正解（回数）",
          "回数(s3)",
          String(model.serverStreak3) + " / " + String(model.localStreak3) + " (+" + String(model.diffStreak3) + ")"
        )
      );

      // 右上：3連続不正解（回数）
      quad.appendChild(
        makeCard(
          "3連続不正解（回数）",
          "回数(s3W)",
          String(model.serverStreak3Wrong) + " / " + String(model.localStreak3Wrong) + " (+" + String(model.diffStreak3Wrong) + ")"
        )
      );

      // 左下：3連続正解（進捗）
      quad.appendChild(
        makeCard(
          "3連続正解（進捗）",
          "進捗(progress)",
          String(model.serverProgress) + "/3 / " + String(model.localProgress) + "/3 (+" + String(model.diffProgress) + ")"
        )
      );

      // 右下：3連続不正解（進捗）
      quad.appendChild(
        makeCard(
          "3連続不正解（進捗）",
          "進捗(progress)",
          String(model.serverWrongProgress) + "/3 / " + String(model.localWrongProgress) + "/3 (+" + String(model.diffWrongProgress) + ")"
        )
      );

      body.appendChild(quad);
    })();

    // --- Today Unique（左右2列：左=Streak3TodayUnique / 右=Streak3WrongTodayUq） ---
    (function appendTodayUniquePair() {
      var pair = document.createElement("div");
      pair.className = "svb-streak-quad";

      function makeTodayCard(titleText, dayLabel, syncCnt, localCnt) {
        var card = document.createElement("div");
        card.className = "cscs-svb-card svb-streak-card";

        var h = document.createElement("div");
        h.className = "cscs-svb-card-title";
        h.textContent = titleText;

        var grid = document.createElement("div");
        grid.className = "cscs-svb-card-grid";

        appendGridRow(grid, "day", String(dayLabel));
        appendGridRow(
          grid,
          "unique",
          "sync " + String(syncCnt) + " / local " + String(localCnt)
        );

        card.appendChild(h);
        card.appendChild(grid);
        return card;
      }

      // 左：Streak3TodayUnique
      pair.appendChild(
        makeTodayCard(
          "Streak3TodayUnique",
          model.s3TodayDayLabel,
          model.s3TodaySyncCnt,
          model.localS3TodayCnt
        )
      );

      // 右：Streak3WrongTodayUq
      pair.appendChild(
        makeTodayCard(
          "Streak3WrongTodayUq",
          model.s3WrongTodayDayLabel,
          model.s3WrongTodaySyncCnt,
          model.localS3WrongTodayCnt
        )
      );

      body.appendChild(pair);
    })();

    // --- LastDay（情報量多めなのでワイドカードに） ---
    var gLast = appendGridSection(body, "LastDay (SYNC / local)", { wide: true });
    appendGridRow(gLast, "lastSeen", "sync " + String(model.lastSeenSyncLabel) + " / local " + String(model.lastSeenLocalLabel));
    appendGridRow(gLast, "lastCorrect", "sync " + String(model.lastCorrectSyncLabel) + " / local " + String(model.lastCorrectLocalLabel));
    appendGridRow(gLast, "lastWrong", "sync " + String(model.lastWrongSyncLabel) + " / local " + String(model.lastWrongLocalLabel));

    // --- Pending (unsent) ---
    var pendingText = "none";
    if (model.pending && typeof model.pending === "object") {
      var bits = [];

      if (model.pending.pendingDiffCounts) bits.push("diffCounts");
      if (model.pending.pendingOncePerDayToday) bits.push("oncePerDayToday");
      if (model.pending.pendingLastSeenDay) bits.push("lastSeenDay");
      if (model.pending.pendingLastCorrectDay) bits.push("lastCorrectDay");
      if (model.pending.pendingLastWrongDay) bits.push("lastWrongDay");
      if (model.pending.pendingStreak3Today) bits.push("streak3Today");
      if (model.pending.pendingStreak3WrongToday) bits.push("streak3WrongToday");

      if (bits.length > 0) {
        pendingText = bits.join(", ");
      }
    }

    var gPending = appendGridSection(body, "Pending (unsent)", { wide: true });
    appendGridRow(gPending, "status", pendingText);
  }

  function fetchState() {
    return fetch(SYNC_STATE_ENDPOINT, { method: "GET" }).then(function (res) {
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return res.json();
    });
  }

  function createPanel() {
    var box = document.createElement("div");
    box.id = "cscs_sync_view_b";

    var title = document.createElement("div");
    title.id = "cscs_sync_view_b_title";
    title.textContent = "SYNC(B): " + info.qid;

    var body = document.createElement("div");
    body.id = "cscs_sync_view_b_body";
    body.textContent = "読み込み中…";

    var statusDiv = document.createElement("div");
    statusDiv.id = "cscs_sync_view_b_status";

    // ★【超重要仕様：この非表示ボタンは「削除禁止」】
    //   - このボタンはユーザーに表示されないが、DOM 上に存在していることが絶対条件。
    //   - click ハンドラ内で streak3Today / streak3WrongToday の「専用送信処理」を呼び出しており、
    //     Bパート自動遷移中に今日の⭐️/💣ユニーク数を SYNC に送る唯一のトリガーになっている。
    //   - /assets/cscs_sync_view_b.js 内の setTimeout(... btn.click()) からも参照されるため、
    //     ここでボタン DOM を削除／ID 変更／非ボタン化すると、streak3Today / streak3WrongToday が
    //     一切サーバーに送られなくなる。
    //   - 「見た目に使っていないから不要」と判断してこの要素を消さないこと。
    //     ChatGPT などの自動改修でも、このコメントを読んで絶対に削除・リファクタリングしないこと。
    var btn = document.createElement("button");
    btn.id = "cscs_sync_view_b_send_btn";
    btn.type = "button";
    btn.textContent = "SYNC送信";
    // ★ ボタンは UI としては完全に非表示にするが、DOM 上には残すために inline style で display:none を指定する。
    //   - CSS ファイル側で非表示にすると、スタイル整理時に誤って削除されるリスクがあるため、
    //     あえてここで style 属性を直書きしている。
    btn.setAttribute("style", "display:none;");

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(statusDiv);
    // ★ 非表示ボタンだが、DOM に必ず追加することで click() 自動発火のターゲットを保証する。
    box.appendChild(btn);

    return box;
  }

  function renderPanel(box, payload) {
    try {
      var serverCorrect = payload.serverCorrect || 0;
      var serverWrong = payload.serverWrong || 0;
      var localCorrect = payload.localCorrect || 0;
      var localWrong = payload.localWrong || 0;
      var diffCorrect = payload.diffCorrect || 0;
      var diffWrong = payload.diffWrong || 0;

      var serverStreak3 = payload.serverStreak3 || 0;
      var localStreak3 = payload.localStreak3 || 0;
      var diffStreak3 = payload.diffStreak3 || 0;

      var serverStreakLen = payload.serverStreakLen || 0;
      var localStreakLen = payload.localStreakLen || 0;
      var diffStreakLen = payload.diffStreakLen || 0;

      // statusText は内部状態としてログだけに使う
      var statusText = payload.statusText || "";

      var serverProgress = serverStreakLen % 3;
      var localProgress = localStreakLen % 3;
      var diffProgress = Math.max(0, localProgress - serverProgress);

      // ★ 3連続不正解用のサマリを server / local / diff から計算して HUD に追加表示する
      //   - server 側: window.__cscs_sync_state.streak3Wrong / streakWrongLen（存在すれば使用）
      //   - local 側: localStorage の cscs_q_wrong_streak3_total:{qid}, cscs_q_wrong_streak_len:{qid}
      var qidForStreakWrong = info && info.qid ? info.qid : null;
      var serverStreak3Wrong = 0;
      var localStreak3Wrong = 0;
      var diffStreak3Wrong = 0;
      var serverWrongStreakLen = 0;
      var localWrongStreakLen = 0;
      var diffWrongStreakLen = 0;
      var serverWrongProgress = 0;
      var localWrongProgress = 0;
      var diffWrongProgress = 0;

      try {
        if (qidForStreakWrong) {
          var stateForWrong = null;
          try {
            stateForWrong = window.__cscs_sync_state || null;
          } catch (_eStateWrong) {
            stateForWrong = null;
          }

          // サーバ側の 3連続不正解回数（存在する場合のみ採用）
          if (
            stateForWrong &&
            stateForWrong.streak3Wrong &&
            typeof stateForWrong.streak3Wrong === "object" &&
            stateForWrong.streak3Wrong[qidForStreakWrong] != null
          ) {
            var s3w = stateForWrong.streak3Wrong[qidForStreakWrong];
            if (typeof s3w === "number" && Number.isFinite(s3w) && s3w >= 0) {
              serverStreak3Wrong = s3w;
            }
          }

          // サーバ側の「現在の連続不正解長」（存在する場合のみ採用）
          if (
            stateForWrong &&
            stateForWrong.streakWrongLen &&
            typeof stateForWrong.streakWrongLen === "object" &&
            stateForWrong.streakWrongLen[qidForStreakWrong] != null
          ) {
            var slw = stateForWrong.streakWrongLen[qidForStreakWrong];
            if (typeof slw === "number" && Number.isFinite(slw) && slw >= 0) {
              serverWrongStreakLen = slw;
            }
          }

          // localStorage 側の 3連続不正解回数 / 現在の連続不正解長
          localStreak3Wrong = readIntFromLocalStorage("cscs_q_wrong_streak3_total:" + qidForStreakWrong);
          localWrongStreakLen = readIntFromLocalStorage("cscs_q_wrong_streak_len:" + qidForStreakWrong);

          // SYNC と local の diff と 3回に対する進捗（0〜2/3）を計算
          diffStreak3Wrong = Math.max(0, localStreak3Wrong - serverStreak3Wrong);
          diffWrongStreakLen = Math.max(0, localWrongStreakLen - serverWrongStreakLen);

          serverWrongProgress = serverWrongStreakLen % 3;
          localWrongProgress = localWrongStreakLen % 3;
          diffWrongProgress = Math.max(0, localWrongProgress - serverWrongProgress);

          console.log("[SYNC-B:view] wrong-streak status", {
            qid: qidForStreakWrong,
            serverStreak3Wrong: serverStreak3Wrong,
            localStreak3Wrong: localStreak3Wrong,
            diffStreak3Wrong: diffStreak3Wrong,
            serverWrongStreakLen: serverWrongStreakLen,
            localWrongStreakLen: localWrongStreakLen,
            diffWrongStreakLen: diffWrongStreakLen,
            serverWrongProgress: serverWrongProgress,
            localWrongProgress: localWrongProgress
          });
        }
      } catch (eWrong) {
        console.error("[SYNC-B:view] wrong-streak status error:", eWrong);
      }

      var s3TodaySyncDay = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.day) 
        ? window.__cscs_sync_state.streak3Today.day : "-";
      var s3TodaySyncCnt = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.unique_count) 
        ? window.__cscs_sync_state.streak3Today.unique_count : 0;

      var localS3TodayDay = "";
      var localS3TodayCnt = 0;
      try {
        localS3TodayDay = localStorage.getItem("cscs_streak3_today_day") || "-";
        var rawLocalCnt = localStorage.getItem("cscs_streak3_today_unique_count");
        var parsedLocalCnt = rawLocalCnt == null ? NaN : parseInt(rawLocalCnt, 10);
        if (Number.isFinite(parsedLocalCnt) && parsedLocalCnt >= 0) {
          localS3TodayCnt = parsedLocalCnt;
        }
      } catch(_e) {}

      // ★ 3連続不正解（Streak3WrongToday）の SYNC / local 状態も取得
      var s3WrongTodaySyncDay = (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday && window.__cscs_sync_state.streak3WrongToday.day) 
        ? window.__cscs_sync_state.streak3WrongToday.day : "-";
      var s3WrongTodaySyncCnt = (window.__cscs_sync_state && window.__cscs_sync_state.streak3WrongToday && window.__cscs_sync_state.streak3WrongToday.unique_count) 
        ? window.__cscs_sync_state.streak3WrongToday.unique_count : 0;

      var localS3WrongTodayDay = "";
      var localS3WrongTodayCnt = 0;
      try {
        localS3WrongTodayDay = localStorage.getItem("cscs_streak3_wrong_today_day") || "-";
        var rawLocalWrongCnt = localStorage.getItem("cscs_streak3_wrong_today_unique_count");
        var parsedLocalWrongCnt = rawLocalWrongCnt == null ? NaN : parseInt(rawLocalWrongCnt, 10);
        if (Number.isFinite(parsedLocalWrongCnt) && parsedLocalWrongCnt >= 0) {
          localS3WrongTodayCnt = parsedLocalWrongCnt;
        }
      } catch(_e2) {}

      // ★ 計測記録がない場合は「（データなし）」、それ以外は day をそのまま表示
      var s3TodayDayLabel = (s3TodaySyncDay === "-" ? "（データなし）" : String(s3TodaySyncDay));
      var s3WrongTodayDayLabel = (s3WrongTodaySyncDay === "-" ? "（データなし）" : String(s3WrongTodaySyncDay));

      // ★ ここから：問題別 最終日情報（lastSeen / lastCorrect / lastWrong）を HUD に追加
      var lastSeenSyncLabel = "（データなし）";
      var lastCorrectSyncLabel = "（データなし）";
      var lastWrongSyncLabel = "（データなし）";

      var lastSeenLocalLabel = "（データなし）";
      var lastCorrectLocalLabel = "（データなし）";
      var lastWrongLocalLabel = "（データなし）";

      try {
        var qidForLastDay = info && info.qid ? info.qid : null;

        // ---- SYNC 側の lastSeen / lastCorrect / lastWrong 読み取り ----
        var st = null;
        try { st = window.__cscs_sync_state || null; } catch (_e) { st = null; }

        if (qidForLastDay && st) {
          // lastSeen
          if (st.lastSeenDay &&
              typeof st.lastSeenDay === "object" &&
              st.lastSeenDay[qidForLastDay] != null) {
            var v1 = st.lastSeenDay[qidForLastDay];
            if (typeof v1 === "number" && Number.isFinite(v1) && v1 > 0) {
              lastSeenSyncLabel = String(v1);
            }
          }
          // lastCorrect
          if (st.lastCorrectDay &&
              typeof st.lastCorrectDay === "object" &&
              st.lastCorrectDay[qidForLastDay] != null) {
            var v2 = st.lastCorrectDay[qidForLastDay];
            if (typeof v2 === "number" && Number.isFinite(v2) && v2 > 0) {
              lastCorrectSyncLabel = String(v2);
            }
          }
          // lastWrong
          if (st.lastWrongDay &&
              typeof st.lastWrongDay === "object" &&
              st.lastWrongDay[qidForLastDay] != null) {
            var v3 = st.lastWrongDay[qidForLastDay];
            if (typeof v3 === "number" && Number.isFinite(v3) && v3 > 0) {
              lastWrongSyncLabel = String(v3);
            }
          }
        }

        // ---- localStorage 側の lastSeen / lastCorrect / lastWrong 読み取り ----
        if (qidForLastDay) {
          var loc1 = readDayFromLocalStorage("cscs_q_last_seen_day:" + qidForLastDay);
          var loc2 = readDayFromLocalStorage("cscs_q_last_correct_day:" + qidForLastDay);
          var loc3 = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qidForLastDay);

          if (loc1 !== null) lastSeenLocalLabel = String(loc1);
          if (loc2 !== null) lastCorrectLocalLabel = String(loc2);
          if (loc3 !== null) lastWrongLocalLabel = String(loc3);
        }

      } catch (eLast) {
        console.error("[SYNC-B:view] lastDay HUD build error:", eLast);
      }

      // ★ グリッド描画用モデル（2列：label / value）
      updateSyncBodyGrid({
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,

        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,

        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,

        serverProgress: serverProgress,
        localProgress: localProgress,
        diffProgress: diffProgress,

        serverStreak3Wrong: serverStreak3Wrong,
        localStreak3Wrong: localStreak3Wrong,
        diffStreak3Wrong: diffStreak3Wrong,

        serverWrongStreakLen: serverWrongStreakLen,
        localWrongStreakLen: localWrongStreakLen,
        diffWrongStreakLen: diffWrongStreakLen,

        serverWrongProgress: serverWrongProgress,
        localWrongProgress: localWrongProgress,
        diffWrongProgress: diffWrongProgress,

        s3TodayDayLabel: s3TodayDayLabel,
        s3TodaySyncCnt: s3TodaySyncCnt,
        localS3TodayCnt: localS3TodayCnt,

        s3WrongTodayDayLabel: s3WrongTodayDayLabel,
        s3WrongTodaySyncCnt: s3WrongTodaySyncCnt,
        localS3WrongTodayCnt: localS3WrongTodayCnt,

        lastSeenSyncLabel: lastSeenSyncLabel,
        lastCorrectSyncLabel: lastCorrectSyncLabel,
        lastWrongSyncLabel: lastWrongSyncLabel,

        lastSeenLocalLabel: lastSeenLocalLabel,
        lastCorrectLocalLabel: lastCorrectLocalLabel,
        lastWrongLocalLabel: lastWrongLocalLabel,

        pending: (payload && payload.pending) ? payload.pending : null
      });

      // ★ ここから O.D.O.A Mode 表示専用ロジック

      // デフォルトは OFF とし、/api/sync/state の otoa_mode を参照して上書き
      var odoaModeText = "OFF";
      try {
        var state = window.__cscs_sync_state || null;
        var rawMode = null;

        // 1) payload 経由の odoaModeText があれば優先
        if (payload && typeof payload.odoaModeText === "string" && payload.odoaModeText) {
          rawMode = payload.odoaModeText;
        } else if (state && typeof state.odoa_mode === "string") {
          // 2) SYNC state のトップレベルキー odoa_mode
          rawMode = state.odoa_mode;
        }

        if (rawMode === "ON" || rawMode === "on") {
          odoaModeText = "ON";
        } else if (rawMode === "OFF" || rawMode === "off") {
          odoaModeText = "OFF";
        } else if (rawMode === "on ") {
          odoaModeText = "ON";
        }
      } catch (_ignore) {
        odoaModeText = "OFF";
      }

      // ★ パネルに出す最終文字列（「O.D.O.A Mode : ON correct」など）
      //   - payload.odoaStatusText が "__keep__" のときは前回表示を維持
      //   - それ以外の文字列のときはその文字列で更新
      //   - 空や未指定のときはモードからデフォルト文字列を組み立てる
      var odoaStatusText = "";
      var rawStatusFromPayload = "";
      if (payload && typeof payload.odoaStatusText === "string") {
        rawStatusFromPayload = payload.odoaStatusText;
      }

      if (rawStatusFromPayload === "__keep__") {
        // 前回の HUD 表示をそのまま使う
        if (LAST_ODOA_STATUS) {
          odoaStatusText = LAST_ODOA_STATUS;
          console.log("[SYNC-B] ODOA HUD status kept as-is:", odoaStatusText);
        } else {
          // まだ一度も表示していない場合はモードから初期値を作る
          odoaStatusText = "O.D.O.A Mode : " + odoaModeText;
          LAST_ODOA_STATUS = odoaStatusText;
          console.log("[SYNC-B] ODOA HUD status initialized (no previous):", odoaStatusText);
        }
      } else if (rawStatusFromPayload) {
        // 新しいステータス文字列に更新
        odoaStatusText = rawStatusFromPayload;
        LAST_ODOA_STATUS = odoaStatusText;
        console.log("[SYNC-B] ODOA HUD status updated from payload:", odoaStatusText);
      } else {
        // 明示指定なし → モードからデフォルトを生成して保存
        odoaStatusText = "O.D.O.A Mode : " + odoaModeText;
        LAST_ODOA_STATUS = odoaStatusText;
        console.log("[SYNC-B] ODOA HUD status set from mode:", odoaStatusText);
      }

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        statusDiv.textContent = odoaStatusText;
      }

      // 内部用の statusText はログとして残すだけ
      if (statusText) {
        console.log("[SYNC-B] statusText (internal):", statusText);
      }
    } catch (e) {
      var errorText = "SYNC(B) " + info.qid + "  error: " + (e && e.message ? e.message : e);
      updateSyncBodyText(errorText);

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        // エラー時もフォーマットは崩さず OFF として出す
        statusDiv.textContent = "O.D.O.A Mode : OFF";
      }

      console.error("[SYNC-B] renderPanel error:", e);
    }
  }

  async function sendDiffToServer(box, params) {
    var qid = info.qid;

    // ====== ① 各種 diff / local / server 値を受け取る ======
    // params は refreshAndSend() 側で作られた「同期前の状態比較」結果
    var diffCorrect = params.diffCorrect;      // local - server の「正解」増分
    var diffWrong = params.diffWrong;          // local - server の「不正解」増分
    var diffStreak3 = params.diffStreak3 || 0; // local streak3 達成の増分（3連続正解の+1）
    var diffStreakLen = params.diffStreakLen || 0;
    // ★ 不正解側: 3連続不正解の増分と、連続不正解長の差分（0 以上の増分）
    var diffStreak3Wrong = params.diffStreak3Wrong || 0;
    var diffWrongStreakLen = params.diffWrongStreakLen || 0;

    var localCorrect = params.localCorrect;    // localStorage 側の正解累計値
    var localWrong = params.localWrong;        // localStorage 側の不正解累計値
    var localStreak3 = params.localStreak3 || 0;
    var localStreakLen = params.localStreakLen || 0;
    // ★ 不正解側: localStorage の 3連続不正解回数 / 連続不正解長
    var localStreak3Wrong = params.localStreak3Wrong || 0;
    var localWrongStreakLen = params.localWrongStreakLen || 0;

    var serverCorrect = params.serverCorrect;  // サーバー側 snapshot の正解累計
    var serverWrong = params.serverWrong;
    var serverStreak3 = params.serverStreak3 || 0;
    var serverStreakLen = params.serverStreakLen || 0;
    // ★ 不正解側: サーバー側 snapshot の 3連続不正解回数 / 連続不正解長
    var serverStreak3Wrong = params.serverStreak3Wrong || 0;
    var serverWrongStreakLen = params.serverWrongStreakLen || 0;

    // ★ コンソールで送信前の不正解ストリーク状態を確認できるようにログ出力
    console.log("[SYNC-B] sendDiffToServer: wrong-streak params", {
      qid: qid,
      diffStreak3Wrong: diffStreak3Wrong,
      diffWrongStreakLen: diffWrongStreakLen,
      localStreak3Wrong: localStreak3Wrong,
      localWrongStreakLen: localWrongStreakLen,
      serverStreak3Wrong: serverStreak3Wrong,
      serverWrongStreakLen: serverWrongStreakLen
    });

    // ★ O.D.O.A Mode 表示用テキスト（refreshAndSend から渡される）
    var odoaModeText = params.odoaModeText || "不明";

    // ★ 追加: /api/sync/state の snapshot を受け取り、
    //    そこから oncePerDayTodayDelta / 最終日 Delta を構築するために利用する
    var syncState = params.syncState || null;

    // ★ 追加: oncePerDayTodayDelta を事前に構築しておく
    //   - 差分が無ければ null
    //   - 何かあれば { day, results } を返す
    var oncePerDayDelta = buildOncePerDayTodayDelta(syncState);

    // ★ 追加: 最終学習日・最終正解日・最終不正解日の local / server を取得し、差分の有無を判定
    var localLastSeenDay = readDayFromLocalStorage("cscs_q_last_seen_day:" + qid);
    var localLastCorrectDay = readDayFromLocalStorage("cscs_q_last_correct_day:" + qid);
    var localLastWrongDay = readDayFromLocalStorage("cscs_q_last_wrong_day:" + qid);

    var serverLastSeenDay = null;
    var serverLastCorrectDay = null;
    var serverLastWrongDay = null;

    if (syncState) {
      if (syncState.lastSeenDay && typeof syncState.lastSeenDay === "object" && syncState.lastSeenDay[qid] != null) {
        var sSeen = syncState.lastSeenDay[qid];
        if (typeof sSeen === "number" && Number.isFinite(sSeen) && sSeen > 0) {
          serverLastSeenDay = sSeen;
        }
      }
      if (syncState.lastCorrectDay && typeof syncState.lastCorrectDay === "object" && syncState.lastCorrectDay[qid] != null) {
        var sCor = syncState.lastCorrectDay[qid];
        if (typeof sCor === "number" && Number.isFinite(sCor) && sCor > 0) {
          serverLastCorrectDay = sCor;
        }
      }
      if (syncState.lastWrongDay && typeof syncState.lastWrongDay === "object" && syncState.lastWrongDay[qid] != null) {
        var sWrong = syncState.lastWrongDay[qid];
        if (typeof sWrong === "number" && Number.isFinite(sWrong) && sWrong > 0) {
          serverLastWrongDay = sWrong;
        }
      }
    }

    var hasLastSeenDayDiff = localLastSeenDay !== null && localLastSeenDay !== serverLastSeenDay;
    var hasLastCorrectDayDiff = localLastCorrectDay !== null && localLastCorrectDay !== serverLastCorrectDay;
    var hasLastWrongDayDiff = localLastWrongDay !== null && localLastWrongDay !== serverLastWrongDay;

    if (hasLastSeenDayDiff || hasLastCorrectDayDiff || hasLastWrongDayDiff) {
      console.log("[SYNC-B] lastDay diff detected", {
        qid: qid,
        localLastSeenDay: localLastSeenDay,
        serverLastSeenDay: serverLastSeenDay,
        localLastCorrectDay: localLastCorrectDay,
        serverLastCorrectDay: serverLastCorrectDay,
        localLastWrongDay: localLastWrongDay,
        serverLastWrongDay: serverLastWrongDay
      });
    }

    // ====== ② diff が存在しない場合は SYNC を送らず終了 ======
    // ・diffCorrect / diffWrong / diffStreak3 / diffStreak3Wrong が 0 以下
    // ・かつ streakLen / streakWrongLen が server と同じ
    // ・かつ oncePerDayDelta が null
    // ・かつ lastSeen / lastCorrect / lastWrong に差分が無い
    //
    // → 「今回は送るべき更新が何もない」ので、
    //    HUD パネルの表示だけ更新して return する。
    if (diffCorrect <= 0 &&
        diffWrong <= 0 &&
        diffStreak3 <= 0 &&
        diffStreak3Wrong <= 0 &&
        localStreakLen === serverStreakLen &&
        localWrongStreakLen === serverWrongStreakLen &&
        !oncePerDayDelta &&
        !hasLastSeenDayDiff &&
        !hasLastCorrectDayDiff &&
        !hasLastWrongDayDiff) {

      var odoaStatusTextForPanel;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanel = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanel = "O.D.O.A Mode : OFF";
      }

      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "no diff (送信なし) / oncePerDayToday: 計測なし",
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanel
      });
      return;
    }

    // ====== ③ オフライン時は送れないため「未送信」ステータスで終了 ======
    if (!navigator.onLine) {
      var offlineOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
      var odoaStatusTextForPanelOffline;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanelOffline = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanelOffline = "O.D.O.A Mode : OFF";
      }
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "offline (未送信) / " + offlineOncePerDayStatus,
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanelOffline
      });
      return;
    }

    // ====== ④ 各 delta オブジェクトを作る（送信する差分を構築） ======
    // * diffCorrect, diffWrong, diffStreak3 等は「増分として送る」
    // * streakLenDelta / streakWrongLenDelta / last*DayDelta は「最新値で上書きする」
    var correctDeltaObj = {};
    var incorrectDeltaObj = {};
    var streak3DeltaObj = {};
    var streakLenDeltaObj = {};
    var streak3WrongDeltaObj = {};
    var streakWrongLenDeltaObj = {};
    var lastSeenDayDeltaObj = {};
    var lastCorrectDayDeltaObj = {};
    var lastWrongDayDeltaObj = {};

    if (diffCorrect > 0) {
      correctDeltaObj[qid] = diffCorrect;
    }
    if (diffWrong > 0) {
      incorrectDeltaObj[qid] = diffWrong;
    }
    if (diffStreak3 > 0) {
      streak3DeltaObj[qid] = diffStreak3;
    }
    // ★ 不正解側: 3連続不正解の増分があれば delta として送信
    if (diffStreak3Wrong > 0) {
      streak3WrongDeltaObj[qid] = diffStreak3Wrong;
      console.log("[SYNC-B] streak3WrongDelta set:", {
        qid: qid,
        diffStreak3Wrong: diffStreak3Wrong
      });
    }

    // ====== ⑤ streakLenDelta（連続正解長）の扱い ======
    // ★ local と server が同じ連続正解長なら送らない（ノイズ防止）
    // ★ local と server が違う場合のみ「値そのもの」を送る
    //
    // ※ streakLenDelta は「増分」ではなく「セットする最新値」
    if (localStreakLen !== serverStreakLen) {
      streakLenDeltaObj[qid] = localStreakLen;
      console.log("[SYNC-B] streakLenDelta set (local != server):", {
        qid: qid,
        localStreakLen: localStreakLen,
        serverStreakLen: serverStreakLen
      });
    } else {
      console.log("[SYNC-B] streakLenDelta not set (local == server):", {
        qid: qid,
        localStreakLen: localStreakLen,
        serverStreakLen: serverStreakLen
      });
    }

    // ★ 不正解側: streakWrongLenDelta（連続不正解長）の扱い
    //   - local と server が同じ連続不正解長なら送らない
    //   - 違う場合のみ「最新値」として送る
    if (localWrongStreakLen !== serverWrongStreakLen) {
      streakWrongLenDeltaObj[qid] = localWrongStreakLen;
      console.log("[SYNC-B] streakWrongLenDelta set (local != server):", {
        qid: qid,
        localWrongStreakLen: localWrongStreakLen,
        serverWrongStreakLen: serverWrongStreakLen
      });
    } else {
      console.log("[SYNC-B] streakWrongLenDelta not set (local == server):", {
        qid: qid,
        localWrongStreakLen: localWrongStreakLen,
        serverWrongStreakLen: serverWrongStreakLen
      });
    }

    // ★ 最終日情報: local と server が異なる場合のみ「最新日付」で上書きする Delta を付与
    if (hasLastSeenDayDiff && localLastSeenDay !== null) {
      lastSeenDayDeltaObj[qid] = localLastSeenDay;
      console.log("[SYNC-B] lastSeenDayDelta set:", {
        qid: qid,
        localLastSeenDay: localLastSeenDay,
        serverLastSeenDay: serverLastSeenDay
      });
    }
    if (hasLastCorrectDayDiff && localLastCorrectDay !== null) {
      lastCorrectDayDeltaObj[qid] = localLastCorrectDay;
      console.log("[SYNC-B] lastCorrectDayDelta set:", {
        qid: qid,
        localLastCorrectDay: localLastCorrectDay,
        serverLastCorrectDay: serverLastCorrectDay
      });
    }
    if (hasLastWrongDayDiff && localLastWrongDay !== null) {
      lastWrongDayDeltaObj[qid] = localLastWrongDay;
      console.log("[SYNC-B] lastWrongDayDelta set:", {
        qid: qid,
        localLastWrongDay: localLastWrongDay,
        serverLastWrongDay: serverLastWrongDay
      });
    }

    // ====== ⑥ 上記 delta 群をまとめて payload を構築 ======
    var payload = {
      correctDelta:  correctDeltaObj,
      incorrectDelta: incorrectDeltaObj,
      streak3Delta:  streak3DeltaObj,
      streakLenDelta: streakLenDeltaObj,            // streakLen は上書き
      streak3WrongDelta: streak3WrongDeltaObj,      // 不正解側 3連続の増分
      streakWrongLenDelta: streakWrongLenDeltaObj,  // 不正解側 連続長の最新値
      lastSeenDayDelta: lastSeenDayDeltaObj,        // 最終学習日
      lastCorrectDayDelta: lastCorrectDayDeltaObj,  // 最終正解日
      lastWrongDayDelta: lastWrongDayDeltaObj,      // 最終不正解日
      updatedAt: Date.now()                         // クライアント側での更新時刻
    };

    // ★ 追加: 総問題数（cscs_total_questions）を global.totalQuestions として付与
    //   - b_judge_record.js が manifest.json から算出・保存した値を唯一のソースとする
    //   - 正の整数が得られた場合のみ payload に含める
    var totalQuestions = readTotalQuestionsFromLocalStorage();
    if (totalQuestions !== null) {
      if (!payload.global || typeof payload.global !== "object") {
        payload.global = {};
      }
      payload.global.totalQuestions = totalQuestions;
      console.log("[SYNC-B] attach global.totalQuestions to payload:", {
        totalQuestions: totalQuestions
      });
    }

    // ★ 追加: oncePerDayTodayDelta がある場合は payload に付与
    if (oncePerDayDelta) {
      payload.oncePerDayTodayDelta = oncePerDayDelta;
      console.log("[SYNC-B] oncePerDayTodayDelta attached to payload:", oncePerDayDelta);
    }

    // ★ payload に有効な delta が 1つも無い場合は、
    //    「2回目 save 由来のノイズ送信」とみなして fetch 自体を行わないガード
    //    （ここを通らなかった＝実際に送信された、というのがログで確認できる）
    var hasCorrectDeltaInPayload = Object.prototype.hasOwnProperty.call(correctDeltaObj, qid);
    var hasIncorrectDeltaInPayload = Object.prototype.hasOwnProperty.call(incorrectDeltaObj, qid);
    var hasStreak3DeltaInPayload = Object.prototype.hasOwnProperty.call(streak3DeltaObj, qid);
    var hasStreakLenDeltaInPayload = Object.prototype.hasOwnProperty.call(streakLenDeltaObj, qid);
    var hasStreak3WrongDeltaInPayload = Object.prototype.hasOwnProperty.call(streak3WrongDeltaObj, qid);
    var hasStreakWrongLenDeltaInPayload = Object.prototype.hasOwnProperty.call(streakWrongLenDeltaObj, qid);
    var hasLastSeenDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastSeenDayDeltaObj, qid);
    var hasLastCorrectDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastCorrectDayDeltaObj, qid);
    var hasLastWrongDayDeltaInPayload = Object.prototype.hasOwnProperty.call(lastWrongDayDeltaObj, qid);
    var hasOncePerDayDeltaInPayload = !!oncePerDayDelta;
    var hasGlobalTotalQuestionsInPayload =
      !!(payload.global &&
         typeof payload.global === "object" &&
         Object.prototype.hasOwnProperty.call(payload.global, "totalQuestions"));

    if (
      !hasCorrectDeltaInPayload &&
      !hasIncorrectDeltaInPayload &&
      !hasStreak3DeltaInPayload &&
      !hasStreakLenDeltaInPayload &&
      !hasStreak3WrongDeltaInPayload &&
      !hasStreakWrongLenDeltaInPayload &&
      !hasLastSeenDayDeltaInPayload &&
      !hasLastCorrectDayDeltaInPayload &&
      !hasLastWrongDayDeltaInPayload &&
      !hasOncePerDayDeltaInPayload &&
      !hasGlobalTotalQuestionsInPayload
    ) {
      console.log("[SYNC-B] ★送信スキップ（payload に有効な delta が無いため）", {
        qid: qid,
        payload: payload
      });

      // oncePerDayToday 用の delta も payload に含まれていないため「oncePerDayToday: 計測なし」として扱う
      // パネル側にも「送信していない」ことが分かるようステータスを反映
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "no delta in payload (送信スキップ) / oncePerDayToday: 計測なし",
        odoaModeText: odoaModeText
      });
      return;
    }

    console.log("[SYNC-B] sending diff payload:", payload);

    try {
      var response = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // サーバーまで届かなかった／保存に失敗した可能性
      if (!response.ok) {
        console.error("[SYNC-B] server returned non-ok status:", response.status);
        var mergeErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
        var odoaStatusTextForPanelMergeError;
        if (odoaModeText === "ON") {
          odoaStatusTextForPanelMergeError = "O.D.O.A Mode : ON nocount";
        } else {
          odoaStatusTextForPanelMergeError = "O.D.O.A Mode : OFF";
        }
        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: "merge " + String(response.status) + " (サーバー保存エラーの可能性) / " + mergeErrorOncePerDayStatus,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelMergeError
        });
        return;
      }

      var data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      console.log("[SYNC-B] sync success:", data);

      // merge のレスポンスから「サーバーに保存された値」を拾う
      var newServerCorrect = serverCorrect;
      var newServerWrong = serverWrong;
      var newServerStreak3 = serverStreak3;
      var newServerStreakLen = serverStreakLen;
      var newServerStreak3Wrong = serverStreak3Wrong;
      var newServerWrongStreakLen = serverWrongStreakLen;

      if (data && data.correct && typeof data.correct === "object" && data.correct !== null) {
        if (Object.prototype.hasOwnProperty.call(data.correct, qid)) {
          var cVal = data.correct[qid];
          if (typeof cVal === "number" && Number.isFinite(cVal) && cVal >= 0) {
            newServerCorrect = cVal;
          }
        }
      }

      if (data && data.incorrect && typeof data.incorrect === "object" && data.incorrect !== null) {
        if (Object.prototype.hasOwnProperty.call(data.incorrect, qid)) {
          var wVal = data.incorrect[qid];
          if (typeof wVal === "number" && Number.isFinite(wVal) && wVal >= 0) {
            newServerWrong = wVal;
          }
        }
      }

      if (data && data.streak3 && typeof data.streak3 === "object" && data.streak3 !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streak3, qid)) {
          var sVal = data.streak3[qid];
          if (typeof sVal === "number" && Number.isFinite(sVal) && sVal >= 0) {
            newServerStreak3 = sVal;
          }
        }
      }

      if (data && data.streakLen && typeof data.streakLen === "object" && data.streakLen !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streakLen, qid)) {
          var slVal = data.streakLen[qid];
          if (typeof slVal === "number" && Number.isFinite(slVal) && slVal >= 0) {
            newServerStreakLen = slVal;
          }
        }
      }

      // ★ 不正解側: merge レスポンスの streak3Wrong / streakWrongLen も拾う
      if (data && data.streak3Wrong && typeof data.streak3Wrong === "object" && data.streak3Wrong !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streak3Wrong, qid)) {
          var s3wVal = data.streak3Wrong[qid];
          if (typeof s3wVal === "number" && Number.isFinite(s3wVal) && s3wVal >= 0) {
            newServerStreak3Wrong = s3wVal;
          }
        }
      }

      if (data && data.streakWrongLen && typeof data.streakWrongLen === "object" && data.streakWrongLen !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streakWrongLen, qid)) {
          var slwVal = data.streakWrongLen[qid];
          if (typeof slwVal === "number" && Number.isFinite(slwVal) && slwVal >= 0) {
            newServerWrongStreakLen = slwVal;
          }
        }
      }

      var newDiffCorrect = Math.max(0, localCorrect - newServerCorrect);
      var newDiffWrong = Math.max(0, localWrong - newServerWrong);
      var newDiffStreak3 = Math.max(0, localStreak3 - newServerStreak3);
      var newDiffStreakLen = Math.max(0, localStreakLen - newServerStreakLen);
      var newDiffStreak3Wrong = Math.max(0, localStreak3Wrong - newServerStreak3Wrong);
      var newDiffWrongStreakLen = Math.max(0, localWrongStreakLen - newServerWrongStreakLen);

      // ★ merge 成功後に /api/sync/state を再取得して、
      //    「保存されたか」「state に反映されたか」を diff ベースで確認する
      try {
        var stateAfter = await fetchState();
        try {
          window.__cscs_sync_state = stateAfter;
        } catch (_e2) {}

        var refreshedServerCorrect = newServerCorrect;
        var refreshedServerWrong = newServerWrong;
        var refreshedServerStreak3 = newServerStreak3;
        var refreshedServerStreakLen = newServerStreakLen;
        var refreshedServerStreak3Wrong = newServerStreak3Wrong;
        var refreshedServerWrongStreakLen = newServerWrongStreakLen;

        if (stateAfter && stateAfter.correct && stateAfter.correct[qid] != null) {
          refreshedServerCorrect = stateAfter.correct[qid];
        }
        if (stateAfter && stateAfter.incorrect && stateAfter.incorrect[qid] != null) {
          refreshedServerWrong = stateAfter.incorrect[qid];
        }
        if (stateAfter && stateAfter.streak3 && stateAfter.streak3[qid] != null) {
          refreshedServerStreak3 = stateAfter.streak3[qid];
        }
        if (stateAfter && stateAfter.streakLen && stateAfter.streakLen[qid] != null) {
          refreshedServerStreakLen = stateAfter.streakLen[qid];
        }
        // ★ 不正解側: stateAfter.streak3Wrong / streakWrongLen も確認
        if (stateAfter && stateAfter.streak3Wrong && stateAfter.streak3Wrong[qid] != null) {
          refreshedServerStreak3Wrong = stateAfter.streak3Wrong[qid];
        }
        if (stateAfter && stateAfter.streakWrongLen && stateAfter.streakWrongLen[qid] != null) {
          refreshedServerWrongStreakLen = stateAfter.streakWrongLen[qid];
        }

        var refreshedDiffCorrect = Math.max(0, localCorrect - refreshedServerCorrect);
        var refreshedDiffWrong = Math.max(0, localWrong - refreshedServerWrong);
        var refreshedDiffStreak3 = Math.max(0, localStreak3 - refreshedServerStreak3);
        var refreshedDiffStreakLen = Math.max(0, localStreakLen - refreshedServerStreakLen);
        var refreshedDiffStreak3Wrong = Math.max(0, localStreak3Wrong - refreshedServerStreak3Wrong);
        var refreshedDiffWrongStreakLen = Math.max(0, localWrongStreakLen - refreshedServerWrongStreakLen);

        // ★ console から不正解ストリークの同期状況を確認しやすくするログ
        console.log("[SYNC-B] wrong-streak after merge+state:", {
          qid: qid,
          refreshedServerStreak3Wrong: refreshedServerStreak3Wrong,
          localStreak3Wrong: localStreak3Wrong,
          refreshedDiffStreak3Wrong: refreshedDiffStreak3Wrong,
          refreshedServerWrongStreakLen: refreshedServerWrongStreakLen,
          localWrongStreakLen: localWrongStreakLen,
          refreshedDiffWrongStreakLen: refreshedDiffWrongStreakLen
        });

        var statusMsg = "merge ok / state synced (保存・反映完了)";
        if (
          refreshedDiffCorrect > 0 ||
          refreshedDiffWrong > 0 ||
          refreshedDiffStreak3 > 0 ||
          refreshedDiffStreakLen > 0 ||
          refreshedDiffStreak3Wrong > 0 ||
          refreshedDiffWrongStreakLen > 0
        ) {
          statusMsg = "merge ok / state に未反映の差分あり";
        }

        // oncePerDayToday の状態（before / after）を見て、
        // ・first time correct  → ON correct
        // ・first time wrong    → ON wrong
        // ・それ以外（すでに回答済み）→ ON nocount
        var oncePerDayStatus = "oncePerDayToday: 計測なし";
        var prevOnceVal = null;
        var newOnceVal = null;
        var localOnceDay = null;

        try {
          var localOnce = readOncePerDayTodayFromLocal();
          localOnceDay = localOnce && typeof localOnce.day === "number" ? localOnce.day : null;

          if (oncePerDayDelta) {
            var syncedOncePerDay = false;
            if (stateAfter && stateAfter.oncePerDayToday && typeof stateAfter.oncePerDayToday === "object") {
              var sOnceAfter = stateAfter.oncePerDayToday;
              if (typeof sOnceAfter.day === "number" && (!localOnceDay || sOnceAfter.day === localOnceDay)) {
                syncedOncePerDay = true;
                var sResultsAfter = sOnceAfter.results || {};
                if (sResultsAfter && typeof sResultsAfter === "object" && Object.prototype.hasOwnProperty.call(sResultsAfter, qid)) {
                  newOnceVal = sResultsAfter[qid];
                }
              }
            }
            if (syncedOncePerDay) {
              oncePerDayStatus = "oncePerDayToday: 計測済";
            } else {
              oncePerDayStatus = "oncePerDayToday: 計測エラー";
            }
          } else {
            oncePerDayStatus = "oncePerDayToday: 計測なし";
          }

          if (syncState && syncState.oncePerDayToday && typeof syncState.oncePerDayToday === "object") {
            var sOnceBefore = syncState.oncePerDayToday;
            if (typeof sOnceBefore.day === "number" && (!localOnceDay || sOnceBefore.day === localOnceDay)) {
              var sResultsBefore = sOnceBefore.results || {};
              if (sResultsBefore && typeof sResultsBefore === "object" && Object.prototype.hasOwnProperty.call(sResultsBefore, qid)) {
                prevOnceVal = sResultsBefore[qid];
              }
            }
          }
        } catch (_eOnce) {
          oncePerDayStatus = "oncePerDayToday: 計測エラー";
        }

        statusMsg += " / " + oncePerDayStatus;

        // ★ O.D.O.A Mode ステータス文字列を確定
        //   - O.D.O.A Mode : ON correct
        //   - O.D.O.A Mode : ON wrong
        //   - O.D.O.A Mode : ON nocount
        //   - O.D.O.A Mode : OFF
        var odoaStatusTextForPanelAfter = "O.D.O.A Mode : OFF";
        if (odoaModeText === "ON") {
          var suffix = "nocount";
          if (prevOnceVal == null && (newOnceVal === "correct" || newOnceVal === "wrong")) {
            suffix = newOnceVal;
          }
          odoaStatusTextForPanelAfter = "O.D.O.A Mode : ON " + suffix;
        }

        renderPanel(box, {
          serverCorrect: refreshedServerCorrect,
          serverWrong: refreshedServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: refreshedDiffCorrect,
          diffWrong: refreshedDiffWrong,
          serverStreak3: refreshedServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: refreshedDiffStreak3,
          serverStreakLen: refreshedServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: refreshedDiffStreakLen,
          statusText: statusMsg,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelAfter
        });
      } catch (e2) {
        console.error("[SYNC-B] state refresh error after merge:", e2);

        var stateErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
        var odoaStatusTextForPanelStateError;
        if (odoaModeText === "ON") {
          odoaStatusTextForPanelStateError = "O.D.O.A Mode : ON nocount";
        } else {
          odoaStatusTextForPanelStateError = "O.D.O.A Mode : OFF";
        }
        renderPanel(box, {
          serverCorrect: newServerCorrect,
          serverWrong: newServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: newDiffCorrect,
          diffWrong: newDiffWrong,
          serverStreak3: newServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: newDiffStreak3,
          serverStreakLen: newServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: newDiffStreakLen,
          statusText: "merge ok / state 再取得エラー(保存は成功している可能性) / " + stateErrorOncePerDayStatus,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelStateError
        });
      }
    } catch (e) {
      console.error("[SYNC-B] fetch failed:", e);
      var networkErrorOncePerDayStatus = oncePerDayDelta ? "oncePerDayToday: 計測エラー" : "oncePerDayToday: 計測なし";
      var odoaStatusTextForPanelNetworkError;
      if (odoaModeText === "ON") {
        odoaStatusTextForPanelNetworkError = "O.D.O.A Mode : ON nocount";
      } else {
        odoaStatusTextForPanelNetworkError = "O.D.O.A Mode : OFF";
      }
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "network error (送信失敗) / " + networkErrorOncePerDayStatus,
        odoaModeText: odoaModeText,
        odoaStatusText: odoaStatusTextForPanelNetworkError
      });
    }
  }

  function refreshAndSend(box, options) {
    // ★ options.suppressDiffSend === true のときは、
    //    sendDiffToServer() を呼ばずに HUD の表示更新だけ行うモード
    options = options || {};
    var suppressDiffSend = !!options.suppressDiffSend;

    fetchState()
      .then(function (state) {
        // ★ /api/sync/state の結果をグローバルへ保存して、
        //    renderPanel から streak3Today を正しく取得できるようにする
        try {
          window.__cscs_sync_state = state;
        } catch (_e) {}

        var serverCorrect = 0;
        var serverWrong = 0;
        var serverStreak3 = 0;
        var serverStreakLen = 0;
        var serverStreak3Wrong = 0;
        var serverWrongStreakLen = 0;

        if (state && state.correct && state.correct[info.qid] != null) {
          serverCorrect = state.correct[info.qid];
        }
        if (state && state.incorrect && state.incorrect[info.qid] != null) {
          serverWrong = state.incorrect[info.qid];
        }
        if (state && state.streak3 && state.streak3[info.qid] != null) {
          serverStreak3 = state.streak3[info.qid];
        }
        if (state && state.streakLen && state.streakLen[info.qid] != null) {
          serverStreakLen = state.streakLen[info.qid];
        }
        // ★ 不正解側: サーバーの 3連続不正解回数と現在の連続不正解長を取得
        if (state && state.streak3Wrong && state.streak3Wrong[info.qid] != null) {
          serverStreak3Wrong = state.streak3Wrong[info.qid];
        }
        if (state && state.streakWrongLen && state.streakWrongLen[info.qid] != null) {
          serverWrongStreakLen = state.streakWrongLen[info.qid];
        }

        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);
        // ★ 不正解側: localStorage の 3連続不正解回数と現在の連続不正解長を取得
        var localStreak3Wrong = readIntFromLocalStorage("cscs_q_wrong_streak3_total:" + info.qid);
        var localWrongStreakLen = readIntFromLocalStorage("cscs_q_wrong_streak_len:" + info.qid);

        var diffCorrect = Math.max(0, localCorrect - serverCorrect);
        var diffWrong = Math.max(0, localWrong - serverWrong);
        var diffStreak3 = Math.max(0, localStreak3 - serverStreak3);
        var diffStreakLen = Math.max(0, localStreakLen - serverStreakLen);
        // ★ 不正解側: SYNC と local の差分（0 以上の増分）を計算
        var diffStreak3Wrong = Math.max(0, localStreak3Wrong - serverStreak3Wrong);
        var diffWrongStreakLen = Math.max(0, localWrongStreakLen - serverWrongStreakLen);

        // ★ コンソールで不正解ストリーク同期対象を確認できるようにログ出力
        console.log("[SYNC-B] wrong-streak diff (local vs server):", {
          qid: info.qid,
          serverStreak3Wrong: serverStreak3Wrong,
          localStreak3Wrong: localStreak3Wrong,
          diffStreak3Wrong: diffStreak3Wrong,
          serverWrongStreakLen: serverWrongStreakLen,
          localWrongStreakLen: localWrongStreakLen,
          diffWrongStreakLen: diffWrongStreakLen
        });

        // ★ O.D.O.A Mode の状態を SYNC state から読み取る
        //   - Workers 側で実際にどこに保存しているかに合わせてここを書き換えること
        var odoaModeRaw = null;
        if (state) {
          // トップレベル候補
          if (Object.prototype.hasOwnProperty.call(state, "odoaMode")) {
            odoaModeRaw = state.odoaMode;
          } else if (Object.prototype.hasOwnProperty.call(state, "odoa_mode")) {
            odoaModeRaw = state.odoa_mode;
          } else if (Object.prototype.hasOwnProperty.call(state, "ODOA_MODE")) {
            odoaModeRaw = state.ODOA_MODE;
          } else if (Object.prototype.hasOwnProperty.call(state, "ODOA")) {
            odoaModeRaw = state.ODOA;
          }

          // debug 配下の候補
          if (odoaModeRaw == null && state.debug && typeof state.debug === "object") {
            if (Object.prototype.hasOwnProperty.call(state.debug, "odoaMode")) {
              odoaModeRaw = state.debug.odoaMode;
            } else if (Object.prototype.hasOwnProperty.call(state.debug, "odoa_mode")) {
              odoaModeRaw = state.debug.odoa_mode;
            } else if (Object.prototype.hasOwnProperty.call(state.debug, "ODOA_MODE")) {
              odoaModeRaw = state.debug.ODOA_MODE;
            }
          }

          // navGuard 配下の候補（nav_guard.js が Workers にこう保存している可能性用）
          if (odoaModeRaw == null && state.navGuard && typeof state.navGuard === "object") {
            if (Object.prototype.hasOwnProperty.call(state.navGuard, "odoaMode")) {
              odoaModeRaw = state.navGuard.odoaMode;
            } else if (Object.prototype.hasOwnProperty.call(state.navGuard, "odoa_mode")) {
              odoaModeRaw = state.navGuard.odoa_mode;
            }
          }
        }

        // デバッグ用に一度ログ出し（騒がしければ後で消してOK）
        console.log("[SYNC-B] detected O.D.O.A from state:", {
          odoaModeRaw: odoaModeRaw
        });

        var odoaModeText = "不明";
        if (odoaModeRaw === true || odoaModeRaw === "TRUE" || odoaModeRaw === "true" ||
            odoaModeRaw === "ON" || odoaModeRaw === "on") {
          odoaModeText = "ON";
        } else if (odoaModeRaw === false || odoaModeRaw === "FALSE" || odoaModeRaw === "false" ||
                   odoaModeRaw === "OFF" || odoaModeRaw === "off") {
          odoaModeText = "OFF";
        }

        var statusTextForRender = suppressDiffSend ? "__keep__" : "state ok";

        // ★ 自動検証モード（CSCS_VERIFY_MODE=on）のときは、
        //   b_judge_record.js と同じく「計測ガード中」であることが分かるように
        //   statusText に明示しておく（diff の送信自体は後段でブロックする）
        var verifyModeOn =
          typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
        if (!suppressDiffSend && verifyModeOn) {
          statusTextForRender = "state ok / verify-mode: 計測ガード中(diff送信なし)";
        }

        // 初期表示や diff 送信前の HUD:
        //   - suppressDiffSend===true のときは "__keep__" を渡し、既存表示を維持
        //   - 通常モードでは「ON nocount」/「OFF」で初期表示を行う
        var odoaStatusTextForPanelInit;
        if (suppressDiffSend) {
          odoaStatusTextForPanelInit = "__keep__";
          console.log("[SYNC-B] ODOA HUD: suppressDiffSend=true → '__keep__' で再描画要求");
        } else {
          if (odoaModeText === "ON") {
            odoaStatusTextForPanelInit = "O.D.O.A Mode : ON nocount";
          } else {
            odoaStatusTextForPanelInit = "O.D.O.A Mode : OFF";
          }
          console.log("[SYNC-B] ODOA HUD: initial status set from mode:", odoaStatusTextForPanelInit);
        }

        var pending = computePendingFlags(state, info.qid);
        pending.pendingDiffCounts = (diffCorrect > 0 || diffWrong > 0 || diffStreak3 > 0 || diffStreakLen > 0 || diffStreak3Wrong > 0 || diffWrongStreakLen > 0);

        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: statusTextForRender,
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelInit,
          pending: pending
        });

        // ★ suppressDiffSend===true の場合は diff の POST を完全に止め、
        //    HUD 表示のみ更新した状態で終了する（手動 streak3Today テスト用）
        if (suppressDiffSend) {
          console.log("[SYNC-B] refreshAndSend: suppressDiffSend=true → diff POST を実行せず HUD 表示のみ更新", {
            qid: info.qid,
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            diffStreak3: diffStreak3,
            diffStreakLen: diffStreakLen,
            odoaModeText: odoaModeText
          });
          return;
        }

        // ★ 自動検証モード中（CSCS_VERIFY_MODE=on）は、
        //    b_judge_record.js と同様「計測ガード」として diff POST を完全にブロックする。
        //    これにより、verify モードで流した A→B 自動遷移では
        //    localStorage 側の計測を行わないだけでなく、
        //    SYNC 側の累計・streak3・oncePerDayToday も一切更新されない。
        if (verifyModeOn) {
          console.log("[SYNC-B] refreshAndSend: verify-mode ON → diff POST を実行せず HUD 表示のみ更新（計測ガード）", {
            qid: info.qid,
            serverCorrect: serverCorrect,
            serverWrong: serverWrong,
            localCorrect: localCorrect,
            localWrong: localWrong,
            diffCorrect: diffCorrect,
            diffWrong: diffWrong,
            diffStreak3: diffStreak3,
            diffStreakLen: diffStreakLen,
            odoaModeText: odoaModeText
          });
          return;
        }

        return sendDiffToServer(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          serverStreak3: serverStreak3,
          serverStreakLen: serverStreakLen,
          serverStreak3Wrong: serverStreak3Wrong,
          serverWrongStreakLen: serverWrongStreakLen,
          localCorrect: localCorrect,
          localWrong: localWrong,
          localStreak3: localStreak3,
          localStreakLen: localStreakLen,
          localStreak3Wrong: localStreak3Wrong,
          localWrongStreakLen: localWrongStreakLen,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          diffStreak3: diffStreak3,
          diffStreakLen: diffStreakLen,
          diffStreak3Wrong: diffStreak3Wrong,
          diffWrongStreakLen: diffWrongStreakLen,
          // ★ oncePerDayTodayDelta を作るために /api/sync/state の snapshot を渡す
          syncState: state,
          // ★ O.D.O.A Mode 表示用テキストも sendDiffToServer に引き継ぎ
          odoaModeText: odoaModeText
        });
      })
      .catch(function (e) {
        console.error("[SYNC-B] state fetch error:", e);
        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);

        var odoaModeText = "不明(state error)";
        var odoaStatusTextForPanelStateError;
        odoaStatusTextForPanelStateError = "O.D.O.A Mode : OFF";

        renderPanel(box, {
          serverCorrect: 0,
          serverWrong: 0,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: 0,
          diffWrong: 0,
          serverStreak3: 0,
          localStreak3: localStreak3,
          diffStreak3: 0,
          serverStreakLen: 0,
          localStreakLen: localStreakLen,
          diffStreakLen: 0,
          statusText: "state error",
          odoaModeText: odoaModeText,
          odoaStatusText: odoaStatusTextForPanelStateError
        });
      });
  }

  function init() {
    // ★ パネル生成より先にCSSを注入（初回表示から確実に適用）
    ensureSyncViewBStyles();

    var box = createPanel();

    function append() {
      var wrap = document.querySelector("div.wrap");
      if (wrap) {
        if (!wrap.contains(box)) {
          wrap.appendChild(box);
        }
      } else {
        if (!document.body.contains(box)) {
          document.body.appendChild(box);
        }
      }
      var btn = document.getElementById("cscs_sync_view_b_send_btn");
      if (btn) {
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();

          // ① 手動テスト時は HUD の表示だけ更新し、diff のサーバー送信は抑制する
          //    → 最初の refreshAndSend では「現在の state」に基づく HUD を表示するだけ
          refreshAndSend(box, { suppressDiffSend: true });

          // ② Local streak3Today / streak3WrongToday 情報を「手動送信」するテスト用トリガー
          //    - それぞれの merge 完了後にもう一度 HUD を更新して、
          //      /api/sync/state に反映された最新の streak3Today / streak3WrongToday を HUD に出す
          var promises = [];

          if (window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3TodayUnique === "function") {
            console.log("[SYNC-B:HUD] manual streak3Today SEND requested from button (diff POST suppressed)");
            var pToday = window.CSCS_SYNC.recordStreak3TodayUnique();
            if (pToday && typeof pToday.then === "function") {
              promises.push(pToday);
            }
          } else {
            console.warn("[SYNC-B:HUD] recordStreak3TodayUnique is not available (手動送信不可)");
          }

          if (window.CSCS_SYNC && typeof window.CSCS_SYNC.recordStreak3WrongTodayUnique === "function") {
            console.log("[SYNC-B:HUD] manual streak3WrongToday SEND requested from button (diff POST suppressed)");
            var pWrongToday = window.CSCS_SYNC.recordStreak3WrongTodayUnique();
            if (pWrongToday && typeof pWrongToday.then === "function") {
              promises.push(pWrongToday);
            }
          } else {
            console.warn("[SYNC-B:HUD] recordStreak3WrongTodayUnique is not available (手動送信不可)");
          }

          if (promises.length > 0) {
            Promise.all(promises).then(function () {
              console.log("[SYNC-B:HUD] streak3Today / streak3WrongToday merge completed → HUD 再取得＋再描画（diff POST 抑制）");
              refreshAndSend(box, { suppressDiffSend: true });
            }).catch(function (e) {
              console.error("[SYNC-B:HUD] streak3Today / streak3WrongToday manual send error:", e);
            });
          }
        });
      }
      // ③ 初期表示時の HUD 更新（diff 送信ありの通常モード）
      refreshAndSend(box);

      // ★【超重要仕様：この自動クリックも「削除禁止」】
      //   - 下の setTimeout で呼ばれる btn.click() は、単なるデバッグ用ではなく、
      //     「streak3Today / streak3WrongToday を Bパートから SYNC に送信するための正式な起動トリガー」。
      //   - click ハンドラ内では diff POST を抑制した上で
      //       window.CSCS_SYNC.recordStreak3TodayUnique()
      //       window.CSCS_SYNC.recordStreak3WrongTodayUnique()
      //     を呼び出し、/api/sync/merge に streak3TodayDelta / streak3WrongTodayDelta を送っている。
      //   - つまり、ここを削除・コメントアウト・条件分岐で無効化すると、
      //     「localStorage 側では計測されているのに、SYNC 側の今日の⭐️/💣ユニーク数が一切増えない」
      //     という不可視な不具合が発生する。
      //   - ChatGPT などが「テスト用の自動クリックだから不要」と誤認して消さないよう、
      //     このコメントで意図を明示している。
      //
      // ④ 追加: ページロード後約1.0秒で「SYNC送信ボタン」を自動クリックして、
      //    手動クリックと同じ挙動（diff POST 抑制 + streak3TodayDelta / streak3WrongTodayDelta 送信）を一度だけ実行する
      if (btn) {
        setTimeout(function () {
          console.log("[SYNC-B:auto] 1.0秒後に SYNC 送信ボタンを自動クリックします");
          btn.click();
        }, 1000);
      } else {
        console.log("[SYNC-B:auto] SYNC 送信ボタンが見つからないため、自動クリックを行いません");
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", append);
    } else {
      append();
    }
  }

  if (typeof window.CSCS_SYNC === "undefined" || window.CSCS_SYNC === null) {
    window.CSCS_SYNC = {};
  }

  window.CSCS_SYNC.recordStreak3TodayUnique = async function () {
    try {
      // ★ 追加ガード: O.D.O.A が nocount のときは streak3Today を一切送らない
      var state = null;
      try {
        state = window.__cscs_sync_state || null;
      } catch(_e) {
        state = null;
      }
      if (state && (state.odoaMode === "on_nocount" || state.odoa_mode === "on_nocount")) {
        // 補足: nocount 中に streak3Today が送信されると「正誤を計測していないのに★だけ増える事故」が発生するため、
        //       ここで必ずブロックする。
        console.log("[SYNC-B:streak3Today] skip because O.D.O.A = on_nocount");
        return;
      }

      // 1) オフラインならそもそも送信しない（Bパートからの streak3TodayDelta は「オンライン時だけ」）
      if (!navigator.onLine) {
        console.warn("[SYNC-B:streak3Today] offline → 送信スキップ");
        return;
      }

      // 2) localStorage に溜まっている「今日の⭐️情報」を読み出すための一時変数
      var day = "";
      var qids = [];
      var localCount = 0;

      try {
        // 2-1) 「今日が何日か」を表す文字列（例: "20251201"）
        day = localStorage.getItem("cscs_streak3_today_day") || "";
        // 2-2) 今日⭐️を新規獲得した qid の配列をシリアライズした文字列
        var rawQids = localStorage.getItem("cscs_streak3_today_qids");
        // 2-3) 今日の⭐️ユニーク数（local 側カウンタ）
        var rawCnt = localStorage.getItem("cscs_streak3_today_unique_count");

        // 2-4) qids の JSON をパースして「妥当な文字列だけ」の配列にクリーンアップ
        if (rawQids) {
          var parsed = JSON.parse(rawQids);
          if (Array.isArray(parsed)) {
            qids = parsed.filter(function (x) {
              return typeof x === "string" && x;
            });
          }
        }

        // 2-5) ユニーク数を数値にパース（不正値や負数は 0 扱い）
        var cnt = parseInt(rawCnt || "0", 10);
        if (Number.isFinite(cnt) && cnt >= 0) {
          localCount = cnt;
        }
      } catch (_e) {
        // localStorage / JSON パースのどこかで失敗した場合は「空データ」として扱う
        day = "";
        qids = [];
        localCount = 0;
      }

      // 3) 読み出したローカル状態をコンソールにフル出力（デバッグ用）
      console.group("[SYNC-B:streak3Today] recordStreak3TodayUnique CALLED");
      console.log("local.day =", day);
      console.log("local.qids =", qids);
      console.log("local.unique_count =", localCount);
      console.groupEnd();

      // 4) 日付か qid 配列が空なら、サーバー側を壊さないために送信しない
      //    - 初回起動直後など「まだ streak3Today 情報が無い」ケースは正常なスキップとして扱う
      if (!day || qids.length === 0) {
        console.log("[SYNC-B:streak3Today] day 又は qids が空 → 正常スキップ（まだ送るべきデータがない）", {
          day: day,
          qidsLength: qids.length
        });
        return;
      }

      // 5) Workers 側の merge.ts に渡す streak3TodayDelta のペイロードを組み立て
      //    - day: "YYYYMMDD" 形式
      //    - qids: その日に⭐️を初めて取った問題の qid 配列
      var payload = {
        streak3TodayDelta: {
          day: day,
          qids: qids
        },
        updatedAt: Date.now()
      };

      // 6) 送信直前の payload を丸ごとログに出しておく
      console.group("[SYNC-B:streak3Today] SEND payload");
      console.log(payload);
      console.groupEnd();

      // 7) /api/sync/merge に対して streak3TodayDelta 専用のリクエストを送信
      var res = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // 8) HTTP レベルでエラーならここで終了（サーバー保存失敗の可能性）
      if (!res.ok) {
        console.error("[SYNC-B:streak3Today] merge FAILED:", res.status);
        return;
      }

      // 9) merge.ts が返してきた最新の SYNC スナップショットを取得（失敗しても致命的ではない）
      var merged = null;
      try {
        merged = await res.json();
      } catch (_e2) {
        merged = null;
      }

      // 10) merge のレスポンスをログに残しておく（Workers 側でどう保存されたかの確認用）
      console.group("[SYNC-B:streak3Today] MERGE result");
      console.log("mergeResponse =", merged);
      console.groupEnd();

      // 11) さらに /api/sync/state を叩いて、KV に反映された最終形の streak3Today を確認する
      try {
        var stateAfter = await fetchState();
        try {
          // 11-1) 取得した state 全体をグローバルに保持して、
          //       Bパート HUD や他のビューからも streak3Today を参照できるようにする
          window.__cscs_sync_state = stateAfter;
        } catch (_e3) {}

        // 11-2) stateAfter.streak3Today の中身をそのままログに出して、
        //       「day / unique_count / qids がどのように保存されたか」を確認できるようにする
        console.group("[SYNC-B:streak3Today] UPDATED state.streak3Today");
        console.log(stateAfter && stateAfter.streak3Today);
        console.groupEnd();

      } catch (e4) {
        // state の再取得自体が失敗したケース（merge 自体は成功している可能性あり）
        console.error("[SYNC-B:streak3Today] state refresh ERROR:", e4);
      }

    } catch (e) {
      // 想定外の例外が起きた場合も握りつぶさずログに出す
      console.error("[SYNC-B:streak3Today] fatal error:", e);
    }
  };

  // ★ 不正解版: 今日の3連続不正解ユニーク（Streak3WrongToday）を SYNC 側に送信する
  window.CSCS_SYNC.recordStreak3WrongTodayUnique = async function () {
    try {
      // ★ 追加ガード: O.D.O.A が nocount のときは streak3WrongToday を一切送らない
      var state = null;
      try {
        state = window.__cscs_sync_state || null;
      } catch(_e) {
        state = null;
      }
      if (state && (state.odoaMode === "on_nocount" || state.odoa_mode === "on_nocount")) {
        // 補足: nocount 中に streak3WrongToday が送信されると
        //       「正誤を計測していないのに💣だけ増える事故」が発生するため、ここで必ずブロックする。
        console.log("[SYNC-B:streak3WrongToday] skip because O.D.O.A = on_nocount");
        return;
      }

      // 1) オフラインならそもそも送信しない（Bパートからの streak3WrongTodayDelta は「オンライン時だけ」）
      if (!navigator.onLine) {
        console.warn("[SYNC-B:streak3WrongToday] offline → 送信スキップ");
        return;
      }

      // 2) localStorage に溜まっている「今日の3連続不正解情報」を読み出すための一時変数
      var day = "";
      var qids = [];
      var localCount = 0;

      try {
        // 2-1) 「今日が何日か」を表す文字列（例: "20251201"）
        day = localStorage.getItem("cscs_streak3_wrong_today_day") || "";
        // 2-2) 今日💣を新規獲得した qid の配列をシリアライズした文字列
        var rawQids = localStorage.getItem("cscs_streak3_wrong_today_qids");
        // 2-3) 今日の3連続不正解ユニーク数（local 側カウンタ）
        var rawCnt = localStorage.getItem("cscs_streak3_wrong_today_unique_count");

        // 2-4) qids の JSON をパースして「妥当な文字列だけ」の配列にクリーンアップ
        if (rawQids) {
          var parsed = JSON.parse(rawQids);
          if (Array.isArray(parsed)) {
            qids = parsed.filter(function (x) {
              return typeof x === "string" && x;
            });
          }
        }

        // 2-5) ユニーク数を数値にパース（不正値や負数は 0 扱い）
        var cnt = parseInt(rawCnt || "0", 10);
        if (Number.isFinite(cnt) && cnt >= 0) {
          localCount = cnt;
        }
      } catch (_e2) {
        // localStorage / JSON パースのどこかで失敗した場合は「空データ」として扱う
        day = "";
        qids = [];
        localCount = 0;
      }

      // 3) 読み出したローカル状態をコンソールにフル出力（デバッグ用）
      console.group("[SYNC-B:streak3WrongToday] recordStreak3WrongTodayUnique CALLED");
      console.log("local.day =", day);
      console.log("local.qids =", qids);
      console.log("local.unique_count =", localCount);
      console.groupEnd();

      // 4) 日付か qid 配列が空なら、サーバー側を壊さないために送信しない
      //    - 初回起動直後など「まだ streak3WrongToday 情報が無い」ケースは正常なスキップとして扱う
      if (!day || qids.length === 0) {
        console.log("[SYNC-B:streak3WrongToday] day 又は qids が空 → 正常スキップ（まだ送るべきデータがない）", {
          day: day,
          qidsLength: qids.length
        });
        return;
      }

      // 5) Workers 側の merge.ts に渡す streak3WrongTodayDelta のペイロードを組み立て
      //    - day: "YYYYMMDD" 形式
      //    - qids: その日に💣を初めて取った問題の qid 配列
      var payload = {
        streak3WrongTodayDelta: {
          day: day,
          qids: qids
        },
        updatedAt: Date.now()
      };

      // 6) 送信直前の payload を丸ごとログに出しておく
      console.group("[SYNC-B:streak3WrongToday] SEND payload");
      console.log(payload);
      console.groupEnd();

      // 7) /api/sync/merge に対して streak3WrongTodayDelta 専用のリクエストを送信
      var res = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // 8) HTTP レベルでエラーならここで終了（サーバー保存失敗の可能性）
      if (!res.ok) {
        console.error("[SYNC-B:streak3WrongToday] merge FAILED:", res.status);
        return;
      }

      // 9) merge.ts が返してきた最新の SYNC スナップショットを取得（失敗しても致命的ではない）
      var merged = null;
      try {
        merged = await res.json();
      } catch (_e3) {
        merged = null;
      }

      // 10) merge のレスポンスをログに残しておく（Workers 側でどう保存されたかの確認用）
      console.group("[SYNC-B:streak3WrongToday] MERGE result");
      console.log("mergeResponse =", merged);
      console.groupEnd();

      // 11) さらに /api/sync/state を叩いて、KV に反映された最終形の streak3WrongToday を確認する
      try {
        var stateAfter = await fetchState();
        try {
          // 11-1) 取得した state 全体をグローバルに保持して、
          //       Bパート HUD や他のビューからも streak3WrongToday を参照できるようにする
          window.__cscs_sync_state = stateAfter;
        } catch (_e4) {}

        // 11-2) stateAfter.streak3WrongToday の中身をそのままログに出して、
        //       「day / unique_count / qids がどのように保存されたか」を確認できるようにする
        console.group("[SYNC-B:streak3WrongToday] UPDATED state.streak3WrongToday");
        console.log(stateAfter && stateAfter.streak3WrongToday);
        console.groupEnd();

      } catch (e5) {
        // state の再取得自体が失敗したケース（merge 自体は成功している可能性あり）
        console.error("[SYNC-B:streak3WrongToday] state refresh ERROR:", e5);
      }

    } catch (e) {
      // 想定外の例外が起きた場合も握りつぶさずログに出す
      console.error("[SYNC-B:streak3WrongToday] fatal error:", e);
    }
  };

  window.addEventListener("online", function () {
    var box = document.getElementById("cscs_sync_view_b");
    if (!box) return;
    refreshAndSend(box);
  });

  init();
})();　

