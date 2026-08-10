// Deep Swarm screenshot — drive to a depth and capture, for eyeballing render changes.
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const DEPTH = Number(process.argv[3] ?? 2500)
const OUT = process.argv[4] ?? 'shot.png'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
await page.evaluate(() => window.__deepSwarm.startSeeded('shot'))
await page.evaluate(d => window.__deepSwarm.jumpDepth(d), DEPTH)
await page.evaluate(() => window.__deepSwarm.debugStress({ wave: 8, enemies: 25 }))
if (process.env.DS_LIGHTS_OFF) await page.keyboard.press('l')   // [L] toggles; default is ON
const BEAT = process.argv[5]
if (BEAT) { await page.waitForTimeout(2500); await page.evaluate(b => window.__deepSwarm.debugDread(b), BEAT) }
await page.waitForTimeout(2500)
await page.screenshot({ path: OUT })
console.log('wrote', OUT, '| errors:', errors.length ? errors.join('; ') : 'none')
await browser.close()
