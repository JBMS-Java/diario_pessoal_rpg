const CACHE_NAME = 'cursed-system-v15';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/friendly.css',
  './css/palettes.css',
  './js/app.js',
  './js/modules/attributes.js',
  './js/modules/experience.js',
  './js/modules/progression.js',
  './js/modules/balance.js',
  './js/modules/rank-icons.js',
  './js/modules/rewards.js',
  './js/modules/ranks.js',
  './js/modules/quests.js',
  './js/modules/epics.js',
  './js/modules/storage.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Recurso indisponível offline.');
      });
    })
  );
});
