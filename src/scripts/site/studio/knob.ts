import { el } from "./helpers";

export interface KnobOptions {
  label: string; min: number; max: number; value: number; step: number;
  unit?: string; def?: number; fmt?: (value: number) => string; size?: number;
  onInput(value: number): void;
}

export interface KnobControl { el: HTMLElement; set(value: number, emit?: boolean): void; get(): number }

export function knob(options: KnobOptions): KnobControl {
  const host = el("div", "wa-knob"), dial = el("div", "wa-knob-dial"), pointer = el("span", "wa-knob-pointer"), valueLabel = el("span", "wa-knob-value");
  host.style.setProperty("--wa-knob-size", `${options.size ?? 48}px`);
  host.tabIndex = 0; host.setAttribute("role", "slider"); host.setAttribute("aria-label", options.label); host.setAttribute("aria-valuemin", String(options.min)); host.setAttribute("aria-valuemax", String(options.max));
  dial.append(pointer); host.append(el("span", "wa-knob-label", options.label), dial, valueLabel);
  const precision = Math.max(0, (String(options.step).split(".")[1] ?? "").length);
  const clamp = (value: number, quantum = options.step): number => Math.max(options.min, Math.min(options.max, Math.round((value - options.min) / quantum) * quantum + options.min));
  let value = clamp(options.value), startY = 0, startValue = value;
  const render = (): void => {
    const ratio = (value - options.min) / (options.max - options.min), angle = -135 + ratio * 270;
    dial.style.setProperty("--wa-knob-angle", `${angle}deg`); dial.style.setProperty("--wa-knob-fill", `${ratio * 75}%`);
    valueLabel.textContent = options.fmt?.(value) ?? `${value.toFixed(precision)}${options.unit ?? ""}`;
    host.setAttribute("aria-valuenow", String(value)); host.setAttribute("aria-valuetext", valueLabel.textContent);
  };
  const setWithQuantum = (next: number, emit = true, quantum = options.step): void => { const clamped = clamp(next, quantum); if (clamped === value) return; value = clamped; render(); if (emit) options.onInput(value); };
  const set = (next: number, emit = true): void => setWithQuantum(next, emit);
  host.addEventListener("pointerdown", (event) => { event.preventDefault(); host.focus(); host.setPointerCapture(event.pointerId); startY = event.clientY; startValue = value; });
  host.addEventListener("pointermove", (event) => { if (!host.hasPointerCapture(event.pointerId)) return; const scale = event.shiftKey ? 0.1 : 1; setWithQuantum(startValue + (startY - event.clientY) / 200 * (options.max - options.min) * scale, true, options.step * scale); });
  host.addEventListener("wheel", (event) => { event.preventDefault(); const scale = event.shiftKey ? 0.1 : 1; setWithQuantum(value + (event.deltaY < 0 ? options.step : -options.step) * scale, true, options.step * scale); }, { passive: false });
  host.addEventListener("dblclick", () => set(options.def ?? options.value));
  host.addEventListener("keydown", (event) => { if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) return; event.preventDefault(); if (event.key === "Home") set(options.min); else if (event.key === "End") set(options.max); else { const scale = event.shiftKey ? 0.1 : 1; setWithQuantum(value + (["ArrowUp", "ArrowRight"].includes(event.key) ? options.step : -options.step) * scale, true, options.step * scale); } });
  render();
  return { el: host, set, get: () => value };
}
