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
const DEV_NOISE = /sw\.js|Outdated Optimize Dep|fetching the script/
page.on('console', (m) => {
  // dev-server-only noise: SW registration 404s + Vite dep re-optimisation
  if (m.type() === 'error' && !DEV_NOISE.test(m.text())) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

try {
  // ── boot ──
  await page.goto(`${BASE}/studio/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.removeItem('vv_studio_v2')
    localStorage.setItem('vv_studio_tutorial_seen', '1')  // fresh boot auto-opens the tour otherwise
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  check('boot: transport renders', true)
  const lcd = await page.textContent('.wa-lcd')
  check('boot: LCD shows BPM + STOP', /BPM/.test(lcd ?? '') && /STOP/.test(lcd ?? ''), (lcd ?? '').slice(0, 30))

  // the drum grid lives on the Sequence tab
  await page.click('.wa-tabs button:has-text("Sequence"), .wa-tab:has-text("Sequence")')
  await page.waitForTimeout(200)

  // ── toggle a drum step ──
  const cell = page.locator('.wa-grid .wa-row .wa-cell').nth(0)
  await cell.click()
  check('grid: step toggles on', await cell.evaluate((n) => n.classList.contains('on')))

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
  check('undo: step reverts', await cell.evaluate((n) => !n.classList.contains('on')))
  await page.click('.wa-transport button:has-text("Redo")')
  await page.waitForTimeout(150)
  check('redo: step returns', await cell.evaluate((n) => n.classList.contains('on')))

  // ── autosave round-trip ──
  await page.waitForTimeout(900) // autosave debounce
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wa-transport', { timeout: 15000 })
  await page.click('.wa-tabs button:has-text("Sequence"), .wa-tab:has-text("Sequence")')
  await page.waitForTimeout(200)
  const cellAfter = page.locator('.wa-grid .wa-row .wa-cell').nth(0)
  check('autosave: step survives reload', await cellAfter.evaluate((n) => n.classList.contains('on')))

  // ── export WAV is non-trivial (Project/Export lives on the Mix tab) ──
  await page.click('.wa-tab:has-text("Mix")')
  await page.waitForTimeout(200)
  const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
  await page.click('button:has-text("Export WAV")')
  const download = await dl
  const path = download ? await download.path() : null
  const { statSync } = await import('node:fs')
  const size = path ? statSync(path).size : 0
  check('export: WAV download > 10KB', size > 10_000, `${size} bytes`)

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
