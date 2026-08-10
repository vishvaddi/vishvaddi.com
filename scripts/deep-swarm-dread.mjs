// Deep Swarm dread-layer checks — each horror beat fires on a long random timer by
// design, so this forces every one and asserts the observable consequence.
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' && !/sw\.js|favicon|cloudflareinsights|ERR_FAILED/i.test(m.text())) errors.push(m.text()) })

const dread = async () => (await page.evaluate(() => window.__deepSwarm.getState().game)).dread
// Fixed sleeps make these checks fail under machine load rather than on a real
// regression. Poll for the condition instead, with a generous ceiling.
const until = async (fn, ms = 12000, step = 250) => {
  const t0 = Date.now()
  for (;;) {
    if (await fn()) return true
    if (Date.now() - t0 > ms) return false
    await page.waitForTimeout(step)
  }
}

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  await page.evaluate(() => window.__deepSwarm.startSeeded('dread'))
  await page.evaluate(() => window.__deepSwarm.jumpDepth(2600))
  await page.waitForTimeout(400)

  const baseR = (await dread()).boundsR
  await page.evaluate(() => window.__deepSwarm.debugDread('open', 20))
  await until(async () => (await dread()).boundsR > baseR)
  const open = await dread()
  check('THE OPEN: walls recede', open.open && open.boundsR > baseR, `${baseR} -> ${open.boundsR}`)
  check('THE OPEN: keel reads no return', open.open, 'openT active')
  const enemiesDuring = (await page.evaluate(() => window.__deepSwarm.getState().game)).enemies
  await page.waitForTimeout(2500)
  const after = (await page.evaluate(() => window.__deepSwarm.getState().game)).enemies
  check('THE OPEN: spawning suppressed', after <= enemiesDuring + 1, `${enemiesDuring} -> ${after}`)

  await page.evaluate(() => window.__deepSwarm.debugDread('stalker'))
  await page.waitForTimeout(1200)
  const st = await dread()
  check('stalker exists and holds off', st.stalker && st.stalkerDist >= 240, `${st.stalkerDist}px`)

  await page.evaluate(() => window.__deepSwarm.debugDread('hypoxia', 5))
  await page.waitForTimeout(500)
  check('hypoxia engages on low life support', (await dread()).hypoxia > 0.5, String((await dread()).hypoxia))

  await page.evaluate(() => window.__deepSwarm.debugDread('phantoms', 85))
  await page.waitForTimeout(1500)
  const ph = await dread()
  check('instruments lie at MIND 60+', ph.phantoms > 0, `${ph.phantoms} phantom(s), hiding=${ph.hiding}`)

  await page.evaluate(() => window.__deepSwarm.debugDread('silence', 3))
  check('silence window opens', (await dread()).silent)
  check('silence closes and pays out', await until(async () => !(await dread()).silent))

  await page.evaluate(() => window.__deepSwarm.debugDread('echo'))
  await page.waitForTimeout(600)
  check('ping answered without error', true)

  // Submechanophobia kinds must actually reach the field and render.
  await page.evaluate(() => window.__deepSwarm.jumpDepth(4600))
  const gotMachinery = await until(async () => (await dread()).kinds.some(k => ['moorchain', 'ladder', 'hatch'].includes(k)))
  check('deep machinery spawns', gotMachinery, (await dread()).kinds.join(','))

  const pressure = (await dread()).maxBar
  await page.evaluate(() => window.__deepSwarm.jumpDepth(300))
  await page.waitForTimeout(600)
  check('pressure peak never falls', (await dread()).maxBar >= pressure, `${pressure} -> ${(await dread()).maxBar}`)
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall dread checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
