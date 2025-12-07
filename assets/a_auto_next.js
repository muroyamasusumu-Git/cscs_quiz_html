// assets/a_auto_next.js
// Aパート（＆Bパート）で、一定時間後に次の問題へ自動遷移するためのスクリプト。
// ・自動送り ON/OFF
// ・順番モード／ランダムモード
// ・待ち時間（10 / 15 / 20 / 25 / 30 / 60 秒）の切り替え
// ・左下のカウンター表示
// ・nav_list / フェード演出との連携
// をまとめて面倒見ている。

(function () {
  "use strict";

  // =========================
  // 設定値と localStorage キー
  // =========================

  // 自動遷移までの候補時間（ミリ秒）
  // ローテ順: 10秒 → 15秒 → 20秒 → 25秒 → 30秒 → 60秒 → …
  var AUTO_ADVANCE_MS_CANDIDATES = [10000, 15000, 20000, 25000, 30000, 60000];
  // 待ち時間の保存キー
  var AUTO_ADVANCE_MS_KEY = "cscs_auto_next_ms";
  // 現在採用されている待ち時間（localStorage から読み出し）
  var AUTO_ADVANCE_MS = loadAutoAdvanceMs();

  // カウントダウンの更新間隔（1秒ごと）
  var COUNTER_INTERVAL_MS = 1000;

  // 自動送り ON/OFF の保存キー
  var AUTO_ENABLED_KEY = "cscs_auto_next_enabled";
  // ランダムモード ON/OFF の保存キー
  var RANDOM_MODE_KEY = "cscs_auto_next_random_enabled";

  // ランダムモードで出題候補とする日付範囲（YYYYMMDD）
  var RANDOM_MIN_DAY = "20250926";
  var RANDOM_MAX_DAY = "20251224";

  // =========================
  // SYNC / ODOA / oncePerDayToday 用ヘルパー
  // =========================

  var SYNC_STATE_ENDPOINT = "/api/sync/state";

  // このファイル内だけで完結する SYNC 状態キャッシュ
  var SYNC_STATE = {
    loaded: false,
    loading: false,
    json: null
  };

  // 自動検証モード（A→B 自動遷移／計測なし）用の localStorage キー
  // 値は "on" または "off" を前提とする（それ以外は "off" に丸める）
  var VERIFY_MODE_KEY = "cscs_auto_verify_mode";

  // 検証モード状態を読み込むヘルパー
  function loadVerifyMode() {
    try {
      var v = localStorage.getItem(VERIFY_MODE_KEY);
      if (v === "on" || v === "off") {
        return v;
      }
      return "off";
    } catch (_e) {
      return "off";
    }
  }

  // 検証モード状態を保存するヘルパー
  function saveVerifyMode(mode) {
    try {
      var normalized = mode === "on" ? "on" : "off";
      localStorage.setItem(VERIFY_MODE_KEY, normalized);
    } catch (_e) {
      // 保存失敗は致命的ではないので無視
    }
  }

  // グローバルな検証モードフラグを初期化する
  (function initVerifyModeGlobal() {
    var initialMode = "off";
    try {
      initialMode = loadVerifyMode();
    } catch (_e) {
      initialMode = "off";
    }

    if (typeof window.CSCS_VERIFY_MODE !== "string") {
      window.CSCS_VERIFY_MODE = initialMode;
    } else {
      // 既にどこかで設定されている場合は "on"/"off" に丸めて保存
      window.CSCS_VERIFY_MODE = window.CSCS_VERIFY_MODE === "on" ? "on" : "off";
      saveVerifyMode(window.CSCS_VERIFY_MODE);
    }
  })();

  // ログ用ヘルパー（このファイル専用のプレフィックス）
  function syncLog() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[A:auto-next]");
      console.log.apply(console, args);
    } catch (_e) {}
  }

  // ODOA モードの正規化（"on" / "off"）
  function normalizeOdoaMode(raw) {
    if (raw === "on" || raw === "off") {
      return raw;
    }
    return "off";
  }

  // /api/sync/state から oncePerDayToday / odoa_mode を取得する共通ヘルパー
  // - 初回のみ実際に fetch し、2回目以降はキャッシュ状態を返す
  // - 情報源は JSON のみ。localStorage などには絶対にフォールバックしない。
  async function ensureSyncStateLoaded() {
    if (SYNC_STATE.loaded) {
      return SYNC_STATE.json || {};
    }
    if (SYNC_STATE.loading) {
      while (SYNC_STATE.loading && !SYNC_STATE.loaded) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 10);
        });
      }
      return SYNC_STATE.json || {};
    }

    SYNC_STATE.loading = true;
    try {
      var res = await fetch(SYNC_STATE_ENDPOINT, { cache: "no-store" });
      var json = await res.json();
      SYNC_STATE.json = json || {};
      SYNC_STATE.loaded = true;

      // ODOA モードをグローバルに反映（"on"/"off" 以外は "off"）
      if (typeof window.CSCS_ODOA_MODE !== "string") {
        window.CSCS_ODOA_MODE = "off";
      }
      if (json && typeof json.odoa_mode === "string") {
        window.CSCS_ODOA_MODE = normalizeOdoaMode(json.odoa_mode);
      }

      syncLog("SYNC state loaded.", {
        odoa_mode: window.CSCS_ODOA_MODE,
        hasOncePerDayToday: !!(json && json.oncePerDayToday)
      });

      return SYNC_STATE.json;
    } catch (e) {
      syncLog("SYNC state load failed:", String(e));
      SYNC_STATE.json = {};
      SYNC_STATE.loaded = true;
      return SYNC_STATE.json;
    } finally {
      SYNC_STATE.loading = false;
    }
  }

  // 現在の ODOA モードを "on" / "off" で取得
  async function getCurrentOdoaMode() {
    await ensureSyncStateLoaded();
    if (typeof window.CSCS_ODOA_MODE !== "string") {
      return "off";
    }
    return normalizeOdoaMode(window.CSCS_ODOA_MODE);
  }

  // oncePerDayToday.results 内に qid が存在するかどうか（true = 今日すでに回答済み）
  async function isOncePerDayAnswered(qid) {
    var json = await ensureSyncStateLoaded();
    var src = json && json.oncePerDayToday;
    if (!src || typeof src !== "object") {
      syncLog("oncePerDayToday is missing or not object.", { qid: qid });
      return false;
    }
    var results = src.results;
    if (!results || typeof results !== "object") {
      syncLog("oncePerDayToday.results is missing or not object.", { qid: qid });
      return false;
    }
    var answered = Object.prototype.hasOwnProperty.call(results, qid);
    syncLog("oncePerDayToday answered check.", {
      qid: qid,
      hasEntry: answered,
      resultsKeysLength: Object.keys(results).length
    });
    return !!answered;
  }

  // qid ("YYYYMMDD-NNN") → consistency_status 用キー ("YYYY年M月D日-NNN") 変換
  function qidToConsistencyKey(qid) {
    if (typeof qid !== "string") {
      return null;
    }
    var m = qid.match(/^(\d{4})(\d{2})(\d{2})-(\d{3})$/);
    if (!m) {
      return null;
    }
    var year = m[1];
    var monthNum = parseInt(m[2], 10);
    var dayNum = parseInt(m[3], 10);
    var num3 = m[4];
    if (!year || !monthNum || !dayNum || !num3) {
      return null;
    }
    // 月・日はゼロ詰め解除して「2025年9月26日-001」の形式にそろえる
    return (
      year +
      "年" +
      String(monthNum) +
      "月" +
      String(dayNum) +
      "日-" +
      num3
    );
  }

  // consistency_status に該当キーが存在するかどうか（true = 整合性チェック済み）
  async function isConsistencyChecked(qid) {
    var json = await ensureSyncStateLoaded();
    var statusRoot = json && json.consistency_status;
    if (!statusRoot || typeof statusRoot !== "object") {
      syncLog("consistency_status is missing or not object.", { qid: qid });
      return false;
    }
    var key = qidToConsistencyKey(qid);
    if (!key) {
      syncLog("qidToConsistencyKey failed.", { qid: qid });
      return false;
    }
    var hasEntry = Object.prototype.hasOwnProperty.call(statusRoot, key);
    var value = hasEntry ? statusRoot[key] : undefined;
    syncLog("consistency_status checked.", {
      qid: qid,
      key: key,
      hasEntry: hasEntry,
      valueType: typeof value
    });
    return !!hasEntry;
  }

  // 必要であれば他スクリプトからも再利用できるように公開
  window.CSCS_SYNC_COMMON = window.CSCS_SYNC_COMMON || {};
  if (!window.CSCS_SYNC_COMMON.getCurrentOdoaMode) {
    window.CSCS_SYNC_COMMON.getCurrentOdoaMode = getCurrentOdoaMode;
  }
  if (!window.CSCS_SYNC_COMMON.isOncePerDayAnswered) {
    window.CSCS_SYNC_COMMON.isOncePerDayAnswered = isOncePerDayAnswered;
  }
  if (!window.CSCS_SYNC_COMMON.isConsistencyChecked) {
    window.CSCS_SYNC_COMMON.isConsistencyChecked = isConsistencyChecked;
  }

  // =========================
  // グローバル状態（この JS 内だけで使う）
  // =========================
  var autoEnabled = loadAutoAdvanceEnabled();      // 自動送りが有効かどうか
  var randomModeEnabled = loadRandomModeEnabled(); // ランダムモードかどうか
  var NEXT_URL = null;                             // 次に遷移する URL
  var counterEl = null;                            // 左下カウンターの DOM 要素
  var counterTimerId = null;                       // setInterval ID
  var autoTimeoutId = null;                        // setTimeout ID
  var startTime = 0;                               // カウント開始時間
  var endTime = 0;                                 // カウント終了予定時間

  // =========================
  // 自動送り ON/OFF の読み書き
  // =========================

  function loadAutoAdvanceEnabled() {
    try {
      var v = localStorage.getItem(AUTO_ENABLED_KEY);
      if (v === null) {
        return true; // 保存されてなければデフォルトは ON
      }
      return v === "1";
    } catch (_e) {
      // localStorage が使えない場合も、とりあえず ON 扱い
      return true;
    }
  }

  function saveAutoAdvanceEnabled(flag) {
    try {
      localStorage.setItem(AUTO_ENABLED_KEY, flag ? "1" : "0");
    } catch (_e) {
      // 失敗しても致命的ではないので無視
    }
  }

  // =========================
  // ランダムモード ON/OFF の読み書き
  // =========================

  function loadRandomModeEnabled() {
    try {
      var v = localStorage.getItem(RANDOM_MODE_KEY);
      if (v === null) {
        return false; // デフォルトは「順番モード」
      }
      return v === "1";
    } catch (_e) {
      return false;
    }
  }

  function saveRandomModeEnabled(flag) {
    try {
      localStorage.setItem(RANDOM_MODE_KEY, flag ? "1" : "0");
    } catch (_e) {
      // 失敗しても無視
    }
  }

  // =========================
  // ランダム再生履歴（直近 N 件）
  // =========================

  var RANDOM_HISTORY_KEY = "cscs_auto_next_random_history";
  var RANDOM_HISTORY_LIMIT = 100;
  var randomHistoryCache = null;

  function loadRandomHistory() {
    if (randomHistoryCache && Array.isArray(randomHistoryCache)) {
      return randomHistoryCache;
    }
    var history = [];
    try {
      var raw = localStorage.getItem(RANDOM_HISTORY_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          history = parsed.filter(function (x) {
            return typeof x === "string" && x.length > 0;
          });
        }
      }
    } catch (_e) {
      history = [];
    }
    randomHistoryCache = history;
    return history;
  }

  function saveRandomHistory(history) {
    try {
      randomHistoryCache = history.slice();
      localStorage.setItem(RANDOM_HISTORY_KEY, JSON.stringify(randomHistoryCache));
    } catch (_e) {
      // 保存失敗は致命的ではないので無視
    }
  }

  function isQidInRandomHistory(qid) {
    if (typeof qid !== "string" || !qid) {
      return false;
    }
    var history = loadRandomHistory();
    for (var i = 0; i < history.length; i++) {
      if (history[i] === qid) {
        return true;
      }
    }
    return false;
  }

  function pushRandomHistory(qid) {
    if (typeof qid !== "string" || !qid) {
      return;
    }
    var history = loadRandomHistory().slice();
    history.push(qid);
    if (history.length > RANDOM_HISTORY_LIMIT) {
      history = history.slice(history.length - RANDOM_HISTORY_LIMIT);
    }
    saveRandomHistory(history);
    syncLog("Random history updated.", {
      latest: qid,
      length: history.length
    });
  }

  // =========================
  // 自動送り待ち時間（ms）の読み書き
  // =========================

  function loadAutoAdvanceMs() {
    try {
      var v = localStorage.getItem(AUTO_ADVANCE_MS_KEY);
      var ms = parseInt(v, 10);
      if (!ms || ms <= 0) {
        // 保存が無い・不正値なら最初の候補（20秒）にフォールバック
        return AUTO_ADVANCE_MS_CANDIDATES[0];
      }
      // 保存値が候補の中にあるかチェック
      for (var i = 0; i < AUTO_ADVANCE_MS_CANDIDATES.length; i++) {
        if (AUTO_ADVANCE_MS_CANDIDATES[i] === ms) {
          return ms;
        }
      }
      // 候補に無い値なら最初の候補に丸める
      return AUTO_ADVANCE_MS_CANDIDATES[0];
    } catch (_e) {
      return AUTO_ADVANCE_MS_CANDIDATES[0];
    }
  }

  function saveAutoAdvanceMs(ms) {
    try {
      localStorage.setItem(AUTO_ADVANCE_MS_KEY, String(ms));
    } catch (_e) {
      // 失敗しても致命的ではない
    }
  }

  // 現在の待ち時間が候補配列の何番目かを返す
  function getCurrentDurationIndex() {
    for (var i = 0; i < AUTO_ADVANCE_MS_CANDIDATES.length; i++) {
      if (AUTO_ADVANCE_MS_CANDIDATES[i] === AUTO_ADVANCE_MS) {
        return i;
      }
    }
    return 0;
  }

  // 次に切り替えるべき待ち時間（配列をぐるっとローテーション）
  function getNextDurationValue() {
    var idx = getCurrentDurationIndex();
    var nextIdx = idx + 1;
    if (nextIdx >= AUTO_ADVANCE_MS_CANDIDATES.length) {
      nextIdx = 0;
    }
    return AUTO_ADVANCE_MS_CANDIDATES[nextIdx];
  }

  // =========================
  // 現在のスライド情報の解析
  // =========================
  // URL 例:
  //   /_build_cscs_20250926/slides/q013_a.html
  //   /_build_cscs_20250926/slides/q013_b.html
  // から
  //   day: "20250926", idx: 13, part: "a" などを取り出す

  function parseSlideInfo() {
    var path = String(location.pathname || "");
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_([ab])(?:\.html)?$/);
    if (!m) {
      return null;
    }
    var day = m[1];           // 日付 "20250926"
    var num3 = m[2];          // 3桁番号 "001"〜"030"
    var idx = parseInt(num3, 10);
    var part = m[3];          // "a" または "b"
    if (!idx || idx < 1 || idx > 999) {
      return null;
    }
    return {
      day: day,
      idx: idx,
      part: part
    };
  }

  // =========================
  // YYYYMMDD 形式の日付に「日数」を加算するヘルパー
  // =========================
  function addDaysToDayString(dayStr, dayOffset) {
    var y = parseInt(dayStr.slice(0, 4), 10);
    var m = parseInt(dayStr.slice(4, 6), 10);
    var d = parseInt(dayStr.slice(6, 8), 10);
    if (!y || !m || !d) {
      return null;
    }
    // UTC 基準で日付オブジェクトを作成
    var date = new Date(Date.UTC(y, m - 1, d));
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }
    // 指定日数だけ加算
    date.setUTCDate(date.getUTCDate() + dayOffset);
    var yy = date.getUTCFullYear();
    var mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(date.getUTCDate()).padStart(2, "0");
    return String(yy) + String(mm) + String(dd);
  }

  // =========================
  // YYYYMMDD → Date（UTC 基準）変換
  // =========================
  function dayStringToDate(dayStr) {
    var y = parseInt(dayStr.slice(0, 4), 10);
    var m = parseInt(dayStr.slice(4, 6), 10);
    var d = parseInt(dayStr.slice(6, 8), 10);
    if (!y || !m || !d) {
      return null;
    }
    var date = new Date(Date.UTC(y, m - 1, d));
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  // =========================
  // 指定された範囲 [minDayStr, maxDayStr] の中からランダムな YYYYMMDD を返す
  // =========================
  function getRandomDayStringBetween(minDayStr, maxDayStr) {
    var minDate = dayStringToDate(minDayStr);
    var maxDate = dayStringToDate(maxDayStr);
    if (!minDate || !maxDate) {
      return null;
    }
    var minTime = minDate.getTime();
    var maxTime = maxDate.getTime();
    // 与えられた順が逆でも動くように並べ替え
    if (maxTime < minTime) {
      var tmp = minTime;
      minTime = maxTime;
      maxTime = tmp;
    }
    var diffMs = maxTime - minTime;
    var diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    var offset = 0;
    if (diffDays > 0) {
      // 0〜diffDays 日の範囲でランダム
      offset = Math.floor(Math.random() * (diffDays + 1));
    }
    var randDate = new Date(minTime);
    randDate.setUTCDate(randDate.getUTCDate() + offset);
    var yy = randDate.getUTCFullYear();
    var mm = String(randDate.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(randDate.getUTCDate()).padStart(2, "0");
    return String(yy) + String(mm) + String(dd);
  }

  // =========================
  // 現在の状態に応じて「次に遷移すべき URL」を組み立てる
  // （順番モード or ランダムモード）
  // =========================
  function buildNextUrl() {
    var info = parseSlideInfo();
    if (!info) {
      return null;
    }

    if (randomModeEnabled) {
      return buildRandomNextUrl(info);
    } else {
      return buildSequentialNextUrl(info);
    }
  }

  // =========================
  // 順番モードの遷移先 URL
  // =========================
  function buildSequentialNextUrl(info) {
    var path = String(location.pathname || "");
    var day = info.day;
    var idx = info.idx;
    var part = info.part || "a";

    if (part === "a") {
      // ---- Aパートの場合 ----

      // 1〜29問目：同じ日付の「次のAパート」へ
      if (idx < 30) {
        var nextIdx = idx + 1;
        var nextNum3 = String(nextIdx).padStart(3, "0");
        var nextPath = path.replace(/q\d{3}_a(?:\.html)?$/, "q" + nextNum3 + "_a.html");
        return nextPath;
      }

      // 30問目：翌日の 1問目 (q001_a.html) へ
      if (idx === 30) {
        var nextDay = addDaysToDayString(day, 1);
        if (!nextDay) {
          return null;
        }
        // 先頭部分（ルートパス）を抽出し、次の日付のパスにすげ替え
        var prefix = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_a(?:\.html)?$/, "");
        var nextPath2 = prefix + "_build_cscs_" + nextDay + "/slides/q001_a.html";
        return nextPath2;
      }

      // 想定外（31問目以降など）は何もしない
      return null;
    }

    if (part === "b") {
      // ---- Bパートの場合 ----

      // Bパートからは「次の問題の Aパート」へ送る
      if (idx < 30) {
        var nextIdxB = idx + 1;
        var nextNum3B = String(nextIdxB).padStart(3, "0");
        var nextPathB = path.replace(/q\d{3}_b(?:\.html)?$/, "q" + nextNum3B + "_a.html");
        return nextPathB;
      }

      // 30問目のB：翌日の 1問目Aへ
      if (idx === 30) {
        var nextDayB = addDaysToDayString(day, 1);
        if (!nextDayB) {
          return null;
        }
        var prefixB = path.replace(/_build_cscs_\d{8}\/slides\/q\d{3}_b(?:\.html)?$/, "");
        var nextPath2B = prefixB + "_build_cscs_" + nextDayB + "/slides/q001_a.html";
        return nextPath2B;
      }

      // 想定外（31問目以降など）は何もしない
      return null;
    }

    // part が a/b 以外など、想定外は何もしない
    return null;
  }

  // =========================
  // ランダムモードの遷移先 URL
  // =========================
  function buildRandomNextUrl(info) {
    var path = String(location.pathname || "");
    // パス先頭部分（_build_cscs_ より前）を抽出する
    var prefixMatch = path.match(/^(.*)_build_cscs_\d{8}\/slides\/q\d{3}_[ab](?:\.html)?$/);
    var prefix = prefixMatch ? prefixMatch[1] : "";

    var currentPath = path;
    var candidatePath = currentPath;
    var chosenQid = null;
    var safety = 0; // 無限ループ防止

    // 「今の問題」と「直近履歴」に含まれないランダムパスを、最大200回トライする
    while (candidatePath === currentPath && safety < 200) {
      var randDay = getRandomDayStringBetween(RANDOM_MIN_DAY, RANDOM_MAX_DAY);
      if (!randDay) {
        break;
      }
      var randIdx = Math.floor(Math.random() * 30) + 1; // 1〜30
      var randNum3 = String(randIdx).padStart(3, "0");
      var candidateQid = randDay + "-" + randNum3;

      // 直近ランダム履歴に含まれている qid はスキップ
      if (isQidInRandomHistory(candidateQid)) {
        safety++;
        continue;
      }

      candidatePath =
        prefix + "_build_cscs_" + randDay + "/slides/q" + randNum3 + "_a.html";

      // 現在表示中の URL と同じ場合もスキップ
      if (candidatePath === currentPath) {
        safety++;
        candidatePath = currentPath;
        continue;
      }

      chosenQid = candidateQid;
      break;
    }

    if (!chosenQid || candidatePath === currentPath) {
      // 安全策：結局有効な候補を作れなかった場合は諦める
      syncLog("Random: no candidate found (history/currentPath filter).");
      return null;
    }

    // 採用した qid を履歴に追加
    pushRandomHistory(chosenQid);
    syncLog("Random: choose candidate.", {
      qid: chosenQid,
      url: candidatePath
    });

    return candidatePath;
  }

  // =========================
  // ODOA モード対応: SYNC / oncePerDayToday を考慮した次の URL 決定
  // =========================
  async function buildNextUrlConsideringOdoa() {
    var info = parseSlideInfo();
    if (!info) {
      return null;
    }

    // ▼ 自動検証モード（A→B 自動遷移／計測なし）の特別処理
    //   - Aパートのときだけ、同じ問題番号の Bパートへ送る
    //   - Bパート側は従来どおり（次の問題の A へ）でよい
    var verifyOn =
      typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
    if (verifyOn && info.part === "a") {
      var pathVerify = String(location.pathname || "");
      var nextNum3Verify = String(info.idx).padStart(3, "0");
      var nextPathVerify = pathVerify.replace(
        /q\d{3}_a(?:\.html)?$/,
        "q" + nextNum3Verify + "_b.html"
      );

      var qidVerify = info.day + "-" + nextNum3Verify;
      syncLog("VerifyMode: A→B auto jump.", {
        qid: qidVerify,
        url: nextPathVerify
      });

      return nextPathVerify;
    }

    // ODOA モードを確認（"on" / "off"）
    var odoaMode = await getCurrentOdoaMode();

    // ODOA OFF の場合は従来ロジックそのまま
    if (odoaMode !== "on") {
      if (randomModeEnabled) {
        return buildRandomNextUrl(info);
      } else {
        return buildSequentialNextUrl(info);
      }
    }

    // ここから ODOA モード ON の場合のみ、
    //   - 通常時: oncePerDayToday を使って「今日すでに計測済みの問題」を除外
    //   - 検証AUTO: consistency_status を使って「整合性チェック済みの問題」を除外
    var path = String(location.pathname || "");
    var prefixMatch = path.match(/^(.*)_build_cscs_\d{8}\/slides\/q\d{3}_[ab](?:\.html)?$/);
    var prefix = prefixMatch ? prefixMatch[1] : "";

    // ---- 順番モード（ODOA） ----
    if (!randomModeEnabled) {
      var currentDay = info.day;
      var currentIdx = info.idx;
      var currentPart = info.part || "a";
      var safetySeq = 0;

      while (safetySeq < 400) {
        var nextDay = currentDay;
        var nextIdx = currentIdx;

        if (currentPart === "a" || currentPart === "b") {
          if (currentIdx < 30) {
            nextIdx = currentIdx + 1;
          } else if (currentIdx === 30) {
            nextDay = addDaysToDayString(currentDay, 1);
            if (!nextDay) {
              return null;
            }
            nextIdx = 1;
          } else {
            return null;
          }
        } else {
          return null;
        }

        var nextNum3 = String(nextIdx).padStart(3, "0");
        var candidateQid = nextDay + "-" + nextNum3;

        if (verifyOn) {
          // ▼ 自動検証モード中: consistency_status で「未チェック」のみを候補にする
          var checked = await isConsistencyChecked(candidateQid);
          if (!checked) {
            var candidatePathSeqVerify =
              prefix + "_build_cscs_" + nextDay + "/slides/q" + nextNum3 + "_a.html";
            syncLog("VerifyMode+ODOA sequential: choose candidate (not consistency-checked).", {
              qid: candidateQid,
              url: candidatePathSeqVerify
            });
            return candidatePathSeqVerify;
          }

          syncLog("VerifyMode+ODOA sequential: skip consistency-checked qid.", {
            qid: candidateQid
          });
        } else {
          // ▼ 通常時: oncePerDayToday で「本日すでに計測済み」の問題をスキップ
          var answered = await isOncePerDayAnswered(candidateQid);

          if (!answered) {
            var candidatePathSeq =
              prefix + "_build_cscs_" + nextDay + "/slides/q" + nextNum3 + "_a.html";
            syncLog("ODOA sequential: choose candidate.", {
              qid: candidateQid,
              url: candidatePathSeq
            });
            return candidatePathSeq;
          }

          syncLog("ODOA sequential: skip oncePerDayToday answered qid.", {
            qid: candidateQid
          });
        }

        // 次の候補へ進める（今見た候補を「現在位置」とみなす）
        currentDay = nextDay;
        currentIdx = nextIdx;
        currentPart = "a";
        safetySeq++;
      }

      syncLog("ODOA sequential: no candidate found within safety limit.");
      return null;
    }

    // ---- ランダムモード（ODOA） ----
    var currentPath = path;
    var safetyRand = 0;

    while (safetyRand < 200) {
      var randDay = getRandomDayStringBetween(RANDOM_MIN_DAY, RANDOM_MAX_DAY);
      if (!randDay) {
        break;
      }
      var randIdx = Math.floor(Math.random() * 30) + 1; // 1〜30
      var randNum3 = String(randIdx).padStart(3, "0");
      var candidatePathRand =
        prefix + "_build_cscs_" + randDay + "/slides/q" + randNum3 + "_a.html";

      // 現在表示中の URL と同じならスキップ
      if (candidatePathRand === currentPath) {
        safetyRand++;
        continue;
      }

      var candidateQidRand = randDay + "-" + randNum3;
      var inHistoryRand = isQidInRandomHistory(candidateQidRand);

      if (verifyOn) {
        // ▼ 自動検証モード中: consistency_status で「未チェック」かつ履歴にないものだけ採用
        var checkedRand = await isConsistencyChecked(candidateQidRand);

        if (!checkedRand && !inHistoryRand) {
          pushRandomHistory(candidateQidRand);
          syncLog("VerifyMode+ODOA random: choose candidate (not consistency-checked).", {
            qid: candidateQidRand,
            url: candidatePathRand
          });
          return candidatePathRand;
        }

        if (checkedRand) {
          syncLog("VerifyMode+ODOA random: skip consistency-checked qid.", {
            qid: candidateQidRand
          });
        } else if (inHistoryRand) {
          syncLog("VerifyMode+ODOA random: skip recent-history qid.", {
            qid: candidateQidRand
          });
        }
      } else {
        // ▼ 通常時: oncePerDayToday 未回答 かつ 直近履歴に無い qid のみ採用
        var answeredRand = await isOncePerDayAnswered(candidateQidRand);

        if (!answeredRand && !inHistoryRand) {
          pushRandomHistory(candidateQidRand);
          syncLog("ODOA random: choose candidate.", {
            qid: candidateQidRand,
            url: candidatePathRand
          });
          return candidatePathRand;
        }

        if (answeredRand) {
          syncLog("ODOA random: skip oncePerDayToday answered qid.", {
            qid: candidateQidRand
          });
        } else if (inHistoryRand) {
          syncLog("ODOA random: skip recent-history qid.", {
            qid: candidateQidRand
          });
        }
      }

      safetyRand++;
    }

    syncLog("ODOA random: no candidate found within safety limit.");
    return null;
  }

  // =========================
  // 左下カウンターの生成（「次の問題まで XX 秒」表示）
  // =========================
  function createAutoNextCounterElement() {
    var existing = document.getElementById("auto-next-counter");
    if (existing) {
      return existing;
    }

    var div = document.createElement("div");
    div.id = "auto-next-counter";
    div.textContent = "";

    div.style.cssText =
      "position: fixed;" +
      "left: 140px;" +          // 左から140px に固定表示
      "bottom: 16px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: #fff;" +         // 白文字
      "z-index: 9999;" +
      "pointer-events: none;" +
      "font-weight: 300;";

    document.body.appendChild(div);
    return div;
  }

  // =========================
  // 自動送り ON/OFF トグルボタンの生成
  // =========================
  function createAutoNextToggleButton() {
    var btn = document.getElementById("auto-next-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-toggle";
    btn.type = "button";
    btn.textContent = autoEnabled ? "[自動送り ON]" : "[自動送りOFF]";
    btn.style.cssText =
      "position: fixed;" +
      "left: 260px;" +
      "bottom: 14px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;";

    // クリックで ON/OFF を切り替える
    btn.addEventListener("click", function () {
      autoEnabled = !autoEnabled;
      saveAutoAdvanceEnabled(autoEnabled);
      btn.textContent = autoEnabled ? "[自動送り ON]" : "[自動送りOFF]";

      if (autoEnabled) {
        // ON にした瞬間から、ODOA / oncePerDayToday を考慮した NEXT_URL を再計算してカウントダウン開始
        (async function () {
          NEXT_URL = await buildNextUrlConsideringOdoa();
          if (NEXT_URL) {
            startAutoAdvanceCountdown();
          } else {
            // 遷移候補が無い場合は OFF 表示にしておく
            cancelAutoAdvanceCountdown(true);
          }
        })();
      } else {
        // OFF にしたらカウントダウン停止 & 表示を更新
        cancelAutoAdvanceCountdown(true);
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // =========================
  // ランダムモード／順番モード切り替えボタンの生成
  // =========================
  function createAutoNextModeToggleButton() {
    var btn = document.getElementById("auto-next-mode-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-mode-toggle";
    btn.type = "button";
    btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番遷移]";
    btn.style.cssText =
      "position: fixed;" +
      "left: 350px;" +
      "bottom: 14px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;";

    // クリックでモード切替
    btn.addEventListener("click", function () {
      randomModeEnabled = !randomModeEnabled;
      saveRandomModeEnabled(randomModeEnabled);
      btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番遷移]";

      // いったんカウントダウンを止めてから、新しい NEXT_URL で再スタート
      cancelAutoAdvanceCountdown(false);

      if (autoEnabled) {
        (async function () {
          NEXT_URL = await buildNextUrlConsideringOdoa();
          if (NEXT_URL) {
            startAutoAdvanceCountdown();
          } else {
            cancelAutoAdvanceCountdown(true);
          }
        })();
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // =========================
  // 自動送り時間（10/15/20/25/30/60秒）切り替えボタンの生成
  // =========================
  function createAutoNextDurationButton() {
    var btn = document.getElementById("auto-next-duration-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-duration-toggle";
    btn.type = "button";
    var sec = Math.round(AUTO_ADVANCE_MS / 1000);
    btn.textContent = "[" + sec + "秒]";
    btn.style.cssText =
      "position: fixed;" +
      "left: 416px;" +
      "bottom: 14px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;";

    // クリックごとに 10 → 15 → 20 → 25 → 30 → 60 → 10…とローテーション
    btn.addEventListener("click", function () {
      var nextMs = getNextDurationValue();
      AUTO_ADVANCE_MS = nextMs;
      saveAutoAdvanceMs(AUTO_ADVANCE_MS);
      var secNow = Math.round(AUTO_ADVANCE_MS / 1000);
      btn.textContent = "[" + secNow + "秒]";

      // 自動送りが ON のときは、新しい時間でカウントダウンをやり直す
      if (autoEnabled) {
        startAutoAdvanceCountdown();
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // =========================
  // 自動検証モードの状態変更＋UI同期ヘルパー
  // =========================
  function setVerifyModeAndSyncUI(mode, options) {
    // mode を "on" / "off" に正規化する
    var normalized = mode === "on" ? "on" : "off";

    // グローバル状態と localStorage を更新
    window.CSCS_VERIFY_MODE = normalized;
    saveVerifyMode(normalized);

    // トグルボタン表示を現在のモードに合わせて更新
    var btn = document.getElementById("auto-next-verify-toggle");
    if (btn) {
      // 現在の検証モードに応じてラベルを切り替える
      btn.textContent = normalized === "on" ? "[検証AUTO:ON]" : "[検証AUTO:OFF]";
    }

    // 変更理由をログに残しておく（外部からの強制OFF含む）
    var reason = options && typeof options.reason === "string" ? options.reason : "";
    syncLog("VerifyMode: set by helper.", {
      mode: normalized,
      reason: reason
    });
  }

  // =========================
  // 自動検証モード（A→B 自動遷移／計測なし）切り替えボタンの生成
  // UI から ON/OFF できる正式トグルボタンとして動作させる。
  // =========================
  function createVerifyModeToggleButton() {
    var btn = document.getElementById("auto-next-verify-toggle");
    if (btn) {
      // すでにボタンが存在する場合は、そのまま再利用する
      return btn;
    }

    // ボタン要素を新規作成
    btn = document.createElement("button");
    btn.id = "auto-next-verify-toggle";
    btn.type = "button";

    // 現在の検証モード（window.CSCS_VERIFY_MODE）に応じて初期ラベルを決定する
    var initialMode = (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on") ? "on" : "off";
    btn.textContent = initialMode === "on" ? "[検証AUTO:ON]" : "[検証AUTO:OFF]";

    // 他ボタンと同等の見た目にそろえる（有効な操作ボタンとして扱う）
    btn.style.cssText =
      "position: fixed;" +
      "left: 462px;" +
      "bottom: 14px;" +
      "padding: 6px 10px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;";

    // クリックごとに検証モード "on" / "off" をトグルし、
    // ラベル更新・localStorage 保存・ログ出力などは
    // CSCS_VERIFY_MODE_HELPER.turnOn/turnOffVerifyMode 経由で一括実行する
    btn.addEventListener("click", function () {
      var currentMode = (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on") ? "on" : "off";
      var nextMode = currentMode === "on" ? "off" : "on";

      // ▼ ユーザー操作によるトグルは、必ず公開ヘルパー経由で行う
      //    これにより consistency_check_debug.js などが
      //    turnOn/turnOffVerifyMode をフックしている場合も確実に通過させる
      if (nextMode === "on") {
        if (window.CSCS_VERIFY_MODE_HELPER && typeof window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode === "function") {
          window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode("user-toggle");
        } else {
          // ヘルパーが存在しない場合はログだけ残して何もしない
          syncLog("VerifyMode: helper.turnOnVerifyMode is not available.", {
            reason: "user-toggle"
          });
        }
        return;
      }

      if (nextMode === "off") {
        if (window.CSCS_VERIFY_MODE_HELPER && typeof window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode === "function") {
          window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode("user-toggle");
        } else {
          // ヘルパーが存在しない場合はログだけ残して何もしない
          syncLog("VerifyMode: helper.turnOffVerifyMode is not available.", {
            reason: "user-toggle"
          });
        }
        return;
      }
    });

    // 画面に追加
    document.body.appendChild(btn);
    return btn;
  }

  // =========================
  // 外部から検証モードを強制ON/OFFにするための公開API
  // 例: 整合性チェックの自動モード切り替えなどから呼び出す
  // =========================
  window.CSCS_VERIFY_MODE_HELPER = window.CSCS_VERIFY_MODE_HELPER || {};

  // 検証モードを強制ONにする（[検証AUTO:ON] ＋ [自動送り ON]）
  if (!window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode) {
    window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode = function (reason) {
      // 検証モードを "on" にして UI と localStorage を同期
      setVerifyModeAndSyncUI("on", {
        reason: reason || "external-turn-on"
      });

      // ★ 検証AUTO:ON のときは、自動送りも強制的に ON にする
      autoEnabled = true;
      saveAutoAdvanceEnabled(true);
      var autoBtn = document.getElementById("auto-next-toggle");
      if (autoBtn) {
        autoBtn.textContent = "[自動送り ON]";
      }

      // 自動送りが有効なら、ODOA/検証モードを考慮した NEXT_URL を再計算してカウントダウン開始
      (async function () {
        if (!autoEnabled) {
          return;
        }
        NEXT_URL = await buildNextUrlConsideringOdoa();
        if (NEXT_URL) {
          startAutoAdvanceCountdown();
        } else {
          // 遷移候補が無い場合は OFF 表示にしておく
          cancelAutoAdvanceCountdown(true);
        }
      })();
    };
  }

  // 検証モードを強制OFFにする
  if (!window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode) {
    window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode = function (reason) {
      // 検証モードを "off" にして UI と localStorage を同期
      setVerifyModeAndSyncUI("off", {
        reason: reason || "external-turn-off"
      });

      // ★ 検証モードOFF時は、自動送りも必ず OFF に揃える
      autoEnabled = false;
      saveAutoAdvanceEnabled(false);
      var autoBtn = document.getElementById("auto-next-toggle");
      if (autoBtn) {
        autoBtn.textContent = "[自動送りOFF]";
      }

      // カウントダウンや自動遷移も停止し、「OFF」表示にしておく
      cancelAutoAdvanceCountdown(true);
    };
  }

  // =========================
  // nav_list / フェードモジュールと連携した遷移処理
  // =========================

  // 共通フェードモジュール CSCS_FADE を使ってフェードアウト後に遷移
  function fadeOutAndNavigate(nextUrl) {
    if (!nextUrl) {
      return;
    }
    // nav_list が表示されていれば、フェードアウトして薄くする
    if (window.CSCS_NAV_LIST && typeof window.CSCS_NAV_LIST.fadeOut === "function") {
      try {
        window.CSCS_NAV_LIST.fadeOut();
      } catch (_e) {}
    }
    // 全画面フェードモジュールがあればそれを利用、なければ普通に遷移
    if (window.CSCS_FADE && typeof window.CSCS_FADE.fadeOutTo === "function") {
      window.CSCS_FADE.fadeOutTo(nextUrl, "a_auto_next");
    } else {
      location.href = nextUrl;
    }
  }

  // 遷移後のページ側でフェードインを走らせる
  function runFadeInIfNeeded() {
    if (window.CSCS_FADE && typeof window.CSCS_FADE.runFadeInIfNeeded === "function") {
      // 理論上は reason は不要だが、識別用に "a_auto_next" を渡している
      window.CSCS_FADE.runFadeInIfNeeded("a_auto_next");
    }
    // nav_list があればフェードイン側も呼ぶ
    if (window.CSCS_NAV_LIST && typeof window.CSCS_NAV_LIST.fadeIn === "function") {
      try {
        window.CSCS_NAV_LIST.fadeIn();
      } catch (_e) {}
    }
  }

  // =========================
  // HEAD リクエストで存在確認してから遷移
  // （存在しないURLに飛ばないようにする保険）
  // =========================
  function goNextIfExists(nextUrl) {
    if (!nextUrl) {
      return;
    }
    try {
      fetch(nextUrl, { method: "HEAD" }).then(function (res) {
        if (res && res.ok) {
          fadeOutAndNavigate(nextUrl);
        }
      }).catch(function (_err) {
        // 404 やネットワークエラー時は静かに何もしない
      });
    } catch (_e) {
      // fetch が使えない環境では、そのまま遷移
      fadeOutAndNavigate(nextUrl);
    }
  }

  // =========================
  // 「次の問題へ」リンク（back-to-top ボタン）の生成
  // - body 直下に a.back-to-top を追加する
  // - 見た目は .back-to-top の CSS に完全委譲する
  // - クリック時は ODOA と同じ NEXT_URL を使って遷移する
  // - フォールバックは行わない
  // =========================
  function createBackToTopLink() {
    // すでに存在していれば再利用
    var existing = document.querySelector(".back-to-top");
    if (existing) {
      return existing;
    }

    // body が無ければ何もしない（フォールバックしない）
    var bodyEl = document.body;
    if (!bodyEl) {
      syncLog("BackToTop: <body> not found.");
      return null;
    }

    // a.back-to-top 要素を生成（スタイル調整は CSS 側の .back-to-top に委譲）
    var link = document.createElement("a");
    link.className = "back-to-top";
    link.textContent = "［次の問題へ］";

    // クリック時に ODOA と同じ NEXT_URL へ遷移させる
    link.addEventListener("click", function (ev) {
      try {
        ev.preventDefault();
      } catch (_e) {}

      (async function () {
        if (!NEXT_URL) {
          NEXT_URL = await buildNextUrlConsideringOdoa();
        }
        if (!NEXT_URL) {
          syncLog("BackToTop: NEXT_URL is not available.");
          return;
        }
        goNextIfExists(NEXT_URL);
      })();
    });

    // body 直下に追加
    bodyEl.appendChild(link);
    syncLog("BackToTop: link created under <body>.");
    return link;
  }

  // =========================
  // Bパートの「選択肢エリア」をクリックしたら
  // ［次の問題へ］と同じ挙動で遷移させる
  // =========================
  function setupBChoicesClickToNext() {
    // スライド情報を確認し、Bパート以外では何もしない
    var info = parseSlideInfo();
    if (!info || info.part !== "b") {
      syncLog("BChoices: not B-part; skip.");
      return;
    }

    // 「選択肢の部分」のコンテナセレクタ
    // 現在のテンプレでは ol.opts が選択肢エリア
    var selectors = [
      "ol.opts"
    ];

    var targets = [];
    for (var i = 0; i < selectors.length; i++) {
      var nodeList = document.querySelectorAll(selectors[i]);
      if (nodeList && nodeList.length > 0) {
        for (var j = 0; j < nodeList.length; j++) {
          targets.push(nodeList[j]);
        }
      }
    }

    if (targets.length === 0) {
      syncLog("BChoices: no target choice container found.");
      return;
    }

    // 対象コンテナそれぞれにクリックリスナーを付与
    targets.forEach(function (el) {
      // 二重バインド防止
      if (el.dataset && el.dataset.cscsBChoicesBound === "1") {
        return;
      }
      if (el.dataset) {
        el.dataset.cscsBChoicesBound = "1";
      }

      el.style.cursor = el.style.cursor || "pointer";

      el.addEventListener("click", function (ev) {
        try {
          ev.preventDefault();
        } catch (_e1) {}
        try {
          ev.stopPropagation();
        } catch (_e2) {}

        (async function () {
          if (!NEXT_URL) {
            NEXT_URL = await buildNextUrlConsideringOdoa();
          }
          if (!NEXT_URL) {
            syncLog("BChoices: NEXT_URL is not available.");
            return;
          }
          goNextIfExists(NEXT_URL);
        })();
      });
    });

    syncLog("BChoices: click-to-next bound on choice containers.", {
      count: targets.length
    });
  }

  // =========================
  // カウントダウンのキャンセル処理
  // =========================
  function cancelAutoAdvanceCountdown(updateText) {
    // 1秒ごと更新している setInterval を止める
    if (counterTimerId) {
      window.clearInterval(counterTimerId);
      counterTimerId = null;
    }
    // 実際の遷移を予約している setTimeout を止める
    if (autoTimeoutId) {
      window.clearTimeout(autoTimeoutId);
      autoTimeoutId = null;
    }
    // updateText=true の場合は、左下の文字も「OFF」表示に更新
    if (updateText) {
      if (!counterEl) {
        counterEl = createAutoNextCounterElement();
      }
      counterEl.textContent = "自動送りは OFF です";
    }
  }

  // =========================
  // カウントダウン開始処理
  // =========================
  function startAutoAdvanceCountdown() {
    // 既存カウントダウンを一旦リセット
    cancelAutoAdvanceCountdown(false);

    // NEXT_URL は事前に決めておく想定（ODOA / oncePerDayToday を考慮済み）
    if (!NEXT_URL) {
      // 次 URL を決められない場合は何もしない
      return;
    }

    // 自動送りが OFF ならカウンターだけ OFF 表示
    if (!autoEnabled) {
      if (!counterEl) {
        counterEl = createAutoNextCounterElement();
      }
      counterEl.textContent = "自動送りは OFF です";
      return;
    }

    // ▼ 検証モード中は A=5秒, B=20秒 に固定するための有効待ち時間を決定する
    var verifyOn =
      typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
    var effectiveMs = AUTO_ADVANCE_MS;

    if (verifyOn) {
      var infoForVerify = parseSlideInfo();
      if (infoForVerify && infoForVerify.part === "a") {
        // Aパートでは 5秒 固定
        effectiveMs = 5000;
        syncLog("VerifyMode: use fixed duration for A (5s).", {
          ms: effectiveMs
        });
      } else if (infoForVerify && infoForVerify.part === "b") {
        // Bパートでは 20秒 固定
        effectiveMs = 20000;
        syncLog("VerifyMode: use fixed duration for B (20s).", {
          ms: effectiveMs
        });
      } else {
        // part が判定できない場合は、現在の AUTO_ADVANCE_MS をそのまま使う
        syncLog("VerifyMode: slide info not available, use current AUTO_ADVANCE_MS.", {
          ms: effectiveMs
        });
      }
    }

    // 左下の待ち時間ボタン表示も、実際に使う待ち時間に合わせて同期する
    var durationBtn = document.getElementById("auto-next-duration-toggle");
    if (durationBtn) {
      var secNowForButton = Math.round(effectiveMs / 1000);
      durationBtn.textContent = "[" + secNowForButton + "秒]";
    }

    // 現在時刻と終了時刻を記録（有効待ち時間を使用）
    startTime = Date.now();
    endTime = startTime + effectiveMs;

    if (!counterEl) {
      counterEl = createAutoNextCounterElement();
    }

    // カウンター更新関数
    function updateCounter() {
      var now = Date.now();
      var remainingMs = endTime - now;

      if (remainingMs <= 0) {
        // 0秒以下になったら「まもなく次へ…」と表示し、インターバルを止める
        counterEl.textContent = "まもなく次へ…";
        window.clearInterval(counterTimerId);
        counterTimerId = null;
        return;
      }

      // 残り秒数を切り上げで計算
      var remainingSec = Math.ceil(remainingMs / 1000);
      counterEl.textContent = "次の問題まで " + remainingSec + " 秒";
    }

    // 初回表示
    updateCounter();
    // 1秒ごとに残り時間を更新
    counterTimerId = window.setInterval(updateCounter, COUNTER_INTERVAL_MS);

    // 待ち時間経過後に、自動で次の問題へ遷移（有効待ち時間を使用）
    autoTimeoutId = window.setTimeout(function () {
      if (counterTimerId) {
        window.clearInterval(counterTimerId);
        counterTimerId = null;
      }
      goNextIfExists(NEXT_URL);
    }, effectiveMs);
  }

  // =========================
  // 初期化処理（ページ読み込み完了時）
  // =========================
  async function onReady() {
    // まず ODOA / oncePerDayToday を考慮した「次の URL」を計算
    NEXT_URL = await buildNextUrlConsideringOdoa();
    if (!NEXT_URL) {
      // 次 URL が無ければフェードインだけやって終了
      runFadeInIfNeeded();
      return;
    }

    // 画面左下の制御ボタン類を作成
    createAutoNextToggleButton();       // 自動送り ON/OFF
    createAutoNextModeToggleButton();   // 順番／ランダム
    createAutoNextDurationButton();     // 待ち時間（秒）
    createVerifyModeToggleButton();     // 自動検証モード（A→B 自動遷移）

    // A/B 共通コンテナ内に「次の問題へ」リンクを追加（ODOA と同じ NEXT_URL を使う）
    createBackToTopLink();

    // Bパートの選択肢エリアにも「次の問題へ」と同じ挙動を紐づける
    setupBChoicesClickToNext();

    // 自動送りの状態に応じて挙動を分岐
    if (autoEnabled) {
      // ON の場合はカウントダウンを開始
      startAutoAdvanceCountdown();
    } else {
      // OFF の場合はカウントダウン停止表示
      cancelAutoAdvanceCountdown(true);
    }

    // フェードイン（必要な場合のみ）
    runFadeInIfNeeded();
  }

  // =========================
  // DOM 準備完了タイミングに合わせて onReady を実行
  // =========================
  if (document.readyState === "complete" || document.readyState === "interactive") {
    onReady();
  } else {
    document.addEventListener("DOMContentLoaded", onReady);
  }
})();