// Money Pro waitlist. POST /api/waitlist { email, source } -> D1. No sender is
// configured anywhere in this repo, so there's no confirmation email and
// nothing to unsubscribe from automatically — the copy on /pro says so.
export interface WaitlistEnv {
  DEEP_SWARM_DB?: D1Database;
  // Same Durable Object apiAllowed() (worker/index.ts) rate-limits every /api/*
  // route at 120/60s; this bucket is a second, longer-window cap specific to
  // this route, keyed by its own name so it doesn't share state with that one.
  RL_DO?: DurableNamespace;
}

interface D1Result<T = unknown> { results?: T[]; success: boolean; meta?: { changes?: number } }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Database { prepare(query: string): D1PreparedStatement }
interface DurableStub { fetch(url: string): Promise<Response> }
interface DurableNamespace { idFromName(name: string): unknown; get(id: unknown): DurableStub }

const NO_STORE_JSON = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAILY_LIMIT = 100;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function waitlistAllowed(request: Request, env: WaitlistEnv): Promise<{ ok: boolean; retryAfter?: number }> {
  if (!env.RL_DO) return { ok: true }; // binding missing -> fail open, matches apiAllowed()
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  try {
    const stub = env.RL_DO.get(env.RL_DO.idFromName(`waitlist:${ip}`));
    const res = await stub.fetch(`https://rl/?limit=${DAILY_LIMIT}&window=${DAILY_WINDOW_MS}`);
    const body = (await res.json()) as { ok: boolean; retryAfter?: number };
    return body;
  } catch {
    return { ok: true }; // limiter error -> fail open rather than lock the form
  }
}

export async function handleWaitlist(request: Request, env: WaitlistEnv, url: URL): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405, headers: NO_STORE_JSON });
  const origin = request.headers.get("Origin");
  if (origin !== url.origin) return Response.json({ ok: false, error: "origin rejected" }, { status: 403, headers: NO_STORE_JSON });

  const limited = await waitlistAllowed(request, env);
  if (!limited.ok) {
    const headers = new Headers(NO_STORE_JSON);
    headers.set("Retry-After", String(limited.retryAfter ?? 86400));
    return new Response(JSON.stringify({ ok: false, error: "too many requests" }), { status: 429, headers });
  }

  let body: { email?: string; source?: string };
  try { body = (await request.json()) as { email?: string; source?: string }; } catch { return Response.json({ ok: false, error: "invalid json" }, { status: 400, headers: NO_STORE_JSON }); }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid email" }, { status: 400, headers: NO_STORE_JSON });
  }
  const source = (body.source || "unknown").trim().slice(0, MAX_SOURCE_LENGTH) || "unknown";

  if (!env.DEEP_SWARM_DB) return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE_JSON });
  await env.DEEP_SWARM_DB.prepare(
    "INSERT INTO waitlist (email, source, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING",
  ).bind(email, source, Date.now()).run();
  // 200 on a duplicate too — the caller can't distinguish a repeat signup from
  // a fresh one, and shouldn't need to.
  return Response.json({ ok: true }, { headers: NO_STORE_JSON });
}
