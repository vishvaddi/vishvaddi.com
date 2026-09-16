// Offline fallback only — the Play Store app (Trusted Web Activity) needs one.
// Nothing else is cached: tool data lives in localStorage, and pages must never
// be served stale or kept from a previous owner session.
const OFFLINE_CACHE = "offline-v1";
const OFFLINE_URL = "/offline/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Retire the former public-site precache without deleting saved tool data.
    for (const name of await caches.keys()) {
      const retired = name.startsWith("workbox-") || name === "books" || name === "gutendex";
      const staleOffline = name.startsWith("offline-") && name !== OFFLINE_CACHE;
      if (retired || staleOffline) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE })) || Response.error()),
  );
});
