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
  var BTN_ID = "cscs-effects-toggle";
  var STYLE_ID = "cscs-effects-toggle-style";

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

  function computeDisabled() {
    var v = safeGetLS(LS_KEY);
    if (String(v || "") === "1") {
      return true;
    }
    return false;
  }

  function applyFlag(disabled) {
    window.CSCS_EFFECTS_DISABLED = (disabled === true);
  }

  function isDisabledNow() {
    return (window.CSCS_EFFECTS_DISABLED === true);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var css =
      "#" + BTN_ID + "{" +
      "position:fixed !important;" +
      "bottom:15px !important;" +
      "right:15px !important;" +
      "z-index:2147483647 !important;" +
      "font-size:11px;" +
      "padding:0px 8px;" +
      "height:22px;" +
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

    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";

    function refreshLabel() {
      var disabled = isDisabledNow();
      if (disabled) {
        btn.textContent = "FX: OFF";
        btn.classList.remove("is-on");
        btn.classList.add("is-off");
      } else {
        btn.textContent = "FX: ON";
        btn.classList.remove("is-off");
        btn.classList.add("is-on");
      }
    }

    btn.addEventListener("click", function () {
      var disabled = isDisabledNow();
      var nextDisabled = !disabled;

      applyFlag(nextDisabled);

      if (nextDisabled) {
        safeSetLS(LS_KEY, "1");
      } else {
        safeRemoveLS(LS_KEY);
      }

      refreshLabel();

      try {
        location.reload();
      } catch (_eReload) {
        // reload が効かない環境向けの最後の手段
        try {
          location.href = location.href;
        } catch (_eHref) {
        }
      }
    });

    refreshLabel();
    document.body.appendChild(btn);
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
    }
  };
})();