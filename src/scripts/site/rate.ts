import { auFmt } from "./calc";

// Generic rate build-up + optional local save. No proprietary rates ship with
// the page; anything you save lives only in THIS browser (localStorage).
const KEY = "vv_rates";
interface Saved { d: string; rate: number }

export function initRate() {
  const g = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const ids = ["r-desc", "r-mat", "r-hrs", "r-lrate", "r-plant", "r-markup", "r-qty"] as const;
  const f: Record<string, HTMLInputElement | null> = {};
  for (const id of ids) f[id] = g<HTMLInputElement>(id);
  const out = g<HTMLDivElement>("r-out");
  const savedEl = g<HTMLDivElement>("r-saved");
  if (!out || !savedEl) return;

  const n = (id: string) => {
    const v = parseFloat(f[id]?.value ?? "");
    return Number.isFinite(v) ? v : 0;
  };
  const calc = () => {
    const cost = n("r-mat") + n("r-hrs") * n("r-lrate") + n("r-plant");
    const rate = cost * (1 + n("r-markup") / 100);
    const qty = Math.max(0, n("r-qty"));
    return { cost, rate, qty, line: rate * qty };
  };
  const stat = (val: string, label: string) => {
    const d = document.createElement("div");
    d.className = "stat";
    const a = document.createElement("div"); a.className = "n"; a.textContent = val;
    const b = document.createElement("div"); b.className = "l"; b.textContent = label;
    d.append(a, b);
    return d;
  };
  const render = () => {
    const { cost, rate, qty, line } = calc();
    out.textContent = "";
    const grid = document.createElement("div");
    grid.className = "stat-grid";
    grid.append(stat("$" + auFmt(cost), "build-up cost"), stat("$" + auFmt(rate), "unit rate"));
    if (qty > 0) grid.append(stat(auFmt(qty), "qty"), stat("$" + auFmt(line), "line total"));
    out.append(grid);
  };

  const load = (): Saved[] => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  };
  const save = (list: Saved[]) => localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300)));
  const renderSaved = () => {
    const list = load();
    savedEl.textContent = "";
    if (!list.length) {
      savedEl.textContent = "No saved rates yet — saved rates stay only on this device.";
      savedEl.style.color = "var(--muted)";
      return;
    }
    savedEl.style.color = "";
    list.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "saved-row";
      const t = document.createElement("span");
      t.textContent = `${s.d} — $${auFmt(s.rate)}`;
      const del = document.createElement("button");
      del.className = "btn btn-ghost btn-sm no-print";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete saved rate");
      del.addEventListener("click", () => { const l = load(); l.splice(i, 1); save(l); renderSaved(); });
      row.append(t, del);
      savedEl.append(row);
    });
  };

  g<HTMLButtonElement>("r-save")?.addEventListener("click", () => {
    const { rate } = calc();
    if (rate <= 0) return;
    const d = (f["r-desc"]?.value || "Rate").trim().slice(0, 60);
    const l = load();
    l.unshift({ d, rate });
    save(l);
    renderSaved();
  });
  g<HTMLButtonElement>("r-export")?.addEventListener("click", () => {
    const body = ["My rates — vishvaddi.com/site/rate", "", ...load().map((s) => `${s.d}: $${auFmt(s.rate)}`)].join("\n");
    location.href = `mailto:?subject=${encodeURIComponent("My rates")}&body=${encodeURIComponent(body)}`;
  });
  g<HTMLButtonElement>("r-clear")?.addEventListener("click", () => {
    if (confirm("Delete all saved rates from this device?")) { save([]); renderSaved(); }
  });

  Object.values(f).forEach((el) => el?.addEventListener("input", render));
  render();
  renderSaved();
}
