const CACHE = 'moneyflow-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './css/ui-polish.css',
  './js/app.js',
  './js/loan-logic.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(r => {
    if (r && r.status === 200) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return r;
  }).catch(()=>caches.match('./'))));
});
