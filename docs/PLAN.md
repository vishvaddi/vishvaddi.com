# Offline PWA + reader-offline — working plan

Status: **Phase A shipped** (this commit). Phase B below is the remaining
to-do — pick it up by pointing Claude Code at this file ("continue
docs/PLAN.md"). Written 2026-06-10 on the work PC, after rebasing onto the
big 2026-06-08/09 home session (reader, calculator, games, radio, weather,
prepping expansions already exist — do NOT re-plan those).

## Done (Phase A — this commit)

- **Offline/PWA**: `scripts/generate-sw.mjs` (workbox-build `generateSW`) runs
  as the last build step and emits a single self-contained `dist/sw.js`:
  - Precaches the whole site (~1 MB; `og/**` excluded) → tools, studio,
    prepping, reader shell all work offline after one visit.
  - Runtime caches: `/api/book?…` cache-first (**a book opened once is
    readable offline**); gutendex search network-first.
  - Registered from `public/scripts/chrome.js` (CSP-clean). `/sw.js` is
    `no-cache` in `_headers`.
- **Installable**: `public/manifest.webmanifest` (start_url `/site`), linked
  in `Base.astro`.
- **Notes**: `/notes` grouped into collapsed `<details>` theme accordions
  (themes derived from frontmatter `tags` — mapping lives in
  `src/pages/notes/index.astro`), reusing the editorial `.note-row` design.
  Drafts stay hidden (16 of 17 notes are still `draft: true`).
- **sci-calc** parked on branch `wip/sci-calc` — superseded by the live
  `/site/calculator`; delete the branch after salvaging anything useful.

## Phase B — remaining (home laptop)

- [ ] **Deploy Phase A**: `npm run build && npx wrangler deploy` (work PC has
      no wrangler auth — this must happen from the authed machine, or run
      `npx wrangler login` interactively on the work PC).
- [ ] **Verify offline on a phone**: open `/site` and a book → airplane mode →
      tools, studio and the opened book still work; "Add to Home Screen".
- [ ] **Reader: proper offline shelf (optional upgrade)** — explicit
      "download" button storing book text + metadata in IndexedDB with a
      "Downloaded" shelf and delete; today's runtime cache covers re-reading
      but is browser-evictable and invisible to the user.
- [ ] **Reader: EPUB + PDF + local files (bigger feature)** — current reader
      is Gutenberg plain-text only. EPUB: unzip with `fflate`, parse OPF
      spine, `DOMParser` + whitelist-import sanitized nodes (no `innerHTML`);
      images as blob URLs. PDF: `pdfjs-dist` canvas mode, same-origin worker.
      "Open local file" input for `.epub`/`.pdf`/`.txt`.
- [ ] **PNG manifest icons** (192/512; manifest currently uses favicon.svg).
- [ ] **Decide `/site/records`**: link it in the hub, or delete it.
- [ ] **CLAUDE.md/global.css note**: when adding page styles, keep using
      global.css or script-module imports — page-level `<style>`/frontmatter
      CSS imports get stale under the immutable `/_astro/*` cache (see commit
      7d391b1).

## Verification (after deploy)

- DevTools → Application → Service Worker active; precache ~60 entries;
  `books` cache populates after opening a book.
- Airplane-mode pass: `/site` hub, one calculator, `/studio` (play a beat),
  `/reader` with a previously opened book.
- Console free of CSP violations throughout.
