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
    // フォールバック①: localStorage にキーが存在しない（null）場合は 0 扱いにする。
    // 目的: 初回アクセス時や、まだ計測が走っていない問題でも script が落ちないようにする。
    const v = localStorage.getItem(key);
    if (v == null) {
      console.log("[SYNC/B][fallback][loadInt] localStorage miss -> 0", { key });
      return 0;
    }

    // フォールバック②: 文字列が数値に変換できない場合（NaN 等）は 0 扱いにする。
    // 目的: 破損値や想定外の値が入っていても delta 計算を継続し、送信ペイロードを壊さない。
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) {
      console.warn("[SYNC/B][fallback][loadInt] parseInt failed -> 0", { key, raw: v });
      return 0;
    }

    // 正常系: ここに来たら「整数として解釈できた」ことが確定。
    console.log("[SYNC/B][ok][loadInt] loaded", { key, raw: v, value: n });
    return n;
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
    // フォールバック③: 「前回SYNC済み累計」が未保存（初回）なら 0 を基準に差分を作る。
    // 目的: 初回の merge で「今の累計＝差分」として正しく送れるようにする。
    const cLast       = loadInt(KEY_LAST_COR);
    const wLast       = loadInt(KEY_LAST_WRG);
    let   s3Last      = loadInt(KEY_LAST_S3);
    let   s3WrongLast = loadInt(KEY_LAST_S3_WRONG);

    console.log("[SYNC/B][ok][lastTotals] loaded last totals (0 means first sync or missing)", {
      qid: info.qid,
      KEY_LAST_COR,
      KEY_LAST_WRG,
      KEY_LAST_S3,
      KEY_LAST_S3_WRONG,
      cLast,
      wLast,
      s3Last,
      s3WrongLast
    });

    // correct 側の 3連続正解累計について、local が s3Last より小さい場合 → s3Last を local に強制修正
    // フォールバック④: 「前回SYNC済みキャッシュ(KEY_LAST_*)」が現在の累計より大きい矛盾を検出したら、
    //   “減算送信”を発生させないために、キャッシュ側を現在値へ下げて整合させる。
    // 目的: delta は加算専用（マイナス送信なし）なので、基準値が未来に飛ぶと永久に追いつけなくなるのを防ぐ。
    if (s3Last > s3Now) {
      console.warn("[SYNC/B][fallback][guard] s3Last > s3Now -> clamp last to now", {
        qid: info.qid,
        KEY_LAST_S3,
        before_s3Last: s3Last,
        s3Now
      });

      s3Last = s3Now;
      saveInt(KEY_LAST_S3, s3Last);

      console.log("[SYNC/B][ok][guard] saved corrected KEY_LAST_S3", {
        qid: info.qid,
        KEY_LAST_S3,
        after_s3Last: s3Last
      });
    }

    // wrong 側の 3連続不正解累計についても同様にガード
    // フォールバック⑤: s3WrongLast も同様に「キャッシュが現在値を超える」矛盾を補正して、
    //   “減算送信”や永久不一致を防ぐ（delta は加算専用）。
    if (s3WrongLast > s3WrongNow) {
      console.warn("[SYNC/B][fallback][guard] s3WrongLast > s3WrongNow -> clamp last to now", {
        qid: info.qid,
        KEY_LAST_S3_WRONG,
        before_s3WrongLast: s3WrongLast,
        s3WrongNow
      });

      s3WrongLast = s3WrongNow;
      saveInt(KEY_LAST_S3_WRONG, s3WrongLast);

      console.log("[SYNC/B][ok][guard] saved corrected KEY_LAST_S3_WRONG", {
        qid: info.qid,
        KEY_LAST_S3_WRONG,
        after_s3WrongLast: s3WrongLast
      });
    }

    // 3) 差分（マイナスは送らない）
    // フォールバック⑥: delta は “加算専用” のため、(now - last) がマイナスなら 0 に丸めて送信しない。
    // 目的: 減算送信を禁止し、SYNC側の累計を絶対に戻さない（ロールバックしない）方針を守る。
    const rawDc       = cNow       - cLast;
    const rawDw       = wNow       - wLast;
    const rawDs3      = s3Now      - s3Last;
    const rawDs3Wrong = s3WrongNow - s3WrongLast;

    const dc       = Math.max(0, rawDc);
    const dw       = Math.max(0, rawDw);
    const ds3      = Math.max(0, rawDs3);
    const ds3Wrong = Math.max(0, rawDs3Wrong);

    if (rawDc < 0 || rawDw < 0 || rawDs3 < 0 || rawDs3Wrong < 0) {
      console.warn("[SYNC/B][fallback][deltaClamp] negative delta detected -> clamped to 0", {
        qid: info.qid,
        rawDc,
        rawDw,
        rawDs3,
        rawDs3Wrong,
        dc,
        dw,
        ds3,
        ds3Wrong,
        cNow,
        cLast,
        wNow,
        wLast,
        s3Now,
        s3Last,
        s3WrongNow,
        s3WrongLast
      });
    } else {
      console.log("[SYNC/B][ok][delta] computed delta (all non-negative)", {
        qid: info.qid,
        dc,
        dw,
        ds3,
        ds3Wrong
      });
    }

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
      // 追加: payload のトップレベルに種別を明示し、「diff（差分）」送信であることをサーバ側に伝える
      payloadType: "diff",

      // 既存: 差分（増分）で送るキー（qid→delta）
      correctDelta:         dc       > 0 ? { [info.qid]: dc       } : {},
      incorrectDelta:       dw       > 0 ? { [info.qid]: dw       } : {},
      streak3Delta:         ds3      > 0 ? { [info.qid]: ds3      } : {},
      streak3WrongDelta:    ds3Wrong > 0 ? { [info.qid]: ds3Wrong } : {},

      // 既存: 「増分」ではなく “最新値” を送るキー（qid→current）
      streakLenDelta:                      { [info.qid]: streakLenNow },
      streakWrongLenDelta:                { [info.qid]: streakWrongLenNow },

      // 既存: 送信時刻
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