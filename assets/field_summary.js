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
        gap: 8px;
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
        min-width: 60px;
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
  //    ・qid(YYYYMMDD-NNN) → Field のマップ
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
      return { names: [], totals: {}, qidToField: {} };
    }

    // Field 名一覧（重複なし）
    var set = new Set();
    // Fieldごとの問題数
    var totals = Object.create(null);
    // qid → Field の対応表（streak3 のキーと結びつけるために必須）
    var qidMap = Object.create(null);

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

      // day と n3 が揃っていれば qid を作成し、Field を紐付ける
      if (day && n3) {
        var qid = day + "-" + n3;
        if (!qidMap[qid]) {
          qidMap[qid] = f;
        }
      }
    });

    return {
      // 分野名一覧
      names: Array.from(set),
      // 分野別の総問題数
      totals: totals,
      // 問題ID(qid)→分野名
      qidToField: qidMap
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

      //「2700問全てを★1回以上とる」ために必要な1日あたりの目標数を計算
      var targetPerDay = 0;
      var TOTAL_Q = 2700;
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
      // リーチ数（⚡️）を集計する：
      //   ・現時点で 3連続正解（★）はしていない
      //   ・現時点での連続正解数 streakLen[qid] がちょうど 2
      // =========================
      var reachCount = 0;
      if (root.streakLen && typeof root.streakLen === "object") {
        Object.keys(root.streakLen).forEach(function (qid) {
          var len = Number(root.streakLen[qid]);
          if (!Number.isFinite(len)) {
            return;
          }
          // 連続正解数が 2 以外はリーチ対象外
          if (len !== 2) {
            return;
          }
          // すでに 3連続正解（★獲得済み）の問題はリーチ対象外
          if (root.streak3 && Number(root.streak3[qid]) > 0) {
            return;
          }
          reachCount += 1;
        });
      }

      // 計算結果をモジュール内グローバルに保存
      starFieldCounts = counts;
      starTotalSolvedQuestions = totalStarQ;
      starRemainingDays = remainingDays;
      starTargetPerDay = targetPerDay;
      starReachCountFromSync = reachCount;
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
        starReachCountFromSync: starReachCountFromSync
      });

      console.log("field_summary.js: SYNC-based reach(2連続正解) computed", {
        starReachCountFromSync: starReachCountFromSync
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
  var starFieldCounts = null;          // 分野別の「★獲得済み問題数」
  var starTotalSolvedQuestions = 0;    // 全体で★済みの問題数
  var starRemainingDays = 0;           // 締切までの残り日数
  var starTargetPerDay = 0;            // 1日あたりの目標★数（SYNCから計算）
  var starReachCountFromSync = 0;      // 2連続正解の「リーチ⚡️」問題数（SYNCから取得）

  // SYNC (/api/sync/state) をソースとした「未正解/未回答」の集計結果
  var unsolvedCountFromSync = 0;       // SYNC上での「未正解問題数」
  var unansweredCountFromSync = 0;     // SYNC上での「未回答問題数」

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
    var totalQuestions = DUMMY_TOTAL;
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

    // ⭐️本日の目標数 21個（リーチ⚡️2個）
    html += "<span class=\"cscs-star-main-compact\">";
    html += "⭐️本日の目標数 " + String(targetNum) + "個";
    html += "<span class=\"cscs-star-mood\">（リーチ⚡️" + String(reachCount) + "個）</span>";
    html += "</span>";

    // 本日の獲得数 +4：15%
    html += "<span class=\"cscs-star-section-compact\">";
    html += "本日の獲得数 +" + String(starTodayCount) + "：";
    html += "<span class=\"cscs-star-percent\">" + String(todayPercent) + "%</span>";
    html += "<span class=\"cscs-star-meter\">";
    html += "<span class=\"cscs-star-meter-fill\" style=\"width:" + String(todayPercent) + "%;\"></span>";
    html += "</span>";
    html += "</span>";

    // 全体進捗：0.07%（基準比:余裕）
    html += "<span class=\"cscs-star-section-compact\">";
    html += "全体進捗：";
    html += "<span class=\"cscs-star-percent\">" + totalPercent.toFixed(2) + "%</span>";
    html += "<span class=\"cscs-star-mood\">（基準比:" + moodText + "）</span>";
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

    // コンソールに現在の目標値と進捗・リーチ数を出力して、値とレンダリング結果を確認できるようにする
    console.log("field_summary.js: compact star summary rendered", {
      targetNum: targetNum,
      starTodayCount: starTodayCount,
      todayPercent: todayPercent,
      totalPercent: totalPercent,
      moodText: moodText,
      starReachCountFromSync: starReachCountFromSync,
      reachCountUsedForView: reachCount
    });

    // 分野別の一覧を <ul> として作成
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
    wrapContainer.insertAdjacentElement("afterend", panel);
  }

  // =========================
  // 8. DOM読み込み完了タイミングで実行
  // =========================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFieldStarSummary);
  } else {
    renderFieldStarSummary();
  }

})();