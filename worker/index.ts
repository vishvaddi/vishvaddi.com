// Static-assets Worker for vishvaddi.com. Static files are served first by the
// assets layer; only non-asset paths reach this fetch handler. We use it to
// proxy the Field Survival map's tile + POI lookups same-origin, so the site's
// strict CSP can stay default-src 'self'. Everything else falls through to the
// built site assets.
interface DurableObjectState {
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
}
interface DurableStub { fetch(url: string): Promise<Response> }
interface DurableNamespace { idFromName(name: string): unknown; get(id: unknown): DurableStub }
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  // Durable Object rate limiter — one instance per IP, so the count is globally
  // consistent (a plain in-memory Map can't be: Cloudflare spreads requests
  // across many isolates). See wrangler.jsonc.
  RL_DO?: DurableNamespace;
}

// One Durable Object instance per IP holds a fixed-window counter. Fast-path
// reads in-memory; mirrors to storage only so a freshly-woken instance can
// resume mid-window rather than letting a burst through.
export class RateLimiter {
  private state: DurableObjectState;
  private count = 0;
  private reset = 0;
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 90;
    const windowMs = Number(url.searchParams.get("window")) || 60_000;
    const now = Date.now();
    if (this.reset === 0) {
      this.reset = (await this.state.storage.get<number>("reset")) || 0;
      this.count = (await this.state.storage.get<number>("count")) || 0;
    }
    if (now > this.reset) {
      this.reset = now + windowMs;
      this.count = 0;
    }
    this.count++;
    const ok = this.count <= limit;
    await this.state.storage.put("count", this.count);
    await this.state.storage.put("reset", this.reset);
    return Response.json({ ok, retryAfter: Math.max(1, Math.ceil((this.reset - now) / 1000)) });
  }
}

async function apiAllowed(request: Request, env: Env): Promise<boolean> {
  if (!env.RL_DO) return true; // binding missing → fail open (don't break the site)
  const ip = request.headers.get("cf-connecting-ip") || "anon";
  try {
    const stub = env.RL_DO.get(env.RL_DO.idFromName(ip));
    const res = await stub.fetch("https://rl/?limit=120&window=60000");
    const { ok } = (await res.json()) as { ok: boolean };
    return ok;
  } catch {
    return true; // limiter error → fail open rather than lock users out
  }
}

const TILE_RE = /^\/api\/poi\/tiles\/(\d+)\/(\d+)\/(\d+)$/;
const UA = "vishvaddi.com field-survival tool (personal, low volume)";
const MAX_FEED_BYTES = 2_000_000;
const MAX_ICY_BYTES = 1_000_000;
const GUTENBERG_OPDS = "https://www.gutenberg.org/ebooks/search.opds/";
const STANDARD_EBOOKS = "https://standardebooks.org";

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

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textMatch(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
}

function htmlToReadableText(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  return decodeHtmlEntities(main
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function parseOpds(xml: string) {
  const entries = xml.split(/<entry>/i).slice(1);
  return entries
    .map((entry) => {
      const idUrl = textMatch(entry, /<id>([^<]+)<\/id>/i);
      const idMatch = idUrl.match(/\/ebooks\/(\d+)/);
      const id = idMatch?.[1];
      if (!id) return null;
      const title = textMatch(entry, /<title>([^<]+)<\/title>/i);
      // Gutenberg's search.opds carries the creator in each entry's <content>,
      // not in an <author> element (that's the feed's own author).
      const author = textMatch(entry, /<content[^>]*>([^<]+)<\/content>/i);
      return {
        id: Number(id),
        title: title || `eBook ${id}`,
        authors: author ? [{ name: author }] : [],
        formats: {
          "image/jpeg": `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
          "text/plain; charset=utf-8": `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
        },
      };
    })
    .filter(Boolean);
}

function parseStandardEbooksList(html: string, base = STANDARD_EBOOKS) {
  const entries = html.split(/<li[^>]+typeof="schema:Book"[^>]*>/i).slice(1);
  return entries
    .map((entry) => {
      const about = textMatch(entry, /about="([^"]+)"/i);
      const path = about || textMatch(entry, /<a[^>]+href="(\/ebooks\/[^"]+)"[^>]+property="schema:url"/i);
      if (!/^\/ebooks\/[^?#]+$/.test(path)) return null;
      const title = textMatch(entry, /<span[^>]+property="schema:name"[^>]*>([^<]+)<\/span>/i);
      const authorBlock = entry.match(/<p[^>]+class="author"[\s\S]*?<\/p>/i)?.[0] || "";
      const author = textMatch(authorBlock, /<span[^>]+property="schema:name"[^>]*>([^<]+)<\/span>/i);
      const coverPath = textMatch(entry, /<img[^>]+src="([^"]+)"/i);
      const url = new URL(path, base).toString();
      return {
        id: path.replace(/^\/ebooks\//, ""),
        title: title || path.split("/").pop()?.replace(/-/g, " ") || "Standard Ebook",
        author: author || "Unknown",
        url,
        textUrl: new URL(`${path}/text/single-page`, base).toString(),
        cover: coverPath ? new URL(coverPath, base).toString() : "",
      };
    })
    .filter(Boolean);
}

function standardEbooksNext(html: string, base: string): string | null {
  const next = textMatch(html, /<a[^>]+href="([^"]+)"[^>]*>\s*Next/i);
  if (!next) return null;
  const url = new URL(next, base);
  return url.hostname === "standardebooks.org" && url.pathname === "/ebooks" ? url.toString() : null;
}

async function fetchOpdsPage(target: string): Promise<{ items: unknown[]; next: string | null }> {
  const upstream = await fetchPublic(publicHttpsUrl(target) || new URL(target), {
    headers: {
      "User-Agent": UA,
      "Accept": "application/atom+xml, application/xml, text/xml, text/plain;q=0.8",
    },
    signal: AbortSignal.timeout(20000),
    cf: { cacheTtl: 600, cacheEverything: true },
  } as RequestInit);
  if (!upstream.ok) throw new Error("upstream error");
  const xml = await upstream.text();
  const next = xml.match(/<link[^>]+rel="next"[^>]+href="([^"]+)"/i)?.[1] || null;
  return {
    items: parseOpds(xml),
    next: next ? new URL(decodeHtmlEntities(next), target).toString() : null,
  };
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

    // Rate-limit the outbound proxy endpoints per IP so they can't be abused to
    // run up usage, proxy traffic, or get the worker banned upstream. Map tiles
    // are excluded — panning fires many at once and they're served from cache.
    if (path.startsWith("/api/") && !TILE_RE.test(path)) {
      if (!(await apiAllowed(request, env))) {
        return new Response("Too many requests — slow down and try again shortly.", {
          status: 429,
          headers: { "Retry-After": "60", "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      }
    }

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

    // Reader text proxy — avoids CORS, caches at edge. Locked to Gutenberg
    // plain text and Standard Ebooks' public single-page XHTML reader.
    if (path === "/api/book" && request.method === "GET") {
      const target = publicHttpsUrl(url.searchParams.get("url") || "");
      if (!target) {
        return new Response("bad url", { status: 400 });
      }
      try {
        const isGutenberg = target.hostname === "www.gutenberg.org" || target.hostname === "gutenberg.org";
        const isStandardEbooks = target.hostname === "standardebooks.org" && /^\/ebooks\/[^?#]+\/text\/single-page$/.test(target.pathname);
        if (!isGutenberg && !isStandardEbooks) return new Response("bad url", { status: 400 });
        const upstream = await fetchPublic(target, {
          headers: { "User-Agent": UA, "Accept": isStandardEbooks ? "application/xhtml+xml,text/html" : "text/plain" },
          signal: AbortSignal.timeout(20000),
          cf: { cacheTtl: 86400, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return new Response("upstream error", { status: 502 });
        const body = isStandardEbooks ? htmlToReadableText(await upstream.text()) : upstream.body;
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

    // Gutenberg OPDS proxy — used for the reader's top-100 shuffle pool and
    // full-catalog search. Returns normalised JSON so the client stays simple.
    if (path === "/api/gutenberg-opds" && request.method === "GET") {
      const query = (url.searchParams.get("query") || "").trim();
      const sortOrder = (url.searchParams.get("sort_order") || "downloads").trim() || "downloads";
      const startIndex = Math.max(1, parseInt(url.searchParams.get("start_index") || "1", 10) || 1);

      // "Load more" passes back the OPDS `next` URL we returned previously. It is
      // a gutenberg.org link, so validate the host before following it.
      const cursor = url.searchParams.get("cursor");
      let startUrl: string;
      if (cursor) {
        const c = publicHttpsUrl(cursor);
        if (!c || (c.hostname !== "www.gutenberg.org" && c.hostname !== "gutenberg.org")) {
          return Response.json({ results: [], next: null }, { status: 400 });
        }
        startUrl = c.toString();
      } else {
        const base = new URL(GUTENBERG_OPDS);
        if (query) {
          base.searchParams.set("query", query);
        }
        base.searchParams.set("sort_order", sortOrder);
        base.searchParams.set("start_index", String(startIndex));
        startUrl = base.toString();
      }

      try {
        const results: unknown[] = [];
        let next: string | null = startUrl;
        let pages = 0;
        while (next && results.length < 100 && pages < 4) {
          const page = await fetchOpdsPage(next);
          results.push(...page.items);
          next = page.next;
          pages++;
        }
        return Response.json({ results: results.slice(0, 100), next }, {
          headers: { "Cache-Control": "public, max-age=300" },
        });
      } catch {
        return Response.json({ results: [] }, { status: 504 });
      }
    }

    if (path === "/api/standardebooks" && request.method === "GET") {
      const query = (url.searchParams.get("query") || "").trim();
      const cursor = url.searchParams.get("cursor");
      let target: URL;
      if (cursor) {
        const c = publicHttpsUrl(cursor);
        if (!c || c.hostname !== "standardebooks.org" || c.pathname !== "/ebooks") {
          return Response.json({ results: [], next: null }, { status: 400 });
        }
        target = c;
      } else {
        target = new URL("/ebooks", STANDARD_EBOOKS);
        if (query) target.searchParams.set("query", query);
      }
      try {
        const upstream = await fetchPublic(target, {
          headers: {
            "User-Agent": UA,
            "Accept": "application/xhtml+xml,text/html",
          },
          signal: AbortSignal.timeout(15000),
          cf: { cacheTtl: 900, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return Response.json({ results: [], next: null }, { status: 502 });
        const html = await upstream.text();
        return Response.json(
          { results: parseStandardEbooksList(html, target.toString()), next: standardEbooksNext(html, target.toString()) },
          { headers: { "Cache-Control": "public, max-age=900" } },
        );
      } catch {
        return Response.json({ results: [], next: null }, { status: 504 });
      }
    }

    if (path === "/api/librivox" && request.method === "GET") {
      const query = (url.searchParams.get("query") || "").trim();
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
      const limit = 24;
      const makeApi = (field?: "title" | "author") => {
        const api = new URL("https://librivox.org/api/feed/audiobooks");
        api.searchParams.set("format", "json");
        api.searchParams.set("extended", "1");
        api.searchParams.set("coverart", "1");
        api.searchParams.set("limit", String(limit));
        api.searchParams.set("offset", String(offset));
        if (query && field) api.searchParams.set(field, query);
        return api;
      };
      const fetchBooks = async (api: URL) => {
        const upstream = await fetch(api, {
          headers: { "User-Agent": UA, "Accept": "application/json" },
          signal: AbortSignal.timeout(15000),
          cf: { cacheTtl: 900, cacheEverything: true },
        } as RequestInit);
        if (upstream.status === 404) return [];
        if (!upstream.ok) throw new Error(String(upstream.status));
        const data = (await upstream.json()) as { books?: unknown[] };
        return Array.isArray(data.books) ? data.books : [];
      };
      try {
        let results = query ? await fetchBooks(makeApi("title")) : await fetchBooks(makeApi());
        if (query && !results.length) results = await fetchBooks(makeApi("author"));
        return Response.json(
          { results, next: results.length === limit ? String(offset + limit) : null },
          { headers: { "Cache-Control": "public, max-age=900" } },
        );
      } catch {
        return Response.json({ results: [] }, { status: 504 });
      }
    }

    // Currency exchange-rate proxy for the unit converter. Keeps the page CSP at
    // connect-src 'self'; rates are cached for an hour. open.er-api.com is free
    // and needs no key.
    if (path === "/api/fx" && request.method === "GET") {
      try {
        const upstream = await fetch("https://open.er-api.com/v6/latest/USD", {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(12000),
          cf: { cacheTtl: 3600, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return Response.json({ rates: null }, { status: 502 });
        const data = (await upstream.json()) as { base_code?: string; rates?: Record<string, number> };
        return Response.json(
          { base: data.base_code || "USD", rates: data.rates || null },
          { headers: { "Cache-Control": "public, max-age=3600" } },
        );
      } catch {
        return Response.json({ rates: null }, { status: 504 });
      }
    }

    // Materials price tracker — proxies Yahoo Finance's keyless chart endpoint
    // for a small whitelist of construction-relevant commodities. History comes
    // from Yahoo (delayed, USD), so nothing is stored. Cached for an hour.
    if (path === "/api/prices" && request.method === "GET") {
      const SYMBOLS: Record<string, string> = {
        copper: "HG=F", aluminium: "ALI=F", lumber: "WOOD", crude: "CL=F",
        gas: "NG=F", gold: "GC=F", steel: "SLX", audusd: "AUDUSD=X",
      };
      const key = (url.searchParams.get("symbol") || "").toLowerCase();
      const sym = SYMBOLS[key];
      if (!sym) return Response.json({ error: "unknown symbol" }, { status: 400 });
      const ranges = ["1mo", "3mo", "6mo", "1y", "2y"];
      const range = ranges.includes(url.searchParams.get("range") || "") ? url.searchParams.get("range") : "6mo";
      try {
        const y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
        const upstream = await fetch(y, {
          headers: { "User-Agent": UA, "Accept": "application/json" },
          signal: AbortSignal.timeout(12000),
          cf: { cacheTtl: 3600, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return Response.json({ error: "upstream" }, { status: 502 });
        const data = (await upstream.json()) as {
          chart?: { result?: Array<{ timestamp?: number[]; meta?: { currency?: string }; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
        };
        const r = data.chart?.result?.[0];
        const ts = r?.timestamp || [];
        const close = r?.indicators?.quote?.[0]?.close || [];
        const points = ts
          .map((t, i) => ({ t, c: close[i] }))
          .filter((p): p is { t: number; c: number } => typeof p.c === "number");
        return Response.json(
          { symbol: key, currency: r?.meta?.currency || "USD", points },
          { headers: { "Cache-Control": "public, max-age=3600" } },
        );
      } catch {
        return Response.json({ error: "fetch failed" }, { status: 504 });
      }
    }

    // Last.fm "now playing" proxy — keeps the API key off the frontend. The key
    // is read-only public data with no billing, but proxying it follows the
    // least-exposure rule and lets the page CSP drop the audioscrobbler origin.
    if (path === "/api/lastfm" && request.method === "GET") {
      const user = (url.searchParams.get("user") || "").trim();
      if (!user || !/^[A-Za-z0-9_.-]{1,40}$/.test(user)) {
        return Response.json({ error: "bad user" }, { status: 400 });
      }
      const key = "b25b959554ed76058ac220b7b2e0a026"; // Last.fm public sample key
      const api = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(user)}&api_key=${key}&format=json&limit=1`;
      try {
        const upstream = await fetch(api, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(10000),
          cf: { cacheTtl: 25, cacheEverything: true },
        } as RequestInit);
        if (!upstream.ok) return Response.json({ error: "upstream" }, { status: 502 });
        return new Response(upstream.body, {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=25" },
        });
      } catch {
        return Response.json({ error: "fetch failed" }, { status: 504 });
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
