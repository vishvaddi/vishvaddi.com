// UI for the expression calculator; the parser/evaluator itself lives in
// calc-engine.ts (shared with the Notepad). All DOM output is textContent —
// XSS-safe.
import { evaluate } from "./calc-engine";

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
    e.title = "Click to reuse this expression";
    e.addEventListener("click", () => { input.value = expr; input.focus(); });
    const r = document.createElement("button");
    r.type = "button";
    r.className = "calc-out";
    r.textContent = out;
    if (ok) {
      r.title = "Click to copy result";
      r.addEventListener("click", () => {
        const val = out.replace(/^.*=\s*/, "");
        if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
        const prev = r.textContent;
        r.textContent = "copied ✓";
        setTimeout(() => { r.textContent = prev; }, 800);
      });
    }
    row.append(e, r);
    hist.prepend(row);
  };

  const insertAtCursor = (text: string) => {
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    const pos = s + text.length;
    input.focus();
    input.setSelectionRange(pos, pos);
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

  // Physical keypad.
  const pad = document.getElementById("calc-pad");
  pad?.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.tagName !== "BUTTON") return;
    const act = t.getAttribute("data-act");
    const ins = t.getAttribute("data-ins");
    if (act === "eq") { run(); return; }
    if (act === "clear") { input.value = ""; input.focus(); return; }
    if (act === "back") { input.value = input.value.slice(0, -1); input.focus(); return; }
    if (ins !== null) insertAtCursor(ins);
  });

  input.focus();
}
