// Deep Swarm perf soak — drives a real run to depth and samples FPS + population.
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const DEPTHS = process.argv[3] ? process.argv[3].split(',').map(Number) : [300, 1200, 2500, 4200]
const SOAK_MS = Number(process.argv[4] ?? 12000)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => {
  if (m.type() === 'error' && !/sw\.js|favicon|cloudflareinsights|ERR_FAILED|AudioContext|autoplay/i.test(m.text())) errors.push(m.text())
})

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  console.log('build:', await page.evaluate(() => window.__deepSwarm.build))

  await page.evaluate(() => window.__deepSwarm.startSeeded('perf-soak'))
  await page.waitForTimeout(500)

  // Force a late-wave, over-cap field ONCE — the condition the lag actually needed.
  // Each depth then soaks from that state, so the population trace shows whether
  // the cap pulls an overloaded field back down instead of only gating new spawns.
  await page.evaluate(() => window.__deepSwarm.debugStress({ wave: 22, enemies: 220 }))

  for (const depth of DEPTHS) {
    await page.evaluate(d => window.__deepSwarm.jumpDepth(d), depth)
    // Hold a movement key so weapons fire and the run behaves like a real dive.
    await page.keyboard.down('d')
    const samples = []
    const t0 = Date.now()
    while (Date.now() - t0 < SOAK_MS) {
      await page.waitForTimeout(1000)
      const s = await page.evaluate(() => window.__deepSwarm.getState().game)
      if (s) samples.push(s)
    }
    await page.keyboard.up('d')
    if (!samples.length) { console.log(`  ${depth}m — no samples`); continue }
    const fps = samples.map(s => s.fps).filter(n => n > 0)
    const en = samples.map(s => s.enemies)
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0
    console.log(
      `  ${String(depth).padStart(4)}m  fps avg ${String(avg(fps)).padStart(3)} min ${String(Math.min(...fps)).padStart(3)}` +
      `  |  contacts avg ${String(avg(en)).padStart(3)} max ${String(Math.max(...en)).padStart(3)} cap ${samples[0].popCap}` +
      `  |  proj ${avg(samples.map(s => s.projectiles))} fx ${avg(samples.map(s => s.effects))} obs ${avg(samples.map(s => s.obstacles))}`
    )
  }

  const final = await page.evaluate(() => window.__deepSwarm.getState())
  console.log('phase:', final.phase, '| runtime error:', final.error ?? 'none')
} finally {
  console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join('\n') : '\nno console errors')
  await browser.close()
}
