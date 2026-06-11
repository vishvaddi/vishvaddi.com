# Offline PWA + reader-offline — working plan

Status: **Phases A and B shipped** (B: 2026-06-11, work PC — icons, reader
shelf, records/fitness linked, notes unpublished). Remaining items below —
pick up by pointing Claude Code at this file ("continue docs/PLAN.md").

## Done

### Phase A (2026-06-10, deployed and verified live)

- **Offline/PWA**: `scripts/generate-sw.mjs` (workbox-build `generateSW`) runs
  as the last build step and emits a single self-contained `dist/sw.js`:
  - Precaches the whole site (~1 MB; `og/**` excluded) → tools, studio,
    prepping, reader shell all work offline after one visit.
  - Runtime caches: `/api/book?…` cache-first; gutendex search network-first.
  - Registered from `public/scripts/chrome.js` (CSP-clean). `/sw.js` is
    `no-cache` in `_headers`.
- **Installable**: `public/manifest.webmanifest` (start_url `/site`), linked
  in `Base.astro`.

### Phase B (2026-06-11, work PC — needs deploy from authed machine)

- **PNG icons**: `scripts/generate-icons.mjs` (sharp, not in build chain —
  rerun after changing the favicon) emits `icon-192/512`, maskable 512 and
  `apple-touch-icon.png`; manifest + Base.astro updated.
- **Reader offline shelf**: explicit "↓ Save offline" button in the reader
  header stores book text + metadata in IndexedDB (`reader-shelf` DB);
  "Downloaded" shelf above the library grid with per-book delete. Saved books
  open from IndexedDB (no network), so they survive browser cache eviction.
- **Records + fitness linked**: `/site/records` and `/site/fitness` now on the
  /site hub and the sidebar rail.
- **Kindle-style reader text**: pages fill to the bottom (paragraphs split at
  word boundaries, continuations unindented), justified + hyphenated with
  first-line indents, chapter headings centred, Source Serif "Book" default
  font, repaginates on settings/resize, remembers reading position per book
  (`reader-pos-<id>` in localStorage), "Page x of y · z%" progress.
- **Notes unpublished "for now"** (Vish's call 2026-06-11): nav item, /notes
  routes, OG endpoint and rss.xml deleted; the 17 draft markdown files remain
  in `src/content/notes/` and the accordion CSS remains in global.css — restore
  the routes from git history (commit before this one) when ready to publish.
- **`wip/sci-calc` branch deleted** (local + origin).

## Remaining

- [ ] **Deploy Phase B**: `npm run build && npx wrangler deploy` (work PC has
      no wrangler auth — home laptop, or `npx wrangler login` on the work PC).
- [ ] **Verify on a phone**: open `/site` and save a book → airplane mode →
      tools, studio and the saved book still work; "Add to Home Screen" shows
      the new icon (iOS + Android).
- [ ] **Reader: EPUB + PDF + local files (bigger feature)** — current reader
      is Gutenberg plain-text only. EPUB: unzip with `fflate`, parse OPF
      spine, `DOMParser` + whitelist-import sanitized nodes (no `innerHTML`);
      images as blob URLs. PDF: `pdfjs-dist` canvas mode, same-origin worker.
      "Open local file" input for `.epub`/`.pdf`/`.txt`.
- [ ] **Prose pages still linking /notes**: `src/content/pages/blog.md` and
      `src/content/years/2026.md` mention `/notes` (now 404 → friendly 404
      page). Vault is canonical for prose — fix there when convenient.
- [ ] **CLAUDE.md/global.css note**: when adding page styles, keep using
      global.css or script-module imports — page-level `<style>`/frontmatter
      CSS imports get stale under the immutable `/_astro/*` cache (see commit
      7d391b1).

## Verification (after deploy)

- DevTools → Application → Service Worker active; precache populates;
  `books` cache + `reader-shelf` IndexedDB populate after opening/saving a book.
- Airplane-mode pass: `/site` hub, one calculator, `/studio` (play a beat),
  `/reader` with a saved book.
- Console free of CSP violations throughout.
