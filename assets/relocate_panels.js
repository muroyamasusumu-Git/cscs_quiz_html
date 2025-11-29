(function(){
  function moveIntoWrap(id){
    try{
      var el = document.getElementById(id);
      if (!el) return;
      var wrap = document.querySelector("div.wrap");
      if (!wrap) return;
      if (el.parentNode === wrap) return;
      wrap.appendChild(el);
    }catch(_){}
  }
  function relocateAll(){
    moveIntoWrap("cscs_sync_monitor_a");
    moveIntoWrap("cscs_sync_view_b");
    moveIntoWrap("cc-check-wrapper");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", relocateAll);
  } else {
    relocateAll();
  }
})();