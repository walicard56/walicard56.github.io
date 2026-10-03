/*
 * Fôlego — anúncios discretos (Google AdSense) só para o plano grátis.
 *
 * Regras para não atrapalhar:
 * - Um único bloco, na aba Mês, entre "Gastos variáveis" e "Orçamentos".
 * - Espaço reservado (não empurra a tela quando carrega) e some se não houver anúncio.
 * - Nunca aparece no Premium nem no teste grátis, nem dentro de janelas (lançar, login, pagamento).
 * - Só carrega o script do Google depois que o app abriu e com a tela parada.
 * - Anúncios não personalizados (não usam histórico de navegação da pessoa).
 * Sem ADSENSE_CLIENT e ADSENSE_SLOT no config.js, nada é carregado.
 */
(function(){
  'use strict';
  const C = window.FOLEGO_CONFIG || {};
  const App = window.FolegoApp, Acc = window.FolegoAccount || {};
  const $ = id => document.getElementById(id);
  const CLIENT = C.ADSENSE_CLIENT || '', SLOT = C.ADSENSE_SLOT || '';
  let scriptLoaded = false, filled = false, shownTracked = false, empty = false;

  const shouldShow = () => !!(CLIENT && SLOT) && Acc.status && Acc.status() === 'free';

  function loadScript(){
    if(scriptLoaded) return; scriptLoaded = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.requestNonPersonalizedAds = 1;
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CLIENT);
    s.onerror = () => { empty = true; const box = $('adSlot'); if(box) box.hidden = true; };
    document.head.append(s);
  }

  function mount(){
    const box = $('adSlot'); if(!box || filled) return;
    box.innerHTML = '<div class="ad-head"><span>Publicidade</span><button class="linkbtn" id="adRemove">Remover anúncios ⭐</button></div>' +
      '<ins class="adsbygoogle" style="display:block" data-ad-client="' + CLIENT + '" data-ad-slot="' + SLOT + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
    $('adRemove').onclick = () => { App.track('anuncio_remover_clicado'); App.requirePremium('anuncios'); };
    filled = true;
    try{ (window.adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
    // Se o Google não tiver anúncio para mostrar, o bloco some.
    const ins = box.querySelector('ins');
    new MutationObserver(() => { if(ins.getAttribute('data-ad-status') === 'unfilled'){ empty = true; box.hidden = true; } })
      .observe(ins, {attributes:true, attributeFilter:['data-ad-status']});
  }

  function refresh(){
    const box = $('adSlot'); if(!box) return;
    if(!shouldShow() || empty){ box.hidden = true; return; }
    box.hidden = false;
    if(!shownTracked){ shownTracked = true; App.track('anuncio_exibido'); }
    const go = () => { loadScript(); mount(); };
    if('requestIdleCallback' in window) requestIdleCallback(go, {timeout: 3000}); else setTimeout(go, 1500);
  }

  App.onComputed(refresh);
  if(document.readyState === 'complete') refresh(); else window.addEventListener('load', refresh);
  window.FolegoAnuncios = {refresh};
})();
