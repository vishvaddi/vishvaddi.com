import { auFmt } from "./calc";

// Line-item rate build-up. Add as many lines as you like; pick each line's type
// from a dropdown. No proprietary rates ship here; saved rates live only in
// THIS browser (localStorage).
const KEY = "vv_rates";
const TYPES = ["Material", "Labour", "Plant", "Subcontract", "Other"];
interface Saved { d: string; rate: number }

export function initRate() {
  const linesEl = document.getElementById("r-lines");
  const out = document.getElementById("r-out");
  const savedEl = document.getElementById("r-saved");
  const marginEl = document.getElementById("r-margin") as HTMLInputElement | null;
  const descEl = document.getElementById("r-desc") as HTMLInputElement | null;
  if (!linesEl || !out || !savedEl || !marginEl) return;

  const num = (el: Element | null) => {
    const v = parseFloat((el as HTMLInputElement)?.value ?? "");
    return Number.isFinite(v) ? v : 0;
  };
  const field = (label: string, el: HTMLElement) => {
    const f = document.createElement("div");
    f.className = "field";
    const l = document.createElement("label");
    l.textContent = label;
    f.append(l, el);
    return f;
  };
  const mkInput = (type: string, cls: string, ph = "", attrs: Record<string, string> = {}) => {
    const i = document.createElement("input");
    i.type = type;
    i.className = cls;
    if (ph) i.placeholder = ph;
    if (type === "number") i.inputMode = "decimal";
    for (const k in attrs) i.setAttribute(k, attrs[k]);
    return i;
  };

  function addLine(type = "Material", desc = "", qty = "1", cost = "0") {
    const row = document.createElement("div");
    row.className = "row-grid";
    row.style.gridTemplateColumns = "auto 1.3fr 0.8fr 0.9fr auto";

    const sel = document.createElement("select");
    sel.className = "r-type";
    TYPES.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; sel.append(o); });
    sel.value = type;

    const d = mkInput("text", "r-d", "Detail"); d.value = desc;
    const q = mkInput("number", "r-qty", "", { min: "0", step: "0.25" }); q.value = qty;
    const c = mkInput("number", "r-cost", "", { min: "0", step: "0.01" }); c.value = cost;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost btn-sm no-print";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Remove line");
    del.addEventListener("click", () => { row.remove(); render(); });

    row.append(field("Type", sel), field("Description", d), field("Qty / hrs", q), field("Unit $", c), del);
    row.addEventListener("input", render);
    linesEl!.append(row);
  }

  function readLines() {
    return [...linesEl!.querySelectorAll(".row-grid")].map((r) => ({
      qty: num(r.querySelector(".r-qty")),
      cost: num(r.querySelector(".r-cost")),
    }));
  }
  function calc() {
    const sub = readLines().reduce((s, l) => s + l.qty * l.cost, 0);
    const m = num(marginEl);
    return { sub, m, rate: sub * (1 + m / 100) };
  }
  const stat = (val: string, label: string) => {
    const d = document.createElement("div");
    d.className = "stat";
    const a = document.createElement("div"); a.className = "n"; a.textContent = val;
    const b = document.createElement("div"); b.className = "l"; b.textContent = label;
    d.append(a, b);
    return d;
  };
  function render() {
    const { sub, m, rate } = calc();
    out!.textContent = "";
    const grid = document.createElement("div");
    grid.className = "stat-grid";
    grid.append(stat("$" + auFmt(sub), "subtotal"), stat(auFmt(m) + "%", "margin"), stat("$" + auFmt(rate), "unit rate"));
    out!.append(grid);
  }

  const load = (): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (l: Saved[]) => localStorage.setItem(KEY, JSON.stringify(l.slice(0, 300)));
  function renderSaved() {
    const list = load();
    savedEl!.textContent = "";
    if (!list.length) { savedEl!.textContent = "No saved rates yet — saved rates stay only on this device."; savedEl!.style.color = "var(--muted)"; return; }
    savedEl!.style.color = "";
    list.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "saved-row";
      const t = document.createElement("span"); t.textContent = `${s.d} — $${auFmt(s.rate)}`;
      const del = document.createElement("button");
      del.className = "btn btn-ghost btn-sm no-print"; del.textContent = "✕"; del.setAttribute("aria-label", "Delete");
      del.addEventListener("click", () => { const l = load(); l.splice(i, 1); save(l); renderSaved(); });
      row.append(t, del);
      savedEl!.append(row);
    });
  }

  document.getElementById("r-addline")?.addEventListener("click", () => { addLine(); render(); });
  document.getElementById("r-save")?.addEventListener("click", () => {
    const { rate } = calc();
    if (rate <= 0) return;
    const d = (descEl?.value || "Rate").trim().slice(0, 60);
    const l = load(); l.unshift({ d, rate }); save(l); renderSaved();
  });
  document.getElementById("r-export")?.addEventListener("click", () => {
    const body = ["My rates — vishvaddi.com/site/rate", "", ...load().map((s) => `${s.d}: $${auFmt(s.rate)}`)].join("\n");
    location.href = `mailto:?subject=${encodeURIComponent("My rates")}&body=${encodeURIComponent(body)}`;
  });
  document.getElementById("r-clear")?.addEventListener("click", () => {
    if (confirm("Delete all saved rates from this device?")) { save([]); renderSaved(); }
  });
  marginEl.addEventListener("input", render);

  // sensible starting lines
  addLine("Material", "", "1", "40");
  addLine("Labour", "", "1.5", "65");
  render();
  renderSaved();
}
