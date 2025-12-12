// assets/b_wrong_strike_mark.js
// 目的: Bパート（body.mode-b）で「ユーザーが選んだ不正解の選択肢」にだけ取消線を入れる（表示のみ）
// - 集計処理・トークン消費・SYNC には一切関与しない
// - 対象は "ol.opts" の中だけ（他のクリック可能UIには影響させない）
// - marker（A/B/C/D のリスト番号）を巻き込まないため、<li> ではなく「中身（a or .sa-correct-pulse-inner）」に取消線を当てる
// - #cscs-fade-highlight-layer（フェード用クローン）配下には絶対に適用しない

(function () {
  "use strict";

  // ============================================================
  // インストールガード（多重読み込み防止）
  // ============================================================
  if (window.__cscsBWrongStrikeInstalled) return;
  window.__cscsBWrongStrikeInstalled = true;

  // ============================================================
  // 0) Bパートだけ動作させる
  // ============================================================
  try {
    if (!document.body || !document.body.classList || !document.body.classList.contains("mode-b")) {
      return;
    }
  } catch (_eMode) {
    return;
  }

  // ============================================================
  // 1) qid を URL から復元（b_judge.js と同系の組み立て）
  // ============================================================
  var day = null;
  var num3 = null;
  var qid = null;

  try {
    var mDay = (location.pathname.match(/_build_cscs_(\d{8})/) || [])[1];
    var mStem = (location.pathname.match(/(?:^|\/)(q\d{3})_b(?:\.html)?(?:\/)?$/i) || [])[1];
    if (mDay && mStem) {
      day = mDay;
      num3 = String(mStem).slice(1);
      qid = String(day) + "-" + String(num3);
    }
  } catch (_eQid) {
    day = null;
    num3 = null;
    qid = null;
  }

  if (!qid) {
    return;
  }

  // ============================================================
  // 2) CSS を 1回だけ注入（取消線を確実に固定）
  // ============================================================
  var STRIKE_STYLE_ID = "cscs-b-wrong-strike-style";

  function injectStrikeCssOnce() {
    try {
      if (document.getElementById(STRIKE_STYLE_ID)) {
        return;
      }

      var styleEl = document.createElement("style");
      styleEl.id = STRIKE_STYLE_ID;
      styleEl.type = "text/css";

      // - li には線を引かず（marker巻き込み防止）、中身側にだけ線
      // - a と .sa-correct-pulse-inner の両対応
      // - フェード用クローン（#cscs-fade-highlight-layer）内は除外
      var cssText =
        "body.mode-b ol.opts li.cscs-wrong-strike{ text-decoration:none !important; }" +
        "body.mode-b ol.opts li.cscs-wrong-strike .sa-correct-pulse-inner{" +
          "text-decoration-line:line-through !important;" +
          "text-decoration-thickness:2px !important;" +
          "text-decoration-color:currentColor !important;" +
        "}" +
        "body.mode-b ol.opts li.cscs-wrong-strike a{" +
          "text-decoration-line:line-through !important;" +
          "text-decoration-thickness:2px !important;" +
          "text-decoration-color:currentColor !important;" +
        "}" +
        "body.mode-b ol.opts li.cscs-wrong-strike a{" +
          "text-decoration-line:line-through !important;" +
          "text-decoration-thickness:2px !important;" +
          "text-decoration-color:currentColor !important;" +
        "}";

      if (styleEl.styleSheet) {
        styleEl.styleSheet.cssText = cssText;
      } else {
        styleEl.appendChild(document.createTextNode(cssText));
      }
      document.head.appendChild(styleEl);
    } catch (_eCss) {
      // 表示専用なので、CSS注入失敗でも他処理は止めない
    }
  }

  // ============================================================
  // 3) ユーザー選択（choice）を取得（表示専用）
  // - まず localStorage の A→B 選択肢キー（qid単位）を読む
  // - それが無い場合のみ URL の choice= を読む
  // ============================================================
  var Kc = "cscs_from_a:" + String(qid);

  function normChoice(letter) {
    var s = String(letter || "").toUpperCase();
    s = s.replace("Ａ", "A").replace("Ｂ", "B").replace("Ｃ", "C").replace("Ｄ", "D").replace("Ｅ", "E");
    return s;
  }

  function readUserChoiceLetter() {
    // 3-1) localStorage から読む
    try {
      var v = localStorage.getItem(Kc);
      var c = normChoice(v);
      if (/^[A-E]$/.test(c)) {
        return c;
      }
    } catch (_eLs) {
    }

    // 3-2) URL から読む（choice=）
    try {
      var u = new URL(location.href);
      var p = normChoice(u.searchParams.get("choice") || "");
      if (/^[A-E]$/.test(p)) {
        return p;
      }
    } catch (_eUrl) {
    }

    return null;
  }

  // ============================================================
  // 4) 取消線を適用（ol.opts 内の該当 li だけ）
  // - 正解行（li.is-correct）には一切触らない
  // - #cscs-fade-highlight-layer 配下は一切触らない
  // ============================================================
  function isInsideHighlightLayer(node) {
    try {
      if (!node || !node.closest) return false;
      return !!node.closest("#cscs-fade-highlight-layer");
    } catch (_e) {
      return false;
    }
  }

  function getLiByLetter(letter) {
    if (!letter) return null;

    var idx = "ABCDE".indexOf(letter.toUpperCase());
    if (idx < 0) return null;

    try {
      return document.querySelector("body.mode-b ol.opts li:nth-child(" + String(idx + 1) + ")");
    } catch (_e) {
      return null;
    }
  }

  function getTextElementWithinLi(li) {
    if (!li) return null;

    // Bパート結果演出で中身がラップされるケース（.sa-correct-pulse-inner）を優先
    try {
      var inner = li.querySelector(".sa-correct-pulse-inner");
      if (inner && inner.nodeType === 1) {
        return inner;
      }
    } catch (_eInner) {
    }

    // 通常の <a>
    try {
      var a = li.querySelector("a");
      if (a && a.nodeType === 1) {
        return a;
      }
    } catch (_eA) {
    }

    return null;
  }

  function clearExistingStrikes() {
    // 表示専用なので「今ページ内の二重適用」を避けるため、既存クラスを剥がす
    // ※ ol.opts 以外は触らない
    var lis = null;
    try {
      lis = document.querySelectorAll("body.mode-b ol.opts li.cscs-wrong-strike");
    } catch (_eLis) {
      lis = null;
    }
    if (!lis || !lis.length) return;

    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      if (!li || !li.classList) continue;
      try {
        if (isInsideHighlightLayer(li)) {
          continue;
        }
        li.classList.remove("cscs-wrong-strike");
      } catch (_eRm) {
      }
    }
  }

  function applyWrongStrike() {
    injectStrikeCssOnce();

    // 既存を消してから付け直す（画面再構築や動的DOMにも耐える）
    clearExistingStrikes();

    var userChoice = readUserChoiceLetter();
    if (!userChoice) {
      return;
    }

    var li = getLiByLetter(userChoice);
    if (!li) {
      return;
    }

    // 正解行に誤って線を入れない（正解は is-correct を想定）
    try {
      if (li.classList && li.classList.contains("is-correct")) {
        return;
      }
    } catch (_eCorrect) {
    }

    // フェード用ハイライトクローン配下は一切触らない
    if (isInsideHighlightLayer(li)) {
      return;
    }

    // li にクラスを付ける（実際の線は CSS で「中身側」にだけ当たる）
    try {
      if (li.classList) {
        li.classList.add("cscs-wrong-strike");
      } else {
        var cls = li.getAttribute("class") || "";
        if (cls.indexOf("cscs-wrong-strike") === -1) {
          li.setAttribute("class", (cls ? cls + " " : "") + "cscs-wrong-strike");
        }
      }
    } catch (_eClass) {
    }

    // inline でも “中身側” にだけ軽く固定（CSS優先だが、念のため）
    var textEl = getTextElementWithinLi(li);
    if (textEl && textEl.style) {
      try {
        if (typeof textEl.style.setProperty === "function") {
          textEl.style.setProperty("text-decoration-line", "line-through", "important");
          textEl.style.setProperty("text-decoration-thickness", "2px", "important");
          textEl.style.setProperty("text-decoration-color", "currentColor", "important");
        } else {
          textEl.style.textDecoration = "line-through";
        }
      } catch (_eStyle) {
      }
    }
  }

  // ============================================================
  // 5) 起動タイミング
  // - DOMContentLoaded 後に 1回
  // - その後、選択肢DOMが動的に差し替わった場合に備えて MutationObserver で再適用
  // ============================================================
  function setup() {
    applyWrongStrike();

    // MutationObserver が無い環境では初回のみ
    if (!window.MutationObserver) {
      return;
    }

    try {
      // ol.opts の差し替え・再構築だけを監視する（属性監視はしない）
      // - applyWrongStrike() 自身が class/style を触るため、attributes を監視すると自己ループで固まる
      var optsRoot = null;
      try {
        optsRoot = document.querySelector("body.mode-b ol.opts");
      } catch (_eFindOpts) {
        optsRoot = null;
      }
      if (!optsRoot) {
        return;
      }

      var scheduled = false;

      function scheduleApply() {
        // 1フレームに1回だけ再適用（連続変化をまとめる）
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          applyWrongStrike();
        });
      }

      var observer = new MutationObserver(function (mutations) {
        // childList 変化（li追加/差し替え等）のみで再適用
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (!m) continue;
          if (m.type === "childList") {
            scheduleApply();
            return;
          }
        }
      });

      observer.observe(optsRoot, {
        childList: true,
        subtree: true
      });
    } catch (_eObs) {
      // 失敗しても初回適用だけは済んでいるのでOK
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }

  // ============================================================
  // 6) 外部からの手動再適用（デバッグ用）
  // ============================================================
  window.CSCS_B_WRONG_STRIKE = {
    apply: function () {
      applyWrongStrike();
    }
  };
})();