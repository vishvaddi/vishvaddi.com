// Deep Swarm rig checks — the hands-on jobs and the maintenance debt that hands
// them to you. Each grammar is driven to both outcomes: secured, and botched.
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

const state = () => page.evaluate(() => window.__deepSwarm.getState())
const rig = () => page.evaluate(() => window.__deepSwarm.rigState())

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  await page.evaluate(() => window.__deepSwarm.startSeeded('rig'))
  await page.evaluate(() => window.__deepSwarm.jumpDepth(1800))
  await page.waitForTimeout(300)

  for (const kind of ['trim', 'bearing', 'purge', 'scrub']) {
    await page.evaluate(k => window.__deepSwarm.openRigTest(k), kind)
    await page.waitForTimeout(250)
    const opened = await state()
    check(`${kind}: opens and renders`, opened.phase === 'rig' && !opened.error, opened.error ?? opened.phase)

    await page.evaluate(() => window.__deepSwarm.rigSolve())
    await page.waitForTimeout(900)
    const after = await state()
    check(`${kind}: solving returns to the dive`, after.phase === 'playing', after.phase)
  }

  // Failure has to cost something specific to the job that was botched.
  await page.evaluate(() => window.__deepSwarm.debugSet({ hp: 90, attention: 10 }))
  await page.evaluate(() => window.__deepSwarm.openRigTest('purge'))
  await page.waitForTimeout(200)
  const hpBefore = (await state()).game.hp
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1400)
  const afterFail = await state()
  check('walking away from a job costs hull', afterFail.game.hp < hpBefore, `hp ${Math.round(hpBefore)} -> ${Math.round(afterFail.game.hp)}`)
  check('failed job returns to the dive', afterFail.phase === 'playing', afterFail.phase)

  // Bearing failure should be paid in attention, not hull.
  await page.evaluate(() => window.__deepSwarm.debugSet({ attention: 10 }))
  const attBefore = (await state()).game.attention
  const hpBeforeBearing = (await state()).game.hp
  await page.evaluate(() => window.__deepSwarm.openRigTest('bearing'))
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1400)
  const post = (await state()).game
  check('botched bearing is paid in attention, not hull',
    post.attention > attBefore && post.hp >= hpBeforeBearing,
    `attention ${attBefore} -> ${post.attention}, hp ${Math.round(hpBeforeBearing)} -> ${Math.round(post.hp)}`)

  // Maintenance debt picks its own job when systems are left below par.
  const debt = await page.evaluate(() => window.__deepSwarm.debugDebt())
  check('neglected systems hand you a job unprompted', debt.phase === 'rig' && !!debt.rig, `${debt.phase} / ${debt.rig}`)
  await page.evaluate(() => window.__deepSwarm.rigSolve())
  await page.waitForTimeout(900)
  const settled = await state()
  check('debt job resolves cleanly', settled.phase === 'playing', settled.phase)
  const d = await page.evaluate(() => window.__deepSwarm.debtState())
  // v is still accruing every frame from the same neglected systems, so this
  // asserts "reset and well below the trigger", not an exact zero.
  check('debt resets and will not fire twice in a row', d && d.v < 5 && d.next > 30, d ? `v=${d.v.toFixed(2)} next=${Math.round(d.next)}s` : 'no debt state')
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall rig checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
