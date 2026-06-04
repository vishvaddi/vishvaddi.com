// VishAmp Studio — a Winamp-styled mini-DAW: a step-sequencer drum machine, a
// subtractive synth and a mixer. Pure Web Audio (no samples). Drum/synth sound
// design ported from the OneScope studio. CSP-clean: external module, DOM via
// createElement, no network.

let AC: AudioContext | null = null;
let master: GainNode | null = null;
const trackGain: GainNode[] = [];
let synthGain: GainNode | null = null;

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
  if (!trackGain.length) {
    for (let i = 0; i < 8; i++) {
      const g = a.createGain();
      g.gain.value = 0.8;
      g.connect(master!);
      trackGain.push(g);
    }
    synthGain = a.createGain();
    synthGain.gain.value = 0.7;
    synthGain.connect(master!);
  }
}

// ── Drum synthesis (connects to a provided output node) ──
function noiseBuf(a: AudioContext, dur: number): AudioBufferSourceNode {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  return src;
}
function hpNoise(a: AudioContext, out: AudioNode, vol: number, hp: number, dur: number, type: BiquadFilterType = "highpass", q = 0): void {
  const src = noiseBuf(a, dur);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = hp;
  if (q) f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(); src.stop(a.currentTime + dur);
}
function tone(a: AudioContext, out: AudioNode, vol: number, f0: number, f1: number, dur: number, type: OscillatorType = "sine"): void {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, a.currentTime);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  osc.connect(g); g.connect(out);
  osc.start(); osc.stop(a.currentTime + dur);
}

const DRUMS = ["Kick", "Snare", "HH Cl", "HH Op", "Clap", "Tom", "Rim", "Crash"];
const DRUM_FN: Array<(a: AudioContext, out: AudioNode, vol: number) => void> = [
  (a, o, v) => tone(a, o, v, 150, 50, 0.5),
  (a, o, v) => hpNoise(a, o, v, 500, 0.2),
  (a, o, v) => hpNoise(a, o, v, 8000, 0.08),
  (a, o, v) => hpNoise(a, o, v, 5000, 0.3),
  (a, o, v) => { for (let i = 0; i < 3; i++) setTimeout(() => hpNoise(a, o, v * 0.9, 1200, 0.05, "bandpass", 0.5), i * 25); },
  (a, o, v) => tone(a, o, v, 120, 60, 0.4),
  (a, o, v) => { tone(a, o, v * 0.5, 400, 400, 0.06, "triangle"); hpNoise(a, o, v * 0.3, 5000, 0.06); },
  (a, o, v) => hpNoise(a, o, v * 0.6, 3000, 1.2),
];

// ── Synth ──
type SynthState = { osc: OscillatorType; cutoff: number; q: number; attack: number; release: number };
const synth: SynthState = { osc: "sawtooth", cutoff: 2200, q: 4, attack: 0.01, release: 0.3 };
const active = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
const SEMI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) return 440;
  const idx = SEMI.indexOf(m[1]);
  const oct = parseInt(m[2], 10);
  const n = idx + (oct + 1) * 12; // MIDI number
  return 440 * Math.pow(2, (n - 69) / 12);
}
function noteOn(note: string): void {
  ensureNodes();
  if (active.has(note)) return;
  const a = ac();
  const osc = a.createOscillator();
  osc.type = synth.osc;
  osc.frequency.value = freq(note);
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = synth.cutoff;
  f.Q.value = synth.q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(0.4, a.currentTime + synth.attack);
  osc.connect(f); f.connect(g); g.connect(synthGain!);
  osc.start();
  active.set(note, { osc, gain: g });
}
function noteOff(note: string): void {
  const n = active.get(note);
  if (!n) return;
  const a = ac();
  n.gain.gain.cancelScheduledValues(a.currentTime);
  n.gain.gain.setValueAtTime(n.gain.gain.value, a.currentTime);
  n.gain.gain.linearRampToValueAtTime(0.0001, a.currentTime + synth.release);
  n.osc.stop(a.currentTime + synth.release + 0.05);
  active.delete(note);
}

// ── DOM helper ──
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ── Main ──
const STEPS = 16;
let bpm = 120;
let playing = false;
let step = 0;
let timer = 0;
const pattern: boolean[][] = DRUMS.map(() => new Array(STEPS).fill(false));

export function initStudio(): void {
  const root = document.getElementById("studio");
  if (!root) return;

  try {
    const saved = JSON.parse(localStorage.getItem("vv_studio_pattern") || "null");
    if (Array.isArray(saved) && saved.length === DRUMS.length) {
      for (let r = 0; r < DRUMS.length; r++) for (let c = 0; c < STEPS; c++) pattern[r][c] = !!saved[r][c];
    }
  } catch { /* ignore */ }

  // Window shell
  const win = el("div", "wa-win");
  const title = el("div", "wa-title");
  title.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), el("span", "wa-title-dots"));
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", "120 BPM");
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  lcd.append(lcdBpm, lcdState);

  // Transport
  const transport = el("div", "wa-transport");
  const playBtn = el("button", "wa-btn", "▶") as HTMLButtonElement;
  playBtn.type = "button";
  const stopBtn = el("button", "wa-btn", "■") as HTMLButtonElement;
  stopBtn.type = "button";
  const bpmDown = el("button", "wa-btn wa-btn-sm", "–") as HTMLButtonElement;
  bpmDown.type = "button";
  const bpmUp = el("button", "wa-btn wa-btn-sm", "+") as HTMLButtonElement;
  bpmUp.type = "button";
  const bpmLabel = el("span", "wa-bpm", "120");
  transport.append(playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmLabel, bpmUp);

  // Tabs
  const tabbar = el("div", "wa-tabs");
  const panels = el("div", "wa-panels");
  const tabs = ["Beat", "Synth", "Mixer"];
  const tabBtns: HTMLElement[] = [];
  const panelEls: HTMLElement[] = [];
  let activeTab = 0;
  tabs.forEach((t, i) => {
    const b = el("button", "wa-tab", t) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", () => { activeTab = i; paintTabs(); });
    tabBtns.push(b);
    tabbar.append(b);
  });
  function paintTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle("active", i === activeTab));
    panelEls.forEach((p, i) => { p.style.display = i === activeTab ? "block" : "none"; });
  }

  // ── Beat panel ──
  const beat = el("div", "wa-panel");
  const grid = el("div", "wa-grid");
  const cells: HTMLElement[][] = [];
  DRUMS.forEach((name, r) => {
    const rowEl = el("div", "wa-row");
    const lab = el("button", "wa-drum", name) as HTMLButtonElement;
    lab.type = "button";
    lab.addEventListener("click", () => { ensureNodes(); DRUM_FN[r](ac(), trackGain[r], 1); });
    rowEl.append(lab);
    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell" + (c % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      if (pattern[r][c]) cell.classList.add("on");
      cell.addEventListener("click", () => {
        pattern[r][c] = !pattern[r][c];
        cell.classList.toggle("on", pattern[r][c]);
        savePattern();
        if (pattern[r][c]) { ensureNodes(); DRUM_FN[r](ac(), trackGain[r], 1); }
      });
      rowCells.push(cell);
      rowEl.append(cell);
    }
    cells.push(rowCells);
    grid.append(rowEl);
  });
  const beatTools = el("div", "wa-row-tools");
  const clearBtn = el("button", "wa-btn wa-btn-sm", "CLEAR") as HTMLButtonElement;
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    for (let r = 0; r < DRUMS.length; r++) for (let c = 0; c < STEPS; c++) { pattern[r][c] = false; cells[r][c].classList.remove("on"); }
    savePattern();
  });
  beatTools.append(clearBtn);
  beat.append(grid, beatTools);

  // ── Synth panel ──
  const synthPanel = el("div", "wa-panel");
  const oscRow = el("div", "wa-knobs");
  (["sawtooth", "square", "sine", "triangle"] as OscillatorType[]).forEach((t) => {
    const b = el("button", "wa-tab" + (t === synth.osc ? " active" : ""), t.slice(0, 3).toUpperCase()) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", () => {
      synth.osc = t;
      oscRow.querySelectorAll(".wa-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
    oscRow.append(b);
  });
  const cutoff = sliderRow("CUTOFF", 200, 6000, synth.cutoff, (v) => { synth.cutoff = v; });
  const synthKeys = el("div", "wa-keys");
  buildKeys(synthKeys);
  synthPanel.append(el("div", "wa-lbl", "OSC"), oscRow, cutoff.row, el("div", "wa-lbl", "KEYS — click or use A–K"), synthKeys);

  // ── Mixer panel ──
  const mixer = el("div", "wa-panel");
  const mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; })));
  mixGrid.append(mixChannel("Synth", 0.7, (v) => { ensureNodes(); synthGain!.gain.value = v; }));
  mixGrid.append(mixChannel("MASTER", 0.8, (v) => { masterNode().gain.value = v; }));
  mixer.append(mixGrid);

  panelEls.push(beat, synthPanel, mixer);
  panels.append(beat, synthPanel, mixer);

  win.append(title, lcd, transport, tabbar, panels);
  root.append(win);
  paintTabs();

  // ── Transport logic ──
  function setBpm(v: number): void {
    bpm = Math.max(60, Math.min(200, v));
    bpmLabel.textContent = String(bpm);
    lcdBpm.textContent = `${bpm} BPM`;
    if (playing) { stopClock(); startClock(); }
  }
  bpmDown.addEventListener("click", () => setBpm(bpm - 4));
  bpmUp.addEventListener("click", () => setBpm(bpm + 4));

  function startClock(): void {
    const interval = (60 / bpm / 4) * 1000;
    timer = window.setInterval(() => {
      for (let r = 0; r < DRUMS.length; r++) if (pattern[r][step]) DRUM_FN[r](ac(), trackGain[r], 1);
      for (let r = 0; r < DRUMS.length; r++) {
        cells[r][(step + STEPS - 1) % STEPS].classList.remove("play");
        cells[r][step].classList.add("play");
      }
      lcdState.textContent = `▶ ${String(step + 1).padStart(2, "0")}`;
      step = (step + 1) % STEPS;
    }, interval);
  }
  function stopClock(): void { if (timer) { clearInterval(timer); timer = 0; } }

  playBtn.addEventListener("click", () => {
    if (playing) return;
    ensureNodes();
    playing = true;
    step = 0;
    startClock();
  });
  stopBtn.addEventListener("click", () => {
    playing = false;
    stopClock();
    step = 0;
    cells.forEach((row) => row.forEach((c) => c.classList.remove("play")));
    lcdState.textContent = "■ STOP";
  });

  // computer-keyboard synth (one octave from middle C)
  const keyMap: Record<string, string> = {
    a: "C4", w: "C#4", s: "D4", e: "D#4", d: "E4", f: "F4", t: "F#4",
    g: "G4", y: "G#4", h: "A4", u: "A#4", j: "B4", k: "C5",
  };
  const down = new Set<string>();
  window.addEventListener("keydown", (ev) => {
    const n = keyMap[ev.key.toLowerCase()];
    if (!n || down.has(n) || ev.metaKey || ev.ctrlKey) return;
    down.add(n);
    noteOn(n);
    highlightKey(synthKeys, n, true);
  });
  window.addEventListener("keyup", (ev) => {
    const n = keyMap[ev.key.toLowerCase()];
    if (!n) return;
    down.delete(n);
    noteOff(n);
    highlightKey(synthKeys, n, false);
  });

  function savePattern(): void {
    try { localStorage.setItem("vv_studio_pattern", JSON.stringify(pattern.map((r) => r.map((b) => (b ? 1 : 0))))); } catch { /* ignore */ }
  }
}

// ── UI builders ──
function sliderRow(label: string, min: number, max: number, val: number, on: (v: number) => void): { row: HTMLElement } {
  const row = el("div", "wa-slider-row");
  row.append(el("span", "wa-lbl", label));
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.value = String(val);
  input.className = "wa-slider";
  const out = el("span", "wa-val", String(val));
  input.addEventListener("input", () => { const v = Number(input.value); out.textContent = String(Math.round(v)); on(v); });
  row.append(input, out);
  return { row };
}

function mixChannel(name: string, val: number, on: (v: number) => void): HTMLElement {
  const ch = el("div", "wa-ch");
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.01";
  input.value = String(val);
  input.className = "wa-fader";
  input.addEventListener("input", () => on(Number(input.value)));
  ch.append(input, el("span", "wa-ch-name", name));
  return ch;
}

const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
function buildKeys(host: HTMLElement): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const note = `${w}${oct}`;
      const key = el("button", "wa-key") as HTMLButtonElement;
      key.type = "button";
      key.dataset.note = note;
      bindKey(key, note);
      if (BLACK[w]) {
        const bn = `${w}#${oct}`;
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement;
        bk.type = "button";
        bk.dataset.note = bn;
        bindKey(bk, bn);
        key.append(bk);
      }
      host.append(key);
    }
  }
}
function bindKey(key: HTMLElement, note: string): void {
  const on = (e: Event) => { e.preventDefault(); e.stopPropagation(); noteOn(note); key.classList.add("down"); };
  const off = () => { noteOff(note); key.classList.remove("down"); };
  key.addEventListener("mousedown", on);
  key.addEventListener("mouseup", off);
  key.addEventListener("mouseleave", () => { if (key.classList.contains("down")) off(); });
  key.addEventListener("touchstart", on, { passive: false });
  key.addEventListener("touchend", (e) => { e.preventDefault(); off(); });
}
function highlightKey(host: HTMLElement, note: string, on: boolean): void {
  const k = host.querySelector<HTMLElement>(`[data-note="${CSS.escape(note)}"]`);
  if (k) k.classList.toggle("down", on);
}
