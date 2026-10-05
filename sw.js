const CACHE = 'folego-v10';
const ASSETS = ['./', './index.html', './config.js', './css/app.css', './js/analytics.js', './js/categorias.js', './js/app.js', './js/account.js', './js/relatorios.js', './js/inteligencia.js', './js/lembretes.js', './js/lumi.js', './js/importar.js', './js/instalar.js', './js/anuncios.js', './js/compartilhar.js', './js/meta.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './privacy.html', './termos.html'];
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res){
  if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fontes e bibliotecas com versão fixa: cache primeiro.
  if(STATIC_HOSTS.includes(url.hostname)){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
    return;
  }
  // Login Google, Supabase, Play etc.: sempre rede, nunca cache.
  if(url.origin !== self.location.origin) return;

  // Arquivos do app: rede primeiro (pega atualizações), cache se estiver offline.
  e.respondWith(
    fetch(req).then(res => put(req, res))
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

// Lembretes enviados pelo servidor (função send-reminders).
self.addEventListener('push', e => {
  let msg = {};
  try{ msg = e.data ? e.data.json() : {}; }catch(err){ msg = {title:'Fôlego', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Fôlego', {
    body: msg.body || '', tag: msg.tag || 'folego', icon: './icon-192.png', badge: './icon-192.png',
    data: {url: msg.url || './index.html'}
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './index.html', self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    for(const c of list){ if(c.url.startsWith(self.registration.scope) && 'focus' in c){ c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
