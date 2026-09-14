# Pro (paywall) — contract

Decided 2026-09-14 with Vish: hybrid public/private gate; free = every tool, unlimited use; **Pro = exports, saves and sync**; an experiment under the 4 h/week cap, no revenue date. This file is the contract between the Worker side and the page side. Change it before changing either.

## Access model

- **Owner** — PIN session (`__Host-site-session`). Sees everything, is always Pro.
- **Public** — no session. May open the routes in `PUBLIC_PATHS` (below). Everything else stays behind the PIN exactly as today.
- **Pro customer** — `__Host-pro` cookie issued after Stripe Checkout or by restoring a licence key. Unlocks export/save/sync on public tools. Never unlocks private pages.

`PUBLIC_PATHS` (prefix match unless marked exact), enforced in `worker/auth.ts` before the PIN check:
`/site` (exact + `/site/`), `/audio` (exact + `/audio/`), `/studio` (exact + `/studio/`), `/pro` (exact + `/pro/`), `/pay/`, `/terms`, `/privacy`, `/login`, `/logout`, `/_astro/`, `/scripts/`, `/fonts/`, `/media/`, `/worklets/`, `/data/`, `/og/`, `/favicon.ico`, `/favicon.svg`, `/icon-`, `/apple-touch-icon.png`, `/manifest.webmanifest`, `/robots.txt`, `/sw.js`, `/api/pro/`, `/api/poi/`, `/api/tiles/` (the OSM tile proxy `TILE_RE`), `/api/fx`, `/api/prices`, `/api/store/` (Pro or owner only — see below).
Everything else (`/`, `/kitchen`, `/money`, `/training`, `/reader`, `/feeds`, `/notes`, `/api/tts`, `/api/book`, `/api/recipe`, …) → PIN as today.

`/api/store/<key>` is reachable publicly but answers 401 unless the request carries a valid owner session **or** an active Pro cookie; Pro customers get their own namespace: the D1 key is `pro:<licence_hash>:<key>` for customers and `<key>` for the owner. Public tools that offer "Sync across devices" therefore work for Pro only.

## Cookies

- `__Host-pro` — HttpOnly, Secure, `SameSite=Lax` (Stripe's redirect is a cross-site top-level navigation), Path=/, 365 days. Value `<licence_hash>.<expiry>.<sig>`; HMAC-SHA-256 with `keyFor(env)` from `auth.ts` (same secret as the PIN session — rotating it logs everyone out, acceptable for the experiment). `licence_hash` = base64url SHA-256 of the licence key.
- `vv_pro=1` — plain (not HttpOnly) marker so pages can render Pro state before `/api/pro/status` answers; set and cleared together with `__Host-pro`.
- `vv_owner=1` — plain marker set with the PIN session cookie at login and cleared at logout, so nav can hide private groups for public visitors.

## D1 (`migrations/0004_pro.sql`)

```sql
CREATE TABLE IF NOT EXISTS pro_licences (
  licence_hash TEXT PRIMARY KEY,
  stripe_customer TEXT NOT NULL,
  stripe_subscription TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,               -- 'year' | 'month'
  status TEXT NOT NULL,             -- 'active' | 'past_due' | 'cancelled'
  current_period_end INTEGER,       -- unix seconds from Stripe
  email TEXT,                       -- from Checkout, for manual key recovery only
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS pro_events (
  event_id TEXT PRIMARY KEY,        -- Stripe event id, idempotency
  received_at INTEGER NOT NULL
);
```

Licence key format shown to the customer: `VV-XXXX-XXXX-XXXX` (uppercase, no 0/O/1/I), generated from `crypto.getRandomValues`; only its hash is stored; it is also written to the Stripe customer's `metadata.licence_key` so Vish can recover it from the dashboard.

## Worker routes (`worker/pro.ts`, wired from `worker/index.ts`)

All JSON, `Cache-Control: no-store`. POSTs require `Origin === url.origin` except the webhook.

| Route | Behaviour |
|---|---|
| `GET /api/pro/status` | `{ pro: boolean, source: "owner" \| "licence" \| null, plan?: "year"\|"month", periodEnd?: number, configured: boolean }`. Owner session → `pro:true, source:"owner"`. Pro cookie → verify signature + expiry, then D1 status must be `active` or `past_due`; touch `last_seen` at most once a day. `configured` = Stripe secrets + price vars present. |
| `POST /api/pro/checkout` `{ plan }` | Creates a Stripe Checkout Session via `fetch("https://api.stripe.com/v1/checkout/sessions")` with the secret key (form-encoded body): `mode=subscription`, `line_items[0][price]=<price id>`, `line_items[0][quantity]=1`, `success_url=<origin>/pay/success?session_id={CHECKOUT_SESSION_ID}`, `cancel_url=<origin>/pro?cancelled=1`, `allow_promotion_codes=true`, `customer_creation` default. Returns `{ url }`. 503 when not configured. 400 on bad plan. |
| `GET /pay/success?session_id=` | Retrieves the session (`expand[]=subscription`, `expand[]=customer`). If `payment_status` is `paid` or `subscription.status` in (`active`,`trialing`): upsert licence keyed by subscription id (idempotent — a second visit re-shows "already issued" without a key), set both cookies, write `metadata[licence_key]` to the customer, and **render an HTML page in the Worker** (same look as the login page in `auth.ts`) showing the key once with copy button and a link to `/pro`. Otherwise render "Payment not completed". |
| `POST /api/pro/restore` `{ key }` | Rate-limited through `PinAttempts` with bucket name `pro-restore` (same 5/IP/15 min). Hash key → D1 row with status active/past_due → set cookies → `{ ok: true, plan }`. Otherwise `{ ok:false }` 401. |
| `POST /api/pro/logout` | Clears both cookies, 204. |
| `POST /api/pro/webhook` | Verify `Stripe-Signature` (v1 HMAC-SHA-256 of `<t>.<payload>` with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance). Idempotent via `pro_events`. Handle `checkout.session.completed` (upsert licence as above, generating the key if the success page hasn't), `customer.subscription.updated` (status/plan/period), `customer.subscription.deleted` (status `cancelled`), `invoice.payment_failed` (status `past_due`). Always 200 on handled/ignored events, 400 on bad signature. |

Env: secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; vars `STRIPE_PRICE_YEAR`, `STRIPE_PRICE_MONTH` (Stripe price ids, in `wrangler.jsonc` `vars`, empty until Vish creates the product). `PinEnv`/`Env` gain these as optional. No Stripe SDK — plain `fetch` with `Authorization: Bearer`.

## Pages and client (`src/scripts/site/pro.ts`, `public/scripts/chrome.js` tweak)

- `pro.ts`: `proState()` (reads `vv_pro`/`vv_owner` markers synchronously, then confirms via `/api/pro/status` once per page and caches in `sessionStorage`), `requirePro(feature: string, run: () => void, anchor: HTMLElement)` — runs immediately when Pro/owner; otherwise renders an inline upsell panel next to `anchor` (never a modal, never `alert`): one sentence naming the feature, two buttons that POST to `/api/pro/checkout` and follow `url` ("Pro — A$39 / year", "A$5 / month"), a "Have a key? Restore" disclosure with the key input, and a "Not now" dismiss. Panel id pattern `pro-upsell`, `data-feature=<feature>`.
- `/pro` page: what's free (everything, unlimited), what Pro adds (exports, saved projects, cross-device sync, MP3/stem export), the two buttons, restore-key form, FAQ (cancel any time via Stripe's customer portal link when available, refunds within 14 days by email, data stays in your browser). If `/api/pro/status` says `configured:false`, buttons are replaced by "Not open yet".
- `/terms` page (plain prose: personal-use licence, no warranty, cancellation, 14-day refund, Australian consumer law not excluded, contact email). `/privacy` gets a Pro paragraph (Stripe processes payment; we store a hashed key, subscription status and email).
- Nav: mark the Life, Read and Logs groups and the homepage private cards with `data-private`; `chrome.js` hides `[data-private]` when the `vv_owner` marker is absent.
- Gating points (public tools). Wrap the **handler**, leave the button enabled so the upsell explains why:
  - `/site/pdf` `#pdf-export`, `#pdf-compare-export`
  - `/site/programme` every export/print action (PDF, CSV, PNG/Gantt, project JSON)
  - `/site/cut-list` and `/site/sheet` `#save-pdf`, `#export-project`/`#save-project`, `#export-csv`
  - `/site/lattice` export/download actions
  - `/site/records` export
  - `/site/rate` `#r-export`, `/site/charge-rate` `#print`
  - `/studio` MP3 export and stem export (WAV master export stays free)
  - `/audio/prep` batch download when more than one file; `/audio/lofi` MP3 format
  - "Sync across devices" toggle on any public tool that has one (none today; the store controls stay owner-only on private pages)
  Everything else — calculators, analysis, playback, single WAV — stays free.

## Tests

- `scripts/pro-api.test.mjs` (`node --experimental-strip-types --test`): fake D1 (see `scripts/store-api.test.mjs`), stub `globalThis.fetch` for Stripe; cover public allowlist vs PIN, status for owner/pro/none, checkout 503 unconfigured and URL when configured, success page issues a key once and sets cookies, restore success/failure/rate-limit, webhook signature accept/reject and idempotency, store namespace for Pro vs owner.
- `scripts/pro-e2e.mjs dist`: public visitor on `/site/pdf/` sees the upsell panel on export click (no navigation, no dialog); `/pro` renders both plans or "Not open yet"; `[data-private]` nav hidden without the owner marker; owner marker shows it.

## Addendum 2026-09-14 (evening) — free quota, Money goes public

**Free quota (Vish's call):** free visitors get **3 gated actions per rolling 30 days**, metered on the Worker; after that every gated action shows the upsell. Enforcement is anonymous-cookie **and** IP-hash, both counted, stricter wins — incognito resets the cookie, not the IP; a VPN beats it; accepted.

- Migration `0005_free_uses.sql`: `CREATE TABLE IF NOT EXISTS free_uses (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL);`
- Cookie `__Host-anon`: HttpOnly, Secure, SameSite=Lax, Path=/, 400 days; value `<id>.<sig>` where id = 16 random bytes base64url and sig = HMAC (`keyFor(env)`) of the id. Set by the Worker on the first `/api/pro/use` call from a browser without one; a cookie with a bad signature is ignored and replaced.
- `POST /api/pro/use` `{ feature: string }` (same-origin): owner or Pro → `200 { allowed: true, pro: true }`. Otherwise buckets `anon:<id>` and `ip:<base64url HMAC of CF-Connecting-IP>`; a bucket whose `window_start` is older than 30 days resets to 0. If **either** bucket already has `count >= FREE_USES` (env var `FREE_USES`, default `3`) → `402 { allowed: false, remaining: 0, resetsAt }`. Else increment both (upsert) → `200 { allowed: true, remaining: FREE_USES - max(counts) }`. The response sets `__Host-anon` when it was missing.
- `GET /api/pro/status` gains `freeRemaining` (computed without incrementing; `null` for owner/Pro).
- Client `requirePro(feature, run, anchor)`: owner/Pro markers → run immediately. Otherwise `POST /api/pro/use` first; `allowed` → run, then show a one-line note under the anchor ("2 free exports left this month — Pro removes the limit"); `402` → the upsell panel with heading "You've used your 3 free exports this month"; network error → the panel (fail closed) with a "try again" line.
- Copy on `/pro`: "Free: every tool, unlimited use, 3 exports a month. Pro: unlimited exports, saved projects, sync."
- Tests: `pro-api.test.mjs` — third use allowed, fourth 402, IP bucket blocks a fresh cookie, 31-day-old window resets, Pro/owner bypass, forged cookie replaced; `pro-e2e.mjs` — stub `/api/pro/use` 200 then 402 and assert note vs panel.

**Money goes public and Pro-gated:** `/money` joins `PUBLIC_EXACT_OR_DIR`; the nav link moves out of the private Life group into the public last group; the homepage card loses `data-private`. Free = budget, transactions, net worth, debts, projections. Pro (via `requirePro`) = live prices, FIRE dashboard, property, CGT, rebalancing, CSV export, sync. Data stays in the visitor's browser either way.
