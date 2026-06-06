// Static-assets Worker for vishvaddi.com. Static files are served first by the
// assets layer; only non-asset paths reach this fetch handler. We use it to
// proxy the Field Survival map's tile + POI lookups same-origin, so the site's
// strict CSP can stay default-src 'self'. Everything else falls through to the
// built site assets.
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const TILE_RE = /^\/api\/poi\/tiles\/(\d+)\/(\d+)\/(\d+)$/;
const UA = "vishvaddi.com field-survival tool (personal, low volume)";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Overpass POI lookup proxy. overpass-api.de is the fastest instance that
    // reliably returns full data (~2-3s); kumi is kept only as a slow backstop.
    // A hard per-request timeout means a stalled instance fails over (or returns
    // empty) instead of hanging the map.
    if (path === "/api/poi/overpass" && request.method === "POST") {
      const body = await request.text();
      if (!body || body.length > 1000 || !/around:/.test(body)) {
        return new Response("[]", { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
      ];
      const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };
      for (const endpoint of mirrors) {
        try {
          const upstream = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "text/plain", "User-Agent": UA },
            body,
            signal: AbortSignal.timeout(15000),
          });
          if (upstream.ok) {
            return new Response(upstream.body, { status: 200, headers: jsonHeaders });
          }
        } catch {
          /* timeout or network error — try the next mirror */
        }
      }
      return new Response("[]", { status: 502, headers: jsonHeaders });
    }

    // OpenStreetMap raster tile proxy
    const m = path.match(TILE_RE);
    if (m && request.method === "GET") {
      const [, z, x, y] = m;
      if (Number(z) > 19) return new Response("bad request", { status: 400 });
      const upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
        headers: { "User-Agent": UA },
        cf: { cacheTtl: 86400, cacheEverything: true },
      } as RequestInit);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }

    // Gutenberg text proxy — avoids CORS, caches at edge
    if (path === "/api/book" && request.method === "GET") {
      const bookUrl = url.searchParams.get("url") || "";
      if (!bookUrl || !/^https:\/\/www\.gutenberg\.org\//.test(bookUrl)) {
        return new Response("bad url", { status: 400 });
      }
      try {
        const upstream = await fetch(bookUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(20000),
        });
        if (!upstream.ok) return new Response("upstream error", { status: 502 });
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response("fetch failed", { status: 504 });
      }
    }

    // Everything else: serve the built site.
    return env.ASSETS.fetch(request);
  },
};
