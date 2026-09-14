import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestLoad, epley, bestE1rm, nextDayId, trends, defaultProgramme, roundTo, weekSummary } from '../src/scripts/site/training-model.ts'

const squat = { id: 'squat', name: 'Back squat', sets: 3, repsMin: 5, repsMax: 5, startKg: 60, incrementKg: 5, roundKg: 2.5 }
const entry = (sets) => ({ exerciseId: 'squat', name: 'Back squat', sets })

test('first session starts at the programme weight', () => {
  assert.deepEqual(suggestLoad(squat, null).kg, 60)
  assert.equal(suggestLoad(squat, null).verdict, 'start')
})

test('all sets at top reps under the easy RPE adds the increment; clearly easy doubles it', () => {
  const easy = suggestLoad(squat, entry([{ kg: 60, reps: 5, rpe: 7 }, { kg: 60, reps: 5, rpe: 7 }, { kg: 60, reps: 5, rpe: 7 }]))
  assert.equal(easy.kg, 65)
  assert.equal(easy.verdict, 'progress')
  const veryEasy = suggestLoad(squat, entry([{ kg: 60, reps: 5, rpe: 5 }, { kg: 60, reps: 5, rpe: 6 }, { kg: 60, reps: 5, rpe: 6 }]))
  assert.equal(veryEasy.kg, 70)
  const noRpe = suggestLoad(squat, entry([{ kg: 60, reps: 5, rpe: null }, { kg: 60, reps: 5, rpe: null }, { kg: 60, reps: 5, rpe: null }]))
  assert.equal(noRpe.kg, 65)
})

test('a top set at or above the hard RPE holds; a missed set deloads 5% rounded to the plate step', () => {
  const hard = suggestLoad(squat, entry([{ kg: 100, reps: 5, rpe: 8 }, { kg: 100, reps: 5, rpe: 9.5 }, { kg: 100, reps: 5, rpe: 9 }]))
  assert.equal(hard.kg, 100)
  assert.equal(hard.verdict, 'hold')
  const missed = suggestLoad(squat, entry([{ kg: 100, reps: 5, rpe: 9 }, { kg: 100, reps: 4, rpe: 10 }, { kg: 100, reps: 3, rpe: 10 }]))
  assert.equal(missed.kg, 95)
  assert.equal(missed.verdict, 'deload')
  const short = suggestLoad(squat, entry([{ kg: 100, reps: 5, rpe: 8 }]))
  assert.equal(short.verdict, 'deload', 'fewer sets than programmed counts as missed')
})

test('inside a rep range with room to grow holds the load', () => {
  const row = { ...squat, id: 'row', repsMin: 8, repsMax: 10, incrementKg: 2.5 }
  const s = suggestLoad(row, entry([{ kg: 40, reps: 9, rpe: 8 }, { kg: 40, reps: 8, rpe: 8 }, { kg: 40, reps: 8, rpe: 8.5 }]))
  assert.equal(s.kg, 40)
  assert.equal(s.verdict, 'hold')
})

test('epley and rounding', () => {
  assert.equal(Math.round(epley(100, 5)), 117)
  assert.equal(epley(100, 1), 100)
  assert.equal(bestE1rm([{ kg: 100, reps: 5, rpe: null }, { kg: 90, reps: 10, rpe: null }]), 120)
  assert.equal(roundTo(63.4, 2.5), 62.5)
  assert.equal(roundTo(18.7, 2), 18)
})

test('day rotation and trends', () => {
  const days = defaultProgramme()
  assert.equal(nextDayId(days, []), 'a')
  const sessions = [
    { id: '1', date: '2026-09-01', dayId: 'a', dayName: 'A', entries: [entry([{ kg: 60, reps: 5, rpe: 7 }])] },
    { id: '2', date: '2026-09-03', dayId: 'b', dayName: 'B', entries: [] },
  ]
  assert.equal(nextDayId(days, sessions), 'c')
  const t = trends({ days, sessions, settings: { rpeEasy: 7, rpeHard: 9.5, deloadPct: 5 } })
  assert.equal(t.length, 1)
  assert.equal(t[0].points[0].e1rm, 70)
  assert.deepEqual(weekSummary(sessions, '2026-09-04'), { sessions: 2, sets: 1, volume: 300 })
})
