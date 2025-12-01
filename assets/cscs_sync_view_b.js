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
        statusText: "no diff"
      });
      return;
    }

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
        statusText: "offline"
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
          statusText: "merge " + String(response.status)
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
        statusText: "ok"
      });
    } catch (e) {
      console.error("[SYNC-B] fetch failed:", e);
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
        statusText: "error"
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

  window.addEventListener("online", function () {
    var box = document.getElementById("cscs_sync_view_b");
    if (!box) return;
    refreshAndSend(box);
  });

  init();
})();