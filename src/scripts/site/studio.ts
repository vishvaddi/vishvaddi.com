import "../../styles/studio.css";

// VishAmp Studio — Winamp-styled mini-DAW. Pure Web Audio, CSP-clean.

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
interface SamplerP {
  name: string;
  tune: number;
  start: number;
  end: number;
  reverse: boolean;
  filter: number;
  attack: number;
  decay: number;
  choke: number;
  loop: boolean;
  warp: boolean;
  sourceBpm: number;
}
interface PadEvent {
  pad: number;
  step: number;
  velocity: number;
  offset: number;
  probability: number;
  ratchets: number;
}
interface MpcState {
  bank: number;
  selectedPad: number;
  fullLevel: boolean;
  sixteenLevels: boolean;
  levelMode: "velocity" | "pitch" | "filter" | "start";
  noteRepeat: boolean;
  repeatDivision: number;
  quantize: number;
  quantizeStrength: number;
  recording: boolean;
  overdub: boolean;
  padMute: boolean[];
  padSolo: boolean[];
}
interface RackState {
  grooveTiming: number;
  grooveVelocity: number;
  grooveRandom: number;
  noteEcho: number;
  echoDecay: number;
  macros: number[];
  devices: Record<string, boolean>;
}
interface HistoryState {
  pats: boolean[][][];
  vels: number[][][];
  synthPats: boolean[][][];
  padEvents: PadEvent[][];
  sampleParams: SamplerP[];
  sampleData: Array<string | null>;
  songChain: number[];
  fx: FxState;
  rackState: RackState;
}
interface FxState {
  low: number;
  mid: number;
  high: number;
  compThreshold: number;
  compRatio: number;
  limiter: number;
  reverb: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
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
let eqLow: BiquadFilterNode | null = null;
let eqMid: BiquadFilterNode | null = null;
let eqHigh: BiquadFilterNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
const trackGain: GainNode[] = [];
let synthGain: GainNode | null = null;
let synthFilter: BiquadFilterNode | null = null;
let reverbConv: ConvolverNode | null = null;
let reverbWetGain: GainNode | null = null;
let delayNode: DelayNode | null = null;
let delayFeedbackGain: GainNode | null = null;
let delayWetGain: GainNode | null = null;
const fx: FxState = {
  low: 0, mid: 0, high: 0,
  compThreshold: -18, compRatio: 3, limiter: -1,
  reverb: 0, delayTime: 0.25, delayFeedback: 0.25, delayMix: 0,
};

function ac(): AudioContext {
  if (!AC) {
    AC = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.8;
    eqLow = AC.createBiquadFilter(); eqLow.type = "lowshelf"; eqLow.frequency.value = 180;
    eqMid = AC.createBiquadFilter(); eqMid.type = "peaking"; eqMid.frequency.value = 1200; eqMid.Q.value = 0.8;
    eqHigh = AC.createBiquadFilter(); eqHigh.type = "highshelf"; eqHigh.frequency.value = 6500;
    compressor = AC.createDynamicsCompressor();
    limiter = AC.createDynamicsCompressor();
    applyFxState();
    master.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(compressor); compressor.connect(limiter); limiter.connect(AC.destination);
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
    master!.connect(reverbConv); reverbConv.connect(reverbWetGain); reverbWetGain.connect(eqLow!);
  } else {
    reverbWetGain!.gain.value = wet;
  }
}
function initDelay(): void {
  if (delayNode) return;
  const a = ac();
  delayNode = a.createDelay(2); delayFeedbackGain = a.createGain(); delayWetGain = a.createGain();
  master!.connect(delayNode); delayNode.connect(delayFeedbackGain); delayFeedbackGain.connect(delayNode);
  delayNode.connect(delayWetGain); delayWetGain.connect(eqLow!);
  applyFxState();
}
function applyFxState(): void {
  if (eqLow) eqLow.gain.value = rackState.devices.eq ? fx.low : 0;
  if (eqMid) eqMid.gain.value = rackState.devices.eq ? fx.mid : 0;
  if (eqHigh) eqHigh.gain.value = rackState.devices.eq ? fx.high : 0;
  if (compressor) {
    compressor.threshold.value = rackState.devices.compressor ? fx.compThreshold : 0;
    compressor.ratio.value = rackState.devices.compressor ? fx.compRatio : 1;
    compressor.attack.value = 0.01; compressor.release.value = 0.2; compressor.knee.value = 12;
  }
  if (limiter) {
    limiter.threshold.value = rackState.devices.limiter ? fx.limiter : 0;
    limiter.ratio.value = rackState.devices.limiter ? 20 : 1;
    limiter.attack.value = 0.001; limiter.release.value = 0.08; limiter.knee.value = 0;
  }
  if (reverbWetGain) reverbWetGain.gain.value = rackState.devices.reverb ? fx.reverb : 0;
  if (delayNode) delayNode.delayTime.value = fx.delayTime;
  if (delayFeedbackGain) delayFeedbackGain.gain.value = fx.delayFeedback;
  if (delayWetGain) delayWetGain.gain.value = rackState.devices.delay ? fx.delayMix : 0;
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
const PAD_COUNT = 64;
const PAD_BANK_SIZE = 16;
const sampleParams: SamplerP[] = Array.from({ length: PAD_COUNT }, (_, i) => ({
  name: i < DRUMS.length ? DRUMS[i] : "",
  tune: 0, start: 0, end: 1, reverse: false, filter: 18000,
  attack: 0, decay: 1, choke: i === 2 || i === 3 ? 1 : 0, loop: false, warp: false, sourceBpm: 170,
}));
const sampleBuffers: Array<AudioBuffer | null> = Array.from({ length: PAD_COUNT }, () => null);
const sampleData: Array<string | null> = Array.from({ length: PAD_COUNT }, () => null);
const chokeSources = new Map<number, AudioBufferSourceNode[]>();

function playSample(
  a: BaseAudioContext,
  out: AudioNode,
  r: number,
  vol: number,
  when: number,
  overrides: Partial<Pick<SamplerP, "tune" | "start" | "filter">> = {},
): boolean {
  const buffer = sampleBuffers[r]; if (!buffer) return false;
  const p = sampleParams[r], src = a.createBufferSource(), g = a.createGain(), filter = a.createBiquadFilter();
  const playable = p.reverse ? reversedBuffer(a, buffer) : buffer;
  src.buffer = playable;
  src.playbackRate.value = Math.pow(2, (overrides.tune ?? p.tune) / 12);
  src.loop = p.loop;
  filter.type = "lowpass"; filter.frequency.value = overrides.filter ?? p.filter;
  const attack = Math.min(0.5, p.attack), playDur = Math.max(0.01, (p.end - (overrides.start ?? p.start)) * buffer.duration);
  g.gain.setValueAtTime(attack > 0 ? 0.0001 : vol, when);
  if (attack > 0) g.gain.linearRampToValueAtTime(vol, when + attack);
  g.gain.setValueAtTime(vol, Math.max(when + attack, when + playDur - Math.min(playDur, p.decay)));
  g.gain.exponentialRampToValueAtTime(0.0001, when + playDur);
  src.connect(filter); filter.connect(g); g.connect(out);
  const offset = Math.min(buffer.duration, (overrides.start ?? p.start) * buffer.duration);
  if (p.warp) {
    const sourceDuration = playDur, targetDuration = sourceDuration * (p.sourceBpm / bpm);
    const grainSize = 0.06, hop = 0.03, grains = Math.max(1, Math.ceil(targetDuration / hop));
    for (let i = 0; i < grains; i++) {
      const grain = a.createBufferSource(), envelope = a.createGain(), grainFilter = a.createBiquadFilter();
      grain.buffer = playable; grain.playbackRate.value = 1;
      grainFilter.type = "lowpass"; grainFilter.frequency.value = overrides.filter ?? p.filter;
      const grainWhen = when + i * hop, sourceOffset = offset + (i / grains) * sourceDuration;
      envelope.gain.setValueAtTime(0.0001, grainWhen);
      envelope.gain.linearRampToValueAtTime(vol, grainWhen + grainSize * 0.25);
      envelope.gain.exponentialRampToValueAtTime(0.0001, grainWhen + grainSize);
      grain.connect(grainFilter); grainFilter.connect(envelope); envelope.connect(out);
      grain.start(grainWhen, Math.min(playable.duration - 0.01, sourceOffset), Math.min(grainSize, playable.duration - sourceOffset));
    }
    return true;
  }
  if (a === AC && p.choke > 0) {
    chokeSources.get(p.choke)?.forEach((node) => { try { node.stop(when); } catch { /* already stopped */ } });
    chokeSources.set(p.choke, [src]);
  }
  src.start(when, offset, playDur);
  return true;
}
function reversedBuffer(a: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const out = a.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c), target = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) target[i] = input[source.length - 1 - i];
  }
  return out;
}
function playDrum(a: BaseAudioContext, out: AudioNode, r: number, vol: number, when: number): void {
  if (playSample(a, out, r, vol, when)) return;
  if (r >= DRUMS.length) return;
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
  osc.connect(g); g.connect(synthGain!); osc.start();
  activeN.set(note, { osc, gain: g });
}

function playPad(
  a: BaseAudioContext,
  pad: number,
  velocity: number,
  when: number,
  variation = 0,
  output?: AudioNode,
): void {
  const anySolo = mpc.padSolo.some(Boolean);
  if (mpc.padMute[pad] || (anySolo && !mpc.padSolo[pad])) return;
  const out = output ?? trackGain[pad % trackGain.length] ?? master!;
  const mode = mpc.sixteenLevels ? mpc.levelMode : null;
  const scaled = Math.max(0, Math.min(1, velocity / 127));
  const tune = mode === "pitch" ? variation * 2 : sampleParams[pad].tune;
  const filter = mode === "filter" ? 300 + (variation + 1) * 550 : sampleParams[pad].filter;
  const start = mode === "start" ? Math.max(0, Math.min(0.95, variation / 15)) : sampleParams[pad].start;
  if (!playSample(a, out, pad, scaled, when, { tune, filter, start })) playDrum(a, out, pad % DRUMS.length, scaled, when);
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
const SONG_SLOTS = 8;
const PIANO_NOTES = ["B4", "A#4", "A4", "G#4", "G4", "F#4", "F4", "E4", "D#4", "D4", "C#4", "C4"];
let bpm = 120, swing = 0, metro = false, curPat = 0, songMode = false;
const allPats: boolean[][][] = Array.from({ length: NUM_PATS }, () => DRUMS.map(() => new Array(STEPS).fill(false)));
const allVels: number[][][] = Array.from({ length: NUM_PATS }, () => DRUMS.map(() => new Array(STEPS).fill(100)));
const synthPats: boolean[][][] = Array.from({ length: NUM_PATS }, () => PIANO_NOTES.map(() => new Array(STEPS).fill(false)));
const songChain = Array.from({ length: SONG_SLOTS }, (_, i) => i % NUM_PATS);
const padEvents: PadEvent[][] = Array.from({ length: NUM_PATS }, () => []);
const mpc: MpcState = {
  bank: 0, selectedPad: 0, fullLevel: false, sixteenLevels: false, levelMode: "velocity",
  noteRepeat: false, repeatDivision: 4, quantize: 4, quantizeStrength: 100,
  recording: false, overdub: true,
  padMute: Array.from({ length: PAD_COUNT }, () => false),
  padSolo: Array.from({ length: PAD_COUNT }, () => false),
};
const rackState: RackState = {
  grooveTiming: 0, grooveVelocity: 0, grooveRandom: 0,
  noteEcho: 0, echoDecay: 0.65, macros: [0, 0, 0, 0],
  devices: { player: true, sampler: true, character: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true },
};
const mute = new Array(8).fill(false);
const solo = new Array(8).fill(false);
function pat(): boolean[][] { return allPats[curPat]; }
function audible(r: number): boolean { const s = solo.some(Boolean); return !mute[r] && (!s || solo[r]); }
const stepDur = (): number => 60 / bpm / 4;

// ─── Persistence ─────────────────────────────────────────────────────────────
function saveAll(): void {
  try {
    localStorage.setItem("vv_studio_v2", JSON.stringify(projectState(false)));
    window.dispatchEvent(new CustomEvent("vv-studio-saved"));
  } catch { /* ignore */ }
}
function historyState(): HistoryState {
  return {
    pats: allPats.map((pattern) => pattern.map((row) => [...row])),
    vels: allVels.map((pattern) => pattern.map((row) => [...row])),
    synthPats: synthPats.map((pattern) => pattern.map((row) => [...row])),
    padEvents: padEvents.map((events) => events.map((event) => ({ ...event }))),
    sampleParams: sampleParams.map((params) => ({ ...params })),
    sampleData: [...sampleData],
    songChain: [...songChain],
    fx: { ...fx },
    rackState: { ...rackState, macros: [...rackState.macros], devices: { ...rackState.devices } },
  };
}
function restoreHistory(state: HistoryState): void {
  state.pats.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allPats[pi][ri][step] = value; })));
  state.vels.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { allVels[pi][ri][step] = value; })));
  state.synthPats.forEach((pattern, pi) => pattern.forEach((row, ri) => row.forEach((value, step) => { synthPats[pi][ri][step] = value; })));
  state.padEvents.forEach((events, i) => { padEvents[i] = events.map((event) => ({ ...event })); });
  state.sampleParams.forEach((params, i) => Object.assign(sampleParams[i], params));
  state.sampleData.forEach((data, i) => { sampleData[i] = data; sampleBuffers[i] = null; if (data) void hydrateSample(i); });
  state.songChain.forEach((pattern, i) => { songChain[i] = pattern; });
  Object.assign(fx, state.fx);
  Object.assign(rackState, state.rackState);
  rackState.macros = [...state.rackState.macros]; rackState.devices = { ...state.rackState.devices };
  applyFxState(); saveAll();
}
function projectState(includeSamples = true): object {
  const samplePool: string[] = [];
  const sampleRefs = sampleData.map((data) => {
    if (!includeSamples || !data) return -1;
    let index = samplePool.indexOf(data);
    if (index < 0) { samplePool.push(data); index = samplePool.length - 1; }
    return index;
  });
  return {
    version: 4,
    pats: allPats.map((p) => p.map((r) => r.map((b) => (b ? 1 : 0)))),
    vels: allVels,
    dp,
    bpm,
    curPat,
    synthPats: synthPats.map((p) => p.map((r) => r.map((b) => (b ? 1 : 0)))),
    synth,
    songChain,
    songMode,
    sampleParams,
    samplePool,
    sampleRefs,
    fx,
    padEvents,
    mpc,
    rackState,
  };
}
function playSynthStep(a: BaseAudioContext, out: AudioNode, note: string, when: number, duration: number, vol: number): void {
  const osc = a.createOscillator(), g = a.createGain(), filter = a.createBiquadFilter();
  osc.type = synth.osc; osc.frequency.value = freq(note);
  filter.type = "lowpass"; filter.frequency.value = synth.cutoff; filter.Q.value = synth.q;
  const attackEnd = when + Math.min(synth.attack, duration * 0.45);
  const releaseStart = Math.max(attackEnd, when + duration - synth.release);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vol, attackEnd);
  g.gain.setValueAtTime(vol, releaseStart);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(filter); filter.connect(g); g.connect(out); osc.start(when); osc.stop(when + duration + 0.02);
}
function loadAll(): void {
  try {
    const raw = localStorage.getItem("vv_studio_v2") || localStorage.getItem("vv_studio_pattern");
    if (!raw) return;
    applyProject(JSON.parse(raw));
  } catch { /* ignore */ }
}
function applyProject(saved: Record<string, unknown>): void {
  try {
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
      if (saved.synthPats) (saved.synthPats as number[][][]).forEach((pp, pi) => {
        if (pi >= NUM_PATS) return;
        pp.forEach((row, ri) => { if (ri < PIANO_NOTES.length) row.forEach((v, ci) => { if (ci < STEPS) synthPats[pi][ri][ci] = !!v; }); });
      });
      if (saved.synth) Object.assign(synth, saved.synth as object);
      if (saved.songChain) (saved.songChain as number[]).forEach((v, i) => {
        if (i < SONG_SLOTS) songChain[i] = Math.max(0, Math.min(NUM_PATS - 1, Number(v) || 0));
      });
      if (typeof saved.songMode === "boolean") songMode = saved.songMode;
      if (saved.sampleParams) (saved.sampleParams as Partial<SamplerP>[]).forEach((p, i) => { if (i < PAD_COUNT) Object.assign(sampleParams[i], p); });
      if (saved.samplePool && saved.sampleRefs) {
        const pool = saved.samplePool as string[], refs = saved.sampleRefs as number[];
        refs.forEach((ref, i) => { if (i < PAD_COUNT) sampleData[i] = ref >= 0 ? pool[ref] ?? null : null; });
      } else if (saved.sampleData) {
        (saved.sampleData as Array<string | null>).forEach((v, i) => { if (i < PAD_COUNT) sampleData[i] = v; });
      }
      if (saved.fx) Object.assign(fx, saved.fx as object);
      if (saved.padEvents) (saved.padEvents as PadEvent[][]).forEach((events, i) => {
        if (i < NUM_PATS) padEvents[i] = events.map((event) => ({ ...event }));
      });
      if (saved.mpc) Object.assign(mpc, saved.mpc as object);
      if (saved.rackState) {
        const incoming = saved.rackState as Partial<RackState>;
        Object.assign(rackState, incoming);
        rackState.devices = { ...rackState.devices, ...(incoming.devices ?? {}) };
      }
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
function help(target: HTMLElement, text: string): HTMLElement {
  target.dataset.help = text;
  target.setAttribute("aria-description", text);
  return target;
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
async function hydrateSample(r: number): Promise<void> {
  const data = sampleData[r]; if (!data) { sampleBuffers[r] = null; return; }
  sampleBuffers[r] = await ac().decodeAudioData(dataUrlToBytes(data));
}
function pendingProjectStore(mode: "get" | "put", value?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vishamp", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onblocked = () => reject(new Error("Project storage is blocked"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("projects", "readwrite"), store = tx.objectStore("projects");
      if (mode === "put") store.put(value, "pending");
      else {
        const get = store.get("pending");
        get.onsuccess = () => {
          const result = (get.result as Record<string, unknown> | undefined) ?? null;
          if (result) store.delete("pending");
          resolve(result);
        };
        get.onerror = () => reject(get.error);
      }
      tx.oncomplete = () => { db.close(); if (mode === "put") resolve(null); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    };
  });
}
// Decode a data: URL straight to bytes. We must NOT fetch() data: URLs — the
// site CSP is `connect-src 'self'` (no data:), so fetch("data:…") is blocked and
// throws "could not decode audio". atob avoids the network entirely.
function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
  const binary = /;base64/i.test(meta) ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function equalSlices(count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => [i / count, (i + 1) / count]);
}
function transientSlices(buffer: AudioBuffer, count = 16): Array<[number, number]> {
  const data = buffer.getChannelData(0), windowSize = Math.max(128, Math.floor(data.length / 512));
  const peaks: Array<{ pos: number; energy: number }> = [];
  let previous = 0;
  for (let i = 0; i < data.length; i += windowSize) {
    let energy = 0;
    for (let j = i; j < Math.min(data.length, i + windowSize); j++) energy += Math.abs(data[j]);
    energy /= windowSize;
    const rise = energy - previous; previous = energy;
    if (rise > 0.015) peaks.push({ pos: i / data.length, energy: rise });
  }
  const starts = [0, ...peaks.sort((a, b) => b.energy - a.energy).slice(0, count - 1).map((p) => p.pos)]
    .sort((a, b) => a - b);
  if (starts.length < 2) return equalSlices(count);
  return starts.slice(0, count).map((start, i) => [start, starts[i + 1] ?? 1]);
}
function snapZero(buffer: AudioBuffer, position: number): number {
  const data = buffer.getChannelData(0), centre = Math.floor(position * data.length), radius = Math.min(1024, Math.floor(data.length / 100));
  let best = centre, bestValue = Math.abs(data[centre] ?? 0);
  for (let i = Math.max(1, centre - radius); i < Math.min(data.length - 1, centre + radius); i++) {
    const value = Math.abs(data[i]);
    if (value < bestValue || (data[i - 1] <= 0 && data[i] >= 0)) { best = i; bestValue = value; if (bestValue < 0.0001) break; }
  }
  return best / data.length;
}
function euclideanPattern(steps: number, pulses: number, rotation: number): boolean[] {
  const pattern = Array.from({ length: steps }, (_, step) => ((step * pulses) % steps) < pulses);
  return pattern.map((_, i) => pattern[(i - rotation + steps) % steps]);
}
function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer, slices: Array<[number, number]>): void {
  const scale = window.devicePixelRatio || 1, width = canvas.clientWidth || 900, height = canvas.clientHeight || 220;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.scale(scale, scale); ctx.fillStyle = "#0c0c12"; ctx.fillRect(0, 0, width, height);
  const data = buffer.getChannelData(0), stride = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = "#22ee55"; ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let i = x * stride; i < Math.min(data.length, (x + 1) * stride); i++) peak = Math.max(peak, Math.abs(data[i]));
    const y = peak * height * 0.45;
    ctx.moveTo(x, height / 2 - y); ctx.lineTo(x, height / 2 + y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#ffe24d"; ctx.fillStyle = "#ffe24d"; ctx.font = "10px monospace";
  slices.forEach(([start], i) => {
    const x = start * width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); ctx.fillText(String(i + 1), x + 3, 12);
  });
}
function crushBuffer(source: AudioBuffer, bits: number, downsample: number): AudioBuffer {
  const out = ac().createBuffer(source.numberOfChannels, source.length, source.sampleRate), levels = Math.pow(2, bits - 1);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c), target = out.getChannelData(c);
    let held = 0;
    for (let i = 0; i < input.length; i++) {
      if (i % downsample === 0) held = Math.round(input[i] * levels) / levels;
      target[i] = held;
    }
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────
export async function initStudio(): Promise<void> {
  const root = document.getElementById("studio");
  if (!root) return;

  const pending = await Promise.race([
    pendingProjectStore("get").catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (pending) applyProject(pending); else loadAll();
  sampleData.forEach((data, r) => { if (data) void hydrateSample(r); });

  const win = el("div", "wa-win");
  const titleBar = el("div", "wa-title");
  const projectName = document.createElement("input");
  projectName.className = "wa-project-name"; projectName.value = localStorage.getItem("vv_studio_name") || "Untitled beat";
  projectName.setAttribute("aria-label", "Project name");
  projectName.addEventListener("change", () => { localStorage.setItem("vv_studio_name", projectName.value.trim() || "Untitled beat"); });
  titleBar.append(el("span", "wa-title-text", "VISHAMP — STUDIO"), projectName, el("span", "wa-title-dots"));
  const lcd = el("div", "wa-lcd");
  const lcdBpm = el("span", "wa-lcd-seg", `${bpm} BPM`);
  const lcdState = el("span", "wa-lcd-seg", "■ STOP");
  const saveState = el("span", "wa-save-state", "SAVED");
  window.addEventListener("vv-studio-saved", () => {
    saveState.textContent = "SAVED"; saveState.classList.add("flash");
    setTimeout(() => saveState.classList.remove("flash"), 450);
  });
  lcd.append(lcdBpm, lcdState, saveState);

  // ── Transport ──
  const transport = el("div", "wa-transport");
  const playBtn = btn("▶"), stopBtn = btn("■");
  const bpmDown = btn("–", "wa-btn-sm"), bpmUp = btn("+", "wa-btn-sm");
  const bpmLabel = el("span", "wa-bpm", String(bpm));
  const swingIn = document.createElement("input");
  swingIn.type = "range"; swingIn.min = "0"; swingIn.max = "0.6"; swingIn.step = "0.02"; swingIn.value = "0"; swingIn.className = "wa-swing-in";
  const swingWrap = el("span", "wa-swing"); swingWrap.append(el("span", "wa-lbl", "Swing"), swingIn);
  const metroBtn = btn("Metro", "wa-toggle"), songBtn = btn(songMode ? "Song" : "Pattern", "wa-toggle"), rotBtn = btn("⤢ Flip", "wa-btn-sm");
  const undoBtn = btn("Undo", "wa-btn-sm"), redoBtn = btn("Redo", "wa-btn-sm");
  const tutorialBtn = btn("? Tutorial", "wa-btn-sm");
  help(playBtn, "Start playback from the beginning of the current pattern or song.");
  help(stopBtn, "Stop playback and clear the playhead.");
  help(metroBtn, "Toggle the metronome. It is also included in audio export while enabled.");
  help(songBtn, "Switch between looping the active pattern and playing the arranged song chain.");
  help(undoBtn, "Restore the previous destructive edit, including chops, fills and dropped samples.");
  help(redoBtn, "Reapply the last undone edit.");
  help(rotBtn, "Expand Studio to the viewport. On portrait phones this rotates the workstation.");
  songBtn.classList.toggle("active", songMode);
  transport.append(playBtn, stopBtn, el("span", "wa-sep"), el("span", "wa-lbl", "BPM"), bpmDown, bpmLabel, bpmUp, el("span", "wa-sep"), swingWrap, metroBtn, songBtn, el("span", "wa-sep"), undoBtn, redoBtn, tutorialBtn, rotBtn);
  const undoStack: HistoryState[] = [], redoStack: HistoryState[] = [];
  function checkpoint(): void {
    undoStack.push(historyState());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = true;
  }
  undoBtn.disabled = true; redoBtn.disabled = true;

  // ── Workspaces ──
  const tabbar = el("div", "wa-tabs"), panels = el("div", "wa-panels");
  const tabNames = ["Create", "Sequence", "Arrange", "Mix"];
  const tabBtns: HTMLElement[] = [], panelEls: HTMLElement[] = [];
  let activeTab = Math.max(0, Math.min(3, Number(localStorage.getItem("vv_studio_workspace")) || 0));
  let queuedPat: number | null = null;
  tabNames.forEach((t, i) => {
    const b = btn(t, "wa-tab"); b.classList.remove("wa-btn");
    const descriptions = [
      "Load or record samples, chop breaks and perform on the pads.",
      "Program drums and synth notes with step and piano-roll editors.",
      "Launch patterns live or order them into a complete song.",
      "Shape the sound, balance tracks and save or export the project.",
    ];
    help(b, descriptions[i]);
    b.addEventListener("click", () => { activeTab = i; localStorage.setItem("vv_studio_workspace", String(i)); paintTabs(); });
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
      synthCells.forEach((row, r) => row.forEach((cell, c) => cell.classList.toggle("on", synthPats[curPat][r][c])));
      saveAll();
    });
    patBtns.push(pb); patRow.append(pb);
  });
  const copyBtn = btn("Copy →next", "wa-btn-sm");
  copyBtn.title = "Copy this pattern to the next slot";
  copyBtn.addEventListener("click", () => {
    checkpoint();
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
  const synthCells: HTMLElement[][] = [];

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
    checkpoint();
    for (let r = 0; r < 8; r++) for (let c = 0; c < STEPS; c++) {
      allPats[curPat][r][c] = false; cells[r][c].classList.remove("on"); cells[r][c].style.opacity = "";
    }
    saveAll();
  });
  const rowTools = el("div", "wa-row-tools"); rowTools.append(clearBtn);
  beat.append(grid, rowTools);

  // ── MPC performance ──
  const mpcPanel = el("div", "wa-panel");
  const mpcToolbar = el("div", "wa-mpc-toolbar");
  const bankButtons: HTMLButtonElement[] = [];
  const padButtons: HTMLButtonElement[] = [];
  const eventCells: HTMLButtonElement[] = [];
  const repeatTimers = new Map<number, number>();
  const performanceStatus = el("span", "wa-status", "Ready");
  const fullLevelBtn = btn("Full Level", "wa-toggle wa-btn-sm");
  const levelsBtn = btn("16 Levels", "wa-toggle wa-btn-sm");
  const repeatBtn = btn("Note Repeat", "wa-toggle wa-btn-sm");
  const recordBtn = btn("Record", "wa-toggle wa-btn-sm");
  const overdubBtn = btn("Overdub", "wa-toggle wa-btn-sm active");
  const undoPassBtn = btn("Undo pass", "wa-btn-sm");
  const rotateBtn = btn("Rotate", "wa-btn-sm"), mutateBtn = btn("Mutate", "wa-btn-sm"), fillBtn = btn("Fill", "wa-btn-sm");
  const ghostBtn = btn("Ghosts", "wa-btn-sm"), extractGrooveBtn = btn("Extract groove", "wa-btn-sm");
  const resampleBtn = btn("Resample → pad", "wa-btn-sm");
  const midiBtn = btn("MIDI", "wa-toggle wa-btn-sm");
  help(fullLevelBtn, "Force every pad hit to maximum velocity.");
  help(levelsBtn, "Map the 16 pads across velocity, pitch, filter cutoff or sample start.");
  help(repeatBtn, "Retrigger a held pad at the division selected beside it.");
  help(recordBtn, "Capture pad hits into the active pattern while playback runs.");
  help(overdubBtn, "Keep existing events while recording. Disable it to replace events at recorded steps.");
  help(undoPassBtn, "Remove the most recent pad-recording pass.");
  help(rotateBtn, "Move every pad event one step later.");
  help(mutateBtn, "Create a variation by changing timing, velocity and occasional ratchets.");
  help(fillBtn, "Write a four-step fill for the selected pad at the end of the pattern.");
  help(ghostBtn, "Add low-velocity, probabilistic ghost notes for the selected pad.");
  help(extractGrooveBtn, "Create groove timing and velocity settings from the current pad performance.");
  help(midiBtn, "Connect Web MIDI inputs. Notes starting at MIDI note 36 map across the 16 pads.");
  help(resampleBtn, "Render the active pattern through the mixer and effects onto the selected pad.");
  const resampleQuality = document.createElement("select");
  [["clean", "Clean"], ["12bit", "12-bit"], ["8bit", "8-bit"], ["jungle", "Jungle grit"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; resampleQuality.append(option);
  });
  let recordSnapshot: PadEvent[] | null = null;
  const levelModeSel = document.createElement("select");
  [["velocity", "16 Velocities"], ["pitch", "16 Pitches"], ["filter", "16 Filters"], ["start", "16 Starts"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; levelModeSel.append(option);
  });
  levelModeSel.value = mpc.levelMode;
  const repeatSel = document.createElement("select");
  [["2", "1/8"], ["3", "1/8T"], ["4", "1/16"], ["6", "1/16T"], ["8", "1/32"], ["16", "1/64"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; repeatSel.append(option);
  });
  repeatSel.value = String(mpc.repeatDivision);
  const quantSel = document.createElement("select");
  [["0", "Quantise off"], ["2", "1/8"], ["3", "1/8T"], ["4", "1/16"], ["6", "1/16T"], ["8", "1/32"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; quantSel.append(option);
  });
  quantSel.value = String(mpc.quantize);
  mpcToolbar.append(fullLevelBtn, levelsBtn, levelModeSel, repeatBtn, repeatSel, recordBtn, overdubBtn, undoPassBtn, quantSel, rotateBtn, mutateBtn, fillBtn, ghostBtn, extractGrooveBtn, midiBtn, resampleQuality, resampleBtn, performanceStatus);

  const padBankRow = el("div", "wa-pad-banks");
  ["A", "B", "C", "D"].forEach((label, bank) => {
    const button = btn(`Bank ${label}`, "wa-pat-btn" + (mpc.bank === bank ? " active" : ""));
    button.classList.remove("wa-btn");
    button.addEventListener("click", () => {
      mpc.bank = bank; bankButtons.forEach((item, i) => item.classList.toggle("active", i === bank)); paintMpcPads(); saveAll();
    });
    bankButtons.push(button); padBankRow.append(button);
  });
  const padGrid = el("div", "wa-mpc-pads");
  const selectedPadLabel = el("span", "wa-status");
  const selectedSampleEditor = el("div", "wa-selected-sample");
  const selectedInputs: Array<{ key: keyof SamplerP; input: HTMLInputElement; out: HTMLElement }> = [];
  function selectedParam(label: string, key: keyof SamplerP, min: number, max: number, step: number): HTMLElement {
    const row = el("div", "wa-slider-row"), input = document.createElement("input"), out = el("span", "wa-val");
    input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.className = "wa-slider";
    input.addEventListener("input", () => {
      const value = Number(input.value); (sampleParams[mpc.selectedPad][key] as number) = value; out.textContent = String(value); saveAll();
    });
    selectedInputs.push({ key, input, out }); row.append(el("span", "wa-lbl", label), input, out); return row;
  }
  const reverseSelectedBtn = btn("Reverse", "wa-toggle wa-btn-sm"), loopSelectedBtn = btn("Loop", "wa-toggle wa-btn-sm"), warpSelectedBtn = btn("Warp", "wa-toggle wa-btn-sm");
  const muteSelectedBtn = btn("Mute", "wa-toggle wa-btn-sm"), soloSelectedBtn = btn("Solo", "wa-toggle wa-btn-sm");
  help(reverseSelectedBtn, "Play this pad's audio backwards.");
  help(loopSelectedBtn, "Loop the selected sample while it plays.");
  help(warpSelectedBtn, "Use granular playback to follow project tempo without ordinary repitching.");
  help(muteSelectedBtn, "Silence the selected pad.");
  help(soloSelectedBtn, "Play only soloed pads.");
  reverseSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.reverse = !p.reverse; reverseSelectedBtn.classList.toggle("active", p.reverse); saveAll();
  });
  loopSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.loop = !p.loop; loopSelectedBtn.classList.toggle("active", p.loop); saveAll();
  });
  warpSelectedBtn.addEventListener("click", () => {
    const p = sampleParams[mpc.selectedPad]; p.warp = !p.warp; warpSelectedBtn.classList.toggle("active", p.warp); saveAll();
  });
  muteSelectedBtn.addEventListener("click", () => {
    mpc.padMute[mpc.selectedPad] = !mpc.padMute[mpc.selectedPad]; paintMpcPads(); saveAll();
  });
  soloSelectedBtn.addEventListener("click", () => {
    mpc.padSolo[mpc.selectedPad] = !mpc.padSolo[mpc.selectedPad]; paintMpcPads(); saveAll();
  });
  selectedSampleEditor.append(
    selectedParam("Tune", "tune", -24, 24, 1),
    selectedParam("Start", "start", 0, 0.95, 0.01),
    selectedParam("End", "end", 0.05, 1, 0.01),
    selectedParam("Filter", "filter", 200, 18000, 100),
    selectedParam("Attack", "attack", 0, 0.5, 0.01),
    selectedParam("Decay", "decay", 0.02, 2, 0.02),
    selectedParam("Choke", "choke", 0, 8, 1),
    selectedParam("Source BPM", "sourceBpm", 40, 240, 1),
    reverseSelectedBtn, loopSelectedBtn, warpSelectedBtn, muteSelectedBtn, soloSelectedBtn,
  );

  function selectedGlobalPad(localPad: number): number { return mpc.bank * PAD_BANK_SIZE + localPad; }
  function paintMpcPads(): void {
    padButtons.forEach((button, localPad) => {
      const pad = selectedGlobalPad(localPad), params = sampleParams[pad];
      button.classList.toggle("selected", pad === mpc.selectedPad);
      button.replaceChildren(
        el("span", "wa-mpc-pad-number", String(localPad + 1)),
        el("span", "wa-mpc-pad-name", params.name || `Pad ${pad + 1}`),
      );
    });
    selectedPadLabel.textContent = `Selected: ${sampleParams[mpc.selectedPad].name || `Pad ${mpc.selectedPad + 1}`}`;
    const selected = sampleParams[mpc.selectedPad];
    selectedInputs.forEach(({ key, input, out }) => {
      input.value = String(selected[key]); out.textContent = String(selected[key]);
    });
    reverseSelectedBtn.classList.toggle("active", selected.reverse); loopSelectedBtn.classList.toggle("active", selected.loop);
    warpSelectedBtn.classList.toggle("active", selected.warp);
    muteSelectedBtn.classList.toggle("active", mpc.padMute[mpc.selectedPad]);
    soloSelectedBtn.classList.toggle("active", mpc.padSolo[mpc.selectedPad]);
    paintEventLane();
  }
  function variationFor(localPad: number): number {
    if (mpc.levelMode === "velocity") return localPad / 15;
    if (mpc.levelMode === "pitch") return localPad - 8;
    return localPad;
  }
  function recordPadEvent(pad: number, velocity: number): void {
    if (!mpc.recording || !playing) return;
    const rawStep = lastHi >= 0 ? lastHi : schStep;
    const grid = mpc.quantize || STEPS;
    const snapped = Math.round(rawStep / (STEPS / grid)) * (STEPS / grid);
    const strength = mpc.quantizeStrength / 100;
    const step = Math.round(rawStep + (snapped - rawStep) * strength) % STEPS;
    if (!mpc.overdub) padEvents[curPat] = padEvents[curPat].filter((event) => event.step !== step);
    else padEvents[curPat] = padEvents[curPat].filter((event) => !(event.step === step && event.pad === pad));
    const playedOffset = lastStepStartedMs > 0 ? Math.max(-60, Math.min(60, performance.now() - lastStepStartedMs)) : 0;
    padEvents[curPat].push({ pad, step, velocity, offset: playedOffset, probability: 100, ratchets: 1 });
    paintEventLane(); saveAll();
  }
  function triggerPerformancePad(localPad: number, velocity: number): void {
    ensureNodes();
    const pad = selectedGlobalPad(localPad);
    const levelVelocity = 8 + localPad * 8;
    const finalVelocity = mpc.fullLevel ? 127 : (mpc.sixteenLevels && mpc.levelMode === "velocity" ? levelVelocity : velocity);
    mpc.selectedPad = pad; paintMpcPads();
    playPad(ac(), pad, finalVelocity, ac().currentTime, variationFor(localPad));
    recordPadEvent(pad, finalVelocity);
    if (rackState.noteEcho > 0) {
      for (let i = 1; i <= rackState.noteEcho; i++) {
        playPad(ac(), pad, finalVelocity * Math.pow(rackState.echoDecay, i), ac().currentTime + i * stepDur(), variationFor(localPad));
      }
    }
  }
  midiBtn.addEventListener("click", async () => {
    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<{ inputs: Map<unknown, { onmidimessage: ((event: { data: Uint8Array }) => void) | null }> }>;
    };
    if (!nav.requestMIDIAccess) { performanceStatus.textContent = "Web MIDI is not supported"; return; }
    try {
      const access = await nav.requestMIDIAccess();
      access.inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          const [status, note, velocity] = event.data, command = status & 0xf0;
          if (command !== 0x90 || velocity === 0) return;
          const localPad = ((note - 36) % PAD_BANK_SIZE + PAD_BANK_SIZE) % PAD_BANK_SIZE;
          triggerPerformancePad(localPad, velocity);
          padButtons[localPad].classList.add("down");
          setTimeout(() => padButtons[localPad].classList.remove("down"), 90);
        };
      });
      midiBtn.classList.add("active"); performanceStatus.textContent = `${access.inputs.size} MIDI input${access.inputs.size === 1 ? "" : "s"} connected`;
    } catch { performanceStatus.textContent = "MIDI access was not granted"; }
  });
  for (let localPad = 0; localPad < PAD_BANK_SIZE; localPad++) {
    const pad = el("button", "wa-mpc-pad") as HTMLButtonElement; pad.type = "button";
    const press = (event: PointerEvent) => {
      event.preventDefault(); pad.setPointerCapture?.(event.pointerId); pad.classList.add("down");
      const rect = pad.getBoundingClientRect();
      const velocity = Math.max(20, Math.min(127, Math.round((1 - (event.clientY - rect.top) / rect.height) * 107 + 20)));
      triggerPerformancePad(localPad, velocity);
      if (mpc.noteRepeat) {
        const interval = Math.max(30, stepDur() * 1000 * (4 / mpc.repeatDivision));
        repeatTimers.set(localPad, window.setInterval(() => triggerPerformancePad(localPad, velocity), interval));
      }
    };
    const release = () => {
      pad.classList.remove("down");
      const timer = repeatTimers.get(localPad); if (timer) clearInterval(timer);
      repeatTimers.delete(localPad);
    };
    pad.addEventListener("pointerdown", press); pad.addEventListener("pointerup", release); pad.addEventListener("pointercancel", release); pad.addEventListener("pointerleave", release);
    pad.addEventListener("dragover", (event) => { event.preventDefault(); pad.classList.add("drop"); });
    pad.addEventListener("dragleave", () => pad.classList.remove("drop"));
    pad.addEventListener("drop", async (event) => {
      event.preventDefault(); pad.classList.remove("drop");
      const file = event.dataTransfer?.files?.[0]; if (!file?.type.startsWith("audio/")) return;
      checkpoint();
      const globalPad = selectedGlobalPad(localPad);
      try {
        sampleData[globalPad] = await readAsDataUrl(file); sampleParams[globalPad].name = file.name;
        await hydrateSample(globalPad); mpc.selectedPad = globalPad; paintMpcPads(); saveAll();
        performanceStatus.textContent = `${file.name} loaded on pad ${localPad + 1}`;
      } catch { performanceStatus.textContent = "Could not load dropped sample"; }
    });
    padButtons.push(pad); padGrid.append(pad);
  }
  fullLevelBtn.classList.toggle("active", mpc.fullLevel);
  fullLevelBtn.addEventListener("click", () => { mpc.fullLevel = !mpc.fullLevel; fullLevelBtn.classList.toggle("active", mpc.fullLevel); saveAll(); });
  levelsBtn.classList.toggle("active", mpc.sixteenLevels);
  levelsBtn.addEventListener("click", () => { mpc.sixteenLevels = !mpc.sixteenLevels; levelsBtn.classList.toggle("active", mpc.sixteenLevels); saveAll(); });
  repeatBtn.classList.toggle("active", mpc.noteRepeat);
  repeatBtn.addEventListener("click", () => { mpc.noteRepeat = !mpc.noteRepeat; repeatBtn.classList.toggle("active", mpc.noteRepeat); saveAll(); });
  recordBtn.classList.toggle("active", mpc.recording);
  recordBtn.addEventListener("click", () => {
    mpc.recording = !mpc.recording;
    if (mpc.recording) { checkpoint(); recordSnapshot = padEvents[curPat].map((event) => ({ ...event })); }
    recordBtn.classList.toggle("active", mpc.recording); performanceStatus.textContent = mpc.recording ? "Recording pad events" : "Ready"; saveAll();
  });
  overdubBtn.addEventListener("click", () => { mpc.overdub = !mpc.overdub; overdubBtn.classList.toggle("active", mpc.overdub); saveAll(); });
  undoPassBtn.addEventListener("click", () => {
    if (!recordSnapshot) return;
    padEvents[curPat] = recordSnapshot.map((event) => ({ ...event })); recordSnapshot = null; paintEventLane(); saveAll(); performanceStatus.textContent = "Last recording pass undone";
  });
  repeatSel.addEventListener("change", () => { mpc.repeatDivision = Number(repeatSel.value); saveAll(); });
  quantSel.addEventListener("change", () => { mpc.quantize = Number(quantSel.value); saveAll(); });
  levelModeSel.addEventListener("change", () => { mpc.levelMode = levelModeSel.value as MpcState["levelMode"]; saveAll(); });
  rotateBtn.addEventListener("click", () => {
    checkpoint();
    padEvents[curPat].forEach((event) => { event.step = (event.step + 1) % STEPS; }); paintEventLane(); saveAll();
  });
  mutateBtn.addEventListener("click", () => {
    checkpoint();
    padEvents[curPat].forEach((event) => {
      if (Math.random() < 0.35) event.step = (event.step + (Math.random() < 0.5 ? -1 : 1) + STEPS) % STEPS;
      event.velocity = Math.max(20, Math.min(127, event.velocity + Math.round((Math.random() * 2 - 1) * 18)));
      if (Math.random() < 0.2) event.ratchets = 1 + Math.floor(Math.random() * 4);
    });
    paintEventLane(); saveAll();
  });
  fillBtn.addEventListener("click", () => {
    checkpoint();
    const pad = mpc.selectedPad;
    for (let step = 12; step < 16; step++) {
      padEvents[curPat] = padEvents[curPat].filter((event) => !(event.pad === pad && event.step === step));
      padEvents[curPat].push({ pad, step, velocity: 72 + (step - 12) * 14, offset: 0, probability: 100, ratchets: step === 15 ? 4 : 1 });
    }
    paintEventLane(); saveAll();
  });
  ghostBtn.addEventListener("click", () => {
    checkpoint();
    const pad = mpc.selectedPad;
    [3, 7, 11, 15].forEach((step, i) => {
      if (!padEvents[curPat].some((event) => event.pad === pad && event.step === step)) {
        padEvents[curPat].push({ pad, step, velocity: 34 + i * 5, offset: i % 2 ? 12 : -8, probability: 72, ratchets: 1 });
      }
    });
    paintEventLane(); saveAll();
  });
  extractGrooveBtn.addEventListener("click", () => {
    const events = padEvents[curPat]; if (!events.length) return;
    const odd = events.filter((event) => event.step % 2 === 1);
    rackState.grooveTiming = Math.max(0, Math.min(0.75, odd.reduce((sum, event) => sum + Math.max(0, event.offset), 0) / Math.max(1, odd.length) / 80));
    const velocities = events.map((event) => event.velocity), mean = velocities.reduce((sum, value) => sum + value, 0) / velocities.length;
    rackState.grooveVelocity = Math.min(0.5, velocities.reduce((sum, value) => sum + Math.abs(value - mean), 0) / velocities.length / 127);
    performanceStatus.textContent = "Groove extracted from current pattern"; saveAll();
  });
  resampleBtn.addEventListener("click", async () => {
    performanceStatus.textContent = "Resampling pattern...";
    try {
      const rendered = await renderBuffer("pattern");
      const buffer = resampleQuality.value === "12bit" ? crushBuffer(rendered, 12, 2)
        : resampleQuality.value === "8bit" ? crushBuffer(rendered, 8, 4)
        : resampleQuality.value === "jungle" ? crushBuffer(rendered, 10, 3) : rendered;
      const data = await blobAsDataUrl(encodeWav(buffer)), pad = mpc.selectedPad;
      sampleData[pad] = data; sampleBuffers[pad] = buffer;
      Object.assign(sampleParams[pad], { name: `Resample ${PAT_LABELS[curPat]}`, start: 0, end: 1, tune: 0, reverse: false });
      paintMpcPads(); saveAll(); performanceStatus.textContent = `Pattern resampled to pad ${pad + 1}`;
    } catch { performanceStatus.textContent = "Resampling failed"; }
  });

  const eventLane = el("div", "wa-event-lane");
  let paintingEvents = false, paintEventsOn = true;
  function paintEventLane(): void {
    eventCells.forEach((cell, step) => {
      const event = padEvents[curPat].find((item) => item.pad === mpc.selectedPad && item.step === step);
      cell.classList.toggle("on", !!event);
      cell.title = event ? `Velocity ${event.velocity}, chance ${event.probability}%, ratchets ${event.ratchets}, offset ${event.offset}ms` : `Step ${step + 1}`;
    });
  }
  for (let step = 0; step < STEPS; step++) {
    const cell = el("button", "wa-cell wa-event-cell" + (step % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement; cell.type = "button";
    const paint = () => {
      const existing = padEvents[curPat].findIndex((event) => event.pad === mpc.selectedPad && event.step === step);
      if (paintEventsOn && existing < 0) padEvents[curPat].push({ pad: mpc.selectedPad, step, velocity: 100, offset: 0, probability: 100, ratchets: 1 });
      if (!paintEventsOn && existing >= 0) padEvents[curPat].splice(existing, 1);
      paintEventLane(); saveAll();
    };
    cell.addEventListener("pointerdown", (event) => {
      event.preventDefault(); checkpoint(); paintingEvents = true;
      paintEventsOn = !padEvents[curPat].some((item) => item.pad === mpc.selectedPad && item.step === step); paint();
    });
    cell.addEventListener("pointerenter", () => { if (paintingEvents) paint(); });
    eventCells.push(cell); eventLane.append(cell);
  }
  window.addEventListener("pointerup", () => { paintingEvents = false; });
  const eventEditor = el("div", "wa-event-editor");
  eventEditor.append(
    sliderRow("Velocity", 1, 127, 100, 1, (v) => { padEvents[curPat].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.velocity = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Chance", 1, 100, 100, 1, (v) => { padEvents[curPat].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.probability = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Micro", -60, 60, 0, 1, (v) => { padEvents[curPat].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.offset = v; }); paintEventLane(); saveAll(); }),
    sliderRow("Ratchet", 1, 8, 1, 1, (v) => { padEvents[curPat].filter((e) => e.pad === mpc.selectedPad).forEach((e) => { e.ratchets = v; }); paintEventLane(); saveAll(); }),
  );
  // MPC/Maschine-style deck: the 4×4 pads dominate; the action controls (full
  // level, levels, repeat, record, quantise, resample…) live in a side column.
  const mpcPadArea = el("div", "wa-mpc-pad-area"); mpcPadArea.append(padBankRow, padGrid);
  const mpcSide = el("div", "wa-mpc-side"); mpcSide.append(mpcToolbar);
  const mpcDeck = el("div", "wa-mpc-deck"); mpcDeck.append(mpcPadArea, mpcSide);
  mpcPanel.append(mpcDeck, el("div", "wa-lbl", "Selected pad sequence"), eventLane, eventEditor);
  paintMpcPads();

  // ── Drum rack / sampler ──
  const rack = el("div", "wa-panel");
  const rackGrid = el("div", "wa-rack");
  DRUMS.forEach((name, r) => {
    const pad = el("div", "wa-pad");
    const trigger = btn(name, "wa-pad-trigger");
    trigger.addEventListener("click", () => { ensureNodes(); playDrum(ac(), trackGain[r], r, 1, ac().currentTime); });
    const fileName = el("span", "wa-sample-name", sampleParams[r].name || "Synth drum");
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.hidden = true;
    const load = btn("Load sample", "wa-btn-sm"), remove = btn("Use synth", "wa-btn-sm");
    load.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      try {
        checkpoint();
        sampleData[r] = await readAsDataUrl(file);
        sampleParams[r].name = file.name;
        await hydrateSample(r);
        fileName.textContent = file.name;
        saveAll();
      } catch { fileName.textContent = "Could not load sample"; }
    });
    remove.addEventListener("click", () => {
      checkpoint();
      sampleData[r] = null; sampleBuffers[r] = null; sampleParams[r].name = "";
      fileName.textContent = "Synth drum"; fileInput.value = ""; saveAll();
    });
    const controls = el("div", "wa-pad-controls");
    controls.append(
      sliderRow("Tune", -24, 24, sampleParams[r].tune, 1, (v) => { sampleParams[r].tune = v; saveAll(); }),
      sliderRow("Start", 0, 0.95, sampleParams[r].start, 0.01, (v) => {
        sampleParams[r].start = Math.min(v, sampleParams[r].end - 0.01); saveAll();
      }),
      sliderRow("End", 0.05, 1, sampleParams[r].end, 0.01, (v) => {
        sampleParams[r].end = Math.max(v, sampleParams[r].start + 0.01); saveAll();
      }),
    );
    const reverse = btn("Reverse", "wa-toggle wa-btn-sm");
    reverse.classList.toggle("active", sampleParams[r].reverse);
    reverse.addEventListener("click", () => {
      sampleParams[r].reverse = !sampleParams[r].reverse; reverse.classList.toggle("active", sampleParams[r].reverse); saveAll();
    });
    const actions = el("div", "wa-pad-actions"); actions.append(load, remove, reverse, fileInput);
    pad.append(trigger, fileName, controls, actions); rackGrid.append(pad);
  });
  rack.append(el("p", "wa-help", "Each pad uses its generated drum until you load a local audio file. Samples stay in this session and are embedded when you save a project."), rackGrid);

  // ── Chop / sample capture ──
  const chop = el("div", "wa-panel");
  const chopToolbar = el("div", "wa-chop-toolbar");
  const chopInput = document.createElement("input"); chopInput.type = "file"; chopInput.accept = "audio/*"; chopInput.hidden = true;
  const loadBreakBtn = btn("Load break"), micBtn = btn("Record mic"), equalBtn = btn("16 equal"), transientBtn = btn("Transient"), clearSlicesBtn = btn("Manual");
  const assignSlicesBtn = btn("Assign to bank"), normaliseBtn = btn("Normalise");
  help(loadBreakBtn, "Load an audio file into the chop editor.");
  help(micBtn, "Record from the microphone, then chop the recording like any other sample.");
  help(equalBtn, "Split the audio into 16 equal-length slices.");
  help(transientBtn, "Detect strong attacks and use them as slice boundaries.");
  help(clearSlicesBtn, "Start with one region, then click the waveform to add slice markers.");
  help(normaliseBtn, "Raise the break to peak level without changing its relative dynamics.");
  help(assignSlicesBtn, "Map the current slices across all 16 pads in the selected bank.");
  const chopStatus = el("span", "wa-status", "Select a pad or load a break");
  const waveform = document.createElement("canvas"); waveform.className = "wa-waveform";
  help(waveform, "Waveform chop editor. In Manual mode, click to add slice markers.");
  let chopBuffer: AudioBuffer | null = null, chopData: string | null = null, chopName = "", slices: Array<[number, number]> = equalSlices(16);
  function refreshWaveform(): void { if (chopBuffer) drawWaveform(waveform, chopBuffer, slices); }
  async function setChopSource(data: string, name: string): Promise<void> {
    chopBuffer = await ac().decodeAudioData(dataUrlToBytes(data)); chopData = data; chopName = name; slices = equalSlices(16);
    chopStatus.textContent = `${name} · ${chopBuffer.duration.toFixed(2)}s`; refreshWaveform();
  }
  loadBreakBtn.addEventListener("click", () => chopInput.click());
  chopInput.addEventListener("change", async () => {
    const file = chopInput.files?.[0]; if (!file) return;
    try { await setChopSource(await readAsDataUrl(file), file.name); } catch { chopStatus.textContent = "Could not decode audio"; }
  });
  micBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { chopStatus.textContent = "Recording is not supported here"; return; }
    if (micBtn.classList.contains("active")) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [], recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        try { await setChopSource(await blobAsDataUrl(blob), `mic-${Date.now()}.webm`); } catch { chopStatus.textContent = "Could not decode recording"; }
        micBtn.classList.remove("active"); micBtn.textContent = "Record mic";
      };
      recorder.start(); micBtn.classList.add("active"); micBtn.textContent = "Stop recording"; chopStatus.textContent = "Recording...";
      const stop = () => { if (recorder.state === "recording") recorder.stop(); micBtn.removeEventListener("click", stop); };
      micBtn.addEventListener("click", stop);
    } catch { chopStatus.textContent = "Microphone permission was not granted"; }
  });
  equalBtn.addEventListener("click", () => { slices = equalSlices(16); refreshWaveform(); });
  transientBtn.addEventListener("click", () => { if (chopBuffer) { slices = transientSlices(chopBuffer, 16); refreshWaveform(); } });
  clearSlicesBtn.addEventListener("click", () => { slices = [[0, 1]]; refreshWaveform(); chopStatus.textContent = "Click the waveform to add slice markers"; });
  waveform.addEventListener("click", (event) => {
    if (!chopBuffer) return;
    const rect = waveform.getBoundingClientRect(), marker = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const starts = [...slices.map(([start]) => start), marker].filter((value, i, all) => all.indexOf(value) === i).sort((a, b) => a - b).slice(0, 16);
    slices = starts.map((start, i) => [start, starts[i + 1] ?? 1]); refreshWaveform();
  });
  assignSlicesBtn.addEventListener("click", async () => {
    if (!chopData || !chopBuffer) { chopStatus.textContent = "Load a break first"; return; }
    checkpoint();
    const bankStart = mpc.bank * PAD_BANK_SIZE;
    slices.slice(0, PAD_BANK_SIZE).forEach(([start, end], i) => {
      const pad = bankStart + i;
      const snappedStart = snapZero(chopBuffer!, start), snappedEnd = Math.max(snappedStart + 0.001, snapZero(chopBuffer!, end));
      sampleData[pad] = chopData; sampleBuffers[pad] = chopBuffer;
      Object.assign(sampleParams[pad], {
        name: `${chopName} ${i + 1}`, start: snappedStart, end: Math.min(1, snappedEnd),
        reverse: false, loop: false, sourceBpm: bpm,
      });
    });
    paintMpcPads(); saveAll(); chopStatus.textContent = `${Math.min(16, slices.length)} slices assigned to Bank ${"ABCD"[mpc.bank]}`;
  });
  normaliseBtn.addEventListener("click", async () => {
    if (!chopBuffer) return;
    let peak = 0;
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const data = chopBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak <= 0 || peak >= 0.999) return;
    const normalised = ac().createBuffer(chopBuffer.numberOfChannels, chopBuffer.length, chopBuffer.sampleRate);
    for (let c = 0; c < chopBuffer.numberOfChannels; c++) {
      const source = chopBuffer.getChannelData(c), target = normalised.getChannelData(c);
      for (let i = 0; i < source.length; i++) target[i] = source[i] / peak;
    }
    chopBuffer = normalised; chopData = await blobAsDataUrl(encodeWav(normalised)); refreshWaveform(); chopStatus.textContent = "Normalised";
  });
  chopToolbar.append(loadBreakBtn, micBtn, equalBtn, transientBtn, clearSlicesBtn, normaliseBtn, assignSlicesBtn, chopInput, chopStatus);
  chop.append(chopToolbar, waveform, el("p", "wa-help", "Equal, transient or manual chopping is non-destructive. Assigning maps the current slices across the selected 16-pad bank."));

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
  const chordRow = el("div", "wa-chords");
  const chords: Array<[string, string[]]> = [
    ["Cm", ["C4", "D#4", "G4"]], ["Fm", ["F4", "G#4", "C5"]], ["Gm", ["G4", "A#4", "D5"]],
    ["Ab", ["G#4", "C5", "D#5"]], ["Bb", ["A#4", "D5", "F5"]], ["C7", ["C4", "E4", "G4", "A#4"]],
  ];
  chords.forEach(([label, notes]) => {
    const button = btn(label, "wa-btn-sm");
    button.addEventListener("click", () => {
      ensureNodes(); notes.forEach((note) => playSynthStep(ac(), synthGain!, note, ac().currentTime, stepDur() * 3.5, 0.32));
    });
    chordRow.append(button);
  });
  const pianoRoll = el("div", "wa-piano-roll");
  PIANO_NOTES.forEach((note, r) => {
    const row = el("div", "wa-piano-row");
    row.append(el("span", "wa-piano-note", note));
    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < STEPS; c++) {
      const cell = el("button", "wa-cell wa-piano-cell" + (c % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      cell.title = `${note}, step ${c + 1}`;
      cell.classList.toggle("on", synthPats[curPat][r][c]);
      cell.addEventListener("click", () => {
        synthPats[curPat][r][c] = !synthPats[curPat][r][c];
        cell.classList.toggle("on", synthPats[curPat][r][c]);
        if (synthPats[curPat][r][c]) {
          ensureNodes();
          playSynthStep(ac(), synthGain!, note, ac().currentTime, stepDur() * 0.9, 0.55);
        }
        saveAll();
      });
      rowCells.push(cell);
      row.append(cell);
    }
    synthCells.push(rowCells);
    pianoRoll.append(row);
  });
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
    el("div", "wa-lbl", "CHORD PLAYER"), chordRow,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "PIANO ROLL — active pattern"), pianoRoll,
    el("div", "wa-sep-h"),
    el("div", "wa-lbl", "KEYS — click or use A–K"), synthKeys,
  );

  // ── Song ──
  const song = el("div", "wa-panel");
  const launcher = el("div", "wa-launcher");
  const launchStatus = el("span", "wa-status", "Launches change on the next bar");
  PAT_LABELS.forEach((label, pi) => {
    const launch = btn(`▶ ${label}`, "wa-scene-launch");
    launch.addEventListener("click", () => {
      if (playing) {
        queuedPat = pi; launchStatus.textContent = `Pattern ${label} queued`;
      } else {
        patBtns[pi].click(); songMode = false; songBtn.textContent = "Pattern"; songBtn.classList.remove("active");
        renderSel.value = "pattern"; launchStatus.textContent = `Pattern ${label} selected`;
      }
    });
    launcher.append(launch);
  });
  launcher.append(launchStatus);
  const chain = el("div", "wa-song-chain");
  const chainSelects: HTMLSelectElement[] = [];
  songChain.forEach((pattern, i) => {
    const slot = el("label", "wa-song-slot");
    slot.append(el("span", "wa-lbl", String(i + 1)));
    const select = document.createElement("select");
    PAT_LABELS.forEach((label, pi) => {
      const option = document.createElement("option"); option.value = String(pi); option.textContent = `Pattern ${label}`; select.append(option);
    });
    select.value = String(pattern);
    select.addEventListener("change", () => { songChain[i] = Number(select.value); saveAll(); });
    chainSelects.push(select); slot.append(select); chain.append(slot);
  });
  const songHelp = el("p", "wa-help", "Launch patterns like clips for improvising, or switch to Song mode to play the arrangement left to right.");
  song.append(songHelp, launcher, chain);

  // ── Mixer ──
  const mixer = el("div", "wa-panel");
  const mixGrid = el("div", "wa-mixer");
  DRUMS.forEach((name, i) => mixGrid.append(mixChannel(name, 0.8, (v) => { ensureNodes(); trackGain[i].gain.value = v; }, i)));
  mixGrid.append(mixChannel("Synth",  0.7, (v) => { ensureNodes(); synthGain!.gain.value = v; }, -1));
  mixGrid.append(mixChannel("MASTER", 0.8, (v) => { ac(); master!.gain.value = v; }, -1));
  const effects = el("div", "wa-effects");
  const fxSlider = (label: string, min: number, max: number, value: number, step: number, apply: (v: number) => void) =>
    sliderRow(label, min, max, value, step, (v) => { ensureNodes(); apply(v); applyFxState(); saveAll(); });
  effects.append(
    el("div", "wa-fx-title", "MASTER EFFECTS"),
    fxSlider("EQ LOW", -12, 12, fx.low, 0.5, (v) => { fx.low = v; }),
    fxSlider("EQ MID", -12, 12, fx.mid, 0.5, (v) => { fx.mid = v; }),
    fxSlider("EQ HIGH", -12, 12, fx.high, 0.5, (v) => { fx.high = v; }),
    fxSlider("COMP THRESH", -50, 0, fx.compThreshold, 1, (v) => { fx.compThreshold = v; }),
    fxSlider("COMP RATIO", 1, 20, fx.compRatio, 0.5, (v) => { fx.compRatio = v; }),
    fxSlider("LIMIT", -12, 0, fx.limiter, 0.5, (v) => { fx.limiter = v; }),
    fxSlider("REVERB", 0, 0.6, fx.reverb, 0.02, (v) => { fx.reverb = v; initReverb(v); }),
    fxSlider("DELAY TIME", 0.05, 1, fx.delayTime, 0.01, (v) => { fx.delayTime = v; initDelay(); }),
    fxSlider("DELAY FDBK", 0, 0.85, fx.delayFeedback, 0.01, (v) => { fx.delayFeedback = v; initDelay(); }),
    fxSlider("DELAY MIX", 0, 0.6, fx.delayMix, 0.02, (v) => { fx.delayMix = v; initDelay(); }),
  );
  mixer.append(mixGrid, effects);

  // ── Modular device rack ──
  const devicePanel = el("div", "wa-panel");
  const combinator = el("div", "wa-combinator");
  combinator.append(el("div", "wa-fx-title", "COMBINATOR MACROS"));
  const applyMacro = (index: number, value: number) => {
    rackState.macros[index] = value;
    if (index === 0) {
      fx.compThreshold = -8 - value * 32; fx.compRatio = 2 + value * 10; fx.high = value * 5;
    } else if (index === 1) {
      fx.reverb = value * 0.5; fx.delayMix = value * 0.35; if (value > 0) { initReverb(fx.reverb); initDelay(); }
    } else if (index === 2) {
      sampleParams.forEach((pad) => { pad.filter = 18000 - value * 16800; });
    } else {
      rackState.grooveTiming = value * 0.7; rackState.grooveRandom = value * 18; rackState.grooveVelocity = value * 0.25;
    }
    applyFxState(); saveAll();
  };
  ["Dirt", "Space", "Cutoff", "Break"].forEach((name, i) => {
    combinator.append(sliderRow(name, 0, 1, rackState.macros[i], 0.01, (value) => applyMacro(i, value)));
  });
  const patchRow = el("div", "wa-export");
  const patchSelect = document.createElement("select");
  ["Clean MPC", "Dusty Hip Hop", "Jungle Pressure", "Dub Space"].forEach((name) => {
    const option = document.createElement("option"); option.value = name; option.textContent = name; patchSelect.append(option);
  });
  const loadPatchBtn = btn("Load patch", "wa-btn-sm");
  help(loadPatchBtn, "Apply a complete macro and effects preset.");
  loadPatchBtn.addEventListener("click", () => {
    const presets: Record<string, number[]> = {
      "Clean MPC": [0.05, 0, 0, 0.1],
      "Dusty Hip Hop": [0.55, 0.12, 0.18, 0.45],
      "Jungle Pressure": [0.72, 0.28, 0.08, 0.82],
      "Dub Space": [0.2, 0.9, 0.35, 0.35],
    };
    presets[patchSelect.value].forEach((value, i) => applyMacro(i, value));
    location.reload();
  });
  patchRow.append(patchSelect, loadPatchBtn); combinator.append(patchRow);

  const playerRack = el("div", "wa-device");
  const euclidControls = el("div", "wa-export");
  const euclidPulses = document.createElement("input"); euclidPulses.type = "number"; euclidPulses.min = "1"; euclidPulses.max = "16"; euclidPulses.value = "7";
  const euclidRotate = document.createElement("input"); euclidRotate.type = "number"; euclidRotate.min = "0"; euclidRotate.max = "15"; euclidRotate.value = "0";
  const euclidBtn = btn("Write Euclidean", "wa-btn-sm");
  help(euclidBtn, "Distribute a chosen number of hits evenly across the 16-step pattern.");
  euclidBtn.addEventListener("click", () => {
    const pattern = euclideanPattern(STEPS, Number(euclidPulses.value), Number(euclidRotate.value)), pad = mpc.selectedPad;
    padEvents[curPat] = padEvents[curPat].filter((event) => event.pad !== pad);
    pattern.forEach((on, step) => { if (on) padEvents[curPat].push({ pad, step, velocity: step % 4 === 0 ? 115 : 86, offset: 0, probability: 100, ratchets: 1 }); });
    paintEventLane(); saveAll();
  });
  euclidControls.append(el("span", "wa-lbl", "Pulses"), euclidPulses, el("span", "wa-lbl", "Rotate"), euclidRotate, euclidBtn);
  playerRack.append(
    el("div", "wa-device-title", "PLAYER · GROOVE + NOTE ECHO"),
    sliderRow("Timing", 0, 0.75, rackState.grooveTiming, 0.01, (v) => { rackState.grooveTiming = v; saveAll(); }),
    sliderRow("Velocity", 0, 0.5, rackState.grooveVelocity, 0.01, (v) => { rackState.grooveVelocity = v; saveAll(); }),
    sliderRow("Random", 0, 40, rackState.grooveRandom, 1, (v) => { rackState.grooveRandom = v; saveAll(); }),
    sliderRow("Echoes", 0, 8, rackState.noteEcho, 1, (v) => { rackState.noteEcho = v; saveAll(); }),
    sliderRow("Echo decay", 0.1, 0.95, rackState.echoDecay, 0.01, (v) => { rackState.echoDecay = v; saveAll(); }),
    euclidControls,
  );
  const deviceRack = el("div", "wa-device-stack");
  const devices: Array<[string, string]> = [
    ["sampler", "MPC PROGRAM · 64 pads / slices"],
    ["character", "CHARACTER · macros / sampler colour"],
    ["eq", "CHANNEL EQ · low / mid / high"],
    ["compressor", "BUS COMPRESSOR"],
    ["delay", "FEEDBACK DELAY · parallel return"],
    ["reverb", "CONVOLUTION REVERB · parallel return"],
    ["limiter", "MASTER LIMITER"],
  ];
  devices.forEach(([key, label]) => {
    const device = el("div", "wa-device"), header = el("div", "wa-device-header");
    const bypass = btn(rackState.devices[key] ? "ON" : "BYPASS", "wa-toggle wa-btn-sm");
    bypass.classList.toggle("active", rackState.devices[key]);
    bypass.addEventListener("click", () => {
      rackState.devices[key] = !rackState.devices[key];
      bypass.textContent = rackState.devices[key] ? "ON" : "BYPASS"; bypass.classList.toggle("active", rackState.devices[key]);
      applyFxState(); saveAll();
    });
    header.append(el("span", "wa-device-title", label), bypass); device.append(header); deviceRack.append(device);
  });
  devicePanel.append(
    el("p", "wa-help", "Signal flow: Player → MPC Program → character controls → EQ → compressor → parallel delay/reverb → limiter."),
    combinator, playerRack, deviceRack,
  );

  // ── Project / export ──
  const exp = el("div", "wa-panel");
  const expRow = el("div", "wa-export");
  const renderSel = document.createElement("select");
  [["pattern","Active pattern"],["song","Full song"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l; renderSel.append(o);
  });
  renderSel.value = songMode ? "song" : "pattern";
  const wavBtn = btn("Export WAV"), mp3Btn = btn("Export MP3"), expStatus = el("span", "wa-status");
  help(wavBtn, "Render the selected pattern or full song as lossless WAV.");
  help(mp3Btn, "Render and encode the selected pattern or full song as 192 kbps MP3.");
  expRow.append(el("span", "wa-lbl", "Render"), renderSel, wavBtn, mp3Btn, expStatus);
  const projectRow = el("div", "wa-export");
  const saveProjectBtn = btn("Save project"), loadProjectBtn = btn("Open project");
  help(saveProjectBtn, "Download an editable project containing patterns, settings and embedded samples.");
  help(loadProjectBtn, "Open a previously saved editable Studio project.");
  const projectInput = document.createElement("input"); projectInput.type = "file"; projectInput.accept = ".json,application/json"; projectInput.hidden = true;
  projectRow.append(saveProjectBtn, loadProjectBtn, projectInput);
  exp.append(
    el("p", "wa-help", "Audio export includes drums and sequenced synth. Project files preserve editable patterns, song order, sounds and tempo."),
    expRow,
    el("div", "wa-sep-h"),
    projectRow,
  );

  const createWorkspace = el("div", "wa-workspace");
  const sequenceWorkspace = el("div", "wa-workspace");
  const arrangeWorkspace = el("div", "wa-workspace");
  const mixWorkspace = el("div", "wa-workspace");
  const hint = (title: string, text: string): HTMLElement => {
    const box = el("div", "wa-hint");
    box.append(el("strong", "", title), document.createTextNode(` ${text}`)); return box;
  };
  const section = (title: string, content: HTMLElement): HTMLElement => {
    const host = el("section", "wa-workspace-section");
    const descriptions: Record<string, string> = {
      Pads: "Perform, record and edit the current 16-pad bank.",
      Chop: "Load or record longer audio and divide it into playable slices.",
      "Sample Rack": "Quick controls for the original drum voices and loaded samples.",
      "Drum Sequence": "Program the legacy eight-lane drum grid and adjust generated drum sounds.",
      "Synth + Piano Roll": "Design and sequence the built-in subtractive synth.",
      "Patterns + Song": "Switch patterns live and order them into a linear song.",
      Devices: "Apply groove, macros and the modular master processing chain.",
      Mixer: "Set drum, synth and master levels, mute or solo channels, and adjust effects.",
      "Project + Export": "Save editable project data or render finished audio.",
      Scratch: "Drag the vinyl to scratch the selected pad's sample over the beat.",
    };
    help(host, descriptions[title] ?? title);
    host.append(el("h2", "wa-section-title", title), content); return host;
  };
  // Sample Rack now opens in a slide-in drawer rather than always sitting in view.
  const rackDrawer = el("aside", "wa-drawer");
  const rackOverlay = el("div", "wa-drawer-overlay");
  const rackClose = btn("✕ Close", "wa-btn-sm");
  const rackHead = el("div", "wa-drawer-head");
  rackHead.append(el("span", "wa-drawer-title", "SAMPLE RACK"), rackClose);
  rackDrawer.append(rackHead, rack);
  const closeRack = (): void => { rackDrawer.classList.remove("open"); rackOverlay.classList.remove("open"); };
  rackClose.addEventListener("click", closeRack);
  rackOverlay.addEventListener("click", closeRack);

  const openRackBtn = btn("⊞ Sample Rack", "wa-btn-sm");
  help(openRackBtn, "Open the drum and sample voice controls in a side panel.");
  openRackBtn.addEventListener("click", () => { rackDrawer.classList.add("open"); rackOverlay.classList.add("open"); });
  const createBar = el("div", "wa-mpc-toolbar"); createBar.append(openRackBtn);

  // ── Vinyl scratchpad — drag the platter to scratch the selected pad's sample
  // (or the loaded break) over whatever's playing. Forward drags play the buffer
  // forwards; backward drags play a reversed copy. Rate tracks hand speed. ──
  const scratchPanel = el("div", "wa-panel");
  const platter = el("div", "wa-scratch");
  const disc = el("div", "wa-scratch-disc");
  disc.append(el("div", "wa-scratch-label", "VV"));
  platter.append(disc);
  scratchPanel.append(
    el("p", "wa-help", "Drag the record left/right to scratch the selected pad's sample over the beat. Forward and backward both sound. Release to stop."),
    platter,
  );

  let scGain: GainNode | null = null, scFwd: AudioBuffer | null = null, scRev: AudioBuffer | null = null;
  let scSrc: AudioBufferSourceNode | null = null, scDir = 1, scPos = 0, scStartT = 0, scStartPos = 0;
  let scDragging = false, scLastX = 0, scLastT = 0, scAngle = 0, scIdle = 0;
  const scBuffer = (): AudioBuffer | null => sampleBuffers[mpc.selectedPad] || chopBuffer || null;
  const scStop = (): void => { if (scSrc) { try { scSrc.stop(); } catch { /* already stopped */ } try { scSrc.disconnect(); } catch { /* noop */ } scSrc = null; } };
  const scNow = (a: AudioContext, dur: number): number => {
    if (!scSrc) return scPos;
    const elapsed = (a.currentTime - scStartT) * scSrc.playbackRate.value;
    return (((scStartPos + scDir * elapsed) % dur) + dur) % dur;
  };
  const scStart = (a: AudioContext, rate: number, dir: number, dur: number): void => {
    scStop();
    const b = dir > 0 ? scFwd : scRev; if (!b) return;
    const src = a.createBufferSource();
    src.buffer = b; src.loop = true; src.loopStart = 0; src.loopEnd = dur;
    src.playbackRate.value = Math.max(0.05, Math.min(8, Math.abs(rate)));
    if (!scGain) { scGain = a.createGain(); scGain.gain.value = 0.9; scGain.connect(master!); }
    src.connect(scGain);
    const offset = dir > 0 ? scPos : dur - scPos;
    src.start(0, Math.max(0, Math.min(dur - 0.001, offset)));
    scSrc = src; scDir = dir; scStartT = a.currentTime; scStartPos = scPos;
  };
  const scBegin = (x: number): void => {
    const b = scBuffer(); if (!b) return;
    ensureNodes(); const a = ac(); if (a.state === "suspended") void a.resume();
    scFwd = b; scRev = reversedBuffer(a, b);
    scDragging = true; scLastX = x; scLastT = performance.now();
  };
  const scMove = (x: number): void => {
    if (!scDragging || !scFwd) return;
    const a = ac(), dur = scFwd.duration, now = performance.now();
    const dt = Math.max(8, now - scLastT), dx = x - scLastX;
    scLastX = x; scLastT = now;
    scAngle += dx * 0.6; disc.style.transform = `rotate(${scAngle}deg)`;
    const rate = (dx / dt) * 6;
    scPos = scNow(a, dur);
    const dir = rate >= 0 ? 1 : -1;
    // Sound only while the hand is moving — if no move fires for ~70ms, hold/stop.
    window.clearTimeout(scIdle);
    scIdle = window.setTimeout(() => { if (scFwd) scPos = scNow(ac(), scFwd.duration); scStop(); }, 70);
    if (Math.abs(rate) < 0.05) { scStop(); return; }
    if (!scSrc || dir !== scDir) scStart(a, rate, dir, dur);
    else scSrc.playbackRate.value = Math.min(8, Math.abs(rate));
  };
  const scEnd = (): void => {
    if (!scDragging) return;
    scDragging = false;
    window.clearTimeout(scIdle);
    if (scFwd) scPos = scNow(ac(), scFwd.duration);
    scStop();
  };
  platter.addEventListener("pointerdown", (e) => { e.preventDefault(); try { platter.setPointerCapture(e.pointerId); } catch { /* noop */ } scBegin(e.clientX); });
  platter.addEventListener("pointermove", (e) => scMove(e.clientX));
  platter.addEventListener("pointerup", scEnd);
  platter.addEventListener("pointercancel", scEnd);

  createWorkspace.append(
    hint("Start here.", "Drop audio onto a pad, or load a break in Chop. Use Z–V, A–F, Q–R and 1–4 to play the 16 pads."),
    createBar,
    section("Pads", mpcPanel), section("Chop", chop), section("Scratch", scratchPanel),
  );
  sequenceWorkspace.append(
    hint("Build the loop.", "Drag across the selected-pad lane to paint or erase hits. Right-click drum steps to edit velocity."),
    section("Drum Sequence", beat), section("Synth + Piano Roll", synthPanel),
  );
  arrangeWorkspace.append(
    hint("Turn loops into a track.", "Launch patterns for live testing, then set the eight song slots and enable Song mode."),
    section("Patterns + Song", song),
  );
  mixWorkspace.append(
    hint("Finish and preserve it.", "Shape the device chain, set levels, save an editable project, then export the audio."),
    section("Mixer", mixer), section("Devices", devicePanel), section("Project + Export", exp),
  );
  panelEls.push(createWorkspace, sequenceWorkspace, arrangeWorkspace, mixWorkspace);
  panels.append(createWorkspace, sequenceWorkspace, arrangeWorkspace, mixWorkspace);

  const inspector = el("aside", "wa-inspector");
  inspector.append(el("div", "wa-inspector-title", "SELECTED PAD"), selectedPadLabel, selectedSampleEditor);
  const workarea = el("div", "wa-workarea"); workarea.append(panels, inspector);
  win.append(titleBar, lcd, tabbar, transport, workarea, rackOverlay, rackDrawer);
  root.append(win);
  paintTabs();

  // ── Help and tutorial ──
  const tutorial = el("div", "wa-tutorial"); tutorial.hidden = true;
  const tutorialShade = el("div", "wa-tutorial-shade");
  const tutorialCard = el("div", "wa-tutorial-card");
  const tutorialStep = el("span", "wa-tutorial-step"), tutorialTitle = el("h2", "wa-tutorial-title"), tutorialText = el("p", "wa-tutorial-text");
  const tutorialActions = el("div", "wa-tutorial-actions");
  const tutorialPrev = btn("Previous", "wa-btn-sm"), tutorialNext = btn("Next", "wa-btn-sm"), tutorialClose = btn("Skip tutorial", "wa-btn-sm");
  tutorialActions.append(tutorialClose, tutorialPrev, tutorialNext);
  tutorialCard.append(tutorialStep, tutorialTitle, tutorialText, tutorialActions);
  tutorial.append(tutorialShade, tutorialCard); document.body.append(tutorial);
  const tutorialSteps: Array<{ workspace: number; target: HTMLElement; title: string; text: string }> = [
    { workspace: 0, target: tabBtns[0], title: "Create", text: "This is the sampling and performance workspace. Start here whenever you are building a new beat." },
    { workspace: 0, target: padGrid, title: "Play the pads", text: "Use the mouse, touch, computer keyboard or MIDI controller. Drop an audio file directly onto any pad to replace it." },
    { workspace: 0, target: selectedSampleEditor, title: "Shape the selected pad", text: "The inspector follows your selected pad across every workspace. Trim, tune, filter, choke, reverse, loop or warp it here." },
    { workspace: 0, target: waveform, title: "Chop a break", text: "Load or record audio, choose equal, transient or manual slicing, then assign the slices to the active pad bank." },
    { workspace: 1, target: eventLane, title: "Sequence pad events", text: "Drag across the lane to paint or erase hits. Use velocity, chance, microtiming and ratchets to make the pattern move." },
    { workspace: 1, target: pianoRoll, title: "Add musical parts", text: "Program synth notes in the piano roll or play them from the on-screen and computer keyboards." },
    { workspace: 2, target: launcher, title: "Test pattern changes", text: "Launch patterns while playback runs. Changes wait until the next bar so transitions remain in time." },
    { workspace: 2, target: chain, title: "Arrange the song", text: "Choose a pattern for each song slot, then enable Song mode in the transport to play the full chain." },
    { workspace: 3, target: devicePanel, title: "Process the sound", text: "Use macros, groove controls and device bypass switches to shape the complete signal chain." },
    { workspace: 3, target: exp, title: "Save and export", text: "Save an editable project before exporting. WAV preserves full quality; MP3 is smaller for sharing." },
    { workspace: 3, target: transport, title: "Transport stays available", text: "Playback, BPM, pattern/song mode, undo and tutorial controls remain visible in every workspace." },
  ];
  let tutorialIndex = 0, tutorialTarget: HTMLElement | null = null;
  function closeTutorial(): void {
    tutorial.hidden = true; tutorialTarget?.classList.remove("wa-tutorial-target"); tutorialTarget = null;
    localStorage.setItem("vv_studio_tutorial_seen", "1");
  }
  function showTutorialStep(index: number): void {
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    const step = tutorialSteps[tutorialIndex];
    tutorialTarget?.classList.remove("wa-tutorial-target"); tabBtns[step.workspace].click();
    tutorialTarget = step.target; tutorialTarget.classList.add("wa-tutorial-target");
    tutorialTarget.scrollIntoView({ block: "center", behavior: "smooth" });
    tutorialStep.textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
    tutorialTitle.textContent = step.title; tutorialText.textContent = step.text;
    tutorialPrev.disabled = tutorialIndex === 0;
    tutorialNext.textContent = tutorialIndex === tutorialSteps.length - 1 ? "Finish" : "Next";
    tutorial.hidden = false;
  }
  tutorialPrev.addEventListener("click", () => showTutorialStep(tutorialIndex - 1));
  tutorialNext.addEventListener("click", () => {
    if (tutorialIndex === tutorialSteps.length - 1) closeTutorial(); else showTutorialStep(tutorialIndex + 1);
  });
  tutorialClose.addEventListener("click", closeTutorial);
  tutorialShade.addEventListener("click", closeTutorial);
  tutorialBtn.addEventListener("click", () => showTutorialStep(0));

  // ── Transport logic ──
  function refreshVisibleState(): void {
    cells.forEach((row, r) => row.forEach((cell, step) => {
      const on = allPats[curPat][r][step]; cell.classList.toggle("on", on);
      if (on) setCellOpacity(cell, allVels[curPat][r][step]); else cell.style.opacity = "";
    }));
    synthCells.forEach((row, r) => row.forEach((cell, step) => cell.classList.toggle("on", synthPats[curPat][r][step])));
    chainSelects.forEach((select, i) => { select.value = String(songChain[i]); });
    paintMpcPads(); paintEventLane(); applyFxState();
  }
  undoBtn.addEventListener("click", () => {
    const previous = undoStack.pop(); if (!previous) return;
    redoStack.push(historyState()); restoreHistory(previous); refreshVisibleState();
    undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = false;
  });
  redoBtn.addEventListener("click", () => {
    const next = redoStack.pop(); if (!next) return;
    undoStack.push(historyState()); restoreHistory(next); refreshVisibleState();
    undoBtn.disabled = false; redoBtn.disabled = redoStack.length === 0;
  });
  function setBpm(v: number): void {
    bpm = Math.max(40, Math.min(240, v));
    bpmLabel.textContent = String(bpm); lcdBpm.textContent = `${bpm} BPM`;
  }
  bpmDown.addEventListener("click", () => setBpm(bpm - 1));
  bpmUp.addEventListener("click", () => setBpm(bpm + 1));
  swingIn.addEventListener("input", () => { swing = Number(swingIn.value); });
  metroBtn.addEventListener("click", () => { metro = !metro; metroBtn.classList.toggle("active", metro); });
  songBtn.addEventListener("click", () => {
    songMode = !songMode; songBtn.textContent = songMode ? "Song" : "Pattern"; songBtn.classList.toggle("active", songMode);
    renderSel.value = songMode ? "song" : "pattern"; saveAll();
  });
  const flipBackdrop = el("div", "wa-flip-backdrop");
  const flipExit = el("div", "wa-flip-exit"); flipExit.textContent = "✕ Exit";
  document.body.append(flipBackdrop, flipExit);
  function setFlip(on: boolean) {
    win.classList.toggle("wa-rotated", on);
    flipBackdrop.classList.toggle("on", on);
    flipExit.classList.toggle("on", on);
  }
  rotBtn.addEventListener("click", () => setFlip(!win.classList.contains("wa-rotated")));
  flipExit.addEventListener("click", () => setFlip(false));

  let playing = false, schedTimer = 0, nextTime = 0, schStep = 0, songPos = 0, lastHi = -1, lastStepStartedMs = 0;
  function highlight(s: number, playingPat: number): void {
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    if (lastHi >= 0) synthCells.forEach((row) => row[lastHi].classList.remove("play"));
    if (playingPat === curPat) {
      for (let r = 0; r < 8; r++) cells[r][s].classList.add("play");
      synthCells.forEach((row) => row[s].classList.add("play"));
    }
    lastStepStartedMs = performance.now();
    lastHi = s; lcdState.textContent = `▶ ${String(s + 1).padStart(2, "0")}`;
  }
  function scheduleStep(s: number, baseWhen: number, playingPat: number): void {
    const a = ac();
    const groove = s % 2 === 1 ? rackState.grooveTiming * stepDur() * 0.5 : 0;
    const random = (Math.random() * 2 - 1) * rackState.grooveRandom / 1000;
    const when = baseWhen + (s % 2 === 1 ? swing * stepDur() : 0) + groove + random;
    for (let r = 0; r < 8; r++) {
      if (allPats[playingPat][r][s] && audible(r)) playDrum(a, trackGain[r], r, allVels[playingPat][r][s] / 127, when);
    }
    padEvents[playingPat].filter((event) => event.step === s).forEach((event) => {
      if (Math.random() * 100 > event.probability) return;
      const velocity = Math.max(1, Math.min(127, event.velocity * (1 + (Math.random() * 2 - 1) * rackState.grooveVelocity)));
      const ratchets = Math.max(1, event.ratchets), spacing = stepDur() / ratchets;
      for (let i = 0; i < ratchets; i++) {
        const eventWhen = Math.max(baseWhen, when + event.offset / 1000 + i * spacing);
        playPad(a, event.pad, velocity, eventWhen, event.pad % PAD_BANK_SIZE);
        if (rackState.noteEcho > 0) for (let echo = 1; echo <= rackState.noteEcho; echo++) {
          playPad(a, event.pad, velocity * Math.pow(rackState.echoDecay, echo), eventWhen + echo * stepDur(), event.pad % PAD_BANK_SIZE);
        }
      }
    });
    PIANO_NOTES.forEach((note, r) => {
      if (synthPats[playingPat][r][s]) playSynthStep(a, synthGain!, note, when, stepDur() * 0.9, 0.55);
    });
    if (metro && s % 4 === 0) metroClick(a, master!, baseWhen, s === 0);
    window.setTimeout(() => { if (playing) highlight(s, playingPat); }, Math.max(0, (baseWhen - a.currentTime) * 1000));
  }
  function scheduler(): void {
    const a = ac();
    while (nextTime < a.currentTime + 0.1) {
      scheduleStep(schStep, nextTime, songMode ? songChain[songPos] : curPat);
      nextTime += stepDur();
      schStep++;
      if (schStep >= STEPS) {
        schStep = 0;
        if (queuedPat !== null) {
          curPat = queuedPat; patBtns[curPat].click(); songMode = false;
          songBtn.textContent = "Pattern"; songBtn.classList.remove("active"); renderSel.value = "pattern";
          launchStatus.textContent = `Pattern ${PAT_LABELS[curPat]} playing`; queuedPat = null;
        } else if (songMode) songPos = (songPos + 1) % SONG_SLOTS;
      }
    }
  }
  playBtn.addEventListener("click", () => {
    if (playing) return;
    ensureNodes(); playing = true; schStep = 0; songPos = 0; nextTime = ac().currentTime + 0.06;
    schedTimer = window.setInterval(scheduler, 25);
  });
  stopBtn.addEventListener("click", () => {
    playing = false; if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (lastHi >= 0) for (let r = 0; r < 8; r++) cells[r][lastHi].classList.remove("play");
    synthCells.forEach((row) => row.forEach((cell) => cell.classList.remove("play")));
    lastHi = -1; lcdState.textContent = "■ STOP";
  });

  // ── Export logic ──
  async function renderBuffer(mode: "pattern" | "song"): Promise<AudioBuffer> {
    ensureNodes();
    const patterns = mode === "song" ? [...songChain] : [curPat];
    const sr = 44100, sd = 60 / bpm / 4, dur = patterns.length * STEPS * sd + 2.2;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const om = off.createGain(); om.gain.value = master!.gain.value;
    const ol = off.createBiquadFilter(); ol.type = "lowshelf"; ol.frequency.value = 180; ol.gain.value = rackState.devices.eq ? fx.low : 0;
    const omi = off.createBiquadFilter(); omi.type = "peaking"; omi.frequency.value = 1200; omi.Q.value = 0.8; omi.gain.value = rackState.devices.eq ? fx.mid : 0;
    const oh = off.createBiquadFilter(); oh.type = "highshelf"; oh.frequency.value = 6500; oh.gain.value = rackState.devices.eq ? fx.high : 0;
    const oc = off.createDynamicsCompressor(); oc.threshold.value = rackState.devices.compressor ? fx.compThreshold : 0; oc.ratio.value = rackState.devices.compressor ? fx.compRatio : 1; oc.knee.value = 12;
    const oli = off.createDynamicsCompressor(); oli.threshold.value = rackState.devices.limiter ? fx.limiter : 0; oli.ratio.value = rackState.devices.limiter ? 20 : 1; oli.knee.value = 0; oli.attack.value = 0.001;
    om.connect(ol); ol.connect(omi); omi.connect(oh); oh.connect(oc); oc.connect(oli); oli.connect(off.destination);
    if (rackState.devices.reverb && fx.reverb > 0) {
      const len = Math.floor(sr * 2.2), ir = off.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) {
        const data = ir.getChannelData(c);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      }
      const conv = off.createConvolver(), wet = off.createGain(); conv.buffer = ir; wet.gain.value = fx.reverb;
      om.connect(conv); conv.connect(wet); wet.connect(ol);
    }
    if (rackState.devices.delay && fx.delayMix > 0) {
      const delay = off.createDelay(2), feedback = off.createGain(), wet = off.createGain();
      delay.delayTime.value = fx.delayTime; feedback.gain.value = fx.delayFeedback; wet.gain.value = fx.delayMix;
      om.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(ol);
    }
    const ot: GainNode[] = [];
    for (let i = 0; i < 8; i++) { const g = off.createGain(); g.gain.value = trackGain[i].gain.value; g.connect(om); ot.push(g); }
    const osf = off.createBiquadFilter(); osf.type = "lowpass"; osf.frequency.value = synth.cutoff; osf.Q.value = synth.q;
    const osg = off.createGain(); osg.gain.value = synthGain!.gain.value; osg.connect(osf); osf.connect(om);
    patterns.forEach((pattern, patternIndex) => { for (let s = 0; s < STEPS; s++) {
      const base = (patternIndex * STEPS + s) * sd;
      const groove = s % 2 === 1 ? rackState.grooveTiming * sd * 0.5 : 0;
      const when = base + (s % 2 === 1 ? swing * sd : 0) + groove;
      for (let r = 0; r < 8; r++) {
        if (allPats[pattern][r][s] && audible(r)) playDrum(off, ot[r], r, allVels[pattern][r][s] / 127, when);
      }
      padEvents[pattern].filter((event) => event.step === s).forEach((event) => {
        if (Math.random() * 100 > event.probability) return;
        const ratchets = Math.max(1, event.ratchets), spacing = sd / ratchets;
        for (let i = 0; i < ratchets; i++) {
          playPad(off, event.pad, event.velocity, Math.max(base, when + event.offset / 1000 + i * spacing), event.pad % PAD_BANK_SIZE, ot[event.pad % ot.length]);
        }
      });
      PIANO_NOTES.forEach((note, r) => {
        if (synthPats[pattern][r][s]) playSynthStep(off, osg, note, when, sd * 0.9, 0.55);
      });
      if (metro && s % 4 === 0) metroClick(off, om, base, s === 0);
    } });
    return off.startRendering();
  }
  async function doExport(fmt: "wav" | "mp3"): Promise<void> {
    wavBtn.setAttribute("disabled", "1"); mp3Btn.setAttribute("disabled", "1"); expStatus.textContent = "Rendering…";
    try {
      const buf = await renderBuffer(renderSel.value as "pattern" | "song");
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
  saveProjectBtn.addEventListener("click", () => {
    download(`vishamp-project-${bpm}bpm.json`, new Blob([JSON.stringify(projectState())], { type: "application/json" }));
  });
  loadProjectBtn.addEventListener("click", () => projectInput.click());
  projectInput.addEventListener("change", async () => {
    const file = projectInput.files?.[0]; if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed?.pats || !Array.isArray(parsed.pats)) throw new Error("Invalid project");
      await pendingProjectStore("put", parsed);
      location.reload();
    } catch { expStatus.textContent = "Project file is invalid."; }
  });

  // ── Keyboard ──
  const keyMap: Record<string, string> = {
    a:"C4", w:"C#4", s:"D4", e:"D#4", d:"E4", f:"F4", t:"F#4",
    g:"G4", y:"G#4", h:"A4", u:"A#4", j:"B4", k:"C5",
  };
  const padKeyMap: Record<string, number> = {
    "1": 12, "2": 13, "3": 14, "4": 15,
    q: 8, w: 9, e: 10, r: 11,
    a: 4, s: 5, d: 6, f: 7,
    z: 0, x: 1, c: 2, v: 3,
  };
  const downSet = new Set<string>();
  window.addEventListener("keydown", (ev) => {
    if (activeTab === 0) {
      const localPad = padKeyMap[ev.key.toLowerCase()];
      if (localPad != null && !ev.repeat && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault(); triggerPerformancePad(localPad, mpc.fullLevel ? 127 : 105); padButtons[localPad].classList.add("down"); return;
      }
    }
    if (activeTab !== 1) return;
    const n = keyMap[ev.key.toLowerCase()];
    if (!n || downSet.has(n) || ev.metaKey || ev.ctrlKey) return;
    downSet.add(n); noteOn(n); highlightKey(synthKeys, n, true);
  });
  window.addEventListener("keyup", (ev) => {
    const localPad = padKeyMap[ev.key.toLowerCase()];
    if (localPad != null) padButtons[localPad].classList.remove("down");
    if (activeTab !== 1) return;
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
