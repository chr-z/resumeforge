// ResumeForge v2 service worker — offline-first, cache-versioned.
// The placeholder __RF_CACHE_VERSION__ is stamped by CI with the commit SHA.
const CACHE_NAME = '__RF_CACHE_VERSION__';
const PRECACHE_URLS = [
  './',
  './index.html',
  './upgrade.html',
  './css/style.css',
  './js/i18n.js',
  './js/pay.js',
  './manifest.json',
  './locales/en.json',
  './locales/pt-BR.json',
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
// Hashed build outputs (JS/CSS/wasm) are cached at runtime.
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

// Let the page warm the runtime cache after the Pyodide engine finishes loading.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'RF_WARM_RUNTIME' && Array.isArray(event.data.urls)) {
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(event.data.urls.map((u) => cache.add(u).catch(() => {})))
    );
  }
});
