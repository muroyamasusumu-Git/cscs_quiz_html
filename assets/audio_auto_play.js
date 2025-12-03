// assets/a_audio_autoplay.js
(function () {

  // ▼ このスクリプト自身の <script> タグを取得
  //    （data-audio-src 属性を読むため）
  var script = document.currentScript;
  if (!script) return; // 取得できなければ終了

  // ▼ <script data-audio-src="xxx.m4a"> の値を取得
  var src = script.getAttribute("data-audio-src");
  if (!src) return; // 音声ファイル指定がなければ何もしない


  // -------------------------------------------------------------
  //  音声自動再生を試み、失敗した場合は「再生ボタン」を画面に追加する関数
  // -------------------------------------------------------------
  function autoPlayAudio(src) {

    // ▼ Audio オブジェクトを生成
    var audio = new Audio(src);
    audio.preload = "auto";     // 音声を事前ロード
    audio.playsInline = true;   // iOS Safari でインライン再生許可（動画扱い防止）

    // ▼ 自動再生を試みる
    var p = audio.play();

    // ▼ play() の結果が Promise なら catch できる
    if (p && typeof p.catch === "function") {
      p.catch(function () {

        // ▼ 自動再生が失敗した場合のフォールバック処理
        //    → ユーザーの操作を要求するボタンを設置

        var btn = document.createElement("button");
        btn.textContent = "🔊 音声を再生";
        btn.className = "audio-fallback-btn";

        // ▼ ボタンクリックで再生 → 再生成功ならボタン削除
        btn.addEventListener("click", function () {
          audio.play().then(function () {
            btn.remove(); // 成功したらボタンを消す
          }).catch(function () {
            // 再生できない場合（ブラウザの設定など）
            btn.textContent = "再生できません（ブラウザ設定を確認）";
          });
        });

        // ▼ ボタンを画面に追加
        document.body.appendChild(btn);
      });
    }
  }


  // -------------------------------------------------------------
  //  DOM が読み込み済みかどうかで実行タイミングを調整
  // -------------------------------------------------------------

  // ▼ loading = 読み込み中 → DOMContentLoaded 後に再生
  if (document.readyState === "loading") {

    window.addEventListener("DOMContentLoaded", function () {
      autoPlayAudio(src);
    });

  } else {

    // ▼ すでに DOM が構築されている場合は即実行
    autoPlayAudio(src);
  }

})();