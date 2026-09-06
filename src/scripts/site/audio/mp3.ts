// lamejs 1.2.1 is broken under ES-module bundling (its Lame/BitStream files
// reach for an MPEGMode global that only exists when the concatenated build
// runs as a classic script), so the encoder is loaded from /public as a
// same-origin <script> — allowed by the CSP's script-src 'self' — on demand.
export interface Mp3Encoder { encodeBuffer(l: Int16Array, r?: Int16Array): Uint8Array; flush(): Uint8Array }
type Ctor = new (channels: number, sampleRate: number, kbps: number) => Mp3Encoder;

let pending: Promise<Ctor> | null = null;
export function loadMp3Encoder(): Promise<Ctor> {
  pending ??= new Promise<Ctor>((resolve, reject) => {
    const existing = (window as unknown as { lamejs?: { Mp3Encoder?: Ctor } }).lamejs?.Mp3Encoder;
    if (existing) { resolve(existing); return; }
    const script = document.createElement("script");
    script.src = "/scripts/lame.min.js";
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { lamejs?: { Mp3Encoder?: Ctor } }).lamejs?.Mp3Encoder;
      if (ctor) resolve(ctor); else reject(new Error("lamejs loaded without Mp3Encoder"));
    };
    script.onerror = () => { pending = null; reject(new Error("could not load the MP3 encoder")); };
    document.head.append(script);
  });
  return pending;
}

const floatTo16 = (x: Float32Array): Int16Array => { const y = new Int16Array(x.length); for (let i = 0; i < x.length; i++) { const s = Math.max(-1, Math.min(1, x[i])); y[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return y; };

/** Encodes plain channels to MP3 at `kbps`. Mono input makes a mono file. */
export async function encodeMp3(channels: Float32Array[], rate: number, kbps = 192): Promise<Blob> {
  const Enc = await loadMp3Encoder();
  const stereo = channels.length > 1;
  const enc = new Enc(stereo ? 2 : 1, rate, kbps);
  const l = floatTo16(channels[0]), r = stereo ? floatTo16(channels[1]) : null;
  const block = 1152, data: Uint8Array[] = [];
  for (let i = 0; i < l.length; i += block) {
    const mp3 = r ? enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block)) : enc.encodeBuffer(l.subarray(i, i + block));
    if (mp3.length) data.push(new Uint8Array(mp3));
  }
  const end = enc.flush(); if (end.length) data.push(new Uint8Array(end));
  return new Blob(data as BlobPart[], { type: "audio/mpeg" });
}
