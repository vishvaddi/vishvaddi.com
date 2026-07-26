// Deep Swarm app shell — scoped to /games/deep-swarm/ only; the main site's
// worker never sees this. Network-first so a deploy is picked up on next
// launch, cache fallback so the installed app opens offline.
const CACHE = 'deepswarm-v25';
const SHELL = ['./index.html', './game.js', './manifest.json', './icon-192.png', './icon-512.png', './concept_art/02_cockpit_porthole_dread.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
