// XY morph field (LYSERGIC, F): drag to walk the tone — X is filter cutoff
// (log-mapped 60Hz–16kHz), Y is wavetable position on both oscillators.
// ORBIT animates the point in a slow lissajous around where you left it;
// SILENCE releases every sounding voice.
import { el, btn, help } from "./helpers";
import { vsynthPatch } from "./state";
import { saveAll } from "./persistence";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { midiToNote, playNote } from "./vsynth";

export interface XYField {
  root: HTMLElement;
  syncFromPatch: () => void;
}

const CUT_LO = 60, CUT_HI = 16000;
const cutToX = (c: number): number => Math.max(0, Math.min(1, Math.log(Math.max(CUT_LO, c) / CUT_LO) / Math.log(CUT_HI / CUT_LO)));
const xToCut = (x: number): number => Math.round(CUT_LO * Math.pow(CUT_HI / CUT_LO, Math.max(0, Math.min(1, x))));

export function buildXYField(deps: { onLight: () => void; onCommit: () => void; onSilence: () => void }): XYField {
  const root = el("div", "wa-xy-wrap");
  const title = el("div", "wa-fx-title", "FIELD — walk the tone");
  const modeRow = el("div", "wa-field-modes");
  const morphBtn = btn("Morph", "wa-btn-sm active"), terrainBtn = btn("Terrain", "wa-btn-sm");
  modeRow.append(morphBtn, terrainBtn);
  const field = el("div", "wa-xy-field");
  const dot = el("div", "wa-xy-dot");
  const readout = el("div", "wa-xy-readout", "");
  field.append(dot);
  help(field, "Drag to morph: left–right opens the filter, up–down morphs the wavetable. ORBIT keeps the point moving on its own.");
  const terrain = el("div", "wa-tone-terrain"); terrain.hidden = true; terrain.tabIndex = 0;
  const terrainDot = el("div", "wa-terrain-dot"), terrainMini = el("div", "wa-terrain-mini");
  terrain.append(terrainDot, terrainMini);

  let px = cutToX(vsynthPatch.filter.cutoff);
  let py = Math.max(0, Math.min(1, vsynthPatch.osc1.pos));
  let terrainX = 0.5, terrainY = 0.5, terrainCell = -1;
  const terrainScale = [0, 2, 3, 5, 7, 9, 10];
  const paintTerrain = (): void => {
    terrainDot.style.left = `${terrainX * 100}%`; terrainDot.style.top = `${terrainY * 100}%`;
    terrainMini.style.setProperty("--x", `${terrainX * 100}%`); terrainMini.style.setProperty("--y", `${terrainY * 100}%`);
  };
  const soundTerrain = (force = false): void => {
    const column = Math.max(0, Math.min(20, Math.floor(terrainX * 21)));
    if (!force && column === terrainCell) return;
    terrainCell = column;
    const midi = 36 + Math.floor(column / terrainScale.length) * 12 + terrainScale[column % terrainScale.length];
    const patch = JSON.parse(JSON.stringify(vsynthPatch)) as typeof vsynthPatch;
    patch.filter.cutoff = 100 * Math.pow(120, 1 - terrainY); patch.osc1.pos = 1 - terrainY; patch.osc2.pos = 1 - terrainY;
    ensureNodes(); playNote(ac(), engine.synthGain!, patch, midiToNote(midi), 96, ac().currentTime, 0.34);
    readout.textContent = `${midiToNote(midi)} · CUT ${Math.round(patch.filter.cutoff)}Hz · drag / WASD`;
  };
  const moveTerrain = (x: number, y: number, sound = true): void => {
    terrainX = Math.max(0, Math.min(1, x)); terrainY = Math.max(0, Math.min(1, y)); paintTerrain(); if (sound) soundTerrain();
  };
  let terrainDragging = false;
  const terrainFromEvent = (ev: PointerEvent): void => { const rect = terrain.getBoundingClientRect(); moveTerrain((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height); };
  terrain.addEventListener("pointerdown", (ev) => { ev.preventDefault(); terrainDragging = true; terrain.setPointerCapture(ev.pointerId); terrain.focus(); terrainFromEvent(ev); });
  terrain.addEventListener("pointermove", (ev) => { if (terrainDragging) terrainFromEvent(ev); });
  terrain.addEventListener("pointerup", () => { terrainDragging = false; });
  terrain.addEventListener("pointercancel", () => { terrainDragging = false; });
  window.addEventListener("keydown", (ev) => {
    if (terrain.hidden || !root.offsetParent || !["w", "a", "s", "d"].includes(ev.key.toLowerCase())) return;
    const active = document.activeElement; if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
    ev.preventDefault(); const key = ev.key.toLowerCase();
    moveTerrain(terrainX + (key === "d" ? 0.05 : key === "a" ? -0.05 : 0), terrainY + (key === "s" ? 0.05 : key === "w" ? -0.05 : 0));
  });
  const setFieldMode = (mode: "morph" | "terrain"): void => {
    const isTerrain = mode === "terrain"; field.hidden = isTerrain; terrain.hidden = !isTerrain;
    morphBtn.classList.toggle("active", !isTerrain); terrainBtn.classList.toggle("active", isTerrain);
    readout.textContent = isTerrain ? "Drag or use WASD to walk the scale" : `CUT ${xToCut(px)}Hz · POS ${py.toFixed(2)}`;
    if (isTerrain) { paintTerrain(); terrain.focus(); }
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
  silenceBtn.addEventListener("click", deps.onSilence);

  const perfRow = el("div", "wa-xy-perf");
  perfRow.append(orbitBtn, silenceBtn);
  root.append(title, modeRow, field, terrain, readout, perfRow);
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
