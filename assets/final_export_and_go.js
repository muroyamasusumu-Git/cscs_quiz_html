// assets/final_export_and_go.js
// Bパート最終問題：このスクリプトが読み込まれた B ページから、同日の q001_a へ戻る専用ナビゲーション
// - JSONエクスポート機能は廃止
// - result.html への遷移も廃止
// - 「どの番号が最後か」は HTML 側の <script> 読み込み位置で決める
(function () {
  "use strict";

  // 現在のURLが Bパート(qNNN_b.html) かどうか判定
  // 例: /_build_cscs_20250926/slides/q030_b.html → true
  function isBPage() {
    const path = window.location.pathname || "";
    return /q\d{3}_b(?:\.html)?$/i.test(path);
  }

  // 同じ日の最初の問題（q001_a.html）へ戻る
  function goToFirstQuestion() {
    try {
      // 同一ディレクトリ内での相対パス遷移
      window.location.href = "q001_a.html";
    } catch (e) {
      if (window.console && window.console.warn) {
        window.console.warn("[final_export_and_go] q001_a.html への遷移に失敗:", e);
      }
    }
  }

  // DeepDive 関連のクリックかどうか
  function isDeepDiveClick(target) {
    return !!(target && target.closest && (
      target.closest("#dd-panel") ||
      target.closest(".deep-dive-btn") ||
      target.closest(".dd-btn")
    ));
  }

  // お気に入りモーダル関連のクリックかどうか
  function isFavClick(target) {
    return !!(target && target.closest && (
      target.closest("#fav-backdrop .fav-modal") ||
      target.closest("#fav-backdrop")
    ));
  }

  window.addEventListener("DOMContentLoaded", () => {
    // 念のため「Bパート以外」では何もしない（誤読込対策）
    if (!isBPage()) {
      if (window.console && window.console.log) {
        window.console.log("[final_export_and_go] Bパートではないため何もしません:", window.location.pathname);
      }
      return;
    }

    if (window.console && window.console.log) {
      window.console.log("[final_export_and_go] Bパート最終問題から q001_a への戻り遷移を有効化しました。");
    }

    // ドキュメントのどこでも（リンク/音声ボタン/DeepDive/Fav を除く）クリックで q001_a に戻る
    document.addEventListener("click", (e) => {
      if (e.target.closest(".audio-fallback-btn")) return;
      if (e.target.closest("a")) return;
      if (isDeepDiveClick(e.target)) return;
      if (isFavClick(e.target)) return;

      e.preventDefault();
      goToFirstQuestion();
    });

    // Space / Enter / → キーでも q001_a に戻る
    document.addEventListener("keydown", (e) => {
      if ([" ", "Enter", "ArrowRight"].includes(e.key)) {
        // 入力欄にフォーカスがある場合は邪魔しない
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
          return;
        }

        e.preventDefault();
        goToFirstQuestion();
      }
    });

    // 画面オーバーレイ（next-overlay）がある場合は、そのクリックでも戻る
    const ov = document.querySelector(".next-overlay");
    if (ov) {
      ov.addEventListener("click", (e) => {
        e.preventDefault();
        goToFirstQuestion();
      });
      ov.href = "#";
      ov.style.zIndex = 9999;
      ov.setAttribute("aria-label", "最初の問題へ戻る");
      ov.setAttribute("role", "link");
      ov.setAttribute("tabindex", "0");
    }
  });
})();