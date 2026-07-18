// Rotary knob — the CV-80-style control that replaces range sliders across
// the studio (Synth Parity Plan, Phase 1). 270° sweep, vertical drag
// (1px = 1/200 of range, Shift = fine ×0.1), wheel, double-click reset,
// arrow keys, ARIA slider semantics, ≥44px touch target.
import { el } from "./helpers";

export interface KnobOpts {
  fmt?: (v: number) => string;      // display formatting (default: trimmed number)
  reset?: number;                   // double-click value (default: initial)
  colour?: string;                  // arc colour override (else section CSS decides)
}

export interface Knob {
  root: HTMLElement;
  set: (v: number) => void;
  get: () => number;
}

const SWEEP = 270;                   // degrees, from -135 to +135

export function knob(
  label: string, min: number, max: number, value: number, step: number,
  on: (v: number) => void, opts: KnobOpts = {},
): Knob {
  const fmt = opts.fmt ?? ((v: number) => String(+v.toFixed(step < 1 ? 2 : 0)));
  const resetTo = opts.reset ?? value;
  let current = clamp(value);

  const root = el("div", "wa-knob-row wa-slider-row");
  const dial = el("div", "wa-knob");
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", label);
  dial.setAttribute("aria-valuemin", String(min));
  dial.setAttribute("aria-valuemax", String(max));
  if (opts.colour) dial.style.setProperty("--wa-knob-col", opts.colour);
  const line = el("div", "wa-knob-line");
  dial.append(line);
  const val = el("span", "wa-knob-val");
  const lbl = el("span", "wa-knob-lbl", label);
  root.append(dial, val, lbl);

  function clamp(v: number): number {
    const snapped = Math.round(v / step) * step;
    return Math.max(min, Math.min(max, +snapped.toFixed(6)));
  }
  function paint(): void {
    const pct = (current - min) / (max - min);
    dial.style.setProperty("--wa-knob-pct", String(pct));
    line.style.transform = `rotate(${-135 + pct * SWEEP}deg)`;
    val.textContent = fmt(current);
    dial.setAttribute("aria-valuenow", String(current));
  }
  function commit(v: number, fire = true): void {
    const next = clamp(v);
    if (next === current) { paint(); return; }
    current = next;
    paint();
    if (fire) on(current);
  }

  let dragY = 0, dragStart = 0, dragging = false;
  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dial.setPointerCapture(e.pointerId);
    dragging = true; dragY = e.clientY; dragStart = current;
    dial.classList.add("active");
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const fine = e.shiftKey ? 0.1 : 1;
    const delta = ((dragY - e.clientY) / 200) * (max - min) * fine;
    commit(dragStart + delta);
  });
  const endDrag = () => { dragging = false; dial.classList.remove("active"); };
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    const coarse = (max - min) / 50;
    commit(current + (e.deltaY < 0 ? 1 : -1) * Math.max(step, e.shiftKey ? step : coarse));
  }, { passive: false });
  dial.addEventListener("dblclick", () => commit(resetTo));
  dial.addEventListener("keydown", (e) => {
    const big = (max - min) / 10;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); commit(current + (e.shiftKey ? step : Math.max(step, big / 5))); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); commit(current - (e.shiftKey ? step : Math.max(step, big / 5))); }
    else if (e.key === "Home") { e.preventDefault(); commit(min); }
    else if (e.key === "End") { e.preventDefault(); commit(max); }
  });

  paint();
  return { root, set: (v) => commit(v, false), get: () => current };
}
