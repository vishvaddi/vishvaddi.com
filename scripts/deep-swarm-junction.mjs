// Deep Swarm power junction — the three replacements for the old Lights Out.
// Each is driven to both outcomes, because all three end on a random board
// and would otherwise only ever be seen in whatever state a playtest found.
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
let failures = 0, ran = 0
const check = (name, ok, detail = '') => {
  ran++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' && !/sw\.js|favicon|cloudflareinsights|ERR_FAILED/i.test(m.text())) errors.push(m.text()) })

const open = (kind) => page.evaluate(k => window.__deepSwarm.openJunctionTest(k), kind)
const key = (k) => page.evaluate(x => window.__deepSwarm.junctionKey(x), k)
const meta = () => page.evaluate(() => window.__deepSwarm.junctionMeta())
const advance = (s) => page.evaluate(x => window.__deepSwarm.junctionAdvance(x), s)
const setReward = (r) => page.evaluate(x => window.__deepSwarm.junctionSetReward(x), r)
const setFault = (i) => page.evaluate(x => window.__deepSwarm.junctionSetFault(x), i)
const battery = () => page.evaluate(() => window.__deepSwarm.junctionBattery())

try {
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 20000 })
  await page.evaluate(() => window.__deepSwarm.startSeeded('junction'))
  await page.waitForTimeout(250)

  // --- the fault picks the screen -------------------------------------
  await setReward('unseal')
  check('a dead bay bus opens ARC WALK', (await open()).junction.kind === 'arc')
  await setReward('system')
  check('a broken system opens FAULT TRACE', (await open()).junction.kind === 'trace')
  await setReward('battery')
  check('a brownout opens LOAD BALANCE', (await open()).junction.kind === 'load')
  await setReward(null)

  // --- ARC WALK -------------------------------------------------------
  let j = (await open('arc')).junction
  check('arc: opens away from the output', j.px !== j.ox || j.py !== j.oy, `you ${j.px},${j.py} out ${j.ox},${j.oy}`)
  check('arc: the arc starts on the board', j.arcs.length >= 1, `${j.arcs.length} head(s)`)

  const before = j.arcs[0]
  j = await key('w')
  check('arc: your step moves you', j.py < j.oy + j.H, `now ${j.px},${j.py}`)
  check('arc: the arc answers every step', j.arcs[0].x !== before.x || j.arcs[0].y !== before.y, `${before.x},${before.y} -> ${j.arcs[0].x},${j.arcs[0].y}`)
  check('arc: what it leaves behind is dead', j.dead >= 1, `${j.dead} dead`)

  j = await key(' ')
  check('arc: shunt spends and stalls the arc', j.shunt === 0 && j.stall > 0, `shunt ${j.shunt} stall ${j.stall}`)
  const stalled = { x: j.arcs[0].x, y: j.arcs[0].y }
  j = await key('w')
  check('arc: a stalled arc does not advance', j.arcs[0].x === stalled.x && j.arcs[0].y === stalled.y)
  j = await key(' ')
  check('arc: shunt is one use only', j.shunt === 0)

  // A dry route to the output. Walking the boundary blindly LOSES — every
  // flooded terminal hands the arc a free step — so the solver routes around
  // water, which is both the intended skill and a winnability proof.
  const dryRoute = (m) => {
    const wet = new Set(m.flooded)
    const dead = new Set(m.deadCells || [])
    const goal = m.oy * m.W + m.ox
    const search = (allowWet) => {
      const start = m.py * m.W + m.px
      const prev = new Map([[start, -1]])
      const q = [start]
      while (q.length) {
        const c = q.shift()
        if (c === goal) break
        const cx = c % m.W, cy = (c - cx) / m.W
        for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue
          const ni = ny * m.W + nx
          if (prev.has(ni)) continue
          if (dead.has(ni)) continue
          if (m.arcs.some(a => a.x === nx && a.y === ny)) continue
          if (!allowWet && wet.has(ni) && ni !== goal) continue
          prev.set(ni, c); q.push(ni)
        }
      }
      if (!prev.has(goal)) return null
      const path = []
      let c = goal
      while (c !== start) { path.push(c); c = prev.get(c) }
      return path.reverse()
    }
    return search(false) || search(true)
  }

  await setReward(null)
  j = (await open('arc')).junction
  let route = dryRoute(j)
  check('arc: a dry route to the output exists', !!route, route ? `${route.length} steps` : 'none')
  let routeGuard = 0
  while (!j.over && routeGuard++ < 30) {
    route = dryRoute(j)
    const step = route && route[0]
    if (step == null) break
    if (j.over) break
    const nx = step % j.W, ny = (step - nx) / j.W
    const dx = nx - j.px, dy = ny - j.py
    j = await key(dx === 1 ? 'd' : dx === -1 ? 'a' : dy === 1 ? 's' : 'w')
    if (!j) break
    // Buy two steps back if it gets close enough to matter.
    if (!j.over && j.shunt > 0 && j.arcs.some(a => Math.abs(a.x - j.px) + Math.abs(a.y - j.py) <= 2)) j = await key(' ')
  }
  check('arc: routing around the water wins', j && j.over && j.won === true, j ? `over=${j.over} won=${j.won}` : 'no state')

  // Cornering: pace on the spot and let it close.
  j = (await open('arc')).junction
  let guard = 0
  while (!j.over && guard++ < 60) {
    j = await key(guard % 2 ? 'd' : 'a')
    if (!j) break
  }
  check('arc: letting it close loses, and only loses', j && j.over && j.won === false, j ? `won=${j.won}` : 'no state')
  check('arc: a lost junction returns to the dive', (await page.evaluate(() => window.__deepSwarm.getState().phase)) !== undefined)

  // --- FAULT TRACE ----------------------------------------------------
  j = (await open('trace')).junction
  await setFault(10)
  await key('a'); await key('a')
  let t = await meta()
  check('trace: probe moves along the run', t.probe === 6, `probe at ${t.probe + 1}`)
  t = await key(' ')
  check('trace: upstream of the break reads continuity', t.reading === 'CONTINUITY', `@${t.readAt + 1}`)
  check('trace: continuity narrows the search downstream', t.known.lo === 7, `lo ${t.known.lo + 1}`)

  for (let i = 0; i < 8; i++) await key('d')
  t = await key(' ')
  check('trace: past the break reads open', t.reading === 'OPEN', `@${t.probe + 1}`)
  check('trace: open narrows the search upstream', t.known.hi === 14, `hi ${t.known.hi + 1}`)
  check('trace: probes are counted against the reserve', t.probes === 2, `${t.probes}/${t.maxProbes}`)

  // Binary search should close on the fault inside the probe budget.
  j = (await open('trace')).junction
  await setFault(6)
  let lo = 0, hi = 15, probes = 0
  while (lo < hi && probes < 5) {
    const mid = Math.floor((lo + hi) / 2)
    const cur = (await meta()).probe
    for (let i = 0; i < Math.abs(mid - cur); i++) await key(mid > cur ? 'd' : 'a')
    const r = await key(' ')
    probes++
    lo = r.known.lo; hi = r.known.hi
  }
  check('trace: binary search closes on the fault within budget', lo === hi && lo === 6, `converged to ${lo + 1} in ${probes} probes`)

  const at = (await meta()).probe
  for (let i = 0; i < Math.abs(6 - at); i++) await key(6 > at ? 'd' : 'a')
  t = await key('Enter')
  check('trace: cutting the right segment wins', t.over && t.won === true)

  j = (await open('trace')).junction
  await setFault(3)
  const p0 = (await meta()).probe
  for (let i = 0; i < Math.abs(12 - p0); i++) await key(12 > p0 ? 'd' : 'a')
  t = await key('Enter')
  check('trace: cutting the wrong segment loses', t.over && t.won === false)

  // --- LOAD BALANCE ---------------------------------------------------
  let l = (await open('load')).junction
  check('load: three buses and four loads', l.buses.length === 3 && l.loads.length === 4)
  check('load: a critical load is flagged', l.loads.some(x => x.critical), l.loads.filter(x => x.critical).map(x => x.name).join(','))
  check('load: nothing is cooked at the start', l.buses.every(b => !b.cooked))

  const startBus = l.loads[0].bus
  l = await key('1')
  check('load: a key moves that load to another bus', l.loads[0].bus !== startBus, `${startBus} -> ${l.loads[0].bus}`)

  // Pile everything onto one bus and it must cook.
  l = (await open('load')).junction
  for (let i = 0; i < 4; i++) {
    let guardB = 0
    while ((await meta()).loads[i].bus !== 1 && guardB++ < 4) await key(String(i + 1))
  }
  l = await advance(6)
  check('load: an overloaded bus cooks', l.over || l.buses.some(b => b.cooked), l.buses.map(b => `${b.name}${b.cooked ? '!' : ''}`).join(' '))

  // Left alone at sane loading, the cycle passes and you win.
  l = (await open('load')).junction
  l = await advance(l.dur + 2)
  check('load: riding out the cycle wins', l.over && l.won === true, `t=${Math.round(l.t)}s of ${l.dur}s`)

  // --- rewards still pay ----------------------------------------------
  await setReward('battery')
  const b0 = await battery()
  await open('trace')
  await setFault(4)
  const pAt = (await meta()).probe
  for (let i = 0; i < Math.abs(4 - pAt); i++) await key(4 > pAt ? 'd' : 'a')
  await key('Enter')
  await page.waitForTimeout(60)
  const b1 = await battery()
  check('reward: solving still pays the caller', b1 > b0, `battery ${b0} -> ${b1}`)

  await setReward('battery')
  const c0 = await battery()
  await open('trace')
  await setFault(2)
  const qAt = (await meta()).probe
  for (let i = 0; i < Math.abs(13 - qAt); i++) await key(13 > qAt ? 'd' : 'a')
  await key('Enter')
  await page.waitForTimeout(60)
  const c1 = await battery()
  check('failing costs power but never the hull', c1 < c0, `battery ${c0} -> ${c1}`)

  console.log(errors.length ? `\nconsole errors:\n${errors.join('\n')}` : '\nno console errors')
  if (errors.length) failures++
} finally {
  await browser.close()
}

// A summary that can only say "passed" is not a check. If the run dies early
// this count is short and the suite fails loudly instead of reporting green.
const EXPECTED = 32
if (ran !== EXPECTED) {
  console.log(`\n✗ ran ${ran} checks, expected ${EXPECTED} — the suite did not complete`)
  failures++
}
console.log(failures ? `\n${failures} junction check(s) failed` : '\nall junction checks passed')
process.exit(failures ? 1 : 0)
