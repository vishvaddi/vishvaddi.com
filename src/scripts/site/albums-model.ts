// Album checklist: "best of" lists pasted in, deduplicated across lists, ticked
// off as listened. Pure so `node --test` can drive it.

export interface Album {
  id: string;        // normalised artist + title
  artist: string;
  title: string;
  year: number | null;
  lists: Record<string, number | null>; // list name → rank on that list
  listenedAt: string | null;
  rating: number | null;
  note: string;
}

export interface AlbumList { name: string; count: number; addedAt: string }

export interface AlbumsData {
  lists: AlbumList[];
  albums: Album[];
}

export function initialAlbums(): AlbumsData { return { lists: [], albums: [] }; }
export function isAlbumsData(v: unknown): v is AlbumsData {
  const d = v as AlbumsData;
  return !!d && Array.isArray(d.lists) && Array.isArray(d.albums);
}

export function albumKey(artist: string, title: string): string {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an)\b/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  return `${norm(artist)}|${norm(title)}`;
}

export interface ParsedLine { rank: number | null; artist: string; title: string; year: number | null }

// Accepts the shapes people actually paste: "12. Artist – Album (1971)",
// "Artist - Album", "Album — Artist" when `albumFirst`, or CSV rows of
// rank,artist,album,year in any order guessed from a header.
export function parseAlbumLines(text: string, opts: { albumFirst?: boolean } = {}): ParsedLine[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  if (/,/.test(lines[0]) && /(artist|album|title)/.test(header) && lines.length > 1) return parseCsv(lines);
  const out: ParsedLine[] = [];
  for (const raw of lines) {
    let line = raw;
    let rank: number | null = null;
    const r = line.match(/^#?(\d{1,4})[.):\-–—\s]+\s*(.+)$/);
    if (r) { rank = Number(r[1]); line = r[2]; }
    let year: number | null = null;
    const y = line.match(/^(.*?)[\s,]*[\[(]\s*((?:19|20)\d\d)\s*[\])]\s*$/);
    if (y) { year = Number(y[2]); line = y[1].trim(); }
    else { const y2 = line.match(/^(.*\S)[\s,]+((?:19|20)\d\d)$/); if (y2) { year = Number(y2[2]); line = y2[1].trim(); } }
    const sep = line.match(/^(.+?)\s+[–—-]\s+(.+)$/) || line.match(/^(.+?)\s*[–—]\s*(.+)$/) || line.match(/^(.+?)\s*:\s+(.+)$/) || line.match(/^(.+?),\s*"(.+)"$/) || line.match(/^"(.+?)"\s*(?:by|-)\s*(.+)$/);
    if (!sep) continue;
    let [a, b] = [sep[1].trim(), sep[2].trim()];
    if (opts.albumFirst) [a, b] = [b, a];
    out.push({ rank, artist: a.replace(/^["']|["']$/g, ""), title: b.replace(/^["']|["']$/g, ""), year });
  }
  return out;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(lines: string[]): ParsedLine[] {
  const head = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ci = { rank: col(["rank", "position", "#", "no"]), artist: col(["artist", "band"]), title: col(["album", "title", "record"]), year: col(["year", "released"]) };
  if (ci.artist === -1 || ci.title === -1) return [];
  return lines.slice(1).map(splitCsv).filter((c) => c[ci.artist] && c[ci.title]).map((c) => ({
    rank: ci.rank >= 0 && c[ci.rank] ? Number(c[ci.rank]) || null : null,
    artist: c[ci.artist],
    title: c[ci.title],
    year: ci.year >= 0 && c[ci.year] ? Number(c[ci.year]) || null : null,
  }));
}

export function mergeList(data: AlbumsData, name: string, parsed: ParsedLine[], addedAt: string): { added: number; merged: number } {
  let added = 0, merged = 0;
  const byId = new Map(data.albums.map((a) => [a.id, a]));
  parsed.forEach((p, i) => {
    const id = albumKey(p.artist, p.title);
    const rank = p.rank ?? i + 1;
    const existing = byId.get(id);
    if (existing) {
      existing.lists[name] = rank;
      if (!existing.year && p.year) existing.year = p.year;
      merged++;
    } else {
      const album: Album = { id, artist: p.artist, title: p.title, year: p.year, lists: { [name]: rank }, listenedAt: null, rating: null, note: "" };
      data.albums.push(album);
      byId.set(id, album);
      added++;
    }
  });
  const list = data.lists.find((l) => l.name === name);
  if (list) list.count = parsed.length; else data.lists.push({ name, count: parsed.length, addedAt });
  return { added, merged };
}

export function removeList(data: AlbumsData, name: string): void {
  data.lists = data.lists.filter((l) => l.name !== name);
  for (const a of data.albums) delete a.lists[name];
  data.albums = data.albums.filter((a) => Object.keys(a.lists).length || a.listenedAt);
}

export function listStats(data: AlbumsData): { name: string; total: number; done: number }[] {
  return data.lists.map((l) => {
    const on = data.albums.filter((a) => l.name in a.lists);
    return { name: l.name, total: on.length, done: on.filter((a) => a.listenedAt).length };
  });
}

// Deterministic pick so the harness can assert on it; pass Math.random() in the UI.
export function pickUnplayed(data: AlbumsData, opts: { list?: string; random?: number } = {}): Album | null {
  const pool = data.albums.filter((a) => !a.listenedAt && (!opts.list || opts.list in a.lists));
  if (!pool.length) return null;
  const r = opts.random ?? Math.random();
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}

export function sortAlbums(albums: Album[], mode: "rank" | "artist" | "year" | "recent"): Album[] {
  const bestRank = (a: Album) => Math.min(...Object.values(a.lists).map((r) => r ?? 9999), 9999);
  const c = [...albums];
  switch (mode) {
    case "artist": return c.sort((a, b) => a.artist.localeCompare(b.artist) || (a.year ?? 0) - (b.year ?? 0));
    case "year": return c.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.artist.localeCompare(b.artist));
    case "recent": return c.sort((a, b) => (b.listenedAt ?? "").localeCompare(a.listenedAt ?? ""));
    default: return c.sort((a, b) => bestRank(a) - bestRank(b) || a.artist.localeCompare(b.artist));
  }
}
