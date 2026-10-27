import { test } from 'node:test'
import assert from 'node:assert/strict'
import { musicalState, musicalPattern, musicalChord, fretMidi, FIFTHS } from '../src/scripts/site/audio/combinator-model.ts'
import { safeEarSettings, DEFAULT_SETTINGS, exerciseById, mulberry32 } from '../src/scripts/site/audio/ear-core.ts'
import { investmentSchedules } from '../src/scripts/site/investment-model.ts'

test('C major progression and inverted sevenths produce concrete MIDI pitches', () => {
  const s = musicalState({ degrees: [0, 4, 5, 3] })
  assert.deepEqual(musicalChord(s, 0), [48, 52, 55])
  assert.deepEqual(musicalChord(s, 5), [57, 60, 64])
  assert.deepEqual(musicalChord(musicalState({ size: 4, inversion: 1 }), 0), [52, 55, 59, 60])
  const notes = musicalPattern(s)
  assert.equal(notes.length, 12)
  assert.deepEqual([...new Set(notes.map(n => n.beat))], [0, 4, 8, 12])
})
test('swung arpeggio is ordered, bounded, and repeats across octaves', () => {
  const notes = musicalPattern(musicalState({ degrees: [0], arp: 'up', rate: .5, swing: .6, gate: 1, octaves: 2 }))
  assert.deepEqual(notes.slice(0, 6).map(n => n.midi), [48, 52, 55, 60, 64, 67])
  assert.equal(notes[1].beat, .8)
  assert.equal(notes.length, 8)
  assert.ok(notes.every(n => n.beat + n.duration <= 4 && n.duration > 0))
  assert.ok(notes.slice(0, -1).every((n, i) => n.beat + n.duration <= notes[i + 1].beat + 1e-9))
  assert.deepEqual(musicalPattern(musicalState({ degrees: [0], arp: 'down' })).slice(0, 3).map(n => n.midi), [55, 52, 48])
})
test('malformed links and old settings cannot inject notes or non-finite timing', () => {
  for (const value of [null, [], { root: NaN, gate: Infinity, scale: 'missing', degrees: [null, -1, 99, 0], rate: 0 }]) {
    const s = musicalState(value)
    assert.ok(musicalPattern(s).every(n => Number.isFinite(n.midi + n.beat + n.duration)))
  }
  assert.deepEqual(safeEarSettings({ intervals: [null, 999], chords: ['missing'], eqBands: [] }), DEFAULT_SETTINGS)
  assert.equal(new Set(FIFTHS).size, 12)
  assert.equal(fretMidi(0, 0, 'dropD'), 38)
  assert.equal(fretMidi(5, 12, 'standard'), 76)
})
test('new exercises have unambiguous answer sets', () => {
  const rng = mulberry32(3)
  for (const id of ['keySignature', 'scale']) for (let i = 0; i < 100; i++) {
    const e = exerciseById(id), q = e.make(DEFAULT_SETTINGS, e.views[0], rng)
    assert.ok(q.choices.includes(q.answer)); assert.equal(new Set(q.choices).size, q.choices.length)
  }
})
const base = { contribution: 100, periods: 12, savingsRate: 0, returnRate: 0, brokerage: 0, years: 1 }
test('zero-rate schedules conserve contributions and account for fees exactly', () => {
  assert.ok(investmentSchedules(base).every(r => r.total === 1200))
  const r = investmentSchedules({ ...base, brokerage: 5 })
  assert.equal(r[1].total, 1140); assert.equal(r[1].fees, 60)
  assert.equal(r[12].total, 1195); assert.equal(r[12].purchases, 1)
})
test('compounding uses end-period contributions and retains residual cash', () => {
  const r = investmentSchedules({ ...base, periods: 12, returnRate: 12 })
  const expected = 100 * ((1.12 - 1) / (1.12 ** (1 / 12) - 1))
  assert.ok(Math.abs(r[1].total - expected) < 1e-7)
  assert.equal(r[5].cash, 200)
  const costly = investmentSchedules({ ...base, brokerage: 2000 })
  assert.ok(costly.every(r => r.total === 1200 && r.fees === 0))
})
test('negative returns and invalid inputs are handled without false optimum claims', () => {
  const r = investmentSchedules({ ...base, returnRate: -50 })
  assert.ok(r[0].total >= Math.max(...r.map(x => x.total)))
  for (const patch of [{ returnRate: -100 }, { years: 1.5 }, { contribution: NaN }, { brokerage: -1 }, { periods: 365 }]) assert.throws(() => investmentSchedules({ ...base, ...patch }), RangeError)
})
