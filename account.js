/*
 * Fôlego — conta Google, teste grátis, assinatura (Google Play Billing) e backup no Drive.
 * Depende de config.js (window.FOLEGO_CONFIG) e do app (window.FolegoApp) carregados antes.
 */
(function(){
  'use strict';
  const C = Object.assign({TRIAL_DAYS:7, PRICE_LABEL:'R$ 9,99/mês', PLAY_SKU:'', PLAY_PACKAGE:'', DRIVE_BACKUP:true}, window.FOLEGO_CONFIG||{});
  const App = window.FolegoApp;
  const ENABLED = !!C.GOOGLE_CLIENT_ID;
  const DAY = 864e5;
  const PLAY_METHOD = 'https://play.google.com/billing';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const BACKUP_NAME = 'folego-backup.json';
  const USER_KEY = 'folego-user', PREM_KEY = 'folego-premium', SYNC_KEY = 'folego-last-backup';
  const PREMIUM_OFFLINE_GRACE = 3*DAY; // quanto tempo confiar na última verificação sem a Play Store

  const store = {
    get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
    set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let user = store.get(USER_KEY);          // {sub,email,name,picture}
  let premium = store.get(PREM_KEY);       // {active,checkedAt,sku}
  let price = C.PRICE_LABEL;
  let billing = null;                      // Digital Goods service (só dentro do app da Play Store)
  let gsiState = 'loading';                // loading | ready | error
  let gateStep = null;                     // null | 'restore'
  let busy = false;

  /* ---------- estado do plano ---------- */
  const trialKey = () => 'folego-trial-' + user.sub;
  function trialStart(){
    if(!user) return null;
    let t = store.get(trialKey());
    if(!t){ t = Date.now(); store.set(trialKey(), t); }
    return t;
  }
  function trialDaysLeft(){
    const t = trialStart(); if(!t) return 0;
    return Math.max(0, Math.ceil((t + C.TRIAL_DAYS*DAY - Date.now()) / DAY));
  }
  function premiumActive(){
    if(!premium || !premium.active) return false;
    if(billing) return true; // verificado agora há pouco na Play Store
    return Date.now() - (premium.checkedAt||0) < PREMIUM_OFFLINE_GRACE;
  }
  function status(){
    if(!ENABLED) return 'free';
    if(!user) return 'signedout';
    if(premiumActive()) return 'premium';
    return trialDaysLeft() > 0 ? 'trial' : 'expired';
  }
  function setPremium(active){
    premium = {active:!!active, checkedAt:Date.now(), sku:C.PLAY_SKU};
    store.set(PREM_KEY, premium);
  }

  /* ---------- Google Sign-In ---------- */
  function loadScript(src){
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true; s.defer = true;
      s.onload = res; s.onerror = rej; document.head.append(s);
    });
  }
  function decodeJwt(t){
    const b = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const bin = atob(b + '==='.slice((b.length+3)%4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function onCredential(resp){
    try{
      const p = decodeJwt(resp.credential);
      if(p.aud !== C.GOOGLE_CLIENT_ID) throw new Error('aud');
      user = {sub:p.sub, email:p.email, name:p.given_name||p.name||p.email, fullName:p.name||'', picture:p.picture||''};
      store.set(USER_KEY, user);
      trialStart();
      App.haptic(15);
      gateStep = (App.isFirstRun() && C.DRIVE_BACKUP) ? 'restore' : null;
      render();
      if(!gateStep) afterAccess();
    }catch(e){ App.toast('Não foi possível entrar. Tente de novo.'); }
  }
  function renderGoogleButton(el){
    if(!el) return;
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
      google.accounts.id.initialize({
        client_id: C.GOOGLE_CLIENT_ID, callback: onCredential,
        auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true
      });
      gsiState = 'ready';
      if(!user) google.accounts.id.prompt();
    }catch(e){ gsiState = 'error'; }
    renderGoogleButton($('gsiBtn'));
  }
  function signOut(){
    if(!confirm('Sair da conta? Seus dados continuam salvos neste aparelho.')) return;
    try{ google.accounts.id.disableAutoSelect(); }catch(e){}
    if(token){ try{ google.accounts.oauth2.revoke(token, ()=>{}); }catch(e){} }
    token = null; tokenExp = 0; user = null; store.del(USER_KEY);
    render();
  }

  /* ---------- Google Play Billing (Digital Goods API + Payment Request) ---------- */
  async function initBilling(){
    if(!('getDigitalGoodsService' in window)) return;
    try{ billing = await window.getDigitalGoodsService(PLAY_METHOD); }catch(e){ billing = null; return; }
    if(!billing) return;
    try{
      const [item] = await billing.getDetails([C.PLAY_SKU]);
      if(item && item.price){
        const p = new Intl.NumberFormat('pt-BR', {style:'currency', currency:item.price.currency}).format(+item.price.value);
        price = p + '/mês';
      }
    }catch(e){}
    await refreshPurchases();
  }
  async function refreshPurchases(){
    if(!billing) return;
    try{
      const list = await billing.listPurchases();
      setPremium(list.some(p => p.itemId === C.PLAY_SKU));
    }catch(e){}
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
      await resp.complete('success');
      setPremium(true);
      App.haptic([20,40,20]); App.celebrate();
      App.toast('Assinatura ativa. Obrigado por apoiar o Fôlego! 💜');
      refreshPurchases();
    }catch(e){
      if(e && e.name !== 'AbortError') App.toast('A compra não foi concluída.');
    }finally{ busy = false; render(); }
  }
  function manageUrl(){
    return 'https://play.google.com/store/account/subscriptions?sku=' + encodeURIComponent(C.PLAY_SKU) + '&package=' + encodeURIComponent(C.PLAY_PACKAGE);
  }

  /* ---------- Backup no Google Drive (pasta oculta do app) ---------- */
  let token = null, tokenExp = 0, tokenClient = null, fileId = null, syncTimer = null;
  const tokenValid = () => token && Date.now() < tokenExp - 60e3;
  function getToken(){
    return new Promise((resolve, reject) => {
      if(tokenValid()) return resolve(token);
      if(gsiState !== 'ready') return reject(new Error('offline'));
      if(!tokenClient){
        tokenClient = google.accounts.oauth2.initTokenClient({client_id: C.GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, callback: ()=>{}});
      }
      tokenClient.callback = r => {
        if(r.error) return reject(r);
        token = r.access_token; tokenExp = Date.now() + (r.expires_in||3600)*1000; resolve(token);
      };
      tokenClient.error_callback = reject;
      tokenClient.requestAccessToken({prompt: '', hint: user && user.email});
    });
  }
  async function drive(path, opts){
    const t = await getToken();
    const res = await fetch('https://www.googleapis.com' + path, Object.assign({cache:'no-store'}, opts, {headers: Object.assign({Authorization:'Bearer '+t}, (opts&&opts.headers)||{})}));
    if(!res.ok) throw new Error('drive ' + res.status);
    return res;
  }
  async function findBackup(){
    if(fileId) return fileId;
    const q = encodeURIComponent("name='" + BACKUP_NAME + "'");
    const r = await (await drive('/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=' + q)).json();
    fileId = r.files && r.files[0] ? r.files[0].id : null;
    return fileId;
  }
  async function backupNow(silent){
    const payload = JSON.stringify({app:'folego', v:1, savedAt:new Date().toISOString(), trialStart: user ? store.get(trialKey()) : null, state: App.getState()});
    const id = await findBackup();
    if(id){
      await drive('/upload/drive/v3/files/' + id + '?uploadType=media', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:payload});
    }else{
      const boundary = 'folego' + Date.now();
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({name: BACKUP_NAME, parents: ['appDataFolder']}) +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + payload + '\r\n--' + boundary + '--';
      const r = await (await drive('/upload/drive/v3/files?uploadType=multipart&fields=id', {method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary}, body})).json();
      fileId = r.id;
    }
    store.set(SYNC_KEY, Date.now());
    if(!silent) App.toast('Backup salvo no seu Google Drive ☁️');
    renderAccount();
  }
  async function readBackup(){
    const id = await findBackup();
    if(!id) return null;
    return (await drive('/drive/v3/files/' + id + '?alt=media')).json();
  }
  function applyBackup(data){
    if(!data || !data.state) return false;
    if(user && data.trialStart){
      const local = store.get(trialKey());
      store.set(trialKey(), local ? Math.min(local, data.trialStart) : data.trialStart);
    }
    App.replaceState(data.state);
    return true;
  }
  async function restoreNow(){
    if(!confirm('Substituir os dados deste aparelho pelo backup do Google Drive?')) return;
    try{
      const data = await readBackup();
      if(applyBackup(data)) App.toast('Dados restaurados do Drive ✅');
      else App.toast('Nenhum backup encontrado nesta conta.');
    }catch(e){ App.toast('Não foi possível acessar o Drive.'); }
    render();
  }
  function scheduleAutoBackup(){
    if(!ENABLED || !C.DRIVE_BACKUP || !user || !tokenValid()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => backupNow(true).catch(()=>{}), 8000);
  }
  async function deleteEverything(){
    if(!confirm('Excluir sua conta do Fôlego? Isso apaga TODOS os dados deste aparelho e o backup do Google Drive. Não dá para desfazer.')) return;
    if(C.DRIVE_BACKUP && gsiState === 'ready'){
      try{ const id = await findBackup(); if(id) await drive('/drive/v3/files/' + id, {method:'DELETE'}); }catch(e){}
    }
    try{ google.accounts.id.disableAutoSelect(); }catch(e){}
    if(token){ try{ google.accounts.oauth2.revoke(token, ()=>{}); }catch(e){} }
    token = null; fileId = null; user = null;
    [USER_KEY, SYNC_KEY].forEach(store.del);
    App.wipe();
    App.toast('Conta e dados excluídos.');
    render();
  }

  /* ---------- interface ---------- */
  const FEATURES = [
    ['📊','Veja quanto sobra no mês, mesmo com renda variável'],
    ['🛟','Monte sua reserva de emergência com metas'],
    ['💳','Acompanhe parcelas e saiba quando quita cada dívida'],
    ['🤖','Dicas da Lumi, sua assistente financeira']
  ];
  const featureList = () => '<ul class="feat">' + FEATURES.map(f => '<li><span>'+f[0]+'</span>'+f[1]+'</li>').join('') + '</ul>';

  function renderGate(){
    const gate = $('gate'); const st = status();
    const show = st === 'signedout' || st === 'expired' || gateStep === 'restore';
    gate.hidden = !show;
    document.body.classList.toggle('locked', show);
    if(!show){ gate.innerHTML = ''; return; }
    let html;
    if(gateStep === 'restore'){
      html = '<div class="gate-hero"><div class="gate-logo">☁️</div><h2>Olá, ' + esc(user.name) + '!</h2>' +
        '<p>Já usou o Fôlego em outro celular? Traga seus dados do Google Drive.</p></div>' +
        '<button class="btn-big" id="gRestore">Procurar meu backup</button>' +
        '<button class="btn-link" id="gFresh">Começar do zero</button>';
    }else if(st === 'signedout'){
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
    const on = (id, fn) => { const el = $(id); if(el) el.addEventListener('click', fn); };
    on('gSub', subscribe);
    on('gRefresh', async () => { await refreshPurchases(); if(status() !== 'premium') App.toast('Nenhuma assinatura ativa encontrada.'); });
    on('gExport', App.exportData);
    on('gOut', signOut);
    on('gFresh', () => { gateStep = null; render(); afterAccess(); });
    on('gRestore', async () => {
      try{
        const data = await readBackup();
        if(applyBackup(data)) App.toast('Bem-vindo de volta! Dados restaurados ✅');
        else { App.toast('Nenhum backup encontrado. Vamos começar!'); gateStep = null; render(); afterAccess(); return; }
      }catch(e){ App.toast('Não foi possível acessar o Drive.'); return; }
      gateStep = null; render();
    });
  }

  function renderBanner(){
    const b = $('trialBanner'); if(!b) return;
    const st = status();
    if(st !== 'trial'){ b.hidden = true; return; }
    const d = trialDaysLeft();
    b.hidden = false;
    b.className = 'trial-banner' + (d <= 2 ? ' urgent' : '');
    b.innerHTML = '<span>⏳ Teste grátis: <b>' + d + ' dia' + (d>1?'s':'') + '</b> restante' + (d>1?'s':'') + '</span><button id="bannerSub">Assinar</button>';
    $('bannerSub').addEventListener('click', () => App.switchTab('conta'));
  }

  function ago(ts){
    if(!ts) return 'nunca';
    const m = Math.round((Date.now()-ts)/60000);
    if(m < 1) return 'agora mesmo'; if(m < 60) return 'há ' + m + ' min';
    const h = Math.round(m/60); if(h < 24) return 'há ' + h + ' h';
    return new Date(ts).toLocaleDateString('pt-BR');
  }

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
    let backup = '';
    if(C.DRIVE_BACKUP){
      backup = '<div class="sec-head" style="margin-top:16px"><h2>Backup no Google Drive</h2></div>' +
        '<p class="hint">Último backup: ' + ago(store.get(SYNC_KEY)) + (tokenValid() ? ' · automático ligado' : '') + '</p>' +
        '<div class="btnrow"><button class="btn-ghost" id="aBackup">☁️ Salvar agora</button><button class="btn-ghost" id="aRestore">Restaurar</button></div>';
    }
    box.innerHTML = '<div class="profile">' + avatar + '<div><b>' + esc(user.fullName || user.name) + '</b><small>' + esc(user.email) + '</small></div></div>' +
      plan + backup +
      '<div class="btnrow" style="margin-top:16px"><button class="btn-ghost" id="aOut">Sair</button><button class="btn-ghost danger" id="aDel">Excluir conta</button></div>';
    const on = (id, fn) => { const el = $(id); if(el) el.addEventListener('click', fn); };
    on('aSub', subscribe);
    on('aOut', signOut);
    on('aDel', deleteEverything);
    on('aBackup', () => backupNow(false).catch(() => App.toast('Não foi possível acessar o Drive.')));
    on('aRestore', restoreNow);
  }

  const USER_SVG = '<svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:#fff;fill:none;stroke-width:1.9"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  let shownPic = null;
  function renderUserBtn(){
    const b = $('userBtn'); if(!b) return;
    const pic = user && user.picture ? user.picture : '';
    if(pic === shownPic) return;
    shownPic = pic;
    if(pic){
      const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = pic;
      img.onerror = () => { shownPic = null; b.innerHTML = USER_SVG.replace('stroke:#fff','stroke:currentColor'); };
      b.innerHTML = ''; b.append(img);
    }else{
      b.innerHTML = USER_SVG.replace('stroke:#fff','stroke:currentColor').replace('width:24px;height:24px','width:20px;height:20px');
    }
  }

  function render(){
    document.documentElement.dataset.plan = status();
    renderUserBtn();
    renderGate(); renderBanner(); renderAccount();
  }

  function afterAccess(){ App.maybeOnboard(); }

  /* ---------- início ---------- */
  App.onSave(scheduleAutoBackup);
  App.onTab(tab => { if(tab === 'conta') renderAccount(); });
  render();
  if(ENABLED){
    initGsi();
    initBilling();
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible'){ refreshPurchases(); render(); } });
    if(status() !== 'signedout' && status() !== 'expired') afterAccess();
  }else{
    afterAccess();
  }
  window.FolegoAccount = {status, subscribe};
})();
