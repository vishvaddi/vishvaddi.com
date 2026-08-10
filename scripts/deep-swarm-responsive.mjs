import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321'
const cases = [
  ['desktop', 1280, 800, true],
  ['full-hd', 1920, 1080, true],
  ['ultrawide', 2560, 1080, true],
  ['short-desktop', 1366, 768, true],
  ['android-landscape', 844, 390, false],
]
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 15000 })
  for (const [name, width, height, expectRails] of cases) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(([w, h]) => {
      const canvas = document.querySelector('#c')
      return canvas && canvas.width === w && canvas.height === h
    }, [width, height], { timeout: 10000 })
    await page.evaluate(seed => window.__deepSwarm.startSeeded(seed), `responsive-${name}`)
    await page.waitForFunction(([w, rails]) => {
      const hud = window.__deepSwarm?.getState()?.game?.hud
      return hud && hud.porthole.x === w / 2 && hud.rails === rails
    }, [width, expectRails], { timeout: 10000 })
    const state = await page.evaluate(() => window.__deepSwarm.getState().game)
    check(`${name}: expected responsive mode`, state.hud.rails === expectRails, `${width}×${height}, rails ${state.hud.rails}`)
    if (state.hud.rails) {
      const { left, right, porthole } = state.hud
      const leftClear = left.x + left.w < porthole.x - porthole.r
      const rightClear = right.x > porthole.x + porthole.r
      const inBounds = left.x >= 0 && right.x + right.w <= width && left.y >= 0 && left.y + left.h <= height
      check(`${name}: rails clear the playfield`, leftClear && rightClear, `left ${leftClear}, right ${rightClear}`)
      check(`${name}: rails remain in canvas`, inBounds)
    }
    if (process.env.DEEP_SWARM_SCREENSHOTS) await page.screenshot({ path: `C:/tmp/deep-swarm-${name}.png` })
  }
} finally {
  check('responsive render has no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
