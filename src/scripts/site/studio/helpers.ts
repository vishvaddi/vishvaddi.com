// Pure helpers — no shared studio state.
import { knob as knobCtor } from "./knob";

// ─── DOM ─────────────────────────────────────────────────────────────────────
export const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export function btn(label: string, extra = ""): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button";
  b.className = ("wa-btn " + extra).trim(); b.textContent = label; return b;
}
export function help(target: HTMLElement, text: string): HTMLElement {
  target.dataset.help = text;
  target.setAttribute("aria-description", text);
  return target;
}
// sliderRow keeps its original signature but renders a CV-80 rotary knob
// (knob.ts) since Phase 1 — every parameter row across the studio upgrades
// through this one function.
export function sliderRow(label: string, min: number, max: number, val: number, step: number, on: (v: number) => void): HTMLElement {
  return knobCtor(label, min, max, val, step, on).root;
}
export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Data URLs / files ───────────────────────────────────────────────────────
// Decode a data: URL straight to bytes. We must NOT fetch() data: URLs — the
// site CSP is `connect-src 'self'` (no data:), so fetch("data:…") is blocked and
// throws "could not decode audio". atob avoids the network entirely.
export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
  const binary = /;base64/i.test(meta) ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
export function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ─── Slicing / patterns ──────────────────────────────────────────────────────
export function equalSlices(count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => [i / count, (i + 1) / count]);
}
export function transientSlices(buffer: AudioBuffer, count = 16): Array<[number, number]> {
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
export function snapZero(buffer: AudioBuffer, position: number): number {
  const data = buffer.getChannelData(0), centre = Math.floor(position * data.length), radius = Math.min(1024, Math.floor(data.length / 100));
  let best = centre, bestValue = Math.abs(data[centre] ?? 0);
  for (let i = Math.max(1, centre - radius); i < Math.min(data.length - 1, centre + radius); i++) {
    const value = Math.abs(data[i]);
    if (value < bestValue || (data[i - 1] <= 0 && data[i] >= 0)) { best = i; bestValue = value; if (bestValue < 0.0001) break; }
  }
  return best / data.length;
}
export function euclideanPattern(steps: number, pulses: number, rotation: number): boolean[] {
  const pattern = Array.from({ length: steps }, (_, step) => ((step * pulses) % steps) < pulses);
  return pattern.map((_, i) => pattern[(i - rotation + steps) % steps]);
}
// Screen palette - cyan terminal (Studio v2 C1). Canvases cannot read CSS vars
// cheaply, so screens draw from these constants; keep in sync with --wa-phos*.
export const SCREEN_BG = "#050a0c";
export const SCREEN_FG = "#34e2ff";

/** Beat ruler row for the 16-step grids: 1 2 3 4 at the quarters, ticks
 *  between. Lives INSIDE the scrolling grid so it tracks horizontal scroll. */
export function stepRuler(): HTMLElement {
  const ruler = el("div", "wa-step-ruler");
  ruler.append(el("span", "wa-ruler-spacer"));
  for (let c = 0; c < 16; c++) {   // STEPS — kept literal so helpers stays dependency-free
    ruler.append(el("span", "wa-step-tick" + (c % 4 === 0 ? " major" : ""), c % 4 === 0 ? String(c / 4 + 1) : "·"));
  }
  return ruler;
}

export function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer, slices: Array<[number, number]>, selected = -1): void {
  const scale = window.devicePixelRatio || 1, width = canvas.clientWidth || 900, height = canvas.clientHeight || 220;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.scale(scale, scale); ctx.fillStyle = SCREEN_BG; ctx.fillRect(0, 0, width, height);
  if (selected >= 0 && slices[selected]) {
    const [start, end] = slices[selected];
    ctx.fillStyle = "rgba(52, 226, 255, 0.16)";
    ctx.fillRect(start * width, 0, (end - start) * width, height);
  }
  const data = buffer.getChannelData(0), stride = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = SCREEN_FG; ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let i = x * stride; i < Math.min(data.length, (x + 1) * stride); i++) peak = Math.max(peak, Math.abs(data[i]));
    const y = peak * height * 0.45;
    ctx.moveTo(x, height / 2 - y); ctx.lineTo(x, height / 2 + y);
  }
  ctx.stroke();
  ctx.strokeStyle = SCREEN_FG; ctx.fillStyle = SCREEN_FG; ctx.font = "10px monospace";
  slices.forEach(([start], i) => {
    const x = start * width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); ctx.fillText(String(i + 1), x + 3, 12);
  });
}

export function drawScope(canvas: HTMLCanvasElement, samples: Float32Array, color = SCREEN_FG): void {
  const scale = window.devicePixelRatio || 1, width = canvas.clientWidth || 200, height = canvas.clientHeight || 40;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.scale(scale, scale); ctx.fillStyle = SCREEN_BG; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * width, y = height / 2 - samples[i] * height * 0.45;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawEnvelopeShape(canvas: HTMLCanvasElement, points: Array<[number, number]>, color = SCREEN_FG): void {
  const scale = window.devicePixelRatio || 1, width = canvas.clientWidth || 200, height = canvas.clientHeight || 70;
  canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.scale(scale, scale); ctx.fillStyle = SCREEN_BG; ctx.fillRect(0, 0, width, height);
  const toPx = ([x, y]: [number, number]): [number, number] => [x * width, (1 - y) * (height - 6) + 3];
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  points.forEach((p, i) => { const [px, py] = toPx(p); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.fillStyle = color;
  points.slice(1).forEach((p) => { const [px, py] = toPx(p); ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill(); });
}

// ─── Encoders ────────────────────────────────────────────────────────────────
export function encodeWav(buf: AudioBuffer): Blob {
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
export function floatTo16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
  return out;
}
export async function encodeMp3(buf: AudioBuffer): Promise<Blob> {
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
