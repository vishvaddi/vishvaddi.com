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

    // Overpass POI lookup proxy
    if (path === "/api/poi/overpass" && request.method === "POST") {
      const body = await request.text();
      if (!body || body.length > 1000 || !/around:/.test(body)) {
        return new Response("[]", { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const upstream = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": UA },
        body,
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
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

    // Everything else: serve the built site.
    return env.ASSETS.fetch(request);
  },
};
