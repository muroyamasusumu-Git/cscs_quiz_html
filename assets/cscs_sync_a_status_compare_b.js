// assets/cscs_sync_a_status_compare_b.js
/**
 * CSCS SYNC Monitor (B)
 * 目的:
 *   - Aで表示されている「SYNCステータスパネル風」のUIを、Bでも表示する。
 *   - B側は“表示専用”として扱い、送信キューやmerge送信は担当しない。
 *
 * 参照元（フォールバック禁止）:
 *   - localStorage（b_judge_record.js が書く各キー）
 *   - /api/sync/state（SYNC state）
 *
 * パネルroot:
 *   - id="cscs_sync_monitor_b"
 *
 * 注意:
 *   - 「取れない値は取れない」と表示する（0埋め/別ルート補完禁止）
 */
(function () {
  "use strict";

  // 二重起動防止
  if (window.__CSCS_SYNC_MONITOR_B_INSTALLED__) return;
  window.__CSCS_SYNC_MONITOR_B_INSTALLED__ = true;

  var SYNC_STATE_ENDPOINT = "/api/sync/state";

  // -----------------------------
  // QID検出（Bパート）
  // 例: /_build_cscs_20250926/slides/q013_b.html → "20250926-013"
  // -----------------------------
  function detectQidFromLocationB() {
    var m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) return null;
    var day = m[1];
    var num3 = m[2];
    return day + "-" + num3;
  }

  var QID = detectQidFromLocationB();

  // -----------------------------
  // 表示補助（欠損は "-" / "（データなし）"）
  // -----------------------------
  function toDisplayText(value, emptyLabel) {
    var fallback = (emptyLabel != null) ? String(emptyLabel) : "-";
    if (value === null || value === undefined) return fallback;
    var s = String(value);
    if (s.trim() === "") return fallback;
    return s;
  }

  function readLsNonNegIntOrNull(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return null;
      var s = String(raw).trim();
      if (s === "") return null;
      if (!/^\d+$/.test(s)) return null;
      var n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    } catch (_) {
      return null;
    }
  }

  function readLsStringOrNull(key) {
    try {
      var v = localStorage.getItem(key);
      if (v === null || v === undefined) return null;
      var s = String(v).trim();
      if (s === "") return null;
      return s;
    } catch (_) {
      return null;
    }
  }

  function readLsJsonOrNull(key) {
    try {
      var v = localStorage.getItem(key);
      if (v === null || v === undefined) return null;
      var s = String(v).trim();
      if (s === "") return null;
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }

  function getTodayYmdNum() {
    try {
      var now = new Date();
      var yy = now.getFullYear();
      var mm = now.getMonth() + 1;
      var dd = now.getDate();
      return yy * 10000 + mm * 100 + dd;
    } catch (_) {
      return null;
    }
  }

  function isTodayYmdString(ymdStr) {
    try {
      var s = String(ymdStr || "").trim();
      if (!/^\d{8}$/.test(s)) return "unknown";
      var t = getTodayYmdNum();
      if (t === null) return "unknown";
      return (s === String(t)) ? "YES" : "NO";
    } catch (_) {
      return "unknown";
    }
  }

  // -----------------------------
  // 共通CSS（A風）をBにも注入
  // ※ここは「AのCSSをそのまま完全コピー」ではなく、
  //   Aと同系統のカード/グリッド表現を新規で作る。
  // -----------------------------
  function injectCscsSyncMonitorBStyleOnce() {
    // 目的:
    //   - Bの見た目/カード構成を「Aと完全同一」に寄せるため、A側と同じ共通CSS注入関数を使う。
    //   - このファイル内で独自CSSを生成して“それっぽく”寄せるのは禁止（Aと差分が出て比較できないため）。
    // 成功ログ:
    //   - 共通CSSが呼べたかを必ずconsoleで確認できるようにする。
    try {
      if (typeof window.injectCscsSyncMonitorCommonStyleOnce === "function") {
        window.injectCscsSyncMonitorCommonStyleOnce();
        console.log("[CSCS_SYNC_MONITOR_B] common style injected: OK");
      } else {
        console.warn("[CSCS_SYNC_MONITOR_B] common style injector not found: window.injectCscsSyncMonitorCommonStyleOnce");
      }
    } catch (e) {
      console.warn("[CSCS_SYNC_MONITOR_B] common style inject failed:", e);
    }
  }

  // -----------------------------
  // DOM生成（B用パネル）
  // -----------------------------
  function buildMonitorDomB() {
    // 目的:
    //   - BパネルのDOMクラス構成を、Aパネルと「同一のカード/行クラス」に統一する。
    //   - A/Bを隣に並べた時に“カード構造そのもの”が一致することが重要（比較のため）。
    // 成功ログ:
    //   - DOM生成が新規だったか/既存再利用だったかをconsoleで判別できるようにする。
    var root = document.getElementById("cscs_sync_monitor_b");
    if (root) {
      console.log("[CSCS_SYNC_MONITOR_B] buildMonitorDomB: reuse existing root");
      return root;
    }

    root = document.createElement("div");
    root.id = "cscs_sync_monitor_b";

    var wrap = document.createElement("div");
    wrap.className = "sync-wrap";

    var head = document.createElement("div");
    head.className = "sync-head";

    var left = document.createElement("div");
    left.className = "sync-head-left";
    left.style.minWidth = "0";

    var title = document.createElement("div");
    title.className = "sync-title";
    title.textContent = "CSCS SYNC Monitor (B)";

    var sub = document.createElement("div");
    sub.className = "sync-sub";
    sub.innerHTML =
      'QID: <span class="sync-qid sync-tag"></span> ' +
      '<span class="sync-status sync-tag"></span>';

    left.appendChild(title);
    left.appendChild(sub);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sync-btn";
    btn.textContent = "OPEN";
    btn.setAttribute("aria-expanded", "false");

    head.appendChild(left);
    head.appendChild(btn);

    var body = document.createElement("div");
    body.className = "sync-body sync-hidden";

    // グリッド本体（Aと同一クラス）
    var grid = document.createElement("div");
    grid.className = "sync-grid";

    function card(titleText, wide) {
      var c = document.createElement("div");
      c.className = "sync-card" + (wide ? " sync-span-2" : "");
      var h = document.createElement("div");
      h.className = "sync-card-title";
      h.textContent = titleText;
      c.appendChild(h);
      return c;
    }

    function row(k, clsV) {
      var r = document.createElement("div");
      r.className = "sync-row";
      var kk = document.createElement("div");
      kk.className = "sync-k";
      kk.textContent = k;
      var vv = document.createElement("div");
      vv.className = "sync-v " + clsV;
      vv.textContent = "-";
      r.appendChild(kk);
      r.appendChild(vv);
      return r;
    }

    // Totals（SYNC / local）
    var cTotals = card("Totals (c / w)", true);
    cTotals.appendChild(row("SYNC", "v-sync-totals"));
    cTotals.appendChild(row("local", "v-local-totals"));
    cTotals.appendChild(row("+Δ(参考)", "v-delta-ref"));
    cTotals.appendChild(document.createElement("div")).className = "sync-mini v-note-totals";
    grid.appendChild(cTotals);

    // Streak (correct)
    var cStreak = card("Streak (correct)", false);
    cStreak.appendChild(row("streak3 (SYNC)", "v-sync-s3"));
    cStreak.appendChild(row("streak3 (local)", "v-local-s3"));
    cStreak.appendChild(row("len (SYNC)", "v-sync-sl"));
    cStreak.appendChild(row("len (local)", "v-local-sl"));
    cStreak.appendChild(row("progress SYNC", "v-sync-prog"));
    cStreak.appendChild(row("progress local", "v-local-prog"));
    grid.appendChild(cStreak);

    // Streak (wrong)
    var cWStreak = card("Streak (wrong)", false);
    cWStreak.appendChild(row("streak3 (SYNC)", "v-sync-s3w"));
    cWStreak.appendChild(row("streak3 (local)", "v-local-s3w"));
    cWStreak.appendChild(row("len (SYNC)", "v-sync-slw"));
    cWStreak.appendChild(row("len (local)", "v-local-slw"));
    cWStreak.appendChild(row("progress SYNC", "v-sync-progw"));
    cWStreak.appendChild(row("progress local", "v-local-progw"));
    grid.appendChild(cWStreak);

    // streak max (local)
    var cMax = card("Streak Max (local)", true);
    cMax.appendChild(row("len (now)", "v-local-max-len"));
    cMax.appendChild(row("max", "v-local-max-val"));
    cMax.appendChild(row("day", "v-local-max-day"));
    cMax.appendChild(document.createElement("div")).className = "sync-mini v-note-max";
    grid.appendChild(cMax);

    // wrong streak max (local)
    var cWMax = card("Wrong Streak Max (local)", true);
    cWMax.appendChild(row("len (now)", "v-local-wmax-len"));
    cWMax.appendChild(row("max", "v-local-wmax-val"));
    cWMax.appendChild(row("day", "v-local-wmax-day"));
    cWMax.appendChild(document.createElement("div")).className = "sync-mini v-note-wmax";
    grid.appendChild(cWMax);

    // Today streak3 unique
    var cToday = card("Streak3Today (⭐️ unique)", true);
    cToday.appendChild(row("SYNC day", "v-s3t-sync-day"));
    cToday.appendChild(row("local day", "v-s3t-local-day"));
    cToday.appendChild(row("isToday (SYNC)", "v-s3t-istoday"));
    cToday.appendChild(row("SYNC unique", "v-s3t-sync-uc"));
    cToday.appendChild(row("local unique", "v-s3t-local-uc"));
    grid.appendChild(cToday);

    // Today wrong streak3 unique
    var cWToday = card("Streak3WrongToday (unique)", true);
    cWToday.appendChild(row("SYNC day", "v-s3wt-sync-day"));
    cWToday.appendChild(row("local day", "v-s3wt-local-day"));
    cWToday.appendChild(row("isToday (SYNC)", "v-s3wt-istoday"));
    cWToday.appendChild(row("SYNC unique", "v-s3wt-sync-uc"));
    cWToday.appendChild(row("local unique", "v-s3wt-local-uc"));
    grid.appendChild(cWToday);

    // oncePerDayToday
    var cOnce = card("OncePerDayToday / ODOA", true);
    cOnce.appendChild(row("oncePerDayToday.day (SYNC)", "v-once-sync-day"));
    cOnce.appendChild(row("oncePerDayToday.day (local)", "v-once-local-day"));
    cOnce.appendChild(row("isToday (SYNC)", "v-once-istoday"));
    cOnce.appendChild(row("result for this QID (SYNC)", "v-once-result"));
    cOnce.appendChild(row("ODOA_MODE", "v-odoa-mode"));
    grid.appendChild(cOnce);

    // last day info
    var cLast = card("LastSeen / LastCorrect / LastWrong", true);
    cLast.appendChild(row("lastSeen (SYNC)", "v-last-seen-sync"));
    cLast.appendChild(row("lastSeen (local)", "v-last-seen-local"));
    cLast.appendChild(row("lastCorrect (SYNC)", "v-last-cor-sync"));
    cLast.appendChild(row("lastCorrect (local)", "v-last-cor-local"));
    cLast.appendChild(row("lastWrong (SYNC)", "v-last-wrg-sync"));
    cLast.appendChild(row("lastWrong (local)", "v-last-wrg-local"));
    grid.appendChild(cLast);

    body.appendChild(grid);
    wrap.appendChild(head);
    wrap.appendChild(body);
    root.appendChild(wrap);
    document.body.appendChild(root);

    // open/close（Aと同一クラスで開閉）
    btn.addEventListener("click", function () {
      // 目的:
      //   - Aと同じ「sync-hidden」で開閉制御し、比較時に挙動も一致させる。
      // 成功ログ:
      //   - クリックごとに open/close 状態をconsoleで確認できる。
      var open = !body.classList.contains("sync-hidden");
      if (open) {
        body.classList.add("sync-hidden");
        btn.textContent = "OPEN";
        btn.setAttribute("aria-expanded", "false");
        console.log("[CSCS_SYNC_MONITOR_B] toggle: CLOSE");
      } else {
        body.classList.remove("sync-hidden");
        btn.textContent = "CLOSE";
        btn.setAttribute("aria-expanded", "true");
        console.log("[CSCS_SYNC_MONITOR_B] toggle: OPEN");
      }
    });

    console.log("[CSCS_SYNC_MONITOR_B] buildMonitorDomB: created new root");
    return root;
  }

  // -----------------------------
  // state取得（B）
  // -----------------------------
  async function fetchSyncStateB() {
    var res = await fetch(SYNC_STATE_ENDPOINT, { method: "GET" });
    if (!res.ok) throw new Error(String(res.status));
    var json = await res.json();
    return json;
  }

  // -----------------------------
  // 値の読み取り（local / sync）
  // -----------------------------
  function readLocalSnapshotForQid(qid) {
    if (!qid) {
      return {
        totals: { c: null, w: null },
        streak: { s3: null, sl: null },
        wrong: { s3: null, sl: null },
        max: { max: null, day: null },
        wmax: { max: null, day: null },
        last: { seen: null, cor: null, wrg: null },
        s3t: { day: null, uc: null },
        s3wt: { day: null, uc: null },
        once: { day: null, results: null }
      };
    }

    var kC = "cscs_q_correct_total:" + qid;
    var kW = "cscs_q_wrong_total:" + qid;

    var kS3 = "cscs_q_correct_streak3_total:" + qid;
    var kSL = "cscs_q_correct_streak_len:" + qid;

    var kS3W = "cscs_q_wrong_streak3_total:" + qid;
    var kSLW = "cscs_q_wrong_streak_len:" + qid;

    var kMax = "cscs_q_correct_streak_max:" + qid;
    var kMaxDay = "cscs_q_correct_streak_max_day:" + qid;

    var kWMax = "cscs_q_wrong_streak_max:" + qid;
    var kWMaxDay = "cscs_q_wrong_streak_max_day:" + qid;

    var kSeen = "cscs_q_last_seen_day:" + qid;
    var kCor = "cscs_q_last_correct_day:" + qid;
    var kWrg = "cscs_q_last_wrong_day:" + qid;

    return {
      totals: { c: readLsNonNegIntOrNull(kC), w: readLsNonNegIntOrNull(kW) },
      streak: { s3: readLsNonNegIntOrNull(kS3), sl: readLsNonNegIntOrNull(kSL) },
      wrong: { s3: readLsNonNegIntOrNull(kS3W), sl: readLsNonNegIntOrNull(kSLW) },
      max: { max: readLsNonNegIntOrNull(kMax), day: readLsStringOrNull(kMaxDay) },
      wmax: { max: readLsNonNegIntOrNull(kWMax), day: readLsStringOrNull(kWMaxDay) },
      last: { seen: readLsStringOrNull(kSeen), cor: readLsStringOrNull(kCor), wrg: readLsStringOrNull(kWrg) },
      s3t: {
        day: readLsStringOrNull("cscs_streak3_today_day"),
        uc: readLsNonNegIntOrNull("cscs_streak3_today_unique_count")
      },
      s3wt: {
        day: readLsStringOrNull("cscs_streak3_wrong_today_day"),
        uc: readLsNonNegIntOrNull("cscs_streak3_wrong_today_unique_count")
      },
      once: {
        day: readLsStringOrNull("cscs_once_per_day_today_day"),
        results: readLsJsonOrNull("cscs_once_per_day_today_results")
      }
    };
  }

  function readSyncSnapshotForQid(state, qid) {
    function readMapNum(mapKey) {
      try {
        if (!state || typeof state !== "object") return null;
        if (!state[mapKey] || typeof state[mapKey] !== "object") return null;
        if (!qid) return null;
        if (!Object.prototype.hasOwnProperty.call(state[mapKey], qid)) return null;
        var v = state[mapKey][qid];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
        return v;
      } catch (_) {
        return null;
      }
    }

    function readLastDay(mapKey) {
      try {
        if (!state || typeof state !== "object") return null;
        if (!state[mapKey] || typeof state[mapKey] !== "object") return null;
        if (!qid) return null;
        var v = state[mapKey][qid];
        if (v === null || v === undefined) return null;
        var s = String(v).trim();
        if (s === "") return null;
        return s;
      } catch (_) {
        return null;
      }
    }

    var s3t = null;
    try {
      if (state && state.streak3Today && typeof state.streak3Today === "object") s3t = state.streak3Today;
    } catch (_) {
      s3t = null;
    }

    var s3wt = null;
    try {
      if (state && state.streak3WrongToday && typeof state.streak3WrongToday === "object") s3wt = state.streak3WrongToday;
    } catch (_) {
      s3wt = null;
    }

    var once = null;
    try {
      if (state && state.oncePerDayToday && typeof state.oncePerDayToday === "object") once = state.oncePerDayToday;
    } catch (_) {
      once = null;
    }

    return {
      totals: { c: readMapNum("correct"), w: readMapNum("incorrect") },
      streak: { s3: readMapNum("streak3"), sl: readMapNum("streakLen") },
      wrong: { s3: readMapNum("streak3Wrong"), sl: readMapNum("streakWrongLen") },
      last: {
        seen: readLastDay("lastSeenDay"),
        cor: readLastDay("lastCorrectDay"),
        wrg: readLastDay("lastWrongDay")
      },
      s3t: {
        day: (s3t && ("day" in s3t)) ? String(s3t.day) : null,
        uc: (s3t && typeof s3t.unique_count === "number" && Number.isFinite(s3t.unique_count) && s3t.unique_count >= 0) ? s3t.unique_count : null
      },
      s3wt: {
        day: (s3wt && ("day" in s3wt)) ? String(s3wt.day) : null,
        uc: (s3wt && typeof s3wt.unique_count === "number" && Number.isFinite(s3wt.unique_count) && s3wt.unique_count >= 0) ? s3wt.unique_count : null
      },
      once: (function () {
        var out = { day: null, result: null };
        try {
          if (!once) return out;

          if (typeof once.day === "number" && Number.isFinite(once.day) && once.day > 0) out.day = String(once.day);
          if (typeof once.day === "string" && once.day.trim() !== "") out.day = once.day.trim();

          if (qid && once.results && typeof once.results === "object") {
            if (Object.prototype.hasOwnProperty.call(once.results, qid)) {
              out.result = String(once.results[qid]);
            }
          }
          return out;
        } catch (_) {
          return out;
        }
      })()
    };
  }

  // -----------------------------
  // UI更新
  // -----------------------------
  function setText(root, cls, text) {
    var el = root.querySelector("." + cls);
    if (!el) return;
    el.textContent = text;
  }

  function updateUiB(root, localSnap, syncSnap, stateOk, lastError) {
    // header
    // 目的:
    //   - buildMonitorDomB() でA同一クラス（sync-qid / sync-status）に統一したため、参照クラスも揃える。
    // 成功ログ:
    //   - ヘッダの2要素がDOM上に存在して更新できたかをconsoleで確認する。
    (function () {
      var qidText = QID ? QID : "（データなし）";
      var statusText = stateOk ? "state:OK" : ("state:ERR " + toDisplayText(lastError, "-"));

      setText(root, "sync-qid", qidText);
      setText(root, "sync-status", statusText);

      var hasQid = !!root.querySelector(".sync-qid");
      var hasStatus = !!root.querySelector(".sync-status");
      if (hasQid && hasStatus) {
        console.log("[CSCS_SYNC_MONITOR_B] header updated: OK", { qid: qidText, status: statusText });
      } else {
        console.warn("[CSCS_SYNC_MONITOR_B] header updated: MISSING_EL", { hasQid: hasQid, hasStatus: hasStatus });
      }
    })();

    // Totals
    var syncTotals = "SYNC " + toDisplayText(syncSnap.totals.c, "-") + " / " + toDisplayText(syncSnap.totals.w, "-");
    var localTotals = "local " + toDisplayText(localSnap.totals.c, "-") + " / " + toDisplayText(localSnap.totals.w, "-");
    setText(root, "v-sync-totals", syncTotals);
    setText(root, "v-local-totals", localTotals);

    // Δ(参考) = (local - sync) ※取れた時だけ
    var dRef = "-";
    if (typeof localSnap.totals.c === "number" && typeof syncSnap.totals.c === "number" &&
        typeof localSnap.totals.w === "number" && typeof syncSnap.totals.w === "number") {
      dRef = String(localSnap.totals.c - syncSnap.totals.c) + " / " + String(localSnap.totals.w - syncSnap.totals.w);
    }
    setText(root, "v-delta-ref", dRef);

    var noteTotals = root.querySelector(".v-note-totals");
    if (noteTotals) {
      noteTotals.textContent = "※Δは参考（両方が取れた時だけ計算）。欠損は欠損のまま。";
    }

    // Streak correct
    setText(root, "v-sync-s3", toDisplayText(syncSnap.streak.s3, "-"));
    setText(root, "v-local-s3", toDisplayText(localSnap.streak.s3, "-"));
    setText(root, "v-sync-sl", toDisplayText(syncSnap.streak.sl, "-"));
    setText(root, "v-local-sl", toDisplayText(localSnap.streak.sl, "-"));

    var sp = (typeof syncSnap.streak.sl === "number") ? (syncSnap.streak.sl % 3) : null;
    var lp = (typeof localSnap.streak.sl === "number") ? (localSnap.streak.sl % 3) : null;
    setText(root, "v-sync-prog", toDisplayText(sp, "-"));
    setText(root, "v-local-prog", toDisplayText(lp, "-"));

    // Streak wrong
    setText(root, "v-sync-s3w", toDisplayText(syncSnap.wrong.s3, "-"));
    setText(root, "v-local-s3w", toDisplayText(localSnap.wrong.s3, "-"));
    setText(root, "v-sync-slw", toDisplayText(syncSnap.wrong.sl, "-"));
    setText(root, "v-local-slw", toDisplayText(localSnap.wrong.sl, "-"));

    var spw = (typeof syncSnap.wrong.sl === "number") ? (syncSnap.wrong.sl % 3) : null;
    var lpw = (typeof localSnap.wrong.sl === "number") ? (localSnap.wrong.sl % 3) : null;
    setText(root, "v-sync-progw", toDisplayText(spw, "-"));
    setText(root, "v-local-progw", toDisplayText(lpw, "-"));

    // Max (local)
    setText(root, "v-local-max-len", toDisplayText(localSnap.streak.sl, "（データなし）"));
    setText(root, "v-local-max-val", toDisplayText(localSnap.max.max, "（データなし）"));
    setText(root, "v-local-max-day", toDisplayText(localSnap.max.day, "（データなし）"));
    var noteMax = root.querySelector(".v-note-max");
    if (noteMax) {
      noteMax.textContent = "※max/day は b_judge_record.js の localStorage を唯一の参照元。";
    }

    // Wrong Max (local)
    setText(root, "v-local-wmax-len", toDisplayText(localSnap.wrong.sl, "（データなし）"));
    setText(root, "v-local-wmax-val", toDisplayText(localSnap.wmax.max, "（データなし）"));
    setText(root, "v-local-wmax-day", toDisplayText(localSnap.wmax.day, "（データなし）"));
    var noteWMax = root.querySelector(".v-note-wmax");
    if (noteWMax) {
      noteWMax.textContent = "※wrong max/day も localStorage を唯一の参照元。";
    }

    // Streak3Today
    setText(root, "v-s3t-sync-day", toDisplayText(syncSnap.s3t.day, "（データなし）"));
    setText(root, "v-s3t-local-day", toDisplayText(localSnap.s3t.day, "（データなし）"));
    setText(root, "v-s3t-istoday", isTodayYmdString(syncSnap.s3t.day));
    setText(root, "v-s3t-sync-uc", toDisplayText(syncSnap.s3t.uc, "（データなし）"));
    setText(root, "v-s3t-local-uc", toDisplayText(localSnap.s3t.uc, "（データなし）"));

    // Streak3WrongToday
    setText(root, "v-s3wt-sync-day", toDisplayText(syncSnap.s3wt.day, "（データなし）"));
    setText(root, "v-s3wt-local-day", toDisplayText(localSnap.s3wt.day, "（データなし）"));
    setText(root, "v-s3wt-istoday", isTodayYmdString(syncSnap.s3wt.day));
    setText(root, "v-s3wt-sync-uc", toDisplayText(syncSnap.s3wt.uc, "（データなし）"));
    setText(root, "v-s3wt-local-uc", toDisplayText(localSnap.s3wt.uc, "（データなし）"));

    // oncePerDayToday / ODOA
    setText(root, "v-once-sync-day", toDisplayText(syncSnap.once.day, "（データなし）"));
    setText(root, "v-once-local-day", toDisplayText(localSnap.once.day, "（データなし）"));
    setText(root, "v-once-istoday", isTodayYmdString(syncSnap.once.day));

    var onceResult = syncSnap.once.result;
    setText(root, "v-once-result", toDisplayText(onceResult, "（データなし）"));

    var odoa = (typeof window.CSCS_ODOA_MODE === "string") ? window.CSCS_ODOA_MODE : "";
    var odoaText = (odoa === "on") ? "on" : (odoa === "off") ? "off" : "unknown";
    setText(root, "v-odoa-mode", odoaText);

    // Last day info
    setText(root, "v-last-seen-sync", toDisplayText(syncSnap.last.seen, "（データなし）"));
    setText(root, "v-last-seen-local", toDisplayText(localSnap.last.seen, "（データなし）"));
    setText(root, "v-last-cor-sync", toDisplayText(syncSnap.last.cor, "（データなし）"));
    setText(root, "v-last-cor-local", toDisplayText(localSnap.last.cor, "（データなし）"));
    setText(root, "v-last-wrg-sync", toDisplayText(syncSnap.last.wrg, "（データなし）"));
    setText(root, "v-last-wrg-local", toDisplayText(localSnap.last.wrg, "（データなし）"));
  }

  // -----------------------------
  // ループ
  // -----------------------------
  var lastStateOk = false;
  var lastError = "";
  var lastState = null;

  async function tickB() {
    try {
      if (!QID) QID = detectQidFromLocationB();

      // UIは常に更新できるように、DOMとlocalは先に読む
      var root = buildMonitorDomB();
      var localSnap = readLocalSnapshotForQid(QID);

      // state取得
      var st = await fetchSyncStateB();
      lastState = st;
      lastStateOk = true;
      lastError = "";

      var syncSnap = readSyncSnapshotForQid(st, QID);
      updateUiB(root, localSnap, syncSnap, true, "");
    } catch (e) {
      try {
        var root2 = buildMonitorDomB();
        var localSnap2 = readLocalSnapshotForQid(QID);
        var syncSnap2 = readSyncSnapshotForQid(lastState, QID);

        lastStateOk = false;
        lastError = String(e && e.message || e);

        updateUiB(root2, localSnap2, syncSnap2, false, lastError);
      } catch (_) {}
    }
  }

  function startB() {
    injectCscsSyncMonitorBStyleOnce();
    buildMonitorDomB();
    tickB();

    // 3秒ごと更新（軽量）
    setInterval(function () {
      tickB();
    }, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startB);
  } else {
    startB();
  }
})();