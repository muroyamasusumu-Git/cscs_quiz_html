(function(){
  function getCorrectFromMeta(){
    try{
      var el = document.getElementById("cscs-meta");
      if (!el) return "";
      var meta = JSON.parse(el.textContent || "{}");
      var c = meta.Correct || meta.correct;
      if (typeof c === "string") return c.trim().toUpperCase();
      return "";
    }catch(_){
      return "";
    }
  }

  function getCorrectFromJudge(){
    try{
      var j = document.getElementById("judge");
      if (!j) return "";
      var t = (j.textContent || j.innerText || "").trim();
      var m = t.match(/[正せ][解い]\s*[:：]?\s*([ABCD])/i);
      return (m && m[1]) ? m[1].toUpperCase() : "";
    }catch(_){
      return "";
    }
  }

  function getCorrectFromAnswer(){
    try{
      // 例: <div class="answer">正解: A<span ...>本文</span></div>
      var a = document.querySelector(".answer");
      if (!a) return "";
      var t = (a.textContent || "").trim();
      var m = t.match(/[正せ][解い]\s*[:：]?\s*([ABCD])/i);
      return (m && m[1]) ? m[1].toUpperCase() : "";
    }catch(_){
      return "";
    }
  }

  function markOnce(corr){
    if (!/^[ABCD]$/.test(corr)) return false;
    var ol = document.querySelector("ol.opts");
    if (!ol) return false;
    var map = { A: 1, B: 2, C: 3, D: 4 };
    var li = ol.querySelector("li:nth-child(" + map[corr] + ")");
    if (!li) return false;
    li.classList.add("is-correct");
    var a = li.querySelector("a.opt-link");
    if (a) a.classList.add("is-correct");
    return true;
  }

  function tryMark(){
    var corr = getCorrectFromMeta();
    if (!corr) corr = getCorrectFromJudge();
    if (!corr) corr = getCorrectFromAnswer();  // .answer からも拾う
    return markOnce(corr);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryMark);
    window.addEventListener("load", tryMark);
  } else {
    tryMark();
    window.addEventListener("load", tryMark);
  }

  setTimeout(tryMark, 0);
  setTimeout(tryMark, 50);
  setTimeout(tryMark, 200);

  // judge/answer の後書き換えに対応
  var judge = document.getElementById("judge");
  if (judge && window.MutationObserver) {
    var obs = new MutationObserver(tryMark);
    obs.observe(judge, { childList: true, subtree: true, characterData: true });
  }

  var ans = document.querySelector(".answer");
  if (ans && window.MutationObserver) {
    var obs2 = new MutationObserver(tryMark);
    obs2.observe(ans, { childList: true, subtree: true, characterData: true });
  }
})();