// Web Audio engine: context, master chain, drum synthesis, sample playback,
// live synth voices. Exported `let` bindings are live — importers always see
// the current node instances.

import {
  DRUMS, dp, fx, rackState, mpc, sampleParams, sampleBuffers, sampleData, transport,
  padLayers, padLayerBuffers, padLayerMode, laneSends, laneVoices,
} from "./state";
import type { SamplerP } from "./state";
import { dataUrlToBytes } from "./helpers";

// ─── Audio graph ─────────────────────────────────────────────────────────────
export let AC: AudioContext | null = null;
export let master: GainNode | null = null;
export let masterAnalyser: AnalyserNode | null = null;
export const trackGain: GainNode[] = [];
export let synthGain: GainNode | null = null;
let liveChain: MasterChain | null = null;

// CV-80 master chain: bus → DRIVE → EQ → comp → LIMITER, with TAPE ECHO and
// SPACE as parallel returns tapped after the drive. Built by one function so
// the live context and the offline render context cannot drift apart.
export interface MasterChain {
  bus: GainNode;
  drivePre: GainNode; driveShaper: WaveShaperNode; drivePost: GainNode;
  eqLow: BiquadFilterNode; eqMid: BiquadFilterNode; eqHigh: BiquadFilterNode;
  compressor: DynamicsCompressorNode; limiter: DynamicsCompressorNode;
  echoDelay: DelayNode; echoFb: GainNode; echoDamp: BiquadFilterNode; echoWet: GainNode;
  echoWowDepth: GainNode;
  spaceHp: BiquadFilterNode; spaceConv: ConvolverNode; spaceWet: GainNode;
  spaceSeconds: number;
}

/** tanh saturation, blended against dry so amount 0 is an exact bypass. */
export function makeDriveCurve(amount: number, blend = 1) {
  const n = 1024, curve = new Float32Array(n), k = Math.max(0.0001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x * (1 - blend) + Math.tanh(x * k) * 0.86 * blend;
  }
  return curve;
}
function makeImpulse(a: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = a.sampleRate, len = Math.max(1, Math.floor(sr * seconds));
  const ir = a.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4.0);
  }
  return ir;
}

export function buildMasterChain(a: BaseAudioContext, dest: AudioNode): MasterChain {
  const bus = a.createGain(); bus.gain.value = 0.8;
  const drivePre = a.createGain(), drivePost = a.createGain();
  const driveShaper = a.createWaveShaper(); driveShaper.oversample = "4x";
  const eqLow = a.createBiquadFilter(); eqLow.type = "lowshelf"; eqLow.frequency.value = 180;
  const eqMid = a.createBiquadFilter(); eqMid.type = "peaking"; eqMid.frequency.value = 1200; eqMid.Q.value = 0.8;
  const eqHigh = a.createBiquadFilter(); eqHigh.type = "highshelf"; eqHigh.frequency.value = 6500;
  const compressor = a.createDynamicsCompressor(), limiter = a.createDynamicsCompressor();
  bus.connect(drivePre); drivePre.connect(driveShaper); driveShaper.connect(drivePost);
  drivePost.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
  eqHigh.connect(compressor); compressor.connect(limiter); limiter.connect(dest);

  // TAPE ECHO — the damping filter sits INSIDE the feedback loop, so each
  // repeat loses top end the way tape does; a slow LFO on delayTime is wow.
  const echoDelay = a.createDelay(2), echoFb = a.createGain(), echoWet = a.createGain();
  const echoDamp = a.createBiquadFilter(); echoDamp.type = "lowpass";
  const echoWow = a.createOscillator(); echoWow.type = "sine"; echoWow.frequency.value = 0.6;
  const echoWowDepth = a.createGain();
  drivePost.connect(echoDelay);
  echoDelay.connect(echoDamp); echoDamp.connect(echoFb); echoFb.connect(echoDelay);
  echoDelay.connect(echoWet); echoWet.connect(eqLow);
  echoWow.connect(echoWowDepth); echoWowDepth.connect(echoDelay.delayTime);
  echoWow.start(0);

  // SPACE — highpassed before the convolver so lows stay dry and defined.
  const spaceSeconds = Math.max(0.3, fx.spaceSize ?? 2.2);
  const spaceHp = a.createBiquadFilter(); spaceHp.type = "highpass"; spaceHp.frequency.value = 380;
  const spaceConv = a.createConvolver(); spaceConv.buffer = makeImpulse(a, spaceSeconds);
  const spaceWet = a.createGain();
  drivePost.connect(spaceHp); spaceHp.connect(spaceConv); spaceConv.connect(spaceWet); spaceWet.connect(eqLow);

  const chain: MasterChain = {
    bus, drivePre, driveShaper, drivePost, eqLow, eqMid, eqHigh, compressor, limiter,
    echoDelay, echoFb, echoDamp, echoWet, echoWowDepth, spaceHp, spaceConv, spaceWet, spaceSeconds,
  };
  applyChainParams(chain);
  return chain;
}

export function applyChainParams(chain: MasterChain): void {
  const d = rackState.devices.drive === false ? 0 : Math.max(0, Math.min(1, fx.drive ?? 0));
  chain.driveShaper.curve = makeDriveCurve(1 + d * 15, d);
  chain.drivePost.gain.value = 1 - d * 0.35;
  chain.eqLow.gain.value = rackState.devices.eq ? fx.low : 0;
  chain.eqMid.gain.value = rackState.devices.eq ? fx.mid : 0;
  chain.eqHigh.gain.value = rackState.devices.eq ? fx.high : 0;
  chain.compressor.threshold.value = rackState.devices.compressor ? fx.compThreshold : 0;
  chain.compressor.ratio.value = rackState.devices.compressor ? fx.compRatio : 1;
  chain.compressor.attack.value = 0.01; chain.compressor.release.value = 0.2; chain.compressor.knee.value = 12;
  chain.limiter.threshold.value = rackState.devices.limiter ? fx.limiter : 0;
  chain.limiter.ratio.value = rackState.devices.limiter ? 20 : 1;
  chain.limiter.attack.value = 0.001; chain.limiter.release.value = 0.08; chain.limiter.knee.value = 0;
  chain.echoDelay.delayTime.value = fx.delayTime;
  chain.echoFb.gain.value = fx.delayFeedback;
  chain.echoDamp.frequency.value = fx.echoDamp ?? 2200;
  chain.echoWowDepth.gain.value = (fx.echoWow ?? 0.25) * 0.0022;
  chain.echoWet.gain.value = rackState.devices.delay ? fx.delayMix : 0;
  chain.spaceWet.gain.value = rackState.devices.reverb ? fx.reverb : 0;
}

export function ac(): AudioContext {
  if (!AC) {
    AC = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    liveChain = buildMasterChain(AC, AC.destination);
    master = liveChain.bus;
    // Post-limiter tap: the orb and any future meter read the finished mix.
    masterAnalyser = AC.createAnalyser(); masterAnalyser.fftSize = 2048; masterAnalyser.smoothingTimeConstant = 0.7;
    liveChain.limiter.connect(masterAnalyser);
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
}
/** Eight drum-lane faders plus their echo/space sends, wired identically live
 *  and offline. `gainOf` lets the offline render copy the live fader values. */
export function buildTracks(
  a: BaseAudioContext, chain: MasterChain, gainOf: (i: number) => number,
): { tracks: GainNode[]; echoSends: GainNode[]; spaceSends: GainNode[]; pans: StereoPannerNode[]; synth: GainNode } {
  const tracks: GainNode[] = [], echoSends: GainNode[] = [], spaceSends: GainNode[] = [], pans: StereoPannerNode[] = [];
  for (let i = 0; i < 8; i++) {
    const g = a.createGain(); g.gain.value = gainOf(i); tracks.push(g);
    // Fader → pan → bus. Sends tap pre-pan so a hard-panned lane still feeds
    // the echo and space returns centred.
    const pan = a.createStereoPanner(); pan.pan.value = laneSends[i]?.pan ?? 0;
    g.connect(pan); pan.connect(chain.bus); pans.push(pan);
    const e = a.createGain(); e.gain.value = laneSends[i]?.echo ?? 0; g.connect(e); e.connect(chain.echoDelay); echoSends.push(e);
    const s = a.createGain(); s.gain.value = laneSends[i]?.space ?? 0; g.connect(s); s.connect(chain.spaceHp); spaceSends.push(s);
  }
  // VV-1 voices carry their own per-note filters — the synth bus is just a fader.
  const synth = a.createGain(); synth.gain.value = 0.7; synth.connect(chain.bus);
  return { tracks, echoSends, spaceSends, pans, synth };
}
let liveEchoSends: GainNode[] = [], liveSpaceSends: GainNode[] = [], livePans: StereoPannerNode[] = [];
/** Per-channel meters for the MIX console. Live context only — an offline
 *  render has nothing to meter. */
export const trackMeters: AnalyserNode[] = [];
export let synthMeter: AnalyserNode | null = null;
export function ensureNodes(): void {
  const a = ac();
  if (trackGain.length) return;
  const built = buildTracks(a, liveChain!, () => 0.8);
  trackGain.push(...built.tracks);
  liveEchoSends = built.echoSends; liveSpaceSends = built.spaceSends; livePans = built.pans;
  synthGain = built.synth;
  built.pans.forEach((p) => {
    const m = a.createAnalyser(); m.fftSize = 256; m.smoothingTimeConstant = 0.6;
    p.connect(m); trackMeters.push(m);
  });
  synthMeter = a.createAnalyser(); synthMeter.fftSize = 256; synthMeter.smoothingTimeConstant = 0.6;
  built.synth.connect(synthMeter);
}
export function setTrackPan(i: number, v: number): void {
  if (laneSends[i]) laneSends[i].pan = v;
  if (livePans[i]) livePans[i].pan.value = Math.max(-1, Math.min(1, v));
}
export function applyLaneSends(): void {
  liveEchoSends.forEach((g, i) => { g.gain.value = laneSends[i]?.echo ?? 0; });
  liveSpaceSends.forEach((g, i) => { g.gain.value = laneSends[i]?.space ?? 0; });
}
/** SPACE wet level — also the target of the master reverb automation ramp. */
export function initReverb(wet: number): void {
  ac();
  fx.reverb = wet;
  if (liveChain) liveChain.spaceWet.gain.value = rackState.devices.reverb ? wet : 0;
}
/** Kept for callers written against the old lazy-init API; the chain is eager now. */
export function initDelay(): void { ac(); applyFxState(); }
export function applyFxState(): void {
  if (liveChain) applyChainParams(liveChain);
}
/** Rebuild the SPACE impulse after a size change (the buffer is baked, not a param). */
export function refreshSpaceSize(): void {
  if (!liveChain || !AC) return;
  const seconds = Math.max(0.3, fx.spaceSize ?? 2.2);
  if (Math.abs(seconds - liveChain.spaceSeconds) < 0.01) return;
  liveChain.spaceConv.buffer = makeImpulse(AC, seconds);
  liveChain.spaceSeconds = seconds;
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
/** Per-voice saturation stage. Drive 0 returns `out` untouched so nothing is
 *  inserted into the graph for the clean case. */
function driveStage(a: BaseAudioContext, out: AudioNode, drive: number): AudioNode {
  if (drive <= 0) return out;
  const pre = a.createGain(); pre.gain.value = 1 + drive * 6;
  const shaper = a.createWaveShaper(); shaper.curve = makeDriveCurve(2 + drive * 9); shaper.oversample = "4x";
  const tone = a.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2600; tone.Q.value = 1.1;
  const post = a.createGain(); post.gain.value = 1 / (1 + drive * 6);
  pre.connect(shaper); shaper.connect(tone); tone.connect(post); post.connect(out);
  return pre;
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
/** LYSERGIC GLT voice — one of three destructive flavours, chosen per hit. */
function dGlitch(a: BaseAudioContext, out: AudioNode, vol: number, when: number, decay: number): void {
  const kind = Math.floor(Math.random() * 3);
  const g = a.createGain(); g.connect(out);
  if (kind === 0) {
    const osc = a.createOscillator(); osc.type = "square";
    const f0 = 200 + Math.random() * 1400;
    for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(f0 * (0.4 + Math.random() * 1.6), when + i * 0.012);
    const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + decay + Math.random() * 0.06);
    osc.connect(hp); hp.connect(g); osc.start(when); osc.stop(when + decay + 0.16);
  } else if (kind === 1) {
    const n = noiseSrc(a, 0.12);
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 600 + Math.random() * 4000; bp.Q.value = 3 + Math.random() * 12;
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03 + Math.random() * 0.05);
    n.connect(bp); bp.connect(g); n.start(when); n.stop(when + 0.12);
  } else {
    const osc = a.createOscillator(); osc.type = "sawtooth";
    const up = Math.random() < 0.5;
    osc.frequency.setValueAtTime(up ? 120 : 1600, when);
    osc.frequency.exponentialRampToValueAtTime(up ? 1600 : 90, when + 0.09);
    g.gain.setValueAtTime(vol * 0.8, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    osc.connect(g); osc.start(when); osc.stop(when + 0.12);
  }
}

export interface DrumHit { pitchMul?: number; decayMul?: number }

export function playDrum(a: BaseAudioContext, out: AudioNode, r: number, vol: number, when: number, hit: DrumHit = {}): void {
  if (laneVoices[r] === "glitch") { dGlitch(a, out, vol, when, Math.max(0.02, (dp[r]?.decay ?? 0.08) * (hit.decayMul ?? 1))); return; }
  if (playSample(a, out, r, vol, when, { tune: (sampleParams[r]?.tune ?? 0) + (hit.pitchMul ? Math.log2(hit.pitchMul) * 12 : 0) })) return;
  if (r >= DRUMS.length) return;
  const p = dp[r];
  // Rack Tune applies to synth drums too, varispeed-style: pitch and noise
  // colour shift together, decay shortens as you tune up (like a repitched sample).
  const rate = Math.pow(2, (sampleParams[r]?.tune ?? 0) / 12) * (hit.pitchMul ?? 1);
  const pitch = p.pitch * rate, pitchEnd = p.pitchEnd * rate;
  const filt = Math.max(40, Math.min(18000, p.filter * rate));
  const decay = Math.max(0.01, p.decay / rate) * (hit.decayMul ?? 1);
  const drive = Math.max(0, Math.min(1, p.drive ?? 0));
  switch (r) {
    case 0: { // Kick: tone sweep through the drive curve + square sub-layer + beater click
      const shaped = driveStage(a, out, drive);
      dTone(a, shaped, vol, pitch, pitchEnd, decay, when);
      if (drive > 0) {
        // the gritty harmonic layer that makes a driven kick read as fuzzed sub
        dTone(a, shaped, vol * 0.3 * drive, pitch * 0.63, pitchEnd * 0.92, decay * 0.7, when, "square");
        dNoise(a, out, vol * 0.35 * drive, 1900, 0.025, when);
      }
      dTone(a, out, vol * 0.25, pitch * 3, pitch * 3, 0.004, when, "square");
      break;
    }
    case 1: { // Snare: noise + optional tone body
      const shaped = driveStage(a, out, drive);
      dNoise(a, shaped, vol, filt, decay, when);
      if (p.toneLevel > 0) dTone(a, shaped, vol * p.toneLevel, pitch, pitch * 0.5, decay * 0.7, when);
      break;
    }
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
