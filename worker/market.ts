// Live prices for /money. Public since 16/09 (docs/PRO_PLAN.md Addendum 4 —
// every feature free, only exports metered); the per-IP /api limiter in
// worker/index.ts and the upstream edge cache below keep refreshes cheap. Follows the /api/prices and /api/fx proxy style in
// worker/index.ts: cache the *upstream* fetch at the edge (cf.cacheEverything)
// rather than the Worker's own response, so a repeat symbol set is cheap
// without needing a manual Cache API round trip.
import type { ProEnv } from "./pro.ts";

const SYMBOL_RE = /^[A-Z0-9.=^-]{1,15}$/;
const MAX_SYMBOLS = 25;
const CACHE_SECONDS = 900; // 15 minutes
const UA = "vishvaddi.com field-survival tool (personal, low volume)";
// Yahoo's quote endpoint (unlike the chart endpoint /api/prices uses) rejects
// non-browser User-Agents outright.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const COIN_IDS: Record<string, string> = { "BTC-AUD": "bitcoin", "ETH-AUD": "ethereum" };
const METAL_SYMBOLS: Record<string, string> = { "XAU-AUD": "GC=F", "XAG-AUD": "SI=F" };

interface PriceEntry { price: number; currency: string; asAt: string; change?: number; changePercent?: number }
interface MarketResult { prices: Record<string, PriceEntry>; source: string }

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface YahooQuoteRow {
  symbol: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
}

// One quote request covers every plain symbol; Yahoo simply omits tickers it
// doesn't recognise, so an unknown symbol never fails the whole call.
async function yahooQuote(symbols: string[]): Promise<Record<string, PriceEntry>> {
  const out: Record<string, PriceEntry> = {};
  if (!symbols.length) return out;
  const qs = `symbols=${symbols.map(encodeURIComponent).join(",")}`;
  for (const host of ["query1", "query2"]) {
    try {
      const upstream = await fetch(`https://${host}.finance.yahoo.com/v7/finance/quote?${qs}`, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      } as RequestInit);
      if (!upstream.ok) continue;
      const data = (await upstream.json()) as { quoteResponse?: { result?: YahooQuoteRow[] } };
      for (const row of data.quoteResponse?.result ?? []) {
        if (typeof row.regularMarketPrice !== "number") continue;
        out[row.symbol] = {
          price: row.regularMarketPrice,
          currency: row.currency || "USD",
          asAt: row.regularMarketTime ? new Date(row.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
          change: typeof row.regularMarketChange === "number" ? row.regularMarketChange : undefined,
          changePercent: typeof row.regularMarketChangePercent === "number" ? row.regularMarketChangePercent : undefined,
        };
      }
      if (Object.keys(out).length) return out;
    } catch {
      /* try the next host */
    }
  }
  return out;
}

async function coingeckoPrices(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  try {
    const upstream = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=aud`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000), cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } } as RequestInit,
    );
    if (!upstream.ok) return out;
    const data = (await upstream.json()) as Record<string, { aud?: number }>;
    for (const [id, v] of Object.entries(data)) if (typeof v.aud === "number") out[id] = v.aud;
  } catch {
    /* leave out empty — the caller just omits these symbols */
  }
  return out;
}

// No exported /api/fx helper to reuse (its logic lives inline in
// worker/index.ts), so fetch the same upstream directly per docs/PRO_PLAN.md's
// fallback instruction.
async function usdToAud(): Promise<number | null> {
  try {
    const upstream = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as { rates?: Record<string, number> };
    return typeof data.rates?.AUD === "number" ? data.rates.AUD : null;
  } catch {
    return null;
  }
}

export async function handleMarket(request: Request, _env: ProEnv, url: URL): Promise<Response> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405, headers });

  const raw = (url.searchParams.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const symbols = Array.from(new Set(raw)).filter((s) => SYMBOL_RE.test(s)).slice(0, MAX_SYMBOLS);
  if (!symbols.length) return Response.json({ error: "no valid symbols" }, { status: 400, headers });

  const metalSymbols = symbols.filter((s) => METAL_SYMBOLS[s]);
  const cryptoSymbols = symbols.filter((s) => COIN_IDS[s]);
  const plainSymbols = symbols.filter((s) => !METAL_SYMBOLS[s] && !COIN_IDS[s]);
  const metalTickers = Array.from(new Set(metalSymbols.map((s) => METAL_SYMBOLS[s])));

  const [plainQuotes, metalQuotes, coinPrices] = await Promise.all([
    yahooQuote(plainSymbols),
    yahooQuote(metalTickers),
    coingeckoPrices(cryptoSymbols.map((s) => COIN_IDS[s])),
  ]);

  const prices: Record<string, PriceEntry> = {};
  const sources = new Set<string>();

  for (const s of plainSymbols) {
    if (plainQuotes[s]) { prices[s] = plainQuotes[s]; sources.add("yahoo"); }
  }

  if (metalSymbols.length) {
    let fx: number | null = null;
    for (const s of metalSymbols) {
      const yq = metalQuotes[METAL_SYMBOLS[s]];
      if (!yq) continue;
      fx ??= await usdToAud();
      if (!fx) continue;
      prices[s] = { price: round2(yq.price * fx), currency: "AUD", asAt: yq.asAt };
      sources.add("yahoo+fx");
    }
  }

  for (const s of cryptoSymbols) {
    const v = coinPrices[COIN_IDS[s]];
    if (typeof v === "number") { prices[s] = { price: v, currency: "AUD", asAt: new Date().toISOString() }; sources.add("coingecko"); }
  }

  const body: MarketResult = { prices, source: Array.from(sources).join("+") || "none" };
  return Response.json(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` } });
}
