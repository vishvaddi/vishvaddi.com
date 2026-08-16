// Deep Swarm fixed-formation mining and in-run field-bay checks.
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

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('mining')
    window.__deepSwarm.prepareCampaignTest()
    window.__deepSwarm.spawnTestDeposit('conductive_vein')
  })
  await page.waitForTimeout(200)

  const before = await page.evaluate(() => window.__deepSwarm.getState().game)
  check('surveyed deposit is fixed in the world', before.fallers === 0 && before.obstacles > 0,
    `${before.obstacles} formations · ${before.fallers} loose rocks`)
  await page.keyboard.down('e')
  for (let waited = 0; waited < 8000; waited += 250) {
    await page.waitForTimeout(250)
    if ((await page.evaluate(() => window.__deepSwarm.getState().game.minedDeposits)) > before.minedDeposits) break
  }
  await page.keyboard.up('e')
  const mined = await page.evaluate(() => window.__deepSwarm.getState().game)
  check('holding E mines the surveyed formation', mined.minedDeposits > before.minedDeposits,
    `${before.minedDeposits} -> ${mined.minedDeposits} · ${JSON.stringify(mined.mining)}`)

  await page.evaluate(() => window.__deepSwarm.debugSet({ hp: 40, attention: 80 }))
  const patch = await page.evaluate(() => window.__deepSwarm.debugFieldBay(3))
  check('field bay patches hull and charges for it', patch.hp > patch.before.hp && patch.mats.scrap < patch.before.mats.scrap,
    `hp ${patch.before.hp} -> ${Math.round(patch.hp)}, scrap ${patch.before.mats.scrap} -> ${patch.mats.scrap}`)
  const dmgBefore = (await page.evaluate(() => window.__deepSwarm.getState().game)).dmgMult
  const over = await page.evaluate(() => window.__deepSwarm.debugFieldBay(4))
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
  check('field bay ballast dump buys silence', quiet.attention < quiet.before.attention,
    `attention ${Math.round(quiet.before.attention)} -> ${Math.round(quiet.attention)}`)
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall mining checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
