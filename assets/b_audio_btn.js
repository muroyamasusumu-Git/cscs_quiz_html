// assets/b_audio_btn.js
(function () {
  "use strict";

  // ▼ 二重初期化防止フラグ
  //   すでにこのスクリプトが実行済みなら何もしないで終了
  if (window.__b_audio_btn_installed) {
    return;
  }
  window.__b_audio_btn_installed = true;

  // ▼ 自分自身の <script> ノードを取得するヘルパー関数
  function getScriptNode() {
    // defer 付きで読み込まれている想定なので、本来は currentScript で取れる
    if (document.currentScript) {
      return document.currentScript;
    }
    // 念のためのフォールバック：
    // <script src="...b_audio_btn.js"> を総当たりで探す
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var src = s.getAttribute("src") || "";
      if (src.indexOf("b_audio_btn.js") !== -1) {
        return s;
      }
    }
    // 見つからなければ null
    return null;
  }

  // ▼ 対象となる <script> ノードを取得
  var script = getScriptNode();
  if (!script) {
    // 取得できなければ処理をあきらめて終了
    return;
  }

  // ▼ script タグから音声パス構成のための属性を取得
  //   data-audio-base: 音声ファイルのベースURL（ディレクトリ）
  //   data-stem:       qNNN などの共通部分
  //   data-ext:        拡張子（指定なければ .m4a）
  var audioBase = script.getAttribute("data-audio-base") || "";
  var stem = script.getAttribute("data-stem") || "";
  var ext = script.getAttribute("data-ext") || ".m4a";

  // ▼ Bパート用の音声ファイルパスを組み立てる
  //   例: audioBase="/audio/20250926", stem="q013", ext=".m4a"
  //       → "/audio/20250926/q013_b.m4a"
  var src = audioBase.replace(/\/+$/, "") + "/" + stem + "_b" + ext;

  // ▼ Audio オブジェクトを生成し、B音声を事前ロード
  var audio = new Audio(src);
  audio.preload = "auto";
  audio.playsInline = true; // iOS でインライン再生を許可

  // ▼ 再生ボタンを必ず1つだけ用意する関数
  function ensureBtn() {
    // すでに .audio-fallback-btn が存在すればそれを使う
    var btn = document.querySelector(".audio-fallback-btn");
    if (btn) {
      return btn;
    }

    // ▼ ボタン要素を新規作成
    btn = document.createElement("button");
    btn.textContent = "🔊 音声を再生";
    btn.className = "audio-fallback-btn";

    // ▼ ボタンクリック時の挙動
    btn.addEventListener("click", function () {
      try {
        // 再生位置を頭出し
        audio.currentTime = 0;
        // 再生を試みる
        var p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () {
            // ブラウザ側の制限などで再生できない場合のメッセージ
            btn.textContent = "再生できません（ブラウザ設定を確認）";
          });
        }
      } catch (e) {
        // play() 呼び出し自体で例外が出た場合も同様にエラーメッセージ
        btn.textContent = "再生できません（ブラウザ設定を確認）";
      }
    });

    // ▼ ボタンを DOM に追加する処理
    function append() {
      document.body.appendChild(btn);
    }

    // DOM 構築状態に応じて、追加タイミングを切り替え
    if (document.readyState === "loading") {
      // まだ読み込み中なら DOMContentLoaded 後に追加
      document.addEventListener("DOMContentLoaded", append);
    } else {
      // すでに DOM ができているなら即追加
      append();
    }

    return btn;
  }

  // ▼ メイン処理：
  //   Bパートでは自動再生せず、「いつでも押せる音声ボタン」を常時表示しておく。
  ensureBtn();
})();