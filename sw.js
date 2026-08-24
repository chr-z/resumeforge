// ResumeForge service worker — offline-first, cache-versioned.
const CACHE_NAME = ''resumeforge-v2'
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/core.js',
  './js/app.js',
  './js/i18n.js',
  './locales/en.json',
  './locales/pt-BR.json',
  './manifest.json',
  './js/pay.js',
  './upgrade.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Offline-first: serve from cache, refresh in background when online.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && new URL(event.request.url).origin === location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
