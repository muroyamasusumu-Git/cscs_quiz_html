// assets/cscs_sync_view_b.js
(function () {
  "use strict";

  var SYNC_STATE_ENDPOINT = "/api/sync/state";
  var SYNC_MERGE_ENDPOINT = "/api/sync/merge";

  function detectInfo() {
    var path = window.location.pathname || "";
    var m = path.match(/_build_cscs_(\d{8})\/slides\/q(\d{3})_b(?:\.html)?$/);
    if (!m) return null;
    var day = m[1];
    var num3 = m[2];
    var qid = day + "-" + num3;
    return { day: day, num3: num3, qid: qid };
  }

  var info = detectInfo();
  if (!info) {
    return;
  }

  function readIntFromLocalStorage(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        return 0;
      }
      var n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        return 0;
      }
      return n;
    } catch (e) {
      console.error("[SYNC-B:view] failed to read int from localStorage:", key, e);
      return 0;
    }
  }

  function updateSyncBody(text) {
    var body = document.getElementById("cscs_sync_view_b_body");
    if (!body) {
      return;
    }

    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }

    var lines = String(text).split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) {
        continue;
      }
      var lineDiv = document.createElement("div");
      lineDiv.textContent = line;
      body.appendChild(lineDiv);
    }
  }

  function fetchState() {
    return fetch(SYNC_STATE_ENDPOINT, { method: "GET" }).then(function (res) {
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return res.json();
    });
  }

  function createPanel() {
    var box = document.createElement("div");
    box.id = "cscs_sync_view_b";

    var title = document.createElement("div");
    title.id = "cscs_sync_view_b_title";
    title.textContent = "SYNC(B): " + info.qid;

    var body = document.createElement("div");
    body.id = "cscs_sync_view_b_body";
    body.textContent = "読み込み中…";

    var statusDiv = document.createElement("div");
    statusDiv.id = "cscs_sync_view_b_status";

    var btn = document.createElement("button");
    btn.id = "cscs_sync_view_b_send_btn";
    btn.type = "button";
    btn.textContent = "SYNC送信";

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(statusDiv);
    box.appendChild(btn);
    return box;
  }

  function renderPanel(box, payload) {
    try {
      var serverCorrect = payload.serverCorrect || 0;
      var serverWrong = payload.serverWrong || 0;
      var localCorrect = payload.localCorrect || 0;
      var localWrong = payload.localWrong || 0;
      var diffCorrect = payload.diffCorrect || 0;
      var diffWrong = payload.diffWrong || 0;

      var serverStreak3 = payload.serverStreak3 || 0;
      var localStreak3 = payload.localStreak3 || 0;
      var diffStreak3 = payload.diffStreak3 || 0;

      var serverStreakLen = payload.serverStreakLen || 0;
      var localStreakLen = payload.localStreakLen || 0;
      var diffStreakLen = payload.diffStreakLen || 0;

      var statusText = payload.statusText || "";

      var serverProgress = serverStreakLen % 3;
      var localProgress = localStreakLen % 3;

      var text = "";
      text += "server " + serverCorrect + " / " + serverWrong + "\n";
      text += "local  " + localCorrect + " / " + localWrong + "\n";
      text += "diff   " + diffCorrect + " / " + diffWrong + "\n";
      text += "s3     " + serverStreak3 + " / " + localStreak3 + " (+" + diffStreak3 + ")\n";
      text += "sLen   " + serverStreakLen + " / " + localStreakLen + " (+" + diffStreakLen + ")\n";
      text += "3連続正解回数 (進捗):\n";
      text += "SYNC " + serverStreak3 + " (" + serverProgress + "/3) / local " + localStreak3 + " (" + localProgress + "/3)\n";

      var s3TodaySyncDay = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.day) 
        ? window.__cscs_sync_state.streak3Today.day : "-";
      var s3TodaySyncCnt = (window.__cscs_sync_state && window.__cscs_sync_state.streak3Today && window.__cscs_sync_state.streak3Today.unique_count) 
        ? window.__cscs_sync_state.streak3Today.unique_count : 0;

      var localS3TodayDay = "";
      var localS3TodayCnt = 0;
      try {
        localS3TodayDay = localStorage.getItem("cscs_streak3_today_day") || "-";
        var rawLocalCnt = localStorage.getItem("cscs_streak3_today_unique_count");
        var parsedLocalCnt = rawLocalCnt == null ? NaN : parseInt(rawLocalCnt, 10);
        if (Number.isFinite(parsedLocalCnt) && parsedLocalCnt >= 0) {
          localS3TodayCnt = parsedLocalCnt;
        }
      } catch(_e) {}

      text += "\n今日の 3連続正解ユニーク数:\n";
      text += "day: " + s3TodaySyncDay + "\n";
      text += "unique: sync " + s3TodaySyncCnt + " / local " + localS3TodayCnt;

      updateSyncBody(text);

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        if (statusText) {
          statusDiv.textContent = "status: " + statusText;
        } else {
          statusDiv.textContent = "";
        }
      }
    } catch (e) {
      var errorText = "SYNC(B) " + info.qid + "  error: " + (e && e.message ? e.message : e);
      updateSyncBody(errorText);

      var statusDiv = document.getElementById("cscs_sync_view_b_status");
      if (statusDiv) {
        statusDiv.textContent = "status: error";
      }
    }
  }

  async function sendDiffToServer(box, params) {
    var qid = info.qid;
    var diffCorrect = params.diffCorrect;
    var diffWrong = params.diffWrong;
    var diffStreak3 = params.diffStreak3 || 0;
    var diffStreakLen = params.diffStreakLen || 0;

    var localCorrect = params.localCorrect;
    var localWrong = params.localWrong;
    var localStreak3 = params.localStreak3 || 0;
    var localStreakLen = params.localStreakLen || 0;

    var serverCorrect = params.serverCorrect;
    var serverWrong = params.serverWrong;
    var serverStreak3 = params.serverStreak3 || 0;
    var serverStreakLen = params.serverStreakLen || 0;

    // 差分が無いときは「そもそも送っていない」ことが分かるようにする
    if (diffCorrect <= 0 && diffWrong <= 0 && diffStreak3 <= 0 && localStreakLen === serverStreakLen) {
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "no diff (送信なし)"
      });
      return;
    }

    // オフラインで送れていないケース
    if (!navigator.onLine) {
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "offline (未送信)"
      });
      return;
    }

    var correctDeltaObj = {};
    var incorrectDeltaObj = {};
    var streak3DeltaObj = {};
    var streakLenDeltaObj = {};
    if (diffCorrect > 0) {
      correctDeltaObj[qid] = diffCorrect;
    }
    if (diffWrong > 0) {
      incorrectDeltaObj[qid] = diffWrong;
    }
    if (diffStreak3 > 0) {
      streak3DeltaObj[qid] = diffStreak3;
    }
    streakLenDeltaObj[qid] = localStreakLen;

    var payload = {
      correctDelta: correctDeltaObj,
      incorrectDelta: incorrectDeltaObj,
      streak3Delta: streak3DeltaObj,
      streakLenDelta: streakLenDeltaObj,
      updatedAt: Date.now()
    };

    console.log("[SYNC-B] sending diff payload:", payload);

    try {
      var response = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // サーバーまで届かなかった／保存に失敗した可能性
      if (!response.ok) {
        console.error("[SYNC-B] server returned non-ok status:", response.status);
        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: "merge " + String(response.status) + " (サーバー保存エラーの可能性)"
        });
        return;
      }

      var data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      console.log("[SYNC-B] sync success:", data);

      // merge のレスポンスから「サーバーに保存された値」を拾う
      var newServerCorrect = serverCorrect;
      var newServerWrong = serverWrong;
      var newServerStreak3 = serverStreak3;
      var newServerStreakLen = serverStreakLen;

      if (data && data.correct && typeof data.correct === "object" && data.correct !== null) {
        if (Object.prototype.hasOwnProperty.call(data.correct, qid)) {
          var cVal = data.correct[qid];
          if (typeof cVal === "number" && Number.isFinite(cVal) && cVal >= 0) {
            newServerCorrect = cVal;
          }
        }
      }

      if (data && data.incorrect && typeof data.incorrect === "object" && data.incorrect !== null) {
        if (Object.prototype.hasOwnProperty.call(data.incorrect, qid)) {
          var wVal = data.incorrect[qid];
          if (typeof wVal === "number" && Number.isFinite(wVal) && wVal >= 0) {
            newServerWrong = wVal;
          }
        }
      }

      if (data && data.streak3 && typeof data.streak3 === "object" && data.streak3 !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streak3, qid)) {
          var sVal = data.streak3[qid];
          if (typeof sVal === "number" && Number.isFinite(sVal) && sVal >= 0) {
            newServerStreak3 = sVal;
          }
        }
      }

      if (data && data.streakLen && typeof data.streakLen === "object" && data.streakLen !== null) {
        if (Object.prototype.hasOwnProperty.call(data.streakLen, qid)) {
          var slVal = data.streakLen[qid];
          if (typeof slVal === "number" && Number.isFinite(slVal) && slVal >= 0) {
            newServerStreakLen = slVal;
          }
        }
      }

      var newDiffCorrect = Math.max(0, localCorrect - newServerCorrect);
      var newDiffWrong = Math.max(0, localWrong - newServerWrong);
      var newDiffStreak3 = Math.max(0, localStreak3 - newServerStreak3);
      var newDiffStreakLen = Math.max(0, localStreakLen - newServerStreakLen);

      // ★ merge 成功後に /api/sync/state を再取得して、
      //    「保存されたか」「state に反映されたか」を diff ベースで確認する
      try {
        var stateAfter = await fetchState();
        try {
          window.__cscs_sync_state = stateAfter;
        } catch (_e2) {}

        var refreshedServerCorrect = newServerCorrect;
        var refreshedServerWrong = newServerWrong;
        var refreshedServerStreak3 = newServerStreak3;
        var refreshedServerStreakLen = newServerStreakLen;

        if (stateAfter && stateAfter.correct && stateAfter.correct[qid] != null) {
          refreshedServerCorrect = stateAfter.correct[qid];
        }
        if (stateAfter && stateAfter.incorrect && stateAfter.incorrect[qid] != null) {
          refreshedServerWrong = stateAfter.incorrect[qid];
        }
        if (stateAfter && stateAfter.streak3 && stateAfter.streak3[qid] != null) {
          refreshedServerStreak3 = stateAfter.streak3[qid];
        }
        if (stateAfter && stateAfter.streakLen && stateAfter.streakLen[qid] != null) {
          refreshedServerStreakLen = stateAfter.streakLen[qid];
        }

        var refreshedDiffCorrect = Math.max(0, localCorrect - refreshedServerCorrect);
        var refreshedDiffWrong = Math.max(0, localWrong - refreshedServerWrong);
        var refreshedDiffStreak3 = Math.max(0, localStreak3 - refreshedServerStreak3);
        var refreshedDiffStreakLen = Math.max(0, localStreakLen - refreshedServerStreakLen);

        var statusMsg = "merge ok / state synced (保存・反映完了)";
        if (
          refreshedDiffCorrect > 0 ||
          refreshedDiffWrong > 0 ||
          refreshedDiffStreak3 > 0 ||
          refreshedDiffStreakLen > 0
        ) {
          // サーバー保存までは成功しているが、state の値が追いついていない／何らかの理由で差分が残っている
          statusMsg = "merge ok / state に未反映の差分あり";
        }

        renderPanel(box, {
          serverCorrect: refreshedServerCorrect,
          serverWrong: refreshedServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: refreshedDiffCorrect,
          diffWrong: refreshedDiffWrong,
          serverStreak3: refreshedServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: refreshedDiffStreak3,
          serverStreakLen: refreshedServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: refreshedDiffStreakLen,
          statusText: statusMsg
        });
      } catch (e2) {
        console.error("[SYNC-B] state refresh error after merge:", e2);

        // 保存は成功しているが、state の再取得に失敗したケース
        renderPanel(box, {
          serverCorrect: newServerCorrect,
          serverWrong: newServerWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: newDiffCorrect,
          diffWrong: newDiffWrong,
          serverStreak3: newServerStreak3,
          localStreak3: localStreak3,
          diffStreak3: newDiffStreak3,
          serverStreakLen: newServerStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: newDiffStreakLen,
          statusText: "merge ok / state 再取得エラー(保存は成功している可能性)"
        });
      }
    } catch (e) {
      console.error("[SYNC-B] fetch failed:", e);
      // ネットワークレベルで送信に失敗したケース
      renderPanel(box, {
        serverCorrect: serverCorrect,
        serverWrong: serverWrong,
        localCorrect: localCorrect,
        localWrong: localWrong,
        diffCorrect: diffCorrect,
        diffWrong: diffWrong,
        serverStreak3: serverStreak3,
        localStreak3: localStreak3,
        diffStreak3: diffStreak3,
        serverStreakLen: serverStreakLen,
        localStreakLen: localStreakLen,
        diffStreakLen: diffStreakLen,
        statusText: "network error (送信失敗)"
      });
    }
  }

  function refreshAndSend(box) {
    fetchState()
      .then(function (state) {
        // ★ /api/sync/state の結果をグローバルへ保存して、
        //    renderPanel から streak3Today を正しく取得できるようにする
        try {
          window.__cscs_sync_state = state;
        } catch (_e) {}

        var serverCorrect = 0;
        var serverWrong = 0;
        var serverStreak3 = 0;
        var serverStreakLen = 0;

        if (state && state.correct && state.correct[info.qid] != null) {
          serverCorrect = state.correct[info.qid];
        }
        if (state && state.incorrect && state.incorrect[info.qid] != null) {
          serverWrong = state.incorrect[info.qid];
        }
        if (state && state.streak3 && state.streak3[info.qid] != null) {
          serverStreak3 = state.streak3[info.qid];
        }
        if (state && state.streakLen && state.streakLen[info.qid] != null) {
          serverStreakLen = state.streakLen[info.qid];
        }

        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);

        var diffCorrect = Math.max(0, localCorrect - serverCorrect);
        var diffWrong = Math.max(0, localWrong - serverWrong);
        var diffStreak3 = Math.max(0, localStreak3 - serverStreak3);
        var diffStreakLen = Math.max(0, localStreakLen - serverStreakLen);

        renderPanel(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          serverStreak3: serverStreak3,
          localStreak3: localStreak3,
          diffStreak3: diffStreak3,
          serverStreakLen: serverStreakLen,
          localStreakLen: localStreakLen,
          diffStreakLen: diffStreakLen,
          statusText: "state ok"
        });

        return sendDiffToServer(box, {
          serverCorrect: serverCorrect,
          serverWrong: serverWrong,
          serverStreak3: serverStreak3,
          serverStreakLen: serverStreakLen,
          localCorrect: localCorrect,
          localWrong: localWrong,
          localStreak3: localStreak3,
          localStreakLen: localStreakLen,
          diffCorrect: diffCorrect,
          diffWrong: diffWrong,
          diffStreak3: diffStreak3,
          diffStreakLen: diffStreakLen
        });
      })
      .catch(function (e) {
        console.error("[SYNC-B] state fetch error:", e);
        var localCorrect = readIntFromLocalStorage("cscs_q_correct_total:" + info.qid);
        var localWrong = readIntFromLocalStorage("cscs_q_wrong_total:" + info.qid);
        var localStreak3 = readIntFromLocalStorage("cscs_q_correct_streak3_total:" + info.qid);
        var localStreakLen = readIntFromLocalStorage("cscs_q_correct_streak_len:" + info.qid);

        renderPanel(box, {
          serverCorrect: 0,
          serverWrong: 0,
          localCorrect: localCorrect,
          localWrong: localWrong,
          diffCorrect: 0,
          diffWrong: 0,
          serverStreak3: 0,
          localStreak3: localStreak3,
          diffStreak3: 0,
          serverStreakLen: 0,
          localStreakLen: localStreakLen,
          diffStreakLen: 0,
          statusText: "state error"
        });
      });
  }

  function init() {
    var box = createPanel();

    function append() {
      var wrap = document.querySelector("div.wrap");
      if (wrap) {
        if (!wrap.contains(box)) {
          wrap.appendChild(box);
        }
      } else {
        if (!document.body.contains(box)) {
          document.body.appendChild(box);
        }
      }
      var btn = document.getElementById("cscs_sync_view_b_send_btn");
      if (btn) {
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          refreshAndSend(box);
        });
      }
      refreshAndSend(box);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", append);
    } else {
      append();
    }
  }

  if (typeof window.CSCS_SYNC === "undefined" || window.CSCS_SYNC === null) {
    window.CSCS_SYNC = {};
  }

  window.CSCS_SYNC.recordStreak3TodayUnique = async function () {
    try {
      // 1) オフラインならそもそも送信しない（Bパートからの streak3TodayDelta は「オンライン時だけ」）
      if (!navigator.onLine) {
        console.warn("[SYNC-B:streak3Today] offline → 送信スキップ");
        return;
      }

      // 2) localStorage に溜まっている「今日の⭐️情報」を読み出すための一時変数
      var day = "";
      var qids = [];
      var localCount = 0;

      try {
        // 2-1) 「今日が何日か」を表す文字列（例: "20251201"）
        day = localStorage.getItem("cscs_streak3_today_day") || "";
        // 2-2) 今日⭐️を新規獲得した qid の配列をシリアライズした文字列
        var rawQids = localStorage.getItem("cscs_streak3_today_qids");
        // 2-3) 今日の⭐️ユニーク数（local 側カウンタ）
        var rawCnt = localStorage.getItem("cscs_streak3_today_unique_count");

        // 2-4) qids の JSON をパースして「妥当な文字列だけ」の配列にクリーンアップ
        if (rawQids) {
          var parsed = JSON.parse(rawQids);
          if (Array.isArray(parsed)) {
            qids = parsed.filter(function (x) {
              return typeof x === "string" && x;
            });
          }
        }

        // 2-5) ユニーク数を数値にパース（不正値や負数は 0 扱い）
        var cnt = parseInt(rawCnt || "0", 10);
        if (Number.isFinite(cnt) && cnt >= 0) {
          localCount = cnt;
        }
      } catch (_e) {
        // localStorage / JSON パースのどこかで失敗した場合は「空データ」として扱う
        day = "";
        qids = [];
        localCount = 0;
      }

      // 3) 読み出したローカル状態をコンソールにフル出力（デバッグ用）
      console.group("[SYNC-B:streak3Today] recordStreak3TodayUnique CALLED");
      console.log("local.day =", day);
      console.log("local.qids =", qids);
      console.log("local.unique_count =", localCount);
      console.groupEnd();

      // 4) 日付か qid 配列が空なら、サーバー側を壊さないために送信しない
      if (!day || qids.length === 0) {
        console.warn("[SYNC-B:streak3Today] day 又は qids が空 → 送信中止");
        return;
      }

      // 5) Workers 側の merge.ts に渡す streak3TodayDelta のペイロードを組み立て
      //    - day: "YYYYMMDD" 形式
      //    - qids: その日に⭐️を初めて取った問題の qid 配列
      var payload = {
        streak3TodayDelta: {
          day: day,
          qids: qids
        },
        updatedAt: Date.now()
      };

      // 6) 送信直前の payload を丸ごとログに出しておく
      console.group("[SYNC-B:streak3Today] SEND payload");
      console.log(payload);
      console.groupEnd();

      // 7) /api/sync/merge に対して streak3TodayDelta 専用のリクエストを送信
      var res = await fetch(SYNC_MERGE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      // 8) HTTP レベルでエラーならここで終了（サーバー保存失敗の可能性）
      if (!res.ok) {
        console.error("[SYNC-B:streak3Today] merge FAILED:", res.status);
        return;
      }

      // 9) merge.ts が返してきた最新の SYNC スナップショットを取得（失敗しても致命的ではない）
      var merged = null;
      try {
        merged = await res.json();
      } catch (_e2) {
        merged = null;
      }

      // 10) merge のレスポンスをログに残しておく（Workers 側でどう保存されたかの確認用）
      console.group("[SYNC-B:streak3Today] MERGE result");
      console.log("mergeResponse =", merged);
      console.groupEnd();

      // 11) さらに /api/sync/state を叩いて、KV に反映された最終形の streak3Today を確認する
      try {
        var stateAfter = await fetchState();
        try {
          // 11-1) 取得した state 全体をグローバルに保持して、
          //       Bパート HUD や他のビューからも streak3Today を参照できるようにする
          window.__cscs_sync_state = stateAfter;
        } catch (_e3) {}

        // 11-2) stateAfter.streak3Today の中身をそのままログに出して、
        //       「day / unique_count / qids がどのように保存されたか」を確認できるようにする
        console.group("[SYNC-B:streak3Today] UPDATED state.streak3Today");
        console.log(stateAfter && stateAfter.streak3Today);
        console.groupEnd();

      } catch (e4) {
        // state の再取得自体が失敗したケース（merge 自体は成功している可能性あり）
        console.error("[SYNC-B:streak3Today] state refresh ERROR:", e4);
      }

    } catch (e) {
      // 想定外の例外が起きた場合も握りつぶさずログに出す
      console.error("[SYNC-B:streak3Today] fatal error:", e);
    }
  };

  window.addEventListener("online", function () {
    var box = document.getElementById("cscs_sync_view_b");
    if (!box) return;
    refreshAndSend(box);
  });

  init();
})();