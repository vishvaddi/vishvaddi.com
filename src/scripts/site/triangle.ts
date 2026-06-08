// Triangle solver + trig helper. Sides a,b,c are opposite angles A,B,C.
// Angles are entered/returned in degrees. All output via textContent — XSS-safe.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

interface Tri { a: number; b: number; c: number; A: number; B: number; C: number; }

export interface Solution {
  tri: Tri;            // all six, degrees
  area: number;
  perimeter: number;
  kind: string;
  warn?: string;
}

const known = (x: number) => Number.isFinite(x);

export function solveTriangle(inp: Partial<Tri>): Solution {
  // Work internally in radians for angles.
  const t: Tri = {
    a: inp.a ?? NaN, b: inp.b ?? NaN, c: inp.c ?? NaN,
    A: known(inp.A as number) ? (inp.A as number) * D2R : NaN,
    B: known(inp.B as number) ? (inp.B as number) * D2R : NaN,
    C: known(inp.C as number) ? (inp.C as number) * D2R : NaN,
  };

  const sides = [t.a, t.b, t.c].filter(known).length;
  const angles = [t.A, t.B, t.C].filter(known).length;
  if (sides === 0) throw new Error("Enter at least one side.");
  if (sides + angles < 3) throw new Error("Enter any 3 values (including ≥1 side).");
  if (angles === 3) throw new Error("Three angles don't fix the size — add a side.");

  let warn: string | undefined;

  const ratio = (): number => {
    if (known(t.a) && known(t.A)) return t.a / Math.sin(t.A);
    if (known(t.b) && known(t.B)) return t.b / Math.sin(t.B);
    if (known(t.c) && known(t.C)) return t.c / Math.sin(t.C);
    return NaN;
  };

  for (let pass = 0; pass < 8; pass++) {
    // Angle sum.
    const knownAng = [t.A, t.B, t.C].filter(known).length;
    if (knownAng === 2) {
      const sum = (known(t.A) ? t.A : 0) + (known(t.B) ? t.B : 0) + (known(t.C) ? t.C : 0);
      if (!known(t.A)) t.A = Math.PI - sum;
      else if (!known(t.B)) t.B = Math.PI - sum;
      else if (!known(t.C)) t.C = Math.PI - sum;
    }

    // Law of cosines — SAS (two sides + included angle) → opposite side.
    if (!known(t.a) && known(t.b) && known(t.c) && known(t.A))
      t.a = Math.sqrt(t.b * t.b + t.c * t.c - 2 * t.b * t.c * Math.cos(t.A));
    if (!known(t.b) && known(t.a) && known(t.c) && known(t.B))
      t.b = Math.sqrt(t.a * t.a + t.c * t.c - 2 * t.a * t.c * Math.cos(t.B));
    if (!known(t.c) && known(t.a) && known(t.b) && known(t.C))
      t.c = Math.sqrt(t.a * t.a + t.b * t.b - 2 * t.a * t.b * Math.cos(t.C));

    // Law of cosines — SSS → angles.
    if (known(t.a) && known(t.b) && known(t.c)) {
      if (!known(t.A)) t.A = Math.acos(clamp((t.b * t.b + t.c * t.c - t.a * t.a) / (2 * t.b * t.c)));
      if (!known(t.B)) t.B = Math.acos(clamp((t.a * t.a + t.c * t.c - t.b * t.b) / (2 * t.a * t.c)));
      if (!known(t.C)) t.C = Math.acos(clamp((t.a * t.a + t.b * t.b - t.c * t.c) / (2 * t.a * t.b)));
    }

    // Law of sines.
    const R = ratio();
    if (known(R)) {
      if (!known(t.a) && known(t.A)) t.a = R * Math.sin(t.A);
      if (!known(t.b) && known(t.B)) t.b = R * Math.sin(t.B);
      if (!known(t.c) && known(t.C)) t.c = R * Math.sin(t.C);
      // SSA: side + opposite known, find another angle from its side (ambiguous).
      const findAng = (side: number, ang: keyof Tri) => {
        if (known(side) && !known(t[ang])) {
          const s = side / R;
          if (s > 1.0001) throw new Error("No triangle exists with those values.");
          (t[ang] as number) = Math.asin(clamp(s));
          warn = "Ambiguous (SSA) case — an obtuse alternative for the computed angle may also be valid.";
        }
      };
      findAng(t.a, "A"); findAng(t.b, "B"); findAng(t.c, "C");
    }

    if ([t.a, t.b, t.c, t.A, t.B, t.C].every(known)) break;
  }

  if (![t.a, t.b, t.c, t.A, t.B, t.C].every(known))
    throw new Error("Couldn't solve — check the combination of inputs.");

  // Validate.
  const degSum = (t.A + t.B + t.C) * R2D;
  if (Math.abs(degSum - 180) > 0.5) throw new Error("No valid triangle (angles don't sum to 180°).");
  if (t.a <= 0 || t.b <= 0 || t.c <= 0) throw new Error("No valid triangle (non-positive side).");

  const area = 0.5 * t.a * t.b * Math.sin(t.C);
  const perimeter = t.a + t.b + t.c;

  return {
    tri: { a: t.a, b: t.b, c: t.c, A: t.A * R2D, B: t.B * R2D, C: t.C * R2D },
    area, perimeter, kind: classify(t.a, t.b, t.c, [t.A, t.B, t.C].map(x => x * R2D)), warn,
  };
}

function clamp(x: number): number { return Math.max(-1, Math.min(1, x)); }

function classify(a: number, b: number, c: number, deg: number[]): string {
  const maxA = Math.max(...deg);
  const byAngle = Math.abs(maxA - 90) < 0.5 ? "right" : maxA > 90 ? "obtuse" : "acute";
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-4;
  let bySide = "scalene";
  if (eq(a, b) && eq(b, c)) bySide = "equilateral";
  else if (eq(a, b) || eq(b, c) || eq(a, c)) bySide = "isosceles";
  return `${byAngle}, ${bySide}`;
}

const fmt = (n: number, d = 3) =>
  Number.isFinite(n) ? parseFloat(n.toFixed(d)).toString() : "—";

export function initTriangle() {
  const g = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const ids = ["a", "b", "c", "A", "B", "C"] as const;
  const out = g<HTMLDivElement>("tri-out");
  const solveBtn = g<HTMLButtonElement>("tri-solve");
  const clearBtn = g<HTMLButtonElement>("tri-clear");
  if (!out || !solveBtn) return;

  const read = (id: string): number => {
    const el = g<HTMLInputElement>("tri-" + id);
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : NaN;
  };

  const stat = (val: string, label: string) => {
    const d = document.createElement("div"); d.className = "stat";
    const n = document.createElement("div"); n.className = "n"; n.textContent = val;
    const l = document.createElement("div"); l.className = "l"; l.textContent = label;
    d.append(n, l); return d;
  };

  const solve = () => {
    out.textContent = "";
    try {
      const s = solveTriangle({
        a: read("a"), b: read("b"), c: read("c"),
        A: read("A"), B: read("B"), C: read("C"),
      });
      const grid = document.createElement("div"); grid.className = "stat-grid";
      grid.append(
        stat(fmt(s.tri.a), "side a"), stat(fmt(s.tri.b), "side b"), stat(fmt(s.tri.c), "side c"),
        stat(fmt(s.tri.A) + "°", "angle A"), stat(fmt(s.tri.B) + "°", "angle B"), stat(fmt(s.tri.C) + "°", "angle C"),
        stat(fmt(s.area), "area"), stat(fmt(s.perimeter), "perimeter"), stat(s.kind, "type"),
      );
      out.append(grid);
      // reflect solved values back into the inputs
      (["a", "b", "c"] as const).forEach(k => { g<HTMLInputElement>("tri-" + k).value = fmt(s.tri[k]); });
      (["A", "B", "C"] as const).forEach(k => { g<HTMLInputElement>("tri-" + k).value = fmt(s.tri[k]); });
      if (s.warn) { const w = document.createElement("p"); w.className = "warn"; w.textContent = s.warn; out.append(w); }
    } catch (e) {
      const p = document.createElement("p"); p.className = "warn"; p.textContent = (e as Error).message; out.append(p);
    }
  };

  solveBtn.addEventListener("click", solve);
  clearBtn?.addEventListener("click", () => {
    ids.forEach(id => { g<HTMLInputElement>("tri-" + id).value = ""; });
    out.textContent = "";
  });

  // ── Trig table ──
  const trigIn = g<HTMLInputElement>("trig-angle");
  const trigOut = g<HTMLDivElement>("trig-out");
  const trigMode = g<HTMLButtonElement>("trig-mode");
  if (trigIn && trigOut) {
    let deg = true;
    const run = () => {
      trigOut.textContent = "";
      const raw = parseFloat(trigIn.value);
      if (!Number.isFinite(raw)) return;
      const r = deg ? raw * D2R : raw;
      const rows: [string, number][] = [
        ["sin", Math.sin(r)], ["cos", Math.cos(r)], ["tan", Math.tan(r)],
        ["csc", 1 / Math.sin(r)], ["sec", 1 / Math.cos(r)], ["cot", 1 / Math.tan(r)],
      ];
      const grid = document.createElement("div"); grid.className = "stat-grid";
      for (const [name, v] of rows) grid.append(stat(Math.abs(v) > 1e12 ? "∞" : fmt(v, 6), name));
      trigOut.append(grid);
    };
    trigIn.addEventListener("input", run);
    trigMode?.addEventListener("click", () => { deg = !deg; trigMode.textContent = deg ? "DEG" : "RAD"; run(); });
    run();
  }
}
