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

## Addendum 2026-09-15 — quota tightened to 1, session nudge, funnel counters

**Quota = 1.** `FREE_USES` is `"1"` in `wrangler.jsonc`; `DEFAULT_FREE_USES` in `worker/pro.ts` is also `1` so a deploy that forgets the var still gets the tight quota. `GET /api/pro/status` and `POST /api/pro/use` both now return `freeLimit` (the configured number, always present, even for Pro/owner) — the client derives every piece of quota copy from this field instead of hardcoding "3":

- `requirePro`'s free-use note: `"N free exports left this month…"` while `remaining > 0`; on the use that exhausts the quota, `"That was your free export this month — Pro removes the limit"` (`freeLimit === 1`) or `"That was your last free export this month…"` (`freeLimit > 1`).
- The blocked-panel heading: `"You've used your free export this month"` (`freeLimit === 1`) or `"You've used your N free exports this month"` (pluralised via the number).
- `/pro`'s Free paragraph has a `#free-limit-copy` span that `freeLimitLabel(limit)` fills in once `/api/pro/status` answers (`applyStatus`'s changed-check now also compares `freeLimit`, since it arrives asynchronously after the synchronous marker read and wouldn't otherwise fire `pro:changed`).

**Session nudge** (`public/scripts/chrome.js`, vanilla, site-wide — duplicates a small `track()` rather than importing `pro.ts`, since this file is a plain `/public` script, not a module): every page load under `/site/`, `/audio/`, `/studio` or `/money` is recorded as a distinct path in `sessionStorage.vv_tool_views` and fires `tool_view`. On the 3rd distinct page, if neither the `vv_owner` nor `vv_pro` cookie marker is present and `sessionStorage.vv_nudge_dismissed` isn't set, a dismissible `.vv-nudge` bar is inserted at the top of `<main>`: "Using these a lot? Pro is A$39 a year — unlimited exports, saved projects and sync." linking to `/pro`, plus a `×` dismiss button. Fires `nudge_shown` once and `nudge_click` on the link. Never on `/pro` itself (not in its path prefixes), never a modal.

**Funnel counters.** `migrations/0007_metrics.sql`: `metrics (day, event, count)`, `PRIMARY KEY (day, event)`, upserted `count + 1`. `POST /api/metric` (`worker/pro.ts`'s `handleMetricRequest`, dispatched from `worker/index.ts`, public path added to `auth.ts`'s `PUBLIC_EXACT`): body is JSON `{event}` or form-style text `event=…` (sniffed by whether the trimmed body starts with `{`); same-origin is `Origin === url.origin` when `Origin` is sent, else `Sec-Fetch-Site === "same-origin"` — both are browser-set headers `sendBeacon` can't override, which matters because `sendBeacon` sends no custom headers of its own. Whitelist: `upsell_shown, checkout_click, restore_ok, pay_success, waitlist_signup, nudge_shown, nudge_click, tool_view` — an unknown event still answers 204 but writes no row. Every path swallows D1 errors and never throws; the route always answers (204 for POST). `GET /api/metric?days=30` is owner-only (401 otherwise), returns `[{day, event, count}]` ordered by day then event.

Client `track(event)` (exported from `pro.ts`, duplicated in `chrome.js`): `navigator.sendBeacon` with a `Blob([json], {type:"application/json"})`, falling back to `fetch(..., {keepalive:true})`. Called on: upsell panel render (`upsell_shown`, inside `buildUpsellPanel`), a plan button click (`checkout_click`, inside `planButton` — fires from both the inline upsell and the `/pro` page since both share it), waitlist signup success (`waitlist_signup`, in `pro.astro`), nudge shown/click (`chrome.js`), tool page load (`tool_view`, `chrome.js`). Server-side: `pay_success` bumped in `successHandler` only when a new key is issued (not on a repeat "already issued" visit), `restore_ok` bumped in `restoreHandler` only on a successful restore.

**Tests:** `pro-api.test.mjs` — quota tests rewritten for `FREE_USES=1` (first use allowed with `remaining 0`, second 402, `freeLimit` on every response), a new metric test (whitelist enforcement, same-origin via `Origin` and via `Sec-Fetch-Site`, owner GET vs anon 401), `pay_success`/`restore_ok` assertions added to the existing success/restore tests. `pro-e2e.mjs` — stubs `/api/metric` to 204 and records calls; asserts the nudge is absent on the 1st/2nd distinct tool page and present on the 3rd, absent entirely with the owner marker, dismissible; asserts the singular "free export" heading with `freeLimit:1` stubbed and the pluralised "3 free exports" heading with `freeLimit:3` stubbed (proving the copy isn't hardcoded); asserts a `checkout_click` beacon on the `/pro` page's yearly button (checkout stubbed to a same-origin URL so nothing leaves the harness).

## Addendum 2026-09-16 — every feature free, exports metered; A$100/yr · A$20/mo · A$5/wk

Vish: "5 dollars a week and 20 a month and 100 a year, with all features free and 1 free export".

**Plans.** `Plan = "year" | "month" | "week"` in both `worker/pro.ts` and `src/scripts/site/pro.ts`. New var `STRIPE_PRICE_WEEK`; `configured()` needs all three price ids, so a missing one closes checkout ("Not open yet") rather than half-opening it. Price → plan resolves through `planForPrice()` for `/pay/success` and `customer.subscription.updated`; checkout sets `metadata[plan]`, which the success page also falls back to. D1 `pro_licences.plan` is plain `TEXT`, so `'week'` needs no migration. Button labels live in one list, `PLAN_BUTTONS`, and must match the Stripe prices. The price ids in `wrangler.jsonc` are blank until the new prices exist; the retired A$39/yr and A$5/mo prices must never be wired back.

**Free.** Every feature is free: Money's FIRE tab, adding properties and live prices are no longer gated. `/api/market` is public, behind the site-wide per-IP `/api` limiter (120/min) and the 15-minute upstream edge cache. Only exports, prints and saved project files go through `requirePro` and the 1-per-30-days allowance.

**Sync stays Pro.** Synced data is keyed by the licence hash, so there's no identity for a free visitor. The checkbox now calls `showProOnly()`, which shows the upsell without calling `/api/pro/use`. Before this change it went through `requirePro`, which spent the free export and did nothing.

**Tests:** `pro-api.test.mjs` covers weekly checkout (price + metadata), unconfigured-without-week → 503, and weekly `/pay/success` → plan `week` + "weekly" copy. `market-proxy.test.mjs` covers anonymous 200. `money-e2e.mjs` checks that FIRE and property work for a public visitor, that sync shows a panel with three plans, and that free features make zero `/api/pro/use` calls.

## Addendum 2026-09-16 (later) — adoption first: free exports with a footer, Pro = your brand; 7-day pass

Vish: "i actually want people to use it first not get scared away" → plan accepted "all that, except google ads". **This supersedes the free-export allowance** (the 1-per-30-days quota and the "1 export ever" idea are both dropped).

### Free vs Pro

| Kind | Features | Free | Pro |
|---|---|---|---|
| Client-facing documents | print/PDF: `charge-rate-print`, `cut-list-save-pdf`, `sheet-save-pdf`, `programme-print`; pdf-lib: `pdf-export`, `pdf-compare-export`; canvas: `programme-png` | **Unlimited, with a footer**: `Made free at vishvaddi.com` | Clean, with **your brand** (business name, optional ABN/contact line, optional logo) |
| Data exports | CSV/JSON/project files: `cut-list-export-*`, `sheet-save-project`, `sheet-export-csv`, `programme-csv`, `programme-json`, `csv-export` (Money), `records-*-export`, `rate-export`, `lattice-export` | Unlimited, unchanged, no footer | same |
| Pro-only | `sync`, `studio-mp3-export`, `studio-stem-export`, `lofi-mp3-format`, `audio-prep-batch-download` | Upsell panel (no quota, no `/api/pro/use`) | Works |

Every tool and feature stays free (Addendum 2026-09-16 still holds for FIRE, property and live prices). WAV export stays free.

### Page side (`src/scripts/site/export-brand.ts`, new; `pro.ts`)

- `requirePro(feature, run, anchor)`: Pro/owner → `run()`. Otherwise show the upsell panel and **never call `/api/pro/use`**. `showFreeUseNote`, the quota headings and `freeLimit` copy are removed.
- `brandedExport(feature, run)` for the seven client-facing features. It always runs `run()` for everyone and, before running, applies the stamp. Pro/owner with a saved brand gets the brand; Pro with no brand gets no footer; free gets the vishvaddi footer. It fires `track("export_free")` for free visitors and `track("export_pro")` for Pro.
  - **print:** inject one `.vv-export-brand` element that shows only under `@media print` (fixed footer for the vishvaddi line; header block for the brand), removed on `afterprint`. Styles in `site.css`, CSS vars only.
  - **pdf-lib:** `stampPdf(doc)` draws the footer (or brand header) on every page, small, 60 % grey, bottom-left margin, without covering content (shrink-to-fit is out of scope; a 14 pt strip at the page edge is enough).
  - **canvas:** `stampCanvas(canvas)` returns a new canvas with a 28 px band added below the image.
- Brand store: `localStorage["vv_brand"] = { name, line, logo }`. `logo` is a PNG/JPEG data URL, ≤ 200 KB after downscaling to ≤ 400 px wide. Editing lives on `/pro` under "Your brand" for **everyone**, with a live preview: free visitors see "Applies to your exports with Pro" and the footer version; Pro sees exactly what exports get. It never leaves the browser.
- After a free client-facing export, one dismissible line under the button: "Exported with the free footer — Pro puts your business name on it instead." (at most once per page view).
- `public/scripts/chrome.js` nudge copy: "Pro is A$100 a year — your business name on every export, plus sync."

### 7-day pass (replaces the weekly subscription)

- Plans: `year` (A$100/yr sub), `month` (A$20/mo sub), `pass` (A$5 one-off, 7 days, **does not renew**). `week` is removed everywhere. Var `STRIPE_PRICE_PASS` replaces `STRIPE_PRICE_WEEK`; `configured()` needs year + month + pass.
- Checkout for `pass`: `mode=payment`, `customer_creation=always`, `metadata[plan]=pass`; subscriptions keep `mode=subscription`.
- Licence row for a pass: `stripe_subscription = "pass_" + checkout session id` (keeps `NOT NULL UNIQUE`), `plan = 'pass'`, `status = 'active'`, `current_period_end = paid time (unix s) + 7 × 86400`. Created by whichever of `/pay/success` or `checkout.session.completed` gets there first (**assume the webhook wins**, 15/09 lesson); licence key in the customer's metadata as for subs.
- Expiry: `activeLicenceHash`, `resolvePro` and `/api/pro/restore` treat a `pass` whose `current_period_end` is in the past as inactive. The `__Host-pro` cookie lifetime for a pass is capped at the pass expiry.
- Success copy: "Your 7-day Pro pass is active until <date, en-AU>." Status payload includes `plan: "pass"` and `periodEnd`.
- `/pro` buttons: "Pro — A$100 / year", "A$20 / month", "7-day pass — A$5". Terms: the pass is one-off, lasts 7 days, doesn't renew; the 14-day refund applies to it.

### Worker clean-up

- `POST /api/pro/use` and the quota code are removed; `freeRemaining`/`freeLimit` are dropped from the status payload; `FREE_USES` is removed from `wrangler.jsonc`. The D1 `free_uses` table is left in place (no destructive migration). `__Host-anon` is no longer set.
- `/api/metric` whitelist gains `export_free`, `export_pro` and `brand_saved`.
- `/privacy`: remove the free-export-allowance section; add "Your brand (name, line, logo) is stored only in your browser."

### Tests

- `pro-api.test.mjs`: pass checkout (payment mode, `customer_creation`, metadata); pass via webhook-first then success page (key shown once); pass expiry → status `pro:false`, restore 401, `/api/store` 401; `/api/pro/use` → 404; status has no `freeLimit`; new metric events accepted.
- `pro-e2e.mjs`: free visitor prints a Cut List → footer element present in print media and removed after; PDF Toolkit export for a free visitor → the saved PDF text contains `vishvaddi.com` (via pdf-lib parsing); a Pro stub with a saved brand → brand text present, footer absent; `/pro` brand editor saves to localStorage and previews; three plan buttons; Pro-only features show the panel and make zero `/api/pro/use` calls.
