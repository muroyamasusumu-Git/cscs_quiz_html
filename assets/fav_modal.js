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
  // SYNCルートを取得（/api/sync/state の戻り値から data を優先）
  // - 他ファイルと同じく window.CSCS_SYNC_DATA を参照
  // =========================
  function getSyncRootForFav(){
    try{
      if (typeof window === "undefined") return null;
      var raw = window.CSCS_SYNC_DATA;
      if (!raw || typeof raw !== "object") return null;
      if (raw.data && typeof raw.data === "object") {
        return raw.data;
      }
      return raw;
    }catch(_){
      return null;
    }
  }

  // =========================
  // SYNC から現在問題の「お気に入り状態」を読み取る
  // - 期待構造: syncRoot.fav[qid] = "unset" | "understood" | "unanswered" | "none" | 数値(1〜3)
  // - 見つからない場合は null を返す（ローカル側の状態に委ねる）
  // =========================
  function getFavFromSync(){
    var qid = getQid();
    try{
      var root = getSyncRootForFav();
      if (!root || !root.fav || typeof root.fav !== "object") {
        return null;
      }
      if (!Object.prototype.hasOwnProperty.call(root.fav, qid)) {
        return null;
      }
      var raw = root.fav[qid];
      var val = null;

      if (raw === "unset" || raw === "understood" || raw === "unanswered" || raw === "none") {
        val = raw;
      } else if (typeof raw === "number") {
        if (raw === 1) {
          val = "understood";
        } else if (raw === 2) {
          val = "unanswered";
        } else if (raw === 3) {
          val = "none";
        } else {
          val = "unset";
        }
      } else {
        val = "unset";
      }

      try{
        console.log("fav_modal.js: getFavFromSync →", { qid: qid, raw: raw, val: val });
      }catch(_){}

      return val;
    }catch(e){
      try{
        console.error("fav_modal.js: getFavFromSync error.", e);
      }catch(_){}
      return null;
    }
  }

  // =========================
  // お気に入り状態を SYNC サーバーへ送信
  // - /api/sync/merge に { fav: { [qid]: val } } 形式でPOST
  // - 戻り値で window.CSCS_SYNC_DATA を更新
  // =========================
  function sendFavToSync(val){
    var qid = getQid();
    var payload = { fav: {} };
    payload.fav[qid] = val;

    try{
      console.log("fav_modal.js: sendFavToSync → POST /api/sync/merge", payload);
    }catch(_){}

    try{
      fetch("/api/sync/merge", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then(function(res){
          if (!res || !res.ok) {
            try{
              console.error("fav_modal.js: SYNC merge HTTP error.", res && res.status);
            }catch(_){}
            return null;
          }
          return res.json().catch(function(e){
            try{
              console.error("fav_modal.js: SYNC merge JSON parse error.", e);
            }catch(_){}
            return null;
          });
        })
        .then(function(json){
          if (!json || typeof json !== "object") {
            return;
          }
          try{
            window.CSCS_SYNC_DATA = json;
            var root = getSyncRootForFav();
            var hasFav = !!(root && root.fav && typeof root.fav === "object" && Object.prototype.hasOwnProperty.call(root.fav, qid));
            console.log("fav_modal.js: SYNC fav updated.", { qid: qid, storedInSync: hasFav });
          }catch(_){}
        })
        .catch(function(e){
          try{
            console.error("fav_modal.js: SYNC merge fetch error.", e);
          }catch(_){}
        });
    }catch(e){
      try{
        console.error("fav_modal.js: sendFavToSync outer fetch error.", e);
      }catch(_){}
    }
  }

  // =========================
  // SYNC から現在問題の「お気に入り状態」を読み取る
  // - getFavFromSync() の結果のみを採用し、フォールバックは行わない
  // - SYNC に値が無い場合は "unset" 固定
  // =========================
  function loadFav(){
    var fromSync = getFavFromSync();
    if (fromSync === null || fromSync === undefined) {
      return "unset"; // SYNC に未登録 → 未設定扱い
    }
    return fromSync;   // "unset" | "understood" | "unanswered" | "none"
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

    // デバッグログ（どのqidが何に設定されたか、SYNC送信も含めて確認）
    try{ console.log("⭐ saved fav (local):", qid, "→", val); }catch(_){}

    try{
      sendFavToSync(val);
    }catch(_){}
  }

  // =========================
  // topmeta-left 用「表示ユーティリティ」
  // - wrong_badge.js など他スクリプトから再利用する前提
  // - ラベル変換 / DOM生成 / バッジ描画 / グローバル公開をまとめる
  // =========================

  // お気に入り状態（文字列）をバッジ表示用ラベルに変換
  // "understood" → "★１" など、UIに直接出す表記を決める
  function favLabelFromStringForBadge(s){
    switch (String(s || "unset")) {
      case "understood": return "★１";
      case "unanswered": return "★２";
      case "none":       return "★３";
      default:           return "★ー";
    }
  }

  // お気に入り状態（数値）をバッジ表示用ラベルに変換
  // cscs_fav_map の 1/2/3 を "★１/★２/★３" に変換する
  function favLabelFromNumberForBadge(n){
    switch ((n | 0)) {
      case 1: return "★１";
      case 2: return "★２";
      case 3: return "★３";
      default: return "★ー";
    }
  }

  // 現在ページの qid に対する「お気に入り状態」を取得して
  // { qid, label, type } 形式で返すユーティリティ
  // type は "unset" / "understood" / "unanswered" / "none" のいずれか
  function readFavLabelAndTypeForCurrentQid(){
    var qid = getQid();
    if (!qid) {
      return { qid: "", label: "★ー", type: "unset" };
    }

    // 既存の loadFav() を使って、SYNC優先→localStorage から文字列表現を取得
    var val = loadFav(); // "unset" | "understood" | "unanswered" | "none"
    var label = favLabelFromStringForBadge(val);

    return { qid: qid, label: label, type: val };
  }

  // topmeta-left 内に「お気に入りバッジ」を表示するための箱を用意
  // - .topmeta-left が無い場合は生成
  // - その中に .fav-status が無い場合は生成
  function ensureFavStatusBox(){
    var box = document.querySelector(".topmeta-left");
    if (!box) {
      box = document.createElement("div");
      box.className = "topmeta-left";
      var topmeta = document.querySelector(".topmeta");
      if (topmeta) {
        topmeta.appendChild(box);
      } else {
        document.body.appendChild(box);
      }
    }

    var favSpan = box.querySelector(".fav-status");
    if (!favSpan) {
      favSpan = document.createElement("span");
      favSpan.className = "fav-status";
      favSpan.textContent = "［--］";
      box.appendChild(favSpan);
    }

    return { box: box, favSpan: favSpan };
  }

  // 現在ページの qid 用に topmeta-left のお気に入りバッジを描画する
  // - DOM 更新は前回と状態が変わった時だけ行う（ログもそのタイミングのみ）
  function renderFavBadgeForCurrentQid(){
    var info = readFavLabelAndTypeForCurrentQid();
    if (!info.qid) {
      return;
    }

    var holder = ensureFavStatusBox();
    var favSpan = holder.favSpan;
    if (!favSpan) {
      return;
    }

    try{
      if (!window.__cscsLastFavBadge) {
        window.__cscsLastFavBadge = {};
      }
      var last = window.__cscsLastFavBadge[info.qid];

      // 前回と同じ状態なら何もせず終了（無限ログ・無駄なDOM更新を防ぐ）
      if (last && last.label === info.label && last.type === info.type) {
        return;
      }

      // ラベルとクラスを更新
      favSpan.textContent = "［" + info.label + "］";
      favSpan.className   = "fav-status fav-" + info.type;

      window.__cscsLastFavBadge[info.qid] = {
        label: info.label,
        type:  info.type
      };

      console.log("★ fav_modal fav badge updated:", info);
    }catch(_){}
  }

  // 上記ユーティリティをグローバルに公開して、
  // 他ファイルから window.CSCS_FAV.readFavLabelAndType() /
  // window.CSCS_FAV.renderStatusBadge() 経由で呼べるようにする
  try{
    if (!window.CSCS_FAV) {
      window.CSCS_FAV = {};
    }
    window.CSCS_FAV.readFavLabelAndType = readFavLabelAndTypeForCurrentQid;
    window.CSCS_FAV.renderStatusBadge   = renderFavBadgeForCurrentQid;
  }catch(_){}

  // =========================
  // SYNCサーバーから最新状態を取得（お気に入り含む）
  // - /api/sync/state を叩いて window.CSCS_SYNC_DATA を更新
  // - fav セクションが存在するかどうかをログに出す
  // =========================
  function fetchSyncStateForFav(){
    try{
      console.log("fav_modal.js: fetchSyncStateForFav → GET /api/sync/state");
    }catch(_){}
    return fetch("/api/sync/state", { cache: "no-store" })
      .then(function(res){
        if (!res || !res.ok) {
          try{
            console.error("fav_modal.js: SYNC state HTTP error.", res && res.status);
          }catch(_){}
          return null;
        }
        return res.json().catch(function(e){
          try{
            console.error("fav_modal.js: SYNC state JSON parse error.", e);
          }catch(_){}
          return null;
        });
      })
      .then(function(json){
        if (!json || typeof json !== "object") {
          try{
            console.warn("fav_modal.js: SYNC state is not a valid object.");
          }catch(_){}
          return null;
        }
        try{
          window.CSCS_SYNC_DATA = json;
          var root = getSyncRootForFav();
          var hasFav = !!(root && root.fav && typeof root.fav === "object");
          console.log("fav_modal.js: SYNC state stored.", { hasFavFavSection: hasFav });
        }catch(_){}
        return json;
      })
      .catch(function(e){
        try{
          console.error("fav_modal.js: fetchSyncStateForFav error.", e);
        }catch(_){}
        return null;
      });
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
          '<button class="fav-btn" data-val="unset" aria-pressed="false">★ー</button>',
          '<button class="fav-btn" data-val="understood" aria-pressed="false">★１</button>',
          '<button class="fav-btn" data-val="unanswered" aria-pressed="false">★２</button>',
          '<button class="fav-btn" data-val="none" aria-pressed="false">★３</button>',
        '</div>',
        '<a href="#" class="fav-cancel" id="fav-cancel">閉じる</a>',
      '</div>'
    ].join("");
    document.body.appendChild(bd);

    // ボタンのラベルが期待通りに差し替わっているかをデバッグログで確認
    try {
      const labels = Array.prototype.map.call(
        bd.querySelectorAll(".fav-btn"),
        function(btn){ return btn.textContent; }
      );
      console.log("★ fav_modal button labels initialized:", labels);
    } catch(_) {}

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
  // - h1 / .question 要素クリック → モーダル
  // - .fav-status（［★ー］など）もリンク風にし、クリック/Enter/Space でモーダル
  // =========================
  function hook(){
    // 代表ターゲット：h1 / .question
    const targets = [];
    const h1 = document.querySelector("h1");
    if(h1) targets.push(h1);
    document.querySelectorAll(".question").forEach(el=>targets.push(el));

    targets.forEach(el=>{
      el.style.cursor="pointer";
      el.addEventListener("click",(e)=>{
        if (e.target && (e.target.closest("a") || e.target.classList.contains("opt-link"))) return;
        e.preventDefault(); 
        e.stopPropagation();
        show();
      });
    });

    // ★ 追加：.fav-status を「リンク風トリガー」にする
    const favSpans = document.querySelectorAll(".fav-status");
    favSpans.forEach(function(span){
      span.style.cursor = "pointer";
      span.style.textDecoration = "underline";   // ← ★ 下線追加！
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");

      // クリックでモーダル
      span.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();
        console.log("fav_modal.js: fav-status clicked → open modal", {
          text: span.textContent
        });
        show();
      });

      // Enter / Space でモーダル
      span.addEventListener("keydown", function(e){
        if (e.key === "Enter" || e.key === " " || e.keyCode === 13 || e.keyCode === 32) {
          e.preventDefault();
          e.stopPropagation();
          console.log("fav_modal.js: fav-status keydown → open modal", {
            text: span.textContent,
            key: e.key
          });
          show();
        }
      });

      console.log("fav_modal.js: hook fav-status as modal trigger (with underline)", {
        text: span.textContent
      });
    });
  }

  // =========================
  // DOM構築完了後に hook() を実行して
  // お気に入りモーダルを使えるようにする
  // 先に SYNC 状態を取得しておくことで、開いた瞬間から
  // 他端末での更新も反映されたお気に入り状態が使える
  // =========================
  window.addEventListener("DOMContentLoaded", function(){
    fetchSyncStateForFav()
      .then(function(){
        try{
          console.log("fav_modal.js: DOMContentLoaded → hook() after SYNC fetch.");
        }catch(_){}
        hook();
      })
      .catch(function(e){
        try{
          console.error("fav_modal.js: DOMContentLoaded SYNC fetch error (hook anyway).", e);
        }catch(_){}
        hook();
      });
  });
})();