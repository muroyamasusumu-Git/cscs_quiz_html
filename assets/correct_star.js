/* correct_star.js — 3連続正解スター表示制御用スクリプト
 *
 * 役割：
 * - 現在表示中の問題の qid を取得する
 * - localStorage の 3連続正解カウンタ（cscs_correct_streak3_total:{qid}）を読む
 * - .qno 内の <span class="correct_star">⭐️</span> の表示 / 非表示を切り替える
 *
 * 想定前提：
 * - b_judge_record.js が 3連続正解達成のたびに
 *   localStorage.setItem("cscs_correct_streak3_total:" + qid, n)
 *   のような形で累計回数を保存している
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

  // ===== 現在の連続正解数（1連続 / 2連続 など）と oncePerDayToday ステータスを SYNC から取得 =====
  /**
   * SYNC (/api/sync/state) から
   *  - streakLen[qid]（現在の連続正解数）
   *  - oncePerDayToday.results[qid]（"correct" / "wrong" / "nocount" などのステータス文字列）
   * をまとめて取得して返すヘルパー。
   *
   * フォールバックは行わず、SYNC から取得できなかった場合は
   *  { streakLen: 0, oncePerDayStatus: null }
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
        streakLen: 0,
        oncePerDayStatus: null
      };
    }

    try {
      var res = await fetch("/api/sync/state", { cache: "no-store" });
      if (!res.ok) {
        console.error("correct_star.js: /api/sync/state 取得失敗(streakLen/oncePerDayToday):", res.status);
        return {
          streakLen: 0,
          oncePerDayStatus: null
        };
      }

      var json = await res.json();
      var root = json.data || json;

      if (!root || typeof root !== "object") {
        console.warn("correct_star.js: SYNC から期待するオブジェクトが取得できませんでした");
        return {
          streakLen: 0,
          oncePerDayStatus: null
        };
      }

      // streakLen 部分の取得
      var lenMap = root.streakLen;
      var len = 0;
      if (lenMap && typeof lenMap === "object") {
        var lenRaw = lenMap[qid];
        len = Number(lenRaw || 0);
        if (!Number.isFinite(len) || len < 0) {
          len = 0;
        }
      } else {
        console.warn("correct_star.js: SYNC に streakLen がありません(リーチ/不正解判定用)");
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
        streakLen: len,
        oncePerDayTodayDay: onceDay,
        oncePerDayStatus: oncePerDayStatus
      });

      return {
        streakLen: len,
        oncePerDayStatus: oncePerDayStatus
      };
    } catch (e) {
      console.error("correct_star.js: streakInfo SYNC 読み取り中に例外:", e);
      return {
        streakLen: 0,
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

  // ===== スター表示の更新 =====
  /**
   * 現在の問題 qid に対応するスター表示を更新する。
   *
   * 優先度の高いルール：
   *  1) 一度でも 3連続正解を達成していれば、累積回数に応じて ⭐️/🌟/💫 を表示
   *  2) まだ 3連続正解を達成していない場合：
   *      - SYNC の oncePerDayToday[qid] が "wrong" なら ☑️
   *        （本日の oncePerDayToday 正誤記録が不正解だった問題を明示する）
   *      - そうでなければ、streakLen に応じて ⚡️ / ✨ / ⭐️ を表示
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

    // 現在の連続正解数と oncePerDayToday ステータスを SYNC から取得
    var currentStreakLen = 0;
    var oncePerDayStatus = null;

    // まだ 3連続正解を一度も達成していない問題だけ、
    // SYNC を見て「本日の oncePerDayToday が wrong かどうか」を判定に使う
    if (count < 1) {
      var info = await getCurrentStreakInfoFromSync(qid);
      if (info && typeof info === "object") {
        currentStreakLen = Number(info.streakLen || 0);
        if (!Number.isFinite(currentStreakLen) || currentStreakLen < 0) {
          currentStreakLen = 0;
        }
        if (typeof info.oncePerDayStatus === "string") {
          oncePerDayStatus = info.oncePerDayStatus;
        } else {
          oncePerDayStatus = null;
        }
      }
    }

    var finalSymbol = symbolFromTotal;
    var state = "off";

    if (count >= 1) {
      // 一度でも3連続正解を達成していれば、累積シンボルをそのまま表示
      finalSymbol = symbolFromTotal;
      state = "on";
    } else {
      // まだ3連続正解は達成していない場合のみ、
      // oncePerDayToday のステータスが "wrong" のときに ☑️ を優先する
      var isWrongToday = oncePerDayStatus === "wrong";

      if (isWrongToday) {
        // 本日の oncePerDayToday 正誤記録が "wrong" → ☑️ を表示
        finalSymbol = "☑️";
        state = "on";
      } else if (currentStreakLen >= 2) {
        // リーチ⚡️（2連続正解中）
        finalSymbol = "⚡️";
        state = "on";
      } else if (currentStreakLen === 1) {
        // あと1回でリーチ✨（1連続正解中）
        finalSymbol = "✨";
        state = "on";
      } else {
        // 本日未回答 or oncePerDayStatus が "wrong" 以外かつ連続正解も無い場合は従来どおりの ⭐️ + OFF
        finalSymbol = "⭐️";
        state = "off";
      }
    }

    starElement.textContent = finalSymbol;
    starElement.setAttribute("data-star-state", state);

    console.log("correct_star.js: スター表示を更新しました", {
      qid: qid,
      streak3Total: count,
      currentStreakLen: currentStreakLen,
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