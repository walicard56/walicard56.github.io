/*
 * Fôlego — conta Google + Supabase (banco de dados dos clientes), teste grátis,
 * assinatura (Google Play Billing) e sincronização dos dados na nuvem.
 * Depende de config.js (window.FOLEGO_CONFIG) e do app (window.FolegoApp) carregados antes.
 */
(function(){
  'use strict';
  const C = Object.assign({TRIAL_DAYS:7, PRICE_LABEL:'R$ 9,99/mês', PLAY_SKU:'', PLAY_PACKAGE:''}, window.FOLEGO_CONFIG||{});
  const App = window.FolegoApp;
  const ENABLED = !!(C.GOOGLE_CLIENT_ID && C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  const DAY = 864e5;
  const PLAY_METHOD = 'https://play.google.com/billing';
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.min.js';
  const USER_KEY = 'folego-user', PROFILE_KEY = 'folego-profile', PREM_KEY = 'folego-premium', SYNC_KEY = 'folego-sync';

  const store = {
    get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
    set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let sb = null;                           // cliente Supabase
  let user = store.get(USER_KEY);          // {id,email,name,fullName,picture} — cópia local p/ abrir offline
  let price = C.PRICE_LABEL;
  let billing = null;                      // Digital Goods service (só dentro do app da Play Store)
  let gsiState = 'loading';                // loading | ready | error
  let busy = false, signingIn = false, syncing = false;
  let rawNonce = '';                       // nonce do login (o Google recebe o hash; o Supabase confere)

  /* ---------- estado do plano ---------- */
  function trialStart(){
    const p = store.get(PROFILE_KEY);
    return p && user && p.uid === user.id ? p.trialStartedAt : Date.now();
  }
  const trialDaysLeft = () => Math.max(0, Math.ceil((trialStart() + C.TRIAL_DAYS*DAY - Date.now()) / DAY));
  function premiumActive(){
    const p = store.get(PREM_KEY);
    return !!(p && user && p.uid === user.id && p.expiresAt > Date.now());
  }
  function status(){
    if(!ENABLED) return 'free';
    if(!user) return 'signedout';
    if(premiumActive()) return 'premium';
    return trialDaysLeft() > 0 ? 'trial' : 'expired';
  }
  function setPremium(expiresAt){
    if(!user) return;
    store.set(PREM_KEY, {uid:user.id, expiresAt: expiresAt ? Date.parse(expiresAt) : 0});
  }

  /* ---------- carregamento ---------- */
  function loadScript(src){
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = res; s.onerror = rej; document.head.append(s);
    });
  }
  async function initSupabase(){
    await loadScript(SUPABASE_JS);
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:'folego-auth'}
    });
  }
  function setUser(u){
    const m = u.user_metadata || {};
    user = {id:u.id, email:u.email, name:m.given_name || (m.full_name||m.name||u.email||'').split(' ')[0],
            fullName:m.full_name||m.name||'', picture:m.avatar_url||m.picture||''};
    store.set(USER_KEY, user);
  }
  function clearLocalAccount(){
    user = null;
    [USER_KEY, PROFILE_KEY, PREM_KEY, SYNC_KEY].forEach(store.del);
  }

  /* ---------- perfil e teste grátis (vem do servidor) ---------- */
  async function loadProfile(){
    const {data, error} = await sb.from('profiles').select('trial_started_at').eq('id', user.id).maybeSingle();
    if(error) throw error;
    if(data) store.set(PROFILE_KEY, {uid:user.id, trialStartedAt: Date.parse(data.trial_started_at)});
  }

  /* ---------- Google Sign-In → Supabase Auth ---------- */
  async function onCredential(resp){
    if(!sb){ App.toast('Sem conexão. Verifique a internet e tente de novo.'); return; }
    signingIn = true; render();
    try{
      const {data, error} = await sb.auth.signInWithIdToken({provider:'google', token: resp.credential, nonce: rawNonce});
      if(error) throw error;
      setUser(data.user);
      await loadProfile().catch(()=>{});
      App.haptic(15);
      await afterSignedIn();
    }catch(e){
      console.error(e);
      App.toast('Não foi possível entrar. Tente de novo.');
    }finally{ signingIn = false; render(); }
  }
  function renderGoogleButton(el){
    if(!el) return;
    if(signingIn){ el.innerHTML = '<div class="spinner" aria-label="entrando"></div>'; return; }
    if(gsiState === 'ready'){
      el.innerHTML = '';
      google.accounts.id.renderButton(el, {theme:'filled_black', size:'large', shape:'pill', text:'continue_with', locale:'pt-BR', width:280});
    }else if(gsiState === 'error'){
      el.innerHTML = '<p class="hint" style="text-align:center">Sem conexão com o Google. Verifique a internet e <a href="" onclick="location.reload();return false">tente de novo</a>.</p>';
    }else{
      el.innerHTML = '<div class="spinner" aria-label="carregando"></div>';
    }
  }
  async function initGsi(){
    try{
      await loadScript('https://accounts.google.com/gsi/client');
      rawNonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce));
      const hashedNonce = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
      google.accounts.id.initialize({
        client_id: C.GOOGLE_CLIENT_ID, callback: onCredential, nonce: hashedNonce,
        auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true
      });
      gsiState = 'ready';
      if(!user) google.accounts.id.prompt();
    }catch(e){ gsiState = 'error'; }
    renderGoogleButton($('gsiBtn'));
  }
  async function signOut(){
    if(!confirm('Sair da conta? Seus dados ficam guardados na nuvem e voltam quando você entrar de novo.')) return;
    try{ await pushNow(); }
    catch(e){ if(!confirm('Não deu para salvar as últimas alterações na nuvem (sem internet?). Sair mesmo assim e perder essas alterações?')) return; }
    try{ await sb.auth.signOut(); }catch(e){}
    try{ google.accounts.id.disableAutoSelect(); }catch(e){}
    clearLocalAccount(); App.wipe(); render();
  }
  async function deleteAccount(){
    if(!confirm('Excluir sua conta do Fôlego? Isso apaga TODOS os seus dados da nuvem e deste aparelho. Não dá para desfazer.\n\nSe você assina o Premium, cancele também na Play Store.')) return;
    try{
      const {error} = await sb.functions.invoke('delete-account', {body:{}});
      if(error) throw error;
    }catch(e){ App.toast('Não foi possível excluir agora. Verifique a internet.'); return; }
    try{ await sb.auth.signOut({scope:'local'}); }catch(e){}
    try{ google.accounts.id.disableAutoSelect(); }catch(e){}
    clearLocalAccount(); App.wipe();
    App.toast('Conta e dados excluídos.');
    render();
  }

  /* ---------- sincronização dos dados (tabela user_data) ---------- */
  const syncInfo = () => store.get(SYNC_KEY) || {};
  let pushTimer = null;
  async function pushNow(){
    if(!sb || !user) return;
    const s = syncInfo();
    if(s.uid === user.id && !s.dirty) return;
    syncing = true; renderAccount();
    try{
      const {data, error} = await sb.from('user_data')
        .upsert({user_id:user.id, state:App.getState()}).select('updated_at').single();
      if(error) throw error;
      store.set(SYNC_KEY, {uid:user.id, syncedAt:Date.parse(data.updated_at), dirty:false});
    }finally{ syncing = false; renderAccount(); }
  }
  function applyRemote(remote){
    store.set(SYNC_KEY, {uid:user.id, syncedAt:Date.parse(remote.updated_at), dirty:false});
    App.replaceState(remote.state); // recarrega a página
  }
  /** Reconcilia aparelho × nuvem. Retorna true se a página vai recarregar. */
  async function reconcile(){
    const {data:remote, error} = await sb.from('user_data').select('state,updated_at').eq('user_id', user.id).maybeSingle();
    if(error) throw error;
    const s = syncInfo();
    if(!remote){
      if(!App.isFirstRun()){ store.set(SYNC_KEY, Object.assign(s, {uid:user.id, dirty:true})); await pushNow(); }
      return false;
    }
    const remoteAt = Date.parse(remote.updated_at);
    if(App.isFirstRun()){ applyRemote(remote); return true; }
    if(s.uid !== user.id){
      if(confirm('Encontramos dados salvos na sua conta.\n\nOK = usar os dados da nuvem\nCancelar = manter os deste aparelho (e enviar para a nuvem)')){ applyRemote(remote); return true; }
      store.set(SYNC_KEY, {uid:user.id, dirty:true}); await pushNow(); return false;
    }
    if(s.dirty){
      if(remoteAt > (s.syncedAt||0) && remoteAt > (s.modifiedAt||0)){ applyRemote(remote); return true; }
      await pushNow(); return false;
    }
    if(remoteAt > (s.syncedAt||0)){ applyRemote(remote); return true; }
    return false;
  }
  function onLocalSave(){
    if(!ENABLED || !user) return;
    const s = syncInfo();
    store.set(SYNC_KEY, Object.assign(s, {uid:user.id, dirty:true, modifiedAt:Date.now()}));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushNow().catch(()=>{}), 2500);
  }

  /* ---------- Google Play Billing + validação no servidor ---------- */
  async function initBilling(){
    if(!('getDigitalGoodsService' in window)) return;
    try{ billing = await window.getDigitalGoodsService(PLAY_METHOD); }catch(e){ billing = null; }
    if(!billing) return;
    try{
      const [item] = await billing.getDetails([C.PLAY_SKU]);
      if(item && item.price){
        price = new Intl.NumberFormat('pt-BR', {style:'currency', currency:item.price.currency}).format(+item.price.value) + '/mês';
      }
    }catch(e){}
    render();
  }
  async function playTokens(){
    if(!billing) return [];
    try{ return (await billing.listPurchases()).filter(p => p.itemId === C.PLAY_SKU).map(p => p.purchaseToken); }
    catch(e){ return []; }
  }
  /** Revalida a assinatura na Google Play (via função do Supabase) e atualiza o cache. */
  async function refreshPremium(extraTokens){
    if(!sb || !user) return;
    const tokens = (extraTokens||[]).concat(await playTokens());
    try{
      const {data, error} = await sb.functions.invoke('verify-purchase', {body:{purchaseTokens:tokens}});
      if(error) throw error;
      setPremium(data && data.expires_at);
    }catch(e){
      try{
        const {data} = await sb.from('subscriptions').select('expires_at').eq('user_id', user.id).order('expires_at', {ascending:false}).limit(1);
        if(data) setPremium(data[0] && data[0].expires_at);
      }catch(e2){}
    }
    render();
  }
  async function subscribe(){
    if(busy) return;
    if(!billing){
      if(C.PLAY_PACKAGE) window.open('https://play.google.com/store/apps/details?id=' + encodeURIComponent(C.PLAY_PACKAGE), '_blank', 'noopener');
      return;
    }
    busy = true; render();
    try{
      const req = new PaymentRequest(
        [{supportedMethods: PLAY_METHOD, data: {sku: C.PLAY_SKU}}],
        {total: {label: 'Total', amount: {currency: 'BRL', value: '0'}}}
      );
      const resp = await req.show();
      const token = resp.details && resp.details.purchaseToken;
      await resp.complete('success');
      App.haptic([20,40,20]); App.celebrate();
      App.toast('Assinatura ativa. Obrigado por apoiar o Fôlego! 💜');
      await refreshPremium(token ? [token] : []);
      // Se o servidor ainda não confirmou (sem internet etc.), libera por 1 dia e revalida depois.
      if(!premiumActive()) setPremium(new Date(Date.now() + DAY).toISOString());
    }catch(e){
      if(e && e.name !== 'AbortError') App.toast('A compra não foi concluída.');
    }finally{ busy = false; render(); }
  }
  const manageUrl = () => 'https://play.google.com/store/account/subscriptions?sku=' + encodeURIComponent(C.PLAY_SKU) + '&package=' + encodeURIComponent(C.PLAY_PACKAGE);

  /* ---------- interface ---------- */
  const FEATURES = [
    ['📊','Veja quanto sobra no mês, mesmo com renda variável'],
    ['🛟','Monte sua reserva de emergência com metas'],
    ['💳','Acompanhe parcelas e saiba quando quita cada dívida'],
    ['☁️','Seus dados salvos na nuvem, em qualquer celular']
  ];
  const featureList = () => '<ul class="feat">' + FEATURES.map(f => '<li><span>'+f[0]+'</span>'+f[1]+'</li>').join('') + '</ul>';
  const on = (id, fn) => { const el = $(id); if(el) el.addEventListener('click', fn); };

  function renderGate(){
    const gate = $('gate'); const st = status();
    const show = st === 'signedout' || st === 'expired';
    gate.hidden = !show;
    document.body.classList.toggle('locked', show);
    if(!show){ gate.innerHTML = ''; return; }
    let html;
    if(st === 'signedout'){
      html = '<div class="gate-hero"><div class="gate-logo"><svg viewBox="0 0 24 24"><path d="M4 14c3-6 7-6 8-3s4 3 8-3"/><path d="M4 20h16"/></svg></div>' +
        '<h2>Fôlego</h2><p>O controle financeiro de quem vive de renda variável.</p></div>' + featureList() +
        '<div id="gsiBtn" class="gsi"></div>' +
        '<p class="fine"><b>' + C.TRIAL_DAYS + ' dias grátis</b>, sem cartão. Depois, ' + esc(price) + '. Cancele quando quiser.</p>' +
        '<p class="fine"><a href="privacy.html" target="_blank">Privacidade</a> · <a href="termos.html" target="_blank">Termos de uso</a></p>';
    }else{
      html = '<div class="gate-hero"><div class="gate-logo">⭐</div><h2>Seu teste grátis acabou</h2>' +
        '<p>Continue no controle do seu dinheiro com o Fôlego Premium.</p></div>' + featureList() +
        '<div class="price-tag"><span class="num">' + esc(price) + '</span><small>renovação mensal · cancele quando quiser</small></div>' +
        (billing
          ? '<button class="btn-big" id="gSub"' + (busy?' disabled':'') + '>' + (busy?'Abrindo a Play Store…':'Assinar agora') + '</button>' +
            '<button class="btn-link" id="gRefresh">Já assinei — restaurar compra</button>'
          : '<button class="btn-big" id="gSub">Assinar pelo app na Google Play</button>' +
            '<p class="fine">A assinatura é feita com segurança pela Google Play, no app instalado.</p>') +
        '<div class="gate-foot"><button class="btn-link" id="gExport">Exportar meus dados</button><button class="btn-link" id="gOut">Sair (' + esc(user.email) + ')</button></div>';
    }
    gate.innerHTML = '<div class="gate-card">' + html + '</div>';
    renderGoogleButton($('gsiBtn'));
    on('gSub', subscribe);
    on('gRefresh', async () => { await refreshPremium(); if(status() !== 'premium') App.toast('Nenhuma assinatura ativa encontrada.'); });
    on('gExport', App.exportData);
    on('gOut', signOut);
  }

  function renderBanner(){
    const b = $('trialBanner'); if(!b) return;
    if(status() !== 'trial'){ b.hidden = true; return; }
    const d = trialDaysLeft();
    b.hidden = false;
    b.className = 'trial-banner' + (d <= 2 ? ' urgent' : '');
    b.innerHTML = '<span>⏳ Teste grátis: <b>' + d + ' dia' + (d>1?'s':'') + '</b> restante' + (d>1?'s':'') + '</span><button id="bannerSub">Assinar</button>';
    on('bannerSub', () => App.switchTab('conta'));
  }

  function ago(ts){
    if(!ts) return 'nunca';
    const m = Math.round((Date.now()-ts)/60000);
    if(m < 1) return 'agora mesmo'; if(m < 60) return 'há ' + m + ' min';
    const h = Math.round(m/60); if(h < 24) return 'há ' + h + ' h';
    return new Date(ts).toLocaleDateString('pt-BR');
  }
  const USER_SVG = '<svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:#fff;fill:none;stroke-width:1.9"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';

  function renderAccount(){
    const box = $('acctBox'); if(!box) return;
    const st = status();
    box.hidden = false;
    if(st === 'free'){
      box.innerHTML = '<div class="profile"><span class="pfp">' + USER_SVG + '</span><div><b>Visitante</b><small>Seus dados ficam salvos neste aparelho</small></div></div>' +
        '<button class="btn-ghost" style="width:100%" disabled>Entrar com Google — em breve</button>';
      return;
    }
    if(!user){ box.innerHTML = ''; return; }
    const avatar = user.picture
      ? '<img class="pfp" src="' + esc(user.picture) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="pfp">' + esc((user.name||'?').charAt(0).toUpperCase()) + '</span>';
    let plan;
    if(st === 'premium'){
      plan = '<div class="plan premium"><div><b>⭐ Fôlego Premium</b><small>assinatura ativa</small></div>' +
        '<a class="btn-ghost" href="' + manageUrl() + '" target="_blank" rel="noopener">Gerenciar</a></div>';
    }else{
      const d = trialDaysLeft(); const pct = Math.round((1 - d/C.TRIAL_DAYS)*100);
      plan = '<div class="plan"><div><b>Teste grátis</b><small>' + d + ' de ' + C.TRIAL_DAYS + ' dias restantes</small></div>' +
        '<button class="btn-primary" id="aSub"' + (busy?' disabled':'') + '>Assinar</button></div>' +
        '<div class="bar" style="margin-top:10px"><span style="width:' + pct + '%"></span></div>';
    }
    const s = syncInfo();
    const syncTxt = syncing ? 'Sincronizando…'
      : (s.dirty ? 'Alterações aguardando envio' + (navigator.onLine ? '' : ' (sem internet)') : 'Sincronizado ' + ago(s.syncedAt));
    box.innerHTML = '<div class="profile">' + avatar + '<div><b>' + esc(user.fullName || user.name) + '</b><small>' + esc(user.email) + '</small></div></div>' +
      plan +
      '<div class="setrow" style="margin-top:12px; border-top:none"><span>☁️ ' + syncTxt + '</span><button class="btn-ghost" id="aSync"' + (syncing?' disabled':'') + '>Sincronizar</button></div>' +
      '<div class="btnrow" style="margin-top:8px"><button class="btn-ghost" id="aOut">Sair</button><button class="btn-ghost danger" id="aDel">Excluir conta</button></div>';
    on('aSub', subscribe);
    on('aOut', signOut);
    on('aDel', deleteAccount);
    on('aSync', async () => {
      if(!sb){ App.toast('Sem conexão com a nuvem agora.'); return; }
      try{ if(!(await reconcile())){ await pushNow(); App.toast('Tudo sincronizado ☁️'); } }
      catch(e){ App.toast('Sem conexão com a nuvem agora.'); }
    });
  }

  let shownPic = null;
  function renderUserBtn(){
    const b = $('userBtn'); if(!b) return;
    const pic = user && user.picture ? user.picture : '';
    if(pic === shownPic) return;
    shownPic = pic;
    const icon = () => USER_SVG.replace('stroke:#fff','stroke:currentColor').replace('width:24px;height:24px','width:20px;height:20px');
    if(pic){
      const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = pic;
      img.onerror = () => { b.innerHTML = icon(); };
      b.innerHTML = ''; b.append(img);
    }else{
      b.innerHTML = icon();
    }
  }

  function render(){
    document.documentElement.dataset.plan = status();
    renderUserBtn(); renderGate(); renderBanner(); renderAccount();
  }

  /* ---------- fluxo ---------- */
  async function afterSignedIn(){
    let reloading = false;
    try{ reloading = await reconcile(); }catch(e){ console.error(e); }
    if(reloading) return;
    render();
    refreshPremium();
    if(status() === 'trial' || status() === 'premium') App.maybeOnboard();
  }

  async function boot(){
    App.onSave(onLocalSave);
    App.onTab(tab => { if(tab === 'conta') renderAccount(); });
    render();
    if(!ENABLED){ App.maybeOnboard(); return; }

    initGsi();
    initBilling();
    window.addEventListener('online', () => { if(syncInfo().dirty) pushNow().catch(()=>{}); });
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'hidden' && syncInfo().dirty) pushNow().catch(()=>{});
      if(document.visibilityState === 'visible' && user && sb) refreshPremium();
    });

    try{
      await initSupabase();
      const {data:{session}} = await sb.auth.getSession();
      if(session){
        setUser(session.user);
        await loadProfile().catch(()=>{});
        await afterSignedIn();
      }else if(user){
        clearLocalAccount(); // sessão expirou ou foi encerrada em outro aparelho
        render();
      }
    }catch(e){
      // Offline: segue com a última situação conhecida (usuário, teste e assinatura em cache).
      render();
      if(status() === 'trial' || status() === 'premium') App.maybeOnboard();
    }
  }

  boot();
  window.FolegoAccount = {status, subscribe};
})();
