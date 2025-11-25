      (function(){
        if (window.__cscsAListenerInstalled2) return;
        window.__cscsAListenerInstalled2 = true;

        // qid = YYYYMMDD-NNN（Aページ限定）
        const mDay  = location.pathname.match(/_build_cscs_(\d{8})/);
        const mStem = location.pathname.match(/(?:^|\/)(q\d{3})_a(?:\.html)?(?:\/)?$/i);
        if (!mDay || !mStem) return;
        const day  = mDay[1];
        const num3 = mStem[1].slice(1);
        const qid  = `${day}-${num3}`;

        // デバッグパネルは非表示（コンソール出力のみ）
        function dlog(...args){
          try{
            console.log('[A:nav-guard]', ...args);
          }catch(_){}
        }

        // 保存状態
        const SAVE = { tried:false, ok:false, lastHref:null, lastChoice:null };

        function makeToken(){
          try{
            const a = new Uint32Array(2);
            crypto.getRandomValues(a);
            return `${qid}:${a[0].toString(36)}${a[1].toString(36)}`;
          }catch(_){
            return `${qid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          }
        }

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

        // ターゲット判定（qNNN_b[.html]）
        function isTargetAnchor(el){
          if (!el || !el.getAttribute) return false;
          const raw = el.getAttribute('href') || '';
          try{
            const u = new URL(raw, location.href);
            return /(?:^|\/)q\d{3}_b(?:\.html)?(?:\/)?$/i.test(u.pathname);
          }catch(_){
            return /(?:^|\/)?q\d{3}_b(?:\.html)?(?:\/)?$/i.test(raw);
          }
        }

        // localStorage 自己診断
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

        // 保存（round-trip 検証つき、軽いリトライ）
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
            for (let i=0;i<3;i++){
              localStorage.setItem(Kt, token);
              if (choice) localStorage.setItem(Kc, choice);
              rt = localStorage.getItem(Kt);
              if (rt === token) { ok = true; break; }
              await Promise.resolve(); // microtask 相当
            }

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

        function hardBlock(ev){
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
        }

        function navigateIfSaved(a){
          if (!SAVE.ok){
            dlog('nav blocked: token missing');
            return;
          }
          const url = new URL(SAVE.lastHref || a.getAttribute('href') || '', location.href);
          requestAnimationFrame(() => location.assign(url.toString()));
        }

        // pointer 系：常にデフォルト遷移は止めて保存だけ実行（失敗なら STOP 継続）
        document.addEventListener('pointerdown', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);
          const ok = await saveTokenFor(a);
          if (!ok) dlog('pointerdown save NG');
        }, { capture:true });

        document.addEventListener('mousedown', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);
          if (!SAVE.ok) {
            const ok = await saveTokenFor(a);
            if (!ok) dlog('mousedown save NG');
          }
        }, { capture:true });

        document.addEventListener('mouseup', async (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a');
          if (!isTargetAnchor(a)) return;
          hardBlock(ev);
          if (!SAVE.ok) {
            const ok = await saveTokenFor(a);
            if (!ok) dlog('mouseup save NG');
          }
        }, { capture:true });

        // click：★最終ゲート（localStorage 実体確認）を通過したらだけ遷移
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

        // キーボード（Enter/Space）も同等のガード
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