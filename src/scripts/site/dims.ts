// Feet-inch-fraction ↔ metric dimensional maths (Construction Master style).
// `evalDims` is pure; `initDims` wires the /site/geometry Dimensions panel.
// All DOM output is textContent — XSS-safe.

export interface DimValue { v: number; dim: number } // v in mm^dim (dim 0 = plain number)

type Tok =
  | { t: "num"; v: number }            // bare number / fraction (unit decided by context)
  | { t: "len"; v: number; inch?: boolean } // explicit length, mm (inch: may follow feet)
  | { t: "ft"; v: number }             // feet — may be followed by bare inches
  | { t: "op"; v: string } | { t: "lp" } | { t: "rp" };

const IN = 25.4, FT = 304.8;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const FRAC = String.raw`(?:[-\s]*(\d+)\s*/\s*(\d+))?`;
const reFeet = new RegExp(`^${NUM}\\s*(?:'|ft\\b|feet\\b|foot\\b)`, "i");
const reInch = new RegExp(`^${NUM}${FRAC}\\s*(?:"|''|in\\b|inch(?:es)?\\b)`, "i");
const reBareFrac = new RegExp(`^(\\d+)\\s*/\\s*(\\d+)\\s*(?:"|''|in\\b)?`, "i");
const reMetric = new RegExp(`^${NUM}\\s*(mm|cm|m|km|yd|yard|yards)\\b`, "i");
const reMixed = new RegExp(`^${NUM}${FRAC}`);

const METRIC: Record<string, number> = { mm: 1, cm: 10, m: 1000, km: 1e6, yd: 914.4, yard: 914.4, yards: 914.4 };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let s = src.replace(/[×x]/gi, "*").replace(/÷/g, "/").replace(/[’‘]/g, "'").replace(/[”“]/g, '"').replace(/−/g, "-").trim();
  let m: RegExpMatchArray | null;
  while (s.length) {
    s = s.replace(/^\s+/, "");
    if (!s) break;
    if ((m = s.match(reFeet))) { toks.push({ t: "ft", v: parseFloat(m[1]) * FT }); s = s.slice(m[0].length); continue; }
    if ((m = s.match(reInch))) {
      const whole = parseFloat(m[1]); const f = m[2] && m[3] ? parseFloat(m[2]) / parseFloat(m[3]) : 0;
      toks.push({ t: "len", v: (whole + f) * IN, inch: true }); s = s.slice(m[0].length); continue;
    }
    if ((m = s.match(reBareFrac))) {
      const v = parseFloat(m[1]) / parseFloat(m[2]);
      toks.push(m[0].trim().endsWith('"') || /in$/i.test(m[0].trim()) ? { t: "len", v: v * IN, inch: true } : { t: "num", v }); s = s.slice(m[0].length); continue;
    }
    if ((m = s.match(reMetric))) { toks.push({ t: "len", v: parseFloat(m[1]) * METRIC[m[2].toLowerCase()] }); s = s.slice(m[0].length); continue; }
    if ((m = s.match(reMixed))) {
      const whole = parseFloat(m[1]); const f = m[2] && m[3] ? parseFloat(m[2]) / parseFloat(m[3]) : 0;
      toks.push({ t: "num", v: whole + f }); s = s.slice(m[0].length); continue;
    }
    const c = s[0];
    if ("+-*/".includes(c)) toks.push({ t: "op", v: c });
    else if (c === "(") toks.push({ t: "lp" });
    else if (c === ")") toks.push({ t: "rp" });
    else throw new Error(`Can't read "${c}"`);
    s = s.slice(1);
  }
  return toks;
}

// bare = what a unitless number means: "mm" | "in" | "ft" | "none"
export function evalDims(src: string, bare: string): DimValue {
  const toks = tokenize(src);
  if (!toks.length) throw new Error("Enter a dimension");
  let p = 0;
  const peek = () => toks[p];
  const bareMm = bare === "in" ? IN : bare === "ft" ? FT : bare === "mm" ? 1 : 0;

  const atom = (): DimValue => {
    const t = toks[p++];
    if (!t) throw new Error("Expression ends early");
    if (t.t === "lp") { const v = expr(); if (peek()?.t !== "rp") throw new Error("Missing )"); p++; return v; }
    if (t.t === "op" && t.v === "-") { const v = atom(); return { v: -v.v, dim: v.dim }; }
    if (t.t === "ft") {
      let v = t.v;
      const n = peek();
      if (n && (n.t === "num" || (n.t === "len" && n.inch))) { v += n.t === "num" ? n.v * IN : n.v; p++; } // 5' 3-1/2 → inches follow feet
      return { v, dim: 1 };
    }
    if (t.t === "len") return { v: t.v, dim: 1 };
    if (t.t === "num") {
      // After * or / a bare number is a multiplier, not a length.
      const prev = toks[p - 2];
      const scalar = prev && prev.t === "op" && (prev.v === "*" || prev.v === "/");
      if (scalar || bareMm === 0) return { v: t.v, dim: 0 };
      return { v: t.v * bareMm, dim: 1 };
    }
    throw new Error("Unexpected " + ("v" in t ? t.v : t.t));
  };
  const term = (): DimValue => {
    let a = atom();
    while (peek()?.t === "op" && ((peek() as { v: string }).v === "*" || (peek() as { v: string }).v === "/")) {
      const op = (toks[p++] as { v: string }).v;
      const b = atom();
      a = op === "*" ? { v: a.v * b.v, dim: a.dim + b.dim } : { v: a.v / b.v, dim: a.dim - b.dim };
    }
    return a;
  };
  const expr = (): DimValue => {
    let a = term();
    while (peek()?.t === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
      const op = (toks[p++] as { v: string }).v;
      const b = term();
      if (a.dim !== b.dim) throw new Error("Can't add a length to an area/volume — check units");
      a = { v: op === "+" ? a.v + b.v : a.v - b.v, dim: a.dim };
    }
    return a;
  };
  const out = expr();
  if (p < toks.length) throw new Error("Unexpected input after the expression");
  if (out.dim < 0 || out.dim > 3) throw new Error("Result isn't a length, area or volume");
  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// 1600.2 mm, denom 16 → 5' 3" (nearest 1/16)
export function fmtFtIn(mm: number, denom = 16): string {
  const sign = mm < 0 ? "-" : "";
  let totalIn = Math.abs(mm) / IN;
  let ft = Math.floor(totalIn / 12);
  let rem = totalIn - ft * 12;
  let whole = Math.floor(rem);
  let num = Math.round((rem - whole) * denom);
  if (num === denom) { whole++; num = 0; }
  if (whole === 12) { ft++; whole = 0; }
  let frac = "";
  if (num) { const g = gcd(num, denom); frac = `${num / g}/${denom / g}`; }
  const inches = whole && frac ? `${whole}-${frac}` : frac || String(whole);
  if (!ft) return `${sign}${inches}"`;
  return `${sign}${ft}' ${inches}"`;
}

export function fmtInFrac(mm: number, denom = 16): string {
  const sign = mm < 0 ? "-" : "";
  const totalIn = Math.abs(mm) / IN;
  let whole = Math.floor(totalIn);
  let num = Math.round((totalIn - whole) * denom);
  if (num === denom) { whole++; num = 0; }
  let frac = "";
  if (num) { const g = gcd(num, denom); frac = `${num / g}/${denom / g}`; }
  return `${sign}${whole && frac ? `${whole}-${frac}` : frac || String(whole)}"`;
}

const f = (n: number, max = 3) => n.toLocaleString("en-AU", { maximumFractionDigits: max });

export function describe(r: DimValue, denom: number): [string, string][] {
  if (r.dim === 0) return [[f(r.v, 6), "number"]];
  if (r.dim === 1) {
    return [
      [f(r.v, 1) + " mm", "millimetres"],
      [f(r.v / 1000, 4) + " m", "metres"],
      [fmtFtIn(r.v, denom), "feet-inches (nearest 1/" + denom + ")"],
      [fmtInFrac(r.v, denom), "inches"],
      [f(r.v / FT, 4) + " ft", "decimal feet"],
      [f(r.v / IN, 3) + " in", "decimal inches"],
    ];
  }
  if (r.dim === 2) {
    return [
      [f(r.v / 1e6, 4) + " m²", "square metres"],
      [f(r.v / (FT * FT), 3) + " ft²", "square feet"],
      [f(r.v / (IN * IN), 2) + " in²", "square inches"],
      [f(r.v / (914.4 * 914.4), 4) + " yd²", "square yards"],
    ];
  }
  return [
    [f(r.v / 1e9, 4) + " m³", "cubic metres"],
    [f(r.v / 1e6, 2) + " L", "litres"],
    [f(r.v / (FT * FT * FT), 3) + " ft³", "cubic feet"],
    [f(r.v / (914.4 ** 3), 4) + " yd³", "cubic yards"],
  ];
}

export function initDims() {
  const input = document.getElementById("dim-expr") as HTMLInputElement | null;
  const bareSel = document.getElementById("dim-bare") as HTMLSelectElement | null;
  const denomSel = document.getElementById("dim-denom") as HTMLSelectElement | null;
  const out = document.getElementById("dim-out");
  const hist = document.getElementById("dim-hist");
  if (!input || !bareSel || !denomSel || !out || !hist) return;

  const tape: string[] = [];
  const render = (commit: boolean) => {
    out.textContent = "";
    const src = input.value.trim();
    if (!src) return;
    try {
      const r = evalDims(src, bareSel.value);
      const grid = document.createElement("div");
      grid.className = "stat-grid";
      const rows = describe(r, parseInt(denomSel.value, 10) || 16);
      for (const [n, l] of rows) {
        const d = document.createElement("div"); d.className = "stat";
        const a = document.createElement("div"); a.className = "n"; a.textContent = n;
        const b = document.createElement("div"); b.className = "l"; b.textContent = l;
        d.append(a, b); grid.append(d);
      }
      out.append(grid);
      if (commit) {
        tape.unshift(`${src} = ${rows[r.dim === 1 ? 2 : 0][0]} = ${rows[0][0]}`);
        if (tape.length > 20) tape.pop();
        hist.textContent = "";
        for (const line of tape) { const li = document.createElement("li"); li.textContent = line; hist.append(li); }
      }
    } catch (e) {
      const p = document.createElement("p"); p.className = "warn"; p.textContent = (e as Error).message; out.append(p);
    }
  };
  input.addEventListener("input", () => render(false));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); render(true); } });
  bareSel.addEventListener("change", () => render(false));
  denomSel.addEventListener("change", () => render(false));
  document.querySelectorAll<HTMLButtonElement>("[data-dim-example]").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.dimExample || ""; render(true); input.focus(); }));
  render(false);
}
