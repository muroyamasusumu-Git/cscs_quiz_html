// assets/b_correct_mark.js

(function(){

  // ▼ 1. cscs-meta から正解を取得
  //   <script id="cscs-meta">{"Correct":"A", ...}</script> のような JSON を想定
  function getCorrectFromMeta(){
    try{
      var el = document.getElementById("cscs-meta");
      if (!el) return "";
      // textContent を JSON としてパース
      var meta = JSON.parse(el.textContent || "{}");
      // Correct または correct フィールドから正解を取得
      var c = meta.Correct || meta.correct;
      if (typeof c === "string") return c.trim().toUpperCase();
      return "";
    }catch(_){
      // パースに失敗したら空文字（＝取得失敗）
      return "";
    }
  }

  // ▼ 2. #judge の文章から正解を抽出
  //   例: 「正解: A」「正解：B」「正しいのは C」などをマッチング
  function getCorrectFromJudge(){
    try{
      var j = document.getElementById("judge");
      if (!j) return "";
      var t = (j.textContent || j.innerText || "").trim();
      // [正せ][解い] で「正解 / 正しい」などをざっくりマッチ
      // その後ろに : or ： があって A〜D のいずれかを拾う
      var m = t.match(/[正せ][解い]\s*[:：]?\s*([ABCD])/i);
      return (m && m[1]) ? m[1].toUpperCase() : "";
    }catch(_){
      return "";
    }
  }

  // ▼ 3. .answer の文章から正解を抽出
  //   例: <div class="answer">正解: A<span ...>本文...</span></div>
  function getCorrectFromAnswer(){
    try{
      var a = document.querySelector(".answer");
      if (!a) return "";
      var t = (a.textContent || "").trim();
      var m = t.match(/[正せ][解い]\s*[:：]?\s*([ABCD])/i);
      return (m && m[1]) ? m[1].toUpperCase() : "";
    }catch(_){
      return "";
    }
  }

  // ▼ 4. 実際に選択肢リストに「正解マーク」を付ける処理
  //   corr: "A"〜"D" を想定
  function markOnce(corr){
    // A〜D 以外なら何もしない
    if (!/^[ABCD]$/.test(corr)) return false;

    // 選択肢リストの <ol class="opts"> を取得
    var ol = document.querySelector("ol.opts");
    if (!ol) return false;

    // A〜D → li の順番へのマッピング
    var map = { A: 1, B: 2, C: 3, D: 4 };

    // nth-child で該当の li を取得
    var li = ol.querySelector("li:nth-child(" + map[corr] + ")");
    if (!li) return false;

    // li 自体に is-correct を付与（CSS 側でスタイルする想定）
    li.classList.add("is-correct");

    // さらに中の <a class="opt-link"> があれば、それにもクラスを追加
    var a = li.querySelector("a.opt-link");
    if (a) a.classList.add("is-correct");

    return true;
  }

  // ▼ 5. .answer にズームインのアニメーションを付与するヘルパー
  function applyZoomToAnswer(){
    try{
      var answer = document.querySelector(".answer");
      if (!answer) return;

      // すでにクラスが付いている場合は何もしない（アニメ多重適用防止）
      if (!answer.classList.contains("cscs-answer-zoom-in")) {
        answer.classList.add("cscs-answer-zoom-in");
      }

      // 一度だけスタイルを注入する
      if (!document.getElementById("cscs-answer-zoom-style")) {
        var style = document.createElement("style");
        style.id = "cscs-answer-zoom-style";
        style.type = "text/css";
        style.textContent =
          ".answer.cscs-answer-zoom-in {" +
          "  animation: cscsAnswerZoomIn 0.6s ease-out 0s 1;" +
          "  transform-origin: center center;" +
          "}" +
          "@keyframes cscsAnswerZoomIn {" +
          "  0% { transform: scale(0.6); opacity: 0; }" +
          "  60% { transform: scale(1.2); opacity: 1; }" +
          "  100% { transform: scale(1.0); opacity: 1; }" +
          "}";
        var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
        head.appendChild(style);
      }
    }catch(e){
      // このスクリプト単体では wlog は無いので、必要なら console に出す程度に留める
      try{
        console.warn("[b_correct_mark] applyZoomToAnswer error", e);
      }catch(_){}
    }
  }

  // ▼ 6. 正解取得 → マーク付けを一通り試みる関数
  function tryMark(){
    // まずは meta から
    var corr = getCorrectFromMeta();
    // ダメなら judge から
    if (!corr) corr = getCorrectFromJudge();
    // それでもダメなら .answer から
    if (!corr) corr = getCorrectFromAnswer();  // .answer からも拾う

    // 見つかった正解で markOnce を実行
    var marked = markOnce(corr);

    // Bパートでの正解表示に動きをつけるため、.answer にズームインアニメを適用
    applyZoomToAnswer();

    return marked;
  }

  // ▼ 7. DOM 準備状態に応じて初回実行タイミングを調整
  if (document.readyState === "loading") {
    // 読み込み途中の場合は DOMContentLoaded と load で tryMark を呼ぶ
    document.addEventListener("DOMContentLoaded", tryMark);
    window.addEventListener("load", tryMark);
  } else {
    // すでに DOM 構築済みならすぐ実行し、さらに load 後にも再度実行
    tryMark();
    window.addEventListener("load", tryMark);
  }

  // ▼ 8. setTimeout で何度か後追い実行
  //    非同期で judge や answer が描画されるケースに備えて、
  //    わずかな遅延で何回か tryMark を再実行している
  setTimeout(tryMark, 0);
  setTimeout(tryMark, 50);
  setTimeout(tryMark, 200);

  // ▼ 9. #judge の中身が後から書き換わるケースに備えた監視
  var judge = document.getElementById("judge");
  if (judge && window.MutationObserver) {
    var obs = new MutationObserver(tryMark);
    // 子ノードの追加・削除・テキストの変更すべてで tryMark を呼び直す
    obs.observe(judge, { childList: true, subtree: true, characterData: true });
  }

  // ▼ 10. .answer の中身が後から書き換わるケースに備えた監視
  var ans = document.querySelector(".answer");
  if (ans && window.MutationObserver) {
    var obs2 = new MutationObserver(tryMark);
    obs2.observe(ans, { childList: true, subtree: true, characterData: true });
  }

})();