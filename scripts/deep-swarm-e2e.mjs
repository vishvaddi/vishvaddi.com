import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
const requestFailures = []
page.on('pageerror', error => errors.push(String(error)))
page.on('requestfailed', request => requestFailures.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`))
page.on('console', message => {
  if (message.type() === 'error' && !/sw\.js|favicon|cloudflareinsights|ERR_FAILED/i.test(message.text())) errors.push(message.text())
})

try {
  await page.goto(`${BASE}/games/deep-swarm/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 15000 })
  const build = await page.evaluate(() => window.__deepSwarm.build)
  check('boot: blueprint build exposed', /blueprint/.test(build), build)

  await page.evaluate(() => window.__deepSwarm.startSeeded('boundary-soak'))
  await page.keyboard.down('s')
  await page.waitForTimeout(120)
  const movementState = await page.evaluate(() => window.__deepSwarm.getState())
  await page.keyboard.up('s')
  check('controls: holding S stays in the dive', movementState.phase === 'playing', movementState.phase)
  for (const depth of [0, 199, 200, 999, 1000, 1999, 2000, 3499, 3500, 4499, 4500, 6000]) {
    await page.evaluate(value => window.__deepSwarm.jumpDepth(value), depth)
    await page.waitForTimeout(120)
    const state = await page.evaluate(() => window.__deepSwarm.getState())
    check(`boundary: ${depth}m remains live`, !state.error && state.phase === 'playing', state.error?.message ?? state.phase)
  }

  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('systems')
    window.__deepSwarm.triggerSystemIncident('reactor', 70)
  })
  await page.waitForTimeout(100)
  const systemsState = await page.evaluate(() => window.__deepSwarm.getState())
  check('systems: random incident opens blueprint', systemsState.phase === 'systems' && systemsState.game.systems.reactor.condition === 30)
  if (process.env.DEEP_SWARM_SCREENSHOTS) await page.screenshot({ path: '.tmp-deep-swarm-systems.png' })

  const expectedErrors = errors.length
  await page.setViewportSize({ width: 844, height: 390 })
  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('render-recovery')
    const render = document.querySelector('#c').getContext('2d')
    const fillText = render.fillText.bind(render)
    let injected = false
    render.fillText = function (...args) {
      if (!injected) {
        injected = true
        this.save()
        this.beginPath()
        this.rect(this.canvas.width - 36, 0, 36, 36)
        this.clip()
        this.translate(this.canvas.width, 0)
        throw new Error('synthetic render fault')
      }
      return fillText(...args)
    }
  })
  await page.waitForTimeout(120)
  const faultState = await page.evaluate(() => {
    const render = document.querySelector('#c').getContext('2d')
    return {
      state: window.__deepSwarm.getState(),
      corner: [...render.getImageData(0, 0, 1, 1).data],
    }
  })
  check('runtime: fault screen escapes leaked viewport clip',
    faultState.state.phase === 'runtime_error' && faultState.corner[0] === 6 && faultState.corner[1] === 1 && faultState.corner[2] === 4,
    `${faultState.state.phase} · rgb(${faultState.corner.slice(0, 3).join(',')})`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(80)
  const recoveredState = await page.evaluate(() => window.__deepSwarm.getState())
  check('runtime: resume returns to the interrupted dive', recoveredState.phase === 'playing' && !recoveredState.error, recoveredState.phase)
  errors.splice(expectedErrors)

  const deployableState = await page.evaluate(() => window.__deepSwarm.triggerDeployableWeapon('decoy_launcher'))
  check('runtime: deployable weapons initialise their state',
    deployableState.phase === 'playing' && deployableState.game.deployables === 1 && !deployableState.error,
    `${deployableState.phase} · deployables ${deployableState.game.deployables}`)

  const junctionState = await page.evaluate(() => window.__deepSwarm.openJunctionTest())
  check('junction: scramble is limited to two or three moves',
    junctionState.phase === 'puzzle' && junctionState.solutionLength >= 2 && junctionState.solutionLength <= 3,
    `${junctionState.solutionLength} moves`)

  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('music-arc')
    window.__deepSwarm.jumpDepth(5200)
  })
  const musicState = await page.evaluate(() => window.__deepSwarm.getState())
  check('music: depth arc reaches jungle in the hadal zone',
    musicState.campaign.musicStage === 'jungle' && musicState.campaign.musicGenre === 'JUNGLE',
    `${musicState.campaign.musicStage} · ${musicState.campaign.musicGenre}`)

  const cadenceState = await page.evaluate(() => window.__deepSwarm.queueNereidTest())
  check('NEREID: routine observations queue instead of talking over each other',
    cadenceState.game.nereidQueue === 3 && cadenceState.phase === 'playing',
    `${cadenceState.game.nereidQueue} queued`)

  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('campaign-pda')
    window.__deepSwarm.prepareCampaignTest()
    window.__deepSwarm.showPDA(1)
  })
  await page.waitForTimeout(120)
  const pdaState = await page.evaluate(() => window.__deepSwarm.getState())
  check('campaign: PDA exposes structured research state',
    pdaState.phase === 'codex' && pdaState.campaign.pdaTab === 1 && pdaState.campaign.geology.includes('conductive_vein'),
    `${pdaState.phase} · tab ${pdaState.campaign.pdaTab}`)
  if (process.env.DEEP_SWARM_SCREENSHOTS) {
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    await page.screenshot({ path: '.tmp-deep-swarm-pda.png' })
  }
  await page.evaluate(() => window.__deepSwarm.showPDA(3))
  await page.keyboard.press('f')
  const fabricatedState = await page.evaluate(() => window.__deepSwarm.getState())
  check('campaign: PDA fabricates analysed components', fabricatedState.campaign.components.conductive_lens >= 2,
    `conductive lens ×${fabricatedState.campaign.components.conductive_lens || 0}`)
  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('campaign-mining')
    window.__deepSwarm.prepareCampaignTest()
    window.__deepSwarm.spawnTestDeposit('conductive_vein')
  })
  await page.keyboard.down('e')
  await page.waitForTimeout(4400)
  await page.keyboard.up('e')
  const miningState = await page.evaluate(() => window.__deepSwarm.getState())
  check('campaign: installed mining laser extracts surveyed rock',
    miningState.phase === 'playing' && miningState.game.minedDeposits === 1 && miningState.campaign.equipped.includes('mining_laser'),
    `${miningState.phase} · deposits ${miningState.game.minedDeposits}`)

  await page.evaluate(() => window.__deepSwarm.giveTestCargo())
  await page.waitForTimeout(100)
  const cargoState = await page.evaluate(() => window.__deepSwarm.getState())
  check('cargo: shaped test manifest opens', cargoState.phase === 'inventory' && cargoState.game.inventory === 3)
  await page.keyboard.press('r')
  await page.keyboard.press('ArrowRight')
  check('cargo: organisation controls keep console clean', errors.length === 0, errors.length ? [...errors, ...requestFailures].slice(0, 2).join(' | ') : '')

  await page.evaluate(() => window.__deepSwarm.setPhase('modules'))
  await page.keyboard.press('1')
  await page.waitForTimeout(100)
  const mobileState = await page.evaluate(() => window.__deepSwarm.getState())
  check('module bay: locked input is handled without fault', mobileState.phase === 'modules' && !mobileState.error)
  check('runtime: browser console remains clean', errors.length === 0, errors.length ? [...errors, ...requestFailures].slice(0, 3).join(' | ') : '')
} catch (error) {
  const boot = await page.evaluate(() => ({
    api: typeof window.__deepSwarm,
    scripts: [...document.scripts].map(script => script.src),
    canvas: !!document.querySelector('#c'),
  })).catch(() => null)
  check('suite completed', false, `${String(error).slice(0, 180)}${errors.length ? ` | ${errors.slice(0, 3).join(' | ')}` : ''} | ${JSON.stringify(boot)}`)
} finally {
  await browser.close()
}

if (failures) process.exit(1)
