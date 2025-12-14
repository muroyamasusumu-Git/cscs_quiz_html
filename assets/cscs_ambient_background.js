// assets/cscs_ambient_background.js
/**
 * CSCS Ambient Background (container + safety rails)
 *
 * 【役割分担（adjust_background.js との責務分離）】
 *   - cscs_ambient_background.js（このファイル / ambient側）:
 *       “背景の器” を作るだけ。
 *       具体的には、背景レイヤーDOMを最背面に固定し、クリックを奪わないことを保証するための
 *       1) 安全柵CSS注入（pointer-events:none / z-index / fixed配置 / .wrap前面化）
 *       2) 背景レイヤーDOM生成（IDを確定して不変化）
 *          #cscs-ambient-layer（器）
 *            ├ #cscs-ambient-base（最低限の下地グラデ）
 *            └ #cscs-ambient-tuned（調整用の描画先）
 *                └ #cscs-ambient-tuned-rot（回転/平行移動/origin等のtransform適用先）
 *       3) ON/OFF 管理（htmlクラス付与/除去、layer表示/非表示）
 *       4) theme状態の保持（data-cscs-ambient-theme を更新するだけ）
 *
 *   - cscs_adjust_background.js（adjust側）:
 *       “見た目の生成（描画）” を担当。
 *       このファイルが用意する #cscs-ambient-tuned-rot に対して <style> を注入し、
 *       gradient合成や transform を使って実際の見た目を作る。
 *       ambient側は tuned の background を勝手に描かない（責務を侵食しない）。
 *
 * 【このファイルが実際にやっていること（詳細）】
 *   - injectStyleIfNeeded():
 *       背景DOMがUIより前に出てクリックを奪う事故を防ぐためのCSSを 1回だけ注入する。
 *       body背景は触らず、背景は専用DOMレイヤーに集約する。
 *
 *   - ensureLayer():
 *       enabled=true のときだけ、htmlへ “背景ONスコープ” を付与し（BODY_CLASS）、
 *       背景DOM（layer/base/tuned/tuned-rot）を1セットだけ生成して body 直下へ挿入する。
 *       すでに layer が存在する場合は、tuned-rot が無い時だけ正規構造として補完する。
 *
 *   - setEnabled(true|false):
 *       true: ensureLayer() を呼び、器を復帰させる。
 *       false: BODY_CLASS と theme属性を外し、layer を display:none にして背景を無効化する。
 *
 *   - setTheme("deep"|"soft"):
 *       見た目は変えず、data-cscs-ambient-theme だけ更新する（器の属性として保持）。
 */
(function () {
  "use strict";

  var BODY_CLASS = "cscs-ambient-bg-on";
  var STYLE_ID = "cscs-ambient-bg-style";

  // ▼ Ambient 層DOM ID（確定：以後不変）
  // 目的: adjust 側の「描画先」を永久に固定し、以後の改修コストを下げる
  var LAYER_ID = "cscs-ambient-layer";
  var BASE_ID  = "cscs-ambient-base";
  var TUNED_ID = "cscs-ambient-tuned";

  // ▼ 回転専用 tuned 子要素（確定：以後不変）
  // 目的: 1枚DOM（tuned）では transform 回転が UI/描画と衝突しやすいので、
  //       回転・平行移動・origin などの transform はこの子要素だけに集約できるようにする
  var TUNED_ROT_ID = "cscs-ambient-tuned-rot";

  var enabled = true;
  var theme = "deep";   // "deep" or "soft"

  function injectStyleIfNeeded() {
    if (document.getElementById(STYLE_ID)) return;

    var styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.type = "text/css";

    // 重要:
    // - body背景は触らない
    // - 背景レイヤーは最背面に固定
    // - .wrap 側を前面に保つ（z-indexの衝突を避けるため、必要なら .wrap に position:relative; z-index:1; を足す）
    var cssText = ""
      + "html, body{"
      + "height:100%;"
      + "min-height:100%;"
      + "overflow-x:hidden;"
      + "}"

      // ▼ Ambient ON のスコープ（背景の“器”がある状態）
      // 目的: 背景は ambient がON/OFF管理し、adjust は触らない
      + "html." + BODY_CLASS + "{"
      + "min-height:100vh;"
      + "background-color: rgba(0,0,0,1);"
      + "}"

      // ▼ body は背景を持たない（背景は専用DOMレイヤーに集約）
      // 目的: 擬似要素やbody背景の取り合いを避ける
      + "body{"
      + "background: transparent;"
      + "position: relative;"
      + "z-index: 1;"
      + "}"

      // ▼ quiz UI を背景レイヤーより必ず前面に固定
      // 目的: 背景DOMが前面に来てクリックを奪う事故を防ぐ
      + ".wrap{"
      + "position: relative;"
      + "z-index: 2;"
      + "}"

      // ▼ 背景レイヤーの器（固定・最背面・クリック不干渉）
      // 目的: adjust が常に同じ描画先にCSSを注入できるようにする
      + "#" + LAYER_ID + "{"
      + "position: fixed;"
      + "inset: 0;"
      + "pointer-events: none;"
      + "z-index: 0;"
      + "}"

      // ▼ 下地（必ず存在）
      // 目的: tuned がOFF/空でも真っ黒に落ちず、最低限の背景を保証
      + "#" + BASE_ID + "{"
      + "position: absolute;"
      + "inset: 0;"
      + "background: linear-gradient(180deg, rgba(18,18,18,1) 0%, rgba(14,14,14,1) 100%);"
      + "}"

      // ▼ 調整レイヤー（adjust の描画先）
      // 目的: 見た目生成は adjust に一本化。ambient はここを邪魔しない
      + "#" + TUNED_ID + "{"
      + "position: absolute;"
      + "inset: 0;"
      + "background: transparent;"
      + "}"

      // ▼ 回転専用 tuned 子要素（adjust が transform を当てる対象）
      // 目的: 回転・平行移動・origin を tuned 本体から分離し、描画の自由度を上げる
      // 注意: 見た目（background 等）は adjust が注入する。ambient は器として配置のみ保証する
      + "#" + TUNED_ROT_ID + "{"
      + "position: absolute;"
      + "top:0px;"
      + "right:0px;"
      + "bottom:0px;"
      + "left:0px;"
      + "background: transparent;"
      + "transform: none;"
      + "transform-origin: 50% 50%;"
      + "}"
      ;

    styleEl.appendChild(document.createTextNode(cssText));
    document.head.appendChild(styleEl);
  }

  function ensureLayer() {
    if (!enabled) return null;
    if (!document || !document.body) return null;

    // ▼ Ambient ON のスコープ付与（ON/OFF管理は ambient のみ）
    // 目的: adjust が BODY_CLASS を触らないルールを守れるようにする
    try {
      document.documentElement.classList.add(BODY_CLASS);
    } catch (_eClass) {
      return null;
    }

    // ▼ テーマ属性は“器の属性”として保持（見た目生成は行わない）
    // 目的: 将来的に必要なら参照できるように、状態だけ残す
    try {
      document.documentElement.setAttribute("data-cscs-ambient-theme", theme);
    } catch (_eTheme) {
    }

    // ▼ 背景レイヤーDOM（layer/base/tuned）を確実に1セットだけ作る
    // 目的: adjust の描画先ID（#cscs-ambient-tuned）を不変に固定する
    var layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = LAYER_ID;

      var base = document.createElement("div");
      base.id = BASE_ID;

      var tuned = document.createElement("div");
      tuned.id = TUNED_ID;

      // ▼ 回転専用の子要素を追加（tuned の子として固定）
      // 目的: adjust 側で rotate/translate/origin をこの要素にだけ適用できるようにする
      var tunedRot = document.createElement("div");
      tunedRot.id = TUNED_ROT_ID;

      tuned.appendChild(tunedRot);

      layer.appendChild(base);
      layer.appendChild(tuned);

      // body 直下に挿入（ただし #root より上に来ないように #root の直後へ）
      // 目的: DOM順で #root より上に ambient layer が出てくるのを防ぐ（見通しの良さ/管理の一貫性）
      var root = document.getElementById("root");
      if (root && root.parentNode === document.body) {
        if (root.nextSibling) document.body.insertBefore(layer, root.nextSibling);
        else document.body.appendChild(layer);
      } else {
        // ▼ #root が無い（または body 直下でない）場合は末尾へ
        // 目的: 先頭へ突っ込んで #root より上に来る事故を避ける
        document.body.appendChild(layer);
      }
    } else {
      // ▼ 既存DOMに tuned-rot が無い場合だけ追加
      // 目的: 既存ページ/キャッシュ状態でも “器” を最新構造に寄せる（勝手なフォールバック生成ではなく、器の正規構造の補完）
      var tunedEl = document.getElementById(TUNED_ID);
      if (tunedEl && !document.getElementById(TUNED_ROT_ID)) {
        var tunedRot2 = document.createElement("div");
        tunedRot2.id = TUNED_ROT_ID;
        tunedEl.appendChild(tunedRot2);
      }

      // ▼ 既に layer が存在する場合でも、#root より上に居たら #root の直後へ移動
      // 目的: 旧挿入位置（firstChild）の残骸があっても、DOM順を常に #root の下に正規化する
      var root2 = document.getElementById("root");
      if (root2 && root2.parentNode === document.body) {
        var layerNow = document.getElementById(LAYER_ID);
        if (layerNow && layerNow.parentNode === document.body) {
          if (root2.nextSibling) document.body.insertBefore(layerNow, root2.nextSibling);
          else document.body.appendChild(layerNow);
        }
      }
    }

    // ▼ OFF→ON 復帰時の表示復元
    // 目的: setEnabled(false) で隠した layer を確実に再表示
    try {
      layer.style.display = "";
    } catch (_eDisplay) {
    }

    return layer;
  }

  function applyTheme() {
    if (!document || !document.body) return;

    // ▼ “器の属性”としてテーマ状態だけを保持
    // 目的: 見た目生成は行わず、状態のみ残す（将来必要なら参照できる）
    try {
      document.documentElement.setAttribute("data-cscs-ambient-theme", theme);
    } catch (_e) {
    }
  }

  function init() {
    // ▼ 安全柵CSS（z-index / pointer-events / レイヤー固定）を注入
    // 目的: 背景DOMがUIのクリックを奪わないことを常に保証
    injectStyleIfNeeded();

    // ▼ 背景レイヤーDOM（layer/base/tuned）を準備
    // 目的: adjust の描画先（#cscs-ambient-tuned）を常に存在させる
    ensureLayer();

    // 補足: 描画（グラデ/楕円/明暗/beam）は adjust 側のみが担当する
  }

  // 公開API
  window.CSCS_AMBIENT_BG = {
    setEnabled: function (v) {
      enabled = !!v;
      if (enabled) {
        // ▼ ON: BODY_CLASS 付与 + 器DOM生成（ambient のみが担当）
        // 目的: adjust が「背景がある前提」で安全にCSS注入できる状態を作る
        ensureLayer();
      } else {
        // ▼ OFF: BODY_CLASS を外し、器DOMを隠す（または撤去）
        // 目的: 背景ON/OFFの責務を ambient に固定し、adjust と完全分離する
        try {
          if (document && document.body) {
            document.documentElement.classList.remove(BODY_CLASS);
            document.documentElement.removeAttribute("data-cscs-ambient-theme");

            var layer = document.getElementById(LAYER_ID);
            if (layer) layer.style.display = "none";
          }
        } catch (_e) {
        }
      }
    },
    setTheme: function (v) {
      // ▼ “器の属性”としてテーマ状態だけ更新
      // 目的: 見た目生成はしない（描画は adjust の責務）
      if (v === "deep" || v === "soft") {
        theme = v;
        applyTheme();
      }
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();