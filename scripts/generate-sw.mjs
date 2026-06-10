// Post-build: generate dist/sw.js precaching the whole site so the tools,
// studio and prepping pages work offline. Runs after optimize-og.mjs so the
// final PNG bytes are what get revisioned.
//
// Unlike optimize-og this is NOT best-effort: a missing service worker would
// silently break the offline promise, so a failure here fails the build.
import { generateSW } from "workbox-build";

const { count, size, warnings } = await generateSW({
  globDirectory: "dist",
  globPatterns: ["**/*.{html,js,css,svg,woff,woff2,webmanifest,wasm}"],
  globIgnores: [
    "og/**", // social-card PNGs — only scrapers need them
    "pagefind/**", // future-proof: never precache a search index wholesale
  ],
  swDest: "dist/sw.js",
  // Single self-contained file: no separate workbox-*.js runtime chunk, so
  // the /sw.js no-cache header in _headers governs the whole worker.
  inlineWorkboxRuntime: true,
  sourcemap: false,
  // One tab/SW per origin; take over immediately so updates apply on reload.
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  // /_astro/* is content-hashed + immutable; html/manifest get revisioned by
  // workbox itself, so everything is safe to serve cache-first.
  dontCacheBustURLsMatching: /^_astro\//,
  // Same-origin navigations to anything not precached (e.g. a brand-new page
  // before the SW updates) fall through to the network as normal.
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  runtimeCaching: [
    {
      // Book text via the worker proxy (/api/book?url=…). Text of a given
      // book never changes → cache-first makes previously opened books
      // readable fully offline. (reader.js uses cache:"no-store", which
      // bypasses the HTTP cache but not this SW cache.)
      urlPattern: /\/api\/book\?/,
      handler: "CacheFirst",
      options: {
        cacheName: "books",
        expiration: { maxEntries: 40 },
        cacheableResponse: { statuses: [200] },
      },
    },
    {
      // Gutendex catalog searches — fresh when online, last results offline.
      urlPattern: /^https:\/\/gutendex\.com\//,
      handler: "NetworkFirst",
      options: {
        cacheName: "gutendex",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 },
      },
    },
  ],
});

for (const w of warnings) console.warn(`[generate-sw] ${w}`);
console.log(
  `[generate-sw] precached ${count} files (${(size / 1024 / 1024).toFixed(1)} MB)`,
);
