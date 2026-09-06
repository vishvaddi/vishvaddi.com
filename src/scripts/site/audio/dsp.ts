// Pure analysis maths for the /audio tools. No DOM. Everything works on the
// decoded PCM of an AudioBuffer and is written to stay under a few seconds for
// a five-minute track on a phone: single passes, small preallocated buffers,
// no per-sample allocations, and the long loops are chunked behind
// `yieldEvery` so the page can draw progress.

export interface Progress { (fraction: number, stage: string): void }

// ── FFT ─────────────────────────────────────────────────────────────────────
export class FFT {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  constructor(n: number) {
    if (n & (n - 1)) throw new Error("FFT size must be a power of two");
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  }
  /** In-place complex FFT. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t], wi = this.sin[t];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// ── Biquads (RBJ cookbook) ──────────────────────────────────────────────────
export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

export function highShelf(fs: number, f0: number, dBgain: number, Q: number): Biquad {
  const A = Math.pow(10, dBgain / 40), w0 = (2 * Math.PI * f0) / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q), sa = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) + (A - 1) * cw + sa), b1 = -2 * A * ((A - 1) + (A + 1) * cw), b2 = A * ((A + 1) + (A - 1) * cw - sa);
  const a0 = (A + 1) - (A - 1) * cw + sa, a1 = 2 * ((A - 1) - (A + 1) * cw), a2 = (A + 1) - (A - 1) * cw - sa;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function highPass(fs: number, f0: number, Q: number): Biquad {
  const w0 = (2 * Math.PI * f0) / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
/** ITU-R BS.1770 K-weighting: pre-filter shelf then RLB high-pass, any sample rate. */
export function kWeighting(fs: number): [Biquad, Biquad] {
  return [highShelf(fs, 1681.974450955533, 3.999843853973347, 0.7071752369554196), highPass(fs, 38.13547087602444, 0.5003270373238773)];
}

// ── Loudness (BS.1770-4 / EBU R128) ─────────────────────────────────────────
export interface Loudness {
  integrated: number;       // LUFS, -Infinity when fully gated
  shortTermMax: number;     // LUFS, 3 s window
  momentaryMax: number;     // LUFS, 400 ms window
  range: number;            // LU (EBU Tech 3342)
  shortTerm: Float32Array;  // one value per 100 ms hop, LUFS (may be -Infinity)
}

const db = (p: number): number => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

export function loudness(channels: Float32Array[], fs: number): Loudness {
  const hop = Math.round(fs / 10); // 100 ms sub-blocks — 400 ms blocks with 75 % overlap fall out of sums of four
  const subCount = Math.max(1, Math.floor(channels[0].length / hop));
  const power = new Float64Array(subCount); // Σ over channels of mean-square per sub-block (G = 1 for L/R/C)
  for (const x of channels) {
    const [s, h] = kWeighting(fs);
    let s1 = 0, s2 = 0, h1 = 0, h2 = 0; // direct-form-II transposed state per stage
    for (let b = 0; b < subCount; b++) {
      const start = b * hop, end = start + hop;
      let acc = 0;
      for (let i = start; i < end; i++) {
        const v = x[i];
        const y1 = s.b0 * v + s1; s1 = s.b1 * v - s.a1 * y1 + s2; s2 = s.b2 * v - s.a2 * y1;
        const y2 = h.b0 * y1 + h1; h1 = h.b1 * y1 - h.a1 * y2 + h2; h2 = h.b2 * y1 - h.a2 * y2;
        acc += y2 * y2;
      }
      power[b] += acc / hop;
    }
  }
  const windowMeans = (len: number): Float64Array => {
    const out = new Float64Array(Math.max(0, subCount - len + 1));
    let run = 0;
    for (let b = 0; b < subCount; b++) { run += power[b]; if (b >= len) run -= power[b - len]; if (b >= len - 1) out[b - len + 1] = run / len; }
    return out;
  };
  const momentary = windowMeans(4), shortTerm = windowMeans(30);
  // Integrated: absolute gate −70 LUFS, then relative gate 10 LU under the mean of what survived.
  let sum = 0, n = 0;
  for (const p of momentary) if (db(p) > -70) { sum += p; n++; }
  let integrated = -Infinity;
  if (n) {
    const rel = db(sum / n) - 10;
    let s2 = 0, n2 = 0;
    for (const p of momentary) if (db(p) > rel) { s2 += p; n2++; }
    integrated = n2 ? db(s2 / n2) : -Infinity;
  }
  // LRA: short-term distribution, absolute −70, relative −20 LU, 10th→95th percentile.
  const st = Array.from(shortTerm, db).filter((v) => v > -70);
  let range = 0;
  if (st.length) {
    const relGate = db(st.reduce((a, v) => a + Math.pow(10, (v + 0.691) / 10), 0) / st.length) - 20;
    const kept = st.filter((v) => v > relGate).sort((a, b) => a - b);
    if (kept.length > 1) range = kept[Math.min(kept.length - 1, Math.floor(0.95 * kept.length))] - kept[Math.floor(0.1 * kept.length)];
  }
  let momentaryMax = -Infinity, shortTermMax = -Infinity;
  for (const p of momentary) momentaryMax = Math.max(momentaryMax, db(p));
  for (const p of shortTerm) shortTermMax = Math.max(shortTermMax, db(p));
  return { integrated, shortTermMax, momentaryMax, range, shortTerm: Float32Array.from(shortTerm, db) };
}

// ── True peak (4× oversampled, windowed-sinc polyphase) ─────────────────────
const TP_TAPS = 12; // per phase → 48-tap interpolator, like the BS.1770 reference
const tpPhases = (() => {
  const phases: Float32Array[] = [];
  for (let p = 1; p < 4; p++) {
    const h = new Float32Array(TP_TAPS);
    const frac = p / 4;
    let sum = 0;
    for (let k = 0; k < TP_TAPS; k++) {
      const t = k - (TP_TAPS / 2 - 1) - frac;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / TP_TAPS) + 0.08 * Math.cos((4 * Math.PI * (k + 0.5)) / TP_TAPS);
      h[k] = sinc * w; sum += h[k];
    }
    for (let k = 0; k < TP_TAPS; k++) h[k] /= sum;
    phases.push(h);
  }
  return phases;
})();

/** Returns {samplePeak, truePeak} as linear values. Only regions within 6 dB of the sample peak are interpolated. */
export function peaks(channels: Float32Array[]): { samplePeak: number; truePeak: number; clippedRuns: number } {
  let samplePeak = 0, clippedRuns = 0;
  for (const x of channels) {
    let run = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > samplePeak) samplePeak = a;
      if (a >= 0.999) { run++; if (run === 3) clippedRuns++; } else run = 0;
    }
  }
  let truePeak = samplePeak;
  const threshold = samplePeak * 0.5;
  const half = TP_TAPS / 2;
  for (const x of channels) {
    for (let i = half; i < x.length - half; i++) {
      if (Math.abs(x[i]) < threshold) continue;
      for (const h of tpPhases) {
        let acc = 0;
        for (let k = 0; k < TP_TAPS; k++) acc += h[k] * x[i - half + 1 + k];
        const a = Math.abs(acc);
        if (a > truePeak) truePeak = a;
      }
    }
  }
  return { samplePeak, truePeak, clippedRuns };
}

// ── Spectral pass: onset envelope, chroma, average spectrum ─────────────────
export interface Spectral {
  fps: number;              // onset frames per second
  onset: Float32Array;      // spectral-flux onset strength
  chroma: Float64Array;     // 12 bins, C = 0, normalised to sum 1
  spectrum: Float32Array;   // average power per FFT bin (mono)
  binHz: number;
  centroidHz: number;
}

export async function spectral(mono: Float32Array, fs: number, progress?: Progress, yieldEvery = 400): Promise<Spectral> {
  const N = 2048, hop = 512, fft = new FFT(N), win = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N), prevMag = new Float32Array(N / 2), mag = new Float32Array(N / 2);
  const frames = Math.max(1, Math.floor((mono.length - N) / hop) + 1);
  const onset = new Float32Array(frames), spectrum = new Float32Array(N / 2), chroma = new Float64Array(12);
  const binHz = fs / N;
  // Chroma comes from interpolated spectral peaks, not whole bins: at 2048
  // points a bin is ~23 Hz wide, which straddles two semitones below C4.
  const kLo = Math.max(2, Math.ceil(80 / binHz)), kHi = Math.min(N / 2 - 2, Math.floor(5000 / binHz));
  let centroidNum = 0, centroidDen = 0;
  for (let fr = 0; fr < frames; fr++) {
    const off = fr * hop;
    for (let i = 0; i < N; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft.transform(re, im);
    let flux = 0;
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const m = Math.sqrt(p);
      mag[k] = m;
      spectrum[k] += p;
      const d = Math.log1p(m * 20) - Math.log1p(prevMag[k] * 20);
      if (d > 0) flux += d;
      centroidNum += k * binHz * p; centroidDen += p;
    }
    for (let k = kLo; k <= kHi; k++) {
      const m = mag[k];
      if (m < 1e-4 || m <= mag[k - 1] || m < mag[k + 1]) continue;
      const l0 = Math.log(mag[k - 1] + 1e-9), l1 = Math.log(m + 1e-9), l2 = Math.log(mag[k + 1] + 1e-9);
      const denom = l0 - 2 * l1 + l2;
      const shift = denom ? 0.5 * (l0 - l2) / denom : 0;
      const f = (k + Math.max(-0.5, Math.min(0.5, shift))) * binHz;
      chroma[(((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12] += m;
    }
    onset[fr] = flux;
    prevMag.set(mag);
    if (fr % yieldEvery === yieldEvery - 1) { progress?.(fr / frames, "spectrum"); await new Promise((r) => setTimeout(r, 0)); }
  }
  for (let k = 0; k < N / 2; k++) spectrum[k] /= frames;
  const total = chroma.reduce((a, v) => a + v, 0) || 1;
  for (let i = 0; i < 12; i++) chroma[i] /= total;
  return { fps: fs / hop, onset, chroma, spectrum, binHz, centroidHz: centroidDen ? centroidNum / centroidDen : 0 };
}

// ── Tempo ───────────────────────────────────────────────────────────────────
export interface Tempo { bpm: number; confidence: number; alternatives: { bpm: number; score: number }[] }

export function tempo(onset: Float32Array, fps: number): Tempo {
  const n = onset.length;
  // Remove the slow envelope so sustained loud sections don't swamp the autocorrelation.
  const env = new Float32Array(n), meanLen = Math.round(fps);
  let run = 0;
  for (let i = 0; i < n; i++) { run += onset[i]; if (i >= meanLen) run -= onset[i - meanLen]; env[i] = Math.max(0, onset[i] - run / Math.min(i + 1, meanLen)); }
  const minLag = Math.floor((60 * fps) / 200), maxLag = Math.ceil((60 * fps) / 60);
  const acf = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    acf[lag] = s / (n - lag);
  }
  let norm = 0; for (let lag = minLag; lag <= maxLag; lag++) norm = Math.max(norm, acf[lag]);
  if (!norm) return { bpm: 0, confidence: 0, alternatives: [] };
  // Log-normal prior around 120 BPM (Ellis 2007) plus support from the double-period lag.
  const prior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.1, 2));
  const scored: { bpm: number; score: number; lag: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    let s = acf[lag] / norm;
    if (2 * lag <= maxLag) s += 0.5 * (acf[2 * lag] / norm);
    scored.push({ bpm, score: s * prior(bpm), lag });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Parabolic interpolation on the raw ACF for a sub-frame lag.
  let lag = best.lag;
  if (lag > minLag && lag < maxLag) {
    const y0 = acf[lag - 1], y1 = acf[lag], y2 = acf[lag + 1], denom = y0 - 2 * y1 + y2;
    if (denom !== 0) lag += 0.5 * (y0 - y2) / denom;
  }
  const bpm = (60 * fps) / lag;
  let mean = 0; for (let l = minLag; l <= maxLag; l++) mean += acf[l]; mean /= maxLag - minLag + 1;
  const confidence = Math.max(0, Math.min(1, (acf[best.lag] - mean) / (norm || 1)));
  const alternatives: { bpm: number; score: number }[] = [];
  for (const cand of [bpm / 2, bpm * 2, (bpm * 2) / 3, (bpm * 3) / 2]) {
    if (cand < 60 || cand > 200) continue;
    const l = Math.round((60 * fps) / cand);
    alternatives.push({ bpm: Math.round(cand * 10) / 10, score: Math.round((acf[l] / norm) * 100) / 100 });
  }
  return { bpm: Math.round(bpm * 10) / 10, confidence, alternatives };
}

// ── Key ─────────────────────────────────────────────────────────────────────
export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

export interface KeyGuess { root: number; mode: "major" | "minor"; name: string; camelot: string; score: number }
export interface Key { best: KeyGuess; candidates: KeyGuess[]; confidence: number; compatible: string[] }

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; dbb += y * y; }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0;
}

export function key(chroma: ArrayLike<number>): Key {
  const guesses: KeyGuess[] = [];
  for (let root = 0; root < 12; root++) {
    const rotated = (profile: number[]) => Array.from({ length: 12 }, (_, i) => profile[((i - root) % 12 + 12) % 12]);
    guesses.push({ root, mode: "major", name: `${NOTE_NAMES[root]} major`, camelot: CAMELOT_MAJOR[root], score: pearson(chroma, rotated(KK_MAJOR)) });
    guesses.push({ root, mode: "minor", name: `${NOTE_NAMES[root]} minor`, camelot: CAMELOT_MINOR[root], score: pearson(chroma, rotated(KK_MINOR)) });
  }
  guesses.sort((a, b) => b.score - a.score);
  const best = guesses[0], second = guesses[1];
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) / Math.max(0.05, Math.abs(best.score))));
  const num = parseInt(best.camelot, 10), letter = best.camelot.endsWith("A") ? "A" : "B";
  const wrap = (n: number) => ((n - 1 + 12) % 12) + 1;
  const compatible = [`${num}${letter === "A" ? "B" : "A"}`, `${wrap(num - 1)}${letter}`, `${wrap(num + 1)}${letter}`];
  return { best, candidates: guesses.slice(0, 3), confidence, compatible };
}

// ── Stereo ──────────────────────────────────────────────────────────────────
export interface Stereo { correlation: number; widthDb: number; balanceDb: number; dcOffset: number; mono: boolean }

export function stereo(channels: Float32Array[]): Stereo {
  if (channels.length < 2) {
    let dc = 0; for (let i = 0; i < channels[0].length; i++) dc += channels[0][i];
    return { correlation: 1, widthDb: -Infinity, balanceDb: 0, dcOffset: dc / channels[0].length, mono: true };
  }
  const [l, r] = channels;
  let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0, dc = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = r[i], m = (a + b) / 2, s = (a - b) / 2;
    ll += a * a; rr += b * b; lr += a * b; mm += m * m; ss += s * s; dc += m;
  }
  const correlation = ll && rr ? lr / Math.sqrt(ll * rr) : 1;
  const widthDb = mm ? 10 * Math.log10((ss || 1e-12) / mm) : -Infinity;
  const balanceDb = ll && rr ? 10 * Math.log10(rr / ll) : 0;
  return { correlation, widthDb, balanceDb, dcOffset: dc / l.length, mono: false };
}

// ── Tonal balance ───────────────────────────────────────────────────────────
export const BANDS: [string, number, number][] = [["Sub", 20, 60], ["Bass", 60, 250], ["Low mid", 250, 500], ["Mid", 500, 2000], ["High mid", 2000, 6000], ["Air", 6000, 20000]];

export function bandShares(spectrum: Float32Array, binHz: number): { name: string; share: number }[] {
  const totals = BANDS.map(() => 0);
  let all = 0;
  for (let k = 1; k < spectrum.length; k++) {
    const f = k * binHz;
    const b = BANDS.findIndex(([, lo, hi]) => f >= lo && f < hi);
    if (b >= 0) { totals[b] += spectrum[k]; all += spectrum[k]; }
  }
  return BANDS.map(([name], i) => ({ name, share: all ? totals[i] / all : 0 }));
}

/** Least-squares slope of the average spectrum in dB per octave, 100 Hz–10 kHz. */
export function spectralTilt(spectrum: Float32Array, binHz: number): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 1; k < spectrum.length; k++) {
    const f = k * binHz;
    if (f < 100 || f > 10000 || spectrum[k] <= 0) continue;
    const x = Math.log2(f), y = 10 * Math.log10(spectrum[k]);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  return denom ? (n * sxy - sx * sy) / denom : 0;
}

// ── Helpers shared with the UI and tests ────────────────────────────────────
export const toDb = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

export function monoMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Deterministic test signal: a kick on every beat at `bpm` plus a sustained minor chord on `rootMidi`. */
export function testSignal(fs: number, seconds: number, bpm: number, rootMidi: number): Float32Array[] {
  const n = Math.floor(fs * seconds), l = new Float32Array(n), r = new Float32Array(n);
  const beat = (60 / bpm) * fs;
  const freqs = [0, 3, 7, 12, 15].map((semi) => 440 * Math.pow(2, (rootMidi + semi - 69) / 12));
  for (let i = 0; i < n; i++) {
    const t = i / fs, inBeat = (i % beat) / fs;
    const kick = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 9) * 0.9;
    let pad = 0;
    freqs.forEach((f, idx) => { pad += Math.sin(2 * Math.PI * f * t + idx) / (freqs.length * 1.5); });
    const gate = i % (beat * 4) < beat * 3.5 ? 1 : 0.2;
    l[i] = kick + pad * 0.35 * gate; r[i] = kick + pad * 0.35 * gate * 0.8 + Math.sin(2 * Math.PI * freqs[1] * t) * 0.03;
  }
  return [l, r];
}
