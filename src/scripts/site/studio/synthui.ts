// Synth: VV-1 wavetable — patch editor (presets, randomize, simple mode,
// scope), DOM piano roll, on-screen keys, key recording. Extracted verbatim
// from index.ts (Phase 0 split). Playhead state reads from ctx.playhead
// (already rewired before the cut).
import { STEPS, SCENE_LABELS, ROLL_NOTES, clip, transport, stepDur, mpc, synthNotes, vsynthPatch } from "./state";
import type { VNote } from "./state";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { playNote, LiveVoices, PRESETS, PRESET_CATEGORIES, TABLE_NAMES, MOD_SRCS, MOD_DESTS, sampleWaveform, noteToMidi, midiToNote } from "./vsynth";
import type { ModSlot, VPatch } from "./vsynth";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow, drawScope, drawEnvelopeShape, SCREEN_BG, SCREEN_FG } from "./helpers";
import { ctx, playhead, gridRepainters, isGridLine, stepsPerGridLine } from "./ctx";
import { showVelocityPopup } from "./velpopup";
import { buildKeys, setKeysLatch } from "./keys";
import { buildRoll } from "./roll";
import { buildXYField } from "./xyfield";

export interface SynthUI {
  synthPanel: HTMLElement;
  synthKeys: HTMLElement;
  liveKeys: LiveVoices;
  rollPlayheadBar: HTMLElement;
  paintRoll: () => void;
  renderPatchEditor: () => void;
  recordSynthOn: (n: string) => void;
  recordSynthOff: (n: string) => void;
  isSynthRec: () => boolean;
  setOctaveShift: (v: number) => void;
  getOctaveShift: () => number;
  waveRedraws: () => Array<() => void>;
  // tutorial targets
  presetRow: HTMLElement;
  pianoRoll: HTMLElement;
  /** KEYS-page strip: label + rec toggle + octave readout (layout re-houses it) */
  keysHeader: HTMLElement;
  /** XY morph field + ORBIT/SILENCE (xyfield.ts, F) — layout places it */
  xyPanel: HTMLElement;
  /** live output scope — layout parks it under the XY field (G) */
  scope: HTMLElement;
}

// Stacked wavetable wireframe (Serum-style): the table's slices drawn as
// perspective-offset polylines, the slice under the POSITION knob lit with a
// cyan halo, neighbours ghosted by distance. Pure look — audio path untouched.
const WT_SLICES = 12;
function drawWavetableStack(canvas: HTMLCanvasElement, table: string, pos: number): void {
  const scale = window.devicePixelRatio || 1, width = canvas.clientWidth || 200, height = canvas.clientHeight || 92;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const g = canvas.getContext("2d"); if (!g) return;
  g.scale(scale, scale);
  g.fillStyle = SCREEN_BG; g.fillRect(0, 0, width, height);
  const spanX = width * 0.2, spanY = height * 0.42;
  const plotW = width - spanX - 10, amp = (height - spanY - 12) * 0.5;
  const current = Math.round(pos * (WT_SLICES - 1));
  const slice = (index: number): void => {
    const t = index / (WT_SLICES - 1);
    const wave = sampleWaveform(table, t);
    const ox = 5 + t * spanX, oy = height - 8 - amp - t * spanY;
    const isCurrent = index === current;
    g.strokeStyle = isCurrent ? SCREEN_FG : `rgba(52, 226, 255, ${(0.08 + 0.16 * (1 - Math.abs(t - pos))).toFixed(3)})`;
    g.lineWidth = isCurrent ? 1.8 : 0.8;
    g.shadowBlur = isCurrent ? 9 : 0;
    g.shadowColor = SCREEN_FG;
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = ox + (i / (wave.length - 1)) * plotW;
      const y = oy - wave[i] * amp;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  for (let i = WT_SLICES - 1; i >= 0; i--) if (i !== current) slice(i);
  slice(current);
  g.shadowBlur = 0;
}

export function buildSynth(): SynthUI {
  let waveRedraws: Array<() => void> = [];
  let modBadgeRefreshers: Array<() => void> = [];
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
  // Preset row — searchable + filterable by category (Surge XT style).
  const presetRow = el("div", "wa-export");
  const presetBrowserRow = el("div", "wa-export");
  const presetSearch = document.createElement("input");
  presetSearch.type = "text"; presetSearch.placeholder = "Search presets…"; presetSearch.className = "wa-preset-search";
  const presetCategoryRow = el("div", "wa-preset-categories");
  const presetCategories = ["All", ...Array.from(new Set(Object.keys(PRESETS).map((name) => PRESET_CATEGORIES[name] ?? "Utility")))];
  let activePresetCategory = "All";
  const categoryBtns: HTMLButtonElement[] = [];
  const presetSel = document.createElement("select");
  function refreshPresetOptions(): void {
    const query = presetSearch.value.trim().toLowerCase(), prevValue = presetSel.value;
    presetSel.replaceChildren();
    Object.keys(PRESETS).forEach((name) => {
      const category = PRESET_CATEGORIES[name] ?? "Utility";
      if (activePresetCategory !== "All" && category !== activePresetCategory) return;
      if (query && !name.toLowerCase().includes(query)) return;
      const o = document.createElement("option"); o.value = name; o.textContent = name; presetSel.append(o);
    });
    if (Array.from(presetSel.options).some((o) => o.value === prevValue)) presetSel.value = prevValue;
  }
  presetCategories.forEach((category) => {
    const b = btn(category, "wa-btn-sm" + (category === "All" ? " active" : ""));
    b.addEventListener("click", () => {
      activePresetCategory = category;
      categoryBtns.forEach((other) => other.classList.toggle("active", other === b));
      refreshPresetOptions();
    });
    categoryBtns.push(b); presetCategoryRow.append(b);
  });
  presetSearch.addEventListener("input", refreshPresetOptions);
  refreshPresetOptions();
  const loadPresetBtn = btn("Load preset", "wa-btn-sm");
  const auditionBtn = btn("♪ Audition", "wa-btn-sm");
  const randomizeBtn = btn("🎲 Randomize", "wa-btn-sm");
  help(loadPresetBtn, "Replace the whole synth patch with the selected preset.");
  help(auditionBtn, "Play a short note with the current patch.");
  help(randomizeBtn, "Jitter the current patch's oscillators, filter, envelopes and modulation within musical ranges.");
  // Randomize — biased toward playable results rather than pure chaos: only
  // 1-2 of the 6 mod-matrix slots get a nonzero amount, cutoff is picked on
  // a log scale, and osc2 is silent half the time.
  function randomizePatch(): void {
    ctx.checkpoint();
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
    const filterTypes = ["lowpass", "highpass", "bandpass", "notch"] as const;
    const lfoShapes = ["sine", "triangle", "sawtooth", "square"] as const;
    vsynthPatch.osc1 = {
      table: pick(TABLE_NAMES), pos: Math.random(), octave: Math.round(rand(-1, 1)), semi: 0,
      level: rand(0.6, 1), unison: 1 + Math.floor(Math.random() * 4), detune: rand(0, 35),
    };
    vsynthPatch.osc2 = Math.random() < 0.5
      ? { table: "basic", pos: 0.6, octave: 0, semi: 0, level: 0, unison: 1, detune: 12 }
      : {
          table: pick(TABLE_NAMES), pos: Math.random(), octave: Math.round(rand(-2, 1)), semi: pick([0, 7, 12, -12] as const),
          level: rand(0.3, 0.8), unison: 1 + Math.floor(Math.random() * 3), detune: rand(0, 35),
        };
    vsynthPatch.noise = { level: Math.random() < 0.7 ? 0 : rand(0.05, 0.3), colour: rand(2000, 14000) };
    vsynthPatch.filter = {
      type: pick(filterTypes) as VPatch["filter"]["type"],
      cutoff: 200 * Math.pow(2, Math.random() * 6),
      res: rand(0.3, 4), env2: rand(-0.4, 0.8), track: rand(0, 0.6),
    };
    vsynthPatch.env1 = { a: Math.random() < 0.8 ? rand(0.001, 0.05) : rand(0.1, 1), d: rand(0.05, 1), s: rand(0, 1), r: rand(0.05, 1) };
    vsynthPatch.env2 = { a: rand(0.001, 0.3), d: rand(0.05, 0.8), s: Math.random() < 0.5 ? 0 : rand(0, 0.6), r: rand(0.05, 0.8) };
    vsynthPatch.lfo1 = { shape: pick(lfoShapes) as VPatch["lfo1"]["shape"], rate: rand(0.1, 8) };
    vsynthPatch.lfo2 = { shape: pick(lfoShapes) as VPatch["lfo2"]["shape"], rate: rand(0.1, 6) };
    ensureMatrixSlots();
    const activeSlots = new Set<number>();
    while (activeSlots.size < 1 + Math.floor(Math.random() * 2)) activeSlots.add(Math.floor(Math.random() * vsynthPatch.matrix.length));
    vsynthPatch.matrix.forEach((slot, i) => {
      slot.src = pick(MOD_SRCS); slot.dest = pick(MOD_DESTS);
      slot.amt = activeSlots.has(i) ? rand(-0.6, 0.6) : 0;
    });
    vsynthPatch.macros = vsynthPatch.macros.map(() => Math.random());
    vsynthPatch.volume = rand(0.6, 0.9);
    renderPatchEditor(); saveAll(); audition("C4");
  }
  randomizeBtn.addEventListener("click", randomizePatch);
  loadPresetBtn.addEventListener("click", () => {
    const preset = PRESETS[presetSel.value]; if (!preset) return;
    ctx.checkpoint();
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
  // Patch editor — rebuilt whenever a preset load replaces the patch wholesale.
  const patchBox = el("div", "wa-vpatch");
  // Simple/Advanced — collapses to Wave/Filter/Envelope/Volume for newcomers
  // (CS50 Synth's "only 3 engines" lesson); the class lives on patchBox
  // itself, so it survives renderPatchEditor()'s replaceChildren() rebuilds.
  const simpleBtn = btn("Simple view", "wa-toggle wa-btn-sm");
  let simpleMode = localStorage.getItem("vv_studio_synth_simple") === "1";
  function applySimpleMode(): void {
    patchBox.classList.toggle("wa-simple", simpleMode);
    simpleBtn.textContent = simpleMode ? "Advanced view" : "Simple view";
    simpleBtn.classList.toggle("active", simpleMode);
  }
  help(simpleBtn, "Collapse the patch editor to Wave, Filter, Envelope and Volume, or show the full mod matrix and macros.");
  simpleBtn.addEventListener("click", () => {
    simpleMode = !simpleMode;
    localStorage.setItem("vv_studio_synth_simple", simpleMode ? "1" : "0");
    applySimpleMode();
  });
  applySimpleMode();
  presetBrowserRow.append(presetSearch, presetCategoryRow);
  presetRow.append(el("span", "wa-lbl", "PRESET"), presetSel, loadPresetBtn, auditionBtn, randomizeBtn, simpleBtn);
  // Live oscilloscope — taps synthGain via an analyser. Stays a flat line
  // until audio has actually started (ensureNodes() runs on first pad/key
  // press), matching the rest of the app's "audio starts on first click" rule.
  const scopeCanvas = document.createElement("canvas"); scopeCanvas.className = "wa-scope";
  let scopeAnalyser: AnalyserNode | null = null;
  function drawSynthScope(): void {
    requestAnimationFrame(drawSynthScope);
    if (!engine.synthGain) return;
    if (!scopeAnalyser) { scopeAnalyser = ac().createAnalyser(); scopeAnalyser.fftSize = 1024; engine.synthGain.connect(scopeAnalyser); }
    const data = new Uint8Array(scopeAnalyser.fftSize);
    scopeAnalyser.getByteTimeDomainData(data);
    const floats = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) floats[i] = (data[i] - 128) / 128;
    drawScope(scopeCanvas, floats, SCREEN_FG);
  }
  drawSynthScope();
  function renderPatchEditor(): void {
    patchBox.replaceChildren();
    waveRedraws = [];
    modBadgeRefreshers = [];
    const pSlider = (host: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      host.append(sliderRow(label, min, max, get(), step, (v) => { set(v); saveAll(); }));
    };
    // Shows total incoming mod-matrix depth on the one slider it targets
    // (Vital-style knob highlight, simplified to a text badge) instead of
    // only listing it in the separate matrix table below.
    const modBadge = (dest: ModSlot["dest"]): HTMLElement => {
      const badge = el("span", "wa-mod-badge");
      const refresh = () => {
        const depth = vsynthPatch.matrix.filter((s) => s.dest === dest).reduce((sum, s) => sum + Math.abs(s.amt), 0);
        badge.textContent = depth > 0.001 ? `MOD ±${Math.round(depth * 100)}%` : "";
        badge.classList.toggle("active", depth > 0.001);
      };
      modBadgeRefreshers.push(refresh); refresh();
      return badge;
    };
    (["osc1", "osc2"] as const).forEach((key, i) => {
      const o = vsynthPatch[key];
      const box = el("div", "wa-vblock" + (i === 1 ? " wa-advanced-only-block" : ""));
      box.append(el("div", "wa-fx-title", `OSC ${i + 1}`));
      const waveCanvas = document.createElement("canvas"); waveCanvas.className = "wa-wave-mini";
      box.append(waveCanvas);
      const redrawWave = () => drawWavetableStack(waveCanvas, o.table, o.pos);
      waveRedraws.push(redrawWave);
      const tableOptions: Array<[string, string]> = TABLE_NAMES.map((n) => [n, n.toUpperCase()]);
      if (o.table.startsWith("text:")) tableOptions.push([o.table, `TEXT "${o.table.slice(5)}"`]);
      box.append(selRow("Table", tableOptions, o.table, (v) => { o.table = v; saveAll(); redrawWave(); }));
      const oscAdvanced = el("div", "wa-advanced-only");
      const textRow = el("div", "wa-export");
      const textInput = document.createElement("input");
      textInput.type = "text"; textInput.placeholder = "type a word…"; textInput.maxLength = 24;
      const genBtn = btn("Generate", "wa-btn-sm");
      help(genBtn, "Hash the typed text into a unique, reproducible wavetable shape (Vital-style text-to-wavetable).");
      genBtn.addEventListener("click", () => {
        const text = textInput.value.trim(); if (!text) return;
        o.table = `text:${text}`; saveAll(); renderPatchEditor();
      });
      textRow.append(textInput, genBtn);
      oscAdvanced.append(textRow);
      const posRow = sliderRow("Position", 0, 1, o.pos, 0.01, (v) => { o.pos = v; redrawWave(); saveAll(); });
      posRow.append(modBadge(i === 0 ? "pos1" : "pos2"));
      box.append(posRow);
      pSlider(oscAdvanced, "Octave", -2, 2, 1, () => o.octave, (v) => { o.octave = v; });
      pSlider(oscAdvanced, "Semi", -12, 12, 1, () => o.semi, (v) => { o.semi = v; });
      pSlider(box, "Level", 0, 1, 0.01, () => o.level, (v) => { o.level = v; });
      pSlider(oscAdvanced, "Unison", 1, 8, 1, () => o.unison, (v) => { o.unison = v; });
      pSlider(oscAdvanced, "Detune", 0, 100, 1, () => o.detune, (v) => { o.detune = v; });
      box.append(oscAdvanced);
      patchBox.append(box);
      redrawWave();
    });
    const noiseBox = el("div", "wa-vblock wa-advanced-only-block");
    noiseBox.append(el("div", "wa-fx-title", "NOISE"));
    pSlider(noiseBox, "Level", 0, 1, 0.01, () => vsynthPatch.noise.level, (v) => { vsynthPatch.noise.level = v; });
    pSlider(noiseBox, "Colour", 200, 16000, 100, () => vsynthPatch.noise.colour, (v) => { vsynthPatch.noise.colour = v; });
    patchBox.append(noiseBox);
    const filterBox = el("div", "wa-vblock");
    filterBox.append(el("div", "wa-fx-title", "FILTER"));
    filterBox.append(selRow("Type", [["lowpass", "LOW PASS"], ["highpass", "HIGH PASS"], ["bandpass", "BAND PASS"], ["notch", "NOTCH"]], vsynthPatch.filter.type, (v) => { vsynthPatch.filter.type = v as VPatch["filter"]["type"]; saveAll(); }));
    const cutoffRow = sliderRow("Cutoff", 30, 18000, vsynthPatch.filter.cutoff, 10, (v) => { vsynthPatch.filter.cutoff = v; saveAll(); });
    cutoffRow.append(modBadge("cutoff"));
    filterBox.append(cutoffRow);
    const filterAdvanced = el("div", "wa-advanced-only");
    pSlider(filterAdvanced, "Res", 0.1, 12, 0.1, () => vsynthPatch.filter.res, (v) => { vsynthPatch.filter.res = v; });
    pSlider(filterAdvanced, "Env2 amt", -1, 1, 0.01, () => vsynthPatch.filter.env2, (v) => { vsynthPatch.filter.env2 = v; });
    pSlider(filterAdvanced, "Key track", 0, 1, 0.05, () => vsynthPatch.filter.track, (v) => { vsynthPatch.filter.track = v; });
    filterBox.append(filterAdvanced);
    patchBox.append(filterBox);
    // LYSERGIC voice motion (F) — always visible, these are performance knobs
    const motionBox = el("div", "wa-vblock");
    motionBox.append(el("div", "wa-fx-title", "MOTION"));
    pSlider(motionBox, "Glide", 0, 0.5, 0.01, () => vsynthPatch.glide ?? 0, (v) => { vsynthPatch.glide = v; });
    pSlider(motionBox, "Drift", 0, 1, 0.01, () => vsynthPatch.drift ?? 0, (v) => { vsynthPatch.drift = v; });
    pSlider(motionBox, "Vibrato", 0, 1, 0.01, () => vsynthPatch.vibrato ?? 0, (v) => { vsynthPatch.vibrato = v; });
    patchBox.append(motionBox);
    // Envelope: draggable shape (attack peak, decay/sustain point, release
    // end) above the same sliders for precise numeric entry — dragging and
    // sliders both write straight into the same EnvPatch fields and redraw
    // each other. Segment widths are fixed thirds (not literally time-to-
    // scale) so a 5ms attack next to a 3s release is still visible/draggable.
    const ENV_MAX = { a: 2, d: 2, r: 3 };
    (["env1", "env2"] as const).forEach((key, i) => {
      const e = vsynthPatch[key];
      const box = el("div", "wa-vblock" + (i === 1 ? " wa-advanced-only-block" : ""));
      box.append(el("div", "wa-fx-title", i === 0 ? "ENV 1 · AMP" : "ENV 2 · MOD"));
      const envCanvas = document.createElement("canvas"); envCanvas.className = "wa-env-canvas";
      box.append(envCanvas);
      const envPoints = (): Array<[number, number]> => [
        [0, 0],
        [(e.a / ENV_MAX.a) * (1 / 3), 1],
        [1 / 3 + (e.d / ENV_MAX.d) * (1 / 3), 1 - e.s],
        [2 / 3, 1 - e.s],
        [2 / 3 + (e.r / ENV_MAX.r) * (1 / 3), 0],
      ];
      const redrawEnv = () => drawEnvelopeShape(envCanvas, envPoints());
      waveRedraws.push(redrawEnv);
      let dragHandle: 1 | 2 | 4 | null = null;
      const onEnvMove = (event: PointerEvent) => {
        if (!dragHandle) return;
        const rect = envCanvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
        if (dragHandle === 1) e.a = Math.max(0, Math.min(ENV_MAX.a, (x / (1 / 3)) * ENV_MAX.a));
        else if (dragHandle === 2) {
          e.d = Math.max(0.01, Math.min(ENV_MAX.d, ((x - 1 / 3) / (1 / 3)) * ENV_MAX.d));
          e.s = Math.max(0, Math.min(1, y));
        } else if (dragHandle === 4) {
          e.r = Math.max(0.01, Math.min(ENV_MAX.r, ((x - 2 / 3) / (1 / 3)) * ENV_MAX.r));
        }
        redrawEnv();
      };
      envCanvas.addEventListener("pointerdown", (event) => {
        const rect = envCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        dragHandle = x < 1 / 3 ? 1 : x < 2 / 3 ? 2 : 4;
        envCanvas.setPointerCapture(event.pointerId);
        onEnvMove(event);
      });
      envCanvas.addEventListener("pointermove", onEnvMove);
      envCanvas.addEventListener("pointerup", () => { if (dragHandle) saveAll(); dragHandle = null; });
      redrawEnv();
      pSlider(box, "Attack", 0, 2, 0.005, () => e.a, (v) => { e.a = v; redrawEnv(); });
      pSlider(box, "Decay", 0.01, 2, 0.01, () => e.d, (v) => { e.d = v; redrawEnv(); });
      pSlider(box, "Sustain", 0, 1, 0.01, () => e.s, (v) => { e.s = v; redrawEnv(); });
      pSlider(box, "Release", 0.01, 3, 0.01, () => e.r, (v) => { e.r = v; redrawEnv(); });
      patchBox.append(box);
    });
    (["lfo1", "lfo2"] as const).forEach((key, i) => {
      const l = vsynthPatch[key];
      const box = el("div", "wa-vblock wa-advanced-only-block");
      box.append(el("div", "wa-fx-title", `LFO ${i + 1}`));
      box.append(selRow("Shape", [["sine", "SINE"], ["triangle", "TRI"], ["sawtooth", "SAW"], ["square", "SQR"]], l.shape, (v) => { l.shape = v as VPatch["lfo1"]["shape"]; saveAll(); }));
      pSlider(box, "Rate Hz", 0.05, 20, 0.05, () => l.rate, (v) => { l.rate = v; });
      patchBox.append(box);
    });
    const matrixBox = el("div", "wa-vblock wa-vmatrix wa-advanced-only-block");
    matrixBox.append(el("div", "wa-fx-title", "MOD MATRIX"));
    vsynthPatch.matrix.forEach((slot: ModSlot) => {
      const row = el("div", "wa-vmatrix-row");
      const srcSel = document.createElement("select");
      MOD_SRCS.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s.toUpperCase(); srcSel.append(o); });
      srcSel.value = slot.src;
      srcSel.addEventListener("change", () => { slot.src = srcSel.value as ModSlot["src"]; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); });
      const destSel = document.createElement("select");
      MOD_DESTS.forEach((d) => { const o = document.createElement("option"); o.value = d; o.textContent = d.toUpperCase(); destSel.append(o); });
      destSel.value = slot.dest;
      destSel.addEventListener("change", () => { slot.dest = destSel.value as ModSlot["dest"]; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); });
      row.append(srcSel, el("span", "wa-lbl", "→"), destSel);
      row.append(sliderRow("Amt", -1, 1, slot.amt, 0.01, (v) => { slot.amt = v; saveAll(); modBadgeRefreshers.forEach((fn) => fn()); }));
      matrixBox.append(row);
    });
    patchBox.append(matrixBox);
    const macroBox = el("div", "wa-vblock");
    macroBox.append(el("div", "wa-fx-title", "MACROS — map via matrix"));
    pSlider(macroBox, "Volume", 0, 1, 0.01, () => vsynthPatch.volume, (v) => { vsynthPatch.volume = v; });
    const macroAdvanced = el("div", "wa-advanced-only");
    ["Macro 1", "Macro 2", "Macro 3", "Macro 4"].forEach((name, i) => {
      pSlider(macroAdvanced, name, 0, 1, 0.01, () => vsynthPatch.macros[i] ?? 0, (v) => { vsynthPatch.macros[i] = v; });
    });
    macroBox.append(macroAdvanced);
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
  // Piano roll v2 — canvas Cubase-style editor, extracted to roll.ts (C3).
  const roll = buildRoll({ audition, saveAll });
  const { pianoRoll, rollPlayheadBar, paintRoll } = roll;
  const synthKeys = el("div", "wa-keys");
  let octaveShift = 0;
  const octaveLabel = el("span", "wa-status", "OCT 0");
  function setOctaveShift(v: number): void {
    octaveShift = Math.max(-3, Math.min(3, v));
    octaveLabel.textContent = `OCT ${octaveShift >= 0 ? "+" : ""}${octaveShift}`;
  }
  buildKeys(synthKeys,
    (note) => {
      ensureNodes();
      const n = midiToNote(noteToMidi(note) + octaveShift * 12);
      liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, n);
      recordSynthOn(n);
    },
    (note) => {
      const n = midiToNote(noteToMidi(note) + octaveShift * 12);
      liveKeys.noteOff(ac(), n);
      recordSynthOff(n);
    });
  // Live key recording — notes land in the playing synth clip's piano roll,
  // snapped to the nearest step. Same target rule as pad recording.
  const keysRecBtn = btn("● Rec", "wa-toggle wa-btn-sm");
  let synthRec = false;
  const heldRec = new Map<string, number>();   // note -> start step
  function currentStepFloat(): number {
    if (!playhead.playing || playhead.lastHi < 0) return -1;
    return playhead.lastHi + Math.min(1, (performance.now() - playhead.lastStepStartedMs) / (stepDur() * 1000));
  }
  function synthRecTarget(): number { return (playhead.playing ? clip.play.synth : null) ?? clip.sel; }
  // Unquantized capture (C3): notes land exactly where they were played;
  // set the transport Grid to quantize instead.
  function recordSynthOn(note: string): void {
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    heldRec.set(note, pos % STEPS);
  }
  function recordSynthOff(note: string): void {
    const start = heldRec.get(note); if (start === undefined) return;
    heldRec.delete(note);
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    let len = pos % STEPS - start;
    if (len <= 0) len += STEPS;
    len = Math.max(0.25, Math.min(STEPS - start, len));
    const target = synthRecTarget();
    synthNotes[target].push({ note, step: start, len, vel: 100 });
    if (target === clip.sel) paintRoll();
    saveAll();
  }
  keysRecBtn.addEventListener("click", () => {
    synthRec = !synthRec;
    if (synthRec) ctx.checkpoint();
    keysRecBtn.classList.toggle("active", synthRec);
  });
  help(keysRecBtn, "Capture key presses into the playing synth clip's piano roll while playback runs. Arm Count-in in the transport for a 1-bar lead-in.");
  const holdBtn = btn("Hold", "wa-toggle wa-btn-sm");
  help(holdBtn, "Latch mode — tap a key to hold its note, tap again to release. Drones on while you tweak the patch.");
  holdBtn.addEventListener("click", () => {
    const on = !holdBtn.classList.contains("active");
    holdBtn.classList.toggle("active", on);
    setKeysLatch(on);
  });
  const keysHeader = el("div", "wa-export");
  keysHeader.append(el("span", "wa-lbl", "KEYS — click, or Z-row / Q-row on the keyboard (− / = shift octave)"), keysRecBtn, holdBtn, octaveLabel);
  // Roll, keys and the keys header live on the KEYS page — layout.ts houses
  // them; appending them here too would just steal them back at boot.
  // Scope lives in the side column beside the XY field (G) — it was a dead
  // black strip up here when nothing played.
  synthPanel.append(
    presetBrowserRow,
    presetRow,
    patchBox,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "CHORD PLAYER"), chordRow,
  );


  // ── XY morph field + performance (xyfield.ts, F) ──
  const xy = buildXYField({
    onLight: () => waveRedraws.forEach((fn) => fn()),
    onCommit: () => renderPatchEditor(),
    onSilence: () => { liveKeys.releaseAll(ac()); setKeysLatch(false); },
  });
  waveRedraws.push(xy.syncFromPatch);

  return {
    synthPanel, synthKeys, liveKeys, rollPlayheadBar, paintRoll, renderPatchEditor,
    recordSynthOn, recordSynthOff,
    isSynthRec: () => synthRec,
    setOctaveShift, getOctaveShift: () => octaveShift,
    waveRedraws: () => waveRedraws,
    presetRow, pianoRoll, keysHeader,
    xyPanel: xy.root,
    scope: scopeCanvas,
  };
}
