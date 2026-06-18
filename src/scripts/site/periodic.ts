// Interactive periodic table renderer. Builds an 18-column CSS grid, colours
// cells by category, and shows a detail panel on hover/click. textContent only.

import { ELEMENTS, CAT_LABELS, ELEMENT_USES, type Cat } from "./periodic-data";

export function initPeriodic() {
  const grid = document.getElementById("pt-grid");
  const detail = document.getElementById("pt-detail");
  const legend = document.getElementById("pt-legend");
  const search = document.getElementById("pt-search") as HTMLInputElement | null;
  if (!grid || !detail) return;

  const cells: Record<number, HTMLElement> = {};

  const showDetail = (el: typeof ELEMENTS[number]) => {
    const [z, sym, name, mass, cat, x, y] = el;
    detail.textContent = "";
    detail.dataset.cat = cat;
    const period = y > 7 ? (y === 8 ? 6 : 7) : y;
    const group = y > 7 ? "—" : String(x);
    const rows: [string, string][] = [
      [sym, name],
      [String(z), "atomic number"],
      [String(mass), "atomic mass"],
      [CAT_LABELS[cat], "category"],
      [group, "group"],
      [String(period), "period"],
    ];
    const big = document.createElement("div");
    big.className = "pt-detail-sym";
    big.textContent = sym;
    detail.append(big);
    const meta = document.createElement("div");
    meta.className = "pt-detail-meta";
    for (const [v, l] of rows.slice(1)) {
      const r = document.createElement("div");
      r.className = "pt-detail-row";
      const a = document.createElement("span"); a.className = "pt-dl"; a.textContent = l;
      const b = document.createElement("span"); b.className = "pt-dv"; b.textContent = v;
      r.append(a, b);
      meta.append(r);
    }
    const nm = document.createElement("div"); nm.className = "pt-detail-name"; nm.textContent = name;
    detail.append(nm, meta);
    const uses = ELEMENT_USES[z];
    if (uses) {
      const u = document.createElement("p");
      u.className = "pt-detail-uses";
      u.textContent = uses;
      detail.append(u);
    }
  };

  for (const el of ELEMENTS) {
    const [z, sym, name, mass, cat, x, y] = el;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "pt-cell";
    cell.dataset.cat = cat;
    cell.style.gridColumn = String(x);
    cell.style.gridRow = String(y > 7 ? y + 1 : y); // gap row before f-block
    cell.setAttribute("aria-label", `${name} (${sym}), atomic number ${z}`);

    const num = document.createElement("span"); num.className = "pt-z"; num.textContent = String(z);
    const s = document.createElement("span"); s.className = "pt-sym"; s.textContent = sym;
    const n = document.createElement("span"); n.className = "pt-name"; n.textContent = name;
    cell.append(num, s, n);

    cell.addEventListener("mouseenter", () => showDetail(el));
    cell.addEventListener("focus", () => showDetail(el));
    cell.addEventListener("click", () => showDetail(el));
    cells[z] = cell;
    grid.append(cell);
  }

  // Category legend (also filters on click).
  if (legend) {
    let active: Cat | null = null;
    (Object.keys(CAT_LABELS) as Cat[]).forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pt-legend-item";
      b.dataset.cat = c;
      const sw = document.createElement("span"); sw.className = "pt-sw"; sw.dataset.cat = c;
      const lbl = document.createElement("span"); lbl.textContent = CAT_LABELS[c];
      b.append(sw, lbl);
      b.addEventListener("click", () => {
        active = active === c ? null : c;
        grid.querySelectorAll<HTMLElement>(".pt-cell").forEach((cell) => {
          cell.classList.toggle("dim", active !== null && cell.dataset.cat !== active);
        });
        legend.querySelectorAll(".pt-legend-item").forEach((li) =>
          li.classList.toggle("on", (li as HTMLElement).dataset.cat === active));
      });
      legend.append(b);
    });
  }

  // Search by name / symbol / number.
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll<HTMLElement>(".pt-cell").forEach((cell) => {
      const el = ELEMENTS.find((e) => cells[e[0]] === cell);
      if (!el) return;
      const hit = !q ||
        el[1].toLowerCase().includes(q) ||
        el[2].toLowerCase().includes(q) ||
        String(el[0]) === q;
      cell.classList.toggle("dim", !hit);
    });
  });

  // Default detail.
  showDetail(ELEMENTS[0]);
}
