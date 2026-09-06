// Lo-fi processor: sixteen one-knob "make it sound like…" transforms in the
// spirit of Reason's Audiomatic, applied offline to a dropped file with a
// dry/wet blend. Pure DSP up top, page wiring below.
import { download } from "../calc";
import { highPass, lowPass, toDb } from "./dsp";
import type { Biquad } from "./dsp";
import { peakOf } from "./process";
import type { Channels } from "./process";
import { encodeMp3Channels, encodeWavChannels } from "./wav";

// ── primitives ──
const run = (x: Float32Array, b: Biquad): Float32Array => { const y = new Float32Array(x.length); let s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { const v = x[i], o = b.b0 * v + s1; s1 = b.b1 * v - b.a1 * o + s2; s2 = b.b2 * v - b.a2 * o; y[i] = o; } return y; };
const lp = (x: Float32Array, fs: number, hz: number, passes = 1): Float32Array => { let y = x; for (let i = 0; i < passes; i++) y = run(y, lowPass(fs, Math.min(hz, fs * 0.45), Math.SQRT1_2)); return y; };
const hp = (x: Float32Array, fs: number, hz: number, passes = 1): Float32Array => { let y = x; for (let i = 0; i < passes; i++) y = run(y, highPass(fs, hz, Math.SQRT1_2)); return y; };
const bp = (x: Float32Array, fs: number, lo: number, hi: number): Float32Array => lp(hp(x, fs, lo, 2), fs, hi, 2);
const shape = (x: Float32Array, drive: number, asym = 0): Float32Array => { const y = new Float32Array(x.length), k = 1 + drive * 12; for (let i = 0; i < x.length; i++) y[i] = (Math.tanh((x[i] + asym) * k) - Math.tanh(asym * k)) / Math.tanh(k * 0.8 + 0.2); return y; };
const gainOf = (x: Float32Array, g: number): Float32Array => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; };
const mix = (a: Float32Array, b: Float32Array, wb: number): Float32Array => { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i] * wb; return y; };
let seed = 1234567;
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = (n: number, level: number, colour: "white" | "pink" | "hum" = "white", fs = 44100): Float32Array => {
  const y = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    if (colour === "white") y[i] = w * level;
    else if (colour === "pink") { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; y[i] = (b0 + b1 + b2 + w * 0.1848) * level * 0.25; }
    else y[i] = (Math.sin((2 * Math.PI * 50 * i) / fs) * 0.7 + Math.sin((2 * Math.PI * 100 * i) / fs) * 0.3) * level;
  }
  return y;
};
const crackle = (n: number, fs: number, density: number, level: number): Float32Array => {
  const y = new Float32Array(n), per = fs / Math.max(1, density * 60);
  for (let i = 0; i < n; i++) if (rnd() < 1 / per) { const a = (rnd() * 2 - 1) * level * (0.4 + rnd()); const len = 3 + Math.floor(rnd() * 40); for (let k = 0; k < len && i + k < n; k++) y[i + k] += a * Math.exp(-k / 8); }
  return lp(y, fs, 6000);
};
/** Slow pitch wobble: a modulated delay line read with linear interpolation. */
const wow = (x: Float32Array, fs: number, depthMs: number, rateHz: number, flutterHz = 0): Float32Array => {
  const y = new Float32Array(x.length), base = (depthMs / 1000) * fs + 2;
  for (let i = 0; i < x.length; i++) {
    const m = Math.sin((2 * Math.PI * rateHz * i) / fs) + (flutterHz ? 0.3 * Math.sin((2 * Math.PI * flutterHz * i) / fs + 1.3) : 0);
    const d = base + (depthMs / 1000) * fs * m * 0.5, pos = i - d, k = Math.floor(pos), t = pos - k;
    y[i] = k >= 0 && k + 1 < x.length ? x[k] * (1 - t) + x[k + 1] * t : 0;
  }
  return y;
};
const bitcrush = (x: Float32Array, bits: number): Float32Array => { const y = new Float32Array(x.length), steps = Math.pow(2, bits - 1); for (let i = 0; i < x.length; i++) y[i] = Math.round(x[i] * steps) / steps; return y; };
const decimate = (x: Float32Array, factor: number): Float32Array => { const y = new Float32Array(x.length); let hold = 0; for (let i = 0; i < x.length; i++) { if (i % factor === 0) hold = x[i]; y[i] = hold; } return y; };
const gate = (x: Float32Array, fs: number, threshold: number): Float32Array => { const y = new Float32Array(x.length); let env = 0; const rel = Math.exp(-1 / (fs * 0.05)); for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); env = a > env ? a : env * rel; y[i] = env > threshold ? x[i] : x[i] * Math.max(0, env / threshold) ** 2; } return y; };
const simpleVerb = (x: Float32Array, fs: number, seconds: number, level: number): Float32Array => {
  const taps = [0.0297, 0.0371, 0.0411, 0.0437].map((t) => Math.floor(t * fs)), fb = Math.pow(0.001, taps[0] / (seconds * fs));
  const combs = taps.map(() => new Float32Array(x.length)), y = new Float32Array(x.length);
  taps.forEach((d, c) => { const buf = combs[c]; for (let i = 0; i < x.length; i++) { buf[i] = x[i] + (i >= d ? buf[i - d] * fb : 0); y[i] += buf[i] * 0.25; } });
  return gainOf(lp(y, fs, 5000), level);
};
const reverseArr = (x: Float32Array): Float32Array => Float32Array.from(x).reverse();

export interface Transform { id: string; name: string; blurb: string; apply: (x: Float32Array, fs: number, amount: number, channel: number) => Float32Array }
export const TRANSFORMS: Transform[] = [
  { id: "vhs", name: "VHS", blurb: "Wobbly, dull, hissy tape from a 90s deck.", apply: (x, fs, a) => mix(wow(lp(shape(x, 0.25 * a), fs, 9000 - a * 5000), fs, 1.5 * a + 0.2, 0.5, 7), noise(x.length, 0.012 * a, "white"), 1) },
  { id: "tape", name: "Tape", blurb: "Warm saturation, gentle top-end roll-off, a little hiss.", apply: (x, fs, a) => mix(lp(shape(x, 0.5 * a, 0.05 * a), fs, 16000 - a * 6000), noise(x.length, 0.006 * a, "pink", fs), 1) },
  { id: "cassette", name: "Cassette", blurb: "Compressed, flutter-y, 12 kHz ceiling.", apply: (x, fs, a) => mix(wow(lp(hp(shape(x, 0.6 * a), fs, 60), fs, 12000 - a * 4000), fs, 0.8 * a, 0.8, 12), noise(x.length, 0.01 * a, "pink", fs), 1) },
  { id: "vinyl", name: "Vinyl", blurb: "Crackle, a slow wobble, lows folded to mono-ish.", apply: (x, fs, a) => mix(wow(lp(hp(x, fs, 40), fs, 14000 - a * 5000), fs, 0.5 * a, 0.55), crackle(x.length, fs, 0.4 + a * 2, 0.35 * a), 1) },
  { id: "radio", name: "FM radio", blurb: "Bright, squashed, a touch of static.", apply: (x, fs, a) => mix(shape(bp(x, fs, 80, 12000 - a * 4000), 0.4 * a), noise(x.length, 0.008 * a, "white"), 1) },
  { id: "am", name: "AM radio", blurb: "Narrow, midrangey, crackly broadcast.", apply: (x, fs, a) => mix(shape(bp(x, fs, 200 + a * 100, 5000 - a * 1800), 0.5 * a), noise(x.length, 0.02 * a, "white"), 1) },
  { id: "telephone", name: "Telephone", blurb: "300–3400 Hz, crunched like a landline.", apply: (x, fs, a) => shape(bp(bp(x, fs, 300, 3400), fs, 300, 3400), 0.3 + 0.5 * a) },
  { id: "walkie", name: "Walkie-talkie", blurb: "Gated, distorted, band-limited, with a burst of static.", apply: (x, fs, a) => mix(shape(gate(bp(x, fs, 400, 3000), fs, 0.03), 0.6 + 0.4 * a), noise(x.length, 0.03 * a, "white"), 1) },
  { id: "megaphone", name: "Megaphone", blurb: "Honky resonant midrange, loud and clipped.", apply: (x, fs, a) => shape(run(bp(x, fs, 500, 4000), { ...lowPass(fs, 1800, 4 + a * 6) }), 0.7 * a + 0.2) },
  { id: "underwater", name: "Underwater", blurb: "Everything above 500 Hz gone, slow chorus.", apply: (x, fs, a) => wow(lp(x, fs, 900 - a * 500, 2), fs, 2.5 * a + 0.5, 0.3) },
  { id: "bitcrush", name: "8-bit", blurb: "Bit depth down to 4 bits at full turn.", apply: (x, _fs, a) => bitcrush(x, Math.round(12 - a * 8)) },
  { id: "samplecrush", name: "Sample crush", blurb: "Sample-and-hold decimation, aliasing included.", apply: (x, _fs, a) => decimate(x, 1 + Math.round(a * 15)) },
  { id: "film", name: "Old film", blurb: "Flutter, projector hum, dusty top end.", apply: (x, fs, a) => mix(mix(wow(lp(x, fs, 7000 - a * 3000), fs, 1.2 * a, 0.9, 24), noise(x.length, 0.01 * a, "hum", fs), 1), crackle(x.length, fs, 1 + a, 0.2 * a), 1) },
  { id: "lofi", name: "Lo-fi hip hop", blurb: "Soft top, tape drive, slow wobble, room hiss.", apply: (x, fs, a) => mix(wow(lp(shape(x, 0.4 * a, 0.03), fs, 9000 - a * 3500), fs, 0.6 * a, 0.35), noise(x.length, 0.008 * a, "pink", fs), 1) },
  { id: "drift", name: "Detune drift", blurb: "Two slightly detuned copies beating against each other.", apply: (x, fs, a) => mix(gainOf(x, 0.6), wow(x, fs, 6 * a + 1, 0.11 + a * 0.2), 0.6) },
  { id: "backwards", name: "Backwards swell", blurb: "Reverse reverb pre-echo into each hit.", apply: (x, fs, a) => mix(x, reverseArr(simpleVerb(reverseArr(x), fs, 0.6 + a * 1.4, 0.8)), 0.9 * a) },
];

export function applyTransform(input: Channels, fs: number, id: string, amount: number, wet: number): Channels {
  const t = TRANSFORMS.find((tr) => tr.id === id) ?? TRANSFORMS[0];
  seed = 1234567; // same file + same knobs = same noise and crackle
  return input.map((x, c) => {
    const processed = t.apply(x, fs, Math.max(0, Math.min(1, amount)), c);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - wet) + processed[i] * wet;
    return y;
  });
}

// ── page ──
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
export function initLofi(): void {
  const input = $<HTMLInputElement>("lf-input"), drop = $("lf-drop"), grid = $("lf-grid"), status = $("lf-status");
  if (!input || !grid) return;
  let ctx: AudioContext | null = null, source: AudioBufferSourceNode | null = null;
  const audio = (): AudioContext => { ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); if (ctx.state === "suspended") void ctx.resume(); return ctx; };
  let original: Channels | null = null, rate = 44100, name = "", processed: Channels | null = null, current = TRANSFORMS[0].id;

  TRANSFORMS.forEach((t) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "lf-card" + (t.id === current ? " active" : ""); b.dataset.id = t.id;
    b.innerHTML = `<strong>${t.name}</strong><span>${t.blurb}</span>`;
    b.addEventListener("click", () => { current = t.id; grid.querySelectorAll(".lf-card").forEach((c) => c.classList.toggle("active", c === b)); process(); });
    grid.append(b);
  });
  const amount = $<HTMLInputElement>("lf-amount"), wet = $<HTMLInputElement>("lf-wet"), gainIn = $<HTMLInputElement>("lf-gain");
  const readouts = () => { $("lf-amount-out").textContent = `${Math.round(Number(amount.value) * 100)}%`; $("lf-wet-out").textContent = `${Math.round(Number(wet.value) * 100)}%`; $("lf-gain-out").textContent = `${Number(gainIn.value) >= 0 ? "+" : ""}${Number(gainIn.value).toFixed(1)} dB`; };
  let pending = 0;
  const process = (): void => {
    readouts();
    if (!original) return;
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      status.textContent = "Processing…";
      window.setTimeout(() => {
        const g = Math.pow(10, Number(gainIn.value) / 20);
        processed = applyTransform(original as Channels, rate, current, Number(amount.value), Number(wet.value)).map((x) => gainOf(x, g));
        const pk = peakOf(processed);
        if (pk > 1) processed = processed.map((x) => gainOf(x, 0.98 / pk));
        status.textContent = `${TRANSFORMS.find((t) => t.id === current)?.name} · ${name}${pk > 1 ? " · peak limited" : ""}`;
        $("lf-actions").hidden = false;
      }, 10);
    }, 120);
  };
  [amount, wet, gainIn].forEach((n) => n.addEventListener("input", process));
  const play = (ch: Channels) => { const a = audio(); source?.stop(); const buf = a.createBuffer(ch.length, ch[0].length, rate); ch.forEach((c, i) => buf.getChannelData(i).set(c)); source = a.createBufferSource(); source.buffer = buf; source.connect(a.destination); source.start(); };
  $("lf-play-dry").addEventListener("click", () => original && play(original));
  $("lf-play-wet").addEventListener("click", () => processed && play(processed));
  $("lf-stop").addEventListener("click", () => source?.stop());
  $("lf-download").addEventListener("click", async () => {
    if (!processed) return;
    const format = $<HTMLSelectElement>("lf-format").value, stem = name.replace(/\.[^.]+$/, "");
    const blob = format === "mp3" ? await encodeMp3Channels(processed, rate) : encodeWavChannels(processed, rate, 16);
    download(`${stem}-${current}.${format}`, URL.createObjectURL(blob));
  });
  async function load(file: File): Promise<void> {
    status.textContent = `Decoding ${file.name}…`;
    try {
      const buffer = await audio().decodeAudioData(await file.arrayBuffer());
      original = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => Float32Array.from(buffer.getChannelData(c)));
      rate = buffer.sampleRate; name = file.name;
      // peak is of the decoded audio — browsers resample on decode, so it can differ slightly from the file
      $("lf-file").textContent = `${file.name} · ${buffer.duration.toFixed(2)} s · ${buffer.numberOfChannels === 1 ? "mono" : "stereo"} · peak ${toDb(peakOf(original)).toFixed(2)} dBFS`;
      process();
    } catch (err) { status.textContent = `Could not decode (${(err as Error).message || "unsupported"})`; }
  }
  input.addEventListener("change", () => { const f = input.files?.[0]; if (f) void load(f); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) void load(f); });
  readouts();
}
