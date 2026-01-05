// assets/a_auto_next.js
//
// 【cscs_sync_bootstrap_a.js との関係（最重要）】
//   このファイルは、/api/sync/state を必ず使用する。
//   そのため、
//     - cscs_sync_bootstrap_a.js による sync bootstrap が完了し、
//     - window.__CSCS_SYNC_KEY_PROMISE__ が resolve し、
//     - window.CSCS_SYNC_KEY が確定している
//   ことを前提として初めて起動されなければならない。
//
//   ✔ 起動順序の正:
//       cscs_sync_bootstrap_a.js
//         → (__CSCS_SYNC_KEY_PROMISE__ resolve)
//         → このJS起動
//
//   ✖ 禁止:
//       - bootstrap 未完了の状態で /api/sync/state を叩く
//       - localStorage の値だけを見て「key があるはず」と推測する
//       - 別ルートのフォールバックで state を読もうとする
//
//   本ファイルの末尾では、この前提を破らないために
//   window.__CSCS_SYNC_KEY_PROMISE__ の resolve を唯一の起動条件としている。
//   （DOM ready よりも bootstrap 完了を優先）
//
// 目的:
//   Aパート / Bパートの「次の問題へ進む体験」をこの1ファイルで統括する。
//   - 自動送り（タイマーでの自動遷移）
//   - 手動送り（［次の問題へ］リンク / Bの選択肢エリアクリックでの遷移）
//   - 順番遷移 / ランダム遷移
//   - ODOA / SYNC 状態（/api/sync/state）を参照した「出題候補の除外」
//   - フェード演出（CSCS_FADE）と nav_list（CSCS_NAV_LIST）への連携
//
// このファイルがやっていること（全体フロー）:
//   1) 初期化（onReady）
//      - 現在ページのスライド情報（day / idx / part）を URL から解析
//      - /api/sync/state を必要に応じて読み込み（キャッシュして再利用）
//      - モード状態（自動送り / ランダム / 検証AUTO / TRYAL / ODOA）を取得
//      - その状態をもとに「次に遷移すべき URL（NEXT_URL）」を決定
//      - 画面左下のUI（トグルボタン群 / カウンター）と手動遷移UIを生成
//      - 自動送りONならカウントダウン開始、OFFなら停止表示
//      - フェードイン演出を必要に応じて実行
//
//   2) 次URLの決定（buildNextUrlConsideringOdoa）
//      - 通常（ODOA OFF）
//          順番: buildSequentialNextUrl() / ランダム: buildRandomNextUrl()
//      - ODOA ON
//          通常時: oncePerDayToday を使い「今日すでに回答済み」を除外しつつ候補を探索
//                  さらに consistency_status の「×」判定（NG）を自動遷移候補から除外
//          検証AUTO時: consistency_status を使い「未チェック」のみを候補として探索
//      ※ 情報源は /api/sync/state の JSON のみ（localStorage などへフォールバックしない方針）
//
//   3) 自動送り（startAutoAdvanceCountdown）
//      - NEXT_URL を前提に「残り秒数」を左下カウンターへ毎秒表示
//      - タイムアウトで goNextIfExists(NEXT_URL) を呼び出し遷移
//      - 検証AUTO / TRYAL のときは、A/B で待ち時間を固定値に差し替える
//          検証AUTO: A=5秒 / B=20秒
//          TRYAL:    A=20秒 / B=30秒
//
//   4) 手動遷移（createBackToTopLink / setupBChoicesClickToNext）
//      - ［次の問題へ］リンクを body 直下に追加し、クリックで NEXT_URL へ遷移
//      - Bパートでは ol.opts（選択肢エリア）クリックでも同じ遷移を発火
//      - 遷移前に HEAD で存在確認（goNextIfExists）して「無いURLへ飛ばない」保険をかける
//
//   5) ランダムの被り制御（random history）
//      - localStorage の配列に「直近N件のqid（YYYYMMDD-NNN）」を保持
//      - ランダム候補の選定時に直近履歴に入っている qid はスキップ
//      - N は RANDOM_HISTORY_LIMIT（直近250件）で制御
//
// 注意:
//   - フェード演出は CSCS_FADE があればそれを使用し、無ければ通常遷移。
//   - nav_list があれば fadeOut/fadeIn を呼んで視覚連携する。
//   - ここで新しい保険的フォールバック経路を勝手に増やさない（恒久方針に従う）。

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
  var __effectId = "a_auto_next"; // ← このJS固有のIDにする
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

  // トライアルモード（A→B 自動遷移＋計測あり、整合性チェックは関与しない）用の localStorage キー
  // 値は "on" または "off" を前提とし、それ以外は "off" に丸める
  var TRIAL_MODE_KEY = "cscs_auto_trial_mode";

  // トライアルモード状態を読み込むヘルパー
  // - localStorage から "on"/"off" を取得し、それ以外は "off" にそろえる
  function loadTrialMode() {
    try {
      var v = localStorage.getItem(TRIAL_MODE_KEY);
      if (v === "on" || v === "off") {
        return v;
      }
      return "off";
    } catch (_e) {
      return "off";
    }
  }

  // トライアルモード状態を保存するヘルパー
  // - mode を "on"/"off" に正規化してから localStorage へ保存する
  function saveTrialMode(mode) {
    try {
      var normalized = mode === "on" ? "on" : "off";
      localStorage.setItem(TRIAL_MODE_KEY, normalized);
    } catch (_e) {
      // 保存失敗は致命的ではないので無視
    }
  }

  // グローバルなトライアルモードフラグを初期化する
  // - window.CSCS_TRIAL_MODE に "on"/"off" をセットし、localStorage と同期する
  (function initTrialModeGlobal() {
    var initialMode = "off";
    try {
      initialMode = loadTrialMode();
    } catch (_e) {
      initialMode = "off";
    }

    if (typeof window.CSCS_TRIAL_MODE !== "string") {
      window.CSCS_TRIAL_MODE = initialMode;
    } else {
      // 既にどこかで設定されている場合は "on"/"off" に丸めて保存
      window.CSCS_TRIAL_MODE = window.CSCS_TRIAL_MODE === "on" ? "on" : "off";
      saveTrialMode(window.CSCS_TRIAL_MODE);
    }
  })();

  // ログ用ヘルパー（このファイル専用のプレフィックス）
  // - デフォルトではログを出さない（コンソールを静かに保つ）
  // - 有効化したい場合:
  //     localStorage.setItem("cscs_debug_auto_next", "1")
  //   もしくは URL に ?debug_auto_next=1 を付ける
  var AUTO_NEXT_DEBUG_KEY = "cscs_debug_auto_next";

  function isAutoNextDebugEnabled() {
    try {
      // URL クエリで一時的にON（デバッグしやすい）
      try {
        var u = new URL(String(location.href || ""), location.href);
        if (u.searchParams && u.searchParams.get("debug_auto_next") === "1") {
          return true;
        }
      } catch (_eUrl) {}

      // localStorage で永続ON
      var v = localStorage.getItem(AUTO_NEXT_DEBUG_KEY);
      return v === "1";
    } catch (_e) {
      return false;
    }
  }

  function syncLog() {
    try {
      if (!isAutoNextDebugEnabled()) {
        return;
      }
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
      var syncKey = null;
      try {
        syncKey = (typeof window.CSCS_SYNC_KEY === "string") ? window.CSCS_SYNC_KEY : null;
      } catch (_eKey) {
        syncKey = null;
      }

      if (!syncKey) {
        throw new Error("CSCS_SYNC_KEY is missing (sync bootstrap not ready).");
      }

      var res = await fetch(SYNC_STATE_ENDPOINT, {
        cache: "no-store",
        credentials: "include",
        headers: {
          "X-CSCS-Key": syncKey
        }
      });
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

  // consistency_status の status_mark / severity_mark が「×」かどうか
  // true の場合 = 整合性NG問題として自動遷移候補から除外する
  async function isConsistencyNg(qid) {
    var json = await ensureSyncStateLoaded();
    var statusRoot = json && json.consistency_status;
    if (!statusRoot || typeof statusRoot !== "object") {
      syncLog("consistency_status is missing or not object for NG check.", { qid: qid });
      return false;
    }
    var key = qidToConsistencyKey(qid);
    if (!key) {
      syncLog("qidToConsistencyKey failed for NG check.", { qid: qid });
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(statusRoot, key)) {
      // エントリ自体が無ければ NG ではない
      return false;
    }
    var value = statusRoot[key] || {};
    var mark = value.status_mark || value.severity_mark || "";
    var isNg = mark === "×";
    syncLog("consistency NG check.", {
      qid: qid,
      key: key,
      mark: mark,
      isNg: isNg
    });
    return isNg;
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
  if (!window.CSCS_SYNC_COMMON.isConsistencyNg) {
    window.CSCS_SYNC_COMMON.isConsistencyNg = isConsistencyNg;
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
  var VERIFY_MODE_AUTO_RESTART_DELAY_MS = 3 * 60 * 1000; // 検証モード自動再開までの待ち時間（ms）
  var verifyModeAutoRestartTimerId = null;         // 検証モード自動再開用 setTimeout ID
  var verifyModeAutoRestartDeadline = 0;           // 自動再開予定時刻（Date.now() 基準のタイムスタンプ）
  var verifyModeAutoRestartIntervalId = null;      // 検証モード再開カウントダウン表示用 setInterval ID

  // =========================
  // 直近QID履歴 / 左下バー / 直近一覧ウィンドウ
  // =========================

  // 直近に訪れた QID 履歴（「押したらその問題へ飛ぶ」用）
  var RECENT_QIDS_KEY = "cscs_auto_next_recent_qids";
  var RECENT_QIDS_LIMIT = 30;

  // 左下バー（ボタン群を横一列に並べる）
  var AUTO_NEXT_BAR_ID = "cscs-auto-next-bar";
  var AUTO_NEXT_BAR_INNER_ID = "cscs-auto-next-bar-inner";
  var RECENT_PANEL_ID = "cscs-auto-next-recent-panel";

  // =========================
  // 直近一覧パネルのCSS（a_auto_next.js内で注入して有効化）
  // - inline style は display 制御のみにし、見た目はCSSへ委譲する
  // =========================
  function ensureRecentPanelCssInjected() {
    var STYLE_ID = "cscs-auto-next-recent-panel-style";
    try {
      if (document.getElementById(STYLE_ID)) {
        return;
      }
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.type = "text/css";
      style.textContent =
        "#cscs-auto-next-recent-panel {\n" +
        "    position: fixed !important;\n" +
        "    right: 12px;\n" +
        "    height: 100px;\n" +
        "    bottom: 54px;\n" +
        "    z-index: 10001;\n" +
        "    overflow: auto;\n" +
        "    padding: 10px 12px;\n" +
        "    background: rgba(0, 0, 0, 0.85);\n" +
        "    border: 1px solid rgba(255, 255, 255, 0.25);\n" +
        "    font-size: 12px;\n" +
        "    line-height: 1.6;\n" +
        "    display: block;\n" +
        "    pointer-events: auto;\n" +
        "    left: 71%;\n" +
        "    opacity: 0.3;\n" +
        "    border-radius: 10px;\n" +
        "}\n";
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) {
      // 失敗しても致命的ではないので無視
    }
  }

  // 直近一覧: qid → 問題文冒頭のキャッシュ（ネットワーク負荷を抑える）
  var RECENT_QID_HEAD_CACHE = {};
  var RECENT_QID_HEAD_CHARS = 30;

  // 直前の回答結果（qidごと）を保存するキー（localStorage）
  // - "○" = 正解, "×" = 不正解
  // - 未保存（結果なし）は "-" 扱い
  var LAST_RESULT_KEY_PREFIX = "cscs_q_last_result:";

  function loadLastResultMark(qid) {
    try {
      if (!qid) {
        return "-";
      }
      var v = localStorage.getItem(LAST_RESULT_KEY_PREFIX + qid);
      if (v === "○" || v === "×") {
        return v;
      }
      return "-";
    } catch (_e) {
      return "-";
    }
  }

  function saveLastResultMark(qid, mark) {
    try {
      if (!qid) {
        return;
      }
      if (mark !== "○" && mark !== "×") {
        return;
      }
      localStorage.setItem(LAST_RESULT_KEY_PREFIX + qid, mark);
    } catch (_e) {}
  }

  // qid を span の id として安全に使うための変換
  function makeSafeDomIdFromQid(qid) {
    return String(qid || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // 取得した HTML から、問題文の冒頭（<h1> の text）を取り出す
  function extractQuestionHeadFromHtml(htmlText) {
    try {
      var doc = new DOMParser().parseFromString(String(htmlText || ""), "text/html");
      var h1 = doc ? doc.querySelector("h1") : null;
      if (!h1) {
        return "";
      }

      // ▼ 改行や連続空白を1つのスペースに正規化して、履歴パネル内で改行させない
      var tRaw = String(h1.textContent || "");
      var t = tRaw.replace(/\s+/g, " ").trim();

      if (!t) {
        return "";
      }
      return t.slice(0, RECENT_QID_HEAD_CHARS);
    } catch (_e) {
      return "";
    }
  }

  // qid の AパートHTML を fetch して、問題文冒頭を返す（取れない場合は空文字）
  function fetchQuestionHead5FromUrl(qid, url) {
    return new Promise(function (resolve) {
      try {
        if (RECENT_QID_HEAD_CACHE && Object.prototype.hasOwnProperty.call(RECENT_QID_HEAD_CACHE, qid)) {
          resolve(String(RECENT_QID_HEAD_CACHE[qid] || ""));
          return;
        }

        fetch(url, { cache: "no-store" })
          .then(function (res) {
            if (!res || !res.ok) {
              resolve("");
              return null;
            }
            return res.text();
          })
          .then(function (text) {
            if (typeof text !== "string") {
              resolve("");
              return;
            }
            var head = extractQuestionHeadFromHtml(text);
            RECENT_QID_HEAD_CACHE[qid] = head;
            resolve(head);
          })
          .catch(function (_err) {
            resolve("");
          });
      } catch (_e2) {
        resolve("");
      }
    });
  }

  // 直近パネルの各行に、問題文冒頭を非同期で流し込む
  function fillRecentPanelQuestionHeads(panel) {
    try {
      if (!panel) {
        return;
      }

      var links = panel.querySelectorAll("a[data-cscs-recent-qid]");
      if (!links || links.length === 0) {
        return;
      }

      links.forEach(function (a) {
        var qid = a.getAttribute("data-cscs-recent-qid");
        var href = a.getAttribute("href");
        if (!qid || !href) {
          return;
        }

        var safe = makeSafeDomIdFromQid(qid);
        var spanId = "cscs-recent-qhead-" + safe;
        var span = document.getElementById(spanId);
        if (!span) {
          return;
        }

        // 既に入っているなら再取得しない
        if (span.dataset && span.dataset.cscsFilled === "1") {
          return;
        }

        fetchQuestionHead5FromUrl(qid, href).then(function (head) {
          try {
            if (head) {
              span.textContent = " " + head;
            } else {
              span.textContent = "";
            }
            if (span.dataset) {
              span.dataset.cscsFilled = "1";
            }
          } catch (_e3) {}
        });
      });
    } catch (_e4) {}
  }

  // 直近一覧パネル表示状態（トグル）
  var recentPanelOpen = false;

  // 直近履歴を読み込む（配列）
  function loadRecentQids() {
    var list = [];
    try {
      var raw = localStorage.getItem(RECENT_QIDS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed.filter(function (x) {
            return typeof x === "string" && x.length > 0;
          });
        }
      }
    } catch (_e) {
      list = [];
    }
    return list;
  }

  // 直近履歴を保存する
  function saveRecentQids(list) {
    try {
      localStorage.setItem(RECENT_QIDS_KEY, JSON.stringify(list));
    } catch (_e) {
      // 保存失敗は致命的ではないので無視
    }
  }

  // 現在ページのQIDを直近履歴へ積む（重複は連続重複のみ抑制）
  function pushCurrentQidToRecentHistory() {
    var info = parseSlideInfo();
    if (!info) {
      return;
    }
    var num3 = String(info.idx).padStart(3, "0");
    var qid = info.day + "-" + num3;

    var list = loadRecentQids();
    if (list.length > 0 && list[list.length - 1] === qid) {
      return;
    }
    list.push(qid);
    if (list.length > RECENT_QIDS_LIMIT) {
      list = list.slice(list.length - RECENT_QIDS_LIMIT);
    }
    saveRecentQids(list);
  }

  // 現在のパスから prefix（_build_cscs_ より前）を抽出
  function getPathPrefixForBuild() {
    var path = String(location.pathname || "");
    var m = path.match(/^(.*)_build_cscs_\d{8}\/slides\/q\d{3}_[ab](?:\.html)?$/);
    return m ? m[1] : "";
  }

  // qid("YYYYMMDD-NNN") → 해당 문제のAパートURLを組み立て
  function buildUrlFromQidToAPart(qid) {
    if (typeof qid !== "string") {
      return null;
    }
    var m = qid.match(/^(\d{8})-(\d{3})$/);
    if (!m) {
      return null;
    }
    var day = m[1];
    var num3 = m[2];
    var prefix = getPathPrefixForBuild();
    return prefix + "_build_cscs_" + day + "/slides/q" + num3 + "_a.html";
  }

  // 左下バーを作る（［前の問題へ］は左端固定、他は100px右へ）
  function getOrCreateAutoNextBar() {
    var bar = document.getElementById(AUTO_NEXT_BAR_ID);
    if (bar) {
      return bar;
    }

    var bodyEl = document.body;
    if (!bodyEl) {
      return null;
    }

    bar = document.createElement("div");
    bar.id = AUTO_NEXT_BAR_ID;

    // 左端に前ボタン、他は100px右へ（要望）
    bar.style.cssText =
      "position: fixed;" +
      "left: 0px;" +
      "bottom: 8px;" +
      "z-index: 10000;" +
      "width: 100%;" +
      "display: block;" +
      "pointer-events: none;";

    // 内側の横並びレーン（ここを100px右へ）
    var inner = document.createElement("div");
    inner.id = AUTO_NEXT_BAR_INNER_ID;
    // ▼ 位置調整は CSS と一致させる（gap/margin-left は inline が強いのでここで揃える）
    inner.style.cssText =
      "display: flex;" +
      "align-items: center;" +
      "gap: 0px;" +
      "margin-left: 256px;" +
      "pointer-events: none;";

    bar.appendChild(inner);
    bodyEl.appendChild(bar);

    return bar;
  }

  // 横並びに要素を入れる “内側レーン” を返す
  function getAutoNextBarInner() {
    var bar = getOrCreateAutoNextBar();
    if (!bar) {
      return null;
    }
    var inner = document.getElementById(AUTO_NEXT_BAR_INNER_ID);
    return inner || null;
  }

  // 直近一覧パネルを作る（前ボタンと被らないように “少し右へ”＆ “バーより上”）
  function getOrCreateRecentPanel() {
    var panel = document.getElementById(RECENT_PANEL_ID);
    if (panel) {
      return panel;
    }

    var bodyEl = document.body;
    if (!bodyEl) {
      return null;
    }

    panel = document.createElement("div");
    panel.id = RECENT_PANEL_ID;

    // 前ボタンを左端に置くので、パネルは left: 8px かつ width を控えめに
    // バーに被らないように bottom を少し上へ
    // ▼ 直近一覧パネルは「画面上端近くまで」広がれるようにする
    //   - bottom はバーとの干渉回避のため維持
    //   - top を指定して高さ上限を解放
    //   - max-height は使わず、top/bottom で可変にする
    // ▼ CSS は a_auto_next.js で注入した #cscs-auto-next-recent-panel に委譲する
    //   inline は表示制御（開閉）だけに限定し、見た目の競合を避ける
    panel.style.cssText =
      "display: none;" +
      "pointer-events: none;";

    bodyEl.appendChild(panel);
    return panel;
  }

  // 直近一覧を再描画する（縦一列リンク）
  function renderRecentPanel() {
      
    ensureRecentPanelCssInjected();            
      
    var panel = getOrCreateRecentPanel();
    if (!panel) {
      return;
    }

    var list = loadRecentQids().slice();

    // ▼ 追加: 現在表示中のQIDは履歴パネルから除外する
    try {
      var infoNow = parseSlideInfo();
      if (infoNow) {
        var num3Now = String(infoNow.idx).padStart(3, "0");
        var currentQid = infoNow.day + "-" + num3Now;
        list = list.filter(function (qid) {
          return qid !== currentQid;
        });
      }
    } catch (_e) {}

    list.reverse(); // 直近が上

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var qid = list[i];
      var url = buildUrlFromQidToAPart(qid);
      if (!url) {
        continue;
      }

      var safe = makeSafeDomIdFromQid(qid);
      var spanId = "cscs-recent-qhead-" + safe;

      var mark = loadLastResultMark(qid);

      html +=
        '<div style="margin: 2px 0;">' +
        '<a href="' + url + '" data-cscs-recent-qid="' + qid + '" style="display: flex; align-items: center; gap: 6px; width: 100%; color: #fff; text-decoration: none; border-bottom: 1px dotted rgba(255,255,255,0.45); white-space: nowrap;">' +
        '<span style="flex: 0 0 18px; width: 18px; color: rgba(255,255,255,0.9);">' + mark + "</span>" +
        '<span style="flex: 0 0 auto;">' + qid + "</span>" +
        '<span id="' + spanId + '" data-cscs-filled="0" style="flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,0.78);"></span>' +
        "</a>" +
        "</div>";
    }

    if (!html) {
      html = '<div style="color: rgba(255,255,255,0.8);">履歴がありません</div>';
    }

    panel.innerHTML = html;

    // パネル内リンクは「フェード連携」で遷移
    panel.querySelectorAll("a[data-cscs-recent-qid]").forEach(function (a) {
      if (a.dataset && a.dataset.cscsRecentBound === "1") {
        return;
      }
      if (a.dataset) {
        a.dataset.cscsRecentBound = "1";
      }

      a.addEventListener("click", function (ev) {
        try {
          ev.preventDefault();
        } catch (_e) {}
        var href = a.getAttribute("href");
        if (!href) {
          return;
        }
        goNextIfExists(href);
      });
    });

    // ▼ 各 qid の隣に「問題文冒頭5文字」を非同期で流し込む
    fillRecentPanelQuestionHeads(panel);
  }

  // パネルを開閉トグルする
  function toggleRecentPanel() {
    var panel = getOrCreateRecentPanel();
    if (!panel) {
      return;
    }

    recentPanelOpen = !recentPanelOpen;

    if (recentPanelOpen) {
      renderRecentPanel();
      panel.style.display = "block";
      panel.style.pointerEvents = "auto";
    } else {
      panel.style.display = "none";
      panel.style.pointerEvents = "none";
    }
  }

  // =========================
  // 自動送り ON/OFF の読み書き
  // =========================

  function loadAutoAdvanceEnabled() {
    try {
      // 追加した処理:
      // - 初回（未保存）時の既定値を OFF にする（ユーザー要望: デフォルトOFF）
      var v = localStorage.getItem(AUTO_ENABLED_KEY);
      if (v === null) {
        // 追加した処理:
        // - 保存値が無い（初回）場合は OFF 扱いにする
        return false;
      }

      // 追加した処理:
      // - 保存値が "1" のときだけ ON（それ以外は OFF）
      return v === "1";
    } catch (_e) {
      // 追加した処理:
      // - localStorage が使えない環境では、意図しない自動遷移を避けるため OFF 扱いにする
      return false;
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
  var RANDOM_HISTORY_LIMIT = 250;
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
        // 保存が無い・不正値なら最初の候補（10秒）にフォールバック
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

  // Bパートで b_judge_record.js が localStorage に書く「正本」から、
  // qid の直前結果（○/×）を確定保存する。
  //
  // 最優先の情報源:
  //   - cscs_once_per_day_today_results  // { qid: "correct"|"wrong" }
  //
  // 次点（保険ではなく補助）:
  //   - cscs_q_correct_total:{qid}, cscs_q_wrong_total:{qid}
  //
  // 情報源は localStorage のみ（DOMやAPIには依存しない）。
  function installLastResultWatcherIfNeeded() {
    try {
      if (window.__cscsLastResultWatcherInstalled) {
        return;
      }
      window.__cscsLastResultWatcherInstalled = true;

      var info = parseSlideInfo();
      if (!info || info.part !== "b") {
        return;
      }

      var num3 = String(info.idx).padStart(3, "0");
      var qid = info.day + "-" + num3;

      var onceKey = "cscs_once_per_day_today_results";
      var correctKey = "cscs_q_correct_total:" + qid;
      var wrongKey = "cscs_q_wrong_total:" + qid;

      function readInt(key) {
        try {
          var v = localStorage.getItem(key);
          var n = parseInt(v, 10);
          return isFinite(n) && n >= 0 ? n : 0;
        } catch (_e) {
          return 0;
        }
      }

      function tryGetMarkFromOncePerDay() {
        try {
          var raw = localStorage.getItem(onceKey);
          if (!raw) {
            return null;
          }
          var obj = JSON.parse(raw);
          if (!obj || typeof obj !== "object") {
            return null;
          }
          if (!Object.prototype.hasOwnProperty.call(obj, qid)) {
            return null;
          }
          var v = obj[qid];
          if (v === "correct") {
            return "○";
          }
          if (v === "wrong") {
            return "×";
          }
          return null;
        } catch (_e2) {
          return null;
        }
      }

      var lastCorrect = readInt(correctKey);
      var lastWrong = readInt(wrongKey);
      var lastOnceRaw = null;

      try {
        lastOnceRaw = localStorage.getItem(onceKey);
      } catch (_e3) {
        lastOnceRaw = null;
      }

      function updateMarkIfPossible(reason) {
        try {
          var m1 = tryGetMarkFromOncePerDay();
          if (m1 === "○" || m1 === "×") {
            saveLastResultMark(qid, m1);
            syncLog("LastResult: set by oncePerDayToday_results.", { qid: qid, mark: m1, reason: reason || "" });
            return true;
          }

          var nowCorrect = readInt(correctKey);
          var nowWrong = readInt(wrongKey);

          if (nowCorrect > lastCorrect) {
            lastCorrect = nowCorrect;
            saveLastResultMark(qid, "○");
            syncLog("LastResult: set ○ (correct_total increment).", { qid: qid, correct: nowCorrect, reason: reason || "" });
            return true;
          }

          if (nowWrong > lastWrong) {
            lastWrong = nowWrong;
            saveLastResultMark(qid, "×");
            syncLog("LastResult: set × (wrong_total increment).", { qid: qid, wrong: nowWrong, reason: reason || "" });
            return true;
          }

          return false;
        } catch (_e4) {
          return false;
        }
      }

      // 初回（既に回答済みで入っているケースも拾う）
      updateMarkIfPossible("init");

      // setItem を「localStorageインスタンス」ではなく「Storage.prototype」で監視する（こっちの方が外されにくい）
      if (!window.__cscsLastResultStorageHookInstalled) {
        window.__cscsLastResultStorageHookInstalled = true;

        var originalProtoSetItem = null;
        try {
          originalProtoSetItem = Storage.prototype.setItem;
        } catch (_e5) {
          originalProtoSetItem = null;
        }

        if (typeof originalProtoSetItem === "function") {
          Storage.prototype.setItem = function (key, value) {
            originalProtoSetItem.call(this, key, value);

            try {
              if (this !== localStorage) {
                return;
              }

              if (key === onceKey) {
                var nowOnceRaw = null;
                try {
                  nowOnceRaw = localStorage.getItem(onceKey);
                } catch (_e6) {
                  nowOnceRaw = null;
                }

                if (nowOnceRaw !== lastOnceRaw) {
                  lastOnceRaw = nowOnceRaw;
                  updateMarkIfPossible("proto.setItem:onceKey");
                }
                return;
              }

              if (key === correctKey || key === wrongKey) {
                updateMarkIfPossible("proto.setItem:totals");
                return;
              }
            } catch (_e7) {}
          };

          syncLog("LastResult: Storage.prototype.setItem hook installed.", { qid: qid });
        } else {
          syncLog("LastResult: Storage.prototype.setItem is not available; hook skipped.", { qid: qid });
        }
      }

      // 念のため、短時間だけポーリング（Bで回答してすぐ遷移するので、即反映を取りこぼさないため）
      // ※ ローカルステージのみ参照。外部フォールバックはしない。
      (function startShortPolling() {
        var tries = 0;
        var maxTries = 40; // 40 * 50ms = 2000ms
        var timerId = window.setInterval(function () {
          tries++;
          updateMarkIfPossible("poll");
          if (tries >= maxTries) {
            try {
              window.clearInterval(timerId);
            } catch (_e8) {}
          }
        }, 50);
      })();

      syncLog("LastResult watcher installed for B-part (oncePerDay primary).", { qid: qid });
    } catch (_e9) {}
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

    // ▼ 各モード状態の取得
    //   - verifyOn : 自動検証モード（整合性チェック用）の ON/OFF
    //   - trialOn  : トライアルモード（A→B 自動遷移＋計測あり）の ON/OFF
    var verifyOn =
      typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
    var trialOn =
      typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on";

    // ▼ 自動検証モード／トライアルモード共通の A→B 自動遷移処理
    //   - Aパートのときだけ、同じ問題番号の Bパートへ送る
    //   - Bパート側は従来どおりのロジック（次の問題の A へ）を使う
    if ((verifyOn || trialOn) && info.part === "a") {
      var pathVerify = String(location.pathname || "");
      var nextNum3Verify = String(info.idx).padStart(3, "0");
      var nextPathVerify = pathVerify.replace(
        /q\d{3}_a(?:\.html)?$/,
        "q" + nextNum3Verify + "_b.html"
      );

      var qidVerify = info.day + "-" + nextNum3Verify;
      syncLog("Verify/TrialMode: A→B auto jump.", {
        qid: qidVerify,
        url: nextPathVerify,
        verifyOn: verifyOn,
        trialOn: trialOn
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
          // ▼ 通常時: まず consistency_status で「×」判定された問題を除外する
          var isNg = await isConsistencyNg(candidateQid);
          if (isNg) {
            syncLog("ODOA sequential: skip consistency NG (×) qid.", {
              qid: candidateQid
            });
            // 次の候補へ進める
            currentDay = nextDay;
            currentIdx = nextIdx;
            currentPart = "a";
            safetySeq++;
            continue;
          }

          // ▼ 次に oncePerDayToday で「本日すでに計測済み」の問題をスキップ
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
        // ▼ 通常時: まず consistency_status で「×」判定された問題を除外
        var isNgRand = await isConsistencyNg(candidateQidRand);
        if (isNgRand) {
          syncLog("ODOA random: skip consistency NG (×) qid.", {
            qid: candidateQidRand
          });
          safetyRand++;
          continue;
        }

        // ▼ 次に oncePerDayToday 未回答 かつ 直近履歴に無い qid のみ採用
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

    var inner = getAutoNextBarInner();
    if (!inner) {
      return null;
    }

    var span = document.createElement("span");
    span.id = "auto-next-counter";
    span.textContent = "";

    // ボタン列の中の「テキスト表示」
    span.style.cssText =
      "padding: 6px 2px 6px 0;" +
      "font-size: 13px;" +
      "color: #fff;" +
      "text-align: right;" +
      "pointer-events: none;" +
      "width: 120px;" +
      "font-weight: 300;";

    inner.appendChild(span);
    return span;
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
    // ▼ CSS の padding 指定と一致させる（inline が優先されるためここで揃える）
    btn.style.cssText =
      "padding: 6px 5px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;" +
      "pointer-events: auto;";

    // ▼ UIをバーへ配置してから、クリックハンドラを確実に登録する
    var inner = getAutoNextBarInner();
    if (inner) {
      inner.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }

    // ▼ クリックで ON/OFF を切り替える（return の前に必ず登録）
    btn.addEventListener("click", function () {
      // ▼ ユーザー操作で自動送りを切り替える時は、
      //   検証AUTOの「自動再開タイマー/表示カウント」が残っていると counter 表示を奪うため、
      //   ここで確実に停止して「手動操作」を優先する。
      clearVerifyModeAutoRestartTimers();

      autoEnabled = !autoEnabled;
      saveAutoAdvanceEnabled(autoEnabled);
      btn.textContent = autoEnabled ? "[自動送り ON]" : "[自動送りOFF]";

      if (autoEnabled) {
        // ▼ ONにした瞬間、ODOA/oncePerDayToday を考慮した NEXT_URL を再計算して開始
        (async function () {
          NEXT_URL = await buildNextUrlConsideringOdoa();
          if (NEXT_URL) {
            startAutoAdvanceCountdown();
          } else {
            // ▼ 遷移候補が無い場合は OFF 表示へ
            cancelAutoAdvanceCountdown(true);
          }
        })();
      } else {
        // ▼ OFF にしたらカウントダウン停止 & 表示更新
        cancelAutoAdvanceCountdown(true);
      }
    });

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
    // ▼ CSS の padding 指定と一致させる（inline が優先されるためここで揃える）
    btn.style.cssText =
      "padding: 6px 5px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;" +
      "pointer-events: auto;";

    // ▼ UIをバーへ配置してから、クリックハンドラを確実に登録する
    var inner = getAutoNextBarInner();
    if (inner) {
      inner.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }

    // ▼ クリックでモード切替（return の前に必ず登録）
    btn.addEventListener("click", function () {
      randomModeEnabled = !randomModeEnabled;
      saveRandomModeEnabled(randomModeEnabled);
      btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番遷移]";

      // ▼ いったんカウントダウンを止めてから、新しい NEXT_URL で再スタート
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
    // ▼ CSS の padding 指定と一致させる（inline が優先されるためここで揃える）
    btn.style.cssText =
      "padding: 6px 5px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;" +
      "pointer-events: auto;";

    // ▼ UIをバーへ配置してから、クリックハンドラを確実に登録する
    var inner = getAutoNextBarInner();
    if (inner) {
      inner.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }

    // ▼ クリックごとに 10 → 15 → 20 → 25 → 30 → 60 → 10…とローテーション
    btn.addEventListener("click", function () {
      var nextMs = getNextDurationValue();
      AUTO_ADVANCE_MS = nextMs;
      saveAutoAdvanceMs(AUTO_ADVANCE_MS);
      var secNow = Math.round(AUTO_ADVANCE_MS / 1000);
      btn.textContent = "[" + secNow + "秒]";

      // ▼ 自動送りが ON のときは、新しい時間でカウントダウンをやり直す
      if (autoEnabled) {
        startAutoAdvanceCountdown();
      }
    });

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
    // ▼ CSS の padding 指定と一致させる（inline が優先されるためここで揃える）
    btn.style.cssText =
      "padding: 6px 5px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;" +
      "pointer-events: auto;";

    // ▼ UIをバーへ配置してから、クリックハンドラを確実に登録する
    var inner = getAutoNextBarInner();
    if (inner) {
      inner.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }

    // ▼ クリックごとに検証モード "on" / "off" をトグルし、公開ヘルパー経由で統一実行する
    btn.addEventListener("click", function () {
      var currentMode = (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on") ? "on" : "off";
      var nextMode = currentMode === "on" ? "off" : "on";

      if (nextMode === "on") {
        if (window.CSCS_VERIFY_MODE_HELPER && typeof window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode === "function") {
          window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode("user-toggle");
        } else {
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
          syncLog("VerifyMode: helper.turnOffVerifyMode is not available.", {
            reason: "user-toggle"
          });
        }
        return;
      }
    });

    return btn;
  }

  // TRYALモード（A→B 自動遷移＋計測あり）の ON/OFF を切り替えるボタンを生成する
  // - [TRYAL:ON] にした瞬間に検証モードを強制 OFF にし、自動送りを ON にそろえる
  function createTrialModeToggleButton() {
    var btn = document.getElementById("auto-next-trial-toggle");
    if (btn) {
      return btn;
    }

    btn = document.createElement("button");
    btn.id = "auto-next-trial-toggle";
    btn.type = "button";

    // 現在のトライアルモード状態に応じて初期ラベルを決定する
    var trialOn = (typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on");
    btn.textContent = trialOn ? "[TRYAL:ON]" : "[TRYAL:OFF]";

    // 他ボタンと同等の見た目にそろえる（位置だけ右側にずらす）
    // ▼ CSS の padding 指定と一致させる（inline が優先されるためここで揃える）
    btn.style.cssText =
      "padding: 6px 5px;" +
      "font-size: 13px;" +
      "color: rgb(150, 150, 150);" +
      "border-radius: 0px;" +
      "z-index: 10000;" +
      "cursor: pointer;" +
      "background: none;" +
      "border: none;" +
      "pointer-events: auto;";

    // ▼ UIをバーへ配置してから、クリックハンドラを確実に登録する
    var inner = getAutoNextBarInner();
    if (inner) {
      inner.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }

    // ▼ クリックで TRYAL モード "on"/"off" をトグルし、検証モード排他＆自動送りONを行う
    btn.addEventListener("click", function () {
      var current = (typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on") ? "on" : "off";
      var next = current === "on" ? "off" : "on";

      // ▼ トライアルモードの状態を更新（グローバル＋localStorage）
      window.CSCS_TRIAL_MODE = next;
      saveTrialMode(next);
      btn.textContent = next === "on" ? "[TRYAL:ON]" : "[TRYAL:OFF]";

      if (next === "on") {
        // ▼ TRYAL:ON 時は検証モードを必ず OFF にする
        if (window.CSCS_VERIFY_MODE_HELPER && typeof window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode === "function") {
          window.CSCS_VERIFY_MODE_HELPER.turnOffVerifyMode("trial-mode-on");
        } else {
          setVerifyModeAndSyncUI("off", {
            reason: "trial-mode-on"
          });
        }

        // ▼ 自動送りも ON に強制し、ボタン表示と localStorage を同期させる
        autoEnabled = true;
        saveAutoAdvanceEnabled(true);
        var autoBtn = document.getElementById("auto-next-toggle");
        if (autoBtn) {
          autoBtn.textContent = "[自動送り ON]";
        }

        // ▼ TRYAL 開始時に NEXT_URL を再計算し、カウントダウンを開始する
        (async function () {
          NEXT_URL = await buildNextUrlConsideringOdoa();
          if (NEXT_URL) {
            startAutoAdvanceCountdown();
          } else {
            cancelAutoAdvanceCountdown(true);
          }
        })();
      } else {
        // TRYAL:OFF では、検証モードは自動では触らず、自動送りの ON/OFF も現在状態を維持する

        // ▼ ただし、過去に検証AUTOの自動再開が予約されていると、
        //   以後の手動操作（自動送りOFFなど）に関係なくカウント表示が出続けることがあるため、
        //   TRYAL終了時点で「検証AUTO再開タイマー/表示」を確実に停止しておく。
        clearVerifyModeAutoRestartTimers();

        syncLog("TrialMode: turned OFF.", {});
      }
    });

    return btn;
  }

  // =========================
  // 外部から検証モードを強制ON/OFFにするための公開API
  // 例: 整合性チェックの自動モード切り替えなどから呼び出す
  // =========================
  window.CSCS_VERIFY_MODE_HELPER = window.CSCS_VERIFY_MODE_HELPER || {};

  // 検証モード自動再開関連のタイマーをすべてクリア
  function clearVerifyModeAutoRestartTimers() {
    if (verifyModeAutoRestartTimerId) {
      try {
        window.clearTimeout(verifyModeAutoRestartTimerId);
      } catch (_e) {}
      verifyModeAutoRestartTimerId = null;
    }
    if (verifyModeAutoRestartIntervalId) {
      try {
        window.clearInterval(verifyModeAutoRestartIntervalId);
      } catch (_e2) {}
      verifyModeAutoRestartIntervalId = null;
    }
    verifyModeAutoRestartDeadline = 0;
  }

  // 検証モード自動再開までの残り秒数を左下に表示する
  function startVerifyModeAutoRestartVisualCountdown() {
    if (!counterEl) {
      counterEl = createAutoNextCounterElement();
    }

    function update() {
      if (!verifyModeAutoRestartDeadline) {
        return;
      }
      var now = Date.now();
      var remainingMs = verifyModeAutoRestartDeadline - now;
      if (remainingMs <= 0) {
        if (counterEl) {
          counterEl.textContent = "検証AUTOの再開を試行中…";
        }
        // ここでは interval だけ止めて、実際の再開処理は setTimeout 側で実行
        if (verifyModeAutoRestartIntervalId) {
          try {
            window.clearInterval(verifyModeAutoRestartIntervalId);
          } catch (_e2) {}
          verifyModeAutoRestartIntervalId = null;
        }
        return;
      }
      var remainingSec = Math.ceil(remainingMs / 1000);
      if (counterEl) {
        // 検証再開までの残り秒数だけを表示
        counterEl.textContent =
          "検証再開まで " + remainingSec + " 秒";
      }
    }

    // 即時更新
    update();

    // すでに別のカウントが動いていれば一旦止める
    if (verifyModeAutoRestartIntervalId) {
      try {
        window.clearInterval(verifyModeAutoRestartIntervalId);
      } catch (_e3) {}
      verifyModeAutoRestartIntervalId = null;
    }
    verifyModeAutoRestartIntervalId = window.setInterval(update, COUNTER_INTERVAL_MS);
  }

  // 検証モード自動再開（3分後に turnOnVerifyMode を呼ぶ）を予約
  function scheduleVerifyModeAutoRestart(reasonStr) {
    clearVerifyModeAutoRestartTimers();

    verifyModeAutoRestartDeadline = Date.now() + VERIFY_MODE_AUTO_RESTART_DELAY_MS;

    try {
      syncLog(
        "VerifyMode: schedule auto-restart after " +
          (VERIFY_MODE_AUTO_RESTART_DELAY_MS / 1000) +
          "s.",
        {
          reason: reasonStr || "auto-restart"
        }
      );
    } catch (_e) {}

    verifyModeAutoRestartTimerId = window.setTimeout(function () {
      // タイマー本体が発火したら、ここでタイマーをクリアした上で検証モードONへ
      clearVerifyModeAutoRestartTimers();
      try {
        syncLog("VerifyMode: auto-restart timer fired, turning ON verify mode.", {
          reason: reasonStr || "auto-restart"
        });
      } catch (_e2) {}
      if (
        window.CSCS_VERIFY_MODE_HELPER &&
        typeof window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode === "function"
      ) {
        window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode("auto-restart");
      }
    }, VERIFY_MODE_AUTO_RESTART_DELAY_MS);

    // 残り秒数のカウント表示も開始
    startVerifyModeAutoRestartVisualCountdown();
  }

  // 検証モードを強制ONにする（[検証AUTO:ON] ＋ [自動送り ON]）
  if (!window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode) {
    window.CSCS_VERIFY_MODE_HELPER.turnOnVerifyMode = function (reason) {
      // 検証モードON時は、自動再開用タイマーは不要なのですべてクリア
      clearVerifyModeAutoRestartTimers();

      // 検証モード ON にする前に、TRYAL モードが ON なら OFF にそろえる
      if (typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on") {
        window.CSCS_TRIAL_MODE = "off";
        saveTrialMode("off");
        var trialBtn = document.getElementById("auto-next-trial-toggle");
        if (trialBtn) {
          trialBtn.textContent = "[TRYAL:OFF]";
        }
        syncLog("TrialMode: turned OFF because verify mode is turning ON.", {
          reason: reason || "verify-mode-on"
        });
      }

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
      var reasonStr = typeof reason === "string" ? reason : "";
      // user-toggle / trial-mode-on は「ユーザー都合の OFF」とみなし、自動再開は行わない
      var isManualOff =
        reasonStr === "user-toggle" ||
        reasonStr === "trial-mode-on";

      // まず既存の自動再開タイマーをクリア（後で必要なら再スケジュール）
      // - すでに別の理由で予約されている自動再開を一旦リセットする
      clearVerifyModeAutoRestartTimers();

      // 検証モードを "off" にして UI と localStorage を同期
      // - 理由はログ用に reasonStr をそのまま渡しておく
      setVerifyModeAndSyncUI("off", {
        reason: reasonStr || "external-turn-off"
      });

      // ★ 検証モードOFF時は、自動送りも必ず OFF に揃える
      //   - 検証AUTOと自動送りの状態を常に一致させるため
      autoEnabled = false;
      saveAutoAdvanceEnabled(false);
      var autoBtn = document.getElementById("auto-next-toggle");
      if (autoBtn) {
        autoBtn.textContent = "[自動送りOFF]";
      }

      // カウントダウンや自動遷移も停止し、「OFF」表示にしておく
      // - 検証AUTO用・通常自動送り用のどちらのカウント表示もここでいったんリセット
      cancelAutoAdvanceCountdown(true);

      // ▼ 「自動OFF」とみなせる場合のみ、3分後に自動ONを予約
      //   - user-toggle / trial-mode-on は「意図的なOFF」とみなして自動再開しない
      //   - それ以外（例: APIエラーなど）は自動OFF扱いとして自動再開を予約する
      if (!isManualOff) {
        scheduleVerifyModeAutoRestart(reasonStr || "auto-restart");
      } else {
        try {
          syncLog("VerifyMode: turned off manually; no auto-restart.", {
            reason: reasonStr || "manual-off"
          });
        } catch (_e3) {}
      }
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
  // 「前の問題へ」ボタンの生成
  // - 画面左端に固定（他の列は100px右へ逃がしているので干渉しにくい）
  // - クリックで「直近問題ID一覧」パネルを開閉トグル
  // =========================
  function createPrevQuestionToggleButton() {
    var existing = document.getElementById("auto-prev-toggle");
    if (existing) {
      return existing;
    }

    var bar = getOrCreateAutoNextBar();
    if (!bar) {
      return null;
    }

    var btn = document.createElement("a");
    btn.id = "auto-prev-toggle";
    btn.className = "back-to-top";
    btn.textContent = "［履歴を見る］";

    // 左端固定（バーの外側に置く）
    // ▼ 位置調整は CSS と一致させる（left/bottom は inline が強いのでここで揃える）
    btn.style.cssText =
      "position: fixed;" +
      "left: 16px;" +
      "bottom: 14px;" +
      "z-index: 10002;" +
      "cursor: pointer;" +
      "pointer-events: auto;";

    btn.addEventListener("click", function (ev) {
      try {
        ev.preventDefault();
      } catch (_e) {}
      toggleRecentPanel();
    });

    document.body.appendChild(btn);
    return btn;
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
    var existing = document.getElementById("auto-next-link");
    if (existing) {
      return existing;
    }

    var inner = getAutoNextBarInner();
    if (!inner) {
      syncLog("BackToTop: bar inner not found.");
      return null;
    }

    // a.back-to-top 要素を生成
    var link = document.createElement("a");
    link.id = "auto-next-link";
    link.className = "back-to-top";
    link.textContent = "［次の問題へ］";

    // ▼ 位置調整は CSS と一致させる（inline が優先されるためここで固定）
    link.style.cssText =
      "position: fixed;" +
      "left: 136px;" +
      "bottom: 14px;" +
      "pointer-events: auto;";

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

    // バー内に追加（横並び）
    link.style.pointerEvents = "auto";
    inner.appendChild(link);

    syncLog("BackToTop: link created under bar.");
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

    // ▼ 検証モード／トライアルモード中の有効待ち時間を決定する
    //   - 検証モード:   A=5秒,  B=20秒（これまでどおり）
    //   - TRYALモード: A=20秒, B=30秒（トレーニング用に少し長めに設定）
    var verifyOn =
      typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on";
    var trialOn =
      typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on";
    var effectiveMs = AUTO_ADVANCE_MS;

    if (verifyOn || trialOn) {
      // 現在のスライドが Aパートか Bパートかを判定して、それぞれのモード別に待ち時間を固定する
      var infoForVerify = parseSlideInfo();
      if (infoForVerify && infoForVerify.part === "a") {
        if (trialOn) {
          // TRYALモード中の Aパート: 20秒 固定（実トレーニング用に少し長めにする）
          effectiveMs = 20000;
          syncLog("TrialMode: use fixed duration for A (20s).", {
            ms: effectiveMs,
            verifyOn: verifyOn,
            trialOn: trialOn
          });
        } else {
          // 検証モード中の Aパート: 5秒 固定（従来どおり）
          effectiveMs = 5000;
          syncLog("VerifyMode: use fixed duration for A (5s).", {
            ms: effectiveMs,
            verifyOn: verifyOn,
            trialOn: trialOn
          });
        }
      } else if (infoForVerify && infoForVerify.part === "b") {
        if (trialOn) {
          // TRYALモード中の Bパート: 30秒 固定（問題を考える時間を少し長めに確保する）
          effectiveMs = 30000;
          syncLog("TrialMode: use fixed duration for B (30s).", {
            ms: effectiveMs,
            verifyOn: verifyOn,
            trialOn: trialOn
          });
        } else {
          // 検証モード中の Bパート: 20秒 固定（従来どおり）
          effectiveMs = 20000;
          syncLog("VerifyMode: use fixed duration for B (20s).", {
            ms: effectiveMs,
            verifyOn: verifyOn,
            trialOn: trialOn
          });
        }
      } else {
        // part が a/b どちらか判定できない場合は、ユーザー指定の AUTO_ADVANCE_MS をそのまま使用する
        syncLog("Verify/TrialMode: slide info not available, use current AUTO_ADVANCE_MS.", {
          ms: effectiveMs,
          verifyOn: verifyOn,
          trialOn: trialOn
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

      // ▼ 自動遷移（タイマー発火）だと判別できるように、URLにマーカーを付与する
      //   - 手動クリックの遷移では付与しない（NEXT_URL自体は汚さない）
      //   - b_judge.js 側で「自動遷移かどうか」「TRYAL/検証AUTOか」を判定できるようにする
      var urlToGo = NEXT_URL;
      try {
        var u = new URL(String(NEXT_URL || ""), location.href);
        u.searchParams.set("auto", "1");

        var vOn = (typeof window.CSCS_VERIFY_MODE === "string" && window.CSCS_VERIFY_MODE === "on");
        var tOn = (typeof window.CSCS_TRIAL_MODE === "string" && window.CSCS_TRIAL_MODE === "on");
        if (tOn) {
          u.searchParams.set("trial_auto", "1");
        }
        if (vOn) {
          u.searchParams.set("verify_auto", "1");
        }

        urlToGo = u.toString();
      } catch (_eAutoMark) {
        urlToGo = NEXT_URL;
      }

      goNextIfExists(urlToGo);
    }, effectiveMs);
  }

  // =========================
  // 初期化処理（ページ読み込み完了時）
  // =========================
  async function onReady() {
    // 直近履歴に「今のQID」を積む（一覧ウィンドウ用）
    pushCurrentQidToRecentHistory();

    // Bパートなら「直前結果（○/×）」の監視を開始（localStorageのみ）
    installLastResultWatcherIfNeeded();

    // 左下バーの器を確実に作る（ボタン群を横一列にする）
    getOrCreateAutoNextBar();

    // 左端に「↑前の問題へ」ボタンを作る（押下で一覧ウィンドウ開閉）
    createPrevQuestionToggleButton();

    // ▼ 追加: 直近一覧パネルをデフォルトで開いた状態にする
    try {
      var p = getOrCreateRecentPanel();
      if (p) {
        recentPanelOpen = true;
        renderRecentPanel();
        p.style.display = "block";
        p.style.pointerEvents = "auto";
      }
    } catch (_eOpen) {}

    // まず ODOA / oncePerDayToday を考慮した「次の URL」を計算
    NEXT_URL = await buildNextUrlConsideringOdoa();
    if (!NEXT_URL) {
      // 次 URL が無ければフェードインだけやって終了
      runFadeInIfNeeded();
      return;
    }

    // 画面左下の制御ボタン類を作成（バー内で横一列）
    createBackToTopLink();              // ［次の問題へ］
    createAutoNextCounterElement();     // 「自動送りはOFFです / 次の問題までXX秒」
    createAutoNextToggleButton();       // 自動送り ON/OFF
    createAutoNextModeToggleButton();   // 順番／ランダム
    createAutoNextDurationButton();     // 待ち時間（秒）
    createVerifyModeToggleButton();     // 自動検証モード（A→B 自動遷移）
    createTrialModeToggleButton();      // TRYALモード（A→B 自動遷移＋計測あり）

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

  // nav-guard と同じ: SYNC bootstrap（__CSCS_SYNC_KEY_PROMISE__）完了後にだけ a_auto_next を起動する
  //
  // 【重要（見落とし防止）】
  //   a_auto_next.js は起動直後に /api/sync/state を fetch して ODOA / oncePerDayToday / consistency_status を参照する。
  //   この fetch は必ず "X-CSCS-Key" ヘッダ（= window.CSCS_SYNC_KEY）を必要とし、
  //   キー無しで叩くと Workers 側で 400（missing X-CSCS-Key）になり、ODOA 判定や候補探索が壊れる。
  //
  //   そのため、このファイルは「DOM ready」より前に、
  //   まず sync bootstrap（cscs_sync_bootstrap_a.js 等）が
  //   window.CSCS_SYNC_KEY を確定させるのを待つ必要がある。
  //
  //   待ち条件は window.__CSCS_SYNC_KEY_PROMISE__ の resolve を唯一の合図とする。
  //   - resolve 後: window.CSCS_SYNC_KEY がセット済みで、/api/sync/state を安全に叩ける
  //   - resolve 前: /api/sync/state を叩くと missing key で落ちる（今回のバグの根本）
  //
  //   ※ ここで別ルートのフォールバック（localStorage/固定キー等）を増やさない（恒久方針）。
  function waitForSyncBootstrapThenStart(startFn) {
    var WIN_PROMISE = "__CSCS_SYNC_KEY_PROMISE__";

    try {
      if (!window[WIN_PROMISE] || typeof window[WIN_PROMISE].then !== "function") {
        console.error("[A:auto-next] SYNC_KEY_PROMISE missing: bootstrap not installed or not executed.");
        return;
      }
    } catch (_e0) {
      try {
        console.error("[A:auto-next] SYNC_KEY_PROMISE check failed.");
      } catch (_e0b) {}
      return;
    }

    window[WIN_PROMISE]
      .then(function () {
        try {
          startFn();
        } catch (_e1) {
          try {
            console.error("[A:auto-next] startFn failed:", _e1);
          } catch (_e2) {}
        }
      })
      .catch(function (e) {
        try {
          console.error("[A:auto-next] SYNC bootstrap failed (promise rejected):", e);
        } catch (_e3) {}
      });
  }

  function startWhenDomReady() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      onReady();
    } else {
      document.addEventListener("DOMContentLoaded", onReady);
    }
  }

  waitForSyncBootstrapThenStart(startWhenDomReady);
})();