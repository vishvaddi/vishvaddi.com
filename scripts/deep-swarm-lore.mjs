// Deep Swarm lore checks — dossiers assembling from fragments, thread pacing,
// NEREID's arc and her one refusal, and whether a wreck reads as a wreck.
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
  await page.evaluate(() => window.__deepSwarm.startSeeded('lore'))
  await page.waitForTimeout(250)

  const meta = await page.evaluate(() => window.__deepSwarm.loreMeta())
  check('dossiers reference only real fragments', meta.danglingNeeds.length === 0, meta.danglingNeeds.join(',') || `${meta.dossiers} dossiers`)
  check('every dossier carries a full document', meta.thinBodies.length === 0, meta.thinBodies.join(',') || 'all substantial')

  const all = await page.evaluate(() => window.__deepSwarm.testDossiers())
  check('collecting the codex assembles every thread', all.assembled.length === meta.dossiers,
    `${all.assembled.length}/${meta.dossiers} from ${all.owned} fragments`)

  // They should land across the run of collection, not all in the last handful.
  const pacing = await page.evaluate(() => window.__deepSwarm.testThreadPacing())
  const firstAt = Math.min(...Object.values(pacing.at))
  const lastAt = Math.max(...Object.values(pacing.at))
  check('threads complete progressively, not all at the end',
    firstAt <= pacing.total * 0.55 && lastAt <= pacing.total,
    `first at ${firstAt}/${pacing.total}, last at ${lastAt}/${pacing.total}`)

  // NEREID's arc: reports, then asks, then asks for things.
  const s0 = await page.evaluate(() => window.__deepSwarm.nereidStageAt(0, 0))
  const s1 = await page.evaluate(() => window.__deepSwarm.nereidStageAt(3, 20))
  const s2 = await page.evaluate(() => window.__deepSwarm.nereidStageAt(6, 40))
  const s3 = await page.evaluate(() => window.__deepSwarm.nereidStageAt(12, 90))
  check('a lucid NEREID just reports', s0.stage === 0 && s0.line === null, `stage ${s0.stage}`)
  check('drift makes her start asking', s1.stage >= 1 && !!s1.line, `stage ${s1.stage}`)
  check('further drift makes her ask for things', s2.stage >= 2 && !!s2.line, `stage ${s2.stage}`)
  check('the arc tops out at the refusal stage', s3.stage === 3, `stage ${s3.stage}`)

  const refuse = await page.evaluate(() => window.__deepSwarm.testRefusal())
  check('at the end of her arc she declines the order once',
    refuse.first.ascending === false && refuse.first.refused === true, JSON.stringify(refuse.first))
  check('giving the order again is obeyed', refuse.second.ascending === true, JSON.stringify(refuse.second))

  const wr = await page.evaluate(() => window.__deepSwarm.wreckLegibility())
  check('a wreck reads the same every time you return to it', wr.stable, wr.sample.attitude)
  check('wrecks vary across the whole catalogue of attitudes and causes',
    wr.attitudes === 5 && wr.causes === 5 && wr.registries > 40,
    `${wr.attitudes} attitudes, ${wr.causes} causes, ${wr.registries} registries over 60 wrecks`)
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall lore checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
