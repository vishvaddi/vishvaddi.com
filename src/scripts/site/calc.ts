// Tiny declarative calculator framework for the /site tool pages.
// Each calc is a spec; we render a form + live result. All output is set via
// textContent (no innerHTML of computed/user data) — XSS-safe by construction.

export interface Field {
  id: string;
  label: string;
  def?: string;
  step?: string;
  min?: string;
}
export interface CalcOutput {
  rows: [value: string, label: string][];
  warn?: string;
}
export interface CalcSpec {
  id: string;
  title: string;
  blurb?: string;
  fields: Field[];
  compute: (v: Record<string, number>) => CalcOutput | null;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function mountCalcs(root: HTMLElement, specs: CalcSpec[]) {
  for (const spec of specs) {
    const sec = document.createElement("section");
    sec.className = "calc";

    const h = document.createElement("h2");
    h.textContent = spec.title;
    sec.append(h);

    if (spec.blurb) {
      const p = document.createElement("p");
      p.className = "calc-blurb";
      p.textContent = spec.blurb;
      sec.append(p);
    }

    const fields = document.createElement("div");
    fields.className = "calc-fields";
    const inputs: Record<string, HTMLInputElement> = {};
    for (const f of spec.fields) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      const id = `${spec.id}-${f.id}`;
      label.htmlFor = id;
      label.textContent = f.label;
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "decimal";
      input.id = id;
      if (f.step) input.step = f.step;
      if (f.min !== undefined) input.min = f.min;
      if (f.def !== undefined) input.value = f.def;
      inputs[f.id] = input;
      wrap.append(label, input);
      fields.append(wrap);
    }
    sec.append(fields);

    const result = document.createElement("div");
    result.className = "result calc-result";
    result.setAttribute("aria-live", "polite");
    sec.append(result);

    const run = () => {
      const vals: Record<string, number> = {};
      for (const f of spec.fields) vals[f.id] = num(inputs[f.id].value);
      const o = spec.compute(vals);
      result.textContent = "";
      if (!o) return;
      const grid = document.createElement("div");
      grid.className = "stat-grid";
      for (const [n, l] of o.rows) {
        const d = document.createElement("div");
        d.className = "stat";
        const a = document.createElement("div");
        a.className = "n";
        a.textContent = n;
        const b = document.createElement("div");
        b.className = "l";
        b.textContent = l;
        d.append(a, b);
        grid.append(d);
      }
      result.append(grid);
      if (o.warn) {
        const w = document.createElement("p");
        w.className = "warn";
        w.textContent = o.warn;
        result.append(w);
      }
    };

    fields.addEventListener("input", run);
    root.append(sec);
    run();
  }
}

// ── Unit converter ──────────────────────────────────────────────────────────
// Kept in this shared module (not the convert page) so Astro bundles it to an
// external /_astro chunk — the strict CSP only allows 'self' scripts, never
// inlined ones.

const UNITS: Record<string, Record<string, number>> = {
  Length: { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8, yd: 914.4 },
  Area: {
    "mm²": 1e-6, "cm²": 1e-4, "m²": 1, ha: 1e4,
    "ft²": 0.09290304, "yd²": 0.83612736, acre: 4046.8564224,
  },
  Volume: {
    mL: 0.001, L: 1, "m³": 1000,
    "ft³": 28.316846592, "gal US": 3.785411784, "gal UK": 4.54609,
  },
};

const cfmt = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-AU", { maximumFractionDigits: 6 }) : "—";

export function initConverter() {
  const g = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const catEl = g<HTMLSelectElement>("cat");
  const valEl = g<HTMLInputElement>("val");
  const fromEl = g<HTMLSelectElement>("from");
  const toEl = g<HTMLSelectElement>("to");
  const outEl = g<HTMLDivElement>("out");
  if (!catEl || !valEl || !fromEl || !toEl || !outEl) return;

  const fill = () => {
    const units = Object.keys(UNITS[catEl.value]);
    for (const sel of [fromEl, toEl]) {
      sel.textContent = "";
      for (const u of units) {
        const o = document.createElement("option");
        o.value = u;
        o.textContent = u;
        sel.append(o);
      }
    }
    fromEl.selectedIndex = 0;
    toEl.selectedIndex = Math.min(1, units.length - 1);
  };

  const convert = () => {
    const table = UNITS[catEl.value];
    const v = parseFloat(valEl.value);
    const from = table[fromEl.value];
    const to = table[toEl.value];
    if (!Number.isFinite(v) || !from || !to) {
      outEl.textContent = "—";
      return;
    }
    outEl.textContent = `${cfmt(v)} ${fromEl.value} = ${cfmt((v * from) / to)} ${toEl.value}`;
  };

  for (const c of Object.keys(UNITS)) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    catEl.append(o);
  }
  catEl.addEventListener("change", () => { fill(); convert(); });
  [valEl, fromEl, toEl].forEach((el) => el.addEventListener("input", convert));
  g<HTMLButtonElement>("swap").addEventListener("click", () => {
    const a = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = a;
    convert();
  });

  fill();
  convert();
}
