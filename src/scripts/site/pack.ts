// A LighterPack-style gear-list / pack-weight tool. Everything is local: packs
// live in localStorage and a whole pack can be shared via a URL hash (base64),
// so there's no server and nothing leaves the device unless you copy the link.

type Item = {
  id: string;
  name: string;
  qty: number;
  weight: number; // grams, always
  worn: boolean;
  consumable: boolean;
};
type Category = { id: string; name: string; items: Item[] };
type Pack = { id: string; name: string; unit: Unit; categories: Category[] };
type Unit = "g" | "kg" | "oz" | "lb";

const STORE = "vv-packs";
const FACTOR: Record<Unit, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const DECIMALS: Record<Unit, number> = { g: 0, kg: 2, oz: 1, lb: 2 };

let packs: Pack[] = [];
let activeId = "";

const uid = (): string => Math.random().toString(36).slice(2, 9);
const active = (): Pack => packs.find((p) => p.id === activeId) || packs[0];

function toUnit(grams: number, u: Unit): number {
  return grams / FACTOR[u];
}
function fmt(grams: number, u: Unit): string {
  const v = toUnit(grams, u);
  return v.toLocaleString("en-AU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: DECIMALS[u],
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function defaultPack(): Pack {
  const cat = (name: string, items: Array<[string, number, number, boolean, boolean]>): Category => ({
    id: uid(),
    name,
    items: items.map(([n, q, w, worn, con]) => ({ id: uid(), name: n, qty: q, weight: w, worn, consumable: con })),
  });
  return {
    id: uid(),
    name: "Get-Home Bag",
    unit: "g",
    categories: [
      cat("Worn", [["Boots", 1, 1100, true, false], ["Jacket (hardshell)", 1, 380, true, false]]),
      cat("Water", [["1L bottle + filter", 1, 320, false, false], ["Water (1L)", 1, 1000, false, true]]),
      cat("Food", [["Trail bars", 4, 60, false, true]]),
      cat("Shelter & warmth", [["Emergency bivvy", 1, 110, false, false], ["Beanie + gloves", 1, 120, false, false]]),
      cat("Tools & light", [["Headtorch", 1, 85, false, false], ["Multi-tool", 1, 150, false, false], ["Lighter + tinder", 1, 40, false, true]]),
      cat("First aid & admin", [["Compact first-aid kit", 1, 220, false, false], ["Cash + ID copies", 1, 60, false, false]]),
      cat("Navigation", [["Phone power bank", 1, 180, false, false], ["Paper map + compass", 1, 95, false, false]]),
    ],
  };
}

function load(): void {
  // A shared pack in the URL takes priority and is imported into the library.
  const hash = location.hash.match(/pack=([^&]+)/);
  try {
    const raw = localStorage.getItem(STORE);
    packs = raw ? JSON.parse(raw) : [];
  } catch {
    packs = [];
  }
  if (hash) {
    try {
      const shared = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(hash[1]))))) as Pack;
      shared.id = uid();
      shared.name = shared.name + " (shared)";
      packs.unshift(shared);
      history.replaceState(null, "", location.pathname);
    } catch {
      /* malformed share link — ignore */
    }
  }
  if (!packs.length) packs = [defaultPack()];
  activeId = packs[0].id;
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(packs));
  } catch {
    /* private mode / quota — tool still works for this session */
  }
}

// ── weight maths ──
function itemGrams(it: Item): number {
  return it.qty * it.weight;
}
function catGrams(c: Category): number {
  return c.items.reduce((s, it) => s + itemGrams(it), 0);
}
function totals(p: Pack) {
  let total = 0, worn = 0, consumable = 0, count = 0;
  for (const c of p.categories)
    for (const it of c.items) {
      const g = itemGrams(it);
      total += g;
      count += it.qty;
      if (it.worn) worn += g;
      else if (it.consumable) consumable += g;
    }
  const base = total - worn - consumable;
  return { total, worn, consumable, base, packWeight: total - worn, count };
}

const BAR_COLORS = ["#2c63d6", "#1f9d6b", "#d6892c", "#9b59b6", "#c0392b", "#16a3a3", "#7f8c2a", "#d65a8e", "#5566cc", "#888"];

// ── rendering ──
let root: HTMLElement;

function render(): void {
  const p = active();
  root.innerHTML = "";

  root.appendChild(toolbar(p));
  root.appendChild(summary(p));
  root.appendChild(breakdown(p));

  const cats = el("div", "pack-cats");
  p.categories.forEach((c) => cats.appendChild(renderCategory(p, c)));
  root.appendChild(cats);

  const addCat = el("button", "btn btn-ghost pack-add-cat", "+ Add category");
  addCat.addEventListener("click", () => {
    p.categories.push({ id: uid(), name: "New category", items: [] });
    save();
    render();
  });
  root.appendChild(addCat);
}

function toolbar(p: Pack): HTMLElement {
  const bar = el("div", "pack-toolbar");

  const sel = el("select", "pack-select");
  packs.forEach((pk) => {
    const o = el("option");
    o.value = pk.id;
    o.textContent = pk.name;
    if (pk.id === activeId) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => { activeId = sel.value; render(); });
  bar.append(el("span", "pack-lbl", "Pack"), sel);

  const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = el("button", "btn btn-ghost pack-btn", label);
    b.addEventListener("click", fn);
    return b;
  };

  bar.appendChild(mkBtn("New", () => {
    const np: Pack = { id: uid(), name: "New pack", unit: p.unit, categories: [{ id: uid(), name: "General", items: [] }] };
    packs.push(np); activeId = np.id; save(); render();
  }));
  bar.appendChild(mkBtn("Rename", () => {
    const name = prompt("Pack name", p.name);
    if (name && name.trim()) { p.name = name.trim(); save(); render(); }
  }));
  bar.appendChild(mkBtn("Duplicate", () => {
    const copy: Pack = JSON.parse(JSON.stringify(p));
    copy.id = uid(); copy.name = p.name + " copy";
    copy.categories.forEach((c) => { c.id = uid(); c.items.forEach((it) => (it.id = uid())); });
    packs.push(copy); activeId = copy.id; save(); render();
  }));
  bar.appendChild(mkBtn("Delete", () => {
    if (packs.length === 1) { alert("Keep at least one pack."); return; }
    if (!confirm("Delete \"" + p.name + "\"?")) return;
    packs = packs.filter((x) => x.id !== p.id); activeId = packs[0].id; save(); render();
  }));

  const unit = el("select", "pack-select pack-unit");
  (["g", "kg", "oz", "lb"] as Unit[]).forEach((u) => {
    const o = el("option"); o.value = u; o.textContent = u;
    if (u === p.unit) o.selected = true; unit.appendChild(o);
  });
  unit.addEventListener("change", () => { p.unit = unit.value as Unit; save(); render(); });
  bar.append(el("span", "pack-lbl", "Units"), unit);

  bar.appendChild(mkBtn("Share link", () => {
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(p))));
    const link = location.origin + location.pathname + "#pack=" + encodeURIComponent(data);
    navigator.clipboard?.writeText(link).then(
      () => alert("Share link copied to clipboard."),
      () => prompt("Copy this share link:", link),
    );
  }));
  bar.appendChild(mkBtn("Export", () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob);
    a.download = p.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".json";
    a.click(); URL.revokeObjectURL(a.href);
  }));
  const importBtn = mkBtn("Import", () => fileInput.click());
  const fileInput = el("input", "pack-file"); fileInput.type = "file"; fileInput.accept = "application/json";
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0]; if (!f) return;
    f.text().then((t) => {
      try {
        const imp = JSON.parse(t) as Pack;
        imp.id = uid(); imp.categories.forEach((c) => { c.id = uid(); c.items.forEach((it) => (it.id = uid())); });
        packs.push(imp); activeId = imp.id; save(); render();
      } catch { alert("That file isn't a valid pack export."); }
    });
  });
  bar.append(importBtn, fileInput);

  return bar;
}

function summary(p: Pack): HTMLElement {
  const t = totals(p);
  const wrap = el("div", "pack-summary");
  const cell = (label: string, grams: number, cls?: string): HTMLElement => {
    const c = el("div", "pack-sum-cell" + (cls ? " " + cls : ""));
    c.append(
      el("div", "pack-sum-n", fmt(grams, p.unit) + " " + p.unit),
      el("div", "pack-sum-l", label),
    );
    return c;
  };
  wrap.append(
    cell("Base weight", t.base, "is-base"),
    cell("Worn", t.worn),
    cell("Consumable", t.consumable),
    cell("Pack weight", t.packWeight),
    cell("Total", t.total, "is-total"),
  );
  const ct = el("div", "pack-sum-cell");
  ct.append(el("div", "pack-sum-n", String(t.count)), el("div", "pack-sum-l", "Items"));
  wrap.appendChild(ct);
  return wrap;
}

function breakdown(p: Pack): HTMLElement {
  const wrap = el("div", "pack-breakdown");
  const t = totals(p).total || 1;
  const bar = el("div", "pack-bar");
  const legend = el("div", "pack-legend");
  p.categories.forEach((c, i) => {
    const g = catGrams(c);
    if (g <= 0) return;
    const pct = (g / t) * 100;
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const seg = el("span", "pack-bar-seg");
    seg.style.width = pct + "%";
    seg.style.background = color;
    seg.title = c.name + " — " + fmt(g, p.unit) + " " + p.unit + " (" + Math.round(pct) + "%)";
    bar.appendChild(seg);

    const li = el("span", "pack-legend-item");
    const dot = el("span", "pack-legend-dot"); dot.style.background = color;
    li.append(dot, el("span", "pack-legend-name", c.name),
      el("span", "pack-legend-val", fmt(g, p.unit) + " " + p.unit + " · " + Math.round(pct) + "%"));
    legend.appendChild(li);
  });
  if (!bar.childElementCount) bar.appendChild(el("span", "pack-bar-empty", ""));
  wrap.append(bar, legend);
  return wrap;
}

function refreshTotals(): void {
  const p = active();
  // category subtotals
  for (const c of p.categories) {
    const node = root.querySelector<HTMLElement>('.pack-cat-subtotal[data-cat="' + c.id + '"]');
    if (node) node.textContent = fmt(catGrams(c), p.unit) + " " + p.unit;
  }
  // summary + breakdown: cheap to rebuild just those two blocks
  const oldSum = root.querySelector(".pack-summary");
  const oldBr = root.querySelector(".pack-breakdown");
  if (oldSum) oldSum.replaceWith(summary(p));
  if (oldBr) oldBr.replaceWith(breakdown(p));
}

function renderCategory(p: Pack, c: Category): HTMLElement {
  const box = el("div", "pack-cat");

  const head = el("div", "pack-cat-head");
  const name = el("input", "pack-cat-name");
  name.value = c.name;
  name.addEventListener("change", () => { c.name = name.value.trim() || "Category"; save(); refreshTotals(); });
  const sub = el("span", "pack-cat-subtotal");
  sub.dataset.cat = c.id;
  sub.textContent = fmt(catGrams(c), p.unit) + " " + p.unit;
  const del = el("button", "pack-x", "✕");
  del.title = "Delete category";
  del.addEventListener("click", () => {
    if (!c.items.length || confirm("Delete category \"" + c.name + "\" and its items?")) {
      p.categories = p.categories.filter((x) => x.id !== c.id); save(); render();
    }
  });
  head.append(name, sub, del);
  box.appendChild(head);

  const table = el("div", "pack-items");
  const header = el("div", "pack-row pack-row-head");
  header.append(
    el("span", "", "Item"), el("span", "pack-c", "Qty"),
    el("span", "pack-c", "Weight"), el("span", "pack-c", "Worn"),
    el("span", "pack-c", "Cons."), el("span", ""),
  );
  table.appendChild(header);

  c.items.forEach((it) => table.appendChild(renderItem(p, c, it)));
  box.appendChild(table);

  const add = el("button", "pack-add-item", "+ Add item");
  add.addEventListener("click", () => {
    c.items.push({ id: uid(), name: "", qty: 1, weight: 0, worn: false, consumable: false });
    save(); render();
  });
  box.appendChild(add);
  return box;
}

function renderItem(p: Pack, c: Category, it: Item): HTMLElement {
  const row = el("div", "pack-row");

  const name = el("input", "pack-i-name");
  name.value = it.name; name.placeholder = "Item name";
  name.addEventListener("input", () => { it.name = name.value; save(); });

  const qty = el("input", "pack-i-num"); qty.type = "number"; qty.min = "0"; qty.step = "1";
  qty.value = String(it.qty);
  qty.addEventListener("input", () => { it.qty = Math.max(0, Number(qty.value) || 0); save(); refreshTotals(); });

  const wWrap = el("span", "pack-i-weight");
  const weight = el("input", "pack-i-num"); weight.type = "number"; weight.min = "0"; weight.step = DECIMALS[p.unit] ? "0.01" : "1";
  weight.value = it.weight ? String(Number(toUnit(it.weight, p.unit).toFixed(DECIMALS[p.unit] + 2))) : "";
  weight.addEventListener("input", () => { it.weight = (Number(weight.value) || 0) * FACTOR[p.unit]; save(); refreshTotals(); });
  wWrap.append(weight, el("span", "pack-i-unit", p.unit));

  const worn = el("input", "pack-chk"); worn.type = "checkbox"; worn.checked = it.worn;
  worn.title = "Worn (excluded from base + pack weight)";
  worn.addEventListener("change", () => { it.worn = worn.checked; if (worn.checked) it.consumable = false; save(); render(); });

  const cons = el("input", "pack-chk"); cons.type = "checkbox"; cons.checked = it.consumable;
  cons.title = "Consumable (excluded from base weight)";
  cons.addEventListener("change", () => { it.consumable = cons.checked; if (cons.checked) it.worn = false; save(); render(); });

  const del = el("button", "pack-x", "✕"); del.title = "Remove item";
  del.addEventListener("click", () => { c.items = c.items.filter((x) => x.id !== it.id); save(); render(); });

  row.append(name, qty, wWrap, wrapChk(worn), wrapChk(cons), del);
  return row;
}

function wrapChk(input: HTMLElement): HTMLElement {
  const s = el("span", "pack-c"); s.appendChild(input); return s;
}

export function initPack(): void {
  const mount = document.getElementById("pack-app");
  if (!mount) return;
  root = mount;
  load();
  render();
}
