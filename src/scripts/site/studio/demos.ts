// Factory demo songs. Each is a full project: 32-step scenes with velocity,
// per-lane polymeter, pad events with probability/ratchets, three synth lanes
// with their own patches, drum-synth voicing, sends, master chain and an
// arrangement with automation. Written as data so they load through the same
// applyProject path as a user's own saved song.
import { SCENES, STEPS, DRUMS, DP_DEF } from "./state";
import type { ArrangeBlock, AutomationRamp, PadEvent, VNote, DrumP } from "./state";
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
const ev = (pad: number, step: number, velocity = 90, extra: Partial<PadEvent> = {}): PadEvent => ({ pad, step, velocity, offset: 0, probability: 100, ratchets: 1, ...extra });
let blockSeq = 0;
const block = (scene: number, startBar: number, bars: number, automation: AutomationRamp[] = []): ArrangeBlock => ({
  id: `factory-${Date.now().toString(36)}-${(blockSeq++).toString(36)}`, scene, bars, startBar, offset: 0, loop: true, automation,
});
const patch = (name: keyof typeof PRESETS, over: Partial<VPatch> = {}): VPatch => ({ ...JSON.parse(JSON.stringify(PRESETS[name])) as VPatch, ...over });
const drumKit = (over: Array<Partial<DrumP> | null>): DrumP[] => DP_DEF.map((d, i) => ({ ...d, ...(over[i] ?? {}) }));

export const DEMO_TITLES = ["BLOCK PARTY", "HAZARD LINES", "MIDNIGHT ACID"] as const;
export type DemoTitle = (typeof DEMO_TITLES)[number];

/** Boom-bap hip hop, 90 BPM, A minor. Seven scenes, 28-bar arrangement. */
function blockParty(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes(), pads: PadEvent[][] = Array.from({ length: SCENES }, () => []);
  const [K, S, HC, HO, CL, T, R, CR] = [0, 1, 2, 3, 4, 5, 6, 7];
  // A — intro: rim + hats, no kick
  row(g, 0, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 0, R,  "....x.......x... ....x.......x..o");
  row(g, 0, HO, "..........x..... ..........x.....");
  // B — verse: boom bap
  row(g, 1, K,  "X..o..x...X..o.. X..o..x.o.X.....");
  row(g, 1, S,  "....X.......X... ....X.......X..o");
  row(g, 1, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 1, HO, "..........x..... ..........x...x.");
  row(g, 1, R,  "...........o.... .......o........");
  // C — verse 2: kick answers, clap doubles the snare, rim chatter
  row(g, 2, K,  "X..o..x.o.X..o.. X..o..x...X.o...");
  row(g, 2, S,  "....X.......X... ....X.......X.o.");
  row(g, 2, CL, "....-.......-... ....-.......-...");
  row(g, 2, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 2, HO, "..........x..... ..............x.");
  row(g, 2, R,  "..o.....o...o.o. ..o.....o.o.....");
  // D — chorus: crash on the one, tom pickup, dense hats
  row(g, 3, K,  "X..o..x...X..o.. X..o..x.o.X..oo.");
  row(g, 3, S,  "....X.......X... ....X.......X.oo");
  row(g, 3, CL, "....x.......x... ....x.......x...");
  row(g, 3, HC, "x-xox-xox-xox-xo x-xox-xox-xox-xo");
  row(g, 3, HO, "..........x..... ..........x...x.");
  row(g, 3, T,  "................ ............o.x.");
  row(g, 3, CR, "X............... ................");
  // E — breakdown: kick only on the one, rim + hats
  row(g, 4, K,  "X............... X...............");
  row(g, 4, HC, "x...x...x...x... x...x...x...x...");
  row(g, 4, R,  "....x.......x... ....x.......x...");
  // F — chorus 2 with a tom fill closing the bar
  row(g, 5, K,  "X..o..x...X..o.. X..o..x.o.X.....");
  row(g, 5, S,  "....X.......X... ....X.......X...");
  row(g, 5, CL, "....x.......x... ....x.......x...");
  row(g, 5, HC, "x-xox-xox-xox-xo x-xox-xox-xox-xo");
  row(g, 5, HO, "..........x..... ..........x.....");
  row(g, 5, T,  "................ ..........x.xxXX");
  row(g, 5, CR, "X............... ................");
  // G — outro: thinning
  row(g, 6, K,  "X.........X..... X...............");
  row(g, 6, S,  "....X.......X... ....X...........");
  row(g, 6, HC, "x.x.x.x.x.x.x.x. x.x.x.x.........");
  row(g, 6, R,  "................ ............x...");
  // pad layer: ratcheted claps and probabilistic rims ride the drum voices
  pads[2] = [ev(4, 12, 70, { ratchets: 2, probability: 65 }), ev(4, 28, 74, { ratchets: 3, probability: 55 }), ev(6, 7, 48, { probability: 40 }), ev(6, 23, 48, { probability: 40 })];
  pads[3] = [ev(4, 12, 74, { ratchets: 2 }), ev(4, 28, 78, { ratchets: 3, probability: 70 }), ev(2, 30, 60, { ratchets: 2, probability: 50 })];
  pads[5] = [ev(4, 12, 74, { ratchets: 2 }), ev(4, 28, 78, { ratchets: 4 }), ev(5, 29, 90, { ratchets: 2 })];

  // A minor: Am7 · Dm7 · Em7 · Am — bass walks, keys stab off the beat, lead sings in the chorus
  const bassVerse = [n("A3", 0, 1.5, 110, true), n("A3", 3, 0.75, 84), n("C4", 6, 1, 88), n("A3", 8, 1.5, 106, true), n("G3", 12, 1, 90), n("E3", 14, 1.5, 96, false, true),
    n("D3", 16, 1.5, 110, true), n("D3", 19, 0.75, 84), n("F3", 22, 1, 88), n("E3", 24, 1.5, 106, true), n("E3", 27, 0.5, 80), n("G3", 28, 1, 92), n("A3", 30, 2, 100, false, true)];
  lanes.bass[1] = bassVerse; lanes.bass[2] = bassVerse; lanes.bass[5] = bassVerse;
  lanes.bass[3] = [...bassVerse, n("A3", 31, 0.5, 90)];
  lanes.bass[4] = [n("A3", 0, 8, 100, true), n("D3", 16, 8, 100, true)];
  lanes.bass[6] = [n("A3", 0, 6, 100, true), n("E3", 16, 6, 90), n("A3", 28, 4, 96, false, true)];
  const keysA = chord(["A3", "C4", "E4", "G4"], 2, 1.5, 76), keysA2 = chord(["A3", "C4", "E4", "G4"], 10, 0.75, 70);
  const keysD = chord(["D4", "F4", "A4", "C5"], 18, 1.5, 76), keysE = chord(["E4", "G4", "B4", "D5"], 26, 1, 74);
  lanes.harmony[0] = [...chord(["A3", "C4", "E4", "G4"], 0, 16, 60), ...chord(["D4", "F4", "A4", "C5"], 16, 16, 58)];
  lanes.harmony[1] = [...keysA, ...keysA2, ...keysD, ...keysE];
  lanes.harmony[2] = [...keysA, ...keysA2, ...keysD, ...keysE, ...chord(["E4", "G4", "B4"], 30, 1, 66)];
  lanes.harmony[3] = [...keysA, ...keysA2, ...keysD, ...keysE];
  lanes.harmony[4] = [...chord(["A3", "C4", "E4", "G4"], 0, 16, 64), ...chord(["D4", "F4", "A4", "C5"], 16, 16, 64)];
  lanes.harmony[5] = [...keysA, ...keysA2, ...keysD, ...keysE];
  lanes.harmony[6] = [...chord(["A3", "C4", "E4"], 0, 32, 56)];
  const hook = [n("E5", 0, 1, 96), n("G5", 2, 1, 90), n("A5", 3, 2.5, 104, true), n("G5", 7, 1, 88), n("E5", 8, 1.5, 92), n("D5", 10, 1, 84), n("C5", 12, 3, 96),
    n("D5", 16, 1, 90), n("F5", 18, 1, 90), n("E5", 19, 2.5, 100, true), n("D5", 23, 1, 86), n("C5", 24, 1.5, 92), n("B4", 26, 1, 84), n("A4", 28, 4, 100, false, true)];
  lanes.lead[3] = hook; lanes.lead[5] = hook;
  lanes.lead[2] = [n("E5", 14, 1, 70), n("G5", 15, 1, 74), n("A5", 30, 1, 70), n("G5", 31, 1, 74)];

  return {
    ...state, title: "BLOCK PARTY", bpm: 90,
    pats: g.pats, vels: g.vels, padEvents: pads, synthLaneNotes: lanes,
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneRates: Array.from({ length: SCENES }, (_, s) => DRUMS.map((_, r) => (s === 3 || s === 5) && r === 6 ? 3 : 0)),
    laneVoices: DRUMS.map(() => "auto"),
    laneSends: [{ echo: 0, space: 0.05, pan: 0 }, { echo: 0.08, space: 0.3, pan: 0 }, { echo: 0, space: 0.08, pan: 0.2 }, { echo: 0, space: 0.16, pan: 0.25 }, { echo: 0.1, space: 0.28, pan: -0.15 }, { echo: 0, space: 0.2, pan: -0.3 }, { echo: 0.32, space: 0.12, pan: 0.35 }, { echo: 0, space: 0.4, pan: 0 }],
    dp: drumKit([{ pitch: 120, pitchEnd: 46, decay: 0.42, drive: 0.32 }, { filter: 1400, decay: 0.22, toneLevel: 0.5, drive: 0.28 }, { filter: 9000, decay: 0.045 }, { filter: 5500, decay: 0.34 }, { filter: 1600, decay: 0.09, spread: 22 }, { pitch: 140, pitchEnd: 70, decay: 0.36 }, { pitch: 520, toneLevel: 0.5, decay: 0.05 }, { filter: 2600, decay: 1.6 }]),
    synthPatches: {
      bass: patch("Sub Bass", { volume: 0.85, glide: 0.06 }),
      lead: patch("Keys", { volume: 0.6, glide: 0.04, vibrato: 0.25, filter: { type: "lowpass", cutoff: 4200, res: 0.6, env2: 0.3, track: 0.5 } }),
      harmony: patch("Keys", { volume: 0.55, filter: { type: "lowpass", cutoff: 2800, res: 0.5, env2: 0.2, track: 0.4 }, env1: { a: 0.004, d: 0.45, s: 0.35, r: 0.3 } }),
    },
    fx: { low: 2, mid: -1, high: 1, compThreshold: -16, compRatio: 3.5, limiter: -1, reverb: 0.16, delayTime: 0.333, delayFeedback: 0.3, delayMix: 0.1, drive: 0.18, echoDamp: 2000, echoWow: 0.3, spaceSize: 1.8 },
    rackState: { grooveTiming: 0.34, grooveVelocity: 0.12, grooveRandom: 4, noteEcho: 0, echoDecay: 0.6, glitch: 0, macros: [0.2, 0.15, 0.6, 0], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [0.92, 0.82, 0.6, 0.55, 0.62, 0.7, 0.55, 0.6], synthLevel: 0.78, masterLevel: 0.85, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 1, clipPlay: { drums: 1, pads: 1, bass: 1, lead: 1, harmony: 1 },
    songLoop: { on: false, startBar: 0, endBar: 28 },
    arrangement: {
      drums: [block(0, 0, 4), block(1, 4, 4), block(2, 8, 4), block(3, 12, 4), block(4, 16, 4), block(5, 20, 4), block(6, 24, 4)],
      pads: [block(2, 8, 4), block(3, 12, 4), block(5, 20, 4)],
      bass: [block(1, 4, 4), block(2, 8, 4), block(3, 12, 4), block(4, 16, 4, [{ lane: "bass", param: "cutoff", from: 0.15, to: 0.85 }]), block(5, 20, 4), block(6, 24, 4)],
      lead: [block(2, 8, 4), block(3, 12, 4), block(5, 20, 4, [{ lane: "lead", param: "reverb", from: 0.1, to: 0.45 }])],
      harmony: [block(0, 0, 4, [{ lane: "master", param: "volume", from: 0.55, to: 0.85 }]), block(1, 4, 4), block(2, 8, 4), block(3, 12, 4), block(4, 16, 4, [{ lane: "harmony", param: "cutoff", from: 0.2, to: 0.7 }]), block(5, 20, 4), block(6, 24, 4, [{ lane: "master", param: "volume", from: 0.85, to: 0.3 }])],
    },
  };
}

/** Jungle, 172 BPM, D minor. Chopped-break drums, Reese bass with slides, hoover stabs, eight scenes, 40 bars. */
function hazardLines(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes(), pads: PadEvent[][] = Array.from({ length: SCENES }, () => []);
  const [K, S, HC, HO, CL, T, R, CR] = [0, 1, 2, 3, 4, 5, 6, 7];
  // A — intro: pad + filtered hats, sparse kick
  row(g, 0, HC, "x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x.");
  row(g, 0, K,  "X............... ..........X.....");
  row(g, 0, R,  "......o.......o. ......o.......o.");
  // B — build: break comes in without the kick, snare rolls into the drop
  row(g, 1, S,  "....X......X.... ....X......X.ooo");
  row(g, 1, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 1, HO, "..x.......x..... ..x.......x.....");
  row(g, 1, R,  "..o...o.....o... ..o...o.....o.oo");
  row(g, 1, CL, "................ ............XXXX");
  // C — drop 1: amen-style two-bar phrase
  row(g, 2, K,  "X.........X..... X.....x...X.....");
  row(g, 2, S,  "....X..o...X.... ....X..o...X..o.");
  row(g, 2, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 2, HO, "..x.......x..... ..x.......x...x.");
  row(g, 2, R,  "..o...o..o..o... ..o...o..o..o.o.");
  row(g, 2, T,  "................ ...............o");
  row(g, 2, CR, "X............... ................");
  // D — drop 2: displaced kicks, ghost snares, triplet rim
  row(g, 3, K,  "X.........X..x.. X.....x...X.....");
  row(g, 3, S,  "....X..o...X..o. ....X.o....X.o..");
  row(g, 3, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 3, HO, "..x.......x..... ..x.......x.....");
  row(g, 3, R,  "o.o.o.o.o.o.o.o. o.o.o.o.o.o.o.o.");
  row(g, 3, CL, "...........x.... ...........x....");
  // E — switch: half-time feel, kick on 1 and 3, big snare
  row(g, 4, K,  "X.......X....... X.......X..x....");
  row(g, 4, S,  "........X....... ........X.......");
  row(g, 4, HC, "x...x...x...x... x...x...x...x...");
  row(g, 4, HO, "......x.......x. ......x.......x.");
  row(g, 4, CR, "X............... ................");
  // F — breakdown: no drums except a distant rim, pad and sub carry it
  row(g, 5, R,  "......o......... ......o.........");
  row(g, 5, HC, "................ ........x.x.x.x.");
  // G — drop 3: full break, glitch lane ghosts, tom rolls
  row(g, 6, K,  "X.........X..x.. X.....x...X.....");
  row(g, 6, S,  "....X..o...X.... ....X..o...X.oXX");
  row(g, 6, HC, "x-x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-");
  row(g, 6, HO, "..x.......x..... ..x.......x...x.");
  row(g, 6, R,  "..o...o..o..o... ..o...o..o..o.o.");
  row(g, 6, T,  "................ ............o.x.");
  row(g, 6, CR, "X............... .........X......");
  // H — outro: break thins to hats, last kick
  row(g, 7, K,  "X............... X...............");
  row(g, 7, S,  "....X......X.... ....X...........");
  row(g, 7, HC, "x-x-x-x-x-x-x-x- x.x.x.x.x.......");
  row(g, 7, R,  "..o...o......... ................");
  // pads: ratcheted snare rolls and clap stabs over the break
  pads[1] = [ev(1, 28, 84, { ratchets: 2 }), ev(1, 29, 90, { ratchets: 3 }), ev(1, 30, 100, { ratchets: 4 }), ev(1, 31, 110, { ratchets: 4 })];
  pads[2] = [ev(1, 15, 70, { ratchets: 2, probability: 45 }), ev(1, 31, 80, { ratchets: 3, probability: 60 }), ev(4, 11, 60, { probability: 35 })];
  pads[3] = [ev(1, 15, 76, { ratchets: 3, probability: 60 }), ev(1, 31, 84, { ratchets: 4 }), ev(2, 27, 66, { ratchets: 2, probability: 50 })];
  pads[6] = [ev(1, 15, 76, { ratchets: 3 }), ev(1, 23, 70, { ratchets: 2, probability: 55 }), ev(1, 31, 90, { ratchets: 4 }), ev(5, 30, 96, { ratchets: 2 })];

  // D minor: Dm · Bb · F · C — reese holds and slides, hoover stabs answer, pad drones
  const reese = [n("D3", 0, 5.5, 118, true), n("D3", 6, 1.5, 96, false, true), n("F3", 8, 3, 104), n("D3", 12, 3.5, 100, false, true),
    n("A#3", 16, 5.5, 116, true), n("A#3", 22, 1.5, 96, false, true), n("C4", 24, 3, 100), n("A3", 28, 4, 108, false, true)];
  const reeseB = [n("F3", 0, 5.5, 118, true), n("F3", 6, 1.5, 96, false, true), n("A3", 8, 3, 104), n("F3", 12, 3.5, 100, false, true),
    n("C4", 16, 5.5, 116, true), n("C4", 22, 1.5, 96, false, true), n("D4", 24, 2, 100), n("A3", 26, 6, 110, false, true)];
  lanes.bass[2] = reese; lanes.bass[3] = reeseB; lanes.bass[6] = reese; lanes.bass[4] = [n("D3", 0, 16, 118, true), n("A#3", 16, 16, 112, true)];
  lanes.bass[5] = [n("D3", 0, 32, 100, true)]; lanes.bass[7] = [n("D3", 0, 12, 110, true), n("D3", 16, 8, 90, false, true)];
  const stabs = [...chord(["D4", "F4", "A4"], 3, 0.75, 104), ...chord(["D4", "F4", "A4"], 11, 0.5, 92), ...chord(["A#3", "D4", "F4"], 19, 0.75, 104), ...chord(["C4", "E4", "G4"], 27, 1, 100)];
  lanes.lead[2] = stabs; lanes.lead[3] = [...stabs, ...chord(["F4", "A4", "C5"], 30, 0.5, 90)]; lanes.lead[6] = stabs;
  lanes.lead[1] = [n("D5", 24, 1, 80), n("F5", 26, 1, 84), n("A5", 28, 4, 96, true)];
  lanes.lead[4] = [...chord(["D4", "F4", "A4"], 0, 4, 110), ...chord(["A#3", "D4", "F4"], 16, 4, 106)];
  const drone = [...chord(["D4", "F4", "A4"], 0, 16, 62), ...chord(["A#3", "D4", "F4"], 16, 16, 60)];
  lanes.harmony[0] = drone; lanes.harmony[1] = drone; lanes.harmony[4] = drone; lanes.harmony[5] = [...chord(["D4", "F4", "A4", "C5"], 0, 32, 66)]; lanes.harmony[7] = drone;
  lanes.harmony[2] = [...chord(["D5", "A5"], 0, 8, 54), ...chord(["A#4", "F5"], 16, 8, 52)];
  lanes.harmony[6] = [...chord(["D5", "A5"], 0, 8, 54), ...chord(["A#4", "F5"], 16, 8, 52)];

  return {
    ...state, title: "HAZARD LINES", bpm: 172,
    pats: g.pats, vels: g.vels, padEvents: pads, synthLaneNotes: lanes,
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, (_, s) => DRUMS.map((_, r) => s === 3 && r === 6 ? 12 : 0)),
    laneRates: Array.from({ length: SCENES }, (_, s) => DRUMS.map((_, r) => (s === 3 && r === 6) ? 6 : (s === 6 && r === 2) ? 12 : 0)),
    laneVoices: DRUMS.map((_, r) => r === 7 ? "glitch" : "auto"),
    laneSends: [{ echo: 0, space: 0.04, pan: 0 }, { echo: 0.06, space: 0.18, pan: 0 }, { echo: 0.12, space: 0.06, pan: 0.3 }, { echo: 0.1, space: 0.14, pan: 0.35 }, { echo: 0.2, space: 0.22, pan: -0.2 }, { echo: 0.14, space: 0.18, pan: -0.35 }, { echo: 0.42, space: 0.1, pan: 0.4 }, { echo: 0.25, space: 0.3, pan: 0 }],
    dp: drumKit([{ pitch: 165, pitchEnd: 56, decay: 0.26, drive: 0.5 }, { filter: 2600, decay: 0.15, toneLevel: 0.35, drive: 0.55 }, { filter: 11000, decay: 0.035 }, { filter: 7000, decay: 0.22 }, { filter: 2400, decay: 0.07, spread: 14 }, { pitch: 170, pitchEnd: 60, decay: 0.3 }, { pitch: 640, toneLevel: 0.4, decay: 0.04 }, { filter: 4000, decay: 1.1 }]),
    synthPatches: {
      bass: patch("Reese", { volume: 0.82, glide: 0.09, matrix: [{ src: "lfo2", dest: "pos1", amt: 0.35 }, { src: "lfo1", dest: "cutoff", amt: 0.18 }], lfo1: { shape: "triangle", rate: 2.87 } }),
      lead: patch("Hoover", { volume: 0.5, glide: 0.03, env1: { a: 0.005, d: 0.35, s: 0.55, r: 0.25 } }),
      harmony: patch("Pad", { volume: 0.42, filter: { type: "lowpass", cutoff: 2200, res: 0.7, env2: 0.1, track: 0.3 } }),
    },
    fx: { low: 1.5, mid: -2, high: 2.5, compThreshold: -20, compRatio: 4.5, limiter: -0.8, reverb: 0.24, delayTime: 0.1744, delayFeedback: 0.42, delayMix: 0.16, drive: 0.3, echoDamp: 2600, echoWow: 0.35, spaceSize: 2.6 },
    rackState: { grooveTiming: 0.04, grooveVelocity: 0.08, grooveRandom: 3, noteEcho: 0, echoDecay: 0.55, glitch: 24, macros: [0.35, 0.3, 0.7, 0.2], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [0.95, 0.88, 0.5, 0.48, 0.6, 0.66, 0.5, 0.55], synthLevel: 0.8, masterLevel: 0.85, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 2, clipPlay: { drums: 2, pads: 2, bass: 2, lead: 2, harmony: 2 },
    songLoop: { on: false, startBar: 0, endBar: 40 },
    arrangement: {
      drums: [block(0, 0, 4), block(1, 4, 4), block(2, 8, 8), block(3, 16, 4), block(4, 20, 4), block(5, 24, 4), block(1, 28, 2), block(6, 30, 6), block(7, 36, 4)],
      pads: [block(1, 4, 4), block(2, 8, 8), block(3, 16, 4), block(1, 28, 2), block(6, 30, 6)],
      bass: [block(2, 8, 8), block(3, 16, 4), block(4, 20, 4, [{ lane: "bass", param: "cutoff", from: 0.9, to: 0.35 }]), block(5, 24, 4, [{ lane: "bass", param: "cutoff", from: 0.2, to: 0.8 }]), block(6, 30, 6), block(7, 36, 4, [{ lane: "bass", param: "cutoff", from: 0.8, to: 0.1 }])],
      lead: [block(1, 4, 4), block(2, 8, 8), block(3, 16, 4), block(4, 20, 4, [{ lane: "lead", param: "reverb", from: 0.2, to: 0.6 }]), block(6, 30, 6)],
      harmony: [block(0, 0, 4, [{ lane: "harmony", param: "cutoff", from: 0.1, to: 0.6 }, { lane: "master", param: "volume", from: 0.5, to: 0.85 }]), block(1, 4, 4, [{ lane: "harmony", param: "cutoff", from: 0.6, to: 1 }]), block(2, 8, 8), block(6, 16, 4), block(4, 20, 4), block(5, 24, 4, [{ lane: "harmony", param: "reverb", from: 0.3, to: 0.7 }]), block(1, 28, 2), block(6, 30, 6), block(7, 36, 4, [{ lane: "master", param: "volume", from: 0.85, to: 0.2 }])],
    },
  };
}

export function buildDemo(name: string, base: Record<string, unknown>): Record<string, unknown> | null {
  if (name === "BLOCK PARTY") return blockParty(base);
  if (name === "HAZARD LINES") return hazardLines(base);
  return null;
}
