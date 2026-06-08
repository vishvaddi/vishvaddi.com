// SpeedCrunch-style calculator: a recursive-descent expression engine with
// functions, constants, user variables, `ans`, factorial and a deg/rad mode,
// plus an evaluation history. All DOM output is textContent — XSS-safe.

type TokType = "num" | "id" | "op" | "lp" | "rp" | "comma";
interface Tok { t: TokType; v: string; }

const CONSTS: Record<string, number> = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

function factorial(n: number): number {
  if (n < 0 || !Number.isFinite(n)) return NaN;
  const k = Math.round(n);
  if (Math.abs(n - k) > 1e-9) return NaN; // only integer factorials
  let r = 1;
  for (let i = 2; i <= k; i++) r *= i;
  return r;
}

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

const fmt = (n: number) => {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return "∞";
  if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-9)) return n.toExponential(8);
  return parseFloat(n.toPrecision(12)).toString();
};

export function initCalculator() {
  const g = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = g<HTMLInputElement>("calc-input");
  const hist = g<HTMLDivElement>("calc-history");
  const modeBtn = g<HTMLButtonElement>("calc-mode");
  const varsEl = g<HTMLDivElement>("calc-vars");
  const clearBtn = g<HTMLButtonElement>("calc-clear");
  if (!input || !hist) return;

  let deg = localStorage.getItem("calc-deg") === "1";
  const vars: Record<string, number> = {};
  const recallable: string[] = [];
  let recallIdx = -1;

  const setMode = () => { if (modeBtn) modeBtn.textContent = deg ? "DEG" : "RAD"; };
  setMode();

  const renderVars = () => {
    if (!varsEl) return;
    varsEl.textContent = "";
    const names = Object.keys(vars).filter(n => n !== "ans");
    if (vars.ans !== undefined) names.unshift("ans");
    if (!names.length) { varsEl.hidden = true; return; }
    varsEl.hidden = false;
    for (const n of names) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "calc-var";
      chip.textContent = `${n} = ${fmt(vars[n])}`;
      chip.addEventListener("click", () => { input.value += n; input.focus(); });
      varsEl.append(chip);
    }
  };

  const addHistory = (expr: string, out: string, ok: boolean) => {
    const row = document.createElement("div");
    row.className = "calc-row" + (ok ? "" : " err");
    const e = document.createElement("button");
    e.type = "button";
    e.className = "calc-expr";
    e.textContent = expr;
    e.title = "Click to edit again";
    e.addEventListener("click", () => { input.value = expr; input.focus(); });
    const r = document.createElement("div");
    r.className = "calc-out";
    r.textContent = out;
    row.append(e, r);
    hist.prepend(row);
  };

  const run = () => {
    const src = input.value.trim();
    if (!src) return;
    try {
      const res = evaluate(src, vars, deg);
      vars.ans = res.value;
      if (res.assigned) vars[res.assigned] = res.value;
      addHistory(src, (res.assigned ? `${res.assigned} = ` : "= ") + fmt(res.value), true);
      recallable.unshift(src);
      recallIdx = -1;
      input.value = "";
      renderVars();
    } catch (err) {
      addHistory(src, (err as Error).message, false);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); run(); }
    else if (e.key === "ArrowUp") {
      if (recallIdx < recallable.length - 1) { recallIdx++; input.value = recallable[recallIdx]; e.preventDefault(); }
    } else if (e.key === "ArrowDown") {
      if (recallIdx > 0) { recallIdx--; input.value = recallable[recallIdx]; }
      else { recallIdx = -1; input.value = ""; }
    }
  });

  modeBtn?.addEventListener("click", () => {
    deg = !deg;
    localStorage.setItem("calc-deg", deg ? "1" : "0");
    setMode();
    input.focus();
  });

  clearBtn?.addEventListener("click", () => {
    hist.textContent = "";
    for (const k of Object.keys(vars)) delete vars[k];
    recallable.length = 0;
    recallIdx = -1;
    renderVars();
    input.focus();
  });

  input.focus();
}
