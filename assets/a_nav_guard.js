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

        // 保存状態を保持するオブジェクト
        // tried: 保存処理を試したかどうか
        // ok:    保存処理が成功したかどうか
        // lastHref: 直近で保存をトライしたリンク先
        // lastChoice: 直近で推定した選択肢（A〜E）
        const SAVE = { tried:false, ok:false, lastHref:null, lastChoice:null };

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
          const ok = await saveTokenFor(a);
          if (!ok) dlog('pointerdown save NG');
        }, { capture:true });

        // mousedown：pointerdown と同様だが、SAVE.ok がまだ false のときだけ保存トライ
        document.addEventListener('mousedown', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);
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

          if (!SAVE.ok) await saveTokenFor(a);

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

          navigateIfSaved(a);
        }, { capture:true });

        // キーボード操作（Enter / Space）で a 要素にフォーカスがある場合も、
        // click と同じフローでガード＆保存＆確認を行う。
        document.addEventListener('keydown', async (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          const a = document.activeElement;
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);

          if (!SAVE.ok) await saveTokenFor(a);

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

          navigateIfSaved(a);
        }, { capture:true });

      })();