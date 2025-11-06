(function(){
  "use strict";

  function getDayFromPath(){
    const m=(location.pathname||"").match(/_build_cscs_(\d{8})/);
    return m?m[1]:"unknown";
  }
  function getQNum(){  // "qNNN_a.html" / "qNNN_b.html" → "NNN"
    const m=(location.pathname||"").match(/q(\d{3})_[ab](?:\.html)?$/i);
    return m?m[1]:"000";
  }
  function getQid(){ return getDayFromPath() + "-" + getQNum(); } // A/B共通キー

  function loadFav(){
    const KEY="cscs_fav";
    let obj={}; try{ obj=JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(_){ obj={}; }
    const cur = obj[getQid()];
    return cur || "unset"; // "unset" | "understood" | "unanswered" | "none"
  }

  function saveFav(val){
    const KEY="cscs_fav";
    let obj={}; try{ obj=JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(_){ obj={}; }
    const qid=getQid();
    obj[qid]=val;
    localStorage.setItem(KEY, JSON.stringify(obj));

    // 互換：数値形式（cscs_fav_map）も更新しておく（1:理解済, 2:要復習, 3:重要, 0/未定義:未設定）
    const MAP_KEY="cscs_fav_map";
    const toNum = (s)=>{
      switch(s){
        case "understood": return 1;
        case "unanswered": return 2; // 要復習
        case "none":       return 3; // 重要
        default:           return 0; // 未設定
      }
    };
    let legacy={}; try{ legacy=JSON.parse(localStorage.getItem(MAP_KEY)||"{}"); }catch(_){ legacy={}; }
    legacy[getQid()] = toNum(val);
    localStorage.setItem(MAP_KEY, JSON.stringify(legacy));

    try{ console.log("⭐ saved fav:", qid, "→", val); }catch(_){}
  }

  function setActive(root, val){
    root.querySelectorAll(".fav-btn").forEach(btn=>{
      const on = (btn.getAttribute("data-val")===val);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function ensureModal(){
    let bd=document.getElementById("fav-backdrop");
    if(bd) return bd;
    bd=document.createElement("div");
    bd.className="fav-backdrop"; bd.id="fav-backdrop";
    bd.innerHTML = [
      '<div class="fav-modal" role="dialog" aria-modal="true" aria-label="お気に入り登録" aria-hidden="true" data-modal-scope="fav">',
        '<div class="fav-title" role="heading" aria-level="3">お気に入りの種別を選択</div>',
        '<div class="fav-row">',
          '<button class="fav-btn" data-val="unset" aria-pressed="false">未設定</button>',
          '<button class="fav-btn" data-val="understood" aria-pressed="false">理解済</button>',
          '<button class="fav-btn" data-val="unanswered" aria-pressed="false">要復習</button>',
          '<button class="fav-btn" data-val="none" aria-pressed="false">重要</button>',
        '</div>',
        '<a href="#" class="fav-cancel" id="fav-cancel">閉じる</a>',
      '</div>'
    ].join("");
    document.body.appendChild(bd);

    // 初期アクティブ（未設定 or 最後の設定）
    const init = loadFav();
    setActive(bd, init);

    // バックドロップクリックで閉じる
    bd.addEventListener("click", (e)=>{
      if(e.target===bd){ e.preventDefault(); e.stopPropagation(); hide(); }
    });

    // ボタン押下：アクティブ切替→保存→閉じる→（変更時のみ）即リロード
    bd.querySelectorAll(".fav-btn").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault(); 
        ev.stopPropagation();

        const prev = loadFav();                          // 直前の値
        const v = btn.getAttribute("data-val");          // 新しい値

        setActive(bd, v);                                // 見た目のアクティブ切替
        saveFav(v);                                      // 保存（cscs_fav / cscs_fav_map 両対応で更新）
        hide();                                          // いったん閉じる

        if (v !== prev) {                                // 値が変わったときだけリロード
          try { 
            // 直後に走らせる（描画チラつき最小化）
            setTimeout(()=>location.reload(), 0); 
          } catch(_) {}
        }
      });
    });

    // 閉じるリンク
    bd.querySelector("#fav-cancel").addEventListener("click",(e)=>{
      e.preventDefault(); e.stopPropagation(); hide();
    });

    return bd;
  }

  function show(){
    const bd = ensureModal();
    // 再オープン時に最新値でアクティブを再描画
    setActive(bd, loadFav());
    bd.style.display="flex";
    try{ window.__cscsFavOpen = true; }catch(_){}
  }
  function hide(){
    const bd=document.getElementById("fav-backdrop");
    if(bd) bd.style.display="none";
    try{ window.__cscsFavOpen = false; }catch(_){}
  }

  function hook(){
    // 代表：h1 をクリックターゲットにする。class="question" も保険で拾う
    const targets = [];
    const h1 = document.querySelector("h1");
    if(h1) targets.push(h1);
    document.querySelectorAll(".question").forEach(el=>targets.push(el));
    targets.forEach(el=>{
      el.style.cursor="pointer";
      el.addEventListener("click",(e)=>{
        // aタグ内部クリック等はスルー
        if (e.target && (e.target.closest("a") || e.target.classList.contains("opt-link"))) return;
        e.preventDefault();
        e.stopPropagation();
        show();
      });
    });
  }

  window.addEventListener("DOMContentLoaded", hook);
})();