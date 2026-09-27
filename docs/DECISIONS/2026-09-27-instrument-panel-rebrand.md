# 2026-09-27 — Instrument-panel rebrand is the default skin

## Context

Vish's 25/09/26 audit chose a full rebrand: modern, futuristic, minimal, eye-catching, animated; dark-first "instrument panel"; light mode kept; exports and prints stay paper; Studio and the game builds out of scope. The plan (`docs/SITE_AUDIT_2026-09-25.md` §3) staged it behind `html[data-skin="v2"]` so each stage could be screenshot-diffed with `scripts/visual-snapshots.mjs`.

## Decision

`src/styles/skin-v2.css` is loaded from `global.css` and `Base.astro` sets `data-skin="v2"` on every page except immersive ones (Studio keeps its own v5 token skin). Tokens: dark `--bg #0B0C0E`, surfaces `#111317/#171A1F/#1E2228`, hairlines at 8%/16% white, text `#ECEDEF/#9BA1A8/#6B7178`, accent `#FF6A2B` (text form `#FF8A55`), data cyan `#37D4FF`, status `#3DDC97/#FFC24B/#FF5A5F`; light `--bg #F5F5F2`, text `#0E0F11/#5A5F66/#7A7F86`, accent `#D9480F` (text `#B33A0A`), data `#0077A8`. Radii 6/10/16, motion 120/200/360/600 ms with `cubic-bezier(.2,.8,.2,1)` and a spring ease. Type: Geist Sans (UI), Geist Mono (readouts, eyebrows), Source Serif 4 kept on `main.long-form` body text.

Dark is the default regardless of OS preference; the toggle stores an explicit `light`. `chrome.js` treats "no stored theme" as dark when the skin attribute is present.

## Contrast (WCAG 2.x ratios)

| Pair | Dark | Light |
|---|---|---|
| text / bg | 16.7 | 17.6 |
| muted / bg | 7.5 | 5.9 |
| faint / bg | 4.0 | 3.6 |
| accent text / bg | 8.4 | 5.5 |
| data / bg | 11.2 | 4.6 |
| text / surface-3 | 13.6 | 15.3 |

Body text ≥ 4.5:1 and UI text ≥ 3:1 in both themes; faint is used only for eyebrows and meta lines. The old body text was about 5.9:1; muted text is now 7.5:1 dark / 5.9:1 light.

## Alternatives rejected

- **Astro `ClientRouter` for page transitions** — every tool script assumes a full page load. CSS `@view-transition { navigation: auto }` gives the cross-fade and the nav-marker/title morph with zero JS.
- **Google Fonts** — `font-src 'self'`; Geist is self-hosted (OFL, `public/fonts/LICENSE-geist.txt`).
- **Deleting the old `:root` colour tokens** — kept as the fallback for immersive pages (Studio) and the Worker-rendered pages that never load the skin. They are inert wherever `data-skin` is set.
- **Restyling exports** — out of scope; `@media print` in the skin resets to paper tokens.

## Consequences

Studio and the game builds look as before. The snapshot script still captures a "v1" set (attribute removed) for one release, then that mode can go. Hover on tool controls stays border-only (17/09 rule); the pointer glow lives on cards only.
