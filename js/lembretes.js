/*
 * Fôlego — contas a pagar (cartão na aba Mês) e lembretes por notificação (Web Push).
 * As notificações são enviadas pelo servidor (função send-reminders) uma vez por dia.
 * Carregado depois de js/account.js.
 */
(function(){
  'use strict';
  const App = window.FolegoApp, Cats = window.FolegoCats, Acc = window.FolegoAccount || {};
  const C = window.FOLEGO_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DUE_SOON = 5; // dias de antecedência para aparecer no cartão

  /* ---------- cartão "Contas a pagar" ---------- */
  function paintBills(){
    const box = $('billsCard'); if(!box) return;
    const st = App.getState();
    if(st.current !== App.todayId){ box.hidden = true; return; }
    const day = new Date().getDate();
    const items = (App.cur().fixos||[])
      .filter(f => f.dia && !f.pago && (+f.valor||0) > 0 && f.dia - day <= DUE_SOON)
      .sort((a,b) => a.dia - b.dia);
    if(!items.length){ box.hidden = true; return; }
    const when = f => f.dia < day ? '<b class="neg-text">atrasada ' + (day-f.dia) + 'd</b>' : f.dia === day ? '<b class="neg-text">vence hoje</b>' : f.dia === day+1 ? 'vence amanhã' : 'vence dia ' + f.dia;
    box.hidden = false;
    box.innerHTML = '<div class="sec-head"><h2>Contas a pagar</h2><span class="sec-total num">' + App.money(items.reduce((s,f)=>s+(+f.valor||0),0)) + '</span></div>' +
      items.map((f,i) => '<div class="bill"><span class="be">' + Cats.of(f).emoji + '</span><span class="bn">' + esc(f.nome) + '<small>' + when(f) + '</small></span>' +
        '<span class="bv num">' + App.money(+f.valor||0) + '</span><button class="btn-ghost bp" data-i="' + i + '">Paguei</button></div>').join('');
    box.querySelectorAll('.bp').forEach(b => b.addEventListener('click', () => {
      const f = items[+b.dataset.i]; f.pago = true;
      App.markTouched(); App.save(); App.haptic(15); App.track('conta_paga_cartao');
      App.buildMes(); App.updateComputed(false);
      App.toast('“' + f.nome + '” marcada como paga ✓', 'Desfazer', () => { f.pago = false; App.save(); App.buildMes(); App.updateComputed(false); });
    }));
  }

  /* ---------- lembretes por notificação ---------- */
  const PUSH_KEY = 'folego-push';
  const pushSupported = () => !!(C.VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const isOn = () => { try{ return localStorage.getItem(PUSH_KEY) === '1'; }catch(e){ return false; } };
  const setOn = v => { try{ v ? localStorage.setItem(PUSH_KEY,'1') : localStorage.removeItem(PUSH_KEY); }catch(e){} };

  async function enablePush(){
    const sb = Acc.client && Acc.client(), user = Acc.user && Acc.user();
    if(!sb || !user){ App.toast('Entre com sua conta Google para receber lembretes.'); App.switchTab('conta'); return false; }
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ App.toast('Permita as notificações nas configurações do celular para receber lembretes.'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToBytes(C.VAPID_PUBLIC_KEY)});
    const j = sub.toJSON();
    const {error} = await sb.from('push_subscriptions').upsert({
      endpoint: j.endpoint, user_id: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
    });
    if(error) throw error;
    setOn(true); App.track('lembretes_ligados');
    const semDia = (App.cur().fixos||[]).filter(f => (+f.valor||0) > 0 && !f.dia).length;
    App.toast(semDia ? 'Lembretes ligados 🔔 Defina o dia de vencimento das contas fixas.' : 'Lembretes ligados 🔔 Avisaremos 1 dia antes e no dia.');
    return true;
  }
  async function disablePush(){
    setOn(false); App.track('lembretes_desligados');
    try{
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if(sub){
        const sb = Acc.client && Acc.client();
        if(sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
    }catch(e){}
  }
  function initToggle(){
    const row = $('pushRow'), t = $('togglePush'); if(!row) return;
    if(!pushSupported()){ row.hidden = true; return; }
    t.checked = isOn() && Notification.permission === 'granted';
    t.addEventListener('change', async () => {
      t.disabled = true;
      try{
        if(t.checked){ if(!(await enablePush())) t.checked = false; }
        else await disablePush();
      }catch(e){ t.checked = false; setOn(false); App.toast('Não foi possível ligar os lembretes agora.'); }
      t.disabled = false;
    });
  }

  App.onComputed(paintBills);
  initToggle();
  paintBills();
  if(location.hash === '#contas') setTimeout(() => { const b = $('billsCard'); if(b && !b.hidden) b.scrollIntoView({behavior:'smooth'}); }, 400);
})();
