(function () {
  "use strict";

  if (window.__b_audio_btn_installed) {
    return;
  }
  window.__b_audio_btn_installed = true;

  function getScriptNode() {
    // defer 付きなので currentScript で取れる想定
    if (document.currentScript) {
      return document.currentScript;
    }
    // 念のためフォールバック（src に b_audio_btn.js を含む script を探す）
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var src = s.getAttribute("src") || "";
      if (src.indexOf("b_audio_btn.js") !== -1) {
        return s;
      }
    }
    return null;
  }

  var script = getScriptNode();
  if (!script) {
    return;
  }

  var audioBase = script.getAttribute("data-audio-base") || "";
  var stem = script.getAttribute("data-stem") || "";
  var ext = script.getAttribute("data-ext") || ".m4a";

  var src = audioBase.replace(/\/+$/, "") + "/" + stem + "_b" + ext;
  var audio = new Audio(src);
  audio.preload = "auto";
  audio.playsInline = true;

  function ensureBtn() {
    var btn = document.querySelector(".audio-fallback-btn");
    if (btn) {
      return btn;
    }
    btn = document.createElement("button");
    btn.textContent = "🔊 音声を再生";
    btn.className = "audio-fallback-btn";
    btn.addEventListener("click", function () {
      try {
        audio.currentTime = 0;
        var p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () {
            btn.textContent = "再生できません（ブラウザ設定を確認）";
          });
        }
      } catch (e) {
        btn.textContent = "再生できません（ブラウザ設定を確認）";
      }
    });

    function append() {
      document.body.appendChild(btn);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", append);
    } else {
      append();
    }

    return btn;
  }

  // 常時ボタンを出しておく（自動再生はしない）
  ensureBtn();
})();