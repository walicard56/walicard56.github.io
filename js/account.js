/*
 * Fôlego — conta Google + Supabase (banco de dados dos clientes), plano Premium
 * (teste grátis de 7 dias + assinatura mensal/anual pela Google Play) e
 * sincronização dos dados na nuvem.
 *
 * Modelo freemium: o app é grátis para sempre sem login. Entrar com Google salva os
 * dados na nuvem e libera 7 dias de Premium. Depois, volta ao grátis (sem bloqueio).
 *
 * Depende de config.js, js/analytics.js e js/app.js carregados antes.
 */
(function(){
  'use strict';
  const C = Object.assign({TRIAL_DAYS:7, PRICE_LABEL:'R$ 9,99', PRICE_LABEL_ANUAL:'R$ 79,90',
    PLAY_SKU:'', PLAY_SKU_ANUAL:'', PLAY_PACKAGE:'', PLAY_STORE_LIVE:false}, window.FOLEGO_CONFIG||{});
  const STORE_URL = C.PLAY_STORE_LIVE && C.PLAY_PACKAGE ? 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(C.PLAY_PACKAGE) : '';
  const App = window.FolegoApp;
  const A = window.FolegoAnalytics || {track(){}, identify(){}, reset(){}, captureError(){}};
  const ENABLED = !!(C.GOOGLE_CLIENT_ID && C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  const DAY = 864e5;
  const PLAY_METHOD = 'https://play.google.com/billing';
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.min.js';
  const SKUS = [C.PLAY_SKU, C.PLAY_SKU_ANUAL].filter(Boolean);
  const USER_KEY = 'folego-user', PROFILE_KEY = 'folego-profile', PREM_KEY = 'folego-premium', SYNC_KEY = 'folego-sync';
  const ENDED_DISMISS_KEY = 'folego-trial-ended-dismissed';
  const welcomedKey = () => 'folego-welcomed-' + user.id;
  const welcomed = () => !!user && !!store.get(welcomedKey());
  let onboardAfterPaywall = false;

  const store = {
    get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
    set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const on = (id, fn) => { const el = $(id); if(el) el.addEventListener('click', fn); };

  let sb = null;                           // cliente Supabase
  let user = store.get(USER_KEY);          // {id,email,name,fullName,picture} — cópia local p/ abrir offline
  const prices = {[C.PLAY_SKU]: C.PRICE_LABEL, [C.PLAY_SKU_ANUAL]: C.PRICE_LABEL_ANUAL};
  let billing = null;                      // Digital Goods service (só no app instalado pela Play Store)
  let gsiState = 'loading';                // loading | ready | error
  let busy = false, signingIn = false, syncing = false;
  let rawNonce = '';                       // nonce do login (o Google recebe o hash; o Supabase confere)
  let chosenSku = C.PLAY_SKU_ANUAL || C.PLAY_SKU;
  let paywallFeature = null;

  /* ---------- plano ---------- */
  function trialStart(){
    const p = store.get(PROFILE_KEY);
    return p && user && p.uid === user.id ? p.trialStartedAt : Date.now();
  }
  const trialDaysLeft = () => Math.max(0, Math.ceil((trialStart() + C.TRIAL_DAYS*DAY - Date.now()) / DAY));
  function premiumInfo(){
    const p = store.get(PREM_KEY);
    return p && user && p.uid === user.id && p.expiresAt > Date.now() ? p : null;
  }
  /** dev (sem configuração) | guest | trial | premium | free */
  function status(){
    if(!ENABLED) return 'dev';
    if(!user) return 'guest';
    if(premiumInfo()) return 'premium';
    return trialDaysLeft() > 0 ? 'trial' : 'free';
  }
  const isPremium = () => ['dev','trial','premium'].includes(status());
  function setPremium(expiresAt, sku){
    if(!user) return;
    store.set(PREM_KEY, {uid:user.id, expiresAt: expiresAt ? Date.parse(expiresAt) : 0, sku: sku || null});
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
    [USER_KEY, PROFILE_KEY, PREM_KEY, SYNC_KEY, ENDED_DISMISS_KEY].forEach(store.del);
  }
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
      A.identify(user.id);
      await loadProfile().catch(()=>{});
      A.track('login_ok', {origem: paywallFeature ? 'paywall' : 'conta', teste_ativo: status() === 'trial'});
      App.haptic(15);
      const wasPaywall = !!paywallFeature;
      closePaywall();
      if(status() === 'premium') store.set(welcomedKey(), true);
      await afterSignedIn();
      if(welcomed()) App.toast('Bem-vindo de volta, ' + user.name + '! ☁️');
    }catch(e){
      console.error(e); A.track('login_erro'); A.captureError(e, {fonte:'login'});
      App.toast('Não foi possível entrar. Tente de novo.');
    }finally{ signingIn = false; render(); }
  }
  function renderGoogleButton(el){
    if(!el) return;
    if(signingIn){ el.innerHTML = '<div class="spinner" aria-label="entrando"></div>'; return; }
    if(gsiState === 'ready'){
      el.innerHTML = '';
      google.accounts.id.renderButton(el, {theme:'filled_black', size:'large', shape:'pill', text:'continue_with', locale:'pt-BR', width:260});
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
        auto_select: true, cancel_on_tap_outside: true, use_fedcm_for_prompt: true
      });
      gsiState = 'ready';
    }catch(e){ gsiState = 'error'; }
    document.querySelectorAll('.gsi-slot').forEach(renderGoogleButton);
  }
  async function signOut(){
    if(!confirm('Sair da conta? Seus dados ficam guardados na nuvem e voltam quando você entrar de novo.')) return;
    try{ await pushNow(); }
    catch(e){ if(!confirm('Não deu para salvar as últimas alterações na nuvem (sem internet?). Sair mesmo assim e perder essas alterações?')) return; }
    try{ await sb.auth.signOut(); }catch(e){}
    try{ google.accounts.id.disableAutoSelect(); }catch(e){}
    A.track('logout'); A.reset();
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
    A.track('conta_excluida'); A.reset();
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
    store.set(welcomedKey(), true);
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
  const fmtBRL = (v, cur) => new Intl.NumberFormat('pt-BR', {style:'currency', currency:cur||'BRL'}).format(v);
  async function initBilling(){
    if(!('getDigitalGoodsService' in window)) return;
    try{ billing = await window.getDigitalGoodsService(PLAY_METHOD); }catch(e){ billing = null; }
    if(!billing) return;
    try{
      (await billing.getDetails(SKUS)).forEach(item => {
        if(item && item.price) prices[item.itemId] = fmtBRL(+item.price.value, item.price.currency);
      });
    }catch(e){}
    render();
  }
  async function playTokens(){
    if(!billing) return [];
    try{ return (await billing.listPurchases()).filter(p => SKUS.includes(p.itemId)).map(p => p.purchaseToken); }
    catch(e){ return []; }
  }
  /** Revalida a assinatura na Google Play (via função do Supabase) e atualiza o cache. */
  async function refreshPremium(extraTokens){
    if(!sb || !user) return;
    const tokens = (extraTokens||[]).concat(await playTokens());
    try{
      const {data, error} = await sb.functions.invoke('verify-purchase', {body:{purchaseTokens:tokens}});
      if(error) throw error;
      setPremium(data && data.expires_at, data && data.product_id);
    }catch(e){
      try{
        const {data} = await sb.from('subscriptions').select('expires_at,product_id').eq('user_id', user.id).order('expires_at', {ascending:false}).limit(1);
        if(data) setPremium(data[0] && data[0].expires_at, data[0] && data[0].product_id);
      }catch(e2){}
    }
    render();
  }
  async function subscribe(sku){
    sku = sku || chosenSku;
    if(busy) return;
    if(!user){ openPaywall('assinar'); return; }
    if(!billing){
      A.track('assinatura_fora_da_play', {loja_publicada: !!STORE_URL});
      if(STORE_URL) window.open(STORE_URL, '_blank', 'noopener');
      else App.toast('A assinatura chega junto com o app na Google Play. Enquanto isso, aproveite o Premium do seu teste grátis! 💜');
      return;
    }
    busy = true; render(); A.track('assinatura_iniciada', {plano: sku === C.PLAY_SKU_ANUAL ? 'anual' : 'mensal'});
    try{
      const req = new PaymentRequest(
        [{supportedMethods: PLAY_METHOD, data: {sku}}],
        {total: {label: 'Total', amount: {currency: 'BRL', value: '0'}}}
      );
      const resp = await req.show();
      const token = resp.details && resp.details.purchaseToken;
      await resp.complete('success');
      A.track('assinatura_concluida', {plano: sku === C.PLAY_SKU_ANUAL ? 'anual' : 'mensal'});
      closePaywall();
      App.haptic([20,40,20]); App.celebrate();
      App.toast('Premium ativado. Obrigado por apoiar o Fôlego! 💜');
      await refreshPremium(token ? [token] : []);
      // Se o servidor ainda não confirmou (sem internet etc.), libera por 1 dia e revalida depois.
      if(!premiumInfo()) setPremium(new Date(Date.now() + DAY).toISOString(), sku);
    }catch(e){
      if(e && e.name !== 'AbortError'){ App.toast('A compra não foi concluída.'); A.captureError(e, {fonte:'compra'}); }
      else A.track('assinatura_cancelada');
    }finally{ busy = false; render(); }
  }
  function manageUrl(){
    const p = premiumInfo();
    return 'https://play.google.com/store/account/subscriptions?package=' + encodeURIComponent(C.PLAY_PACKAGE) +
      (p && p.sku ? '&sku=' + encodeURIComponent(p.sku) : '');
  }

  /* ---------- folha de assinatura (paywall) ---------- */
  const FEATURE_TITLES = {
    historico: 'Histórico e relatórios são Premium',
    dividas: 'Dívidas ilimitadas são Premium',
    orcamento: 'Orçamento por categoria é Premium',
    renda: 'Renda segura é Premium',
    mei: 'A área MEI é Premium',
    lumi: 'Conversar com a Lumi é Premium',
    importar: 'Importar extrato é Premium'
  };
  const BENEFITS = [
    ['📈','Histórico de todos os meses e relatórios por categoria'],
    ['🎯','Orçamento por categoria com alertas'],
    ['💳','Dívidas e parcelamentos ilimitados'],
    ['🧮','Renda segura e área MEI'],
    ['🤖','Pergunte à Lumi: “posso comprar isso?”'],
    ['🏦','Importe o extrato do banco']
  ];
  function monthlyEquivalent(){
    const raw = String(prices[C.PLAY_SKU_ANUAL]||'').replace(/[^\d,]/g,'').replace(',','.');
    const v = parseFloat(raw);
    return v ? fmtBRL(v/12) : '';
  }
  function savingPct(){
    const m = parseFloat(String(prices[C.PLAY_SKU]||'').replace(/[^\d,]/g,'').replace(',','.'));
    const y = parseFloat(String(prices[C.PLAY_SKU_ANUAL]||'').replace(/[^\d,]/g,'').replace(',','.'));
    return m && y ? Math.round((1 - y/(m*12))*100) : 0;
  }
  function openPaywall(feature){
    paywallFeature = feature || 'geral';
    A.track('paywall_visto', {recurso: paywallFeature, plano_atual: status()});
    renderPaywall();
    App.openSheet($('paywall'));
  }
  function closePaywall(){
    if(!paywallFeature) return;
    paywallFeature = null;
    App.closeSheet();
  }
  function renderPaywall(){
    const el = $('paywallBody'); if(!el || !paywallFeature) return;
    const st = status();
    const title = FEATURE_TITLES[paywallFeature] || 'Fôlego Premium';
    const canTrial = st === 'guest';
    const save = savingPct();
    const plans = SKUS.length > 1
      ? '<div class="plans">' +
          '<button class="plan-opt' + (chosenSku===C.PLAY_SKU_ANUAL?' on':'') + '" data-sku="' + esc(C.PLAY_SKU_ANUAL) + '">' +
            (save ? '<span class="save">-' + save + '%</span>' : '') +
            '<b>Anual</b><span class="num">' + esc(prices[C.PLAY_SKU_ANUAL]) + '</span><small>' + (monthlyEquivalent() ? 'só ' + esc(monthlyEquivalent()) + '/mês' : 'por ano') + '</small></button>' +
          '<button class="plan-opt' + (chosenSku===C.PLAY_SKU?' on':'') + '" data-sku="' + esc(C.PLAY_SKU) + '">' +
            '<b>Mensal</b><span class="num">' + esc(prices[C.PLAY_SKU]) + '</span><small>por mês</small></button>' +
        '</div>'
      : '';
    let cta;
    if(canTrial){
      cta = '<p class="pw-trial">Entre com o Google e ganhe <b>' + C.TRIAL_DAYS + ' dias de Premium grátis</b>. Sem cartão, sem cobrança automática.</p>' +
            '<div class="gsi gsi-slot" id="gsiPaywall"></div>';
    }else{
      const anual = chosenSku === C.PLAY_SKU_ANUAL;
      cta = (st === 'trial' ? '<p class="pw-trial">Seu teste grátis termina em <b>' + trialDaysLeft() + ' dia' + (trialDaysLeft()>1?'s':'') + '</b>. Assine para não perder o Premium.</p>' : '') +
        '<button class="btn-big" id="pwSub"' + (busy?' disabled':'') + '>' + (busy ? 'Abrindo a Play Store…' : (billing ? 'Assinar ' + (anual?'plano anual':'plano mensal') : STORE_URL ? 'Assinar pelo app na Google Play' : 'Assinatura em breve na Google Play')) + '</button>' +
        (billing ? '<button class="btn-link" id="pwRestore">Já assinei — restaurar compra</button>' : '') +
        '<p class="fine">' + esc(prices[chosenSku]) + (anual ? ' por ano' : ' por mês') + ', cobrado pela Google Play. Renova automaticamente; cancele quando quiser em Play Store › Pagamentos e assinaturas.</p>';
    }
    el.innerHTML = '<div class="pw-head"><div class="gate-logo">⭐</div><h3>' + esc(title) + '</h3>' +
      '<p class="hint">O plano grátis continua seu para sempre. O Premium leva o controle a outro nível:</p></div>' +
      '<ul class="feat">' + BENEFITS.map(b => '<li><span>'+b[0]+'</span>'+b[1]+'</li>').join('') + '</ul>' +
      (canTrial ? '' : plans) + cta;
    renderGoogleButton($('gsiPaywall'));
    el.querySelectorAll('.plan-opt').forEach(b => b.addEventListener('click', () => { chosenSku = b.dataset.sku; App.haptic(6); renderPaywall(); }));
    on('pwSub', () => subscribe(chosenSku));
    on('pwRestore', async () => { await refreshPremium(); if(status() === 'premium'){ closePaywall(); App.toast('Premium restaurado ⭐'); } else App.toast('Nenhuma assinatura ativa encontrada.'); });
  }

  /* ---------- banners ---------- */
  function renderBanner(){
    const b = $('trialBanner'); if(!b) return;
    const st = status();
    if(st === 'trial'){
      const d = trialDaysLeft();
      b.hidden = false;
      b.className = 'trial-banner' + (d <= 2 ? ' urgent' : '');
      b.innerHTML = '<span>⭐ Premium grátis: <b>' + d + ' dia' + (d>1?'s':'') + '</b> restante' + (d>1?'s':'') + '</span><button id="bannerSub">Ver planos</button>';
      on('bannerSub', () => openPaywall('geral'));
    }else if(st === 'free' && store.get(ENDED_DISMISS_KEY) !== user.id){
      b.hidden = false;
      b.className = 'trial-banner';
      b.innerHTML = '<span>Seu teste Premium acabou. O app continua grátis 💜</span><button id="bannerSub">Ver planos</button><button class="x" id="bannerX" aria-label="fechar">×</button>';
      on('bannerSub', () => openPaywall('geral'));
      on('bannerX', () => { store.set(ENDED_DISMISS_KEY, user.id); renderBanner(); });
    }else{
      b.hidden = true;
    }
  }

  /* ---------- conta ---------- */
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
    if(st === 'dev'){
      box.innerHTML = '<div class="profile"><span class="pfp">' + USER_SVG + '</span><div><b>Visitante</b><small>Seus dados ficam salvos neste aparelho</small></div></div>' +
        '<button class="btn-ghost" style="width:100%" disabled>Entrar com Google — em breve</button>';
      return;
    }
    if(st === 'guest'){
      box.innerHTML = '<div class="profile"><span class="pfp">' + USER_SVG + '</span><div><b>Visitante</b><small>Seus dados estão só neste aparelho</small></div></div>' +
        '<div class="plan"><div><b>Entre com o Google</b><small>Salve seus dados na nuvem e ganhe ' + C.TRIAL_DAYS + ' dias de Premium grátis</small></div></div>' +
        '<div class="gsi gsi-slot" id="acctLogin"></div>';
      renderGoogleButton($('acctLogin'));
      return;
    }
    const avatar = user.picture
      ? '<img class="pfp" src="' + esc(user.picture) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="pfp">' + esc((user.name||'?').charAt(0).toUpperCase()) + '</span>';
    let plan;
    if(st === 'premium'){
      const p = premiumInfo();
      plan = '<div class="plan premium"><div><b>⭐ Fôlego Premium</b><small>' + (p.sku === C.PLAY_SKU_ANUAL ? 'plano anual' : 'plano mensal') + ' · renova em ' + new Date(p.expiresAt).toLocaleDateString('pt-BR') + '</small></div>' +
        '<a class="btn-ghost" href="' + manageUrl() + '" target="_blank" rel="noopener">Gerenciar</a></div>';
    }else if(st === 'trial'){
      const d = trialDaysLeft(); const pct = Math.round((1 - d/C.TRIAL_DAYS)*100);
      plan = '<div class="plan premium"><div><b>⭐ Premium grátis</b><small>' + d + ' de ' + C.TRIAL_DAYS + ' dias restantes</small></div>' +
        '<button class="btn-primary" id="aSub">Ver planos</button></div>' +
        '<div class="bar" style="margin-top:10px"><span style="width:' + pct + '%"></span></div>';
    }else{
      plan = '<div class="plan"><div><b>Plano grátis</b><small>Premium a partir de ' + esc(monthlyEquivalent() || prices[C.PLAY_SKU]) + '/mês</small></div>' +
        '<button class="btn-primary" id="aSub">Ver planos</button></div>';
    }
    const s = syncInfo();
    const syncTxt = syncing ? 'Sincronizando…'
      : (s.dirty ? 'Alterações aguardando envio' + (navigator.onLine ? '' : ' (sem internet)') : 'Sincronizado ' + ago(s.syncedAt));
    box.innerHTML = '<div class="profile">' + avatar + '<div><b>' + esc(user.fullName || user.name) + '</b><small>' + esc(user.email) + '</small></div></div>' +
      plan +
      '<div class="setrow" style="margin-top:12px; border-top:none"><span>☁️ ' + syncTxt + '</span><button class="btn-ghost" id="aSync"' + (syncing?' disabled':'') + '>Sincronizar</button></div>' +
      '<div class="btnrow" style="margin-top:8px"><button class="btn-ghost" id="aOut">Sair</button><button class="btn-ghost danger" id="aDel">Excluir conta</button></div>';
    on('aSub', () => openPaywall('geral'));
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
    renderUserBtn(); renderGate(); renderBanner(); renderAccount(); renderPaywall();
    App.refreshPlan();
  }

  /* ---------- tela de entrada: login obrigatório e escolha do plano ---------- */
  function chooseFree(){
    store.set(welcomedKey(), true);
    A.track('plano_escolhido', {plano: 'gratis', teste_ativo: status() === 'trial'});
    App.haptic(10); render(); App.maybeOnboard();
    if(status() === 'trial') App.toast('Aproveite seus ' + trialDaysLeft() + ' dias de Premium grátis ⭐');
  }
  function chooseSubscribe(){
    store.set(welcomedKey(), true);
    A.track('plano_escolhido', {plano: 'assinar'});
    onboardAfterPaywall = true; render(); openPaywall('geral');
  }
  function renderGate(){
    const gate = $('gate'); if(!gate) return;
    const showLogin = ENABLED && !user, showChoice = ENABLED && !!user && !welcomed();
    gate.hidden = !(showLogin || showChoice);
    document.body.classList.toggle('locked', !gate.hidden);
    if(gate.hidden){ gate.innerHTML = ''; return; }
    if(showLogin){
      if(gate.dataset.step === 'login' && !signingIn && $('gsiGate') && $('gsiGate').childElementCount) return;
      gate.dataset.step = 'login';
      gate.innerHTML = '<div class="gate-card">' +
        '<div class="gate-hero"><div class="gate-logo"><svg viewBox="0 0 24 24"><path d="M4 14c3-6 7-6 8-3s4 3 8-3"/><path d="M4 20h16"/></svg></div>' +
        '<h2>Fôlego</h2><p>O controle financeiro de quem vive de renda variável.</p></div>' +
        '<ul class="feat">' + [['📊','Saiba quanto sobra no mês, mesmo com comissão'],['🛟','Monte sua reserva de emergência'],['💳','Saia das dívidas com um plano'],['☁️','Seus dados salvos na sua conta Google']]
          .map(f => '<li><span>'+f[0]+'</span>'+f[1]+'</li>').join('') + '</ul>' +
        '<div class="gsi gsi-slot" id="gsiGate"></div>' +
        '<p class="fine">Ao entrar você ganha <b>' + C.TRIAL_DAYS + ' dias de Premium grátis</b>, sem cartão.</p>' +
        '<p class="fine"><a href="privacy.html" target="_blank">Privacidade</a> · <a href="termos.html" target="_blank">Termos de uso</a></p></div>';
      renderGoogleButton($('gsiGate'));
      return;
    }
    gate.dataset.step = 'choice';
    const trial = status() === 'trial', d = trialDaysLeft();
    gate.innerHTML = '<div class="gate-card">' +
      '<div class="gate-hero"><div class="gate-logo">👋</div><h2>Olá, ' + esc(user.name) + '!</h2><p>Como você quer usar o Fôlego?</p></div>' +
      '<button class="choice premium" id="chooseSub"><span class="ch-top"><b>⭐ Premium</b><span class="ch-price">a partir de ' + esc(monthlyEquivalent() || prices[C.PLAY_SKU]) + '/mês</span></span>' +
        '<small>Histórico e relatórios, orçamento por categoria, dívidas ilimitadas, renda segura, área MEI, Lumi com IA e importação de extrato.</small></button>' +
      '<button class="choice" id="chooseFree"><span class="ch-top"><b>Básico grátis</b><span class="ch-price">R$ 0</span></span>' +
        '<small>' + (trial ? 'Começa com <b>' + d + ' dias de Premium de presente</b>. Depois, continua grátis com o essencial: mês, reserva, 1 dívida e dicas da Lumi.' : 'Mês, ganhos e gastos, reserva, 1 dívida e dicas da Lumi. Grátis para sempre.') + '</small></button>' +
      '<p class="fine">Você pode assinar ou cancelar quando quiser, em Conta e ajustes.</p></div>';
    on('chooseSub', chooseSubscribe);
    on('chooseFree', chooseFree);
  }

  /* ---------- feedback ---------- */
  async function sendFeedback(message, context){
    A.track('feedback_enviado');
    if(!sb) return false;
    try{
      const {error} = await sb.from('feedback').insert({user_id: user ? user.id : null, message: String(message).slice(0,2000), context: context||{}});
      return !error;
    }catch(e){ return false; }
  }

  /* ---------- fluxo ---------- */
  async function afterSignedIn(){
    let reloading = false;
    try{ reloading = await reconcile(); }catch(e){ console.error(e); A.captureError(e, {fonte:'sincronizacao'}); }
    if(reloading) return;
    render();
    refreshPremium();
    if(welcomed()) App.maybeOnboard();
  }

  async function boot(){
    App.setPlan({loginAvailable: false, isPremium, openPaywall, sendFeedback, storeUrl: STORE_URL});
    App.onSave(onLocalSave);
    App.onTab(tab => { if(tab === 'conta') renderAccount(); });
    App.onSheetClose(() => { paywallFeature = null; if(onboardAfterPaywall){ onboardAfterPaywall = false; setTimeout(App.maybeOnboard, 300); } });
    render();
    if(!ENABLED){ App.maybeOnboard(); return; }
    if(welcomed()) App.maybeOnboard();

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
        setUser(session.user); A.identify(user.id);
        await loadProfile().catch(()=>{});
        await afterSignedIn();
      }else if(user){
        clearLocalAccount(); // sessão expirou ou foi encerrada em outro aparelho
        render();
      }
    }catch(e){
      render(); // offline: segue com a última situação conhecida (em cache)
    }
  }

  boot();
  window.FolegoAccount = {status, isPremium, subscribe, openPaywall, client: () => sb, user: () => user};
})();
