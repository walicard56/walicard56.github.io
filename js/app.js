/* Fôlego — lógica principal do app (cálculos, telas, lançamentos). */
const KEY='app-financas-v1';
const track=(e,p)=>{try{window.FolegoAnalytics&&FolegoAnalytics.track(e,p);}catch(err){}};
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MABREV=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const now=new Date();
const todayId=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

function seedMonth(){return{
  ganhos:[{nome:'Salário',valor:0}],
  comPrevNome:'Comissão (prevista)', comPrev:0, comReal:0,
  fixos:[{nome:'Aluguel / moradia',valor:0},{nome:'Energia',valor:0},{nome:'Água',valor:0},
    {nome:'Internet e celular',valor:0},{nome:'Mercado',valor:0},{nome:'Transporte',valor:0}],
  variaveis:[], extras:[], touched:false
};}
function defaults(){const m={};const s=seedMonth();s.touched=true;m[todayId]=s;return{months:m,current:todayId,
  config:{comissao:false}, reserva:{meta:3000,atual:0}, dividas:[]};}

function isPristine(m){
  const s=seedMonth();
  return JSON.stringify(m.ganhos)===JSON.stringify(s.ganhos)
    && JSON.stringify(m.fixos)===JSON.stringify(s.fixos)
    && (+m.comPrev===s.comPrev) && (!m.comReal||+m.comReal===0)
    && (!m.variaveis||m.variaveis.length===0) && (!m.extras||m.extras.length===0);
}

let S, firstRun=false;
try{const s=localStorage.getItem(KEY); firstRun=!s; S=s?JSON.parse(s):defaults();}catch(e){S=defaults();firstRun=true;}
if(!S||!S.months) S=defaults();
if(!S.config) S.config={comissao:true};
// migrate + clean phantom months
Object.keys(S.months).forEach(id=>{const m=S.months[id];
  if(!m.extras)m.extras=[]; if(!m.variaveis)m.variaveis=[]; if(!m.ganhos)m.ganhos=[]; if(!m.fixos)m.fixos=[];
  if(m.touched===undefined) m.touched=(id===todayId)||!isPristine(m);});
if(!Array.isArray(S.dividas)) S.dividas=[];
if(!S.reserva) S.reserva={meta:4500,atual:0};
Object.keys(S.months).forEach(id=>{ if(id!==todayId && S.months[id].touched===false) delete S.months[id]; });
// Virada do mês: cria o mês atual a partir do último (contas fixas voltam a "não pago") e abre nele.
(function rollover(){
  const ids=Object.keys(S.months).sort(); const last=ids[ids.length-1];
  if(!last||S.months[todayId]||last>todayId) return;
  const b=S.months[last];
  S.months[todayId]={ganhos:b.ganhos.map(x=>({...x})),comPrevNome:b.comPrevNome,comPrev:b.comPrev,comReal:0,
    fixos:b.fixos.map(x=>({...x,pago:false})),variaveis:[],extras:[],touched:true};
  S.current=todayId;
})();
if(!S.months[S.current]) S.current=S.months[todayId]?todayId:Object.keys(S.months)[0];
if(!S.current||!S.months[S.current]){const s=seedMonth();s.touched=true;S.months[todayId]=s;S.current=todayId;}
const saveHooks=[], computedHooks=[], launchHooks=[], achievementHooks=[];
const achieve=ev=>achievementHooks.forEach(f=>{try{f(ev);}catch(e){console.error(e);}});
function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){} saveHooks.forEach(f=>{try{f();}catch(e){}});}

const money=n=>'R$ '+Math.round(n).toLocaleString('pt-BR');
const money1=n=>(n<0?'-':'')+'R$ '+Math.round(Math.abs(n)).toLocaleString('pt-BR');
function fmtMonth(id){const[y,m]=id.split('-');let s=MESES[+m-1];return s.charAt(0).toUpperCase()+s.slice(1)+' '+y;}
function abrevMonth(id){const[y,m]=id.split('-');return MABREV[+m-1]+' '+y.slice(2);}
function shiftMonth(id,n){let[y,m]=id.split('-').map(Number);m+=n;while(m<1){m+=12;y--;}while(m>12){m-=12;y++;}return y+'-'+String(m).padStart(2,'0');}
function cur(){return S.months[S.current];}
/** Garante que o mês exista (copiando ganhos e contas fixas do mês mais próximo) e o marca como usado. */
function ensureMonth(id){
  if(!S.months[id]){
    const ids=Object.keys(S.months).sort(); const near=ids.filter(k=>k<=id).pop()||ids[0]; const b=S.months[near];
    S.months[id]={ganhos:b.ganhos.map(x=>({...x})),comPrevNome:b.comPrevNome,comPrev:b.comPrev,comReal:0,
      fixos:b.fixos.map(x=>({...x,pago:id<todayId})),variaveis:[],extras:[],touched:true};
  }
  S.months[id].touched=true; return S.months[id];
}
function markTouched(){const m=cur(); if(m&&!m.touched){m.touched=true;}}

function monthNumbers(id){
  const m=S.months[id]; if(!m) return null;
  const ganhoFixo=m.ganhos.reduce((s,i)=>s+(+i.valor||0),0);
  const extras=(m.extras||[]).reduce((s,i)=>s+(+i.valor||0),0);
  const comOn=!!S.config.comissao;
  const comissao=comOn?((+m.comReal>0)?+m.comReal:(+m.comPrev||0)):0;
  const usouReal=comOn&&(+m.comReal>0);
  const fixos=m.fixos.reduce((s,i)=>s+(+i.valor||0),0);
  const variaveis=m.variaveis.reduce((s,i)=>s+(+i.valor||0),0);
  const dividasMes=S.dividas.reduce((s,d)=>s+((+d.pagas< +d.total)?(+d.parcela||0):0),0);
  const gastos=fixos+variaveis+dividasMes;
  return{ganhoFixo,extras,comissao,usouReal,comOn,fixos,variaveis,dividasMes,gastos,
    ganhos:ganhoFixo+comissao+extras, sobra:ganhoFixo+comissao+extras-gastos,
    sobraFixa:ganhoFixo-(fixos+dividasMes), fixoCompromisso:fixos+dividasMes};
}

function setBig(el,value,animate){
  const from=parseFloat(el.dataset.v)||0; el.dataset.v=value;
  if(!animate||reduce||from===value){el.textContent=money1(value); return;}
  const t0=performance.now(), dur=520;
  function step(t){const k=Math.min(1,(t-t0)/dur); const e=1-Math.pow(1-k,3);
    el.textContent=money1(from+(value-from)*e); if(k<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}

const Cats=window.FolegoCats;
const isoToday=()=>{const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
/** Data padrão para um lançamento no mês aberto: hoje, se for o mês atual; senão o dia 1. */
const defaultDate=()=>S.current===todayId?isoToday():S.current+'-01';
function daysInMonth(id){const[y,m]=id.split('-').map(Number); return new Date(y,m,0).getDate();}

function catButton(item,onChange){
  const b=document.createElement('button'); b.className='catbtn';
  const paint=()=>{const c=Cats.of(item); b.textContent=c.emoji; b.title=c.nome; b.setAttribute('aria-label','categoria: '+c.nome);};
  paint();
  b.addEventListener('click',()=>openCatPicker(Cats.of(item).id,id=>{item.cat=id; paint(); markTouched(); save(); onChange&&onChange();}));
  return b;
}
function makeRow(item,list,extraClass,opts){
  opts=opts||{};
  const row=document.createElement('div'); row.className='row'+(extraClass?' '+extraClass:'');
  if(opts.cat) row.append(catButton(item,()=>updateComputed(false)));
  const name=document.createElement('input'); name.className='name'; name.value=item.nome;
  name.addEventListener('input',()=>{item.nome=name.value;markTouched();save();});
  const c=document.createElement('span'); c.className='cur'; c.textContent='R$';
  const val=document.createElement('input'); val.className='val num'; val.type='number'; val.inputMode='decimal'; val.value=item.valor;
  val.addEventListener('input',()=>{item.valor=parseFloat(val.value)||0;markTouched();updateComputed(false);save();});
  const del=document.createElement('button'); del.className='del'; del.textContent='×';
  del.setAttribute('aria-label','remover '+item.nome);
  del.addEventListener('click',()=>{const i=list.indexOf(item);if(i<0)return;list.splice(i,1);markTouched();buildMes();updateComputed(true);save();haptic(10);
    toast('“'+(item.nome||'Item')+'” removido','Desfazer',()=>{list.splice(Math.min(i,list.length),0,item);buildMes();updateComputed(true);save();});});
  row.append(name,c,val,del);
  if(opts.date||opts.due){
    const sub=document.createElement('div'); sub.className='row-sub';
    if(opts.date){
      const dt=document.createElement('input'); dt.type='date'; dt.className='dt'; dt.setAttribute('aria-label','data');
      dt.min=S.current+'-01'; dt.max=S.current+'-'+String(daysInMonth(S.current)).padStart(2,'0');
      if(!item.data) item.data=defaultDate();
      dt.value=item.data;
      dt.addEventListener('change',()=>{if(dt.value){item.data=dt.value;markTouched();save();}});
      sub.append(dt);
    }
    if(opts.due){
      const lab=document.createElement('label'); lab.className='due'; lab.textContent='vence dia ';
      const sel=document.createElement('select'); sel.setAttribute('aria-label','dia do vencimento');
      sel.innerHTML='<option value="">—</option>'+Array.from({length:31},(_,i)=>'<option>'+(i+1)+'</option>').join('');
      sel.value=item.dia?String(item.dia):'';
      sel.addEventListener('change',()=>{item.dia=sel.value?+sel.value:null;markTouched();save();computedHooks.forEach(f=>f());});
      lab.append(sel);
      const paid=document.createElement('button'); paid.className='paid'+(item.pago?' on':'');
      paid.textContent=item.pago?'✓ pago':'marcar pago';
      paid.addEventListener('click',()=>{item.pago=!item.pago;markTouched();save();haptic(10);
        paid.className='paid'+(item.pago?' on':''); paid.textContent=item.pago?'✓ pago':'marcar pago'; computedHooks.forEach(f=>f());});
      sub.append(lab,paid);
    }
    row.append(sub);
  }
  return row;
}

/* ---------- escolha de categoria ---------- */
let catPickCb=null, catReturnTo=null;
function openCatPicker(current,cb){
  catPickCb=cb; catReturnTo=openSheetEl&&openSheetEl.id!=='catSheet'?openSheetEl:null;
  const g=document.getElementById('catGrid'); g.innerHTML='';
  Cats.CATS.forEach(c=>{const b=document.createElement('button'); b.className='catopt'+(c.id===current?' on':'');
    b.innerHTML='<span>'+c.emoji+'</span>'+c.nome;
    b.addEventListener('click',()=>{haptic(6); const f=catPickCb; catPickCb=null; closeSheet(); f&&f(c.id);
      if(catReturnTo){const r=catReturnTo; catReturnTo=null; openSheet(r);}}); g.append(b);});
  openSheet(document.getElementById('catSheet'));
}
function buildMes(){
  const m=cur();
  const g=document.getElementById('ganhosList'); g.innerHTML=''; m.ganhos.forEach(it=>g.append(makeRow(it,m.ganhos)));
  const ex=document.getElementById('extraList'); ex.innerHTML='';
  if(m.extras.length===0){const p=document.createElement('p');p.className='hint';p.textContent='Nenhuma renda extra lançada este mês.';ex.append(p);}
  m.extras.forEach(it=>ex.append(makeRow(it,m.extras,'var inc',{date:true})));
  const f=document.getElementById('fixosList'); f.innerHTML=''; m.fixos.forEach(it=>f.append(makeRow(it,m.fixos,'',{cat:true,due:true})));
  const v=document.getElementById('varList'); v.innerHTML='';
  if(m.variaveis.length===0){const p=document.createElement('p');p.className='hint';p.textContent='Nenhum gasto variável lançado ainda este mês.';v.append(p);}
  m.variaveis.slice().sort((a,b)=>(b.data||'').localeCompare(a.data||'')).forEach(it=>v.append(makeRow(it,m.variaveis,'var',{cat:true,date:true})));
  document.getElementById('comPrevNome').value=m.comPrevNome||'Comissão (prevista)';
  document.getElementById('comPrev').value=m.comPrev;
  document.getElementById('comReal').value=m.comReal||'';
  applyComissao();
}
function applyComissao(){
  const on=!!S.config.comissao;
  document.getElementById('toggleCom').checked=on;
  document.getElementById('comissaoBlock').style.display=on?'':'none';
}

function buildDividas(){
  const box=document.getElementById('divList'); box.innerHTML='';
  S.dividas.forEach(d=>{
    const el=document.createElement('div'); el.className='debt';
    const head=document.createElement('div'); head.className='dhead';
    const nm=document.createElement('input'); nm.className='dname'; nm.value=d.nome;
    nm.addEventListener('input',()=>{d.nome=nm.value;save();});
    const del=document.createElement('button'); del.className='del'; del.textContent='×';
    del.setAttribute('aria-label','remover dívida');
    del.addEventListener('click',()=>{const i=S.dividas.indexOf(d);if(i<0)return;S.dividas.splice(i,1);buildDividas();updateComputed(true);save();haptic(10);
      toast('Dívida removida','Desfazer',()=>{S.dividas.splice(Math.min(i,S.dividas.length),0,d);buildDividas();updateComputed(true);save();});});
    head.append(nm,del);
    const fields=document.createElement('div'); fields.className='fields';
    fields.append(field('Parcela R$',d.parcela,v=>d.parcela=v),field('Nº parcelas',d.total,v=>d.total=v),field('Já pagas',d.pagas,v=>d.pagas=v));
    const bar=document.createElement('div'); bar.className='bar pos'; bar.style.margin='4px 0 0'; bar.innerHTML='<span></span>';
    const info=document.createElement('div'); info.className='dinfo';
    const pay=document.createElement('button'); pay.className='paybtn';
    pay.addEventListener('click',()=>{
      if(+d.pagas>=+d.total) return;
      d.pagas=(+d.pagas||0)+1; buildDividas(); updateComputed(true); save(); haptic(15);
      track('parcela_paga'); if(+d.pagas>=+d.total){ celebrate(); track('divida_quitada'); maybeAskReview('divida_quitada'); achieve({tipo:'divida', nome:d.nome, total:(+d.parcela||0)*(+d.total||0)}); }
    });
    el.append(head,fields,bar,info,pay); box.append(el);
    d._el={bar:bar.firstChild,info,pay};
  });
  function field(label,value,set){
    const w=document.createElement('div'); w.className='field';
    const l=document.createElement('label'); l.textContent=label;
    const inp=document.createElement('input'); inp.type='number'; inp.inputMode='decimal'; inp.value=value;
    inp.addEventListener('input',()=>{set(parseFloat(inp.value)||0);updateComputed(false);save();});
    w.append(l,inp); return w;
  }
}

let tipIndex=0;
function greeting(){const h=now.getHours(); return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';}
function setMood(mood){const mouth=document.getElementById('mouth'); if(!mouth)return;
  mouth.setAttribute('d', mood==='happy'?'M13 25 Q20 31 27 25': mood==='worried'?'M13 28 Q20 23 27 28':'M13 26 H27');}
function buildTips(n){
  const t=[]; const r=S.reserva;
  const nearDebt=S.dividas.find(d=>{const rest=(+d.total||0)-(+d.pagas||0); return rest>0&&rest<=2;});
  if(nearDebt){const rest=(+nearDebt.total||0)-(+nearDebt.pagas||0); t.push('Falta '+rest+' parcela'+(rest>1?'s':'')+' pra quitar o '+nearDebt.nome+'. Tá quase! 💪');}
  if((P.streak||0)>=2 && (P.lastLaunchDay===isoToday())) t.push('🔥 '+P.streak+' dias seguidos anotando! Quem anota todo dia descobre pra onde vai o dinheiro.');
  if(n.variaveis===0) t.push('Você ainda não lançou gastos do dia este mês. Anotar os pequenos é o que evita o susto no fim do mês.');
  if(+r.atual < n.fixoCompromisso) t.push('Meta de fôlego: juntar '+money(n.fixoCompromisso)+' na reserva = 1 mês de contas pagas mesmo sem renda.');
  if(n.sobra>0) t.push('Sobrou '+money(n.sobra)+' este mês. Mandar metade pra reserva já acelera bastante sua meta.');
  if(n.comOn) t.push('Comissão é renda variável: o ideal é viver com o salário fixo e tratar a comissão como bônus pra reserva e dívidas.');
  if(n.extras>0) t.push('Você teve '+money(n.extras)+' de renda extra este mês — ótimo momento pra reforçar a reserva.');
  if(n.dividasMes>0) t.push('Suas parcelas somam '+money(n.dividasMes)+'/mês. Quando quitar, esse valor vira sobra ou reserva.');
  return t;
}
function updateCoach(){
  const n=monthNumbers(S.current); const r=S.reserva;
  const box=document.getElementById('coach'); box.className='coach';
  let mood='happy', title, msg;
  if(n.sobra<0){box.classList.add('worried'); mood='worried';
    title='Esse mês tá fechando no vermelho';
    msg='Tá saindo mais do que entra. Segura os gastos variáveis e deixa só o essencial até a renda entrar.';}
  else if(n.sobraFixa<0){box.classList.add('caution'); mood='neutral';
    title=n.comOn?'Você depende da comissão este mês':'As contas passam da renda fixa';
    msg=n.comOn?('Só com o salário, faltam '+money(-n.sobraFixa)+' pras contas fixas. Enquanto ela não cai, cada gasto extra pesa.')
              :('Só com a renda fixa, faltam '+money(-n.sobraFixa)+'. Vale rever gastos ou somar uma renda extra no mês.');}
  else if(+r.atual < n.fixoCompromisso){ mood='neutral';
    title='Bora começar sua reserva?';
    msg='A renda já cobre o fixo 👏. Próximo passo: guardar um pouco pra ter fôlego nos meses fracos.';}
  else if(n.sobra>0 && +r.atual < +r.meta){ mood='happy';
    title=greeting()+'! Mês no azul 🎉';
    msg='Sobrou '+money(n.sobra)+'. Que tal mandar uma parte pra reserva e chegar mais perto da meta?';}
  else { mood='happy';
    title='Tá tudo em ordem ✨';
    msg='Contas pagas, renda cobrindo o fixo e reserva indo bem. Caminho certo — continua assim!';}
  document.getElementById('coachWho').textContent='Lumi · '+greeting().toLowerCase();
  document.getElementById('coachTitle').textContent=title;
  document.getElementById('coachMsg').textContent=msg;
  setMood(mood);
  box._messages=[msg].concat(buildTips(n)); tipIndex=0;
  document.getElementById('tipBtn').textContent='💡 dica';
  renderDots();
}
function renderDots(){
  const box=document.getElementById('coach'); const msgs=box._messages||[]; const d=document.getElementById('cdots');
  d.innerHTML=''; if(msgs.length<2) return;
  msgs.forEach((_,i)=>{const b=document.createElement('button'); if(i===tipIndex)b.className='on';
    b.setAttribute('aria-label','mensagem '+(i+1)); b.addEventListener('click',()=>showMsg(i)); d.append(b);});
}
function showMsg(i){
  const box=document.getElementById('coach'); const msgs=box._messages||[]; if(!(i in msgs))return;
  tipIndex=i; const el=document.getElementById('coachMsg'); el.textContent=msgs[i];
  if(!reduce) el.animate([{opacity:.2,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:220});
  document.getElementById('tipBtn').textContent = i===0 ? '💡 dica' : '💡 próxima';
  renderDots();
}
document.getElementById('tipBtn').addEventListener('click',()=>{
  const msgs=document.getElementById('coach')._messages||[]; if(msgs.length<2)return;
  showMsg((tipIndex+1)%msgs.length);
});
document.getElementById('askVal').addEventListener('input',e=>{
  const g=parseFloat(e.target.value)||0; const res=document.getElementById('askRes');
  if(!g){res.textContent='';return;}
  const n=monthNumbers(S.current); const nova=n.sobra-g;
  if(nova>=0){res.textContent='✅ Pode! Ainda sobra '+money(nova)+' no mês.'; res.style.fontWeight='500';}
  else{res.textContent='⚠️ Cuidado: isso deixa o mês em '+money1(nova)+'.'; res.style.fontWeight='600';}
});
document.getElementById('toggleCom').addEventListener('change',e=>{
  S.config.comissao=e.target.checked; applyComissao(); updateComputed(true); save();
});

let prevResBucket=Math.floor((S.reserva.atual/(S.reserva.meta||1))*4);
function updateComputed(animate){
  const n=monthNumbers(S.current);
  const st=document.getElementById('sobraTotal'); setBig(st,n.sobra,animate); st.className='big num '+(n.sobra>=0?'pos-text':'neg-text');
  document.getElementById('sobraLabel').textContent = n.comOn ? ('Sobra do mês ('+(n.usouReal?'comissão recebida':'comissão prevista')+')') : 'Sobra do mês';
  const ss=document.getElementById('sobraStatus'); ss.textContent='entra '+money(n.ganhos)+' · sai '+money(n.gastos); ss.className='status '+(n.sobra>=0?'pos':'neg');
  const sf=document.getElementById('sobraFixa'); setBig(sf,n.sobraFixa,animate); sf.className='big num '+(n.sobraFixa>=0?'pos-text':'neg-text');
  const fs=document.getElementById('fixaStatus');
  if(n.sobraFixa>=0){fs.textContent='o salário cobre as contas fixas';fs.className='status pos';}
  else{fs.textContent='faltam '+money(-n.sobraFixa)+(n.comOn?' — depende da comissão':' — falta renda');fs.className='status neg';}
  document.getElementById('totalGanhos').textContent=money(n.ganhoFixo+n.comissao);
  document.getElementById('totalExtra').textContent=money(n.extras);
  document.getElementById('totalFixos').textContent=money(n.fixos);
  document.getElementById('totalVar').textContent=money(n.variaveis);
  document.getElementById('dividaHint').textContent=n.dividasMes>0?('+ '+money(n.dividasMes)+' de parcelas de dívidas (aba Dívidas) já entram na conta do mês.'):'';
  updateCoach();
  const av=document.getElementById('askVal'); if(av.value) av.dispatchEvent(new Event('input'));
  paintHist(); paintReserva(n,animate); paintDividas(n,animate);
  computedHooks.forEach(f=>{try{f();}catch(e){console.error(e);}});
}
function goToMonth(id){ if(!S.months[id])return; S.current=id;
  document.getElementById('monthLabel').textContent=fmtMonth(id); buildMes(); switchTab('mes'); }
function paintHist(){
  const ids=Object.keys(S.months).filter(id=>S.months[id].touched).sort();
  const data=ids.map(id=>({id,sobra:monthNumbers(id).sobra}));
  const max=Math.max(1,...data.map(d=>Math.abs(d.sobra)));
  const list=document.getElementById('histList'); list.innerHTML='';
  data.forEach(d=>{
    const r=document.createElement('div'); r.className='hbar-row';
    const mm=document.createElement('div'); mm.className='hm'; mm.innerHTML=abrevMonth(d.id)+(d.id===todayId?'<b>atual</b>':'');
    const track=document.createElement('div'); track.className='hbar-track';
    const fill=document.createElement('div'); fill.className='hbar-fill';
    fill.style.background=d.sobra>=0?'linear-gradient(90deg,var(--pos),#3ecf9a)':'linear-gradient(90deg,var(--neg),#f5747f)';
    track.append(fill); requestAnimationFrame(()=>fill.style.width=(Math.abs(d.sobra)/max*100)+'%');
    const val=document.createElement('div'); val.className='hbar-val '+(d.sobra>=0?'pos-text':'neg-text'); val.textContent=money1(d.sobra);
    r.append(mm,track,val); r.addEventListener('click',()=>goToMonth(d.id)); list.append(r);
  });
  const avg=data.length?data.reduce((s,d)=>s+d.sobra,0)/data.length:0;
  if(!data.length) data.push({sobra:0});
  const best=Math.max(...data.map(d=>d.sobra)), worst=Math.min(...data.map(d=>d.sobra));
  const stA=document.getElementById('stAvg'), stB=document.getElementById('stBest'), stW=document.getElementById('stWorst');
  stA.textContent=money1(avg); stA.className='sv num '+(avg>=0?'pos-text':'neg-text');
  stB.textContent=money1(best); stB.className='sv num '+(best>=0?'pos-text':'neg-text');
  stW.textContent=money1(worst); stW.className='sv num '+(worst>=0?'pos-text':'neg-text');
  document.getElementById('histHint').textContent = data.length<2
    ? 'Por enquanto só o mês atual. Avance o mês (›) e preencha os valores — cada mês que você mexer aparece aqui. Toque num mês pra abri-lo.'
    : 'Toque em qualquer mês pra abrir e ver os detalhes.';
}
function paintReserva(n,animate){
  const r=S.reserva; const meta=+r.meta||0, atual=+r.atual||0;
  const el=document.getElementById('resSaldo'); setBig(el,atual,animate);
  document.getElementById('resMeta').value=r.meta; document.getElementById('resAtual').value=r.atual;
  const pct=meta>0?Math.min(100,atual/meta*100):0;
  document.getElementById('resBar').style.width=pct+'%';
  document.getElementById('resPct').textContent=Math.round(pct)+'% da meta';
  const falta=Math.max(0,meta-atual);
  document.getElementById('resFalta').textContent=falta>0?('faltam '+money(falta)):'meta atingida 🎉';
  const ids=Object.keys(S.months).filter(id=>S.months[id].touched);
  const avg=ids.reduce((s,id)=>s+monthNumbers(id).sobra,0)/(ids.length||1);
  let nota;
  if(falta<=0) nota='Meta batida! A partir daqui, o que sobrar pode ir pra investir ou quitar dívida mais rápido.';
  else if(avg>0){const m=Math.ceil(falta/avg); nota='No seu ritmo (sobra média de '+money(avg)+'/mês), você atinge a meta em ~'+m+' '+(m===1?'mês':'meses')+', guardando toda a sobra.';}
  else nota='Sua sobra média está no vermelho — o foco agora é fechar o mês no azul antes de guardar com folga.';
  document.getElementById('resNota').textContent=nota;
  const bucket=Math.floor((meta>0?atual/meta:0)*4);
  if(bucket>prevResBucket && bucket>0){ celebrate(); maybeAskReview('meta_reserva'); achieve({tipo:'reserva', pct:Math.min(100,bucket*25), atual}); }
  prevResBucket=bucket;
}
function paintDividas(n,animate){
  let totalFalta=0;
  S.dividas.forEach(d=>{
    const rest=Math.max(0,(+d.total||0)-(+d.pagas||0));
    const falta=rest*(+d.parcela||0); totalFalta+=falta;
    const pct=(+d.total>0)?Math.min(100,(+d.pagas||0)/(+d.total)*100):0;
    if(d._el){d._el.bar.style.width=pct+'%';
      const quit=rest<=0?'Quitado ✓':'quita em '+fmtMonth(shiftMonth(todayId,rest-1));
      d._el.info.innerHTML='<span>faltam <b>'+rest+'</b> de '+(+d.total||0)+' · <b>'+money(falta)+'</b></span><span>'+quit+'</span>';
      if(rest<=0){d._el.pay.textContent='Quitado ✓'; d._el.pay.className='paybtn done';}
      else{d._el.pay.textContent='✓ Paguei a parcela'; d._el.pay.className='paybtn';}
    }
  });
  const el=document.getElementById('divTotal'); setBig(el,totalFalta,animate);
  document.getElementById('divParcelaMes').textContent='parcelas neste mês: '+money(n.dividasMes);
}
function celebrate(){
  if(reduce)return;
  const cols=['#4f46e5','#0f9d6b','#e7b24e','#7c6cff','#e05566'];
  for(let i=0;i<26;i++){const c=document.createElement('div'); c.className='confetti';
    c.style.left=(10+Math.random()*80)+'%'; c.style.background=cols[i%cols.length];
    const dur=1.1+Math.random()*.9; c.style.animation='fall '+dur+'s ease-in forwards'; c.style.animationDelay=(Math.random()*.2)+'s';
    document.body.append(c); setTimeout(()=>c.remove(),(dur+.3)*1000);}
}

/* reserve movement */
function moverReserva(delta){
  S.reserva.atual=Math.max(0,(+S.reserva.atual||0)+delta);
  updateComputed(true); save();
}
document.querySelectorAll('[data-res]').forEach(b=>b.addEventListener('click',()=>moverReserva(+b.dataset.res)));
document.getElementById('resGuardar').addEventListener('click',()=>{
  const inp=document.getElementById('resAddVal'); const v=parseFloat(inp.value)||0; if(v<=0)return;
  moverReserva(v); inp.value='';
});
document.getElementById('resUsar').addEventListener('click',()=>{
  const inp=document.getElementById('resAddVal'); const v=parseFloat(inp.value)||0; if(v<=0)return;
  moverReserva(-v); inp.value='';
});

function switchTab(tab){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.getElementById('viewTitle').textContent={mes:'Fôlego',hist:'Histórico',reserva:'Reserva',dividas:'Dívidas',conta:'Conta e ajustes'}[tab];
  document.getElementById('monthnav').style.display=(tab==='mes')?'':'none';
  document.getElementById('userBtn').classList.toggle('on',tab==='conta');
  document.getElementById('fab').classList.toggle('hide',tab==='conta');
  window.scrollTo(0,0);
  updateComputed(true);
  tabHooks.forEach(f=>f(tab));
  track('aba_aberta',{aba:tab});
}
const tabHooks=[];
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
  haptic(6); if(b.dataset.tab==='hist'&&!requirePremium('historico')) return; switchTab(b.dataset.tab);}));
document.getElementById('userBtn').addEventListener('click',()=>{haptic(6);switchTab(document.getElementById('view-conta').classList.contains('active')?'mes':'conta');});
function goMonth(delta){
  const leaving=S.current;
  const target=shiftMonth(S.current,delta);
  if(!S.months[target]){const base=cur();
    S.months[target]={ganhos:base.ganhos.map(x=>({...x})),comPrevNome:base.comPrevNome,comPrev:base.comPrev,comReal:0,fixos:base.fixos.map(x=>({...x,pago:false})),variaveis:[],extras:[],touched:false};}
  if(leaving!==todayId && S.months[leaving] && S.months[leaving].touched===false && leaving!==target) delete S.months[leaving];
  S.current=target; document.getElementById('monthLabel').textContent=fmtMonth(S.current);
  buildMes(); updateComputed(true); save();
}
document.getElementById('prevM').addEventListener('click',()=>goMonth(-1));
document.getElementById('nextM').addEventListener('click',()=>goMonth(1));
document.getElementById('comPrevNome').addEventListener('input',e=>{cur().comPrevNome=e.target.value;markTouched();save();});
document.getElementById('comPrev').addEventListener('input',e=>{cur().comPrev=parseFloat(e.target.value)||0;markTouched();updateComputed(false);save();});
document.getElementById('comReal').addEventListener('input',e=>{cur().comReal=parseFloat(e.target.value)||0;markTouched();updateComputed(false);save();});
document.getElementById('resMeta').addEventListener('input',e=>{S.reserva.meta=parseFloat(e.target.value)||0;updateComputed(false);save();});
document.getElementById('resAtual').addEventListener('input',e=>{S.reserva.atual=parseFloat(e.target.value)||0;updateComputed(false);save();});
document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.add;
  if(t==='ganho') cur().ganhos.push({nome:'Novo ganho',valor:0});
  else if(t==='extra') cur().extras.push({nome:'Renda extra',valor:0});
  else if(t==='fixo') cur().fixos.push({nome:'Novo gasto',valor:0});
  else if(t==='var') cur().variaveis.push({nome:'Novo gasto',valor:0});
  else if(t==='divida'){ if(S.dividas.length>=1&&!requirePremium('dividas')) return; S.dividas.push({nome:'Nova dívida',parcela:0,total:12,pagas:0});buildDividas();updateComputed(false);save();return;}
  markTouched(); buildMes();updateComputed(false);save();
}));
document.getElementById('reset').addEventListener('click',()=>{if(confirm('Apagar todos os seus lançamentos e recomeçar do zero?')){S=defaults();prevResBucket=0;init();save();toast('Tudo apagado. Vamos recomeçar!');}});


/* ---------- preferências, toast, vibração ---------- */
const PREFS_KEY='folego-prefs';
let P={theme:'auto',haptic:true};
try{P=Object.assign(P,JSON.parse(localStorage.getItem(PREFS_KEY))||{});}catch(e){}
function savePrefs(){try{localStorage.setItem(PREFS_KEY,JSON.stringify(P));}catch(e){}}
function haptic(p){if(P.haptic&&navigator.vibrate){try{navigator.vibrate(p);}catch(e){}}}
function applyTheme(){
  const r=document.documentElement;
  if(P.theme==='light'||P.theme==='dark') r.dataset.theme=P.theme; else delete r.dataset.theme;
  document.querySelectorAll('[data-theme-opt]').forEach(b=>b.classList.toggle('on',b.dataset.themeOpt===P.theme));
  const dark=P.theme==='dark'||(P.theme==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').setAttribute('content',dark?'#121318':'#4f46e5');
}
document.querySelectorAll('[data-theme-opt]').forEach(b=>b.addEventListener('click',()=>{P.theme=b.dataset.themeOpt;savePrefs();applyTheme();haptic(6);}));
const hapticToggle=document.getElementById('toggleHaptic');
hapticToggle.checked=P.haptic;
hapticToggle.addEventListener('change',()=>{P.haptic=hapticToggle.checked;savePrefs();haptic(15);});
const statsToggle=document.getElementById('toggleStats');
if(window.FolegoAnalytics&&FolegoAnalytics.available()){
  statsToggle.checked=!FolegoAnalytics.isOptedOut();
  statsToggle.addEventListener('change',()=>{ if(!statsToggle.checked) track('estatisticas_desligadas'); FolegoAnalytics.setOptOut(!statsToggle.checked); });
}else document.getElementById('statsRow').hidden=true;
applyTheme();

let toastTimer;
function toast(msg,actionLabel,action){
  const t=document.getElementById('toast'), b=document.getElementById('toastAct');
  document.getElementById('toastMsg').textContent=msg;
  b.hidden=!actionLabel; b.textContent=actionLabel||'';
  b.onclick=()=>{t.classList.remove('show'); if(action){action();haptic(8);}};
  t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),actionLabel?5000:2800);
}

/* ---------- sheets (lançamento rápido e configuração inicial) ---------- */
const scrim=document.getElementById('scrim');
let openSheetEl=null; const sheetCloseHooks=[];
function openSheet(el){
  if(openSheetEl&&openSheetEl!==el){ if(openSheetEl.id==='setupSheet') return; openSheetEl.classList.remove('open'); }
  openSheetEl=el; el.classList.add('open'); scrim.classList.add('open'); el.scrollTop=0; document.body.classList.add('sheet-open');
}
function closeSheet(force){
  if(!openSheetEl)return; if(openSheetEl.id==='setupSheet'&&!force)return;
  openSheetEl.classList.remove('open'); scrim.classList.remove('open'); openSheetEl=null; document.body.classList.remove('sheet-open');
  sheetCloseHooks.forEach(f=>f());
}
document.querySelectorAll('[data-close-sheet]').forEach(b=>b.addEventListener('click',()=>closeSheet()));

/* ---------- plano (grátis × Premium) ---------- */
let plan={isPremium:()=>true, openPaywall:()=>{}, sendFeedback:async()=>false, storeUrl:''};
function requirePremium(feature){ if(plan.isPremium()) return true; haptic([8,30,8]); plan.openPaywall(feature); return false; }
function refreshPlan(){
  const prem=plan.isPremium();
  document.querySelectorAll('[data-premium]').forEach(el=>el.classList.toggle('locked-feature',!prem));
  const addDiv=document.querySelector('[data-add=divida]');
  if(addDiv) addDiv.textContent=(!prem&&S.dividas.length>=1)?'+ adicionar dívida ⭐ Premium':'+ adicionar dívida';
  if(!prem&&document.getElementById('view-hist').classList.contains('active')) switchTab('mes');
  computedHooks.forEach(f=>{try{f();}catch(e){console.error(e);}});
}

/* ---------- pedido de avaliação (em momentos felizes) ---------- */
(function countUsageDay(){
  const d=new Date().toISOString().slice(0,10);
  if(P.lastDay!==d){P.lastDay=d; P.days=(P.days||0)+1; savePrefs();}
})();
function maybeAskReview(motivo){
  if((P.days||0)<3) return;
  if(P.reviewAt&&Date.now()-P.reviewAt<90*864e5) return;
  if(openSheetEl) return;
  P.reviewAt=Date.now(); savePrefs();
  track('avaliacao_perguntada',{motivo});
  setTimeout(()=>{renderReview('pergunta'); openSheet(document.getElementById('reviewSheet'));},1600);
}
function renderReview(step){
  const b=document.getElementById('reviewBody');
  if(step==='pergunta'){
    b.innerHTML='<div class="pw-head"><div class="gate-logo">💜</div><h3>Está curtindo o Fôlego?</h3></div>'+
      '<div class="btnrow"><button class="btn-ghost" id="rvMeh">Mais ou menos</button><button class="btn-primary" id="rvYes">Sim, estou! 😄</button></div>';
    b.querySelector('#rvYes').onclick=()=>{track('avaliacao_gostou');
      if(plan.storeUrl) renderReview('loja'); else {closeSheet(); toast('Que bom! Obrigado por usar o Fôlego 💜');}};
    b.querySelector('#rvMeh').onclick=()=>{track('avaliacao_nao_gostou');renderReview('feedback');};
  }else if(step==='loja'){
    b.innerHTML='<div class="pw-head"><div class="gate-logo">⭐</div><h3>Que bom! Avalia a gente?</h3><p class="hint">Leva 10 segundos e ajuda muito outras pessoas a encontrarem o app.</p></div>'+
      '<button class="btn-big" id="rvStore">Avaliar na Play Store</button><button class="btn-link" data-close-sheet>Agora não</button>';
    b.querySelector('#rvStore').onclick=()=>{track('avaliacao_loja_aberta'); if(plan.storeUrl) window.open(plan.storeUrl,'_blank','noopener'); closeSheet();};
  }else{
    b.innerHTML='<div class="pw-head"><div class="gate-logo">🛠️</div><h3>O que podemos melhorar?</h3><p class="hint">Sua opinião vai direto para quem faz o app.</p></div>'+
      '<textarea class="field-in" id="rvText" rows="4" maxlength="2000" placeholder="Conta pra gente…"></textarea>'+
      '<button class="btn-big" id="rvSend">Enviar</button><button class="btn-link" data-close-sheet>Agora não</button>';
    b.querySelector('#rvSend').onclick=async()=>{
      const t=b.querySelector('#rvText').value.trim(); if(!t){b.querySelector('#rvText').focus();return;}
      await plan.sendFeedback(t,{motivo:'avaliacao'}); closeSheet(); toast('Obrigado! Sua opinião foi enviada 💜');
    };
  }
  b.querySelectorAll('[data-close-sheet]').forEach(x=>x.onclick=()=>closeSheet());
}
scrim.addEventListener('click',closeSheet);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});

const QUICK_CATS=['mercado','alimentacao','transporte','saude','lazer','compras','contas','outros'];
const EXTRA_CHIPS=['Freela','Venda','Bônus','Bico','Pix recebido'];
let qType='var', qCat=null;
function paintQuick(){
  document.querySelectorAll('#qType button').forEach(b=>b.classList.toggle('on',b.dataset.q===qType));
  const box=document.getElementById('qChips'); box.innerHTML='';
  if(qType==='var') QUICK_CATS.forEach(id=>{const c=Cats.get(id); const b=document.createElement('button');
    b.textContent=c.emoji+' '+c.nome; b.dataset.cat=id; if(qCat===id) b.className='on';
    b.addEventListener('click',()=>{qCat=qCat===id?null:id; paintQuick(); haptic(5);}); box.append(b);});
  if(qType==='extra') EXTRA_CHIPS.forEach(c=>{const b=document.createElement('button'); b.textContent=c;
    b.addEventListener('click',()=>{document.getElementById('qName').value=c;
      box.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));haptic(5);}); box.append(b);});
  document.getElementById('qName').hidden=qType==='reserva';
  document.getElementById('qName').placeholder=qType==='var'&&qCat?Cats.get(qCat).nome+' (descrição opcional)':'Descrição (opcional)';
  const qd=document.getElementById('qDate'); qd.hidden=qType==='reserva';
  qd.min=S.current+'-01'; qd.max=S.current+'-'+String(daysInMonth(S.current)).padStart(2,'0');
  if(!qd.value||qd.value<qd.min||qd.value>qd.max) qd.value=defaultDate();
  document.getElementById('qSave').textContent=qType==='reserva'?'Guardar na reserva':qType==='extra'?'Lançar renda':'Lançar gasto';
}
document.querySelectorAll('#qType button').forEach(b=>b.addEventListener('click',()=>{qType=b.dataset.q;paintQuick();haptic(5);}));
function openQuick(tipo,nome){
  document.getElementById('qVal').value=''; document.getElementById('qName').value=nome||''; qCat=null;
  document.getElementById('qDate').value=defaultDate(); qType=tipo||'var';
  paintQuick(); openSheet(document.getElementById('quickSheet'));
  setTimeout(()=>document.getElementById('qVal').focus(),250);
}
document.getElementById('fab').addEventListener('click',()=>{
  haptic(8); qType=document.querySelector('#view-reserva.active')?'reserva':'var';
  document.getElementById('qVal').value=''; document.getElementById('qName').value=''; qCat=null;
  document.getElementById('qDate').value=defaultDate();
  paintQuick(); openSheet(document.getElementById('quickSheet'));
  setTimeout(()=>document.getElementById('qVal').focus(),250);
});
function quickSave(){
  const v=parseFloat(document.getElementById('qVal').value)||0;
  if(v<=0){document.getElementById('qVal').focus();haptic([10,40,10]);return;}
  const nome=document.getElementById('qName').value.trim();
  track('lancamento_rapido',{tipo:qType});
  if(qType==='reserva'){moverReserva(v); closeSheet(); toast('R$ '+v.toLocaleString('pt-BR')+' guardado na reserva 🛟'); haptic(15); return;}
  const m=cur(); const list=qType==='extra'?m.extras:m.variaveis;
  const typedCat=qType==='var'?(qCat||Cats.guess(nome)):null;
  const item={nome:nome||(qType==='extra'?'Renda extra':(typedCat?Cats.get(typedCat).nome:'Gasto do dia')),valor:v,
    data:document.getElementById('qDate').value||defaultDate()};
  if(typedCat) item.cat=typedCat;
  list.push(item); markTouched(); buildMes(); updateComputed(true); save(); closeSheet(); haptic(15);
  launchHooks.forEach(f=>{try{f(item,qType);}catch(e){console.error(e);}});
  P.launches=(P.launches||0)+1;
  // Sequência de dias seguidos anotando (só conta 1 vez por dia).
  const hoje=isoToday(), ontem=(()=>{const d=new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();
  if(P.lastLaunchDay!==hoje){ P.streak=P.lastLaunchDay===ontem?(P.streak||0)+1:1; P.lastLaunchDay=hoje;
    if([3,7,14,30].includes(P.streak)){ track('sequencia',{dias:P.streak}); setTimeout(()=>toast('🔥 '+P.streak+' dias seguidos anotando! É assim que se ganha fôlego.'),3200); } }
  updateCoach();
  savePrefs(); if(P.launches===8) maybeAskReview('lancamentos');
  toast((qType==='extra'?'Renda de ':'Gasto de ')+money(v)+' lançado','Desfazer',()=>{const i=list.indexOf(item);if(i>-1)list.splice(i,1);buildMes();updateComputed(true);save();});
}
document.getElementById('qSave').addEventListener('click',quickSave);
document.getElementById('qVal').addEventListener('keydown',e=>{if(e.key==='Enter')quickSave();});

let onboarded=false;
function maybeOnboard(){
  if(onboarded||!firstRun) return; onboarded=true;
  const com=document.getElementById('sCom');
  document.getElementById('sLogin').hidden=!plan.loginAvailable;
  com.addEventListener('change',()=>{document.getElementById('sComBox').hidden=!com.checked;});
  openSheet(document.getElementById('setupSheet'));
}
document.getElementById('sGo').addEventListener('click',()=>{
  const m=cur(); const sal=parseFloat(document.getElementById('sSalario').value)||0;
  if(m.ganhos[0]) m.ganhos[0].valor=sal; else m.ganhos.push({nome:'Salário',valor:sal});
  S.config.comissao=document.getElementById('sCom').checked;
  m.comPrev=parseFloat(document.getElementById('sComVal').value)||0;
  firstRun=false; buildMes(); updateComputed(true); save();
  closeSheet(true);
  haptic(15); toast('Pronto! Agora preencha seus gastos fixos 👇');
  track('configuracao_inicial',{comissao:S.config.comissao,informou_salario:sal>0});
});

document.getElementById('sLogin').addEventListener('click',()=>{closeSheet(true); switchTab('conta'); track('configuracao_pulada_login');});

/* ---------- exportar / importar ---------- */
function exportData(){
  const blob=new Blob([JSON.stringify({app:'folego',v:1,exportedAt:new Date().toISOString(),state:S},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='folego-backup-'+todayId+'.json';
  document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  toast('Arquivo de backup baixado ⬇️'); track('dados_exportados');
}
function replaceState(ns){
  if(!ns||typeof ns!=='object'||!ns.months) throw new Error('arquivo inválido');
  localStorage.setItem(KEY,JSON.stringify(ns)); location.reload();
}
document.getElementById('exportBtn').addEventListener('click',exportData);
document.getElementById('importBtn').addEventListener('click',()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f)return;
  f.text().then(t=>{const d=JSON.parse(t); const ns=d.state||d;
    if(!ns.months) throw 0;
    if(confirm('Substituir os dados atuais pelos do arquivo?')){ track('dados_importados'); replaceState(ns); }
  }).catch(()=>toast('Esse arquivo não é um backup do Fôlego.'));
  e.target.value='';
});

window.FolegoApp={
  getState:()=>S, replaceState, exportData, toast, haptic, celebrate, switchTab,
  isFirstRun:()=>firstRun, maybeOnboard, openSheet, closeSheet, requirePremium,
  cur, ensureMonth, monthNumbers, openQuick, money, money1, fmtMonth, abrevMonth, shiftMonth, todayId, save, markTouched, buildMes, updateComputed,
  isPremium:()=>plan.isPremium(), track, openCatPicker,
  onComputed:f=>computedHooks.push(f), onLaunch:f=>launchHooks.push(f), onAchievement:f=>achievementHooks.push(f),
  setPlan:p=>{plan=Object.assign(plan,p);}, refreshPlan, onSheetClose:f=>sheetCloseHooks.push(f),
  wipe:()=>{try{localStorage.removeItem(KEY);}catch(e){} S=defaults();firstRun=true;onboarded=false;prevResBucket=0;init();},
  onSave:f=>saveHooks.push(f), onTab:f=>tabHooks.push(f)
};

function init(){
  document.getElementById('monthLabel').textContent=fmtMonth(S.current);
  buildMes(); buildDividas(); updateComputed(true);
}
init();
if(new URLSearchParams(location.search).get('add')==='var' && !firstRun) setTimeout(()=>document.getElementById('fab').click(),400);

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
