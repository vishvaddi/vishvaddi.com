import "../../styles/studio.css";

// VishAmp Studio — a Winamp-styled mini-DAW: step-sequencer drum machine,
// subtractive synth and mixer, with swing, metronome, per-track mute/solo and
// WAV/MP3 export. Pure Web Audio. Drum/synth sound design ported from the
// OneScope studio. CSP-clean: external module, DOM via createElement.

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

// ── Drum synthesis (scheduled at an absolute time `when`, into `out`) ──
function noiseSrc(a: BaseAudioContext, dur: number): AudioBufferSourceNode {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  return src;
}
function dNoise(a: BaseAudioContext, out: AudioNode, vol: number, hp: number, dur: number, when: number, type: BiquadFilterType = "highpass", q = 0): void {
  const src = noiseSrc(a, dur);
  const f = a.createBiquadFilter();
  f.type = type; f.frequency.value = hp; if (q) f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(when); src.stop(when + dur);
}
function dTone(a: BaseAudioContext, out: AudioNode, vol: number, f0: number, f1: number, dur: number, when: number, type: OscillatorType = "sine"): void {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + dur);
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(out);
  o.start(when); o.stop(when + dur);
}
function metroClick(a: BaseAudioContext, out: AudioNode, when: number, accent: boolean): void {
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  o.connect(g); g.connect(out);
  o.start(when); o.stop(when + 0.05);
}

const DRUMS = ["Kick", "Snare", "HH Cl", "HH Op", "Clap", "Tom", "Rim", "Crash"];
const DRUM_FN: Array<(a: BaseAudioContext, out: AudioNode, vol: number, when: number) => void> = [
  (a, o, v, w) => dTone(a, o, v, 150, 50, 0.5, w),
  (a, o, v, w) => dNoise(a, o, v, 500, 0.2, w),
  (a, o, v, w) => dNoise(a, o, v, 8000, 0.08, w),
  (a, o, v, w) => dNoise(a, o, v, 5000, 0.3, w),
  (a, o, v, w) => { for (let i = 0; i < 3; i++) dNoise(a, o, v * 0.9, 1200, 0.05, w + i * 0.025, "bandpass", 0.5); },
  (a, o, v, w) => dTone(a, o, v, 120, 60, 0.4, w),
  (a, o, v, w) => { dTone(a, o, v * 0.5, 400, 400, 0.06, w, "triangle"); dNoise(a, o, v * 0.3, 5000, 0.06, w); },
  (a, o, v, w) => dNoise(a, o, v * 0.6, 3000, 1.2, w),
];

// ── Synth ──
const synth = { osc: "sawtooth" as OscillatorType, cutoff: 2200, q: 4, attack: 0.01, release: 0.3 };
const activeN = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
const SEMI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) return 440;
  const n = SEMI.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}
function noteOn(note: string): void {
  ensureNodes();
  if (activeN.has(note)) return;
  const a = ac();
  const osc = a.createOscillator();
  osc.type = synth.osc;
  osc.frequency.value = freq(note);
  const f = a.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = synth.cutoff; f.Q.value = synth.q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(0.4, a.currentTime + synth.attack);
  osc.connect(f); f.connect(g); g.connect(synthGain!);
  osc.start();
  activeN.set(note, { osc, gain: g });
}
function noteOff(note: string): void {
  const n = activeN.get(note);
  if (!n) return;
  const a = ac();
  n.gain.gain.cancelScheduledValues(a.currentTime);
  n.gain.gain.setValueAtTime(n.gain.gain.value, a.currentTime);
  n.gain.gain.linearRampToValueAtTime(0.0001, a.currentTime + synth.release);
  n.osc.stop(a.currentTime + synth.release + 0.05);
  activeN.delete(note);
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── State ──
const STEPS = 16;
let bpm = 120;
let swing = 0;
let metro = false;
const pattern: boolean[][] = DRUMS.map(() => new Array(STEPS).fill(false));
const mute = new Array(8).fill(false);
const solo = new Array(8).fill(false);
function audible(r: number): boolean {
  const anySolo = solo.some(Boolean);
  return !mute[r] && (!anySolo || solo[r]);
}
const stepDur = (): number => 60 / bpm / 4;

export function initStudio(): void {
  const root = document.getElementById("studio");
  if (!root) return;

  try {
    const saved = JSON.parse(localStorage.getItem("vv_studio_pattern") || "null");
    if (Array.isArray(saved) && saved.length === 8) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) pattern[r][c] = !!saved[r][c];
    }
  } catch { /* ignore */ }

  const win = el("div", "wa-win");
  const title = el("div", "wa-title");
  title.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), el("span", "wa-title-dots"));
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", "120 BPM");
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  lcd.append(lcdBpm, lcdState);

  // Transport
  const transport = el("div", "wa-transport");
  const playBtn = btn("▶");
  const stopBtn = btn("■");
  const bpmDown = btn("–", "wa-btn-sm");
  const bpmUp = btn("+", "wa-btn-sm");
  const bpmLabel = el("span", "wa-bpm", "120");
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing");
  swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle");
  const rotBtn = btn("⤢ Flip", "wa-btn-sm");
  transport.append(playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmLabel, bpmUp, el("span", "wa-sep"), swingWrap, metroBtn, el("span", "wa-sep"), rotBtn);

  // Tabs
  const tabbar = el("div", "wa-tabs");
  const panels = el("div", "wa-panels");
  const tabs = ["Beat", "Synth", "Mixer", "Export"];
  const tabBtns: HTMLElement[] = [];
  const panelEls: HTMLElement[] = [];
  let activeTab = 0;
  tabs.forEach((t, i) => {
    const b = btn(t, "wa-tab");
    b.classList.remove("wa-btn");
    b.addEventListener("click", () => { activeTab = i; paintTabs(); });
    tabBtns.push(b);
    tabbar.append(b);
  });
  function paintTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle("active", i === activeTab));
    panelEls.forEach((p, i) => { p.style.display = i === activeTab ? "block" : "none"; });
  }

  // ── Beat ──
  const beat = el("div", "wa-panel");
  const grid = el("div", "wa-grid");
  const cells: HTMLElement[][] = [];
  DRUMS.forEach((name, r) => {
    const rowEl = el("div", "wa-row");
    const lab = btn(name, "wa-drum");
    lab.classList.remove("wa-btn");
    lab.addEventListener("click", () => { ensureNodes(); DRUM_FN[r](ac(), trackGain[r], 1, ac().currentTime); });
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
        if (pattern[r][c]) { ensureNodes(); DRUM_FN[r](ac(), trackGain[r], 1, ac().currentTime); }
      });
      rowCells.push(cell);
      rowEl.append(cell);
    }
    cells.push(rowCells);
    grid.append(rowEl);
  });
  const clearBtn = btn("CLEAR", "wa-btn-sm");
  clearBtn.addEventListener("click", () => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) { pattern[r][c] = false; cells[r][c].classList.remove("on"); }
    savePattern();
  });
  beat.append(grid, el("div", "wa-row-tools").appendChild(clearBtn).parentElement!);

  // ── Synth ──
  const synthPanel = el("div", "wa-panel");
  const oscRow = el("div", "wa-knobs");
  (["sawtooth", "square", "sine", "triangle"] as OscillatorType[]).forEach((t) => {
    const b = btn(t.slice(0, 3).toUpperCase(), "wa-tab" + (t === synth.osc ? " active" : ""));
    b.classList.remove("wa-btn");
    b.addEventListener("click", () => {
      synth.osc = t;
      oscRow.querySelectorAll(".wa-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
    oscRow.append(b);
  });
  const synthKeys = el("div", "wa-keys");
  buildKeys(synthKeys);
  synthPanel.append(
    el("div", "wa-lbl", "OSC"), oscRow,
    sliderRow("CUTOFF", 200, 6000, synth.cutoff, 1, (v) => { synth.cutoff = v; }),
    sliderRow("RESO", 0, 20, synth.q, 0.5, (v) => { synth.q = v; }),
    sliderRow("ATTACK", 0, 1, synth.attack, 0.01, (v) => { synth.attack = v; }),
    sliderRow("RELEASE", 0.05, 2, synth.release, 0.05, (v) => { synth.release = v; }),
    el("div", "wa-lbl", "KEYS — click or use A–K"), synthKeys,
  );

  // ── Mixer ──
  const mixer = el("div", "wa-panel");
  const mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; }, i)));
  mixGrid.append(mixChannel("Synth", 0.7, (v) => { ensureNodes(); synthGain!.gain.value = v; }, -1));
  mixGrid.append(mixChannel("MASTER", 0.8, (v) => { ac(); master!.gain.value = v; }, -1));
  mixer.append(mixGrid);

  // ── Export ──
  const exp = el("div", "wa-panel");
  const expRow = el("div", "wa-export");
  const barsSel = document.createElement("select");
  [["1", "1 bar"], ["2", "2 bars"], ["4", "4 bars"], ["8", "8 bars"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l; barsSel.append(o);
  });
  barsSel.value = "2";
  const wavBtn = btn("Export WAV");
  const mp3Btn = btn("Export MP3");
  const expStatus = el("span", "wa-status");
  expRow.append(el("span", "wa-lbl", "Length"), barsSel, wavBtn, mp3Btn, expStatus);
  exp.append(el("p", "wa-help", "Renders the drum pattern (at current mixer levels, swing and metronome) and downloads it. The synth is a live instrument and isn't included."), expRow);

  panelEls.push(beat, synthPanel, mixer, exp);
  panels.append(beat, synthPanel, mixer, exp);
  win.append(title, lcd, transport, tabbar, panels);
  root.append(win);
  paintTabs();

  // ── Transport logic ──
  function setBpm(v: number): void {
    bpm = Math.max(40, Math.min(240, v));
    bpmLabel.textContent = String(bpm);
    lcdBpm.textContent = `${bpm} BPM`;
  }
  bpmDown.addEventListener("click", () => setBpm(bpm - 1));
  bpmUp.addEventListener("click", () => setBpm(bpm + 1));
  swingIn.addEventListener("input", () => { swing = Number(swingIn.value); });
  metroBtn.addEventListener("click", () => { metro = !metro; metroBtn.classList.toggle("active", metro); });
  rotBtn.addEventListener("click", () => { win.classList.toggle("wa-rotated"); });

  let playing = false;
  let schedTimer = 0;
  let nextTime = 0;
  let schStep = 0;
  let lastHi = -1;
  function highlight(s: number): void {
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    for (let r = 0; r < 8; r++) cells[r][s].classList.add("play");
    lastHi = s;
    lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
  }
  function scheduleStep(s: number, baseWhen: number): void {
    const a = ac();
    const when = baseWhen + (s % 2 === 1 ? swing * stepDur() : 0);
    for (let r = 0; r < 8; r++) if (pattern[r][s] && audible(r)) DRUM_FN[r](a, trackGain[r], 1, when);
    if (metro && s % 4 === 0) metroClick(a, master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playing) highlight(s); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
  }
  function scheduler(): void {
    const a = ac();
    while (nextTime < a.currentTime + 0.1) {
      scheduleStep(schStep, nextTime);
      nextTime += stepDur();
      schStep = (schStep + 1) % STEPS;
    }
  }
  playBtn.addEventListener("click", () => {
    if (playing) return;
    ensureNodes();
    playing = true;
    schStep = 0;
    nextTime = ac().currentTime + 0.06;
    schedTimer = window.setInterval(scheduler, 25);
  });
  stopBtn.addEventListener("click", () => {
    playing = false;
    if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    lastHi = -1;
    lcdState.textContent = "■ STOP";
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
      const base = (b * STEPS + s) * sd;
      const when = base + (s % 2 === 1 ? swing * sd : 0);
      for (let r = 0; r < 8; r++) if (pattern[r][s] && audible(r)) DRUM_FN[r](off, ot[r], 1, when);
      if (metro && s % 4 === 0) metroClick(off, om, base, s === 0);
    }
    return off.startRendering();
  }
  async function doExport(fmt: "wav" | "mp3"): Promise<void> {
    wavBtn.setAttribute("disabled", "1"); mp3Btn.setAttribute("disabled", "1");
    expStatus.textContent = "Rendering…";
    try {
      const buf = await renderBuffer(Number(barsSel.value));
      if (fmt === "wav") {
        download(`vishamp-${bpm}bpm.wav`, encodeWav(buf));
      } else {
        expStatus.textContent = "Encoding MP3…";
        download(`vishamp-${bpm}bpm.mp3`, await encodeMp3(buf));
      }
      expStatus.textContent = "Saved ✓";
    } catch (e) {
      expStatus.textContent = fmt === "mp3" ? "MP3 failed — try WAV." : "Export failed.";
    } finally {
      wavBtn.removeAttribute("disabled"); mp3Btn.removeAttribute("disabled");
      setTimeout(() => { if (expStatus.textContent === "Saved ✓") expStatus.textContent = ""; }, 2500);
    }
  }
  wavBtn.addEventListener("click", () => doExport("wav"));
  mp3Btn.addEventListener("click", () => doExport("mp3"));

  // computer-keyboard synth
  const keyMap: Record<string, string> = {
    a: "C4", w: "C#4", s: "D4", e: "D#4", d: "E4", f: "F4", t: "F#4",
    g: "G4", y: "G#4", h: "A4", u: "A#4", j: "B4", k: "C5",
  };
  const downSet = new Set<string>();
  window.addEventListener("keydown", (ev) => {
    const n = keyMap[ev.key.toLowerCase()];
    if (!n || downSet.has(n) || ev.metaKey || ev.ctrlKey) return;
    downSet.add(n); noteOn(n); highlightKey(synthKeys, n, true);
  });
  window.addEventListener("keyup", (ev) => {
    const n = keyMap[ev.key.toLowerCase()];
    if (!n) return;
    downSet.delete(n); noteOff(n); highlightKey(synthKeys, n, false);
  });

  function savePattern(): void {
    try { localStorage.setItem("vv_studio_pattern", JSON.stringify(pattern.map((r) => r.map((b) => (b ? 1 : 0))))); } catch { /* ignore */ }
  }
}

// ── builders ──
function btn(label: string, extra = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = ("wa-btn " + extra).trim();
  b.textContent = label;
  return b;
}
function sliderRow(label: string, min: number, max: number, val: number, step: number, on: (v: number) => void): HTMLElement {
  const row = el("div", "wa-slider-row");
  row.append(el("span", "wa-lbl", label));
  const input = document.createElement("input");
  input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(val); input.className = "wa-slider";
  const out = el("span", "wa-val", String(val));
  input.addEventListener("input", () => { const v = Number(input.value); out.textContent = String(v); on(v); });
  row.append(input, out);
  return row;
}
function mixChannel(name: string, val: number, on: (v: number) => void, idx: number): HTMLElement {
  const ch = el("div", "wa-ch");
  const input = document.createElement("input");
  input.type = "range"; input.min = "0"; input.max = "1"; input.step = "0.01"; input.value = String(val);
  input.className = "wa-fader";
  input.addEventListener("input", () => on(Number(input.value)));
  ch.append(input);
  if (idx >= 0) {
    const ms = el("div", "wa-ms");
    const m = btn("M", "wa-mute"); m.classList.remove("wa-btn");
    m.addEventListener("click", () => { mute[idx] = !mute[idx]; m.classList.toggle("active", mute[idx]); });
    const s = btn("S", "wa-solo"); s.classList.remove("wa-btn");
    s.addEventListener("click", () => { solo[idx] = !solo[idx]; s.classList.toggle("active", solo[idx]); });
    ms.append(m, s);
    ch.append(ms);
  }
  ch.append(el("span", "wa-ch-name", name));
  return ch;
}

const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
const HAS_BLACK: Record<string, boolean> = { C: true, D: true, F: true, G: true, A: true };
function buildKeys(host: HTMLElement): void {
  for (let oct = 3; oct <= 4; oct++) {
    for (const w of WHITE) {
      const key = el("button", "wa-key") as HTMLButtonElement;
      key.type = "button";
      key.dataset.note = `${w}${oct}`;
      bindKey(key, `${w}${oct}`);
      if (HAS_BLACK[w]) {
        const bk = el("button", "wa-key wa-key-black") as HTMLButtonElement;
        bk.type = "button";
        bk.dataset.note = `${w}#${oct}`;
        bindKey(bk, `${w}#${oct}`);
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

// ── encoders ──
function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + len * ch * 2);
  const dv = new DataView(out);
  let p = 0;
  const str = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  str("RIFF"); u32(36 + len * ch * 2); str("WAVE"); str("fmt "); u32(16); u16(1); u16(ch); u32(sr); u32(sr * ch * 2); u16(ch * 2); u16(16); str("data"); u32(len * ch * 2);
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true); p += 2;
  }
  return new Blob([out], { type: "audio/wav" });
}
function floatTo16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
  return out;
}
async function encodeMp3(buf: AudioBuffer): Promise<Blob> {
  const mod = (await import("lamejs")) as unknown as { Mp3Encoder?: any; default?: any };
  const Enc = mod.Mp3Encoder ?? mod.default?.Mp3Encoder ?? mod.default;
  const enc = new Enc(2, buf.sampleRate, 192);
  const l = floatTo16(buf.getChannelData(0));
  const r = floatTo16(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
  const block = 1152;
  const data: Uint8Array[] = [];
  for (let i = 0; i < l.length; i += block) {
    const mp3 = enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block));
    if (mp3.length) data.push(new Uint8Array(mp3));
  }
  const end = enc.flush();
  if (end.length) data.push(new Uint8Array(end));
  return new Blob(data as BlobPart[], { type: "audio/mpeg" });
}
