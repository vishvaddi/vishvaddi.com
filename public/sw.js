self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Retire the former public-site precache without deleting saved tool data.
    for (const name of await caches.keys()) {
      if (name.startsWith("workbox-") || name === "books" || name === "gutendex") await caches.delete(name);
    }
    await self.clients.claim();
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) await client.navigate(client.url);
  })());
});
