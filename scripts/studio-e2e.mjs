// VishAmp studio e2e regression gate (handover Phase 0).
// Drives the REAL app in system Chrome via playwright-core — the proven
// verification method for this repo (no test framework, plain assertions).
// Usage: node scripts/studio-e2e.mjs [baseURL]   (default http://localhost:4321)
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const results = []
let failed = 0

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
  }))
  check('first run: demo content is loaded', cold.seeded > 0, `${cold.seeded} steps`)
  check('first run: tour does not block the UI', !cold.tourOpen)
  check('first run: non-modal hint is shown', cold.hint)
  await page.locator('.wa-modekey', { hasText: 'SYNTH' }).click({ timeout: 4000 })
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
  await page.click('.wa-modekey:has-text("DRUMS")')
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
  await page.locator('.wa-modekey', { hasText: 'DRUMS' }).click()
  await page.waitForTimeout(200)
  check('workflow: pattern length lives on DRUMS', await page.locator('.wa-page-drums select[aria-label="Pattern length"]').count() === 1)
  await page.selectOption('.wa-page-drums select[aria-label="Pattern length"]', '8')
  await page.locator('.wa-modekey', { hasText: 'SYNTH' }).click()
  await page.waitForTimeout(250)
  check('workflow: the roll agrees with it', await page.inputValue('.wa-page-synth select[aria-label="Pattern length"]') === '8')

  // ── workflow: the arrangement is undoable ──
  await page.locator('.wa-modekey', { hasText: 'CLIPS' }).click()
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
