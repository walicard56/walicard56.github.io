/*
 * Fôlego — convite para instalar o app (abre em tela cheia, sem a barra do navegador).
 * Não aparece quando já está instalado ou quando roda pelo app da Play Store.
 */
(function(){
  'use strict';
  const App = window.FolegoApp;
  const $ = id => document.getElementById(id);
  const KEY = 'folego-install-dismissed';
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true || document.referrer.startsWith('android-app://');
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  // Navegadores embutidos (WhatsApp, Instagram, Facebook, Gmail...) não deixam instalar.
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(ua);
  let deferred = null;

  const dismissed = () => { try{ return Date.now() - (+localStorage.getItem(KEY)||0) < 14*864e5; }catch(e){ return false; } };

  function show(kind){
    const b = $('installBanner'); if(!b || standalone || dismissed()) return;
    const txt = {
      prompt: '<b>Instale o Fôlego</b><small>Abre em tela cheia, como um app, e funciona sem internet.</small>',
      ios: '<b>Instale o Fôlego</b><small>Toque em <b>Compartilhar</b> ⬆️ e depois em <b>Adicionar à Tela de Início</b>.</small>',
      inapp: '<b>Abra no Chrome para instalar</b><small>Toque em ⋮ e em <b>Abrir no Chrome</b>; lá, ⋮ › <b>Instalar app</b>.</small>',
      menu: '<b>Instale o Fôlego</b><small>No Chrome, toque em ⋮ e depois em <b>Instalar app</b>.</small>'
    }[kind];
    b.innerHTML = '<span class="ib-ic">📲</span><span class="ib-t">' + txt + '</span>' +
      (kind === 'prompt' ? '<button class="btn-primary" id="installGo">Instalar</button>' : '') +
      '<button class="x" id="installX" aria-label="fechar">×</button>';
    b.hidden = false;
    const go = $('installGo');
    if(go) go.onclick = async () => {
      if(!deferred) return;
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => ({}));
      App.track('instalar_resposta', {aceitou: r.outcome === 'accepted'});
      deferred = null; b.hidden = true;
    };
    $('installX').onclick = () => { try{ localStorage.setItem(KEY, String(Date.now())); }catch(e){} b.hidden = true; App.track('instalar_dispensado', {tipo: kind}); };
    App.track('instalar_sugerido', {tipo: kind});
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show('prompt'); });
  window.addEventListener('appinstalled', () => { const b = $('installBanner'); if(b) b.hidden = true; App.track('app_instalado'); });

  if(!standalone){
    if(isIOS) show('ios');
    else if(inApp) show('inapp');
    else if(isAndroid) setTimeout(() => { if(!deferred) show('menu'); }, 4000);
  }
})();
