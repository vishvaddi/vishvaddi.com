// Node unit run for src/scripts/site/audio/ear-core.ts.
// Usage: node --experimental-strip-types scripts/audio-ear-check.mjs
import { EXERCISES, DEFAULT_SETTINGS, INTERVALS, CHORDS, PITCH_LABELS, mulberry32, staffNote, CLEF_BASE_STEP, fretPositions, TUNING } from '../src/scripts/site/audio/ear-core.ts'
let failed = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }
const rng = mulberry32(42)
const settings = { ...DEFAULT_SETTINGS, accidentals: true, inversions: true, intervals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], chords: Object.keys(CHORDS) }

for (const ex of EXERCISES) {
  let ok = true, detail = ''
  for (let i = 0; i < 300 && ok; i++) {
    for (const view of ex.views) {
      const q = ex.make(settings, view, rng)
      if (!q.choices.includes(q.answer)) { ok = false; detail = `${view}: answer ${q.answer} not in choices`; break }
      if (new Set(q.choices).size !== q.choices.length) { ok = false; detail = `${view}: duplicate choices`; break }
      if (q.choices.length < 4) { ok = false; detail = `${view}: only ${q.choices.length} choices`; break }
      if (view !== 'ear' && !q.notes.length) { ok = false; detail = `${view}: no notes to draw`; break }
      if (view === 'ear' && !q.audio) { ok = false; detail = 'ear question without audio'; break }
      if (ex.id === 'interval' || ex.id === 'intervalEar') {
        const semis = Math.abs(q.notes[1] - q.notes[0])
        if (INTERVALS[semis][0] !== q.answer) { ok = false; detail = `interval mismatch ${semis} vs ${q.answer}`; break }
      }
      if (ex.id === 'note') {
        const pc = ((q.notes[0] % 12) + 12) % 12
        if (PITCH_LABELS[pc] !== q.answer) { ok = false; detail = `note mismatch`; break }
      }
      if (ex.id === 'chord') {
        const root = q.notes[0], rel = [...new Set(q.notes.map((n) => ((n - root) % 12 + 12) % 12))].sort((a, b) => a - b)
        const matches = Object.values(CHORDS).filter((c) => { for (let inv = 0; inv < c.intervals.length; inv++) { const base = c.intervals[inv]; const set = [...new Set(c.intervals.map((x) => ((x - base) % 12 + 12) % 12))].sort((a, b) => a - b); if (set.length === rel.length && set.every((v, k) => v === rel[k])) return true } return false }).map((c) => c.label)
        if (!matches.includes(q.answer)) { ok = false; detail = `chord ${q.answer} not consistent with notes ${q.notes.join(' ')}`; break }
      }
      if (ex.id === 'rhythm') {
        if (!q.rhythmChoices || q.rhythmChoices.length !== 4) { ok = false; detail = 'rhythm needs four patterns'; break }
        if (!q.audio.cells[0]) { ok = false; detail = 'rhythm must start on the downbeat'; break }
      }
      if (view === 'fretboard' && !fretPositions(q.notes, rng)) { ok = false; detail = `no fretboard placement for ${q.notes.join(' ')}`; break }
      if (view === 'staff') { const pos = q.notes.map((n) => staffNote(n).step - CLEF_BASE_STEP[settings.clef]); if (pos.some((p) => p < -8 || p > 18)) { ok = false; detail = `staff position out of range ${pos.join(' ')}`; break } }
    }
  }
  check(`${ex.name}: 300 questions are consistent across ${ex.views.join('/')}`, ok, detail)
}
check('staffNote spells C#4 as C with a sharp on the C4 step', staffNote(61).accidental === '♯' && staffNote(61).step === staffNote(60).step)
check('E4 sits on the treble bottom line', staffNote(64).step === CLEF_BASE_STEP.treble)
const pos = fretPositions([40, 47, 52], mulberry32(1))
check('fretboard places an E power chord on three strings', pos && new Set(pos.map((p) => p.string)).size === 3 && pos.every((p) => TUNING[p.string] + p.fret === [40, 47, 52][pos.indexOf(p)]))
const a = mulberry32(7), b = mulberry32(7)
check('seeded rng is reproducible', a() === b() && a() === b())
console.log(failed ? `${failed} FAILED` : 'all green')
process.exit(failed ? 1 : 0)
