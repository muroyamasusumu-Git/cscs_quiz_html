// assets/fav_modal.js
(function(){
  "use strict";

  // =========================
  // 現在のURLから「日付(YYYYMMDD)」を取得
  // 例: /_build_cscs_20250926/slides/q013_a.html → "20250926"
  // =========================
  function getDayFromPath(){
    const m=(location.pathname||"").match(/_build_cscs_(\d{8})/);
    return m?m[1]:"unknown";
  }

  // =========================
  // 現在のURLから「問題番号3桁」を取得
  // 例: q013_a.html / q013_b.html → "013"
  // =========================
  function getQNum(){  // "qNNN_a.html" / "qNNN_b.html" → "NNN"
    const m=(location.pathname||"").match(/q(\d{3})_[ab](?:\.html)?$/i);
    return m?m[1]:"000";
  }

  // =========================
  // A/B共通の問題ID qid を生成
  // 形式: "YYYYMMDD-NNN"
  // =========================
  function getQid(){ return getDayFromPath() + "-" + getQNum(); } // A/B共通キー

  // =========================
  // localStorage から現在問題の「お気に入り状態」を読み取る
  // - KEY: "cscs_fav"
  // - 値: "unset" | "understood" | "unanswered" | "none"
  // =========================
  function loadFav(){
    const KEY="cscs_fav";
    let obj={}; 
    try{ 
      obj=JSON.parse(localStorage.getItem(KEY)||"{}"); 
    }catch(_){ 
      obj={}; 
    }
    const cur = obj[getQid()];
    return cur || "unset"; // "unset" | "understood" | "unanswered" | "none"
  }

  // =========================
  // 現在問題の「お気に入り状態」を保存
  // - 文字列表現: cscs_fav
  // - 数値表現:   cscs_fav_map（互換用）
  //   1:理解済 / 2:要復習 / 3:重要高 / 0:未設定
  // =========================
  function saveFav(val){
    const KEY="cscs_fav";
    let obj={}; 
    try{ 
      obj=JSON.parse(localStorage.getItem(KEY)||"{}"); 
    }catch(_){ 
      obj={}; 
    }
    const qid=getQid();
    obj[qid]=val;
    localStorage.setItem(KEY, JSON.stringify(obj));

    // 互換：数値形式（cscs_fav_map）も更新しておく（1:理解済, 2:要復習, 3:重要高, 0/未定義:未設定）
    const MAP_KEY="cscs_fav_map";
    const toNum = (s)=>{
      switch(s){
        case "understood": return 1;
        case "unanswered": return 2; // 要復習
        case "none":       return 3; // 重要高
        default:           return 0; // 未設定
      }
    };
    let legacy={}; 
    try{ 
      legacy=JSON.parse(localStorage.getItem(MAP_KEY)||"{}"); 
    }catch(_){ 
      legacy={}; 
    }
    legacy[getQid()] = toNum(val);
    localStorage.setItem(MAP_KEY, JSON.stringify(legacy));

    // デバッグログ（どのqidが何に設定されたか）
    try{ console.log("⭐ saved fav:", qid, "→", val); }catch(_){}
  }

  // =========================
  // モーダル内のボタン群について
  // 指定された val と一致するボタンに .is-active/aria-pressed=true を付与
  // =========================
  function setActive(root, val){
    root.querySelectorAll(".fav-btn").forEach(btn=>{
      const on = (btn.getAttribute("data-val")===val);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // =========================
  // お気に入りモーダルの DOM を生成（初回のみ）
  // - バックドロップ + ダイアログ本体 + ボタン群
  // - クリックイベントや初期状態もここでセット
  // =========================
  function ensureModal(){
    // すでに作成済みならそのまま返す
    let bd=document.getElementById("fav-backdrop");
    if(bd) return bd;

    // バックドロップ要素を生成
    bd=document.createElement("div");
    bd.className="fav-backdrop"; 
    bd.id="fav-backdrop";

    // モーダル本体のHTMLをまとめて挿入
    bd.innerHTML = [
      '<div class="fav-modal" role="dialog" aria-modal="true" aria-label="お気に入り登録" aria-hidden="true" data-modal-scope="fav">',
        '<div class="fav-title" role="heading" aria-level="3">お気に入りの種別を選択</div>',
        '<div class="fav-row">',
          '<button class="fav-btn" data-val="unset" aria-pressed="false">未設定</button>',
          '<button class="fav-btn" data-val="understood" aria-pressed="false">理解済</button>',
          '<button class="fav-btn" data-val="unanswered" aria-pressed="false">要復習</button>',
          '<button class="fav-btn" data-val="none" aria-pressed="false">重要高</button>',
        '</div>',
        '<a href="#" class="fav-cancel" id="fav-cancel">閉じる</a>',
      '</div>'
    ].join("");
    document.body.appendChild(bd);

    // 初回オープン時の「アクティブボタン」を現在の状態で反映
    const init = loadFav();
    setActive(bd, init);

    // バックドロップの透過部分クリックでモーダルを閉じる
    bd.addEventListener("click", (e)=>{
      if(e.target===bd){ 
        e.preventDefault(); 
        e.stopPropagation(); 
        hide(); 
      }
    });

    // 各「お気に入りボタン」にクリックハンドラを付与
    // 手順:
    //  1) 直前の値を取得
    //  2) 新しい値を取得
    //  3) 見た目更新 + 保存
    //  4) モーダル閉じる
    //  5) 値が変わったときだけ location.reload() で画面をリロード
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
            // setTimeout で次のtickにリロード → モーダル閉じ演出などがチラつきにくくなる
            setTimeout(()=>location.reload(), 0); 
          } catch(_) {}
        }
      });
    });

    // 「閉じる」リンクを押したときの処理
    bd.querySelector("#fav-cancel").addEventListener("click",(e)=>{
      e.preventDefault(); 
      e.stopPropagation(); 
      hide();
    });

    return bd;
  }

  // =========================
  // モーダル表示
  // - ensureModal()でDOMを用意
  // - 最新の状態を反映してから display="flex"
  // =========================
  function show(){
    const bd = ensureModal();
    // 再オープン時に最新値でアクティブを再描画
    setActive(bd, loadFav());
    bd.style.display="flex";
    try{ window.__cscsFavOpen = true; }catch(_){}
  }

  // =========================
  // モーダル非表示
  // - display="none"
  // - グローバルフラグも更新
  // =========================
  function hide(){
    const bd=document.getElementById("fav-backdrop");
    if(bd) bd.style.display="none";
    try{ window.__cscsFavOpen = false; }catch(_){}
  }

  // =========================
  // ページ上のクリックトリガーを仕込む
  // - 代表として h1 と .question 要素をクリックしたらモーダルを出す
  // - ただし aタグのリンク部分や .opt-link をクリックした場合は発火させない
  // =========================
  function hook(){
    // 代表：h1 をクリックターゲットにする。class="question" も保険で拾う
    const targets = [];
    const h1 = document.querySelector("h1");
    if(h1) targets.push(h1);
    document.querySelectorAll(".question").forEach(el=>targets.push(el));

    targets.forEach(el=>{
      // クリック可能であることが分かるようにカーソル変更
      el.style.cursor="pointer";
      el.addEventListener("click",(e)=>{
        // aタグ内部クリック or 選択肢リンク(.opt-link)はスルー
        if (e.target && (e.target.closest("a") || e.target.classList.contains("opt-link"))) return;
        e.preventDefault();
        e.stopPropagation();
        show();
      });
    });
  }

  // =========================
  // DOM構築完了後に hook() を実行して
  // お気に入りモーダルを使えるようにする
  // =========================
  window.addEventListener("DOMContentLoaded", hook);
})();