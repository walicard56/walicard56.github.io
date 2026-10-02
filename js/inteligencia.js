/*
 * Fôlego — recursos para renda variável: renda segura, meta de reserva sugerida e área MEI.
 * Carregado depois de js/app.js.
 */
(function(){
  'use strict';
  const App = window.FolegoApp;
  const $ = id => document.getElementById(id);
  const S = () => App.getState();
  const MEI_LIMITE_PADRAO = 81000; // limite anual do MEI; editável na própria área

  /* ---------- renda segura ---------- */
  /** Renda dos meses já fechados (até 6), do mais recente ao mais antigo. */
  function closedIncomes(){
    const st = S();
    return Object.keys(st.months).filter(id => id < App.todayId && st.months[id].touched).sort().reverse().slice(0, 6)
      .map(id => ({id, renda: App.monthNumbers(id).ganhos})).filter(m => m.renda > 0);
  }
  /** {segura, media, meses} — segura é o pior mês recente; null com menos de 2 meses fechados. */
  function rendaSegura(){
    const ms = closedIncomes();
    if(ms.length < 2) return null;
    const vals = ms.map(m => m.renda);
    return {segura: Math.min(...vals), media: vals.reduce((a,b) => a+b, 0)/vals.length, meses: ms.length};
  }
  function paintRenda(){
    const box = $('rendaCard'); if(!box) return;
    if(!App.isPremium()){
      box.innerHTML = '<div class="mini-lock"><span>🧮 <b>Renda segura</b> — descubra com quanto você pode contar todo mês</span><span class="tag">⭐ Premium</span></div>';
      box.onclick = () => App.requirePremium('renda'); box.classList.add('clickable'); return;
    }
    box.onclick = null; box.classList.remove('clickable');
    const r = rendaSegura(), n = App.monthNumbers(S().current);
    if(!r){
      box.innerHTML = '<div class="sec-head"><h2>🧮 Renda segura</h2></div><p class="hint">Aparece quando houver 2 meses fechados no histórico. Até lá, planeje o mês só com a renda fixa: <b class="num">' + App.money(n.ganhoFixo) + '</b>.</p>';
      return;
    }
    const diff = n.ganhos - r.segura;
    const msg = S().current !== App.todayId ? ''
      : diff > 0 ? '<p class="renda-msg pos">Este mês está entrando <b>' + App.money(diff) + ' acima</b> da sua renda segura. Que tal mandar esse extra para a reserva ou dívidas?</p>'
      : diff < 0 ? '<p class="renda-msg neg">Este mês está <b>' + App.money(-diff) + ' abaixo</b> da renda segura. Segure os gastos variáveis.</p>' : '';
    box.innerHTML = '<div class="sec-head"><h2>🧮 Renda segura</h2><span class="sec-total num">' + App.money(r.segura) + '</span></div>' +
      '<p class="hint">É o que entrou no seu pior mês dos últimos ' + r.meses + '. Monte seu orçamento com esse valor; a média foi ' + App.money(r.media) + '.</p>' + msg;
  }

  /* ---------- meta de reserva sugerida (grátis) ---------- */
  function paintReservaSugerida(){
    const box = $('resSugerida'); if(!box) return;
    const n = App.monthNumbers(S().current);
    const sugerida = Math.round(n.fixoCompromisso * 6 / 100) * 100;
    if(sugerida <= 0){ box.hidden = true; return; }
    box.hidden = false;
    const igual = Math.abs((+S().reserva.meta||0) - sugerida) < 1;
    box.innerHTML = '<div class="sec-head"><h2>Meta sugerida</h2><span class="sec-total num">' + App.money(sugerida) + '</span></div>' +
      '<p class="hint">Para renda variável, o ideal é ter 6 meses de contas fixas e parcelas (' + App.money(n.fixoCompromisso) + '/mês) guardados.</p>' +
      (igual ? '<p class="hint pos-text">✓ Sua meta já segue essa recomendação.</p>' : '<button class="add" id="resUsarSugerida">Usar ' + App.money(sugerida) + ' como meta</button>');
    const b = $('resUsarSugerida');
    if(b) b.onclick = () => { S().reserva.meta = sugerida; App.save(); App.updateComputed(true); App.track('meta_sugerida_usada'); App.toast('Meta da reserva atualizada 🎯'); };
  }

  /* ---------- área MEI ---------- */
  function mei(){ const st = S(); if(!st.mei) st.mei = {ativo:false, das:0, limite:MEI_LIMITE_PADRAO, faturamento:{}}; return st.mei; }
  function paintMei(){
    const box = $('meiCard'); if(!box) return;
    const m = mei();
    const t = $('toggleMei'); if(t) t.checked = !!m.ativo;
    if(!m.ativo){ box.hidden = true; return; }
    box.hidden = false;
    if(!App.isPremium()){
      box.innerHTML = '<div class="mini-lock"><span>💼 <b>Área MEI</b> — DAS em dia e limite de faturamento sob controle</span><span class="tag">⭐ Premium</span></div>';
      box.onclick = () => App.requirePremium('mei'); box.classList.add('clickable'); return;
    }
    box.onclick = null; box.classList.remove('clickable');
    const ano = S().current.slice(0,4), limite = +m.limite || MEI_LIMITE_PADRAO;
    const fatAno = Object.entries(m.faturamento).filter(([id]) => id.startsWith(ano)).reduce((s,[,v]) => s + (+v||0), 0);
    const pct = Math.min(100, fatAno/limite*100);
    const st = pct >= 100 ? {cls:'over', txt:'🔴 Passou do limite do MEI. Procure um contador: pode ser preciso migrar para ME.'}
      : pct >= 80 ? {cls:'warn', txt:'⚠️ Já usou ' + Math.round(pct) + '% do limite anual. Planeje o restante do ano.'}
      : {cls:'ok', txt:'Disponível no ano: ' + App.money(limite - fatAno)};
    const temDas = (App.cur().fixos||[]).some(f => /\bdas\b/i.test(f.nome||''));
    box.innerHTML = '<div class="sec-head"><h2>💼 MEI</h2><span class="hint">ano ' + ano + '</span></div>' +
      '<div class="row"><span class="name">Faturamento deste mês</span><span class="cur">R$</span><input class="val num" id="meiFat" type="number" inputmode="decimal" aria-label="faturamento do mês"></div>' +
      '<div class="meter ' + st.cls + '" style="margin-top:6px"><div class="mhead"><span>Faturamento no ano</span><span class="num">' + App.money(fatAno) + ' <small>/ ' + App.money(limite) + '</small></span></div>' +
      '<div class="mtrack"><span style="width:' + pct + '%"></span></div><div class="mfoot">' + st.txt + '</div></div>' +
      '<div class="row" style="margin-top:6px"><span class="name">Valor do DAS</span><span class="cur">R$</span><input class="val num" id="meiDas" type="number" inputmode="decimal" aria-label="valor do DAS"></div>' +
      (temDas ? '<p class="hint">✓ O DAS está nas contas fixas (vence dia 20).</p>' : '<button class="add" id="meiAddDas">+ colocar o DAS nas contas fixas (vence dia 20)</button>') +
      '<div class="row"><span class="name">Limite anual</span><span class="cur">R$</span><input class="val num" id="meiLim" type="number" inputmode="decimal" aria-label="limite anual"></div>';
    $('meiFat').value = m.faturamento[S().current] || '';
    $('meiDas').value = m.das || '';
    $('meiLim').value = limite;
    $('meiFat').onchange = e => { const v = parseFloat(e.target.value)||0; if(v) m.faturamento[S().current] = v; else delete m.faturamento[S().current]; App.save(); paintMei(); };
    $('meiDas').onchange = e => { m.das = parseFloat(e.target.value)||0; App.save(); };
    $('meiLim').onchange = e => { m.limite = parseFloat(e.target.value)||MEI_LIMITE_PADRAO; App.save(); paintMei(); };
    const add = $('meiAddDas');
    if(add) add.onclick = () => {
      App.cur().fixos.push({nome:'DAS MEI', valor:+m.das||0, cat:'trabalho', dia:20});
      App.markTouched(); App.save(); App.buildMes(); App.updateComputed(true);
      App.track('mei_das_adicionado'); App.toast(m.das ? 'DAS adicionado às contas fixas' : 'DAS adicionado — preencha o valor nas contas fixas');
    };
  }
  function initMeiToggle(){
    const t = $('toggleMei'); if(!t) return;
    t.checked = !!mei().ativo;
    t.addEventListener('change', () => {
      mei().ativo = t.checked; App.save(); paintMei(); App.track(t.checked ? 'mei_ligado' : 'mei_desligado');
      if(t.checked) App.toast('Área MEI ativada na aba Mês 💼');
    });
  }

  App.onComputed(() => { paintRenda(); paintReservaSugerida(); paintMei(); });
  initMeiToggle();
  paintRenda(); paintReservaSugerida(); paintMei();
  window.FolegoInteligencia = {rendaSegura, mei};
})();
