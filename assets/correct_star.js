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
 * ▼ 問題別 3 連続不正解（💣/💥/🔥 用の累計カウンタ）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *
 * ▼ 問題別「現在の連続不正解数」（🔧/🛠️/💣 用）
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
 * - localStorage の 3連続正解累計（cscs_q_correct_streak3_total:{qid}）、
 *   3連続不正解累計（cscs_q_wrong_streak3_total:{qid}）を読む
 * - SYNC state (/api/sync/state) から
 *     streakLen[qid]       … 現在の連続正解数
 *     streakWrongLen[qid]  … 現在の連続不正解数
 *     oncePerDayToday      … 本日の正誤ステータス
 *   を取得する
 * - .qno 内の <span class="correct_star">…</span> の表示内容を
 *   以下の優先順位で切り替える（常に「最新の連続回数値」を最優先で反映）：
 *
 *   1) 現在の不正解ストリーク（streakWrongLen[qid]）が 1 以上のとき：
 *        1連続不正解  → 🔧
 *        2連続不正解  → 🛠️
 *        3連続以上    → 💣
 *
 *   2) 現在の不正解ストリークが 0 で、
 *      現在の正解ストリーク（streakLen[qid]）が 1 以上のとき：
 *        1連続正解    → ✨
 *        2連続正解    → ⚡️
 *        3連続以上    → ⭐️
 *
 *   3) 上記どちらのストリークも 0 のときにのみ、
 *      「累計の 3 連続達成回数」を表示する：
 *
 *      - 不正解側 3連続累計（cscs_q_wrong_streak3_total / streak3Wrong[qid]）:
 *          累計 1〜2回   → 💣
 *          累計 3〜8回   → 💥
 *          累計 9回以上  → 🔥
 *
 *      - 正解側 3連続累計（cscs_q_correct_streak3_total / streak3[qid]）:
 *          累計 1〜2回   → ⭐️
 *          累計 3〜8回   → 🌟
 *          累計 9回以上  → 💫
 *
 *   4) それ以外（ストリークも累計も 0）のとき：
 *        表示なし（空欄：OFF状態）
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

  // ===== 3連続不正解カウント取得 =====
  function getWrongStreak3Count(qid) {
    if (!qid) {
      return 0;
    }

    // 問題別の3連不正解累計キー
    // 例: "cscs_q_wrong_streak3_total:20250926-001"
    var key = "cscs_q_wrong_streak3_total:" + qid;
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

      // oncePerDayToday 部分の取得（{ day, results } 構造）
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

    // 未達成時は「空欄」（OFF状態）を返す
    return "";
  }

  // 不正解側 3連続累計 → マーカー絵文字 変換ヘルパー
  function getWrongSymbolFromStreak3Count(count) {
    var n = Number(count || 0);
    if (!Number.isFinite(n) || n < 0) {
      n = 0;
    }

    if (n >= 9) {
      // 9回以上 3連続不正解達成で 🔥
      return "🔥";
    } else if (n >= 3) {
      // 3〜8回達成で 💥
      return "💥";
    } else if (n >= 1) {
      // 1〜2回達成で 💣
      return "💣";
    }

    return null;
  }

  // 3連続正解の累計回数から「⭐️/🌟/💫 + 回数」の表示文字列を組み立てるヘルパー
  function buildCorrectBadgeFromTotals(totalCount) {
    var n = Number(totalCount || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return "";
    }

    // 1〜2回達成までは ⭐️+1 / ⭐️+2
    if (n === 1 || n === 2) {
      return "⭐️+" + String(n);
    }

    // 3回達成で一度「🌟」に昇格
    if (n === 3) {
      return "🌟";
    }

    // 4〜8回達成までは 🌟+1〜5（9回目で💫に到達する手前まで）
    if (n >= 4 && n <= 8) {
      return "🌟+" + String(n - 3);
    }

    // 9回達成で「💫」に昇格
    if (n === 9) {
      return "💫";
    }

    // 10回以降は 💫+1, 💫+2, ... と上乗せ表記
    return "💫+" + String(n - 9);
  }

  // 3連続不正解の累計回数から「💣/💥/🔥 + 回数」の表示文字列を組み立てるヘルパー
  function buildWrongBadgeFromTotals(totalCount) {
    var n = Number(totalCount || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return "";
    }

    // 1〜2回達成までは 💣+1 / 💣+2
    if (n === 1 || n === 2) {
      return "💣+" + String(n);
    }

    // 3回達成で一度「💥」に昇格
    if (n === 3) {
      return "💥";
    }

    // 4〜8回達成までは 💥+1〜5（9回目で🔥に到達する手前まで）
    if (n >= 4 && n <= 8) {
      return "💥+" + String(n - 3);
    }

    // 9回達成で「🔥」に昇格
    if (n === 9) {
      return "🔥";
    }

    // 10回以降は 🔥+1, 🔥+2, ... と上乗せ表記
    return "🔥+" + String(n - 9);
  }

  // nav_list.js など他スクリプトからも利用できるように公開（正解側のみ）
  if (typeof window !== "undefined") {
    window.cscsGetStarSymbolFromStreakCount = getStarSymbolFromStreakCount;
  }

  // ===== スター / 不正解マーカー表示の更新 =====
  /**
   * 現在の問題 qid に対応するスター / 不正解マーカー表示を更新する。
   *
   * 優先度の高いルール（常に「最新の連続回数値」を最優先で反映）：
   *
   *  1) 現在の不正解ストリーク（streakWrongLen[qid]）が 1 以上のとき：
   *       1連続不正解  → 🔧
   *       2連続不正解  → 🛠️
   *       3連続以上    → 💣
   *
   *  2) 現在の不正解ストリークが 0 で、
   *     現在の正解ストリーク（streakLen[qid]）が 1〜2 のとき：
   *       1連続正解    → ✨
   *       2連続正解    → ⚡️
   *
   *  3) 正解・不正解どちらのストリークも 0 のときにのみ、
   *     「3連続達成の累計回数」からトロフィーを表示する：
   *
   *     - 正解側 3連続累計（cscs_q_correct_streak3_total / streak3[qid]）:
   *         1〜2回達成   → ⭐️+1 / ⭐️+2
   *         3回達成      → 🌟
   *         4〜8回達成   → 🌟+1〜5
   *         9回達成      → 💫
   *         10回以上     → 💫+1, 💫+2, ... と加算表示
   *
   *     - 不正解側 3連続累計（cscs_q_wrong_streak3_total / streak3Wrong[qid]）:
   *         1〜2回達成   → 💣+1 / 💣+2
   *         3回達成      → 💥
   *         4〜8回達成   → 💥+1〜5
   *         9回達成      → 🔥
   *         10回以上     → 🔥+1, 🔥+2, ... と加算表示
   *
   *     ※ 正解・不正解の両方に累計がある場合は、正解側のトロフィー表示を優先する。
   *
   *  4) 上記いずれにも該当しない（ストリークも累計も 0）のとき：
   *       表示なし（空欄：OFF状態）
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

    // 正解側 3連続正解達成回数（累積）
    var correct3Total = getStreak3Count(qid);
    var symbolFromCorrectTotal = getStarSymbolFromStreakCount(correct3Total);

    // 不正解側 3連続不正解達成回数（累積）
    var wrong3Total = getWrongStreak3Count(qid);
    var symbolFromWrongTotal = getWrongSymbolFromStreak3Count(wrong3Total);

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

    var finalSymbol = "";
    var state = "off";

    // 1) 現在の不正解ストリークが 1 以上なら常にこちらを最優先（🔧 / 🛠️ / 💣）
    //    → 苦戦中の問題を一目で分かるようにする。
    if (currentStreakLenWrong >= 1) {
      if (currentStreakLenWrong >= 3) {
        finalSymbol = "💣"; // 3連続以上の不正解
      } else if (currentStreakLenWrong === 2) {
        finalSymbol = "🛠️"; // 2連続不正解
      } else {
        finalSymbol = "🔧"; // 1連続不正解
      }
      state = "on";
    } else if (currentStreakLenCorrect >= 1 && currentStreakLenCorrect <= 2) {
      // 2) 不正解ストリークが 0 で、現在の正解ストリークが 1〜2 のとき（✨ / ⚡️）
      //    → まだ3連続達成前の「今の連続正解」の様子をそのまま出す。
      if (currentStreakLenCorrect === 2) {
        finalSymbol = "⚡️"; // 2連続正解中
      } else {
        finalSymbol = "✨"; // 1連続正解中
      }
      state = "on";
    } else {
      // 3) どちらのストリークも 0 のときだけ、3連続達成の累計からトロフィーを表示する。
      //    先に正解側の累計（⭐️/🌟/💫系）を優先し、その次に不正解側（💣/💥/🔥系）を見る。
      var badgeFromCorrectTotal = buildCorrectBadgeFromTotals(correct3Total);
      var badgeFromWrongTotal = buildWrongBadgeFromTotals(wrong3Total);

      if (badgeFromCorrectTotal) {
        finalSymbol = badgeFromCorrectTotal;
        state = "on";
      } else if (badgeFromWrongTotal) {
        finalSymbol = badgeFromWrongTotal;
        state = "on";
      } else {
        // 4) ストリークも累計も何も無い場合は OFF（空欄）にする。
        finalSymbol = "";
        state = "off";
      }
    }

    starElement.textContent = finalSymbol;
    starElement.setAttribute("data-star-state", state);

    console.log("correct_star.js: スター表示を更新しました", {
      qid: qid,
      correct3Total: correct3Total,
      wrong3Total: wrong3Total,
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