// assets/cscs_adjust_background.js
/*
 * CSCS Adjust Background (Ambient Tuner)
 *
 * 【役割分担（ambient_background.js との責務分離）】
 *   - cscs_ambient_background.js（ambient側）:
 *       「背景レイヤーの器（DOMと安全柵CSS）」を作るだけ。
 *       具体的には #cscs-ambient-layer / #cscs-ambient-base / #cscs-ambient-tuned /
 *       #cscs-ambient-tuned-rot を “確定ID” で常に用意し、最背面固定・クリック不干渉・z-index安全を保証する。
 *       ON/OFF と theme状態は ambient が管理する（描画はしない）。
 *
 *   - cscs_adjust_background.js（adjust側 / このファイル）:
 *       「見た目の生成（描画）」と「調整UI」と「localStorage保存」を担当する。
 *       ambient が用意した “器” のうち、#cscs-ambient-tuned-rot に対して <style> を注入し、
 *       radial-gradient / linear-gradient の合成や transform（rotate/translate/origin）で見た目を作る。
 *       器が無い場合は何もしない（フォールバックで器を作らない）。
 *
 * 【このファイルが実際にやっていること（流れ）】
 *   1) State（st）を保持
 *      - 見た目パラメータ（spot/alpha/stop/rotate/translate/origin/afterBox など）
 *      - 表示系（enabled: 上書きCSSの有効/無効, uiVisible: パネル開閉, hideOtherUI: 背景確認モード）
 *
 *   2) CSS注入（apply）
 *      - <style id="cscs-ambient-tuner-style"> を用意し、その textContent を差し替える。
 *      - 描画先は #cscs-ambient-tuned-rot に固定（擬似要素は使わない）。
 *      - enabled=OFF のときは、background/transform/top/right/bottom/left を明示的にクリアして
 *        「前回の見た目が残る事故」を防ぐ。
 *
 *   3) 調整UI（右下⚙︎ + パネル）
 *      - スライダー/トグル操作で st を更新し、即時 apply() で反映する。
 *      - Hide other UI は html にクラスを付け、visibility で “背景以外” を隠す（背景レイヤーDOMは表示維持）。
 *
 *   4) テーマ保存（theme1〜theme3 / 値だけ）
 *      - localStorage に “値だけ” を保存する（uiVisible のような一時UI状態は保存しない）。
 *      - Load は保存が無い場合は何もしない（フォールバックで勝手に作らない）。
 *      - 最後に Load した theme 名は LAST_THEME_KEY に保存し、ページ遷移後に自動復元する。
 *
 * 【依存関係（重要）】
 *   - このファイルは ambient 側が用意する #cscs-ambient-tuned-rot を “描画先” として使う。
 *   - そのDOMが無い場合は apply() が何もせず終了する（器の生成は ambient の責務なので行わない）。
 */

(() => {
  "use strict";

  // ▼ ambient 側で確定した DOM ID（以後不変）
  // 目的: adjust の描画先を固定し、以後の改修をラクにする
  const AMBIENT_LAYER_ID = "cscs-ambient-layer";
  const AMBIENT_BASE_ID  = "cscs-ambient-base";
  const AMBIENT_TUNED_ID = "cscs-ambient-tuned";

  // ▼ 回転専用 tuned 子要素（ambient 側で追加した描画先）
  // 目的: 回転・平行移動・origin をこの要素に集約し、描画もここへ寄せる
  const AMBIENT_TUNED_ROT_ID = "cscs-ambient-tuned-rot";

  const STYLE_ID = "cscs-ambient-tuner-style"; // このチューナーが上書きCSSを入れる <style> のID
  const PANEL_ID = "cscs-ambient-tuner-panel"; // 調整パネルDOMのID
  const BTN_ID   = "cscs-ambient-tuner-toggle-btn"; // 右下⚙︎ボタンDOMのID

  const HIDE_UI_CLASS = "cscs-ambient-tuner-hide-ui"; // 「他UIを見えなくする」時に html に付けるクラス

  // ===== localStorage 保存（テーマ別） =====
  const LS_PREFIX = "cscs_adjust_background_theme_"; // 保存キーの接頭辞（theme1〜3 をぶら下げる）
  const THEMES = ["theme1", "theme2", "theme3"]; // 保存スロット（固定3種）

  // ★ 最後に読み込んだ theme を保持するキー
  // 目的: ページ跨ぎで「最後に使った背景」を自動復元する
  const LAST_THEME_KEY = "cscs_adjust_background_last_theme";

  const clamp01 = (x) => { // 0..1 に丸める（dim/bright用）
    x = Number(x);
    if (!isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  };

  const st = {
    enabled: true,        // 上書きCSSを有効化（OFFにするとこのチューナーのstyleは空になる）
    uiVisible: false,     // パネル表示ON/OFF（初期は閉じる：右下⚙︎で開く）
    hideOtherUI: false,   // 背景調整用に「他のUIを非表示（visibility）」にする

    // ▼ デフォルトは「はみ出し無し」を基準にする
    // 目的: 初期状態で afterBox 調整が不要な状態にし、見た目の基準点を明確にする
    afterBox: { top: 0, right: 0, bottom: 0, left: 0 },  // %

    afterBoxAuto: {
      // ▼ 画面比率と回転角から「欠けないための必要最小余白」を自動計算する
      // 目的: 端末の縦横比が変わったり、rotate角度を変えた時に afterBox を手調整しなくて済むようにする
      enabled: true,

      // ▼ 安全係数（計算値に掛ける倍率）
      // 目的: レンダリング差や background-attachment:fixed 等のクセで「ギリギリ欠ける」を防ぐ
      safety: 1.45
    },

    // ▼ デフォルトは「変換ゼロ（回転0・移動0・支点中央）」にする
    // 目的: 初期状態で欠け・ズレ・はみ出しが起きない基準状態を作る
    origin: { x: 50, y: 50 }, // %
    translate: { x: 0, y: 0 }, // %
    rotate: 0, // deg

    // ▼ 楕円スポット中心もデフォルトは中央に置く
    // 目的: 位置調整をしていない状態の見た目を安定させる
    spot: { x: 50, y: 50 }, // %

    ellipse: {
      // ▼ 楕円スポット（radial）のON/OFF
      // 目的: Beam と同様に、楕円の光だけを即座に切り替えられるようにする
      enabled: true
    },

    // ▼ デフォルトは「円」（縦横比 1:1）
    // 目的: 初期状態では歪みのないニュートラルなスポット形状にする
    core: { w: 260, h: 260 }, // px
    main: { w: 1200, h: 1200 }, // px

    alpha: {
      core0: 0.45,
      core1: 0.32,
      main0: 0.64,
      main1: 0.52
    },

    stop: {
      core1: 42,
      core2: 70,
      main1: 38,
      main2: 78
    },

    dim: 0.0,   // 暗さ（0..1 / 0=解除）
    bright: 0.0, // 明るさ（0..1：白い薄膜で全体を明るくする）

    beam: {
      // ▼ デフォルトで斜めの光（Beam）を有効化
      // 目的: 何も操作しなくても「斜めの光」が最初から見える状態にする
      enabled: true,
      angle: 340,

      // ▼ Beam の全体強度（倍率）
      // 目的: 右下の直線光の「光の強さ」をまとめて増減できるようにする
      strength: 1.00,

      a0: 0.10,
      a1: 0.04,
      a2: 0.00,
      p0: 0,
      p1: 28,
      p2: 58
    },

    // ▼ 2本目の直線光（Beam2）
    // 目的: 1本目（beam）と同様に “完全に独立したパラメータ” で調整できるようにする
    beam2: {
      enabled: false,
      angle: 160,

      // ▼ Beam2 の全体強度（倍率）
      // 目的: Beam2 の光量を strength 一発で増減できるようにする
      strength: 1.00,

      a0: 0.10,
      a1: 0.04,
      a2: 0.00,
      p0: 0,
      p1: 28,
      p2: 58
    }
  };

  // ===== デフォルト（初期値）保存 =====
  // 目的: 「Reset to default」で、このJSの初期状態へ確実に戻す
  // 注意: uiVisible は “一時UI状態” なのでデフォルト復帰対象からは外す（値だけ扱う）
  const DEFAULT_VALUES = JSON.parse(JSON.stringify(st));
  delete DEFAULT_VALUES.uiVisible;

  function getTunedRotElOrNull() {
    // ▼ 器（DOM）が無ければ何もしない（フォールバックで勝手に作らない）
    // 目的: adjust が ambient の責務（器生成）を侵食しない
    try {
      const el = document.getElementById(AMBIENT_TUNED_ROT_ID);
      return el || null;
    } catch (_e) {
      return null;
    }
  }

  function ensureStyleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      el.type = "text/css";
      document.head.appendChild(el);
    }
    return el;
  }

  function ensureHideUiStyle() {
    const id = "cscs-ambient-tuner-hide-ui-style";
    if (document.getElementById(id)) return;

    const css =
      "html." + HIDE_UI_CLASS + " body *{" +
        "visibility:hidden !important;" +
      "}" +
      "html." + HIDE_UI_CLASS + " #" + PANEL_ID + "," +
      "html." + HIDE_UI_CLASS + " #" + PANEL_ID + " *," +
      "html." + HIDE_UI_CLASS + " #" + BTN_ID + "," +
      "html." + HIDE_UI_CLASS + " #" + BTN_ID + " *," +

      // ▼ 背景レイヤーDOMは必ず見せる（背景確認モードのため）
      // 目的: Hide other UI 中でも背景自体が消えないようにする
      "html." + HIDE_UI_CLASS + " #" + AMBIENT_LAYER_ID + "," +
      "html." + HIDE_UI_CLASS + " #" + AMBIENT_BASE_ID + "," +
      "html." + HIDE_UI_CLASS + " #" + AMBIENT_TUNED_ID + "," +
      "html." + HIDE_UI_CLASS + " #" + AMBIENT_TUNED_ROT_ID + "{" +
        "visibility:visible !important;" +
      "}";

    const el = document.createElement("style");
    el.id = id;
    el.type = "text/css";
    el.appendChild(document.createTextNode(css));
    document.head.appendChild(el);
  }

  function applyHideOtherUI() {
    try {
      ensureHideUiStyle();
      if (st.hideOtherUI) document.documentElement.classList.add(HIDE_UI_CLASS);
      else document.documentElement.classList.remove(HIDE_UI_CLASS);
    } catch (_e) {}
  }

  function cssDimA() { // dim → 0..0.60相当（より暗くできる）
    // ▼ dim は 0=解除（暗くしない）
    // 目的: null運用を廃止し、「0=解除」で一貫した操作にする
    return String(0.60 * clamp01(st.dim));
  }

  function cssBrightA() { // bright → 0..0.18相当（白膜。上げすぎると白っぽくなるので控えめ）
    return String(0.18 * clamp01(st.bright));
  }

  function calcAutoAfterBoxFromViewport(rotateDeg, origin, translate, safety) {
    // ▼ 端末サイズ + origin/translate/rotate から、変換後の4隅を計算して必要余白(%)に変換する
    // 目的: origin や translate を使っても「欠けないための最小余白」を自動算出できるようにする
    const w = Number(window.innerWidth);
    const h = Number(window.innerHeight);

    const r = Number(rotateDeg);
    const k = Number(safety);

    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    // ▼ transform-origin は % なので、viewport を基準に px へ変換
    // 目的: 回転の支点ズレ（20/20等）を計算に含める
    const oxp = origin && isFinite(origin.x) ? Number(origin.x) : 50;
    const oyp = origin && isFinite(origin.y) ? Number(origin.y) : 50;
    const ox = (oxp / 100) * w;
    const oy = (oyp / 100) * h;

    // ▼ translate(% , %) は要素サイズ基準なので、viewport を基準に px へ変換
    // 目的: 平行移動による片側欠けを計算に含める
    const txp = translate && isFinite(translate.x) ? Number(translate.x) : 0;
    const typ = translate && isFinite(translate.y) ? Number(translate.y) : 0;
    const tx = (txp / 100) * w;
    const ty = (typ / 100) * h;

    // ▼ 回転角をラジアンへ
    // 目的: 4隅の回転変換を行う
    const rad = r * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    function applyTransform(px, py) {
      // ▼ transform の順序: translate → rotate（CSSの transform: translate(...) rotate(...) に一致）
      // 目的: 実際の見た目と同じ順番で座標を変換する
      const x1 = px + tx;
      const y1 = py + ty;

      // ▼ origin を中心に回転
      // 目的: 支点が 50/50 以外でも正しく外接矩形を求める
      const dx = x1 - ox;
      const dy = y1 - oy;

      const x2 = ox + (dx * cos - dy * sin);
      const y2 = oy + (dx * sin + dy * cos);

      return { x: x2, y: y2 };
    }

    // ▼ viewport矩形の4隅を変換して min/max を取る
    // 目的: 回転+平行移動+支点ズレ込みの「必要な拡張量」を求める
    const p0 = applyTransform(0, 0);
    const p1 = applyTransform(w, 0);
    const p2 = applyTransform(w, h);
    const p3 = applyTransform(0, h);

    const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);

    // ▼ 「画面からはみ出した分」だけが必要余白（左右上下で非対称になる）
    // 目的: 無駄に全方向へ広げず、必要最小限の afterBox を得る
    const needLeftPx = Math.max(0, 0 - minX);
    const needRightPx = Math.max(0, maxX - w);
    const needTopPx = Math.max(0, 0 - minY);
    const needBottomPx = Math.max(0, maxY - h);

    // ▼ px → % に変換（afterBox は top/right/bottom/left を % で「外へはみ出す」指定なのでマイナス）
    // 目的: tuned-rot の top/right/bottom/left にそのまま適用できる形式にする
    const baseLeft = -((needLeftPx / w) * 100);
    const baseRight = -((needRightPx / w) * 100);
    const baseTop = -((needTopPx / h) * 100);
    const baseBottom = -((needBottomPx / h) * 100);

    const s = isFinite(k) && k > 0 ? k : 1;

    return {
      top: baseTop * s,
      right: baseRight * s,
      bottom: baseBottom * s,
      left: baseLeft * s
    };
  }

  function getEffectiveAfterBox() {
    // ▼ afterBoxAuto がONなら、端末サイズ + transform条件(origin/translate/rotate) から afterBox を自動計算して使う
    // 目的: rotate を変えた時／端末回転・リサイズ時も欠けにくい余白を常に適用する
    if (st.afterBoxAuto && st.afterBoxAuto.enabled) {
      return calcAutoAfterBoxFromViewport(st.rotate, st.origin, st.translate, st.afterBoxAuto.safety);
    }
    return st.afterBox;
  }

  function buildTunedCss() {
    const dimA = cssDimA();
    const brightA = cssBrightA();

    const spx = st.spot.x + "%";
    const spy = st.spot.y + "%";

    // ▼ 擬似要素を使わず、#cscs-ambient-tuned の background で合成
    // 目的: 描画を「専用DOMレイヤー方式」に統一し、擬似要素の取り合いを根絶する
    const layers = [];

    // Beam（直線光：1本目）
    if (st.beam && st.beam.enabled) {
      const b = st.beam;

      const s = Number(b.strength);
      const strength = isFinite(s) ? s : 1;

      const a0 = Number(b.a0) * strength;
      const a1 = Number(b.a1) * strength;
      const a2 = Number(b.a2) * strength;

      layers.push(
        "linear-gradient(" + b.angle + "deg," +
          "rgba(255,255,255," + a0 + ") " + b.p0 + "%," +
          "rgba(255,255,255," + a1 + ") " + b.p1 + "%," +
          "rgba(255,255,255," + a2 + ") " + b.p2 + "%" +
        ")"
      );
    }

    // Beam（直線光：2本目）
    if (st.beam2 && st.beam2.enabled) {
      const b2 = st.beam2;

      // ▼ Beam2 の強度倍率を a0/a1/a2 に反映
      // 目的: Beam2 の「光の強さ」を strength 一発で調整できるようにする
      const s2 = Number(b2.strength);
      const strength2 = isFinite(s2) ? s2 : 1;

      const a0_2 = Number(b2.a0) * strength2;
      const a1_2 = Number(b2.a1) * strength2;
      const a2_2 = Number(b2.a2) * strength2;

      layers.push(
        "linear-gradient(" + b2.angle + "deg," +
          "rgba(255,255,255," + a0_2 + ") " + b2.p0 + "%," +
          "rgba(255,255,255," + a1_2 + ") " + b2.p1 + "%," +
          "rgba(255,255,255," + a2_2 + ") " + b2.p2 + "%" +
        ")"
      );
    }

    // 明るさオーバーレイ（bright）
    layers.push("linear-gradient(180deg, rgba(255,255,255," + brightA + ") 0%, rgba(255,255,255," + brightA + ") 100%)");

    // 暗さオーバーレイ（dim）
    layers.push("linear-gradient(180deg, rgba(0,0,0," + dimA + ") 0%, rgba(0,0,0," + dimA + ") 100%)");

    // 右側を暗く落とす（旧 ::before 相当）
    layers.push("linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0.58) 100%)");

    // 左下も暗く溜める（旧 ::before 相当）
    layers.push("linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 60%, rgba(0,0,0,0.70) 100%)");

    // Ellipse（任意）
    if (st.ellipse && st.ellipse.enabled) {
      // ▼ 楕円スポット（radial）をON/OFFできるようにする
      // 目的: 楕円の光を消して「暗い背景だけ」「Beamだけ」などの確認をしやすくする

      // 小さいコア楕円（旧 ::after 相当）
      layers.push(
        "radial-gradient(ellipse " + st.core.w + "px " + st.core.h + "px at " + spx + " " + spy + "," +
          "rgba(70,70,70," + st.alpha.core0 + ") 0%," +
          "rgba(50,50,50," + st.alpha.core1 + ") " + st.stop.core1 + "%," +
          "rgba(0,0,0,0) " + st.stop.core2 + "%" +
        ")"
      );

      // 大きいメイン楕円（旧 ::after 相当）
      layers.push(
        "radial-gradient(ellipse " + st.main.w + "px " + st.main.h + "px at " + spx + " " + spy + "," +
          "rgba(58,58,58," + st.alpha.main0 + ") 0%," +
          "rgba(34,34,34," + st.alpha.main1 + ") " + st.stop.main1 + "%," +
          "rgba(0,0,0,0) " + st.stop.main2 + "%" +
        ")"
      );
    }

    const bx = getEffectiveAfterBox();
    const ox = st.origin;
    const tr = st.translate;

    return (
      "#" + AMBIENT_TUNED_ROT_ID + "{" +
        // ▼ afterBox（回転で欠けないための余白）を tuned-rot の外枠として適用
        // 目的: 回転しても画面端が欠けにくい描画領域を確保する
        "top:" + bx.top + "%;" +
        "right:" + bx.right + "%;" +
        "bottom:" + bx.bottom + "%;" +
        "left:" + bx.left + "%;" +

        // ▼ origin / translate / rotate を tuned-rot に集約
        // 目的: 回転などの transform を 1要素に閉じ込め、他要素（tuned本体）と責務分離する
        "transform-origin:" + ox.x + "% " + ox.y + "%;" +
        "transform: translate(" + tr.x + "%," + tr.y + "%) rotate(" + st.rotate + "deg);" +

        // ▼ 描画（background合成）も tuned-rot に寄せる
        // 目的: 回転と描画の適用対象を一致させ、UIの afterBox/origin/translate/rotate が有効に働くようにする
        "background:" + layers.join(",") + ";" +
        "background-repeat:no-repeat;" +
        "background-attachment:fixed;" +
      "}"
    );
  }

  // buildBeforeCssIfNeeded は廃止（擬似要素を使わない）
  // buildDimOverride も廃止（ambient の CSS 変数に依存しない）

  function apply() {
    const el = ensureStyleEl();

    // ▼ 器（DOM）が無ければ何もしない（フォールバックで作らない）
    // 目的: adjust が ambient の責務（器生成）を侵食しない
    const tunedRot = getTunedRotElOrNull();
    if (!tunedRot) {
      el.textContent = "";
      return;
    }

    // ▼ このチューナーのCSS注入をOFF（tuned は空にする）
    // 目的: 器は残したまま、adjust の描画だけを確実に無効化する
    if (!st.enabled) {
      // ▼ 上書きをOFFにしたとき、前回の描画（background/transform）がDOMに残らないようにクリアする
      // 目的: Override OFF で「背景が残る」事故を防ぎ、OFF=無効を確実にする
      el.textContent =
        "#" + AMBIENT_TUNED_ROT_ID + "{" +
          "background:transparent;" +
          "transform:none;" +
          "transform-origin:50% 50%;" +
          "top:0%;" +
          "right:0%;" +
          "bottom:0%;" +
          "left:0%;" +
        "}";
      return;
    }

    // ▼ tuned レイヤーにのみ CSS を注入（擬似要素は禁止）
    // 目的: 描画責務を adjust に一本化し、描画先DOMを不変にする
    el.textContent = buildTunedCss();
  }

  // removeAll は廃止：
  // 目的: パネル/⚙︎ボタン自体を消す機能を無くし、混乱を防ぐ（UIは常に存在する前提）

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        if (k === "style") Object.assign(e.style, props[k]);
        else if (k === "className") e.className = props[k];
        else if (k === "text") e.textContent = props[k];
        else e.setAttribute(k, props[k]);
      });
    }
    if (children) children.forEach((c) => e.appendChild(c));
    return e;
  }

  function rowLabel(text) {
    return el("div", { style: { fontSize: "11px", opacity: "0.9", marginBottom: "2px" }, text });
  }

  function slider(label, min, max, step, get, set) {
    const v = get();
    const out = el("span", { style: { fontSize: "11px", opacity: "0.85", minWidth: "46px", textAlign: "right" }, text: String(v) });

    const input = el("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(v),
      style: { width: "100%" }
    });

    input.addEventListener("input", () => {
      const nv = Number(input.value);
      out.textContent = String(nv);
      set(nv);
      apply();
    });

    return el("div", { style: { marginBottom: "10px" } }, [
      rowLabel(label),
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [input, out])
    ]);
  }

  function toggle(label, get, set, onAfter) {
    const btn = el("button", {
      type: "button",
      style: {
        width: "100%",
        fontSize: "11px",
        padding: "7px 9px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer"
      },
      text: ""
    });

    function render() {
      btn.textContent = label + ": " + (get() ? "ON" : "OFF");
    }

    btn.addEventListener("click", () => {
      set(!get());
      render();
      if (onAfter) onAfter();
      else apply();
    });

    render();
    return btn;
  }

  function button(text, onClick) {
    const b = el("button", {
      type: "button",
      style: {
        width: "100%",
        fontSize: "11px",
        padding: "7px 9px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.10)",
        color: "#fff",
        cursor: "pointer"
      },
      text
    });
    b.addEventListener("click", onClick);
    return b;
  }

  // ===== テーマ保存/読込（値だけ） =====

  function themeKey(name) { // theme名 → localStorageキーへ
    return LS_PREFIX + String(name);
  }

  function exportValuesOnly() { // st から「値だけ」を抜き出して保存用オブジェクト化
    // 目的: uiVisible のような一時UI状態を保存対象から除外する
    const v = JSON.parse(JSON.stringify(st));
    delete v.uiVisible;
    return v;
  }

  function applyValuesOnly(v) { // 保存オブジェクトを st へ反映
    // 目的: “値だけ” を復元し、即時反映（apply + hideOtherUI反映）
    if (!v || typeof v !== "object") return;

    if (v.enabled !== undefined) st.enabled = !!v.enabled;
    if (v.hideOtherUI !== undefined) st.hideOtherUI = !!v.hideOtherUI;

    if (v.afterBox) st.afterBox = {
      top: Number(v.afterBox.top),
      right: Number(v.afterBox.right),
      bottom: Number(v.afterBox.bottom),
      left: Number(v.afterBox.left)
    };

    if (v.afterBoxAuto) {
      // ▼ afterBoxAuto の復元（自動安全マージンのON/OFFと安全係数）
      // 目的: テーマ読込で「自動余白」設定も同じ状態に戻せるようにする
      st.afterBoxAuto = {
        enabled: !!v.afterBoxAuto.enabled,
        safety: Number(v.afterBoxAuto.safety)
      };
    }

    if (v.origin) st.origin = { x: Number(v.origin.x), y: Number(v.origin.y) };
    if (v.translate) st.translate = { x: Number(v.translate.x), y: Number(v.translate.y) };

    if (v.rotate !== undefined) st.rotate = Number(v.rotate);

    if (v.spot) st.spot = { x: Number(v.spot.x), y: Number(v.spot.y) };

    if (v.ellipse) {
      // ▼ 楕円スポットON/OFFを復元
      // 目的: テーマ読込で楕円の表示状態も同じに戻せるようにする
      st.ellipse = { enabled: !!v.ellipse.enabled };
    }

    if (v.core) st.core = { w: Number(v.core.w), h: Number(v.core.h) };
    if (v.main) st.main = { w: Number(v.main.w), h: Number(v.main.h) };

    if (v.alpha) st.alpha = {
      core0: Number(v.alpha.core0),
      core1: Number(v.alpha.core1),
      main0: Number(v.alpha.main0),
      main1: Number(v.alpha.main1)
    };

    if (v.stop) st.stop = {
      core1: Number(v.stop.core1),
      core2: Number(v.stop.core2),
      main1: Number(v.stop.main1),
      main2: Number(v.stop.main2)
    };

    // ▼ dim は 0=解除（null運用は廃止）
    // 目的: 保存/復元も「0..1」で統一する
    if (v.dim !== undefined) st.dim = clamp01(v.dim);

    if (v.bright !== undefined) st.bright = clamp01(v.bright);

    if (v.beam) st.beam = {
      enabled: !!v.beam.enabled,
      angle: Number(v.beam.angle),

      // ▼ Beam 強度倍率を復元
      // 目的: テーマ読込で「右下の直線光の強さ」も同じ見え方に戻せるようにする
      strength: Number(v.beam.strength),

      a0: Number(v.beam.a0),
      a1: Number(v.beam.a1),
      a2: Number(v.beam.a2),
      p0: Number(v.beam.p0),
      p1: Number(v.beam.p1),
      p2: Number(v.beam.p2)
    };

    // ▼ Beam2（2本目）も beam と同様に復元
    // 目的: テーマ読込で Beam2 の角度/強度/フェード位置も同じ状態へ戻す
    if (v.beam2) st.beam2 = {
      enabled: !!v.beam2.enabled,
      angle: Number(v.beam2.angle),
      strength: Number(v.beam2.strength),
      a0: Number(v.beam2.a0),
      a1: Number(v.beam2.a1),
      a2: Number(v.beam2.a2),
      p0: Number(v.beam2.p0),
      p1: Number(v.beam2.p1),
      p2: Number(v.beam2.p2)
    };

    apply();
    applyHideOtherUI();
  }

  // ▼ 現在アクティブな theme（最後に Load したもの）を保持
  // 目的: rotate変更などの「自動反映」時に、保存先を迷わず自動保存できるようにする
  let currentThemeName = null;

  // ▼ 自動保存（デバウンス）
  // 目的: スライダー連続操作中に毎回 localStorage 書き込みしない（最後の値だけ保存）
  let autoSaveTimer = null;
  function scheduleAutoSaveIfPossible() {
    if (!currentThemeName) return; // フォールバックで勝手に保存先を作らない
    if (autoSaveTimer) {
      try { window.clearTimeout(autoSaveTimer); } catch (_e) {}
    }
    autoSaveTimer = window.setTimeout(() => {
      try {
        saveTheme(currentThemeName);
      } catch (_e) {}
    }, 450);
  }

  function saveTheme(name) { // 現在の値を theme1〜3 のどれかに保存
    // 目的: 調整した “値だけ” を localStorage に保存して後で呼び出せるようにする
    const n = String(name);
    if (THEMES.indexOf(n) === -1) return;

    try {
      const data = exportValuesOnly();
      localStorage.setItem(themeKey(n), JSON.stringify(data));
      currentThemeName = n; // ▼ 手動Saveでも「今のテーマ」を確定させる（保存先の迷子防止）
      console.log("CSCS_ADJUST_BG saved:", n);
    } catch (_e) {}
  }

  function loadTheme(name) { // theme1〜3 の保存値を読み込んで反映
    // 目的: 以前保存したテーマを即時反映（保存が無い場合は何もしない）
    const n = String(name);
    if (THEMES.indexOf(n) === -1) return;

    let raw = null;
    try {
      raw = localStorage.getItem(themeKey(n));
    } catch (_e) {}

    if (!raw) {
      console.log("CSCS_ADJUST_BG no saved theme:", n);
      return;
    }

    try {
      const v = JSON.parse(raw);
      applyValuesOnly(v);

      // ★ 最後に読み込んだ theme 名を保存
      // 目的: 次回ページ読み込み時に自動復元するため
      try {
        localStorage.setItem(LAST_THEME_KEY, n);
      } catch (_e) {}

      currentThemeName = n; // ▼ 自動保存の保存先を「最後にLoadしたテーマ」に固定する
      console.log("CSCS_ADJUST_BG loaded:", n);
    } catch (_e) {}
  }

  function clearTheme(name) { // theme1〜3 の保存値を削除
    // 目的: 保存したテーマを「無かったこと」にする（フォールバックで復元しない）
    const n = String(name);
    if (THEMES.indexOf(n) === -1) return;

    try {
      localStorage.removeItem(themeKey(n));
      console.log("CSCS_ADJUST_BG cleared:", n);
    } catch (_e) {}
  }

  function resetToDefault() { // デフォルトに戻す
    // 目的: いつでも “初期状態” に戻れるようにする（保存テーマは触らない）
    const v = JSON.parse(JSON.stringify(DEFAULT_VALUES));
    applyValuesOnly(v);
    console.log("CSCS_ADJUST_BG reset to default.");
  }

  function buildPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    panel = el("div", {
      id: PANEL_ID,
      style: {
        position: "fixed",
        right: "6px",
        top: "calc(10px + env(safe-area-inset-top))",
        bottom: "calc(54px + env(safe-area-inset-bottom))",
        width: "300px",
        overflow: "auto",
        zIndex: 999999,
        color: "#fff",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        background: "rgba(0,0,0,0.52)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "14px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        padding: "10px",
        display: st.uiVisible ? "" : "none"
      }
    });

    panel.appendChild(el("div", {
      style: { fontSize: "11px", fontWeight: "700", opacity: "0.92", marginBottom: "10px" },
      text: "Ambient Tuner（背景の見え方をその場で調整）"
    }));

    const group = el("div", {});

    // ===== Theme（保存/読込）UI =====
    // 目的: theme1〜theme3 の3枠で “値だけ” を保存して切り替える
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9", marginBottom: "6px" }, text: "Theme（保存/読込）" }));

    const themeRow = el("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" } });

    const themeSelect = el("select", {
      style: {
        flex: "1",
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.25)",
        color: "#fff",
        outline: "none"
      }
    });

    THEMES.forEach((t) => {
      themeSelect.appendChild(el("option", { value: t, text: t }));
    });

    const saveBtn = el("button", {
      type: "button",
      style: {
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.10)",
        color: "#fff",
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      text: "Save（保存）"
    });

    saveBtn.addEventListener("click", () => {
      const beforeText = saveBtn.textContent;

      // ▼ 保存に成功したときだけボタン文言を「保存完了」にする
      // 目的: localStorage への保存成功がユーザーに即時伝わるようにする
      try {
        saveTheme(themeSelect.value);
        saveBtn.textContent = "保存完了";

        // ▼ 永続的に「保存完了」固定にならないよう一定時間で元に戻す
        // 目的: 次の保存操作の意図が伝わりやすい状態へ戻す
        window.setTimeout(() => {
          try {
            saveBtn.textContent = beforeText || "Save（保存）";
          } catch (_e) {}
        }, 900);
      } catch (_e) {
        // ▼ 失敗時は文言を変えない（フォールバックで成功扱いにしない）
        // 目的: 「保存できてないのに保存完了に見える」事故を防ぐ
        saveBtn.textContent = beforeText;
      }
    });

    const loadBtn = el("button", {
      type: "button",
      style: {
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.10)",
        color: "#fff",
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      text: "Load（読込）"
    });

    loadBtn.addEventListener("click", () => {
      loadTheme(themeSelect.value);
    });

    themeRow.appendChild(themeSelect);
    themeRow.appendChild(saveBtn);
    themeRow.appendChild(loadBtn);
    group.appendChild(themeRow);

    const themeRow2 = el("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" } });

    const clearBtn = el("button", {
      type: "button",
      style: {
        flex: "1",
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer"
      },
      text: "Clear saved（保存削除）"
    });

    clearBtn.addEventListener("click", () => {
      clearTheme(themeSelect.value);
    });

    const resetBtn = el("button", {
      type: "button",
      style: {
        flex: "1",
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer"
      },
      text: "Reset to default（初期値へ）"
    });

    resetBtn.addEventListener("click", () => {
      resetToDefault();
    });

    themeRow2.appendChild(clearBtn);
    themeRow2.appendChild(resetBtn);
    group.appendChild(themeRow2);

    group.appendChild(toggle("Override CSS（このチューナーの上書きを有効化）", () => st.enabled, (v) => (st.enabled = v)));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(toggle("Beam 1（斜めの光）", () => st.beam.enabled, (v) => (st.beam.enabled = v)));
    group.appendChild(el("div", { style: { height: "4px" } }));

    // ▼ Beam2 の ON/OFF を Beam1 直下へ移動
    // 目的: Beam 系の主トグルを上下に並べて操作しやすくする
    group.appendChild(toggle("Beam 2（2本目の光）", () => (st.beam2 && st.beam2.enabled), (v) => {
      // ▼ Beam2 を存在保証しつつ ON/OFF を切替
      // 目的: Beam2 を beam と同格で扱い、単独でも有効化できるようにする
      if (!st.beam2) st.beam2 = {
        enabled: false,
        angle: 160,
        strength: 1.00,
        a0: 0.10,
        a1: 0.04,
        a2: 0.00,
        p0: 0,
        p1: 28,
        p2: 58
      };
      st.beam2.enabled = !!v;
    }));
    group.appendChild(el("div", { style: { height: "4px" } }));

    group.appendChild(toggle("Ellipse(::after)（楕円の光をON/OFF）", () => (st.ellipse && st.ellipse.enabled), (v) => {
      // ▼ 楕円スポットのON/OFF切替
      // 目的: 楕円だけ消して背景/Beamの見え方を比較できるようにする
      if (!st.ellipse) st.ellipse = { enabled: true };
      st.ellipse.enabled = !!v;
    }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(toggle("Hide other UI（他UIを見えなくして背景だけ確認）", () => st.hideOtherUI, (v) => (st.hideOtherUI = v), () => {
      applyHideOtherUI();
    }));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(button("Copy JSON（現在設定をクリップボードへ）", async () => {
      const data = JSON.stringify(st, null, 2);
      try {
        await navigator.clipboard.writeText(data);
        console.log("Copied state JSON.");
      } catch (_e) {
        console.log(data);
        console.warn("Clipboard unavailable. JSON logged to console.");
      }
    }));

    // 「UI自体を消す」機能は混乱防止のため廃止（Resetボタンも出さない）

    // ★ ここが追加：全体明るさ（白膜）
    group.appendChild(el("div", { style: { height: "12px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Global（全体の明るさ/暗さ）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));
    group.appendChild(slider("Bright (0..1)（全体を明るく：白い薄膜）", 0, 1, 0.01, () => st.bright, (v) => (st.bright = clamp01(v))));

    // ▼ Global の直下に Dim override を配置
    // 目的: 「全体の明るさ/暗さ」を同じブロックで連続調整できるようにする
    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Dim override（暗さの一時上書き）" }));
    group.appendChild(el("div", { style: { fontSize: "11px", opacity: "0.85", marginBottom: "6px" }, text: "0 = 解除（暗くしない）" }));

    const dimWrap = el("div", { style: { marginBottom: "10px" } });
    const dimVal = el("span", { style: { fontSize: "11px", opacity: "0.85", minWidth: "46px", textAlign: "right" }, text: String(st.dim) });

    const dimInput = el("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value: String(st.dim),
      style: { width: "100%" }
    });

    dimInput.addEventListener("input", () => {
      // ▼ 0..1 の範囲で暗さを上書き（0=解除）
      // 目的: 「解除ボタン無し」でも最小値=解除で直感的に戻せるようにする
      st.dim = clamp01(dimInput.value);
      dimVal.textContent = String(st.dim);
      apply();
    });

    dimWrap.appendChild(rowLabel("Dim (0..1)（背景全体の暗さ：0=解除/1=最大）"));
    dimWrap.appendChild(el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
      dimInput,
      dimVal
    ]));
    group.appendChild(dimWrap);

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Ellipse (::after)（楕円スポット）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Spot X (%)（スポット中心の左右位置）", 0, 100, 1, () => st.spot.x, (v) => (st.spot.x = v)));
    group.appendChild(slider("Spot Y (%)（スポット中心の上下位置）", 0, 100, 1, () => st.spot.y, (v) => (st.spot.y = v)));

    group.appendChild(slider("Rotate (deg)（楕円レイヤー全体の回転）", -60, 60, 1, () => st.rotate, (v) => {
      // ▼ 回転角度の更新
      // 目的: 角度変更を st に反映する
      st.rotate = v;

      // ▼ afterBoxAuto が有効なら、角度変更に合わせて「必要最小余白」を自動計算して使う（buildTunedCss内で反映される）
      // 目的: 手動で afterBox を触らずに「欠け」を抑える
      // ※ apply() は slider() の共通処理で呼ばれるため、ここでは呼ばない

      // ▼ 最後に Load した theme がある時だけ自動保存（フォールバックで勝手に保存先は作らない）
      // 目的: 「角度→自動余白→自動反映→自動保存」の流れを成立させる
      scheduleAutoSaveIfPossible();
    }));
    group.appendChild(slider("Origin X (%)（回転の支点X：左=0/右=100）", 0, 100, 1, () => st.origin.x, (v) => (st.origin.x = v)));
    group.appendChild(slider("Origin Y (%)（回転の支点Y：上=0/下=100）", 0, 100, 1, () => st.origin.y, (v) => (st.origin.y = v)));

    group.appendChild(slider("Translate X (%)（楕円レイヤーの平行移動X）", -30, 30, 1, () => st.translate.x, (v) => (st.translate.x = v)));
    group.appendChild(slider("Translate Y (%)（楕円レイヤーの平行移動Y）", -30, 30, 1, () => st.translate.y, (v) => (st.translate.y = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Coverage box (%)（回転で欠けないための“余白”）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(toggle("Auto afterBox（画面比率+角度から余白を自動計算）", () => (st.afterBoxAuto && st.afterBoxAuto.enabled), (v) => {
      // ▼ 自動安全マージンのON/OFF
      // 目的: 手動調整(afterBoxスライダー)と自動計算を切り替えられるようにする
      if (!st.afterBoxAuto) st.afterBoxAuto = { enabled: true, safety: 1.45 };
      st.afterBoxAuto.enabled = !!v;
    }));
    group.appendChild(slider("Auto safety (x)（自動余白の安全係数）", 1, 3, 0.01, () => (st.afterBoxAuto ? st.afterBoxAuto.safety : 1.45), (v) => {
      // ▼ 自動計算値に掛ける倍率
      // 目的: 「計算上はOKだが実機でギリ欠ける」ケースを係数で吸収できるようにする
      if (!st.afterBoxAuto) st.afterBoxAuto = { enabled: true, safety: 1.45 };
      st.afterBoxAuto.safety = Number(v);
    }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Top (%)（上側へどれだけはみ出すか）", -80, 0, 1, () => st.afterBox.top, (v) => (st.afterBox.top = v)));
    group.appendChild(slider("Right (%)（右側へどれだけはみ出すか）", -80, 0, 1, () => st.afterBox.right, (v) => (st.afterBox.right = v)));
    group.appendChild(slider("Bottom (%)（下側へどれだけはみ出すか）", -80, 0, 1, () => st.afterBox.bottom, (v) => (st.afterBox.bottom = v)));
    group.appendChild(slider("Left (%)（左側へどれだけはみ出すか）", -80, 0, 1, () => st.afterBox.left, (v) => (st.afterBox.left = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Sizes (px)（楕円の大きさ）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Core W (px)（コア楕円：横幅）", 50, 1200, 10, () => st.core.w, (v) => (st.core.w = v)));
    group.appendChild(slider("Core H (px)（コア楕円：縦幅）", 30, 600, 5, () => st.core.h, (v) => (st.core.h = v)));
    group.appendChild(slider("Main W (px)（メイン楕円：横幅）", 300, 3200, 20, () => st.main.w, (v) => (st.main.w = v)));
    group.appendChild(slider("Main H (px)（メイン楕円：縦幅）", 100, 1400, 10, () => st.main.h, (v) => (st.main.h = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Intensity (alpha)（明るさ/濃さ）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Core alpha start（コア中心の濃さ）", 0, 1, 0.01, () => st.alpha.core0, (v) => (st.alpha.core0 = v)));
    group.appendChild(slider("Core alpha mid（コア中間の濃さ）",   0, 1, 0.01, () => st.alpha.core1, (v) => (st.alpha.core1 = v)));
    group.appendChild(slider("Main alpha start（メイン中心の濃さ）", 0, 1, 0.01, () => st.alpha.main0, (v) => (st.alpha.main0 = v)));
    group.appendChild(slider("Main alpha mid（メイン中間の濃さ）",   0, 1, 0.01, () => st.alpha.main1, (v) => (st.alpha.main1 = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Fade stops (%)（フェードが消える位置）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Core mid stop（コア：中間へ落ちる位置）", 0, 100, 1, () => st.stop.core1, (v) => (st.stop.core1 = v)));
    group.appendChild(slider("Core end stop（コア：完全に消える位置）", 0, 100, 1, () => st.stop.core2, (v) => (st.stop.core2 = v)));
    group.appendChild(slider("Main mid stop（メイン：中間へ落ちる位置）", 0, 100, 1, () => st.stop.main1, (v) => (st.stop.main1 = v)));
    group.appendChild(slider("Main end stop（メイン：完全に消える位置）", 0, 100, 1, () => st.stop.main2, (v) => (st.stop.main2 = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Beam (optional)（直線光の微調整）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Beam angle (deg)（光の向き）", 0, 360, 1, () => st.beam.angle, (v) => (st.beam.angle = v)));

    // ▼ 右下の直線光の強さ（倍率）
    // 目的: Beam の見え方を「強度」だけ素早く調整できるようにする
    group.appendChild(slider("Beam strength (x)（直線光の強さ倍率）", 0, 3, 0.01, () => st.beam.strength, (v) => (st.beam.strength = v)));

    group.appendChild(slider("Beam mid stop (%)（中間までの距離）", 0, 100, 1, () => st.beam.p1, (v) => (st.beam.p1 = v)));
    group.appendChild(slider("Beam end stop (%)（消えるまでの距離）", 0, 100, 1, () => st.beam.p2, (v) => (st.beam.p2 = v)));

    // ▼ Beam2（2本目）のON/OFFトグルは、上部（Beam1直下）へ移動済み
    // 目的: 重複表示を避け、操作位置を一箇所に統一する
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Beam2 angle (deg)（2本目の向き）", 0, 360, 1,
      () => (st.beam2 ? st.beam2.angle : 160),
      (v) => {
        // ▼ Beam2 の角度を更新
        // 目的: 2本目の光を任意方向へ回せるようにする
        if (!st.beam2) st.beam2 = {
          enabled: true,
          angle: 160,
          strength: 1.00,
          a0: 0.10,
          a1: 0.04,
          a2: 0.00,
          p0: 0,
          p1: 28,
          p2: 58
        };
        st.beam2.angle = v;
      }
    ));

    group.appendChild(slider("Beam2 strength (x)（2本目の強さ倍率）", 0, 3, 0.01,
      () => (st.beam2 ? st.beam2.strength : 1),
      (v) => {
        // ▼ Beam2 の強度倍率を更新
        // 目的: 2本目の光量を即座に調整できるようにする
        if (!st.beam2) st.beam2 = {
          enabled: true,
          angle: 160,
          strength: 1.00,
          a0: 0.10,
          a1: 0.04,
          a2: 0.00,
          p0: 0,
          p1: 28,
          p2: 58
        };
        st.beam2.strength = v;
      }
    ));

    group.appendChild(slider("Beam2 mid stop (%)（2本目：中間まで）", 0, 100, 1,
      () => (st.beam2 ? st.beam2.p1 : 28),
      (v) => {
        // ▼ Beam2 の中間フェード位置を更新
        // 目的: 光の広がり（中間）を独立調整できるようにする
        if (!st.beam2) st.beam2 = {
          enabled: true,
          angle: 160,
          strength: 1.00,
          a0: 0.10,
          a1: 0.04,
          a2: 0.00,
          p0: 0,
          p1: 28,
          p2: 58
        };
        st.beam2.p1 = v;
      }
    ));

    group.appendChild(slider("Beam2 end stop (%)（2本目：消えるまで）", 0, 100, 1,
      () => (st.beam2 ? st.beam2.p2 : 58),
      (v) => {
        // ▼ Beam2 の終端フェード位置を更新
        // 目的: 光が消える距離を独立調整できるようにする
        if (!st.beam2) st.beam2 = {
          enabled: true,
          angle: 160,
          strength: 1.00,
          a0: 0.10,
          a1: 0.04,
          a2: 0.00,
          p0: 0,
          p1: 28,
          p2: 58
        };
        st.beam2.p2 = v;
      }
    ));

    panel.appendChild(group);
    document.body.appendChild(panel);
  }

  function buildFloatingToggleBtn() {
    let btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();

    btn = el("button", {
      id: BTN_ID,
      type: "button",
      style: {
        position: "fixed",
        right: "6px",
        bottom: "10px",
        zIndex: 999999,
        width: "34px",
        height: "34px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.42)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
        backdropFilter: "blur(8px)",
        boxShadow: "0 10px 24px rgba(0,0,0,0.32)"
      },
      text: "⚙︎"
    });

    btn.addEventListener("click", () => {
      st.uiVisible = !st.uiVisible;

      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = st.uiVisible ? "" : "none";

      applyHideOtherUI();
    });

    document.body.appendChild(btn);
  }

  window.CSCS_AMBIENT_TUNER = {
    showUI: () => {
      st.uiVisible = true;
      const p = document.getElementById(PANEL_ID);
      if (p) p.style.display = "";
      applyHideOtherUI();
    },
    hideUI: () => {
      st.uiVisible = false;
      const p = document.getElementById(PANEL_ID);
      if (p) p.style.display = "none";
      applyHideOtherUI();
    },
    toggleUI: () => {
      st.uiVisible = !st.uiVisible;
      const p = document.getElementById(PANEL_ID);
      if (p) p.style.display = st.uiVisible ? "" : "none";
      applyHideOtherUI();
    },

    hideOtherUI: () => { st.hideOtherUI = true; applyHideOtherUI(); },
    showOtherUI: () => { st.hideOtherUI = false; applyHideOtherUI(); },
    toggleOtherUI: () => { st.hideOtherUI = !st.hideOtherUI; applyHideOtherUI(); },

    enable: () => { st.enabled = true; apply(); },
    disable: () => { st.enabled = false; apply(); },
    toggle: () => { st.enabled = !st.enabled; apply(); },

    // ===== Theme API（コンソール操作用）=====
    // 目的: UI無しでも theme 保存/読込/削除/初期値復帰ができる
    saveTheme: (name) => { saveTheme(name); },
    loadTheme: (name) => { loadTheme(name); },
    clearTheme: (name) => { clearTheme(name); },
    resetDefault: () => { resetToDefault(); },

    getState: () => JSON.parse(JSON.stringify(st)),
    apply: () => { apply(); applyHideOtherUI(); },
    // remove は廃止: UI自体を消去する導線を無くす（混乱防止）
  };

  apply();
  applyHideOtherUI();

  window.addEventListener("resize", () => {
    // ▼ 端末回転・リサイズ時に afterBox 自動計算を追従させる
    // 目的: 画面比率が変わった瞬間に「欠け」を起こしにくくする
    if (st.afterBoxAuto && st.afterBoxAuto.enabled) apply();
  });

  // ★ 最後に使用していた theme を自動復元
  // 目的: ページ遷移・再読込後も同じ背景を維持する
  try {
    const lastTheme = localStorage.getItem(LAST_THEME_KEY);
    if (lastTheme && THEMES.indexOf(lastTheme) !== -1) {
      loadTheme(lastTheme);
    }
  } catch (_e) {}

  buildPanel();
  buildFloatingToggleBtn();

  console.log("CSCS_AMBIENT_TUNER ready.");
  console.log("Open/Close panel: click ⚙︎ or CSCS_AMBIENT_TUNER.toggleUI()");
  console.log("Hide other UI: CSCS_AMBIENT_TUNER.toggleOtherUI()");
})();