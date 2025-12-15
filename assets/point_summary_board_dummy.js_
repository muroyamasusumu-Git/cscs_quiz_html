// assets/point_summary_board_dummy.js
// CSCS: リッチなポイントサマリーボード（固定ミニパネル）
// - ダミー値で表示（後で実データに差し替え可能）
// - 依存なし（単体で動く）
// - 画面右上固定 / 展開・折りたたみ / ミニグラフ / 内訳 / 差分 / 明日の提案 を表示

(function(){
  "use strict";

  // ===== 設定 =====
  var PANEL_ID = "cscs-point-summary-board";
  var LS_POS_KEY = "cscs_point_board_pos_v1"; // 今回は保存までしないが、将来の拡張用
  var DEFAULT_POS = "top-right"; // "top-right" | "top-left" | "bottom-right" | "bottom-left"
  var START_EXPANDED = true;

  // ===== ダミーデータ（ここを後で実データに差し替え） =====
  function getDummyData(){
    // 例: 目標と実績（ポイント）
    var targetPt = 720;
    var actualPt = 685;

    // 例: 内訳（今日の到達回数＝遷移回数のイメージ）
    var breakdown = {
      star: 18,     // ⭐️到達
      bolt: 22,     // ⚡️到達
      sparkle: 31,  // ✨到達
      wrench: 6,    // 🔧到達（1連不正解）
      hammer: 2,    // 🛠️到達（2連不正解）
      bomb: 1,      // 💣到達（3連以上不正解）
      answers: 112, // 回答数
      correct: 84,  // 正解数（表示用）
      wrong: 28     // 不正解数（表示用）
    };

    // 例: ポイント配点（ダミー）
    // ※ここは「回答+1、✨+3、⚡️+5、⭐️+9、🛠️-2、💣-5」の思想に沿う
    // 表示では「合計が actualPt っぽく見える」ように少し整えている
    var weights = {
      answer: 1,
      sparkle: 3,
      bolt: 6,
      star: 10,
      hammerPenalty: -2,
      bombPenalty: -5
    };

    // 例: 直近の推移（ミニグラフ用、7日）
    var trend = {
      ideal:  [680, 700, 710, 720, 720, 720, 720],
      actual: [520, 610, 640, 690, 705, 670, 685]
    };

    // 例: 明日の提案（ダミー）
    var advice = {
      starPlus: 3,
      boltPlus: 2,
      note: "💣解体優先（⚡️→⭐️回収）"
    };

    // 差分
    var diffPt = actualPt - targetPt;

    return {
      targetPt: targetPt,
      actualPt: actualPt,
      diffPt: diffPt,
      breakdown: breakdown,
      weights: weights,
      trend: trend,
      advice: advice
    };
  }

  // ===== 便利関数 =====
  function clamp(n, min, max){
    return Math.max(min, Math.min(max, n));
  }
  function pct(a, b){
    if (!b || b <= 0) return 0;
    return clamp(Math.round((a / b) * 100), 0, 999);
  }
  function fmtSigned(n){
    if (n > 0) return "+" + n;
    return String(n);
  }
  function safeText(s){
    return String(s == null ? "" : s);
  }

  // ===== DOM 構築 =====
  function ensureStyle(){
    if (document.getElementById(PANEL_ID + "-style")) return;

    var css = ""
      + "#" + PANEL_ID + " {"
      + "  position: fixed;"
      + "  z-index: 2147483000;"
      + "  width: 320px;"
      + "  max-width: min(92vw, 360px);"
      + "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, \"Apple Color Emoji\", \"Segoe UI Emoji\";"
      + "  color: rgba(255,255,255,0.92);"
      + "  border: 1px solid rgba(255,255,255,0.14);"
      + "  border-radius: 14px;"
      + "  background: rgba(10, 10, 14, 0.78);"
      + "  backdrop-filter: blur(10px);"
      + "  -webkit-backdrop-filter: blur(10px);"
      + "  box-shadow: 0 10px 30px rgba(0,0,0,0.45);"
      + "  overflow: hidden;"
      + "}"
      + "#" + PANEL_ID + " .psb-inner { padding: 10px 10px 10px 10px; }"
      + "#" + PANEL_ID + " .psb-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }"
      + "#" + PANEL_ID + " .psb-title { font-size: 12px; letter-spacing: 0.06em; opacity: 0.95; display: flex; align-items: center; gap: 8px; }"
      + "#" + PANEL_ID + " .psb-title b { font-size: 12px; font-weight: 800; }"
      + "#" + PANEL_ID + " .psb-btns { display: flex; align-items: center; gap: 6px; }"
      + "#" + PANEL_ID + " .psb-btn {"
      + "  font-size: 11px;"
      + "  padding: 4px 7px;"
      + "  border-radius: 10px;"
      + "  border: 1px solid rgba(255,255,255,0.14);"
      + "  background: rgba(255,255,255,0.06);"
      + "  color: rgba(255,255,255,0.88);"
      + "  cursor: pointer;"
      + "  user-select: none;"
      + "}"
      + "#" + PANEL_ID + " .psb-btn:active { transform: scale(0.99); }"
      + "#" + PANEL_ID + " .psb-sep { height: 1px; background: rgba(255,255,255,0.10); margin: 10px 0; }"
      + "#" + PANEL_ID + " .psb-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }"
      + "#" + PANEL_ID + " .psb-k { font-size: 11px; opacity: 0.78; }"
      + "#" + PANEL_ID + " .psb-v { font-size: 18px; font-weight: 800; letter-spacing: 0.02em; }"
      + "#" + PANEL_ID + " .psb-sub { font-size: 11px; opacity: 0.8; }"
      + "#" + PANEL_ID + " .psb-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px;"
      + "  border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); font-size: 11px; }"
      + "#" + PANEL_ID + " .psb-diff-pos { color: rgba(120, 255, 180, 0.95); }"
      + "#" + PANEL_ID + " .psb-diff-neg { color: rgba(255, 200, 120, 0.95); }"
      + "#" + PANEL_ID + " .psb-bar-wrap { margin-top: 8px; }"
      + "#" + PANEL_ID + " .psb-bar { height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); overflow: hidden; }"
      + "#" + PANEL_ID + " .psb-bar > div { height: 100%; width: 0%; background: linear-gradient(90deg, rgba(120, 210, 255, 0.95), rgba(180, 120, 255, 0.95)); }"
      + "#" + PANEL_ID + " .psb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }"
      + "#" + PANEL_ID + " .psb-card { padding: 8px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }"
      + "#" + PANEL_ID + " .psb-card .psb-card-h { display: flex; align-items: center; justify-content: space-between; }"
      + "#" + PANEL_ID + " .psb-card .psb-card-h .psb-k { font-size: 11px; opacity: 0.78; }"
      + "#" + PANEL_ID + " .psb-card .psb-card-h .psb-v2 { font-size: 14px; font-weight: 800; }"
      + "#" + PANEL_ID + " .psb-mini { font-size: 11px; opacity: 0.88; margin-top: 6px; line-height: 1.35; }"
      + "#" + PANEL_ID + " .psb-mini code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 10px; opacity: 0.95; }"
      + "#" + PANEL_ID + " .psb-trend { margin-top: 6px; }"
      + "#" + PANEL_ID + " canvas.psb-cv { width: 100%; height: 50px; display: block; border-radius: 10px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.18); }"
      + "#" + PANEL_ID + " .psb-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }"
      + "#" + PANEL_ID + " .psb-advice { font-size: 11px; opacity: 0.9; }"
      + "#" + PANEL_ID + " .psb-badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }"
      + "#" + PANEL_ID + " .psb-collapsed .psb-detail { display: none; }"
      + "#" + PANEL_ID + " .psb-collapsed .psb-sep.detail-sep { display: none; }"
      + "#" + PANEL_ID + " .psb-ghost { opacity: 0.65; }"
      + "#" + PANEL_ID + " .psb-pos-top-right { top: 10px; right: 10px; }"
      + "#" + PANEL_ID + " .psb-pos-top-left { top: 10px; left: 10px; }"
      + "#" + PANEL_ID + " .psb-pos-bottom-right { bottom: 10px; right: 10px; }"
      + "#" + PANEL_ID + " .psb-pos-bottom-left { bottom: 10px; left: 10px; }";

    var st = document.createElement("style");
    st.id = PANEL_ID + "-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildPanel(){
    ensureStyle();

    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    var root = document.createElement("div");
    root.id = PANEL_ID;

    // 位置
    var pos = DEFAULT_POS;
    try{
      var saved = localStorage.getItem(LS_POS_KEY);
      if (saved === "top-right" || saved === "top-left" || saved === "bottom-right" || saved === "bottom-left"){
        pos = saved;
      }
    }catch(_){}

    root.className = "psb-pos-" + pos;

    // 中身
    root.innerHTML =
      ""
      + "<div class=\"psb-inner\">"
      + "  <div class=\"psb-top\">"
      + "    <div class=\"psb-title\"><span style=\"opacity:.9\">📊</span> <b>DAILY POINT HUD</b> <span class=\"psb-ghost\">CSCS</span></div>"
      + "    <div class=\"psb-btns\">"
      + "      <div class=\"psb-btn\" data-psb=\"toggle\">展開/縮小</div>"
      + "      <div class=\"psb-btn\" data-psb=\"pos\">位置</div>"
      + "      <div class=\"psb-btn\" data-psb=\"refresh\">更新</div>"
      + "    </div>"
      + "  </div>"
      + "  <div class=\"psb-sep\"></div>"
      + "  <div class=\"psb-row\">"
      + "    <div>"
      + "      <div class=\"psb-k\">🎯 今日の目標</div>"
      + "      <div class=\"psb-v\" data-psb=\"target\">-</div>"
      + "      <div class=\"psb-sub\" data-psb=\"targetSub\">基準: -</div>"
      + "    </div>"
      + "    <div class=\"psb-pill\" data-psb=\"statusPill\">-</div>"
      + "  </div>"
      + "  <div class=\"psb-bar-wrap\">"
      + "    <div class=\"psb-bar\"><div data-psb=\"bar\"></div></div>"
      + "  </div>"
      + "  <div class=\"psb-sep detail-sep\"></div>"
      + "  <div class=\"psb-detail\">"
      + "    <div class=\"psb-grid\">"
      + "      <div class=\"psb-card\">"
      + "        <div class=\"psb-card-h\">"
      + "          <div class=\"psb-k\">🏆 今日の獲得</div>"
      + "          <div class=\"psb-v2\" data-psb=\"actual\">-</div>"
      + "        </div>"
      + "        <div class=\"psb-mini\" data-psb=\"diffLine\">差分: -</div>"
      + "        <div class=\"psb-mini\" data-psb=\"qaLine\">回答/正誤: -</div>"
      + "      </div>"
      + "      <div class=\"psb-card\">"
      + "        <div class=\"psb-card-h\">"
      + "          <div class=\"psb-k\">🔎 状態内訳</div>"
      + "          <div class=\"psb-v2\" data-psb=\"statusSummary\">-</div>"
      + "        </div>"
      + "        <div class=\"psb-mini\" data-psb=\"statusLine1\">-</div>"
      + "        <div class=\"psb-mini\" data-psb=\"statusLine2\">-</div>"
      + "      </div>"
      + "    </div>"
      + "    <div class=\"psb-card\" style=\"margin-top: 8px;\">"
      + "      <div class=\"psb-card-h\">"
      + "        <div class=\"psb-k\">🧮 ポイント内訳</div>"
      + "        <div class=\"psb-v2\" data-psb=\"ptSum\">-</div>"
      + "      </div>"
      + "      <div class=\"psb-mini\" data-psb=\"ptDetail\">-</div>"
      + "    </div>"
      + "    <div class=\"psb-card psb-trend\" style=\"margin-top: 8px;\">"
      + "      <div class=\"psb-card-h\">"
      + "        <div class=\"psb-k\">📈 7日トレンド</div>"
      + "        <div class=\"psb-v2\"><span class=\"psb-badge\">Ideal / Actual</span></div>"
      + "      </div>"
      + "      <div style=\"margin-top: 6px;\">"
      + "        <canvas class=\"psb-cv\" data-psb=\"cv\" width=\"600\" height=\"120\"></canvas>"
      + "      </div>"
      + "    </div>"
      + "    <div class=\"psb-sep\" style=\"margin-top: 10px;\"></div>"
      + "    <div class=\"psb-foot\">"
      + "      <div class=\"psb-advice\" data-psb=\"advice\">-</div>"
      + "      <div class=\"psb-badge\" data-psb=\"miniTip\">Tap: 展開/縮小</div>"
      + "    </div>"
      + "  </div>"
      + "</div>";

    // 初期状態
    if (!START_EXPANDED){
      root.classList.add("psb-collapsed");
    }

    // イベント
    root.addEventListener("click", function(e){
      var t = e.target;
      if (!(t instanceof Element)) return;

      var k = t.getAttribute("data-psb");
      if (k === "toggle"){
        root.classList.toggle("psb-collapsed");
        return;
      }
      if (k === "refresh"){
        renderPanel(root, getDummyData());
        return;
      }
      if (k === "pos"){
        cyclePosition(root);
        return;
      }
    });

    // パネル自体クリックでもトグル（ボタン以外）
    root.addEventListener("dblclick", function(){
      root.classList.toggle("psb-collapsed");
    });

    document.body.appendChild(root);
    return root;
  }

  function cyclePosition(root){
    var classes = ["top-right","top-left","bottom-right","bottom-left"];
    var cur = DEFAULT_POS;
    classes.forEach(function(p){
      if (root.classList.contains("psb-pos-" + p)) cur = p;
    });
    var idx = classes.indexOf(cur);
    var next = classes[(idx + 1) % classes.length];

    classes.forEach(function(p){
      root.classList.remove("psb-pos-" + p);
    });
    root.classList.add("psb-pos-" + next);

    try{
      localStorage.setItem(LS_POS_KEY, next);
    }catch(_){}
  }

  // ===== 描画（テキスト/バー/グラフ） =====
  function renderPanel(root, data){
    var target = data.targetPt;
    var actual = data.actualPt;
    var diff = data.diffPt;
    var bd = data.breakdown;
    var w = data.weights;

    // ターゲット行
    var targetEl = root.querySelector("[data-psb=\"target\"]");
    var targetSubEl = root.querySelector("[data-psb=\"targetSub\"]");
    if (targetEl) targetEl.textContent = safeText(target) + " pt";
    if (targetSubEl) targetSubEl.textContent = "基準: " + safeText(target) + " pt（ダミー）";

    // ステータスピル
    var pill = root.querySelector("[data-psb=\"statusPill\"]");
    if (pill){
      var rate = pct(actual, target);
      var label = "達成率 " + rate + "%";
      var d = diff;
      var diffText = fmtSigned(d) + " pt";
      var cls = (d >= 0) ? "psb-diff-pos" : "psb-diff-neg";
      pill.innerHTML = "<span style=\"opacity:.9\">📌</span> <span>" + label + "</span> <span class=\"" + cls + "\" style=\"font-weight:800\">" + diffText + "</span>";
    }

    // バー
    var bar = root.querySelector("[data-psb=\"bar\"]");
    if (bar){
      var p = pct(actual, target);
      if (p > 100) p = 100;
      bar.style.width = p + "%";
    }

    // 今日の獲得
    var actualEl = root.querySelector("[data-psb=\"actual\"]");
    if (actualEl) actualEl.textContent = safeText(actual) + " pt";

    // 差分
    var diffLine = root.querySelector("[data-psb=\"diffLine\"]");
    if (diffLine){
      var cls2 = (diff >= 0) ? "psb-diff-pos" : "psb-diff-neg";
      diffLine.innerHTML = "差分: <span class=\"" + cls2 + "\" style=\"font-weight:800\">" + fmtSigned(diff) + " pt</span>（目標 " + target + " / 実績 " + actual + "）";
    }

    // 回答・正誤
    var qaLine = root.querySelector("[data-psb=\"qaLine\"]");
    if (qaLine){
      var acc = pct(bd.correct, bd.answers);
      qaLine.textContent = "回答 " + bd.answers + " ｜ 正解 " + bd.correct + " / 不正解 " + bd.wrong + "（正答率 " + acc + "%）";
    }

    // 状態内訳（簡易サマリ）
    var statusSummary = root.querySelector("[data-psb=\"statusSummary\"]");
    if (statusSummary){
      statusSummary.textContent = "⭐️" + bd.star + " ⚡️" + bd.bolt + " ✨" + bd.sparkle;
    }

    var statusLine1 = root.querySelector("[data-psb=\"statusLine1\"]");
    if (statusLine1){
      statusLine1.textContent = "進行（正解）: ✨ " + bd.sparkle + " ／ ⚡️ " + bd.bolt + " ／ ⭐️ " + bd.star;
    }
    var statusLine2 = root.querySelector("[data-psb=\"statusLine2\"]");
    if (statusLine2){
      statusLine2.textContent = "危険（不正解）: 🔧 " + bd.wrench + " ／ 🛠️ " + bd.hammer + " ／ 💣 " + bd.bomb;
    }

    // ポイント内訳（見せかけの計算）
    // ※ここはあくまでダミーの説明用。合計は data.actualPt に合わせる。
    var ptsStar = bd.star * w.star;
    var ptsBolt = bd.bolt * w.bolt;
    var ptsSparkle = bd.sparkle * w.sparkle;
    var ptsAnswers = bd.answers * w.answer;
    var penHammer = bd.hammer * w.hammerPenalty;
    var penBomb = bd.bomb * w.bombPenalty;
    var computed = ptsStar + ptsBolt + ptsSparkle + ptsAnswers + penHammer + penBomb;

    // 見た目の合計が actual にズレる場合、誤差として注記（ダミーなので）
    var ptSum = root.querySelector("[data-psb=\"ptSum\"]");
    if (ptSum){
      ptSum.textContent = safeText(actual) + " pt";
    }

    var ptDetail = root.querySelector("[data-psb=\"ptDetail\"]");
    if (ptDetail){
      var lines = [];
      lines.push("⭐️ " + bd.star + " × " + w.star + " = " + ptsStar + " pt");
      lines.push("⚡️ " + bd.bolt + " × " + w.bolt + " = " + ptsBolt + " pt");
      lines.push("✨ " + bd.sparkle + " × " + w.sparkle + " = " + ptsSparkle + " pt");
      lines.push("回答 " + bd.answers + " × " + w.answer + " = " + ptsAnswers + " pt");
      lines.push("🛠️ " + bd.hammer + " × (" + w.hammerPenalty + ") = " + penHammer + " pt");
      lines.push("💣 " + bd.bomb + " × (" + w.bombPenalty + ") = " + penBomb + " pt");
      lines.push("合計（参考）= " + computed + " pt / 表示（実績）= " + actual + " pt");
      ptDetail.innerHTML = "<div style=\"display:grid; grid-template-columns: 1fr 1fr; gap: 6px;\">" +
        lines.slice(0, 6).map(function(s){ return "<code>" + safeText(s) + "</code>"; }).join("") +
        "</div>" +
        "<div style=\"margin-top:6px;\"><code>" + safeText(lines[6]) + "</code></div>";
    }

    // トレンド描画
    var cv = root.querySelector("[data-psb=\"cv\"]");
    if (cv && cv.getContext){
      drawTrend(cv, data.trend);
    }

    // 明日の提案
    var advice = root.querySelector("[data-psb=\"advice\"]");
    if (advice){
      advice.innerHTML =
        "⏭️ 明日の提案: <b>⭐️ +" + safeText(data.advice.starPlus) +
        "</b> ／ <b>⚡️ +" + safeText(data.advice.boltPlus) +
        "</b> ｜ " + safeText(data.advice.note);
    }
  }

  function drawTrend(canvas, trend){
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var w = canvas.width;
    var h = canvas.height;

    // 背景クリア
    ctx.clearRect(0, 0, w, h);

    // データ整形
    var ideal = Array.isArray(trend.ideal) ? trend.ideal.slice(0) : [];
    var actual = Array.isArray(trend.actual) ? trend.actual.slice(0) : [];
    var n = Math.min(ideal.length, actual.length);
    if (n < 2) return;

    // min/max
    var minV = Infinity;
    var maxV = -Infinity;
    for (var i = 0; i < n; i++){
      minV = Math.min(minV, ideal[i], actual[i]);
      maxV = Math.max(maxV, ideal[i], actual[i]);
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV === maxV){
      minV = 0;
      maxV = 1;
    }

    var padX = 10;
    var padY = 10;

    function xOf(i){
      return padX + (i * (w - padX * 2)) / (n - 1);
    }
    function yOf(v){
      var t = (v - minV) / (maxV - minV);
      return (h - padY) - t * (h - padY * 2);
    }

    // グリッド（薄）
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (var gy = 0; gy <= 3; gy++){
      var yy = padY + (gy * (h - padY * 2)) / 3;
      ctx.beginPath();
      ctx.moveTo(padX, yy);
      ctx.lineTo(w - padX, yy);
      ctx.stroke();
    }
    ctx.restore();

    // Ideal（点線）
    ctx.save();
    ctx.strokeStyle = "rgba(170,200,255,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    for (var i2 = 0; i2 < n; i2++){
      var xi = xOf(i2);
      var yi = yOf(ideal[i2]);
      if (i2 === 0) ctx.moveTo(xi, yi);
      else ctx.lineTo(xi, yi);
    }
    ctx.stroke();
    ctx.restore();

    // Actual（実線）
    ctx.save();
    ctx.strokeStyle = "rgba(210,170,255,0.92)";
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (var i3 = 0; i3 < n; i3++){
      var xa = xOf(i3);
      var ya = yOf(actual[i3]);
      if (i3 === 0) ctx.moveTo(xa, ya);
      else ctx.lineTo(xa, ya);
    }
    ctx.stroke();
    ctx.restore();

    // ラスト点（Actual）
    ctx.save();
    ctx.fillStyle = "rgba(210,170,255,0.95)";
    var lx = xOf(n - 1);
    var ly = yOf(actual[n - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===== 起動 =====
  function boot(){
    if (!document.body) return;
    var root = buildPanel();
    renderPanel(root, getDummyData());
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }else{
    boot();
  }

})();