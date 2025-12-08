/* correct_star.js — 3連続正解スター / 不正解ストリーク表示制御用スクリプト
 *
 * 【キー対応表（LocalStorage ⇔ SYNC state ⇔ delta payload）】
 *  ※このファイルで「新しくキーを追加／既存キー名を変更」した場合は、
 *    必ずこの表を更新すること（恒久ルール）。
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage: "cscs_q_correct_streak3_total:" + qid
 *       ⇔ SYNC state: streak3[qid]
 *       ⇔ delta payload: streak3Delta[qid]
 *
 * ▼ 問題別「現在の連続正解数」（✨/⚡️ 用）
 *   - localStorage: "cscs_q_correct_streak_len:" + qid
 *       ⇔ SYNC state: streakLen[qid]
 *       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ 問題別 3 連続不正解（🛠️用）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *
 * ▼ 問題別「現在の連続不正解数」（🔧/🔨/🛠️ 用）
 *   - localStorage: "cscs_q_wrong_streak_len:" + qid
 *       ⇔ SYNC state: streakWrongLen[qid]
 *       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ oncePerDayToday（1日1回まで計測の本日正誤）
 *   - localStorage: "cscs_once_per_day_today_day"
 *       ⇔ SYNC state: oncePerDayToday.day
 *       ⇔ delta payload: oncePerDayTodayDelta.day
 *   - localStorage: "cscs_once_per_day_today_results"
 *       ⇔ SYNC state: oncePerDayToday.results[qid]
 *       ⇔ delta payload: oncePerDayTodayDelta.results[qid]
 *
 * 役割：
 * - 現在表示中の問題の qid を取得する
 * - localStorage の 3連続正解累計（cscs_q_correct_streak3_total:{qid}）を読む
 * - SYNC state (/api/sync/state) から
 *     streakLen[qid]       … 現在の連続正解数
 *     streakWrongLen[qid]  … 現在の連続不正解数
 *     oncePerDayToday      … 本日の正誤ステータス
 *   を取得する
 * - .qno 内の <span class="correct_star">…</span> の表示内容を
 *   以下の優先順位で切り替える：
 *
 *   1) 不正解ストリーク（streakWrongLen）:
 *        1連続不正解  → 🔧
 *        2連続不正解  → 🔨
 *        3連続以上    → 🛠️
 *
 *   2) 正解側 3連続累計（cscs_q_correct_streak3_total / streak3）:
 *        累計 1〜2回   → ⭐️
 *        累計 3〜8回   → 🌟
 *        累計 9回以上  → 💫
 *
 *   3) 正解側「現在の連続正解数」（streakLen）:
 *        2連続正解中  → ⚡️
 *        1連続正解中  → ✨
 *        それ以外      → ⭐️（OFF状態）
 *
 * 想定前提：
 * - b_judge_record.js が 3連続正解 / 不正解達成のたびに
 *   localStorage.setItem("cscs_q_correct_streak3_total:" + qid, n)
 *   localStorage.setItem("cscs_q_wrong_streak3_total:"   + qid, n)
 *   などの形で累計回数を保存している
 * - migrate_top_date() などで .qno の直下に
 *   <span class="correct_star">⭐️</span>
 *   が既に差し込まれている
 */

(function () {
  "use strict";

  // ===== QID の取得ヘルパー =====
  function getQidFromGlobalMeta() {
    if (typeof window !== "undefined" && window.cscsMeta && typeof window.cscsMeta === "object") {
      if (window.cscsMeta.qid) {
        return String(window.cscsMeta.qid);
      }
    }
    return null;
  }

  function getQidFromMetaTag() {
    var meta = document.querySelector('meta[name="cscs-qid"]');
    if (meta && meta.content) {
      return String(meta.content);
    }
    return null;
  }

  function getCurrentQid() {
    // 優先順位：
    // 1) window.cscsMeta.qid
    // 2) <meta name="cscs-qid" content="...">
    var qid = getQidFromGlobalMeta();
    if (qid) {
      return qid;
    }
    qid = getQidFromMetaTag();
    if (qid) {
      return qid;
    }
    return null;
  }

  // ===== 3連続正解カウント取得 =====
  function getStreak3Count(qid) {
    if (!qid) {
      return 0;
    }

    // 問題別の3連正解累計キー
    // 例: "cscs_q_correct_streak3_total:20250926-001"
    var key = "cscs_q_correct_streak3_total:" + qid;
    var raw = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch (e) {
      // localStorage が使えない環境では 0 回扱い
      return 0;
    }

    if (raw === null || raw === undefined || raw === "") {
      return 0;
    }

    var n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }

    return n;
  }

  // ===== 現在の連続正解数 / 連続不正解数 と oncePerDayToday ステータスを SYNC から取得 =====
  /**
   * SYNC (/api/sync/state) から
   *  - streakLen[qid]       … 現在の連続正解数
   *  - streakWrongLen[qid]  … 現在の連続不正解数
   *  - oncePerDayToday.results[qid] … "correct" / "wrong" / "nocount" などのステータス文字列
   * をまとめて取得して返すヘルパー。
   *
   * フォールバックは行わず、SYNC から取得できなかった場合は
   *  {
   *    streakLenCorrect: 0,
   *    streakLenWrong: 0,
   *    oncePerDayStatus: null
   *  }
   * を返す。
   *
   * oncePerDayToday の構造は cscs_sync_view_b.js と同じく:
   *   oncePerDayToday: {
   *     day: number,              // 例: 20251204
   *     results: { qid: string }  // 例: { "20250926-022": "wrong", ... }
   *   }
   * を想定する。
   */
  async function getCurrentStreakInfoFromSync(qid) {
    if (!qid) {
      return {
        streakLenCorrect: 0,
        streakLenWrong: 0,
        oncePerDayStatus: null
      };
    }

    try {
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("correct_star.js: /api/sync/state 取得失敗(streakLen / streakWrongLen / oncePerDayToday):", res.status);
        return {
          streakLenCorrect: 0,
          streakLenWrong: 0,
          oncePerDayStatus: null
        };
      }

      var json = await res.json();
      var root = json.data || json;

      if (!root || typeof root !== "object") {
        console.warn("correct_star.js: SYNC から期待するオブジェクトが取得できませんでした");
        return {
          streakLenCorrect: 0,
          streakLenWrong: 0,
          oncePerDayStatus: null
        };
      }

      // streakLen 部分の取得（現在の連続正解数）
      var lenMap = root.streakLen;
      var lenCorrect = 0;
      if (lenMap && typeof lenMap === "object") {
        var lenRaw = lenMap[qid];
        lenCorrect = Number(lenRaw || 0);
        if (!Number.isFinite(lenCorrect) || lenCorrect < 0) {
          lenCorrect = 0;
        }
      } else {
        console.warn("correct_star.js: SYNC に streakLen がありません(正解ストリーク用)");
      }

      // streakWrongLen 部分の取得（現在の連続不正解数）
      var wrongLenMap = root.streakWrongLen;
      var lenWrong = 0;
      if (wrongLenMap && typeof wrongLenMap === "object") {
        var lenWrongRaw = wrongLenMap[qid];
        lenWrong = Number(lenWrongRaw || 0);
        if (!Number.isFinite(lenWrong) || lenWrong < 0) {
          lenWrong = 0;
        }
      } else {
        console.warn("correct_star.js: SYNC に streakWrongLen がありません(不正解ストリーク用)");
      }

      // oncePerDayToday 部分の取得（cscs_sync_view_b.js と同じ { day, results } 構造）
      var oncePerDayStatus = null;
      var onceMap = root.oncePerDayToday;
      var onceDay = null;
      if (onceMap && typeof onceMap === "object") {
        if (typeof onceMap.day === "number") {
          onceDay = onceMap.day;
        }
        var results = onceMap.results;
        if (results && typeof results === "object") {
          if (Object.prototype.hasOwnProperty.call(results, qid)) {
            var statusRaw = results[qid];
            if (typeof statusRaw === "string") {
              oncePerDayStatus = statusRaw;
            }
          }
        }
      } else {
        console.warn("correct_star.js: SYNC に oncePerDayToday がありません(本日の正誤ステータス判定用)");
      }

      console.log("correct_star.js: SYNC streakInfo 読み取り成功", {
        qid: qid,
        streakLenCorrect: lenCorrect,
        streakLenWrong: lenWrong,
        oncePerDayTodayDay: onceDay,
        oncePerDayStatus: oncePerDayStatus
      });

      return {
        streakLenCorrect: lenCorrect,
        streakLenWrong: lenWrong,
        oncePerDayStatus: oncePerDayStatus
      };
    } catch (e) {
      console.error("correct_star.js: streakInfo SYNC 読み取り中に例外:", e);
      return {
        streakLenCorrect: 0,
        streakLenWrong: 0,
        oncePerDayStatus: null
      };
    }
  }

  // ===== 3連続正解回数 → スター絵文字 変換ヘルパー =====
  function getStarSymbolFromStreakCount(count) {
    var n = Number(count || 0);
    if (!Number.isFinite(n) || n < 0) {
      n = 0;
    }

    if (n >= 9) {
      // 9回以上達成で 💫
      return "💫";
    } else if (n >= 3) {
      // 3〜8回達成で 🌟
      return "🌟";
    } else if (n >= 1) {
      // 1〜2回達成で ⭐️
      return "⭐️";
    }

    // 未達成時は従来どおり ⭐️（CSS側で data 属性を見て制御）
    return "⭐️";
  }

  // nav_list.js など他スクリプトからも利用できるように公開
  if (typeof window !== "undefined") {
    window.cscsGetStarSymbolFromStreakCount = getStarSymbolFromStreakCount;
  }

  // ===== スター / 不正解マーカー表示の更新 =====
  /**
   * 現在の問題 qid に対応するスター / 不正解マーカー表示を更新する。
   *
   * 優先度の高いルール：
   *
   *  1) 不正解ストリーク（streakWrongLen[qid]）が 1 以上のとき：
   *       1連続不正解  → 🖋️
   *       2連続不正解  → 🖌️
   *       3連続以上    → 🖍️
   *
   *  2) 不正解ストリークが 0 の場合で、一度でも 3連続正解を達成していれば：
   *       累積 1〜2回   → ⭐️
   *       累積 3〜8回   → 🌟
   *       累積 9回以上  → 💫
   *
   *  3) 上記どちらにも該当しない場合（まだ 3連続正解未達成かつ連続不正解も 0）のとき：
   *       2連続正解中  → ⚡️
   *       1連続正解中  → ✨
   *       それ以外      → ⭐️（OFF状態）
   */
  async function updateCorrectStar() {
    var qid = getCurrentQid();
    var starElement = document.querySelector(".qno .correct_star");

    if (!starElement) {
      return;
    }
    if (!qid) {
      console.warn("correct_star.js: qid を取得できなかったためスター表示を更新できませんでした");
      return;
    }

    // 3連続正解達成回数（累積）
    var count = getStreak3Count(qid);

    // 3連続正解の累積回数に応じた基本シンボル（⭐️/🌟/💫）
    var symbolFromTotal = getStarSymbolFromStreakCount(count);

    // 現在の連続正解数 / 連続不正解数 / oncePerDayToday ステータスを SYNC から取得
    var currentStreakLenCorrect = 0;
    var currentStreakLenWrong = 0;
    var oncePerDayStatus = null;

    var info = await getCurrentStreakInfoFromSync(qid);
    if (info && typeof info === "object") {
      currentStreakLenCorrect = Number(info.streakLenCorrect || 0);
      if (!Number.isFinite(currentStreakLenCorrect) || currentStreakLenCorrect < 0) {
        currentStreakLenCorrect = 0;
      }

      currentStreakLenWrong = Number(info.streakLenWrong || 0);
      if (!Number.isFinite(currentStreakLenWrong) || currentStreakLenWrong < 0) {
        currentStreakLenWrong = 0;
      }

      if (typeof info.oncePerDayStatus === "string") {
        oncePerDayStatus = info.oncePerDayStatus;
      } else {
        oncePerDayStatus = null;
      }
    }

    var finalSymbol = symbolFromTotal;
    var state = "off";

    // 1) 不正解ストリークが 1 以上あれば、正解側より優先して 🔧/🔨/🛠️ を表示
    if (currentStreakLenWrong >= 1) {
      if (currentStreakLenWrong >= 3) {
        finalSymbol = "🛠️"; // 3連続以上の不正解
      } else if (currentStreakLenWrong === 2) {
        finalSymbol = "🔨"; // 2連続不正解
      } else {
        finalSymbol = "🔧"; // 1連続不正解
      }
      state = "on";
    } else if (count >= 1) {
      // 2) 不正解ストリークが 0 で、一度でも3連続正解を達成していれば累積シンボルをそのまま表示
      finalSymbol = symbolFromTotal;
      state = "on";
    } else {
      // 3) まだ3連続正解は未達成 & 連続不正解も 0 の場合のみ、
      //    正解側の連続回数に応じて ⚡️ / ✨ / ⭐️ を表示
      if (currentStreakLenCorrect >= 2) {
        // リーチ⚡️（2連続正解中）
        finalSymbol = "⚡️";
        state = "on";
      } else if (currentStreakLenCorrect === 1) {
        // あと1回でリーチ✨（1連続正解中）
        finalSymbol = "✨";
        state = "on";
      } else {
        // 本日未回答など、連続正解も不正解もない場合は従来どおりの ⭐️ + OFF
        finalSymbol = "⭐️";
        state = "off";
      }
    }

    starElement.textContent = finalSymbol;
    starElement.setAttribute("data-star-state", state);

    console.log("correct_star.js: スター表示を更新しました", {
      qid: qid,
      streak3Total: count,
      currentStreakLenCorrect: currentStreakLenCorrect,
      currentStreakLenWrong: currentStreakLenWrong,
      oncePerDayStatus: oncePerDayStatus,
      finalSymbol: finalSymbol,
      dataStarState: state
    });
  }

  // ===== 初期化 =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () {
        updateCorrectStar();
        console.log("correct_star.js: 初期スター更新(遅延)を実行しました (DOMContentLoaded)");
      }, 1000);
    });
  } else {
    setTimeout(function () {
      updateCorrectStar();
      console.log("correct_star.js: 初期スター更新(遅延)を実行しました (readyState=" + document.readyState + ")");
    }, 1000);
  }

  // SYNC 後に外部から再評価できるように公開
  window.cscsUpdateCorrectStar = updateCorrectStar;
})();