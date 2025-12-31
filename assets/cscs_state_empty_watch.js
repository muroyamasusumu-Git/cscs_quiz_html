// assets/cscs_state_empty_watch.js
//
// 【読み込み範囲に関する重要な注意（設計前提）】
//   - 本ファイルは Aパート / Bパートの【両方】に読み込まれている共通JSである。
//   - したがって、本ファイルに追加する処理・監視・副作用は、
//     A/B 両パートの挙動・ログ・ネットワーク通信に同時に影響を与える。
//   - デバッグ用の一時的な監視や、片側（Aのみ / Bのみ）を想定した処理を
//     ここに追加することは原則として避けること。
//   - 片側限定の監視を行いたい場合は、
//     ・A/B 専用JSに分離する
//     ・もしくは URL / part 判定を明示的に行った上でガードする
//     という設計対応が必要になる。
//
// 目的:
//   /api/sync/state のレスポンスヘッダを毎回チェックし、
//   「KV miss + empty template 返却」をブラウザコンソールで一発確定させる。

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
  //      → このファイルは一切動かない（CSS注入/イベント登録/Observer登録/DOM加工を行わない）
  //   2) localStorage "cscs_effects_disabled" === "1"
  //      → 同上（ページ跨ぎで維持するための永続フラグ）
  //
  // 注意:
  //   ・「後から殺す」方式では既に登録されたイベント等を完全に巻き戻せないため、
  //     演出OFFは “冒頭でreturnして最初から走らせない” を正とする。
  //   ・このブロックは演出系JSの冒頭に統一して配置し、挙動の共通化を保つ。
  // ============================================================

  // 演出OFFモード（最上流フラグ）
  // - true: このファイルは一切のCSS注入/イベント登録/Observer登録を行わない
  // - false/未定義: 通常どおり動作
  var __effectsDisabled = false;

  // 追加した処理:
  // - 個別OFF指定（CSCS_EFFECTS_DISABLED_MAP）を確認
  // - effectId は各JSごとに固定文字列で指定する
  var __effectId = "cscs_state_empty_watch"; // ← このJS固有のIDにする
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
    // - ここで false に戻すと、直前までの判定（個別OFF等）を打ち消す可能性があるため
    //   例外時は「現状維持」にする
  }
  if (__effectsDisabled) {
    return;
  }
  
  
  // 二重実行防止（SPA / A-B 遷移対策）
  if (window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__) return;
  window.__CSCS_EMPTY_TEMPLATE_WATCH_INSTALLED__ = true;

  try {
    // ============================================================
    // /api/sync/state を叩く前に、ローカルに保存されている
    // 「決定的SYNCキー（cscs_sync_key）」を取得する
    //
    // 重要:
    // - このキーは init.ts により発行・保存される前提
    // - key が無い状態で /api/sync/state を叩くと、
    //   Worker 側は必ず 400 (SYNC_STATE_MISSING_KEY) を返す
    // - それは「失敗」ではなく「仕様通り」だが、
    //   デバッグ時にノイズになるため、ここで明示的に防ぐ
    // ============================================================
    var _syncKey = "";
    try {
      _syncKey = localStorage.getItem("cscs_sync_key") || "";
    } catch (_e) {
      // localStorage にアクセスできない環境（例: 制限付き iframe 等）
      // その場合も key 無しとして扱う
      _syncKey = "";
    }

    // ============================================================
    // SYNCキーが存在しない場合は、/api/sync/state を呼ばない
    //
    // 意図:
    // - 「key が無いのに state を叩いた」ことによる 400 を発生させない
    // - init 未完了 / 保存失敗 / 読み込み順の問題を
    //   コンソールログ一発で切り分けられるようにする
    // ============================================================
    if (!_syncKey) {
      console.log(
        "[CSCS][STATE] skipped: cscs_sync_key is missing (will not call /api/sync/state)"
      );
      return;
    }

    // ============================================================
    // 決定的キーが存在する場合のみ /api/sync/state を呼び出す
    //
    // 注意:
    // - Worker 側は「X-CSCS-Key」ヘッダのみを正として判定する
    // - クエリや cookie に key があっても意味はない
    // ============================================================
    fetch("/api/sync/state", {
      cache: "no-store",
      credentials: "include",
      headers: {
        "X-CSCS-Key": String(_syncKey)
      }
    })
      .then(function (r) {
        const kv = r.headers.get("X-CSCS-KV");
        const isEmpty = r.headers.get("X-CSCS-IsEmptyTemplate");
        const warn = r.headers.get("X-CSCS-Warn");
        const fatal = r.headers.get("X-CSCS-Fatal");

        // 追加した処理: KV バインディング名を毎回ログで確定させる（A/B共通JSなので副作用はログのみ）
        // - 目的: 「この function が掴んでいる KV バインディング名」をコンソール一発で確定
        // - 成功例: [CSCS][ENV_KEYS] X-CSCS-KV-Binding= "SYNC"
        const kvBinding = r.headers.get("X-CSCS-KV-Binding");
        console.log("[CSCS][ENV_KEYS] X-CSCS-KV-Binding=", kvBinding);

        return r.text().then(function (bodyText) {
          let bodyJson = null;
          try {
            bodyJson = bodyText ? JSON.parse(bodyText) : null;
          } catch (_e) {
            bodyJson = null;
          }

          // ★ ERROR / EMPTY / OK の切り分け（推測しない）
          // - ERROR: HTTP 200以外（400/401/403/500 等） → “EMPTY扱い”にしない
          // - EMPTY: HTTP 200 かつ (X-CSCS-KV=miss & X-CSCS-IsEmptyTemplate=1)
          // - OK   : HTTP 200 かつ 上記以外
          if (!r.ok) {
            const warnObj = bodyJson && bodyJson.__cscs_warn ? bodyJson.__cscs_warn : null;
            const warnCode =
              warnObj && typeof warnObj.code === "string"
                ? warnObj.code
                : warn
                  ? String(warn)
                  : null;

            const msg =
              warnObj && typeof warnObj.message === "string"
                ? warnObj.message
                : bodyJson && typeof bodyJson.message === "string"
                  ? bodyJson.message
                  : null;

            console.warn("[CSCS][STATE][ERROR] state request failed (do not treat as empty)", {
              http: r.status,
              ok: r.ok,
              kv: kv,
              isEmptyTemplate: isEmpty,
              warn: warnCode,
              fatal: fatal ? String(fatal) : null,
              message: msg,
              bodyTopLevelKeys: bodyJson && typeof bodyJson === "object" ? Object.keys(bodyJson) : null
            });
          } else if (kv === "miss" && isEmpty === "1") {
            console.warn(
              "[CSCS][EMPTY-TEMPLATE] KV state not available -> out=empty returned",
              { kv: "miss", template: "empty" }
            );
          } else {
            console.log("[CSCS][STATE] state ok", {
              http: r.status,
              kv: kv,
              isEmptyTemplate: isEmpty
            });
          }

          // 追加した処理: /api/sync/init の判定結果（✅/❌）を毎回“簡潔に”出す（デバッグ段階なので常時ログ）
          // - 目的: 手動スモークテストと同じ結論（INIT OK/FAILED）を、この監視JS起動だけで毎回確定させる
          // - 方針: 推測はしない（status とレスポンスヘッダの有無だけで判定）
          // - 注意: 本ファイルは A/B 両方で読み込まれるため、A/B 両方から init が実行されログが出る（副作用は通信＋ログのみ）
          fetch("/api/sync/init", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({ force: false })
          })
            .then(function (res) {
              const hdrs = {
                "X-CSCS-Key": res.headers.get("X-CSCS-Key"),
                "X-CSCS-User": res.headers.get("X-CSCS-User"),
                "X-CSCS-KV-Binding": res.headers.get("X-CSCS-KV-Binding"),
                "X-CSCS-KV-Identity": res.headers.get("X-CSCS-KV-Identity")
              };

              // 追加した処理: 判定に必要な最小情報だけをログに残す（検索しやすい）
              console.log("[CSCS][INIT] status:", res.status);
              console.log("[CSCS][INIT] ok:", res.ok);
              console.log("[CSCS][INIT] response headers:", hdrs);

              // 追加した処理: 手動スモークテストと同じ基準で“1行結論”を出す（推測しない）
              if (res.status === 200 && hdrs["X-CSCS-Key"] && hdrs["X-CSCS-User"]) {
                console.log("✅ INIT OK:", "key issued / returned", "| user =", hdrs["X-CSCS-User"]);
              } else {
                console.warn("❌ INIT FAILED:", "implementation or binding issue");
              }
            })
            .catch(function (e) {
              console.error("[CSCS][INIT] fetch /api/sync/init failed", e);
            });
        });
      })
      .catch(function (e) {
        console.error("[CSCS][STATE] fetch /api/sync/state failed", e);
      });
  } catch (e) {
    console.error("[CSCS][STATE] unexpected error", e);
  }
})();