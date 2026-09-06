// WAV encoding for plain channel arrays: 16-bit and 24-bit PCM, or 32-bit float.
export type WavDepth = 16 | 24 | 32;

export function encodeWavChannels(channels: Float32Array[], rate: number, depth: WavDepth = 16): Blob {
  const ch = channels.length, n = channels[0]?.length ?? 0, bytes = depth / 8, dataLen = n * ch * bytes;
  const out = new ArrayBuffer(44 + dataLen), dv = new DataView(out); let p = 0;
  const str = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  str("RIFF"); u32(36 + dataLen); str("WAVE"); str("fmt "); u32(16); u16(depth === 32 ? 3 : 1); u16(ch); u32(rate); u32(rate * ch * bytes); u16(ch * bytes); u16(depth); str("data"); u32(dataLen);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    if (depth === 16) { dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2; }
    else if (depth === 24) { const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); dv.setUint8(p++, v & 0xff); dv.setUint8(p++, (v >> 8) & 0xff); dv.setUint8(p++, (v >> 16) & 0xff); }
    else { dv.setFloat32(p, s, true); p += 4; }
  }
  return new Blob([out], { type: "audio/wav" });
}

export { encodeMp3 as encodeMp3Channels } from "./mp3";
