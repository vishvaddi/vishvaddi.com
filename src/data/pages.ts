// Personal pages that exist but have no content yet stay reachable at their
// URL and leave everything else — nav, homepage, palette, sitemap, RSS — and
// carry noindex until this flag flips (Vish, 25/09/26 audit, item 2.2).
// Flip a page to true and every surface picks it up on the next build.
export const PAGE_PUBLISHED: Readonly<Record<string, boolean>> = {
  "/blog": false,
  "/notes": false,
  "/books": false,
  "/movies": false,
  "/now": false,
  "/year/2026": false,
  // The album checklist works, so the page stays; its empty list sections are gone.
  "/music": true,
};

const normalise = (path: string): string => {
  const clean = path.split("#")[0].split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
};

/** True unless the page is explicitly unpublished. Note pages inherit from /notes. */
export function isPublished(path: string): boolean {
  const p = normalise(path);
  if (p in PAGE_PUBLISHED) return PAGE_PUBLISHED[p];
  if (p.startsWith("/notes/")) return PAGE_PUBLISHED["/notes"];
  if (p.startsWith("/year/")) return PAGE_PUBLISHED[p] ?? false;
  return true;
}
