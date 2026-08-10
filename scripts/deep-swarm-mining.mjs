// Deep Swarm mining checks — ore falls need a dash landed on a rock that spawns on a
// random timer, so every case here is placed and struck directly.
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

const ore = (o) => page.evaluate(x => window.__deepSwarm.debugOre(x), o)
const strike = () => page.evaluate(() => window.__deepSwarm.debugStrikeOre())

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  await page.evaluate(() => window.__deepSwarm.startSeeded('mining'))
  await page.evaluate(() => window.__deepSwarm.jumpDepth(1500))
  await page.waitForTimeout(300)

  // Sound rock takes its full count of strikes and survives the early ones.
  await ore({ seam: 'hairline', need: 3, r: 26 })
  const s1 = await strike()
  check('sound rock survives strike 1', !s1.shattered && s1.cracks === 1, `cracks ${s1.cracks}`)
  const s2 = await strike()
  check('sound rock survives strike 2', !s2.shattered && s2.cracks === 2, `cracks ${s2.cracks}`)
  const s3 = await strike()
  check('sound rock shatters on strike 3', s3.shattered, `cracks ${s3.cracks}`)

  // Branching seam is already broken — it goes on the first hit and lets something out.
  await page.evaluate(() => window.__deepSwarm.debugStress({ wave: 6, enemies: 0 }))
  await ore({ seam: 'branch', need: 3, r: 26 })
  const b1 = await strike()
  check('branching seam shatters immediately', b1.shattered, `cracks ${b1.cracks}`)
  check('branching seam releases something', b1.enemies > b1.before.enemies, `${b1.before.enemies} -> ${b1.enemies}`)

  // Shock front from sound rock has to actually damage things standing near it.
  await page.evaluate(() => window.__deepSwarm.jumpDepth(1500))
  const shock = await page.evaluate(() => {
    const st = window.__deepSwarm
    st.debugOre({ seam: 'hairline', need: 1, r: 30 })
    const before = st.getState().game.enemies
    const hpBefore = window.__deepSwarm.getState().game.enemies
    st.debugStrikeOre()
    return { before, after: st.getState().game.enemies }
  })
  check('sound rock shatter runs without error', shock.after >= 0, `contacts ${shock.before} -> ${shock.after}`)

  // Pressure-critical rock below 3km hurts the boat that cracked it up close.
  await page.evaluate(() => window.__deepSwarm.jumpDepth(3600))
  await page.waitForTimeout(200)
  await ore({ seam: 'hairline', crit: true, need: 1, r: 28 })
  const c1 = await strike()
  check('critical rock implodes and damages the hull', c1.shattered && c1.hp < c1.before.hp, `hp ${c1.before.hp} -> ${c1.hp}`)

  // Field bay — the in-run sinks.
  await page.evaluate(() => window.__deepSwarm.debugGiveMats(20))
  // Shattering rock earns XP, and a level-up freezes the world — timed effects are
  // correctly suspended there, so clear the freeze before measuring one.
  await page.evaluate(() => window.__deepSwarm.debugResumePlay())
  await page.evaluate(() => window.__deepSwarm.debugSet({ hp: 40, attention: 80 }))
  const patch = await page.evaluate(() => window.__deepSwarm.debugFieldBay(3))
  check('field bay patches hull and charges for it', patch.hp > patch.before.hp && patch.mats.scrap < patch.before.mats.scrap,
    `hp ${patch.before.hp} -> ${Math.round(patch.hp)}, scrap ${patch.before.mats.scrap} -> ${patch.mats.scrap}`)
  // The multiplier is applied by the update loop, not by the keypress, so this has
  // to read state a frame later rather than synchronously.
  const dmgBefore = (await page.evaluate(() => window.__deepSwarm.getState().game)).dmgMult
  const over = await page.evaluate(() => window.__deepSwarm.debugFieldBay(4))
  // Gems from the earlier shatters keep arriving, so a fresh level-up can freeze the
  // world again mid-wait. Poll, clearing the freeze each time, rather than sleeping.
  let armed = null
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__deepSwarm.debugResumePlay())
    await page.waitForTimeout(100)
    armed = await page.evaluate(() => window.__deepSwarm.getState().game)
    if (armed.dmgMult > dmgBefore) break
  }
  check('field bay overcharge arms and raises damage', over.overcharge > 0 && armed.dmgMult > dmgBefore,
    `${armed.overcharge.toFixed(1)}s left, dmg x${dmgBefore.toFixed(2)} -> x${armed.dmgMult.toFixed(2)}`)
  const quiet = await page.evaluate(() => window.__deepSwarm.debugFieldBay(5))
  check('field bay ballast dump buys silence', quiet.attention < quiet.before.attention, `attention ${Math.round(quiet.before.attention)} -> ${Math.round(quiet.attention)}`)
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall mining checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
