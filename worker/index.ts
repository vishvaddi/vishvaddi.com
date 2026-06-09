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
const MAX_FEED_BYTES = 2_000_000;
const MAX_ICY_BYTES = 1_000_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.includes(":")
  ) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const nums = parts.map(Number);
    if (nums.some((n) => n < 0 || n > 255)) return true;
    const [a, b] = nums;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return false;
}

function publicHttpsUrl(raw: string): URL | null {
  try {
    const target = new URL(raw);
    if (target.protocol !== "https:" || target.username || target.password) return null;
    if (target.port && target.port !== "443") return null;
    if (isBlockedHost(target.hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

async function fetchPublic(target: URL, init: RequestInit): Promise<Response> {
  let current = target;
  for (let i = 0; i < 4; i++) {
    const upstream = await fetch(current, { ...init, redirect: "manual" });
    const location = upstream.headers.get("Location");
    if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) return upstream;
    const next = publicHttpsUrl(new URL(location, current).toString());
    if (!next) throw new Error("blocked redirect");
    current = next;
  }
  throw new Error("too many redirects");
}

function concatBytes(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk.slice(0, Math.min(chunk.length, length - offset)), offset);
    offset += chunk.length;
    if (offset >= length) break;
  }
  return out;
}

async function readIcyTitle(upstream: Response): Promise<string | null> {
  const metaInt = Number(upstream.headers.get("icy-metaint") || "0");
  if (!Number.isFinite(metaInt) || metaInt <= 0 || metaInt > MAX_ICY_BYTES) return null;
  const reader = upstream.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  let needed = metaInt + 1;
  try {
    while (total < needed && total < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    if (total < needed) return null;
    let buffer = concatBytes(chunks, total);
    const metaLength = buffer[metaInt] * 16;
    if (!metaLength) return null;
    needed = metaInt + 1 + metaLength;
    while (total < needed && total < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    if (total < needed) return null;
    buffer = concatBytes(chunks, total);
    const meta = new TextDecoder("utf-8")
      .decode(buffer.slice(metaInt + 1, needed))
      .replace(/\0/g, "")
      .trim();
    const match = meta.match(/StreamTitle='([^']*)'/i);
    return match?.[1]?.trim() || null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

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

    // RSS/Atom proxy for the Feeds page. It is intentionally HTTPS-only with
    // private-host blocking and a small body cap so it cannot become a useful
    // general open proxy.
    if (path === "/api/feed" && request.method === "GET") {
      const target = publicHttpsUrl(url.searchParams.get("url") || "");
      if (!target) return new Response("bad url", { status: 400 });
      try {
        const upstream = await fetchPublic(target, {
          headers: {
            "User-Agent": UA,
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
          cf: { cacheTtl: 600, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return new Response("upstream error", { status: 502 });
        const len = Number(upstream.headers.get("Content-Length") || "0");
        if (len > MAX_FEED_BYTES) return new Response("feed too large", { status: 413 });
        const contentType = upstream.headers.get("Content-Type") || "text/xml; charset=utf-8";
        const body = await upstream.arrayBuffer();
        if (body.byteLength > MAX_FEED_BYTES) return new Response("feed too large", { status: 413 });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response("fetch failed", { status: 504 });
      }
    }

    // Radio ICY metadata proxy. Reads only enough bytes to parse StreamTitle,
    // then closes the upstream stream. Same public-HTTPS restrictions as feeds.
    if (path === "/api/radio-meta" && request.method === "GET") {
      const target = publicHttpsUrl(url.searchParams.get("url") || "");
      if (!target) return Response.json({ title: null }, { status: 400 });
      try {
        const upstream = await fetchPublic(target, {
          headers: {
            "User-Agent": UA,
            "Accept": "*/*",
            "Icy-MetaData": "1",
          },
          signal: AbortSignal.timeout(12000),
          cf: { cacheTtl: 20, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return Response.json({ title: null }, { status: 502 });
        return Response.json(
          { title: await readIcyTitle(upstream) },
          { headers: { "Cache-Control": "public, max-age=20" } }
        );
      } catch {
        return Response.json({ title: null }, { status: 504 });
      }
    }

    // Reader book proxy — fetch Project Gutenberg plain text same-origin so the
    // strict CSP stays default-src 'self'. Locked to gutenberg.org only.
    if (path === "/api/book" && request.method === "GET") {
      const target = publicHttpsUrl(url.searchParams.get("url") || "");
      if (!target || (target.hostname !== "www.gutenberg.org" && target.hostname !== "gutenberg.org")) {
        return new Response("bad url", { status: 400 });
      }
      try {
        const upstream = await fetchPublic(target, {
          headers: { "User-Agent": UA, "Accept": "text/plain" },
          signal: AbortSignal.timeout(20000),
          cf: { cacheTtl: 86400, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return new Response("upstream error", { status: 502 });
        const body = await upstream.arrayBuffer();
        return new Response(body, {
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
