// assets/a_auto_next.js
// Aパート（＆Bパート）で、一定時間後に次の問題へ自動遷移するためのスクリプト。
// ・自動送り ON/OFF
// ・順番モード／ランダムモード
// ・待ち時間（20 / 30 / 60 秒）の切り替え
// ・左下のカウンター表示
// ・nav_list / フェード演出との連携
// をまとめて面倒見ている。

(function () {
  "use strict";

  // =========================
  // 設定値と localStorage キー
  // =========================

  // 自動遷移までの候補時間（ミリ秒）
  var AUTO_ADVANCE_MS_CANDIDATES = [20000, 30000, 60000];
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
    var safety = 0; // 無限ループ防止

    // 「今の問題と同じ URL にならない」ランダムなパスを、最大100回トライする
    while (candidatePath === currentPath && safety < 100) {
      var randDay = getRandomDayStringBetween(RANDOM_MIN_DAY, RANDOM_MAX_DAY);
      if (!randDay) {
        break;
      }
      var randIdx = Math.floor(Math.random() * 30) + 1; // 1〜30
      var randNum3 = String(randIdx).padStart(3, "0");
      candidatePath =
        prefix + "_build_cscs_" + randDay + "/slides/q" + randNum3 + "_a.html";
      safety++;
    }

    if (candidatePath === currentPath) {
      // 安全策：結局同じパスしか作れなかった場合は諦める
      return null;
    }
    return candidatePath;
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
    btn.textContent = autoEnabled ? "[自動送りON]" : "[自動送りOFF]";
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
      btn.textContent = autoEnabled ? "[自動送りON]" : "[自動送りOFF]";

      if (autoEnabled) {
        // ON にした瞬間からカウントダウンを開始
        startAutoAdvanceCountdown();
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
    btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番]";
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
      btn.textContent = randomModeEnabled ? "[ランダム]" : "[順番]";

      // いったんカウントダウンを止めてから、新しい NEXT_URL で再スタート
      cancelAutoAdvanceCountdown(false);

      if (autoEnabled) {
        NEXT_URL = buildNextUrl();
        if (NEXT_URL) {
          startAutoAdvanceCountdown();
        } else {
          cancelAutoAdvanceCountdown(true);
        }
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  // =========================
  // 自動送り時間（20/30/60秒）切り替えボタンの生成
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

    // クリックごとに 20 → 30 → 60 → 20…とローテーション
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

    // 最新の NEXT_URL を計算
    NEXT_URL = buildNextUrl();

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

    // 現在時刻と終了時刻を記録
    startTime = Date.now();
    endTime = startTime + AUTO_ADVANCE_MS;

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

    // 待ち時間経過後に、自動で次の問題へ遷移
    autoTimeoutId = window.setTimeout(function () {
      if (counterTimerId) {
        window.clearInterval(counterTimerId);
        counterTimerId = null;
      }
      goNextIfExists(NEXT_URL);
    }, AUTO_ADVANCE_MS);
  }

  // =========================
  // 初期化処理（ページ読み込み完了時）
  // =========================
  function onReady() {
    // まず「次の URL」を計算
    NEXT_URL = buildNextUrl();
    if (!NEXT_URL) {
      // 次 URL が無ければフェードインだけやって終了
      runFadeInIfNeeded();
      return;
    }

    // 画面左下の制御ボタン類を作成
    createAutoNextToggleButton();     // 自動送り ON/OFF
    createAutoNextModeToggleButton(); // 順番／ランダム
    createAutoNextDurationButton();   // 待ち時間（秒）

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