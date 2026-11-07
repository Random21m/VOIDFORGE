// Offline copy for the VOIDFORGE online demo. Network first: when you are online you always get the
// current files; when you are offline the last copy you opened is used. Bump CACHE on every demo update.
const CACHE = 'voidforge-demo-2.5.0';
const FILES = ['./', 'index.html', 'voidforge.html', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.webmanifest', 'register.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(r, { cache: 'no-store' }).then((resp) => {
    if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); }
    return resp;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || (r.mode === 'navigate' ? caches.match('index.html') : undefined) || new Response('Offline and not saved yet. Open this page once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
