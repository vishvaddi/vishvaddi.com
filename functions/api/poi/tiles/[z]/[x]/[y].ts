// Same-origin proxy for OpenStreetMap raster tiles so the browser loads them
// from vishvaddi.com (keeps img-src 'self'). Cloudflare Pages Function.
// Low-volume personal use; tiles cached at the edge for a day.
export async function onRequestGet(context: any): Promise<Response> {
  const { z, x, y } = context.params;
  if (![z, x, y].every((s: string) => /^\d+$/.test(s)) || Number(z) > 19) {
    return new Response("bad request", { status: 400 });
  }
  const upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { "User-Agent": "vishvaddi.com field-survival tool (personal, low volume)" },
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as any);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
