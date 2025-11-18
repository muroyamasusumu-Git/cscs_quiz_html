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
      + "      \"NSCA-CSCS の出題として問題がある場合のみ、その理由\",\n"
      + "      \"なければ空配列も可\"\n"
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

    if (!response.ok) {
      throw new Error("整合性チェック API エラー: HTTP " + response.status);
    }

    var text = await response.text();
    if (lastConsistencyDebug) {
      lastConsistencyDebug.rawResponseText = text;
    }

    // 応答は「JSONだけ」が返ってくる想定だが、
    // 念のため try/catch しておく
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
    div.style.position = "fixed";
    div.style.top = "5%";
    div.style.left = "50%";
    div.style.transform = "translateX(-50%)";
    div.style.maxWidth = "900px";
    div.style.width = "96%";
    div.style.maxHeight = "88%";
    div.style.overflowY = "auto";
    div.style.backgroundColor = "rgba(0, 0, 0, 0.96)";
    div.style.border = "1px solid #555555";
    div.style.borderRadius = "8px";
    div.style.padding = "16px 20px";
    div.style.fontSize = "15px";
    div.style.color = "#eeeeee";
    div.style.zIndex = "99999";
    div.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.7)";
    document.body.appendChild(div);
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

    var html = "";

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<div style="font-weight:600;font-size:15px;">整合性チェック結果</div>';
    html += '<div>';
    html += '<button type="button" id="cscs-consistency-copy-debug"';
    html += ' style="margin-right:6px;border:1px solid #777777;border-radius:4px;background:#222222;color:#ffffff;';
    html += ' padding:2px 8px;font-size:12px;cursor:pointer;">デバッグ用テキストをコピー</button>';
    html += '<button type="button" id="cscs-consistency-panel-close"';
    html += ' style="border:1px solid #777777;border-radius:4px;background:#333333;color:#ffffff;';
    html += ' padding:2px 8px;font-size:12px;cursor:pointer;">閉じる</button>';
    html += "</div>";
    html += "</div>";

    html += '<div style="font-size:12px;color:#bbbbbb;margin-bottom:8px;">';
    html += "モード: " + strictLabel + " ／ overall: " + overall + " ／ 判定: " + mark;
    html += "</div>";

    html += '<div style="border-top:1px solid #444444;margin:8px 0 6px 0;"></div>';

    html += '<div style="margin-bottom:6px;font-size:12px;color:#aaaaaa;">';
    html += "Day: " + meta.day + " ／ Field: " + meta.field + " ／ Theme: " + meta.theme + " ／ Level: " + meta.level;
    html += "</div>";

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">問題文</div>';
    html += '<div style="white-space:pre-wrap;line-height:1.4;">' + q.question + "</div>";
    html += "</div>";

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">選択肢</div>';
    html += '<div style="white-space:pre-wrap;line-height:1.4;">';
    html += "A. " + q.choices[0] + "<br>";
    html += "B. " + q.choices[1] + "<br>";
    html += "C. " + q.choices[2] + "<br>";
    html += "D. " + q.choices[3];
    html += "</div>";
    html += "</div>";

    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">解説</div>';
    html += '<div style="white-space:pre-wrap;line-height:1.4;">' + q.explanation + "</div>";
    html += "</div>";

    html += '<div style="border-top:1px solid #444444;margin:8px 0 6px 0;"></div>';

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">全体コメント</div>';
    html += '<div style="white-space:pre-wrap;line-height:1.4;">' + summary + "</div>";
    html += "</div>";

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">正解の妥当性 (answer_correctness)</div>';
    html += '<div style="font-size:12px;color:#cccccc;margin-bottom:4px;">';
    html += "status: " + acStatus + " ／ mode: " + acMode;
    html += "</div>";
    if (acModeReason) {
      html += '<div style="font-size:12px;color:#88ddff;margin-bottom:4px;">';
      html += "mode_reason: " + acModeReason;
      html += "</div>";
    }
    if (acIssues.length > 0) {
      html += '<ul style="margin:4px 0 0 16px;padding:0;font-size:12px;line-height:1.4;">';
      for (var i = 0; i < acIssues.length; i++) {
        html += "<li>" + acIssues[i] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">解説の品質 (explanation_quality)</div>';
    html += '<div style="font-size:12px;color:#cccccc;margin-bottom:4px;">';
    html += "status: " + eqStatus;
    html += "</div>";
    if (eqIssues.length > 0) {
      html += '<ul style="margin:4px 0 0 16px;padding:0;font-size:12px;line-height:1.4;">';
      for (var j = 0; j < eqIssues.length; j++) {
        html += "<li>" + eqIssues[j] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    html += '<div style="margin-bottom:4px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">問題文の NSCA 的妥当性 (problem_statement_nsac_validity)</div>';
    html += '<div style="font-size:12px;color:#cccccc;margin-bottom:4px;">';
    html += "status: " + psStatus;
    html += "</div>";
    if (psIssues.length > 0) {
      html += '<ul style="margin:4px 0 0 16px;padding:0;font-size:12px;line-height:1.4;">';
      for (var k = 0; k < psIssues.length; k++) {
        html += "<li>" + psIssues[k] + "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

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
      showConsistencyResultPanel(meta, q, result, typeof strict === "boolean" ? strict : STRICT_MODE_DEFAULT);
    } catch (e) {
      panel.innerHTML = '<div style="font-size:14px;color:#ff8080;">整合性チェック中にエラーが発生しました: '
        + String(e && e.message ? e.message : e)
        + "</div>";
    }
  }

  // window 配下に公開しておく（Bパートから呼べるように）
  window.CSCSConsistencyCheck = {
    runConsistencyCheck: runConsistencyCheck,
    runAndShowConsistencyCheck: runAndShowConsistencyCheck,
    showConsistencyResultPanel: showConsistencyResultPanel
  };

  // Bパート用：整合性チェックボタンの自動生成
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
    if (!isB) {
      return;
    }

    if (document.getElementById("cc-check-btn")) {
      return;
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

    if (!questionText || choices.length === 0 || !explanationText) {
      return;
    }

    var q = {
      question: questionText,
      choices: choices,
      correct_index: correctIndex,
      explanation: explanationText
    };

    var btn = document.createElement("button");
    btn.id = "cc-check-btn";
    btn.type = "button";
    btn.textContent = "整合性チェック";
    btn.style.position = "fixed";
    btn.style.top = "170px";
    btn.style.right = "34%";
    btn.style.zIndex = "99999";
    btn.style.fontSize = "12px";
    btn.style.padding = "4px 8px";
    btn.style.borderRadius = "6px";
    btn.style.border = "1px solid #666666";
    btn.style.background = "#222222";
    btn.style.color = "#eeeeee";
    btn.style.opacity = "0.55";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", function(e) {
    e.stopPropagation();
    e.preventDefault();
    window.CSCSConsistencyCheck.runAndShowConsistencyCheck(meta, q, true);
    });

    document.body.appendChild(btn);
  });

})();