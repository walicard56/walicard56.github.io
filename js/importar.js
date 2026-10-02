/*
 * Fôlego — importação de extrato bancário (OFX e CSV) com prévia, categorização
 * automática e proteção contra duplicatas. Recurso Premium.
 * Carregado depois de js/app.js e js/categorias.js.
 */
(function(){
  'use strict';
  const App = window.FolegoApp, Cats = window.FolegoCats;
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const MAX_IDS = 6000;

  // Lançamentos que normalmente não são gasto/renda de verdade: vêm desmarcados.
  const IGNORAR = /pagamento (de |da )?fatura|pagamento recebido|fatura (do )?cart|aplica[cç][aã]o|resgate|rendimento|transfer[eê]ncia entre contas|estorno|saldo (anterior|do dia)|\bsaldo\b/i;

  /* ---------- leitura de números e datas ---------- */
  /** "1.234,56" | "1234.56" | "-R$ 12,00" | "12,5" → número */
  function parseNum(s){
    s = String(s||'').trim().replace(/\s|R\$/g,'');
    if(!s) return NaN;
    const neg = /^-|^\(.*\)$|-$/.test(s) ? -1 : 1;
    s = s.replace(/[()\-+]/g,'');
    if(s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if(s.includes(',')) s = s.replace(',','.');
    const v = parseFloat(s);
    return isNaN(v) ? NaN : neg*v;
  }
  /** "31/12/2026" | "2026-12-31" | "20261231..." | "31/12/26" → "2026-12-31" */
  function parseDate(s){
    s = String(s||'').trim();
    let m;
    if((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
    if((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))){ const y = m[3].length === 2 ? '20'+m[3] : m[3]; return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
    if((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return m[1]+'-'+m[2]+'-'+m[3];
    return null;
  }
  const clean = s => String(s||'').replace(/\s+/g,' ').trim();

  /* ---------- OFX ---------- */
  function parseOFX(text){
    const out = [];
    text.split(/<STMTTRN>/i).slice(1).forEach(block => {
      block = block.split(/<\/STMTTRN>/i)[0];
      const tag = t => { const m = block.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
      const data = parseDate(tag('DTPOSTED')), valor = parseNum(tag('TRNAMT'));
      if(!data || isNaN(valor) || valor === 0) return;
      const desc = clean(tag('MEMO') || tag('NAME') || tag('TRNTYPE'));
      out.push({data, valor, desc, fitid: tag('FITID')});
    });
    return out;
  }

  /* ---------- CSV ---------- */
  function splitCSV(line, d){
    const out = []; let cur = '', q = false;
    for(let i = 0; i < line.length; i++){
      const c = line[i];
      if(c === '"'){ if(q && line[i+1] === '"'){ cur += '"'; i++; } else q = !q; }
      else if(c === d && !q){ out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out.map(x => x.trim());
  }
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2) return {itens:[], cartao:false};
    // Cabeçalho: primeira linha (entre as 10 primeiras) que tenha data e valor.
    let hi = -1, d = ',', cols;
    for(let i = 0; i < Math.min(10, lines.length) && hi < 0; i++){
      for(const dl of [';', ',', '\t']){
        const c = splitCSV(lines[i], dl).map(norm);
        if(c.some(x => /^(data|date)/.test(x)) && c.some(x => /^(valor|amount|quantia|value)/.test(x))){ hi = i; d = dl; cols = c; break; }
      }
    }
    if(hi < 0) return {itens:[], cartao:false};
    const find = re => cols.findIndex(x => re.test(x));
    const iData = find(/^(data|date)/), iValor = find(/^(valor|amount|quantia|value)/);
    let iDesc = -1;
    for(const re of [/^descri/, /^(title|titulo)/, /^estabelecimento/, /^(memo|detalhe)/, /^historico/, /^lancamento/]){ iDesc = find(re); if(iDesc >= 0) break; }
    if(iDesc < 0) iDesc = cols.findIndex((x,i) => i !== iData && i !== iValor);
    const iId = find(/^(identificador|id$)/);
    // Fatura de cartão (ex.: Nubank "date,title,amount"): valor positivo = compra.
    const cartao = cols.includes('title') && cols.includes('amount');
    const itens = [];
    lines.slice(hi+1).forEach(l => {
      const c = splitCSV(l, d);
      const data = parseDate(c[iData]); let valor = parseNum(c[iValor]);
      if(!data || isNaN(valor) || valor === 0) return;
      if(cartao) valor = -valor;
      itens.push({data, valor, desc: clean(c[iDesc]), fitid: iId >= 0 ? c[iId] : ''});
    });
    return {itens, cartao};
  }

  function parse(text, filename){
    const isOFX = /\.ofx$/i.test(filename||'') || /<OFX>|<STMTTRN>/i.test(text);
    return isOFX ? {itens: parseOFX(text), cartao: false, formato:'OFX'} : Object.assign(parseCSV(text), {formato:'CSV'});
  }

  /** Lê o arquivo como UTF-8; se tiver caracteres inválidos, como Windows-1252 (comum em OFX de banco). */
  async function readText(file){
    const buf = await file.arrayBuffer();
    try{ return new TextDecoder('utf-8', {fatal:true}).decode(buf); }
    catch(e){ return new TextDecoder('windows-1252').decode(buf); }
  }

  /* ---------- prévia e importação ---------- */
  function idOf(t){ return t.fitid ? 'f:' + t.fitid : 'h:' + t.data + '|' + t.valor.toFixed(2) + '|' + norm(t.desc).slice(0,40); }
  let rows = [];

  function openPreview(itens, info){
    const st = App.getState();
    const seen = new Set(st.importIds || []);
    rows = itens.sort((a,b) => b.data.localeCompare(a.data)).map(t => {
      const id = idOf(t), dup = seen.has(id), gasto = t.valor < 0;
      return Object.assign({}, t, {id, dup, gasto, cat: gasto ? (Cats.guess(t.desc) || 'outros') : null,
        sel: !dup && gasto && !IGNORAR.test(t.desc)});
    });
    renderPreview(info);
    App.openSheet($('importSheet'));
  }
  function renderPreview(info){
    const body = $('importBody');
    const sel = rows.filter(r => r.sel), dups = rows.filter(r => r.dup).length;
    const tot = sel.reduce((s,r) => s + Math.abs(r.valor) * (r.gasto ? 1 : 0), 0);
    body.innerHTML = '<h3>Importar extrato</h3>' +
      '<p class="hint" style="margin:-6px 0 10px">' + rows.length + ' lançamentos no arquivo ' + info.formato + (dups ? ' · ' + dups + ' já importados' : '') +
      '. Rendas e pagamentos de fatura vêm desmarcados para não duplicar o salário. Toque no emoji para trocar a categoria.</p>' +
      '<div class="imp-list">' + rows.map((r,i) =>
        '<label class="imp' + (r.dup ? ' dup' : '') + '"><input type="checkbox" data-i="' + i + '"' + (r.sel?' checked':'') + (r.dup?' disabled':'') + '>' +
        (r.gasto ? '<button type="button" class="catbtn" data-cat="' + i + '">' + Cats.get(r.cat).emoji + '</button>' : '<span class="catbtn inc">💰</span>') +
        '<span class="imp-d">' + esc(r.desc || '(sem descrição)') + '<small>' + r.data.split('-').reverse().join('/') + (r.dup ? ' · já importado' : r.gasto ? '' : ' · entrada') + '</small></span>' +
        '<span class="imp-v num ' + (r.gasto ? '' : 'pos-text') + '">' + (r.gasto ? '' : '+') + App.money(Math.abs(r.valor)) + '</span></label>').join('') + '</div>' +
      '<button class="btn-big" id="impGo"' + (sel.length ? '' : ' disabled') + ' style="margin-top:12px">Importar ' + sel.length + ' lançamento' + (sel.length===1?'':'s') + (tot ? ' (' + App.money(tot) + ' em gastos)' : '') + '</button>';
    body.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => { rows[+cb.dataset.i].sel = cb.checked; renderPreview(info); }));
    body.querySelectorAll('button[data-cat]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      const r = rows[+b.dataset.cat];
      App.openCatPicker(r.cat, id => { r.cat = id; renderPreview(info); });
    }));
    $('impGo').onclick = () => doImport(info);
  }
  function doImport(info){
    const st = App.getState();
    const ids = st.importIds || (st.importIds = []);
    const sel = rows.filter(r => r.sel && !r.dup);
    const meses = new Set();
    sel.forEach(r => {
      const m = App.ensureMonth(r.data.slice(0,7)); meses.add(r.data.slice(0,7));
      const nome = (r.desc || (r.gasto ? Cats.get(r.cat).nome : 'Entrada')).slice(0, 60);
      if(r.gasto) m.variaveis.push({nome, valor: Math.round(Math.abs(r.valor)*100)/100, data: r.data, cat: r.cat});
      else m.extras.push({nome, valor: Math.round(r.valor*100)/100, data: r.data});
      ids.push(r.id);
    });
    if(ids.length > MAX_IDS) ids.splice(0, ids.length - MAX_IDS);
    App.save(); App.buildMes(); App.updateComputed(true); App.closeSheet();
    App.track('extrato_importado', {formato: info.formato, quantidade: sel.length, meses: meses.size});
    App.toast(sel.length + ' lançamento' + (sel.length===1?'':'s') + ' importado' + (sel.length===1?'':'s') + ' em ' + meses.size + ' mês' + (meses.size===1?'':'es') + ' 🏦');
  }

  async function onFile(file){
    if(!file) return;
    try{
      const info = parse(await readText(file), file.name);
      if(!info.itens.length){ App.toast('Não encontrei lançamentos nesse arquivo. Use o extrato em OFX ou CSV.'); App.track('extrato_vazio', {formato: info.formato}); return; }
      openPreview(info.itens, info);
    }catch(e){ App.toast('Não consegui ler esse arquivo.'); }
  }

  const btn = $('bankImportBtn'), input = $('bankFile');
  if(btn && input){
    btn.addEventListener('click', () => { if(App.requirePremium('importar')) input.click(); });
    input.addEventListener('change', () => { onFile(input.files[0]); input.value = ''; });
  }
  window.FolegoImport = {parse, parseNum, parseDate, openPreview};
})();
