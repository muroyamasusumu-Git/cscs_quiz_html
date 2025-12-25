// completely_delete_local.js
(function () {
  "use strict";

  // ============================================================================
  // 🚨🚨🚨 超重要：これは「ローカル完全削除」スクリプト（極めて危険） 🚨🚨🚨
  //
  // これは “SYNCサーバ(KV)” ではなく、ブラウザ側の「このオリジンのローカル保存」を
  // 可能な限り全部消します。
  //
  // 【何を消すか（対象は “今開いているドメイン(オリジン)” のみ）】
  //   1) localStorage        -> 全キー削除（clear）
  //   2) sessionStorage      -> 全キー削除（clear）
  //   3) IndexedDB           -> 可能なら全DB削除（deleteDatabase）
  //   4) Cache Storage       -> 可能なら全キャッシュ削除（caches.delete）
  //
  // 【危険性（必読）】
  //   - 取り消し不可・復元不可（ブラウザ側のデータが消える）
  //   - “CSCSだけ” ではなく、このドメイン上で保存していたデータが全て消える
  //   - 誤って本番/別環境/別アカウントで実行すると、作業データを即ロストする
  //
  // 【安全策】
  //   - 実行前に confirm と “DELETE” の手入力を要求する（誤爆防止）
  //
  // ============================================================================

  function now() {
    return new Date().toISOString();
  }

  function logLine() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CSCS][COMPLETELY_DELETE_LOCAL][" + now() + "]");
    console.log.apply(console, args);
  }

  function warnLine() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CSCS][COMPLETELY_DELETE_LOCAL][" + now() + "]");
    console.warn.apply(console, args);
  }

  function errLine() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CSCS][COMPLETELY_DELETE_LOCAL][" + now() + "]");
    console.error.apply(console, args);
  }

  function snapshotStorageKeys(storage) {
    var keys = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (k !== null && k !== undefined) keys.push(String(k));
      }
    } catch (e) {
      return { ok: false, error: e, keys: [] };
    }
    return { ok: true, keys: keys };
  }

  function clearStorage(storage, label) {
    var before = snapshotStorageKeys(storage);
    if (!before.ok) {
      warnLine(label + " snapshot failed:", before.error);
      return { ok: false, cleared: false, deletedKeys: [], error: before.error };
    }

    try {
      storage.clear();
    } catch (e) {
      errLine(label + " clear() failed:", e);
      return { ok: false, cleared: false, deletedKeys: before.keys, error: e };
    }

    var after = snapshotStorageKeys(storage);
    if (!after.ok) {
      warnLine(label + " post-snapshot failed:", after.error);
      return { ok: true, cleared: true, deletedKeys: before.keys, warning: after.error };
    }

    return {
      ok: true,
      cleared: true,
      deletedKeys: before.keys,
      remainingCount: after.keys.length
    };
  }

  function supportsIndexedDBList() {
    return typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function";
  }

  function deleteOneIDB(name) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.deleteDatabase(name);
        req.onsuccess = function () {
          resolve({ name: name, ok: true, result: "success" });
        };
        req.onerror = function () {
          resolve({ name: name, ok: false, result: "error", error: req.error || null });
        };
        req.onblocked = function () {
          resolve({ name: name, ok: false, result: "blocked" });
        };
      } catch (e) {
        resolve({ name: name, ok: false, result: "exception", error: e });
      }
    });
  }

  async function deleteAllIndexedDB() {
    if (typeof indexedDB === "undefined") {
      warnLine("IndexedDB is not available in this environment.");
      return { ok: true, skipped: true, reason: "no-indexeddb" };
    }

    if (!supportsIndexedDBList()) {
      warnLine(
        "indexedDB.databases() is not supported in this browser. IndexedDB full wipe may be incomplete."
      );
      return { ok: true, skipped: true, reason: "no-databases-enum" };
    }

    var list;
    try {
      list = await indexedDB.databases();
    } catch (e) {
      warnLine("indexedDB.databases() failed:", e);
      return { ok: false, skipped: true, reason: "databases-enum-failed", error: e };
    }

    var names = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name) names.push(String(list[i].name));
    }

    if (names.length === 0) {
      logLine("IndexedDB: no databases found.");
      return { ok: true, deleted: [], count: 0 };
    }

    logLine("IndexedDB: deleting databases ->", names);

    var results = [];
    for (var j = 0; j < names.length; j++) {
      // 逐次実行（安全のため並列にしない）
      // blocked が出たら「他タブが掴んでいる」可能性がある
      // その場合は全タブ閉じてからやり直すのが安全
      // （このスクリプト自体は落とさず結果に記録する）
      /* eslint-disable no-await-in-loop */
      var r = await deleteOneIDB(names[j]);
      results.push(r);
      /* eslint-enable no-await-in-loop */
    }

    return { ok: true, deleted: results, count: results.length };
  }

  async function deleteAllCaches() {
    if (typeof caches === "undefined" || typeof caches.keys !== "function") {
      warnLine("Cache Storage API is not available in this environment.");
      return { ok: true, skipped: true, reason: "no-cache-api" };
    }

    var names;
    try {
      names = await caches.keys();
    } catch (e) {
      warnLine("caches.keys() failed:", e);
      return { ok: false, skipped: true, reason: "cache-keys-failed", error: e };
    }

    if (!names || names.length === 0) {
      logLine("Cache Storage: no caches found.");
      return { ok: true, deleted: [], count: 0 };
    }

    logLine("Cache Storage: deleting caches ->", names);

    var results = [];
    for (var i = 0; i < names.length; i++) {
      /* eslint-disable no-await-in-loop */
      try {
        var ok = await caches.delete(names[i]);
        results.push({ name: names[i], ok: !!ok });
      } catch (e) {
        results.push({ name: names[i], ok: false, error: e });
      }
      /* eslint-enable no-await-in-loop */
    }

    return { ok: true, deleted: results, count: results.length };
  }

  async function run() {
    logLine("RUN begin");
    logLine("Origin =", location.origin);

    // 誤爆防止①：確認ダイアログ
    var ok1 = confirm(
      "⚠️ DANGER ⚠️\n\nThis will DELETE ALL local data for this origin:\n- localStorage\n- sessionStorage\n- IndexedDB (best-effort)\n- Cache Storage (best-effort)\n\nContinue?"
    );
    if (!ok1) {
      warnLine("Aborted by user (confirm).");
      return;
    }

    // 誤爆防止②：手入力（DELETE 以外は中止）
    var phrase = prompt('Type "DELETE" to proceed with COMPLETE LOCAL WIPE:', "");
    if (phrase !== "DELETE") {
      warnLine('Aborted by user (phrase mismatch). You typed:', phrase);
      return;
    }

    // 事前スナップショット（件数だけ）
    var lsBefore = snapshotStorageKeys(localStorage);
    var ssBefore = snapshotStorageKeys(sessionStorage);
    logLine("localStorage keys (before) =", lsBefore.ok ? lsBefore.keys.length : "unknown");
    logLine("sessionStorage keys (before) =", ssBefore.ok ? ssBefore.keys.length : "unknown");

    // 1) localStorage を全消去
    var lsRes = clearStorage(localStorage, "localStorage");
    logLine("localStorage cleared =", lsRes.ok && lsRes.cleared);
    logLine("localStorage deletedKeysCount =", lsRes.deletedKeys ? lsRes.deletedKeys.length : 0);

    // 2) sessionStorage を全消去
    var ssRes = clearStorage(sessionStorage, "sessionStorage");
    logLine("sessionStorage cleared =", ssRes.ok && ssRes.cleared);
    logLine("sessionStorage deletedKeysCount =", ssRes.deletedKeys ? ssRes.deletedKeys.length : 0);

    // 3) IndexedDB を全消去（ブラウザ対応状況により “ベストエフォート”）
    var idbRes = await deleteAllIndexedDB();
    logLine("IndexedDB result =", idbRes);

    // 4) Cache Storage を全消去（対応していれば）
    var cacheRes = await deleteAllCaches();
    logLine("Cache Storage result =", cacheRes);

    // 事後確認
    var lsAfter = snapshotStorageKeys(localStorage);
    var ssAfter = snapshotStorageKeys(sessionStorage);
    logLine("localStorage keys (after) =", lsAfter.ok ? lsAfter.keys.length : "unknown");
    logLine("sessionStorage keys (after) =", ssAfter.ok ? ssAfter.keys.length : "unknown");

    // 最後に「推奨アクション」を明示（強制はしない）
    warnLine(
      "DONE. Strongly recommended: reload the page now to start from a truly clean runtime state."
    );

    logLine("RUN done");
  }

  run().catch(function (e) {
    errLine("RUN failed:", e && e.stack ? e.stack : e);
  });
})();