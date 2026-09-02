// Screenshot every Studio mode at desktop, phone and landscape from the built
// site: `node scripts/studio-shots.mjs <out-dir>`. Used for before/after
// comparison during the v5 visual rework — not a pass/fail harness.
import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'
import { mkdirSync } from 'node:fs'

const OUT = process.argv[2] ?? 'studio-shots'
mkdirSync(OUT, { recursive: true })
const site = await serveBuiltSite(4411)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const clickIf = async (loc) => { if (await loc.count()) await loc.first().click() }
const shots = [
  ['pads', async (p) => { await p.locator('.wa-modekey[data-intent="make"]').click(); await p.locator('.wa-modekey[data-mode="pads"]').click(); await clickIf(p.locator('.wa-beat-tabs .wa-subtab', { hasText: 'Play' })) }],
  ['pads-sample', async (p) => { await clickIf(p.locator('.wa-beat-tabs .wa-subtab', { hasText: 'Sample' })) }],
  ['drums', async (p) => { await p.locator('.wa-modekey[data-mode="drums"]').click() }],
  ['synth-notes', async (p) => { await p.locator('.wa-modekey[data-mode="synth"]').click(); await clickIf(p.locator('.wa-page-synth .wa-subtab', { hasText: 'Notes' })) }],
  ['synth-sound', async (p) => { await clickIf(p.locator('.wa-page-synth .wa-subtab', { hasText: 'Sound' })) }],
  ['mix', async (p) => { await p.locator('.wa-modekey[data-mode="mix"]').click() }],
  ['arrange', async (p) => { await p.locator('.wa-modekey[data-mode="song"]').click(); await clickIf(p.locator('button', { hasText: 'Arrangement' })) }],
  ['clips', async (p) => { await clickIf(p.locator('button', { hasText: 'Clip launcher' })) }],
  ['dj', async (p) => { await p.locator('.wa-modekey[data-mode="dj"]').click() }],
]
try {
  for (const [name, w, h, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true], ['landscape', 844, 390, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${site.base}/studio/`, { waitUntil: 'load' })
    await page.waitForTimeout(800)
    for (const [label, go] of shots) {
      try { await go(page) } catch (e) { console.log(`  ! ${name}/${label}: ${String(e).split('\n')[0]}`) }
      await page.waitForTimeout(350)
      await page.screenshot({ path: `${OUT}/${name}-${label}.png` })
      console.log(`  ${name}/${label}`)
    }
    if (errors.length) console.log(`  errors(${name}): ${errors.slice(0, 3).join(' | ')}`)
    await ctx.close()
  }
} finally { await browser.close(); await site.close() }
