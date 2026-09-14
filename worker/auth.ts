export interface PinEnv {
  SITE_PIN?: string;
  SESSION_SECRET?: string;
  PIN_ATTEMPTS?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

interface Attempt { at: number; ip: string }
interface Transaction {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export class PinAttempts {
  private storage: { transaction<T>(callback: (txn: Transaction) => Promise<T>): Promise<T> };
  constructor(state: { storage: PinAttempts["storage"] }) { this.storage = state.storage; }

  async fetch(request: Request): Promise<Response> {
    const ip = new URL(request.url).searchParams.get("ip") || "unknown";
    const now = Date.now();
    // A single transactional bucket bounds guesses even when attackers rotate IPs.
    return this.storage.transaction(async (txn) => {
      const attempts = ((await txn.get<Attempt[]>("attempts")) || []).filter((entry) => entry.at > now - 3_600_000);
      const local = attempts.filter((entry) => entry.ip === ip && entry.at > now - 900_000);
      const retry = Math.max(
        attempts.length >= 20 ? attempts[0].at + 3_600_000 - now : 0,
        local.length >= 5 ? local[0].at + 900_000 - now : 0,
      );
      if (retry > 0) return new Response(null, { status: 429, headers: { "Retry-After": String(Math.ceil(retry / 1000)) } });
      attempts.push({ at: now, ip });
      await txn.put("attempts", attempts);
      return new Response(null, { status: 204 });
    });
  }
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const COOKIE = "__Host-site-session";
const SESSION_SECONDS = 7 * 24 * 3600;
const encoder = new TextEncoder();
const cookie = (value: string, age: number) => `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;

export function privateResponse(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("CDN-Cache-Control", "no-store");
  result.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

function page(message = "Enter your six-digit PIN to continue.", status = 200, lock = false): Response {
  return new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock · Vish Vaddi</title><style>
  :root{--bg:#fafaf7;--fg:#1a1a1a;--muted:#6b6b6b;--rule:#e5e5e0;--accent:#9e4e2e;color-scheme:light dark}
  @media(prefers-color-scheme:dark){:root{--bg:#161613;--fg:#e8e8e4;--muted:#aaa;--rule:#555;--accent:#C5683F}}
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{width:min(100%,360px)}h1{font-family:Georgia,serif;font-weight:400;font-size:36px;margin:12px 0}p{color:var(--muted)}label{display:block;margin:24px 0 8px}input,button{width:100%;min-height:52px;border:1px solid var(--rule);border-radius:8px;font:inherit}input{background:var(--bg);color:var(--fg);text-align:center;font-size:28px;letter-spacing:.35em;padding:10px}button{background:var(--fg);color:var(--bg);margin-top:16px;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:4px}.brand{font-size:13px;letter-spacing:.12em;text-transform:uppercase}
  </style></head><body><main><p class="brand">Vish Vaddi · Private site</p><h1>${lock ? "Finished for now?" : "Welcome back."}</h1><p role="status">${message}</p><form method="post" action="${lock ? "/logout" : "/login"}">${lock ? "" : `<label for="pin">Six-digit PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" required autofocus>`}<button type="submit">${lock ? "Lock site" : "Unlock"}</button></form></main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      // no-referrer makes native form POSTs send Origin: null, failing the CSRF check.
      "Referrer-Policy": "same-origin",
    },
  });
}

async function keyFor(env: PinEnv): Promise<CryptoKey> {
  // Binding the key to the PIN invalidates every session when either secret rotates.
  return crypto.subtle.importKey("raw", encoder.encode(`${env.SESSION_SECRET}:${env.SITE_PIN}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function validSession(request: Request, key: CryptoKey): Promise<boolean> {
  const token = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  const match = token.match(/^(\d{10,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const expiry = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now || expiry > now + SESSION_SECONDS) return false;
  const signature = Uint8Array.from(atob(match[3].replace(/-/g, "+").replace(/_/g, "/") + "="), (char) => char.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${match[1]}.${match[2]}`));
}

export async function pinGate(request: Request, env: PinEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.protocol !== "https:") return new Response("HTTPS required", { status: 400 });
  if (!/^[0-9]{6}$/.test(env.SITE_PIN || "") || (env.SESSION_SECRET?.length || 0) < 32 || !env.PIN_ATTEMPTS) {
    return new Response("Private site. Login is not configured yet.", { status: 503 });
  }
  try {
    const key = await keyFor(env);
    if (url.pathname === "/logout") {
      if (request.method === "GET" || request.method === "HEAD") return page("You will need your PIN to unlock this browser again.", 200, true);
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
      if (request.headers.get("Origin") !== url.origin) return new Response("Origin rejected", { status: 403 });
      return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": cookie("", 0), "Clear-Site-Data": '"cache"' } });
    }
    if (url.pathname === "/login" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return new Response("Origin rejected", { status: 403 });
      if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return new Response("Unsupported form", { status: 415 });
      const ipHash = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(request.headers.get("CF-Connecting-IP") || "unknown"))));
      const limit = await env.PIN_ATTEMPTS.get(env.PIN_ATTEMPTS.idFromName("site-login")).fetch(new Request(`https://attempts/?ip=${ipHash}`));
      if (limit.status === 429) {
        const response = page("Too many attempts. Try again later.", 429);
        response.headers.set("Retry-After", limit.headers.get("Retry-After") || "3600");
        return response;
      }
      if (limit.status !== 204) throw new Error("limiter unavailable");
      // Bound streamed bodies too: Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      let raw = "";
      if (reader) {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 128) { await reader.cancel(); return new Response("Form too large", { status: 413 }); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        raw = new TextDecoder().decode(bytes);
      }
      const form = new URLSearchParams(raw);
      const pin = form.get("pin") || "";
      if (form.getAll("pin").length !== 1 || !/^[0-9]{6}$/.test(pin)) return page("Enter exactly six digits.", 401);
      const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(env.SITE_PIN!));
      if (!await crypto.subtle.verify("HMAC", key, expected, encoder.encode(pin))) return page("Incorrect PIN. Try again.", 401);
      const payload = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${base64Url(crypto.getRandomValues(new Uint8Array(16)))}`;
      const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
      return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": cookie(`${payload}.${signature}`, SESSION_SECONDS), "Clear-Site-Data": '"cache"' } });
    }
    if (await validSession(request, key)) {
      if (url.pathname === "/login") return new Response(null, { status: 303, headers: { Location: "/" } });
      return null;
    }
    if (url.pathname === "/login" && (request.method === "GET" || request.method === "HEAD")) return page();
    if (request.method === "GET" && request.headers.get("Sec-Fetch-Dest") === "document") return new Response(null, { status: 303, headers: { Location: "/login" } });
    return new Response("Site locked", { status: 401 });
  } catch {
    return new Response("Login temporarily unavailable. Try again later.", { status: 503 });
  }
}
