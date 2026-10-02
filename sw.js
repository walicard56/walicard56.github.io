const CACHE = 'folego-v2';
const ASSETS = ['./', './index.html', './config.js', './account.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './privacy.html', './termos.html'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

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

  // Fontes: cache primeiro.
  if(FONT_HOSTS.includes(url.hostname)){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
    return;
  }
  // Login Google, Drive, Play etc.: sempre rede, nunca cache.
  if(url.origin !== self.location.origin) return;

  // Arquivos do app: rede primeiro (pega atualizações), cache se estiver offline.
  e.respondWith(
    fetch(req).then(res => put(req, res))
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
