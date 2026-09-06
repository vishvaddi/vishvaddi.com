// Tiny Standard MIDI File reader for harness assertions: format, PPQ, tempo,
// and per-track name / note-on count / note-off count / channels used.
export function parseSmf(bytes) {
  const str = (o, n) => String.fromCharCode(...bytes.slice(o, o + n))
  if (bytes.length < 14 || str(0, 4) !== 'MThd') return { ok: false, tracks: [] }
  const u16 = (o) => (bytes[o] << 8) | bytes[o + 1]
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  const format = u16(8), ntrks = u16(10), ppq = u16(12)
  let pos = 14, bpm = null
  const tracks = []
  for (let t = 0; t < ntrks && pos + 8 <= bytes.length; t++) {
    if (str(pos, 4) !== 'MTrk') return { ok: false, tracks }
    const len = u32(pos + 4), end = pos + 8 + len
    let p = pos + 8, name = '', noteOns = 0, noteOffs = 0, status = 0, lastTick = 0, tick = 0
    const channels = []
    const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f) } while (b & 0x80); return v }
    while (p < end) {
      tick += vlq()
      const b = bytes[p]
      if (b === 0xff) { const type = bytes[p + 1]; p += 2; const l = vlq(); if (type === 0x03) name = String.fromCharCode(...bytes.slice(p, p + l)); if (type === 0x51) bpm = 60_000_000 / ((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]); p += l; continue }
      if (b === 0xf0 || b === 0xf7) { p++; p += vlq(); continue }
      if (b & 0x80) { status = b; p++ }
      const kind = status & 0xf0, ch = status & 0x0f
      if (kind === 0x90) { const vel = bytes[p + 1]; if (vel > 0) { noteOns++; channels.push(ch); lastTick = tick } else noteOffs++; p += 2 }
      else if (kind === 0x80) { noteOffs++; p += 2 }
      else if (kind === 0xc0 || kind === 0xd0) p += 1
      else p += 2
    }
    tracks.push({ name, noteOns, noteOffs, channels, lastNoteTick: lastTick })
    pos = end
  }
  return { ok: true, format, ppq, bpm, tracks }
}
