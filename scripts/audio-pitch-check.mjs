// Node unit run for src/scripts/site/audio/pitch.ts.
// Usage: node --experimental-strip-types scripts/audio-pitch-check.mjs
import { detectPitch, nearestNote } from '../src/scripts/site/audio/pitch.ts'
let failed = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }
const tone = (hz, rate = 48000, n = 4096, harmonics = [1, 0.5, 0.25]) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) { let v = 0; harmonics.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * hz * (k + 1) * i / rate) }); x[i] = v * 0.3 } return x }
for (const hz of [55, 110, 220, 440, 659.25, 1046.5]) {
  const p = detectPitch(tone(hz), 48000)
  check(`detects ${hz} Hz`, p && Math.abs(p.hz - hz) / hz < 0.003, p ? `${p.hz.toFixed(2)} Hz clarity ${p.clarity.toFixed(2)}` : 'null')
}
check('silence returns null', detectPitch(new Float32Array(4096), 48000) === null)
const noise = new Float32Array(4096); for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.3
check('white noise returns null or low clarity', (() => { const p = detectPitch(noise, 48000); return p === null || p.clarity < 0.7 })())
const n = nearestNote(446)
check('446 Hz is A4 +23 cents', n.name === 'A' && n.octave === 4 && Math.round(n.cents) === 23, `${n.name}${n.octave} ${n.cents.toFixed(1)}`)
check('432 reference shifts the reading', Math.abs(nearestNote(432, 432).cents) < 0.01)
console.log(failed ? `${failed} FAILED` : 'all green')
process.exit(failed ? 1 : 0)
