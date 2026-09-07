// Ear-training question generators. Pure: given settings and a random
// source they return a Question the page renders and grades. Kept free of
// DOM and audio so a node run can check every exercise's logic.

export type View = "staff" | "keyboard" | "fretboard" | "ear";
export type Rng = () => number;

export interface Settings {
  clef: "treble" | "bass";
  accidentals: boolean;
  intervals: number[];        // semitones enabled, 1–12
  chords: string[];           // quality ids enabled
  inversions: boolean;
  melodic: "asc" | "desc" | "both" | "harmonic";
  eqBands: number[];          // Hz
  eqBoostDb: number;
  rhythmDensity: 1 | 2 | 3;   // 1 = quarters/eighths, 2 = eighths, 3 = sixteenths
}
export const DEFAULT_SETTINGS: Settings = {
  clef: "treble", accidentals: false, intervals: [2, 3, 4, 5, 7, 9, 11, 12], chords: ["maj", "min", "dim", "aug"], inversions: false,
  melodic: "both", eqBands: [125, 250, 500, 1000, 2000, 4000, 8000], eqBoostDb: 9, rhythmDensity: 2,
};

export interface Question {
  exercise: string;
  prompt: string;
  notes: number[];             // MIDI notes to draw (visual exercises) or play (ear)
  choices: string[];
  answer: string;
  explain: string;
  view: View;
  audio?: { kind: "notes"; notes: number[]; mode: "melodic" | "harmonic"; gapMs: number } | { kind: "eq"; band: number; boostDb: number } | { kind: "rhythm"; cells: boolean[]; cellMs: number };
  rhythmChoices?: boolean[][];
}

export const INTERVALS: Record<number, [string, string]> = { 1: ["m2", "minor 2nd"], 2: ["M2", "major 2nd"], 3: ["m3", "minor 3rd"], 4: ["M3", "major 3rd"], 5: ["P4", "perfect 4th"], 6: ["TT", "tritone"], 7: ["P5", "perfect 5th"], 8: ["m6", "minor 6th"], 9: ["M6", "major 6th"], 10: ["m7", "minor 7th"], 11: ["M7", "major 7th"], 12: ["P8", "octave"] };
export const CHORDS: Record<string, { label: string; intervals: number[] }> = {
  maj: { label: "Major", intervals: [0, 4, 7] }, min: { label: "Minor", intervals: [0, 3, 7] }, dim: { label: "Diminished", intervals: [0, 3, 6] }, aug: { label: "Augmented", intervals: [0, 4, 8] },
  sus2: { label: "Sus2", intervals: [0, 2, 7] }, sus4: { label: "Sus4", intervals: [0, 5, 7] },
  maj7: { label: "Major 7th", intervals: [0, 4, 7, 11] }, dom7: { label: "Dominant 7th", intervals: [0, 4, 7, 10] }, min7: { label: "Minor 7th", intervals: [0, 3, 7, 10] }, m7b5: { label: "Half-dim 7th", intervals: [0, 3, 6, 10] }, dim7: { label: "Dim 7th", intervals: [0, 3, 6, 9] },
};
export const PITCH_LABELS = ["C", "C♯/D♭", "D", "D♯/E♭", "E", "F", "F♯/G♭", "G", "G♯/A♭", "A", "A♯/B♭", "B"];
export const EQ_LABELS = (hz: number): string => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

const pick = <T,>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length) % arr.length];
const shuffle = <T,>(arr: T[], rng: Rng): T[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rangeFor = (s: Settings, view: View): [number, number] => view === "fretboard" ? [40, 76] : view === "keyboard" ? [48, 83] : s.clef === "treble" ? [57, 84] : [36, 62];
const isNatural = (midi: number): boolean => [0, 2, 4, 5, 7, 9, 11].includes(((midi % 12) + 12) % 12);
const midiName = (m: number): string => `${PITCH_LABELS[((m % 12) + 12) % 12].split("/")[0]}${Math.floor(m / 12) - 1}`;

function randomNote(s: Settings, view: View, rng: Rng, lo?: number, hi?: number): number {
  const [a, b] = rangeFor(s, view);
  const min = lo ?? a, max = hi ?? b;
  for (let tries = 0; tries < 50; tries++) { const m = min + Math.floor(rng() * (max - min + 1)); if (s.accidentals || isNatural(m)) return m; }
  return min;
}

export const EXERCISES: Array<{ id: string; name: string; views: View[]; make: (s: Settings, view: View, rng: Rng) => Question }> = [
  {
    id: "note", name: "Note ID", views: ["staff", "keyboard", "fretboard"],
    make: (s, view, rng) => {
      const m = randomNote(s, view, rng);
      const pc = ((m % 12) + 12) % 12;
      const choices = s.accidentals ? PITCH_LABELS : PITCH_LABELS.filter((_, i) => isNatural(i));
      return { exercise: "note", prompt: view === "staff" ? "Name the note on the staff." : view === "keyboard" ? "Name the highlighted key." : "Name the note at the marked fret.", notes: [m], choices, answer: PITCH_LABELS[pc], explain: `${midiName(m)} · MIDI ${m}`, view };
    },
  },
  {
    id: "interval", name: "Interval ID", views: ["staff", "keyboard", "fretboard"],
    make: (s, view, rng) => {
      const semis = pick(s.intervals.length ? s.intervals : DEFAULT_SETTINGS.intervals, rng);
      const [lo, hi] = rangeFor(s, view);
      let root = randomNote(s, view, rng, lo, hi - semis);
      // the fretboard needs two distinct strings within frets 0–12; retry the root until it fits
      for (let tries = 0; view === "fretboard" && tries < 40 && !fretPositions([root, root + semis], rng); tries++) root = randomNote(s, view, rng, lo, hi - semis);
      const enabled = (s.intervals.length >= 4 ? s.intervals : Object.keys(INTERVALS).map(Number)).map((n) => INTERVALS[n][0]);
      return { exercise: "interval", prompt: "Name the interval between the two notes.", notes: [root, root + semis], choices: enabled, answer: INTERVALS[semis][0], explain: `${midiName(root)} → ${midiName(root + semis)} = ${INTERVALS[semis][1]} (${semis} semitones)`, view };
    },
  },
  {
    id: "chord", name: "Chord ID", views: ["staff", "keyboard", "fretboard"],
    make: (s, view, rng) => {
      const ids = s.chords.length ? s.chords : DEFAULT_SETTINGS.chords;
      const id = pick(ids, rng), def = CHORDS[id];
      const [lo, hi] = rangeFor(s, view);
      const root = randomNote(s, view, rng, lo, hi - 16);
      let notes = def.intervals.map((i) => root + i);
      let inversion = 0;
      if (s.inversions) { inversion = Math.floor(rng() * notes.length); for (let k = 0; k < inversion; k++) notes.push((notes.shift() as number) + 12); }
      while (Math.max(...notes) > hi && Math.min(...notes) - 12 >= lo) notes = notes.map((n) => n - 12);
      notes = notes.sort((a, b) => a - b);
      if (view === "fretboard") {
        for (let tries = 0; tries < 40 && !fretPositions(notes, rng); tries++) {
          const r = randomNote(s, view, rng, lo, hi - 16);
          notes = def.intervals.map((i) => r + i);
          for (let k = 0; k < inversion; k++) notes.push((notes.shift() as number) + 12);
          while (Math.max(...notes) > hi && Math.min(...notes) - 12 >= lo) notes = notes.map((n) => n - 12);
          notes = notes.sort((a, b) => a - b);
        }
      }
      const choices = (ids.length >= 4 ? ids : Object.keys(CHORDS)).map((k) => CHORDS[k].label);
      return { exercise: "chord", prompt: "Name the chord quality.", notes, choices, answer: def.label, explain: `${midiName(root)} ${def.label.toLowerCase()}${inversion ? `, ${["root position", "1st inversion", "2nd inversion", "3rd inversion"][inversion]}` : ""}: ${notes.map(midiName).join(" ")}`, view };
    },
  },
  {
    id: "intervalEar", name: "Interval ear", views: ["ear"],
    make: (s, _view, rng) => {
      const semis = pick(s.intervals.length ? s.intervals : DEFAULT_SETTINGS.intervals, rng);
      const root = 55 + Math.floor(rng() * 14);
      const dir = s.melodic === "both" ? (rng() < 0.5 ? "asc" : "desc") : s.melodic;
      const notes = dir === "desc" ? [root + semis, root] : [root, root + semis];
      const enabled = (s.intervals.length >= 4 ? s.intervals : Object.keys(INTERVALS).map(Number)).map((n) => INTERVALS[n][0]);
      return { exercise: "intervalEar", prompt: dir === "harmonic" ? "Listen: which interval is sounding?" : `Listen: which interval is that (${dir === "asc" ? "rising" : "falling"})?`, notes, choices: enabled, answer: INTERVALS[semis][0], explain: `${INTERVALS[semis][1]}: ${notes.map(midiName).join(" → ")}`, view: "ear", audio: { kind: "notes", notes, mode: dir === "harmonic" ? "harmonic" : "melodic", gapMs: 650 } };
    },
  },
  {
    id: "eq", name: "EQ ear", views: ["ear"],
    make: (s, _view, rng) => {
      const bands = s.eqBands.length >= 3 ? s.eqBands : DEFAULT_SETTINGS.eqBands;
      const band = pick(bands, rng);
      return { exercise: "eq", prompt: `Listen: which band is boosted by ${s.eqBoostDb} dB? (Flat plays first, then boosted.)`, notes: [], choices: bands.map(EQ_LABELS), answer: EQ_LABELS(band), explain: `+${s.eqBoostDb} dB bell at ${EQ_LABELS(band)}`, view: "ear", audio: { kind: "eq", band, boostDb: s.eqBoostDb } };
    },
  },
  {
    id: "rhythm", name: "Rhythm dictation", views: ["ear"],
    make: (s, _view, rng) => {
      const cellsPerBar = s.rhythmDensity === 3 ? 16 : 8;
      const density = s.rhythmDensity === 1 ? 0.45 : 0.6;
      let cells: boolean[] = [];
      do { cells = Array.from({ length: cellsPerBar }, (_, i) => i === 0 || rng() < density); } while (cells.filter(Boolean).length < 3);
      if (s.rhythmDensity === 1) cells = cells.map((c, i) => (i % 2 === 1 && rng() < 0.6 ? false : c)); // lean on beats
      const mutate = (src: boolean[]): boolean[] => { const out = [...src]; const flips = 1 + Math.floor(rng() * 2); for (let k = 0; k < flips; k++) { const i = 1 + Math.floor(rng() * (out.length - 1)); out[i] = !out[i]; } return out; };
      const seen = new Set<string>([cells.join("")]);
      const options: boolean[][] = [cells];
      while (options.length < 4) { const m = mutate(cells); const key = m.join(""); if (!seen.has(key)) { seen.add(key); options.push(m); } }
      const shuffled = shuffle(options, rng);
      const label = (c: boolean[]): string => c.map((on) => (on ? "●" : "·")).join("");
      const cellMs = s.rhythmDensity === 3 ? 150 : 300; // 100 BPM
      return { exercise: "rhythm", prompt: "Listen to one bar after the count-in, then pick the rhythm you heard.", notes: [], choices: shuffled.map(label), answer: label(cells), explain: `Hits on cells ${cells.map((c, i) => (c ? i + 1 : null)).filter(Boolean).join(", ")} of ${cellsPerBar}`, view: "ear", audio: { kind: "rhythm", cells, cellMs }, rhythmChoices: shuffled };
    },
  },
];

export const exerciseById = (id: string) => EXERCISES.find((e) => e.id === id) ?? EXERCISES[0];

/** Deterministic PRNG so a shared link or a test can replay a session. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── staff geometry (shared by the renderer and its test) ──
const LETTER_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // sharps spelling, C = 0
const PC_IS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
export interface StaffNote { midi: number; step: number; accidental: "" | "♯" }
/** Diatonic step index (C0 = 0, one per letter) using sharp spelling. */
export function staffNote(midi: number): StaffNote {
  const pc = ((midi % 12) + 12) % 12, octave = Math.floor(midi / 12) - 1;
  return { midi, step: octave * 7 + LETTER_OF_PC[pc], accidental: PC_IS_SHARP[pc] ? "♯" : "" };
}
/** Bottom-line step for each clef: treble E4, bass G2. */
export const CLEF_BASE_STEP = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 } as const;

// ── fretboard placement ──
export const TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4, low to high
export interface FretPos { string: number; fret: number }
/** One position per note, distinct strings, frets 0–12, preferring a tight hand span. */
export function fretPositions(notes: number[], rng: Rng): FretPos[] | null {
  const candidates = notes.map((n) => TUNING.map((open, string) => ({ string, fret: n - open })).filter((p) => p.fret >= 0 && p.fret <= 12));
  if (candidates.some((c) => !c.length)) return null;
  let best: FretPos[] | null = null, bestSpan = Infinity;
  const walk = (i: number, chosen: FretPos[]) => {
    if (i === notes.length) {
      const frets = chosen.map((c) => c.fret).filter((f) => f > 0);
      const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
      const score = span + rng() * 0.5;
      if (score < bestSpan) { bestSpan = score; best = [...chosen]; }
      return;
    }
    for (const c of candidates[i]) if (!chosen.some((x) => x.string === c.string)) walk(i + 1, [...chosen, c]);
  };
  walk(0, []);
  return best;
}
