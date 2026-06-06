# vishvaddi.com — Claude Code context

## ALWAYS DO FIRST

```bash
git pull origin master
```

Run this before reading any file or making any change. This repo is actively worked on across sessions. Never assume local state matches remote.

## Stack

- **Astro 6** + Tailwind v4 + vanilla TypeScript in `<script>` tags
- Deployed to **Cloudflare Workers** via `wrangler deploy` (NOT auto-deploy on push)
- Build: `npm run build` → `dist/`
- Dev: `npm run dev` → localhost:4321
- Deploy: `npx wrangler deploy`

## Deploy sequence

```bash
npm run build && npx wrangler deploy
```

Always build before deploying. Check build passes before touching wrangler.

## Project structure

```
src/
  layouts/Base.astro      — shell: nav, head, footer, site-rail
  styles/global.css       — design tokens + base styles
  styles/site.css         — /site tool styles
  styles/studio.css       — /studio VishAmp skin
  styles/prepping.css     — /prepping styles
  pages/
    index.astro           — homepage
    site/                 — construction tools (10 tools)
    studio.astro          — VishAmp music workstation
    prepping.astro        — prepping knowledge
    prepping/tools.astro  — prepping tools
    notes/                — evergreen notes
  scripts/site/           — TypeScript modules per tool
  content/                — markdown content collections
public/scripts/
  chrome.js               — nav theme toggle, dropdown close
  site-hub.js             — /site hub behaviour
worker/index.ts           — Cloudflare Worker entry
```

## Nav structure (Base.astro)

- `navPrimary` array — main nav links
- `navMore` array — "More" dropdown items
- `siteTools` array — sidebar rail shown on /site/* pages (pass `siteNav` prop)
- Active state via `isActive()` comparing `Astro.url.pathname`

## CSS conventions

- Design tokens in `:root` in global.css — always use CSS vars, never hardcode colours
- Dark mode via `[data-theme="dark"]` + `prefers-color-scheme` media query
- Tailwind v4 utility classes available but used sparingly — base styles in global.css

## Content

- Notes: `src/content/notes/*.md` — frontmatter: title, description, pubDate, tags, draft
- Pages: `src/content/pages/*.md` — rendered via `getEntry` + `render` in page components
- Years: `src/content/years/*.md`

## What exists already

Before adding a page, check `src/pages/` — the following already exist:
- `/site/*` — 10 construction tools
- `/studio` — VishAmp (full drum machine, synth, mixer, export)
- `/prepping` + `/prepping/tools`
- Standard: work, notes, blog, music, movies, books, now, about, 404

## Coding conventions

- No framework components — vanilla JS in `<script>` tags
- TypeScript in `src/scripts/site/*.ts`, imported from page `<script>` tags
- No comments on what the code does — only why if non-obvious
- Match existing page structure before creating new ones
