# Marketing drafts — acquisition build (2026-09)

Working drafts only. Read each subreddit's self-promotion rules before posting
— none of this is pre-approved by a moderator. Nothing here has been posted.

## Reddit drafts

### r/AusFinance — Money

Title: I built a free, local-only budget/net worth tracker (no bank login, runs in your browser)

Body (≤180 words):

> Made a personal finance tool because I didn't want to hand a bank-login
> aggregator my transaction history. It's at vishvaddi.com/money — budget,
> transactions, net worth, debts and simple projections. Everything is typed
> or CSV-imported by you; nothing is uploaded, there's no account, and it
> works offline once loaded. AUD by default, with super projections and
> Australian bank CSV imports, not a US template with the currency swapped.
>
> It's free with no functional limit on the core tracker. There's an optional
> paid tier (live prices, FIRE dashboard, property) for
> people who want more than the free set — happy to take the flak if that
> feels tacked-on, genuinely just trying to fund the hosting and my time.
>
> Would appreciate feedback from anyone who's tried to track net worth by
> hand and given up — what's missing, what's confusing, what you'd want
> before trusting it with real numbers.

### r/Estimators (or r/Construction) — Site tools

Title: Free browser tools for estimators: cut list optimiser, programme builder, PDF toolkit

Body (≤180 words):

> I'm an estimator in shopfitting/commercial construction in Australia and
> got sick of paying for or hacking together the small tools estimating
> actually needs, so I built a set at vishvaddi.com/site. Three that might be
> useful here:
>
> - Cut List Optimiser — packs pieces into stock lengths, minimises offcut,
>   allows for kerf and end trim.
> - Programme Builder — real CPM scheduling (FS/SS/FF, lag, working-day
>   calendar, float), not just a task list with dates.
> - PDF Toolkit — merge/split/rotate/watermark/compare drawings, all local,
>   nothing uploaded.
>
> There are also calculators for materials, unit rates, charge-out rates,
> timber spans and a site records register. All free, no account, nothing
> leaves your browser. There's an optional Pro tier for exports/saves if you
> want it — the calculators themselves aren't gated.
>
> Keen for feedback from people who actually estimate for a living — what's
> wrong, what's missing, what you'd never trust a browser tool with.

### r/AusRenovation — Cut list / materials

Title: Free cut-list and material-quantity calculators for DIY/reno (AU, browser-only)

Body (≤180 words):

> Built a couple of tools that might help if you're planning a reno and
> want to sense-check quantities before you order: vishvaddi.com/site
>
> - Cut List Optimiser — tell it your stock lengths and the pieces you need
>   (shelving, framing, trim) and it works out the cutting plan with the
>   least waste, accounting for saw kerf.
> - Material Calculators — paint coverage, tiles, plasterboard sheets,
>   concrete and footing volumes, timber, roofing — each with a sensible
>   waste allowance.
>
> Everything runs in your browser, no sign-up, no upload — I don't want your
> project details any more than you want to hand them over. Free tier covers
> using every calculator; there's an optional paid add-on for saving/exporting
> a project if you want to reopen it later, but you don't need it to get a
> number today.
>
> If you've done a reno lately, I'd love to know what number you had to dig
> around for that this doesn't cover yet.

## Whirlpool forum post draft

Forum: Whirlpool — likely **Building / Renovation** or **Trades and
Services** subforum, depending on audience. Check the forum's own
self-promotion guidelines before posting; Whirlpool moderators are stricter
about anything that reads as an ad than most subreddits.

Title: Free construction estimating tools (cut list, programme, PDF, material calcs) — feedback welcome

Body:

> G'day — I'm an estimator (shopfitting/commercial) and built a set of free,
> browser-based tools for the small jobs that eat estimating time: a cut list
> optimiser (linear + sheet nesting), a proper critical-path programme
> builder with Gantt export, a local PDF toolkit (merge/split/watermark/
> compare drawings), unit rate and charge-out rate calculators, material
> quantity calculators (paint, tiles, concrete, timber, roofing), a timber
> span lookup, and a site records register for variations/punch
> list/deliveries.
>
> They're at vishvaddi.com/site. Everything runs entirely in the browser —
> no account, no upload, no watermark on the free tier. There's an optional
> paid add-on (exports, saved projects, sync) for people who want more than
> the free set, but the calculators themselves aren't gated.
>
> I'm not a full-time software person — this is a side project I build in a
> few hours a week — so I'd genuinely value feedback from people who
> estimate or run renovations for a living: what's inaccurate, what's
> missing, what you'd never trust a browser tool to get right.

## Google Ads test plan

Budget discipline: A$10/day cap **per campaign**, 14 days, manual pause if
cost-per-Pro-sale exceeds the kill line below. No display network, search
only, exact match only (keeps CPCs predictable and volume low enough to stay
inside budget).

**Conversion event:** a page view on `/pay/success` (the Stripe Checkout
return page in `worker/pro.ts`) — that page only renders after Stripe
confirms payment, so it's a real conversion, not a click-through proxy.
Import it as a "page view" goal in Google Ads via the Google tag, scoped to
that exact path.

**Kill line:** pause the campaign the moment cost-per-Pro-sale exceeds
**A$40** (roughly one month of the annual plan's *effective* monthly price,
so it's not profitable to keep buying sales at that cost while the product is
unproven). Check daily for the first 5 days, then every 2–3 days.

### Campaign 1 — Site tools

Landing page: `/site` (or the highest-intent tool page, e.g. `/site/cut-list`
for the cut-list keyword, to keep search intent and landing content matched).

Exact-match keywords:
1. [construction cut list calculator]
2. [free construction programme software]
3. [cpm scheduling software free]
4. [pdf editor for tradies]
5. [estimating calculator australia]

### Campaign 2 — Money

Landing page: `/money`

Exact-match keywords:
1. [free budget tracker australia]
2. [net worth tracker no bank login]
3. [personal finance app australia free]
4. [budget spreadsheet alternative]
5. [free fire calculator australia]

## Demo video scripts (30 seconds each, one per hero tool)

Format for all five: no voiceover required (captions on-screen), screen
recording only, ends on the URL card. Keep it to the real UI — nothing shown
that the tool doesn't do today.

### 1. Cut List Optimiser (`/site/cut-list`)

- 0:00–0:04 — Caption: "Cutting a job's timber list by hand? There's a
  better way." Show blank cut-list page.
- 0:04–0:12 — Type in stock lengths (5400, 4800mm) and 4–5 pieces with
  quantities.
- 0:12–0:20 — Cut plan renders: highlight the efficiency %, offcut total and
  the bar visualisation.
- 0:20–0:26 — Click "Save as PDF" → upsell panel appears (shows Pro exists
  without dwelling on it).
- 0:26–0:30 — End card: "Free at vishvaddi.com/site/cut-list"

### 2. Programme Builder (`/site/programme`)

- 0:00–0:04 — Caption: "A real CPM programme, not a task list with dates."
- 0:04–0:14 — Pick the shopfitting template, show tasks populate with FS/SS
  links already in place.
- 0:14–0:22 — Drag a task, show downstream dates and float recalculate live.
- 0:22–0:28 — Open the Gantt view, scroll across the critical path
  highlighted in a different colour.
- 0:28–0:30 — End card: "Free at vishvaddi.com/site/programme"

### 3. PDF Toolkit (`/site/pdf`)

- 0:00–0:04 — Caption: "Stop uploading tender drawings to strangers' PDF
  sites."
- 0:04–0:12 — Drop in two PDF files, show them merge into one page list.
- 0:12–0:20 — Select a page, rotate it, add a "FOR REVIEW" stamp preset.
- 0:20–0:27 — Open Overlay and compare, load a second revision, show the
  difference-mode overlay highlighting changed areas.
- 0:27–0:30 — End card: "Free at vishvaddi.com/site/pdf"

### 4. Chord & Scale Lab (`/audio/chords`)

- 0:00–0:04 — Caption: "Every chord in the key, plus the numerals producers
  talk in."
- 0:04–0:12 — Pick a key and scale, tap through the diatonic chords, audio
  plays each one.
- 0:12–0:20 — Build a progression from a preset, show Roman numerals and
  Camelot code update live.
- 0:20–0:26 — Loop the progression at tempo, then click Export MIDI.
- 0:26–0:30 — End card: "Free at vishvaddi.com/audio/chords"

### 5. Track Analyser (`/audio/analyser`)

- 0:00–0:04 — Caption: "Mastering meters without opening a DAW."
- 0:04–0:14 — Drag a track in, show BPM, key and Camelot code populate.
- 0:14–0:22 — Show LUFS, true peak and stereo width readouts.
- 0:22–0:28 — Highlight the "vs Spotify / Apple Music / club target" gap
  indicator.
- 0:28–0:30 — End card: "Free at vishvaddi.com/audio/analyser"
