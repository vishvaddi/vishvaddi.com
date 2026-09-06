// /audio tools functional gate. Drives the real pages in system Chrome via
// playwright-core: hub renders and searches, the analyser measures a synthetic
// file of known tempo, key and level through the browser's own decoder, and
// the built-in test tone path agrees with it.
// Usage: node scripts/audio-tools-e2e.mjs [baseURL|dist]   (default http://localhost:4321)
import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'
import { parseSmf } from './smf-parse.mjs'
import { readFileSync } from 'node:fs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4403) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://localhost:4321'
const results = []
let failed = 0
const check = (name, ok, detail = '') => { results.push(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++ }

// 16-bit stereo WAV: 132 BPM kick + D minor pad, peak scaled to −6 dBFS.
function makeWav({ seconds = 24, rate = 44100, bpm = 132, rootMidi = 62, peakDb = -6 } = {}) {
  const n = rate * seconds, beat = (60 / bpm) * rate
  const freqs = [0, 3, 7, 12, 15].map((s) => 440 * Math.pow(2, (rootMidi + s - 69) / 12))
  const l = new Float64Array(n), r = new Float64Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const t = i / rate, inBeat = (i % beat) / rate
    const kick = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 9)
    let pad = 0; freqs.forEach((f, k) => { pad += Math.sin(2 * Math.PI * f * t + k) / (freqs.length * 1.5) })
    l[i] = kick + pad * 0.35; r[i] = kick + pad * 0.3
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
  }
  const gain = Math.pow(10, peakDb / 20) / peak
  const out = Buffer.alloc(44 + n * 4)
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22)
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) { out.writeInt16LE(Math.round(l[i] * gain * 32767), 44 + i * 4); out.writeInt16LE(Math.round(r[i] * gain * 32767), 46 + i * 4) }
  return out
}

// Reads a 16-bit PCM WAV download back into channels for assertions.
function readWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const channels = dv.getUint16(22, true), rate = dv.getUint32(24, true), bits = dv.getUint16(34, true)
  let p = 12
  while (p < bytes.length - 8) { const id = String.fromCharCode(...bytes.slice(p, p + 4)), len = dv.getUint32(p + 4, true); if (id === 'data') { p += 8; break } p += 8 + len }
  const frames = Math.floor((bytes.length - p) / (channels * bits / 8))
  const out = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) { out[c][i] = dv.getInt16(p, true) / 32768; p += 2 }
  return { channels: out, rate, frames }
}
const goertzel = (x, rate, hz) => { const w = 2 * Math.PI * hz / rate, c = 2 * Math.cos(w); let s0 = 0, s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0 } return s1 * s1 + s2 * s2 - c * s1 * s2 }
const peakDb = (chs) => { let p = 0; for (const x of chs) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return 20 * Math.log10(p) }
// Stereo WAV: 1 kHz tone dead centre + 3 kHz tone in anti-phase (pure side), 1 s of silence either end, peak −6 dBFS.
function makeCentreWav(rate = 44100, seconds = 6) {
  const n = rate * seconds, l = new Float64Array(n), r = new Float64Array(n)
  for (let i = rate; i < n - rate; i++) { const t = i / rate, centre = Math.sin(2 * Math.PI * 1000 * t) * 0.5, side = Math.sin(2 * Math.PI * 3000 * t) * 0.25; l[i] = centre + side; r[i] = centre - side }
  const peak = 0.75, gain = Math.pow(10, -6 / 20) / peak
  const out = Buffer.alloc(44 + n * 4)
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22)
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) { out.writeInt16LE(Math.round(l[i] * gain * 32767), 44 + i * 4); out.writeInt16LE(Math.round(r[i] * gain * 32767), 46 + i * 4) }
  return out
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const page = await ctx.newPage()
const consoleErrors = []
const NOISE = /sw\.js|cloudflareinsights|ERR_FAILED|Outdated Optimize Dep/
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(e.stack ?? String(e)))

const readStats = () => page.evaluate(() => {
  const num = (id) => parseFloat(document.getElementById(id)?.textContent ?? 'NaN')
  return {
    bpm: num('au-bpm'), key: document.getElementById('au-key')?.textContent, camelot: document.getElementById('au-camelot')?.textContent,
    lufs: num('au-lufs'), tp: num('au-tp'), lra: num('au-lra'), corr: num('au-corr'), width: num('au-width'),
    file: document.getElementById('au-file')?.textContent, targets: document.querySelectorAll('#au-targets tr').length,
    bands: document.querySelectorAll('.au-band').length, waveW: document.getElementById('au-wave')?.width,
  }
})

try {
  // ── hub ──
  await page.goto(`${BASE}/audio/`, { waitUntil: 'domcontentloaded' })
  check('hub: renders the analyser card', await page.locator('.tool-card[data-tool="/audio/analyser"]').count() === 1)
  check('hub: no site-tools rail on the hub itself', await page.locator('.site-rail').count() === 0)
  await page.fill('#site-hub-search', 'zzzz')
  check('hub: search empties the grid', await page.locator('#site-search-empty').isVisible())
  await page.fill('#site-hub-search', 'lufs')
  check('hub: search finds by alias', await page.locator('[data-tool-item]:not([hidden]) .tool-card[data-tool="/audio/analyser"]').count() === 1 && await page.locator('[data-tool-item]:not([hidden])').count() < 4)

  // ── analyser: rail + file path ──
  await page.goto(`${BASE}/audio/analyser/`, { waitUntil: 'domcontentloaded' })
  check('analyser: audio rail is shown with the hub link', await page.locator('.site-rail .site-nav-all[href="/audio"]').count() === 1)
  check('analyser: rail marks this tool active', (await page.locator('.site-rail a.active').textContent()) === 'Analyser')
  check('analyser: nav More menu links the hub', await page.locator('.nav-more-menu a[href="/audio"]').count() === 1)
  await page.setInputFiles('#au-file-input', { name: 'probe.wav', mimeType: 'audio/wav', buffer: makeWav() })
  await page.waitForSelector('#au-results:not([hidden])', { timeout: 60000 })
  const wav = await readStats()
  check('analyser: file name and format are reported', /probe\.wav .* decoded at \d+ Hz .* stereo/.test(wav.file ?? ''), wav.file)
  check('analyser: tempo within 1 BPM of 132', Math.abs(wav.bpm - 132) <= 1, String(wav.bpm))
  check('analyser: key is D minor or its relative F major', /^(D minor|F major)$/.test(wav.key ?? ''), wav.key)
  check('analyser: camelot matches the key', (wav.key === 'D minor' && wav.camelot === '7A') || (wav.key === 'F major' && wav.camelot === '7B'), wav.camelot)
  check('analyser: true peak within 0.6 dB of the −6 dBFS sample peak', wav.tp >= -6.2 && wav.tp <= -5.4, String(wav.tp))
  check('analyser: integrated loudness is plausible for the tone', wav.lufs < -8 && wav.lufs > -30, String(wav.lufs))
  check('analyser: loudness range is small for a steady loop', wav.lra >= 0 && wav.lra < 6, String(wav.lra))
  check('analyser: stereo correlation is high for near-identical channels', wav.corr > 0.9, String(wav.corr))
  check('analyser: six platform rows', wav.targets === 6, String(wav.targets))
  check('analyser: six tonal bands', wav.bands === 6, String(wav.bands))
  check('analyser: waveform canvas painted', (wav.waveW ?? 0) > 100, String(wav.waveW))
  const gainCell = await page.locator('#au-targets tr').first().locator('td').nth(3).textContent()
  const expectedGain = -14 - wav.lufs
  check('analyser: Spotify gain column equals −14 minus LUFS', Math.abs(parseFloat(gainCell) - expectedGain) < 0.15, `${gainCell} vs ${expectedGain.toFixed(1)}`)

  // ── analyser: built-in test tone ──
  await page.click('#au-demo')
  await page.waitForFunction(() => /test tone/.test(document.getElementById('au-file')?.textContent ?? ''), null, { timeout: 60000 })
  await page.waitForSelector('#au-results:not([hidden])', { timeout: 60000 })
  const tone = await readStats()
  check('test tone: tempo reads 128', Math.abs(tone.bpm - 128) <= 1, String(tone.bpm))
  check('test tone: key is A minor or C major', /^(A minor|C major)$/.test(tone.key ?? ''), tone.key)

  // ── report export ──
  const dl = page.waitForEvent('download', { timeout: 10000 })
  await page.click('#au-json')
  const file = await dl
  check('export: JSON download is offered', /analysis\.json$/.test(file.suggestedFilename()), file.suggestedFilename())

  // ── chord lab ──
  await page.goto(`${BASE}/audio/chords/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('vv_audio_chords_v1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.selectOption('#ch-root', '9')
  await page.selectOption('#ch-scale', 'minor')
  const symbols = await page.locator('#ch-chords .ch-symbol').allTextContents()
  check('chords: A minor lists seven diatonic triads', symbols.join(' ') === 'Am Bdim C Dm Em F G', symbols.join(' '))
  const numerals = await page.locator('#ch-chords .ch-numeral').allTextContents()
  check('chords: numerals carry quality', numerals.join(' ') === 'i ii° III iv v VI VII', numerals.join(' '))
  check('chords: key line shows Camelot 8A and the relative major', /8A.*C major.*8B/.test((await page.locator('#ch-key-meta').textContent()) ?? ''), await page.locator('#ch-key-meta').textContent())
  check('chords: keyboard highlights seven scale tones per octave', await page.locator('#ch-keys .ch-key.on').count() === 14, String(await page.locator('#ch-keys .ch-key.on').count()))
  await page.selectOption('#ch-size', '4')
  const sevenths = await page.locator('#ch-chords .ch-symbol').allTextContents()
  check('chords: sevenths rename the chords', sevenths[0] === 'Am7' && sevenths[1] === 'Bm7♭5' && sevenths[2] === 'Cmaj7' && sevenths[4] === 'Em7', sevenths.join(' '))
  await page.selectOption('#ch-size', '3')
  await page.selectOption('#ch-preset', '6') // Andalusian i VII VI V
  const slots = await page.locator('.ch-slot strong').allTextContents()
  check('chords: preset builds the progression', slots.join(' ') === 'Am G F Em', slots.join(' '))
  await page.click('#ch-play')
  await page.waitForTimeout(600)
  check('chords: playback runs and lights the current chord', (await page.locator('#ch-play').getAttribute('aria-pressed')) === 'true' && await page.locator('.ch-slot.playing').count() === 1)
  await page.click('#ch-play')
  const chordDl = page.waitForEvent('download', { timeout: 10000 })
  await page.click('#ch-midi')
  const chordFile = await chordDl
  const smf = parseSmf(new Uint8Array(readFileSync(await chordFile.path())))
  const chordsTrack = smf.tracks.find((t) => t.name === 'Chords'), bassTrack = smf.tracks.find((t) => t.name === 'Bass')
  check('chords: MIDI has 12 chord notes and 4 bass notes at 120 BPM', smf.ok && chordsTrack?.noteOns === 12 && bassTrack?.noteOns === 4 && Math.abs((smf.bpm ?? 0) - 120) < 0.5, `${chordsTrack?.noteOns}/${bassTrack?.noteOns} @ ${smf.bpm}`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('chords: progression survives reload', await page.locator('.ch-slot').count() === 4)

  // ── sample prep ──
  await page.goto(`${BASE}/audio/prep/`, { waitUntil: 'domcontentloaded' })
  await page.setInputFiles('#pp-input', { name: 'centre.wav', mimeType: 'audio/wav', buffer: makeCentreWav() })
  await page.waitForFunction(() => /BPM/.test(document.querySelector('.pp-item-meta')?.textContent ?? ''), null, { timeout: 30000 })
  check('prep: file decodes and reports level', /6\.00 s .* peak -6\.\d dBFS/.test((await page.locator('.pp-item-meta').textContent()) ?? ''), await page.locator('.pp-item-meta').textContent())
  // recipe 1: trim + fade + peak normalise to −1 dB
  await page.check('#pp-trim'); await page.fill('#pp-fade-in', '50'); await page.fill('#pp-fade-out', '50')
  await page.selectOption('#pp-norm', 'peak'); await page.fill('#pp-peak-db', '-1')
  await page.click('#pp-process')
  await page.waitForFunction(() => /Done/.test(document.getElementById('pp-status')?.textContent ?? ''), null, { timeout: 60000 })
  let ppDl = page.waitForEvent('download', { timeout: 15000 })
  await page.locator('.pp-item .btn', { hasText: 'Download' }).click()
  let ppWav = readWav(new Uint8Array(readFileSync(await (await ppDl).path())))
  check('prep: trim removes the two seconds of silence', Math.abs(ppWav.frames / ppWav.rate - 4) < 0.05, `${(ppWav.frames / ppWav.rate).toFixed(3)} s`)
  check('prep: peak normalised to −1 dBFS', Math.abs(peakDb(ppWav.channels) + 1) < 0.15, peakDb(ppWav.channels).toFixed(2))
  check('prep: fade-in starts quiet', Math.abs(ppWav.channels[0][40]) < 0.05, String(ppWav.channels[0][40]))
  const decodedHz = Number(/(\d+) Hz/.exec((await page.locator('.pp-item-meta').textContent()) ?? '')?.[1])
  check('prep: download keeps the decoded sample rate', ppWav.rate === decodedHz, `${ppWav.rate} vs decoded ${decodedHz}`)
  // recipe 2: centre removal only
  await page.uncheck('#pp-trim'); await page.fill('#pp-fade-in', '0'); await page.fill('#pp-fade-out', '0'); await page.selectOption('#pp-norm', 'off')
  await page.check('#pp-centre')
  await page.click('#pp-process')
  await page.waitForFunction(() => /Done/.test(document.getElementById('pp-status')?.textContent ?? ''), null, { timeout: 60000 })
  ppDl = page.waitForEvent('download', { timeout: 15000 })
  await page.locator('.pp-item .btn', { hasText: 'Download' }).click()
  ppWav = readWav(new Uint8Array(readFileSync(await (await ppDl).path())))
  const mid = ppWav.channels[0].subarray(ppWav.rate * 2, ppWav.rate * 3)
  const centreLeft = goertzel(mid, ppWav.rate, 1000), sideLeft = goertzel(mid, ppWav.rate, 3000)
  check('prep: centre removal kills the 1 kHz centre tone and keeps the 3 kHz side tone', sideLeft > 0 && centreLeft / sideLeft < 0.01, `ratio ${(centreLeft / sideLeft).toExponential(2)}`)
  // recipe 3: stretch to 150 % (length only)
  await page.uncheck('#pp-centre'); await page.fill('#pp-stretch', '150')
  await page.click('#pp-process')
  await page.waitForFunction(() => /Done/.test(document.getElementById('pp-status')?.textContent ?? ''), null, { timeout: 60000 })
  ppDl = page.waitForEvent('download', { timeout: 15000 })
  await page.locator('.pp-item .btn', { hasText: 'Download' }).click()
  ppWav = readWav(new Uint8Array(readFileSync(await (await ppDl).path())))
  check('prep: 150 % stretch lengthens by half', Math.abs(ppWav.frames / ppWav.rate - 9) < 0.15, `${(ppWav.frames / ppWav.rate).toFixed(3)} s`)
  const stretched = ppWav.channels[0].subarray(ppWav.rate * 3, ppWav.rate * 4)
  check('prep: stretch keeps pitch (1 kHz still dominant over 1.5 kHz)', goertzel(stretched, ppWav.rate, 1000) > 20 * goertzel(stretched, ppWav.rate, 1500), '')
  // recipe 4: MP3 output
  await page.fill('#pp-stretch', '100'); await page.selectOption('#pp-format', 'mp3')
  await page.click('#pp-process')
  await page.waitForFunction(() => /Done/.test(document.getElementById('pp-status')?.textContent ?? ''), null, { timeout: 60000 })
  ppDl = page.waitForEvent('download', { timeout: 30000 })
  await page.locator('.pp-item .btn', { hasText: 'Download' }).click()
  const mp3 = await ppDl
  const mp3Bytes = readFileSync(await mp3.path())
  check('prep: MP3 export produces an MPEG stream', /\.mp3$/.test(mp3.suggestedFilename()) && mp3Bytes.length > 20_000 && (mp3Bytes[0] === 0xff || mp3Bytes.toString('latin1', 0, 3) === 'ID3'), `${mp3.suggestedFilename()} ${mp3Bytes.length} bytes`)

  // ── bpm maths ──
  await page.goto(`${BASE}/audio/bpm/`, { waitUntil: 'domcontentloaded' })
  await page.fill('#bm-bpm', '120'); await page.dispatchEvent('#bm-bpm', 'input')
  const quarter = await page.locator('#bm-notes tr').nth(2).locator('td').allTextContents()
  check('bpm: quarter note at 120 is 500 / 750 / 333.3 ms and 2 Hz', quarter[1] === '500.0 ms' && quarter[2] === '750.0 ms' && quarter[3] === '333.3 ms' && quarter[4] === '2.000 Hz', quarter.join(' | '))
  await page.fill('#bm-bars', '8'); await page.dispatchEvent('#bm-bars', 'input')
  check('bpm: eight bars of 4/4 at 120 is 16 s', /^16\.00 s · 0:16 · 705,600 samples/.test((await page.locator('#bm-bars-out').textContent()) ?? ''), await page.locator('#bm-bars-out').textContent())
  await page.selectOption('#bm-sig', '3/4'); await page.dispatchEvent('#bm-sig', 'input')
  check('bpm: 3/4 shortens the bar', /^12\.00 s/.test((await page.locator('#bm-bars-out').textContent()) ?? ''), await page.locator('#bm-bars-out').textContent())
  await page.fill('#bm-pitch', 'A1'); await page.dispatchEvent('#bm-pitch', 'input')
  check('bpm: A1 converts to 55 Hz, MIDI 33', /55\.00 Hz · A1 \+0 ¢ · MIDI 33/.test((await page.locator('#bm-pitch-out').textContent()) ?? ''), await page.locator('#bm-pitch-out').textContent())
  await page.fill('#bm-pitch', '446'); await page.dispatchEvent('#bm-pitch', 'input')
  check('bpm: 446 Hz reads as A4 +23 cents', /A4 \+23 ¢/.test((await page.locator('#bm-pitch-out').textContent()) ?? ''), await page.locator('#bm-pitch-out').textContent())
  for (let i = 0; i < 5; i++) { await page.click('#bm-tap'); if (i < 4) await page.waitForTimeout(400) }
  const tapped = Number(await page.inputValue('#bm-bpm'))
  check('bpm: tap tempo lands near 150 for 400 ms taps', tapped > 135 && tapped < 165, String(tapped))

  // ── tuner & metronome ──
  await page.goto(`${BASE}/audio/metronome/`, { waitUntil: 'domcontentloaded' })
  check('metronome: tempo is shared with BPM maths', Math.abs(Number(await page.inputValue('#mt-bpm')) - tapped) < 1, await page.inputValue('#mt-bpm'))
  await page.fill('#mt-bpm', '240'); await page.dispatchEvent('#mt-bpm', 'input')
  await page.selectOption('#mt-beats', '3')
  check('metronome: dots follow the time signature', await page.locator('.mt-dot').count() === 3 && await page.locator('.mt-dot.accent').count() === 1)
  await page.click('#mt-play')
  await page.waitForTimeout(700)
  const lit = await page.evaluate(() => [...document.querySelectorAll('.mt-dot')].findIndex((d) => d.classList.contains('on')))
  check('metronome: running and lighting beats', (await page.locator('#mt-play').getAttribute('aria-pressed')) === 'true' && lit >= 0, `lit ${lit}`)
  await page.click('#mt-play')
  await page.click('#tn-enable')
  await page.waitForTimeout(800)
  const tunerStatus = await page.locator('#tn-status').textContent()
  check('tuner: microphone path opens (fake device)', /Listening/.test(tunerStatus ?? ''), tunerStatus)
  await page.click('#tn-enable')

  // ── phone layout ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p2 = await phone.newPage()
  await p2.goto(`${BASE}/audio/analyser/`, { waitUntil: 'domcontentloaded' })
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check('phone: no horizontal overflow', overflow <= 1, String(overflow))
  check('phone: compact picker names the tool', /Analyser/.test((await p2.locator('.site-picker summary').textContent()) ?? ''))
  await phone.close()

  check('console: no errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  failed++
  results.push(`  ✗ harness crashed — ${err?.stack ?? err}`)
  if (consoleErrors.length) results.push(`  console: ${consoleErrors.slice(0, 3).join(' | ')}`)
} finally {
  console.log(results.join('\n'))
  console.log(failed ? `\n${failed} FAILED` : '\nall green')
  await browser.close()
  await builtSite?.close?.()
  process.exit(failed ? 1 : 0)
}
