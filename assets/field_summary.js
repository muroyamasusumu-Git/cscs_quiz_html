// assets/field_summary.js

(function () {
  "use strict";

  // =========================
  // 1. スタイル（CSS）を自動挿入
  // =========================
  // 進捗パネル #cscs-field-star-summary 用の見た目をここで定義して <head> に挿入するヘルパー
  function injectFieldSummaryStyles() {
    // 二重挿入防止
    if (document.getElementById("cscs-field-star-summary-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "cscs-field-star-summary-style";
    style.textContent = `
    #cscs-field-star-summary {
        font-size: 11px;
        margin-top: 0;
        padding: 10px 10px 0 5px;
        color: rgb(255, 255, 255);
        opacity: 0.55;
        width: 68.0%;
        font-weight: 300;
    }

    .cscs-star-summary-line-compact {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1px;
        font-size: 12px;
        margin-bottom: 8px;
        margin-left: -4px;
    }

    .cscs-star-main-compact {
        font-weight: 600;
    }

    .cscs-star-mood {
        margin-left: 2px;
        opacity: 0.8;
    }

    .cscs-star-section-compact {
        display: inline-flex;
        align-items: center;
        gap: 0px;
        flex: 1 1 0;
        white-space: nowrap;
    }

    .cscs-star-section-compact .cscs-star-percent {
        min-width: 0;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .cscs-star-meter {
        position: relative;
        display: inline-block;
        flex: 1 1 auto;
        width: auto;
        min-width: 30px;
        max-width: 220px;
        height: 8px;
        margin-left: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        overflow: hidden;
        margin-top: 1px;
    }

    .cscs-star-meter-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(255, 215, 0, 0.95), rgba(255, 255, 255, 0.95));
    }

    .cscs-star-meter-fill-total {
        /* ⭐️と同じ黄色グラデーションに統一 */
        background: linear-gradient(90deg, rgba(255, 215, 0, 0.95), rgba(255, 255, 255, 0.95));
    }

    /* 分野ゲージ用 内側バー（黄色グラデーション） */
    .cscs-field-bar-inner {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(255, 215, 0, 0.95), rgba(255, 255, 255, 0.95));
    }

    /* テーマ一覧バー（見出し直下にインライン表示） */
    .cscs-field-theme-bar {
        margin-top: 2px;
        margin-bottom: 2px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        opacity: 0.9;
    }

    .cscs-field-theme-label {
        font-weight: 600;
        margin-right: 4px;
    }

    .cscs-field-theme-list {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .cscs-field-theme-pill {
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 999px;
        padding: 1px 6px;
        font-size: 10px;
        background: rgba(0, 0, 0, 0.3);
        color: #fff;
        cursor: pointer;
        line-height: 1.4;
        white-space: nowrap;
    }

    .cscs-field-theme-pill:hover {
        background: rgba(255, 255, 255, 0.12);
    }

    .cscs-field-theme-pill-active {
        background: rgba(255, 215, 0, 0.3);
        border-color: rgba(255, 215, 0, 0.9);
    }
    `;
    document.head.appendChild(style);
    console.log("field_summary.js: CSS for compact star summary injected");
  }

  // 旧ダミー値（現在は実計算に置き換え済みだが、一部計算に名残あり）
  var DUMMY_TOTAL = 2700;
  var DUMMY_STAR_DONE = 500;
  var DUMMY_DAYS_LEFT = 120;

  // =========================
  // 2. メタ情報（cscs_meta_all.json）から
  //    ・Field名リスト
  //    ・Fieldごとの総問題数
  //    ・qid(YYYYMMDD-NNN) → Field / Theme / Level / Question のマップ
  //    を作る
  // =========================
  function normalizeMetaForFields(meta) {
    var rows = [];
    // 形式1: { items: [...] }
    if (meta && Array.isArray(meta.items)) {
      rows = meta.items;
    // 形式2: { questions: [...] }（csv→metaのパターン）
    } else if (meta && Array.isArray(meta.questions)) {
      rows = meta.questions;
    // 形式3: 単純な配列
    } else if (Array.isArray(meta)) {
      rows = meta;
    } else {
      // どれにも該当しない場合は空で返す
      return { names: [], totals: {}, qidToField: {}, qidToQuestion: {}, qidToTheme: {}, qidToLevel: {} };
    }

    // Field 名一覧（重複なし）
    var set = new Set();
    // Fieldごとの問題数
    var totals = Object.create(null);
    // qid → Field の対応表（streak3 のキーと結びつけるために必須）
    var qidMap = Object.create(null);
    // qid → Question の対応表（ローカルステージのメタから取得）
    var qTextMap = Object.create(null);
    // qid → Theme の対応表（分野内でのソート用）
    var qThemeMap = Object.create(null);
    // qid → Level の対応表（分野内でのソート用）
    var qLevelMap = Object.create(null);

    rows.forEach(function (x) {
      // Field 名を取得（大文字小文字・プロパティ名違いの吸収）
      var f = x.Field || x.field || "";
      f = String(f).trim();
      if (!f) {
        return;
      }
      set.add(f);

      // Fieldごとの総問題数をカウント
      if (totals[f] == null) {
        totals[f] = 1;
      } else {
        totals[f] += 1;
      }

      // qid用の日付を取得（Date or day）
      var day = x.Date || x.day || "";
      day = String(day).trim();

      // 番号部分 (Number or n3) を取得
      var numRaw = null;
      if (x.n3 != null) {
        numRaw = x.n3;
      } else if (x.Number != null) {
        numRaw = x.Number;
      }

      // n3（3桁ゼロ埋め）に整形
      var n3 = "";
      if (numRaw != null) {
        n3 = String(numRaw);
        if (n3.length < 3) {
          n3 = ("00" + n3).slice(-3);
        }
      }

      // day と n3 が揃っていれば qid を作成し、Field / Theme / Level / Question を紐付ける
      if (day && n3) {
        var qid = day + "-" + n3;
        if (!qidMap[qid]) {
          qidMap[qid] = f;
        }

        // Question テキスト（候補: text / Question / question / Stem）
        var qtext =
          x.text != null
            ? x.text
            : x.Question != null
            ? x.Question
            : x.question != null
            ? x.question
            : x.Stem != null
            ? x.Stem
            : "";
        qtext = String(qtext == null ? "" : qtext).trim();
        if (!qTextMap[qid]) {
          qTextMap[qid] = qtext;
        }

        // Theme テキスト（候補: Theme / theme）
        var themeRaw = x.Theme != null ? x.Theme : x.theme != null ? x.theme : "";
        var themeText = String(themeRaw == null ? "" : themeRaw).trim();
        if (!qThemeMap[qid]) {
          qThemeMap[qid] = themeText;
        }

        // Level テキスト（候補: Level / level）
        var levelRaw = x.Level != null ? x.Level : x.level != null ? x.level : "";
        var levelText = String(levelRaw == null ? "" : levelRaw).trim();
        if (!qLevelMap[qid]) {
          qLevelMap[qid] = levelText;
        }
      }
    });

    return {
      // 分野名一覧
      names: Array.from(set),
      // 分野別の総問題数
      totals: totals,
      // 問題ID(qid)→分野名
      qidToField: qidMap,
      // 問題ID(qid)→問題文
      qidToQuestion: qTextMap,
      // 問題ID(qid)→テーマ
      qidToTheme: qThemeMap,
      // 問題ID(qid)→レベル
      qidToLevel: qLevelMap
    };
  }

  // =========================
  // 3. メタ情報の読み込み（Field一覧の取得）
  // =========================
  async function loadFieldNamesFromMetaStrict() {
    try {
      // デフォルトのメタJSONパス（similar_list.js と同じ）
      var src = "../../assets/cscs_meta_all.json";
      // <script src="...field_summary.js" data-src="..."> がある場合は data-src を優先
      (function () {
        var scripts = document.scripts;
        for (var i = 0; i < scripts.length; i++) {
          var s = scripts[i];
          if ((s.src || "").indexOf("field_summary.js") !== -1 && s.dataset && s.dataset.src) {
            src = s.dataset.src;
            break;
          }
        }
      })();

      // 絶対URLに解決して fetch
      var url = new URL(src, location.href).href;
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("field_summary.js: meta JSON fetch failed: " + res.status);
        return null;
      }

      var meta = await res.json();
      // meta から Field情報を正規化
      var info = normalizeMetaForFields(meta);
      if (!info || !info.names || !info.names.length) {
        console.error("field_summary.js: meta に有効な Field がありません");
        return null;
      }

      // グローバル変数に保存（後で使う）
      fieldTotals = info.totals || {};
      qidToField = info.qidToField || {};
      qidToQuestion = info.qidToQuestion || {};
      // ▼ 分野内ソートで使うテーマ / レベルのマップも保持する
      qidToTheme = info.qidToTheme || {};
      qidToLevel = info.qidToLevel || {};
      return info.names;
    } catch (e) {
      console.error("field_summary.js: meta 読み込み失敗", e);
      return null;
    }
  }

  // =========================
  // 4. /api/sync/state から streak3 情報を読み、
  //    ・Fieldごとの「★獲得済み問題数」
  //    ・全体の獲得数
  //    ・試験日から逆算した「残り日数」「1日あたり必要★数」
  //    を計算する
  // =========================
  async function loadStarFieldCountsStrict() {
    try {
      // SYNC状態を取得
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("field_summary.js: /api/sync/state 取得失敗: " + res.status);
        return null;
      }
      var json = await res.json();
      if (!json || typeof json !== "object") {
        console.error("field_summary.js: SYNC データ形式が不正です", json);
        return null;
      }

      // SYNCルート（/state の生JSON or { data: {...} } のどちらにも対応）
      var root = json.data || json;
      if (!root.streak3 || typeof root.streak3 !== "object") {
        console.error("field_summary.js: SYNC に streak3 がありません", root);
        return null;
      }
      var streak3 = root.streak3;

      // 3連続不正解（💣）累計マップは存在すれば採用（任意）
      var streak3Wrong = null;
      if (root.streak3Wrong && typeof root.streak3Wrong === "object") {
        streak3Wrong = root.streak3Wrong;
      }

      // 問題別 最終日情報（lastSeen / lastCorrect / lastWrong）マップ
      var lastSeenDay = null;
      if (root.lastSeenDay && typeof root.lastSeenDay === "object") {
        lastSeenDay = root.lastSeenDay;
      }
      var lastCorrectDay = null;
      if (root.lastCorrectDay && typeof root.lastCorrectDay === "object") {
        lastCorrectDay = root.lastCorrectDay;
      }
      var lastWrongDay = null;
      if (root.lastWrongDay && typeof root.lastWrongDay === "object") {
        lastWrongDay = root.lastWrongDay;
      }

      // モジュール全体から参照できるように保持
      syncStreak3Map = streak3;
      syncStreak3WrongMap = streak3Wrong;
      syncLastSeenDayMap = lastSeenDay;
      syncLastCorrectDayMap = lastCorrectDay;
      syncLastWrongDayMap = lastWrongDay;

      // 各 Field に対する「★獲得済み問題数」を集計
      var counts = Object.create(null);
      var totalStarQ = 0;

      Object.keys(streak3).forEach(function (qid) {
        var cnt = Number(streak3[qid] || 0);
        // streak3[qid] が 0 以下 or 非数ならスキップ
        if (!Number.isFinite(cnt) || cnt <= 0) {
          return;
        }
        // meta側で qid→Field の対応が取れない場合もスキップ
        if (!qidToField || !Object.prototype.hasOwnProperty.call(qidToField, qid)) {
          return;
        }
        var field = qidToField[qid];
        if (!field) {
          return;
        }

        // 分野ごとの獲得済み問題数を +1
        if (counts[field] == null) {
          counts[field] = 1;
        } else {
          counts[field] += 1;
        }
        // 全体の獲得済み問題数カウント
        totalStarQ += 1;
      });

      // 試験日 (exam_date) を SYNC から取得し、Date にパース
      var examDate = null;
      if (typeof root.exam_date === "string") {
        var m = root.exam_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          var y = Number(m[1]);
          var mo = Number(m[2]) - 1;
          var d = Number(m[3]);
          var dt = new Date(y, mo, d);
          // パース結果の妥当性確認
          if (
            !Number.isNaN(dt.getTime()) &&
            dt.getFullYear() === y &&
            dt.getMonth() === mo &&
            dt.getDate() === d
          ) {
            examDate = dt;
          }
        }
      }

      // 試験日の「14日前」を締切とみなして残り日数を計算
      var remainingDays = 0;
      if (examDate) {
        var now = new Date();
        var todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var deadline = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
        // 試験日の 2週間前を締切とする
        deadline.setDate(deadline.getDate() - 14);
        var diffMs = deadline.getTime() - todayBase.getTime();
        remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (!Number.isFinite(remainingDays) || remainingDays < 0) {
          remainingDays = 0;
        }
      }

      //「全問題を★1回以上とる」ために必要な1日あたりの目標数を計算
      var targetPerDay = 0;

      // ★ 総問題数の決定:
      //   - まず SYNC の root.global.totalQuestions（number, >0）を最優先
      //   - 不正または存在しない場合のみ DUMMY_TOTAL を暫定使用
      var TOTAL_Q = 0;
      var totalFromSync = null;
      try {
        if (root && typeof root === "object" && root.global && typeof root.global === "object") {
          var tRaw = root.global.totalQuestions;
          if (typeof tRaw === "number" && Number.isFinite(tRaw) && tRaw > 0) {
            totalFromSync = tRaw;
          }
        }
      } catch (_e) {
        totalFromSync = null;
      }
      if (totalFromSync !== null) {
        TOTAL_Q = totalFromSync;
      } else {
        TOTAL_Q = DUMMY_TOTAL;
      }

      // モジュール全体で参照できるように保持
      totalQuestionsGlobal = TOTAL_Q;

      if (remainingDays > 0) {
        var remainingStar = TOTAL_Q - totalStarQ;
        if (remainingStar < 0) {
          remainingStar = 0;
        }
        targetPerDay = Math.ceil(remainingStar / remainingDays);
      } else {
        targetPerDay = 0;
      }

      // =========================
      // SYNC の state.correct / state.incorrect を使って
      // ・未正解問題数
      // ・未回答問題数
      // を集計する（フォールバックなし）
      // =========================

      // 正解マップ: state.correct
      var correctMap = null;
      if (root.correct && typeof root.correct === "object") {
        correctMap = root.correct;
      }

      // 不正解マップ: state.incorrect
      var incorrectMap = null;
      if (root.incorrect && typeof root.incorrect === "object") {
        incorrectMap = root.incorrect;
      }

      // SYNCから取得した正解/不正解マップをモジュール内共有変数に保存（最終正誤表示用）
      syncCorrectMap = correctMap || {};
      syncIncorrectMap = incorrectMap || {};
      if (root.streakLen && typeof root.streakLen === "object") {
        // 連続正解回数マップも共有（qid一覧テーブルの「連続回数」表示に利用）
        syncStreakLenMap = root.streakLen;
      } else {
        syncStreakLenMap = null;
      }

      var everCorrectCount = 0;               // 一度でも正解したことがある問題数
      var appearedSet = new Set();           // 一度でも正解 or 不正解として登場した qid の集合

      // correctMap から：
      //   - 「一度でも正解したことがある問題数」を数える
      //   - correct のキーは「登場した qid」として appearedSet に追加
      if (correctMap) {
        var correctQids = Object.keys(correctMap);
        correctQids.forEach(function (qid) {
          var v = correctMap[qid];
          var n;

          // number / { total: number } 両対応で total 回数を取り出す
          if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "total")) {
            n = Number(v.total);
          } else {
            n = Number(v);
          }
          if (!Number.isFinite(n) || n < 0) {
            n = 0;
          }

          if (n > 0) {
            everCorrectCount += 1;
          }

          appearedSet.add(qid);
        });
      }

      // incorrectMap から：
      //   - 「一度でも正解または不正解をしたことがある問題」の集合に qid を追加
      if (incorrectMap) {
        var incorrectQids = Object.keys(incorrectMap);
        incorrectQids.forEach(function (qid) {
          appearedSet.add(qid);
        });
      }

      // 未正解 = 全問題数 - 「一度でも正解したことがある問題数」
      var unsolved = TOTAL_Q - everCorrectCount;
      if (!Number.isFinite(unsolved) || unsolved < 0) {
        unsolved = 0;
      }

      // 未回答 = 全問題数 - 「一度でも正解または不正解をしたことがある問題数」
      var appearedCount = appearedSet.size;
      var unanswered = TOTAL_Q - appearedCount;
      if (!Number.isFinite(unanswered) || unanswered < 0) {
        unanswered = 0;
      }

      // =========================
      // リーチ数（⚡️）と「あと1回でリーチ（✨）」を集計する：
      //   ・現時点で 3連続正解（★）はしていない
      //   ・streakLen[qid] === 2 → リーチ⚡️
      //   ・streakLen[qid] === 1 → あと1回正解でリーチ✨
      // =========================
      var reachCount = 0;
      var preReachCount = 0;
      if (root.streakLen && typeof root.streakLen === "object") {
        Object.keys(root.streakLen).forEach(function (qid) {
          var len = Number(root.streakLen[qid]);
          if (!Number.isFinite(len)) {
            return;
          }
          var streak3TotalForQid = 0;
          if (root.streak3 && Object.prototype.hasOwnProperty.call(root.streak3, qid)) {
            streak3TotalForQid = Number(root.streak3[qid]);
            if (!Number.isFinite(streak3TotalForQid)) {
              streak3TotalForQid = 0;
            }
          }
          // すでに 3連続正解（★獲得済み）の問題はどちらのカウントからも除外
          if (streak3TotalForQid > 0) {
            return;
          }
          // 連続正解数が 2 → リーチ⚡️
          if (len === 2) {
            reachCount += 1;
            return;
          }
          // 連続正解数が 1 → あと1回でリーチ✨
          if (len === 1) {
            preReachCount += 1;
            return;
          }
        });
      }

      // 計算結果をモジュール内グローバルに保存
      starFieldCounts = counts;
      starTotalSolvedQuestions = totalStarQ;
      starRemainingDays = remainingDays;
      starTargetPerDay = targetPerDay;
      starReachCountFromSync = reachCount;
      starPreReachCountFromSync = preReachCount;
      unsolvedCountFromSync = unsolved;
      unansweredCountFromSync = unanswered;

      console.log("field_summary.js: SYNC-based unsolved/unanswered computed", {
        TOTAL_Q: TOTAL_Q,
        totalStarQ: totalStarQ,
        remainingDays: remainingDays,
        targetPerDay: targetPerDay,
        everCorrectCount: everCorrectCount,
        appearedCount: appearedCount,
        unsolvedCountFromSync: unsolvedCountFromSync,
        unansweredCountFromSync: unansweredCountFromSync,
        starReachCountFromSync: starReachCountFromSync,
        starPreReachCountFromSync: starPreReachCountFromSync
      });

      console.log("field_summary.js: SYNC-based reach counts computed", {
        reachCount_2chain: starReachCountFromSync,
        preReachCount_1chain: starPreReachCountFromSync
      });

      return counts;
    } catch (e) {
      console.error("field_summary.js: SYNC 読み込み失敗", e);
      return null;
    }
  }

  // =========================
  // 5. モジュール内で共有する状態変数
  // =========================
  var fieldNames = null;               // 分野名一覧
  var fieldTotals = null;              // 分野別の総問題数
  var qidToField = null;               // qid→Field
  var qidToQuestion = null;            // qid→問題文（ローカルステージのメタ情報由来）
  var qidToTheme = null;               // qid→テーマ（分野内ソート用）
  var qidToLevel = null;               // qid→レベル（分野内ソート用）
  var starFieldCounts = null;          // 分野別の「★獲得済み問題数」
  var starTotalSolvedQuestions = 0;    // 全体で★済みの問題数
  var starRemainingDays = 0;           // 締切までの残り日数
  var starTargetPerDay = 0;            // 1日あたりの目標★数（SYNCから計算）
  var starReachCountFromSync = 0;      // 2連続正解の「リーチ⚡️」問題数（SYNCから取得）
  var starPreReachCountFromSync = 0;   // 1連続正解中（次の正解で⚡️になる）問題数（SYNCから取得）

  // SYNC (/api/sync/state) をソースとした「未正解/未回答」の集計結果
  var unsolvedCountFromSync = 0;       // SYNC上での「未正解問題数」
  var unansweredCountFromSync = 0;     // SYNC上での「未回答問題数」

  // CSCS 全体の総問題数
  // - 通常は SYNC の root.global.totalQuestions を採用
  // - 取得できなかった場合のみ DUMMY_TOTAL を暫定使用
  var totalQuestionsGlobal = DUMMY_TOTAL;

  // SYNC状態から取得した正解・不正解・連続正解マップ（最終正誤結果 / 連続回数 / 3連続達成回数 / 最終日情報の表示用）
  var syncCorrectMap = null;           // state.correct の生データ参照
  var syncIncorrectMap = null;         // state.incorrect の生データ参照
  var syncStreakLenMap = null;         // state.streakLen の生データ参照
  var syncStreak3Map = null;           // state.streak3 の生データ参照（⭐️累計）
  var syncStreak3WrongMap = null;      // state.streak3Wrong の生データ参照（💣累計）
  var syncLastSeenDayMap = null;       // state.lastSeenDay の生データ参照
  var syncLastCorrectDayMap = null;    // state.lastCorrectDay の生データ参照
  var syncLastWrongDayMap = null;      // state.lastWrongDay の生データ参照

  // シンプルなテキストゲージ（［■■■□□□□□□］）を生成するヘルパー
  function makeProgressBar(percent, segments) {
    var seg = (segments && Number.isFinite(segments)) ? segments : 10;
    if (seg <= 0) {
      seg = 10;
    }

    var p = Number(percent);
    if (!Number.isFinite(p) || p < 0) {
      p = 0;
    }
    if (p > 100) {
      p = 100;
    }

    var filled = Math.round((p / 100) * seg);
    if (filled < 0) filled = 0;
    if (filled > seg) filled = seg;

    var empty = seg - filled;
    var filledChar = "■";
    var emptyChar = "□";

    var bar = "［" + filledChar.repeat(filled) + emptyChar.repeat(empty) + "］";
    return bar;
  }

  // ある Field について
  //   total: 総問題数（metaから）
  //   star : ★獲得済み問題数（SYNCから）
  // をセットにして返す
  function makeStats(name) {
    var total = 0;
    if (fieldTotals && Object.prototype.hasOwnProperty.call(fieldTotals, name)) {
      total = Number(fieldTotals[name]) || 0;
    }
    var star = 0;
    if (starFieldCounts && Object.prototype.hasOwnProperty.call(starFieldCounts, name)) {
      star = Number(starFieldCounts[name]) || 0;
    }
    return { field: name, star: star, total: total };
  }
  
  // qid(YYYYMMDD-NNN) から問題文を取得するヘルパー
  //  - cscs_meta_all.json → normalizeMetaForFields() → qidToQuestion に保存された内容を参照
  //  - 見つからなければ空文字を返す
  function getQuestionTextForQid(qid) {
    try {
      var map = qidToQuestion;
      if (!map || typeof map !== "object") {
        return "";
      }
      var text = map[String(qid)] || "";
      if (text == null) {
        text = "";
      }
      return String(text);
    } catch (e) {
      console.error("field_summary.js: getQuestionTextForQid error", e);
      return "";
    }
  }

  // qid(YYYYMMDD-NNN) からテーマを取得するヘルパー
  //  - meta 正規化時に作った qidToTheme から参照し、見つからなければ空文字を返す
  function getThemeForQid(qid) {
    try {
      var map = qidToTheme;
      if (!map || typeof map !== "object") {
        return "";
      }
      var text = map[String(qid)] || "";
      if (text == null) {
        text = "";
      }
      return String(text);
    } catch (e) {
      console.error("field_summary.js: getThemeForQid error", e);
      return "";
    }
  }

  // qid(YYYYMMDD-NNN) からレベルを取得するヘルパー
  //  - meta 正規化時に作った qidToLevel から参照し、見つからなければ空文字を返す
  function getLevelForQid(qid) {
    try {
      var map = qidToLevel;
      if (!map || typeof map !== "object") {
        return "";
      }
      var text = map[String(qid)] || "";
      if (text == null) {
        text = "";
      }
      return String(text);
    } catch (e) {
      console.error("field_summary.js: getLevelForQid error", e);
      return "";
    }
  }

  // qid(YYYYMMDD-NNN) から「最終正誤結果」と「現在の連続正解回数」を取得するヘルパー
  //  - state.correct / state.incorrect / state.streakLen をもとに決定し、解答履歴が無ければ空を返す
  function getLastResultInfoForQid(qid) {
    // 結果が存在しない場合にも、呼び出し側で扱いやすい固定フォーマットで返す
    var info = {
      symbol: "",
      text: "",
      streak: 0
    };

    try {
      if (!syncCorrectMap && !syncIncorrectMap && !syncStreakLenMap) {
        return info;
      }

      var key = String(qid);

      // state.correct / state.incorrect から合計回数を取り出すユーティリティ
      function extractTotal(v) {
        if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "total")) {
          var t = Number(v.total);
          return Number.isFinite(t) && t > 0 ? t : 0;
        }
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }

      var correctEntry = syncCorrectMap && Object.prototype.hasOwnProperty.call(syncCorrectMap, key)
        ? syncCorrectMap[key]
        : null;
      var incorrectEntry = syncIncorrectMap && Object.prototype.hasOwnProperty.call(syncIncorrectMap, key)
        ? syncIncorrectMap[key]
        : null;

      var correctTotal = extractTotal(correctEntry);
      var incorrectTotal = extractTotal(incorrectEntry);

      // 一度も解答履歴が無い場合は空のまま返す
      if (correctTotal === 0 && incorrectTotal === 0) {
        return info;
      }

      var streakLen = 0;
      if (syncStreakLenMap && Object.prototype.hasOwnProperty.call(syncStreakLenMap, key)) {
        var rawStreak = Number(syncStreakLenMap[key]);
        if (Number.isFinite(rawStreak) && rawStreak > 0) {
          streakLen = rawStreak;
        }
      }

      // 連続正解回数が 1 以上であれば、直近は必ず「正解」となる
      if (streakLen > 0) {
        info.symbol = "○";
        info.text = "正解";
        info.streak = streakLen;
        return info;
      }

      // 正解ストリークが 0 で、かつ不正解履歴が存在する場合は「直近が不正解」とみなす
      if (incorrectTotal > 0) {
        info.symbol = "×";
        info.text = "不正解";
        info.streak = 0;  // ここでは「連続正解回数」を扱うため、不正解時は 0 としておく
        return info;
      }

      // 上記いずれにも当てはまらない場合（不整合ケース）は記号のみ空のまま返す
      return info;
    } catch (e) {
      console.error("field_summary.js: getLastResultInfoForQid error", e);
      return info;
    }
  }

  // 分野別の進捗リスト（後で一度だけ計算してキャッシュ）
  var dummyFieldStats = null;

  // =========================
  // 6. 今日の 3連続正解ユニーク数（streak3Today）を SYNC から読む
  // =========================
  var starTodayCount = 0;

  async function loadTodayStreak3CountFromSync() {
    try {
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("field_summary.js: SYNC streak3Today GET失敗:", res.status);
        return 0;
      }
      var json = await res.json();
      var root = json.data || json;

      if (!root.streak3Today || typeof root.streak3Today !== "object") {
        console.warn("field_summary.js: SYNC に streak3Today がありません");
        return 0;
      }

      var u = Number(root.streak3Today.unique_count);
      if (!Number.isFinite(u) || u < 0) {
        u = 0;
      }

      console.log("field_summary.js: SYNC streak3Today.unique_count 読み取り成功:", {
        day: root.streak3Today.day,
        unique_count: u
      });

      return u;
    } catch (e) {
      console.error("field_summary.js: streak3Today SYNC 読み取り中に例外:", e);
      return 0;
    }
  }

  // 旧ダミー計算（現状ほぼ使っていないが変数だけ残っている）
  var remainStar = DUMMY_TOTAL - DUMMY_STAR_DONE;
  var needPerDay = Math.ceil(remainStar / DUMMY_DAYS_LEFT);

  // =========================
  // 7. メイン：分野別★サマリーを画面に描画
  // =========================
  async function renderFieldStarSummary() {
    // このタイミングでスタイルを一度だけ注入
    injectFieldSummaryStyles();

    // A/Bパートのメインコンテナ（.wrap）の直後に挿入する前提
    var wrapContainer = document.querySelector(".wrap");
    if (!wrapContainer) {
      console.warn(".wrap が見つからないため field_summary を表示できませんでした。");
      return;
    }

    // すでに表示済みなら二重生成しない
    if (document.getElementById("cscs-field-star-summary")) return;

    // まだ Field 名一覧を取得していなければ、メタJSONからロード
    if (!fieldNames) {
      fieldNames = await loadFieldNamesFromMetaStrict();
      if (!fieldNames || !Array.isArray(fieldNames) || !fieldNames.length) {
        // メタ取得に失敗した場合のエラーパネル
        var errorPanel = document.createElement("div");
        errorPanel.id = "cscs-field-star-summary";
        errorPanel.textContent = "field_summary: /assets/cscs_meta_all.json から分野一覧を取得できませんでした。";
        errorPanel.style.fontSize = "11px";
        errorPanel.style.opacity = "0.7";
        wrapContainer.insertAdjacentElement("afterend", errorPanel);
        return;
      }
    }

    // まだ streak3 の分野別集計が終わっていなければ SYNC からロード
    if (!starFieldCounts) {
      var counts = await loadStarFieldCountsStrict();
      if (!counts) {
        var errorPanelSync = document.createElement("div");
        errorPanelSync.id = "cscs-field-star-summary";
        errorPanelSync.textContent = "field_summary: /api/sync/state から streak3 を取得できませんでした。";
        errorPanelSync.style.fontSize = "11px";
        errorPanelSync.style.opacity = "0.7";
        wrapContainer.insertAdjacentElement("afterend", errorPanelSync);
        return;
      }
    }

    // 分野ごとの stats 配列を一度だけ作る
    if (!dummyFieldStats) {
      dummyFieldStats = fieldNames.map(makeStats);
    }

    // パネル本体のコンテナ
    var panel = document.createElement("div");
    panel.id = "cscs-field-star-summary";

    // 1日あたりのベース目標（30問ぐらいを基準にしている）
    var basePerDay = 30;
    var diff = needPerDay - basePerDay;
    var mood = "";
    // diff に応じて「余裕 / 順調 / 巻き返し / 要注意」の4段階を決める（現状はテキストに未反映）
    if (needPerDay <= basePerDay * 0.8) {
      mood = "余裕";
    } else if (needPerDay <= basePerDay * 1.1) {
      mood = "順調";
    } else if (needPerDay <= basePerDay * 1.4) {
      mood = "巻き返し";
    } else {
      mood = "要注意";
    }

    // 上部に表示する「⭐️本日の目標〜」行を構築
    var needLine = document.createElement("div");

    // SYNCから計算された「本日の目標（★何個/日）」を使用
    var targetNum = Number(starTargetPerDay);
    if (!Number.isFinite(targetNum) || targetNum < 0) {
      targetNum = 0;
    }

    // 今日の 3連続正解ユニーク数を SYNC から読み込む
    starTodayCount = await loadTodayStreak3CountFromSync();

    // 今日の達成率（本日の獲得数 / 本日の目標数）
    var todayPercent = 0;
    if (targetNum > 0) {
      todayPercent = Math.floor((starTodayCount / targetNum) * 100);
      if (!Number.isFinite(todayPercent) || todayPercent < 0) {
        todayPercent = 0;
      }
      if (todayPercent > 100) {
        todayPercent = 100;
      }
    }

    // 全体の達成率（★獲得済み問題数 / 全体問題数）
    var totalPercent = 0;
    var totalQuestions = Number(totalQuestionsGlobal || 0);
    if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) {
      totalQuestions = 0;
    }
    if (totalQuestions > 0) {
      totalPercent = ((starTotalSolvedQuestions / totalQuestions) * 100);
      if (!Number.isFinite(totalPercent) || totalPercent < 0) {
        totalPercent = 0;
      }
      if (totalPercent > 100) {
        totalPercent = 100;
      }
      totalPercent = Number(totalPercent.toFixed(2));
    }

    // コンパクトな進捗行を構築（CSSミニバー付き）
    needLine.className = "cscs-star-summary-line-compact";

    var moodText = mood || "順調";
    var html = "";

    // SYNC から計算された「リーチ⚡️（2連続正解）」の問題数
    var reachCount = Number(starReachCountFromSync || 0);
    if (!Number.isFinite(reachCount) || reachCount < 0) {
      reachCount = 0;
    }

    // SYNC から計算された「あと1回でリーチ✨（1連続正解中）」の問題数
    var preReachCount = Number(starPreReachCountFromSync || 0);
    if (!Number.isFinite(preReachCount) || preReachCount < 0) {
      preReachCount = 0;
    }

    // ⭐️本日の目標 21個（リーチ⚡️2個 ✨1個）
    html += "<span class=\"cscs-star-main-compact\">";
    html += "⭐️本日目標 " + String(targetNum) + "個";
    html += "<span class=\"cscs-star-main\">／リーチ⚡️" + String(reachCount) + "個／連続✨" + String(preReachCount) + "個／</span>";
    html += "</span>";

    // 本日の獲得 +4：15%
    html += "<span class=\"cscs-star-section-compact\">";
    html += "本日獲得 +" + String(starTodayCount) + "：";
    html += "<span class=\"cscs-star-percent\">" + String(todayPercent) + "%</span>";
    html += "<span class=\"cscs-star-meter\">";
    html += "<span class=\"cscs-star-meter-fill\" style=\"width:" + String(todayPercent) + "%;\"></span>";
    html += "</span>";
    html += "</span>";

    // 総進捗：0.07%（状況:余裕）
    html += "<span class=\"cscs-star-section-compact\">";
    html += "／総進捗：";
    html += "<span class=\"cscs-star-percent\">" + totalPercent.toFixed(2) + "%</span>";
    html += "<span class=\"cscs-star-mood\">(状況:" + moodText + ")</span>";
    html += "<span class=\"cscs-star-meter\">";
    html += "<span class=\"cscs-star-meter-fill cscs-star-meter-fill-total\" style=\"width:" + totalPercent.toFixed(2) + "%;\"></span>";
    html += "</span>";
    html += "</span>";

    needLine.innerHTML = html;

    needLine.style.marginBottom = "10px";
    needLine.style.marginLeft = "-8px";
    needLine.style.fontWeight = "500";
    needLine.style.fontSize = "15px";
    panel.appendChild(needLine);

    // コンソールに現在の目標値と進捗・リーチ数・✨数を出力して、値とレンダリング結果を確認できるようにする
    console.log("field_summary.js: compact star summary rendered", {
      targetNum: targetNum,
      starTodayCount: starTodayCount,
      todayPercent: todayPercent,
      totalPercent: totalPercent,
      moodText: moodText,
      starReachCountFromSync: starReachCountFromSync,
      starPreReachCountFromSync: starPreReachCountFromSync,
      reachCountUsedForView: reachCount,
      preReachCountUsedForView: preReachCount
    });

    // 分野別の一覧を <ul> として作成
    // あわせて「分野名クリック時に qid 一覧をインライン表示するコンテナ」も用意する

    // qidToField を使って、指定の Field に属する qid 一覧を取得するヘルパー
    function getQidsForFieldInline(fieldName) {
      var result = [];
      if (!qidToField || typeof qidToField !== "object") {
        return result;
      }
      var keys = Object.keys(qidToField);
      for (var i = 0; i < keys.length; i++) {
        var qid = keys[i];
        if (qidToField[qid] === fieldName) {
          result.push(qid);
        }
      }
      result.sort();
      return result;
    }

    var list = document.createElement("ul");
    list.style.listStyleType = "disc";
    list.style.listStylePosition = "outside";
    list.style.margin = "0";
    list.style.padding = "0";

    // 3カラムグリッドで並べる
    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(3, 1fr)";
    list.style.columnGap = "0";
    list.style.rowGap = "2px";

    // 分野名クリック時の qid 一覧表示用コンテナ
    var qidInlineBox = document.createElement("div");
    qidInlineBox.id = "cscs-field-qid-inline";
    qidInlineBox.style.marginTop = "10px";
    qidInlineBox.style.paddingTop = "6px";
    qidInlineBox.style.borderTop = "1px solid rgba(255,255,255,0.18)";
    qidInlineBox.style.fontSize = "11px";
    qidInlineBox.style.lineHeight = "1.4";
    qidInlineBox.style.opacity = "0.85";

    // 各 Field ごとに1行（ラベル + 小さな横棒グラフ）を描画
    dummyFieldStats.forEach(function (row) {
      // その分野の★達成率（0〜100%）
      var rate = (row.total > 0)
        ? ((row.star / row.total) * 100).toFixed(0)
        : "0";

      var item = document.createElement("li");

      // 100%達成している Field は少し見た目を変える（インデント調整など）
      var isPerfect = (rate === "100");

      if (isPerfect) {
        item.style.listStyleType = "none";
        item.style.textIndent = "-1.5em";
        item.style.paddingLeft = "0px";
        item.style.justifySelf = "start";
        item.style.margin = "0px 0px 6px";
      } else {
        item.style.listStyleType = "none";
        item.style.paddingLeft = "0";
        item.style.textIndent = "0";
        item.style.margin = "0 0 6px 0";
      }

      // 一度だけ、全 Field のうち 100% 達成している分野をリストアップして
      // その中からランダムで1つだけ「🌟」として特別扱いする
      if (!window.__cscsStarListPrepared__) {
        window.__cscsStarListPrepared__ = true;
        window.__cscsPerfectFields__ = dummyFieldStats
          .filter(function (r) { return ((r.star / r.total) * 100).toFixed(0) === "100"; })
          .map(function (r) { return r.field; });
        window.__cscsPerfectFields__ = window.__cscsPerfectFields__.slice(0, 4);
        if (window.__cscsPerfectFields__.length > 0) {
          var randomIndex = Math.floor(Math.random() * window.__cscsPerfectFields__.length);
          window.__cscsPerfectSpecial__ = window.__cscsPerfectFields__[randomIndex];
        } else {
          window.__cscsPerfectSpecial__ = null;
        }
      }

      // 100%達成 Field の先頭に付けるマーク
      // ・普通の満点Field → "⭐️"
      // ・ランダムで選ばれた1つ → "🌟"
      var headMark;
      if (((row.star / row.total) * 100).toFixed(0) === "100") {
        if (row.field === window.__cscsPerfectSpecial__) {
          headMark = "🌟";
        } else {
          headMark = "⭐️";
        }
      } else {
        headMark = "";
      }

      // 分野名＋進捗テキストラベル
      var label = document.createElement("div");
      label.textContent =
        headMark +
        row.field +
        ": " +
        row.star + " / " + row.total +
        "(" + rate + "%)";

      // 分野名クリックで qid 一覧をパネル最下部にインライン表示（テーブル＋30件ずつ）
      label.style.cursor = "pointer";
      label.addEventListener("click", function () {
        try {
          var name = row.field;
          var qids = getQidsForFieldInline(name) || [];

          // すでにこの分野を開いていた場合はトグルで閉じる
          if (
            qidInlineBox.dataset.currentField &&
            qidInlineBox.dataset.currentField === name
          ) {
            qidInlineBox.innerHTML = "";
            qidInlineBox.dataset.currentField = "";
            return;
          }

          // 別の分野を開くので中身をリセット
          qidInlineBox.innerHTML = "";
          qidInlineBox.dataset.currentField = name;

          // 見出し（右端に［閉じる］を追加）
          var heading = document.createElement("div");
          heading.style.display = "flex";
          heading.style.justifyContent = "space-between";
          heading.style.alignItems = "center";
          heading.style.marginBottom = "4px";
          heading.style.fontWeight = "600";
          heading.style.fontSize = "11px";
          heading.style.opacity = "0.95";

          var titleSpan = document.createElement("span");
          titleSpan.textContent =
            "▶ " + name + " の qid 一覧（" + String(qids.length) + "問）";

          var closeBtn = document.createElement("span");
          closeBtn.textContent = "[閉じる]";
          closeBtn.style.cursor = "pointer";
          closeBtn.style.opacity = "0.8";
          closeBtn.style.marginLeft = "8px";
          closeBtn.onclick = function () {
            qidInlineBox.innerHTML = "";
            qidInlineBox.dataset.currentField = "";
          };

          heading.appendChild(titleSpan);
          heading.appendChild(closeBtn);
          qidInlineBox.appendChild(heading);

          if (!qids.length) {
            var empty = document.createElement("div");
            empty.textContent = "対象の qid は 0 件です。";
            empty.style.fontSize = "11px";
            empty.style.opacity = "0.8";
            qidInlineBox.appendChild(empty);
            return;
          }

          // 一覧本体コンテナ
          var body = document.createElement("div");
          body.style.fontSize = "11px";
          body.style.whiteSpace = "normal";
          body.style.wordBreak = "normal";
          body.style.marginTop = "4px";

          // ▼ テーマ一覧バー
          // 分野内に存在するテーマをユニークに抽出し、見出し直下にインラインで並べる
          var themeBar = document.createElement("div");
          themeBar.className = "cscs-field-theme-bar";

          var themeLabel = document.createElement("span");
          themeLabel.textContent = "テーマ:";
          themeLabel.className = "cscs-field-theme-label";
          themeBar.appendChild(themeLabel);

          var themeList = document.createElement("span");
          themeList.className = "cscs-field-theme-list";

          // フィールド内の qid からテーマをユニーク抽出
          var themeSet = new Set();
          for (var iTheme = 0; iTheme < qids.length; iTheme++) {
            var qidTheme = getThemeForQid(qids[iTheme]);
            if (qidTheme && typeof qidTheme === "string") {
              var trimmed = qidTheme.trim();
              if (trimmed) {
                themeSet.add(trimmed);
              }
            }
          }
          var themeArray = Array.from(themeSet).sort(function (a, b) {
            return a.localeCompare(b, "ja");
          });

          // 各テーマをクリック可能なピルとして追加（クリックでそのテーマのみを一覧表示）
          themeArray.forEach(function (themeName) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.textContent = themeName;
            pill.className = "cscs-field-theme-pill";
            pill.dataset.themeName = themeName;
            themeList.appendChild(pill);
          });

          themeBar.appendChild(themeList);
          qidInlineBox.appendChild(themeBar);

          // ▼ ソート用コントロール（qid順 / レベル順の切り替え）
          var sortBox = document.createElement("div");
          sortBox.style.display = "flex";
          sortBox.style.justifyContent = "flex-end";
          sortBox.style.alignItems = "center";
          sortBox.style.gap = "6px";
          sortBox.style.marginBottom = "2px";

          var sortLabel = document.createElement("span");
          sortLabel.textContent = "ソート:";
          sortLabel.style.fontSize = "10px";
          sortLabel.style.opacity = "0.85";

          var sortSelect = document.createElement("select");
          sortSelect.style.fontSize = "10px";
          sortSelect.style.padding = "1px 4px";
          sortSelect.style.background = "#222";
          sortSelect.style.color = "#fff";
          sortSelect.style.border = "1px solid #444";
          sortSelect.style.borderRadius = "4px";
          sortSelect.style.cursor = "pointer";

          var optQid = document.createElement("option");
          optQid.value = "qid";
          optQid.textContent = "qid順";

          var optLevel = document.createElement("option");
          optLevel.value = "level";
          optLevel.textContent = "レベル順";

          sortSelect.appendChild(optQid);
          sortSelect.appendChild(optLevel);
          sortSelect.value = "qid";

          sortBox.appendChild(sortLabel);
          sortBox.appendChild(sortSelect);
          body.appendChild(sortBox);

          // テーブル本体の作成（テーマ列は持たせず、qid / レベル / 問題文のみ表示）
          var table = document.createElement("table");
          table.style.width = "100%";
          table.style.borderCollapse = "collapse";
          table.style.borderSpacing = "0";
          table.style.color = "#fff";

          var thead = document.createElement("thead");
          var headTr = document.createElement("tr");

          var thQid = document.createElement("th");
          thQid.textContent = "qid";
          thQid.style.textAlign = "left";
          thQid.style.fontWeight = "600";
          thQid.style.fontSize = "11px";
          thQid.style.padding = "2px 4px";
          thQid.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thQid.style.whiteSpace = "nowrap";

          var thLevel = document.createElement("th");
          thLevel.textContent = "レベル";
          thLevel.style.textAlign = "left";
          thLevel.style.fontWeight = "600";
          thLevel.style.fontSize = "11px";
          thLevel.style.padding = "2px 4px";
          thLevel.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thLevel.style.whiteSpace = "nowrap";

          var thQuestion = document.createElement("th");
          thQuestion.textContent = "問題文";
          thQuestion.style.textAlign = "left";
          thQuestion.style.fontWeight = "600";
          thQuestion.style.fontSize = "11px";
          thQuestion.style.padding = "2px 4px";
          thQuestion.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";

          var thLast = document.createElement("th");
          thLast.textContent = "最終";
          thLast.style.textAlign = "left";
          thLast.style.fontWeight = "600";
          thLast.style.fontSize = "11px";
          thLast.style.padding = "2px 4px";
          thLast.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thLast.style.whiteSpace = "nowrap";

          var thStreak = document.createElement("th");
          thStreak.textContent = "連続";
          thStreak.style.textAlign = "left";
          thStreak.style.fontWeight = "600";
          thStreak.style.fontSize = "11px";
          thStreak.style.padding = "2px 4px";
          thStreak.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thStreak.style.whiteSpace = "nowrap";

          var thStar = document.createElement("th");
          thStar.textContent = "⭐️";
          thStar.style.textAlign = "left";
          thStar.style.fontWeight = "600";
          thStar.style.fontSize = "11px";
          thStar.style.padding = "2px 4px";
          thStar.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thStar.style.whiteSpace = "nowrap";
          thStar.title = "3連続正解（⭐️）の累計獲得数";

          var thBomb = document.createElement("th");
          thBomb.textContent = "💣";
          thBomb.style.textAlign = "left";
          thBomb.style.fontWeight = "600";
          thBomb.style.fontSize = "11px";
          thBomb.style.padding = "2px 4px";
          thBomb.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thBomb.style.whiteSpace = "nowrap";
          thBomb.title = "3連続不正解（💣）の累計獲得数";

          var thTotalCorrect = document.createElement("th");
          thTotalCorrect.textContent = "正解累計";
          thTotalCorrect.style.textAlign = "left";
          thTotalCorrect.style.fontWeight = "600";
          thTotalCorrect.style.fontSize = "11px";
          thTotalCorrect.style.padding = "2px 4px";
          thTotalCorrect.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thTotalCorrect.style.whiteSpace = "nowrap";
          thTotalCorrect.title = "state.correct[qid] の累計 total";

          var thTotalWrong = document.createElement("th");
          thTotalWrong.textContent = "誤答累計";
          thTotalWrong.style.textAlign = "left";
          thTotalWrong.style.fontWeight = "600";
          thTotalWrong.style.fontSize = "11px";
          thTotalWrong.style.padding = "2px 4px";
          thTotalWrong.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thTotalWrong.style.whiteSpace = "nowrap";
          thTotalWrong.title = "state.incorrect[qid] の累計 total";

          var thLastCorrect = document.createElement("th");
          thLastCorrect.textContent = "最終正解";
          thLastCorrect.style.textAlign = "left";
          thLastCorrect.style.fontWeight = "600";
          thLastCorrect.style.fontSize = "11px";
          thLastCorrect.style.padding = "2px 4px";
          thLastCorrect.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thLastCorrect.style.whiteSpace = "nowrap";
          thLastCorrect.title = "state.lastCorrectDay[qid]";

          var thLastWrong = document.createElement("th");
          thLastWrong.textContent = "最終誤答";
          thLastWrong.style.textAlign = "left";
          thLastWrong.style.fontWeight = "600";
          thLastWrong.style.fontSize = "11px";
          thLastWrong.style.padding = "2px 4px";
          thLastWrong.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
          thLastWrong.style.whiteSpace = "nowrap";
          thLastWrong.title = "state.lastWrongDay[qid]";

          // カラム順:
          // qid / レベル / 問題文 / 最終 / 連続 / ⭐️ / 💣 / 正解累計 / 誤答累計 / 最終正解 / 最終誤答
          headTr.appendChild(thQid);
          headTr.appendChild(thLevel);
          headTr.appendChild(thQuestion);
          headTr.appendChild(thLast);
          headTr.appendChild(thStreak);
          headTr.appendChild(thStar);
          headTr.appendChild(thBomb);
          headTr.appendChild(thTotalCorrect);
          headTr.appendChild(thTotalWrong);
          headTr.appendChild(thLastCorrect);
          headTr.appendChild(thLastWrong);
          thead.appendChild(headTr);

          var tbody = document.createElement("tbody");

          table.appendChild(thead);
          table.appendChild(tbody);
          body.appendChild(table);

          // ページングUI（30件ずつ）
          var pager = document.createElement("div");
          pager.style.marginTop = "4px";
          pager.style.display = "flex";
          pager.style.justifyContent = "center";
          pager.style.alignItems = "center";
          pager.style.gap = "8px";

          var prevBtn = document.createElement("button");
          prevBtn.type = "button";
          prevBtn.textContent = "◀ 前の30件";
          prevBtn.style.fontSize = "10px";
          prevBtn.style.padding = "2px 6px";
          prevBtn.style.background = "#222";
          prevBtn.style.color = "#fff";
          prevBtn.style.border = "1px solid #444";
          prevBtn.style.borderRadius = "4px";
          prevBtn.style.cursor = "pointer";

          var pageInfo = document.createElement("span");
          pageInfo.style.fontSize = "10px";
          pageInfo.style.opacity = "0.85";

          var nextBtn = document.createElement("button");
          nextBtn.type = "button";
          nextBtn.textContent = "次の30件 ▶";
          nextBtn.style.fontSize = "10px";
          nextBtn.style.padding = "2px 6px";
          nextBtn.style.background = "#222";
          nextBtn.style.color = "#fff";
          nextBtn.style.border = "1px solid #444";
          nextBtn.style.borderRadius = "4px";
          nextBtn.style.cursor = "pointer";

          pager.appendChild(prevBtn);
          pager.appendChild(pageInfo);
          pager.appendChild(nextBtn);

          body.appendChild(pager);

          qidInlineBox.appendChild(body);

          // ▼ 一覧に対するページング・ソート・テーマフィルタ状態
          var pageSize = 30;
          var currentPage = 0;
          var totalPages = 1;
          var currentSortKey = "qid";        // "qid" / "level"
          var currentThemeFilter = "";       // 空文字列なら全テーマ対象
          var qidsAll = qids.slice();
          var qidsFiltered = qidsAll.slice();
          var qidsSorted = qidsFiltered.slice();

          // 1ページ分の行を描画する
          function renderPage(pageIndex) {
            if (pageIndex < 0) {
              pageIndex = 0;
            }
            if (pageIndex > totalPages - 1) {
              pageIndex = totalPages - 1;
            }
            currentPage = pageIndex;

            // tbody をクリア
            while (tbody.firstChild) {
              tbody.removeChild(tbody.firstChild);
            }

            var startIndex = currentPage * pageSize;
            var endIndex = Math.min(startIndex + pageSize, qidsSorted.length);

            for (var i = startIndex; i < endIndex; i++) {
              var qid = qidsSorted[i];
              var parts = String(qid).split("-");
              var day = parts[0];
              var n3 = parts[1];

              var tr = document.createElement("tr");

              // qid セル（リンク付き）
              var tdQid = document.createElement("td");
              tdQid.style.padding = "2px 4px";
              tdQid.style.verticalAlign = "top";
              tdQid.style.whiteSpace = "nowrap";
              tdQid.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";

              if (day && n3) {
                var a = document.createElement("a");
                a.href =
                  "/_build_cscs_" +
                  day +
                  "/slides/q" +
                  n3 +
                  "_a.html?nav=manual";
                a.textContent = qid;
                a.style.color = "#fff";
                a.style.textDecoration = "underline";
                a.style.cursor = "pointer";
                tdQid.appendChild(a);
              } else {
                tdQid.textContent = qid;
              }

              // 最終正誤セル（○ / ×）と連続正解回数セル
              var lastInfo = getLastResultInfoForQid(qid);

              var tdLast = document.createElement("td");
              tdLast.style.padding = "2px 4px";
              tdLast.style.verticalAlign = "top";
              tdLast.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdLast.style.whiteSpace = "nowrap";
              if (lastInfo.symbol) {
                tdLast.textContent = lastInfo.symbol;
              } else {
                tdLast.textContent = "";
              }
              if (lastInfo.text) {
                tdLast.title = lastInfo.text;
              }

              var tdStreak = document.createElement("td");
              tdStreak.style.padding = "2px 4px";
              tdStreak.style.verticalAlign = "top";
              tdStreak.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdStreak.style.whiteSpace = "nowrap";
              if (lastInfo.streak > 0) {
                tdStreak.textContent = String(lastInfo.streak);
              } else {
                tdStreak.textContent = "";
              }

              // ⭐️（3連続正解）累計セル
              var tdStar = document.createElement("td");
              tdStar.style.padding = "2px 4px";
              tdStar.style.verticalAlign = "top";
              tdStar.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdStar.style.whiteSpace = "nowrap";
              tdStar.style.textAlign = "right";

              var starCount = 0;
              var qidKey = String(qid);
              if (syncStreak3Map && Object.prototype.hasOwnProperty.call(syncStreak3Map, qidKey)) {
                var vStar = syncStreak3Map[qidKey];
                if (vStar && typeof vStar === "object" && Object.prototype.hasOwnProperty.call(vStar, "total")) {
                  var tStar = Number(vStar.total);
                  if (Number.isFinite(tStar) && tStar > 0) {
                    starCount = tStar;
                  }
                } else {
                  var nStar = Number(vStar);
                  if (Number.isFinite(nStar) && nStar > 0) {
                    starCount = nStar;
                  }
                }
              }
              if (starCount > 0) {
                tdStar.textContent = String(starCount);
              } else {
                tdStar.textContent = "";
              }

              // 💣（3連続不正解）累計セル
              var tdBomb = document.createElement("td");
              tdBomb.style.padding = "2px 4px";
              tdBomb.style.verticalAlign = "top";
              tdBomb.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdBomb.style.whiteSpace = "nowrap";
              tdBomb.style.textAlign = "right";

              var bombCount = 0;
              if (syncStreak3WrongMap && Object.prototype.hasOwnProperty.call(syncStreak3WrongMap, qidKey)) {
                var vBomb = syncStreak3WrongMap[qidKey];
                if (vBomb && typeof vBomb === "object" && Object.prototype.hasOwnProperty.call(vBomb, "total")) {
                  var tBomb = Number(vBomb.total);
                  if (Number.isFinite(tBomb) && tBomb > 0) {
                    bombCount = tBomb;
                  }
                } else {
                  var nBomb = Number(vBomb);
                  if (Number.isFinite(nBomb) && nBomb > 0) {
                    bombCount = nBomb;
                  }
                }
              }
              if (bombCount > 0) {
                tdBomb.textContent = String(bombCount);
              } else {
                tdBomb.textContent = "";
              }

              // 正解累計セル（state.correct[qid]）
              var tdTotalCorrect = document.createElement("td");
              tdTotalCorrect.style.padding = "2px 4px";
              tdTotalCorrect.style.verticalAlign = "top";
              tdTotalCorrect.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdTotalCorrect.style.whiteSpace = "nowrap";
              tdTotalCorrect.style.textAlign = "right";

              var totalCorrectCount = 0;
              if (syncCorrectMap && Object.prototype.hasOwnProperty.call(syncCorrectMap, qidKey)) {
                var vCorrect = syncCorrectMap[qidKey];
                if (vCorrect && typeof vCorrect === "object" && Object.prototype.hasOwnProperty.call(vCorrect, "total")) {
                  var tCorrect = Number(vCorrect.total);
                  if (Number.isFinite(tCorrect) && tCorrect > 0) {
                    totalCorrectCount = tCorrect;
                  }
                } else {
                  var nCorrect = Number(vCorrect);
                  if (Number.isFinite(nCorrect) && nCorrect > 0) {
                    totalCorrectCount = nCorrect;
                  }
                }
              }
              if (totalCorrectCount > 0) {
                tdTotalCorrect.textContent = String(totalCorrectCount);
              } else {
                tdTotalCorrect.textContent = "";
              }

              // 誤答累計セル（state.incorrect[qid]）
              var tdTotalWrong = document.createElement("td");
              tdTotalWrong.style.padding = "2px 4px";
              tdTotalWrong.style.verticalAlign = "top";
              tdTotalWrong.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdTotalWrong.style.whiteSpace = "nowrap";
              tdTotalWrong.style.textAlign = "right";

              var totalWrongCount = 0;
              if (syncIncorrectMap && Object.prototype.hasOwnProperty.call(syncIncorrectMap, qidKey)) {
                var vIncorrect = syncIncorrectMap[qidKey];
                if (vIncorrect && typeof vIncorrect === "object" && Object.prototype.hasOwnProperty.call(vIncorrect, "total")) {
                  var tIncorrect = Number(vIncorrect.total);
                  if (Number.isFinite(tIncorrect) && tIncorrect > 0) {
                    totalWrongCount = tIncorrect;
                  }
                } else {
                  var nIncorrect = Number(vIncorrect);
                  if (Number.isFinite(nIncorrect) && nIncorrect > 0) {
                    totalWrongCount = nIncorrect;
                  }
                }
              }
              if (totalWrongCount > 0) {
                tdTotalWrong.textContent = String(totalWrongCount);
              } else {
                tdTotalWrong.textContent = "";
              }

              // 最終正解日セル（state.lastCorrectDay[qid]）
              var tdLastCorrect = document.createElement("td");
              tdLastCorrect.style.padding = "2px 4px";
              tdLastCorrect.style.verticalAlign = "top";
              tdLastCorrect.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdLastCorrect.style.whiteSpace = "nowrap";

              var lastCorrectVal = "";
              if (syncLastCorrectDayMap && Object.prototype.hasOwnProperty.call(syncLastCorrectDayMap, qidKey)) {
                var rawCorrect = syncLastCorrectDayMap[qidKey];
                if (rawCorrect && typeof rawCorrect === "object" && Object.prototype.hasOwnProperty.call(rawCorrect, "day")) {
                  lastCorrectVal = String(rawCorrect.day || "");
                } else {
                  lastCorrectVal = String(rawCorrect == null ? "" : rawCorrect);
                }
              }
              tdLastCorrect.textContent = lastCorrectVal;

              // 最終誤答日セル（state.lastWrongDay[qid]）
              var tdLastWrong = document.createElement("td");
              tdLastWrong.style.padding = "2px 4px";
              tdLastWrong.style.verticalAlign = "top";
              tdLastWrong.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdLastWrong.style.whiteSpace = "nowrap";

              var lastWrongVal = "";
              if (syncLastWrongDayMap && Object.prototype.hasOwnProperty.call(syncLastWrongDayMap, qidKey)) {
                var rawWrong = syncLastWrongDayMap[qidKey];
                if (rawWrong && typeof rawWrong === "object" && Object.prototype.hasOwnProperty.call(rawWrong, "day")) {
                  lastWrongVal = String(rawWrong.day || "");
                } else {
                  lastWrongVal = String(rawWrong == null ? "" : rawWrong);
                }
              }
              tdLastWrong.textContent = lastWrongVal;

              // レベルセル
              var tdLevel = document.createElement("td");
              tdLevel.style.padding = "2px 4px";
              tdLevel.style.verticalAlign = "top";
              tdLevel.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdLevel.style.whiteSpace = "nowrap";
              var levelText = getLevelForQid(qid);
              if (!levelText) {
                levelText = "";
              }
              tdLevel.textContent = levelText;

              // 問題文セル
              var tdQuestion = document.createElement("td");
              tdQuestion.style.padding = "2px 4px";
              tdQuestion.style.verticalAlign = "top";
              tdQuestion.style.borderBottom = "1px solid rgba(255, 255, 255, 0.12)";
              tdQuestion.style.width = "100%";
              tdQuestion.style.wordBreak = "break-word";

              var qText = getQuestionTextForQid(qid);
              if (!qText) {
                qText = "";
              }
              tdQuestion.textContent = qText;

              // カラム順:
              // qid / レベル / 問題文 / 最終 / 連続 / ⭐️ / 💣 / 正解累計 / 誤答累計 / 最終正解 / 最終誤答
              tr.appendChild(tdQid);
              tr.appendChild(tdLevel);
              tr.appendChild(tdQuestion);
              tr.appendChild(tdLast);
              tr.appendChild(tdStreak);
              tr.appendChild(tdStar);
              tr.appendChild(tdBomb);
              tr.appendChild(tdTotalCorrect);
              tr.appendChild(tdTotalWrong);
              tr.appendChild(tdLastCorrect);
              tr.appendChild(tdLastWrong);
              tbody.appendChild(tr);
            }

            // ページ情報表示更新
            var startDisp = qidsSorted.length === 0 ? 0 : startIndex + 1;
            var endDisp = qidsSorted.length === 0 ? 0 : endIndex;
            pageInfo.textContent =
              "ページ " +
              String(currentPage + 1) +
              " / " +
              String(totalPages) +
              " （" +
              String(startDisp) +
              "〜" +
              String(endDisp) +
              "件）";

            // ボタン活性制御
            prevBtn.disabled = currentPage <= 0;
            nextBtn.disabled = currentPage >= totalPages - 1;
            prevBtn.style.opacity = prevBtn.disabled ? "0.4" : "1.0";
            nextBtn.style.opacity = nextBtn.disabled ? "0.4" : "1.0";
          }

          // ▼ テーマフィルタ＋ソートを適用して先頭ページを再描画する
          function applySortAndRender() {
            // テーマフィルタを適用（currentThemeFilter が空なら全件）
            qidsFiltered = qidsAll.filter(function (qid) {
              if (!currentThemeFilter) {
                return true;
              }
              var t = getThemeForQid(qid) || "";
              return t.trim() === currentThemeFilter;
            });

            // 現在のソートキーに応じて並べ替え
            qidsSorted = qidsFiltered.slice();
            qidsSorted.sort(function (a, b) {
              if (currentSortKey === "level") {
                var la = getLevelForQid(a);
                var lb = getLevelForQid(b);
                la = la || "";
                lb = lb || "";
                if (la !== lb) {
                  return la.localeCompare(lb, "ja");
                }
                return String(a).localeCompare(String(b));
              }
              // デフォルト: qid文字列で昇順ソート
              return String(a).localeCompare(String(b));
            });

            totalPages = Math.max(1, Math.ceil(qidsSorted.length / pageSize));
            renderPage(0);
          }

          // ▼ テーマピルの選択状態を更新する
          function updateThemePillActive() {
            var pills = themeList.querySelectorAll(".cscs-field-theme-pill");
            for (var i = 0; i < pills.length; i++) {
              var pill = pills[i];
              if (pill.dataset.themeName === currentThemeFilter) {
                pill.classList.add("cscs-field-theme-pill-active");
              } else {
                pill.classList.remove("cscs-field-theme-pill-active");
              }
            }
          }

          // テーマピルのクリックイベントを設定（クリックでテーマフィルタのON/OFF）
          var pillsAll = themeList.querySelectorAll(".cscs-field-theme-pill");
          for (var iPill = 0; iPill < pillsAll.length; iPill++) {
            (function (pill) {
              pill.addEventListener("click", function () {
                var themeName = pill.dataset.themeName || "";
                if (currentThemeFilter === themeName) {
                  // 同じテーマをもう一度クリックしたらフィルタ解除
                  currentThemeFilter = "";
                } else {
                  currentThemeFilter = themeName;
                }
                updateThemePillActive();
                applySortAndRender();
              });
            })(pillsAll[iPill]);
          }

          // ページングボタンのイベント
          prevBtn.addEventListener("click", function () {
            renderPage(currentPage - 1);
          });
          nextBtn.addEventListener("click", function () {
            renderPage(currentPage + 1);
          });

          // ソートセレクトの変更イベント
          sortSelect.addEventListener("change", function () {
            currentSortKey = sortSelect.value;
            applySortAndRender();
          });

          // 最初のソート＋ページ描画
          updateThemePillActive();
          applySortAndRender();

          console.log("field_summary.js: field qid list inline updated (table + paging + sort + theme filter)", {
            field: name,
            totalQids: qids.length,
            pageSize: pageSize,
            sortKey: currentSortKey,
            themeFilter: currentThemeFilter
          });

          console.log("field_summary.js: field qid list inline updated (table + paging)", {
            field: name,
            totalQids: qids.length,
            pageSize: pageSize,
            totalPages: totalPages
          });
        } catch (e) {
          console.error("field_summary.js: qid inline list update failed", e);
        }
      });

      // 横棒グラフの外枠（灰色）
      var barOuter = document.createElement("div");
      barOuter.style.marginTop = "1px";
      barOuter.style.width = "170px";
      barOuter.style.maxWidth = "170px";
      barOuter.style.height = "3px";
      barOuter.style.background = "rgba(255, 255, 255, 0.30)";
      barOuter.style.borderRadius = "999px";
      barOuter.style.overflow = "hidden";

      // 横棒グラフの中身（分野ゲージ用・黄色グラデーション、幅は rate%）
      var barInner = document.createElement("div");
      barInner.className = "cscs-field-bar-inner";
      barInner.style.width = rate + "%";

      barOuter.appendChild(barInner);

      item.appendChild(label);
      item.appendChild(barOuter);

      list.appendChild(item);
    });

    // =========================
    // 全問題2700件に対して：
    // ・未正解   = SYNC上で「正解0件 かつ 不正解1件以上」と判定された問題
    // ・未回答   = SYNC上で「正解0件 かつ 不正解0件」と判定された問題
    // =========================

    var unsolvedCount = Number(unsolvedCountFromSync || 0);
    if (!Number.isFinite(unsolvedCount) || unsolvedCount < 0) {
      unsolvedCount = 0;
    }
    var unansweredCount = Number(unansweredCountFromSync || 0);
    if (!Number.isFinite(unansweredCount) || unansweredCount < 0) {
      unansweredCount = 0;
    }

    var unansweredPercent = 0;
    var unsolvedPercent = 0;
    if (totalQuestions > 0) {
      unansweredPercent = (unansweredCount / totalQuestions) * 100;
      unsolvedPercent = (unsolvedCount / totalQuestions) * 100;
    }

    var unansweredPercentStr = unansweredPercent.toFixed(2);
    var unsolvedPercentStr = unsolvedPercent.toFixed(2);

    // グリッド末尾セル1: 未正解問題数 / 割合%（SYNCベース）
    var liUnsolved = document.createElement("li");
    liUnsolved.style.listStyleType = "none";
    liUnsolved.style.paddingLeft = "0";
    liUnsolved.style.textIndent = "0";
    liUnsolved.style.margin = "0 0 6px 0";
    liUnsolved.textContent =
      "未正解問題数(SYNC): " +
      unsolvedCount + " / " + totalQuestions +
      " (" + unsolvedPercentStr + "%)";
    list.appendChild(liUnsolved);

    // グリッド末尾セル2: 未回答問題数 / 割合%（SYNCベース）
    var liUnanswered = document.createElement("li");
    liUnanswered.style.listStyleType = "none";
    liUnanswered.style.paddingLeft = "0";
    liUnanswered.style.textIndent = "0";
    liUnanswered.style.margin = "0 0 6px 0";
    liUnanswered.textContent =
      "未回答問題数(SYNC): " +
      unansweredCount + " / " + totalQuestions +
      " (" + unansweredPercentStr + "%)";
    list.appendChild(liUnanswered);

    // ログ（SYNCベースのサマリ確認用）
    console.log("field_summary: unsolved/unanswered summary (from SYNC)", {
      totalQuestions: totalQuestions,
      unsolvedCount: unsolvedCount,
      unsolvedPercent: unsolvedPercent,
      unansweredCount: unansweredCount,
      unansweredPercent: unansweredPercent
    });

    // 分野ゲージ描画と末尾サマリセル追加の完了をログ出力
    console.log("field_summary.js: field list rendered with yellow gradient bars + extra summary cells", {
      fieldCount: dummyFieldStats.length,
      totalQuestions: totalQuestions,
      starTotalSolvedQuestions: starTotalSolvedQuestions,
      unsolvedCount: unsolvedCount,
      unsolvedPercent: unsolvedPercent
    });

    // パネルにリストを追加し、.wrap の直後に挿入
    panel.appendChild(list);
    panel.appendChild(qidInlineBox);
    wrapContainer.insertAdjacentElement("afterend", panel);
  }

  // Bパートで表示されたときに、1.5秒後に一度だけ field_summary を再計算・再描画する
  function scheduleBPageFieldSummaryRefresh() {
    var path = location.pathname || "";
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) {
      // Bパートでないページでは何もしない
      return;
    }

    console.log("field_summary.js: B-page detected, scheduling delayed refresh (500ms).");

    // ▼▼▼ ここが遅延時間（ms）。500 → 1000 にすると「1秒後」に実行される ▼▼▼
    setTimeout(function () {
      // 既存のフィールドサマリーパネルを削除してから、再描画する
      var panel = document.getElementById("cscs-field-star-summary");
      if (panel && panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }

      // SYNC由来の集計状態を一度リセットしてから、再度 /api/sync/state から読み直す
      starFieldCounts = null;
      starTotalSolvedQuestions = 0;
      starRemainingDays = 0;
      starTargetPerDay = 0;
      starReachCountFromSync = 0;
      if (typeof starPreReachCountFromSync !== "undefined") {
        starPreReachCountFromSync = 0;
      }
      unsolvedCountFromSync = 0;
      unansweredCountFromSync = 0;

      console.log("field_summary.js: B-page delayed refresh executing now (reloading SYNC state).");
      renderFieldStarSummary();
    }, 2000);  // ← ★ ここを 1000 に変更（1秒後に refresh）
  }

  // =========================
  // 8. DOM読み込み完了タイミングで実行
  // =========================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderFieldStarSummary();
      scheduleBPageFieldSummaryRefresh();
    });
  } else {
    renderFieldStarSummary();
    scheduleBPageFieldSummaryRefresh();
  }

})();