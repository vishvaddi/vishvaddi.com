// VV-1 wavetable synth UI: preset row, patch editor, chord player, the piano
// roll (see pianoroll.ts) and the on-screen keys.

import { stepDur, vsynthPatch } from "./state";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { playNote, LiveVoices, PRESETS, TABLE_NAMES, MOD_SRCS, MOD_DESTS } from "./vsynth";
import type { ModSlot, VPatch } from "./vsynth";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow } from "./helpers";
import { buildPianoRoll } from "./pianoroll";

export interface SynthUI {
  synthPanel: HTMLElement;
  synthCells: HTMLElement[][];
  pianoRoll: HTMLElement;
  synthKeys: HTMLElement;
  liveKeys: LiveVoices;
  noteOn(note: string): void;
  noteOff(note: string): void;
}

export function buildSynthUI(): SynthUI {
  const synthPanel = el("div", "wa-panel");
  const liveKeys = new LiveVoices();
  const audition = (note: string, vel = 105, lenSteps = 2): void => {
    ensureNodes(); playNote(ac(), engine.synthGain!, vsynthPatch, note, vel, ac().currentTime, stepDur() * lenSteps);
  };
  function ensureMatrixSlots(): void {
    while (vsynthPatch.matrix.length < 6) vsynthPatch.matrix.push({ src: "lfo1", dest: "cutoff", amt: 0 });
    vsynthPatch.matrix.length = 6;
  }
  ensureMatrixSlots();
  const selRow = (label: string, options: Array<[string, string]>, value: string, on: (v: string) => void): HTMLElement => {
    const row = el("div", "wa-slider-row");
    row.append(el("span", "wa-lbl", label));
    const sel = document.createElement("select");
    options.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; sel.append(o); });
    sel.value = value;
    sel.addEventListener("change", () => on(sel.value));
    row.append(sel); return row;
  };
  // Preset row
  const presetRow = el("div", "wa-export");
  const presetSel = document.createElement("select");
  Object.keys(PRESETS).forEach((name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; presetSel.append(o); });
  const loadPresetBtn = btn("Load preset", "wa-btn-sm");
  const auditionBtn = btn("♪ Audition", "wa-btn-sm");
  help(loadPresetBtn, "Replace the whole synth patch with the selected preset.");
  help(auditionBtn, "Play a short note with the current patch.");
  loadPresetBtn.addEventListener("click", () => {
    const preset = PRESETS[presetSel.value]; if (!preset) return;
    const copy = JSON.parse(JSON.stringify(preset)) as VPatch;
    (Object.keys(copy) as Array<keyof VPatch>).forEach((key) => {
      const value = copy[key];
      if (Array.isArray(value)) (vsynthPatch[key] as unknown[]) = value;
      else if (typeof value === "object" && value !== null) Object.assign(vsynthPatch[key] as object, value);
      else (vsynthPatch[key] as unknown) = value;
    });
    ensureMatrixSlots();
    renderPatchEditor(); saveAll(); audition("C4");
  });
  auditionBtn.addEventListener("click", () => audition("C4"));
  presetRow.append(el("span", "wa-lbl", "PRESET"), presetSel, loadPresetBtn, auditionBtn);
  // Patch editor — rebuilt whenever a preset load replaces the patch wholesale.
  const patchBox = el("div", "wa-vpatch");
  function renderPatchEditor(): void {
    patchBox.replaceChildren();
    const pSlider = (host: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      host.append(sliderRow(label, min, max, get(), step, (v) => { set(v); saveAll(); }));
    };
    (["osc1", "osc2"] as const).forEach((key, i) => {
      const o = vsynthPatch[key];
      const box = el("div", "wa-vblock");
      box.append(el("div", "wa-fx-title", `OSC ${i + 1}`));
      box.append(selRow("Table", TABLE_NAMES.map((n) => [n, n.toUpperCase()]), o.table, (v) => { o.table = v; saveAll(); }));
      pSlider(box, "Position", 0, 1, 0.01, () => o.pos, (v) => { o.pos = v; });
      pSlider(box, "Octave", -2, 2, 1, () => o.octave, (v) => { o.octave = v; });
      pSlider(box, "Semi", -12, 12, 1, () => o.semi, (v) => { o.semi = v; });
      pSlider(box, "Level", 0, 1, 0.01, () => o.level, (v) => { o.level = v; });
      pSlider(box, "Unison", 1, 8, 1, () => o.unison, (v) => { o.unison = v; });
      pSlider(box, "Detune", 0, 100, 1, () => o.detune, (v) => { o.detune = v; });
      patchBox.append(box);
    });
    const noiseBox = el("div", "wa-vblock");
    noiseBox.append(el("div", "wa-fx-title", "NOISE"));
    pSlider(noiseBox, "Level", 0, 1, 0.01, () => vsynthPatch.noise.level, (v) => { vsynthPatch.noise.level = v; });
    pSlider(noiseBox, "Colour", 200, 16000, 100, () => vsynthPatch.noise.colour, (v) => { vsynthPatch.noise.colour = v; });
    patchBox.append(noiseBox);
    const filterBox = el("div", "wa-vblock");
    filterBox.append(el("div", "wa-fx-title", "FILTER"));
    filterBox.append(selRow("Type", [["lowpass", "LOW PASS"], ["highpass", "HIGH PASS"], ["bandpass", "BAND PASS"], ["notch", "NOTCH"]], vsynthPatch.filter.type, (v) => { vsynthPatch.filter.type = v as VPatch["filter"]["type"]; saveAll(); }));
    pSlider(filterBox, "Cutoff", 30, 18000, 10, () => vsynthPatch.filter.cutoff, (v) => { vsynthPatch.filter.cutoff = v; });
    pSlider(filterBox, "Res", 0.1, 12, 0.1, () => vsynthPatch.filter.res, (v) => { vsynthPatch.filter.res = v; });
    pSlider(filterBox, "Env2 amt", -1, 1, 0.01, () => vsynthPatch.filter.env2, (v) => { vsynthPatch.filter.env2 = v; });
    pSlider(filterBox, "Key track", 0, 1, 0.05, () => vsynthPatch.filter.track, (v) => { vsynthPatch.filter.track = v; });
    patchBox.append(filterBox);
    (["env1", "env2"] as const).forEach((key, i) => {
      const e = vsynthPatch[key];
      const box = el("div", "wa-vblock");
      box.append(el("div", "wa-fx-title", i === 0 ? "ENV 1 · AMP" : "ENV 2 · MOD"));
      pSlider(box, "Attack", 0, 2, 0.005, () => e.a, (v) => { e.a = v; });
      pSlider(box, "Decay", 0.01, 2, 0.01, () => e.d, (v) => { e.d = v; });
      pSlider(box, "Sustain", 0, 1, 0.01, () => e.s, (v) => { e.s = v; });
      pSlider(box, "Release", 0.01, 3, 0.01, () => e.r, (v) => { e.r = v; });
      patchBox.append(box);
    });
    (["lfo1", "lfo2"] as const).forEach((key, i) => {
      const l = vsynthPatch[key];
      const box = el("div", "wa-vblock");
      box.append(el("div", "wa-fx-title", `LFO ${i + 1}`));
      box.append(selRow("Shape", [["sine", "SINE"], ["triangle", "TRI"], ["sawtooth", "SAW"], ["square", "SQR"]], l.shape, (v) => { l.shape = v as VPatch["lfo1"]["shape"]; saveAll(); }));
      pSlider(box, "Rate Hz", 0.05, 20, 0.05, () => l.rate, (v) => { l.rate = v; });
      patchBox.append(box);
    });
    const matrixBox = el("div", "wa-vblock wa-vmatrix");
    matrixBox.append(el("div", "wa-fx-title", "MOD MATRIX"));
    vsynthPatch.matrix.forEach((slot: ModSlot) => {
      const row = el("div", "wa-vmatrix-row");
      const srcSel = document.createElement("select");
      MOD_SRCS.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s.toUpperCase(); srcSel.append(o); });
      srcSel.value = slot.src;
      srcSel.addEventListener("change", () => { slot.src = srcSel.value as ModSlot["src"]; saveAll(); });
      const destSel = document.createElement("select");
      MOD_DESTS.forEach((d) => { const o = document.createElement("option"); o.value = d; o.textContent = d.toUpperCase(); destSel.append(o); });
      destSel.value = slot.dest;
      destSel.addEventListener("change", () => { slot.dest = destSel.value as ModSlot["dest"]; saveAll(); });
      row.append(srcSel, el("span", "wa-lbl", "→"), destSel);
      row.append(sliderRow("Amt", -1, 1, slot.amt, 0.01, (v) => { slot.amt = v; saveAll(); }));
      matrixBox.append(row);
    });
    patchBox.append(matrixBox);
    const macroBox = el("div", "wa-vblock");
    macroBox.append(el("div", "wa-fx-title", "MACROS — map via matrix"));
    ["Macro 1", "Macro 2", "Macro 3", "Macro 4"].forEach((name, i) => {
      pSlider(macroBox, name, 0, 1, 0.01, () => vsynthPatch.macros[i] ?? 0, (v) => { vsynthPatch.macros[i] = v; });
    });
    pSlider(macroBox, "Volume", 0, 1, 0.01, () => vsynthPatch.volume, (v) => { vsynthPatch.volume = v; });
    patchBox.append(macroBox);
  }
  renderPatchEditor();
  // Chord player
  const chordRow = el("div", "wa-chords");
  const chords: Array<[string, string[]]> = [
    ["Cm", ["C4", "D#4", "G4"]], ["Fm", ["F4", "G#4", "C5"]], ["Gm", ["G4", "A#4", "D5"]],
    ["Ab", ["G#4", "C5", "D#5"]], ["Bb", ["A#4", "D5", "F5"]], ["C7", ["C4", "E4", "G4", "A#4"]],
  ];
  chords.forEach(([label, notes]) => {
    const button = btn(label, "wa-btn-sm");
    button.addEventListener("click", () => { notes.forEach((note) => audition(note, 90, 3.5)); });
    chordRow.append(button);
  });
  const { pianoRoll, synthCells } = buildPianoRoll(audition);
  const noteOn = (note: string): void => { ensureNodes(); liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, note); };
  const noteOff = (note: string): void => liveKeys.noteOff(ac(), note);
  const synthKeys = el("div", "wa-keys");
  buildKeys(synthKeys, noteOn, noteOff);
  synthPanel.append(
    presetRow,
    patchBox,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "CHORD PLAYER"), chordRow,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "PIANO ROLL — click to add, drag right for length, right-click for velocity"), pianoRoll,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "KEYS — click or use A–K"), synthKeys,
  );

  return { synthPanel, synthCells, pianoRoll, synthKeys, liveKeys, noteOn, noteOff };
}

// ─── Key builders ─────────────────────────────────────────────────────────────
const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
type NoteFn = (note: string) => void;
function buildKeys(host: HTMLElement, noteOn: NoteFn, noteOff: NoteFn): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const key = el("button", "wa-key") as HTMLButtonElement; key.type = "button"; key.dataset.note = `${w}${oct}`; bindKey(key, `${w}${oct}`, noteOn, noteOff);
      if (HAS_BLACK[w]) {
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement; bk.type = "button"; bk.dataset.note = `${w}#${oct}`; bindKey(bk, `${w}#${oct}`, noteOn, noteOff); key.append(bk);
      }
      host.append(key);
    }
  }
}
function bindKey(key: HTMLElement, note: string, noteOn: NoteFn, noteOff: NoteFn): void {
  const on = (e: Event) => { e.preventDefault(); e.stopPropagation(); noteOn(note); key.classList.add("down"); };
  const off = () => { noteOff(note); key.classList.remove("down"); };
  key.addEventListener("mousedown", on); key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", () => { if (key.classList.contains("down")) off(); });
  key.addEventListener("touchstart", on, { passive: false });
  key.addEventListener("touchend", (e) => { e.preventDefault(); off(); });
}
export function highlightKey(host: HTMLElement, note: string, on: boolean): void {
  const k = host.querySelector<HTMLElement>(`[data-note="${CSS.escape(note)}"]`);
  if (k) k.classList.toggle("down", on);
}
