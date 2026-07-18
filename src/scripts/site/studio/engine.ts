// Web Audio engine: context, master chain, drum synthesis, sample playback,
// live synth voices. Exported `let` bindings are live — importers always see
// the current node instances.

import {
  DRUMS, dp, fx, rackState, mpc, sampleParams, sampleBuffers, sampleData, transport,
  padLayers, padLayerBuffers, padLayerMode,
} from "./state";
import type { SamplerP } from "./state";
import { dataUrlToBytes } from "./helpers";

// ─── Audio graph ─────────────────────────────────────────────────────────────
export let AC: AudioContext | null = null;
export let master: GainNode | null = null;
let eqLow: BiquadFilterNode | null = null;
let eqMid: BiquadFilterNode | null = null;
let eqHigh: BiquadFilterNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
export const trackGain: GainNode[] = [];
export let synthGain: GainNode | null = null;
let reverbConv: ConvolverNode | null = null;
let reverbWetGain: GainNode | null = null;
let delayNode: DelayNode | null = null;
let delayFeedbackGain: GainNode | null = null;
let delayWetGain: GainNode | null = null;

export function ac(): AudioContext {
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
export function ensureNodes(): void {
  const a = ac();
  if (trackGain.length) return;
  for (let i = 0; i < 8; i++) {
    const g = a.createGain(); g.gain.value = 0.8; g.connect(master!); trackGain.push(g);
  }
  // VV-1 voices carry their own per-note filters — the synth bus is just a fader.
  synthGain = a.createGain(); synthGain.gain.value = 0.7;
  synthGain.connect(master!);
}
export function initReverb(wet: number): void {
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
export function initDelay(): void {
  if (delayNode) return;
  const a = ac();
  delayNode = a.createDelay(2); delayFeedbackGain = a.createGain(); delayWetGain = a.createGain();
  master!.connect(delayNode); delayNode.connect(delayFeedbackGain); delayFeedbackGain.connect(delayNode);
  delayNode.connect(delayWetGain); delayWetGain.connect(eqLow!);
  applyFxState();
}
export function applyFxState(): void {
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

// ─── Drum synthesis ──────────────────────────────────────────────────────────
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
export function metroClick(a: BaseAudioContext, out: AudioNode, when: number, accent: boolean): void {
  const o = a.createOscillator(); const g = a.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  const peak = (accent ? 0.5 : 0.3) * transport.metroVolume;
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  o.connect(g); g.connect(out); o.start(when); o.stop(when + 0.05);
}

// ─── Sample playback ─────────────────────────────────────────────────────────
const chokeSources = new Map<number, AudioBufferSourceNode[]>();

export function playSample(
  a: BaseAudioContext,
  out: AudioNode,
  r: number,
  vol: number,
  when: number,
  overrides: Partial<Pick<SamplerP, "tune" | "start" | "filter">> & { buffer?: AudioBuffer } = {},
): boolean {
  const buffer = overrides.buffer ?? sampleBuffers[r]; if (!buffer) return false;
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
    const sourceDuration = playDur, targetDuration = sourceDuration * (p.sourceBpm / transport.bpm);
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
export function reversedBuffer(a: BaseAudioContext, source: AudioBuffer): AudioBuffer {
  const out = a.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c), target = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) target[i] = input[source.length - 1 - i];
  }
  return out;
}
export function playDrum(a: BaseAudioContext, out: AudioNode, r: number, vol: number, when: number): void {
  if (playSample(a, out, r, vol, when)) return;
  if (r >= DRUMS.length) return;
  const p = dp[r];
  // Rack Tune applies to synth drums too, varispeed-style: pitch and noise
  // colour shift together, decay shortens as you tune up (like a repitched sample).
  const rate = Math.pow(2, (sampleParams[r]?.tune ?? 0) / 12);
  const pitch = p.pitch * rate, pitchEnd = p.pitchEnd * rate;
  const filt = Math.max(40, Math.min(18000, p.filter * rate));
  const decay = Math.max(0.01, p.decay / rate);
  switch (r) {
    case 0: // Kick: tone sweep + transient click
      dTone(a, out, vol, pitch, pitchEnd, decay, when);
      dTone(a, out, vol * 0.25, pitch * 3, pitch * 3, 0.004, when, "square");
      break;
    case 1: // Snare: noise + optional tone body
      dNoise(a, out, vol, filt, decay, when);
      if (p.toneLevel > 0) dTone(a, out, vol * p.toneLevel, pitch, pitch * 0.5, decay * 0.7, when);
      break;
    case 2: dNoise(a, out, vol, filt, decay, when); break;           // HH Cl
    case 3: dNoise(a, out, vol, filt, decay, when); break;           // HH Op
    case 4: // Clap: staggered noise bursts
      for (let i = 0; i < 3; i++) dNoise(a, out, vol * 0.9, filt, decay, when + i * (p.spread / 1000), "bandpass", 0.5);
      break;
    case 5: dTone(a, out, vol, pitch, pitchEnd, decay, when); break; // Tom
    case 6: // Rim: triangle tone + noise
      dTone(a, out, vol * p.toneLevel, pitch, pitch, 0.06, when, "triangle");
      dNoise(a, out, vol * (1 - p.toneLevel) * 0.6, filt, 0.06, when);
      break;
    case 7: dNoise(a, out, vol * 0.6, filt, decay, when); break;    // Crash
  }
}

export function playPad(
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
  // Poise-style layers (C4): base = the pad's own sample (or synth drum);
  // extras dispatch by the pad's layer mode.
  const base = (gain = 1, extraTune = 0): void => {
    if (!playSample(a, out, pad, scaled * gain, when, { tune: tune + extraTune, filter, start })) playDrum(a, out, pad % DRUMS.length, scaled * gain, when);
  };
  const extras = padLayers[pad]
    .map((layer, i) => ({ layer, buffer: padLayerBuffers[pad]?.[i] ?? null }))
    .filter((x): x is { layer: (typeof padLayers)[number][number]; buffer: AudioBuffer } => !!x.buffer);
  if (!extras.length) { base(); return; }
  const fireExtra = (x: (typeof extras)[number]): void => {
    playSample(a, out, pad, scaled * x.layer.gain, when, { tune: tune + x.layer.tune, filter, start, buffer: x.buffer });
  };
  const lm = padLayerMode[pad];
  if (lm === "layered") { base(); extras.forEach(fireExtra); }
  else if (lm === "roundrobin") {
    const total = extras.length + 1;
    const k = (rrCounters[pad] = ((rrCounters[pad] ?? -1) + 1) % total);
    if (k === 0) base(); else fireExtra(extras[k - 1]);
  } else if (lm === "random") {
    const k = Math.floor(Math.random() * (extras.length + 1));
    if (k === 0) base(); else fireExtra(extras[k - 1]);
  } else {
    const match = extras.find((x) => velocity >= x.layer.velLo && velocity <= x.layer.velHi);
    if (match) fireExtra(match); else base();
  }
}
const rrCounters: Record<number, number> = {};

export async function hydratePadLayer(pad: number, index: number): Promise<void> {
  const layer = padLayers[pad][index];
  if (!layer?.data) { if (padLayerBuffers[pad]) padLayerBuffers[pad][index] = null; return; }
  padLayerBuffers[pad][index] = await ac().decodeAudioData(dataUrlToBytes(layer.data));
}

// ─── Buffers ─────────────────────────────────────────────────────────────────
export async function hydrateSample(r: number): Promise<void> {
  const data = sampleData[r]; if (!data) { sampleBuffers[r] = null; return; }
  sampleBuffers[r] = await ac().decodeAudioData(dataUrlToBytes(data));
}
export function crushBuffer(source: AudioBuffer, bits: number, downsample: number): AudioBuffer {
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
