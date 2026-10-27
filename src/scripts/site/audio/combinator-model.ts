import { diatonicChord, invert, pc, scaleById, SCALES, voice } from './theory.ts';
import type { Voicing } from './theory.ts';

export interface MusicalState {
  root: number; scale: string; octave: number; size: number; inversion: number; voicing: Voicing;
  arp: 'off' | 'up' | 'down' | 'updown'; rate: number; octaves: number; swing: number; gate: number;
  degrees: number[]; tuning: 'standard' | 'dropD'; left: boolean; labels: 'notes' | 'degrees';
}
export interface MusicalNote { midi: number; beat: number; duration: number }
export const MUSICAL_DEFAULTS: MusicalState = {
  root: 0, scale: 'major', octave: 3, size: 3, inversion: 0, voicing: 'close',
  arp: 'off', rate: .5, octaves: 1, swing: 0, gate: .8, degrees: [0, 4, 5, 3],
  tuning: 'standard', left: false, labels: 'notes',
};
export function musicalState(value: unknown): MusicalState {
  const v = value && typeof value === 'object' ? value as Partial<MusicalState> : {};
  const n = (x: unknown, min: number, max: number, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
  const scale = SCALES.some(s => s.id === v.scale) ? v.scale! : 'major';
  return {
    root: Math.round(n(v.root, 0, 11, 0)), scale, octave: Math.round(n(v.octave, 2, 5, 3)),
    size: v.size === 4 ? 4 : 3, inversion: Math.round(n(v.inversion, 0, v.size === 4 ? 3 : 2, 0)),
    voicing: ['close', 'open', 'drop2', 'spread'].includes(v.voicing!) ? v.voicing! : 'close',
    arp: ['off', 'up', 'down', 'updown'].includes(v.arp!) ? v.arp! : 'off',
    rate: [1, .5, .25].includes(v.rate!) ? v.rate! : .5, octaves: Math.round(n(v.octaves, 1, 3, 1)),
    swing: n(v.swing, 0, .6, 0), gate: n(v.gate, .1, 1, .8),
    degrees: Array.isArray(v.degrees) ? v.degrees.filter(d => Number.isInteger(d) && d >= 0 && d < scaleById(scale).steps.length).slice(0, 16) : [...MUSICAL_DEFAULTS.degrees],
    tuning: v.tuning === 'dropD' ? 'dropD' : 'standard', left: v.left === true, labels: v.labels === 'degrees' ? 'degrees' : 'notes',
  };
}
export function musicalChord(state: MusicalState, degree: number): number[] {
  return voice(invert(diatonicChord(state.root, state.scale, degree, state.size, state.octave), state.inversion), state.voicing).filter(n => n >= 0 && n <= 127);
}
export function musicalPattern(input: MusicalState): MusicalNote[] {
  const s = musicalState(input), events: MusicalNote[] = [];
  s.degrees.forEach((degree, bar) => {
    const chord = musicalChord(s, degree);
    if (s.arp === 'off') { chord.forEach(midi => events.push({ midi, beat: bar * 4, duration: 4 * s.gate })); return; }
    let order = Array.from({ length: s.octaves }, (_, octave) => chord.map(n => n + octave * 12)).flat().filter(n => n <= 127).sort((a, b) => a - b);
    if (s.arp === 'down') order.reverse();
    if (s.arp === 'updown') order = [...order, ...order.slice(1, -1).reverse()];
    for (let i = 0; i < 4 / s.rate; i++) {
      const offset = i % 2 ? s.swing * s.rate : 0;
      const spacing = s.rate * (i % 2 ? 1 - s.swing : 1 + s.swing);
      events.push({ midi: order[i % order.length], beat: bar * 4 + i * s.rate + offset, duration: Math.min(spacing * s.gate, 4 - i * s.rate - offset) });
    }
  });
  return events;
}
export const fretMidi = (string: number, fret: number, tuning: MusicalState['tuning']): number => [tuning === 'dropD' ? 38 : 40, 45, 50, 55, 59, 64][string] + fret;
export const FIFTHS = Array.from({ length: 12 }, (_, i) => pc(i * 7));
