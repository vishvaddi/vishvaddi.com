// VishAmp studio e2e regression gate (handover Phase 0).
// Drives the REAL app in system Chrome via playwright-core — the proven
// verification method for this repo (no test framework, plain assertions).
// Usage: node scripts/studio-e2e.mjs [baseURL]   (default http://localhost:4321)
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const testWav = (() => {
  const sampleRate = 8000, samples = sampleRate * 2, out = Buffer.alloc(44 + samples * 2)
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples * 2, 4); out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 220) * 10000), 44 + i * 2)
  return out
})()
const results = []
let failed = 0
const modeRoute = {
  DRUMS: ['edit', 'drums'], PADS: ['play', 'pads'], SYNTH: ['edit', 'synth'],
  CLIPS: ['arrange', null], DJ: ['play', 'dj'], MIX: ['mix', null],
}

async function openMode(page, mode) {
  const [workspace, tool] = modeRoute[mode]
  await page.locator(`[data-workspace="${workspace}"].wa-modekey`).click()
  if (tool) await page.locator(`[data-workspace="${workspace}"][data-mode="${tool}"]`).click()
}

function check(name, ok, detail = '') {
  results.push(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 950 } })
const page = await ctx.newPage()

const consoleErrors = []
const DEV_NOISE = /sw\.js|Outdated Optimize Dep|fetching the script|cloudflareinsights|ERR_FAILED/
page.on('console', (m) => {
  // dev-server-only noise: SW registration 404s + Vite dep re-optimisation
  if (m.type() === 'error' && !DEV_NOISE.test(m.text())) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

try {
  // ── cold boot: a first-time visitor must meet a playable instrument, not a
  // modal tour over an empty grid ──
  await page.goto(`${BASE}/studio/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  await page.waitForTimeout(500)
  const cold = await page.evaluate(() => ({
    seeded: document.querySelectorAll('.wa-cell.on').length,
    tourOpen: !document.querySelector('.wa-tutorial')?.hidden,
    hint: !!document.querySelector('.wa-firstrun-hint'),
    title: document.querySelector('.wa-project-name')?.value,
  }))
  check('first run: demo content is loaded', cold.seeded > 0, `${cold.seeded} steps`)
  check('first run: tour does not block the UI', !cold.tourOpen)
  check('first run: non-modal hint is shown', cold.hint)
  check('first run: demo has its real title', cold.title === 'MIDNIGHT ACID', String(cold.title))
  check('first run: arranger is the project home', await page.locator('.wa-page-song').isVisible())
  await openMode(page, 'SYNTH')
  check('first run: controls are usable immediately', true)

  await page.evaluate(() => {
    localStorage.removeItem('vv_studio_v2')
    localStorage.setItem('vv_studio_tutorial_seen', '1')  // fresh boot auto-opens the tour otherwise
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  check('boot: transport renders', true)
  const lcd = await page.textContent('.wa-lcd')
  check('boot: LCD shows BPM + STOP', /BPM/.test(lcd ?? '') && /STOP/.test(lcd ?? ''), (lcd ?? '').slice(0, 30))

  // ── toggle a drum step ──
  await openMode(page, 'DRUMS')
  const cell = page.locator('.wa-grid .wa-row .wa-cell').nth(0)
  const wasOn = await cell.evaluate((n) => n.classList.contains('on'))
  await cell.click()
  check('grid: step toggles', await cell.evaluate((n) => n.classList.contains('on')) !== wasOn, wasOn ? 'on→off' : 'off→on')

  // ── play two beats: playhead advances on the LCD ──
  await page.click('.wa-transport button:has-text("▶")')
  await page.waitForTimeout(1200)
  const lcdPlaying = await page.textContent('.wa-lcd')
  check('transport: LCD shows playhead while playing', /▶/.test(lcdPlaying ?? ''), (lcdPlaying ?? '').slice(0, 30))
  await page.click('.wa-transport button:has-text("■")')
  await page.waitForTimeout(200)
  check('transport: stop returns LCD to STOP', /STOP/.test((await page.textContent('.wa-lcd')) ?? ''))

  // ── undo reverts the step ──
  await page.click('.wa-transport button:has-text("Undo")')
  await page.waitForTimeout(150)
  check('undo: step reverts', await cell.evaluate((n) => n.classList.contains('on')) === wasOn)
  await page.click('.wa-transport button:has-text("Redo")')
  await page.waitForTimeout(150)
  check('redo: step returns', await cell.evaluate((n) => n.classList.contains('on')) !== wasOn)

  // ── autosave round-trip ──
  await page.waitForTimeout(900) // autosave debounce
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  const cellAfter = page.locator('.wa-grid .wa-row .wa-cell').nth(0)
  check('autosave: step survives reload', await cellAfter.evaluate((n) => n.classList.contains('on')) !== wasOn)

  // ── export WAV is non-trivial (export is a transport key opening a modal) ──
  await page.click('.wa-transport button:has-text("EXPORT")')
  await page.waitForTimeout(300)
  check('export: modal opens from the transport key', await page.locator('.wa-export-dialog[open]').count() === 1)
  const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
  await page.click('button:has-text("Export WAV")')
  const download = await dl
  const path = download ? await download.path() : null
  const { statSync } = await import('node:fs')
  const size = path ? statSync(path).size : 0
  check('export: WAV download > 10KB', size > 10_000, `${size} bytes`)
  await page.click('.wa-export-dialog-head button:has-text("Close")')
  await page.waitForTimeout(200)

  // ── workflow: pattern length is settable where the pattern is edited ──
  await openMode(page, 'DRUMS')
  await page.waitForTimeout(200)
  check('workflow: pattern length lives on DRUMS', await page.locator('.wa-page-drums select[aria-label="Pattern length"]').count() === 1)
  await page.selectOption('.wa-page-drums select[aria-label="Pattern length"]', '8')
  await openMode(page, 'SYNTH')
  await page.waitForTimeout(250)
  check('workflow: the roll agrees with it', await page.inputValue('.wa-page-synth select[aria-label="Pattern length"]') === '8')

  // ── workflow: the arrangement is undoable ──
  await openMode(page, 'CLIPS')
  await page.waitForTimeout(250)
  const chainBefore = await page.locator('.wa-chain-block').count()
  await page.locator('.wa-composer-head button', { hasText: 'Add selected' }).click()
  await page.waitForTimeout(200)
  const chainAdded = await page.locator('.wa-chain-block').count()
  await page.locator('.wa-transport button', { hasText: 'Undo' }).click({ timeout: 5000 })
  await page.waitForTimeout(300)
  check('workflow: arrangement edits undo', chainAdded === chainBefore + 1 && await page.locator('.wa-chain-block').count() === chainBefore)

  // ── workflow: loading a song applies in place, no page restart ──
  page.on('dialog', (d) => d.accept())
  await page.evaluate(() => { window.__noReload = true })
  await page.selectOption('.wa-song-library select', 'factory:NEON HORIZON')
  await page.locator('.wa-song-library button', { hasText: 'Load' }).first().click()
  await page.waitForTimeout(700)
  const inPlace = await page.evaluate(() => ({ survived: window.__noReload === true, bpm: document.querySelector('.wa-bpm')?.value }))
  check('workflow: song loads without reloading the page', inPlace.survived, `bpm now ${inPlace.bpm}`)

  // ── reach: controls have accessible names ──
  const named = await page.evaluate(() => ({
    cell: document.querySelector('.wa-cell')?.getAttribute('aria-label'),
    key: document.querySelector('.wa-key')?.getAttribute('aria-label'),
  }))
  check('reach: drum cells and keys are named', !!named.cell && !!named.key, `${named.cell} / ${named.key}`)

  // ── mixer: one persisted master state drives both controls ──
  await openMode(page, 'MIX')
  await page.locator('.wa-ch-master .wa-fader').evaluate((node) => {
    node.value = '0.37'; node.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('.wa-mute').first().click()
  const masterSync = await page.evaluate(() => ({
    knob: document.querySelector('.wa-title .wa-knob[aria-label="Master"]')?.getAttribute('aria-valuenow'),
    saved: JSON.parse(localStorage.getItem('vv_studio_v2') ?? '{}').mix?.masterLevel,
    muted: JSON.parse(localStorage.getItem('vv_studio_v2') ?? '{}').mix?.mute?.[0],
  }))
  check('mixer: controls stay synchronised and persist', masterSync.knob === '0.37' && masterSync.saved === 0.37 && masterSync.muted === true, JSON.stringify(masterSync))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  await openMode(page, 'MIX')
  check('mixer: master level survives reload', await page.inputValue('.wa-ch-master .wa-fader') === '0.37')
  check('mixer: mute state survives reload', await page.locator('.wa-mute').first().getAttribute('aria-pressed') === 'true')

  // ── project transitions: blank is explicit, in-place and undoable ──
  await page.locator('.wa-export-key').click()
  await page.locator('.wa-export-dialog button', { hasText: 'New blank' }).click()
  await page.waitForTimeout(350)
  const blank = await page.evaluate(() => ({ title: document.querySelector('.wa-project-name')?.value, steps: document.querySelectorAll('.wa-cell.on').length }))
  check('project: explicit blank project applies in place', blank.title === 'Untitled' && blank.steps === 0, JSON.stringify(blank))
  await page.locator('.wa-export-dialog-head button', { hasText: 'Close' }).click()
  await page.locator('.wa-transport button', { hasText: 'Undo' }).click()
  await page.waitForTimeout(300)
  check('project: replacement can be undone', await page.locator('.wa-cell.on').count() > 0)

  // ── DJ: local file enters a real deck and cue workflow ──
  await openMode(page, 'DJ')
  await page.locator('.wa-dj-deck-a input[type="file"]').setInputFiles({ name: 'local-test.wav', mimeType: 'audio/wav', buffer: testWav })
  await page.waitForFunction(() => document.querySelector('.wa-dj-deck-a .wa-dj-bpm')?.textContent?.includes('BPM') && !document.querySelector('.wa-dj-deck-a .wa-dj-bpm')?.textContent?.includes('ERROR'))
  check('dj: local file loads and analyses', (await page.locator('.wa-dj-deck-a .wa-dj-track-title').textContent()) === 'local-test.wav')
  check('dj: loaded deck lights its quartz state', await page.locator('.wa-dj-deck-a').evaluate((node) => node.classList.contains('loaded')))
  await page.locator('.wa-dj-deck-a .wa-dj-hotcue').first().click()
  check('dj: hot cue can be set', await page.locator('.wa-dj-deck-a .wa-dj-hotcue').first().evaluate((node) => node.classList.contains('set')))
  check('dj: local file is added to browser library', await page.locator('.wa-dj-library-row', { hasText: 'local-test.wav' }).count() === 1)
  await page.locator('.wa-dj-deck-a .wa-dj-start').click()
  await page.waitForTimeout(300)
  check('dj: start animates the direct-drive deck', await page.locator('.wa-dj-deck-a').evaluate((node) => node.classList.contains('playing')))
  check('dj: level meter responds to deck audio', await page.locator('.wa-dj-meter .lit').count() > 0)
  check('dj: tonearm is a connected stylus assembly', await page.locator('.wa-dj-deck-a .wa-dj-arm-assembly .wa-dj-headshell').count() === 1)
  await page.locator('.wa-dj-deck-a .wa-dj-loop-length').selectOption('0.25')
  await page.locator('.wa-dj-deck-a .wa-dj-loopbar .wa-btn', { hasText: 'LOOP' }).click()
  await page.waitForFunction(() => Number(document.querySelector('.wa-dj-deck-a')?.dataset.loopWraps || 0) >= 2)
  check('dj: loop wraps on the audio engine clock', Number(await page.locator('.wa-dj-deck-a').getAttribute('data-loop-wraps')) >= 2)
  const quarterSpan = await page.locator('.wa-dj-deck-a').evaluate((node) => Number(node.dataset.loopOut) - Number(node.dataset.loopIn))
  await page.locator('.wa-dj-deck-a .wa-dj-loop-length').selectOption('0.5')
  await page.waitForFunction(() => Number(document.querySelector('.wa-dj-deck-a')?.dataset.loopWraps || 0) >= 1)
  const halfSpan = await page.locator('.wa-dj-deck-a').evaluate((node) => Number(node.dataset.loopOut) - Number(node.dataset.loopIn))
  check('dj: changing loop length rebuilds the live loop', halfSpan > quarterSpan * 1.8 && halfSpan < quarterSpan * 2.2, `${quarterSpan.toFixed(3)}→${halfSpan.toFixed(3)}s`)
  await page.locator('.wa-dj-deck-a .wa-dj-loopbar .wa-btn', { hasText: 'LOOP' }).click()
  await page.locator('.wa-dj-deck-a .wa-dj-loopbar .wa-btn', { hasText: 'IN' }).click()
  await page.waitForTimeout(140)
  await page.locator('.wa-dj-deck-a .wa-dj-loopbar .wa-btn', { hasText: 'OUT' }).click()
  await page.waitForFunction(() => document.querySelector('.wa-dj-deck-a')?.dataset.loopActive === 'true' && Number(document.querySelector('.wa-dj-deck-a')?.dataset.loopWraps || 0) >= 1)
  check('dj: manual IN and OUT replace the previous loop', await page.locator('.wa-dj-deck-a').getAttribute('data-loop-active') === 'true')
  await page.locator('.wa-dj-deck-a .wa-dj-loopbar .wa-btn', { hasText: 'LOOP ON' }).click()
  const platter = await page.locator('.wa-dj-deck-a .wa-dj-platter').boundingBox()
  if (platter) {
    const y = platter.y + platter.height / 2
    await page.mouse.move(platter.x + platter.width / 2, y); await page.mouse.down(); await page.mouse.move(platter.x + platter.width * .8, y, { steps: 5 }); await page.waitForTimeout(80)
    check('dj: scratch engine plays forwards', await page.locator('.wa-dj-deck-a').getAttribute('data-scratch-direction') === 'forward')
    await page.mouse.move(platter.x + platter.width * .2, y, { steps: 5 }); await page.waitForTimeout(80)
    check('dj: scratch engine plays audio in reverse', await page.locator('.wa-dj-deck-a').getAttribute('data-scratch-direction') === 'reverse')
    await page.mouse.up()
  } else check('dj: platter can be targeted', false)
  await page.locator('.wa-dj-effect-select').selectOption('ECHO')
  await page.locator('.wa-dj-effect-toggle').click()
  check('dj: master effects bus exposes active state', await page.locator('.wa-dj').getAttribute('data-effect') === 'echo')
  await page.locator('.wa-dj-clear-cues').first().click()
  check('dj: cues can be cleared without right click', !await page.locator('.wa-dj-deck-a .wa-dj-hotcue').first().evaluate((node) => node.classList.contains('set')))
  await page.screenshot({ path: 'C:/tmp/studio-dj-playing.png', fullPage: false })
  if (!await page.locator('.wa-dj-deck-a').evaluate((node) => node.classList.contains('playing'))) {
    await page.locator('.wa-dj-deck-a .wa-dj-start').click()
    await page.waitForTimeout(100)
  }
  await page.locator('.wa-dj-deck-a .wa-dj-start').click()
  await page.waitForTimeout(100)
  check('dj: stop halts the direct-drive deck', !await page.locator('.wa-dj-deck-a').evaluate((node) => node.classList.contains('playing')))
  check('dj: obsolete embed warning is absent', await page.getByText('EMBEDS AREN’T MIXABLE').count() === 0)

  // ── console clean ──
  check('console: no errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
} catch (err) {
  check(`RUN ABORTED: ${String(err).slice(0, 140)}`, false)
} finally {
  await browser.close()
}

console.log(`\nVishAmp e2e vs ${BASE}\n${results.join('\n')}\n`)
if (failed) {
  console.error(`${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('all green')
