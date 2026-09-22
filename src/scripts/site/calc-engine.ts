// Shared expression engine behind the Calculator and Calculation Notepad.
// Two evaluators live here: `evaluate()` is the original SpeedCrunch-style
// single-expression engine (functions, constants, ans, deg/rad) unchanged
// from calculator.ts, used verbatim by the Calculator page. `evaluatePad()`
// is a line-based evaluator for the Notepad with units, currency, percent
// and GST idioms, variables with spaces and running totals. They are kept
// as separate grammars (rather than one generic value-typed parser) so the
// Calculator's numeric behaviour can't regress — they share constants,
// factorial and the general recursive-descent shape. All output is
// text/values only; DOM rendering stays in calculator.ts / notepad.ts.

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export const CONSTS: Record<string, number> = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

export function factorial(n: number): number {
  if (n < 0 || !Number.isFinite(n)) return NaN;
  const k = Math.round(n);
  if (Math.abs(n - k) > 1e-9) return NaN; // only integer factorials
  let r = 1;
  for (let i = 2; i <= k; i++) r *= i;
  return r;
}

// ---------------------------------------------------------------------------
// Calculator: single-expression evaluator (identical behaviour to the
// pre-merge calculator.ts — functions, constants, user variables, ans,
// factorial, deg/rad power and modulo).
// ---------------------------------------------------------------------------

type TokType = "num" | "id" | "op" | "lp" | "rp" | "comma";
interface Tok { t: TokType; v: string; }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) => /[a-zA-Z_]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && isDigit(src[j])) j++;
      }
      toks.push({ t: "num", v: src.slice(i, j) });
      i = j;
    } else if (isAlpha(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else if ("+-*/%^!,=".includes(c)) {
      toks.push({ t: c === "," ? "comma" : "op", v: c });
      i++;
    } else if (c === "(") { toks.push({ t: "lp", v: c }); i++; }
    else if (c === ")") { toks.push({ t: "rp", v: c }); i++; }
    else throw new Error(`Unexpected character "${c}"`);
  }
  return toks;
}

export interface EvalResult { value: number; assigned?: string; }

export function evaluate(src: string, vars: Record<string, number>, deg: boolean): EvalResult {
  const toks = tokenize(src);
  if (!toks.length) throw new Error("Empty expression");
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  // Detect assignment:  identifier '=' expr
  let assigned: string | undefined;
  if (toks.length >= 2 && toks[0].t === "id" && toks[1].t === "op" && toks[1].v === "=") {
    assigned = toks[0].v;
    if (assigned in CONSTS) throw new Error(`Cannot reassign constant "${assigned}"`);
    pos = 2;
  }

  const d2r = (x: number) => (deg ? (x * Math.PI) / 180 : x);
  const r2d = (x: number) => (deg ? (x * 180) / Math.PI : x);

  const FUNCS: Record<string, (args: number[]) => number> = {
    sin: a => Math.sin(d2r(a[0])), cos: a => Math.cos(d2r(a[0])), tan: a => Math.tan(d2r(a[0])),
    asin: a => r2d(Math.asin(a[0])), acos: a => r2d(Math.acos(a[0])), atan: a => r2d(Math.atan(a[0])),
    atan2: a => r2d(Math.atan2(a[0], a[1])),
    sinh: a => Math.sinh(a[0]), cosh: a => Math.cosh(a[0]), tanh: a => Math.tanh(a[0]),
    ln: a => Math.log(a[0]), log: a => Math.log10(a[0]), log2: a => Math.log2(a[0]),
    sqrt: a => Math.sqrt(a[0]), cbrt: a => Math.cbrt(a[0]), exp: a => Math.exp(a[0]),
    abs: a => Math.abs(a[0]), sign: a => Math.sign(a[0]),
    round: a => Math.round(a[0]), floor: a => Math.floor(a[0]), ceil: a => Math.ceil(a[0]),
    pow: a => Math.pow(a[0], a[1]), hypot: a => Math.hypot(...a),
    min: a => Math.min(...a), max: a => Math.max(...a), fact: a => factorial(a[0]),
  };

  function parseExpr(): number { // + -
    let v = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number { // * / %
    let v = parseFactor();
    while (peek() && peek().t === "op" && "*/%".includes(peek().v)) {
      const op = next().v;
      const r = parseFactor();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function parseFactor(): number { // ^ (right assoc)
    const base = parseUnary();
    if (peek() && peek().t === "op" && peek().v === "^") {
      next();
      return Math.pow(base, parseFactor());
    }
    return base;
  }
  function parseUnary(): number {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = next().v;
      const v = parseUnary();
      return op === "-" ? -v : v;
    }
    return parsePostfix();
  }
  function parsePostfix(): number {
    let v = parsePrimary();
    while (peek() && peek().t === "op" && peek().v === "!") { next(); v = factorial(v); }
    return v;
  }
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") { next(); return parseFloat(t.v); }
    if (t.t === "lp") {
      next();
      const v = parseExpr();
      if (!peek() || peek().t !== "rp") throw new Error("Missing )");
      next();
      return v;
    }
    if (t.t === "id") {
      next();
      const name = t.v;
      if (peek() && peek().t === "lp") {
        next();
        const args: number[] = [];
        if (peek() && peek().t !== "rp") {
          args.push(parseExpr());
          while (peek() && peek().t === "comma") { next(); args.push(parseExpr()); }
        }
        if (!peek() || peek().t !== "rp") throw new Error(`Missing ) after ${name}(`);
        next();
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${name}"`);
        return fn(args);
      }
      if (name in CONSTS) return CONSTS[name];
      if (name === "ans") return vars.ans ?? 0;
      if (name in vars) return vars[name];
      throw new Error(`Unknown name "${name}"`);
    }
    throw new Error(`Unexpected "${t.v}"`);
  }

  const value = parseExpr();
  if (pos < toks.length) throw new Error(`Unexpected "${toks[pos].v}"`);
  if (!Number.isFinite(value) && !Number.isNaN(value)) throw new Error("Result is infinite");
  return { value, assigned };
}

// ---------------------------------------------------------------------------
// Notepad: line-based pad evaluator with units, currency and GST idioms.
// ---------------------------------------------------------------------------

export interface PadLine {
  text: string;
  kind: "result" | "comment" | "label" | "blank" | "error" | "total";
  display: string;
  value?: number;
  unit?: string;
  currency?: boolean;
  error?: string;
}

interface Value {
  n: number;
  unit?: string;
  currency?: boolean;
  /** came from a bare "10%" literal — triggers proportional +/- semantics */
  pctSrc?: boolean;
  /** format as a percentage (from "x as % of y") */
  pctDisplay?: boolean;
  /** n is a day-index — whole days since 1970-01-01 UTC, calendar date only */
  isDate?: boolean;
  /** produced by date - date; keeps both operands so "in wd" can recompute as working days */
  dateDiff?: boolean;
  diffA?: number;
  diffB?: number;
}

const LENGTH: Record<string, number> = { mm: 1, cm: 10, m: 1000, km: 1e6, lm: 1000 };
const MASS: Record<string, number> = { kg: 1, t: 1000 };
const TIMEU: Record<string, number> = { min: 1, hr: 60 };

// -- date maths: represent a calendar date as an integer day-index (days since
// the Unix epoch, UTC) so add/subtract is plain integer arithmetic with no
// timezone or DST drift; only construction (from local "today") and display
// touch a real Date object. --
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function dayIndexUTC(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function formatDate(idx: number): string {
  const d = new Date(idx * 86400000);
  return `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function dateToISO(idx: number): string {
  const d = new Date(idx * 86400000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
// epoch day 0 (1970-01-01) was a Thursday, hence the +4 offset; 0=Sun..6=Sat
function dayOfWeek(idx: number): number {
  const m = (idx + 4) % 7;
  return m < 0 ? m + 7 : m;
}
function isWeekendIdx(idx: number): boolean {
  const dow = dayOfWeek(idx);
  return dow === 0 || dow === 6;
}
function addWorkingDays(startIdx: number, n: number): number {
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.round(n));
  let idx = startIdx;
  while (remaining > 0) {
    idx += step;
    if (!isWeekendIdx(idx)) remaining--;
  }
  return idx;
}
// working days strictly between two day-indexes (fromIdx, toIdx] — signed so
// it inverts cleanly: countWorkingDays(a, addWorkingDays(a, n)) === n
function countWorkingDays(fromIdx: number, toIdx: number): number {
  const step = toIdx >= fromIdx ? 1 : -1;
  let idx = fromIdx;
  let count = 0;
  while (idx !== toIdx) {
    idx += step;
    if (!isWeekendIdx(idx)) count++;
  }
  return step > 0 ? count : -count;
}

function familyOf(u?: string): string {
  if (!u) return "none";
  if (u in LENGTH) return "length";
  if (u in MASS) return "mass";
  if (u in TIMEU) return "time";
  return u; // m2, m3, ea, L are their own singleton families
}
function factorOf(u: string): number {
  return LENGTH[u] ?? MASS[u] ?? TIMEU[u] ?? 1;
}
function isLengthUnit(u?: string): boolean {
  return !!u && u in LENGTH;
}

function convertTo(v: Value, target: string): Value {
  if (v.dateDiff && target === "wd") return { n: countWorkingDays(v.diffB!, v.diffA!), unit: "wd" };
  if (!v.unit) throw new Error(`Can't convert a plain number to ${target}`);
  if (v.unit === target) return v;
  if (familyOf(v.unit) !== familyOf(target)) throw new Error(`Can't convert ${v.unit} to ${target}`);
  const base = v.n * factorOf(v.unit);
  return { ...v, n: base / factorOf(target), unit: target };
}

function addDateValue(a: Value, b: Value): Value {
  const [d, other] = a.isDate ? [a, b] : [b, a];
  if (other.isDate) throw new Error("Can't add two dates");
  if (other.unit === "wd") return { n: addWorkingDays(d.n, other.n), isDate: true };
  if (!other.unit || other.unit === "days") return { n: d.n + Math.round(other.n), isDate: true };
  throw new Error(`Can't add ${other.unit} to a date`);
}

function addValues(a: Value, b: Value): Value {
  if (a.isDate || b.isDate) return addDateValue(a, b);
  const currency = (a.currency || b.currency) || undefined;
  if (a.unit === b.unit) return { n: a.n + b.n, unit: a.unit, currency };
  if (a.unit && b.unit) {
    const fa = familyOf(a.unit), fb = familyOf(b.unit);
    if (fa === fb && fa !== "none") {
      const base = a.n * factorOf(a.unit) + b.n * factorOf(b.unit);
      const target = factorOf(a.unit) >= factorOf(b.unit) ? a.unit : b.unit;
      return { n: base / factorOf(target), unit: target, currency };
    }
    throw new Error(`Can't combine ${a.unit} and ${b.unit}`);
  }
  return { n: a.n + b.n, unit: a.unit || b.unit, currency };
}
function subtractValues(a: Value, b: Value): Value {
  if (a.isDate && b.isDate) return { n: a.n - b.n, unit: "days", dateDiff: true, diffA: a.n, diffB: b.n };
  if (a.isDate) {
    if (b.unit === "wd") return { n: addWorkingDays(a.n, -b.n), isDate: true };
    if (!b.unit || b.unit === "days") return { n: a.n - Math.round(b.n), isDate: true };
    throw new Error(`Can't subtract ${b.unit} from a date`);
  }
  if (b.isDate) throw new Error("Can't subtract a date from a number");
  const currency = (a.currency || b.currency) || undefined;
  if (a.unit === b.unit) return { n: a.n - b.n, unit: a.unit, currency };
  if (a.unit && b.unit) {
    const fa = familyOf(a.unit), fb = familyOf(b.unit);
    if (fa === fb && fa !== "none") {
      const base = a.n * factorOf(a.unit) - b.n * factorOf(b.unit);
      const target = factorOf(a.unit) >= factorOf(b.unit) ? a.unit : b.unit;
      return { n: base / factorOf(target), unit: target, currency };
    }
    throw new Error(`Can't combine ${a.unit} and ${b.unit}`);
  }
  return { n: a.n - b.n, unit: a.unit || b.unit, currency };
}
function multiplyValues(a: Value, b: Value): Value {
  if (a.pctSrc && !a.unit && !a.currency) return { n: a.n * b.n, unit: b.unit, currency: b.currency };
  if (b.pctSrc && !b.unit && !b.currency) return { n: a.n * b.n, unit: a.unit, currency: a.currency };
  if (a.currency || b.currency) return { n: a.n * b.n, currency: true };
  if (isLengthUnit(a.unit) && isLengthUnit(b.unit)) {
    const am = (a.n * factorOf(a.unit!)) / 1000, bm = (b.n * factorOf(b.unit!)) / 1000;
    return { n: am * bm, unit: "m2" };
  }
  if (a.unit === "m2" && isLengthUnit(b.unit)) return { n: a.n * ((b.n * factorOf(b.unit!)) / 1000), unit: "m3" };
  if (b.unit === "m2" && isLengthUnit(a.unit)) return { n: b.n * ((a.n * factorOf(a.unit!)) / 1000), unit: "m3" };
  if (a.unit && !b.unit) return { n: a.n * b.n, unit: a.unit };
  if (b.unit && !a.unit) return { n: a.n * b.n, unit: b.unit };
  return { n: a.n * b.n };
}
function divideValues(a: Value, b: Value): Value {
  if (a.currency && b.currency) return { n: a.n / b.n };
  if (!b.unit) return { n: a.n / b.n, unit: a.unit, currency: a.currency };
  if (a.unit === "m3" && isLengthUnit(b.unit)) return { n: a.n / ((b.n * factorOf(b.unit)) / 1000), unit: "m2" };
  if (a.unit === "m2" && isLengthUnit(b.unit)) return { n: a.n / ((b.n * factorOf(b.unit)) / 1000), unit: "m" };
  if (a.unit === "m3" && b.unit === "m2") return { n: a.n / b.n, unit: "m" };
  if (a.unit && familyOf(a.unit) === familyOf(b.unit) && familyOf(a.unit) !== "none") {
    return { n: (a.n * factorOf(a.unit)) / (b.n * factorOf(b.unit)) };
  }
  return { n: a.n / b.n };
}
function rateMultiply(a: Value, b: Value): Value {
  return { n: a.n * b.n, currency: (a.currency || b.currency) || undefined };
}

function clean(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1e9) / 1e9;
}

function formatValue(v: Value): string {
  if (v.isDate) return formatDate(v.n);
  const n = clean(v.n);
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  if (v.pctDisplay) return `${clean(n * 100).toLocaleString("en-AU", { maximumFractionDigits: 4 })}%`;
  const maxDp = v.currency ? 2 : 4;
  const body = n.toLocaleString("en-AU", { maximumFractionDigits: maxDp });
  if (v.currency) return `$${body}`;
  if (v.unit) return `${body} ${v.unit}`;
  return body;
}

function valueToLiteral(v: Value): string {
  if (v.isDate) return dateToISO(v.n);
  const n = clean(v.n);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (v.currency) return `${sign}$${abs}`;
  if (v.pctDisplay || v.pctSrc) return `${sign}${clean(abs * 100)}%`;
  if (v.unit) return `${sign}${abs}${v.unit}`;
  return `${sign}${abs}`;
}

// -- unit words, longest match first, so "sqm" beats "m" and "m2" beats "m" --
const UNIT_MATCH_LIST: [string, string][] = [
  ["business days", "wd"], ["working days", "wd"],
  ["sqm", "m2"], ["cum", "m3"], ["hrs", "hr"], ["min", "min"],
  ["m²", "m2"], ["m³", "m3"], ["mm", "mm"], ["cm", "cm"], ["km", "km"],
  ["lm", "lm"], ["kg", "kg"], ["m2", "m2"], ["m3", "m3"], ["hr", "hr"], ["ea", "ea"],
  ["days", "days"], ["day", "days"], ["wd", "wd"],
  ["t", "t"], ["m", "m"], ["l", "L"],
];
const UNIT_WORD_MAP = new Map(UNIT_MATCH_LIST.map(([text, canon]) => [text, canon]));
function canonicalUnit(word: string): string | undefined {
  return UNIT_WORD_MAP.get(word.toLowerCase());
}
function matchUnit(src: string, pos: number): { symbol: string; end: number } | null {
  for (const [text, canon] of UNIT_MATCH_LIST) {
    if (src.slice(pos, pos + text.length).toLowerCase() === text) {
      const after = src[pos + text.length];
      if (after === undefined || !/[a-zA-Z0-9_]/.test(after)) return { symbol: canon, end: pos + text.length };
    }
  }
  return null;
}

type PTokType = "num" | "id" | "op" | "lp" | "rp";
interface PTok { t: PTokType; v: string; value?: Value }

function scanNumber(src: string, start: number, currency: boolean): { value: Value; end: number } {
  const isDigit = (c: string) => c >= "0" && c <= "9";
  let j = start;
  while (j < src.length && (isDigit(src[j]) || src[j] === ",")) j++;
  if (src[j] === "." && isDigit(src[j + 1])) {
    j++;
    while (j < src.length && isDigit(src[j])) j++;
  }
  const raw = src.slice(start, j).replace(/,/g, "");
  const n = parseFloat(raw);
  if (Number.isNaN(n)) throw new Error("Bad number");
  if (src[j] === "k" || src[j] === "K") {
    return { value: { n: n * 1000, currency: currency || undefined }, end: j + 1 };
  }
  if (src[j] === "%") {
    return { value: { n: n / 100, pctSrc: true }, end: j + 1 };
  }
  let k2 = j;
  if (src[k2] === " ") k2++;
  const unitMatch = matchUnit(src, k2);
  if (unitMatch) return { value: { n, unit: unitMatch.symbol, currency: currency || undefined }, end: unitMatch.end };
  return { value: { n, currency: currency || undefined }, end: j };
}

function tryScanDate(src: string, i: number): { value: Value; end: number } | null {
  const rest = src.slice(i);
  const boundaryOk = (end: number) => {
    const after = src[end];
    return after === undefined || !/[a-zA-Z0-9_]/.test(after);
  };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(rest);
  if (iso) {
    const end = i + iso[0].length;
    const m = +iso[2], d = +iso[3];
    if (boundaryOk(end) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { value: { n: dayIndexUTC(+iso[1], m, d), isDate: true }, end };
    }
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(rest);
  if (slash) {
    const end = i + slash[0].length;
    const d = +slash[1], m = +slash[2];
    if (boundaryOk(end) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { value: { n: dayIndexUTC(+slash[3], m, d), isDate: true }, end };
    }
  }
  // Australian "1 Oct 2026" / "1 October 2026"
  const named = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(rest);
  if (named) {
    const mon = MONTH_INDEX[named[2].slice(0, 3).toLowerCase()];
    const end = i + named[0].length;
    if (mon && boundaryOk(end) && +named[1] >= 1 && +named[1] <= 31) {
      return { value: { n: dayIndexUTC(+named[3], mon, +named[1]), isDate: true }, end };
    }
  }
  return null;
}

function tokenizePad(src: string): PTok[] {
  const toks: PTok[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) => /[a-zA-Z]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "$" && isDigit(src[i + 1])) {
      const { value, end } = scanNumber(src, i + 1, true);
      toks.push({ t: "num", v: "", value });
      i = end;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      const dateTok = isDigit(c) ? tryScanDate(src, i) : null;
      if (dateTok) {
        toks.push({ t: "num", v: "", value: dateTok.value });
        i = dateTok.end;
        continue;
      }
      const { value, end } = scanNumber(src, i, false);
      toks.push({ t: "num", v: "", value });
      i = end;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const lw = word.toLowerCase();
      if (lw === "today" || lw === "tomorrow") {
        const now = new Date();
        let idx = dayIndexUTC(now.getFullYear(), now.getMonth() + 1, now.getDate());
        if (lw === "tomorrow") idx += 1;
        toks.push({ t: "num", v: "", value: { n: idx, isDate: true } });
        i = j;
        continue;
      }
      toks.push({ t: "id", v: word });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", v: c }); i++; continue; }
    if (c === "×") { toks.push({ t: "op", v: "*" }); i++; continue; }
    if (c === "÷") { toks.push({ t: "op", v: "/" }); i++; continue; }
    if ("+-*/^!@".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return toks;
}

function parsePadExpr(text: string, opts: { allowTrailingLabel?: boolean } = {}): Value {
  const toks = tokenizePad(text);
  if (!toks.length) throw new Error("Empty expression");
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): Value {
    let v = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const r = parseTerm();
      if (op === "+") {
        v = r.pctSrc && !r.unit && !r.currency ? { n: v.n * (1 + r.n), unit: v.unit, currency: v.currency } : addValues(v, r);
      } else {
        v = r.pctSrc && !r.unit && !r.currency ? { n: v.n * (1 - r.n), unit: v.unit, currency: v.currency } : subtractValues(v, r);
      }
    }
    return v;
  }
  function parseTerm(): Value {
    let v = parseFactor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/" || peek().v === "@")) {
      const op = next().v;
      const r = parseFactor();
      v = op === "*" ? multiplyValues(v, r) : op === "/" ? divideValues(v, r) : rateMultiply(v, r);
    }
    return v;
  }
  function parseFactor(): Value {
    const base = parseUnary();
    if (peek() && peek().t === "op" && peek().v === "^") {
      next();
      const exp = parseFactor();
      return { n: Math.pow(base.n, exp.n) };
    }
    return base;
  }
  function parseUnary(): Value {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = next().v;
      const v = parseUnary();
      return op === "-" ? { ...v, n: -v.n } : v;
    }
    return parsePostfix();
  }
  function parsePostfix(): Value {
    let v = parsePrimary();
    while (peek() && peek().t === "op" && peek().v === "!") { next(); v = { n: factorial(v.n) }; }
    return v;
  }
  function parsePrimary(): Value {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") { next(); return t.value!; }
    if (t.t === "lp") {
      next();
      const v = parseExpr();
      if (!peek() || peek().t !== "rp") throw new Error("Missing )");
      next();
      return v;
    }
    if (t.t === "id") throw new Error(`Unknown word "${t.v}"`);
    throw new Error(`Unexpected "${t.v}"`);
  }

  const value = parseExpr();
  if (pos < toks.length) {
    if (opts.allowTrailingLabel && toks.slice(pos).every((tk) => tk.t === "id")) return value;
    throw new Error(`Unexpected "${toks[pos].v}"`);
  }
  return value;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function substituteAll(
  text: string,
  vars: Map<string, Value>,
  names: string[],
  ans: Value | undefined,
  lineValues: (Value | undefined)[],
): string {
  let out = text;
  out = out.replace(/\bline\s+(\d+)\b/gi, (_m, d: string) => {
    const v = lineValues[parseInt(d, 10)];
    if (!v) throw new Error(`Line ${d} has no result`);
    return valueToLiteral(v);
  });
  out = out.replace(/\bL(\d+)\b/g, (_m, d: string) => {
    const v = lineValues[parseInt(d, 10)];
    if (!v) throw new Error(`Line ${d} has no result`);
    return valueToLiteral(v);
  });
  out = out.replace(/\bans\b/gi, () => {
    if (!ans) throw new Error("No previous result for ans");
    return valueToLiteral(ans);
  });
  for (const name of names) {
    const re = new RegExp("\\b" + escapeRegex(name) + "\\b", "gi");
    if (!re.test(out)) continue;
    const v = vars.get(normalizeKey(name))!;
    out = out.replace(new RegExp("\\b" + escapeRegex(name) + "\\b", "gi"), () => valueToLiteral(v));
  }
  return out;
}

function ratioOf(a: Value, b: Value): number {
  if (a.unit && b.unit && familyOf(a.unit) === familyOf(b.unit) && familyOf(a.unit) !== "none") {
    return (a.n * factorOf(a.unit)) / (b.n * factorOf(b.unit));
  }
  return a.n / b.n;
}

function evalExprLine(substituted: string): Value {
  const asOf = /^(.+?)\s+as\s+%\s+of\s+(.+)$/i.exec(substituted);
  if (asOf) {
    const left = parsePadExpr(asOf[1].trim());
    const right = parsePadExpr(asOf[2].trim());
    return { n: ratioOf(left, right), pctDisplay: true };
  }
  const inMatch = /^(.+?)\s+in\s+([a-zA-Z²³]+)\s*$/i.exec(substituted);
  if (inMatch && canonicalUnit(inMatch[2])) {
    const base = parsePadExpr(inMatch[1].trim());
    return convertTo(base, canonicalUnit(inMatch[2])!);
  }
  let t = substituted;
  const gstOn = /^gst\s+on\s+(.+)$/i.exec(t);
  if (gstOn) {
    t = `(${gstOn[1]}) * 0.1`;
  } else {
    let m: RegExpExecArray | null;
    if (
      (m = /^(.+?)\s*\+\s*gst\s*$/i.exec(t)) ||
      (m = /^(.+?)\bplus\s+gst\s*$/i.exec(t)) ||
      (m = /^(.+?)\binc\s+gst\s*$/i.exec(t))
    ) {
      t = `(${m[1]}) * 1.1`;
    } else if (
      (m = /^(.+?)\bex\s+gst\s*$/i.exec(t)) ||
      (m = /^(.+?)\bless\s+gst\s*$/i.exec(t))
    ) {
      t = `(${m[1]}) / 1.1`;
    }
  }
  t = t.replace(/\bof\b/gi, "*");
  return parsePadExpr(t);
}

function sumValues(all: Value[]): Value {
  // Dates aren't summable quantities — a total skips them entirely.
  const summable = all.filter((v) => !v.isDate);
  if (!summable.length) return { n: 0 };
  // In a mixed section the dollar lines are the answer and the unit lines are
  // workings, so a total only counts money once any money is present.
  const money = summable.filter((v) => v.currency);
  const list = money.length ? money : summable;
  const currencyCount = money.length;
  if (currencyCount === list.length) {
    return { n: list.reduce((s, v) => s + v.n, 0), currency: true };
  }
  if (currencyCount === 0) {
    const units = list.map((v) => v.unit);
    if (units.every((u) => u === units[0])) {
      return { n: list.reduce((s, v) => s + v.n, 0), unit: units[0] };
    }
    const families = units.map((u) => familyOf(u));
    if (families.every((f) => f === families[0]) && families[0] !== "none") {
      const target = units.reduce<string | undefined>(
        (best, u) => (u && (!best || factorOf(u) > factorOf(best)) ? u : best),
        units[0],
      )!;
      const base = list.reduce((s, v) => s + v.n * factorOf(v.unit!), 0);
      return { n: base / factorOf(target), unit: target };
    }
  }
  return { n: list.reduce((s, v) => s + v.n, 0) };
}

function findCommentIndex(s: string): number {
  const hashIdx = s.indexOf("#");
  const slashIdx = s.indexOf("//");
  const candidates = [hashIdx, slashIdx].filter((i) => i >= 0);
  return candidates.length ? Math.min(...candidates) : -1;
}

function toPadLine(raw: string, kind: PadLine["kind"], value?: Value, error?: string): PadLine {
  if (!value) return { text: raw, kind, display: "", error };
  return { text: raw, kind, display: formatValue(value), value: clean(value.n), unit: value.unit, currency: value.currency };
}

/** Pure, DOM-free: evaluates a whole notepad's text into one PadLine per source line. */
export function evaluatePad(text: string): PadLine[] {
  const rawLines = text.split(/\r?\n/);
  const out: PadLine[] = [];
  const vars = new Map<string, Value>();
  const varNames: string[] = [];
  let ans: Value | undefined;
  const lineValues: (Value | undefined)[] = [];
  let sectionResults: Value[] = [];
  let runningBalance: Value | undefined;
  const globalResults: Value[] = [];

  const sortedNames = () => [...varNames].sort((a, b) => b.length - a.length);

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    const trimmed = raw.trim();

    if (trimmed === "") {
      out.push(toPadLine(raw, "blank"));
      sectionResults = [];
      runningBalance = undefined;
      continue;
    }

    const commentIdx = findCommentIndex(trimmed);
    const content = (commentIdx === -1 ? trimmed : trimmed.slice(0, commentIdx)).trim();
    if (content === "") {
      out.push(toPadLine(raw, "comment"));
      continue;
    }

    try {
      const lc = content.toLowerCase();

      if (/^grand\s+total(\s|$)/.test(lc)) {
        const value = sumValues(globalResults);
        ans = value; lineValues[lineNo] = value;
        out.push(toPadLine(raw, "total", value));
        continue;
      }
      if (/^(total|subtotal)(\s|$)/.test(lc)) {
        const value = sumValues(sectionResults);
        ans = value; lineValues[lineNo] = value;
        out.push(toPadLine(raw, "total", value));
        continue;
      }

      if (/^[+-]\s*\S/.test(content)) {
        const sign = content[0] === "-" ? -1 : 1;
        const rest = substituteAll(content.slice(1).trim(), vars, sortedNames(), ans, lineValues);
        const amount = parsePadExpr(rest, { allowTrailingLabel: true });
        const signed: Value = { ...amount, n: amount.n * sign };
        runningBalance = runningBalance ? addValues(runningBalance, signed) : signed;
        sectionResults.push(signed);
        globalResults.push(signed);
        ans = runningBalance;
        lineValues[lineNo] = runningBalance;
        out.push(toPadLine(raw, "result", runningBalance));
        continue;
      }

      const eqIdx = content.indexOf("=");
      let name: string | undefined;
      let exprTextRaw: string;
      if (eqIdx > 0) {
        name = content.slice(0, eqIdx).trim();
        exprTextRaw = content.slice(eqIdx + 1).trim();
      } else {
        exprTextRaw = content;
      }

      const substituted = substituteAll(exprTextRaw, vars, sortedNames(), ans, lineValues);
      // "today"/"tomorrow" are valid date literals with no digits of their own —
      // don't let the label heuristic (needs a digit) swallow a bare one.
      if (!name && !/\d/.test(substituted) && !/\b(today|tomorrow)\b/i.test(substituted)) {
        out.push(toPadLine(raw, "label"));
        continue;
      }

      const value = evalExprLine(substituted);
      if (name) {
        const key = normalizeKey(name);
        if (!vars.has(key)) varNames.push(name);
        vars.set(key, value);
      }
      ans = value;
      lineValues[lineNo] = value;
      sectionResults.push(value);
      globalResults.push(value);
      out.push(toPadLine(raw, "result", value));
    } catch (err) {
      out.push(toPadLine(raw, "error", undefined, (err as Error).message));
    }
  }

  return out;
}
