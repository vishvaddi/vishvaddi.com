import { createStore, mountStoreControls, todayIso } from "./store";
import { initialAlbums, isAlbumsData, parseAlbumLines, mergeList, removeList, listStats, pickUnplayed, sortAlbums, type AlbumsData, type Album } from "./albums-model";

const mk = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
  const b = mk("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

export function initAlbums(): void {
  const root = document.getElementById("albums-app");
  if (!root) return;
  const store = createStore<AlbumsData>({ key: "albums", version: 1, initial: initialAlbums, validate: isAlbumsData });
  const controls = document.getElementById("albums-store");
  if (controls) mountStoreControls(controls, store, { filename: "vishvaddi-albums.json", onImport: () => render() });

  let filterList = "";
  let unplayedOnly = true;
  let query = "";
  let sort: "rank" | "artist" | "year" | "recent" = "rank";
  let picked: Album | null = null;

  // ── Import form ──
  const form = mk("details", "alb-import");
  form.append(mk("summary", undefined, "Add a list"));
  const nameField = mk("div", "field");
  nameField.append(mk("label", undefined, "List name"));
  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.id = "alb-list-name";
  nameIn.placeholder = "e.g. Rolling Stone 500 (2020)";
  nameField.append(nameIn);
  const textField = mk("div", "field");
  textField.append(mk("label", undefined, "One album per line — “12. Artist – Album (1971)” — or CSV with an artist/album header"));
  const textIn = document.createElement("textarea");
  textIn.id = "alb-list-text";
  textIn.rows = 6;
  textIn.placeholder = "1. Marvin Gaye – What's Going On (1971)\n2. The Beach Boys – Pet Sounds (1966)";
  textField.append(textIn);
  const albumFirst = document.createElement("input");
  albumFirst.type = "checkbox";
  const albumFirstLabel = mk("label", "alb-opt");
  albumFirstLabel.append(albumFirst, document.createTextNode(" Lines are “Album – Artist”"));
  const fileIn = document.createElement("input");
  fileIn.type = "file";
  fileIn.accept = ".txt,.csv,text/plain,text/csv";
  fileIn.id = "alb-list-file";
  fileIn.addEventListener("change", async () => { const f = fileIn.files?.[0]; if (f) { textIn.value = await f.text(); if (!nameIn.value) nameIn.value = f.name.replace(/\.[^.]+$/, ""); } });
  const importStatus = mk("span", "store-status");
  importStatus.id = "alb-import-status";
  const addBtn = btn("Add list", "btn btn-sm", () => {
    const name = nameIn.value.trim();
    const parsed = parseAlbumLines(textIn.value, { albumFirst: albumFirst.checked });
    if (!name) { importStatus.textContent = "Give the list a name."; return; }
    if (!parsed.length) { importStatus.textContent = "No albums recognised — check the line format."; return; }
    let result = { added: 0, merged: 0 };
    store.update((d) => { result = mergeList(d, name, parsed, todayIso()); });
    importStatus.textContent = `${parsed.length} lines: ${result.added} new, ${result.merged} already on another list.`;
    textIn.value = "";
    nameIn.value = "";
    filterList = name;
    render();
  });
  addBtn.id = "alb-add-list";
  const row = mk("div", "btn-row");
  row.append(addBtn, fileIn, importStatus);
  form.append(nameField, textField, albumFirstLabel, row);

  const stats = mk("div", "alb-stats");
  stats.id = "alb-stats";
  const toolbar = mk("div", "alb-toolbar no-print");
  const listSel = document.createElement("select");
  listSel.id = "alb-filter-list";
  const unplayedBox = document.createElement("input");
  unplayedBox.type = "checkbox";
  unplayedBox.checked = unplayedOnly;
  unplayedBox.id = "alb-unplayed";
  const unplayedLabel = mk("label", "alb-opt");
  unplayedLabel.append(unplayedBox, document.createTextNode(" Unplayed only"));
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search artist or album";
  search.id = "alb-search";
  const sortSel = document.createElement("select");
  for (const [v, l] of [["rank", "By rank"], ["artist", "By artist"], ["year", "By year"], ["recent", "Recently played"]]) { const o = document.createElement("option"); o.value = v; o.textContent = l; sortSel.append(o); }
  const pickBtn = btn("Pick an unplayed album", "btn btn-sm", () => { picked = pickUnplayed(store.get(), { list: filterList || undefined }); renderPick(); });
  pickBtn.id = "alb-pick";
  toolbar.append(listSel, unplayedLabel, search, sortSel, pickBtn);
  listSel.addEventListener("change", () => { filterList = listSel.value; render(); });
  unplayedBox.addEventListener("change", () => { unplayedOnly = unplayedBox.checked; renderTable(); });
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); renderTable(); });
  sortSel.addEventListener("change", () => { sort = sortSel.value as typeof sort; renderTable(); });

  const pickCard = mk("div", "rec-card alb-pick");
  pickCard.id = "alb-pick-card";
  pickCard.hidden = true;
  const table = mk("div", "alb-table");
  table.id = "alb-table";
  root.append(form, stats, toolbar, pickCard, table);

  function renderPick(): void {
    pickCard.textContent = "";
    if (!picked) { pickCard.hidden = true; return; }
    pickCard.hidden = false;
    const p = picked;
    pickCard.append(mk("div", "rec-chip", "Tonight"), mk("div", "rec-title", `${p.artist} — ${p.title}${p.year ? ` (${p.year})` : ""}`));
    pickCard.append(mk("div", "rec-meta", Object.entries(p.lists).map(([l, r]) => `${l}${r ? ` #${r}` : ""}`).join(" · ")));
    const acts = mk("div", "btn-row");
    acts.append(
      btn("Mark listened", "btn btn-sm", () => { markListened(p.id, true); picked = null; renderPick(); }),
      btn("Another", "btn btn-ghost btn-sm", () => { picked = pickUnplayed(store.get(), { list: filterList || undefined }); renderPick(); }),
    );
    pickCard.append(acts);
  }

  function markListened(id: string, on: boolean): void {
    store.update((d) => { const a = d.albums.find((x) => x.id === id); if (a) a.listenedAt = on ? todayIso() : null; });
    renderStats();
    renderTable();
  }

  function renderStats(): void {
    const data = store.get();
    stats.textContent = "";
    const s = listStats(data);
    if (!s.length) { stats.append(mk("p", "calc-blurb", "No lists yet. Paste one in above — Rolling Stone, NME, SPIN, 1001 Albums, your own.")); return; }
    const grid = mk("div", "stat-grid");
    const all = mk("div", "stat");
    all.append(mk("div", "n", `${data.albums.filter((a) => a.listenedAt).length} / ${data.albums.length}`), mk("div", "l", "all albums"));
    grid.append(all);
    for (const l of s) {
      const el = mk("div", "stat alb-stat");
      el.append(mk("div", "n", `${l.done} / ${l.total}`), mk("div", "l", l.name));
      const rm = btn("remove", "alb-remove", () => { if (!confirm(`Remove the list “${l.name}”? Albums only on this list are dropped unless you've played them.`)) return; store.update((d) => removeList(d, l.name)); if (filterList === l.name) filterList = ""; render(); });
      el.append(rm);
      grid.append(el);
    }
    stats.append(grid);
    const current = listSel.value;
    listSel.textContent = "";
    const allOpt = document.createElement("option"); allOpt.value = ""; allOpt.textContent = "All lists"; listSel.append(allOpt);
    for (const l of data.lists) { const o = document.createElement("option"); o.value = l.name; o.textContent = l.name; listSel.append(o); }
    listSel.value = data.lists.some((l) => l.name === filterList) ? filterList : (current && data.lists.some((l) => l.name === current) ? current : "");
    filterList = listSel.value;
  }

  function renderTable(): void {
    const data = store.get();
    table.textContent = "";
    let albums = data.albums.filter((a) => (!filterList || filterList in a.lists) && (!unplayedOnly || !a.listenedAt));
    if (query) albums = albums.filter((a) => `${a.artist} ${a.title}`.toLowerCase().includes(query));
    albums = sortAlbums(albums, sort);
    if (!albums.length) { table.append(mk("p", "calc-blurb", data.albums.length ? "Nothing matches." : "")); return; }
    const frag = document.createDocumentFragment();
    for (const a of albums.slice(0, 400)) {
      const row = mk("label", "alb-row" + (a.listenedAt ? " done" : ""));
      row.dataset.album = a.id;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!a.listenedAt;
      box.addEventListener("change", () => markListened(a.id, box.checked));
      const main = mk("span", "alb-main");
      main.append(mk("span", "alb-artist", a.artist), mk("span", "alb-title", a.title), mk("span", "alb-year", a.year ? String(a.year) : ""));
      const lists = mk("span", "alb-lists", Object.entries(a.lists).map(([l, r]) => `${shortName(l)}${r ? ` #${r}` : ""}`).join(" · ") + (a.listenedAt ? ` · played ${a.listenedAt}` : ""));
      row.append(box, main, lists);
      frag.append(row);
    }
    table.append(frag);
    if (albums.length > 400) table.append(mk("p", "calc-blurb", `Showing 400 of ${albums.length} — search or filter to narrow.`));
  }
  const shortName = (l: string) => l.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => (/^\d/.test(w) ? w : w[0])).join("").toUpperCase();

  function render(): void { renderStats(); renderTable(); }
  render();
}
