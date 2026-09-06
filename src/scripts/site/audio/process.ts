// Offline sample-prep operations on plain Float32Array channels. Pure, no DOM,
// no AudioContext — the page decodes, calls these in a recipe order, encodes.
import { lowPass, loudness, toDb } from "./dsp";
import type { Biquad } from "./dsp";

export type Channels = Float32Array[];

export const peakOf = (ch: Channels): number => { let p = 0; for (const x of ch) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };
export const clone = (ch: Channels): Channels => ch.map((x) => Float32Array.from(x));

export function gain(ch: Channels, db: number): Channels {
  const g = Math.pow(10, db / 20);
  return ch.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; });
}
export function normalisePeak(ch: Channels, targetDb = -1): Channels {
  const p = peakOf(ch); if (!p) return clone(ch);
  return gain(ch, targetDb - toDb(p));
}
/** Integrated-loudness normalise; returns the gain applied so the UI can report it. */
export function normaliseLufs(ch: Channels, fs: number, targetLufs = -14): { out: Channels; gainDb: number } {
  const l = loudness(ch, fs).integrated;
  if (!Number.isFinite(l)) return { out: clone(ch), gainDb: 0 };
  const gainDb = targetLufs - l;
  return { out: gain(ch, gainDb), gainDb };
}

/** Removes leading and trailing material below `thresholdDb`, keeping a short pad so transients are not clipped. */
export function trimSilence(ch: Channels, fs: number, thresholdDb = -50, padMs = 5): Channels {
  const t = Math.pow(10, thresholdDb / 20), n = ch[0].length, pad = Math.round((padMs / 1000) * fs);
  let start = 0, end = n;
  outer: for (let i = 0; i < n; i++) { for (const x of ch) if (Math.abs(x[i]) > t) { start = i; break outer; } }
  outer2: for (let i = n - 1; i >= 0; i--) { for (const x of ch) if (Math.abs(x[i]) > t) { end = i + 1; break outer2; } }
  if (end <= start) return ch.map(() => new Float32Array(0));
  start = Math.max(0, start - pad); end = Math.min(n, end + pad);
  return ch.map((x) => x.slice(start, end));
}

export function fade(ch: Channels, fs: number, inMs: number, outMs: number): Channels {
  const n = ch[0].length, fi = Math.min(n, Math.round((inMs / 1000) * fs)), fo = Math.min(n, Math.round((outMs / 1000) * fs));
  return ch.map((x) => {
    const y = Float32Array.from(x);
    for (let i = 0; i < fi; i++) y[i] *= Math.sin((i / fi) * Math.PI / 2);          // equal-power-ish curve
    for (let i = 0; i < fo; i++) y[n - 1 - i] *= Math.sin((i / fo) * Math.PI / 2);
    return y;
  });
}
export const reverse = (ch: Channels): Channels => ch.map((x) => Float32Array.from(x).reverse());
export const toMono = (ch: Channels): Channels => {
  if (ch.length === 1) return clone(ch);
  const y = new Float32Array(ch[0].length);
  for (const x of ch) for (let i = 0; i < y.length; i++) y[i] += x[i] / ch.length;
  return [y];
};

export function removeDc(ch: Channels): Channels {
  return ch.map((x) => { let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length || 1; const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] - m; return y; });
}

function runBiquad(x: Float32Array, b: Biquad): Float32Array {
  const y = new Float32Array(x.length); let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], o = b.b0 * v + s1; s1 = b.b1 * v - b.a1 * o + s2; s2 = b.b2 * v - b.a2 * o; y[i] = o; }
  return y;
}
/** Linkwitz-Riley 4th-order low-pass (two cascaded Butterworth 2nd-order sections), −24 dB/oct above f0. */
function lowBand(x: Float32Array, fs: number, f0: number): Float32Array {
  const lp = lowPass(fs, f0, Math.SQRT1_2);
  return runBiquad(runBiquad(x, lp), lp);
}

/**
 * Centre-channel cancellation. Anything identical in both channels (a centred
 * vocal, usually kick and bass too) cancels in L−R; the mid below `keepBelowHz`
 * is added back so the low end survives. Crude by design — real separation is
 * a model, this is arithmetic.
 */
export function removeCentre(ch: Channels, fs: number, keepBelowHz = 150, sideGainDb = 0): Channels {
  if (ch.length < 2) return clone(ch);
  const [l, r] = ch, n = l.length, mid = new Float32Array(n), side = new Float32Array(n);
  for (let i = 0; i < n; i++) { mid[i] = (l[i] + r[i]) / 2; side[i] = (l[i] - r[i]) / 2; }
  const sub = keepBelowHz > 0 ? lowBand(mid, fs, keepBelowHz) : new Float32Array(n);
  const g = Math.pow(10, sideGainDb / 20);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  for (let i = 0; i < n; i++) { outL[i] = side[i] * g + sub[i]; outR[i] = -side[i] * g + sub[i]; }
  return [outL, outR];
}

/** 4-point Catmull-Rom resampler. `ratio` > 1 makes the output shorter (faster). */
export function resample(ch: Channels, ratio: number): Channels {
  if (Math.abs(ratio - 1) < 1e-9) return clone(ch);
  return ch.map((x) => {
    const n = Math.max(1, Math.floor(x.length / ratio)), y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio, k = Math.floor(pos), t = pos - k;
      const p0 = x[Math.max(0, k - 1)], p1 = x[Math.min(x.length - 1, k)], p2 = x[Math.min(x.length - 1, k + 1)], p3 = x[Math.min(x.length - 1, k + 2)];
      y[i] = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    return y;
  });
}
export const convertRate = (ch: Channels, fromHz: number, toHz: number): Channels => resample(ch, fromHz / toHz);

/**
 * WSOLA time-stretch: output length = input × factor, pitch unchanged. Frames
 * are 40 ms with a ±8 ms search for the best-aligned overlap. Fine for drums
 * and loops at 0.5–2×; extreme ratios smear like every OLA method does.
 */
export function timeStretch(ch: Channels, fs: number, factor: number): Channels {
  if (Math.abs(factor - 1) < 1e-4) return clone(ch);
  const frame = Math.round(fs * 0.04), hopOut = Math.floor(frame / 2), hopIn = hopOut / factor, search = Math.round(fs * 0.008);
  const win = new Float32Array(frame); for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));
  return ch.map((x) => {
    const outLen = Math.floor(x.length * factor), y = new Float32Array(outLen + frame), norm = new Float32Array(outLen + frame);
    let prevIn = 0;
    for (let o = 0, f = 0; o < outLen; o += hopOut, f++) {
      const target = Math.round(f * hopIn);
      let best = target, bestScore = -Infinity;
      if (f > 0) {
        const natural = prevIn + hopOut; // where the previous frame would continue naturally
        for (let d = -search; d <= search; d += 2) {
          const cand = target + d; if (cand < 0 || cand + frame >= x.length) continue;
          let score = 0;
          for (let i = 0; i < frame; i += 4) score += x[natural + i] * x[cand + i];
          if (score > bestScore) { bestScore = score; best = cand; }
        }
      }
      if (best + frame >= x.length) best = Math.max(0, x.length - frame - 1);
      for (let i = 0; i < frame && o + i < y.length; i++) { y[o + i] += x[best + i] * win[i]; norm[o + i] += win[i]; }
      prevIn = best;
    }
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = norm[i] > 1e-3 ? y[i] / norm[i] : y[i];
    return out;
  });
}
/** Pitch shift keeping length: stretch by the ratio, then varispeed back. */
export function pitchShift(ch: Channels, fs: number, semitones: number): Channels {
  if (!semitones) return clone(ch);
  const ratio = Math.pow(2, semitones / 12);
  return resample(timeStretch(ch, fs, ratio), ratio);
}
/** Varispeed: tape-style pitch and length change together. */
export const varispeed = (ch: Channels, semitones: number): Channels => resample(ch, Math.pow(2, semitones / 12));

export interface Recipe {
  trim: boolean; trimDb: number;
  removeDc: boolean;
  centre: boolean; keepBelowHz: number;
  mono: boolean;
  pitchSemitones: number; pitchMode: "keep" | "varispeed";
  stretch: number;           // 1 = unchanged
  reverse: boolean;
  fadeInMs: number; fadeOutMs: number;
  normalise: "off" | "peak" | "lufs"; peakDb: number; lufs: number;
  gainDb: number;
  outRate: number;           // 0 = keep
}
export const DEFAULT_RECIPE: Recipe = { trim: false, trimDb: -50, removeDc: false, centre: false, keepBelowHz: 150, mono: false, pitchSemitones: 0, pitchMode: "keep", stretch: 1, reverse: false, fadeInMs: 0, fadeOutMs: 0, normalise: "off", peakDb: -1, lufs: -14, gainDb: 0, outRate: 0 };

export function applyRecipe(input: Channels, fs: number, r: Recipe): { out: Channels; rate: number; notes: string[] } {
  let ch = clone(input), rate = fs; const notes: string[] = [];
  if (r.removeDc) ch = removeDc(ch);
  if (r.centre) { ch = removeCentre(ch, rate, r.keepBelowHz); notes.push(`centre removed (sub kept below ${r.keepBelowHz} Hz)`); }
  if (r.trim) { const before = ch[0].length; ch = trimSilence(ch, rate, r.trimDb); notes.push(`trimmed ${((before - ch[0].length) / rate).toFixed(2)} s`); }
  if (r.mono) ch = toMono(ch);
  if (r.stretch !== 1) { ch = timeStretch(ch, rate, r.stretch); notes.push(`stretched ×${r.stretch.toFixed(3)}`); }
  if (r.pitchSemitones) { ch = r.pitchMode === "keep" ? pitchShift(ch, rate, r.pitchSemitones) : varispeed(ch, r.pitchSemitones); notes.push(`pitch ${r.pitchSemitones > 0 ? "+" : ""}${r.pitchSemitones} st (${r.pitchMode === "keep" ? "length kept" : "varispeed"})`); }
  if (r.reverse) ch = reverse(ch);
  if (r.fadeInMs || r.fadeOutMs) ch = fade(ch, rate, r.fadeInMs, r.fadeOutMs);
  if (r.outRate && r.outRate !== rate) { ch = convertRate(ch, rate, r.outRate); rate = r.outRate; notes.push(`resampled to ${rate} Hz`); }
  if (r.gainDb) ch = gain(ch, r.gainDb);
  if (r.normalise === "peak") ch = normalisePeak(ch, r.peakDb);
  else if (r.normalise === "lufs") { const n = normaliseLufs(ch, rate, r.lufs); ch = n.out; notes.push(`loudness ${n.gainDb >= 0 ? "+" : ""}${n.gainDb.toFixed(1)} dB to ${r.lufs} LUFS`); if (peakOf(ch) > 1) { ch = normalisePeak(ch, -0.1); notes.push("peak clamped to −0.1 dBFS after loudness gain"); } }
  return { out: ch, rate, notes };
}
