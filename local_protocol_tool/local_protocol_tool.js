// local_protocol_tool.js
//
// ============================================================
// ★ このツールは 3ファイル密結合（HTML / JS / PY）で動く
// ------------------------------------------------------------
// 目的:
//   local_protocol_tool.html / local_protocol_tool.js / local_protocol_tool.py は
//   それぞれ単体ではなく「1つの道具」として設計されている。
//   ChatGPT などが修正する際に “JSだけ直して終わり” にならないよう、
//   連動点（契約）をここに明示する。
//
// 役割分担:
//   - local_protocol_tool.html : UIのDOM（id="..."）定義。JSはDOM idに強く依存。
//   - local_protocol_tool.js   : UIロジック。/api/* を叩き、localStorageへUI状態保存。
//   - local_protocol_tool.py   : ローカルHTTPサーバ。/api/split /api/extract /api/check
//                               /api/instructions* を提供し、出力保存（out_*）も担う。
//
// このJSが依存する “契約（変えるなら3ファイル同時に見る）”:
//   1) DOM id 契約（HTML）
//      例: #instruction, #file, #run, #runExtract, #extractPreview,
//          #instructionHistory, #taskIdHistoryList, #extractNotFoundLog など。
//      → HTML側で id を変えると、このJSは即死する。
//
//   2) API 契約（PY）
//      - POST /api/split        : {
//                                  files:[{ filename, content }],
//                                  prefix, lang, maxchars, maxlines, maxlogs,
//                                  split_mode, iife_grace_ratio, instruction
//                                }
//                                → { session_id, parts:[{part_id,index,total,payload,part_sha8...}] }
//      - POST /api/extract      : {
//                                  sources:[{ filename, content }],
//                                  extract_from:[{ filename, content }],
//                                  symbols[], needles[], context_lines, max_matches
//                                }
//                                → { ok, blocks:[...] }
//      - POST /api/check        : { filename, content } → { ok, error? }
//      - GET  /api/instructions : 履歴一覧（outroot/dirs/items）
//      - POST /api/instructions/delete / GET /api/instructions/original
//      → PY側のレスポンス形が変わると、履歴UIやコピー系が壊れる。
//
//   3) 出力フォーマット契約（PY→JS→ユーザー貼り付け）
//      - split: <<<PART_BEGIN>>> / PartID / SHA256 等のヘッダを含む“貼り付け用プロトコル”
//      - extract: <<<EXTRACT_BEGIN>>>..<<<EXTRACT_END>>> を基本とし、
//                 このJSは FOUND:false を「コピー対象外ログ」に分離する運用を担う。
//      → 表示/コピー対象の境界仕様を変える時は JS/HTML/PY を必ず同時に確認する。
// ============================================================

  const $ = (id) => document.getElementById(id);

  const TASK_ID_HISTORY_KEY = "protocol_splitter_task_id_history_v1";
  const TASK_ID_HISTORY_MAX = 40;

  /* 追加: extract symbols / needles の履歴 */
  const EXTRACT_SYMBOLS_HISTORY_KEY = "protocol_splitter_extract_symbols_history_v1";
  const EXTRACT_NEEDLES_HISTORY_KEY = "protocol_splitter_extract_needles_history_v1";
  const EXTRACT_TEXT_HISTORY_MAX = 40;

  function loadTaskIdHistory() {
    try {
      const raw = localStorage.getItem(TASK_ID_HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(x => String(x || "").trim()).filter(x => x);
    } catch (e) {
      return [];
    }
  }

  function saveTaskIdHistory(arr) {
    try {
      const uniq = [];
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        const v = String(arr[i] || "").trim();
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        uniq.push(v);
        if (uniq.length >= TASK_ID_HISTORY_MAX) break;
      }
      localStorage.setItem(TASK_ID_HISTORY_KEY, JSON.stringify(uniq));
    } catch (e) {}
  }

  /* 追加: text履歴（symbols/needles）共通 */
  function loadTextHistory(storageKey) {
    try {
      const raw = localStorage.getItem(String(storageKey || ""));
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(x => String(x || "").trim()).filter(x => x);
    } catch (e) {
      return [];
    }
  }

  function saveTextHistory(storageKey, arr, maxN) {
    try {
      const lim = (typeof maxN === "number" && isFinite(maxN) && maxN > 0) ? Math.floor(maxN) : EXTRACT_TEXT_HISTORY_MAX;

      const uniq = [];
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        const v = String(arr[i] || "").trim();
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        uniq.push(v);
        if (uniq.length >= lim) break;
      }

      localStorage.setItem(String(storageKey || ""), JSON.stringify(uniq));
    } catch (e) {}
  }

  function rememberTextHistory(storageKey, v) {
    const s = String(v || "").trim();
    if (!s) return;

    const hist = loadTextHistory(storageKey);
    const next = [s].concat(hist);
    saveTextHistory(storageKey, next, EXTRACT_TEXT_HISTORY_MAX);
  }

  function refreshTaskIdDatalist() {
    const dl = $("taskIdHistoryList");
    if (!dl) return;

    dl.innerHTML = "";
    const hist = loadTaskIdHistory();

    for (let i = 0; i < hist.length; i++) {
      const opt = document.createElement("option");
      opt.value = hist[i];
      dl.appendChild(opt);
    }
  }

  function rememberTaskId(v) {
    const s = String(v || "").trim();
    if (!s) return;

    const hist = loadTaskIdHistory();
    const next = [s].concat(hist);
    saveTaskIdHistory(next);
    refreshTaskIdDatalist();
  }

  function buildMetaRulesBlock(projectId, taskId) {
    const p = String(projectId || "").trim();
    const t = String(taskId || "").trim();

    const lines = [];
    lines.push("<<<TASK_META_BEGIN>>>");
    lines.push("PROJECT_ID: " + (p ? p : "(unset)"));
    lines.push("TASK_ID: " + (t ? t : "(unset)"));
    lines.push("");
    lines.push("【いつものルール】");
    lines.push("・参照元と同じインデントで「置換前／置換後」を明確に分けて提示");
    lines.push("・\"...\" や（中略）など省略は絶対に無し（該当箇所は完全形で）");
    lines.push("・置換前コードブロックに“本文に無いコメント”は入れない");
    lines.push("・フォールバック/保険/自動互換コードは勝手に追加しない");
    lines.push("・必要なら『どのファイルの、何を、何のために直すか』を明示");
    lines.push("<<<TASK_META_END>>>");
    lines.push("");
    return lines.join("\n");
  }

  function upsertMetaRulesIntoInstruction(metaBlock) {
    const ta = $("instruction");
    if (!ta) return;

    const cur = String(ta.value || "");
    const begin = "<<<TASK_META_BEGIN>>>";
    const end = "<<<TASK_META_END>>>";

    const i0 = cur.indexOf(begin);
    const i1 = cur.indexOf(end);

    if (i0 !== -1 && i1 !== -1 && i1 > i0) {
      const afterEnd = i1 + end.length;
      const before = cur.slice(0, i0);
      const after = cur.slice(afterEnd);

      const cleanedAfter = after.replace(/^\s*\n/, "\n").replace(/^\s*\r?\n/, "\n");
      ta.value = String(before || "") + metaBlock + String(cleanedAfter || "");
    } else {
      if (cur.trim() === "") ta.value = metaBlock;
      else ta.value = metaBlock + cur;
    }

    autosizeInstruction();
    saveUiState();
  }

  function loadUiState() {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function saveUiState() {
    try {
      const s = {
        prefix: String(($("prefix") && $("prefix").value) || ""),
        lang: String(($("lang") && $("lang").value) || ""),
        maxchars: Number(($("maxchars") && $("maxchars").value) || 0),
        maxlines: Number(($("maxlines") && $("maxlines").value) || 0),
        maxlogs: Number(($("maxlogs") && $("maxlogs").value) || 0),
        splitMode: String(($("splitMode") && $("splitMode").value) || "C"),

        /* 追加: project_id / task_id（instruction注入用） */
        projectId: String(($("projectId") && $("projectId").value) || ""),
        taskId: String(($("taskId") && $("taskId").value) || ""),

        instruction: String(($("instruction") && $("instruction").value) || ""),
        uiMode: String((window.__uiMode || "split")),
        extractSymbols: String(($("extractSymbols") && $("extractSymbols").value) || ""),
        extractNeedles: String(($("extractNeedles") && $("extractNeedles").value) || ""),
        /* 追加した処理: splitで得た session_id を extractヘッダへ必ず出すため、UI状態として保存 */
        extractSessionId: String(($("extractSessionId") && $("extractSessionId").value) || ""),
        /* 追加した処理: splitの instruction 原文（EXEC_TASK）を extractヘッダへ必ず出すため、UI状態として保存 */
        extractExecTask: String(($("extractExecTask") && $("extractExecTask").value) || ""),
        /* 追加した処理: 抽出結果に PURPOSE を確実に添えるため、UI状態として保存 */
        extractPurpose: String(($("extractPurpose") && $("extractPurpose").value) || ""),
        /* 追加した処理: 抽出結果に DEPENDS を確実に添えるため、UI状態として保存 */
        extractDepends: String(($("extractDepends") && $("extractDepends").value) || ""),
        extractContextLines: Number(($("extractContextLines") && $("extractContextLines").value) || 25),
        extractMaxMatches: Number(($("extractMaxMatches") && $("extractMaxMatches").value) || 50),
        /* 追加した処理: 「コードのみ（厳格）」スイッチもUI状態として保存し、毎回の操作ブレを防ぐ */
        extractCodeOnly: !!(($("extractCodeOnly") && $("extractCodeOnly").checked) ? true : false),
        currentIndex: Number(currentIndex || 0),
        previewAllOn: !!previewAllOn,
        /* 追加した処理: extract結果の全文表示/一部表示（ALL: OFF/ON）状態も保存する */
        extractPreviewAllOn: !!extractPreviewAllOn,

        /* 追加した処理: extractPreview の文字サイズ(px)も保存する */
        extractPreviewFontPx: Number(($("extractPreviewFont") && $("extractPreviewFont").value) || 14),

        /* 追加: 読み込んだファイルのチェック状態を保存（nameで紐付け） */
        fileChecks: (function(){
          const arr = [];
          for (let i = 0; i < fileEntries.length; i++) {
            const e = fileEntries[i] || {};

            const name = String(e.name || "");
            const size = Number(e.size || 0);
            const lastModified = Number(e.lastModified || 0);

            const key = (typeof e.key === "string" && e.key)
              ? String(e.key)
              : (name + "|" + String(size) + "|" + String(lastModified));

            arr.push({
              key: key,
              name: name,
              size: size,
              lastModified: lastModified,
              sourceChecked: !!e.sourceChecked,
              extractFromChecked: !!e.extractFromChecked
            });
          }
          return arr;
        })(),
      };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function restoreUiState() {
    const s = loadUiState();
    if (!s) {
      /* 初回（UI_STATEが無い）だけ: CODE_ONLY をデフォルトONにする */
      if ($("extractCodeOnly")) {
        $("extractCodeOnly").checked = true;
      }
      saveUiState();
      return;
    }

    if ($("prefix") && typeof s.prefix === "string" && s.prefix) {
      $("prefix").value = s.prefix;
    }
    if ($("lang") && typeof s.lang === "string" && s.lang) {
      $("lang").value = s.lang;
    }
    if ($("maxchars") && typeof s.maxchars === "number" && s.maxchars > 0) {
      $("maxchars").value = String(s.maxchars);
    }
    if ($("maxlines") && typeof s.maxlines === "number" && s.maxlines > 0) {
      $("maxlines").value = String(s.maxlines);
    }
    if ($("maxlogs") && typeof s.maxlogs === "number" && s.maxlogs > 0) {
      $("maxlogs").value = String(s.maxlogs);
    }

    if ($("splitMode") && typeof s.splitMode === "string" && s.splitMode) {
      $("splitMode").value = s.splitMode;

      const radios = document.querySelectorAll('input[name="splitModeRadio"]');
      for (let i = 0; i < radios.length; i++) {
        const r = radios[i];
        const v = String(r && r.value ? r.value : "");
        r.checked = (v === s.splitMode);
      }
    }

    /* 追加: project_id / task_id を復元（ID注入が毎回ゼロからにならないようにする） */
    if ($("projectId") && typeof s.projectId === "string") {
      $("projectId").value = s.projectId;
    }
    if ($("taskId") && typeof s.taskId === "string") {
      $("taskId").value = s.taskId;
    }

    if ($("instruction") && typeof s.instruction === "string") {
      $("instruction").value = s.instruction;
    }

    if ($("extractSymbols") && typeof s.extractSymbols === "string") {
      $("extractSymbols").value = s.extractSymbols;
    }
    if ($("extractNeedles") && typeof s.extractNeedles === "string") {
      $("extractNeedles").value = s.extractNeedles;
    }
    /* 追加した処理: SESSION_ID / EXEC_TASK も復元して、split→extract の往復で情報が消えないようにする */
    if ($("extractSessionId") && typeof s.extractSessionId === "string") {
      $("extractSessionId").value = s.extractSessionId;
    }
    if ($("extractExecTask") && typeof s.extractExecTask === "string") {
      $("extractExecTask").value = s.extractExecTask;
    }
    /* 追加した処理: PURPOSE / DEPENDS も復元して、抽出コピーの定型が崩れないようにする */
    if ($("extractPurpose") && typeof s.extractPurpose === "string") {
      $("extractPurpose").value = s.extractPurpose;
    }
    if ($("extractDepends") && typeof s.extractDepends === "string") {
      $("extractDepends").value = s.extractDepends;
    }
    if ($("extractContextLines") && (typeof s.extractContextLines === "number" || typeof s.extractContextLines === "string")) {
      const v = Number(s.extractContextLines);
      if (isFinite(v) && v >= 0) $("extractContextLines").value = String(v);
    }
    if ($("extractMaxMatches") && (typeof s.extractMaxMatches === "number" || typeof s.extractMaxMatches === "string")) {
      const v = Number(s.extractMaxMatches);
      if (isFinite(v) && v > 0) $("extractMaxMatches").value = String(v);
    }

    /* 追加した処理: 「コードのみ（厳格）」スイッチも復元する（ON/OFFを保持） */
    if ($("extractCodeOnly") && typeof s.extractCodeOnly === "boolean") {
      $("extractCodeOnly").checked = !!s.extractCodeOnly;
    }

    if (typeof s.previewAllOn === "boolean") {
      previewAllOn = s.previewAllOn;
    }

    /* 追加した処理: extract結果の全文表示/一部表示（ALL: OFF/ON）状態も復元する */
    if (typeof s.extractPreviewAllOn === "boolean") {
      extractPreviewAllOn = s.extractPreviewAllOn;
    }

    /* 追加した処理: extractPreview の文字サイズ(px)も復元する */
    (function(){
      const slider = $("extractPreviewFont");
      const label  = $("extractPreviewFontLabel");
      const ta     = $("extractPreview");

      let px = 14;
      if (typeof s.extractPreviewFontPx === "number" || typeof s.extractPreviewFontPx === "string") {
        const v = Number(s.extractPreviewFontPx);
        if (isFinite(v) && v >= 10 && v <= 28) px = v;
      }

      if (slider) slider.value = String(px);
      if (label)  label.textContent = String(px) + "px";
      if (ta)     ta.style.fontSize = String(px) + "px";
    })();

    if (typeof s.uiMode === "string" && s.uiMode) {
      window.__uiMode = s.uiMode;
    } else {
      window.__uiMode = "split";
    }

    // 追加: fileChecks は FileList 読み込み後に適用する（ここでは保持だけ）
    window.__savedFileChecks = (s && Array.isArray(s.fileChecks)) ? s.fileChecks : [];
  }

  function restoreUiStatePostResult() {
    const s = loadUiState();
    if (!s) return;

    if (typeof s.currentIndex === "number" && isFinite(s.currentIndex)) {
      const idx = Math.max(0, Math.floor(s.currentIndex));
      if (result && result.parts && result.parts.length > 0) {
        currentIndex = Math.min(idx, result.parts.length - 1);
      } else {
        currentIndex = 0;
      }
    }
  }

  function autosizeInstruction() {
    const ta = $("instruction");
    if (!ta) return;

    ta.style.height = "auto";
    const next = ta.scrollHeight;
    ta.style.height = String(next) + "px";
  }

  function setFilesFromDrop(fileList) {
    const input = $("file");
    if (!input) return;

    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;

    // 拡張子フィルタ（非対応は弾く）
    const ok = [];
    const ng = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = String(f && f.name ? f.name : "");
      const okExt = /\.(js|mjs|cjs|txt)$/i.test(name);
      if (okExt) ok.push(f);
      else ng.push(name);
    }

    if (ok.length === 0) {
      setStatus("非対応の拡張子のみでした（.js/.mjs/.cjs/.txt）: " + ng.join(", "));
      return;
    }

    const dt = new DataTransfer();
    for (let i = 0; i < ok.length; i++) dt.items.add(ok[i]);
    input.files = dt.files;

    // entries 再構築（同名でも別扱いになるが、実運用では同名は避ける想定）
    fileEntries = [];
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i];

      const name = String(f.name || "");
      const size = Number(f.size || 0);
      const lastModified = Number(f.lastModified || 0);
      const key = name + "|" + String(size) + "|" + String(lastModified);

      fileEntries.push({
        key: key,
        name: name,
        file: f,
        size: size,
        lastModified: lastModified,
        sourceChecked: false,
        extractFromChecked: false,
        syntaxOk: null,
        syntaxMsg: ""
      });
    }

    // 保存済みチェック状態を適用（name一致）
    (function applySavedChecks(){
      const saved = Array.isArray(window.__savedFileChecks) ? window.__savedFileChecks : [];
      if (!saved || saved.length === 0) return;

      for (let i = 0; i < fileEntries.length; i++) {
        const e = fileEntries[i];

        const eKey = (e && typeof e.key === "string" && e.key) ? String(e.key) : "";
        const eName = String(e && e.name ? e.name : "");

        for (let k = 0; k < saved.length; k++) {
          const s = saved[k] || {};

          const sKey = (typeof s.key === "string" && s.key) ? String(s.key) : "";
          const sName = String(s.name || "");

          const matched = (sKey && eKey) ? (sKey === eKey) : (sName === eName);
          if (matched) {
            e.sourceChecked = !!s.sourceChecked;
            e.extractFromChecked = !!s.extractFromChecked;
            break;
          }
        }
      }
    })();

    setAllChecksIfEmpty();
    renderJsFileList();
    saveUiState();

    setStatus("ファイル読み込み: " + ok.map(f => String(f.name || "")).join(", ") + "（ドラッグ&ドロップ）");

    // 構文チェック（全ファイル）
    (function(){
      for (let i = 0; i < ok.length; i++) {
        runSyntaxCheckForFile(ok[i]);
      }
    })();
  }

  window.addEventListener("dragover", (ev) => {
    ev.preventDefault(); /* drop を有効化する */
    document.body.classList.add("dragover"); /* ドラッグ中の視覚表現 */
  });

  window.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    document.body.classList.remove("dragover"); /* ドラッグ終了で解除 */
  });

  window.addEventListener("drop", (ev) => {
    ev.preventDefault(); /* ブラウザのデフォルト（開く/移動）を抑止する */
    document.body.classList.remove("dragover"); /* ドラッグ表現を解除 */

    const files = ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : null;
    if (!files || files.length === 0) {
      setStatus("ドロップされたファイルが見つかりません");
      return;
    }

    setFilesFromDrop(files); /* 複数扱う */
  });

  let result = null;
  let currentIndex = 0;

  let previewAllOn = false;

  /* 追加した処理: extract結果は常に全文表示にする（折りたたみ無し） */
  let extractPreviewAllOn = true;

  /* extract結果（<<<EXTRACT_BEGIN>>>..<<<EXTRACT_END>>>）を保持してコピーできるようにする */
  let lastExtractText = "";

  /* extract表示の折りたたみ上限（先頭何行まで見せるか） */
  const EXTRACT_PREVIEW_HEAD_MAX_LINES = 18;

  /* extract表示の折りたたみ上限（行数で切った後の保険：文字数） */
  const EXTRACT_PREVIEW_HEAD_MAX_CHARS = 1800;

  function buildExtractPreviewText(fullText) {
    /*
     * 何をしているか:
     *   - extract結果は常に全文表示に固定する（折りたたみ無し）。
     *   - 既存の ALL: OFF/ON ロジックは保持していても表示は常に全文になる。
     */
    const s = String(fullText || "");
    return s;
  }

  function updateToggleExtractAllButton() {
    const btn = $("toggleExtractAll");
    if (!btn) return;

    /*
     * 何をしているか:
     *   - extract結果は常に全文表示に固定するため、ALL切替ボタンは常に無効化する。
     *   - ただし「コピー」「リセット」は抽出結果がある時だけ押せるように維持する。
     */
    const ta = $("extractPreview");
    const hasLast = (String(lastExtractText || "").length > 0);
    const hasTA = !!(ta && String(ta.value || "").trim() !== "");

    const enabled = (hasLast || hasTA);

    /* ALL 切替は使わない（常に全文表示） */
    btn.disabled = true;
    btn.textContent = "ALL: ON";

    /* extractPreviewAllOn も常に true に寄せる（UI状態復元で false になっても戻す） */
    extractPreviewAllOn = true;

    /* 追加した処理: extract結果がある時だけ Copy/Reset も押せるようにする */
    const btnCopy = $("copyExtract");
    if (btnCopy) btnCopy.disabled = !enabled;

    const btnReset = $("resetExtract");
    if (btnReset) btnReset.disabled = !enabled;
  }

  function renderExtractPreview() {
    const ta = $("extractPreview");
    if (!ta) return;

    /* 追加した処理: extract結果の表示は「全文 or 先頭のみ」を buildExtractPreviewText で統一する */
    ta.value = buildExtractPreviewText(lastExtractText);

    updateToggleExtractAllButton();
  }

  /* 追加した処理: extract結果カードの ALL: OFF/ON ボタンを動作させる */
  (function(){
    const btn = $("toggleExtractAll");
    if (!btn) return;

    btn.onclick = () => {
      /*
       * 何をしているか:
       *   - extractPreviewAllOn を反転
       *   - textarea 表示を再描画
       *   - UI状態を保存
       */
      extractPreviewAllOn = !extractPreviewAllOn;
      renderExtractPreview();
      saveUiState();
      setStatus("extract：ALL 表示を切替（" + (extractPreviewAllOn ? "ON" : "OFF") + "）");
    };
  })();

  /* 追加した処理: extractPreview のフォントサイズをスライダーで変更（即反映＋保存） */
  (function(){
    const slider = $("extractPreviewFont");
    const label  = $("extractPreviewFontLabel");
    const ta     = $("extractPreview");

    if (!slider) return;

    function apply(px) {
      const v = Number(px);
      const clamped = Math.max(10, Math.min(28, isFinite(v) ? v : 14));

      if (label) label.textContent = String(clamped) + "px";
      if (ta) ta.style.fontSize = String(clamped) + "px";

      saveUiState();
    }

    slider.addEventListener("input", function(){
      apply(slider.value);
      setStatus("extract：文字サイズを変更（" + String(slider.value) + "px）");
    });

    /* 初期値（HTML側の value=14 を反映） */
    apply(slider.value);
  })();
  
  window.__uiMode = "split";

  function applyUIMode(nextMode) {
    const mode = (String(nextMode || "") === "extract") ? "extract" : "split";
    window.__uiMode = mode;

    const splitBox = $("modeSplitBox");
    const extractBox = $("modeExtractBox");
    const btnSplit = $("modeSplitBtn");
    const btnExtract = $("modeExtractBtn");

    const btnRunSplit = $("run");
    const btnRunExtract = $("runExtract");

    if (splitBox) splitBox.style.display = (mode === "split") ? "" : "none";
    if (extractBox) extractBox.style.display = (mode === "extract") ? "" : "none";

    if (btnRunSplit) btnRunSplit.style.display = (mode === "split") ? "" : "none";
    if (btnRunExtract) btnRunExtract.style.display = (mode === "extract") ? "" : "none";

    const btnCopyExtract = $("copyExtract");
    if (btnCopyExtract) btnCopyExtract.style.display = (mode === "extract") ? "" : "none";

    const btnResetExtract = $("resetExtract");
    if (btnResetExtract) btnResetExtract.style.display = (mode === "extract") ? "" : "none";

    if (btnSplit) {
      if (mode === "split") btnSplit.classList.add("primary");
      else btnSplit.classList.remove("primary");
    }
    if (btnExtract) {
      if (mode === "extract") btnExtract.classList.add("primary");
      else btnExtract.classList.remove("primary");
    }

    /* 追加した処理: extractモード時は「現在のパート」カードを非表示にし、抽出結果カードに切り替える */
    const currentPartCard = $("currentPartCard");
    const extractResultCard = $("extractResultCard");
    if (currentPartCard) currentPartCard.style.display = (mode === "split") ? "" : "none";
    if (extractResultCard) extractResultCard.style.display = (mode === "extract") ? "" : "none";

    /* 追加した処理: extractモードでは split操作ボタンを無効化して誤操作を防ぐ */
    const btnCopyCurrent = $("copyCurrent");
    const btnCopyNext = $("copyNext");
    const btnToggleAll = $("toggleAll");
    if (btnCopyCurrent) btnCopyCurrent.disabled = (mode === "extract") ? true : !!(btnCopyCurrent.disabled && false);
    if (btnCopyNext) btnCopyNext.disabled = (mode === "extract") ? true : !!(btnCopyNext.disabled && false);
    if (btnToggleAll) btnToggleAll.disabled = (mode === "extract") ? true : !!(btnToggleAll.disabled && false);

    saveUiState();

    try {
      if (mode === "split" && $("instruction")) $("instruction").focus();
      if (mode === "extract" && $("extractSymbols")) $("extractSymbols").focus();
    } catch (e) {}
  }

  /* 折りたたみ時の縦サイズ上限（= 先頭何行まで見せるか） */
  const PREVIEW_HEAD_MAX_LINES = 18;

  /* 折りたたみ時の文字数上限（行数で切った後の保険） */
  const PREVIEW_HEAD_MAX_CHARS = 1200;

  function renderPartJumpButtons() {
    const box = $("partJump");
    if (!box) return;

    box.innerHTML = "";

    if (!result || !result.parts || result.parts.length === 0) {
      return;
    }

    for (let i = 0; i < result.parts.length; i++) {
      const p = result.parts[i];

      const btn = document.createElement("button");
      btn.className = "partJumpBtn" + (i === currentIndex ? " primary" : "");
      btn.textContent = String((p && p._display_index) ? (p._display_index) : (i + 1));
      /*
       * 何をしているか:
       *   - ジャンプボタンの番号も _display_index に統一する
       *   - UI内で番号解釈が分岐しないようにする
       */
      btn.onclick = () => {
        currentIndex = i;
        renderCurrent();
        saveUiState();
        setStatus("表示: part_" + String(p.index).padStart(2, "0"));
      };

      box.appendChild(btn);
    }
  }

  function buildPreviewText(fullText) {
    const s = String(fullText || "");
    if (previewAllOn) return s;

    const lines = s.split("\n");
    const headLines = lines.slice(0, PREVIEW_HEAD_MAX_LINES).join("\n");

    let out = headLines;
    if (out.length > PREVIEW_HEAD_MAX_CHARS) {
      out = out.slice(0, PREVIEW_HEAD_MAX_CHARS);
    }

    const isTruncatedByLines = lines.length > PREVIEW_HEAD_MAX_LINES;
    const isTruncatedByChars = headLines.length > PREVIEW_HEAD_MAX_CHARS;

    if (isTruncatedByLines || isTruncatedByChars || out.length < s.length) {
      out += "\n\n…（折りたたみ中：ALL を ON にすると全文表示）";
    }

    return out;
  }

  const HIST_PREVIEW_MAX_LINES = 10;

  function getHistoryMaxCharsByWidth(preEl) {
    /* 幅に応じて省略量を変える（狭いほど短く） */
    try {
      if (!preEl) return 900;

      const rect = preEl.getBoundingClientRect();
      const w = Math.max(0, rect.width);

      /* 履歴preは monospace 11px。だいたい 1文字=7px前後で概算 */
      const approxCharPx = 7;
      const charsPerLine = Math.max(12, Math.floor(w / approxCharPx));

      /* 行数上限×1行文字数に少しバッファ（改行やヘッダ分） */
      const maxChars = (HIST_PREVIEW_MAX_LINES * charsPerLine) + 120;

      /* 極端に大きくしない（広い画面でもダラダラ全文にならない） */
      return Math.min(Math.max(220, maxChars), 2200);
    } catch (e) {
      return 900;
    }
  }

  function buildHistoryPreviewText(fullText, preEl) {
    const s = String(fullText || "");
    const lines = s.split("\n");
    const headLines = lines.slice(0, HIST_PREVIEW_MAX_LINES).join("\n");

    const maxChars = getHistoryMaxCharsByWidth(preEl);

    let out = headLines;
    if (out.length > maxChars) {
      out = out.slice(0, maxChars);
    }

    const isTruncatedByLines = lines.length > HIST_PREVIEW_MAX_LINES;
    const isTruncatedByChars = headLines.length > maxChars;

    if (isTruncatedByLines || isTruncatedByChars || out.length < s.length) {
      out += "\n\n…（省略：このRUNの指示は全文ではありません）";
    }

    return out;
  }

  function updateToggleAllButton() {
    const btn = $("toggleAll");
    if (!btn) return;

    /*
     * 何をしているか:
     *   - Split結果があるか（result.parts）に加えて、
     *     現在プレビューに表示している文字列が空でないかも判定に含める。
     *   - result の参照タイミングや render の順序がズレても、
     *     「表示が出ているなら ALL は押せる」を保証する。
     */
    const pre = $("preview");
    const hasResult = !!(result && result.parts && result.parts.length > 0);
    const hasPreviewText = !!(pre && String(pre.textContent || "").trim() !== "");

    const enabled = (hasResult || hasPreviewText);
    btn.disabled = !enabled;

    if (!enabled) {
      btn.textContent = "ALL: OFF";
      return;
    }

    btn.textContent = previewAllOn ? "ALL: ON" : "ALL: OFF";
  }

  /* 追加した処理: split側（現在のパート）の ALL: OFF/ON ボタンを動作させる */
  (function(){
    const btn = $("toggleAll");
    if (!btn) return;

    btn.onclick = () => {
      /*
       * 何をしているか:
       *   - previewAllOn を反転
       *   - 現在表示中パートの描画をやり直す
       *   - UI状態を保存
       */
      previewAllOn = !previewAllOn;
      renderCurrent();
      saveUiState();
      setStatus("split：ALL 表示を切替（" + (previewAllOn ? "ON" : "OFF") + "）");
    };
  })();


  let fileEntries = []; 
  // [{ name, file, size, lastModified, sourceChecked, extractFromChecked, syntaxOk, syntaxMsg }]

  function getSelectedSourceEntries() {
    return fileEntries.filter(x => x && x.sourceChecked);
  }

  function getSelectedExtractFromEntries() {
    return fileEntries.filter(x => x && x.extractFromChecked);
  }

  function setAllChecksIfEmpty() {
    // 初回読み込み時に何もチェックが無いなら、sourceは全部ONに寄せる（勝手にファイル内容を補う類ではない）
    const any = fileEntries.some(x => x && (x.sourceChecked || x.extractFromChecked));
    if (any) return;
    for (let i = 0; i < fileEntries.length; i++) {
      fileEntries[i].sourceChecked = true;
    }
  }

  function renderJsFileList() {
    const box = $("js_file_list");
    if (!box) return;

    box.innerHTML = "";

    if (!fileEntries || fileEntries.length === 0) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "（まだファイルがありません：ドラッグ＆ドロップ or ファイル選択）";
      box.appendChild(div);
      return;
    }

    for (let i = 0; i < fileEntries.length; i++) {
      const e = fileEntries[i];

      const row = document.createElement("div");
      row.className = "jsfile-row";

      const label = document.createElement("label");
      label.className = "jsfile-name";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = String(e.name || "");

      label.appendChild(nameSpan);

      const chkSrc = document.createElement("input");
      chkSrc.type = "checkbox";
      chkSrc.checked = !!e.sourceChecked;
      chkSrc.addEventListener("change", () => {
        e.sourceChecked = !!chkSrc.checked;
        saveUiState();
      });

      const chkEx = document.createElement("input");
      chkEx.type = "checkbox";
      chkEx.checked = !!e.extractFromChecked;
      chkEx.addEventListener("change", () => {
        const next = !!chkEx.checked;

        // extract_from は “複数選択” を許可する
        e.extractFromChecked = next;

        saveUiState();
      });

      const srcWrap = document.createElement("label");
      srcWrap.className = "jsfile-check";
      srcWrap.appendChild(chkSrc);
      srcWrap.appendChild(document.createTextNode(" source"));

      const exWrap = document.createElement("label");
      exWrap.className = "jsfile-check";
      exWrap.appendChild(chkEx);
      exWrap.appendChild(document.createTextNode(" extract_from"));

      const pill = document.createElement("span");
      pill.className = "pill";
      if (e.syntaxOk === true) pill.textContent = "SYNTAX: OK";
      else if (e.syntaxOk === false) pill.textContent = "SYNTAX: NG";
      else pill.textContent = "SYNTAX: (not checked)";

      const msg = document.createElement("span");
      msg.className = "muted";
      msg.textContent = e.syntaxMsg ? (" " + String(e.syntaxMsg)) : "";

      row.appendChild(label);
      row.appendChild(srcWrap);
      row.appendChild(exWrap);
      row.appendChild(pill);
      row.appendChild(msg);

      box.appendChild(row);
    }
  }

  let lastSyntaxCheckOk = null;
  let lastSyntaxCheckMessage = "";

  // ============================================================
  // ★ EXTRACT 診断ログ設定（コンソールで一発で状況を追うため）
  // ------------------------------------------------------------
  // 何をしているか:
  //   - EXTRACT_DIAG_ENABLED を true にすると、doExtract() の重要状態を
  //     console に必ず出す（UIの status だけでは追えない原因を可視化）。
  //   - false にすると一切出さない（通常運用へ即戻せる）。
  // ============================================================
  const EXTRACT_DIAG_ENABLED = true;
  
  // ============================================================
  // ★ EXTRACT input history picker（右クリックで履歴→反映）
  // ------------------------------------------------------------
  // 何をしているか:
  //   - extractSymbols / extractNeedles の過去入力を localStorage に保存
  //   - テキストエリア上で右クリックすると履歴一覧を prompt で表示
  //   - 番号選択でそのまま入力へ反映
  // ============================================================
  function openTextHistoryPicker(storageKey, targetTextareaId, label) {
    try {
      const ta = $(String(targetTextareaId || ""));
      if (!ta) return;

      const hist = loadTextHistory(storageKey);
      if (!hist || hist.length === 0) {
        setStatus(String(label || "履歴") + "：履歴がありません");
        return;
      }

      const lines = [];
      lines.push(String(label || "履歴") + "（新しい順）");
      lines.push("番号を入力すると、その値を反映します。空でキャンセル。");
      lines.push("");
      for (let i = 0; i < hist.length; i++) {
        lines.push(String(i + 1).padStart(2, "0") + ": " + hist[i]);
      }

      const ans = window.prompt(lines.join("\n"), "");
      if (ans === null) return;

      const n = Number(String(ans || "").trim());
      if (!isFinite(n) || n <= 0) return;

      const idx = Math.floor(n) - 1;
      if (idx < 0 || idx >= hist.length) return;

      ta.value = hist[idx];
      saveUiState();
      try { ta.focus(); } catch (e) {}

      setStatus(String(label || "履歴") + "：反映しました（#" + String(n) + "）");
    } catch (e) {}
  }  

  function diagExtract(label, obj) {
    /*
     * 何をしているか:
     *   - ログ出力を 1箇所に集約して、出力形式を安定化させる
     *   - label と payload をまとめて出す（後で検索しやすい）
     */
    if (!EXTRACT_DIAG_ENABLED) return;
    try {
      if (obj !== undefined) {
        console.log("[LPT][EXTRACT][DIAG] " + String(label || ""), obj);
      } else {
        console.log("[LPT][EXTRACT][DIAG] " + String(label || ""));
      }
    } catch (e) {}
  }

  async function runSyntaxCheckForFile(file) {
    if (!file) return;

    lastSyntaxCheckOk = null;
    lastSyntaxCheckMessage = "";
    setStatus("構文チェック中...");

    let text = "";
    try {
      text = await file.text();
    } catch (e) {
      lastSyntaxCheckOk = false;
      lastSyntaxCheckMessage = "ファイル読み取り失敗: " + String(e);
      setStatus(lastSyntaxCheckMessage);
      return;
    }

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ filename: file.name, content: text })
      });

      if (!res.ok) {
        lastSyntaxCheckOk = false;
        lastSyntaxCheckMessage = "構文チェックAPI失敗: HTTP " + String(res.status);
        setStatus(lastSyntaxCheckMessage);
        return;
      }

      const data = await res.json();
      const ok = !!(data && data.ok);
      const err = String((data && data.error) || "").trim();

      lastSyntaxCheckOk = ok;
      lastSyntaxCheckMessage = ok ? "OK" : (err || "構文エラー");

      if (ok) {
        setStatus("構文チェックOK: " + String(file.name || ""));
      } else {
        setStatus("構文チェックNG: " + String(file.name || "") + " / " + lastSyntaxCheckMessage);
      }

      // 追加: fileEntries に反映（name一致）
      (function(){
        const name = String(file.name || "");
        for (let i = 0; i < fileEntries.length; i++) {
          const e = fileEntries[i];
          if (e && String(e.name || "") === name) {
            e.syntaxOk = ok;
            e.syntaxMsg = ok ? "OK" : (err || "構文エラー");
            break;
          }
        }
        renderJsFileList();
        saveUiState();
      })();
    } catch (e) {
      lastSyntaxCheckOk = false;
      lastSyntaxCheckMessage = "構文チェック例外: " + String(e);
      setStatus(lastSyntaxCheckMessage);
    }
  }

  function setHistRoot(msg) {
    const el = $("histRoot");
    if (!el) return;
    el.textContent = String(msg || "");
  }

  async function fetchInstructionHistoryFromServer() {
    try {
      const res = await fetch("/api/instructions", { method: "GET" });
      if (!res.ok) {
        return { outroot: "", total_dirs: 0, items: [], error: "HTTP " + String(res.status) };
      }
      const data = await res.json();

      const outroot = String((data && data.outroot) || "");
      const total_dirs = Number((data && data.total_dirs) || 0);
      const items = (data && Array.isArray(data.items)) ? data.items : [];

      return { outroot, total_dirs, items, error: "" };
    } catch (e) {
      return { outroot: "", total_dirs: 0, items: [], error: String(e) };
    }
  }

  async function renderInstructionHistory() {
    const box = $("instructionHistory");
    if (!box) return;

    box.innerHTML = "";
    setHistStatus("読み込み中...");

    const data = await fetchInstructionHistoryFromServer();

    if (data.outroot) {
      setHistRoot("参照先: " + data.outroot + "（dirs: " + String(data.total_dirs) + "）");
    } else {
      setHistRoot("参照先: （未取得）");
    }

    if (data.error) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "（読み込み失敗）: " + data.error;
      box.appendChild(div);
      setHistStatus("");
      return;
    }

    const items = data.items;

    if (!items || items.length === 0) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "（まだ履歴がありません：一度「生成（split）」すると out_protocol_local_tool に保存され、ここに出ます）";
      box.appendChild(div);
      setHistStatus("件数: 0");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const instr = String(it.instruction || "").trim();

      const div = document.createElement("div");
      div.className = "card";

      const header = document.createElement("div");
      header.className = "partHeader";

      const t1 = document.createElement("span");
      t1.className = "pill";
      t1.textContent = "RUN" + String(i + 1).padStart(2, "0");

      const t2 = document.createElement("span");
      t2.className = "pill";
      t2.textContent = String(it.created_at || "");

      const t3 = document.createElement("span");
      t3.className = "pill";
      t3.textContent = String(it.session_id || "");

      const btnUse = document.createElement("button");
      btnUse.textContent = "入力へ反映";
      btnUse.disabled = !instr;
      btnUse.onclick = () => {
        $("instruction").value = instr;
        autosizeInstruction();
        try { $("instruction").focus(); } catch (e) {}
        setHistStatus("入力欄に反映しました: " + String(it.session_id || ""));
      };

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "コピー";
      btnCopy.disabled = !instr;
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(instr);
          flashButton(btnCopy, "ok");
          setHistStatus("コピーしました: " + String(it.session_id || ""));
          const old = btnCopy.textContent;
          btnCopy.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopy.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopy, "ng");
          setHistStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
        }
      };

      const btnDel = document.createElement("button");
      btnDel.textContent = "削除";
      btnDel.disabled = !String(it.output_dir || "");
      btnDel.onclick = async () => {
        const dir = String(it.output_dir || "");
        if (!dir) return;

        const ok = window.confirm("この履歴を削除しますか？\n\n" + dir);
        if (!ok) return;

        btnDel.disabled = true;
        setHistStatus("削除中...: " + String(it.session_id || ""));

        try {
          const res = await fetch("/api/instructions/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ output_dir: dir })
          });

          if (!res.ok) {
            setHistStatus("削除失敗: HTTP " + String(res.status));
            btnDel.disabled = false;
            return;
          }

          const data = await res.json();
          if (data && data.ok) {
            setHistStatus("削除しました: " + String(it.session_id || ""));
            await renderInstructionHistory();
          } else {
            setHistStatus("削除失敗: " + String((data && data.error) || "unknown error"));
            btnDel.disabled = false;
          }
        } catch (e) {
          setHistStatus("削除例外: " + String(e));
          btnDel.disabled = false;
        }
      };

      const btnCopySrc = document.createElement("button");
      btnCopySrc.textContent = "元JSコピー";
      btnCopySrc.disabled = !String(it.output_dir || "") || !String(it.original_saved_copy || "");
      btnCopySrc.onclick = async () => {
        const dir = String(it.output_dir || "");
        if (!dir) return;

        setHistStatus("元JS取得中...: " + String(it.session_id || ""));

        try {
          const url = "/api/instructions/original?output_dir=" + encodeURIComponent(dir);
          const res = await fetch(url, { method: "GET" });

          if (!res.ok) {
            setHistStatus("元JS取得失敗: HTTP " + String(res.status));
            flashButton(btnCopySrc, "ng");
            return;
          }

          const text = await res.text();
          await navigator.clipboard.writeText(text);

          flashButton(btnCopySrc, "ok");
          setHistStatus("元JSをコピーしました: " + String(it.session_id || ""));

          const old = btnCopySrc.textContent;
          btnCopySrc.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopySrc.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopySrc, "ng");
          setHistStatus("元JSコピー失敗（権限/HTTP制約等）: " + String(e));
        }
      };

      header.appendChild(t1);
      header.appendChild(t2);
      header.appendChild(t3);
      header.appendChild(btnUse);
      header.appendChild(btnCopy);
      header.appendChild(btnDel);
      header.appendChild(btnCopySrc);

      // 追加した処理: 「元JSコピー」ボタンの右に、対象JSのファイル名を表示する
      const jsNamePill = document.createElement("span");
      jsNamePill.className = "pill";
      (function(){
        const targetFile = String(it.target_file || "").trim();
        const savedCopy  = String(it.original_saved_copy || "").trim();

        let name = targetFile;
        if (!name && savedCopy) {
          const parts = savedCopy.split(/[\\/]/);
          name = parts.length ? String(parts[parts.length - 1] || "").trim() : "";
        }

        jsNamePill.textContent = name ? ("JS: " + name) : "JS: (unknown)";
      })();
      header.appendChild(jsNamePill);

      const pre = document.createElement("pre");
      if (instr) {
        pre.dataset.fullInstruction = instr;
        pre.textContent = buildHistoryPreviewText(instr, pre);
      } else {
        pre.textContent = "（この run の manifest.json に instruction がありません）";
      }

      div.appendChild(header);
      div.appendChild(pre);
      box.appendChild(div);
    }

    setHistStatus("件数: " + items.length);
  }

  function setStatus(msg) {
    const el = $("status");
    if (!el) return;

    /* 表示内容を文字列化して扱う（null/undefined 対策） */
    const s = String(msg || "");

    /* 空メッセージなら、status 自体を非表示にする（未選択時など） */
    if (s.trim() === "") {
      el.textContent = "";
      el.style.display = "none";
      return;
    }

    /* メッセージがある時だけ表示する */
    el.textContent = s;
    el.style.display = "";
  }

  function setHistStatus(msg) {
    const el = $("histStatus");
    if (!el) return;
    el.textContent = msg;
  }

  function flashButton(btn, kind) {
    if (!btn) return;
    const cls = (kind === "ng") ? "flash-ng" : "flash-ok";
    btn.classList.add(cls);
    window.setTimeout(() => btn.classList.remove(cls), 220);
  }

  function flashPartSwitchCue(options) {
    const title = $("currentPartTitle");
    const pre = $("preview");

    const opt = (options && typeof options === "object") ? options : {};
    const doScroll = (opt.scroll === false) ? false : true;

    if (title) {
      title.classList.add("flash-part-switch");
      window.setTimeout(() => title.classList.remove("flash-part-switch"), 560);
    }
    if (pre) {
      pre.classList.add("flash-part-switch");
      window.setTimeout(() => pre.classList.remove("flash-part-switch"), 560);
    }

    /* 追加した処理: スクロール（ページ内ジャンプ）を抑止できるようにする */
    if (!doScroll) return;

    /* 追加した処理: 切替直後に「今どこを見れば良いか」を明確にするため、プレビューへスクロールする */
    try {
      if (pre && typeof pre.scrollIntoView === "function") {
        pre.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function goNextPartWithCue(originLabel, options) {
    if (!result || !result.parts || result.parts.length === 0) return false;

    if (currentIndex < result.parts.length - 1) {
      const prev = result.parts[currentIndex];
      currentIndex += 1;
      const next = result.parts[currentIndex];

      /* 追加した処理: 表示を切り替える（次のパート） */
      renderCurrent();
      saveUiState();

      /* 追加した処理: 切り替わったことを水色フラッシュで明示する（必要ならスクロール抑止） */
      flashPartSwitchCue(options);

      /* 追加した処理: 状態表示に「コピー→次へ」等の由来を含め、何が起きたか分かるようにする */
      const origin = String(originLabel || "操作");
      setStatus(origin + "：表示を切替（" + prev.part_id + " → " + next.part_id + "）");

      return true;
    }

    return false;
  }

  async function copyCurrent() {
    if (!result) return;
    const p = result.parts[currentIndex];
    const btn = $("copyCurrent");
    try {
      await navigator.clipboard.writeText(p.payload);
      flashButton(btn, "ok");

      /* 追加した処理: コピー成功後、次のパートへ自動で切り替える（ただしスクロールはしない） */
      const moved = goNextPartWithCue("コピー→次のパートへ", { scroll: false });

      if (!moved) {
        setStatus("コピーしました（最後のパート）: " + p.part_id);
      }

      const old = btn.textContent;
      btn.textContent = "Copied ✓";
      window.setTimeout(() => (btn.textContent = old), 650);
    } catch (e) {
      flashButton(btn, "ng");
      setStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
    }
  }

  async function copyNext() {
    if (!result) return;
    const btn = $("copyNext");

    if (currentIndex < result.parts.length - 1) {
      flashButton(btn, "ok");

      /* 追加した処理: 「次のパートを表示」でも同じ強い明示（フラッシュ＋ステータス）を出す */
      goNextPartWithCue("次のパートを表示");

      const old = btn.textContent;
      btn.textContent = "表示 ✓";
      window.setTimeout(() => (btn.textContent = old), 650);
    } else {
      flashButton(btn, "ng");
      setStatus("これが最後のパートです: " + result.parts[currentIndex].part_id);
    }
  }

  function renderCurrent() {
    if (!result || !result.parts || result.parts.length === 0) {
      $("preview").textContent = "(まだ生成していません)";
      if ($("currentPartTitle")) {
        const root = $("currentPartTitle");
        const label = root.querySelector(".currentPartLabel");
        const meta  = root.querySelector(".currentPartMeta");

        if (label && meta) {
          /* span構造を維持したまま「未生成」表示に戻す */
          label.textContent = "現在のパート";
          meta.textContent  = "　Part: - / -　(SessionID: -)";
        } else {
          /* 旧DOM（spanが無い）対策：最小限の復元（フォールバックではなくDOM整形） */
          root.innerHTML =
            '<span class="currentPartLabel">現在のパート</span>' +
            '<span class="currentPartMeta">　Part: - / -　(SessionID: -)</span>';
        }
      }
      $("pidPill").textContent = "PartID: -";
      if ($("sha8Pill")) {
        $("sha8Pill").textContent = "SHA8: -";
      }

      previewAllOn = false;
      updateToggleAllButton();
      return;
    }
    
    const p = result.parts[currentIndex];
    $("preview").textContent = buildPreviewText(p.payload);
    if ($("currentPartTitle")) {
      const root = $("currentPartTitle");
      const label = root.querySelector(".currentPartLabel");
      const meta  = root.querySelector(".currentPartMeta");

      if (label) {
        label.textContent = "現在のパート";
      }
      if (meta) {
        const di = (p && p._display_index) || "-";
        const dt = (p && p._display_total) || "-";
        /*
         * 何をしているか:
         *   - UI表示のパート番号は _display_index のみを使用する
         *   - p.index へのフォールバックを廃止し、生成物とUI表示のズレを防ぐ
         */

        const srcName = String((p && p._source_filename) || "").trim();
        const srcSid  = String((p && p._source_session_id) || "").trim();

        const fileLabel = srcName ? ("　(File: " + srcName + ")") : "";
        const sidLabel  = (srcSid || result.session_id) ? ("　(SessionID: " + (srcSid || result.session_id) + ")") : "　(SessionID: -)";

        meta.textContent =
          "　Part: " + String(di) + " / " + String(dt) +
          fileLabel +
          sidLabel;
      }
    }
    $("pidPill").textContent = "PartID: " + p.part_id;
    if ($("sha8Pill")) {
      const s8 = (p && typeof p.part_sha8 === "string" && p.part_sha8) ? p.part_sha8 : "-";
      $("sha8Pill").textContent = "SHA8: " + s8;
    }
    $("copyNext").disabled = false;
    $("copyCurrent").disabled = false;

    updateToggleAllButton();
    renderPartJumpButtons(); /* 右端のパート番号ボタンを更新 */
  }

  function renderList() {
    const box = $("partsList");
    box.innerHTML = "";
    if (!result || !result.parts) return;

    for (let i = 0; i < result.parts.length; i++) {
      const p = result.parts[i];
      const div = document.createElement("div");
      div.className = "card";
      const btnGo = document.createElement("button");
      btnGo.textContent = "表示";
      btnGo.onclick = () => {
        currentIndex = i;
        renderCurrent();
        saveUiState();
        setStatus("表示: part_" + String(p.index).padStart(2, "0"));
      };

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "コピー";
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(p.payload);
          flashButton(btnCopy, "ok");
          setStatus("コピーしました: " + p.part_id);
          const old = btnCopy.textContent;
          btnCopy.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopy.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopy, "ng");
          setStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
        }
      };

      const header = document.createElement("div");
      header.className = "partHeader";
      const t1 = document.createElement("span");
      t1.className = "pill";
      const di = (p && p._display_index) || 0;
      t1.textContent = "part_" + String(di).padStart(2, "0") + ".txt";
      /*
       * 何をしているか:
       *   - 一覧表示でも _display_index のみを使用する
       *   - 単一ファイル split 時に part_02.txt が誤表示される問題を防止
       */
      const t2 = document.createElement("span");
      t2.className = "pill";
      t2.textContent = p.part_id;

      const t3 = document.createElement("span");
      t3.className = "pill";
      const s8 = (p && typeof p.part_sha8 === "string" && p.part_sha8) ? p.part_sha8 : "-";
      t3.textContent = "SHA8:" + s8;

      header.appendChild(t1);
      header.appendChild(t2);
      header.appendChild(t3);

      const tf = document.createElement("span");
      tf.className = "pill";
      tf.textContent = String((p && p._source_filename) ? ("FILE:" + String(p._source_filename)) : "FILE:(single)");
      header.appendChild(tf);

      header.appendChild(btnGo);
      header.appendChild(btnCopy);

      div.appendChild(header);
      box.appendChild(div);
    }
  }

  function resetGeneratedOnly() {
    /* 生成結果だけをリセット（instruction は触らない） */
    result = null;
    currentIndex = 0;
    previewAllOn = false;

    $("partsList").innerHTML = "";
    $("preview").textContent = "(まだ生成していません)";
    if ($("idxPill")) {
      $("idxPill").textContent = "Part: -";
    }
    $("pidPill").textContent = "PartID: -";
    if ($("currentSessionInline")) {
      $("currentSessionInline").textContent = "(SessionID: -)";
    }

    $("copyNext").disabled = true;
    $("copyCurrent").disabled = true;

    if ($("resetGen")) {
      $("resetGen").disabled = true;
    }

    saveUiState();
    renderPartJumpButtons(); /* 右端のパート番号ボタンを消す/更新 */
    setHistRoot("参照先: （未取得）");
    setStatus("生成結果をリセットしました（指示は保持）");
  }

  function resetExtractOnly() {
    /*
     * 何をしているか:
     *   extract結果だけを完全に初期状態へ戻す。
     *   - 抽出テキストを消す
     *   - ALL を OFF に戻す
     *   - 表示・ボタン状態を render 系に一本化して同期する
     *   ※ symbols / needles 入力は一切触らない
     */

    lastExtractText = "";
    extractPreviewAllOn = false;

    /*
     * 表示更新は renderExtractPreview に委譲する
     * （textarea への直書きは行わない）
     */
    renderExtractPreview();

    const btnCopyExtract = $("copyExtract");
    if (btnCopyExtract) btnCopyExtract.disabled = true;

    const btnResetExtract = $("resetExtract");
    if (btnResetExtract) btnResetExtract.disabled = true;

    /*
     * ALL トグルボタンの有効状態とラベルを同期
     */
    updateToggleExtractAllButton();

    saveUiState();
    setStatus("抽出結果をリセットしました（入力は保持）");
  }

  async function doSplit() {
    const selected = getSelectedSourceEntries();
    if (!selected || selected.length === 0) {
      setStatus("split対象がありません（js_file_list で source にチェックしてください）");
      return;
    }

    // 構文チェックNGが1つでも混ざってたら止める（不意の壊れ送信防止）
    for (let i = 0; i < selected.length; i++) {
      const e = selected[i];
      if (e && e.syntaxOk === false) {
        setStatus("構文チェックNGのため生成を中止します: " + String(e.name || "") + " / " + String(e.syntaxMsg || ""));
        return;
      }
    }

    const instr = String($("instruction").value || "").trim();
    if (!instr) {
      /* 生成時に instruction が空なら止める（空EXEC_TASK防止） */
      setStatus("指示（--instruction）が空です。必ず記入してください。");
      try { $("instruction").focus(); } catch (e) {}
      return;
    }

    /* 追加: task_id が空なら「提案だけ」出す（勝手に入力しない運用） */
    (function(){
      const taskEl = $("taskId");
      if (!taskEl) return;

      const curTask = String(taskEl.value || "").trim();
      if (curTask) return;

      const pid = String((($("projectId") && $("projectId").value) || "")).trim();

      function ymd() {
        const d = new Date();
        const y = String(d.getFullYear());
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + dd;
      }

      /* xxx は project_id から雑に作る（空なら "task"） */
      let base = pid ? pid : "task";
      base = base
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_\-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();

      if (!base) base = "task";

      const suggestion = ymd() + "_" + base;

      setStatus("task_id が空です。提案: " + suggestion + "（必要なら task_id 欄に手入力してから生成してください）");

      try {
        const ok = window.confirm(
          "task_id が空です。\n\n提案: " + suggestion + "\n\n※ 自動入力はしません。\ntask_id 欄に貼り付けますか？"
        );
        if (ok) {
          taskEl.value = suggestion;
          saveUiState();
          refreshTaskIdDatalist();
          setStatus("task_id に提案を入力しました: " + suggestion);
          try { taskEl.focus(); } catch (e) {}
        }
      } catch (e) {}
    })();

    const filesPayload = [];
    for (let i = 0; i < selected.length; i++) {
      const e = selected[i];
      const f = e && e.file ? e.file : null;
      if (!f) continue;
      const text = await f.text();
      filesPayload.push({ filename: String(f.name || ""), content: String(text || "") });
    }

    const payload = {
      files: filesPayload,
      prefix: $("prefix").value || "CSCSJS",
      lang: $("lang").value || "javascript",
      maxchars: Number($("maxchars").value || 60000),
      maxlines: Number($("maxlines").value || 1200),
      maxlogs: Number($("maxlogs").value || 50),
      split_mode: ($("splitMode") && $("splitMode").value) ? String($("splitMode").value) : "C",
      iife_grace_ratio: 0.30,
      instruction: instr,

      /* 追加した処理: SCOPE CHECK 用の抽出コードを split payload に含めて /api/split へ渡す（そのまま値を送る） */
      scope_extract_code: document.getElementById("scope_extract_code").value
    };

    setStatus("分割中...");
    $("run").disabled = true;
    $("copyNext").disabled = true;
    $("copyCurrent").disabled = true;

    const res = await fetch("/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });

    $("run").disabled = false;

    if (!res.ok) {
      const t = await res.text();
      setStatus("エラー: " + t);
      return;
    }

    result = await res.json();

    // ============================================================
    // ★ 複数ファイル split のレスポンス正規化（results[] → parts[]）
    // ------------------------------------------------------------
    // - 単体: { session_id, parts:[...] }
    // - 複数: { ok, results:[ { filename, session_id, parts:[...] }, ... ] }
    //   → UI側は常に result.parts[] を読む設計なので、ここで一本化する。
    // - さらに UIジャンプ用に通し番号（_display_index/_display_total）を付与する。
    // ============================================================
    (function normalizeSplitResponseForUI() {
      const raw = result;

      if (!raw || typeof raw !== "object") return;

      // ============================================================
      // ★ 単一 / 複数 を分岐して正規化する
      // ------------------------------------------------------------
      // 何をしているか:
      //   - raw.parts がある場合は「単一レスポンス」として扱い、これを最優先する
      //   - raw.parts が無い場合のみ raw.results（複数レスポンス）を flatten する
      //   - UIは常に result.parts[] を読むため、ここで形を一本化する
      // ============================================================

      // ============================================================
      // 1) 単一レスポンス: { session_id, parts:[...] } を優先
      // ------------------------------------------------------------
      // 何をしているか:
      //   - raw.parts をそのまま UI 用に採用する（results があっても flatten しない）
      //   - UIジャンプ用に _display_index/_display_total を付与する
      // ============================================================
      if (Array.isArray(raw.parts)) {
        const partsIn = raw.parts;
        const out = [];

        for (let i = 0; i < partsIn.length; i++) {
          const p0 = partsIn[i] || {};
          const di = i + 1;

          const p = Object.assign({}, p0, {
            _display_index: di,
            _display_total: 0
          });

          out.push(p);
        }

        for (let i = 0; i < out.length; i++) {
          out[i]._display_total = out.length;
        }

        result = {
          session_id: String(raw.session_id || "").trim(),
          parts: out,
          _multi: false
        };
        return;
      }

      // ============================================================
      // 2) 複数レスポンス: { ok, results:[ { filename, session_id, parts:[...] }, ... ] }
      // ------------------------------------------------------------
      // 何をしているか:
      //   - results[].parts を flatten して UI が読む result.parts[] にまとめる
      //   - どのファイル由来か追えるように _source_filename/_source_session_id を付与する
      //   - UIジャンプ用に _display_index/_display_total を付与する
      // ============================================================
      if (!Array.isArray(raw.results)) return;

      const flat = [];

      for (let i = 0; i < raw.results.length; i++) {
        const r = raw.results[i] || {};

        const fname = String(r.filename || "").trim();
        const sid = String(r.session_id || "").trim();

        const parts = Array.isArray(r.parts) ? r.parts : [];

        for (let k = 0; k < parts.length; k++) {
          const p0 = parts[k] || {};
          const di = flat.length + 1;

          const p = Object.assign({}, p0, {
            _display_index: di,
            _display_total: 0,
            _source_filename: fname,
            _source_session_id: sid
          });

          flat.push(p);
        }
      }

      for (let i = 0; i < flat.length; i++) {
        flat[i]._display_total = flat.length;
      }

      // ============================================================
      // 3) UIの session_id を決める
      // ------------------------------------------------------------
      // 何をしているか:
      //   - 複数レスポンスでは raw.session_id が無いケースがあるため、
      //     UI側は first part の _source_session_id を代表として採用する
      // ============================================================
      const uiSessionId =
        String((flat[0] && flat[0]._source_session_id) || "").trim();

      result = {
        session_id: uiSessionId,
        parts: flat,
        _multi: true
      };
    })();

    currentIndex = 0;
    renderList();
    renderCurrent();
    renderInstructionHistory();
    autosizeInstruction();

    /* 追加した処理: split直後の result.session_id を extract用 SESSION_ID に自動入力する（手入力も可） */
    if ($("extractSessionId") && result && typeof result.session_id === "string") {
      $("extractSessionId").value = String(result.session_id || "");
    }

    /* 追加した処理: split直後の instruction 原文（EXEC_TASK）を extract用に自動入力する（手入力も可） */
    if ($("extractExecTask")) {
      $("extractExecTask").value = String(instr || "");
    }

    saveUiState();

    if ($("resetGen")) {
      $("resetGen").disabled = false;
    }

    (function(){
      const pid = String((($("projectId") && $("projectId").value) || "")).trim();
      const tid = String((($("taskId") && $("taskId").value) || "")).trim();

      const pidShow = pid ? pid : "(unset)";
      const tidShow = tid ? tid : "(unset)";

      setStatus(
        "生成完了: " + result.session_id +
        " / parts=" + result.parts.length +
        " / PROJECT_ID=" + pidShow +
        " / TASK_ID=" + tidShow
      );
    })();
  }

  $("run").onclick = doSplit;

  if ($("resetExtract")) {
    $("resetExtract").onclick = () => resetExtractOnly();
  }
  
  if ($("modeSplitBtn")) {
    $("modeSplitBtn").onclick = () => applyUIMode("split");
  }
  if ($("modeExtractBtn")) {
    $("modeExtractBtn").onclick = () => applyUIMode("extract");
  }

  /* 追加した処理: extract結果も「ALL: OFF/ON」で全文/一部表示を切替する */
  if ($("toggleExtractAll")) {
    $("toggleExtractAll").onclick = () => {
      extractPreviewAllOn = !extractPreviewAllOn;
      renderExtractPreview();
      /* 追加: task_id が入っている場合は履歴に残す（サジェスト用） */
    (function(){
      const tid = String((($("taskId") && $("taskId").value) || "")).trim();
      if (tid) rememberTaskId(tid);
    })();

    saveUiState();
      setStatus("extract表示: " + (extractPreviewAllOn ? "ALL: ON（全文）" : "ALL: OFF（一部）"));
    };
  }

  if ($("extractSymbols")) {
    $("extractSymbols").addEventListener("input", () => saveUiState());

    /* 追加: 右クリックで履歴ピッカー */
    $("extractSymbols").addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      openTextHistoryPicker(EXTRACT_SYMBOLS_HISTORY_KEY, "extractSymbols", "EXTRACT_SYMBOLS 履歴");
    });
  }
  if ($("extractNeedles")) {
    $("extractNeedles").addEventListener("input", () => saveUiState());

    /* 追加: 右クリックで履歴ピッカー */
    $("extractNeedles").addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      openTextHistoryPicker(EXTRACT_NEEDLES_HISTORY_KEY, "extractNeedles", "EXTRACT_NEEDLES 履歴");
    });
  }
  /* 追加した処理: SESSION_ID / EXEC_TASK も入力変更で即保存（split後の自動入力→手修正も保持） */
  if ($("extractSessionId")) {
    $("extractSessionId").addEventListener("input", () => saveUiState());
  }
  if ($("extractExecTask")) {
    $("extractExecTask").addEventListener("input", () => saveUiState());
  }
  /* 追加した処理: PURPOSE / DEPENDS も入力変更で即保存 */
  if ($("extractPurpose")) {
    $("extractPurpose").addEventListener("input", () => saveUiState());
  }
  if ($("extractDepends")) {
    $("extractDepends").addEventListener("input", () => saveUiState());
  }
  if ($("extractContextLines")) {
    $("extractContextLines").addEventListener("input", () => saveUiState());
  }
  if ($("extractMaxMatches")) {
    $("extractMaxMatches").addEventListener("input", () => saveUiState());
  }

  /* 追加した処理: 「コードのみ（厳格）」切替でも即保存し、意図しない表示混入を防ぐ */
  if ($("extractCodeOnly")) {
    $("extractCodeOnly").addEventListener("change", () => saveUiState());
  }

  async function doExtract() {
    const sourcesSel = getSelectedSourceEntries();
    const extractFromSel = getSelectedExtractFromEntries();

    // ============================================================
    // ★ 診断ログ: 選択状態（source / extract_from）の“実態”を最初に出す
    // ------------------------------------------------------------
    // 何をしているか:
    //   - UI上ではチェックが入ってる“つもり”でも、内部配列が空/ズレていると
    //     そこで止まる。その瞬間の配列数とファイル名を確実に可視化する。
    // ============================================================
    diagExtract("selection snapshot", {
      sourcesSel_len: sourcesSel ? sourcesSel.length : null,
      extractFromSel_len: extractFromSel ? extractFromSel.length : null,
      sourcesSel_names: (sourcesSel || []).map(e => String((e && e.name) || "")),
      extractFromSel_names: (extractFromSel || []).map(e => String((e && e.name) || "")),
    });

    if (!sourcesSel || sourcesSel.length === 0) {
      diagExtract("stop: sources empty");
      setStatus("extractの sources が空です（js_file_list で source にチェックしてください）");
      return;
    }
    if (!extractFromSel || extractFromSel.length === 0) {
      diagExtract("stop: extract_from empty");
      setStatus("extract対象（extract_from）が空です（js_file_list で extract_from にチェックしてください）");
      return;
    }

    // ============================================================
    // ★ 診断ログ: 構文チェック状態（NGで止まる理由を確実に出す）
    // ------------------------------------------------------------
    // 何をしているか:
    //   - syntaxOk=false が混じって止まる場合、どのファイルで止まったか
    //     consoleに必ず残す（UIのstatusは上書きされうる）。
    // ============================================================
    for (let i = 0; i < sourcesSel.length; i++) {
      const e = sourcesSel[i];
      if (e && e.syntaxOk === false) {
        diagExtract("stop: syntax NG in sources", {
          name: String(e.name || ""),
          syntaxMsg: String(e.syntaxMsg || "")
        });
        setStatus("構文チェックNGのため抽出を中止します: " + String(e.name || "") + " / " + String(e.syntaxMsg || ""));
        return;
      }
    }
    for (let i = 0; i < extractFromSel.length; i++) {
      const e = extractFromSel[i];
      if (e && e.syntaxOk === false) {
        diagExtract("stop: syntax NG in extract_from", {
          name: String(e.name || ""),
          syntaxMsg: String(e.syntaxMsg || "")
        });
        setStatus("構文チェックNGのため抽出を中止します: " + String(e.name || "") + " / " + String(e.syntaxMsg || ""));
        return;
      }
    }

    const sym = String(($("extractSymbols") && $("extractSymbols").value) || "").trim();
    const ndl = String(($("extractNeedles") && $("extractNeedles").value) || "").trim();

    /* 追加: 実行時に現在の入力を履歴へ保存（空は除外・重複は潰す） */
    rememberTextHistory(EXTRACT_SYMBOLS_HISTORY_KEY, sym);
    rememberTextHistory(EXTRACT_NEEDLES_HISTORY_KEY, ndl);

    const ctxRaw = String(($("extractContextLines") && $("extractContextLines").value) || "25").trim();
    const mxmRaw = String(($("extractMaxMatches") && $("extractMaxMatches").value) || "50").trim();

    /* 追加した処理: 「抽出したコード以外は一切表示しない」厳格モード（メタ/ログ/フェンスも禁止） */
    const codeOnly = !!(($("extractCodeOnly") && $("extractCodeOnly").checked) ? true : false);

    const symbols = sym ? sym.split(",").map(s => String(s).trim()).filter(s => s) : [];
    const needles = ndl ? ndl.split(",").map(s => String(s)).filter(s => s !== "") : [];

    const context_lines = ctxRaw ? Number(ctxRaw) : 25;
    const max_matches = mxmRaw ? Number(mxmRaw) : 50;

    // ============================================================
    // ★ 診断ログ: 入力（symbols/needles/パラメータ）を“そのまま”出す
    // ------------------------------------------------------------
    // 何をしているか:
    //   - symbols/needles が空や意図と違う分割になっていると、
    //     抽出が常に0になる。ここで確実に確認できるようにする。
    // ============================================================
    diagExtract("inputs", {
      sym_raw: sym,
      ndl_raw: ndl,
      symbols_len: symbols.length,
      needles_len: needles.length,
      context_lines: context_lines,
      max_matches: max_matches,
      codeOnly: codeOnly
    });

    const sourcesPayload = [];
    for (let i = 0; i < sourcesSel.length; i++) {
      const e = sourcesSel[i];
      const f = e && e.file ? e.file : null;
      if (!f) continue;

      // ============================================================
      // ★ 診断ログ: File.text() が失敗していないか／サイズがゼロでないか
      // ------------------------------------------------------------
      // 何をしているか:
      //   - “チェックは入ってるが content が空” だと抽出は成立しない。
      //   - ここで filename と文字数を出して確実に検出できるようにする。
      // ============================================================
      const text = await f.text();
      diagExtract("read source file", {
        filename: String(f.name || ""),
        chars: String(text || "").length
      });

      sourcesPayload.push({ filename: String(f.name || ""), content: String(text || "") });
    }

    const extractFromPayload = [];
    for (let i = 0; i < extractFromSel.length; i++) {
      const e = extractFromSel[i];
      const f = e && e.file ? e.file : null;
      if (!f) continue;

      // ============================================================
      // ★ 診断ログ: extract_from の読み込み実態（空/読めてない）を潰す
      // ------------------------------------------------------------
      // 何をしているか:
      //   - extract_from が空だと、symbols/needles があってもヒットしない。
      //   - filename と文字数を必ず出す。
      // ============================================================
      const text = await f.text();
      diagExtract("read extract_from file", {
        filename: String(f.name || ""),
        chars: String(text || "").length
      });

      extractFromPayload.push({ filename: String(f.name || ""), content: String(text || "") });
    }

    const payload = {
      sources: sourcesPayload,
      extract_from: extractFromPayload,
      symbols: symbols,
      needles: needles,
      context_lines: context_lines,
      max_matches: max_matches
    };

    // ============================================================
    // ★ 診断ログ: /api/extract へ送る payload の要約を出す
    // ------------------------------------------------------------
    // 何をしているか:
    //   - 「送っているはず」が崩れている箇所（空配列/想定外ファイル数）を
    //     ここで確実に確定させる。
    //   - content の中身は出さず、数だけ出す（ログ爆発防止）。
    // ============================================================
    diagExtract("payload summary", {
      sources_n: payload.sources.length,
      extract_from_n: payload.extract_from.length,
      symbols_n: payload.symbols.length,
      needles_n: payload.needles.length,
      context_lines: payload.context_lines,
      max_matches: payload.max_matches,
      sources_files: payload.sources.map(x => String((x && x.filename) || "")),
      extract_from_files: payload.extract_from.map(x => String((x && x.filename) || "")),
    });

    setStatus("抽出中...");
    $("run").disabled = true;
    if ($("runExtract")) $("runExtract").disabled = true;

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });

      $("run").disabled = false;
      if ($("runExtract")) $("runExtract").disabled = false;

      // ============================================================
      // ★ 診断ログ: HTTP ステータス（ここで失敗してるとJS側ロジック以前）
      // ------------------------------------------------------------
      // 何をしているか:
      //   - res.ok / status / statusText を確実に出す
      // ============================================================
      diagExtract("response status", {
        ok: !!res.ok,
        status: res.status,
        statusText: String(res.statusText || "")
      });

      if (!res.ok) {
        const t = await res.text();

        // ============================================================
        // ★ 診断ログ: サーバが返した本文（JSONでなくてもそのまま）
        // ------------------------------------------------------------
        // 何をしているか:
        //   - /api/extract 側の例外やバリデーション結果がここに出る。
        // ============================================================
        diagExtract("response body (non-ok)", {
          text_len: String(t || "").length,
          text_head_600: String(t || "").slice(0, 600)
        });

        setStatus("抽出エラー: " + t);
        return;
      }

      const data = await res.json();

      // ============================================================
      // ★ 診断ログ: 返ってきたJSONの“骨格”を出す
      // ------------------------------------------------------------
      // 何をしているか:
      //   - ok / error / blocks数 が想定通りかを一発確認できるようにする。
      // ============================================================
      diagExtract("response json summary", {
        ok: !!(data && data.ok),
        error: String((data && data.error) || ""),
        filename: String((data && data.filename) || ""),
        blocks_len: (data && Array.isArray(data.blocks)) ? data.blocks.length : null
      });

      if (!data || !data.ok) {
        setStatus("抽出失敗: " + String((data && data.error) || "unknown"));
        return;
      }

      /* 追加した処理: 抽出成功時点で「コピー」と「リセット」を有効化する */
      if ($("copyExtract")) $("copyExtract").disabled = false;
      if ($("resetExtract")) $("resetExtract").disabled = false;

      /* 追加した処理: コードブロック先頭の空行だけを除去し、```javascript の直後が必ず実コード行になるようにする */
      function trimLeadingBlankLinesForFence(codeText) {
        const s = String(codeText || "");
        return s.replace(/^\n+/, "");
      }

      const outLines = [];

      /* 追加した処理:
         codeOnly=ON のときは「抽出コード以外は一切表示しない」ため、ヘッダ行の生成自体をスキップする */
      if (!codeOnly) {
        outLines.push("<<<EXTRACT_BEGIN>>>");
        outLines.push("FILE: " + String(data.filename || ""));
        outLines.push("SYMBOLS: " + String((data.symbols || []).join(", ")));
        outLines.push("NEEDLES: " + String((data.needles || []).join(", ")));

        /* 追加した処理: split直後の result.session_id を extractヘッダへ必ず出す（手入力/コピペも可） */
        outLines.push("SESSION_ID: " + String((($("extractSessionId") && $("extractSessionId").value) || "")).trim());

        /* 追加した処理: split直後の instruction 原文（EXEC_TASK）を extractヘッダへ必ず出す
           ※ ヘッダを1行=1項目で崩さないため、改行は \\n にエスケープして1行化する */
        (function(){
          const raw = String((($("extractExecTask") && $("extractExecTask").value) || ""));
          const one = raw.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
          outLines.push("EXEC_TASK: " + one);
        })();

        /* 追加した処理: “抽出の目的”を1行で明示（LLMの判断がブレにくくなる） */
        outLines.push("PURPOSE: " + String((($("extractPurpose") && $("extractPurpose").value) || "")).trim());

        /* 追加した処理: 依存の“存在だけ”をメタで列挙（中身不要 / 推測を減らす） */
        outLines.push("DEPENDS: " + String((($("extractDepends") && $("extractDepends").value) || "")).trim());

        outLines.push("");
      }

      /* 追加した処理: 「FOUND:true（コピー対象）」テキストから、コードフェンス内部だけを抽出して連結する */
      function extractOnlyCodeBlocks(foundText) {
        const s = String(foundText || "");
        const lines = s.split("\n");

        const blocks = [];
        let inFence = false;
        let cur = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // ```lang または ``` でトグル（langは不問）
          if (/^\s*```/.test(line)) {
            if (!inFence) {
              inFence = true;
              cur = [];
            } else {
              inFence = false;
              const body = cur.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
              if (body.trim() !== "") blocks.push(body);
              cur = [];
            }
            continue;
          }

          if (inFence) {
            cur.push(line);
          }
        }

        return blocks.join("\n\n");
      }

      /* 追加した処理: 出力テキストを後処理で「FOUND:true（コピー対象）」と
         「FOUND:false（コピー対象外ログ）」に振り分ける（data構造に依存しない） */
      function splitExtractTextByFoundFlags(fullText) {
        const s = String(fullText || "");
        const lines = s.split("\n");

        const keep = [];      // textarea（コピー対象）
        const nf = [];        // textarea外ログ（コピー対象外）

        // textarea 側に「絶対に残さない」行（FOUND:false / HEADER:not found）
        function stripForbiddenLines(blockText) {
          const t = String(blockText || "");
          return t
            .replace(/^\s*FOUND:\s*false\b.*$/gmi, "")
            .replace(/^\s*HEADER:\s*not\s+found\b.*$/gmi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trimEnd();
        }

        // ブロック単位： "【...】" で開始する塊をひとまず作る
        let cur = [];
        function flush() {
          if (!cur.length) return;

          const blockText = cur.join("\n");

          // ★ 追加した処理:
          // textarea に出したくない判定を FOUND:false だけに限定せず、
          // HEADER:not found も同様に “コピー対象外ログ” へ退避する
          const hasFoundFalse = /\nFOUND:\s*false\b/i.test("\n" + blockText);
          const hasHeaderNotFound = /\nHEADER:\s*not\s+found\b/i.test("\n" + blockText);

          // FOUND:true があっても「禁則行」は textarea に残さない（= strip は必ず通す）
          const cleaned = stripForbiddenLines(blockText);

          if (hasFoundFalse || hasHeaderNotFound) {
            // ★ 追加した処理: コピー対象外ログにも、見やすさのため禁則行除去後を入れる
            // （FOUND:false/HEADER:not found 自体を見せたくない運用なら、ここも同様に消える）
            if (cleaned.trim()) nf.push(cleaned);
          } else {
            // ★ 追加した処理: textarea 側も必ず禁則行を除去してから入れる（残留を物理的に防ぐ）
            if (cleaned.trim()) keep.push(cleaned);
          }

          cur = [];
        }

        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];

          // "【" から始まる行をブロック境界として扱う（今の出力形式と一致）
          if (ln.startsWith("【") && cur.length > 0) {
            flush();
          }
          cur.push(ln);
        }
        flush();

        // ★ 追加した処理: keep 側全体にも最終防波堤を掛けて、混入を “絶対” に潰す
        const keepTextFinal = stripForbiddenLines(keep.join("\n"));

        return {
          keepText: keepTextFinal,
          notFoundText: nf.join("\n").trim()
        };
      }

      const blocks = data.blocks || [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] || {};
        if (b.kind === "function_whole") {
          outLines.push("【FUNCTION_WHOLE】 " + String(b.name || ""));
          outLines.push("FOUND: " + String(!!b.found));
          outLines.push("HEADER: " + String(b.header || ""));
          outLines.push("SHA256: " + String(b.sha256 || ""));
          outLines.push("```javascript");
          outLines.push(trimLeadingBlankLinesForFence(b.text));
          outLines.push("```");
          outLines.push("");
          continue;
        }

        if (b.kind === "context") {
          outLines.push("【CONTEXT】 " + String(b.needle || ""));
          outLines.push("HITS: " + String(b.hit_count || 0));

          /* 追加した処理:
             CODE_ONLY（厳格）=ON のときは抽出結果内に LINES / MAX_MATCHES を入れない */
          if (!codeOnly) {
            outLines.push("LINES: ±" + String(b.context_lines || 0));
            outLines.push("MAX_MATCHES: " + String(b.max_matches || 0));
          }

          outLines.push("");

          const items = b.items || [];
          for (let k = 0; k < items.length; k++) {
            const it = items[k] || {};
            outLines.push("HEADER: " + String(it.header || ""));
            outLines.push("SHA256: " + String(it.sha256 || ""));
            outLines.push("```javascript");
            outLines.push(trimLeadingBlankLinesForFence(it.text));
            outLines.push("```");
            outLines.push("");
          }
        }
      }

      outLines.push("<<<EXTRACT_END>>>");

      // ============================================================
      // ★ 追加: FOUND:false / HEADER:not found をコピー対象から除外する
      // ------------------------------------------------------------
      // - textarea（コピー対象）: FOUND:true のみ
      // - textarea外ログ         : FOUND:false / HEADER:not found のみ
      // ============================================================
      const __fullOutText = outLines.join("\n");
      const __split = splitExtractTextByFoundFlags(__fullOutText);

      // textarea（コピー対象）は FOUND:true だけ（+ 先頭メタ部は維持）
      lastExtractText = __split.keepText;

      /* 追加した処理: 抽出結果は専用textareaへ表示（splitの「現在のパート」カードは触らない） */
      const ex = $("extractPreview");
      if (ex) {
        ex.value = lastExtractText;
        try { ex.scrollTop = 0; } catch (e) {}
      }

      // FOUND:false / HEADER:not found は textarea 外に“小ログ”として表示（コピー対象外）
      const nfEl = $("extractNotFoundLog");
      if (nfEl) {
        const t = String(__split.notFoundText || "").trim();
        if (t) {
          nfEl.textContent = "FOUND: false（コピー対象外ログ）\n" + t;
        } else {
          nfEl.textContent = "";
        }
      }

      const btnCopyExtract = $("copyExtract");
      if (btnCopyExtract) {
        btnCopyExtract.disabled = !String(lastExtractText || "").trim();
      }

      setStatus("抽出完了（FOUND:false はコピー対象外ログへ分離しました）。「抽出結果をコピー」でそのまま貼れます。");
    } catch (e) {
      $("run").disabled = false;
      if ($("runExtract")) $("runExtract").disabled = false;
      setStatus("抽出例外: " + String(e));
    }
  }

  if ($("runExtract")) {
    $("runExtract").onclick = doExtract;
  }

  $("copyCurrent").onclick = copyCurrent;
  $("copyNext").onclick = copyNext;

  async function copyExtract() {
    const btn = $("copyExtract");
    try {
      const text = String(lastExtractText || "");
      if (!text.trim()) {
        flashButton(btn, "ng");
        setStatus("抽出結果が空です（先に「抽出（extract）」を実行してください）");
        return;
      }

      await navigator.clipboard.writeText(text);
      flashButton(btn, "ok");

      const old = btn.textContent;
      btn.textContent = "Copied ✓";
      window.setTimeout(() => (btn.textContent = old), 650);

      setStatus("抽出結果をコピーしました（<<<EXTRACT_BEGIN>>> から全部）");
    } catch (e) {
      flashButton(btn, "ng");
      setStatus("抽出結果コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
    }
  }

  if ($("copyExtract")) {
    $("copyExtract").onclick = copyExtract;
  }

  if ($("instruction")) {
    $("instruction").addEventListener("input", () => {
      autosizeInstruction();
      saveUiState();
    });
  }

  /* 追加: project_id / task_id 入力も即保存 */
  if ($("projectId")) {
    $("projectId").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("taskId")) {
    $("taskId").addEventListener("input", () => {
      saveUiState();
    });
    $("taskId").addEventListener("change", () => {
      const v = String(($("taskId") && $("taskId").value) || "").trim();
      if (v) rememberTaskId(v);
      saveUiState();
    });
  }

  /* 追加: 「ID＋いつものルールを挿入」ボタン */
  if ($("injectMetaRules")) {
    $("injectMetaRules").onclick = () => {
      const pid = String(($("projectId") && $("projectId").value) || "").trim();
      const tid = String(($("taskId") && $("taskId").value) || "").trim();

      if (tid) rememberTaskId(tid);

      const meta = buildMetaRulesBlock(pid, tid);
      upsertMetaRulesIntoInstruction(meta);

      setStatus("instruction に project_id/task_id + いつものルールを挿入しました");
    };
  }

  if ($("toggleAll")) {
    $("toggleAll").onclick = () => {
      previewAllOn = !previewAllOn;
      updateToggleAllButton();
      renderCurrent();
      saveUiState();
    };
  }
  
  if ($("prefix")) {
    $("prefix").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("lang")) {
    $("lang").addEventListener("change", () => {
      saveUiState();
    });
  }

  if ($("maxchars")) {
    $("maxchars").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("maxlines")) {
    $("maxlines").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("maxlogs")) {
    $("maxlogs").addEventListener("input", () => {
      saveUiState();
    });
  }

  (function(){
    const hidden = $("splitMode");
    const radios = document.querySelectorAll('input[name="splitModeRadio"]');

    if (radios && radios.length > 0) {
      for (let i = 0; i < radios.length; i++) {
        const r = radios[i];
        r.addEventListener("change", () => {
          if (!r.checked) return;

          const v = String(r.value || "C");
          if (hidden) {
            hidden.value = v;
          }
          saveUiState();
        });
      }
    }
  })();

  if ($("file")) {
    $("file").addEventListener("change", async () => {
      const list = $("file").files ? $("file").files : null;
      if (!list || list.length === 0) return;
      setFilesFromDrop(list);
    });
  }

  if ($("resetGen")) {
    $("resetGen").onclick = resetGeneratedOnly;
    $("resetGen").disabled = true;
  }

  if ($("histClear")) {
    $("histClear").disabled = true;
  }

  restoreUiState();
  refreshTaskIdDatalist();
  applyUIMode(window.__uiMode || "split");

  (function(){
    const hidden = $("splitMode");
    const v = String(hidden && hidden.value ? hidden.value : "C");
    const radios = document.querySelectorAll('input[name="splitModeRadio"]');
    for (let i = 0; i < radios.length; i++) {
      const r = radios[i];
      const rv = String(r && r.value ? r.value : "");
      r.checked = (rv === v);
    }
  })();

  autosizeInstruction();
  updateToggleAllButton();
  renderCurrent();
  renderInstructionHistory();
  saveUiState();

  /* 初期表示では status を出さない（ファイル未選択時の非表示） */
  setStatus("");
  
  window.addEventListener("resize", () => {
    try {
      const box = $("instructionHistory");
      if (!box) return;

      const cards = box.querySelectorAll(".card");
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const pre = c.querySelector("pre");
        if (!pre) continue;

        /* 元の全文 instruction は pre の dataset に保持しておく */
        const raw = pre.dataset && typeof pre.dataset.fullInstruction === "string"
          ? pre.dataset.fullInstruction
          : null;

        if (raw !== null) {
          pre.textContent = buildHistoryPreviewText(raw, pre);
        }
      }
    } catch (e) {}
  });

  /* 初期表示では status を出さない（ファイル未選択時の非表示） */
  setStatus("");

  // ============================================================
  // textarea 高さリサイズ（広いハンドルでドラッグできるようにする）
  // ------------------------------------------------------------
  // 使い方:
  //   <div class="ta-resize-wrap" data-target="TEXTAREA_ID">
  //     <textarea id="TEXTAREA_ID"></textarea>
  //     <div class="ta-resize-handle"></div>
  //     <div class="ta-resize-hint">...</div>
  //   </div>
  // ============================================================
  (function () {
    "use strict";

    function setupResizeWrap(wrap) {
      var targetId = wrap.getAttribute("data-target");
      var ta = document.getElementById(targetId);
      var handle = wrap.querySelector(".ta-resize-handle");
      if (!ta || !handle) return;

      var startY = 0;
      var startH = 0;
      var active = false;

      function onMove(e) {
        if (!active) return;
        var clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        var dy = clientY - startY;
        var next = Math.max(80, startH + dy); /* 最小高さ 80px */
        ta.style.height = String(next) + "px";
        e.preventDefault();
      }

      function onUp() {
        if (!active) return;
        active = false;
        wrap.classList.remove("is-resizing");
        document.removeEventListener("mousemove", onMove, { passive: false });
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("touchmove", onMove, { passive: false });
        document.removeEventListener("touchend", onUp);
      }

      function onDown(e) {
        active = true;
        wrap.classList.add("is-resizing");
        startY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;

        var rect = ta.getBoundingClientRect();
        var computed = window.getComputedStyle(ta);
        var h = rect.height;
        if (computed && computed.height) {
          var parsed = parseFloat(computed.height);
          if (!Number.isNaN(parsed)) h = parsed;
        }
        startH = h;

        document.addEventListener("mousemove", onMove, { passive: false });
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);

        e.preventDefault();
      }

      handle.addEventListener("mousedown", onDown);
      handle.addEventListener("touchstart", onDown, { passive: false });
    }

    function init() {
      var wraps = document.querySelectorAll(".ta-resize-wrap[data-target]");
      for (var i = 0; i < wraps.length; i++) setupResizeWrap(wraps[i]);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();

  window.addEventListener("resize", () => {
    try {
      const box = $("instructionHistory");
      if (!box) return;

      const cards = box.querySelectorAll(".card");
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const pre = c.querySelector("pre");
        if (!pre) continue;

        /* 元の全文 instruction は pre の dataset に保持しておく */
        const raw = pre.dataset && typeof pre.dataset.fullInstruction === "string"
          ? pre.dataset.fullInstruction
          : null;

        if (raw !== null) {
          pre.textContent = buildHistoryPreviewText(raw, pre);
        }
      }
    } catch (e) {}
  });
