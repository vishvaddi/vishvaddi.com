// XY morph field: drag to walk the tone — X is filter cutoff
// (log-mapped 60Hz–16kHz), Y is wavetable position on both oscillators.
// ORBIT animates the point in a slow lissajous around where you left it;
// SILENCE releases every sounding voice.
import { el, btn, help } from "./helpers";
import { vsynthPatch } from "./state";
import { saveAll } from "./persistence";
import { buildBandScan } from "./bandscan";

export interface XYField {
  root: HTMLElement;
  syncFromPatch: () => void;
}

const CUT_LO = 60, CUT_HI = 16000;
const cutToX = (c: number): number => Math.max(0, Math.min(1, Math.log(Math.max(CUT_LO, c) / CUT_LO) / Math.log(CUT_HI / CUT_LO)));
const xToCut = (x: number): number => Math.round(CUT_LO * Math.pow(CUT_HI / CUT_LO, Math.max(0, Math.min(1, x))));

export function buildXYField(deps: { onLight: () => void; onCommit: () => void; onSilence: () => void }): XYField {
  const root = el("div", "wa-xy-wrap");
  const title = el("div", "wa-fx-title", "FIELD");
  const modeRow = el("div", "wa-field-modes");
  const morphBtn = btn("Morph", "wa-btn-sm active"), terrainBtn = btn("Scan", "wa-btn-sm");
  modeRow.append(morphBtn, terrainBtn);
  const field = el("div", "wa-xy-field");
  const dot = el("div", "wa-xy-dot");
  const readout = el("div", "wa-xy-readout", "");
  field.append(dot);
  help(field, "Drag to morph: left–right opens the filter, up–down morphs the wavetable. ORBIT keeps the point moving on its own.");
  // SCAN — a receiver sweeping a band of transmitters. Replaces the bloom
  // field, which followed its reference too closely.
  const bloom = buildBandScan({ onReadout: (text) => { if (!bloom.root.hidden) readout.textContent = text; } });
  bloom.root.hidden = true;

  let px = cutToX(vsynthPatch.filter.cutoff);
  let py = Math.max(0, Math.min(1, vsynthPatch.osc1.pos));
  const setFieldMode = (mode: "morph" | "terrain"): void => {
    const isField = mode === "terrain"; field.hidden = isField; bloom.root.hidden = !isField;
    morphBtn.classList.toggle("active", !isField); terrainBtn.classList.toggle("active", isField);
    readout.textContent = isField ? "tune with WASD or drag" : `CUT ${xToCut(px)}Hz · POS ${py.toFixed(2)}`;
    bloom.setActive(isField);
    if (isField) bloom.root.focus();
  };
  morphBtn.addEventListener("click", () => setFieldMode("morph")); terrainBtn.addEventListener("click", () => setFieldMode("terrain"));

  const paint = (): void => {
    dot.style.left = `${px * 100}%`;
    dot.style.top = `${(1 - py) * 100}%`;
    readout.textContent = `CUT ${xToCut(px)}Hz · POS ${py.toFixed(2)}`;
  };
  let lightTick = 0;
  const apply = (commit: boolean): void => {
    vsynthPatch.filter.cutoff = xToCut(px);
    vsynthPatch.osc1.pos = py;
    vsynthPatch.osc2.pos = py;
    paint();
    if (commit) { deps.onCommit(); saveAll(); }
    else if (++lightTick % 3 === 0) deps.onLight();
  };

  let dragging = false;
  const fromEvent = (ev: PointerEvent): void => {
    const r = field.getBoundingClientRect();
    px = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    py = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
  };
  field.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    dragging = true;
    field.setPointerCapture(ev.pointerId);
    fromEvent(ev); apply(false);
  });
  field.addEventListener("pointermove", (ev) => { if (dragging) { fromEvent(ev); apply(false); } });
  const endDrag = (): void => { if (dragging) { dragging = false; apply(true); } };
  field.addEventListener("pointerup", endDrag);
  field.addEventListener("pointercancel", endDrag);

  // ── ORBIT — slow lissajous drift around the point you parked ──
  let orbiting = false, raf = 0, cx = 0.5, cy = 0.5, t0 = 0;
  const orbitBtn = btn("ORBIT", "wa-toggle wa-btn-sm");
  help(orbitBtn, "Automated motion — the point orbits slowly around where you left it, morphing filter and wavetable together.");
  const orbitFrame = (now: number): void => {
    if (!orbiting) return;
    const t = (now - t0) / 1000;
    px = Math.max(0, Math.min(1, cx + 0.26 * Math.sin(t * 0.9)));
    py = Math.max(0, Math.min(1, cy + 0.22 * Math.sin(t * 0.57 + 1.4)));
    apply(false);
    raf = requestAnimationFrame(orbitFrame);
  };
  orbitBtn.addEventListener("click", () => {
    orbiting = !orbiting;
    orbitBtn.classList.toggle("active", orbiting);
    field.classList.toggle("orbiting", orbiting);
    if (orbiting) { cx = px; cy = py; t0 = performance.now(); raf = requestAnimationFrame(orbitFrame); }
    else { cancelAnimationFrame(raf); apply(true); }
  });

  const silenceBtn = btn("SILENCE", "wa-btn-sm wa-silence");
  help(silenceBtn, "Release every sounding voice, including held and latched notes.");
  silenceBtn.addEventListener("click", () => { bloom.silence(); deps.onSilence(); });

  const perfRow = el("div", "wa-xy-perf");
  perfRow.append(orbitBtn, silenceBtn);
  root.append(title, modeRow, field, bloom.root, readout, perfRow);
  paint();

  return {
    root,
    syncFromPatch: () => {
      if (dragging || orbiting) return;
      px = cutToX(vsynthPatch.filter.cutoff);
      py = Math.max(0, Math.min(1, vsynthPatch.osc1.pos));
      paint();
    },
  };
}
