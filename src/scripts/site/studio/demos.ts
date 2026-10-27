// Factory demo songs. Each is a full project: 32-step scenes with velocity,
// per-lane polymeter, pad events with probability/ratchets, three synth lanes
// with their own patches, drum-synth voicing, sends, master chain and an
// arrangement with automation. Written as data so they load through the same
// applyProject path as a user's own saved song.
import { SCENES, STEPS, DRUMS, DP_DEF } from "./state";
import type { ArrangeBlock, AutomationRamp, VNote, DrumP } from "./state";
import { PRESETS } from "./vsynth";
import type { VPatch } from "./vsynth";

type Grid = { pats: number[][][]; vels: number[][][] };
type Lanes = Record<string, VNote[][]>;

// Step strings: 32 characters, one per 1/16. X accent · x hit · - soft · o ghost · . rest
const VEL: Record<string, number> = { X: 122, x: 100, "-": 78, o: 52 };
function row(grid: Grid, scene: number, lane: number, steps: string): void {
  Array.from(steps.replace(/\s+/g, "")).forEach((ch, i) => {
    if (i >= STEPS || ch === ".") return;
    grid.pats[scene][lane][i] = 1; grid.vels[scene][lane][i] = VEL[ch] ?? 100;
  });
}
const emptyGrid = (): Grid => ({
  pats: Array.from({ length: SCENES }, () => Array.from({ length: 8 }, () => Array(STEPS).fill(0))),
  vels: Array.from({ length: SCENES }, () => Array.from({ length: 8 }, () => Array(STEPS).fill(96))),
});
const emptyLanes = (): Lanes => ({ bass: scenes(), lead: scenes(), harmony: scenes() });
const scenes = (): VNote[][] => Array.from({ length: SCENES }, () => []);
const n = (note: string, step: number, len = 1, vel = 96, accent = false, slide = false): VNote => ({ note, step, len, vel, accent, slide });
const chord = (notes: string[], step: number, len: number, vel = 80): VNote[] => notes.map((note) => n(note, step, len, vel));
let blockSeq = 0;
const block = (scene: number, startBar: number, bars: number, automation: AutomationRamp[] = []): ArrangeBlock => ({
  id: `factory-${Date.now().toString(36)}-${(blockSeq++).toString(36)}`, scene, bars, startBar, offset: 0, loop: true, automation,
});
const patch = (name: keyof typeof PRESETS, over: Partial<VPatch> = {}): VPatch => ({ ...JSON.parse(JSON.stringify(PRESETS[name])) as VPatch, ...over });
const drumKit = (over: Array<Partial<DrumP> | null>): DrumP[] => DP_DEF.map((d, i) => ({ ...d, ...(over[i] ?? {}) }));

export const DEMO_TITLES = ["USE YOUR HEART — INTERLUDE STUDY"] as const;
export type DemoTitle = (typeof DEMO_TITLES)[number];
export const DEMO_NOTES: Partial<Record<DemoTitle, { description: string; reference: string }>> = {
  'USE YOUR HEART — INTERLUDE STUDY': {
    description: '111.5 BPM · 44 bars · SWV reference study. Synthesised half-time drums, sub bass and extended electric-key chords. Editable approximation, not an exact transcription; no original recording or vocals included.',
    reference: 'https://www.youtube.com/watch?v=_RVCDKS5D4c',
  },
};

function heartInterlude(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes();
  // The detected pulse is about 111–112 BPM; the backbeat falls halfway through each bar.
  for (let scene = 0; scene < 7; scene++) {
    row(g, scene, 0, scene === 4 ? 'X............... X...............' : 'X...........x... X.........o.x...');
    if (scene !== 0 && scene !== 4) row(g, scene, 1, '........X....... ........X.......');
    if (scene !== 4) row(g, scene, 2, 'x.-.x.-.x.-.x.-. x.-.x.-.x.-.x.-.');
    row(g, scene, 6, '........o....... ........o.......');
    if ([2, 3, 5].includes(scene)) {
      row(g, scene, 2, 'x.-.x.-.x.-.x.-o x.-.x.-.x.-.x.oo');
      row(g, scene, 3, '..............o. ..............o.');
      row(g, scene, 1, '........X......o ........X.......');
    }
  }
  const harmonies = [
    ['G#3', 'C4', 'D#4', 'G4'], ['C#4', 'E4', 'G#4', 'B4'],
    ['F#3', 'A#3', 'C#4', 'E4'], ['B3', 'D#4', 'F#4', 'A#4'],
    ['D#3', 'G3', 'A#3', 'C#4'],
  ];
  const pairs = [[0, 1], [0, 1], [0, 1], [2, 3], [1, 4], [0, 1], [0, 1]];
  const roots = ['G#2', 'C#3', 'F#2', 'B2', 'D#3'];
  pairs.forEach(([first, second], scene) => {
    lanes.harmony[scene] = [...chord(harmonies[first], .1, 13.5, 75), ...chord(harmonies[second], 16.12, 14.5, 71)];
    if (scene !== 0) lanes.bass[scene] = [n(roots[first], 0, 10, 102), n(roots[first], 12, 2.5, 75), n(roots[second], 16, 12.5, 100), n(roots[second], 30, 1.5, 70)];
    if ([2, 3, 5].includes(scene)) lanes.lead[scene] = [n(harmonies[first][3], 6.2, 1.8, 53), n(harmonies[first][2], 11, 2.5, 49), n(harmonies[second][3], 22.2, 1.8, 51), n(harmonies[second][2], 27, 3, 47)];
  });
  const sequence: Array<[number, number, number]> = [[0, 0, 4], [1, 4, 8], [2, 12, 8], [4, 20, 4], [3, 24, 4], [5, 28, 12], [6, 40, 4]];
  return {
    ...state, title: 'USE YOUR HEART — INTERLUDE STUDY', bpm: 111.5,
    pats: g.pats, vels: g.vels, synthLaneNotes: lanes, padEvents: Array.from({ length: SCENES }, () => []),
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)), laneRates: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneVoices: DRUMS.map(() => 'auto'),
    laneSends: DRUMS.map((_, i) => ({ echo: i === 6 ? .12 : 0, space: i === 1 ? .16 : .04, pan: i === 2 ? .16 : i === 6 ? -.15 : 0 })),
    dp: drumKit([{ pitch: 105, pitchEnd: 45, decay: .23, drive: .12 }, { filter: 1700, decay: .12, toneLevel: .22, drive: .1 }, { filter: 7600, decay: .035 }, { filter: 6200, decay: .13 }, null, null, { pitch: 580, toneLevel: .38, decay: .035 }, null]),
    synthPatches: {
      bass: patch('Sub Bass', { volume: .7, glide: .035, filter: { type: 'lowpass', cutoff: 380, res: .3, env2: .05, track: .1 }, env1: { a: .006, d: .35, s: .8, r: .12 } }),
      harmony: patch('Keys', { volume: .44, osc1: { table: 'basic', pos: .08, octave: 0, semi: 0, level: .8, unison: 2, detune: 4 }, osc2: { table: 'basic', pos: 0, octave: 1, semi: 0, level: .12, unison: 1, detune: 0 }, filter: { type: 'lowpass', cutoff: 2200, res: .35, env2: .12, track: .3 }, env1: { a: .012, d: 1.2, s: .2, r: .5 }, lfo1: { shape: 'sine', rate: 3.2 }, matrix: [{ src: 'lfo1', dest: 'amp', amt: .08 }], drift: .025 }),
      lead: patch('Pluck', { volume: .16, filter: { type: 'lowpass', cutoff: 1800, res: .4, env2: .15, track: .2 }, env1: { a: .008, d: .4, s: .08, r: .4 } }),
    },
    fx: { low: 1.5, mid: -.7, high: -1.5, compThreshold: -17, compRatio: 2.5, limiter: -1, reverb: .16, delayTime: 60 / 111.5 * .75, delayFeedback: .22, delayMix: .055, drive: .06, echoDamp: 2300, echoWow: .1, spaceSize: 1.4 },
    rackState: { grooveTiming: .12, grooveVelocity: .06, grooveRandom: 0, noteEcho: 0, echoDecay: .6, glitch: 0, macros: [0, .16, 0, .12], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [.78, .65, .35, .3, .3, .3, .32, .2], synthLevel: .75, masterLevel: .8, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 1, clipPlay: { drums: 1, pads: 1, bass: 1, lead: 1, harmony: 1 }, songLoop: { on: false, startBar: 0, endBar: 44 },
    sections: [{ bar: 0, name: 'Intro' }, { bar: 4, name: 'Pocket' }, { bar: 12, name: 'Answer' }, { bar: 20, name: 'Break' }, { bar: 24, name: 'Turnaround' }, { bar: 28, name: 'Return' }, { bar: 40, name: 'Outro' }],
    arrangement: {
      drums: sequence.map(([s, at, bars]) => block(s, at, bars)), pads: [],
      bass: sequence.filter(([s]) => s !== 0).map(([s, at, bars]) => block(s, at, bars)),
      lead: sequence.filter(([s]) => [2, 3, 5].includes(s)).map(([s, at, bars]) => block(s, at, bars)),
      harmony: sequence.map(([s, at, bars]) => block(s, at, bars, s === 6 ? [{ lane: 'master', param: 'volume', from: .8, to: .08 }] : [])),
    },
  };
}

export function buildDemo(name: string, base: Record<string, unknown>): Record<string, unknown> | null {
  if (name === 'USE YOUR HEART — INTERLUDE STUDY') return heartInterlude(base);
  return null;
}
