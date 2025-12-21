// assets/b_sync_merge.js
// Bパート → SYNC 連携（attempt_log 廃止版）
/**
 * 【キー対応表（LocalStorage ⇔ SYNC state ⇔ delta payload）】
 *  ※このファイルで「新しくキーを追加／既存キー名を変更」した場合は、
 *    必ずこの表を更新すること（恒久ルール）。
 *
 * ▼ 問題別累計
 *   - localStorage: "cscs_q_correct_total:" + qid
 *       ⇔ SYNC state: correct[qid]
 *       ⇔ delta payload: correctDelta[qid]
 *   - localStorage: "cscs_q_wrong_total:" + qid
 *       ⇔ SYNC state: incorrect[qid]
 *       ⇔ delta payload: incorrectDelta[qid]
 *
 * ▼ 問題別 3 連続正解（⭐️用）
 *   - localStorage: "cscs_q_correct_streak3_total:" + qid
 *       ⇔ SYNC state: streak3[qid]
 *       ⇔ delta payload: streak3Delta[qid]
 *   - localStorage: "cscs_q_correct_streak_len:" + qid
 *       ⇔ SYNC state: streakLen[qid]
 *       ⇔ delta payload: streakLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ 問題別 3 連続不正解（💣用）
 *   - localStorage: "cscs_q_wrong_streak3_total:" + qid
 *       ⇔ SYNC state: streak3Wrong[qid]
 *       ⇔ delta payload: streak3WrongDelta[qid]
 *   - localStorage: "cscs_q_wrong_streak_len:" + qid
 *       ⇔ SYNC state: streakWrongLen[qid]
 *       ⇔ delta payload: streakWrongLenDelta[qid]（「増分」ではなく最新値）
 *
 * ▼ B専用「前回 SYNC 済み累計」のローカルキャッシュ（SYNC state には存在しない）
 *   - localStorage: "cscs_sync_last_c:"   + qid … 正解累計の前回同期値
 *   - localStorage: "cscs_sync_last_w:"   + qid … 不正解累計の前回同期値
 *   - localStorage: "cscs_sync_last_s3:"  + qid … 3連続正解累計の前回同期値
 *   - localStorage: "cscs_sync_last_ws3:" + qid … 3連続不正解累計の前回同期値
 *
 * このファイルは「localStorage → /api/sync/merge の delta payload」を組み立てる役割だけを持つ。
 * SYNC 側の完全な構造は merge.ts / state.ts の仕様コメントを参照すること。
 */

(function(){
  // Bページの URL から qid = "YYYYMMDD-NNN" を取得
  function detectInfo(){
    const m = location.pathname.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b/);
    if (!m) return null;
    const day = m[1];       // 例: "20250926"
    const n3  = m[2];       // 例: "001"
    const qid = `${day}-${n3}`;
    return { day, n3, qid };
  }

  const info = detectInfo();
  if (!info) return;

  // b_judge_record.js が管理している「本物の累積キー」
  const KEY_COR              = `cscs_q_correct_total:${info.qid}`;
  const KEY_WRG              = `cscs_q_wrong_total:${info.qid}`;
  const KEY_S3               = `cscs_q_correct_streak3_total:${info.qid}`;
  const KEY_STREAK_LEN       = `cscs_q_correct_streak_len:${info.qid}`;
  const KEY_S3_WRONG         = `cscs_q_wrong_streak3_total:${info.qid}`;
  const KEY_STREAK_WRONG_LEN = `cscs_q_wrong_streak_len:${info.qid}`;

  // B側だけで使う「最後に SYNC 済みだったときの累積値」
  const KEY_LAST_COR      = `cscs_sync_last_c:${info.qid}`;
  const KEY_LAST_WRG      = `cscs_sync_last_w:${info.qid}`;
  const KEY_LAST_S3       = `cscs_sync_last_s3:${info.qid}`;
  const KEY_LAST_S3_WRONG = `cscs_sync_last_ws3:${info.qid}`;

  function loadInt(key){
    const v = localStorage.getItem(key);
    if (v == null) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function saveInt(key, value){
    localStorage.setItem(key, String(value));
  }
  
// 置換後（このブロックをまるごと削除して何も置かない）

  async function syncFromTotals(){
    // 1) 現在の累積（b_judge_record.js が書いた値）
    const cNow              = loadInt(KEY_COR);
    const wNow              = loadInt(KEY_WRG);
    const s3Now             = loadInt(KEY_S3);
    const streakLenNow      = loadInt(KEY_STREAK_LEN);
    const s3WrongNow        = loadInt(KEY_S3_WRONG);
    const streakWrongLenNow = loadInt(KEY_STREAK_WRONG_LEN);

    // 2) 前回 SYNC 時点の値（存在しなければ 0 扱い）
    const cLast       = loadInt(KEY_LAST_COR);
    const wLast       = loadInt(KEY_LAST_WRG);
    let   s3Last      = loadInt(KEY_LAST_S3);
    let   s3WrongLast = loadInt(KEY_LAST_S3_WRONG);

    // correct 側の 3連続正解累計について、local が s3Last より小さい場合 → s3Last を local に強制修正
    if (s3Last > s3Now) {
      console.warn("[SYNC/B] 修正: s3Last が local より大きかったため補正しました", {
        qid: info.qid,
        s3Last,
        s3Now
      });
      s3Last = s3Now;
      saveInt(KEY_LAST_S3, s3Last);
    }

    // wrong 側の 3連続不正解累計についても同様にガード
    if (s3WrongLast > s3WrongNow) {
      console.warn("[SYNC/B] 修正: s3WrongLast が local より大きかったため補正しました", {
        qid: info.qid,
        s3WrongLast,
        s3WrongNow
      });
      s3WrongLast = s3WrongNow;
      saveInt(KEY_LAST_S3_WRONG, s3WrongLast);
    }

    // 3) 差分（マイナスは送らない）
    const dc       = Math.max(0, cNow       - cLast);
    const dw       = Math.max(0, wNow       - wLast);
    const ds3      = Math.max(0, s3Now      - s3Last);
    const ds3Wrong = Math.max(0, s3WrongNow - s3WrongLast);

    // streak3TodayDelta は cscs_sync_view_b.js 側からのみ送信するため、
    // ここでは streak3Today 系は一切扱わない。
    // 3連続不正解関連も「今日のユニーク」ではなく累計・現在長だけを扱う。
    if (!dc && !dw && !ds3 && !ds3Wrong && streakLenNow === 0 && streakWrongLenNow === 0) {
      console.log("[SYNC/B] ★送信なし（no delta）", {
        qid: info.qid,
        cNow,
        wNow,
        s3Now,
        streakLenNow,
        s3WrongNow,
        streakWrongLenNow,
        cLast,
        wLast,
        s3Last,
        s3WrongLast
      });
      return;
    }

    // 4) /api/sync/merge へ「差分だけ」を送信
    const payload = {
      correctDelta:         dc       > 0 ? { [info.qid]: dc       } : {},
      incorrectDelta:       dw       > 0 ? { [info.qid]: dw       } : {},
      streak3Delta:         ds3      > 0 ? { [info.qid]: ds3      } : {},
      streakLenDelta:                      { [info.qid]: streakLenNow },
      streak3WrongDelta:    ds3Wrong > 0 ? { [info.qid]: ds3Wrong } : {},
      streakWrongLenDelta:                { [info.qid]: streakWrongLenNow },
      updatedAt: Date.now()
    };

    console.log("[SYNC/B] merge payload (no streak3TodayDelta)", {
      qid: info.qid,
      cNow,
      wNow,
      s3Now,
      streakLenNow,
      s3WrongNow,
      streakWrongLenNow,
      cLast,
      wLast,
      s3Last,
      s3WrongLast,
      dc,
      dw,
      ds3,
      ds3Wrong,
      payload
    });

    try{
      const res = await fetch("/api/sync/merge", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(String(res.status));

      // 5) 成功したら「今回送信後の累積値」を保存して次回差分の基準にする
      if (dc)       saveInt(KEY_LAST_COR,      cNow);
      if (dw)       saveInt(KEY_LAST_WRG,      wNow);
      if (ds3)      saveInt(KEY_LAST_S3,       s3Now);
      if (ds3Wrong) saveInt(KEY_LAST_S3_WRONG, s3WrongNow);

      console.log("[SYNC/B] ★送信成功（merge OK）", {
        qid: info.qid
      });
    }catch(e){
      console.warn("[SYNC/B] ★送信失敗（merge failed）", e);
    }
  }

  // b_judge_record.js の集計が終わったタイミングに近づけるため、
  // DOM 完成後に 1 tick 遅らせて実行
  function schedule(){
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", function(){
        setTimeout(syncFromTotals, 0);
      });
    } else {
      setTimeout(syncFromTotals, 0);
    }
  }

  function showStreakStatus(){
    const localTotalCorrect  = loadInt(KEY_S3);
    const syncedTotalCorrect = loadInt(KEY_LAST_S3);
    const localTotalWrong    = loadInt(KEY_S3_WRONG);
    const syncedTotalWrong   = loadInt(KEY_LAST_S3_WRONG);

    console.log("== Bパート: 3連続正解 / 3連続不正解 SYNC ステータス ==");
    console.log("qid:", info.qid);

    // 3連続正解側のステータス
    console.log("--- 3連続正解(⭐️) ---");
    console.log("localStorage[KEY_S3] =", localStorage.getItem(KEY_S3), "→", localTotalCorrect);
    console.log("localStorage[KEY_LAST_S3] =", localStorage.getItem(KEY_LAST_S3), "→", syncedTotalCorrect);

    if (localTotalCorrect === 0 && syncedTotalCorrect === 0) {
      console.log("ℹ まだこの問題では 3回連続正解が発生していません。");
    } else if (localTotalCorrect === syncedTotalCorrect) {
      console.log("✅ 3連続正解回数: SYNC " + String(syncedTotalCorrect) + " 回 / local " + String(localTotalCorrect) + " 回（完全一致）です。");
    } else if (syncedTotalCorrect < localTotalCorrect) {
      console.warn(
        "⚠ 同期待ちの 3連続正解があります。",
        "SYNC 側 =", syncedTotalCorrect, "/ local 側 =", localTotalCorrect,
        "（次回の Bパート遷移時に追加送信される可能性があります。）"
      );
    } else {
      console.error(
        "✕ 異常: SYNC 側の 3連続正解回数の方が大きくなっています (SYNC > local)。",
        "SYNC 側 =", syncedTotalCorrect, "/ local 側 =", localTotalCorrect,
        "一度リセットしてから再テストした方が良いかもしれません。"
      );
    }

    // 3連続不正解側のステータス（💣）
    console.log("--- 3連続不正解(💣) ---");
    console.log("localStorage[KEY_S3_WRONG] =", localStorage.getItem(KEY_S3_WRONG), "→", localTotalWrong);
    console.log("localStorage[KEY_LAST_S3_WRONG] =", localStorage.getItem(KEY_LAST_S3_WRONG), "→", syncedTotalWrong);

    if (localTotalWrong === 0 && syncedTotalWrong === 0) {
      console.log("ℹ まだこの問題では 3回連続不正解が発生していません。");
    } else if (localTotalWrong === syncedTotalWrong) {
      console.log("✅ 3連続不正解回数: SYNC " + String(syncedTotalWrong) + " 回 / local " + String(localTotalWrong) + " 回（完全一致）です。");
    } else if (syncedTotalWrong < localTotalWrong) {
      console.warn(
        "⚠ 同期待ちの 3連続不正解があります。",
        "SYNC 側 =", syncedTotalWrong, "/ local 側 =", localTotalWrong,
        "（次回の Bパート遷移時に追加送信される可能性があります。）"
      );
    } else {
      console.error(
        "✕ 異常: SYNC 側の 3連続不正解回数の方が大きくなっています (SYNC > local)。",
        "SYNC 側 =", syncedTotalWrong, "/ local 側 =", localTotalWrong,
        "一度リセットしてから再テストした方が良いかもしれません。"
      );
    }

    console.log("== Bパート: 3連続正解 / 3連続不正解 SYNC ステータス終了 ==");
  }

  schedule();
  showStreakStatus();
})();