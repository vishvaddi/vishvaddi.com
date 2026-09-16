import { base64Url, keyFor, ownerSession } from "./auth.ts";
import type { PinEnv } from "./auth.ts";

export interface ProEnv extends PinEnv {
  DEEP_SWARM_DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_YEAR?: string;
  STRIPE_PRICE_MONTH?: string;
  STRIPE_PRICE_PASS?: string;
}

export type Plan = "year" | "month" | "pass";
type SubscriptionPlan = Exclude<Plan, "pass">;
const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = ["year", "month"];
const PLANS: readonly Plan[] = [...SUBSCRIPTION_PLANS, "pass"];
const PLAN_LABEL: Record<SubscriptionPlan, string> = { year: "yearly", month: "monthly" };

function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === "string" && (SUBSCRIPTION_PLANS as readonly string[]).includes(value);
}

function priceFor(env: ProEnv, plan: Plan): string | undefined {
  return plan === "year" ? env.STRIPE_PRICE_YEAR : plan === "month" ? env.STRIPE_PRICE_MONTH : env.STRIPE_PRICE_PASS;
}

// Subscriptions only: a subscription row must never be relabelled 'pass', or
// it would start expiring on current_period_end like a one-off pass.
function planForPrice(env: ProEnv, priceId: string | undefined): SubscriptionPlan | null {
  return SUBSCRIPTION_PLANS.find((plan) => priceId && priceFor(env, plan) === priceId) ?? null;
}

interface D1Result<T = unknown> { results?: T[]; success: boolean; meta?: { changes?: number } }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Database { prepare(query: string): D1PreparedStatement }

interface LicenceRow {
  licence_hash: string;
  stripe_customer: string;
  stripe_subscription: string;
  plan: string;
  status: string;
  current_period_end: number | null;
  email: string | null;
  last_seen: number | null;
}

const PRO_COOKIE = "__Host-pro";
const PRO_MARKER = "vv_pro";
const PRO_COOKIE_SECONDS = 365 * 24 * 3600;
const PASS_SECONDS = 7 * 24 * 3600;
// A pass's licence row is keyed by "pass_" + Checkout Session id in the
// stripe_subscription column (NOT NULL UNIQUE); real subscription ids start "sub_".
const PASS_PREFIX = "pass_";
// Caps how long a pass Checkout Session stays payable, which bounds the gap
// between session.created (the pass start) and the actual payment. Stripe
// allows 30 min–24 h; an hour leaves headroom for clock skew and slow 3DS.
const PASS_CHECKOUT_TTL_S = 3600;
const PASS_DATE = new Intl.DateTimeFormat("en-AU", { dateStyle: "long", timeZone: "Australia/Sydney" });
const LAST_SEEN_THROTTLE_MS = 24 * 3600 * 1000;
const WEBHOOK_TOLERANCE_S = 300;
const KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const NO_STORE_JSON = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const encoder = new TextEncoder();

const proCookie = (value: string, age: number) => `${PRO_COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
// Plain (readable) marker so pages can render Pro state before /api/pro/status answers.
const proMarker = (value: string, age: number) => `${PRO_MARKER}=${value}; Path=/; Max-Age=${age}; Secure; SameSite=Lax`;

async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function base64UrlToBytes(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "="), (char) => char.charCodeAt(0));
}

function generateLicenceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let chars = "";
  for (const byte of bytes) chars += KEY_ALPHABET[byte % KEY_ALPHABET.length];
  return `VV-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

function originOk(request: Request, url: URL): boolean {
  return request.headers.get("Origin") === url.origin;
}

function configured(env: ProEnv): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && PLANS.every((plan) => priceFor(env, plan)));
}

// Every Stripe call goes through here so tests can stub globalThis.fetch instead
// of standing up a fake Stripe server. Plain fetch + Bearer auth — no SDK.
async function stripe(env: ProEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.stripe.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY || ""}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers || {}),
    },
  });
}

async function signPro(env: PinEnv, licenceHash: string, expiry: number): Promise<string> {
  const key = await keyFor(env);
  const payload = `${licenceHash}.${expiry}`;
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
  return `${licenceHash}.${expiry}.${signature}`;
}

// Signature + expiry only — callers that need the licence to still be paid up
// must check D1 status themselves (see activeLicenceHash / resolvePro).
async function verifiedLicenceHash(request: Request, env: PinEnv): Promise<string | null> {
  const token = readCookie(request, PRO_COOKIE);
  if (!token) return null;
  const match = token.match(/^([A-Za-z0-9_-]{43})\.(\d{10,12})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const [, licenceHash, expiryRaw, signature] = match;
  const expiry = Number(expiryRaw);
  if (expiry <= Math.floor(Date.now() / 1000)) return null;
  try {
    const key = await keyFor(env);
    const ok = await crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), encoder.encode(`${licenceHash}.${expiryRaw}`));
    return ok ? licenceHash : null;
  } catch {
    return null;
  }
}

const ACTIVE_STATUSES = new Set(["active", "past_due"]);
const LICENCE_STATE_SQL = "SELECT plan, status, current_period_end FROM pro_licences WHERE licence_hash = ?";

type LicenceState = Pick<LicenceRow, "plan" | "status" | "current_period_end">;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// The single "is this licence paid up" rule. A subscription's
// current_period_end is ignored (renewal webhooks can land after it passes);
// a pass has no renewal, so its end is final — and a pass without one never counts.
function licenceActive(row: LicenceState, now: number): boolean {
  if (!ACTIVE_STATUSES.has(row.status)) return false;
  return row.plan !== "pass" || (row.current_period_end != null && row.current_period_end > now);
}

// Absolute cookie expiry: a year, but never past the end of a pass.
function cookieExpiry(row: LicenceState, now: number): number {
  const year = now + PRO_COOKIE_SECONDS;
  return row.plan === "pass" ? Math.min(year, row.current_period_end ?? now) : year;
}

async function proCookies(env: PinEnv, licenceHash: string, expiry: number, now: number): Promise<string[]> {
  const age = Math.max(0, expiry - now);
  const token = await signPro(env, licenceHash, expiry);
  return [proCookie(token, age), proMarker("1", age)];
}

// Used by index.ts's /api/store/ gate — owner is checked separately there via
// ownerSession, this only covers the Pro-cookie path.
export async function activeLicenceHash(request: Request, env: ProEnv): Promise<string | null> {
  const licenceHash = await verifiedLicenceHash(request, env);
  if (!licenceHash || !env.DEEP_SWARM_DB) return null;
  const row = await env.DEEP_SWARM_DB.prepare(LICENCE_STATE_SQL).bind(licenceHash).first<LicenceState>();
  return row && licenceActive(row, nowSeconds()) ? licenceHash : null;
}

interface ProStatus {
  pro: boolean;
  source: "owner" | "licence" | null;
  plan?: Plan;
  periodEnd?: number;
  configured: boolean;
}

async function resolvePro(request: Request, env: ProEnv): Promise<ProStatus> {
  const conf = configured(env);
  if (await ownerSession(request, env)) return { pro: true, source: "owner", configured: conf };
  const licenceHash = await verifiedLicenceHash(request, env);
  if (!licenceHash || !env.DEEP_SWARM_DB) return { pro: false, source: null, configured: conf };
  const row = await env.DEEP_SWARM_DB.prepare("SELECT plan, status, current_period_end, last_seen FROM pro_licences WHERE licence_hash = ?")
    .bind(licenceHash).first<Pick<LicenceRow, "plan" | "status" | "current_period_end" | "last_seen">>();
  if (!row || !licenceActive(row, nowSeconds())) return { pro: false, source: null, configured: conf };
  const now = Date.now();
  if (!row.last_seen || now - row.last_seen > LAST_SEEN_THROTTLE_MS) {
    await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET last_seen = ? WHERE licence_hash = ?").bind(now, licenceHash).run();
  }
  return {
    pro: true,
    source: "licence",
    plan: isPlan(row.plan) ? row.plan : "month",
    periodEnd: row.current_period_end ?? undefined,
    configured: conf,
  };
}

async function statusHandler(request: Request, env: ProEnv): Promise<Response> {
  const result = await resolvePro(request, env);
  const payload: Record<string, unknown> = { pro: result.pro, source: result.source, configured: result.configured };
  if (result.plan) payload.plan = result.plan;
  if (result.periodEnd != null) payload.periodEnd = result.periodEnd;
  return Response.json(payload, { headers: NO_STORE_JSON });
}

async function checkoutHandler(request: Request, env: ProEnv, url: URL): Promise<Response> {
  if (!originOk(request, url)) return Response.json({ error: "origin rejected" }, { status: 403, headers: NO_STORE_JSON });
  if (!configured(env)) return Response.json({ error: "not configured" }, { status: 503, headers: NO_STORE_JSON });
  let body: { plan?: string };
  try { body = (await request.json()) as { plan?: string }; } catch { return Response.json({ error: "invalid json" }, { status: 400, headers: NO_STORE_JSON }); }
  if (!isPlan(body.plan)) return Response.json({ error: "bad plan" }, { status: 400, headers: NO_STORE_JSON });
  const plan = body.plan;
  const price = priceFor(env, plan);
  const form = new URLSearchParams({
    mode: plan === "pass" ? "payment" : "subscription",
    "line_items[0][price]": price || "",
    "line_items[0][quantity]": "1",
    // Lets the webhook resolve plan without a subscription expand; for a pass it
    // is also what distinguishes our checkout from any other one-off payment on the account.
    "metadata[plan]": plan,
    success_url: `${url.origin}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/pro?cancelled=1`,
    allow_promotion_codes: "true",
  });
  if (plan === "pass") {
    // Payment mode creates no customer by default; the licence key is stored on one.
    form.set("customer_creation", "always");
    // Session metadata isn't shown on the dashboard's Payments page, where refunds are issued.
    form.set("payment_intent_data[metadata][plan]", "pass");
    form.set("expires_at", String(nowSeconds() + PASS_CHECKOUT_TTL_S));
    // Card only: a delayed method (BECS, PayTo) completes as unpaid and no pass would ever be issued.
    form.set("payment_method_types[0]", "card");
  }
  try {
    const upstream = await stripe(env, "/v1/checkout/sessions", { method: "POST", body: form.toString() });
    if (!upstream.ok) return Response.json({ error: "stripe error" }, { status: 502, headers: NO_STORE_JSON });
    const session = (await upstream.json()) as { url?: string };
    if (!session.url) return Response.json({ error: "stripe error" }, { status: 502, headers: NO_STORE_JSON });
    return Response.json({ url: session.url }, { headers: NO_STORE_JSON });
  } catch {
    return Response.json({ error: "stripe unreachable" }, { status: 502, headers: NO_STORE_JSON });
  }
}

function htmlResponse(html: string, status: number, cookies: string[] = []): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    // No script anywhere on this page (a copy-button script would need
    // 'unsafe-inline' in script-src) — the key sits in a readonly input instead.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(html, { status, headers });
}

function successHtml(heading: string, message: string, key?: string): string {
  const body = key
    ? `<p role="status">${message}</p><label for="key">Your licence key</label><input id="key" type="text" readonly value="${key}"><p class="hint">We only store its hash, so we can't show it again — it's also on your Stripe receipt. Use the Restore form on the Pro page to add it on another device.</p><p><a href="/pro">Continue to Pro</a></p>`
    : `<p role="status">${message}</p><p><a href="/pro">Back to Pro</a></p>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pro · Vish Vaddi</title><style>
  :root{--bg:#fafaf7;--fg:#1a1a1a;--muted:#6b6b6b;--rule:#e5e5e0;--accent:#9e4e2e;color-scheme:light dark}
  @media(prefers-color-scheme:dark){:root{--bg:#161613;--fg:#e8e8e4;--muted:#aaa;--rule:#555;--accent:#C5683F}}
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{width:min(100%,420px)}h1{font-family:Georgia,serif;font-weight:400;font-size:32px;margin:12px 0}p{color:var(--muted)}label{display:block;margin:24px 0 8px;color:var(--fg)}input{width:100%;min-height:52px;border:1px solid var(--rule);border-radius:8px;font:inherit;background:var(--bg);color:var(--fg);text-align:center;font-size:20px;letter-spacing:.04em;padding:10px}a{color:var(--accent)}.brand{font-size:13px;letter-spacing:.12em;text-transform:uppercase}.hint{font-size:13px}
  </style></head><body><main><p class="brand">Vish Vaddi · Pro</p><h1>${heading}</h1>${body}</main></body></html>`;
}

interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string } }> };
}
interface StripeCustomer { id: string; email?: string }
interface StripeCheckoutSession {
  id?: string;
  mode?: string;
  created?: number;
  payment_status?: string;
  subscription?: StripeSubscription | null;
  customer?: StripeCustomer | string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
}

const INSERT_LICENCE_SQL = "INSERT INTO pro_licences (licence_hash, stripe_customer, stripe_subscription, plan, status, current_period_end, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
const PASS_ROW_SQL = "SELECT licence_hash, plan, status, current_period_end, key_shown_at FROM pro_licences WHERE stripe_subscription = ?";
const KEY_SHOWN_SQL = "UPDATE pro_licences SET key_shown_at = ? WHERE licence_hash = ?";

interface PassRow extends LicenceState { licence_hash: string; key_shown_at: number | null }

const stripeId = (value: { id?: string } | string | null | undefined): string => (typeof value === "string" ? value : value?.id || "");
const notCompleted = () => htmlResponse(successHtml("Hold on.", "Payment not completed."), 200);
const passActiveUntil = (periodEnd: number) => `Your 7-day Pro pass is active until ${PASS_DATE.format(new Date(periodEnd * 1000))}.`;

// keyShown false means the other path (usually the webhook) has the row but
// its key isn't readable from the Stripe customer yet — a refresh will show it.
function alreadyIssuedHtml(what: "subscription" | "pass", keyShown: boolean, lead = ""): string {
  return keyShown
    ? successHtml("Already issued.", `${lead}This ${what}'s licence key was shown once already. This browser is unlocked; for another device use Restore on the Pro page with the key you saved, or email vishvaddi@gmail.com with your Stripe receipt and I'll recover it.`)
    : successHtml("Almost there.", `${lead}Your licence key is still being issued. This browser is unlocked; refresh this page in a few seconds to see it, or email vishvaddi@gmail.com with your Stripe receipt if it doesn't appear.`);
}

async function storeLicenceKeyOnCustomer(env: ProEnv, customerId: string, key: string): Promise<void> {
  try {
    await stripe(env, `/v1/customers/${encodeURIComponent(customerId)}`, {
      method: "POST",
      body: new URLSearchParams({ "metadata[licence_key]": key }).toString(),
    });
  } catch { /* best-effort — the licence still works without it */ }
}

// The webhook normally wins the race and has already minted the key; it lives
// on the Stripe customer, so the success page can show it once.
async function recoverUnshownKey(env: ProEnv, row: { licence_hash: string; key_shown_at: number | null }, customerId: string): Promise<string | undefined> {
  if (row.key_shown_at || !customerId) return undefined;
  const recovered = await customerLicenceKey(env, customerId);
  return recovered && (await sha256Base64Url(recovered)) === row.licence_hash ? recovered : undefined;
}

// Shared by /pay/success and the checkout.session.completed webhook so both
// create or reuse exactly one row. The pass starts at session.created: it is in
// both the webhook payload and the retrieved session, so either path computes
// the same end (PASS_CHECKOUT_TTL_S bounds how long before payment that is).
async function ensurePassLicence(env: ProEnv, db: D1Database, session: StripeCheckoutSession): Promise<{ row: PassRow; customerId: string; mintedKey?: string } | null> {
  if (session.mode !== "payment" || session.metadata?.plan !== "pass" || session.payment_status !== "paid" || !session.id) return null;
  const customerId = stripeId(session.customer);
  if (!customerId) return null;
  const ref = PASS_PREFIX + session.id;
  const existing = await db.prepare(PASS_ROW_SQL).bind(ref).first<PassRow>();
  if (existing) return { row: existing, customerId };
  const created = typeof session.created === "number" && session.created > 0 ? session.created : nowSeconds();
  const periodEnd = created + PASS_SECONDS;
  const key = generateLicenceKey();
  const licenceHash = await sha256Base64Url(key);
  const email = (typeof session.customer === "object" && session.customer?.email) || session.customer_details?.email || null;
  const now = Date.now();
  try {
    await db.prepare(INSERT_LICENCE_SQL).bind(licenceHash, customerId, ref, "pass", "active", periodEnd, email, now, now).run();
  } catch (error) {
    // Lost the insert race to the other path: UNIQUE(stripe_subscription) kept
    // its row, so our key was never valid and must not reach the customer.
    const winner = await db.prepare(PASS_ROW_SQL).bind(ref).first<PassRow>();
    if (winner) return { row: winner, customerId };
    throw error;
  }
  await storeLicenceKeyOnCustomer(env, customerId, key);
  await bumpMetric(env, "pay_success");
  return { row: { licence_hash: licenceHash, plan: "pass", status: "active", current_period_end: periodEnd, key_shown_at: null }, customerId, mintedKey: key };
}

async function passSuccess(env: ProEnv, db: D1Database, session: StripeCheckoutSession): Promise<Response> {
  const pass = await ensurePassLicence(env, db, session);
  if (!pass) return notCompleted();
  const { row, customerId } = pass;
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  if (!licenceActive(row, nowSec)) return htmlResponse(successHtml("Pass ended.", "This 7-day Pro pass is no longer active."), 200);
  const issuedKey = pass.mintedKey ?? (await recoverUnshownKey(env, row, customerId));
  if (issuedKey) await db.prepare(KEY_SHOWN_SQL).bind(now, row.licence_hash).run();
  const cookies = await proCookies(env, row.licence_hash, cookieExpiry(row, nowSec), nowSec);
  const until = passActiveUntil(row.current_period_end as number);
  const html = issuedKey ? successHtml("You're in.", until, issuedKey) : alreadyIssuedHtml("pass", row.key_shown_at != null, `${until} `);
  return htmlResponse(html, 200, cookies);
}

async function successHandler(request: Request, env: ProEnv, url: URL): Promise<Response> {
  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId || !env.STRIPE_SECRET_KEY) return notCompleted();
  let session: StripeCheckoutSession;
  try {
    const upstream = await stripe(env, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription&expand[]=customer`, { method: "GET" });
    if (!upstream.ok) return notCompleted();
    session = (await upstream.json()) as StripeCheckoutSession;
  } catch {
    return notCompleted();
  }
  const db = env.DEEP_SWARM_DB;
  if (!db) return notCompleted();
  if (session.mode === "payment") return passSuccess(env, db, session);
  const sub = session.subscription;
  const paid = session.payment_status === "paid" || sub?.status === "active" || sub?.status === "trialing";
  if (!paid || !sub) return notCompleted();
  const customer = session.customer;
  const customerId = stripeId(customer);
  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan: SubscriptionPlan = planForPrice(env, priceId) ?? (isSubscriptionPlan(session.metadata?.plan) ? session.metadata.plan : "month");
  const status = sub.status === "trialing" ? "active" : sub.status;
  const now = Date.now();
  const existing = await db.prepare("SELECT licence_hash, key_shown_at FROM pro_licences WHERE stripe_subscription = ?")
    .bind(sub.id).first<{ licence_hash: string; key_shown_at: number | null }>();
  let licenceHash: string;
  let issuedKey: string | undefined;
  if (existing) {
    licenceHash = existing.licence_hash;
    await db.prepare("UPDATE pro_licences SET status = ?, plan = ?, current_period_end = ?, updated_at = ? WHERE licence_hash = ?")
      .bind(status, plan, sub.current_period_end ?? null, now, licenceHash).run();
    issuedKey = await recoverUnshownKey(env, existing, customerId);
  } else {
    issuedKey = generateLicenceKey();
    licenceHash = await sha256Base64Url(issuedKey);
    await db.prepare(INSERT_LICENCE_SQL)
      .bind(licenceHash, customerId, sub.id, plan, status, sub.current_period_end ?? null, (typeof customer === "object" && customer?.email) || null, now, now).run();
    if (customerId) await storeLicenceKeyOnCustomer(env, customerId, issuedKey);
    await bumpMetric(env, "pay_success");
  }
  if (issuedKey) await db.prepare(KEY_SHOWN_SQL).bind(now, licenceHash).run();
  const nowSec = Math.floor(now / 1000);
  const cookies = await proCookies(env, licenceHash, nowSec + PRO_COOKIE_SECONDS, nowSec);
  const html = issuedKey
    ? successHtml("You're in.", `Your ${PLAN_LABEL[plan]} Pro subscription is active.`, issuedKey)
    : alreadyIssuedHtml("subscription", existing?.key_shown_at != null);
  return htmlResponse(html, 200, cookies);
}

async function restoreHandler(request: Request, env: ProEnv, url: URL): Promise<Response> {
  if (!originOk(request, url)) return Response.json({ error: "origin rejected" }, { status: 403, headers: NO_STORE_JSON });
  if (!env.PIN_ATTEMPTS) return Response.json({ ok: false }, { status: 401, headers: NO_STORE_JSON });
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256Base64Url(ip);
  let limited: Response;
  try {
    limited = await env.PIN_ATTEMPTS.get(env.PIN_ATTEMPTS.idFromName("pro-restore")).fetch(new Request(`https://attempts/?ip=${ipHash}`));
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE_JSON });
  }
  if (limited.status === 429) {
    const headers = new Headers(NO_STORE_JSON);
    headers.set("Retry-After", limited.headers.get("Retry-After") || "900");
    return new Response(JSON.stringify({ ok: false }), { status: 429, headers });
  }
  if (limited.status !== 204) return Response.json({ ok: false }, { status: 503, headers: NO_STORE_JSON });
  let body: { key?: string };
  try { body = (await request.json()) as { key?: string }; } catch { return Response.json({ ok: false }, { status: 400, headers: NO_STORE_JSON }); }
  const key = (body.key || "").trim().toUpperCase();
  if (!key || !env.DEEP_SWARM_DB) return Response.json({ ok: false }, { status: 401, headers: NO_STORE_JSON });
  const licenceHash = await sha256Base64Url(key);
  const row = await env.DEEP_SWARM_DB.prepare(LICENCE_STATE_SQL).bind(licenceHash).first<LicenceState>();
  const now = nowSeconds();
  if (!row || !licenceActive(row, now)) return Response.json({ ok: false }, { status: 401, headers: NO_STORE_JSON });
  const headers = new Headers(NO_STORE_JSON);
  for (const cookie of await proCookies(env, licenceHash, cookieExpiry(row, now), now)) headers.append("Set-Cookie", cookie);
  await bumpMetric(env, "restore_ok");
  return new Response(JSON.stringify({ ok: true, plan: row.plan }), { status: 200, headers });
}

function logoutHandler(request: Request, url: URL): Response {
  if (!originOk(request, url)) return Response.json({ error: "origin rejected" }, { status: 403, headers: NO_STORE_JSON });
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", proCookie("", 0));
  headers.append("Set-Cookie", proMarker("", 0));
  return new Response(null, { status: 204, headers });
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyStripeSignature(header: string, payload: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (name === "t" || (name === "v1" && !parts.v1)) parts[name] = value;
  }
  const timestamp = Number(parts.t);
  if (!parts.t || !parts.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${parts.t}.${payload}`));
  const expectedHex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualHex(expectedHex, parts.v1.toLowerCase());
}

async function customerLicenceKey(env: ProEnv, customerId: string): Promise<string | null> {
  try {
    const res = await stripe(env, `/v1/customers/${encodeURIComponent(customerId)}`, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as { metadata?: Record<string, string> };
    const key = data.metadata?.licence_key || "";
    return /^VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

async function upsertFromCheckoutCompleted(env: ProEnv, obj: Record<string, unknown>): Promise<void> {
  if (!env.DEEP_SWARM_DB) return;
  const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : (obj.subscription as { id?: string } | null)?.id;
  const customerId = typeof obj.customer === "string" ? obj.customer : (obj.customer as { id?: string } | null)?.id;
  if (!subscriptionId || !customerId) return;
  const metadata = (obj.metadata as Record<string, string> | undefined) || {};
  const plan: SubscriptionPlan = isSubscriptionPlan(metadata.plan) ? metadata.plan : "month";
  const email = (obj.customer_details as { email?: string } | undefined)?.email || null;
  const now = Date.now();
  const existing = await env.DEEP_SWARM_DB.prepare("SELECT licence_hash FROM pro_licences WHERE stripe_subscription = ?")
    .bind(subscriptionId).first<{ licence_hash: string }>();
  if (existing) {
    await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET status = 'active', updated_at = ? WHERE licence_hash = ?").bind(now, existing.licence_hash).run();
    return;
  }
  const key = generateLicenceKey();
  const licenceHash = await sha256Base64Url(key);
  await env.DEEP_SWARM_DB.prepare(
    "INSERT INTO pro_licences (licence_hash, stripe_customer, stripe_subscription, plan, status, current_period_end, email, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', NULL, ?, ?, ?)",
  ).bind(licenceHash, customerId, subscriptionId, plan, email, now, now).run();
  await storeLicenceKeyOnCustomer(env, customerId, key);
  await bumpMetric(env, "pay_success");
}

// Subscription events can never address a pass row (Stripe ids start "sub_"),
// but a pass must not be renewed, re-planned or re-dated by one regardless.
const isPassRef = (id: string) => id.startsWith(PASS_PREFIX);

async function updateFromSubscriptionUpdated(env: ProEnv, obj: Record<string, unknown>): Promise<void> {
  if (!env.DEEP_SWARM_DB) return;
  const id = obj.id as string | undefined;
  if (!id || isPassRef(id)) return;
  const status = obj.status === "trialing" ? "active" : ((obj.status as string) || "active");
  const periodEnd = (obj.current_period_end as number | undefined) ?? null;
  const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data;
  const priceId = items?.[0]?.price?.id;
  const plan = planForPrice(env, priceId);
  const now = Date.now();
  if (plan) {
    await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET status = ?, plan = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription = ?")
      .bind(status, plan, periodEnd, now, id).run();
  } else {
    await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET status = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription = ?")
      .bind(status, periodEnd, now, id).run();
  }
}

async function markCancelled(env: ProEnv, obj: Record<string, unknown>): Promise<void> {
  if (!env.DEEP_SWARM_DB) return;
  const id = obj.id as string | undefined;
  if (!id || isPassRef(id)) return;
  await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET status = 'cancelled', updated_at = ? WHERE stripe_subscription = ?").bind(Date.now(), id).run();
}

async function markPastDue(env: ProEnv, obj: Record<string, unknown>): Promise<void> {
  if (!env.DEEP_SWARM_DB) return;
  const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : (obj.subscription as { id?: string } | null)?.id;
  if (!subscriptionId || isPassRef(subscriptionId)) return;
  await env.DEEP_SWARM_DB.prepare("UPDATE pro_licences SET status = 'past_due', updated_at = ? WHERE stripe_subscription = ?").bind(Date.now(), subscriptionId).run();
}

async function webhookHandler(request: Request, env: ProEnv): Promise<Response> {
  const signatureHeader = request.headers.get("Stripe-Signature") || "";
  const payload = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(signatureHeader, payload, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("bad signature", { status: 400 });
  }
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(payload); } catch { return new Response("bad payload", { status: 400 }); }
  if (!event.id) return new Response("bad payload", { status: 400 });
  const db = env.DEEP_SWARM_DB;
  if (!db) return new Response("ok", { status: 200 });
  const seen = await db.prepare("SELECT event_id FROM pro_events WHERE event_id = ?").bind(event.id).first();
  if (seen) return new Response("ok", { status: 200 });
  const obj = event.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed":
      if (obj.mode === "payment") await ensurePassLicence(env, db, obj as StripeCheckoutSession);
      else await upsertFromCheckoutCompleted(env, obj);
      break;
    case "customer.subscription.updated": await updateFromSubscriptionUpdated(env, obj); break;
    case "customer.subscription.deleted": await markCancelled(env, obj); break;
    case "invoice.payment_failed": await markPastDue(env, obj); break;
    default: break; // unhandled event types are acknowledged, not errors
  }
  // Recorded only once handled: a D1/Stripe failure above throws, Stripe
  // retries, and the retry isn't swallowed as a replay. Every handler is
  // idempotent, so a concurrent duplicate delivery is harmless.
  await db.prepare("INSERT INTO pro_events (event_id, received_at) VALUES (?, ?)").bind(event.id, Date.now()).run();
  return new Response("ok", { status: 200 });
}

// --- Funnel counters (Addendum 3, docs/PRO_PLAN.md) -------------------------
// migrations/0007_metrics.sql. One row per (day, event); POST increments,
// GET (owner-only) reads the last N days. Never throws — a metrics outage
// must never take down the feature it's measuring.
const METRIC_EVENTS = new Set([
  "upsell_shown", "checkout_click", "restore_ok", "pay_success",
  "waitlist_signup", "nudge_shown", "nudge_click", "tool_view",
  "export_free", "export_pro", "brand_saved",
]);
const DEFAULT_METRIC_DAYS = 30;
const MAX_METRIC_DAYS = 90;

interface MetricRow { day: string; event: string; count: number }

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

// navigator.sendBeacon carries no custom headers, so Origin/Sec-Fetch-Site —
// both set by the browser itself, never by page script — are what we can
// trust here instead of the usual Origin-only check the other POST routes use.
function sameOriginOk(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (origin) return origin === url.origin;
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite) return secFetchSite === "same-origin";
  return false;
}

async function parseMetricEvent(request: Request): Promise<string | null> {
  const raw = (await request.text()).trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const body = JSON.parse(raw) as { event?: unknown };
      return typeof body.event === "string" ? body.event : null;
    } catch {
      return null;
    }
  }
  const event = new URLSearchParams(raw).get("event");
  return event || null;
}

// Best-effort — a failed insert never surfaces to the caller (see metricPostHandler).
export async function bumpMetric(env: ProEnv, event: string): Promise<void> {
  if (!METRIC_EVENTS.has(event) || !env.DEEP_SWARM_DB) return;
  try {
    await env.DEEP_SWARM_DB.prepare(
      "INSERT INTO metrics (day, event, count) VALUES (?, ?, 1) ON CONFLICT(day, event) DO UPDATE SET count = count + excluded.count",
    ).bind(utcDay(), event).run();
  } catch {
    /* swallow — metrics must never break the feature they measure */
  }
}

async function metricPostHandler(request: Request, env: ProEnv, url: URL): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOriginOk(request, url)) return new Response(null, { status: 403, headers });
  try {
    const event = await parseMetricEvent(request);
    if (event) await bumpMetric(env, event);
  } catch {
    /* malformed body — still 204, never throw on a fire-and-forget beacon */
  }
  return new Response(null, { status: 204, headers });
}

async function metricGetHandler(request: Request, env: ProEnv, url: URL): Promise<Response> {
  if (!(await ownerSession(request, env))) return Response.json({ error: "unauthorised" }, { status: 401, headers: NO_STORE_JSON });
  if (!env.DEEP_SWARM_DB) return Response.json([], { headers: NO_STORE_JSON });
  const days = Math.min(MAX_METRIC_DAYS, Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_METRIC_DAYS));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const result = await env.DEEP_SWARM_DB.prepare(
      "SELECT day, event, count FROM metrics WHERE day >= ? ORDER BY day ASC, event ASC",
    ).bind(since).all<MetricRow>();
    return Response.json(result.results || [], { headers: NO_STORE_JSON });
  } catch {
    return Response.json([], { headers: NO_STORE_JSON });
  }
}

export async function handleMetricRequest(request: Request, env: ProEnv, url: URL): Promise<Response> {
  if (request.method === "POST") return metricPostHandler(request, env, url);
  if (request.method === "GET") return metricGetHandler(request, env, url);
  return new Response(null, { status: 405, headers: { "Cache-Control": "no-store" } });
}

export async function handleProRequest(request: Request, env: ProEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/api/pro/status" && request.method === "GET") return statusHandler(request, env);
  if (path === "/api/pro/checkout" && request.method === "POST") return checkoutHandler(request, env, url);
  // HEAD is answered without side effects so a link prefetcher can't spend the one-time key view.
  if (path === "/pay/success" && request.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  if (path === "/pay/success" && request.method === "GET") return successHandler(request, env, url);
  if (path === "/api/pro/restore" && request.method === "POST") return restoreHandler(request, env, url);
  if (path === "/api/pro/logout" && request.method === "POST") return logoutHandler(request, url);
  if (path === "/api/pro/webhook" && request.method === "POST") return webhookHandler(request, env);
  return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE_JSON });
}
