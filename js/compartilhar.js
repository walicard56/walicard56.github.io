/*
 * Fôlego — crescimento: "Indique e ganhe" e cartões de conquista para compartilhar.
 * Todo compartilhamento leva o link de convite da pessoa (?ref=CODIGO): quem entra por ele
 * ganha +7 dias de Premium, e quem indicou também.
 */
(function(){
  'use strict';
  const App = window.FolegoApp, Acc = window.FolegoAccount || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const BASE = 'https://walicard56.github.io/';
  const logged = () => Acc.status && ['trial','premium','free'].includes(Acc.status());

  async function inviteUrl(){
    const code = logged() && Acc.myRefCode ? await Acc.myRefCode().catch(() => null) : null;
    return {url: code ? BASE + '?ref=' + code : BASE, code};
  }
  function inviteText(intro){
    return (intro ? intro + '\n\n' : '') + 'Tô usando o Fôlego pra organizar minha renda variável: ele mostra quanto falta pra fechar o mês 🎯';
  }
  async function shareText(text, url, origem){
    App.track('compartilhar', {origem, metodo: navigator.share ? 'nativo' : 'copiar'});
    if(navigator.share){ try{ await navigator.share({title:'Fôlego', text, url}); return; }catch(e){ if(e && e.name === 'AbortError') return; } }
    try{ await navigator.clipboard.writeText(text + '\n' + url); App.toast('Convite copiado! Cole no WhatsApp 💬'); }
    catch(e){ App.toast(url); }
  }
  const whatsappLink = (text, url) => 'https://wa.me/?text=' + encodeURIComponent(text + '\n' + url);

  /* ---------- Indique e ganhe (Conta e ajustes) ---------- */
  async function paintInvite(){
    const box = $('inviteBox'); if(!box) return;
    if(!logged()){ box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="sec-head"><h2>🎁 Indique e ganhe</h2></div>' +
      '<p class="hint">Cada amigo que entrar pelo seu link ganha <b>7 dias de Premium</b>, e você também (até 84 dias).</p>' +
      '<div class="invite-code"><span>Seu código</span><b class="num" id="invCode">…</b><small id="invCount"></small></div>' +
      '<div class="btnrow"><a class="btn-primary wa" id="invWa" href="#" target="_blank" rel="noopener">Convidar pelo WhatsApp</a><button class="btn-ghost" id="invShare">Outros apps</button></div>';
    const {url, code} = await inviteUrl();
    const text = inviteText('Entra pelo meu link e ganha 7 dias de Premium grátis:');
    $('invCode').textContent = code || '—';
    $('invWa').href = whatsappLink(text, url);
    $('invWa').onclick = () => App.track('compartilhar', {origem:'convite', metodo:'whatsapp'});
    $('invShare').onclick = () => shareText(text, url, 'convite');
    const n = Acc.myReferrals ? await Acc.myReferrals() : 0;
    $('invCount').textContent = n ? (n>1 ? n + ' amigos entraram' : '1 amigo entrou') + ' pelo seu link' : 'Nenhum amigo ainda — o primeiro já vale 7 dias!';
  }

  /* ---------- cartões de conquista (formato stories) ---------- */
  let current = null;
  const THEMES = {
    mes:     {c1:'#0f9d6b', c2:'#3ecf9a', emoji:'💚'},
    divida:  {c1:'#4f46e5', c2:'#7c6cff', emoji:'🏆'},
    reserva: {c1:'#c06f1e', c2:'#e7b24e', emoji:'🛟'},
    meta:    {c1:'#4f46e5', c2:'#3ecf9a', emoji:'🎯'}
  };
  function wrap(ctx, text, maxW){
    const words = text.split(' '), lines = []; let line = '';
    words.forEach(w => { const t = line ? line + ' ' + w : w; if(ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; });
    if(line) lines.push(line); return lines;
  }
  async function draw(card, showValues, code){
    const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), th = THEMES[card.tipo] || THEMES.mes;
    try{ await document.fonts.ready; }catch(e){}
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, th.c1); g.addColorStop(1, th.c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // brilhos decorativos
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    [[880,260,260],[140,1500,320],[960,1700,180]].forEach(([x,y,r]) => { ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); });
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '700 64px "Space Grotesk", system-ui, sans-serif'; ctx.fillText('Fôlego', W/2, 200);
    ctx.font = '400 36px Inter, system-ui, sans-serif'; ctx.globalAlpha = .85; ctx.fillText('controle de quem vive de renda variável', W/2, 260); ctx.globalAlpha = 1;
    ctx.font = '220px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'; ctx.fillText(card.emoji || th.emoji, W/2, 720);
    ctx.font = '700 92px "Space Grotesk", system-ui, sans-serif';
    let y = 900; wrap(ctx, card.titulo, W - 160).forEach(l => { ctx.fillText(l, W/2, y); y += 108; });
    const sub = showValues && card.valor ? card.valor : card.semValor;
    if(sub){ ctx.font = '600 60px "Space Grotesk", system-ui, sans-serif'; y += 40; wrap(ctx, sub, W - 200).forEach(l => { ctx.fillText(l, W/2, y); y += 76; }); }
    // rodapé com convite
    ctx.fillStyle = 'rgba(255,255,255,.95)'; const bx = 90, by = 1560, bw = W - 180, bh = 230, r = 40;
    ctx.beginPath(); ctx.moveTo(bx+r,by); ctx.arcTo(bx+bw,by,bx+bw,by+bh,r); ctx.arcTo(bx+bw,by+bh,bx,by+bh,r); ctx.arcTo(bx,by+bh,bx,by,r); ctx.arcTo(bx,by,bx+bw,by,r); ctx.fill();
    ctx.fillStyle = th.c1; ctx.font = '700 46px "Space Grotesk", system-ui, sans-serif'; ctx.fillText('Baixe grátis: walicard56.github.io', W/2, by + 92);
    ctx.fillStyle = '#444'; ctx.font = '400 38px Inter, system-ui, sans-serif';
    ctx.fillText(code ? 'Código ' + code + ' = +7 dias de Premium 🎁' : 'Organize sua comissão, corridas e freelas', W/2, by + 160);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  async function openCard(card){
    current = card; App.track('cartao_aberto', {tipo: card.tipo});
    const body = $('shareBody');
    body.innerHTML = '<h3>Compartilhe sua conquista</h3>' +
      '<div class="share-prev"><img id="sharePrev" alt="prévia do cartão"></div>' +
      (card.valor ? '<div class="setrow" style="border-top:none"><span>Mostrar valores<small class="hint" style="display:block">desligado, ninguém vê quanto você ganha ou deve</small></span><label class="switch" style="margin:0"><input type="checkbox" id="shareVals"><span class="track"></span></label></div>' : '') +
      '<button class="btn-big" id="shareGo">Compartilhar</button><button class="btn-link" id="shareDl">Baixar imagem</button>';
    App.openSheet($('shareSheet'));
    const {url, code} = await inviteUrl();
    let blob;
    const render = async () => {
      blob = await draw(card, !!($('shareVals') && $('shareVals').checked), code);
      const img = $('sharePrev'); if(img){ if(img.src) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(blob); }
    };
    await render();
    const vals = $('shareVals'); if(vals) vals.onchange = render;
    const text = inviteText(card.texto) + '\nEntra pelo meu link e ganha 7 dias de Premium:';
    $('shareGo').onclick = async () => {
      const file = new File([blob], 'folego-conquista.png', {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        App.track('compartilhar', {origem:'cartao_' + card.tipo, metodo:'imagem'});
        try{ await navigator.share({files:[file], text: text + ' ' + url}); App.closeSheet(); }catch(e){}
      }else{ download(blob); await shareText(text, url, 'cartao_' + card.tipo); }
    };
    $('shareDl').onclick = () => { download(blob); App.track('cartao_baixado', {tipo: card.tipo}); };
  }
  function download(blob){
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'folego-conquista.png';
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------- quando oferecer ---------- */
  App.onAchievement(ev => {
    let card;
    if(ev.tipo === 'divida') card = {tipo:'divida', emoji:'🏆', titulo:'Quitei uma dívida!', valor: ev.total ? 'Foram ' + App.money(ev.total) + ' pagos' : '', semValor:'Uma parcela a menos todo mês', texto:'🏆 Quitei uma dívida!'};
    else if(ev.tipo === 'reserva') card = {tipo:'reserva', emoji:'🛟', titulo:'Minha reserva chegou a ' + ev.pct + '% da meta!', valor: App.money(ev.atual) + ' guardados', semValor:'Mais fôlego pros meses fracos', texto:'🛟 Minha reserva de emergência chegou a ' + ev.pct + '% da meta!'};
    if(card) setTimeout(() => App.toast(card.titulo + ' Que tal mostrar?', 'Compartilhar', () => openCard(card)), 1800);
  });
  function monthCard(){
    const st = App.getState(), n = App.monthNumbers(st.current);
    const mes = App.fmtMonth(st.current).split(' ')[0].toLowerCase();
    if(n.sobra > 0) return {tipo:'mes', emoji:'💚', titulo:'Fechei ' + mes + ' no azul!', valor:'Sobrou ' + App.money(n.sobra), semValor: n.ganhos ? 'Guardei ' + Math.round(n.sobra/n.ganhos*100) + '% do que entrou' : '', texto:'💚 Fechei ' + mes + ' no azul!'};
    return {tipo:'meta', emoji:'🎯', titulo:'Tô no controle da minha renda variável', valor:'', semValor:'Sei quanto falta pra fechar o mês', texto:'🎯 Tô no controle da minha renda variável!'};
  }
  function paintMonthShare(){
    const b = $('shareMonth'); if(!b) return;
    const n = App.monthNumbers(App.getState().current);
    b.hidden = !(n && n.sobra > 0 && n.ganhos > 0);
  }

  const sm = $('shareMonth'); if(sm) sm.onclick = () => openCard(monthCard());
  App.onTab(tab => { if(tab === 'conta') paintInvite(); });
  App.onComputed(paintMonthShare);
  paintMonthShare();
  window.FolegoShare = {openCard, monthCard, inviteUrl, draw};
})();
