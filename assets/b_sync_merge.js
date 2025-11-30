// assets/b_sync_merge.js
// Bパート → SYNC 連携（attempt_log 廃止版）

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
  const KEY_COR        = `cscs_q_correct_total:${info.qid}`;
  const KEY_WRG        = `cscs_q_wrong_total:${info.qid}`;
  const KEY_S3         = `cscs_q_correct_streak3_total:${info.qid}`;
  const KEY_STREAK_LEN = `cscs_q_correct_streak_len:${info.qid}`;

  // B側だけで使う「最後に SYNC 済みだったときの累積値」
  const KEY_LAST_COR = `cscs_sync_last_c:${info.qid}`;
  const KEY_LAST_WRG = `cscs_sync_last_w:${info.qid}`;
  const KEY_LAST_S3  = `cscs_sync_last_s3:${info.qid}`;

  function loadInt(key){
    const v = localStorage.getItem(key);
    if (v == null) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function saveInt(key, value){
    localStorage.setItem(key, String(value));
  }

  // 今日の「新規⭐️」メタ情報を localStorage から読み出すヘルパー
  function loadStreak3TodayMeta(){
    var dayKey   = "cscs_streak3_today_day";
    var qidsKey  = "cscs_streak3_today_qids";
    var countKey = "cscs_streak3_today_unique_count";

    var day = "";
    try {
      day = localStorage.getItem(dayKey) || "";
    } catch (_e) {
      day = "";
    }

    var count = 0;
    try {
      var rawCount = localStorage.getItem(countKey);
      var n = parseInt(rawCount || "0", 10);
      count = Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (_e) {
      count = 0;
    }

    var qids = [];
    try {
      var rawQids = localStorage.getItem(qidsKey);
      qids = JSON.parse(rawQids || "[]");
      if (!Array.isArray(qids)) {
        qids = [];
      }
    } catch (_e) {
      qids = [];
    }

    // count と配列長がズレていたら、配列長を優先
    if (qids.length > 0 && count !== qids.length) {
      count = qids.length;
    }

    return {
      day: day,
      count: count,
      qids: qids
    };
  }

  async function syncFromTotals(){
    // 1) 現在の累積（b_judge_record.js が書いた値）
    const cNow        = loadInt(KEY_COR);
    const wNow        = loadInt(KEY_WRG);
    const s3Now       = loadInt(KEY_S3);
    const streakLenNow = loadInt(KEY_STREAK_LEN);

    // 2) 前回 SYNC 時点の値（存在しなければ 0 扱い）
    const cLast  = loadInt(KEY_LAST_COR);
    const wLast  = loadInt(KEY_LAST_WRG);
    let s3Last = loadInt(KEY_LAST_S3);

    // local が s3Last より小さい場合 → s3Last を local に強制修正
    if (s3Last > s3Now) {
      console.warn("[SYNC/B] 修正: s3Last が local より大きかったため補正しました");
      s3Last = s3Now;
      saveInt(KEY_LAST_S3, s3Last);
    }

    // 3) 差分（マイナスは送らない）
    const dc  = Math.max(0, cNow  - cLast);
    const dw  = Math.max(0, wNow  - wLast);
    const ds3 = Math.max(0, s3Now - s3Last);

    // streakLenNow が 0 でも「リセットとして送る」ケースがあるので条件に含めない
    if (!dc && !dw && !ds3 && streakLenNow === 0) return;

    // 4) /api/sync/merge へ「差分だけ」を送信（Aパートと同じ Delta 形式）
    const todayMeta = loadStreak3TodayMeta();

    const payload = {
      correctDelta:   dc  > 0 ? { [info.qid]: dc  } : {},
      incorrectDelta: dw  > 0 ? { [info.qid]: dw  } : {},
      streak3Delta:   ds3 > 0 ? { [info.qid]: ds3 } : {},
      streakLenDelta: { [info.qid]: streakLenNow },
      updatedAt: Date.now()
    };

    // ★ 今日ぶんのユニーク⭐️数が更新された場合だけ送る
    if (ds3 > 0 && todayMeta.day) {
      payload.streak3Today = {
        day: todayMeta.day,
        unique_count: todayMeta.count
      };
    }

    console.log("[SYNC/B] streak3 merge payload", {
      qid: info.qid,
      cNow,
      wNow,
      s3Now,
      streakLenNow,
      cLast,
      wLast,
      s3Last,
      dc,
      dw,
      ds3,
      payload
    });

    try{
      const res = await fetch("/api/sync/merge", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.status);

      // 5) 成功したら「今回送信後の累積値」を保存して次回差分の基準にする
      if (dc)  saveInt(KEY_LAST_COR, cNow);
      if (dw)  saveInt(KEY_LAST_WRG,  wNow);
      if (ds3) saveInt(KEY_LAST_S3,   s3Now);
    }catch(e){
      console.warn("[SYNC/B] merge failed", e);
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
    const localTotal  = loadInt(KEY_S3);
    const syncedTotal = loadInt(KEY_LAST_S3);

    console.log("== Bパート: 3連続正解 SYNC ステータス ==");
    console.log("qid:", info.qid);
    console.log("localStorage[KEY_S3] =", localStorage.getItem(KEY_S3), "→", localTotal);
    console.log("localStorage[KEY_LAST_S3] =", localStorage.getItem(KEY_LAST_S3), "→", syncedTotal);

    if (localTotal === 0 && syncedTotal === 0) {
      console.log("ℹ まだこの問題では 3回連続正解が発生していません。");
    } else if (localTotal === syncedTotal) {
      console.log("✅ 3連続正解回数: SYNC " + String(syncedTotal) + " 回 / local " + String(localTotal) + " 回（完全一致）です。");
    } else if (syncedTotal < localTotal) {
      console.warn(
        "⚠ 同期待ちの 3連続正解があります。",
        "SYNC 側 =", syncedTotal, "/ local 側 =", localTotal,
        "（次回の Bパート遷移時に追加送信される可能性があります。）"
      );
    } else {
      console.error(
        "✕ 異常: SYNC 側の 3連続正解回数の方が大きくなっています (SYNC > local)。",
        "SYNC 側 =", syncedTotal, "/ local 側 =", localTotal,
        "一度リセットしてから再テストした方が良いかもしれません。"
      );
    }

    console.log("== Bパート: 3連続正解 SYNC ステータス終了 ==");
  }

  schedule();
  showStreakStatus();
})();