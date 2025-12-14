// cscs_adjust_background.js
/*
 * 概要:
 *   右下の ⚙︎ ボタンから「背景（ambient）の見え方」をその場で調整できるパネルを表示します。
 *   調整したパラメータ（各値）を localStorage に保存し、theme1 / theme2 / theme3 の3種類を切り替えて使えます。
 *
 * 使い方:
 *   - 右下 ⚙︎ を押すとパネルが開閉します（折りたたみボタンはありません）。
 *   - パネル内のスライダー/トグルで背景を調整すると即時反映されます。
 *   - 「Theme」欄で theme1〜3 を選び、「Save（保存）」でそのテーマに保存できます。
 *   - 「Load（読込）」で保存済みテーマを読み込み、即時反映します。
 *   - 「Reset to default（初期値に戻す）」でこのJSの初期状態（デフォルト）に戻します。
 *
 * 注意:
 *   - 保存/読込は “値だけ” を扱います（uiVisible などの一時UI状態は保存しません）。
 *   - 保存データが無いテーマを Load した場合は何もしません（フォールバックで勝手に作りません）。
 */

(() => {
  "use strict";

  const BODY_CLASS = "cscs-ambient-bg-on"; // 背景レイヤーON時に html に付けるクラス（既存ambient背景と揃える）

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

    afterBox: { top: -30, right: -10, bottom: -50, left: -20 },  // %
    origin: { x: 20, y: 20 }, // %
    translate: { x: -4, y: -4 }, // %
    rotate: -20, // deg

    spot: { x: 23, y: 30 }, // %

    core: { w: 400, h: 130 }, // px
    main: { w: 1980, h: 567 }, // px

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

    dim: null,   // 暗さ（0..1 / null=既存変数を使う）
    bright: 0.0, // 明るさ（0..1：白い薄膜で全体を明るくする）

    beam: {
      enabled: false,
      angle: 340,
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

  function ensureHtmlClass() {
    try {
      document.documentElement.classList.add(BODY_CLASS);
    } catch (_e) {}
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
      "html." + HIDE_UI_CLASS + " #" + BTN_ID + " *{" +
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

  function cssDimA() { // dim → 0..0.30相当
    if (st.dim === null) return "var(--cscs-ambient-dim-a,0)";
    return String(0.30 * clamp01(st.dim));
  }

  function cssBrightA() { // bright → 0..0.18相当（白膜。上げすぎると白っぽくなるので控えめ）
    return String(0.18 * clamp01(st.bright));
  }

  function buildAfterCss() {
    const dimA = cssDimA();
    const brightA = cssBrightA();

    const bx = st.afterBox;
    const ox = st.origin;
    const tr = st.translate;

    const spx = st.spot.x + "%";
    const spy = st.spot.y + "%";

    const afterBg =
      // 明るさオーバーレイ（bright）
      "linear-gradient(180deg, rgba(255,255,255," + brightA + ") 0%, rgba(255,255,255," + brightA + ") 100%)," +
      // 暗さオーバーレイ（dim）
      "linear-gradient(180deg, rgba(0,0,0," + dimA + ") 0%, rgba(0,0,0," + dimA + ") 100%)," +
      // 小さいコア楕円
      "radial-gradient(ellipse " + st.core.w + "px " + st.core.h + "px at " + spx + " " + spy + "," +
        "rgba(70,70,70," + st.alpha.core0 + ") 0%," +
        "rgba(50,50,50," + st.alpha.core1 + ") " + st.stop.core1 + "%," +
        "rgba(0,0,0,0) " + st.stop.core2 + "%" +
      ")," +
      // 大きいメイン楕円
      "radial-gradient(ellipse " + st.main.w + "px " + st.main.h + "px at " + spx + " " + spy + "," +
        "rgba(58,58,58," + st.alpha.main0 + ") 0%," +
        "rgba(34,34,34," + st.alpha.main1 + ") " + st.stop.main1 + "%," +
        "rgba(0,0,0,0) " + st.stop.main2 + "%" +
      ")";

    return (
      "html." + BODY_CLASS + "::after{" +
        "content:'';" +
        "position:fixed;" +
        "pointer-events:none;" +
        "z-index:0;" +
        "top:" + bx.top + "%;" +
        "right:" + bx.right + "%;" +
        "bottom:" + bx.bottom + "%;" +
        "left:" + bx.left + "%;" +
        "transform-origin:" + ox.x + "% " + ox.y + "%;" +
        "transform: translate(" + tr.x + "%," + tr.y + "%) rotate(" + st.rotate + "deg);" +
        "background:" + afterBg + ";" +
        "background-repeat:no-repeat,no-repeat,no-repeat,no-repeat;" +
        "background-attachment:fixed,fixed,fixed,fixed;" +
        "background-blend-mode:normal,normal,normal,normal;" +
      "}"
    );
  }

  function buildBeforeCssIfNeeded() {
    if (!st.beam.enabled) return "";

    const dimA = cssDimA();
    const brightA = cssBrightA();
    const b = st.beam;

    const beam =
      "linear-gradient(" + b.angle + "deg," +
        "rgba(255,255,255," + b.a0 + ") " + b.p0 + "%," +
        "rgba(255,255,255," + b.a1 + ") " + b.p1 + "%," +
        "rgba(255,255,255," + b.a2 + ") " + b.p2 + "%" +
      ")";

    return (
      "html." + BODY_CLASS + "::before{" +
        "background:" +
          beam + "," +
          "linear-gradient(180deg, rgba(255,255,255," + brightA + ") 0%, rgba(255,255,255," + brightA + ") 100%)," +
          "linear-gradient(180deg, rgba(0,0,0," + dimA + ") 0%, rgba(0,0,0," + dimA + ") 100%)," +
          "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0.58) 100%)," +
          "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 60%, rgba(0,0,0,0.70) 100%)," +
          "linear-gradient(180deg, rgba(18,18,18,1) 0%, rgba(14,14,14,1) 100%);" +
        "background-repeat:no-repeat;" +
        "background-attachment:fixed;" +
      "}"
    );
  }

  function buildDimOverride() {
    if (st.dim === null) return "";
    return "html." + BODY_CLASS + "{--cscs-ambient-dim-a:" + cssDimA() + ";}";
  }

  function apply() {
    ensureHtmlClass();
    const el = ensureStyleEl();

    if (!st.enabled) {
      el.textContent = "";
      return;
    }

    el.textContent = buildDimOverride() + buildBeforeCssIfNeeded() + buildAfterCss();
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

    if (v.origin) st.origin = { x: Number(v.origin.x), y: Number(v.origin.y) };
    if (v.translate) st.translate = { x: Number(v.translate.x), y: Number(v.translate.y) };

    if (v.rotate !== undefined) st.rotate = Number(v.rotate);

    if (v.spot) st.spot = { x: Number(v.spot.x), y: Number(v.spot.y) };

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

    // dim は null を許可（既存CSS変数に戻す用途）
    if (v.dim === null) st.dim = null;
    else if (v.dim !== undefined) st.dim = clamp01(v.dim);

    if (v.bright !== undefined) st.bright = clamp01(v.bright);

    if (v.beam) st.beam = {
      enabled: !!v.beam.enabled,
      angle: Number(v.beam.angle),
      a0: Number(v.beam.a0),
      a1: Number(v.beam.a1),
      a2: Number(v.beam.a2),
      p0: Number(v.beam.p0),
      p1: Number(v.beam.p1),
      p2: Number(v.beam.p2)
    };

    apply();
    applyHideOtherUI();
  }

  function saveTheme(name) { // 現在の値を theme1〜3 のどれかに保存
    // 目的: 調整した “値だけ” を localStorage に保存して後で呼び出せるようにする
    const n = String(name);
    if (THEMES.indexOf(n) === -1) return;

    try {
      const data = exportValuesOnly();
      localStorage.setItem(themeKey(n), JSON.stringify(data));
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
        bottom: "54px",
        width: "300px",
        maxHeight: "calc(100vh - 90px)",
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
      saveTheme(themeSelect.value);
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

    group.appendChild(toggle("Beam(::before)（斜めの光を追加して見え方確認）", () => st.beam.enabled, (v) => (st.beam.enabled = v)));
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

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Ellipse (::after)（楕円スポット）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Spot X (%)（スポット中心の左右位置）", 0, 100, 1, () => st.spot.x, (v) => (st.spot.x = v)));
    group.appendChild(slider("Spot Y (%)（スポット中心の上下位置）", 0, 100, 1, () => st.spot.y, (v) => (st.spot.y = v)));

    group.appendChild(slider("Rotate (deg)（楕円レイヤー全体の回転）", -60, 60, 1, () => st.rotate, (v) => (st.rotate = v)));
    group.appendChild(slider("Origin X (%)（回転の支点X：左=0/右=100）", 0, 100, 1, () => st.origin.x, (v) => (st.origin.x = v)));
    group.appendChild(slider("Origin Y (%)（回転の支点Y：上=0/下=100）", 0, 100, 1, () => st.origin.y, (v) => (st.origin.y = v)));

    group.appendChild(slider("Translate X (%)（楕円レイヤーの平行移動X）", -30, 30, 1, () => st.translate.x, (v) => (st.translate.x = v)));
    group.appendChild(slider("Translate Y (%)（楕円レイヤーの平行移動Y）", -30, 30, 1, () => st.translate.y, (v) => (st.translate.y = v)));

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Coverage box (%)（回転で欠けないための“余白”）" }));
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
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Dim override（暗さの一時上書き）" }));
    group.appendChild(el("div", { style: { fontSize: "11px", opacity: "0.85", marginBottom: "6px" }, text: "null = 既存の --cscs-ambient-dim-a をそのまま利用" }));

    const dimWrap = el("div", { style: { marginBottom: "10px" } });
    const dimVal = el("span", { style: { fontSize: "11px", opacity: "0.85", minWidth: "46px", textAlign: "right" }, text: st.dim === null ? "null" : String(st.dim) });

    const dimInput = el("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value: st.dim === null ? "0.10" : String(st.dim),
      style: { width: "100%" }
    });

    dimInput.addEventListener("input", () => {
      st.dim = clamp01(dimInput.value);
      dimVal.textContent = String(st.dim);
      apply();
    });

    const dimNullBtn = el("button", {
      type: "button",
      style: {
        fontSize: "11px",
        padding: "6px 8px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      text: "Set null（上書きを解除）"
    });

    dimNullBtn.addEventListener("click", () => {
      st.dim = null;
      dimVal.textContent = "null";
      apply();
    });

    dimWrap.appendChild(rowLabel("Dim (0..1)（背景全体の暗さ：0=暗くしない/1=最大）"));
    dimWrap.appendChild(el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
      dimInput,
      dimVal,
      dimNullBtn
    ]));
    group.appendChild(dimWrap);

    group.appendChild(el("div", { style: { height: "10px" } }));
    group.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "700", opacity: "0.9" }, text: "Beam (optional)（直線光の微調整）" }));
    group.appendChild(el("div", { style: { height: "6px" } }));

    group.appendChild(slider("Beam angle (deg)（光の向き）", 0, 360, 1, () => st.beam.angle, (v) => (st.beam.angle = v)));
    group.appendChild(slider("Beam mid stop (%)（中間までの距離）", 0, 100, 1, () => st.beam.p1, (v) => (st.beam.p1 = v)));
    group.appendChild(slider("Beam end stop (%)（消えるまでの距離）", 0, 100, 1, () => st.beam.p2, (v) => (st.beam.p2 = v)));

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

  ensureHtmlClass();
  apply();
  applyHideOtherUI();

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