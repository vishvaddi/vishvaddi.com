// Factory demo songs. Each is a full project: 32-step scenes with velocity,
// per-lane polymeter, pad events with probability/ratchets, three synth lanes
// with their own patches, drum-synth voicing, sends, master chain and an
// arrangement with automation. Written as data so they load through the same
// applyProject path as a user's own saved song.
import { SCENES, STEPS, DRUMS, DP_DEF } from "./state";
import type { ArrangeBlock, AutomationRamp, PadEvent, VNote, DrumP } from "./state";
import { PRESETS, initPatch } from "./vsynth";
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

export const DEMO_TITLES = ["WESTSIDE", "FLIGHT PATH", "SODIUM LIGHT"] as const;
export type DemoTitle = (typeof DEMO_TITLES)[number];

/** G-funk, 92 BPM, G minor. Long 808 kick, clap on every snare, straight hats,
 *  sub bass on the chord roots, a portamento whistle lead. Seven scenes, 32 bars. */
function westside(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes(), pads: PadEvent[][] = Array.from({ length: SCENES }, () => []);
  const [K, S, HC, HO, CL, T, R, CR] = [0, 1, 2, 3, 4, 5, 6, 7];
  const hats = "x.-.x.-.x.-.x.-. x.-.x.-.x.-.x.-.";
  // A — intro: whistle over hats and a lone kick
  row(g, 0, HC, hats);
  row(g, 0, K,  "X............... X...............");
  row(g, 0, HO, "..............x. ..............x.");
  // B — verse: the Dre pocket — kick 1, and-of-2 pickup, 3; snare + clap 2 and 4
  row(g, 1, K,  "X......x..X..... X......x..X...o.");
  row(g, 1, S,  "....X.......X... ....X.......X...");
  row(g, 1, CL, "....x.......x... ....x.......x...");
  row(g, 1, HC, hats);
  row(g, 1, HO, "..............x. ..............x.");
  // C — verse 2: hat doubles and a kick answer on the four
  row(g, 2, K,  "X......x..X....o X......x..X.o...");
  row(g, 2, S,  "....X.......X... ....X.......X...");
  row(g, 2, CL, "....x.......x... ....x.......x...");
  row(g, 2, HC, "x.-.x.-.x.-.x.-o x.-.x.-.x.-.x.oo");
  row(g, 2, HO, "..............x. ..............x.");
  row(g, 2, R,  "..........o..... ..........o.....");
  // D — hook: crash, snare flam, open hat lifts
  row(g, 3, K,  "X......x..X..... X......x..X...o.");
  row(g, 3, S,  "....X.......X... ....X.......X.o.");
  row(g, 3, CL, "....x.......x... ....x.......x.x.");
  row(g, 3, HC, hats);
  row(g, 3, HO, "......x.......x. ......x.......x.");
  row(g, 3, CR, "X............... ................");
  // E — bridge: drums out, kick on the one
  row(g, 4, K,  "X............... X...............");
  row(g, 4, HC, "x...x...x...x... x...x...x...x...");
  // F — hook 2: tom answer, clap ratchet into the turnaround
  row(g, 5, K,  "X......x..X..... X......x..X...o.");
  row(g, 5, S,  "....X.......X... ....X.......X...");
  row(g, 5, CL, "....x.......x... ....x.......x...");
  row(g, 5, HC, hats);
  row(g, 5, HO, "......x.......x. ......x.......x.");
  row(g, 5, T,  "................ .............o.x");
  row(g, 5, CR, "X............... ................");
  // G — outro: last verse pocket fading
  row(g, 6, K,  "X......x..X..... X.........X.....");
  row(g, 6, S,  "....X.......X... ....X...........");
  row(g, 6, CL, "....x.......x... ....x...........");
  row(g, 6, HC, "x.-.x.-.x.-.x.-. x.-.x.-.x.......");
  // pads: clap ratchets on the turnaround, ghost rims at low probability
  pads[2] = [ev(6, 11, 46, { probability: 40 }), ev(6, 27, 46, { probability: 40 })];
  pads[3] = [ev(4, 28, 80, { ratchets: 3, probability: 60 }), ev(6, 11, 46, { probability: 35 }), ev(6, 27, 46, { probability: 35 })];
  pads[5] = [ev(4, 28, 84, { ratchets: 4 }), ev(4, 30, 70, { ratchets: 2, probability: 50 })];

  // G minor: Gm · Cm · Gm · D7 — sub on the roots with octave bounce, keys stab off the beat, whistle sings above
  const sub = [n("G3", 0, 3, 118, true), n("G3", 4, 1, 90), n("G3", 6, 1.5, 96), n("A#3", 8, 1, 92), n("C4", 10, 2, 110, true), n("C4", 14, 1.5, 96),
    n("G3", 16, 3, 118, true), n("G3", 20, 1, 90), n("G3", 22, 1.5, 96), n("D4", 24, 2, 110, true), n("D4", 27, 1, 90), n("F4", 29, 1, 92), n("D4", 30, 2, 100, false, true)];
  [1, 2, 3, 5].forEach((s) => { lanes.bass[s] = sub; });
  lanes.bass[4] = [n("G3", 0, 8, 110, true), n("C4", 8, 8, 106, true), n("G3", 16, 8, 110, true), n("D4", 24, 8, 106, true)];
  lanes.bass[6] = [n("G3", 0, 6, 110, true), n("C4", 8, 4, 100), n("G3", 16, 12, 104, true)];
  const stab = (notes: string[], step: number, len = 0.75, vel = 82) => chord(notes, step, len, vel);
  const keys = [...stab(["G3", "A#3", "D4", "F4"], 3), ...stab(["G3", "A#3", "D4", "F4"], 7, 0.5, 74), ...stab(["C4", "D#4", "G4", "A#4"], 11), ...stab(["C4", "D#4", "G4"], 15, 0.5, 74),
    ...stab(["G3", "A#3", "D4", "F4"], 19), ...stab(["G3", "A#3", "D4"], 23, 0.5, 74), ...stab(["D4", "F#4", "A4", "C5"], 27, 1, 86), ...stab(["D4", "F#4", "A4"], 30, 1.5, 78)];
  [1, 2, 3, 5].forEach((s) => { lanes.harmony[s] = keys; });
  lanes.harmony[0] = [...chord(["G3", "A#3", "D4", "F4"], 0, 16, 58), ...chord(["C4", "D#4", "G4", "A#4"], 16, 16, 56)];
  lanes.harmony[4] = [...chord(["G3", "A#3", "D4", "F4"], 0, 8, 62), ...chord(["C4", "D#4", "G4", "A#4"], 8, 8, 62), ...chord(["G3", "A#3", "D4", "F4"], 16, 8, 62), ...chord(["D4", "F#4", "A4", "C5"], 24, 8, 64)];
  lanes.harmony[6] = [...chord(["G3", "A#3", "D4"], 0, 32, 52)];
  // the whistle: long portamento lines, one phrase per two bars
  const whistle = [n("D5", 0, 3, 100, true), n("F5", 3, 1, 90, false, true), n("G5", 4, 4, 104, false, true), n("F5", 9, 1.5, 88, false, true), n("D5", 11, 3, 96, false, true),
    n("A#4", 16, 2, 92), n("C5", 18, 2, 94, false, true), n("D5", 20, 4, 104, true), n("F5", 25, 1.5, 90, false, true), n("D5", 27, 1, 86), n("A4", 28, 4, 98, false, true)];
  const whistleHook = [n("G5", 0, 2, 104, true), n("A#5", 2, 1.5, 96, false, true), n("A5", 4, 4, 106, false, true), n("G5", 9, 1, 90), n("F5", 10, 2, 92, false, true), n("D5", 12, 4, 100, false, true),
    n("F5", 16, 2, 96), n("G5", 18, 2, 100, false, true), n("A5", 20, 3, 106, true), n("G5", 24, 1, 90), n("F5", 25, 1, 88), n("D5", 26, 6, 102, false, true)];
  lanes.lead[0] = whistle; lanes.lead[2] = whistle; lanes.lead[3] = whistleHook; lanes.lead[5] = whistleHook;
  lanes.lead[4] = [n("D5", 0, 8, 96, true), n("C5", 8, 8, 92, false, true), n("D5", 16, 8, 96, false, true), n("A4", 24, 8, 94, false, true)];
  lanes.lead[6] = [n("G5", 0, 4, 96, true), n("D5", 4, 12, 92, false, true)];

  return {
    ...state, title: "WESTSIDE", bpm: 92,
    pats: g.pats, vels: g.vels, padEvents: pads, synthLaneNotes: lanes,
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneRates: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneVoices: DRUMS.map(() => "auto"),
    laneSends: [{ echo: 0, space: 0.02, pan: 0 }, { echo: 0, space: 0.22, pan: 0 }, { echo: 0, space: 0.06, pan: 0.18 }, { echo: 0, space: 0.14, pan: 0.22 }, { echo: 0.06, space: 0.3, pan: -0.1 }, { echo: 0, space: 0.2, pan: -0.3 }, { echo: 0.28, space: 0.1, pan: 0.35 }, { echo: 0, space: 0.4, pan: 0 }],
    // long 808-style kick, cracking snare with body, tight hats, wide clap
    dp: drumKit([{ pitch: 92, pitchEnd: 40, decay: 0.68, drive: 0.24 }, { filter: 1900, decay: 0.19, toneLevel: 0.45, drive: 0.22 }, { filter: 10000, decay: 0.04 }, { filter: 6000, decay: 0.3 }, { filter: 1300, decay: 0.11, spread: 30 }, { pitch: 130, pitchEnd: 60, decay: 0.4 }, { pitch: 480, toneLevel: 0.5, decay: 0.05 }, { filter: 2400, decay: 1.8 }]),
    synthPatches: {
      bass: patch("Sub Bass", { volume: 0.9, glide: 0.05, filter: { type: "lowpass", cutoff: 640, res: 0.4, env2: 0.15, track: 0.1 }, env1: { a: 0.004, d: 0.4, s: 0.9, r: 0.18 } }),
      // the G-funk whistle: a pure sine, slow glide, wide delayed vibrato
      lead: patch("Init", { volume: 0.5, glide: 0.14, vibrato: 0.55, drift: 0.05,
        osc1: { table: "basic", pos: 0, octave: 0, semi: 0, level: 0.85, unison: 1, detune: 0, warp: "none", warpAmount: 0, phase: 0 },
        filter: { type: "lowpass", cutoff: 5200, res: 0.3, env2: 0, track: 0.6 }, env1: { a: 0.02, d: 0.3, s: 0.9, r: 0.35 } }),
      harmony: patch("Keys", { volume: 0.5, filter: { type: "lowpass", cutoff: 2400, res: 0.5, env2: 0.25, track: 0.4 }, env1: { a: 0.004, d: 0.35, s: 0.3, r: 0.25 } }),
    },
    fx: { low: 3, mid: -1.5, high: 0.5, compThreshold: -15, compRatio: 3, limiter: -1, reverb: 0.14, delayTime: 0.326, delayFeedback: 0.28, delayMix: 0.08, drive: 0.12, echoDamp: 1800, echoWow: 0.3, spaceSize: 1.6 },
    rackState: { grooveTiming: 0.1, grooveVelocity: 0.08, grooveRandom: 2, noteEcho: 0, echoDecay: 0.6, glitch: 0, macros: [0.15, 0.1, 0.55, 0], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [0.96, 0.84, 0.55, 0.5, 0.66, 0.66, 0.5, 0.55], synthLevel: 0.8, masterLevel: 0.85, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 1, clipPlay: { drums: 1, pads: 1, bass: 1, lead: 1, harmony: 1 },
    songLoop: { on: false, startBar: 0, endBar: 32 },
    arrangement: {
      drums: [block(0, 0, 4), block(1, 4, 8), block(2, 12, 4), block(3, 16, 4), block(4, 20, 4), block(5, 24, 4), block(6, 28, 4)],
      pads: [block(2, 12, 4), block(3, 16, 4), block(5, 24, 4)],
      bass: [block(1, 4, 8), block(2, 12, 4), block(3, 16, 4), block(4, 20, 4, [{ lane: "bass", param: "cutoff", from: 0.2, to: 0.8 }]), block(5, 24, 4), block(6, 28, 4)],
      lead: [block(0, 0, 4, [{ lane: "lead", param: "reverb", from: 0.5, to: 0.25 }]), block(2, 12, 4), block(3, 16, 4), block(4, 20, 4, [{ lane: "lead", param: "reverb", from: 0.2, to: 0.6 }]), block(5, 24, 4), block(6, 28, 4)],
      harmony: [block(0, 0, 4, [{ lane: "master", param: "volume", from: 0.5, to: 0.85 }]), block(1, 4, 8), block(2, 12, 4), block(3, 16, 4), block(4, 20, 4, [{ lane: "harmony", param: "cutoff", from: 0.25, to: 0.75 }]), block(5, 24, 4), block(6, 28, 4, [{ lane: "master", param: "volume", from: 0.85, to: 0.25 }])],
    },
  };
}

/** Halfstep dub techno after 2562's Aerial, 140 BPM, G minor. Kick on the one,
 *  snare on the three, everything else syncopated and swung: shuffled rims, a
 *  triplet-length rim lane, dub chord stabs drowned in dotted echo, a pure sub
 *  that slides between roots, metallic pings. One four-to-the-floor stepper
 *  section. Eight scenes, 48 bars. */
function flightPath(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes(), pads: PadEvent[][] = Array.from({ length: SCENES }, () => []);
  const [K, S, HC, HO, CL, T, R, CR] = [0, 1, 2, 3, 4, 5, 6, 7];
  const hats = "..x...x.-.x...x. ..x...x.-.x...x.";
  // A — intro: stabs echoing over a shaker tick and a distant rim
  row(g, 0, HC, "..-...-...-...-. ..-...-...-...-.");
  row(g, 0, R,  "......o......... ..........o.....");
  // B — percussion build: two-step rims and hats, no kick or snare yet
  row(g, 1, HC, hats);
  row(g, 1, HO, "..............x. ..............x.");
  row(g, 1, R,  "x..x..x...x.x... x..x..x...x...x.");
  row(g, 1, CL, "........o....... ........o.......");
  // C — drop: halfstep — kick one, snare three, the second kick lands on the and-of-three
  row(g, 2, K,  "X.........x..... X......x........");
  row(g, 2, S,  "........X....... ........X.......");
  row(g, 2, CL, "........x....... ........x.......");
  row(g, 2, HC, hats);
  row(g, 2, HO, "..............x. ......x.........");
  row(g, 2, R,  "...x..x......x.. ...x..x.....x...");
  // D — drop variation: rim lane runs 18 triplet-16ths so it drifts against the bar
  row(g, 3, K,  "X.........x..x.. X......x..x.....");
  row(g, 3, S,  "........X....... ........X.....o.");
  row(g, 3, CL, "........x....... ........x.......");
  row(g, 3, HC, "..x...x.-.x...x. ..x...x.-.x.-.x.");
  row(g, 3, HO, "..............x. ..............x.");
  row(g, 3, R,  "x..x.-x..x.-x..x .-..............");
  row(g, 3, T,  "................ ..............o.");
  // E — stepper: four-to-the-floor with the same swung top end
  row(g, 4, K,  "X...x...X...x... X...x...X...x...");
  row(g, 4, HC, "..x...x...x...x. ..x...x...x...x.");
  row(g, 4, HO, "..............x. ......x.........");
  row(g, 4, R,  "...x..x...x.x... ...x..x...x...x.");
  row(g, 4, CL, "............x... ............x...");
  // F — breakdown: chords and sub, the shaker keeps time
  row(g, 5, HC, "..-...-...-...-. ..-...-...-...-.");
  row(g, 5, R,  "..........o..... ......o.........");
  row(g, 5, CR, "X............... ................");
  // G — second drop: hats double up, tom pickup into the turnaround
  row(g, 6, K,  "X.........x..... X......x..x.....");
  row(g, 6, S,  "........X....... ........X.......");
  row(g, 6, CL, "........x......o ........x.......");
  row(g, 6, HC, "..x...x.-.x...x. ..x.x.x.-.x...x.");
  row(g, 6, HO, "..............x. ..............x.");
  row(g, 6, R,  "...x..x......x.. ...x..x.....x.x.");
  row(g, 6, T,  "................ .............o..");
  row(g, 6, CR, "X............... ................");
  // H — outro: kick and rim thin out under the last echoes
  row(g, 7, K,  "X.........x..... X...............");
  row(g, 7, HC, "..x...x.-.x...x. ..-...-.........");
  row(g, 7, R,  "...x..x......... ...x............");
  // pads: rim ghosts and clap doubles at low probability, a snare flam into each drop
  pads[2] = [ev(6, 9, 48, { probability: 35 }), ev(6, 25, 48, { probability: 35 }), ev(4, 30, 60, { ratchets: 2, probability: 40 })];
  pads[3] = [ev(6, 9, 48, { probability: 35 }), ev(4, 14, 56, { probability: 30 }), ev(1, 31, 88, { ratchets: 2, probability: 60 })];
  pads[6] = [ev(6, 9, 52, { probability: 40 }), ev(4, 30, 64, { ratchets: 2, probability: 50 }), ev(1, 31, 96, { ratchets: 2 })];

  // G minor: Gm9 → Ebmaj7 → Gm9 → F. Sub holds and slides; stabs sit on the offbeats and echo; pings answer in the gaps
  const sub = [n("G3", 0, 5, 118, true), n("G3", 7, 1, 92), n("G3", 10, 3, 104, false, true), n("A#3", 16, 4, 112, true), n("D#4", 21, 3, 100, false, true), n("F3", 26, 5, 108, false, true)];
  const subB = [n("G3", 0, 4, 118, true), n("F3", 6, 2, 96, false, true), n("G3", 10, 3, 104, false, true), n("A#3", 16, 5, 112, true), n("C4", 22, 3, 100, false, true), n("F3", 28, 4, 108, false, true)];
  lanes.bass[2] = sub; lanes.bass[3] = subB; lanes.bass[6] = subB; lanes.bass[7] = [n("G3", 0, 10, 110, true), n("F3", 16, 12, 96, false, true)];
  lanes.bass[0] = [n("G3", 0, 16, 96, true), n("A#3", 16, 16, 92, true)];
  lanes.bass[5] = [n("G3", 0, 32, 104, true)];
  lanes.bass[4] = [n("G3", 2, 1.5, 108, true), n("G3", 6, 1.5, 100), n("G3", 10, 1.5, 104), n("G3", 14, 1.5, 100), n("A#3", 18, 1.5, 106, true), n("A#3", 22, 1.5, 100), n("F3", 26, 1.5, 104), n("F3", 30, 1.5, 100)];
  const gm9 = ["G3", "A#3", "D4", "F4", "A4"], ebmaj7 = ["D#4", "G4", "A#4", "D5"], f9 = ["F3", "A3", "C4", "D#4", "G4"];
  const stab = (notes: string[], step: number, len = 0.75, vel = 84) => chord(notes, step, len, vel);
  const stabs = [...stab(gm9, 2), ...stab(gm9, 11, 0.5, 72), ...stab(ebmaj7, 18), ...stab(f9, 26, 1, 80)];
  [1, 2, 3, 4, 6].forEach((s) => { lanes.harmony[s] = stabs; });
  lanes.harmony[0] = [...stab(gm9, 2, 1, 78), ...stab(ebmaj7, 18, 1, 74)];
  lanes.harmony[5] = [...chord(gm9, 0, 15, 66), ...chord(ebmaj7, 16, 15, 62)];
  lanes.harmony[7] = [...stab(gm9, 2), ...stab(gm9, 18, 1, 68)];
  const ping = [n("D5", 6, 0.5, 92), n("A#4", 13, 0.5, 84), n("G5", 22, 0.5, 94), n("F5", 29, 0.5, 86)];
  lanes.lead[1] = ping; lanes.lead[2] = ping; lanes.lead[6] = ping;
  lanes.lead[3] = [n("D5", 6, 0.5, 92), n("C5", 14, 0.5, 84), n("A#4", 22, 0.5, 90), n("G5", 30, 0.5, 96)];
  lanes.lead[4] = [n("G5", 3, 0.5, 90), n("F5", 7, 0.5, 84), n("D5", 11, 0.5, 88), n("A#4", 15, 0.5, 82), n("G5", 19, 0.5, 90), n("F5", 23, 0.5, 84), n("D#5", 27, 0.5, 88), n("D5", 31, 0.5, 82)];
  lanes.lead[5] = [n("D5", 14, 1, 84), n("G5", 30, 1, 90, true)];

  return {
    ...state, title: "FLIGHT PATH", bpm: 140,
    pats: g.pats, vels: g.vels, padEvents: pads, synthLaneNotes: lanes,
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, (_, s) => DRUMS.map((_, r) => s === 3 && r === 6 ? 18 : 0)),
    laneRates: Array.from({ length: SCENES }, (_, s) => DRUMS.map((_, r) => (s === 3 && r === 6) ? 6 : 0)),
    laneVoices: DRUMS.map(() => "auto"),
    laneSends: [{ echo: 0, space: 0.04, pan: 0 }, { echo: 0.12, space: 0.34, pan: 0 }, { echo: 0.06, space: 0.1, pan: 0.22 }, { echo: 0.1, space: 0.18, pan: 0.3 }, { echo: 0.2, space: 0.3, pan: -0.15 }, { echo: 0.14, space: 0.22, pan: -0.3 }, { echo: 0.45, space: 0.2, pan: 0.32 }, { echo: 0.1, space: 0.5, pan: 0 }],
    // dubstep kit: deep punchy kick, cracking snare with body, short hats, woody rim, loose clap
    dp: drumKit([{ pitch: 118, pitchEnd: 42, decay: 0.46, drive: 0.2 }, { pitch: 190, pitchEnd: 170, filter: 2200, decay: 0.21, toneLevel: 0.42, drive: 0.3 }, { filter: 9000, decay: 0.035 }, { filter: 6500, decay: 0.22 }, { filter: 1500, decay: 0.09, spread: 22 }, { pitch: 140, pitchEnd: 70, decay: 0.3 }, { pitch: 900, pitchEnd: 900, toneLevel: 0.55, decay: 0.04, filter: 4000 }, { filter: 3500, decay: 1.6 }]),
    synthPatches: {
      // the sub: a sine that slides, no filter motion — the floor of the track
      bass: patch("Sub Bass", { volume: 0.92, glide: 0.12, osc1: { table: "basic", pos: 0, octave: -1, semi: 0, level: 0.9, unison: 1, detune: 0, warp: "none", warpAmount: 0, phase: 0 }, filter: { type: "lowpass", cutoff: 400, res: 0.3, env2: 0.04, track: 0.1 }, env1: { a: 0.008, d: 0.5, s: 0.95, r: 0.3 } }),
      // tuned metallic ping: a bright digital pluck through a resonant bandpass
      lead: patch("Pluck", { volume: 0.36, osc1: { table: "digital", pos: 0.55, octave: 1, semi: 0, level: 0.8, unison: 2, detune: 6, warp: "none", warpAmount: 0, phase: 0 }, filter: { type: "bandpass", cutoff: 2600, res: 1.4, env2: 0.5, track: 0.6 }, env1: { a: 0.001, d: 0.22, s: 0, r: 0.3 }, env2: { a: 0.001, d: 0.12, s: 0, r: 0.1 } }),
      // dub chord stab: detuned saws through a closed resonant filter, a slow LFO breathing the cutoff
      harmony: patch("Init", { volume: 0.5,
        osc1: { table: "basic", pos: 0.7, octave: 0, semi: 0, level: 0.7, unison: 3, detune: 18, warp: "none", warpAmount: 0, phase: 0 },
        osc2: { table: "basic", pos: 0.72, octave: -1, semi: 0, level: 0.35, unison: 2, detune: 12, warp: "none", warpAmount: 0, phase: 0 },
        filter: { type: "lowpass", cutoff: 1100, res: 0.9, env2: 0.35, track: 0.3 },
        env1: { a: 0.005, d: 0.35, s: 0.15, r: 0.45 }, env2: { a: 0.002, d: 0.25, s: 0, r: 0.2 },
        lfo1: { shape: "sine", rate: 0.08 }, matrix: [{ src: "lfo1", dest: "cutoff", amt: 0.2 }] }),
    },
    // dotted-eighth echo at 140 (0.321 s), dark and regenerating; long space
    fx: { low: 3.5, mid: -2, high: 1, compThreshold: -18, compRatio: 3.5, limiter: -1, reverb: 0.36, delayTime: 0.32143, delayFeedback: 0.52, delayMix: 0.24, drive: 0.16, echoDamp: 1500, echoWow: 0.35, spaceSize: 3.6 },
    rackState: { grooveTiming: 0.24, grooveVelocity: 0.12, grooveRandom: 2, noteEcho: 0, echoDecay: 0.6, glitch: 0, macros: [0.2, 0.35, 0.5, 0.1], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [0.95, 0.84, 0.46, 0.42, 0.52, 0.6, 0.58, 0.45], synthLevel: 0.8, masterLevel: 0.85, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 2, clipPlay: { drums: 2, pads: 2, bass: 2, lead: 2, harmony: 2 },
    songLoop: { on: false, startBar: 0, endBar: 48 },
    arrangement: {
      drums: [block(0, 0, 8), block(1, 8, 4), block(2, 12, 8), block(3, 20, 8), block(4, 28, 6), block(5, 34, 4), block(6, 38, 6), block(7, 44, 4)],
      pads: [block(2, 12, 8), block(3, 20, 8), block(6, 38, 6)],
      bass: [block(0, 0, 8, [{ lane: "bass", param: "volume", from: 0.4, to: 0.9 }]), block(2, 12, 8), block(3, 20, 8), block(4, 28, 6), block(5, 34, 4, [{ lane: "bass", param: "cutoff", from: 0.12, to: 0.5 }]), block(6, 38, 6), block(7, 44, 4, [{ lane: "bass", param: "cutoff", from: 0.5, to: 0.08 }])],
      lead: [block(1, 8, 4), block(2, 12, 8), block(3, 20, 8), block(4, 28, 6), block(5, 34, 4, [{ lane: "lead", param: "reverb", from: 0.35, to: 0.8 }]), block(6, 38, 6)],
      harmony: [block(0, 0, 8, [{ lane: "harmony", param: "cutoff", from: 0.1, to: 0.5 }, { lane: "master", param: "volume", from: 0.45, to: 0.85 }]), block(1, 8, 4), block(2, 12, 8), block(3, 20, 8), block(4, 28, 6), block(5, 34, 4, [{ lane: "harmony", param: "reverb", from: 0.3, to: 0.8 }]), block(6, 38, 6), block(7, 44, 4, [{ lane: "master", param: "volume", from: 0.85, to: 0.15 }])],
    },
  };
}

/** After Burial's Untrue, 136 BPM, E minor. Swung two-step with loose random
 *  timing, shell-click rims and a woodblock tom, a papery snare in a long room,
 *  vinyl crackle riding the drowned pads, a pitched-up ghost vocal that slides
 *  between notes, a sine sub. Seven scenes, 48 bars. */
function sodiumLight(state: Record<string, unknown>): Record<string, unknown> {
  const g = emptyGrid(), lanes = emptyLanes(), pads: PadEvent[][] = Array.from({ length: SCENES }, () => []);
  const [K, S, HC, HO, CL, T, R, CR] = [0, 1, 2, 3, 4, 5, 6, 7];
  const twoStepK = "X.........x..... X......x..x.....";
  const twoStepS = "....X.......X... ....X.......X...";
  const hats = "..x...x.x.x...x. ..x.x.x...x.x...";
  // A — crackle and pads, the vocal alone, a shell click and a wash
  row(g, 0, R,  "..........o..... ....o...........");
  row(g, 0, CR, "o............... ................");
  // B — two-step in, no sub yet
  row(g, 1, K,  twoStepK);
  row(g, 1, S,  twoStepS);
  row(g, 1, HC, hats);
  row(g, 1, HO, "......x......... ..........x.....");
  row(g, 1, R,  "...o..o....o.... ...o......o..o..");
  row(g, 1, CL, "....-.......-... ....-.......-...");
  // C — full: sub under, woodblock answers the snare
  row(g, 2, K,  twoStepK);
  row(g, 2, S,  twoStepS);
  row(g, 2, HC, hats);
  row(g, 2, HO, "......x......... ..........x.....");
  row(g, 2, R,  "...o..o....o.... ...o......o..o..");
  row(g, 2, CL, "....-.......-... ....-.......-...");
  row(g, 2, T,  ".......x......x. .......x........");
  // D — variation: the second snare slips early, more shell clicks
  row(g, 3, K,  "X.........x..... X.......x..x....");
  row(g, 3, S,  "....X......X.... ....X.......X.o.");
  row(g, 3, HC, "..x...x.x.x...x. ..x.x.x...x.x.x.");
  row(g, 3, HO, "......x.......x. ..........x.....");
  row(g, 3, R,  "...o..o....o..o. ...o..o...o..o..");
  row(g, 3, CL, "....-......-.... ....-.......-...");
  row(g, 3, T,  ".......x......x. .......x.....x..");
  // E — drop out: pads, vocal and sub; one kick, hats return late
  row(g, 4, K,  "X............... ................");
  row(g, 4, R,  "......o......... ..........o.....");
  row(g, 4, HC, "................ ........x...x...");
  // F — return: hats double, clap firms up, wash on the one
  row(g, 5, K,  twoStepK);
  row(g, 5, S,  twoStepS);
  row(g, 5, HC, "..x.x.x.x.x.x.x. ..x.x.x.x.x.x.x.");
  row(g, 5, HO, "......x.......x. ......x.......x.");
  row(g, 5, R,  "...o..o....o.... ...o......o..o..");
  row(g, 5, CL, "....x.......x... ....x.......x...");
  row(g, 5, T,  ".......x......x. .......x........");
  row(g, 5, CR, "o............... ................");
  // G — outro: drums thin while the vocal keeps going
  row(g, 6, K,  "X.........x..... X...............");
  row(g, 6, S,  "....X.......X... ....X...........");
  row(g, 6, HC, "..x...x.x.x...x. ..x...x.........");
  row(g, 6, R,  "...o..o......... ................");
  // pads: shell clicks that land or don't, a loose clap double
  pads[2] = [ev(6, 5, 44, { probability: 35 }), ev(6, 21, 44, { probability: 35 }), ev(6, 27, 40, { probability: 25 })];
  pads[3] = [ev(6, 5, 44, { probability: 40 }), ev(6, 14, 40, { probability: 30 }), ev(4, 12, 58, { ratchets: 2, probability: 35 })];
  pads[5] = [ev(6, 5, 46, { probability: 40 }), ev(6, 21, 46, { probability: 40 }), ev(4, 28, 62, { ratchets: 2, probability: 45 })];

  // E minor: Em9 → Cmaj9, Am9 in the turnarounds. Sub slides between roots; pads are long and drowned; the vocal sings short slurred phrases
  const sub = [n("E3", 0, 6, 116, true), n("E3", 8, 2, 96), n("G3", 11, 2, 100, false, true), n("E3", 13, 3, 104, false, true),
    n("C3", 16, 6, 112, true), n("C3", 24, 2, 96), n("D3", 27, 5, 100, false, true)];
  const subB = [n("E3", 0, 6, 116, true), n("E3", 8, 3, 96), n("B2", 12, 4, 100, false, true),
    n("A2", 16, 6, 110, true), n("A2", 24, 2, 96), n("C3", 27, 2, 98, false, true), n("D3", 29, 3, 100, false, true)];
  lanes.bass[2] = sub; lanes.bass[3] = subB; lanes.bass[5] = sub; lanes.bass[6] = [n("E3", 0, 12, 106, true), n("C3", 16, 12, 98, false, true)];
  lanes.bass[4] = [n("E3", 0, 16, 104, true), n("C3", 16, 16, 100, true)];
  const em9 = ["E3", "B3", "D4", "F#4", "G4"], cmaj9 = ["C3", "G3", "B3", "D4", "E4"], am9 = ["A2", "E3", "G3", "B3", "C4"];
  const wash = [...chord(em9, 0, 16, 64), ...chord(cmaj9, 16, 16, 62)];
  [0, 1, 2, 5].forEach((s) => { lanes.harmony[s] = wash; });
  lanes.harmony[3] = [...chord(em9, 0, 16, 62), ...chord(am9, 16, 16, 62)];
  lanes.harmony[4] = [...chord(em9, 0, 16, 70), ...chord(cmaj9, 16, 16, 68)];
  lanes.harmony[6] = [...chord(em9, 0, 16, 58), ...chord(cmaj9, 16, 16, 50)];
  // the ghost vocal: pitched-up, slurred, short phrases with air between them
  const voice = [n("B4", 2, 1.5, 92), n("D5", 4, 1, 94, false, true), n("E5", 5, 3, 100, false, true), n("D5", 9, 1, 86, false, true), n("B4", 10, 2, 90, false, true),
    n("G4", 20, 2, 88), n("A4", 22, 1.5, 90, false, true), n("B4", 24, 4, 96, false, true)];
  const voiceHook = [n("E5", 0, 2, 98, true), n("G5", 2, 1.5, 96, false, true), n("F#5", 4, 3, 100, false, true), n("E5", 8, 1, 90, false, true), n("B4", 10, 3, 92, false, true),
    n("D5", 18, 1.5, 90), n("E5", 20, 2, 94, false, true), n("G5", 22, 1, 92, false, true), n("E5", 24, 4, 98, false, true)];
  lanes.lead[0] = voice; lanes.lead[2] = voice; lanes.lead[3] = voiceHook; lanes.lead[4] = voiceHook; lanes.lead[5] = voice;
  lanes.lead[6] = [n("B4", 2, 1.5, 88), n("D5", 4, 1, 88, false, true), n("E5", 5, 5, 92, false, true), n("B4", 20, 6, 86, false, true)];

  const perf = (texture: "vinyl" | "rain", textureLevel: number) => ({ ...(initPatch().performance as NonNullable<VPatch["performance"]>), texture, textureLevel });
  return {
    ...state, title: "SODIUM LIGHT", bpm: 136,
    pats: g.pats, vels: g.vels, padEvents: pads, synthLaneNotes: lanes,
    patternLengths: Array.from({ length: SCENES }, () => 32), patternDivisions: Array.from({ length: SCENES }, () => 4),
    laneLengths: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneRates: Array.from({ length: SCENES }, () => DRUMS.map(() => 0)),
    laneVoices: DRUMS.map(() => "auto"),
    laneSends: [{ echo: 0, space: 0.05, pan: 0 }, { echo: 0.08, space: 0.48, pan: 0 }, { echo: 0.04, space: 0.2, pan: 0.2 }, { echo: 0.08, space: 0.24, pan: 0.28 }, { echo: 0.1, space: 0.4, pan: -0.12 }, { echo: 0.25, space: 0.3, pan: 0.35 }, { echo: 0.3, space: 0.35, pan: -0.3 }, { echo: 0.1, space: 0.6, pan: 0 }],
    // muffled kick, papery snare, short hats, loose clap, woodblock tom, shell-click rim, long noise wash for the crash
    dp: drumKit([{ pitch: 110, pitchEnd: 44, decay: 0.36, drive: 0.12 }, { pitch: 200, pitchEnd: 180, filter: 3200, decay: 0.15, toneLevel: 0.25, drive: 0.3 }, { filter: 9500, decay: 0.03 }, { filter: 7000, decay: 0.16 }, { filter: 1800, decay: 0.08, spread: 40 }, { pitch: 820, pitchEnd: 780, decay: 0.035 }, { pitch: 1400, pitchEnd: 1400, toneLevel: 0.6, decay: 0.03, filter: 5000 }, { filter: 5000, decay: 2.6 }]),
    synthPatches: {
      bass: patch("Sub Bass", { volume: 0.9, glide: 0.15, osc1: { table: "basic", pos: 0, octave: -1, semi: 0, level: 0.9, unison: 1, detune: 0, warp: "none", warpAmount: 0, phase: 0 }, filter: { type: "lowpass", cutoff: 380, res: 0.3, env2: 0.03, track: 0.1 }, env1: { a: 0.01, d: 0.5, s: 0.95, r: 0.35 } }),
      // the ghost vocal: vocal table an octave up, slow glide, wide vibrato, rain hiss under it
      lead: patch("Init", { volume: 0.42, glide: 0.2, vibrato: 0.5, drift: 0.08,
        osc1: { table: "vocal", pos: 0.55, octave: 1, semi: 0, level: 0.7, unison: 2, detune: 9, warp: "none", warpAmount: 0, phase: 0 },
        osc2: { table: "vocal", pos: 0.3, octave: 0, semi: 0, level: 0.25, unison: 1, detune: 0, warp: "none", warpAmount: 0, phase: 0 },
        filter: { type: "lowpass", cutoff: 2400, res: 0.6, env2: 0.1, track: 0.5 }, env1: { a: 0.04, d: 0.4, s: 0.7, r: 0.6 },
        performance: perf("rain", 0.18) }),
      // drowned pads with the vinyl crackle bound to them — the pads never stop, so neither does the crackle
      harmony: patch("Pad", { volume: 0.5,
        osc1: { table: "vocal", pos: 0.4, octave: 0, semi: 0, level: 0.55, unison: 4, detune: 30, warp: "none", warpAmount: 0, phase: 0 },
        osc2: { table: "basic", pos: 0.2, octave: -1, semi: 0, level: 0.35, unison: 2, detune: 8, warp: "none", warpAmount: 0, phase: 0 },
        filter: { type: "lowpass", cutoff: 900, res: 0.5, env2: 0.05, track: 0.2 }, env1: { a: 1.2, d: 1.5, s: 0.85, r: 2.6 },
        lfo2: { shape: "triangle", rate: 0.07 }, matrix: [{ src: "lfo2", dest: "cutoff", amt: 0.15 }, { src: "lfo1", dest: "pan", amt: 0.2 }],
        performance: perf("vinyl", 0.35) }),
    },
    // dotted-eighth echo at 136 (0.331 s) with heavy wow, dark top end, a big room
    fx: { low: 2.5, mid: -3, high: -1, compThreshold: -17, compRatio: 3, limiter: -1, reverb: 0.44, delayTime: 0.33088, delayFeedback: 0.4, delayMix: 0.2, drive: 0.1, echoDamp: 1300, echoWow: 0.65, spaceSize: 4.2 },
    // heavy swing plus random timing: the hits sit off the grid the way the records do
    rackState: { grooveTiming: 0.4, grooveVelocity: 0.18, grooveRandom: 7, noteEcho: 0, echoDecay: 0.6, glitch: 0, macros: [0.1, 0.5, 0.35, 0.3], devices: { player: true, drive: true, eq: true, compressor: true, delay: true, reverb: true, limiter: true } },
    mix: { channelLevels: [0.86, 0.78, 0.42, 0.38, 0.44, 0.5, 0.52, 0.4], synthLevel: 0.84, masterLevel: 0.85, power: true, mute: Array(8).fill(false), solo: Array(8).fill(false) },
    clipSel: 2, clipPlay: { drums: 2, pads: 2, bass: 2, lead: 2, harmony: 2 },
    songLoop: { on: false, startBar: 0, endBar: 48 },
    arrangement: {
      drums: [block(0, 0, 8), block(1, 8, 4), block(2, 12, 8), block(3, 20, 8), block(4, 28, 4), block(5, 32, 8), block(6, 40, 8)],
      pads: [block(2, 12, 8), block(3, 20, 8), block(5, 32, 8)],
      bass: [block(2, 12, 8), block(3, 20, 8), block(4, 28, 4), block(5, 32, 8), block(6, 40, 8, [{ lane: "bass", param: "cutoff", from: 0.4, to: 0.06 }])],
      lead: [block(0, 0, 8, [{ lane: "lead", param: "reverb", from: 0.75, to: 0.45 }]), block(2, 12, 8), block(3, 20, 8), block(4, 28, 4, [{ lane: "lead", param: "reverb", from: 0.4, to: 0.8 }]), block(5, 32, 8), block(6, 40, 8, [{ lane: "lead", param: "reverb", from: 0.5, to: 0.9 }])],
      harmony: [block(0, 0, 8, [{ lane: "harmony", param: "cutoff", from: 0.1, to: 0.4 }, { lane: "master", param: "volume", from: 0.4, to: 0.85 }]), block(1, 8, 4), block(2, 12, 8), block(3, 20, 8), block(4, 28, 4, [{ lane: "harmony", param: "cutoff", from: 0.4, to: 0.7 }]), block(5, 32, 8), block(6, 40, 8, [{ lane: "master", param: "volume", from: 0.85, to: 0.1 }])],
    },
  };
}

export function buildDemo(name: string, base: Record<string, unknown>): Record<string, unknown> | null {
  if (name === "WESTSIDE") return westside(base);
  if (name === "FLIGHT PATH") return flightPath(base);
  if (name === "SODIUM LIGHT") return sodiumLight(base);
  return null;
}
