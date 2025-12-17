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

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "cscs_ambient_background"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }

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
      + "}"

      // ▼ body直下の要素は常に背景より前面へ（個別z-index指定を不要にする）
      // 目的: どんなUIが body直下に追加されても ambient より前に出ることを保証する
      // 注意: ambient 自身（#cscs-ambient-layer）は除外する
      + "body > *:not(#" + LAYER_ID + "){"
      + "position: relative;"
      + "z-index: 1;"
      + "}"

      // ▼ .wrap は z-index を持たせず、通常レイヤーとして扱う
      // 目的: UI側の個別調整を減らし、ambient の役割（常に背面）を明確化する
      + ".wrap{"
      + "position: relative;"
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

      // ▼ 星スパークル用レイヤー（ambientの器側）
      + "#cscs-ambient-sparkle-layer{"
      + "position:absolute;"
      + "inset:0;"
      + "pointer-events:none;"
      + "overflow:hidden;"
      + "}"

      // ▼ 1pxの星（ランダム生成して一瞬だけ光る）
      + ".cscs-ambient-star{"
      + "position:absolute;"
      + "width:1px;"
      + "height:1px;"
      + "border-radius:999px;"
      + "opacity:0;"
      + "will-change: transform, opacity;"
      + "filter: drop-shadow(0 0 2px rgba(255,255,255,0.35));"
      + "}"

      + "@keyframes cscsAmbientStarTwinkle{"
      + "0%{opacity:0;transform:scale(1);}"
      + "35%{opacity:1;transform:scale(1.8);}"
      + "100%{opacity:0;transform:scale(1);}"
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

      // ▼ 星スパークル用レイヤー（ambient側の“器”）
      // 目的: adjust の描画先（tuned）を汚さず、ambient が管理する軽量演出の置き場を確保
      var sparkleLayer = document.createElement("div");
      sparkleLayer.id = "cscs-ambient-sparkle-layer";
      layer.appendChild(sparkleLayer);

      // body の閉じタグ直前に挿入
      // 目的: DOM順で常に UI（#root 等）より後ろに配置し、
      //       z-index 管理とスタッキングコンテキストを単純化する
      document.body.appendChild(layer);
    } else {
      // ▼ 既存DOMに tuned-rot が無い場合だけ追加
      // 目的: 既存ページ/キャッシュ状態でも “器” を最新構造に寄せる（勝手なフォールバック生成ではなく、器の正規構造の補完）
      var tunedEl = document.getElementById(TUNED_ID);
      if (tunedEl && !document.getElementById(TUNED_ROT_ID)) {
        var tunedRot2 = document.createElement("div");
        tunedRot2.id = TUNED_ROT_ID;
        tunedEl.appendChild(tunedRot2);
      }

      // ▼ 星スパークル用レイヤーが無い場合だけ追加
      // 目的: 既存DOMでも ambient の“器”としての正規構造を満たす
      if (!document.getElementById("cscs-ambient-sparkle-layer")) {
        var layerForSparkle = document.getElementById(LAYER_ID);
        if (layerForSparkle) {
          var sparkleLayer2 = document.createElement("div");
          sparkleLayer2.id = "cscs-ambient-sparkle-layer";
          layerForSparkle.appendChild(sparkleLayer2);
        }
      }

      // ▼ 既に layer が存在する場合でも、必ず body の末尾へ移動
      // 目的: 旧ロジック（firstChild / root直後）の残骸を完全に排除し、
      //       DOM順を「UI → ambient」の一方向に固定する
      var layerNow = document.getElementById(LAYER_ID);
      if (layerNow && layerNow.parentNode === document.body) {
        document.body.appendChild(layerNow);
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

    // ▼ たまに1pxの小さい星が上の方でキラッと光る（ランダム位置・ランダム間隔）
    // 目的: UIを邪魔せず、背景に“生体反応”っぽい微細な気配を足す
    (function startAmbientStarTwinkleLoop(){
      var timerId = 0;

      function rand(min, max){
        return min + Math.random() * (max - min);
      }

      function scheduleNext(){
        // だいたい 0.9〜3.6秒に1回（ランダム）
        var wait = Math.floor(rand(900, 3600));
        timerId = window.setTimeout(fireOnce, wait);
      }

      function fireOnce(){
        // enabled が false の時は何もしない（次も予約しない）
        if (!enabled) return;

        var layer = document.getElementById(LAYER_ID);
        if (!layer) {
          scheduleNext();
          return;
        }
        try {
          if (String(layer.style.display || "") === "none") {
            scheduleNext();
            return;
          }
        } catch (_eDisp) {
        }

        var sparkleHost = document.getElementById("cscs-ambient-sparkle-layer");
        if (!sparkleHost) {
          scheduleNext();
          return;
        }

        function canSparkleNow(){
          if (!enabled) return false;

          var layer2 = document.getElementById(LAYER_ID);
          if (!layer2) return false;

          try {
            if (String(layer2.style.display || "") === "none") return false;
          } catch (_eDisp2) {
          }

          var host2 = document.getElementById("cscs-ambient-sparkle-layer");
          if (!host2) return false;

          return true;
        }

        function spawnOneStar(){
          var sparkleHost2 = document.getElementById("cscs-ambient-sparkle-layer");
          if (!sparkleHost2) return;

          // 星を1個生成
          var star = document.createElement("div");
          star.className = "cscs-ambient-star";

          // 上の方だけ：上部に寄せる（2〜18vh）
          var topVh = rand(2, 18);

          // 横は全面：0〜100vw 相当（%でOK）
          var leftPct = rand(0, 100);

          // ほんのり白（テーマには依存させず、最小限の粒子として固定）
          star.style.left = String(leftPct) + "%";
          star.style.top = String(topVh) + "vh";
          star.style.background = "rgba(255,255,255,0.9)";

          // 点滅時間も少しランダム（0.35〜0.9s）
          var dur = rand(0.35, 0.9);
          star.style.animation = "cscsAmbientStarTwinkle " + String(dur) + "s ease-out 0s 1";

          sparkleHost2.appendChild(star);

          // 終わったら消す（DOM肥大防止）
          window.setTimeout(function(){
            try {
              if (star && star.parentNode) {
                star.parentNode.removeChild(star);
              }
            } catch (_eRm) {
            }
          }, Math.ceil(dur * 1000) + 50);
        }

        // 1個目（即時）
        if (canSparkleNow()) {
          spawnOneStar();
        }

        // 2個目（時間差＋別場所）: 120〜520ms 遅らせる
        var delay2 = Math.floor(rand(120, 520));
        window.setTimeout(function(){
          if (canSparkleNow()) {
            spawnOneStar();
          }
        }, delay2);

        // 3個目（さらに時間差＋別場所）: 260〜980ms 遅らせる（2個目より後に来やすい）
        var delay3 = Math.floor(rand(260, 980));
        window.setTimeout(function(){
          if (canSparkleNow()) {
            spawnOneStar();
          }
          scheduleNext();
        }, delay3);
      }

      // 起動（多重起動防止）
      if (window.__cscsAmbientStarTwinkleInstalled) return;
      window.__cscsAmbientStarTwinkleInstalled = true;

      scheduleNext();
    })();

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