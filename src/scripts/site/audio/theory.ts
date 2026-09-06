// Pure music theory shared by the chord lab, the ear trainer and the studio's
// scale lock. Pitch classes are 0–11 with C = 0; MIDI numbers use C4 = 60.

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface Scale { id: string; name: string; steps: number[]; mode?: "major" | "minor" }
export const SCALES: Scale[] = [
  { id: "major", name: "Major (Ionian)", steps: [0, 2, 4, 5, 7, 9, 11], mode: "major" },
  { id: "minor", name: "Natural minor (Aeolian)", steps: [0, 2, 3, 5, 7, 8, 10], mode: "minor" },
  { id: "harmonicMinor", name: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11], mode: "minor" },
  { id: "melodicMinor", name: "Melodic minor", steps: [0, 2, 3, 5, 7, 9, 11], mode: "minor" },
  { id: "dorian", name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10], mode: "minor" },
  { id: "phrygian", name: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10], mode: "minor" },
  { id: "lydian", name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11], mode: "major" },
  { id: "mixolydian", name: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10], mode: "major" },
  { id: "locrian", name: "Locrian", steps: [0, 1, 3, 5, 6, 8, 10], mode: "minor" },
  { id: "majorPentatonic", name: "Major pentatonic", steps: [0, 2, 4, 7, 9], mode: "major" },
  { id: "minorPentatonic", name: "Minor pentatonic", steps: [0, 3, 5, 7, 10], mode: "minor" },
  { id: "blues", name: "Blues", steps: [0, 3, 5, 6, 7, 10], mode: "minor" },
  { id: "wholeTone", name: "Whole tone", steps: [0, 2, 4, 6, 8, 10] },
  { id: "chromatic", name: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];
export const scaleById = (id: string): Scale => SCALES.find((s) => s.id === id) ?? SCALES[0];

export const pc = (midi: number): number => ((midi % 12) + 12) % 12;
export const midiName = (midi: number, sharps = false): string => `${(sharps ? SHARP_NAMES : NOTE_NAMES)[pc(midi)]}${Math.floor(midi / 12) - 1}`;
/** Studio-style note string ("A#3") → MIDI. */
export function nameToMidi(name: string): number {
  const m = /^([A-G])([#♯b♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return 60;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"] ?? 0;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return base + acc + (parseInt(m[3], 10) + 1) * 12;
}

export const scalePitchClasses = (root: number, scaleId: string): number[] => scaleById(scaleId).steps.map((s) => pc(root + s));
export const inScale = (midi: number, root: number, scaleId: string): boolean => scalePitchClasses(root, scaleId).includes(pc(midi));

/** Nearest scale tone; ties resolve downward so a played black key lands on the note under the finger. */
export function quantiseToScale(midi: number, root: number, scaleId: string, direction: "nearest" | "down" | "up" = "nearest"): number {
  if (inScale(midi, root, scaleId)) return midi;
  for (let d = 1; d <= 6; d++) {
    const down = midi - d, up = midi + d;
    if (direction !== "up" && inScale(down, root, scaleId)) return down;
    if (direction !== "down" && inScale(up, root, scaleId)) return up;
  }
  return midi;
}

/** Index of a scale tone within the scale, or -1. */
export const degreeOf = (midi: number, root: number, scaleId: string): number => scalePitchClasses(root, scaleId).indexOf(pc(midi));

/** Chord built in thirds (every other scale tone) from `baseMidi`, which must be a scale tone. */
export function diatonicChordFrom(baseMidi: number, root: number, scaleId: string, size = 3): number[] {
  const steps = scaleById(scaleId).steps, degree = degreeOf(baseMidi, root, scaleId);
  if (degree < 0) return [baseMidi];
  return Array.from({ length: size }, (_, j) => {
    const idx = degree + 2 * j;
    return baseMidi + steps[idx % steps.length] + 12 * Math.floor(idx / steps.length) - steps[degree];
  });
}
/** Diatonic chord on a scale degree (0-based), rooted in `octave`. */
export const diatonicChord = (root: number, scaleId: string, degree: number, size = 3, octave = 4): number[] => {
  const steps = scaleById(scaleId).steps;
  return diatonicChordFrom((octave + 1) * 12 + root + steps[degree % steps.length], root, scaleId, size);
};

export function invert(notes: number[], inversion: number): number[] {
  const out = [...notes].sort((a, b) => a - b);
  for (let i = 0; i < inversion && out.length > 1; i++) out.push((out.shift() as number) + 12);
  return out;
}
export type Voicing = "close" | "open" | "drop2" | "spread";
export function voice(notes: number[], voicing: Voicing): number[] {
  const s = [...notes].sort((a, b) => a - b);
  if (voicing === "open" && s.length >= 3) return [s[0], s[2], s[1] + 12, ...s.slice(3).map((n) => n + 12)].sort((a, b) => a - b);
  if (voicing === "drop2" && s.length >= 3) { const d = s[s.length - 2] - 12; return [d, ...s.filter((n) => n !== s[s.length - 2])].sort((a, b) => a - b); }
  if (voicing === "spread") return s.map((n, i) => n + (i === 0 ? -12 : i >= 2 ? 12 : 0)).sort((a, b) => a - b);
  return s;
}

const QUALITIES: Array<[number[], string, string]> = [
  [[0, 4, 7], "major", ""], [[0, 3, 7], "minor", "m"], [[0, 3, 6], "diminished", "dim"], [[0, 4, 8], "augmented", "aug"],
  [[0, 2, 7], "sus2", "sus2"], [[0, 5, 7], "sus4", "sus4"],
  [[0, 4, 7, 11], "major 7th", "maj7"], [[0, 4, 7, 10], "dominant 7th", "7"], [[0, 3, 7, 10], "minor 7th", "m7"],
  [[0, 3, 6, 10], "half-diminished", "m7♭5"], [[0, 3, 6, 9], "diminished 7th", "dim7"], [[0, 3, 7, 11], "minor-major 7th", "mMaj7"],
  [[0, 4, 8, 10], "augmented 7th", "aug7"], [[0, 4, 8, 11], "augmented major 7th", "augMaj7"], [[0, 4, 7, 9], "6th", "6"], [[0, 3, 7, 9], "minor 6th", "m6"],
];
export interface ChordName { symbol: string; quality: string; root: number }
/** Names a chord from its notes; tries every note as a candidate root so inversions still resolve. */
export function nameChord(notes: number[]): ChordName {
  const pcs = [...new Set(notes.map(pc))];
  for (const candidate of pcs) {
    const rel = pcs.map((p) => pc(p - candidate)).sort((a, b) => a - b);
    const hit = QUALITIES.find(([shape]) => shape.length === rel.length && shape.every((v, i) => v === rel[i]));
    if (hit) return { symbol: `${NOTE_NAMES[candidate]}${hit[2]}`, quality: hit[1], root: candidate };
  }
  const low = pc(Math.min(...notes));
  return { symbol: `${NOTE_NAMES[low]}?`, quality: "unnamed", root: low };
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export function romanNumeral(degree: number, quality: string): string {
  const base = ROMAN[degree % ROMAN.length];
  if (/minor|half|diminished/.test(quality) && quality !== "minor-major 7th") return base.toLowerCase() + (quality === "diminished" || quality === "diminished 7th" ? "°" : quality === "half-diminished" ? "ø" : "");
  return base + (quality.startsWith("augmented") ? "+" : "");
}

export interface Progression { name: string; degrees: number[]; mode?: "major" | "minor" }
export const PROGRESSIONS: Progression[] = [
  { name: "Pop — I V vi IV", degrees: [1, 5, 6, 4], mode: "major" },
  { name: "50s — I vi IV V", degrees: [1, 6, 4, 5], mode: "major" },
  { name: "Emotional — vi IV I V", degrees: [6, 4, 1, 5], mode: "major" },
  { name: "Canon — I V vi iii IV I IV V", degrees: [1, 5, 6, 3, 4, 1, 4, 5], mode: "major" },
  { name: "Jazz — ii V I", degrees: [2, 5, 1], mode: "major" },
  { name: "Blues — I IV I V IV I", degrees: [1, 4, 1, 5, 4, 1], mode: "major" },
  { name: "Andalusian — i VII VI V", degrees: [1, 7, 6, 5], mode: "minor" },
  { name: "Minor pop — i VI III VII", degrees: [1, 6, 3, 7], mode: "minor" },
  { name: "Dark — i iv v", degrees: [1, 4, 5], mode: "minor" },
  { name: "Dub — i VII", degrees: [1, 7], mode: "minor" },
];

const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];
export function camelot(root: number, mode: "major" | "minor"): string { return (mode === "major" ? CAMELOT_MAJOR : CAMELOT_MINOR)[pc(root)]; }
export function relativeKey(root: number, mode: "major" | "minor"): { root: number; mode: "major" | "minor" } {
  return mode === "major" ? { root: pc(root + 9), mode: "minor" } : { root: pc(root + 3), mode: "major" };
}
