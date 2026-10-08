/*
 * Fôlego — orçamento por categoria (aba Mês) e relatório por categoria (aba Histórico).
 * Recursos Premium. Carregado depois de js/app.js.
 */
(function(){
  'use strict';
  const App = window.FolegoApp, Cats = window.FolegoCats;
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const S = () => App.getState();
  let reportMonth = null;

  /** Gasto por categoria num mês: fixos + variáveis + parcelas de dívidas. */
  function spendByCat(id){
    const m = S().months[id]; const out = {};
    if(!m) return out;
    [].concat(m.fixos||[], m.variaveis||[]).forEach(it => {
      const v = +it.valor || 0; if(v <= 0) return;
      const c = Cats.of(it).id; out[c] = (out[c]||0) + v;
    });
    const n = App.monthNumbers(id);
    if(n && n.dividasMes > 0) out._dividas = n.dividasMes;
    return out;
  }
  const catInfo = id => id === '_dividas' ? {id, emoji:'💳', nome:'Parcelas'} : Cats.get(id);

  /* ---------- orçamento ---------- */
  function budgets(){ const st = S(); if(!st.budgets) st.budgets = {}; return st.budgets; }
  function budgetStatus(spent, limit){
    const pct = limit > 0 ? spent/limit : 0;
    if(pct > 1) return {cls:'over', txt:'🔴 passou ' + App.money(spent-limit)};
    if(pct >= .8) return {cls:'warn', txt:'⚠️ restam ' + App.money(limit-spent)};
    return {cls:'ok', txt:'restam ' + App.money(limit-spent)};
  }
  function paintBudgets(){
    const box = $('orcSection'); if(!box) return;
    if(!App.isPremium()){
      box.innerHTML = '<div class="sec-head"><h2>Orçamentos</h2><span class="tag">⭐ Premium</span></div>' +
        '<p class="hint">Defina um limite por categoria (ex.: Comer fora R$ 300) e receba alerta antes de estourar.</p>' +
        '<button class="add" id="orcUnlock">Conhecer o Premium</button>';
      $('orcUnlock').onclick = () => App.requirePremium('orcamento');
      return;
    }
    const b = budgets(); const ids = Object.keys(b).filter(k => +b[k] > 0);
    if(!ids.length){
      box.innerHTML = '<div class="sec-head"><h2>Orçamentos</h2></div>' +
        '<p class="hint">Defina limites por categoria e veja quanto ainda pode gastar em cada uma.</p>' +
        '<button class="add" id="orcEdit">+ definir orçamentos</button>';
      $('orcEdit').onclick = openBudgetEditor; return;
    }
    const spent = spendByCat(S().current);
    box.innerHTML = '<div class="sec-head"><h2>Orçamentos</h2><button class="linkbtn" id="orcEdit">editar</button></div>' +
      ids.map(id => {
        const c = Cats.get(id), lim = +b[id], sp = spent[id]||0, st = budgetStatus(sp, lim);
        const pct = Math.min(100, lim ? sp/lim*100 : 0);
        return '<div class="meter ' + st.cls + '" role="img" aria-label="' + esc(c.nome) + ': ' + App.money(sp) + ' de ' + App.money(lim) + '">' +
          '<div class="mhead"><span>' + c.emoji + ' ' + esc(c.nome) + '</span><span class="num">' + App.money(sp) + ' <small>/ ' + App.money(lim) + '</small></span></div>' +
          '<div class="mtrack"><span style="width:' + pct + '%"></span></div><div class="mfoot">' + st.txt + '</div></div>';
      }).join('');
    $('orcEdit').onclick = openBudgetEditor;
  }
  function openBudgetEditor(){
    const b = budgets(); const body = $('budgetBody');
    const spent = spendByCat(S().current);
    body.innerHTML = '<h3>Orçamento mensal por categoria</h3><p class="hint" style="margin:-6px 0 10px">Deixe vazio para não acompanhar. Valores valem para todos os meses.</p>' +
      Cats.CATS.map(c => '<div class="setrow"><span>' + c.emoji + ' ' + esc(c.nome) + (spent[c.id] ? '<small class="hint" style="display:block">este mês: ' + App.money(spent[c.id]) + '</small>' : '') + '</span>' +
        '<input class="field-in budget-in" type="number" inputmode="decimal" placeholder="R$" data-cat="' + c.id + '" value="' + (b[c.id] || '') + '"></div>').join('') +
      '<button class="btn-big" id="budgetSave" style="margin-top:12px">Salvar</button>';
    $('budgetSave').onclick = () => {
      body.querySelectorAll('.budget-in').forEach(i => { const v = parseFloat(i.value)||0; if(v > 0) b[i.dataset.cat] = v; else delete b[i.dataset.cat]; });
      App.save(); App.closeSheet(); paintBudgets(); App.toast('Orçamentos salvos 🎯');
      App.track('orcamento_definido', {categorias: Object.keys(b).length});
    };
    App.openSheet($('budgetSheet'));
  }
  /** Alerta ao lançar um gasto que passa de 80% ou 100% do orçamento. */
  function onLaunch(item, tipo){
    if(tipo !== 'var' || !App.isPremium()) return;
    const id = Cats.of(item).id, lim = +budgets()[id]; if(!lim) return;
    const sp = spendByCat(S().current)[id]||0, before = sp - (+item.valor||0), c = Cats.get(id);
    if(sp > lim && before <= lim) setTimeout(() => App.toast('🔴 Orçamento de ' + c.nome + ' estourou: ' + App.money(sp) + ' de ' + App.money(lim)), 2900);
    else if(sp >= lim*.8 && before < lim*.8) setTimeout(() => App.toast('⚠️ ' + c.nome + ': já usou ' + Math.round(sp/lim*100) + '% do orçamento'), 2900);
  }

  /* ---------- relatório por categoria ---------- */
  function paintReport(){
    const box = $('relSection'); if(!box || !App.isPremium()) return;
    const st = S();
    const ids = Object.keys(st.months).filter(id => st.months[id].touched).sort().reverse();
    if(!reportMonth || !st.months[reportMonth]) reportMonth = st.current;
    const data = Object.entries(spendByCat(reportMonth)).map(([id, v]) => ({c:catInfo(id), v})).sort((a,b) => b.v - a.v);
    const total = data.reduce((s,d) => s + d.v, 0);
    const max = Math.max(1, ...data.map(d => d.v));
    const opts = ids.map(id => '<option value="' + id + '"' + (id===reportMonth?' selected':'') + '>' + App.fmtMonth(id) + '</option>').join('');
    box.innerHTML = '<div class="sec-head"><h2>Para onde foi o dinheiro</h2><select class="msel" id="relMonth" aria-label="mês">' + opts + '</select></div>' +
      (data.length
        ? '<p class="hint" style="margin:-4px 0 10px">Total de gastos: <b class="num">' + App.money(total) + '</b>. Toque numa categoria para ver os itens.</p>' +
          '<div class="cbars" role="table" aria-label="Gastos por categoria">' + data.map(d =>
            '<div class="cbar" role="row" tabindex="0" data-cat="' + d.c.id + '">' +
              '<span class="cl" role="cell">' + d.c.emoji + ' ' + esc(d.c.nome) + '</span>' +
              '<span class="ct" role="cell"><span style="width:' + (d.v/max*100) + '%"></span></span>' +
              '<span class="cv num" role="cell">' + App.money(d.v) + ' <small>' + Math.round(d.v/total*100) + '%</small></span>' +
            '</div><div class="cdetail" data-for="' + d.c.id + '" hidden></div>').join('') + '</div>'
        : '<p class="hint">Nenhum gasto neste mês ainda.</p>');
    const sel = $('relMonth'); if(sel) sel.onchange = () => { reportMonth = sel.value; paintReport(); };
    box.querySelectorAll('.cbar').forEach(row => {
      const toggle = () => {
        const det = box.querySelector('.cdetail[data-for="' + row.dataset.cat + '"]');
        if(!det.hidden){ det.hidden = true; row.classList.remove('open'); return; }
        const m = st.months[reportMonth];
        const items = row.dataset.cat === '_dividas'
          ? st.dividas.filter(d => +d.pagas < +d.total).map(d => ({nome:d.nome, valor:d.parcela}))
          : [].concat(m.fixos, m.variaveis).filter(it => (+it.valor||0) > 0 && Cats.of(it).id === row.dataset.cat);
        det.innerHTML = items.sort((a,b) => b.valor - a.valor).map(it => '<div><span>' + esc(it.nome) + '</span><span class="num">' + App.money(+it.valor) + '</span></div>').join('');
        det.hidden = false; row.classList.add('open');
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
    });
  }

  App.onComputed(() => { paintBudgets(); paintReport(); });
  App.onLaunch(onLaunch);
  App.onTab(tab => { if(tab === 'hist') paintReport(); });
  window.FolegoRelatorios = {spendByCat, paintBudgets, paintReport};
  paintBudgets(); paintReport();
})();
