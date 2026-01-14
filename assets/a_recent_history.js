// assets/a_recent_history.js
//
// 目的:
//   「直近履歴ウィンドウ（#cscs-auto-next-recent-panel）」を
//   単体JSとして常時表示させる。
//   - a_auto_next.js に依存しない（トグル/生成/描画を一切要求しない）
//   - 自分自身で「現在QIDを履歴に積む」まで含めて完結させる
//
// 注意（設計方針）:
//   - 情報源は localStorage と URL/DOM のみ（/api などは使わない）
//   - a_auto_next.js 側の定義済みキー/IDをそのまま使用する（新規キーを勝手に増やさない）
//   - 見た目は CSS 注入で担保し、inline style は最小にする
//   - リンク遷移は CSCS_FADE / CSCS_NAV_LIST があれば連携し、無ければ通常遷移する
//
(function () {
  "use strict";

  // ============================================================
  // 【演出ON/OFF 共通仕様（演出系JSは全てこの方式で制御）】
  // ------------------------------------------------------------
  // 目的:
  //   演出系JS（fade/scale/ambient/text shadow/slide in 等）を
  //   「テンプレ上では読み込んだまま」でも、実行時に確実に無効化できるようにする。
  //
  // 使い方（最上流フラグ）:
  //   1) window.CSCS_EFFECTS_DISABLED === true
  //      → このファイルは一切動かない（CSS注入/イベント登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/DOM加工を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "a_recent_history"; // ← このJS固有のIDにする
  try {
    if (
      window.CSCS_EFFECTS_DISABLED_MAP &&
      window.CSCS_EFFECTS_DISABLED_MAP[__effectId] === true
    ) {
      __effectsDisabled = true;
    }
  } catch (_eMap) {
  }
  try {
    if (window.CSCS_EFFECTS_DISABLED === true) {
      __effectsDisabled = true;
    } else {
      var v = "";
      try {
        v = String(localStorage.getItem("cscs_effects_disabled") || "");
      } catch (_eLS) {
        v = "";
      }
      if (v === "1") {
        __effectsDisabled = true;
      }
    }
  } catch (_eFlag) {
    // 追加した処理:
    // - ここで false に戻すと直前までの判定を打ち消す可能性があるため、
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }

  // =========================
  // 設定値と localStorage キー（a_auto_next.js と同一）
  // =========================
  var RECENT_QIDS_KEY = "cscs_auto_next_recent_qids";
  var RECENT_QIDS_LIMIT = 30;

  var RECENT_PANEL_ID = "cscs-auto-next-recent-panel";
  var STYLE_ID = "cscs-auto-next-recent-panel-style";

  var LAST_RESULT_KEY_PREFIX = "cscs_q_last_result:";

  // 直近一覧: qid → 問題文冒頭のキャッシュ（ネットワーク負荷を抑える）
  var RECENT_QID_HEAD_CACHE = {};
  var RECENT_QID_HEAD_CHARS = 30;

  // =========================
  // 基本ユーティリティ
  // =========================

  // 追加した処理:
  // - qid を span の id として安全に使うための変換
  function makeSafeDomIdFromQid(qid) {
    return String(qid || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // 追加した処理:
  // - 現在のスライド情報を URL から取り出す（a_auto_next.js と同等）
  function parseSlideInfo() {
    var path = String(location.pathname || "");
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_([ab])(?:\.html)?$/);
    if (!m) {
      return null;
    }
    var day = m[1];
    var num3 = m[2];
    var idx = parseInt(num3, 10);
    var part = m[3];
    if (!idx || idx < 1 || idx > 999) {
      return null;
    }
    return {
      day: day,
      idx: idx,
      part: part
    };
  }

  // 追加した処理:
  // - 現在ページのQID（YYYYMMDD-NNN）を作る
  function getCurrentQid() {
    var info = parseSlideInfo();
    if (!info) {
      return null;
    }
    var num3 = String(info.idx).padStart(3, "0");
    return info.day + "-" + num3;
  }

  // =========================
  // localStorage: 直近QID履歴の読み書き
  // =========================

  // 追加した処理:
  // - 直近履歴を読み込む（配列）
  function loadRecentQids() {
    var list = [];
    try {
      var raw = localStorage.getItem(RECENT_QIDS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed.filter(function (x) {
            return typeof x === "string" && x.length > 0;
          });
        }
      }
    } catch (_e) {
      list = [];
    }
    return list;
  }

  // 追加した処理:
  // - 直近履歴を保存する
  function saveRecentQids(list) {
    try {
      localStorage.setItem(RECENT_QIDS_KEY, JSON.stringify(list));
    } catch (_e) {
      // 保存失敗は致命的ではないので無視
    }
  }

  // 追加した処理:
  // - 現在ページのQIDを直近履歴へ積む（連続重複のみ抑制）
  function pushCurrentQidToRecentHistory() {
    var qid = getCurrentQid();
    if (!qid) {
      return;
    }

    var list = loadRecentQids();
    if (list.length > 0 && list[list.length - 1] === qid) {
      return;
    }

    list.push(qid);
    if (list.length > RECENT_QIDS_LIMIT) {
      list = list.slice(list.length - RECENT_QIDS_LIMIT);
    }
    saveRecentQids(list);
  }

  // =========================
  // 遷移（フェード連携）
  // =========================

  // 追加した処理:
  // - nav_list / CSCS_FADE と連携して遷移する
  function fadeOutAndNavigate(nextUrl) {
    if (!nextUrl) {
      return;
    }
    if (window.CSCS_NAV_LIST && typeof window.CSCS_NAV_LIST.fadeOut === "function") {
      try {
        window.CSCS_NAV_LIST.fadeOut();
      } catch (_e) {}
    }
    if (window.CSCS_FADE && typeof window.CSCS_FADE.fadeOutTo === "function") {
      window.CSCS_FADE.fadeOutTo(nextUrl, "a_recent_history");
    } else {
      location.href = nextUrl;
    }
  }

  // 追加した処理:
  // - HEAD で存在確認してから遷移（a_auto_next.js と同等の保険）
  function goNextIfExists(nextUrl) {
    if (!nextUrl) {
      return;
    }
    try {
      fetch(nextUrl, { method: "HEAD" })
        .then(function (res) {
          if (res && res.ok) {
            fadeOutAndNavigate(nextUrl);
          }
        })
        .catch(function (_err) {
          // 404 やネットワークエラー時は静かに何もしない
        });
    } catch (_e) {
      // fetch が使えない環境では、そのまま遷移
      fadeOutAndNavigate(nextUrl);
    }
  }

  // =========================
  // パネル CSS 注入
  // =========================

  // 追加した処理:
  // - パネル見た目は CSS で固定し、inline の競合を避ける
  function ensureRecentPanelCssInjected() {
    try {
      if (document.getElementById(STYLE_ID)) {
        return;
      }
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.type = "text/css";
      style.textContent =
        "#cscs-auto-next-recent-panel {\n" +
        "    position: fixed !important;\n" +
        "    right: 15px;\n" +
        "    height: 100px;\n" +
        "    bottom: 54px;\n" +
        "    z-index: 10001;\n" +
        "    overflow: auto;\n" +
        "    padding: 10px 12px;\n" +
        "    background: rgba(0, 0, 0, 0.85);\n" +
        "    border: 1px solid rgba(255, 255, 255, 0.25);\n" +
        "    font-size: 12px;\n" +
        "    line-height: 1.6;\n" +
        "    display: block;\n" +
        "    pointer-events: auto;\n" +
        "    left: 71%;\n" +
        "    opacity: 0.3;\n" +
        "    border-radius: 10px;\n" +
        "}\n";
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) {
      // 失敗しても致命的ではないので無視
    }
  }

  // =========================
  // パネル生成
  // =========================

  // 追加した処理:
  // - パネルDOMを必ず作り、常時表示する
  function getOrCreateRecentPanel() {
    var panel = document.getElementById(RECENT_PANEL_ID);
    if (panel) {
      return panel;
    }

    var bodyEl = document.body;
    if (!bodyEl) {
      return null;
    }

    panel = document.createElement("div");
    panel.id = RECENT_PANEL_ID;

    // 追加した処理:
    // - 表示/操作は常時ON（CSSは注入済みを前提）
    panel.style.cssText =
      "display: block;" +
      "pointer-events: auto;";

    bodyEl.appendChild(panel);
    return panel;
  }

  // =========================
  // 表示用：直前結果マーク（○/×/-）
  // =========================

  // 追加した処理:
  // - localStorage に保存されている直前結果（○/×）を読む
  // - 無ければ "-" を返す
  function loadLastResultMark(qid) {
    try {
      if (!qid) {
        return "-";
      }
      var v = localStorage.getItem(LAST_RESULT_KEY_PREFIX + qid);
      if (v === "○" || v === "×") {
        return v;
      }
      return "-";
    } catch (_e) {
      return "-";
    }
  }

  // =========================
  // AパートURL組み立て（qid → /slides/qNNN_a.html）
  // =========================

  // 追加した処理:
  // - 現在のパスから prefix（_build_cscs_ より前）を抽出
  function getPathPrefixForBuild() {
    var path = String(location.pathname || "");
    var m = path.match(/^(.*)_build_cscs_\d{8}\/slides\/q\d{3}_[ab](?:\.html)?$/);
    return m ? m[1] : "";
  }

  // 追加した処理:
  // - qid("YYYYMMDD-NNN") → 해당問題のAパートURLを組み立て
  function buildUrlFromQidToAPart(qid) {
    if (typeof qid !== "string") {
      return null;
    }
    var m = qid.match(/^(\d{8})-(\d{3})$/);
    if (!m) {
      return null;
    }
    var day = m[1];
    var num3 = m[2];
    var prefix = getPathPrefixForBuild();
    return prefix + "_build_cscs_" + day + "/slides/q" + num3 + "_a.html";
  }

  // =========================
  // 問題文冒頭の抽出（AパートHTMLの <h1>）
  // =========================

  // 追加した処理:
  // - 取得した HTML から <h1> の text を抽出し、改行/連続空白を1スペースに正規化する
  function extractQuestionHeadFromHtml(htmlText) {
    try {
      var doc = new DOMParser().parseFromString(String(htmlText || ""), "text/html");
      var h1 = doc ? doc.querySelector("h1") : null;
      if (!h1) {
        return "";
      }
      var tRaw = String(h1.textContent || "");
      var t = tRaw.replace(/\s+/g, " ").trim();
      if (!t) {
        return "";
      }
      return t.slice(0, RECENT_QID_HEAD_CHARS);
    } catch (_e) {
      return "";
    }
  }

  // 追加した処理:
  // - qid の AパートHTML を fetch して、問題文冒頭を返す（取れない場合は空文字）
  function fetchQuestionHeadFromUrl(qid, url) {
    return new Promise(function (resolve) {
      try {
        if (
          RECENT_QID_HEAD_CACHE &&
          Object.prototype.hasOwnProperty.call(RECENT_QID_HEAD_CACHE, qid)
        ) {
          resolve(String(RECENT_QID_HEAD_CACHE[qid] || ""));
          return;
        }

        fetch(url, { cache: "no-store" })
          .then(function (res) {
            if (!res || !res.ok) {
              resolve("");
              return null;
            }
            return res.text();
          })
          .then(function (text) {
            if (typeof text !== "string") {
              resolve("");
              return;
            }
            var head = extractQuestionHeadFromHtml(text);
            RECENT_QID_HEAD_CACHE[qid] = head;
            resolve(head);
          })
          .catch(function (_err) {
            resolve("");
          });
      } catch (_e2) {
        resolve("");
      }
    });
  }

  // 追加した処理:
  // - パネルの各行に、問題文冒頭を非同期で流し込む
  function fillRecentPanelQuestionHeads(panel) {
    try {
      if (!panel) {
        return;
      }

      var links = panel.querySelectorAll("a[data-cscs-recent-qid]");
      if (!links || links.length === 0) {
        return;
      }

      links.forEach(function (a) {
        var qid = a.getAttribute("data-cscs-recent-qid");
        var href = a.getAttribute("href");
        if (!qid || !href) {
          return;
        }

        var safe = makeSafeDomIdFromQid(qid);
        var spanId = "cscs-recent-qhead-" + safe;
        var span = document.getElementById(spanId);
        if (!span) {
          return;
        }

        // 追加した処理:
        // - 既に入っているなら再取得しない（同一ページ内での再描画を軽くする）
        if (span.dataset && span.dataset.cscsFilled === "1") {
          return;
        }

        fetchQuestionHeadFromUrl(qid, href).then(function (head) {
          try {
            if (head) {
              span.textContent = " " + head;
            } else {
              span.textContent = "";
            }
            if (span.dataset) {
              span.dataset.cscsFilled = "1";
            }
          } catch (_e3) {}
        });
      });
    } catch (_e4) {}
  }

  // =========================
  // 描画（常時表示）
  // =========================

  // 追加した処理:
  // - 直近一覧を常時表示として描画する
  // - 現在表示中のQIDは一覧から除外する
  function renderRecentPanel() {
    ensureRecentPanelCssInjected();

    var panel = getOrCreateRecentPanel();
    if (!panel) {
      return;
    }

    var list = loadRecentQids().slice();

    // 追加した処理:
    // - 現在表示中のQIDは履歴パネルから除外する
    try {
      var currentQid = getCurrentQid();
      if (currentQid) {
        list = list.filter(function (qid) {
          return qid !== currentQid;
        });
      }
    } catch (_e) {}

    list.reverse(); // 直近が上

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var qid = list[i];
      var url = buildUrlFromQidToAPart(qid);
      if (!url) {
        continue;
      }

      var safe = makeSafeDomIdFromQid(qid);
      var spanId = "cscs-recent-qhead-" + safe;

      var mark = loadLastResultMark(qid);

      html +=
        '<div style="margin: 2px 0;">' +
        '<a href="' + url + '" data-cscs-recent-qid="' + qid + '" style="display: flex; align-items: center; gap: 6px; width: 100%; color: #fff; text-decoration: none; border-bottom: 1px dotted rgba(255,255,255,0.45); white-space: nowrap;">' +
        '<span style="flex: 0 0 18px; width: 18px; color: rgba(255,255,255,0.9);">' + mark + "</span>" +
        '<span style="flex: 0 0 auto;">' + qid + "</span>" +
        '<span id="' + spanId + '" data-cscs-filled="0" style="flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,0.78);"></span>' +
        "</a>" +
        "</div>";
    }

    if (!html) {
      html = '<div style="color: rgba(255,255,255,0.8);">履歴がありません</div>';
    }

    panel.innerHTML = html;

    // 追加した処理:
    // - パネル内リンクは goNextIfExists で遷移（フェード連携あり）
    panel.querySelectorAll("a[data-cscs-recent-qid]").forEach(function (a) {
      if (a.dataset && a.dataset.cscsRecentBound === "1") {
        return;
      }
      if (a.dataset) {
        a.dataset.cscsRecentBound = "1";
      }

      a.addEventListener("click", function (ev) {
        try {
          ev.preventDefault();
        } catch (_e2) {}
        var href = a.getAttribute("href");
        if (!href) {
          return;
        }
        goNextIfExists(href);
      });
    });

    // 追加した処理:
    // - 各 qid の隣に「問題文冒頭」を非同期で流し込む
    fillRecentPanelQuestionHeads(panel);
  }

  // =========================
  // 自動更新（必要最小）
  // =========================

  // 追加した処理:
  // - 同一ページ内で localStorage が更新されても描画が古いままにならないよう、
  //   storage イベント（主に別タブ/別ウィンドウ更新）で再描画する
  function installStorageListener() {
    try {
      window.addEventListener("storage", function (ev) {
        try {
          if (!ev) {
            return;
          }
          if (ev.key !== RECENT_QIDS_KEY) {
            return;
          }
          renderRecentPanel();
        } catch (_e2) {}
      });
    } catch (_e) {}
  }

  // =========================
  // 初期化
  // =========================

  function onReady() {
    // 追加した処理:
    // - このJS単体で「現在QIDを履歴に積む」まで完結させる
    pushCurrentQidToRecentHistory();

    // 追加した処理:
    // - パネル生成と初回描画（常時表示）
    ensureRecentPanelCssInjected();
    getOrCreateRecentPanel();
    renderRecentPanel();

    // 追加した処理:
    // - 他タブ更新などに追従するための最小リスナー
    installStorageListener();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    onReady();
  } else {
    document.addEventListener("DOMContentLoaded", onReady);
  }
})();