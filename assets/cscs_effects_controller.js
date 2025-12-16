// assets/cscs_effects_controller.js
// 目的:
//   演出系JS（fade/scale/ambient/text-shadow/slide-in 等）を、実行時に確実にON/OFFできる “司令塔”。
//   - テンプレ上では演出系JSを読み込んだままでも、冒頭ガードで「動かさない」ことができる。
//   - 画面内のボタンで ON/OFF を切り替える（切替は localStorage に永続化）。
//
// 重要（運用ルール）:
//   演出OFFは「後から殺す」のではなく「演出JSの冒頭でreturnして最初から走らせない」を正とする。
//   そのため、切替を確実に反映させるには “ページをリロード” する（演出JSが既にイベント登録済みのため）。
//
// 仕様（フラグ）:
//   - window.CSCS_EFFECTS_DISABLED === true  → 演出OFF
//   - localStorage "cscs_effects_disabled" === "1" → 演出OFF（永続）
//
// UI:
//   - 右上に小さいトグルボタン（FX: ON / FX: OFF）を表示。
//   - 押すと localStorage を切替 → window フラグ反映 → 即リロード。

(function () {
  "use strict";

  var LS_KEY = "cscs_effects_disabled";
  // 個別OFF用（モジュール別の辞書）: {"fade":true,"scale":false,...} のようなJSONを保存する
  var LS_KEY_MAP = "cscs_effects_disabled_map";

  var BTN_ID = "cscs-effects-toggle";
  var STYLE_ID = "cscs-effects-toggle-style";

  // 【個別ON/OFF対象の演出モジュール定義】
  // - id: 演出JS側が参照するキー（例: window.CSCS_EFFECTS_DISABLED_MAP[id]）
  // - label: UI表示名
  var EFFECTS = [
    { id: "clickable_scale_effects", label: "Scale" },
    { id: "cscs_adjust_background",  label: "AdjustBG" },
    { id: "cscs_ambient_background", label: "Ambient" },
    { id: "cscs_fade_overlay",       label: "Fade" },
    { id: "cscs_slide_in",           label: "SlideIn" },
    { id: "cscs_text_shadow",        label: "TextShadow" },
    { id: "point_summary_board_dummy", label: "PointBoard" },
    { id: "field_summary", label: "FieldSummary" },
    { id: "similar_list", label: "SimilarList" },
    { id: "b_wrong_strike_mark", label: "WrongStrike" }
  ];

  function safeGetLS(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }

  function safeSetLS(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function safeRemoveLS(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (_e) {
      return false;
    }
  }

  // 個別OFF辞書を安全に読む（壊れていれば空辞書）
  function safeGetMap() {
    var raw = safeGetLS(LS_KEY_MAP);
    if (!raw) return {};
    try {
      var obj = JSON.parse(String(raw));
      if (!obj || typeof obj !== "object") return {};
      return obj;
    } catch (_eJSON) {
      return {};
    }
  }

  // 個別OFF辞書を安全に保存する（objectのみ）
  function safeSetMap(mapObj) {
    try {
      var s = JSON.stringify(mapObj || {});
      return safeSetLS(LS_KEY_MAP, s);
    } catch (_eStr) {
      return false;
    }
  }

  // 全体OFF判定（従来の単一フラグ）
  function computeDisabled() {
    var v = safeGetLS(LS_KEY);
    if (String(v || "") === "1") {
      return true;
    }
    return false;
  }

  // 個別OFF判定（辞書に true が入っているものだけOFF）
  function isEffectDisabled(effectId) {
    var m = safeGetMap();
    return (m && m[effectId] === true);
  }

  // window側へフラグを反映
  // 追加した処理:
  //  - CSCS_EFFECTS_DISABLED: 全体OFFの従来フラグ（互換維持）
  //  - CSCS_EFFECTS_DISABLED_MAP: 個別OFF辞書（各演出JSの冒頭returnで参照する想定）
  function applyFlag(disabled) {
    window.CSCS_EFFECTS_DISABLED = (disabled === true);
    window.CSCS_EFFECTS_DISABLED_MAP = safeGetMap();
  }

  function isDisabledNow() {
    return (window.CSCS_EFFECTS_DISABLED === true);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var PANEL_ID = "cscs-effects-panel";

    var css =
      "#" + BTN_ID + "{" +
      "position:fixed !important;" +
      "bottom:10px !important;" +
      "right:12px !important;" +
      "z-index:2147483647 !important;" +
      "font-size:11px;" +
      "padding:0px 0px;" +
      "height:34px;" +
      "width:66px;" +
      "line-height:22px;" +
      "border-radius:999px;" +
      "border:1px solid rgba(255,255,255,0.18);" +
      "background:rgba(0,0,0,0.40) !important;" +
      "color:#fff;" +
      "font-weight:700;" +
      "letter-spacing:0.2px;" +
      "cursor:pointer;" +
      "user-select:none;" +
      "-webkit-user-select:none;" +
      "box-shadow:none;" +
      "opacity:0.78;" +
      "}" +
      "#" + BTN_ID + ":active{" +
      "transform:translateY(1px);" +
      "}" +
      "#" + BTN_ID + ".is-off{" +
      "background:rgba(0,0,0,0.55);" +
      "opacity:0.55;" +
      "}" +
      "#" + BTN_ID + ".is-on{" +
      "background:rgba(0,0,0,0.35);" +
      "opacity:0.80;" +
      "}" +

      // 追加した処理: 個別ON/OFF用パネル
      "#" + PANEL_ID + "{" +
      "position:fixed !important;" +
      "right:12px;" +
      "bottom:calc(10px + 34px + 8px);" +
      "z-index:2147483647;" +
      "width:170px;" +
      "padding:10px 10px;" +
      "border-radius:12px;" +
      "border:1px solid rgba(255,255,255,0.16);" +
      "background:rgba(0,0,0,0.58);" +
      "color:#fff;" +
      "font-size:12px;" +
      "box-shadow:none;" +
      "display:none;" +
      "}" +
      "#" + PANEL_ID + ".open{" +
      "display:block;" +
      "}" +
      "#" + PANEL_ID + " .row{" +
      "display:flex;" +
      "align-items:center;" +
      "justify-content:space-between;" +
      "padding:4px 0px;" +
      "}" +
      "#" + PANEL_ID + " .ttl{" +
      "font-weight:700;" +
      "opacity:0.9;" +
      "padding-bottom:6px;" +
      "}" +
      "#" + PANEL_ID + " input[type=checkbox]{" +
      "transform:scale(1.05);" +
      "}" +
      "#" + PANEL_ID + " .btn{" +
      "font-size:11px;" +
      "padding:2px 8px;" +
      "height:24px;" +
      "line-height:20px;" +
      "border-radius:999px;" +
      "border:1px solid rgba(255,255,255,0.18);" +
      "background:rgba(0,0,0,0.35);" +
      "color:#fff;" +
      "font-weight:700;" +
      "cursor:pointer;" +
      "user-select:none;" +
      "-webkit-user-select:none;" +
      "box-shadow:none;" +
      "}" +
      "#" + PANEL_ID + " .btn:active{" +
      "transform:translateY(1px);" +
      "}" +
      "#" + PANEL_ID + " .btn.is-off{" +
      "background:rgba(0,0,0,0.55);" +
      "opacity:0.65;" +
      "}" +
      "#" + PANEL_ID + " .btn.is-on{" +
      "background:rgba(0,0,0,0.35);" +
      "opacity:0.90;" +
      "}" +
      "#" + PANEL_ID + " .hint{" +
      "font-size:11px;" +
      "opacity:0.72;" +
      "padding-top:6px;" +
      "}";

    var styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.type = "text/css";
    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);
  }

  function renderButton() {
    if (document.getElementById(BTN_ID)) {
      return;
    }

    ensureStyle();

    var PANEL_ID = "cscs-effects-panel";

    // 追加した処理: 個別ON/OFFパネルを生成（ボタンとは別DOM）
    function ensurePanel() {
      var existing = document.getElementById(PANEL_ID);
      if (existing) return existing;

      var panel = document.createElement("div");
      panel.id = PANEL_ID;

      var ttl = document.createElement("div");
      ttl.className = "ttl";
      ttl.textContent = "Effects (panel)";
      panel.appendChild(ttl);

      // 追加した処理:
      // - パネル内に「ALL（全体ON/OFF）」ボタンを置く
      // - ここで LS_KEY（cscs_effects_disabled）を操作し、確実に反映するためリロードする
      (function () {
        var rowAll = document.createElement("div");
        rowAll.className = "row";

        var labelAll = document.createElement("span");
        labelAll.textContent = "ALL";

        var btnAll = document.createElement("button");
        btnAll.type = "button";
        btnAll.className = "btn";

        function refreshAllButton() {
          var disabled = isDisabledNow();
          if (disabled) {
            btnAll.textContent = "OFF";
            btnAll.classList.remove("is-on");
            btnAll.classList.add("is-off");
          } else {
            btnAll.textContent = "ON";
            btnAll.classList.remove("is-off");
            btnAll.classList.add("is-on");
          }
        }

        btnAll.addEventListener("click", function () {
          var disabled = isDisabledNow();
          var nextDisabled = !disabled;

          applyFlag(nextDisabled);

          if (nextDisabled) {
            safeSetLS(LS_KEY, "1");
          } else {
            safeRemoveLS(LS_KEY);
          }

          refreshAllButton();

          try {
            location.reload();
          } catch (_eReloadAll) {
            try {
              location.href = location.href;
            } catch (_eHrefAll) {
            }
          }
        });

        refreshAllButton();

        rowAll.appendChild(labelAll);
        rowAll.appendChild(btnAll);
        panel.appendChild(rowAll);
      })();

      var map = safeGetMap();

      for (var i = 0; i < EFFECTS.length; i++) {
        (function (def) {
          var row = document.createElement("div");
          row.className = "row";

          var label = document.createElement("span");
          label.textContent = def.label;

          var cb = document.createElement("input");
          cb.type = "checkbox";
          // チェックON = 有効（OFF状態は map[id]=true で表現する）
          cb.checked = !(map && map[def.id] === true);

          cb.addEventListener("change", function () {
            // 追加した処理: チェックOFF = その演出をOFF（map[id]=true）
            var m = safeGetMap();
            if (!m || typeof m !== "object") m = {};
            if (cb.checked) {
              delete m[def.id];
            } else {
              m[def.id] = true;
            }
            safeSetMap(m);

            // windowへ即反映（各演出JSの冒頭ガードが参照）
            applyFlag(isDisabledNow());

            // 演出JSは「冒頭でreturn」が正なので、確実な反映にはリロードする
            try {
              location.reload();
            } catch (_eReloadP) {
              try {
                location.href = location.href;
              } catch (_eHrefP) {
              }
            }
          });

          row.appendChild(label);
          row.appendChild(cb);
          panel.appendChild(row);
        })(EFFECTS[i]);
      }

      var hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Tip: tap FX button to open/close this panel.";
      panel.appendChild(hint);

      document.body.appendChild(panel);
      return panel;
    }

    function togglePanel(open) {
      var p = ensurePanel();
      if (open === true) {
        p.classList.add("open");
      } else {
        p.classList.remove("open");
      }
    }

    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";

    function refreshLabel() {
      var disabled = isDisabledNow();

      // 追加した処理:
      // - 全体ONでも、個別OFFが1つでもあれば "MIX" 表示にして状態を可視化する
      var anyEffectOff = false;
      try {
        var m = safeGetMap();
        for (var i = 0; i < EFFECTS.length; i++) {
          var id = EFFECTS[i].id;
          if (m && m[id] === true) {
            anyEffectOff = true;
            break;
          }
        }
      } catch (_eMix) {
        anyEffectOff = false;
      }

      if (disabled) {
        btn.textContent = "FX: OFF";
        btn.classList.remove("is-on");
        btn.classList.add("is-off");
      } else if (anyEffectOff) {
        btn.textContent = "FX: MIX";
        btn.classList.remove("is-off");
        btn.classList.add("is-on");
      } else {
        btn.textContent = "FX: ON";
        btn.classList.remove("is-off");
        btn.classList.add("is-on");
      }
    }

    // 追加した処理:
    // - FXボタンは「パネルを開閉するだけ」にする（1クリック導線）
    // - 全体ON/OFF（ALL）と個別ON/OFFはパネル内で行う
    btn.addEventListener("click", function () {
      var p = ensurePanel();
      var isOpen = p.classList.contains("open");
      togglePanel(!isOpen);
    });

    // パネル外クリックで閉じる（最小限）
    document.addEventListener("click", function (ev) {
      var p = document.getElementById(PANEL_ID);
      if (!p) return;
      if (!p.classList.contains("open")) return;

      var t = ev && ev.target ? ev.target : null;
      if (!t) return;

      // 追加した処理: ボタンやパネル内部クリックでは閉じない
      if (t.id === BTN_ID) return;
      if (p.contains(t)) return;

      togglePanel(false);
    });

    refreshLabel();
    document.body.appendChild(btn);

    // 起動直後にwindowへmapを確実に置く（演出JS側の冒頭ガードが参照するため）
    applyFlag(isDisabledNow());
  }

  // ===== 起動直後（最優先でフラグ確定）=====
  // ※ 演出JSより先にこの司令塔JSが読み込まれていることが前提（重要）
  applyFlag(computeDisabled());

  // ===== UI（ボタン）=====
  // DOMがまだ無い場合があるので、DOM構築後に描画する
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderButton();
    });
  } else {
    renderButton();
  }

  // デバッグや他JSから操作したい場合のために最小APIを公開
  window.CSCS_EFFECTS_CONTROLLER = {
    isDisabled: function () {
      return isDisabledNow();
    },

    // 追加した処理: マスターON/OFF（従来互換）
    setDisabled: function (disabled) {
      applyFlag(disabled === true);
      if (disabled === true) {
        safeSetLS(LS_KEY, "1");
      } else {
        safeRemoveLS(LS_KEY);
      }
      try {
        location.reload();
      } catch (_eReload2) {
      }
    },

    // 追加した処理: 個別ON/OFF（effectId は EFFECTS[].id を想定）
    // - disabled=true でその演出だけOFF（map[id]=true）
    // - disabled=false でその演出だけON（map[id] を削除）
    setEffectDisabled: function (effectId, disabled) {
      var m = safeGetMap();
      if (!m || typeof m !== "object") m = {};
      var k = String(effectId || "");
      if (!k) return;

      if (disabled === true) {
        m[k] = true;
      } else {
        delete m[k];
      }
      safeSetMap(m);

      // windowへ即反映（確実な反映はリロード）
      applyFlag(isDisabledNow());

      try {
        location.reload();
      } catch (_eReload3) {
      }
    },

    // 追加した処理: 個別OFF状態の取得
    isEffectDisabled: function (effectId) {
      var k = String(effectId || "");
      if (!k) return false;
      return isEffectDisabled(k);
    },

    // 追加した処理: 現在の個別辞書を返す（参照用）
    getEffectMap: function () {
      return safeGetMap();
    }
  };
})();