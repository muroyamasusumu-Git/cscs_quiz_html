// assets/next_nav.js
// 次へ遷移の“保険”スクリプト（Deep Dive / お気に入り / 整合性パネル対応）

(function () {
  "use strict";

  // ==== 次のページへの遷移先取得 ====
  // <script src="assets/next_nav.js" data-next="q005_a.html"></script>
  // の data-next から遷移先を取得する
  var currentScript = document.currentScript;
  var nextHref = null;

  if (currentScript && currentScript.getAttribute("data-next")) {
    nextHref = currentScript.getAttribute("data-next");
  } else {
    // 念のためフォールバック：src に "next_nav.js" を含む <script> を探す
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var src = s.getAttribute("src") || "";
      if (src.indexOf("next_nav.js") !== -1) {
        nextHref = s.getAttribute("data-next");
        currentScript = s;
        break;
      }
    }
  }

  if (!nextHref) {
    // 遷移先が取れない場合は何もしない
    return;
  }

  // ==== Deep Dive 周り ====
  function isDeepDiveOpen() {
    try {
      var p = document.getElementById("dd-panel");
      return !!(p && p.style && p.style.display !== "none");
    } catch (e) {
      return false;
    }
  }

  function clickIsInsideDeepDive(target) {
    if (!target) return false;
    try {
      if (typeof target.closest !== "function") return false;
      if (target.closest("#dd-panel")) return true;
      if (target.closest(".deep-dive-btn")) return true;
      if (target.closest(".dd-btn")) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // ==== お気に入りモーダル周り ====
  function isFavOpen() {
    try {
      var bd = document.getElementById("fav-backdrop");
      if (!bd) return false;
      var st = (window.getComputedStyle ? window.getComputedStyle(bd) : bd.style);
      if (bd.style && bd.style.display === "flex") return true;
      if (st && st.display === "flex") return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function clickIsInsideFav(target) {
    if (!target) return false;
    try {
      if (typeof target.closest !== "function") return false;
      if (target.closest("#fav-backdrop .fav-modal")) return true;
      if (target.closest("#fav-backdrop")) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // ==== 次へ遷移処理 ====
  // - 通常は CSCS_FADE.fadeOutTo を使って「フェードアウト → 遷移」を行う
  // - CSCS_FADE が利用できないページでは、従来どおり即時の location.href で遷移する
  function goNext() {
    // まずはフェードアウト付き遷移を試みる
    try {
      if (window.CSCS_FADE && typeof window.CSCS_FADE.fadeOutTo === "function") {
        // フェードイン／アウト制御用の共通APIを利用して、暗転→次の問題へ
        window.CSCS_FADE.fadeOutTo(nextHref, "next_nav");
        return; // フェード付き遷移を開始したので、ここで終了
      }
    } catch (e) {
      // CSCS_FADE 側で何かエラーが出ても、下のフォールバックで遷移自体は継続させる
    }

    // フェードAPIが使えない場合は、従来どおり即時遷移（保険として維持）
    try {
      window.location.href = nextHref;
    } catch (_e2) {
      // 何もしない（ここで失敗するケースはほぼ無い想定）
    }
  }

  // ==== クリック時の挙動 ====
  document.addEventListener("click", function (e) {
    var target = e.target;

    // 整合性チェックパネル内は遷移しない
    try {
      if (target && typeof target.closest === "function") {
        if (target.closest("#cscs-consistency-panel")) {
          return;
        }
      }
    } catch (errConsistency) {
      // 何もしない
    }

    // Deep Dive 操作中は遷移しない
    if (isDeepDiveOpen() || clickIsInsideDeepDive(target)) {
      return;
    }

    // お気に入りモーダル操作中は遷移しない
    if (isFavOpen() || clickIsInsideFav(target)) {
      return;
    }

    // 音声ボタンは遷移しない
    try {
      if (target && typeof target.closest === "function") {
        if (target.closest(".audio-fallback-btn")) {
          return;
        }
      }
    } catch (errAudio) {
      // 何もしない
    }

    // aタグのクリックは通常通りリンク遷移
    try {
      if (target && typeof target.closest === "function") {
        if (target.closest("a")) {
          return;
        }
      }
    } catch (errLink) {
      // 何もしない
    }

    // 上記どれにも該当しないクリックは「次へ」
    goNext();
  });

  // ==== キーボード操作時の挙動 ====
  document.addEventListener("keydown", function (e) {
    // Deep Dive / お気に入りモーダル表示中はキーボード遷移も抑止
    if (isDeepDiveOpen() || isFavOpen()) {
      return;
    }

    var key = e.key;
    if (key === " " || key === "Enter" || key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  });

  // ==== オーバーレイの前面化とアクセシビリティ付与 ====
  try {
    var ov = document.querySelector(".next-overlay");
    if (ov) {
      ov.style.zIndex = 9999;
      ov.setAttribute("aria-label", "次の問題へ");
      ov.setAttribute("role", "link");
      ov.setAttribute("tabindex", "0");
    }
  } catch (e) {
    // 何もしない
  }
})();