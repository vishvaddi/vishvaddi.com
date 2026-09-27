# Site audit and rebuild plan — 25/09/26

Written on the work PC from a live-site audit plus a read of the GitHub repo. No code was changed.
Filed into `docs/` on the home laptop 27/09/26; progress is tracked in `docs/PROJECT_STATE.md` and `docs/RUN_LOG.md`.

Before touching anything: read `CLAUDE.md` and `docs/PROJECT_STATE.md`, run `git status --short --branch` and `git pull --ff-only origin master` (clean tree only), and keep `npm run release:check` green at every phase boundary. Deploy only on Vish's word, from a clean pushed commit.

---

## Decisions Vish made (25.09.26)

| Question | Answer |
|---|---|
| What the site is for | **All three**: tools product (Pro), personal hub and professional portfolio. Give each a clear front door. |
| Placeholder pages | **Hide until filled.** Take them out of the nav, sitemap, command palette and home links, add `noindex`, and keep the URLs working. |
| Stripe / Pro | **LIVE, taking real payments.** Treat anything touching checkout as high-risk (see guardrails). |
| Visual direction | **Full rebrand**: modern, futuristic, minimal, eye-catching, animated. Dark-first "instrument panel" identity. |

## Order of work

0. Ship the backlog that's already built
1. Bug fixes (small and independent; do these before the rebrand so the diffs stay readable)
2. Information architecture and content
3. Full rebrand (staged)
4. Quality items
5. Growth, one track per audience

Commit per item, and state the blast radius before changing shared code, as CLAUDE.md requires.

---

## Phase 0 — ship what's already built

`PROJECT_STATE.md` has three batches built and marked green but **NOT deployed**: Site refresh phase 4 (21/09), Notepad value adds (22/09) and the Motion pass (22/09).
Deploy them **before** the rebrand, otherwise the rebrand has to rebase over them and three weeks of work stays invisible.

- Build, deploy, then run the live checks listed in each entry: `/site/rate` Copy link, `/site/charge-rate` tiles tick, `/site/programme`, `/site/notepad` gutter plus a `+ 10 wd` line, `/feeds`, `/scripts/install.js` → 200, and a materials answer page with the "change the numbers" link.

## Phase 1 — bug fixes (confirmed on the live site 25.09.26)

### 1.1 Reader fails on load — HIGH
- **Symptom:** `/reader/` shows "Failed to load Project Gutenberg." `GET /api/gutenberg-opds?sort_order=downloads` returns **504 in 0.86 s**. Search (`?query=dickens`) returns 200 but takes 5.5 s.
- **Code:** `worker/index.ts` → `fetchOpdsPage()` (~line 343) and the `/api/gutenberg-opds` route (~line 644). It throws on `!upstream.ok` and has no fallback. The fetch uses `cf: { cacheTtl: 600, cacheEverything: true }`, and a 504 that fast suggests an **upstream error is being edge-cached for 10 minutes**. Verify that before relying on it.
- **Fix:**
  - (a) Use `cacheTtlByStatus: { "200-299": 600, "400-599": 0 }`.
  - (b) When the default list fails, fall back to Gutendex (`https://gutendex.com/books/?sort=popular`, measured at 0.5 s) normalised to the same item shape.
  - (c) Keep a last-good copy (Cache API) and serve it stale on failure.
  - (d) Shorten the timeout for the default list to about 8 s.
- **Accept:** `/reader/` lists books with Gutenberg's OPDS blocked. Add a test to the existing harness.

### 1.2 Unknown URLs return an empty 404 — MEDIUM
- **Symptom:** `/nonexistent`, `/api/` and `/latest` return 404 with a **0-byte body**. Only the private routes (`/kitchen`, `/money`, `/training`) get the styled 404.
- **Cause:** the `assets` block in `wrangler.jsonc` has `run_worker_first: true` and no `not_found_handling`.
- **Fix:** add `"not_found_handling": "404-page"`, or in the Worker, when `ASSETS.fetch` returns 404 for a navigation, return the `/404/` page body with status 404.
- **Accept:** `curl -i https://vishvaddi.com/zzz` → 404 with HTML. API 404s can stay JSON.

### 1.3 Duplicated Cache-Control headers — MEDIUM (performance)
- **Symptom:** hashed assets send `Cache-Control: public, max-age=0, must-revalidate, public, max-age=31536000, immutable`.
- **Cause:** Cloudflare `_headers` applies **every** matching rule, so `/*` (max-age=0) is joined onto `/_astro/*`, `/og/*`, `/fonts/*`, `/favicon.svg` and `/manifest.webmanifest`.
- **Fix:** in each long-cache block, add `! Cache-Control` before the new value, or drop the header from `/*` and set HTML caching elsewhere.
- **Accept:** `curl -sI` on one `/_astro/*.css` shows exactly one `public, max-age=31536000, immutable`. HTML still revalidates.

### 1.4 Trailing-slash redirects are 307 — LOW (SEO)
- `/site/calc`, `/site/sheet` and similar return a 307 to the slashed URL. The command-palette index in `Base.astro` links to the unslashed forms, which adds an extra redirect.
- **Fix:** end every internal href in a slash (palette index, nav, cards). Make the redirect permanent if the Worker controls it.

### 1.5 Sitemap — MEDIUM (SEO)
- **Missing:** `/site/calc/`, `/site/lattice/`, `/site/records/`, `/site/prices/`, `/site/programme/`, which are among the strongest tools. Find the filter in `astro.config.mjs` or the page flags, probably left over from the hybrid PIN era.
- **Should not be listed:** the noindex redirect stubs `/site/fitness/`, `/site/periodic/` and `/site/triangle/`.
- **Accept:** a sitemap diff shows the five added and the three removed.

### 1.6 Pro copy contradicts itself — HIGH (Stripe is live)
- **`/pro/`:** says "every export… unlimited, free" but then lists Lo-fi MP3 and Audio Prep batch download as Pro-only.
- **`/site/` FAQ:** says Pro adds "saved projects", which isn't a Pro feature anywhere else.
- **Refunds:** `/pro/` says "within 14 days of your first payment", while `/terms/` says "of any purchase". Use the Terms wording (more generous, consistent with ACL) everywhere.
- **Prices:** they only render through JS (`pro.lAHY_SrU.js`: A$100/yr, A$20/mo, A$5 7-day). Render them into the static HTML from the same constants.
- **One statement to use everywhere:** "Every tool is free. Pro puts your brand on client exports instead of the vishvaddi.com footer, and adds cross-device sync, Studio MP3/stems, and Audio MP3/batch downloads."
- **Checkout failure:** the upsell button re-enables silently on a failed `/api/pro/checkout`. Show an inline error with the email fallback. Test it by mocking the fetch failure in Playwright. **Do not make real purchases.**

### 1.7 Privacy page missing third parties — HIGH (live payments mean real users)
- **Listed today:** Cloudflare, Stripe, Deep Swarm saves, sync and usage counts.
- **Add:**
  - **ElevenLabs.** Reader/Feeds narration text is sent through `/api/tts`.
  - **Open-Meteo** (weather).
  - **radio-browser** and the stream hosts.
  - **Project Gutenberg, Standard Ebooks and Gutendex.**
  - **TheSportsDB.**
  - **api.allorigins.win**, until 4.5 removes it.
  - **YouTube (nocookie) and archive.org** (TV).
  - **Windy, earth.nullschool and ADS-B Exchange** embeds.
  - **Recipe import**, which fetches the URL you paste.
  - **Microphone and geolocation** use: which tools, and that nothing is recorded.

### 1.8 Private links ship to anonymous visitors — MEDIUM
- `Base.astro` renders Kitchen, Money, Training and Lock-site with `data-private`. `chrome.js` hides them after a *deferred* script runs, so crawlers and no-JS clients see links that 404, and there can be a flash.
- **Fix:** in the Worker, strip them with `HTMLRewriter().on('[data-private]', { element: e => e.remove() })` when the request has no owner session.
- **Accept:** `curl -s https://vishvaddi.com/ | grep -c kitchen` → 0.

### 1.9 Smaller bugs
- **Reader:** no `<h1>`. Add one (visually hidden is fine).
- **Radio:** the "LIVE RECEIVER / AU + WORLD" eyebrow overlaps the "Also in Music" line.
- **Price tracker:** chart axis labels are unreadably small. Use the chart tokens with a minimum of 11 px.
- **Game pages** (`/games/*`): no meta description or OG. Studio has no static text for crawlers. Add a meta description, OG image and a `<noscript>` summary.
- **Notepad:** the H1 reads "Calculator". Align it with the merged Calc/Notepad naming.

## Phase 2 — information architecture and content

### 2.1 Three front doors (for "all three" audiences)
- **Homepage:** a hero with a one-line identity, then three large doors:
  - **Tools**: Site Tools, Audio, Studio. This is where Pro lives.
  - **Field**: Prepping.
  - **Work**: about Vish, how the estimating tools came about, and contact.
  - Play (Games, Radio, TV, Reader, Feeds) goes in a quieter strip below.
- **Primary nav:** `Tools · Audio · Studio · Field · Work`, then `⌕ ◷ ◐`. The More menu keeps Play and Logs.
- **Manifest:** `name` is "Vish Vaddi — Site Tools" with `start_url: /site`. Keep it if the Play Store listing is Site Tools. Otherwise rename it. Check `docs/PLAY_STORE.md` first.
- **About:** it doesn't mention the tools at all. Rewrite it to cover estimator, builder of tools and the side interests.

### 2.2 Hide the placeholders until they're filled
Pages: `/blog`, `/notes`, `/books`, `/movies`, `/music` (lists only), `/now` (last updated 30 April), `/year/2026`.
- Add a single `published` flag, for example a `src/data/pages.ts` map, that nav, sitemap, the palette index, homepage "More" links and RSS all read.
- A hidden page keeps its URL, gets `noindex` and is left out of everything above.
- `/music` has a working **album checklist**. Keep it reachable and move it into the Play/Life area, but hide the empty list sections.
- **RSS:** `/rss.xml` has 0 items. Stop advertising it (remove the `<link rel="alternate">` and any links) until Notes has posts, **or** feed it a site changelog. Vish to choose; the default is to hide it.

### 2.3 Work page, for the portfolio audience
- A short case study for each tool family: what problem, what it does, one screenshot.
- ⚠️ **Guardrail:** Vish's day-job tools and job data belong to his employer. **No client names, job numbers, prices or employer-internal screenshots.** Describe capabilities generically, and get Vish to approve all copy.

## Phase 3 — full rebrand: the "instrument panel" identity

**Brief:** modern, futuristic, minimal, eye-catching, animated. Dark-first, with light mode still supported (the theme toggle exists and exported documents are paper). The feel should be precise measuring equipment, not a gaming site: restrained surfaces, one hot accent, crisp type, motion that shows state.

### 3.1 Hard constraints (don't break these)
- **CSP:** `script-src 'self'` with no inline scripts (JSON data blocks only). `font-src 'self'`, so fonts must be **self-hosted** (no Google Fonts). `style-src` allows inline.
- **Motion:** respect `prefers-reduced-motion` everywhere. Animate only `transform` and `opacity` (plus `filter` on small elements). Nothing animates while the user is typing (the motion pass already uses `:not(:focus-within)`).
- **Exports and prints are out of scope:** PDFs, prints, PNGs, the Gantt/cut-list paper canvases and the free footer keep their current paper styling. Check `@media print` in every stage.
- **Studio** (`/studio`, its own v5 token skin) and the **game builds** under `public/games/` are out of scope. Only their hub cards and shared chrome change.
- **Performance budget:** homepage JS ≤ 30 KB gzip excluding the analytics beacon, CLS < 0.05, LCP < 1.5 s on mid-range Android 4G. No new runtime dependencies for visuals: use CSS, SVG and a small canvas at most.
- **Contrast:** body text ≥ 4.5:1 and UI text ≥ 3:1 in both themes. Current body text is about 5.9:1; don't go lower.
- **Earlier decision to revisit, not silently override:** the 17/09 polish pass set "hover = border colour only, no transform". The rebrand may add pointer-glow, but keep the no-transform rule on tool controls.

### 3.2 Tokens (`src/styles/global.css` `:root`)
Put the new tokens behind `html[data-skin="v2"]` first, so every stage can be A/B screenshotted, then flip the default and delete the old tokens at the end.

```
Dark (default)
--bg: #0B0C0E    --surface-1: #111317   --surface-2: #171A1F   --surface-3: #1E2228
--line: rgb(255 255 255 / .08)   --line-strong: rgb(255 255 255 / .16)
--text: #ECEDEF  --text-muted: #9BA1A8  --text-faint: #6B7178
--accent: #FF6A2B  (signal orange — continuity with the rust/Studio orange)
--accent-glow: rgb(255 106 43 / .35)
--data: #37D4FF    (cyan, for charts/links/data only; never decorative)
--ok: #3DDC97  --warn: #FFC24B  --bad: #FF5A5F
Light
--bg: #F5F5F2  --surface-1: #FFFFFF  --surface-2: #EFEFEA  --line: rgb(0 0 0 / .09)
--text: #0E0F11  --text-muted: #5A5F66  --accent: #D9480F  --data: #0077A8
Section tints (a 6% overlay on hub heroes only): Tools = accent, Audio = #A78BFA, Field = #3DDC97
Radii 6/10/16 · spacing 4-pt scale · keep the 17/09 --control-h / --gap tokens, re-valued
Motion: --ease-out: cubic-bezier(.2,.8,.2,1)  --ease-spring: cubic-bezier(.3,1.4,.5,1)
        --t-fast: 120ms  --t-base: 200ms  --t-slow: 360ms  --t-reveal: 600ms
```

Run every text/background pair through a contrast check and record the numbers in the decision record.

### 3.3 Type
- **Display/UI:** Geist Sans (OFL, variable). **Numbers/readouts/code:** Geist Mono. Self-host woff2, subset to Latin, `font-display: swap`, and preload only the UI weight.
- **Long-form** (prepping guides, notes): keep Source Serif 4 (already self-hosted) for body text only. It's the one warm note, and 4,000-word pages read better in a serif.
- **Scale:** fluid `clamp()`. Hero 44–88 px with tight tracking (-0.03em). H1 32–48. Eyebrows in mono uppercase with +0.14em tracking.
- **Numbers:** `font-variant-numeric: tabular-nums` on every readout.

### 3.4 Signature visuals and motion
1. **Homepage hero:** a full-bleed "blueprint instrument" in one inline SVG plus about 3 KB of JS in a `/public/scripts` file (CSP-safe).
   - A precise wireframe (isometric grid with a dimension line and a slowly scanning measurement sweep) draws itself on load using `stroke-dashoffset`.
   - Pointer parallax via the existing `--mx/--my` from `grid.js`.
   - It pauses offscreen via IntersectionObserver and is static under reduced motion.
   - Headline: short identity, mono sub-line with a typed-cursor effect (CSS `steps()`).
2. **Cross-page transitions:** CSS `@view-transition { navigation: auto; }` with `view-transition-name` on the nav, page title and hub cards, so a card morphs into the tool header.
   - Zero JS and CSP-safe.
   - Do **not** adopt Astro's `ClientRouter`: every tool script assumes a full page load.
3. **Cards:**
   - 1 px gradient border lit by a radial glow that follows the pointer (`--mx/--my`, `mask`).
   - The icon glyph draw-on already exists.
   - A subtle noise/grain layer at 3% on surfaces.
   - Staggered reveal via scroll-driven animation (`animation-timeline: view()`) inside `@supports`, with the existing `reveal.js` as fallback.
4. **Readouts:** keep the motion-pass number ticks, add a thin accent underline sweep when a value changes, and add a live-status dot on data tools (price tracker, weather, radio).
5. **Nav:**
   - Translucent bar (`backdrop-filter: blur(12px)` over `--bg` at 70%) with a hairline bottom border.
   - An active-section indicator bar slides between items (View Transition or CSS anchor positioning inside `@supports`).
   - The Ctrl+K palette gets a glass panel and highlighted match characters.
6. **Blueprint grid:** keep the reactive grid and retune it for the dark background (lines at `--line`, and the pointer-proximity brightening from the motion pass).
7. **Micro-interactions:** button press at scale .98 (buttons only, not inputs), focus ring as a 2 px accent plus a 4 px glow, and toggle switches with a spring ease.
8. **Loading states:** replace the text-only "Loading…" (Feeds, Reader, Radio) with skeleton rows and a shimmer. Reduced motion gets a static skeleton.

### 3.5 Rollout stages (screenshot-diff each one)
Before stage A, add `scripts/visual-snapshots.mjs` using the existing `playwright-core`. It should capture a route list at 390×844 and 1440×900 in dark and light, for both `data-skin` values.

Routes: `/`, `/site/`, `/site/calc/`, `/site/programme/`, `/site/cut-list/`, `/site/pdf/`, `/site/materials/paint/3x3m-room-2-4m-ceiling/`, `/audio/`, `/audio/analyser/`, `/prepping/`, `/prepping/tools/`, `/radio/`, `/feeds/`, `/reader/`, `/games/`, `/pro/`, `/privacy/`, `/404`, `/offline/`, and the login page.

| Stage | Scope | Check |
|---|---|---|
| A | Tokens, fonts and base elements (`global.css`) | contrast table, CLS |
| B | Chrome: nav, footer, palette, quote, install chip, standby | keyboard walk-through, palette |
| C | Homepage (hero and doors), `/site` and `/audio` hubs | perf budget, reduced motion |
| D | Tool shell (`site.css`): rail, picker, controls, tiles, charts; then the page-scoped styles (finish the leftover `.calc-input` / `.prog-card*` clean-up) | all harnesses green, print preview unchanged |
| E | Prepping and content pages, Radio/TV/Feeds/Reader skins | long-form readability |
| F | 404, offline and the Worker-rendered login/logout pages (inline styles in the Worker) | PIN flow still works (auth tests) |
| G | Flip `data-skin="v2"` to the default, delete old tokens, write a decision record in `docs/DECISIONS` | full `release:check`, live smoke |

## Phase 4 — quality items
- **4.1 Feeds:** render each source as it arrives instead of waiting for all 641 items (it currently shows a blank "Loading…" for 5–8 s). Tone the saturated source labels down to token colours.
- **4.2 Install chip:** already rate-limited by phase 4. Once deployed, confirm it no longer shows on first visits.
- **4.3 Studio and game pages:** SEO meta and OG images (see 1.9).
- **4.4 Materials answer pages:** 108 are live and indexable. Add the same pattern to other high-intent tools if Search Console shows traction, for example charge-out rate by trade and concrete bags by footing size.
- **4.5 Remove `api.allorigins.win`** (in the CSP `connect-src`). Find which script calls it and route it through an allow-listed Worker proxy like the existing ones. It's a free public proxy: a reliability and privacy risk.
- **4.6 Leftovers from `PROJECT_STATE.md`:**
  - The failing `auth.test.mjs` "origin" test on the laptop.
  - A real-device Android audio pass.
  - Deep Swarm, Carromancy and Big 2 playtests, and the Big 2 open questions.

## Phase 5 — growth, one track per audience
- **Tools / Pro (live):**
  - Check the `/api/metric` counts (upgrade prompt shown → checkout click → purchase).
  - Put the Pro value on export buttons ("Export with your logo") rather than in banners.
  - Work through `docs/PLAY_STORE.md`, `docs/LISTINGS.md` and `docs/OUTREACH_TAFE.md`.
  - Pricing sanity check: A$100/yr is about 5 months of the A$20 monthly plan. That's deliberate, but make sure the page states the saving.
- **Portfolio:** the Work page (2.3), a short "how I build" note, and a contact CTA.
- **Personal:** fill the logs over time. Each one comes out of hiding automatically once `published` is flipped (2.2).

---

## Evidence appendix (live, 25.09.26)
- **Crawl:** 88 URLs. Every sitemap page returned 200 in 0.1–0.7 s. Private routes returned the styled 404 for anonymous visitors.
- **Browser pass (Chrome):**
  - No console errors on `/`, `/site/`, `/studio/`, `/site/calc/`, `/site/convert/`, `/site/prices/`, `/feeds/`, `/radio/`, `/reader/`, `/prepping/tools/`, `/tv/`, `/games/` or `/games/carromancy/`.
  - Reader failed as described in 1.1.
  - Feeds took 5–8 s before its first render.
- **Security headers are strong:** strict CSP, HSTS preload, XFO DENY, nosniff and Permissions-Policy. The PIN limiter is confirmed in `PROJECT_STATE.md` (5 attempts/IP/15 min, 20/hour site-wide).
- **Corrections to the first-pass audit:**
  - `/site/resources` and `/site/span` 301 correctly.
  - Calc/Notepad and Cut List/Sheet are intentional merged tools with two URLs each, not duplicates.
- **Not verified:**
  - Correctness of each tool's output.
  - Mobile layouts.
  - Stripe checkout. Don't test it with real cards.
