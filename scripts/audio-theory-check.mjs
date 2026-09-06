// Node unit run for src/scripts/site/audio/theory.ts (pure, no bundler needed).
// Usage: node --experimental-strip-types scripts/audio-theory-check.mjs
import { diatonicChord, diatonicChordFrom, invert, nameChord, quantiseToScale, romanNumeral, camelot, relativeKey, voice, nameToMidi } from '../src/scripts/site/audio/theory.ts'
let failed = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); if (!ok) failed++ }
eq('C major I triad', diatonicChord(0, 'major', 0, 3, 4), [60, 64, 67])
eq('C major V7', diatonicChord(0, 'major', 4, 4, 4), [67, 71, 74, 77])
eq('A minor ii names as Bdim', nameChord(diatonicChord(9, 'minor', 1, 3, 4)).symbol, 'Bdim')
eq('A minor ii numeral', romanNumeral(1, nameChord(diatonicChord(9, 'minor', 1, 3, 4)).quality), 'ii°')
eq('first inversion of C', invert([60, 64, 67], 1), [64, 67, 72])
eq('inverted chord still names as C', nameChord(invert([60, 64, 67], 1)).symbol, 'C')
eq('quantise C# to C major lands on C', quantiseToScale(61, 0, 'major'), 60)
eq('quantise leaves scale tones alone', quantiseToScale(64, 0, 'major'), 64)
eq('diatonic chord from E in C major is Em', nameChord(diatonicChordFrom(64, 0, 'major', 3)).symbol, 'Em')
eq('harmonic minor V is major', nameChord(diatonicChord(9, 'harmonicMinor', 4, 3, 4)).symbol, 'E')
eq('drop2 keeps four notes', voice([60, 64, 67, 71], 'drop2').length, 4)
eq('Camelot A minor', camelot(9, 'minor'), '8A')
eq('relative of A minor is C major', relativeKey(9, 'minor'), { root: 0, mode: 'major' })
eq('nameToMidi A#3', nameToMidi('A#3'), 58)
console.log(failed ? `${failed} FAILED` : 'all green')
process.exit(failed ? 1 : 0)
