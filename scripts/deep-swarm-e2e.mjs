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
  await page.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 15000 })
  const build = await page.evaluate(() => window.__deepSwarm.build)
  check('boot: cockpit build exposed', /cockpit/.test(build), build)
  const bootState = await page.evaluate(() => window.__deepSwarm.getState())
  check('boot: input becomes ready on the first title frame', bootState.boot.inputReadyMs > 0 && bootState.boot.firstFrameMs > 0,
    `${bootState.boot.inputReadyMs}/${bootState.boot.firstFrameMs}ms`)
  check('save: versioned local profile is active', bootState.save.version === 2 && !!bootState.save.profileId,
    `v${bootState.save.version}`)

  await page.evaluate(() => window.__deepSwarm.startSeeded('boundary-soak'))
  await page.keyboard.down('s')
  await page.waitForTimeout(120)
  const movementState = await page.evaluate(() => window.__deepSwarm.getState())
  await page.keyboard.up('s')
  check('controls: holding S stays in the dive', movementState.phase === 'playing', movementState.phase)
  check('options: auto-ping defaults off', movementState.options.autoPing === false && movementState.game.autoPing === false)
  check('HUD: XP is the primary viewport metric', movementState.game.hud.primaryMetric === 'xp', movementState.game.hud.primaryMetric)
  check('opening: first-career grace is ten seconds or less', movementState.game.openingGrace <= 10, `${movementState.game.openingGrace}s`)
  const checkpointState = await page.evaluate(() => window.__deepSwarm.checkpointRoundTrip())
  check('save: interrupted dive resumes from a safe checkpoint', checkpointState.resumed && checkpointState.phase === 'playing' && checkpointState.depth === 1234 && checkpointState.xp === 7,
    JSON.stringify(checkpointState))
  const brownoutState = await page.evaluate(() => window.__deepSwarm.brownoutRecovery())
  check('reserve: brownout recovers without draining hull', !brownoutState.brownout && brownoutState.battery >= 11 && brownoutState.hp === 90,
    `${brownoutState.battery.toFixed(1)}% · hull ${brownoutState.hp}`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  await page.keyboard.press('c')
  const toggledOptions = await page.evaluate(() => window.__deepSwarm.getState())
  check('options: sonar and camera preferences toggle in pause', toggledOptions.options.autoPing === true && toggledOptions.game.autoPing === true && toggledOptions.options.cameraMotion === false)
  await page.keyboard.press('f')
  await page.keyboard.press('c')
  await page.keyboard.press('Escape')
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
  await page.waitForFunction(() => {
    if (window.__deepSwarm?.getState()?.phase !== 'runtime_error') return false
    const pixel = document.querySelector('#c').getContext('2d').getImageData(0, 0, 1, 1).data
    return pixel[0] === 6 && pixel[1] === 1 && pixel[2] === 4
  }, null, { timeout: 3000 })
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

  const wakeState = await page.evaluate(() => window.__deepSwarm.triggerDeployableWeapon('decoy_launcher'))
  check('weapons: Cavitation Wake arms the next dash',
    wakeState.phase === 'playing' && wakeState.game.wakeArmed === 1 && wakeState.game.deployables === 0 && !wakeState.error,
    `${wakeState.phase} · armed ${wakeState.game.wakeArmed}`)

  const fieldState = await page.evaluate(() => window.__deepSwarm.testElectricField())
  check('weapons: Electric Field applies its full pulse damage',
    fieldState.phase === 'playing' && fieldState.damage >= 2.9 && !fieldState.error,
    `${fieldState.damage.toFixed(2)} damage`)

  await page.evaluate(() => window.__deepSwarm.triggerMissingColourRender())
  await page.waitForTimeout(120)
  const colourState = await page.evaluate(() => window.__deepSwarm.getState())
  check('runtime: missing dynamic colours use a safe fallback',
    colourState.phase === 'playing' && !colourState.error,
    colourState.error || colourState.phase)

  const junctionState = await page.evaluate(() => window.__deepSwarm.openJunctionTest())
  check('junction: opens one of the three fault screens',
    junctionState.phase === 'puzzle' && ['arc', 'trace', 'load'].includes(junctionState.junction && junctionState.junction.kind),
    junctionState.junction && junctionState.junction.kind)

  await page.evaluate(() => {
    window.__deepSwarm.startSeeded('music-arc')
    window.__deepSwarm.jumpDepth(5200)
  })
  const musicState = await page.evaluate(() => window.__deepSwarm.getState())
  check('music: depth arc reaches jungle in the hadal zone',
    musicState.campaign.musicStage === 'jungle' && musicState.campaign.musicGenre === 'JUNGLE',
    `${musicState.campaign.musicStage} · ${musicState.campaign.musicGenre}`)

  const cadenceState = await page.evaluate(() => window.__deepSwarm.queueNereidTest())
  check('NEREID: routine observations collapse to the latest useful line',
    cadenceState.game.nereidQueue === 1 && cadenceState.phase === 'playing',
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
}

await context.close()
for (const [name, width, height] of [
  ['android portrait', 412, 915],
  ['android landscape', 915, 412],
]) {
  const mobileContext = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
  })
  const mobilePage = await mobileContext.newPage()
  const mobileErrors = []
  mobilePage.on('pageerror', error => mobileErrors.push(String(error)))
  mobilePage.on('console', message => {
    if (message.type() === 'error' && !/sw\.js|favicon|cloudflareinsights|ERR_FAILED/i.test(message.text())) mobileErrors.push(message.text())
  })
  try {
    await mobilePage.goto(`${BASE}/games/deep-swarm/index.html`, { waitUntil: 'domcontentloaded' })
    await mobilePage.waitForFunction(() => window.__deepSwarm?.build, null, { timeout: 15000 })
    await mobilePage.evaluate(() => window.__deepSwarm.startSeeded('android-fit'))
    await mobilePage.waitForTimeout(120)
    const geometry = await mobilePage.evaluate(() => {
      const canvas = document.querySelector('#c').getBoundingClientRect()
      return {
        docWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        canvasWidth: Math.round(canvas.width),
        canvasHeight: Math.round(canvas.height),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }
    })
    check(`${name}: no horizontal overflow`, geometry.docWidth <= geometry.clientWidth + 1, `${geometry.docWidth}/${geometry.clientWidth}`)
    check(`${name}: canvas fits the viewport`,
      Math.abs(geometry.canvasWidth - geometry.viewportWidth) <= 1 && Math.abs(geometry.canvasHeight - geometry.viewportHeight) <= 1,
      `${geometry.canvasWidth}×${geometry.canvasHeight}/${geometry.viewportWidth}×${geometry.viewportHeight}`)

    await mobilePage.evaluate(() => window.__deepSwarm.triggerMissingColourRender())
    await mobilePage.waitForTimeout(120)
    const runtimeState = await mobilePage.evaluate(() => window.__deepSwarm.getState())
    check(`${name}: dive remains live`, runtimeState.phase === 'playing' && !runtimeState.error, runtimeState.error || runtimeState.phase)

    await mobilePage.evaluate(() => window.__deepSwarm.triggerSystemIncident('reactor', 45))
    await mobilePage.waitForTimeout(120)
    const systemsState = await mobilePage.evaluate(() => window.__deepSwarm.getState())
    check(`${name}: repair blueprint opens`, systemsState.phase === 'systems' && !systemsState.error, systemsState.error || systemsState.phase)
    if (process.env.DEEP_SWARM_SCREENSHOTS) {
      await mobilePage.screenshot({ path: `.tmp-deep-swarm-${name.replace(' ', '-')}.png`, fullPage: false })
    }
    check(`${name}: console clean`, mobileErrors.length === 0, mobileErrors.slice(0, 2).join(' | '))
  } catch (error) {
    check(`${name}: responsive run completed`, false, String(error).slice(0, 180))
  } finally {
    await mobileContext.close()
  }
}
await browser.close()

if (failures) process.exit(1)
