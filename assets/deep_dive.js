// =============================================================
// CSCS Deep Dive（ススム専用・全リビルド版）
// ・APIキーはブラウザで絶対に扱わない
// ・/api/deep-dive（Worker）が Gemini を代理実行
// ・dd-toggle ボタン＋dd-panel を自動生成して利用
// ・類似問題検索は IndexedDB のDBを利用
// ・過去のAPI UI関連はすべて撤去
// =============================================================

(function () {
  "use strict";

  // =============================================================
  // 起動
  // =============================================================
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("dd-toggle");
    if (!btn) return;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const panel = ensurePanel();

      // 開閉
      const opened = panel.style.display === "block";
      if (opened) {
        panel.style.display = "none";
        document.documentElement.removeAttribute("data-dd-open");
        return;
      }

      panel.style.display = "block";
      document.documentElement.setAttribute("data-dd-open", "1");
      await runDeepDive(panel);
    });
  });

  // =============================================================
  // パネル生成
  // =============================================================
  function ensurePanel() {
    let panel = document.getElementById("dd-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "dd-panel";
      Object.assign(panel.style, {
        position: "fixed",
        left: "16px",
        right: "16px",
        top: "12px",
        bottom: "12px",
        background: "rgba(0,0,0,0.86)",
        border: "1px solid #333",
        borderRadius: "12px",
        padding: "16px",
        overflow: "auto",
        zIndex: 999999,
        display: "none",
        color: "#eee",
        fontSize: "15px",
        lineHeight: 1.6,
      });
      document.body.appendChild(panel);

      // 閉じるボタン
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✖ Close";
      Object.assign(closeBtn.style, {
        position: "absolute",
        right: "12px",
        top: "12px",
        background: "#333",
        border: "1px solid #666",
        color: "#eee",
        padding: "4px 10px",
        borderRadius: "6px",
        cursor: "pointer",
      });
      closeBtn.onclick = () => {
        panel.style.display = "none";
        document.documentElement.removeAttribute("data-dd-open");
      };
      panel.appendChild(closeBtn);

      const body = document.createElement("div");
      body.id = "dd-body";
      body.style.marginTop = "40px";
      panel.appendChild(body);
    }
    return panel;
  }

  // =============================================================
  // Deep Dive 実行
  // =============================================================
  async function runDeepDive(panel) {
    const body = panel.querySelector("#dd-body");
    body.innerHTML =
      `<div><span class="dd-spinner" style="border:2px solid #777;border-top-color:#fff;border-radius:50%;width:20px;height:20px;display:inline-block;animation:ddspin 1s linear infinite;"></span> 生成中…</div>`;

    const meta = readMeta();
    const dom = readDomForPrompt();
    const similar = await findSimilarQuestions(dom.question);

    const prompt = buildPrompt(meta, dom, similar);

    let output = "";
    try {
      output = await callWorker(prompt);
    } catch (e) {
      output = `<div style="color:#faa">エラー: ${String(e.message || e)}</div>`;
    }

    body.innerHTML = output || "<div>(空の出力)</div>";
  }

  // =============================================================
  // メタ情報の取得（cscs-meta）
  // =============================================================
  function readMeta() {
    try {
      const el = document.getElementById("cscs-meta");
      if (!el) return { field: "", theme: "", tags: {} };
      return JSON.parse(el.textContent || "{}");
    } catch {
      return { field: "", theme: "", tags: {} };
    }
  }

  // =============================================================
  // DOMから問題文と選択肢と正解を取得
  // =============================================================
  function readDomForPrompt() {
    const q = document.querySelector("h1");
    const question = q ? q.textContent.trim() : "";

    const opts = Array.from(
      document.querySelectorAll("ol.opts li")
    ).map((li, i) => `${String.fromCharCode(65 + i)}) ${li.textContent.trim()}`);

    const ansEls = Array.from(document.querySelectorAll(".answer"));
    let correct = "";
    for (const el of ansEls) {
      const m = (el.innerHTML || "").match(/正解\s*[:：]\s*([A-DＡ-Ｄ])/);
      if (m) {
        correct = m[1].replace(/[Ａ-Ｄ]/g, (z) =>
          String.fromCharCode(z.charCodeAt(0) - 0xfee0)
        );
        break;
      }
    }

    return { question, opts, correct };
  }

  // =============================================================
  // IndexedDB: 類似問題検索
  // =============================================================
  async function openMetaDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("cscs_meta", 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains("qmeta")) {
          db.createObjectStore("qmeta", { keyPath: "qid" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllMeta(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("qmeta", "readonly");
      const st = tx.objectStore("qmeta");
      const out = [];
      const req = st.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          out.push(cur.value);
          cur.continue();
        } else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function findSimilarQuestions(text) {
    try {
      const db = await openMetaDB();
      const all = await getAllMeta(db);
      if (!text) return [];

      const key = text.slice(0, 10);
      return all.filter((x) => x.question && x.question.includes(key)).slice(0, 6);
    } catch {
      return [];
    }
  }

  // =============================================================
  // Deep Dive Prompt 生成
  // =============================================================
  function buildPrompt(meta, dom, similarList) {
    const opts = dom.opts.join("\n");
    const similar = similarList
      .map((x) => `- ${x.qid}: ${x.question}`)
      .join("\n");

    return `
あなたはNSCA-CSCSの専門コーチです。
以下の問題と選択肢・正解を因果関係で深掘りし、理解を助ける解説を作成してください。

【分野】${meta.field || ""}
【テーマ】${meta.theme || ""}

【設問】
${dom.question}

【選択肢】
${opts}

【正解】
${dom.correct}

【類似問題（参考）】
${similar || "なし"}

# 出力形式（HTML）
<section><h3>上流（原因・原理）</h3><p>…</p></section>
<section><h3>中流（過程・理解の要点）</h3><p>…</p></section>
<section><h3>下流（結果・実践例・誤解ポイント）</h3><p>…</p></section>
<section><h3>この問題への当てはめ</h3><p>…</p></section>

・専門用語は <span class="dd-key">…</span> で強調
・正解根拠は <span class="dd-answer">…</span> で強調
・HTMLのみを返す（前置き禁止）
    `.trim();
  }

  // =============================================================
  // Worker /api/deep-dive 呼び出し
  // =============================================================
  async function callWorker(prompt) {
    const res = await fetch("/api/deep-dive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const j = await res.json().catch(() => ({}));
    return j.output || "";
  }

  // =============================================================
  // CSS アニメーション
  // =============================================================
  const spin = document.createElement("style");
  spin.textContent = `
@keyframes ddspin { to{ transform:rotate(360deg) } }
`;
  document.head.appendChild(spin);
})();
