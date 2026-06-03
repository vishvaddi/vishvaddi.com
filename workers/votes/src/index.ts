// Isolated "vote on the next tool" Worker. Separate deployment from the static
// site — it cannot affect the site's security surface. Stores only a per-option
// counter + a short-lived hashed-IP dedupe key (no PII). CORS locked to the
// site origin; input validated against a fixed option set.

export interface Env {
  VOTES: KVNamespace;
}

const ALLOWED_ORIGIN = "https://vishvaddi.com";

// The candidate tools people can vote for. Keep in sync with /site/roadmap.
const OPTIONS = new Set<string>([
  "2d-sheet",
  "timber-span",
  "beam-point-load",
  "concrete-mix",
  "fastener-spacing",
  "reno-budget",
  "fall-setout",
  "stair-stringer",
]);

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tally(env: Env): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    [...OPTIONS].map(async (opt) => {
      out[opt] = parseInt((await env.VOTES.get(`count:${opt}`)) || "0", 10) || 0;
    }),
  );
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") || "";
    const h = cors(origin);

    if (req.method === "OPTIONS") return new Response(null, { headers: h });

    const url = new URL(req.url);
    if (url.pathname !== "/api/votes") return json({ error: "not found" }, h, 404);

    if (req.method === "GET") return json(await tally(env), h);

    if (req.method === "POST") {
      if (origin !== ALLOWED_ORIGIN) return json({ error: "forbidden" }, h, 403);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, h, 400); }
      const opt = String(body?.option || "");
      if (!OPTIONS.has(opt)) return json({ error: "unknown option" }, h, 400);

      // one vote per option per IP per day (hashed IP — no PII stored)
      const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const day = new Date().toISOString().slice(0, 10);
      const dedupeKey = `seen:${day}:${opt}:${await sha(ip)}`;
      if (await env.VOTES.get(dedupeKey)) {
        return json({ ok: true, deduped: true, tally: await tally(env) }, h);
      }
      await env.VOTES.put(dedupeKey, "1", { expirationTtl: 60 * 60 * 36 });

      const key = `count:${opt}`;
      const cur = parseInt((await env.VOTES.get(key)) || "0", 10) || 0;
      await env.VOTES.put(key, String(cur + 1));
      return json({ ok: true, tally: await tally(env) }, h);
    }

    return json({ error: "method not allowed" }, h, 405);
  },
};
