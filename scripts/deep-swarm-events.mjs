// Deep Swarm event checks — every option has to be reachable and every option has
// to cost something. Fires each definition's choices directly rather than waiting
// out the 80-120s event cooldown.
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
  await page.evaluate(() => window.__deepSwarm.startSeeded('events'))
  await page.waitForTimeout(300)

  const meta = await page.evaluate(() => window.__deepSwarm.eventMeta())
  check('event catalogue reached target size', meta.total >= 40, `${meta.total} events`)
  check('every event has at least two choices', meta.tooFewChoices.length === 0, meta.tooFewChoices.join(',') || 'all ok')
  check('every event has a no-choice branch', meta.missingNoChoice.length === 0, meta.missingNoChoice.join(',') || 'all ok')
  check('every event has situated text', meta.thinText.length === 0, meta.thinText.join(',') || 'all ok')

  // Fire every choice of every event and make sure none of them throws.
  const run = await page.evaluate(() => window.__deepSwarm.exerciseEvents())
  check('every choice runs without throwing', run.errors.length === 0, run.errors.slice(0, 4).join(' | ') || `${run.fired} choices fired`)
  check('every no-choice branch runs without throwing', run.noChoiceErrors.length === 0, run.noChoiceErrors.slice(0, 4).join(' | ') || `${run.noChoiceFired} fired`)

  // Gating: deep/loud/corrupt events must not be offered in shallow, quiet, lucid water.
  const shallow = await page.evaluate(() => window.__deepSwarm.eligibleAt({ depth: 100, wave: 20, attention: 0, corruption: 0 }))
  check('depth-gated events stay out of shallow water',
    !shallow.includes('moor_chain') && !shallow.includes('clean_room') && !shallow.includes('own_pulse'),
    `${shallow.length} eligible at 100m`)
  const deep = await page.evaluate(() => window.__deepSwarm.eligibleAt({ depth: 3200, wave: 20, attention: 80, corruption: 60 }))
  check('deep loud corrupt water unlocks the late catalogue',
    deep.includes('moor_chain') && deep.includes('clean_room') && deep.includes('shadow_closes'),
    `${deep.length} eligible at 3200m`)
  check('attention-gated event needs a hunt state',
    !shallow.includes('shadow_closes'), 'shadow_closes gated on attention')

  // The picker should escalate rather than reshuffle: deep runs weight deep events.
  const bias = await page.evaluate(() => window.__deepSwarm.samplePicker({ depth: 3400, wave: 20, attention: 70, corruption: 60 }, 600))
  const deepShare = bias.deepGated / bias.total
  check('picker favours late-run events as the dive escalates', deepShare > 0.45, `${Math.round(deepShare * 100)}% depth-gated`)

  // NEREID's silence after recovering a body.
  const mute = await page.evaluate(() => window.__deepSwarm.testNereidMute())
  check('recovering a body silences NEREID but not alarms', mute.routineBlocked && mute.urgentPassed, JSON.stringify(mute))
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join('\n') : '\nno console errors')
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall event checks passed')
  await browser.close()
  process.exitCode = failures ? 1 : 0
}
