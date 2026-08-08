// Synth: VV-1 wavetable — patch editor (presets, randomize, simple mode,
// scope), DOM piano roll, on-screen keys, key recording. Extracted verbatim
// from index.ts (Phase 0 split). Playhead state reads from ctx.playhead
// (already rewired before the cut).
import { STEPS, SCENE_LABELS, ROLL_NOTES, clip, transport, stepDur, patternStepDur, mpc, activeSynth, synthLaneNotes, patternLengths, vsynthPatch } from "./state";
import type { VNote } from "./state";
import { ac, ensureNodes } from "./engine";
import * as engine from "./engine";
import { playNote, LiveVoices, PRESETS, PRESET_CATEGORIES, TABLE_NAMES, MOD_SRCS, MOD_DESTS, sampleWaveform, noteToMidi, midiToNote } from "./vsynth";
import type { ModSlot, VPatch } from "./vsynth";
import { saveAll } from "./persistence";
import { el, btn, help, sliderRow, drawScope, drawEnvelopeShape, download, askText, SCREEN_BG, SCREEN_FG, screenRgba } from "./helpers";
import { ctx, playhead, gridRepainters, isGridLine, stepsPerGridLine } from "./ctx";
import { showVelocityPopup } from "./velpopup";
import { buildKeys, setKeysLatch } from "./keys";
import type { KeyMods } from "./keys";
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
  /** chord player card — side column filler (H) */
  chordPanel: HTMLElement;
}

// Stacked wavetable wireframe (Serum-style): the table's slices drawn as
// perspective-offset polylines, the slice under the POSITION knob lit with a
// phosphor halo, neighbours ghosted by distance. Pure look — audio path untouched.
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
    g.strokeStyle = isCurrent ? SCREEN_FG : screenRgba(0.08 + 0.16 * (1 - Math.abs(t - pos)));
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
  const userPatchKey = "vv_studio_user_patches";
  let userPatches: Record<string, VPatch> = {};
  try { userPatches = JSON.parse(localStorage.getItem(userPatchKey) || "{}"); } catch { userPatches = {}; }
  const persistUserPatches = () => localStorage.setItem(userPatchKey, JSON.stringify(userPatches));
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
    Object.keys(userPatches).sort().forEach((name) => {
      if (query && !name.toLowerCase().includes(query)) return;
      const o = document.createElement("option"); o.value = `user:${name}`; o.textContent = `★ ${name}`; presetSel.append(o);
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
  const savePatchBtn = btn("＋ Save", "wa-btn-sm");
  const deletePatchBtn = btn("Delete", "wa-btn-sm");
  const exportPatchBtn = btn("↓ Patch", "wa-btn-sm");
  const importPatchBtn = btn("↑ Patch", "wa-btn-sm");
  const patchInput = document.createElement("input"); patchInput.type = "file"; patchInput.accept = ".json,application/json"; patchInput.hidden = true;
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
    const preset = presetSel.value.startsWith("user:") ? userPatches[presetSel.value.slice(5)] : PRESETS[presetSel.value]; if (!preset) return;
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
  savePatchBtn.addEventListener("click", async () => {
    const name = await askText("Save patch", `${activeSynth.lane} patch`); if (!name) return;
    userPatches[name] = JSON.parse(JSON.stringify(vsynthPatch)); persistUserPatches(); refreshPresetOptions(); presetSel.value = `user:${name}`;
  });
  deletePatchBtn.addEventListener("click", () => {
    if (!presetSel.value.startsWith("user:")) return;
    delete userPatches[presetSel.value.slice(5)]; persistUserPatches(); refreshPresetOptions();
  });
  exportPatchBtn.addEventListener("click", () => download(`vishamp-${activeSynth.lane}-patch.json`, new Blob([JSON.stringify({ format: "vishamp-patch", version: 1, patch: vsynthPatch }, null, 2)], { type: "application/json" })));
  importPatchBtn.addEventListener("click", () => patchInput.click());
  patchInput.addEventListener("change", async () => {
    const file = patchInput.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { patch?: VPatch } | VPatch;
      const incoming = "patch" in parsed ? parsed.patch : parsed; if (!incoming || typeof incoming !== "object") return;
      Object.assign(vsynthPatch, JSON.parse(JSON.stringify(incoming))); ensureMatrixSlots(); renderPatchEditor(); saveAll();
    } catch { /* invalid imports leave the active patch untouched */ }
    patchInput.value = "";
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
  presetRow.append(el("span", "wa-lbl", "PRESET"), presetSel, loadPresetBtn, savePatchBtn, deletePatchBtn, exportPatchBtn, importPatchBtn, patchInput, auditionBtn, randomizeBtn, simpleBtn);
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
      // CV-80 quick picks: the four classic shapes are positions on the basic
      // table, so these jump straight there without leaving the wavetable model.
      const waveRow = el("div", "wa-waveselect");
      const SHAPES: Array<[string, number, string]> = [
        ["sine", 0, "M1 7 Q5.5 -1 9 7 T17 7"],
        ["triangle", 1 / 3, "M1 11 L5.5 3 L11 11 L17 3"],
        ["sawtooth", 2 / 3, "M1 12 L9 3 L9 12 L17 3"],
        ["square", 1, "M1 12 L1 3 L9 3 L9 12 L17 12 L17 3"],
      ];
      const paintWaveBtns = (): void => {
        Array.from(waveRow.children).forEach((child, idx) => {
          const [, pos] = SHAPES[idx];
          child.classList.toggle("on", o.table === "basic" && Math.abs(o.pos - pos) < 0.02);
        });
      };
      SHAPES.forEach(([name, pos, path]) => {
        const b = el("button", "wa-wbtn") as HTMLButtonElement;
        b.type = "button"; b.title = name; b.setAttribute("aria-label", name);
        b.innerHTML = `<svg viewBox="0 0 18 14" aria-hidden="true"><path d="${path}"/></svg>`;
        b.addEventListener("click", () => {
          o.table = "basic"; o.pos = pos; saveAll(); redrawWave(); paintWaveBtns();
          const tableSel = box.querySelector<HTMLSelectElement>("select"); if (tableSel) tableSel.value = "basic";
        });
        waveRow.append(b);
      });
      box.append(waveRow);
      const tableOptions: Array<[string, string]> = TABLE_NAMES.map((n) => [n, n.toUpperCase()]);
      if (o.table.startsWith("text:")) tableOptions.push([o.table, `TEXT "${o.table.slice(5)}"`]);
      box.append(selRow("Table", tableOptions, o.table, (v) => { o.table = v; saveAll(); redrawWave(); paintWaveBtns(); }));
      paintWaveBtns();
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
    (note, clickMods) => {
      ensureNodes();
      // armed toggles OR the click modifier — either route reaches the same place
      const mods: KeyMods = {
        accent: clickMods?.accent || armedMods.accent,
        slide: clickMods?.slide || armedMods.slide,
      };
      const n = midiToNote(noteToMidi(note) + octaveShift * 12);
      // A slid key glides in like a 303 tie; an accent hits harder and brighter.
      const patch = mods?.slide && (vsynthPatch.glide ?? 0) < 0.08
        ? { ...vsynthPatch, glide: 0.08 } as typeof vsynthPatch
        : vsynthPatch;
      liveKeys.noteOn(ac(), engine.synthGain!, patch, n, mods?.accent ? 122 : 105);
      recordSynthOn(n, mods);
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
    return playhead.lastHi + Math.min(1, (performance.now() - playhead.lastStepStartedMs) / (patternStepDur(synthRecTarget()) * 1000));
  }
  function synthRecTarget(): number { return (playhead.playing ? clip.play.synth : null) ?? clip.sel; }
  // Unquantized capture (C3): notes land exactly where they were played;
  // set the transport Grid to quantize instead.
  // Expression captured at note-on rides through to the recorded note, so a
  // shift-click on a key writes an accented note and alt-click a slide.
  /** Armed by the ACCENT / SLIDE keys beside HOLD; ORed with click modifiers. */
  const armedMods: KeyMods = { accent: false, slide: false };
  const recMods = new Map<string, KeyMods>();
  function recordSynthOn(note: string, mods?: KeyMods): void {
    if (mods?.accent || mods?.slide) recMods.set(note, mods); else recMods.delete(note);
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    heldRec.set(note, pos % patternLengths[synthRecTarget()]);
  }
  function recordSynthOff(note: string): void {
    const start = heldRec.get(note); if (start === undefined) return;
    heldRec.delete(note);
    if (!synthRec || !playhead.playing) return;
    const pos = currentStepFloat(); if (pos < 0) return;
    const patternLength = patternLengths[synthRecTarget()];
    let len = pos % patternLength - start;
    if (len <= 0) len += patternLength;
    len = Math.max(0.25, Math.min(patternLength - start, len));
    const target = synthRecTarget();
    const mods = recMods.get(note); recMods.delete(note);
    synthLaneNotes[activeSynth.lane][target].push({
      note, step: start, len, vel: mods?.accent ? 122 : 100,
      accent: !!mods?.accent, slide: !!mods?.slide,
    });
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
  const midiBtn = btn("MIDI", "wa-toggle wa-btn-sm");
  help(midiBtn, "Connect every available Web MIDI input to the active synth lane.");
  midiBtn.addEventListener("click", async () => {
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<{ inputs: Map<unknown, { onmidimessage: ((event: { data: Uint8Array }) => void) | null }> }> };
    if (!nav.requestMIDIAccess) { midiBtn.textContent = "MIDI unavailable"; return; }
    try {
      const access = await nav.requestMIDIAccess();
      access.inputs.forEach((input) => { input.onmidimessage = (event) => {
        if (!event.data) return;
        const [status, midi, velocity] = event.data, command = status & 0xf0, note = midiToNote(midi);
        if (command === 0x90 && velocity > 0) { ensureNodes(); liveKeys.noteOn(ac(), engine.synthGain!, vsynthPatch, note, velocity); recordSynthOn(note); }
        else if (command === 0x80 || (command === 0x90 && velocity === 0)) { liveKeys.noteOff(ac(), note); recordSynthOff(note); }
      }; });
      midiBtn.classList.add("active"); midiBtn.textContent = `MIDI ${access.inputs.size}`;
    } catch { midiBtn.textContent = "MIDI blocked"; }
  });
  // Accent and slide had no visible affordance at all — shift-click and
  // alt-click were the only way in, and you had to hover a tooltip to learn
  // they existed. These arm the same KeyMods path; the modifiers still work
  // as the fast path for anyone who knows them.
  const accentArm = btn("Accent", "wa-toggle wa-btn-sm");
  const slideArm = btn("Slide", "wa-toggle wa-btn-sm");
  help(accentArm, "Arm accent — played notes hit harder and brighter. Shift-click a key does the same for one note.");
  help(slideArm, "Arm slide — played notes glide in from the previous pitch. Alt-click a key does the same for one note.");
  accentArm.addEventListener("click", () => { armedMods.accent = !armedMods.accent; accentArm.classList.toggle("active", armedMods.accent); });
  slideArm.addEventListener("click", () => { armedMods.slide = !armedMods.slide; slideArm.classList.toggle("active", armedMods.slide); });

  const keysHeader = el("div", "wa-export");
  keysHeader.append(el("span", "wa-lbl", "KEYS — click, or Z-row / Q-row on the keyboard (− / = shift octave)"), keysRecBtn, holdBtn, accentArm, slideArm, midiBtn, octaveLabel);
  // Roll, keys and the keys header live on the KEYS page — layout.ts houses
  // them; appending them here too would just steal them back at boot.
  // Scope + chord player live in the side column beside the XY field (G/H) —
  // both were dead space up here.
  synthPanel.append(presetBrowserRow, presetRow, patchBox);
  const chordPanel = el("div", "wa-xy-wrap");
  chordPanel.append(el("div", "wa-fx-title", "CHORD PLAYER"), chordRow);


  // ── XY morph field + performance (xyfield.ts, F) ──
  const xy = buildXYField({
    onLight: () => waveRedraws.forEach((fn) => fn()),
    onCommit: () => renderPatchEditor(),
    onSilence: () => { liveKeys.releaseAll(ac()); setKeysLatch(false); },
  });
  waveRedraws.push(xy.syncFromPatch);
  window.addEventListener("vv-synth-lane-change", () => {
    ensureMatrixSlots(); renderPatchEditor(); xy.syncFromPatch();
  });

  return {
    synthPanel, synthKeys, liveKeys, rollPlayheadBar, paintRoll, renderPatchEditor,
    recordSynthOn, recordSynthOff,
    isSynthRec: () => synthRec,
    setOctaveShift, getOctaveShift: () => octaveShift,
    waveRedraws: () => waveRedraws,
    presetRow, pianoRoll, keysHeader,
    xyPanel: xy.root,
    scope: scopeCanvas,
    chordPanel,
  };
}
