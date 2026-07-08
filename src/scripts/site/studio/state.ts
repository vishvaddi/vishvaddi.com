// VishAmp shared data model. All mutable project state lives here so the
// engine, persistence and UI modules can share it without circular imports.

import { initPatch } from "./vsynth";
import type { VPatch } from "./vsynth";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface DrumP {
  pitch: number;      // tone start Hz
  pitchEnd: number;   // tone end Hz
  decay: number;      // seconds
  filter: number;     // noise HPF/BPF Hz
  toneLevel: number;  // 0–1 tone layer mix (snare, rim)
  spread: number;     // clap stagger ms
}
export interface ParamSpec {
  key: keyof DrumP; label: string; min: number; max: number; step: number; unit?: string;
}
export interface SamplerP {
  name: string;
  tune: number;
  start: number;
  end: number;
  reverse: boolean;
  filter: number;
  attack: number;
  decay: number;
  choke: number;
  loop: boolean;
  warp: boolean;
  sourceBpm: number;
}
export interface PadEvent {
  pad: number;
  step: number;
  velocity: number;
  offset: number;
  probability: number;
  ratchets: number;
}
export interface MpcState {
  bank: number;
  selectedPad: number;
  fullLevel: boolean;
  sixteenLevels: boolean;
  levelMode: "velocity" | "pitch" | "filter" | "start";
  noteRepeat: boolean;
  repeatDivision: number;
  quantize: number;
  quantizeStrength: number;
  recording: boolean;
  overdub: boolean;
  padMute: boolean[];
  padSolo: boolean[];
}
export interface RackState {
  grooveTiming: number;
  grooveVelocity: number;
  grooveRandom: number;
  noteEcho: number;
  echoDecay: number;
  macros: number[];
  devices: Record<string, boolean>;
}
export interface VNote {
  note: string;   // e.g. "D#4"
  step: number;   // 0–15 start step
  len: number;    // steps, ≥1
  vel: number;    // 1–127
}
export interface HistoryState {
  pats: boolean[][][];
  vels: number[][][];
  synthNotes: VNote[][];
  padEvents: PadEvent[][];
  sampleParams: SamplerP[];
  sampleData: Array<string | null>;
  songChain: number[];
  arrangement: Record<TrackId, ArrangeBlock[]>;
  fx: FxState;
  rackState: RackState;
  vsynth: VPatch;
}
export interface FxState {
  low: number;
  mid: number;
  high: number;
  compThreshold: number;
  compRatio: number;
  limiter: number;
  reverb: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
export const STEPS = 16;
export const SCENES = 8;
export const SCENE_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const SONG_SLOTS = 8;
export const DRUMS = ["Kick", "Snare", "HH Cl", "HH Op", "Clap", "Tom", "Rim", "Crash"];
export const PAD_COUNT = 64;
export const PAD_BANK_SIZE = 16;
// Legacy 12-note grid rows (v5 and older projects) — kept for migration only.
export const PIANO_NOTES = ["B4", "A#4", "A4", "G#4", "G4", "F#4", "F4", "E4", "D#4", "D4", "C#4", "C4"];
// Piano-roll rows, top to bottom: B5 down to C3 (3 octaves).
export const ROLL_NOTES: string[] = (() => {
  const semis = ["B", "A#", "A", "G#", "G", "F#", "F", "E", "D#", "D", "C#", "C"];
  const rows: string[] = [];
  for (let oct = 5; oct >= 3; oct--) semis.forEach((s) => rows.push(`${s}${oct}`));
  return rows;
})();

// ─── Drum defaults & param specs ─────────────────────────────────────────────
export const DP_DEF: DrumP[] = [
  { pitch: 150, pitchEnd: 50,  decay: 0.50, filter: 0,    toneLevel: 0,   spread: 0  }, // Kick
  { pitch: 180, pitchEnd: 180, decay: 0.18, filter: 500,  toneLevel: 0.3, spread: 0  }, // Snare
  { pitch: 0,   pitchEnd: 0,   decay: 0.08, filter: 8000, toneLevel: 0,   spread: 0  }, // HH Cl
  { pitch: 0,   pitchEnd: 0,   decay: 0.30, filter: 5000, toneLevel: 0,   spread: 0  }, // HH Op
  { pitch: 0,   pitchEnd: 0,   decay: 0.06, filter: 1200, toneLevel: 0,   spread: 25 }, // Clap
  { pitch: 120, pitchEnd: 60,  decay: 0.40, filter: 0,    toneLevel: 0,   spread: 0  }, // Tom
  { pitch: 400, pitchEnd: 400, decay: 0.06, filter: 5000, toneLevel: 0.4, spread: 0  }, // Rim
  { pitch: 0,   pitchEnd: 0,   decay: 1.20, filter: 3000, toneLevel: 0,   spread: 0  }, // Crash
];
export const dp: DrumP[] = DP_DEF.map((d) => ({ ...d }));

export const DP_SPECS: ParamSpec[][] = [
  [{ key:"pitch",    label:"Punch",  min:40,   max:400,   step:5,    unit:"Hz" },
   { key:"pitchEnd", label:"Body",   min:20,   max:150,   step:5,    unit:"Hz" },
   { key:"decay",    label:"Decay",  min:0.1,  max:2.0,   step:0.05, unit:"s"  }],
  [{ key:"filter",    label:"Snap",   min:200,  max:5000,  step:50,   unit:"Hz" },
   { key:"decay",     label:"Decay",  min:0.05, max:0.5,   step:0.01, unit:"s"  },
   { key:"toneLevel", label:"Body",   min:0,    max:1,     step:0.05            }],
  [{ key:"filter", label:"Bite",  min:4000, max:18000, step:200,  unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.01, max:0.25,  step:0.005,unit:"s"  }],
  [{ key:"filter", label:"Bite",  min:2000, max:12000, step:200,  unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.1,  max:1.2,   step:0.02, unit:"s"  }],
  [{ key:"filter", label:"Crack",  min:500,  max:5000,  step:100,  unit:"Hz" },
   { key:"decay",  label:"Decay",  min:0.02, max:0.2,   step:0.005,unit:"s"  },
   { key:"spread", label:"Spread", min:0,    max:40,    step:2,    unit:"ms" }],
  [{ key:"pitch",    label:"High",  min:60,  max:400, step:5,    unit:"Hz" },
   { key:"pitchEnd", label:"Low",   min:30,  max:200, step:5,    unit:"Hz" },
   { key:"decay",    label:"Decay", min:0.1, max:1.5, step:0.05, unit:"s"  }],
  [{ key:"pitch",     label:"Tone",  min:200, max:800,  step:20,   unit:"Hz" },
   { key:"toneLevel", label:"Body",  min:0,   max:1,    step:0.05            },
   { key:"decay",     label:"Decay", min:0.02,max:0.15, step:0.005,unit:"s"  }],
  [{ key:"filter", label:"Tone",  min:1000, max:8000, step:100, unit:"Hz" },
   { key:"decay",  label:"Decay", min:0.3,  max:4.0,  step:0.1, unit:"s"  }],
];

// ─── Transport ───────────────────────────────────────────────────────────────
export const transport = {
  bpm: 120, swing: 0, metro: false, metroVolume: 1, songMode: false,
  // Snap/grid resolution shared by the drum, pad-event and piano-roll
  // editors — 4/8/16 subdivisions per 16-step bar (16 = every step, finest).
  quantizeGrid: 4,
};
export const stepDur = (): number => 60 / transport.bpm / 4;

// ─── Session clips ───────────────────────────────────────────────────────────
// Ableton-style: each track (drums grid / MPC pads / synth) plays its own clip,
// chosen from the 8 scenes. `play` null = track stopped. `queued` undefined =
// no change pending; a number or null applies at the next pattern boundary.
export type TrackId = "drums" | "pads" | "synth";
export const TRACKS: TrackId[] = ["drums", "pads", "synth"];
export const TRACK_LABELS: Record<TrackId, string> = { drums: "Drums", pads: "Pads", synth: "Synth" };
export const clip = {
  sel: 0,
  play: { drums: 0, pads: 0, synth: 0 } as Record<TrackId, number | null>,
  queued: { drums: undefined, pads: undefined, synth: undefined } as Record<TrackId, number | null | undefined>,
};

// ─── Arrangement ─────────────────────────────────────────────────────────────
// Each track gets its own ordered list of blocks (scene + bar-length), so
// e.g. drums can loop scene A for 4 bars while synth plays 1 bar of A then 3
// of C — real per-track independence, unlike the old shared songChain below.
export interface ArrangeBlock { scene: number; bars: number; }
export const arrangement: Record<TrackId, ArrangeBlock[]> = { drums: [], pads: [], synth: [] };
// Per-track playhead while transport.songMode drives the arrangement.
export const arrangePos: Record<TrackId, { block: number; barInBlock: number }> = {
  drums: { block: 0, barInBlock: 0 }, pads: { block: 0, barInBlock: 0 }, synth: { block: 0, barInBlock: 0 },
};

// ─── Pattern data ────────────────────────────────────────────────────────────
export const allPats: boolean[][][] = Array.from({ length: SCENES }, () => DRUMS.map(() => new Array(STEPS).fill(false)));
export const allVels: number[][][] = Array.from({ length: SCENES }, () => DRUMS.map(() => new Array(STEPS).fill(100)));
export const synthNotes: VNote[][] = Array.from({ length: SCENES }, () => []);
export const songChain = Array.from({ length: SONG_SLOTS }, (_, i) => i % 4);
export const padEvents: PadEvent[][] = Array.from({ length: SCENES }, () => []);

// ─── Sampler / MPC ───────────────────────────────────────────────────────────
export const sampleParams: SamplerP[] = Array.from({ length: PAD_COUNT }, (_, i) => ({
  name: i < DRUMS.length ? DRUMS[i] : "",
  tune: 0, start: 0, end: 1, reverse: false, filter: 18000,
  attack: 0, decay: 1, choke: i === 2 || i === 3 ? 1 : 0, loop: false, warp: false, sourceBpm: 170,
}));
export const sampleBuffers: Array<AudioBuffer | null> = Array.from({ length: PAD_COUNT }, () => null);
export const sampleData: Array<string | null> = Array.from({ length: PAD_COUNT }, () => null);

export const mpc: MpcState = {
  bank: 0, selectedPad: 0, fullLevel: false, sixteenLevels: false, levelMode: "velocity",
  noteRepeat: false, repeatDivision: 4, quantize: 4, quantizeStrength: 100,
  recording: false, overdub: true,
  padMute: Array.from({ length: PAD_COUNT }, () => false),
  padSolo: Array.from({ length: PAD_COUNT }, () => false),
};
export const rackState: RackState = {
  grooveTiming: 0, grooveVelocity: 0, grooveRandom: 0,
  noteEcho: 0, echoDecay: 0.65, macros: [0, 0, 0, 0],
  devices: { player: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true },
};
export const fx: FxState = {
  low: 0, mid: 0, high: 0,
  compThreshold: -18, compRatio: 3, limiter: -1,
  reverb: 0, delayTime: 0.25, delayFeedback: 0.25, delayMix: 0,
};

// ─── Synth ───────────────────────────────────────────────────────────────────
// The VV-1 wavetable synth patch (see vsynth.ts). One patch per project.
export const vsynthPatch: VPatch = initPatch();

// ─── Mixer ───────────────────────────────────────────────────────────────────
export const mute = new Array(8).fill(false);
export const solo = new Array(8).fill(false);
export function audible(r: number): boolean { const s = solo.some(Boolean); return !mute[r] && (!s || solo[r]); }
