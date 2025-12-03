// assets/relocate_panels.js
(function(){
  // 指定した id の要素を <div class="wrap"> の直下に移動させるヘルパー
  function moveIntoWrap(id){
    try{
      // 対象要素を id で取得
      var el = document.getElementById(id);
      if (!el) return;  // 見つからなければ何もしない

      // レイアウトの親コンテナとなる .wrap を取得
      var wrap = document.querySelector("div.wrap");
      if (!wrap) return;  // .wrap が無ければ何もしない

      // すでに親が wrap なら移動不要
      if (el.parentNode === wrap) return;

      // まだ別の場所にある場合は、wrap の末尾に append して移動
      wrap.appendChild(el);
    }catch(_){
      // 例外が起きても画面を壊さないように握りつぶす
    }
  }

  // 3種類のパネルをまとめて移動する
  function relocateAll(){
    // A側のSYNCモニタパネル
    moveIntoWrap("cscs_sync_monitor_a");
    // B側のSYNCビュー（HUD）パネル
    moveIntoWrap("cscs_sync_view_b");
    // cc-check 用のラッパー要素
    moveIntoWrap("cc-check-wrapper");
  }

  // DOM構築前なら DOMContentLoaded 後に実行
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", relocateAll);
  } else {
    // すでにDOMができているなら即実行
    relocateAll();
  }
})();