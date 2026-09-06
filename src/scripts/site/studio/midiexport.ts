// Standard MIDI File (type 1) export of the launched clips or the whole
// arrangement. Walks the same bar timeline as render.ts so a DAW import lines
// up with the WAV export: drums on channel 10 with a GM note map, pads on a
// second channel-10 track, one track per synth lane, automation ramps as CCs.
// Deterministic on purpose — pad probability, groove random and glitch are
// ignored; swing is kept because it is a fixed setting, not a dice roll.
import {
  ARRANGE_TRACKS, SYNTH_LANES, SYNTH_LANE_LABELS, DRUMS, clip, transport, song,
  allPats, allVels, synthLaneNotes, patternLengths, patternDivisions, laneLength, laneRate, padEvents, blockAt, songEndBar,
} from "./state";
import type { ArrangeTrackId } from "./state";
import { noteToMidi } from "./vsynth";
import { PPQ, encodeMidi } from "../audio/smf";
import type { MidiTrack } from "../audio/smf";

export { PPQ } from "../audio/smf";
// General MIDI percussion keys for the eight synth-drum lanes.
export const GM_DRUM_NOTES = [36, 38, 42, 46, 39, 45, 37, 49];
const PAD_BASE_NOTE = 36;
const CC_FOR: Record<string, number> = { cutoff: 74, volume: 7, reverb: 91 };

export interface MidiSummary { bars: number; notes: Record<string, number> }

/** Builds the SMF bytes for the current project. `mode` follows the render selector. */
export function buildMidi(mode: "pattern" | "song"): { bytes: Uint8Array; summary: MidiSummary } {
  const beat = PPQ;
  const bars = mode === "song" ? songEndBar() : 1;
  const sceneAt = (track: ArrangeTrackId, bar: number): number | null => mode === "song" ? blockAt(track, bar)?.scene ?? null : clip.play[track];
  const barTicks = Array.from({ length: bars }, (_, bar) => Math.max(beat * 4, ...ARRANGE_TRACKS.map((track) => {
    const scene = sceneAt(track, bar); return scene === null ? 0 : Math.round(patternLengths[scene] * beat / (patternDivisions[scene] || 4));
  })));
  const barStart: number[] = []; let total = 0;
  barTicks.forEach((t) => { barStart.push(total); total += t; });

  const drums: MidiTrack = { name: "Drum Rack", events: [] };
  const pads: MidiTrack = { name: "Pads", events: [] };
  const synths = new Map<string, MidiTrack>(SYNTH_LANES.map((lane) => [lane, { name: SYNTH_LANE_LABELS[lane] ?? lane, events: [] }]));
  const master: MidiTrack = { name: "Master automation", events: [] };
  const notes: Record<string, number> = { "Drum Rack": 0, Pads: 0 };
  SYNTH_LANES.forEach((lane) => { notes[SYNTH_LANE_LABELS[lane] ?? lane] = 0; });
  let order = 0;
  const note = (track: MidiTrack, channel: number, key: number, vel: number, start: number, length: number) => {
    const k = Math.max(0, Math.min(127, Math.round(key))), v = Math.max(1, Math.min(127, Math.round(vel)));
    const on = Math.max(0, Math.round(start)), off = Math.max(on + 1, Math.round(start + length));
    track.events.push({ tick: on, order: order++, bytes: [0x90 | channel, k, v] });
    track.events.push({ tick: off, order: -1, bytes: [0x80 | channel, k, 0] }); // note-offs sort before same-tick note-ons
    notes[track.name] = (notes[track.name] ?? 0) + 1;
  };
  const cc = (track: MidiTrack, channel: number, controller: number, value: number, tick: number) => {
    track.events.push({ tick: Math.round(tick), order: -2, bytes: [0xb0 | channel, controller, Math.max(0, Math.min(127, Math.round(value * 127)))] });
  };
  const synthChannel = (index: number): number => (index >= 9 ? index + 1 : index) % 16; // skip channel 10

  for (let bar = 0; bar < bars; bar++) {
    const drumScene = sceneAt("drums", bar), padScene = sceneAt("pads", bar);
    if (drumScene !== null) {
      const sd = beat / (patternDivisions[drumScene] || 4), barLen = patternLengths[drumScene] * sd;
      for (let r = 0; r < DRUMS.length; r++) {
        const len = laneLength(drumScene, r), rate = beat / laneRate(drumScene, r), hits = Math.ceil(barLen / rate - 1e-9);
        for (let k = 0; k < hits; k++) {
          const localStep = k % len;
          if (!allPats[drumScene][r][localStep]) continue;
          const when = barStart[bar] + k * rate + (k % 2 ? transport.swing * rate : 0);
          note(drums, 9, GM_DRUM_NOTES[r], allVels[drumScene][r][localStep], when, Math.min(rate, beat / 4));
        }
      }
    }
    if (padScene !== null) {
      const sd = beat / (patternDivisions[padScene] || 4);
      padEvents[padScene].filter((event) => event.step < patternLengths[padScene]).forEach((event) => {
        const base = barStart[bar] + event.step * sd + (Math.floor(event.step) % 2 ? transport.swing * sd : 0) + (event.offset / 1000) * (transport.bpm / 60) * beat;
        const ratchets = Math.max(1, event.ratchets), spacing = sd / ratchets;
        for (let i = 0; i < ratchets; i++) note(pads, 9, PAD_BASE_NOTE + event.pad, event.velocity, base + i * spacing, spacing * 0.9);
      });
    }
    SYNTH_LANES.forEach((lane, index) => {
      const scene = sceneAt(lane, bar); if (scene === null) return;
      const track = synths.get(lane)!, channel = synthChannel(index), sd = beat / (patternDivisions[scene] || 4);
      const laneNotes = synthLaneNotes[lane][scene].filter((n) => n.step < patternLengths[scene]).sort((a, b) => a.step - b.step);
      laneNotes.forEach((n, i) => {
        const start = barStart[bar] + n.step * sd;
        let length = n.len * sd - PPQ / 96;
        // slide = legato: overlap the next note so a glide-capable synth ties them
        if (n.slide && i + 1 < laneNotes.length) length = Math.max(length, (laneNotes[i + 1].step - n.step) * sd + PPQ / 48);
        note(track, channel, noteToMidi(n.note), n.accent ? n.vel * 1.22 : n.vel, start, length);
      });
      if (mode === "song") {
        const block = blockAt(lane, bar);
        (block?.automation ?? []).forEach((ramp) => {
          const controller = CC_FOR[ramp.param]; if (!controller) return;
          const target = ramp.lane === "master" ? master : synths.get(ramp.lane);
          if (!target || !block) return;
          const steps = 16;
          for (let s = 0; s < steps; s++) {
            const progress = Math.max(0, Math.min(1, (bar - block.startBar + s / steps) / block.bars));
            cc(target, ramp.lane === "master" ? 15 : channel, controller, ramp.from + (ramp.to - ramp.from) * progress, barStart[bar] + (s / steps) * barTicks[bar]);
          }
        });
      }
    });
  }
  const tracks = [drums, pads, ...synths.values(), master].filter((t) => t.events.length);
  return { bytes: encodeMidi(tracks, transport.bpm, song.title || "VishAmp"), summary: { bars, notes } };
}
