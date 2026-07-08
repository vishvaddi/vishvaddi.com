// VV-1 — pragmatic wavetable synth (Vital-inspired, Web Audio).
// Voice graphs are built identically on AudioContext and OfflineAudioContext so
// exports sound the same as live playback: envelopes are scheduled ramps,
// LFOs are real oscillator nodes wired into AudioParams, and wavetable
// position morphs by crossfading two oscillators on adjacent table frames.

export interface OscPatch {
  table: string;
  pos: number;      // 0–1 across the table's frames
  octave: number;   // -2..+2
  semi: number;     // -12..+12
  level: number;    // 0–1
  unison: number;   // 1–8 voices
  detune: number;   // unison spread, cents
}
export interface EnvPatch { a: number; d: number; s: number; r: number; }
export interface LfoPatch { shape: "sine" | "triangle" | "sawtooth" | "square"; rate: number; }
export type ModSrc = "lfo1" | "lfo2" | "env2" | "vel" | "macro1" | "macro2" | "macro3" | "macro4";
export type ModDest = "pitch" | "cutoff" | "amp" | "pan" | "pos1" | "pos2";
export interface ModSlot { src: ModSrc; dest: ModDest; amt: number; }
export interface VPatch {
  osc1: OscPatch;
  osc2: OscPatch;
  noise: { level: number; colour: number };
  filter: { type: "lowpass" | "highpass" | "bandpass" | "notch"; cutoff: number; res: number; env2: number; track: number };
  env1: EnvPatch;
  env2: EnvPatch;
  lfo1: LfoPatch;
  lfo2: LfoPatch;
  matrix: ModSlot[];
  macros: number[];
  volume: number;
}

export const MOD_SRCS: ModSrc[] = ["lfo1", "lfo2", "env2", "vel", "macro1", "macro2", "macro3", "macro4"];
export const MOD_DESTS: ModDest[] = ["pitch", "cutoff", "amp", "pan", "pos1", "pos2"];
export const TABLE_NAMES = ["basic", "pwm", "harm", "vocal", "digital"];

export function initPatch(): VPatch {
  return {
    osc1: { table: "basic", pos: 0.6, octave: 0, semi: 0, level: 0.8, unison: 1, detune: 12 },
    osc2: { table: "basic", pos: 0.6, octave: 0, semi: 0, level: 0, unison: 1, detune: 12 },
    noise: { level: 0, colour: 8000 },
    filter: { type: "lowpass", cutoff: 9000, res: 0.7, env2: 0, track: 0.4 },
    env1: { a: 0.005, d: 0.25, s: 0.7, r: 0.25 },
    env2: { a: 0.005, d: 0.2, s: 0, r: 0.2 },
    lfo1: { shape: "sine", rate: 4 },
    lfo2: { shape: "triangle", rate: 0.5 },
    matrix: [],
    macros: [0, 0, 0, 0],
    volume: 0.8,
  };
}

export const PRESETS: Record<string, VPatch> = {
  "Init": initPatch(),
  "Sub Bass": {
    ...initPatch(),
    osc1: { table: "basic", pos: 0.05, octave: -1, semi: 0, level: 0.9, unison: 1, detune: 0 },
    filter: { type: "lowpass", cutoff: 900, res: 0.5, env2: 0.2, track: 0.2 },
    env1: { a: 0.004, d: 0.3, s: 0.85, r: 0.12 },
    env2: { a: 0.001, d: 0.12, s: 0, r: 0.1 },
  },
  "Reese": {
    ...initPatch(),
    osc1: { table: "basic", pos: 0.65, octave: -1, semi: 0, level: 0.75, unison: 2, detune: 32 },
    osc2: { table: "basic", pos: 0.65, octave: -1, semi: 0, level: 0.75, unison: 2, detune: 45 },
    filter: { type: "lowpass", cutoff: 700, res: 2.5, env2: 0, track: 0.1 },
    env1: { a: 0.01, d: 0.2, s: 0.95, r: 0.2 },
    matrix: [{ src: "lfo2", dest: "pos1", amt: 0.35 }],
    lfo2: { shape: "sine", rate: 0.4 },
  },
  "Hoover": {
    ...initPatch(),
    osc1: { table: "pwm", pos: 0.35, octave: 0, semi: 0, level: 0.7, unison: 6, detune: 55 },
    osc2: { table: "basic", pos: 0.7, octave: -1, semi: 0, level: 0.5, unison: 2, detune: 20 },
    filter: { type: "lowpass", cutoff: 2400, res: 1.4, env2: 0.5, track: 0.3 },
    env1: { a: 0.01, d: 0.4, s: 0.8, r: 0.3 },
    env2: { a: 0.005, d: 0.5, s: 0.2, r: 0.3 },
    matrix: [{ src: "lfo1", dest: "pos1", amt: 0.3 }],
    lfo1: { shape: "triangle", rate: 5.5 },
  },
  "Pluck": {
    ...initPatch(),
    osc1: { table: "digital", pos: 0.3, octave: 0, semi: 0, level: 0.85, unison: 3, detune: 14 },
    filter: { type: "lowpass", cutoff: 500, res: 1.2, env2: 0.85, track: 0.5 },
    env1: { a: 0.002, d: 0.28, s: 0, r: 0.2 },
    env2: { a: 0.001, d: 0.22, s: 0, r: 0.15 },
  },
  "Pad": {
    ...initPatch(),
    osc1: { table: "vocal", pos: 0.3, octave: 0, semi: 0, level: 0.6, unison: 4, detune: 24 },
    osc2: { table: "basic", pos: 0.35, octave: -1, semi: 0, level: 0.4, unison: 2, detune: 10 },
    filter: { type: "lowpass", cutoff: 3200, res: 0.6, env2: 0.15, track: 0.3 },
    env1: { a: 0.6, d: 0.8, s: 0.8, r: 1.2 },
    matrix: [{ src: "lfo2", dest: "pos1", amt: 0.4 }, { src: "lfo1", dest: "pan", amt: 0.25 }],
    lfo1: { shape: "sine", rate: 0.3 },
    lfo2: { shape: "triangle", rate: 0.15 },
  },
  "Acid": {
    ...initPatch(),
    osc1: { table: "basic", pos: 0.68, octave: 0, semi: 0, level: 0.85, unison: 1, detune: 0 },
    filter: { type: "lowpass", cutoff: 300, res: 9, env2: 0.75, track: 0.6 },
    env1: { a: 0.002, d: 0.18, s: 0.25, r: 0.08 },
    env2: { a: 0.001, d: 0.16, s: 0.05, r: 0.1 },
  },
  "Keys": {
    ...initPatch(),
    osc1: { table: "harm", pos: 0.25, octave: 0, semi: 0, level: 0.7, unison: 1, detune: 0 },
    osc2: { table: "basic", pos: 0.1, octave: 1, semi: 0, level: 0.2, unison: 1, detune: 0 },
    filter: { type: "lowpass", cutoff: 6500, res: 0.5, env2: 0.25, track: 0.5 },
    env1: { a: 0.003, d: 0.5, s: 0.4, r: 0.35 },
    env2: { a: 0.002, d: 0.4, s: 0, r: 0.3 },
  },
};

export const PRESET_CATEGORIES: Record<string, string> = {
  "Init": "Utility",
  "Sub Bass": "Bass",
  "Reese": "Bass",
  "Acid": "Bass",
  "Hoover": "Lead",
  "Pluck": "Pluck",
  "Pad": "Pad",
  "Keys": "Keys",
};

// ─── Wavetables ──────────────────────────────────────────────────────────────
const FRAMES = 8;
const HARMONICS = 64;

// Text-to-wavetable: the table's whole identity lives in the string itself
// ("text:<word>"), so no separate storage is needed for save/load — hashing
// is a GLSL-style fract(sin(x)*large) trick, deterministic per (text, n, t),
// rolled off at 1/n so it reads as a wave rather than white noise.
function textHarmonicAmp(text: string, f: number, n: number): number {
  const t = f / (FRAMES - 1);
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  const h = Math.sin(seed * 0.0001 + n * 12.9898 + t * 78.233) * 43758.5453;
  return ((h - Math.floor(h)) * 2 - 1) / n;
}

// Harmonic amplitude (sine-phase) for each named table at frame f (0..FRAMES-1).
function harmonicAmp(table: string, f: number, n: number): number {
  if (table.startsWith("text:")) return textHarmonicAmp(table.slice(5) || "VISHAMP", f, n);
  const t = f / (FRAMES - 1); // 0–1 across the table
  switch (table) {
    case "basic": {
      // sine → triangle → saw → square, piecewise morph
      const sine = n === 1 ? 1 : 0;
      const tri = n % 2 === 1 ? (8 / Math.PI / Math.PI) * (n % 4 === 1 ? 1 : -1) / (n * n) : 0;
      const saw = (2 / Math.PI) / n * (n % 2 === 0 ? -1 : 1);
      const sq = n % 2 === 1 ? (4 / Math.PI) / n : 0;
      if (t < 1 / 3) { const x = t * 3; return sine * (1 - x) + tri * x; }
      if (t < 2 / 3) { const x = t * 3 - 1; return tri * (1 - x) + saw * x; }
      const x = t * 3 - 2; return saw * (1 - x) + sq * x;
    }
    case "pwm": {
      const width = 0.5 - t * 0.44; // 0.5 → 0.06
      return (2 / (Math.PI * n)) * Math.sin(Math.PI * n * width) * 2;
    }
    case "harm": {
      const count = 1 + Math.round(t * 15);
      return n <= count ? 1 / Math.sqrt(n) : 0;
    }
    case "vocal": {
      // two gaussian formant bumps sweeping upwards
      const c1 = 2 + t * 10, c2 = 8 + t * 26;
      const g = (c: number, w: number) => Math.exp(-((n - c) * (n - c)) / (2 * w * w));
      return (g(c1, 1.6) + 0.7 * g(c2, 2.6)) / n * 4;
    }
    case "digital": {
      const saw = (2 / Math.PI) / n * (n % 2 === 0 ? -1 : 1);
      const grit = 1 + t * 3 * Math.sin(n * (2 + t * 5));
      return saw * grit;
    }
    default: return n === 1 ? 1 : 0;
  }
}

// One cycle of a table/position's shape, for a static waveform preview — sums
// the same crossfaded harmonic frames playNote() uses for oscA/oscB, just
// evaluated directly into samples instead of a PeriodicWave.
export function sampleWaveform(table: string, framePos: number, n = 256): Float32Array {
  const clamped = Math.max(0, Math.min(1, framePos)) * (FRAMES - 1);
  const frameA = Math.min(FRAMES - 2, Math.floor(clamped));
  const frac = clamped - frameA;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (i / n) * Math.PI * 2;
    let sum = 0;
    for (let h = 1; h <= HARMONICS; h++) {
      const ampA = harmonicAmp(table, frameA, h), ampB = harmonicAmp(table, frameA + 1, h);
      sum += (ampA * (1 - frac) + ampB * frac) * Math.sin(phase * h);
    }
    out[i] = sum;
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.0001) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

const tableCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function waveFor(ctx: BaseAudioContext, table: string, frame: number): PeriodicWave {
  let perCtx = tableCache.get(ctx);
  if (!perCtx) { perCtx = new Map(); tableCache.set(ctx, perCtx); }
  const key = `${table}:${frame}`;
  let wave = perCtx.get(key);
  if (!wave) {
    const real = new Float32Array(HARMONICS + 1), imag = new Float32Array(HARMONICS + 1);
    for (let n = 1; n <= HARMONICS; n++) imag[n] = harmonicAmp(table, frame, n);
    wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    perCtx.set(key, wave);
  }
  return wave;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

// ─── Modulation plumbing ─────────────────────────────────────────────────────
const SEMI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function noteToMidi(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note); if (!m) return 69;
  return SEMI.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
}
export function midiToFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }
export function midiToNote(midi: number): string {
  const m = Math.round(midi);
  return `${SEMI[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

interface ModBus {
  // node-based sources (connect through a scaling gain into AudioParams)
  lfo1: AudioNode | null;
  lfo2: AudioNode | null;
  env2: AudioNode | null;
  // static sources sampled at note-on
  statics: Record<string, number>;
}
function scaleInto(ctx: BaseAudioContext, src: AudioNode, param: AudioParam, amount: number): void {
  const g = ctx.createGain(); g.gain.value = amount;
  src.connect(g); g.connect(param);
}
function applyMatrix(
  ctx: BaseAudioContext, patch: VPatch, bus: ModBus, dest: ModDest, param: AudioParam, scale: number,
): void {
  patch.matrix.forEach((slot) => {
    if (slot.dest !== dest || !slot.amt) return;
    const nodeSrc = slot.src === "lfo1" ? bus.lfo1 : slot.src === "lfo2" ? bus.lfo2 : slot.src === "env2" ? bus.env2 : null;
    if (nodeSrc) scaleInto(ctx, nodeSrc, param, slot.amt * scale);
    else param.value += (bus.statics[slot.src] ?? 0) * slot.amt * scale;
  });
}
function staticModTotal(patch: VPatch, bus: ModBus, dest: ModDest): number {
  return patch.matrix.reduce((sum, slot) => {
    if (slot.dest !== dest) return sum;
    if (slot.src === "lfo1" || slot.src === "lfo2" || slot.src === "env2") return sum;
    return sum + (bus.statics[slot.src] ?? 0) * slot.amt;
  }, 0);
}

function scheduleAdsr(param: AudioParam, env: EnvPatch, peak: number, when: number, releaseAt: number | null): number {
  param.setValueAtTime(0.0001, when);
  param.linearRampToValueAtTime(peak, when + Math.max(0.001, env.a));
  param.setTargetAtTime(Math.max(0.0001, env.s * peak), when + Math.max(0.001, env.a), Math.max(0.005, env.d / 3));
  if (releaseAt !== null) {
    const rel = Math.max(when + env.a, releaseAt);
    param.setTargetAtTime(0.0001, rel, Math.max(0.005, env.r / 4));
    return rel + env.r + 0.1; // safe stop time
  }
  return Infinity;
}

// ─── Voice ───────────────────────────────────────────────────────────────────
export interface VoiceHandle { release(atTime: number): void; stop(): void; }

// Builds one note's full graph. `dur` null = held (live keys) — call release().
export function playNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patch: VPatch,
  note: string,
  velocity: number, // 0–127
  when: number,
  dur: number | null,
): VoiceHandle {
  const midi = noteToMidi(note);
  const vel = Math.max(0, Math.min(1, velocity / 127));
  const releaseAt = dur !== null ? when + dur : null;
  const stopNodes: Array<{ stop(t?: number): void }> = [];
  const started: Array<{ start(t?: number): void }> = [];

  // Mod sources
  const bus: ModBus = {
    lfo1: null, lfo2: null, env2: null,
    statics: {
      vel: vel * 2 - 1,
      macro1: patch.macros[0] ?? 0, macro2: patch.macros[1] ?? 0,
      macro3: patch.macros[2] ?? 0, macro4: patch.macros[3] ?? 0,
    },
  };
  const needs = (src: ModSrc) => patch.matrix.some((s) => s.src === src && s.amt !== 0);
  if (needs("lfo1")) {
    const o = ctx.createOscillator(); o.type = patch.lfo1.shape; o.frequency.value = patch.lfo1.rate;
    bus.lfo1 = o; stopNodes.push(o); started.push(o);
  }
  if (needs("lfo2")) {
    const o = ctx.createOscillator(); o.type = patch.lfo2.shape; o.frequency.value = patch.lfo2.rate;
    bus.lfo2 = o; stopNodes.push(o); started.push(o);
  }
  let env2Stop = Infinity;
  if (needs("env2") || patch.filter.env2 !== 0) {
    const c = ctx.createConstantSource(); c.offset.value = 0;
    env2Stop = scheduleAdsr(c.offset, patch.env2, 1, when, releaseAt);
    bus.env2 = c; stopNodes.push(c); started.push(c);
  }

  // Filter
  const filter = ctx.createBiquadFilter();
  filter.type = patch.filter.type;
  const track = Math.pow(2, ((midi - 60) / 12) * patch.filter.track);
  const baseCut = Math.max(30, Math.min(18000, patch.filter.cutoff * track * Math.pow(2, staticModTotal(patch, bus, "cutoff") * 4)));
  filter.frequency.value = baseCut;
  filter.Q.value = patch.filter.res;
  if (bus.env2 && patch.filter.env2 !== 0) scaleInto(ctx, bus.env2, filter.frequency, patch.filter.env2 * 9000);
  applyMatrix(ctx, patch, bus, "cutoff", filter.frequency, 6000);

  // Amp: env gain → (optional tremolo) → pan → dest
  const amp = ctx.createGain();
  const peak = patch.volume * (0.35 + 0.65 * vel) * (1 + staticModTotal(patch, bus, "amp") * 0.5);
  const ampStop = scheduleAdsr(amp.gain, patch.env1, Math.max(0.001, peak), when, releaseAt);
  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const panBase = Math.max(-1, Math.min(1, staticModTotal(patch, bus, "pan")));
  if (panner) {
    panner.pan.value = panBase;
    applyMatrix(ctx, patch, bus, "pan", panner.pan, 1);
    amp.connect(panner); panner.connect(dest);
  } else {
    amp.connect(dest);
  }
  applyMatrix(ctx, patch, bus, "amp", amp.gain, peak * 0.5);
  filter.connect(amp);

  // Oscillator sections
  ([["osc1", "pos1"], ["osc2", "pos2"]] as Array<["osc1" | "osc2", ModDest]>).forEach(([key, posDest]) => {
    const o = patch[key];
    if (o.level <= 0) return;
    const posStatic = Math.max(0, Math.min(1, o.pos + staticModTotal(patch, bus, posDest)));
    const framePos = posStatic * (FRAMES - 1);
    const frameA = Math.min(FRAMES - 2, Math.floor(framePos));
    const frac = framePos - frameA;
    const secGain = ctx.createGain();
    secGain.gain.value = o.level / Math.sqrt(o.unison);
    secGain.connect(filter);
    const baseFreq = midiToFreq(midi + o.octave * 12 + o.semi);
    for (let v = 0; v < o.unison; v++) {
      const spread = o.unison === 1 ? 0 : (2 * v / (o.unison - 1) - 1);
      const detune = spread * o.detune;
      const vGain = ctx.createGain(); vGain.gain.value = 1;
      // Unison stereo spread when panners are available
      if (panner && ctx.createStereoPanner && o.unison > 1) {
        const p = ctx.createStereoPanner(); p.pan.value = spread * 0.55;
        vGain.connect(p); p.connect(secGain);
      } else {
        vGain.connect(secGain);
      }
      // Two oscillators on adjacent frames, crossfaded by position
      const gA = ctx.createGain(); gA.gain.value = 1 - frac;
      const gB = ctx.createGain(); gB.gain.value = frac;
      gA.connect(vGain); gB.connect(vGain);
      const oscA = ctx.createOscillator(), oscB = ctx.createOscillator();
      oscA.setPeriodicWave(waveFor(ctx, o.table, frameA));
      oscB.setPeriodicWave(waveFor(ctx, o.table, frameA + 1));
      [oscA, oscB].forEach((osc) => {
        osc.frequency.value = baseFreq;
        osc.detune.value = detune + staticModTotal(patch, bus, "pitch") * 200;
        applyMatrix(ctx, patch, bus, "pitch", osc.detune, 200);
      });
      oscA.connect(gA); oscB.connect(gB);
      // Position modulation: inverse-linked crossfade gains
      patch.matrix.forEach((slot) => {
        if (slot.dest !== posDest || !slot.amt) return;
        const nodeSrc = slot.src === "lfo1" ? bus.lfo1 : slot.src === "lfo2" ? bus.lfo2 : slot.src === "env2" ? bus.env2 : null;
        if (!nodeSrc) return;
        scaleInto(ctx, nodeSrc, gB.gain, slot.amt);
        scaleInto(ctx, nodeSrc, gA.gain, -slot.amt);
      });
      stopNodes.push(oscA, oscB); started.push(oscA, oscB);
    }
  });

  // Noise
  if (patch.noise.level > 0) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = "lowpass"; nf.frequency.value = patch.noise.colour;
    const ng = ctx.createGain(); ng.gain.value = patch.noise.level * 0.6;
    src.connect(nf); nf.connect(ng); ng.connect(filter);
    stopNodes.push(src); started.push(src);
  }

  started.forEach((node) => node.start(when));
  let stopped = false;
  const stopAll = (t: number) => {
    if (stopped) return; stopped = true;
    stopNodes.forEach((node) => { try { node.stop(t); } catch { /* already stopped */ } });
  };
  if (releaseAt !== null) {
    const stopTime = Math.min(Math.max(ampStop, env2Stop === Infinity ? 0 : env2Stop), releaseAt + patch.env1.r + 4);
    stopAll(Math.max(releaseAt + patch.env1.r + 0.15, stopTime === Infinity ? 0 : stopTime));
  }
  return {
    release(atTime: number): void {
      if (releaseAt !== null) return; // sequenced notes already scheduled
      amp.gain.cancelScheduledValues(atTime);
      amp.gain.setTargetAtTime(0.0001, atTime, Math.max(0.005, patch.env1.r / 4));
      stopAll(atTime + patch.env1.r + 0.2);
    },
    stop(): void { stopAll(0); },
  };
}

// Live keyboard helper: tracks held notes against an AudioContext.
export class LiveVoices {
  private held = new Map<string, VoiceHandle>();
  noteOn(ctx: AudioContext, dest: AudioNode, patch: VPatch, note: string, velocity = 105): void {
    if (this.held.has(note)) return;
    this.held.set(note, playNote(ctx, dest, patch, note, velocity, ctx.currentTime, null));
  }
  noteOff(ctx: AudioContext, note: string): void {
    const v = this.held.get(note); if (!v) return;
    v.release(ctx.currentTime); this.held.delete(note);
  }
  panic(): void { this.held.forEach((v) => v.stop()); this.held.clear(); }
}
