// a_audio.js
(function () {
  var script = document.currentScript;
  if (!script) return;
  var src = script.getAttribute("data-audio-src");
  if (!src) return;

  function autoPlayAudio(src) {
    var audio = new Audio(src);
    audio.preload = "auto";
    audio.playsInline = true;
    var p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        var btn = document.createElement("button");
        btn.textContent = "🔊 音声を再生";
        btn.className = "audio-fallback-btn";
        btn.addEventListener("click", function () {
          audio.play().then(function () {
            btn.remove();
          }).catch(function () {
            btn.textContent = "再生できません（ブラウザ設定を確認）";
          });
        });
        document.body.appendChild(btn);
      });
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", function () {
      autoPlayAudio(src);
    });
  } else {
    autoPlayAudio(src);
  }
})();