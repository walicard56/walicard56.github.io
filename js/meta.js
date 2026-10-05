/*
 * Fôlego — "Meta do mês" para renda variável.
 * Mostra quanto ainda falta entrar para fechar o mês (e guardar, se a pessoa quiser)
 * e traduz isso em vendas, corridas ou serviços — no total e por dia. Recurso grátis.
 */
(function(){
  'use strict';
  const App = window.FolegoApp;
  const $ = id => document.getElementById(id);
  const S = () => App.getState();
  const TIPOS = {
    comissao: {emoji:'🛍️', nome:'Comissão sobre vendas', campo:'Sua comissão (% sobre o que vende)', unidade:'em vendas', sufixo:'%'},
    corrida:  {emoji:'🚗', nome:'Corridas / entregas', campo:'Quanto sobra, em média, por corrida (R$)', unidade:'corridas', sufixo:'R$'},
    servico:  {emoji:'🛠️', nome:'Serviços / freelas / diárias', campo:'Quanto ganha, em média, por serviço (R$)', unidade:'serviços', sufixo:'R$'}
  };
  let editing = false;

  function cfg(){ const st = S(); if(!st.config.meta) st.config.meta = {tipo:null, taxa:0, valor:0, guardar:0}; return st.config.meta; }
  function diasRestantes(){
    if(S().current !== App.todayId) return 0;
    const d = new Date(), fim = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    return fim - d.getDate() + 1;
  }

  /** Números da meta do mês aberto. */
  function calc(){
    const c = cfg(), st = S(), m = App.cur(), n = App.monthNumbers(st.current);
    const comReal = n.comOn ? (+m.comReal||0) : 0;
    let recebido = comReal + n.extras;
    // Comissão ainda não paga: estima pelo que já vendeu.
    if(c.tipo === 'comissao' && !comReal && +m.vendas > 0 && +c.taxa > 0) recebido += +m.vendas * (+c.taxa/100);
    const necessario = Math.max(0, n.gastos + (+c.guardar||0) - n.ganhoFixo);
    const falta = Math.max(0, necessario - recebido);
    let unidades = 0;
    if(c.tipo === 'comissao' && +c.taxa > 0) unidades = falta / (+c.taxa/100);
    else if((c.tipo === 'corrida' || c.tipo === 'servico') && +c.valor > 0) unidades = Math.ceil(falta / +c.valor);
    const dias = diasRestantes();
    return {c, necessario, recebido, falta, unidades, dias, porDia: dias ? falta/dias : 0, unidadesDia: dias ? unidades/dias : 0};
  }
  const fmtUnid = (c, u) => c.tipo === 'comissao' ? App.money(u) + ' em vendas' : Math.ceil(u) + ' ' + TIPOS[c.tipo].unidade;

  function paint(){
    const box = $('metaCard'); if(!box) return;
    const c = cfg();
    if(c.tipo === 'nenhum'){ box.hidden = true; return; }
    box.hidden = false;
    if(!c.tipo || editing){ paintSetup(box, c); return; }
    const r = calc(), t = TIPOS[c.tipo];
    const pct = r.necessario > 0 ? Math.min(100, r.recebido / r.necessario * 100) : 100;
    let corpo;
    if(r.necessario <= 0){
      corpo = '<p class="meta-big pos-text">Sua renda fixa já cobre tudo 💚</p><p class="hint">Toda ' + t.nome.toLowerCase() + ' deste mês é sobra. Que tal definir quanto quer guardar? Toque em "ajustar".</p>';
    }else if(r.falta <= 0){
      corpo = '<p class="meta-big pos-text">Meta batida! 🎉</p><p class="hint">O que entrar daqui pra frente é sobra' + (+c.guardar ? '' : ' — ótimo momento pra reforçar a reserva') + '.</p>';
    }else{
      const conv = (+c.taxa > 0 || +c.valor > 0) ? fmtUnid(c, r.unidades) : '';
      corpo = '<p class="meta-big">Faltam <b class="num">' + App.money(r.falta) + '</b></p>' +
        (conv ? '<p class="meta-conv">' + t.emoji + ' ≈ <b>' + conv + '</b></p>' : '') +
        (r.dias ? '<p class="hint">Em ' + r.dias + ' dia' + (r.dias>1?'s':'') + ': <b>' + App.money(r.porDia) + ' por dia</b>' +
          (conv ? ' (' + (c.tipo === 'comissao' ? App.money(r.unidadesDia) + ' em vendas' : (r.unidadesDia < 1 ? 'menos de 1' : '≈ ' + Math.ceil(r.unidadesDia)) + ' ' + t.unidade) + '/dia)' : '') + '</p>' : '');
    }
    box.innerHTML = '<div class="sec-head"><h2>🎯 Meta do mês</h2><button class="linkbtn" id="metaEdit">ajustar</button></div>' + corpo +
      (r.necessario > 0 ? '<div class="mtrack" style="margin-top:10px" role="img" aria-label="' + Math.round(pct) + '% da meta"><span style="width:' + pct + '%"></span></div>' +
        '<div class="mfoot">' + App.money(r.recebido) + ' de ' + App.money(r.necessario) + ' em renda variável' + (+c.guardar ? ' (inclui ' + App.money(+c.guardar) + ' para guardar)' : '') + '</div>' : '') +
      (c.tipo === 'comissao'
        ? '<div class="row" style="margin-top:8px"><span class="name">Vendi até agora</span><span class="cur">R$</span><input class="val num" id="metaVendas" type="number" inputmode="decimal" aria-label="vendas até agora"></div>'
        : '<button class="add" id="metaAdd">+ registrar ' + (c.tipo === 'corrida' ? 'ganhos de corridas' : 'ganho de serviço') + '</button>');
    $('metaEdit').onclick = () => { editing = true; paint(); };
    const v = $('metaVendas');
    if(v){ v.value = App.cur().vendas || ''; v.onchange = () => { App.cur().vendas = parseFloat(v.value)||0; App.markTouched(); App.save(); App.updateComputed(false); App.track('meta_vendas_atualizadas'); }; }
    const add = $('metaAdd');
    if(add) add.onclick = () => App.openQuick('extra', c.tipo === 'corrida' ? 'Corridas' : 'Serviço');
  }

  function paintSetup(box, c){
    const tipo = c.tipo && c.tipo !== 'nenhum' ? c.tipo : null;
    box.innerHTML = '<div class="sec-head"><h2>🎯 Meta do mês</h2>' + (c.tipo ? '<button class="linkbtn" id="metaCancel">fechar</button>' : '') + '</div>' +
      '<p class="hint" style="margin-bottom:8px">Como você ganha a parte variável? A gente calcula quanto falta pra fechar o mês.</p>' +
      '<div class="meta-tipos">' + Object.entries(TIPOS).map(([k,t]) => '<button data-tipo="' + k + '" class="' + (tipo===k?'on':'') + '">' + t.emoji + ' ' + t.nome + '</button>').join('') +
      '<button data-tipo="nenhum">Não tenho renda variável</button></div>' +
      (tipo ? '<label class="hint" for="metaNum">' + TIPOS[tipo].campo + '</label><input class="field-in" id="metaNum" type="number" inputmode="decimal" style="margin-top:6px">' +
        '<label class="hint" for="metaGuardar">Quanto quer guardar este mês? (opcional)</label><input class="field-in" id="metaGuardar" type="number" inputmode="decimal" placeholder="R$ 0" style="margin-top:6px">' +
        '<button class="btn-big" id="metaSave">Calcular minha meta</button>' : '');
    box.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
      if(b.dataset.tipo === 'nenhum'){ c.tipo = 'nenhum'; editing = false; App.save(); paint(); App.toast('Tudo bem! Dá pra ligar de novo em Conta e ajustes.'); App.track('meta_tipo', {tipo:'nenhum'}); return; }
      c.tipo = b.dataset.tipo; editing = true; paint();
    });
    const num = $('metaNum');
    if(num){ num.value = tipo === 'comissao' ? (c.taxa || '') : (c.valor || ''); $('metaGuardar').value = c.guardar || ''; setTimeout(() => num.focus(), 50); }
    const save = $('metaSave');
    if(save) save.onclick = () => {
      const v = parseFloat(num.value)||0;
      if(v <= 0){ num.focus(); App.haptic([10,40,10]); return; }
      if(tipo === 'comissao') c.taxa = Math.min(100, v); else c.valor = v;
      c.guardar = parseFloat($('metaGuardar').value)||0;
      editing = false; App.save(); App.haptic(15); paint();
      App.track('meta_tipo', {tipo, guardar: c.guardar > 0});
    };
    const cancel = $('metaCancel'); if(cancel) cancel.onclick = () => { editing = false; paint(); };
  }

  /** Reativa a meta (usado em Conta e ajustes). */
  function reativar(){ const c = cfg(); if(c.tipo === 'nenhum') c.tipo = null; editing = !c.tipo; App.save(); paint(); App.switchTab('mes'); }

  const btn = $('metaConfig'); if(btn) btn.onclick = () => { editing = true; const c = cfg(); if(c.tipo === 'nenhum') c.tipo = null; paint(); App.switchTab('mes'); };
  App.onComputed(paint);
  paint();
  window.FolegoMeta = {calc, reativar};
})();
