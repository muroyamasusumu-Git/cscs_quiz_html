// consistency_check_debug.js
// NSCA-CSCS 問題の「整合性チェック」専用デバッグスクリプト
// - deep_dive とは完全に別物
// - APIキーはここには絶対に書かない
// - Cloudflare Functions などの /api/consistency-check に投げる前提

(function() {
  "use strict";

  // ===== 設定 =====
  const GEMINI_MODEL = "models/gemini-2.5-flash";
  const ENDPOINT_PATH = "/api/consistency-check"; // Cloudflare 側で受けるエンドポイント
  const STRICT_MODE_DEFAULT = true; // 空気を読ませない「厳しめ判定」モード
  var lastConsistencyDebug = null;

  // ===== プロンプト生成 =====

  /**
   * 整合性チェック用のプロンプト文字列を生成
   *
   * @param {Object} meta
   * @param {string} meta.day
   * @param {string} meta.field
   * @param {string} meta.theme
   * @param {string} meta.level
   *
   * @param {Object} q
   * @param {string} q.question
   * @param {string[]} q.choices  // [A, B, C, D]
   * @param {number} q.correct_index  // 0-based
   * @param {string} q.explanation
   * @param {boolean} strictMode
   * @returns {string}
   */
  function buildConsistencyPrompt(meta, q, strictMode) {
    var strictText = strictMode ? "（厳格モード: 空気を一切読まず、グレーは全て問題ありと判定する）" : "（通常モード）";

    var prompt = ""
      + "あなたは NSCA-CSCS 試験レベルの専門知識を持つ「問題整合性チェッカー」です。\n"
      + "以下の 1 問について、「問題文（問）」「選択肢」「正解ラベル」「解説文」が\n"
      + "NSCA-CSCS の出題レベルとして妥当かどうかを厳密に判定してください。\n"
      + "\n"
      + "現在の判定モード: " + strictText + "\n"
      + "\n"
      + "重要な前提ルール:\n"
      + "\n"
      + "1. 問題文（問）の扱い\n"
      + "- 問題文は「原則として正しい前提条件」として扱ってください。\n"
      + "- 「事実が間違っているから書き換える」のではなく、\n"
      + "  あくまで「与えられた前提のもとで、回答と解説が整合しているか」を評価することが主目的です。\n"
      + "- ただし、NSCA-CSCS の出題として明らかに不適切な場合\n"
      + "  （あいまいすぎて解答できない、NSCA的にほぼ扱わない内容、用語が独自すぎる 等）は、\n"
      + "  別枠「problem_statement_nsac_validity」で評価・指摘してください。\n"
      + "\n"
      + "2. 「優しさ」を禁止します（空気を読む判定はしない）\n"
      + "- 作者に配慮して「まあ許容できるだろうから◎にしておこう」といった\n"
      + "  情緒的な判定は絶対に行わないでください。\n"
      + "- グレーゾーンの場合は「問題あり」としてフラグを立ててください。\n"
      + "- 「本番の NSCA-CSCS 試験問題として掲載してよいか？」という厳しめの基準で評価してください。\n"
      + "\n"
      + "3. 主なチェック対象\n"
      + "(1) answer_correctness\n"
      + "- 正解とされている選択肢が、本当に妥当な正解か？\n"
      + "- 他の選択肢の方が正しい、または複数の選択肢が正解と言えてしまわないか？\n"
      + "- 誤答選択肢（ディストラクタ）が NSCA-CSCS 的に変な誤り方をしていないか？\n"
      + "- 正解の成立方式を必ず分類してください：\n"
      + "    ・direct      → 問題文の条件と NSCA 知識から積極的にその選択肢を正解と支持できる\n"
      + "    ・elimination → 他の選択肢の誤りを消去した結果、残ったために正解となっている\n"
      + "    ・uncertain   → 情報不足などで direct / elimination のどちらとも言えない\n"
      + "- mode と mode_reason は必須です。\n"
      + "\n"
      + "(2) explanation_quality\n"
      + "- 解説が「正解とされている選択肢」をちゃんと説明しているか？\n"
      + "- 解説が、運動生理学・解剖学・栄養学・プログラムデザインなどの\n"
      + "  NSCA-CSCS の知識として正しく、一貫しているか？\n"
      + "- 問題文・正解と矛盾していないか？\n"
      + "- 主張に対して必要な前提や条件が抜けていないか？\n"
      + "\n"
      + "(3) problem_statement_nsac_validity\n"
      + "- 問題文の日本語としての自然さ（多少のぎこちなさは許容）。\n"
      + "- それよりも、「NSCA-CSCS の試験問題として妥当な問い方か？」を重視。\n"
      + "  例:\n"
      + "  - 情報不足で解答が決まらない\n"
      + "  - 重要でない枝葉の知識を聞きすぎている\n"
      + "  - 教科書に載らないレベルのマニアックすぎる設定\n"
      + "  - 用語が NSCA-CSCS で一般的に使われない表現ばかり など\n"
      + "\n"
      + "4. 出力フォーマット\n"
      + "- 出力は必ず 1つの JSON オブジェクトのみ とし、その前後に一切の文字（説明文・前置き・後置き・注釈・コードブロック記号 ``` ・言語名 json など）は付けないでください。\n"
      + "- 先頭の1文字目は必ず \"{\"、末尾の1文字目は必ず \"}\" になるようにし、その外側に改行や空白・コメントなどを置かないでください。\n"
      + "- すべての文字列は日本語で書いてください（専門用語に英語併記するのは可です）。\n"
      + "\n"
      + "出力すべき JSON のスキーマ:\n"
      + "\n"
      + "{\n"
      + "  \"overall\": \"ok\" | \"minor_issue\" | \"ng\",\n"
      + "  \"judgement_mark\": \"◎\" | \"×\",\n"
      + "\n"
      + "  \"reason_summary\": \"全体としての評価理由を簡潔に（3〜5行程度）\",\n"
      + "\n"
      + "  \"answer_correctness\": {\n"
      + "    \"status\": \"ok\" | \"ambiguous\" | \"wrong\",\n"
      + "    \"mode\": \"direct\" | \"elimination\" | \"uncertain\",\n"
      + "    \"mode_reason\": \"そのモードになった理由（1〜3行）\",\n"
      + "    \"issues\": [\n"
      + "      \"問題がある点・気になった点を具体的に列挙（0個以上）\"\n"
      + "    ],\n"
      + "    \"suggested_correct_choice_index\": 0\n"
      + "  },\n"
      + "\n"
      + "  \"explanation_quality\": {\n"
      + "    \"status\": \"good\" | \"problematic\" | \"dangerous_or_wrong\",\n"
      + "    \"issues\": [\n"
      + "      \"解説のどの部分がどう問題か、またはどこが特に良いか\"\n"
      + "    ]\n"
      + "  },\n"
      + "\n"
      + "  \"problem_statement_nsac_validity\": {\n"
      + "    \"status\": \"good\" | \"ambiguous\" | \"not_nsac_style\",\n"
      + "    \"issues\": [\n"
      + "      \"必ず1つ以上の要素を入れてください。空配列は絶対に使わないでください。\",\n"
      + "      \"status が good の場合: 『この問題文を NSCA-CSCS の本試験問題として掲載してよいと判断した理由』を1〜3文で具体的に書く（例: 出題範囲の中核をついている／問われ方が標準的／難易度が適切 など）\",\n"
      + "      \"status が ambiguous の場合: 『どの点が曖昧・情報不足で、本試験問題として採用した場合にどのようなリスクがあるか』を具体的に書く\",\n"
      + "      \"status が not_nsac_style の場合: 『この問題文を NSCA-CSCS の本試験問題として掲載すべきでないと判断した具体的な理由』を列挙する（例: 枝葉の知識に偏りすぎている／教科書にほぼ登場しない設定／用語が独自すぎる 等）\"\n"
      + "    ],\n"
      + "    \"suggested_rewrite\": \"必要な場合だけ、元の意図を保ったままの改善案を書く。不要なら空文字。\"\n"
      + "  },\n"
      + "\n"
      + "  \"auto_fixable\": true | false,\n"
      + "\n"
      + "  \"suggested_fixed_item\": {\n"
      + "    \"question\": \"修正した方がよい場合のみ、改善済みの問題文。不要なら元の問題文をそのまま入れる。\",\n"
      + "    \"choices\": [\n"
      + "      \"選択肢 A（必要に応じて修正済み）\",\n"
      + "      \"選択肢 B\",\n"
      + "      \"選択肢 C\",\n"
      + "      \"選択肢 D\"\n"
      + "    ],\n"
      + "    \"correct_index\": 0,\n"
      + "    \"explanation\": \"修正済みの解説。修正不要なら元の解説をそのまま入れる。\",\n"
      + "    \"deep_dive_tags\": [\n"
      + "      \"この問題に関連するタグ（例: エネルギー供給機構, 神経筋, プログラムデザイン など）\"\n"
      + "    ]\n"
      + "  }\n"
      + "}\n"
      + "\n"
      + "判定ロジックのガイドライン:\n"
      + "\n"
      + "- \"overall\":\n"
      + "  - すべての観点が明確に問題なし → \"ok\"\n"
      + "  - 軽微だが気になる点がある、しかし本番に出しても大きな問題にはならない → \"minor_issue\"\n"
      + "  - 正解が疑わしい、解説が誤っている、出題として不適切など → \"ng\"\n"
      + "\n"
      + "- \"judgement_mark\":\n"
      + "  - 本番用の問題集にそのまま入れてよいレベル → \"◎\"\n"
      + "  - 何らかの修正が必要 / 出題として不適切 → \"×\"\n"
      + "  - \"overall\" が \"ng\" の場合は必ず \"×\" にしてください。\n"
      + "\n"
      + "- \"answer_correctness.status\":\n"
      + "  - 正解が明確で妥当 → \"ok\"\n"
      + "  - 複数の選択肢が正解に見える／情報不足で正解が決めにくい → \"ambiguous\"\n"
      + "  - 正解ラベルが明らかに誤り → \"wrong\"\n"
      + "\n"
      + "- \"answer_correctness.mode\":\n"
      + "  - 正解を積極的に支持できる → \"direct\"\n"
      + "  - 他の選択肢の誤りを消去した結果の正解 → \"elimination\"\n"
      + "  - 情報不足や曖昧さでどちらとも言えない → \"uncertain\"\n"
      + "\n"
      + "- \"auto_fixable\":\n"
      + "  - あなたの提案どおりに書き換えれば「◎」レベルまで持っていけると思う → true\n"
      + "  - そもそも問いの構造から作り直した方がよい／出題範囲から外れている → false\n"
      + "\n"
      + "ここからが入力データです。\n"
      + "==== 入力データここから ====\n"
      + "\n"
      + "[メタ情報]\n"
      + "Day: " + meta.day + "\n"
      + "Field: " + meta.field + "\n"
      + "Theme: " + meta.theme + "\n"
      + "Level: " + meta.level + "\n"
      + "\n"
      + "[問題文（問）]\n"
      + q.question + "\n"
      + "\n"
      + "[選択肢]\n"
      + "A. " + q.choices[0] + "\n"
      + "B. " + q.choices[1] + "\n"
      + "C. " + q.choices[2] + "\n"
      + "D. " + q.choices[3] + "\n"
      + "\n"
      + "[正解ラベル（0-based index）]\n"
      + String(q.correct_index) + "\n"
      + "\n"
      + "[解説文]\n"
      + q.explanation + "\n"
      + "\n"
      + "==== 入力データここまで ====\n"
      + "\n"
      + "上記の入力データをもとに、前置き・後置き・説明文・コードブロック記号（```）・言語名指定（json など）を一切付けず、「JSON オブジェクトのみ」を 1 つだけ出力してください。\n";

    return prompt;
  }

  // ===== API 呼び出し =====

  /**
   * Cloudflare Functions 経由で Gemini 整合性チェックを実行
   *
   * @param {Object} payload
   * @param {Object} payload.meta
   * @param {Object} payload.question
   * @param {boolean} [payload.strict]
   * @returns {Promise<Object>}  // Gemini からの JSON 応答
   */
  async function requestConsistencyCheck(payload) {
    var meta = payload.meta;
    var q = payload.question;
    var strict = typeof payload.strict === "boolean" ? payload.strict : STRICT_MODE_DEFAULT;

    var prompt = buildConsistencyPrompt(meta, q, strict);

    lastConsistencyDebug = {
      meta: meta,
      question: q,
      strict: strict,
      prompt: prompt,
      rawResponseText: "",
      sanitizedJsonText: "",
      parsedResult: null,
      parsingError: null
    };

    var body = {
      model: GEMINI_MODEL,
      prompt: prompt,
      strict: strict
    };

    var response = await fetch(ENDPOINT_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    var text = await response.text();

    if (!response.ok) {
      console.error("整合性チェック API 生レスポンス:", text);
      throw new Error("整合性チェック API エラー: HTTP " + response.status + " / body: " + text);
    }

    if (lastConsistencyDebug) {
      lastConsistencyDebug.rawResponseText = text;
    }
    if (lastConsistencyDebug) {
      lastConsistencyDebug.rawResponseText = text;
    }

    try {
      var jsonText = text;

      if (typeof jsonText === "string") {
        var trimmed = jsonText.trim();
        if (trimmed.startsWith("```")) {
          var lines = trimmed.split("\n");
          if (lines.length > 0) {
            var firstLine = lines[0].trim();
            if (
              firstLine === "```" ||
              firstLine === "```json" ||
              firstLine === "```JSON" ||
              firstLine.toLowerCase().startsWith("```json")
            ) {
              lines.shift();

              while (lines.length > 0 && lines[0].trim() === "") {
                lines.shift();
              }

              while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
                lines.pop();
              }

              if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
                lines.pop();
              }

              jsonText = lines.join("\n").trim();
            } else {
              jsonText = trimmed;
            }
          } else {
            jsonText = trimmed;
          }
        } else {
          jsonText = trimmed;
        }
      }

      if (lastConsistencyDebug) {
        lastConsistencyDebug.sanitizedJsonText = typeof jsonText === "string" ? jsonText : "";
      }

      var json = JSON.parse(jsonText);
      if (lastConsistencyDebug) {
        lastConsistencyDebug.parsedResult = json;
        lastConsistencyDebug.parsingError = null;
      }
      return json;
    } catch (e) {
      if (lastConsistencyDebug) {
        lastConsistencyDebug.sanitizedJsonText = typeof jsonText === "string" ? jsonText : "";
        lastConsistencyDebug.parsedResult = null;
        lastConsistencyDebug.parsingError = String(e && e.message ? e.message : e);
      }
      console.error("整合性チェック応答 JSON パース失敗:", e, text);
      throw new Error("整合性チェック応答が JSON ではありません。");
    }
  }

  // ===== 公開関数（Bパートなどから呼ぶ用） =====

  /**
   * 1問ぶんのデータを渡して整合性チェックを実行
   *
   * @param {Object} meta
   * @param {string} meta.day
   * @param {string} meta.field
   * @param {string} meta.theme
   * @param {string} meta.level
   *
   * @param {Object} q
   * @param {string} q.question
   * @param {string[]} q.choices
   * @param {number} q.correct_index
   * @param {string} q.explanation
   *
   * @param {boolean} [strict]
   * @returns {Promise<Object>}
   */
  function runConsistencyCheck(meta, q, strict) {
    var payload = {
      meta: meta,
      question: q,
      strict: strict
    };
    return requestConsistencyCheck(payload);
  }

  /**
   * パネル用コンテナを取得または生成
   *
   * @returns {HTMLElement}
   */
  function getConsistencyPanelContainer() {
    var existing = document.getElementById("cscs-consistency-panel");
    if (existing) {
      return existing;
    }
    var div = document.createElement("div");
    div.id = "cscs-consistency-panel";
    div.setAttribute("role", "dialog");

    // ★ root の中に入れる。なければ body にフォールバック。
    var root = document.getElementById("root");
    if (root) {
      root.appendChild(div);
    } else {
      document.body.appendChild(div);
    }

    return div;
  }

  /**
   * 結果オブジェクトからパネル用 HTML を生成
   *
   * @param {Object} meta
   * @param {Object} q
   * @param {Object} result
   * @param {boolean} strict
   * @returns {string}
   */
  function buildConsistencyResultHtml(meta, q, result, strict) {
    var overall = result && typeof result.overall === "string" ? result.overall : "";
    var mark = result && typeof result.judgement_mark === "string" ? result.judgement_mark : "";
    var summary = result && typeof result.reason_summary === "string" ? result.reason_summary : "";

    var ac = result && result.answer_correctness ? result.answer_correctness : {};
    var acStatus = typeof ac.status === "string" ? ac.status : "";
    var acMode = typeof ac.mode === "string" ? ac.mode : "";
    var acModeReason = typeof ac.mode_reason === "string" ? ac.mode_reason : "";
    var acIssues = Array.isArray(ac.issues) ? ac.issues : [];

    var eq = result && result.explanation_quality ? result.explanation_quality : {};
    var eqStatus = typeof eq.status === "string" ? eq.status : "";
    var eqIssues = Array.isArray(eq.issues) ? eq.issues : [];

    var ps = result && result.problem_statement_nsac_validity ? result.problem_statement_nsac_validity : {};
    var psStatus = typeof ps.status === "string" ? ps.status : "";
    var psIssues = Array.isArray(ps.issues) ? ps.issues : [];

    var strictLabel = strict ? "厳格モード" : "通常モード";

    var classificationCode = "S";
    var classificationLabel = "S. 何も直さなくて良い";
    var classificationPriority = "なし";
    var classificationReason = "";

    if (acStatus === "wrong") {
      classificationCode = "A";
      classificationLabel = "A. 正解を直すべき";
      classificationPriority = "高";
      classificationReason = "正解ラベルが問題内容や NSCA-CSCS の知識と整合していない可能性があります。正解そのものの修正が最優先です。";
    } else if (psStatus === "not_nsac_style") {
      classificationCode = "D";
      classificationLabel = "D. 問題そのものを直すべき";
      classificationPriority = "高";
      classificationReason = "問題文が NSCA-CSCS の出題範囲や問い方として不適切と判定されています。問題構造から見直す必要があります。";
    } else if (eqStatus === "dangerous_or_wrong") {
      classificationCode = "B";
      classificationLabel = "B. 解説を直すべき";
      classificationPriority = "高";
      classificationReason = "解説内容が正解や NSCA-CSCS の知識と矛盾している、または誤っている可能性があります。解説の修正が優先されます。";
    } else if (eqStatus === "problematic") {
      classificationCode = "B";
      classificationLabel = "B. 解説を直すべき";
      classificationPriority = "中";
      classificationReason = "解説が不十分であったり、前提や条件の説明が不足しているため、学習効果の面で改善余地があります。";
    } else if (acStatus === "ambiguous") {
      classificationCode = "C";
      classificationLabel = "C. 選択肢を直すべき";
      classificationPriority = "中";
      classificationReason = "正解と意味が近い選択肢や紛らわしい誤答が含まれている可能性があります。選択肢全体の整理が望まれます。";
    } else if (overall === "minor_issue") {
      classificationCode = "C";
      classificationLabel = "C. 選択肢を直すべき";
      classificationPriority = "低";
      classificationReason = "致命的ではありませんが、選択肢や表現に軽微な改善余地があります。余裕があれば修正を検討してください。";
    } else if (
      overall === "ok" &&
      acStatus === "ok" &&
      (eqStatus === "good" || eqStatus === "") &&
      (psStatus === "good" || psStatus === "")
    ) {
      classificationCode = "S";
      classificationLabel = "S. 何も直さなくて良い";
      classificationPriority = "なし";
      classificationReason = "正解・解説・選択肢・問題文はいずれも NSCA-CSCS の出題として妥当であり、優先して修正すべき点は見当たりません。";
    } else {
      classificationCode = "C";
      classificationLabel = "C. 選択肢を直すべき";
      classificationPriority = "低";
      classificationReason = "大きな破綻はありませんが、一部の選択肢や表現に調整の余地があります。";
    }

    var severityMark = "◎";
    var severityLabel = "変更必要なし";

    if (classificationPriority === "高") {
      severityMark = "×";
      severityLabel = "変更が必要（優先度/高）";
    } else if (classificationPriority === "中") {
      severityMark = "△";
      severityLabel = "変更を推奨（優先度/中）";
    } else if (classificationPriority === "低") {
      severityMark = "○";
      severityLabel = "ほぼ変更必要なし（優先度/低）";
    } else {
      severityMark = "◎";
      severityLabel = "変更必要なし";
    }

    var classificationText = classificationLabel.replace(/^.\.\s*/, "");

    var html = "";

    html += '<div class="cc-panel-header-row">';
    html += '<div class="cc-panel-header-title">整合性チェック結果</div>';
    html += '<div class="cc-panel-header-actions">';
    html += '<button type="button" id="cscs-consistency-copy-debug" class="cc-btn cc-btn-secondary">デバッグ用テキストをコピー</button>';
    html += '<button type="button" id="cscs-consistency-refresh" class="cc-btn cc-btn-secondary">更新</button>';
    html += '<button type="button" id="cscs-consistency-panel-close" class="cc-btn cc-btn-close">閉じる</button>';
    html += "</div>";
    html += "</div>";

    html += '<div class="cc-panel-classification">';
    html += '<div class="cc-classification-title">分類結果: ' + classificationCode + " ／ " + severityMark + ". " + classificationText + "（修正優先度: " + classificationPriority + "）</div>";
    if (classificationReason) {
      html += '<div class="cc-classification-reason">' + classificationReason + "</div>";
    }
    html += "</div>";

    html += '<div class="cc-panel-summary">';
    html += '<div class="cc-panel-summary-top">';
    html += '<div class="cc-summary-mode">モード: ' + strictLabel + "</div>";
    html += '<div class="cc-summary-overall">ステータス: ' + severityMark + "（" + severityLabel + "） ／ 種別: " + classificationCode + "</div>";
    html += "</div>";
    html += '<div class="cc-panel-cards">';

    html += '<div class="cc-card cc-card-answer">';
    html += '<div class="cc-card-title">正解の妥当性</div>';
    html += '<div class="cc-card-main">status: ' + acStatus + "</div>";
    html += '<div class="cc-card-sub">mode: ' + acMode + "</div>";
    html += "</div>";

    html += '<div class="cc-card cc-card-choices">';
    html += '<div class="cc-card-title">選択肢の妥当性</div>';
    html += '<div class="cc-card-main">status: ' + acStatus + "</div>";
    html += '<div class="cc-card-sub">choices / distractors</div>';
    html += "</div>";

    html += '<div class="cc-card cc-card-explanation">';
    html += '<div class="cc-card-title">解説の品質</div>';
    html += '<div class="cc-card-main">status: ' + eqStatus + "</div>";
    html += '<div class="cc-card-sub">explanation_quality</div>';
    html += "</div>";

    html += '<div class="cc-card cc-card-problem">';
    html += '<div class="cc-card-title">問題文の NSCA 的妥当性</div>';
    html += '<div class="cc-card-main">status: ' + psStatus + "</div>";
    html += '<div class="cc-card-sub">problem_statement_nsac_validity</div>';
    html += "</div>";

    html += "</div>";
    html += "</div>";

    html += '<div class="cc-section cc-section-summary">';
    html += '<div class="cc-section-title">全体コメント</div>';
    html += '<div class="cc-summary-text">' + summary + "</div>";
    html += "</div>";

    html += '<div class="cc-separator"></div>';

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">詳細: 正解の妥当性 (answer_correctness)</div>';
    html += '<div class="cc-section-status">';
    html += "status: " + acStatus + " ／ mode: " + acMode;
    html += "</div>";
    if (acModeReason) {
      html += '<div class="cc-section-mode-reason">';
      html += "mode_reason: " + acModeReason;
      html += "</div>";
    }
    if (acIssues.length > 0) {
      html += '<ul class="cc-section-list">';
      for (var i = 0; i < acIssues.length; i++) {
        html += "<li>" + acIssues[i] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">詳細: 解説の品質 (explanation_quality)</div>';
    html += '<div class="cc-section-status">';
    html += "status: " + eqStatus;
    html += "</div>";
    if (eqIssues.length > 0) {
      html += '<ul class="cc-section-list">';
      for (var j = 0; j < eqIssues.length; j++) {
        html += "<li>" + eqIssues[j] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">詳細: 問題文の NSCA 的妥当性 (problem_statement_nsac_validity)</div>';
    html += '<div class="cc-section-status">';
    html += "status: " + psStatus;
    html += "</div>";
    if (psIssues.length > 0) {
      html += '<ul class="cc-section-list">';
      for (var k = 0; k < psIssues.length; k++) {
        html += "<li>" + psIssues[k] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    /*
    html += '<div class="cc-separator"></div>';

    html += '<div class="cc-meta-line">';
    html += "Day: " + meta.day + " ／ Field: " + meta.field + " ／ Theme: " + meta.theme + " ／ Level: " + meta.level;
    html += "</div>";

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">問題文</div>';
    html += '<div class="cc-section-text">' + q.question + "</div>";
    html += "</div>";

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">選択肢</div>';
    html += '<div class="cc-section-text">';
    html += "A. " + q.choices[0] + "<br>";
    html += "B. " + q.choices[1] + "<br>";
    html += "C. " + q.choices[2] + "<br>";
    html += "D. " + q.choices[3];
    html += "</div>";
    html += "</div>";

    html += '<div class="cc-section">';
    html += '<div class="cc-section-title">解説</div>';
    html += '<div class="cc-section-text">' + q.explanation + "</div>";
    html += "</div>";
    */

    return html;
  }

  /**
   * 結果をパネルに描画
   *
   * @param {Object} meta
   * @param {Object} q
   * @param {Object} result
   * @param {boolean} strict
   */
  function showConsistencyResultPanel(meta, q, result, strict) {
    var panel = getConsistencyPanelContainer();
    panel.innerHTML = buildConsistencyResultHtml(meta, q, result, strict);

    panel.addEventListener("click", function(e) {
      e.stopPropagation();
    });

    var closeBtn = document.getElementById("cscs-consistency-panel-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        if (panel && panel.parentNode) {
          panel.parentNode.removeChild(panel);
        }
      });
    }

    var refreshBtn = document.getElementById("cscs-consistency-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        e.preventDefault();
        var useStrict = typeof strict === "boolean" ? strict : STRICT_MODE_DEFAULT;
        window.CSCSConsistencyCheck.runAndShowConsistencyCheck(meta, q, useStrict);
      });
    }

    var copyBtn = document.getElementById("cscs-consistency-copy-debug");
    if (copyBtn) {
      copyBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        e.preventDefault();

        var lines = [];
        lines.push("=== CSCS Consistency Check Debug ===");
        lines.push("");
        lines.push("[Meta]");
        lines.push("Day: " + String(meta && meta.day ? meta.day : ""));
        lines.push("Field: " + String(meta && meta.field ? meta.field : ""));
        lines.push("Theme: " + String(meta && meta.theme ? meta.theme : ""));
        lines.push("Level: " + String(meta && meta.level ? meta.level : ""));
        lines.push("Strict mode: " + (strict ? "true" : "false"));
        lines.push("");
        lines.push("[Question]");
        lines.push(q && q.question ? q.question : "");
        lines.push("");
        lines.push("[Choices]");
        if (q && Array.isArray(q.choices)) {
          for (var i = 0; i < q.choices.length; i++) {
            lines.push(String.fromCharCode(65 + i) + ". " + String(q.choices[i]));
          }
        }
        lines.push("");
        lines.push("[Correct index (0-based)]");
        lines.push(String(q && typeof q.correct_index === "number" ? q.correct_index : ""));
        lines.push("");
        lines.push("[Explanation]");
        lines.push(q && q.explanation ? q.explanation : "");
        lines.push("");

        if (lastConsistencyDebug) {
          lines.push("[Prompt sent to Gemini]");
          lines.push(lastConsistencyDebug.prompt ? lastConsistencyDebug.prompt : "");
          lines.push("");
          lines.push("[Raw response text from /api/consistency-check]");
          lines.push(lastConsistencyDebug.rawResponseText ? lastConsistencyDebug.rawResponseText : "");
          lines.push("");
          if (lastConsistencyDebug.sanitizedJsonText) {
            lines.push("[Sanitized JSON text before parse]");
            lines.push(lastConsistencyDebug.sanitizedJsonText);
            lines.push("");
          }
          if (lastConsistencyDebug.parsingError) {
            lines.push("[JSON parsing error]");
            lines.push(lastConsistencyDebug.parsingError);
            lines.push("");
          }
        }

        if (result) {
          lines.push("[Parsed result JSON]");
          try {
            lines.push(JSON.stringify(result, null, 2));
          } catch (jsonError) {
            lines.push("JSON.stringify error: " + String(jsonError && jsonError.message ? jsonError.message : jsonError));
          }
        }

        var debugText = lines.join("\n");

        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(debugText).then(function() {
            alert("デバッグ用テキストをクリップボードにコピーしました。");
          }).catch(function() {
            alert("クリップボードへのコピーに失敗しました。テキストを手動でコピーしてください。");
          });
        } else {
          alert("この環境ではクリップボードコピーが利用できません。テキストを手動でコピーしてください。\n\n" + debugText);
        }
      });
    }
  }

  /**
   * 整合性チェック結果保存時に使用する localStorage キーを生成
   *
   * @param {Object} meta
   * @param {Object} q
   * @returns {string}
   */
  function getConsistencyStorageKey(meta, q) {
    var keyBase = "cscs_consistency_check:";
    var qid = meta && meta.qid ? String(meta.qid) : "";
    var fallbackId = String(meta && meta.day ? meta.day : "") + "|" + String(q && q.question ? q.question : "").slice(0, 50);
    return keyBase + (qid || fallbackId);
  }

  /**
   * SYNC から最新の整合性ステータスを取得し、localStorage に反映する
   *
   * @param {Object} meta
   * @param {Object} q
   * @returns {Promise<void>}
   */
  async function fetchConsistencySyncStatus(meta, q) {
    if (typeof fetch !== "function") {
      return;
    }
    if (typeof localStorage === "undefined") {
      return;
    }

    var qid = meta && meta.qid ? String(meta.qid) : "";
    if (!qid) {
      return;
    }

    var url = "/api/sync-consistency?qid=" + encodeURIComponent(qid);

    try {
      var response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });

      var text = await response.text();

      if (!response.ok) {
        console.log("[consistency SYNC] fetch failed:", response.status, text);
        return;
      }

      if (!text) {
        return;
      }

      var data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("[consistency SYNC] response JSON parse error:", parseError, text);
        return;
      }

      var items = [];
      if (data && Array.isArray(data.items)) {
        items = data.items;
      } else if (data && data.item) {
        items = [data.item];
      }

      if (!items || items.length === 0) {
        return;
      }

      var item = items[0];
      var statusObj = item && item.status ? item.status : item;

      if (!statusObj || typeof statusObj !== "object") {
        return;
      }

      var severityMark = typeof statusObj.status_mark === "string" ? statusObj.status_mark : "";
      var severityLabel = typeof statusObj.status_label === "string" ? statusObj.status_label : "";
      var classificationCode = typeof statusObj.classification_code === "string" ? statusObj.classification_code : "";
      var classificationDetail = typeof statusObj.classification_detail === "string" ? statusObj.classification_detail : "";
      var savedAtRemote = typeof statusObj.saved_at === "string" ? statusObj.saved_at : "";
      var savedAtIso = savedAtRemote || new Date().toISOString();

      var storageKey = getConsistencyStorageKey(meta, q);
      var existing = null;
      try {
        var existingRaw = localStorage.getItem(storageKey);
        if (existingRaw) {
          existing = JSON.parse(existingRaw);
        }
      } catch (existingError) {
        existing = null;
      }

      var payload = {
        meta: meta,
        question: q,
        strict: existing && typeof existing.strict === "boolean" ? existing.strict : true,
        result: existing && existing.result ? existing.result : null,
        saved_at: savedAtIso,
        severity_mark: severityMark,
        severity_label: severityLabel,
        classification_code: classificationCode,
        classification_label: existing && typeof existing.classification_label === "string" ? existing.classification_label : "",
        classification_priority: existing && typeof existing.classification_priority === "string" ? existing.classification_priority : "",
        classification_detail: classificationDetail
      };

      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (storeError) {
        console.error("[consistency SYNC] failed to store merged payload into localStorage:", storeError);
      }

      try {
        var syncOkKey = "cscs_consistency_sync_ok:" + qid;
        localStorage.setItem(syncOkKey, savedAtIso);
      } catch (syncOkError) {
        console.error("[consistency SYNC] failed to store sync_ok flag:", syncOkError);
      }
    } catch (e) {
      console.error("[consistency SYNC] request failed:", e);
    }
  }

  /**
   * 画面右上の「整合性チェックステータス」表示を更新
   *
   * @param {Object} meta
   * @param {Object} q
   */
  function updateConsistencyCheckStatus(meta, q) {
    var statusDiv = document.getElementById("cc-check-status");
    if (!statusDiv) {

      var wrapper = document.getElementById("cc-check-wrapper");
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.id = "cc-check-wrapper";
        var wrapperParent = document.querySelector(".wrap") || document.body;
        wrapperParent.appendChild(wrapper);
      }

      statusDiv = document.createElement("div");
      statusDiv.id = "cc-check-status";

      var btnInWrapper = document.getElementById("cc-check-btn");
      if (btnInWrapper && btnInWrapper.parentNode === wrapper) {
        wrapper.insertBefore(statusDiv, btnInWrapper);
      } else {
        wrapper.appendChild(statusDiv);
      }
    }

    var lines = [];
    lines.push("整合性チェック: 未");
    lines.push("ステータス: —");
    lines.push("—");
    lines.push("種別: —");
    lines.push("最終: —");
    lines.push("SYNC: 未保存");

    if (typeof localStorage !== "undefined") {
      try {
        var storageKey = getConsistencyStorageKey(meta, q);
        var raw = localStorage.getItem(storageKey);
        if (raw) {
          var data = JSON.parse(raw);
          var result = data && data.result ? data.result : {};
          var savedAt = data && data.saved_at ? String(data.saved_at) : "";
          var savedLabel = savedAt;

          if (savedAt) {
            var d = new Date(savedAt);
            if (!isNaN(d.getTime())) {
              var year = d.getFullYear();
              var month = String(d.getMonth() + 1).padStart(2, "0");
              var day = String(d.getDate()).padStart(2, "0");
              var hour = String(d.getHours()).padStart(2, "0");
              var minute = String(d.getMinutes()).padStart(2, "0");
              savedLabel = year + "-" + month + "-" + day + " " + hour + ":" + minute;
            }
          }

          var severityMark = data && typeof data.severity_mark === "string" ? data.severity_mark : "";
          var severityLabel = data && typeof data.severity_label === "string" ? data.severity_label : "";
          var classificationCode = data && typeof data.classification_code === "string" ? data.classification_code : "";
          var classificationLabel = data && typeof data.classification_label === "string" ? data.classification_label : "";
          var classificationPriority = data && typeof data.classification_priority === "string" ? data.classification_priority : "";

          if (!severityMark || !classificationCode) {
            var overall = typeof result.overall === "string" ? result.overall : "";
            var ac = result && result.answer_correctness ? result.answer_correctness : {};
            var eq = result && result.explanation_quality ? result.explanation_quality : {};
            var ps = result && result.problem_statement_nsac_validity ? result.problem_statement_nsac_validity : {};
            var acStatus = typeof ac.status === "string" ? ac.status : "";
            var eqStatus = typeof eq.status === "string" ? eq.status : "";
            var psStatus = typeof ps.status === "string" ? ps.status : "";

            classificationCode = "S";
            classificationLabel = "S. 何も直さなくて良い";
            classificationPriority = "なし";

            if (acStatus === "wrong") {
              classificationCode = "A";
              classificationLabel = "A. 正解を直すべき";
              classificationPriority = "高";
            } else if (psStatus === "not_nsac_style") {
              classificationCode = "D";
              classificationLabel = "D. 問題そのものを直すべき";
              classificationPriority = "高";
            } else if (eqStatus === "dangerous_or_wrong") {
              classificationCode = "B";
              classificationLabel = "B. 解説を直すべき";
              classificationPriority = "高";
            } else if (eqStatus === "problematic") {
              classificationCode = "B";
              classificationLabel = "B. 解説を直すべき";
              classificationPriority = "中";
            } else if (acStatus === "ambiguous") {
              classificationCode = "C";
              classificationLabel = "C. 選択肢を直すべき";
              classificationPriority = "中";
            } else if (overall === "minor_issue") {
              classificationCode = "C";
              classificationLabel = "C. 選択肢を直すべき";
              classificationPriority = "低";
            } else if (
              overall === "ok" &&
              acStatus === "ok" &&
              (eqStatus === "good" || eqStatus === "") &&
              (psStatus === "good" || psStatus === "")
            ) {
              classificationCode = "S";
              classificationLabel = "S. 何も直さなくて良い";
              classificationPriority = "なし";
            } else {
              classificationCode = "C";
              classificationLabel = "C. 選択肢を直すべき";
              classificationPriority = "低";
            }

            severityMark = "◎";
            severityLabel = "変更必要なし";

            if (classificationPriority === "高") {
              severityMark = "×";
              severityLabel = "変更が必要（優先度/高）";
            } else if (classificationPriority === "中") {
              severityMark = "△";
              severityLabel = "変更を推奨（優先度/中）";
            } else if (classificationPriority === "低") {
              severityMark = "○";
              severityLabel = "ほぼ変更必要なし（優先度/低）";
            } else {
              severityMark = "◎";
              severityLabel = "変更必要なし";
            }
          } else if (!severityLabel) {
            if (classificationPriority === "高") {
              severityLabel = "変更が必要（優先度/高）";
            } else if (classificationPriority === "中") {
              severityLabel = "変更を推奨（優先度/中）";
            } else if (classificationPriority === "低") {
              severityLabel = "ほぼ変更必要なし（優先度/低）";
            } else {
              severityLabel = "変更必要なし";
            }
          }

          lines[0] = "整合性チェック: 済";
          if (severityMark) {
            lines[1] = "ステータス: " + severityMark;
            lines[2] = severityLabel || "—";
          } else {
            lines[1] = "ステータス: —";
            lines[2] = "—";
          }

          var typeDetail = "";
          if (classificationCode === "A") {
            typeDetail = "正解";
          } else if (classificationCode === "B") {
            typeDetail = "解説";
          } else if (classificationCode === "C") {
            typeDetail = "選択肢";
          } else if (classificationCode === "D") {
            typeDetail = "問題";
          }

          if (classificationCode) {
            if (typeDetail) {
              lines[3] = "種別: " + classificationCode + " / " + typeDetail;
            } else {
              lines[3] = "種別: " + classificationCode;
            }
          } else {
            lines[3] = "種別: —";
          }

          lines[4] = "最終: " + (savedLabel || "—");

          var syncStatusLabel = "SYNC: 未保存";
          var qidForSync = meta && meta.qid ? String(meta.qid) : "";
          if (qidForSync && typeof localStorage !== "undefined") {
            try {
              var syncOkKey = "cscs_consistency_sync_ok:" + qidForSync;
              var syncOkValue = localStorage.getItem(syncOkKey);
              if (syncOkValue) {
                syncStatusLabel = "SYNC: 保存済";
              }
            } catch (syncReadError) {
              console.error("整合性チェック SYNC ステータスの読み込みに失敗しました:", syncReadError);
            }
          }
          lines[5] = syncStatusLabel;
        }
      } catch (e) {
        console.error("整合性チェックステータスの読み込みに失敗しました:", e);
      }
    }

    statusDiv.textContent = lines.join("\n");
  }

  /**
   * チェックを実行して結果パネルを表示
   *
   * @param {Object} meta
   * @param {Object} q
   * @param {boolean} [strict]
   * @returns {Promise<void>}
   */
  async function runAndShowConsistencyCheck(meta, q, strict) {
    var panel = getConsistencyPanelContainer();
    panel.innerHTML = '<div style="font-size:14px;">整合性チェックを実行中です。少し待ってください。</div>';

    try {
      var result = await runConsistencyCheck(meta, q, strict);

      var usedStrict = typeof strict === "boolean" ? strict : STRICT_MODE_DEFAULT;
      if (typeof localStorage !== "undefined") {
        try {
          var storageKey = getConsistencyStorageKey(meta, q);

          var overall = result && typeof result.overall === "string" ? result.overall : "";
          var ac = result && result.answer_correctness ? result.answer_correctness : {};
          var eq = result && result.explanation_quality ? result.explanation_quality : {};
          var ps = result && result.problem_statement_nsac_validity ? result.problem_statement_nsac_validity : {};
          var acStatus = typeof ac.status === "string" ? ac.status : "";
          var eqStatus = typeof eq.status === "string" ? eq.status : "";
          var psStatus = typeof ps.status === "string" ? ps.status : "";

          var classificationCode = "S";
          var classificationLabel = "S. 何も直さなくて良い";
          var classificationPriority = "なし";
          var classificationReason = "";

          if (acStatus === "wrong") {
            classificationCode = "A";
            classificationLabel = "A. 正解を直すべき";
            classificationPriority = "高";
            classificationReason = "正解ラベルが問題内容や NSCA-CSCS の知識と整合していない可能性があります。正解そのものの修正が最優先です。";
          } else if (psStatus === "not_nsac_style") {
            classificationCode = "D";
            classificationLabel = "D. 問題そのものを直すべき";
            classificationPriority = "高";
            classificationReason = "問題文が NSCA-CSCS の出題範囲や問い方として不適切と判定されています。問題構造から見直す必要があります。";
          } else if (eqStatus === "dangerous_or_wrong") {
            classificationCode = "B";
            classificationLabel = "B. 解説を直すべき";
            classificationPriority = "高";
            classificationReason = "解説内容が正解や NSCA-CSCS の知識と矛盾している、または誤っている可能性があります。解説の修正が優先されます。";
          } else if (eqStatus === "problematic") {
            classificationCode = "B";
            classificationLabel = "B. 解説を直すべき";
            classificationPriority = "中";
            classificationReason = "解説が不十分であったり、前提や条件の説明が不足しているため、学習効果の面で改善余地があります。";
          } else if (acStatus === "ambiguous") {
            classificationCode = "C";
            classificationLabel = "C. 選択肢を直すべき";
            classificationPriority = "中";
            classificationReason = "正解と意味が近い選択肢や紛らわしい誤答が含まれている可能性があります。選択肢全体の整理が望まれます。";
          } else if (overall === "minor_issue") {
            classificationCode = "C";
            classificationLabel = "C. 選択肢を直すべき";
            classificationPriority = "低";
            classificationReason = "致命的ではありませんが、選択肢や表現に軽微な改善余地があります。余裕があれば修正を検討してください。";
          } else if (
            overall === "ok" &&
            acStatus === "ok" &&
            (eqStatus === "good" || eqStatus === "") &&
            (psStatus === "good" || psStatus === "")
          ) {
            classificationCode = "S";
            classificationLabel = "S. 何も直さなくて良い";
            classificationPriority = "なし";
            classificationReason = "正解・解説・選択肢・問題文はいずれも NSCA-CSCS の出題として妥当であり、優先して修正すべき点は見当たりません。";
          } else {
            classificationCode = "C";
            classificationLabel = "C. 選択肢を直すべき";
            classificationPriority = "低";
            classificationReason = "大きな破綻はありませんが、一部の選択肢や表現に調整の余地があります。";
          }

          var severityMark = "◎";
          var severityLabel = "変更必要なし";

          if (classificationPriority === "高") {
            severityMark = "×";
            severityLabel = "変更が必要（優先度/高）";
          } else if (classificationPriority === "中") {
            severityMark = "△";
            severityLabel = "変更を推奨（優先度/中）";
          } else if (classificationPriority === "低") {
            severityMark = "○";
            severityLabel = "ほぼ変更必要なし（優先度/低）";
          } else {
            severityMark = "◎";
            severityLabel = "変更必要なし";
          }

          var savedAtIso = new Date().toISOString();
          var storePayload = {
            meta: meta,
            question: q,
            strict: usedStrict,
            result: result,
            saved_at: savedAtIso,
            severity_mark: severityMark,
            severity_label: severityLabel,
            classification_code: classificationCode,
            classification_label: classificationLabel,
            classification_priority: classificationPriority
          };
          localStorage.setItem(storageKey, JSON.stringify(storePayload));

          var qid = meta && meta.qid ? String(meta.qid) : "";
          var classificationDetail = "";
          if (classificationCode === "A") {
            classificationDetail = "正解";
          } else if (classificationCode === "B") {
            classificationDetail = "解説";
          } else if (classificationCode === "C") {
            classificationDetail = "選択肢";
          } else if (classificationCode === "D") {
            classificationDetail = "問題";
          }
          var syncPayload = {
            status_mark: severityMark,
            status_label: severityLabel,
            classification_code: classificationCode,
            classification_detail: classificationDetail,
            saved_at: savedAtIso
          };

          if (typeof window !== "undefined" && window.cscsConsistency && typeof window.cscsConsistency.saveLocal === "function") {
            try {
              window.cscsConsistency.saveLocal(qid, syncPayload);
            } catch (consistencySaveError) {
              console.error("整合性チェック結果の cscsConsistency 保存に失敗しました:", consistencySaveError);
            }
          }

  /**
   * SYNC から最新の整合性ステータスを取得し、localStorage に反映する
   *
   * @param {Object} meta
   * @param {Object} q
   * @returns {Promise<void>}
   */
  async function fetchConsistencySyncStatus(meta, q) {
    if (typeof fetch !== "function") {
      return;
    }
    if (typeof localStorage === "undefined") {
      return;
    }

    var qid = meta && meta.qid ? String(meta.qid) : "";
    if (!qid) {
      return;
    }

    var url = "/api/sync-consistency?qid=" + encodeURIComponent(qid);

    try {
      var response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });

      var text = await response.text();

      if (!response.ok) {
        console.log("[consistency SYNC] fetch failed:", response.status, text);
        return;
      }

      if (!text) {
        return;
      }

      var data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("[consistency SYNC] response JSON parse error:", parseError, text);
        return;
      }

      var items = [];
      if (data && Array.isArray(data.items)) {
        items = data.items;
      } else if (data && data.item) {
        items = [data.item];
      }

      if (!items || items.length === 0) {
        return;
      }

      var item = items[0];
      var statusObj = item && item.status ? item.status : item;

      if (!statusObj || typeof statusObj !== "object") {
        return;
      }

      var severityMark = typeof statusObj.status_mark === "string" ? statusObj.status_mark : "";
      var severityLabel = typeof statusObj.status_label === "string" ? statusObj.status_label : "";
      var classificationCode = typeof statusObj.classification_code === "string" ? statusObj.classification_code : "";
      var classificationDetail = typeof statusObj.classification_detail === "string" ? statusObj.classification_detail : "";
      var savedAtRemote = typeof statusObj.saved_at === "string" ? statusObj.saved_at : "";
      var savedAtIso = savedAtRemote || new Date().toISOString();

      var storageKey = getConsistencyStorageKey(meta, q);
      var existing = null;
      try {
        var existingRaw = localStorage.getItem(storageKey);
        if (existingRaw) {
          existing = JSON.parse(existingRaw);
        }
      } catch (existingError) {
        existing = null;
      }

      var payload = {
        meta: meta,
        question: q,
        strict: existing && typeof existing.strict === "boolean" ? existing.strict : true,
        result: existing && existing.result ? existing.result : null,
        saved_at: savedAtIso,
        severity_mark: severityMark,
        severity_label: severityLabel,
        classification_code: classificationCode,
        classification_label: existing && typeof existing.classification_label === "string" ? existing.classification_label : "",
        classification_priority: existing && typeof existing.classification_priority === "string" ? existing.classification_priority : "",
        classification_detail: classificationDetail
      };

      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (storeError) {
        console.error("[consistency SYNC] failed to store merged payload into localStorage:", storeError);
      }

      try {
        var syncOkKey = "cscs_consistency_sync_ok:" + qid;
        localStorage.setItem(syncOkKey, savedAtIso);
      } catch (syncOkError) {
        console.error("[consistency SYNC] failed to store sync_ok flag:", syncOkError);
      }
    } catch (e) {
      console.error("[consistency SYNC] request failed:", e);
    }
  }

  /**
   * SYNC 状態とローカル結果を削除し、ステータス表示をリセットする
   *
   * @param {Object} meta
   * @param {Object} q
   */
  function clearConsistencySyncStatus(meta, q) {
    if (typeof localStorage === "undefined") {
      updateConsistencyCheckStatus(meta, q);
      return;
    }

    var storageKey = getConsistencyStorageKey(meta, q);
    try {
      localStorage.removeItem(storageKey);
    } catch (removeError) {
      console.error("整合性チェック結果の削除に失敗しました:", removeError);
    }

    var qid = meta && meta.qid ? String(meta.qid) : "";
    if (qid) {
      try {
        var syncOkKey = "cscs_consistency_sync_ok:" + qid;
        localStorage.removeItem(syncOkKey);
      } catch (syncRemoveError) {
        console.error("整合性チェック SYNC ステータスの削除に失敗しました:", syncRemoveError);
      }
    }

    updateConsistencyCheckStatus(meta, q);
  }

  /**
   * 画面右上の「整合性チェックステータス」表示を更新
   *
   * @param {Object} meta
   * @param {Object} q
   */
  function updateConsistencyCheckStatus(meta, q) {
        } catch (storageError) {
          console.error("整合性チェック結果の localStorage 保存に失敗しました:", storageError);
        }
      }

      showConsistencyResultPanel(meta, q, result, usedStrict);
      updateConsistencyCheckStatus(meta, q);
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      var friendly = "";

      if (msg.indexOf("HTTP 500") !== -1 && msg.indexOf("503") !== -1) {
        friendly = "（Gemini のモデル側が一時的に過負荷のため利用できない状態です。少し時間を空けてから、もう一度「整合性チェック」ボタンを押してみてください。）";
      }

      panel.innerHTML = '<div style="font-size:14px;color:#ff8080;">整合性チェック中にエラーが発生しました: '
        + msg
        + (friendly ? "<br>" + friendly : "")
        + "</div>";
    }
  }

  // window 配下に公開しておく（Bパートから呼べるように）
  window.CSCSConsistencyCheck = {
    runConsistencyCheck: runConsistencyCheck,
    runAndShowConsistencyCheck: runAndShowConsistencyCheck,
    showConsistencyResultPanel: showConsistencyResultPanel
  };

  // Bパート用：整合性チェックボタンの自動生成（Aパートではステータス表示のみ）
  document.addEventListener("DOMContentLoaded", function() {
    var scripts = document.querySelectorAll('script[src$="consistency_check_debug.js"]');
    var isB = false;
    for (var i = 0; i < scripts.length; i++) {
      var sc = scripts[i];
      if (sc.getAttribute("data-part") === "b") {
        isB = true;
        break;
      }
    }

    var metaScript = document.getElementById("cscs-meta");
    if (!metaScript) {
      return;
    }

    var baseMeta;
    try {
      var raw = metaScript.textContent || metaScript.innerText || "";
      baseMeta = raw ? JSON.parse(raw) : {};
    } catch (e) {
      baseMeta = {};
    }

    var meta = {
      day: String(baseMeta.date || baseMeta.day || ""),
      field: String(baseMeta.field || ""),
      theme: String(baseMeta.theme || ""),
      level: String(baseMeta.level || ""),
      qid: String(baseMeta.qid || ""),
      quiztype: String(baseMeta.quiztype || "")
    };

    var h1 = document.querySelector("h1");
    var questionText = h1 && h1.textContent ? h1.textContent.trim() : "";

    var choiceNodes = document.querySelectorAll("ol.opts li");
    var choices = [];
    var correctIndex = 0;
    var foundCorrect = false;
    for (var j = 0; j < choiceNodes.length; j++) {
      var li = choiceNodes[j];
      var txt = li && li.textContent ? li.textContent : "";
      choices.push(txt.trim());
      if (!foundCorrect && li && li.classList && li.classList.contains("is-correct")) {
        correctIndex = j;
        foundCorrect = true;
      }
    }

    while (choices.length < 4) {
      choices.push("");
    }

    var expNode = document.querySelector(".explain-text");
    var explanationText = "";
    if (expNode && expNode.textContent) {
      explanationText = expNode.textContent.trim();
    } else {
      var expWrap = document.querySelector(".explain");
      if (expWrap && expWrap.textContent) {
        explanationText = expWrap.textContent.trim();
      }
    }

    var q = {
      question: questionText,
      choices: choices,
      correct_index: correctIndex,
      explanation: explanationText
    };

    if (questionText) {
      if (meta && meta.qid) {
        fetchConsistencySyncStatus(meta, q).then(function() {
          updateConsistencyCheckStatus(meta, q);
        }).catch(function() {
          updateConsistencyCheckStatus(meta, q);
        });
      } else {
        updateConsistencyCheckStatus(meta, q);
      }
    }

    if (!isB) {
      return;
    }

    if (document.getElementById("cc-check-btn")) {
      return;
    }

    if (!questionText || choices.length === 0 || !explanationText) {
      return;
    }

    if (typeof localStorage !== "undefined") {
      try {
        var storageKey = getConsistencyStorageKey(meta, q);
        var storedRaw = localStorage.getItem(storageKey);
        if (storedRaw) {
          var storedData = JSON.parse(storedRaw);
          if (storedData && storedData.result) {
            var usedStrict = typeof storedData.strict === "boolean" ? storedData.strict : STRICT_MODE_DEFAULT;
            showConsistencyResultPanel(meta, q, storedData.result, usedStrict);
          }
        }
      } catch (restoreError) {
        console.error("整合性チェック結果の復元に失敗しました:", restoreError);
      }
    }

    var btn = document.createElement("button");
    btn.id = "cc-check-btn";
    btn.type = "button";
    btn.textContent = "整合性チェック";

    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      e.preventDefault();
      window.CSCSConsistencyCheck.runAndShowConsistencyCheck(meta, q, true);
    });

    var clearBtn = document.createElement("button");
    clearBtn.id = "cc-sync-clear-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "SYNC削除";

    clearBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      e.preventDefault();
      clearConsistencySyncStatus(meta, q);
    });

    var wrapper = document.getElementById("cc-check-wrapper");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "cc-check-wrapper";
      var wrapperParent = document.querySelector(".wrap") || document.body;
      wrapperParent.appendChild(wrapper);
    }

    wrapper.appendChild(btn);
    wrapper.appendChild(clearBtn);
  });

})();