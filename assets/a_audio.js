// assets/a_audio.js
// Aパート用の「自動音声再生 + 失敗したときのフォールバックボタン」スクリプト。
// <script src="assets/a_audio.js" data-audio-src="..."> の data-audio-src を見て、
// 画面ロード時に自動再生を試みる。ダメだったら「🔊 音声を再生」ボタンを出す。

(function () {
  // この JS タグ自身（<script>）を取得
  var script = document.currentScript;
  // 何らかの理由で currentScript が取れなければ何もしない
  if (!script) return;

  // <script data-audio-src="..."> から音声ファイルの URL を取り出す
  var src = script.getAttribute("data-audio-src");
  // data-audio-src が設定されていなければ終了
  if (!src) return;

  // 実際に音声を自動再生し、失敗したときはボタンを出す処理
  function autoPlayAudio(src) {
    // HTMLAudioElement を生成し、指定された音声 URL をセット
    var audio = new Audio(src);
    // 事前に読み込みを指示（自動再生の成功率を少しでも上げる）
    audio.preload = "auto";
    // iOS Safari 対策：インライン再生を許可
    audio.playsInline = true;

    // 再生を開始。戻り値は Promise（ブラウザによっては undefined のこともある）
    var p = audio.play();

    // Promise が返ってきて、かつ catch が使える環境のみエラーハンドリングを行う
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        // 自動再生に失敗した場合（ユーザー操作必須など）、フォールバックボタンを表示する

        // 画面下に「🔊 音声を再生」ボタンを作成
        var btn = document.createElement("button");
        btn.textContent = "🔊 音声を再生";
        btn.className = "audio-fallback-btn";

        // ボタンクリックで改めて音声再生を試みる
        btn.addEventListener("click", function () {
          audio.play().then(function () {
            // 再生に成功したらボタンは不要なので削除
            btn.remove();
          }).catch(function () {
            // それでもダメな場合はエラーメッセージに差し替え
            btn.textContent = "再生できません（ブラウザ設定を確認）";
          });
        });

        // ボタンを body 直下に追加（CSS 側で位置を調整する前提）
        document.body.appendChild(btn);
      });
    }
  }

  // =========================
  // DOM の準備状態に応じて autoPlayAudio を呼び分け
  // =========================

  if (document.readyState === "loading") {
    // まだ DOM 構築中なら、DOMContentLoaded 後に音声再生を開始
    window.addEventListener("DOMContentLoaded", function () {
      autoPlayAudio(src);
    });
  } else {
    // すでに DOM 構築済みなら即座に音声再生を試みる
    autoPlayAudio(src);
  }
})();