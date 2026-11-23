// Offline support: the whole app is cached on first visit.
// Network first, so updates appear as soon as you are online; the cache answers when offline.
const CACHE = 'verbasizer-v3';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'cutup.js',
  'smoothing.js',
  'samples.js',
  'sound.js',
  'cards.js',
  'store.js',
  'app.js',
  'manifest.webmanifest',
  'fonts/Galmuri11.woff2',
  'fonts/Galmuri11-Bold.woff2',
  'fonts/Galmuri14.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then((cached) => cached ?? (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
