// Same-origin proxy for the Overpass API so the browser only ever talks to
// vishvaddi.com (keeps connect-src 'self'). Cloudflare Pages Function.
export async function onRequestPost(context: any): Promise<Response> {
  const body = await context.request.text();
  // Guard: only small, well-formed Overpass queries from the survival tool.
  if (!body || body.length > 1000 || !/around:/.test(body)) {
    return new Response("[]", { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const upstream = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "vishvaddi.com field-survival tool" },
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
