/*
 * Fôlego — estatísticas de uso anônimas e captura de erros (PostHog).
 * Não envia nada se POSTHOG_KEY estiver vazio no config.js ou se o usuário desligar
 * em Conta e ajustes. Nunca envia valores financeiros, nomes ou e-mails.
 */
(function(){
  'use strict';
  const C = window.FOLEGO_CONFIG || {};
  const KEY = C.POSTHOG_KEY || '';
  const HOST = (C.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
  const ID_KEY = 'folego-anon-id', OPT_KEY = 'folego-analytics-off';
  const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const set = (k,v) => { try{ v==null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch(e){} };

  let distinctId = get(ID_KEY);
  if(!distinctId){
    distinctId = 'anon-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2,'0')).join('');
    set(ID_KEY, distinctId);
  }
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const base = () => ({
    $current_url: location.origin + location.pathname,
    plataforma: document.referrer.startsWith('android-app://') ? 'play' : (standalone ? 'pwa' : 'web'),
    plano: document.documentElement.dataset.plan || 'desconhecido'
  });
  const enabled = () => !!KEY && get(OPT_KEY) !== '1';
  const recent = [];

  function send(event, props){
    if(!enabled()) return;
    const body = JSON.stringify({api_key:KEY, event, distinct_id:distinctId, timestamp:new Date().toISOString(), properties:Object.assign(base(), props||{})});
    try{
      if(navigator.sendBeacon && navigator.sendBeacon(HOST + '/capture/', new Blob([body], {type:'text/plain'}))) return;
    }catch(e){}
    fetch(HOST + '/capture/', {method:'POST', body, keepalive:true, headers:{'Content-Type':'application/json'}}).catch(()=>{});
  }

  function track(event, props){ send(event, props); }

  /** Liga o id anônimo ao id interno da conta (não é o e-mail). */
  function identify(userId){
    if(!userId || distinctId === userId) return;
    const prev = distinctId; distinctId = userId; set(ID_KEY, userId);
    send('$identify', {$anon_distinct_id: prev});
  }
  function reset(){
    distinctId = 'anon-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2,'0')).join('');
    set(ID_KEY, distinctId);
  }

  function captureError(err, extra){
    const message = String((err && err.message) || err || 'erro').slice(0, 300);
    const key = message + (extra && extra.fonte || '');
    if(recent.includes(key)) return; // não repetir o mesmo erro na sessão
    recent.push(key); if(recent.length > 20) recent.shift();
    send('app_error', Object.assign({mensagem:message, pilha:String((err && err.stack) || '').slice(0, 1500)}, extra||{}));
  }
  window.addEventListener('error', e => captureError(e.error || e.message, {fonte:(e.filename||'').split('/').pop() + ':' + e.lineno}));
  window.addEventListener('unhandledrejection', e => captureError(e.reason, {fonte:'promise'}));

  window.FolegoAnalytics = {
    track, identify, reset, captureError,
    available: () => !!KEY,
    isOptedOut: () => get(OPT_KEY) === '1',
    setOptOut: off => set(OPT_KEY, off ? '1' : null)
  };
  window.addEventListener('load', () => track('app_aberto'));
})();
