// /audio tools functional gate. Drives the real pages in system Chrome via
// playwright-core: hub renders and searches, the analyser measures a synthetic
// file of known tempo, key and level through the browser's own decoder, and
// the built-in test tone path agrees with it.
// Usage: node scripts/audio-tools-e2e.mjs [baseURL|dist]   (default http://localhost:4321)
import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

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

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
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
  check('hub: search finds by alias', await page.locator('[data-tool-item]:not([hidden])').count() === 1)

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
} finally {
  console.log(results.join('\n'))
  console.log(failed ? `\n${failed} FAILED` : '\nall green')
  await browser.close()
  await builtSite?.close?.()
  process.exit(failed ? 1 : 0)
}
