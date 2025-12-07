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
  // SYNC から現在問題の「お気に入り状態」を読み取る（SYNC専用）
  // - 期待構造: syncRoot.fav[qid] = "unset" | "understood" | "unanswered" | "none" | 数値(1〜3)
  // - 見つからない場合やエラー時も "unset" を返す（ローカルには一切フォールバックしない）
  // =========================
  function getFavFromSync(){
    var qid = getQid();
    var val = "unset"; // デフォルトは常に "unset"
    try{
      // SYNCルートから fav セクションを取得
      var root = getSyncRootForFav();
      if (!root || !root.fav || typeof root.fav !== "object") {
        try{
          console.log("fav_modal.js: getFavFromSync → no fav section in SYNC. qid:", qid);
        }catch(_){}
        return val;
      }

      // qid が存在しなければ "unset" のまま返す
      if (!Object.prototype.hasOwnProperty.call(root.fav, qid)) {
        try{
          console.log("fav_modal.js: getFavFromSync → no entry for qid in SYNC. qid:", qid);
        }catch(_){}
        return val;
      }

      var raw = root.fav[qid];

      // 文字列表現はそのまま優先
      if (raw === "unset" || raw === "understood" || raw === "unanswered" || raw === "none") {
        val = raw;
      } else if (typeof raw === "number") {
        // 数値表現(1/2/3)も受け取り、文字列にマッピング
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
      // 例外時もフォールバックは行わず、"unset" を返す
      try{
        console.error("fav_modal.js: getFavFromSync error.", { qid: qid, error: e });
      }catch(_){}
      return val;
    }
  }

  // =========================
  // お気に入り状態を SYNC サーバーへ送信
  // - /api/sync/merge に { fav: { [qid]: val } } 形式でPOST
  // - 戻り値で window.CSCS_SYNC_DATA を更新
  // - fetch の Promise をそのまま返し、呼び出し側で完了後にリロードできるようにする
  // =========================
  function sendFavToSync(val){
    var qid = getQid();
    var payload = { fav: {} };
    payload.fav[qid] = val;

    try{
      console.log("fav_modal.js: sendFavToSync → POST /api/sync/merge", payload);
    }catch(_){}

    try{
      return fetch("/api/sync/merge", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        credentials: "include"
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
            return null;
          }
          try{
            window.CSCS_SYNC_DATA = json;
            var root = getSyncRootForFav();
            var hasFav = !!(root && root.fav && typeof root.fav === "object" && Object.prototype.hasOwnProperty.call(root.fav, qid));
            console.log("fav_modal.js: SYNC fav updated.", { qid: qid, storedInSync: hasFav });
          }catch(_){}
          return json;
        })
        .catch(function(e){
          // ページリロードなどで fetch が中断された場合に出るエラーをここで握りつぶす
          try{
            console.warn("fav_modal.js: SYNC merge fetch error (ignored):", e);
          }catch(_){}
          return null;
        });
    }catch(e){
      try{
        console.error("fav_modal.js: sendFavToSync outer fetch error.", e);
      }catch(_){}
      // 例外時も呼び出し側が then/finally を呼べるように resolved Promise を返す
      return Promise.resolve(null);
    }
  }

  // =========================
  // ローカル(localStorage)から現在問題の「お気に入り状態」を読み取る
  // - 優先: cscs_fav[qid] = "unset" | "understood" | "unanswered" | "none"
  // - 互換: cscs_fav_map[qid] = 1/2/3 → 文字列にマッピング
  // =========================
  function getFavFromLocal(){
    var qid = getQid();
    var KEY = "cscs_fav";
    var MAP_KEY = "cscs_fav_map";
    var val = null;

    // 1) 文字列表現から取得
    try{
      var obj = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, qid)) {
        var raw = obj[qid];
        if (raw === "understood" || raw === "unanswered" || raw === "none" || raw === "unset") {
          val = raw;
        }
      }
    }catch(_){}

    // 2) 数値表現(互換)からの復元
    if (val === null) {
      try{
        var legacy = JSON.parse(localStorage.getItem(MAP_KEY) || "{}");
        if (legacy && typeof legacy === "object" && Object.prototype.hasOwnProperty.call(legacy, qid)) {
          var n = legacy[qid] | 0;
          if (n === 1) {
            val = "understood";
          } else if (n === 2) {
            val = "unanswered";
          } else if (n === 3) {
            val = "none";
          }
        }
      }catch(_){}
    }

    // 3) どちらからも取れなければ "unset"
    if (val === null) {
      val = "unset";
    }

    try{
      console.log("fav_modal.js: getFavFromLocal →", { qid: qid, val: val });
    }catch(_){}

    return val;
  }

  // =========================
  // 現在問題の「お気に入り状態」を読み取る（SYNC専用）
  // - window.CSCS_SYNC_DATA に読み込まれた fav 情報のみを参照する
  // - ローカル(localStorage)へは一切フォールバックしない
  // =========================
  function loadFav(){
    // SYNCに保存されている値をそのまま採用する
    return getFavFromSync();
  }

  // =========================
  // 現在問題の「お気に入り状態」を保存（SYNC専用）
  // - /api/sync/merge に対して fav 情報だけを送信する
  // - localStorage(cscs_fav / cscs_fav_map) は一切更新しない
  // - sendFavToSync の Promise をそのまま返し、呼び出し側で完了待ちできるようにする
  // =========================
  function saveFav(val){
    var qid = getQid();

    try{
      console.log("fav_modal.js: saveFav(SYNC only) → sendFavToSync", { qid: qid, val: val });
    }catch(_){}

    // SYNCサーバーにお気に入り状態を送信し、その Promise を返す
    return sendFavToSync(val);
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
  // ★ SYNC専用: window.CSCS_SYNC_DATA 上の fav を見る（localStorage には依存しない）
  function readFavLabelAndTypeForCurrentQid(){
    var qid = getQid();
    if (!qid) {
      return { qid: "", label: "★ー", type: "unset" };
    }

    var type = "unset";

    try{
      // SYNCから現在の状態を取得
      type = loadFav();
      if (type !== "understood" && type !== "unanswered" && type !== "none" && type !== "unset") {
        type = "unset";
      }

      console.log("fav_modal.js: readFavLabelAndTypeForCurrentQid(SYNC)", {
        qid: qid,
        mappedType: type
      });
    }catch(e){
      // 例外時は "unset" に戻してから返す
      console.error("fav_modal.js: readFavLabelAndTypeForCurrentQid(SYNC) error", {
        qid: qid,
        error: e
      });
      type = "unset";
    }

    // バッジ表示用のラベルへ変換
    var label = favLabelFromStringForBadge(type);
    return { qid: qid, label: label, type: type };
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
    //  3) 見た目更新
    //  4) SYNC 送信（Promise 完了を待つ）
    //  5) モーダルを閉じる
    //  6) 値が変わったときだけ、SYNC 完了後に画面をリロード
    bd.querySelectorAll(".fav-btn").forEach(btn=>{
      btn.addEventListener("click", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();

        const prev = loadFav();                 // 直前の値
        const v = btn.getAttribute("data-val"); // 新しい値

        // 見た目のアクティブ切替
        setActive(bd, v);

        // SYNC 送信の Promise を取得
        var p = saveFav(v);

        // モーダルはすぐ閉じてしまって OK（裏で SYNC が走る）
        hide();

        if (v !== prev) {
          try{
            // Promise があれば完了後にリロード、それ以外は従来どおり次の tick でリロード
            if (p && typeof p.then === "function") {
              p.finally(function(){
                try{
                  location.reload();
                }catch(_){}
              });
            } else {
              setTimeout(function(){
                try{
                  location.reload();
                }catch(_){}
              }, 0);
            }
          }catch(_){}
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
  // DOM構築完了後に SYNC状態を取得してから
  // お気に入りモーダルのトリガーとバッジ描画を行う
  // - /api/sync/state から取得した内容を window.CSCS_SYNC_DATA に反映
  // - 取得に失敗した場合もフォールバックは行わず、"unset" として扱う
  // =========================
  window.addEventListener("DOMContentLoaded", function(){
    try{
      console.log("fav_modal.js: DOMContentLoaded → SYNC mode (fav only).");
    }catch(_){}

    // 1) SYNC状態を取得して window.CSCS_SYNC_DATA を更新
    fetchSyncStateForFav().then(function(){
      // 2) SYNC結果をもとにバッジを描画
      try{
        renderFavBadgeForCurrentQid();
      }catch(_){}

      // 3) クリックトリガーを仕込む（モーダル自体は SYNC が無くても開ける）
      hook();
    });
  });
})();