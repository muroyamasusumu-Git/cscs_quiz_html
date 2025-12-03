// assets/a_nav_guard.js
// Aパート専用：Bパート(qNNN_b.html)へ遷移する前に、必ずトークン＋選択肢情報を localStorage/sessionStorage に保存し、
// 保存が確認できた場合にだけ遷移を許可する「ナビゲーションガード」。

(function(){
        // 二重読み込み防止フラグ。すでにリスナーが入っている場合は何もしない。
        if (window.__cscsAListenerInstalled2) return;
        window.__cscsAListenerInstalled2 = true;

        // qid = YYYYMMDD-NNN を URL から取得（Aページ限定）
        // 例: /_build_cscs_20250926/slides/q013_a.html → qid = "20250926-013"
        const mDay  = location.pathname.match(/_build_cscs_(\d{8})/);
        const mStem = location.pathname.match(/(?:^|\/)(q\d{3})_a(?:\.html)?(?:\/)?$/i);
        // 対象のパス形式でなければ何もしない
        if (!mDay || !mStem) return;
        const day  = mDay[1];
        const num3 = mStem[1].slice(1);
        const qid  = `${day}-${num3}`;

        // デバッグログ用（画面にはパネルを出さず、コンソールにだけ出す）
        function dlog(...args){
          try{
            console.log('[A:nav-guard]', ...args);
          }catch(_){}
        }

        // O.D.O.A Mode トグルボタン用の CSS を動的に注入する
        // - 位置やサイズなどの見た目をここで一括管理する
        (function injectOdoaToggleStyle(){
          try{
            if (document.getElementById("cscs-odoa-toggle-style")) {
              return;
            }
            const style = document.createElement("style");
            style.id = "cscs-odoa-toggle-style";
            style.textContent = `
#cscs-odoa-toggle {
    font-size: 12px;
    padding: 2px 0px;
    position: fixed;
    bottom: 421px;
    right: 50px;
    opacity: 0.15;
    font-weight: bold;
    width: 100px;
    text-align: center;
}
            `;
            document.head.appendChild(style);
            dlog("O.D.O.A toggle style injected.");
          }catch(e){
            dlog("O.D.O.A toggle style injection failed:", String(e));
          }
        })();

        // 保存状態を保持するオブジェクト
        // tried: 保存処理を試したかどうか
        // ok:    保存処理が成功したかどうか
        // lastHref: 直近で保存をトライしたリンク先
        // lastChoice: 直近で推定した選択肢（A〜E）
        const SAVE = { tried:false, ok:false, lastHref:null, lastChoice:null };

        // O.D.O.A Mode 関連の状態を保持するオブジェクト
        // loaded : SYNC state の取得が完了したかどうか
        // loading: 現在取得中かどうか（多重 fetch を防ぐため）
        // state  : /api/sync/state から取得した JSON 全体
        const ODOA_STATE = { loaded:false, loading:false, state:null };

        // グローバルな O.D.O.A モード文字列（"on" / "off"）
        // まだ設定されていなければ "off" を初期値として使う
        if (typeof window.CSCS_ODOA_MODE !== 'string') {
          window.CSCS_ODOA_MODE = 'off';
        }

        // /api/sync/state から SYNC 状態を1回だけ取得するヘルパー
        // - odoa_mode / oncePerDayToday を含む全体 state を ODOA_STATE.state に格納
        // - 取得に成功したら window.CSCS_ODOA_MODE を odoa_mode("on"/"off") で更新
        async function loadSyncStateForOdoaIfNeeded(){
          if (ODOA_STATE.loaded) {
            return;
          }
          if (ODOA_STATE.loading) {
            // すでに別の呼び出しが取得中なら、完了を軽く待つ
            while (ODOA_STATE.loading && !ODOA_STATE.loaded) {
              await new Promise(function(resolve){ setTimeout(resolve, 10); });
            }
            return;
          }
          ODOA_STATE.loading = true;
          try{
            const res = await fetch("/api/sync/state", { cache: "no-store" });
            const json = await res.json();
            ODOA_STATE.state = json;
            ODOA_STATE.loaded = true;

            // odoa_mode の正規化（"on" / "off" 以外は "off" 扱い）
            let mode = "off";
            if (json && typeof json.odoa_mode === "string") {
              if (json.odoa_mode === "on" || json.odoa_mode === "off") {
                mode = json.odoa_mode;
              }
            }
            window.CSCS_ODOA_MODE = mode;

            dlog("O.D.O.A SYNC state loaded:", {
              odoa_mode: window.CSCS_ODOA_MODE,
              hasOncePerDayToday: !!(json && json.oncePerDayToday)
            });

            // ボタンラベル更新関数があれば、ここで最新状態を反映
            if (typeof window.__cscsUpdateOdoaBtnLabel === "function") {
              try{
                window.__cscsUpdateOdoaBtnLabel();
              }catch(_){}
            }

            // SYNC state 読み込み後に、必要であれば href を一括書き換え
            try{
              rewriteAnchorsForOdoaIfNeeded();
            }catch(e){
              dlog("O.D.O.A: bulk rewrite after state load failed:", String(e));
            }
          }catch(e){
            dlog("O.D.O.A SYNC state load failed:", String(e));
          }finally{
            ODOA_STATE.loading = false;
          }
        }

        // oncePerDayToday の情報から「この qid が今日すでに回答済みかどうか」を判定する
        // - oncePerDayToday.day は「今日のYYYYMMDD」で管理されている前提なので、
        //   ここでは day との一致チェックは行わず、results[qid] の有無だけを見る。
        function isOncePerDayAnsweredForThisQid(){
          const st = ODOA_STATE.state;
          if (!st || !st.oncePerDayToday || typeof st.oncePerDayToday !== "object") return false;

          const raw = st.oncePerDayToday;
          const results = raw.results;
          if (!results || typeof results !== "object") {
            dlog("O.D.O.A: oncePerDayToday.results is missing or not object.", { qid });
            return false;
          }

          const answered = Object.prototype.hasOwnProperty.call(results, qid);

          // デバッグ用に、この qid のエントリ有無と全体件数をログする
          try{
            dlog("O.D.O.A: oncePerDayToday answered check:", {
              qid,
              hasEntry: answered,
              resultsKeysLength: Object.keys(results).length
            });
          }catch(_){}

          return !!answered;
        }

        // 「O.D.O.A Mode の仕様上、この問題はトークン発行をスキップすべきか？」を判定
        // - モードが "on" で、かつ oncePerDayToday 上「今日すでに回答済み」であれば true
        function shouldSkipTokenForThisQuestion(){
          const mode = window.CSCS_ODOA_MODE === "on" ? "on" : "off";
          if (mode !== "on") return false;
          const answered = isOncePerDayAnsweredForThisQid();
          if (answered) {
            dlog("O.D.O.A: this qid is already answered today. Will skip token issuing.", { qid, mode });
          }
          return answered;
        }

        // O.D.O.A Mode の条件に応じて、A→B のリンク href を一括で書き換える
        // - mode === "on" かつ「今日すでに回答済み」のとき: ?choice= を削除
        // - mode === "off" のとき                   : ?choice= を付け直す（pickChoice で推定）
        function rewriteAnchorsForOdoaIfNeeded(){
          try{
            const mode = window.CSCS_ODOA_MODE === "on" ? "on" : "off";

            // ▼ mode: "on" の場合 → 既回答の問題だけ ?choice を削る
            if (mode === "on") {
              if (!shouldSkipTokenForThisQuestion()) {
                dlog("O.D.O.A: bulk rewrite skipped (mode=on but not answered today).", {
                  qid,
                  mode
                });
                return;
              }

              const anchors = Array.prototype.slice.call(document.querySelectorAll("a"));
              let removedCount = 0;

              for (let i = 0; i < anchors.length; i++) {
                const a = anchors[i];
                if (!isTargetAnchor(a)) continue;

                const rawHref = a.getAttribute("href") || "";
                if (!rawHref) continue;

                try{
                  const u = new URL(rawHref, location.href);
                  const before = u.pathname + u.search;

                  if (!u.searchParams.has("choice")) {
                    continue;
                  }

                  u.searchParams.delete("choice");
                  const finalHref = u.pathname + u.search;

                  a.setAttribute("href", finalHref);
                  removedCount++;

                  dlog("O.D.O.A: anchor href stripped by bulk rewrite (mode=on).", {
                    beforeHref: before,
                    afterHref: finalHref
                  });
                }catch(e){
                  dlog("O.D.O.A: bulk rewrite href normalize failed (mode=on), keep raw href.", {
                    rawHref,
                    error: String(e)
                  });
                }
              }

              dlog("O.D.O.A: bulk rewrite finished for mode=on.", {
                qid,
                removedCount
              });
              return;
            }

            // ▼ mode: "off" の場合 → Bリンクに ?choice= を復元する
            const anchors = Array.prototype.slice.call(document.querySelectorAll("a"));
            let restoredCount = 0;
            let skippedNoChoiceInfo = 0;

            for (let i = 0; i < anchors.length; i++) {
              const a = anchors[i];
              if (!isTargetAnchor(a)) continue;

              const rawHref = a.getAttribute("href") || "";
              if (!rawHref) continue;

              try{
                const u = new URL(rawHref, location.href);
                const before = u.pathname + u.search;

                // すでに choice パラメータがある場合は何もしない
                if (u.searchParams.has("choice")) {
                  continue;
                }

                // a要素から choice を推定（A/B/C/D...）
                const choice = pickChoice(a);
                if (!choice) {
                  skippedNoChoiceInfo++;
                  dlog("O.D.O.A: cannot restore choice (no choice info).", {
                    beforeHref: before
                  });
                  continue;
                }

                u.searchParams.set("choice", choice);
                const finalHref = u.pathname + u.search;

                a.setAttribute("href", finalHref);
                restoredCount++;

                dlog("O.D.O.A: anchor href restored with choice param (mode=off).", {
                  beforeHref: before,
                  afterHref: finalHref,
                  choice
                });
              }catch(e){
                dlog("O.D.O.A: bulk rewrite href normalize failed (mode=off), keep raw href.", {
                  rawHref,
                  error: String(e)
                });
              }
            }

            dlog("O.D.O.A: bulk rewrite finished for mode=off.", {
              qid,
              restoredCount,
              skippedNoChoiceInfo
            });
          }catch(e){
            dlog("O.D.O.A: bulk rewrite exception:", String(e));
          }
        }

        // O.D.O.A Mode を SYNC に保存するヘルパー
        // - mode は "on" / "off" のみ想定
        function sendOdoaModeToSync(mode){
          try{
            const payload = { odoa_mode: mode === "on" ? "on" : "off" };
            dlog("O.D.O.A: sending mode to SYNC:", payload);
            fetch("/api/sync/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }).then(function(res){
              dlog("O.D.O.A: SYNC merge response status:", res.status);
            }).catch(function(err){
              dlog("O.D.O.A: SYNC merge error:", String(err));
            });
          }catch(e){
            dlog("O.D.O.A: sendOdoaModeToSync exception:", String(e));
          }
        }

        // O.D.O.A Mode のボタンUIを1回だけ生成する
        // - window.CSCS_ODOA_MODE の値に応じてラベルを更新
        // - クリックで on/off をトグルし、SYNC にも送信
        function setupOdoaModeButtonOnce(){
          if (window.__cscsOdoaBtnInstalled) return;
          window.__cscsOdoaBtnInstalled = true;

          const wrapper = document.createElement("div");
          wrapper.id = "cscs-odoa-toggle-wrapper";

          const btn = document.createElement("button");
          btn.id = "cscs-odoa-toggle";

          window.__cscsUpdateOdoaBtnLabel = function(){
            const mode = window.CSCS_ODOA_MODE === "on" ? "on" : "off";
            if (mode === "on") {
              btn.textContent = "ODOA：ON";
            } else {
              btn.textContent = "ODOA：OFF";
            }
          };

          btn.addEventListener("click", function(){
            const prev = window.CSCS_ODOA_MODE === "on" ? "on" : "off";
            const next = prev === "on" ? "off" : "on";
            window.CSCS_ODOA_MODE = next;
            if (typeof window.__cscsUpdateOdoaBtnLabel === "function") {
              window.__cscsUpdateOdoaBtnLabel();
            }
            dlog("O.D.O.A: button clicked, mode changed:", { prev, next });

            // モード変更直後に、一括書き換えを試みる
            try{
              rewriteAnchorsForOdoaIfNeeded();
            }catch(e){
              dlog("O.D.O.A: bulk rewrite after button click failed:", String(e));
            }

            sendOdoaModeToSync(next);
          });

          wrapper.appendChild(btn);

          document.addEventListener("DOMContentLoaded", function(){
            // まず <div class="wrap"> が存在すれば、その中にトグルボタンを入れる
            // 見つからない場合は、従来どおり Aパート下部 or body に配置する
            let anchor = null;
            const wrap = document.querySelector("div.wrap");
            if (wrap) {
              anchor = wrap;
            } else {
              anchor =
                document.getElementById("cscs-a-bottom-controls") ||
                document.getElementById("cscs-a-bottom") ||
                document.body;
            }

            anchor.appendChild(wrapper);

            if (typeof window.__cscsUpdateOdoaBtnLabel === "function") {
              window.__cscsUpdateOdoaBtnLabel();
            }

            // どの要素の中にマウントされたかを詳細にログ出力して確認できるようにする
            dlog("O.D.O.A button mounted to DOM.", {
              anchorTag: anchor && anchor.tagName,
              anchorId: anchor && anchor.id,
              anchorClass: anchor && anchor.className
            });
          });
        }

        // 起動時にボタン生成処理を登録し、SYNC state の取得もウォームアップしておく
        setupOdoaModeButtonOnce();
        loadSyncStateForOdoaIfNeeded();

        // トークン生成関数
        // crypto.getRandomValues が使える場合はランダムな 2つの 32bit 値からトークン生成
        // 使えない環境では Date.now + Math.random をフォールバックとして使用
        function makeToken(){
          try{
            const a = new Uint32Array(2);
            crypto.getRandomValues(a);
            return `${qid}:${a[0].toString(36)}${a[1].toString(36)}`;
          }catch(_){
            return `${qid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          }
        }

        // アンカー要素から「どの選択肢か」を推定する関数
        // 1) href のクエリ ?choice=A〜E
        // 2) テキストの先頭文字（A〜E）
        // 3) 親 li 要素の data-choice 属性
        // の順に判定し、A〜E いずれかを返す。判定できなければ空文字を返す。
        function pickChoice(a){
          try{
            const raw = a.getAttribute('href') || '';
            let c = '';
            try{
              const url = new URL(raw, location.href);
              c = (url.searchParams.get('choice') || '').trim().toUpperCase();
              if (/^[A-E]$/.test(c)) return c;
            }catch(_){}
            const t = (a.textContent || '').trim();
            const head = t.charAt(0).toUpperCase();
            if (/^[A-E]$/.test(head)) return head;
            const li = a.closest && a.closest('li');
            const dataC = li && (li.getAttribute('data-choice') || '').toUpperCase();
            if (/^[A-E]$/.test(dataC)) return dataC;
            return '';
          }catch(_){ return ''; }
        }

        // ターゲット判定：Bパートの HTML へのリンクかどうかを判定
        // パスの末尾が qNNN_b, qNNN_b.html などになっている a 要素のみを対象とする。
        function isTargetAnchor(el){
          if (!el || !el.getAttribute) return false;
          const raw = el.getAttribute('href') || '';
          try{
            const u = new URL(raw, location.href);
            return /(?:^|\/)q\d{3}_b(?:\.html)?(?:\/)?$/i.test(u.pathname);
          }catch(_){
            // URL コンストラクタに失敗するような相対パスもあるので、その場合は生文字列に対して判定
            return /(?:^|\/)?q\d{3}_b(?:\.html)?(?:\/)?$/i.test(raw);
          }
        }

        // localStorage が実際に読み書きできるかどうかをチェックする自己診断
        // ランダム値を書き込み → 読み出し → 削除 して一致するか確認
        function storageSelfTest(){
          try{
            const k = '__cscs_selftest__';
            const v = String(Math.random());
            localStorage.setItem(k, v);
            const r = localStorage.getItem(k);
            localStorage.removeItem(k);
            return r === v;
          }catch(err){
            dlog('selftest NG:', String(err));
            return false;
          }
        }

        // トークンと選択肢を保存するメイン処理
        // - すでに SAVE.ok が true の場合は何もしない（再保存しない）
        // - localStorage にトークン＋choice を書き込み、round-trip（書いた値を読み戻す）で確認
        // - sessionStorage にも直近のトークン情報を保存
        // - 成否を SAVE に記録して返す
        async function saveTokenFor(a){
          if (SAVE.ok) return true;
          SAVE.tried = true;

          // O.D.O.A Mode の仕様上、この問題ではトークン発行をスキップすべき場合
          // - トークンは localStorage に書かず、ナビゲーションガード的には「成功」とみなす
          await loadSyncStateForOdoaIfNeeded();
          if (shouldSkipTokenForThisQuestion()) {
            const rawHref = a.getAttribute('href') || '';
            let finalHref = rawHref;

            // ODOA モード時は B へのリンクから choice パラメータを取り除く
            try{
              const u = new URL(rawHref, location.href);
              const before = u.pathname + u.search;
              u.searchParams.delete('choice');
              finalHref = u.pathname + u.search;
              dlog("O.D.O.A: stripped choice param from href.", {
                qid,
                mode: window.CSCS_ODOA_MODE,
                beforeHref: before,
                afterHref: finalHref
              });
            }catch(e){
              dlog("O.D.O.A: href normalize failed, using raw href.", {
                qid,
                mode: window.CSCS_ODOA_MODE,
                rawHref,
                error: String(e)
              });
            }

            SAVE.ok = true;

            // A→B 遷移用の href を実際の a 要素にも反映する
            try{
              a.setAttribute("href", finalHref);
              dlog("O.D.O.A: anchor href updated for navigation.", {
                finalHref
              });
            }catch(e){
              dlog("O.D.O.A: anchor href update failed:", String(e));
            }

            SAVE.lastHref = finalHref;
            SAVE.lastChoice = null;

            dlog("O.D.O.A: saveTokenFor skipped token issuing (treated as OK).", {
              qid,
              mode: window.CSCS_ODOA_MODE
            });
            return true;
          }

          const choice = pickChoice(a);
          const token  = makeToken();
          const Kt = `cscs_from_a_token:${qid}`;
          const Kc = `cscs_from_a:${qid}`;

          const selfOK = storageSelfTest();
          if (!selfOK){
            dlog('localStorage not writable (selftest NG)');
          }

          try{
            let ok = false, rt = null;
            // 軽いリトライ（最大3回）、毎回 set → get で round-trip を確認
            for (let i=0;i<3;i++){
              localStorage.setItem(Kt, token);
              if (choice) localStorage.setItem(Kc, choice);
              rt = localStorage.getItem(Kt);
              if (rt === token) { ok = true; break; }
              // 非同期の隙間を与える（microtask 相当）
              await Promise.resolve();
            }

            // 直近のトークン情報は sessionStorage にも保存（デバッグ・確認用）
            try{
              sessionStorage.setItem('cscs_last_token_qid', qid);
              sessionStorage.setItem('cscs_last_token_value', token);
              if (choice) sessionStorage.setItem('cscs_last_choice', choice);
            }catch(_){}

            SAVE.ok = !!ok;
            SAVE.lastHref = a.getAttribute('href') || '';
            SAVE.lastChoice = choice || null;

            dlog('save:', { ok: SAVE.ok, choice: SAVE.lastChoice, wrote: !!rt });
            return SAVE.ok;
          }catch(err){
            dlog('save exception:', String(err));
            SAVE.ok = false;
            return false;
          }
        }

        // そのイベント経路からのデフォルト動作を完全停止するヘルパー
        function hardBlock(ev){
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
        }

        // SAVE.ok が true であることを前提に、保存済みの href に遷移する
        // URL オブジェクトで絶対URLにし、requestAnimationFrame 内で location.assign する
        function navigateIfSaved(a){
          if (!SAVE.ok){
            dlog('nav blocked: token missing');
            return;
          }
          const url = new URL(SAVE.lastHref || a.getAttribute('href') || '', location.href);
          requestAnimationFrame(() => location.assign(url.toString()));
        }

        // ▼ イベントリスナー群
        // pointer 系：常にデフォルト遷移を完全に止め、トークン保存のみ実行
        //             （失敗した場合は遷移させず STOP のまま）

        document.addEventListener('pointerdown', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          await loadSyncStateForOdoaIfNeeded();

          const ok = await saveTokenFor(a);
          if (!ok) dlog('pointerdown save NG');
        }, { capture:true });

        // mousedown：pointerdown と同様だが、SAVE.ok がまだ false のときだけ保存トライ
        document.addEventListener('mousedown', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          await loadSyncStateForOdoaIfNeeded();

          if (!SAVE.ok) {
            const ok = await saveTokenFor(a);
            if (!ok) dlog('mousedown save NG');
          }
        }, { capture:true });

        // mouseup：同じくガード。ここでも必要なら保存を試みる
        document.addEventListener('mouseup', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          await loadSyncStateForOdoaIfNeeded();

          if (!SAVE.ok) {
            const ok = await saveTokenFor(a);
            if (!ok) dlog('mouseup save NG');
          }
        }, { capture:true });

        // click イベント：
        // ★最終ゲート。ここで localStorage にトークンがあることをもう一度確認。
        // - SAVE.ok が false なら saveTokenFor を再試行
        // - localStorage から実体を get し、なければ遷移 STOP
        // - あれば navigateIfSaved() で実際に遷移させる
        document.addEventListener('click', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          await loadSyncStateForOdoaIfNeeded();

          if (!SAVE.ok) await saveTokenFor(a);

          const skipToken = shouldSkipTokenForThisQuestion();

          if (!skipToken) {
            try {
              const Kt = `cscs_from_a_token:${qid}`;
              await Promise.resolve();
              const rt = localStorage.getItem(Kt);
              if (!rt) {
                dlog('click STOP (no token in localStorage)');
                return;
              }
            } catch (e) {
              dlog('click STOP (exception on localStorage check):', String(e));
              return;
            }
          } else {
            dlog("O.D.O.A: click token check skipped (no token required for this qid).", {
              qid,
              mode: window.CSCS_ODOA_MODE
            });
          }

          navigateIfSaved(a);
        }, { capture:true });

        // キーボード操作（Enter / Space）で a 要素にフォーカスがある場合も、
        // click と同じフローでガード＆保存＆確認を行う。
        document.addEventListener('keydown', async (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          const a = document.activeElement;
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          await loadSyncStateForOdoaIfNeeded();

          if (!SAVE.ok) await saveTokenFor(a);

          const skipToken = shouldSkipTokenForThisQuestion();

          if (!skipToken) {
            try {
              const Kt = `cscs_from_a_token:${qid}`;
              await Promise.resolve();
              const rt = localStorage.getItem(Kt);
              if (!rt) {
                dlog('kbd STOP (no token in localStorage)');
                return;
              }
            } catch (e) {
              dlog('kbd STOP (exception on localStorage check):', String(e));
              return;
            }
          } else {
            dlog("O.D.O.A: keydown token check skipped (no token required for this qid).", {
              qid,
              mode: window.CSCS_ODOA_MODE
            });
          }

          navigateIfSaved(a);
        }, { capture:true });

      })();