import "../../styles/studio.css";

// VishAmp Studio — Winamp-styled mini-DAW. Additions over v1: per-drum sound
// design panels, 4-pattern slots, per-step velocity, synth LFO with global
// filter, global reverb, updated save format. Pure Web Audio, CSP-clean.

// ─── Types ───────────────────────────────────────────────────────────────────
interface DrumP {
  pitch: number;      // tone start Hz
  pitchEnd: number;   // tone end Hz
  decay: number;      // seconds
  filter: number;     // noise HPF/BPF Hz
  toneLevel: number;  // 0–1 tone layer mix (snare, rim)
  spread: number;     // clap stagger ms
}
interface ParamSpec {
  key: keyof DrumP; label: string; min: number; max: number; step: number; unit?: string;
}

// ─── Drum defaults & param specs ─────────────────────────────────────────────
const DP_DEF: DrumP[] = [
  { pitch: 150, pitchEnd: 50,  decay: 0.50, filter: 0,    toneLevel: 0,   spread: 0  }, // Kick
  { pitch: 180, pitchEnd: 180, decay: 0.18, filter: 500,  toneLevel: 0.3, spread: 0  }, // Snare
  { pitch: 0,   pitchEnd: 0,   decay: 0.08, filter: 8000, toneLevel: 0,   spread: 0  }, // HH Cl
  { pitch: 0,   pitchEnd: 0,   decay: 0.30, filter: 5000, toneLevel: 0,   spread: 0  }, // HH Op
  { pitch: 0,   pitchEnd: 0,   decay: 0.06, filter: 1200, toneLevel: 0,   spread: 25 }, // Clap
  { pitch: 120, pitchEnd: 60,  decay: 0.40, filter: 0,    toneLevel: 0,   spread: 0  }, // Tom
  { pitch: 400, pitchEnd: 400, decay: 0.06, filter: 5000, toneLevel: 0.4, spread: 0  }, // Rim
  { pitch: 0,   pitchEnd: 0,   decay: 1.20, filter: 3000, toneLevel: 0,   spread: 0  }, // Crash
];
const dp: DrumP[] = DP_DEF.map((d) => ({ ...d }));

const DP_SPECS: ParamSpec[][] = [
  [{ key:"pitch",    label:"Punch",  min:40,   max:400,   step:5,    unit:"Hz" },
   { key:"pitchEnd", label:"Body",   min:20,   max:150,   step:5,    unit:"Hz" },
   { key:"decay",    label:"Decay",  min:0.1,  max:2.0,   step:0.05, unit:"s"  }],
  [{ key:"filter",    label:"Snap",   min:200,  max:5000,  step:50,   unit:"Hz" },
   { key:"decay",     label:"Decay",  min:0.05, max:0.5,   step:0.01, unit:"s"  },
   { key:"toneLevel", label:"Body",   min:0,    max:1,     step:0.05            }],
  [{ key:"filter", label:"Bite",  min:4000, max:18000, step:200,  unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.01, max:0.25,  step:0.005,unit:"s"  }],
  [{ key:"filter", label:"Bite",  min:2000, max:12000, step:200,  unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.1,  max:1.2,   step:0.02, unit:"s"  }],
  [{ key:"filter", label:"Crack",  min:500,  max:5000,  step:100,  unit:"Hz" },
   { key:"decay",  label:"Decay",  min:0.02, max:0.2,   step:0.005,unit:"s"  },
   { key:"spread", label:"Spread", min:0,    max:40,    step:2,    unit:"ms" }],
  [{ key:"pitch",    label:"High",  min:60,  max:400, step:5,    unit:"Hz" },
   { key:"pitchEnd", label:"Low",   min:30,  max:200, step:5,    unit:"Hz" },
   { key:"decay",    label:"Decay", min:0.1, max:1.5, step:0.05, unit:"s"  }],
  [{ key:"pitch",     label:"Tone",  min:200, max:800,  step:20,   unit:"Hz" },
   { key:"toneLevel", label:"Body",  min:0,   max:1,    step:0.05            },
   { key:"decay",     label:"Decay", min:0.02,max:0.15, step:0.005,unit:"s"  }],
  [{ key:"filter", label:"Tone",  min:1000, max:8000, step:100, unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.3,  max:4.0,  step:0.1, unit:"s"  }],
];

// ─── Audio graph ─────────────────────────────────────────────────────────────
let AC: AudioContext | null = null;
let master: GainNode | null = null;
const trackGain: GainNode[] = [];
let synthGain: GainNode | null = null;
let synthFilter: BiquadFilterNode | null = null;
let reverbConv: ConvolverNode | null = null;
let reverbWetGain: GainNode | null = null;

function ac(): AudioContext {
  if (!AC) {
    AC = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.8;
    master.connect(AC.destination);
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function ensureNodes(): void {
  const a = ac();
  if (trackGain.length) return;
  for (let i = 0; i < 8; i++) {
    const g = a.createGain(); g.gain.value = 0.8; g.connect(master!); trackGain.push(g);
  }
  synthFilter = a.createBiquadFilter();
  synthFilter.type = "lowpass"; synthFilter.frequency.value = synth.cutoff; synthFilter.Q.value = synth.q;
  synthGain = a.createGain(); synthGain.gain.value = 0.7;
  synthGain.connect(synthFilter); synthFilter.connect(master!);
}
function initReverb(wet: number): void {
  const a = ac();
  if (!reverbConv) {
    const sr = a.sampleRate, len = Math.floor(sr * 2.2);
    const ir = a.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4.0);
    }
    reverbConv = a.createConvolver(); reverbConv.buffer = ir;
    reverbWetGain = a.createGain(); reverbWetGain.gain.value = wet;
    // Parallel wet path off master (master already routes to destination)
    master!.connect(reverbConv); reverbConv.connect(reverbWetGain); reverbWetGain.connect(a.destination);
  } else {
    reverbWetGain!.gain.value = wet;
  }
}

// ─── Drum synthesis ───────────────────────────────────────────────────────────
function noiseSrc(a: BaseAudioContext, dur: number): AudioBufferSourceNode {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf; return src;
}
function dNoise(a: BaseAudioContext, out: AudioNode, vol: number, hp: number, dur: number, when: number, type: BiquadFilterType = "highpass", q = 0): void {
  const src = noiseSrc(a, dur);
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = hp; if (q) f.Q.value = q;
  const g = a.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f); f.connect(g); g.connect(out); src.start(when); src.stop(when + dur);
}
function dTone(a: BaseAudioContext, out: AudioNode, vol: number, f0: number, f1: number, dur: number, when: number, type: OscillatorType = "sine"): void {
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, when);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), when + dur);
  g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(out); o.start(when); o.stop(when + dur);
}
function metroClick(a: BaseAudioContext, out: AudioNode, when: number, accent: boolean): void {
  const o = a.createOscillator(); const g = a.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  o.connect(g); g.connect(out); o.start(when); o.stop(when + 0.05);
}

const DRUMS = ["Kick", "Snare", "HH Cl", "HH Op", "Clap", "Tom", "Rim", "Crash"];
function playDrum(a: BaseAudioContext, out: AudioNode, r: number, vol: number, when: number): void {
  const p = dp[r];
  switch (r) {
    case 0: // Kick: tone sweep + transient click
      dTone(a, out, vol, p.pitch, p.pitchEnd, p.decay, when);
      dTone(a, out, vol * 0.25, p.pitch * 3, p.pitch * 3, 0.004, when, "square");
      break;
    case 1: // Snare: noise + optional tone body
      dNoise(a, out, vol, p.filter, p.decay, when);
      if (p.toneLevel > 0) dTone(a, out, vol * p.toneLevel, p.pitch, p.pitch * 0.5, p.decay * 0.7, when);
      break;
    case 2: dNoise(a, out, vol, p.filter, p.decay, when); break;           // HH Cl
    case 3: dNoise(a, out, vol, p.filter, p.decay, when); break;           // HH Op
    case 4: // Clap: staggered noise bursts
      for (let i = 0; i < 3; i++) dNoise(a, out, vol * 0.9, p.filter, p.decay, when + i * (p.spread / 1000), "bandpass", 0.5);
      break;
    case 5: dTone(a, out, vol, p.pitch, p.pitchEnd, p.decay, when); break; // Tom
    case 6: // Rim: triangle tone + noise
      dTone(a, out, vol * p.toneLevel, p.pitch, p.pitch, 0.06, when, "triangle");
      dNoise(a, out, vol * (1 - p.toneLevel) * 0.6, p.filter, 0.06, when);
      break;
    case 7: dNoise(a, out, vol * 0.6, p.filter, p.decay, when); break;    // Crash
  }
}

// ─── Synth ────────────────────────────────────────────────────────────────────
const synth = { osc: "sawtooth" as OscillatorType, cutoff: 2200, q: 4, attack: 0.01, release: 0.3 };
const lfo = { rate: 3, depth: 0, target: "filter" as "filter" | "pitch", phase: 0, timer: 0 };
const activeN = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
const SEMI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note); if (!m) return 440;
  const n = SEMI.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}
function noteOn(note: string): void {
  ensureNodes(); if (activeN.has(note)) return;
  const a = ac(), osc = a.createOscillator(), g = a.createGain();
  osc.type = synth.osc; osc.frequency.value = freq(note);
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(0.4, a.currentTime + synth.attack);
  osc.connect(g); g.connect(synthFilter ?? synthGain!); osc.start();
  activeN.set(note, { osc, gain: g });
}
function noteOff(note: string): void {
  const n = activeN.get(note); if (!n) return;
  const a = ac();
  n.gain.gain.cancelScheduledValues(a.currentTime);
  n.gain.gain.setValueAtTime(n.gain.gain.value, a.currentTime);
  n.gain.gain.linearRampToValueAtTime(0.0001, a.currentTime + synth.release);
  n.osc.stop(a.currentTime + synth.release + 0.05); activeN.delete(note);
}
function startLFO(): void {
  if (lfo.timer) return;
  lfo.timer = window.setInterval(() => {
    if (!AC || lfo.depth === 0) return;
    lfo.phase += (lfo.rate / 60) * Math.PI * 2;
    const mod = Math.sin(lfo.phase);
    if (lfo.target === "filter" && synthFilter) {
      synthFilter.frequency.value = synth.cutoff * (1 + mod * lfo.depth * 0.9);
    } else if (lfo.target === "pitch") {
      activeN.forEach(({ osc }) => { osc.detune.value = mod * lfo.depth * 100; });
    }
  }, 1000 / 60);
}

// ─── State ────────────────────────────────────────────────────────────────────
const STEPS = 16;
const NUM_PATS = 4;
const PAT_LABELS = ["A", "B", "C", "D"];
let bpm = 120, swing = 0, metro = false, curPat = 0;
const allPats: boolean[][][] = Array.from({ length: NUM_PATS }, () => DRUMS.map(() => new Array(STEPS).fill(false)));
const allVels: number[][][] = Array.from({ length: NUM_PATS }, () => DRUMS.map(() => new Array(STEPS).fill(100)));
const mute = new Array(8).fill(false);
const solo = new Array(8).fill(false);
function pat(): boolean[][] { return allPats[curPat]; }
function audible(r: number): boolean { const s = solo.some(Boolean); return !mute[r] && (!s || solo[r]); }
const stepDur = (): number => 60 / bpm / 4;

// ─── Persistence ─────────────────────────────────────────────────────────────
function saveAll(): void {
  try {
    localStorage.setItem("vv_studio_v2", JSON.stringify({
      pats: allPats.map((p) => p.map((r) => r.map((b) => (b ? 1 : 0)))),
      vels: allVels,
      dp,
      bpm,
      curPat,
    }));
  } catch { /* ignore */ }
}
function loadAll(): void {
  try {
    const raw = localStorage.getItem("vv_studio_v2") || localStorage.getItem("vv_studio_pattern");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.pats) {
      (saved.pats as number[][][]).forEach((pp, pi) => {
        if (pi >= NUM_PATS) return;
        pp.forEach((row, ri) => { if (ri < 8) row.forEach((v, ci) => { if (ci < STEPS) allPats[pi][ri][ci] = !!v; }); });
      });
      if (saved.vels) (saved.vels as number[][][]).forEach((pp, pi) => {
        if (pi >= NUM_PATS) return;
        pp.forEach((row, ri) => { if (ri < 8) row.forEach((v, ci) => { if (ci < STEPS) allVels[pi][ri][ci] = v; }); });
      });
      if (saved.dp) (saved.dp as Partial<DrumP>[]).forEach((d, i) => { if (i < 8) Object.assign(dp[i], d); });
      if (saved.bpm) bpm = saved.bpm;
      if (typeof saved.curPat === "number") curPat = saved.curPat;
    } else if (Array.isArray(saved) && saved.length === 8) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) allPats[0][r][c] = !!saved[r][c];
    }
  } catch { /* ignore */ }
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function btn(label: string, extra = ""): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button";
  b.className = ("wa-btn " + extra).trim(); b.textContent = label; return b;
}
function sliderRow(label: string, min: number, max: number, val: number, step: number, on: (v: number) => void): HTMLElement {
  const row = el("div", "wa-slider-row");
  row.append(el("span", "wa-lbl", label));
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val); inp.className = "wa-slider";
  const out = el("span", "wa-val", String(val));
  inp.addEventListener("input", () => { const v = Number(inp.value); out.textContent = String(v); on(v); });
  row.append(inp, out); return row;
}
function mixChannel(name: string, val: number, on: (v: number) => void, idx: number): HTMLElement {
  const ch = el("div", "wa-ch");
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = "0"; inp.max = "1"; inp.step = "0.01"; inp.value = String(val); inp.className = "wa-fader";
  inp.addEventListener("input", () => on(Number(inp.value))); ch.append(inp);
  if (idx >= 0) {
    const ms = el("div", "wa-ms");
    const m = btn("M", "wa-mute"); m.classList.remove("wa-btn");
    m.addEventListener("click", () => { mute[idx] = !mute[idx]; m.classList.toggle("active", mute[idx]); });
    const s = btn("S", "wa-solo"); s.classList.remove("wa-btn");
    s.addEventListener("click", () => { solo[idx] = !solo[idx]; s.classList.toggle("active", solo[idx]); });
    ms.append(m, s); ch.append(ms);
  }
  ch.append(el("span", "wa-ch-name", name)); return ch;
}
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function initStudio(): void {
  const root = document.getElementById("studio");
  if (!root) return;

  loadAll();

  const win = el("div", "wa-win");
  const titleBar = el("div", "wa-title");
  titleBar.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), el("span", "wa-title-dots"));
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", `${bpm} BPM`);
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  lcd.append(lcdBpm, lcdState);

  // ── Transport ──
  const transport = el("div", "wa-transport");
  const playBtn = btn("▶"), stopBtn = btn("■");
  const bpmDown = btn("–", "wa-btn-sm"), bpmUp = btn("+", "wa-btn-sm");
  const bpmLabel = el("span", "wa-bpm", String(bpm));
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), rotBtn = btn("⤢ Flip", "wa-btn-sm");
  transport.append(playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmLabel, bpmUp, el("span", "wa-sep"), swingWrap, metroBtn, el("span", "wa-sep"), rotBtn);

  // ── Tabs ──
  const tabbar = el("div", "wa-tabs"), panels = el("div", "wa-panels");
  const tabNames = ["Beat", "Synth", "Mixer", "Export"];
  const tabBtns: HTMLElement[] = [], panelEls: HTMLElement[] = [];
  let activeTab = 0;
  tabNames.forEach((t, i) => {
    const b = btn(t, "wa-tab"); b.classList.remove("wa-btn");
    b.addEventListener("click", () => { activeTab = i; paintTabs(); });
    tabBtns.push(b); tabbar.append(b);
  });
  function paintTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle("active", i === activeTab));
    panelEls.forEach((p, i) => { p.style.display = i === activeTab ? "block" : "none"; });
  }

  // ── Shared velocity popup ──
  const velPopup = el("div", "wa-vel-popup");
  velPopup.style.display = "none";
  const velSlider = document.createElement("input");
  velSlider.type = "range"; velSlider.min = "1"; velSlider.max = "127"; velSlider.step = "1"; velSlider.className = "wa-vel-slider";
  const velLabel = el("span", "wa-vel-num", "100");
  velPopup.append(el("span", "wa-lbl", "VEL"), velSlider, velLabel);
  document.body.append(velPopup);
  let velTarget: { r: number; c: number; cell: HTMLElement } | null = null;
  velSlider.addEventListener("input", () => {
    const v = Number(velSlider.value); velLabel.textContent = String(v);
    if (velTarget) { allVels[curPat][velTarget.r][velTarget.c] = v; setCellOpacity(velTarget.cell, v); saveAll(); }
  });
  document.addEventListener("click", (e) => { if (!velPopup.contains(e.target as Node)) velPopup.style.display = "none"; });
  function setCellOpacity(cell: HTMLElement, v: number): void { cell.style.opacity = String(0.45 + 0.55 * (v / 127)); }
  function showVelPopup(r: number, c: number, cell: HTMLElement, x: number, y: number): void {
    velTarget = { r, c, cell };
    const v = allVels[curPat][r][c]; velSlider.value = String(v); velLabel.textContent = String(v);
    velPopup.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    velPopup.style.top = `${Math.max(y - 54, 4)}px`;
    velPopup.style.display = "flex";
  }

  // ── Beat ──
  const beat = el("div", "wa-panel");

  // Pattern selector row
  const patRow = el("div", "wa-pat-row");
  patRow.append(el("span", "wa-lbl", "Pattern"));
  const patBtns: HTMLButtonElement[] = [];
  PAT_LABELS.forEach((label, pi) => {
    const pb = btn(label, "wa-pat-btn" + (pi === curPat ? " active" : "")); pb.classList.remove("wa-btn");
    pb.addEventListener("click", () => {
      curPat = pi; patBtns.forEach((b, i) => b.classList.toggle("active", i === pi));
      cells.forEach((row, r) => row.forEach((cell, c) => {
        const on = allPats[curPat][r][c]; cell.classList.toggle("on", on);
        if (on) setCellOpacity(cell, allVels[curPat][r][c]); else cell.style.opacity = "";
      }));
      saveAll();
    });
    patBtns.push(pb); patRow.append(pb);
  });
  const copyBtn = btn("Copy →next", "wa-btn-sm");
  copyBtn.title = "Copy this pattern to the next slot";
  copyBtn.addEventListener("click", () => {
    const next = (curPat + 1) % NUM_PATS;
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[next][r][c] = allPats[curPat][r][c];
      allVels[next][r][c] = allVels[curPat][r][c];
    }
    saveAll(); const orig = copyBtn.textContent; copyBtn.textContent = "Copied ✓";
    setTimeout(() => { copyBtn.textContent = orig; }, 1200);
  });
  patRow.append(el("span", "wa-sep"), copyBtn);
  beat.append(patRow);

  const grid = el("div", "wa-grid");
  const cells: HTMLElement[][] = [];
  const sdPanels: HTMLElement[] = [];

  DRUMS.forEach((name, r) => {
    // Drum row
    const rowEl = el("div", "wa-row");
    const lab = btn(name, "wa-drum"); lab.classList.remove("wa-btn");
    let sdOpen = false;
    lab.addEventListener("click", () => {
      sdOpen = !sdOpen;
      sdPanels[r].style.display = sdOpen ? "block" : "none";
      lab.classList.toggle("active", sdOpen);
    });
    rowEl.append(lab);

    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell" + (c % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      if (allPats[curPat][r][c]) { cell.classList.add("on"); setCellOpacity(cell, allVels[curPat][r][c]); }
      cell.addEventListener("click", () => {
        allPats[curPat][r][c] = !allPats[curPat][r][c];
        cell.classList.toggle("on", allPats[curPat][r][c]);
        if (allPats[curPat][r][c]) {
          setCellOpacity(cell, allVels[curPat][r][c]);
          ensureNodes(); playDrum(ac(), trackGain[r], r, allVels[curPat][r][c] / 127, ac().currentTime);
        } else { cell.style.opacity = ""; }
        saveAll();
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault(); if (!allPats[curPat][r][c]) return;
        showVelPopup(r, c, cell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      // Long-press for velocity on mobile
      let lpTimer: number | null = null;
      cell.addEventListener("touchstart", (e: TouchEvent) => {
        const t = e.touches[0]; const x = t.clientX, y = t.clientY;
        lpTimer = window.setTimeout(() => { if (allPats[curPat][r][c]) showVelPopup(r, c, cell, x, y); lpTimer = null; }, 500);
      }, { passive: true });
      cell.addEventListener("touchend", () => { if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; } });
      rowCells.push(cell); rowEl.append(cell);
    }
    cells.push(rowCells); grid.append(rowEl);

    // Sound design panel (below each row, hidden by default)
    const sdPanel = el("div", "wa-sd-panel"); sdPanel.style.display = "none";
    const sdRow = el("div", "wa-sd-row");
    const specs = DP_SPECS[r];
    specs.forEach((spec, si) => {
      const item = el("div", "wa-sd-item");
      const inp = document.createElement("input");
      inp.type = "range"; inp.min = String(spec.min); inp.max = String(spec.max); inp.step = String(spec.step); inp.value = String(dp[r][spec.key]);
      const vout = el("span", "wa-sd-val", `${dp[r][spec.key]}${spec.unit ?? ""}`);
      inp.addEventListener("input", () => {
        const v = Number(inp.value); (dp[r][spec.key] as number) = v; vout.textContent = `${v}${spec.unit ?? ""}`; saveAll();
      });
      item.append(el("span", "wa-sd-lbl", spec.label), inp, vout);
      sdRow.append(item);
      void si;
    });
    const testBtn = btn("▶ Test", "wa-btn-sm");
    testBtn.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[r], r, 1, ac().currentTime); });
    const resetBtn = btn("Reset", "wa-btn-sm");
    resetBtn.addEventListener("click", () => {
      Object.assign(dp[r], DP_DEF[r]);
      sdPanel.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp, i) => {
        if (i >= specs.length) return;
        inp.value = String(dp[r][specs[i].key]);
        const vout = inp.nextElementSibling as HTMLElement;
        if (vout) vout.textContent = `${dp[r][specs[i].key]}${specs[i].unit ?? ""}`;
      });
      saveAll();
    });
    const actions = el("div", "wa-sd-actions"); actions.append(testBtn, resetBtn);
    sdPanel.append(sdRow, actions);
    sdPanels.push(sdPanel); grid.append(sdPanel);
  });

  const clearBtn = btn("CLEAR", "wa-btn-sm");
  clearBtn.addEventListener("click", () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[curPat][r][c] = false; cells[r][c].classList.remove("on"); cells[r][c].style.opacity = "";
    }
    saveAll();
  });
  const rowTools = el("div", "wa-row-tools"); rowTools.append(clearBtn);
  beat.append(grid, rowTools);

  // ── Synth ──
  const synthPanel = el("div", "wa-panel");
  const oscRow = el("div", "wa-knobs");
  (["sawtooth", "square", "sine", "triangle"] as OscillatorType[]).forEach((t) => {
    const b = btn(t.slice(0, 3).toUpperCase(), "wa-tab" + (t === synth.osc ? " active" : "")); b.classList.remove("wa-btn");
    b.addEventListener("click", () => { synth.osc = t; oscRow.querySelectorAll(".wa-tab").forEach((x) => x.classList.remove("active")); b.classList.add("active"); });
    oscRow.append(b);
  });
  const lfoTargetRow = el("div", "wa-knobs");
  (["filter", "pitch"] as const).forEach((t) => {
    const b = btn(t === "filter" ? "FILTER" : "PITCH", "wa-tab" + (lfo.target === t ? " active" : "")); b.classList.remove("wa-btn");
    b.addEventListener("click", () => {
      lfo.target = t; lfoTargetRow.querySelectorAll(".wa-tab").forEach((x) => x.classList.remove("active")); b.classList.add("active");
    });
    lfoTargetRow.append(b);
  });
  const synthKeys = el("div", "wa-keys"); buildKeys(synthKeys);
  synthPanel.append(
    el("div", "wa-lbl", "OSC"), oscRow,
    sliderRow("CUTOFF",  200,  6000, synth.cutoff,  1,    (v) => { synth.cutoff  = v; if (synthFilter) synthFilter.frequency.value = v; }),
    sliderRow("RESO",    0,    20,   synth.q,        0.5,  (v) => { synth.q      = v; if (synthFilter) synthFilter.Q.value = v; }),
    sliderRow("ATTACK",  0,    1,    synth.attack,   0.01, (v) => { synth.attack  = v; }),
    sliderRow("RELEASE", 0.05, 2,    synth.release,  0.05, (v) => { synth.release = v; }),
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "LFO"),
    sliderRow("RATE",  0.1, 20, lfo.rate,  0.1,  (v) => { lfo.rate  = v; }),
    sliderRow("DEPTH", 0,   1,  lfo.depth, 0.01, (v) => { lfo.depth = v; if (v > 0) startLFO(); }),
    lfoTargetRow,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "KEYS — click or use A–K"), synthKeys,
  );

  // ── Mixer ──
  const mixer = el("div", "wa-panel");
  const mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; }, i)));
  mixGrid.append(mixChannel("Synth",  0.7, (v) => { ensureNodes(); synthGain!.gain.value = v; }, -1));
  mixGrid.append(mixChannel("MASTER", 0.8, (v) => { ac(); master!.gain.value = v; }, -1));
  mixer.append(mixGrid);
  const rvRow = el("div", "wa-rv-row");
  const rvSlider = document.createElement("input");
  rvSlider.type = "range"; rvSlider.min = "0"; rvSlider.max = "0.6"; rvSlider.step = "0.02"; rvSlider.value = "0"; rvSlider.className = "wa-slider";
  const rvVal = el("span", "wa-val", "off");
  rvSlider.addEventListener("input", () => {
    const v = Number(rvSlider.value); rvVal.textContent = v > 0 ? v.toFixed(2) : "off";
    ensureNodes(); initReverb(v);
  });
  rvRow.append(el("span", "wa-lbl", "Reverb"), rvSlider, rvVal);
  mixer.append(rvRow);

  // ── Export ──
  const exp = el("div", "wa-panel");
  const expRow = el("div", "wa-export");
  const barsSel = document.createElement("select");
  [["1","1 bar"],["2","2 bars"],["4","4 bars"],["8","8 bars"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l; barsSel.append(o);
  });
  barsSel.value = "2";
  const wavBtn = btn("Export WAV"), mp3Btn = btn("Export MP3"), expStatus = el("span", "wa-status");
  expRow.append(el("span", "wa-lbl", "Length"), barsSel, wavBtn, mp3Btn, expStatus);
  exp.append(el("p", "wa-help", "Renders the active drum pattern at current mixer levels, swing and metro. Synth is a live instrument and isn't included."), expRow);

  panelEls.push(beat, synthPanel, mixer, exp);
  panels.append(beat, synthPanel, mixer, exp);
  win.append(titleBar, lcd, transport, tabbar, panels);
  root.append(win);
  paintTabs();

  // ── Transport logic ──
  function setBpm(v: number): void {
    bpm = Math.max(40, Math.min(240, v));
    bpmLabel.textContent = String(bpm); lcdBpm.textContent = `${bpm} BPM`;
  }
  bpmDown.addEventListener("click", () => setBpm(bpm - 1));
  bpmUp.addEventListener("click", () => setBpm(bpm + 1));
  swingIn.addEventListener("input", () => { swing = Number(swingIn.value); });
  metroBtn.addEventListener("click", () => { metro = !metro; metroBtn.classList.toggle("active", metro); });
  rotBtn.addEventListener("click", () => { win.classList.toggle("wa-rotated"); });

  let playing = false, schedTimer = 0, nextTime = 0, schStep = 0, lastHi = -1;
  function highlight(s: number): void {
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    for (let r = 0; r < 8; r++) cells[r][s].classList.add("play");
    lastHi = s; lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
  }
  function scheduleStep(s: number, baseWhen: number): void {
    const a = ac();
    const when = baseWhen + (s % 2 === 1 ? swing * stepDur() : 0);
    for (let r = 0; r < 8; r++) {
      if (pat()[r][s] && audible(r)) playDrum(a, trackGain[r], r, allVels[curPat][r][s] / 127, when);
    }
    if (metro && s % 4 === 0) metroClick(a, master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playing) highlight(s); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
  }
  function scheduler(): void {
    const a = ac();
    while (nextTime < a.currentTime + 0.1) { scheduleStep(schStep, nextTime); nextTime += stepDur(); schStep = (schStep + 1) % STEPS; }
  }
  playBtn.addEventListener("click", () => {
    if (playing) return;
    ensureNodes(); playing = true; schStep = 0; nextTime = ac().currentTime + 0.06;
    schedTimer = window.setInterval(scheduler, 25);
  });
  stopBtn.addEventListener("click", () => {
    playing = false; if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    lastHi = -1; lcdState.textContent = "■ STOP";
  });

  // ── Export logic ──
  async function renderBuffer(bars: number): Promise<AudioBuffer> {
    ensureNodes();
    const sr = 44100, sd = 60 / bpm / 4, dur = bars * STEPS * sd + 1.6;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const om = off.createGain(); om.gain.value = master!.gain.value; om.connect(off.destination);
    const ot: GainNode[] = [];
    for (let i = 0; i < 8; i++) { const g = off.createGain(); g.gain.value = trackGain[i].gain.value; g.connect(om); ot.push(g); }
    for (let b = 0; b < bars; b++) for (let s = 0; s < STEPS; s++) {
      const base = (b * STEPS + s) * sd, when = base + (s % 2 === 1 ? swing * sd : 0);
      for (let r = 0; r < 8; r++) {
        if (pat()[r][s] && audible(r)) playDrum(off, ot[r], r, allVels[curPat][r][s] / 127, when);
      }
      if (metro && s % 4 === 0) metroClick(off, om, base, s === 0);
    }
    return off.startRendering();
  }
  async function doExport(fmt: "wav" | "mp3"): Promise<void> {
    wavBtn.setAttribute("disabled", "1"); mp3Btn.setAttribute("disabled", "1"); expStatus.textContent = "Rendering…";
    try {
      const buf = await renderBuffer(Number(barsSel.value));
      if (fmt === "wav") { download(`vishamp-${bpm}bpm.wav`, encodeWav(buf)); }
      else { expStatus.textContent = "Encoding MP3…"; download(`vishamp-${bpm}bpm.mp3`, await encodeMp3(buf)); }
      expStatus.textContent = "Saved ✓";
    } catch { expStatus.textContent = fmt === "mp3" ? "MP3 failed — try WAV." : "Export failed."; }
    finally {
      wavBtn.removeAttribute("disabled"); mp3Btn.removeAttribute("disabled");
      setTimeout(() => { if (expStatus.textContent === "Saved ✓") expStatus.textContent = ""; }, 2500);
    }
  }
  wavBtn.addEventListener("click", () => doExport("wav"));
  mp3Btn.addEventListener("click", () => doExport("mp3"));

  // ── Keyboard ──
  const keyMap: Record<string, string> = {
    a:"C4", w:"C#4", s:"D4", e:"D#4", d:"E4", f:"F4", t:"F#4",
    g:"G4", y:"G#4", h:"A4", u:"A#4", j:"B4", k:"C5",
  };
  const downSet = new Set<string>();
  window.addEventListener("keydown", (ev) => {
    const n = keyMap[ev.key.toLowerCase()];
    if (!n || downSet.has(n) || ev.metaKey || ev.ctrlKey) return;
    downSet.add(n); noteOn(n); highlightKey(synthKeys, n, true);
  });
  window.addEventListener("keyup", (ev) => {
    const n = keyMap[ev.key.toLowerCase()]; if (!n) return;
    downSet.delete(n); noteOff(n); highlightKey(synthKeys, n, false);
  });
}

// ─── Key builders ─────────────────────────────────────────────────────────────
const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
function buildKeys(host: HTMLElement): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const key = el("button", "wa-key") as HTMLButtonElement; key.type = "button"; key.dataset.note = `${w}${oct}`; bindKey(key, `${w}${oct}`);
      if (HAS_BLACK[w]) {
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement; bk.type = "button"; bk.dataset.note = `${w}#${oct}`; bindKey(bk, `${w}#${oct}`); key.append(bk);
      }
      host.append(key);
    }
  }
}
function bindKey(key: HTMLElement, note: string): void {
  const on = (e: Event) => { e.preventDefault(); e.stopPropagation(); noteOn(note); key.classList.add("down"); };
  const off = () => { noteOff(note); key.classList.remove("down"); };
  key.addEventListener("mousedown", on); key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", () => { if (key.classList.contains("down")) off(); });
  key.addEventListener("touchstart", on, { passive: false });
  key.addEventListener("touchend", (e) => { e.preventDefault(); off(); });
}
function highlightKey(host: HTMLElement, note: string, on: boolean): void {
  const k = host.querySelector<HTMLElement>(`[data-note="${CSS.escape(note)}"]`);
  if (k) k.classList.toggle("down", on);
}

// ─── Encoders ─────────────────────────────────────────────────────────────────
function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + len * ch * 2); const dv = new DataView(out); let p = 0;
  const str = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  str("RIFF"); u32(36 + len * ch * 2); str("WAVE"); str("fmt "); u32(16); u16(1); u16(ch); u32(sr); u32(sr * ch * 2); u16(ch * 2); u16(16); str("data"); u32(len * ch * 2);
  const chans: Float32Array[] = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i])); dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true); p += 2;
  }
  return new Blob([out], { type: "audio/wav" });
}
function floatTo16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
  return out;
}
async function encodeMp3(buf: AudioBuffer): Promise<Blob> {
  const mod = (await import("lamejs")) as unknown as { Mp3Encoder?: unknown; default?: unknown };
  const Enc = (mod.Mp3Encoder ?? (mod.default as { Mp3Encoder?: unknown })?.Mp3Encoder ?? mod.default) as new (...a: unknown[]) => {
    encodeBuffer(l: Int16Array, r: Int16Array): Uint8Array;
    flush(): Uint8Array;
  };
  const enc = new Enc(2, buf.sampleRate, 192);
  const l = floatTo16(buf.getChannelData(0));
  const r = floatTo16(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
  const block = 1152, data: Uint8Array[] = [];
  for (let i = 0; i < l.length; i += block) {
    const mp3 = enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block));
    if (mp3.length) data.push(new Uint8Array(mp3));
  }
  const end = enc.flush(); if (end.length) data.push(new Uint8Array(end));
  return new Blob(data as BlobPart[], { type: "audio/mpeg" });
}
