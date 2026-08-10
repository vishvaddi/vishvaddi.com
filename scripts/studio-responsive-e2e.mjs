import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const viewports = [
  ['desktop', 1440, 900],
  ['laptop', 1280, 720],
  ['tablet', 1024, 768],
  ['phone', 390, 844],
  ['landscape', 844, 390],
]
let failures = 0
const lines = []
const check = (name, value, detail = '') => {
  lines.push(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
for (const [name, width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: name === 'phone' || name === 'landscape', isMobile: name === 'phone' || name === 'landscape' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/sw\.js|cloudflareinsights|ERR_FAILED|504|bad HTTP response|Outdated Optimize Dep/.test(message.text())) errors.push(message.text()) })
  try {
    await page.goto(`${BASE}/studio/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('vv_studio_v2')
      localStorage.setItem('vv_studio_tutorial_seen', '1')
      localStorage.setItem('vv_studio_mode', 'drums')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.wa-modebar', { timeout: 15000 })
    const geometry = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      winHeight: document.querySelector('.wa-win')?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    }))
    check(`${name}: no document horizontal overflow`, geometry.docWidth <= geometry.clientWidth + 1, `${geometry.docWidth}/${geometry.clientWidth}`)
    check(`${name}: workstation fills viewport`, Math.abs(geometry.winHeight - geometry.viewportHeight) <= 2, `${geometry.winHeight}/${geometry.viewportHeight}`)

    for (const mode of ['DRUMS', 'PADS', 'SYNTH', 'CLIPS', 'DJ', 'MIX']) {
      await page.locator('.wa-modekey', { hasText: mode }).click()
      check(`${name}: ${mode} opens`, await page.locator('.wa-modekey', { hasText: mode }).evaluate((node) => node.classList.contains('active')))
      if ((name === 'desktop' || name === 'laptop') && mode === 'PADS') {
        const fill = await page.evaluate(() => {
          const active = document.querySelector('.wa-page:not([hidden])')?.getBoundingClientRect()
          const host = document.querySelector('.wa-pagehost')?.getBoundingClientRect()
          return active && host ? host.bottom - active.bottom : 999
        })
        check(`${name}: ${mode} uses workspace height`, fill <= 20, `${Math.round(fill)}px unused`)
      }
      if ((name === 'desktop' || name === 'laptop') && mode === 'MIX') {
        const mixLayout = await page.evaluate(() => {
          const gap = (panelSelector, contentSelector) => {
            const panel = document.querySelector(panelSelector)?.getBoundingClientRect()
            const content = document.querySelector(contentSelector)?.getBoundingClientRect()
            return panel && content ? Math.round(panel.bottom - content.bottom) : 999
          }
          const channelTops = [...document.querySelectorAll('.wa-mixer .wa-ch')].map((channel) => Math.round(channel.getBoundingClientRect().top))
          return {
            // export moved to a transport-key modal; the device rail and the
            // channel plate are what must stay tight now
            gaps: [gap('.wa-mix-flex', '.wa-devbrowser'), gap('.wa-mix-channels', '.wa-mixer')],
            channelRows: new Set(channelTops).size,
          }
        })
        check(`${name}: MIX panels are compact`, mixLayout.gaps.every((gap) => gap <= 20), `${mixLayout.gaps.join('/')}px trailing space`)
        check(`${name}: MIX channels stay on one row`, mixLayout.channelRows === 1, `${mixLayout.channelRows} rows`)
        check(`${name}: MIX uses the single Void Coil visualiser`, await page.locator('.wa-page-mix .wa-spectral[data-visualizer="void-coil"]').count() === 1 && await page.locator('.wa-page-mix .wa-spectral-mode, .wa-page-mix .wa-master-scope').count() === 0)
        if (name === 'desktop') await page.screenshot({ path: 'C:/tmp/studio-mix-desktop.png', fullPage: false })
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'DRUMS') {
        const cell = await page.locator('.wa-grid .wa-cell').first().evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))
        check(`${name}: DRUMS cells remain usable`, cell.width >= 36 && cell.height >= 36, `${Math.round(cell.width)}×${Math.round(cell.height)}px`)
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'PADS') {
        const pads = await page.locator('.wa-mpc-pad').evaluateAll((nodes) => nodes.map((node) => {
          const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
        }))
        const overlaps = pads.some((a, i) => pads.some((b, j) => i < j && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1))
        check(`${name}: PADS remain separated`, !overlaps && pads.every((pad) => pad.width >= 60 && pad.height >= 72), `${Math.round(Math.min(...pads.map((pad) => pad.width)))}×${Math.round(Math.min(...pads.map((pad) => pad.height)))}px min`)
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'MIX') {
        const widths = await page.locator('.wa-mixer .wa-ch').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
        check(`${name}: MIX channels remain readable`, widths.every((width) => width >= 72), `${Math.round(Math.min(...widths))}px min`)
      }
      if (mode === 'DJ') {
        const djLayout = await page.evaluate(() => {
          const decks = [...document.querySelectorAll('.wa-dj-deck')].map((node) => node.getBoundingClientRect())
          const crossfader = document.querySelector('.wa-dj-crossfader input')?.getBoundingClientRect()
          const platter = document.querySelector('.wa-dj-platter')?.getBoundingClientRect()
          const pitch = document.querySelector('.wa-dj-pitch-fader input')?.getBoundingClientRect()
          const host = document.querySelector('.wa-dj-decks')?.getBoundingClientRect()
          const library = document.querySelector('.wa-dj-library')?.getBoundingClientRect()
          const mixer = document.querySelector('.wa-dj-mixer')
          const mixerRect = mixer?.getBoundingClientRect()
          const recordStatus = document.querySelector('.wa-dj-record-status')?.getBoundingClientRect()
          const performanceButtons = [...document.querySelectorAll('.wa-dj-deck .wa-dj-performance .wa-btn')].map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, clipped: node.scrollWidth > node.clientWidth + 1 }))
          return { widths: decks.map((deck) => Math.round(deck.width)), tops: decks.map((deck) => Math.round(deck.top)), crossfader: crossfader?.width ?? 0, platter: platter?.width ?? 0, pitchWidth: pitch?.width ?? 0, pitchHeight: pitch?.height ?? 0, hostBottom: host?.bottom ?? 0, libraryTop: library?.top ?? 0, performanceButtons, mixerScroll: mixer ? mixer.scrollHeight - mixer.clientHeight : 999, mixerBottom: mixerRect?.bottom ?? 0, recordBottom: recordStatus?.bottom ?? 999 }
        })
        check(`${name}: DJ exposes two usable decks`, djLayout.widths.length === 2 && djLayout.widths.every((width) => width >= (name === 'desktop' || name === 'laptop' ? 260 : 320)), djLayout.widths.join('/'))
        check(`${name}: DJ crossfader is usable`, djLayout.crossfader >= 90, `${Math.round(djLayout.crossfader)}px`)
        check(`${name}: DJ platter is turntable-sized`, djLayout.platter >= 220, `${Math.round(djLayout.platter)}px`)
        check(`${name}: DJ pitch control is vertical`, djLayout.pitchHeight > djLayout.pitchWidth * 2, `${Math.round(djLayout.pitchWidth)}×${Math.round(djLayout.pitchHeight)}px`)
        check(`${name}: DJ performance buttons do not squash`, djLayout.performanceButtons.every((button) => button.width >= 28 && button.height >= 30 && !button.clipped), `${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.width)))}×${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.height)))}px min`)
        check(`${name}: DJ mixer needs no internal scroll`, djLayout.mixerScroll <= 1 && djLayout.recordBottom <= djLayout.mixerBottom + 1, `${Math.round(djLayout.mixerScroll)}px overflow`)
        if (name === 'phone' || name === 'landscape') {
          check(`${name}: DJ decks stack instead of squash`, djLayout.tops[1] > djLayout.tops[0] + 400, djLayout.tops.join('/'))
          check(`${name}: DJ library follows the decks`, djLayout.libraryTop >= djLayout.hostBottom - 1, `${Math.round(djLayout.hostBottom)}/${Math.round(djLayout.libraryTop)}`)
        }
      }
    }

    await page.locator('.wa-modekey', { hasText: 'SYNTH' }).click()
    check(`${name}: three synth lanes`, await page.locator('.wa-roll-lane').count() === 3)
    await page.locator('.wa-roll-lane', { hasText: 'Lead' }).click()
    check(`${name}: lead lane activates`, await page.locator('.wa-roll-lane', { hasText: 'Lead' }).evaluate((node) => node.classList.contains('active')))
    await page.locator('.wa-field-modes button', { hasText: 'Drift' }).click()
    const before = await page.locator('.wa-xy-readout').textContent()
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(300)
    await page.keyboard.up('KeyD')
    const after = await page.locator('.wa-xy-readout').textContent()
    check(`${name}: signal garden responds to keyboard`, before !== after, `${before} → ${after}`)

    await page.locator('.wa-modekey', { hasText: 'CLIPS' }).click()
    // the first-run demo seeds an arrangement, so these assert a DELTA rather
    // than assuming the chain starts empty
    const blocksBefore = await page.locator('.wa-chain-block').count()
    await page.locator('.wa-composer-head button', { hasText: 'Add selected' }).click()
    check(`${name}: arrangement block added`, await page.locator('.wa-chain-block').count() === blocksBefore + 1)
    const rampsBefore = await page.locator('.wa-ramp-row').count()
    await page.locator('.wa-automation-editor button', { hasText: 'Ramp' }).click()
    check(`${name}: automation ramp added`, await page.locator('.wa-ramp-row').count() === rampsBefore + 1)

    if (name === 'phone' || name === 'landscape') {
      const targets = await page.locator('.wa-modekey').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
      check(`${name}: mode targets are touch-sized`, targets.every((size) => size >= 44), targets.join(','))
      check(`${name}: CLIPS exposes scene range`, /Scenes \d+–\d+ of 16/.test((await page.locator('.wa-scene-position').textContent()) ?? ''))
      await page.locator('.wa-transport button', { hasText: '? Tutorial' }).click()
      const tutorialTop = await page.evaluate(() => {
        const card = document.querySelector('.wa-tutorial-card'); if (!card) return false
        const r = card.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 8, r.top + 8)
        return r.top >= 0 && r.bottom <= innerHeight && !!top && card.contains(top)
      })
      check(`${name}: tutorial card stays above its target`, tutorialTop)
      await page.locator('.wa-tutorial-card button', { hasText: 'Close' }).click()
    }
    await page.screenshot({ path: `C:/tmp/studio-${name}.png`, fullPage: false })
    await page.locator('.wa-modekey', { hasText: 'DJ' }).click()
    await page.screenshot({ path: `C:/tmp/studio-dj-${name}.png`, fullPage: false })
    check(`${name}: console clean`, errors.length === 0, errors.slice(0, 2).join(' | '))
  } catch (error) {
    check(`${name}: run completed`, false, String(error).slice(0, 180))
  } finally {
    await context.close()
  }
}
await browser.close()

console.log(`\nVishAmp responsive E2E\n${lines.join('\n')}\n`)
if (failures) process.exit(1)
