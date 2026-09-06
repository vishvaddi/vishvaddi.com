// Minimal Standard MIDI File (type 1) writer shared by the studio export and
// the /audio tools. Tracks carry absolute ticks; the writer sorts and deltas.

export const PPQ = 480;
export interface MidiEvent { tick: number; bytes: number[]; order: number }
export interface MidiTrack { name: string; events: MidiEvent[] }

const vlq = (value: number): number[] => {
  let v = Math.max(0, Math.round(value));
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const text = (type: number, s: string): number[] => { const b = Array.from(new TextEncoder().encode(s)); return [0xff, type, ...vlq(b.length), ...b]; };

function trackBytes(track: MidiTrack): number[] {
  const events = [...track.events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [...vlq(0), ...text(0x03, track.name)];
  let last = 0;
  for (const e of events) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...body];
}

export function encodeMidi(tracks: MidiTrack[], bpm: number, title: string): Uint8Array {
  const usPerBeat = Math.round(60_000_000 / bpm);
  const conductor: MidiTrack = { name: title, events: [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (usPerBeat >>> 16) & 0xff, (usPerBeat >>> 8) & 0xff, usPerBeat & 0xff] },
    { tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ] };
  const all = [conductor, ...tracks];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (all.length >>> 8) & 0xff, all.length & 0xff, (PPQ >>> 8) & 0xff, PPQ & 0xff];
  return Uint8Array.from([...header, ...all.flatMap(trackBytes)]);
}

