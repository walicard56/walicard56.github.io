/*
 * Fôlego — conversa com a Lumi (IA). Envia a pergunta e um resumo dos números do mês
 * para a função "lumi" do Supabase, que responde usando o Claude. Recurso Premium.
 * Carregado depois de js/account.js, js/relatorios.js e js/inteligencia.js.
 */
(function(){
  'use strict';
  const App = window.FolegoApp, Cats = window.FolegoCats, Acc = window.FolegoAccount || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SUGESTOES = [
    'Posso comprar um celular de R$ 1.500 em 10x?',
    'Como fecho este mês no azul?',
    'Quanto devo guardar por mês?',
    'Qual dívida devo quitar primeiro?'
  ];
  const history = []; // só na memória: some ao fechar o app
  let sending = false;

  /** Resumo dos números (sem e-mail ou dados de conta) enviado junto com a pergunta. */
  function summary(){
    const st = App.getState(), id = st.current, n = App.monthNumbers(id), m = st.months[id];
    const porCat = {};
    Object.entries(window.FolegoRelatorios ? FolegoRelatorios.spendByCat(id) : {}).forEach(([c,v]) => {
      porCat[c === '_dividas' ? 'Parcelas de dívidas' : Cats.get(c).nome] = Math.round(v);
    });
    const hist = Object.keys(st.months).filter(k => st.months[k].touched).sort().slice(-6)
      .map(k => ({mes: App.fmtMonth(k), renda: Math.round(App.monthNumbers(k).ganhos), sobra: Math.round(App.monthNumbers(k).sobra)}));
    const r = window.FolegoInteligencia && FolegoInteligencia.rendaSegura();
    const orc = st.budgets || {};
    return {
      mes_aberto: App.fmtMonth(id), dia_de_hoje: new Date().getDate(),
      renda: {fixa: n.ganhoFixo, comissao: n.comOn ? {prevista: +m.comPrev||0, recebida: +m.comReal||0} : 'não recebe', extras: n.extras, total: n.ganhos},
      gastos: {fixos: n.fixos, variaveis: n.variaveis, parcelas_dividas: n.dividasMes, total: n.gastos, por_categoria: porCat},
      sobra_do_mes: n.sobra, sobra_so_com_renda_fixa: n.sobraFixa,
      renda_segura: r ? {valor: Math.round(r.segura), media: Math.round(r.media), meses_analisados: r.meses} : 'menos de 2 meses de histórico',
      reserva: {guardado: +st.reserva.atual||0, meta: +st.reserva.meta||0},
      dividas: st.dividas.map(d => ({nome: d.nome, parcela: +d.parcela||0, parcelas_restantes: Math.max(0,(+d.total||0)-(+d.pagas||0))})),
      contas_fixas_pendentes: (m.fixos||[]).filter(f => f.dia && !f.pago && (+f.valor||0) > 0).map(f => ({nome: f.nome, valor: +f.valor, dia: f.dia})),
      orcamentos: Object.fromEntries(Object.entries(orc).map(([c,v]) => [Cats.get(c).nome, v])),
      mei: st.mei && st.mei.ativo ? {das: st.mei.das, limite_anual: st.mei.limite} : undefined,
      historico: hist
    };
  }

  function paint(){
    const box = $('lumiMsgs');
    box.innerHTML = (history.length ? '' :
        '<div class="lmsg bot">Oi! Eu sou a Lumi 💜 Olho seus números de verdade antes de responder. O que você quer saber?</div>') +
      history.map(t => '<div class="lmsg ' + (t.role === 'user' ? 'me' : 'bot') + '">' + esc(t.content).replace(/\n/g,'<br>') + '</div>').join('') +
      (sending ? '<div class="lmsg bot typing"><span></span><span></span><span></span></div>' : '');
    $('lumiChips').hidden = history.length > 0;
    box.scrollTop = box.scrollHeight;
  }

  async function ask(q){
    q = String(q||'').trim(); if(!q || sending) return;
    const sb = Acc.client && Acc.client();
    history.push({role:'user', content:q}); sending = true; paint();
    $('lumiInput').value = '';
    App.track('lumi_pergunta', {sugestao: SUGESTOES.includes(q)});
    let reply;
    try{
      if(!sb) throw Object.assign(new Error('offline'), {code: (Acc.status && Acc.status() === 'dev') ? 'dev' : 'offline'});
      const {data, error} = await sb.functions.invoke('lumi', {body:{question:q, summary:summary(), history:history.slice(0,-1)}});
      if(error){
        let code = 'erro';
        try{ const b = await error.context.json(); code = b.error || code; }catch(e){}
        throw Object.assign(new Error(code), {code});
      }
      reply = data.reply;
    }catch(e){
      const code = e.code || 'erro';
      reply = code === 'limit' ? 'Você chegou ao limite de perguntas de hoje. Amanhã eu volto com tudo! 💜'
        : code === 'premium_required' ? 'Conversar comigo é um recurso Premium. Toque em "Ver planos" na sua conta para continuar.'
        : code === 'dev' ? 'A Lumi com IA será ativada quando o servidor do app estiver configurado.'
        : 'Não consegui me conectar agora. Verifique a internet e tente de novo.';
      history.push({role:'assistant', content:reply, erro:true}); sending = false; paint(); return;
    }
    history.push({role:'assistant', content:reply}); sending = false; paint();
  }

  function open(){
    if(!App.requirePremium('lumi')) return;
    App.track('lumi_aberta');
    paint();
    App.openSheet($('lumiSheet'));
  }

  $('lumiChips').innerHTML = SUGESTOES.map(s => '<button>' + esc(s) + '</button>').join('');
  $('lumiChips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => ask(b.textContent)));
  $('lumiSend').addEventListener('click', () => ask($('lumiInput').value));
  $('lumiInput').addEventListener('keydown', e => { if(e.key === 'Enter') ask($('lumiInput').value); });
  $('lumiOpen').addEventListener('click', open);
  window.FolegoLumi = {open, ask, summary};
})();
