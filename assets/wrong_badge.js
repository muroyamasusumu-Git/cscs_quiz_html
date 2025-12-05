// /assets/wrong_badge.js　
// 目的: b_judge_record.js のキー命名に完全一致。
// 表示の（正解/不正）をリンク化し、クリックでその問題単体の集計をリセットできるようにする。
(() => {
  "use strict";

  // ===== JST "today" (YYYYMMDD) =====
  // ※ 現状このファイル内では利用していないが、JST基準の日付キーを作るユーティリティ
  function getTodayYYYYMMDD_JST() {
    try {
      const now = new Date();
      // UTCから+9時間ずらした Date を作る（JST）
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      // "YYYY-MM-DD" までを取り出して "-" を除去 → "YYYYMMDD"
      return jst.toISOString().slice(0, 10).replace(/-/g, "");
    } catch {
      return "";
    }
  }

  // ===== Favorites（既存表示は維持） =====
  // お気に入りステータスのラベル化（文字列版）
  function favLabelFromString(s) {
    switch (String(s || "unset")) {
      case "understood": return "★１";
      case "unanswered": return "★２";
      case "none":       return "★３";
      default:           return "★ー";
    }
  }
  // お気に入りステータスのラベル化（数値版）
  function favLabelFromNumber(n) {
    switch ((n | 0)) {
      case 1: return "★１";
      case 2: return "★２";
      case 3: return "★３";
      default: return "★ー";
    }
  }

  // 現在ページの QID に紐づく「お気に入りステータス」を localStorage から読み取る
  // ・cscs_fav      : 文字列版 "understood" / "unanswered" / "none"
  // ・cscs_fav_map  : 数値版   1 / 2 / 3
  function readFavLabelAndType() {
    // URL から dayPath（YYYYMMDD）と n3（3桁番号）を取り出し、qid を復元
    const dayPath = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1] || "";
    const n3 = (location.pathname.match(/q(\d{3})_[ab]/i) || [])[1] || "";
    const qid = dayPath && n3 ? `${dayPath}-${n3}` : "";
    if (!qid) return { label: "★ー", type: "unset" };

    // 1) まず cscs_fav（文字列版）を参照
    try {
      const obj = JSON.parse(localStorage.getItem("cscs_fav") || "{}");
      if (obj && Object.prototype.hasOwnProperty.call(obj, qid)) {
        const raw = String(obj[qid] || "unset");
        return { label: favLabelFromString(raw), type: raw };
      }
    } catch {}

    // 2) 次に cscs_fav_map（数値版）を参照
    try {
      const m = JSON.parse(localStorage.getItem("cscs_fav_map") || "{}");
      if (m && Object.prototype.hasOwnProperty.call(m, qid)) {
        const n = m[qid];
        const label = favLabelFromNumber(n);
        const type =
          n === 1 ? "understood" :
          n === 2 ? "unanswered" :
          n === 3 ? "none" :
          "unset";
        return { label, type };
      }
    } catch {}

    // どちらにも無ければ「未設定」
    return { label: "★ー", type: "unset" };
  }

  // ===== topmeta-left 内にステータスを差し込む =====
  function ensureFixedBox() {
    // HTML 側に用意された .topmeta-left を優先的に利用
    let box = document.querySelector(".topmeta-left");

    // 無い場合はフォールバックとして生成
    if (!box) {
      box = document.createElement("div");
      box.className = "topmeta-left";

      // 可能なら .topmeta 内に配置 / 無ければ body 末尾
      const topmeta = document.querySelector(".topmeta");
      if (topmeta) {
        topmeta.appendChild(box);
      } else {
        document.body.appendChild(box);
      }
    }

    // 既に .fav-status / .wrong-status があるかどうかチェック
    const hasFav = !!box.querySelector(".fav-status");
    const hasWrong = !!box.querySelector(".wrong-status");

    // 「正解/不正解」表示（クリック可能なリンク）を生成
    if (!hasWrong) {
      const wrongEl = document.createElement("a");
      wrongEl.href = "#";
      wrongEl.className = "wrong-status";
      wrongEl.setAttribute("role", "button");
      wrongEl.setAttribute("aria-label", "成績の統計を表示");
      wrongEl.textContent = "（正解:--回 / 不正解:--回）";
      box.appendChild(wrongEl);
    }

    // お気に入りステータス表示を生成
    if (!hasFav) {
      const favEl = document.createElement("span");
      favEl.className = "fav-status";
      favEl.textContent = "［--］";
      box.appendChild(favEl);
    }

    return box;
  }

  // ===== 当日ユニーク値の読取り（b_judge_record.js 準拠） =====
  // ※ このファイル内では現状未使用。将来の「今日のユニーク正解/不正」バッジ用のヘルパー。

  function readTodayUniqueCorrect() {
    try {
      const dayPlay = getTodayYYYYMMDD_JST();
      if (!dayPlay) return 0;
      const v = localStorage.getItem(`cscs_daily_unique_done:${dayPlay}`);
      return v === "1" ? 1 : 0;
    } catch {
      return 0;
    }
  }
  function readTodayUniqueWrong() {
    try {
      const dayPlay = getTodayYYYYMMDD_JST();
      if (!dayPlay) return 0;
      const n = parseInt(localStorage.getItem(`cscs_wrong_attempts_${dayPlay}`) || "0", 10);
      return (Number.isFinite(n) && n > 0) ? 1 : 0;
    } catch {
      return 0;
    }
  }

  // ===== 集計ユーティリティ =====
  // 柔軟に: {counted}, {total}, {sum}, {raw}, {unique} のいずれでも拾う

  // 日次ログオブジェクトを受け取り、total / counted / sum のどれかにある値を合算して
  // 「延べ回数」を求める
  function sumField(obj) {
    return Object.values(obj).reduce((acc, v) => {
      if (!v || typeof v !== "object") return acc;
      if (Number.isFinite(v.total))   return acc + v.total;
      if (Number.isFinite(v.counted)) return acc + v.counted;
      if (Number.isFinite(v.sum))     return acc + v.sum;
      return acc;
    }, 0);
  }

  // ログオブジェクトから「ユニークな問題数」を推定
  function uniqueProblemCount(obj) {
    // 1) 配列（qids / unique / rawIds）があれば、そのユニーク件数を返す
    const set = new Set();
    for (const v of Object.values(obj)) {
      if (!v || typeof v !== "object") continue;
      const cands = [];
      if (Array.isArray(v.qids))   cands.push(...v.qids);
      if (Array.isArray(v.unique)) cands.push(...v.unique);
      if (Array.isArray(v.rawIds)) cands.push(...v.rawIds);
      for (const id of cands) if (id != null) set.add(String(id));
    }
    if (set.size > 0) return set.size;

    // 2) 配列が無いログ構造:
    //    数値フィールド raw を合算して「ユニーク問題数の近似値」として扱う
    //    例: { "20250926": { raw: 3, counted: 1 } }
    return Object.values(obj).reduce((acc, v) => {
      const n = (v && typeof v === "object" && Number.isFinite(v.raw)) ? v.raw : 0;
      return acc + n;
    }, 0);
  }

  // 全体の統計値を一括計算
  function computeStats() {
    const cd = JSON.parse(localStorage.getItem("cscs_correct_daily_log") || "{}");
    const wd = JSON.parse(localStorage.getItem("cscs_wrong_daily_log")  || "{}");

    const correctTotal = sumField(cd);   // 正解の延べ回数
    const wrongTotal   = sumField(wd);   // 不正解の延べ回数

    // ユニーク問題数（配列があればそれを信頼、無ければ raw を使った近似）
    const correctRaw = uniqueProblemCount(cd);
    const wrongRaw   = uniqueProblemCount(wd);

    // 記録日数 = 正解ログ / 不正ログのキーの和集合
    const days = new Set([...Object.keys(cd), ...Object.keys(wd)]).size;

    return { cd, wd, correctTotal, wrongTotal, correctRaw, wrongRaw, days };
  }

  // 全体集計をダイアログ＆コンソールに表示
  function showStats() {
    const { correctTotal, wrongTotal, correctRaw, wrongRaw, days, cd, wd } = computeStats();

    const rows = [
      { type: "✅ 正解（延べ）",           value: correctTotal },
      { type: "❌ 不正解（延べ）",         value: wrongTotal },
      { type: "🟩 正解（ユニーク問題数）", value: correctRaw },
      { type: "🟥 不正解（ユニーク問題数）", value: wrongRaw },
      { type: "📅 記録日数",               value: days },
    ];

    console.group("[CSCS] 集計情報");
    console.table(rows);
    console.log("正解 日次ログ (cscs_correct_daily_log):", cd);
    console.log("不正 日次ログ (cscs_wrong_daily_log):",  wd);
    console.groupEnd();

    alert([
      `✅ 正解（延べ）: ${correctTotal}`,
      `❌ 不正解（延べ）: ${wrongTotal}`,
      `🟩 正解（ユニーク問題数）: ${correctRaw}`,
      `🟥 不正解（ユニーク問題数）: ${wrongRaw}`,
      `📅 記録日数: ${days}`,
      "",
      "※ 詳細はブラウザのコンソール (console) を確認してください。"
    ].join("\n"));
  }

  // ===== モーダル（簡易） =====
  // 「この問題だけ」の累計正解/不正解カウンタをリセットする確認モーダル
  function openResetPanel(qid, correct, wrong) {
    // 既存のモーダルがあれば消してから作り直す
    const old = document.getElementById("cscs-reset-modal");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    // 画面全体を覆うオーバーレイ
    const overlay = document.createElement("div");
    overlay.id = "cscs-reset-modal";
    overlay.style.cssText = [
      "position:fixed","inset:0","z-index:999999",
      "background:rgba(0,0,0,.5)","display:flex",
      "align-items:center","justify-content:center"
    ].join(";");

    // 実際のパネル本体
    const panel = document.createElement("div");
    panel.style.cssText = [
      "min-width:320px","max-width:90vw","background:#1c1c1c",
      "color:#fff","border-radius:10px","padding:16px",
      "box-shadow:0 10px 30px rgba(0,0,0,.4)","font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,sans-serif"
    ].join(";");

    // パネル内容（qid と現在の累計表示、リセット説明、ボタン）
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">回数記録のリセット</div>
      <div style="opacity:.9;margin-bottom:12px;">
        <div style="margin-bottom:4px;">qid: <code>${qid}</code></div>
        <div style="margin-bottom:8px;">現在の累計（延べ）：<b>正解:${correct}回 / 不正解:${wrong}回</b></div>
        <div>この問題のみの正誤回数（<code>cscs_q_correct_total:${qid}</code> / <code>cscs_q_wrong_total:${qid}</code>）を削除します。</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="cscs-reset-cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #555;background:#2b2b2b;color:#ddd;cursor:pointer; width: 130px;">キャンセル</button>
        <button type="button" id="cscs-reset-do" style="padding:8px 12px;border-radius:8px;border:0 solid #c33;background:#a35757;color:#fff;cursor:pointer; width: 130px;">回数記録のリセット</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // モーダルを閉じる共通関数
    function close() {
      try { overlay.remove(); } catch(_){}
    }

    // キャンセルボタン
    panel.querySelector("#cscs-reset-cancel").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });

    // リセット実行ボタン
    panel.querySelector("#cscs-reset-do").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // この問題だけの累計 key を削除
      try { localStorage.removeItem(`cscs_q_correct_total:${qid}`); } catch(_){}
      try { localStorage.removeItem(`cscs_q_wrong_total:${qid}`); } catch(_){}
      close();
      // コンソールにログを出しつつ、表示を更新
      try { console.info("[reset] cleared per-problem totals", { qid }); } catch(_){}
      render();
    });

    // オーバーレイの透過部分をクリックしたら閉じる
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  // ===== 描画 =====
  // 左上 box に「お気に入りステータス」「この問題の正解/不正解累計」を表示し、
  // 正解/不正解部分をクリックでリセットモーダルを開くようにする
  function render() {
    // 当該1問の QID を pathname から復元（A/B両方対応）
    const dayPath = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1] || "";
    const n3 = (location.pathname.match(/q(\d{3})_[ab]/i) || [])[1] || "";
    const qid = dayPath && n3 ? `${dayPath}-${n3}` : "";

    // この問題の「累計（延べ）」を b_judge_record.js 準拠のキーから取得
    const correct = qid ? parseInt(localStorage.getItem(`cscs_q_correct_total:${qid}`) || "0", 10) : 0;
    const wrong   = qid ? parseInt(localStorage.getItem(`cscs_q_wrong_total:${qid}`)   || "0", 10) : 0;

    // box と中の要素を取得（無ければ生成）
    const box = ensureFixedBox();
    const favSpan   = box.querySelector(".fav-status");
    const wrongLink = box.querySelector(".wrong-status");

    // ★ お気に入り表示は fav_modal.js に委譲
    try {
      if (favSpan && window.CSCS_FAV && typeof window.CSCS_FAV.renderStatusBadge === "function") {
        window.CSCS_FAV.renderStatusBadge();
      }
    } catch(_) {}

    // 正解/不正解のリンク表示と挙動を設定
    if (wrongLink) {
      // 表示（リンク） ※文言から「回」は削除
      wrongLink.textContent = `(正解:${correct} / 不正解:${wrong})`;
      wrongLink.setAttribute("title", qid ? `qid: ${qid} の累計（延べ）` : `qid未特定（パス判定不可）`);
      wrongLink.setAttribute("href", "#");

      // クリックで当該問題のリセットモーダルを開く
      wrongLink.onclick = (e) => {
        e.preventDefault();
        if (!qid) return;
        openResetPanel(qid, correct, wrong);
      };
    }
  }

  // ===== 監視 =====
  // DOM構築完了時・storageイベント・タブ復帰・定期タイマーで render を回し続ける

  // 初期描画
  window.addEventListener("DOMContentLoaded", render);

  // 他タブなどから localStorage が書き換わったときも再描画
  window.addEventListener("storage", render);

  // タブ復帰時（非表示→可視）に再描画
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });

  // 2秒おきに再描画（保険としてのポーリング）
  setInterval(render, 2000);
})();