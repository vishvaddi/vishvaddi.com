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
const modeRoute = {
  DRUMS: ['drums', '.wa-page-drums'],
  PADS: ['pads', '.wa-page-pads'],
  SYNTH: ['synth', '.wa-page-synth'],
  CLIPS: ['song', '.wa-page-song'],
  DJ: ['dj', '.wa-page-dj'],
  MIX: ['mix', '.wa-page-mix'],
}
const openMode = async (page, mode) => {
  const [key] = modeRoute[mode]
  await page.locator(`.wa-modekey[data-mode="${key}"]`).click()
}
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
      localStorage.removeItem('vv_studio_mode')
      localStorage.removeItem('vv_studio_workspace')
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
    check(`${name}: PADS is the opening screen`, await page.locator('.wa-page-pads').isVisible())
    check(`${name}: six flat mode keys, no context row`, await page.locator('.wa-primary-nav .wa-modekey').count() === 6 && await page.locator('.wa-context-nav').count() === 0)

    for (const mode of ['DRUMS', 'PADS', 'SYNTH', 'CLIPS', 'DJ', 'MIX']) {
      await openMode(page, mode)
      check(`${name}: ${mode} opens`, await page.locator(modeRoute[mode][1]).isVisible())
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
        check(`${name}: MIX uses the single Lysergic sphere`, await page.locator('.wa-page-mix .wa-orb[data-visualizer="lysergic-sphere"]').count() === 1 && await page.locator('.wa-page-mix .wa-spectral, .wa-page-mix .wa-master-scope').count() === 0)
        if (name === 'desktop') await page.screenshot({ path: 'C:/tmp/studio-mix-desktop.png', fullPage: false })
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'DRUMS') {
        const cell = await page.locator('.wa-grid .wa-cell').first().evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))
        check(`${name}: DRUMS cells remain usable`, cell.width >= 36 && cell.height >= 36, `${Math.round(cell.width)}×${Math.round(cell.height)}px`)
      }
      if ((name === 'desktop' || name === 'laptop') && mode === 'DRUMS') {
        const sends = await page.locator('.wa-lane-sends').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
        check(`${name}: drum sends stay inside the inspector`, sends.scroll <= sends.client + 1, `${sends.scroll}/${sends.client}`)
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
        const mixGap = await page.evaluate(() => {
          const panel = document.querySelector('.wa-mix-channels')?.getBoundingClientRect()
          const mixer = document.querySelector('.wa-page-mix .wa-mixer')?.getBoundingClientRect()
          return panel && mixer ? Math.round(panel.bottom - mixer.bottom) : 999
        })
        check(`${name}: MIX channel plate has no dead band`, mixGap <= 24, `${mixGap}px trailing space`)
      }
      if (mode === 'SYNTH') {
        const hint = await page.locator('.wa-keys-hint').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
        check(`${name}: synth key hint is contained`, hint.scroll <= hint.client + 1, `${hint.scroll}/${hint.client}`)
      }
      if (mode === 'DJ') {
        const djLayout = await page.evaluate(() => {
          const decks = [...document.querySelectorAll('.wa-dj-deck')].map((node) => node.getBoundingClientRect())
          const crossfader = document.querySelector('.wa-dj-crossfader input')?.getBoundingClientRect()
          const platter = document.querySelector('.wa-dj-platter')?.getBoundingClientRect()
          const quartz = document.querySelector('.wa-dj-quartz')?.getBoundingClientRect()
          const pitch = document.querySelector('.wa-dj-pitch-fader input')?.getBoundingClientRect()
          const hostEl = document.querySelector('.wa-dj-decks')
          const host = hostEl?.getBoundingClientRect()
          const library = document.querySelector('.wa-dj-library')?.getBoundingClientRect()
          const mixer = document.querySelector('.wa-dj-mixer')
          const mixerRect = mixer?.getBoundingClientRect()
          const recordStatus = document.querySelector('.wa-dj-record-status')?.getBoundingClientRect()
          const performanceButtons = [...document.querySelectorAll('.wa-dj-deck .wa-dj-performance .wa-btn')].map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, clipped: node.scrollWidth > node.clientWidth + 1 }))
          const quartzClear = !platter || !quartz || quartz.bottom <= platter.top || quartz.right <= platter.left || quartz.left >= platter.right
          return { widths: decks.map((deck) => Math.round(deck.width)), tops: decks.map((deck) => Math.round(deck.top)), lefts: decks.map((deck) => Math.round(deck.left)), deckHostScroll: hostEl ? hostEl.scrollWidth - hostEl.clientWidth : 0, crossfader: crossfader?.width ?? 0, platter: platter?.width ?? 0, quartzClear, quartzGap: platter && quartz ? platter.top - quartz.bottom : 0, pitchWidth: pitch?.width ?? 0, pitchHeight: pitch?.height ?? 0, hostBottom: host?.bottom ?? 0, libraryTop: library?.top ?? 0, performanceButtons, mixerScroll: mixer ? mixer.scrollHeight - mixer.clientHeight : 999, mixerBottom: mixerRect?.bottom ?? 0, recordBottom: recordStatus?.bottom ?? 999 }
        })
        check(`${name}: DJ exposes two usable decks`, djLayout.widths.length === 2 && djLayout.widths.every((width) => width >= (name === 'desktop' || name === 'laptop' ? 260 : 320)), djLayout.widths.join('/'))
        check(`${name}: DJ crossfader is usable`, djLayout.crossfader >= 90, `${Math.round(djLayout.crossfader)}px`)
        check(`${name}: DJ platter is turntable-sized`, djLayout.platter >= 220, `${Math.round(djLayout.platter)}px`)
        check(`${name}: quartz badge clears the platter`, djLayout.quartzClear, `${Math.round(djLayout.quartzGap)}px gap`)
        check(`${name}: DJ pitch control is vertical`, djLayout.pitchHeight > djLayout.pitchWidth * 2, `${Math.round(djLayout.pitchWidth)}×${Math.round(djLayout.pitchHeight)}px`)
        check(`${name}: DJ performance buttons do not squash`, djLayout.performanceButtons.every((button) => button.width >= 28 && button.height >= 30 && !button.clipped), `${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.width)))}×${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.height)))}px min`)
        check(`${name}: DJ mixer needs no internal scroll`, djLayout.mixerScroll <= 1 && djLayout.recordBottom <= djLayout.mixerBottom + 1, `${Math.round(djLayout.mixerScroll)}px overflow`)
        if (name === 'phone' || name === 'landscape') {
          check(`${name}: DJ decks swipe horizontally`, Math.abs(djLayout.tops[1] - djLayout.tops[0]) <= 2 && djLayout.lefts[1] > djLayout.lefts[0] + 250 && djLayout.deckHostScroll > 0, `${djLayout.lefts.join('/')} · scroll ${Math.round(djLayout.deckHostScroll)}px`)
        }
      }
    }

    await openMode(page, 'SYNTH')
    check(`${name}: three synth lanes`, await page.locator('.wa-roll-lane').count() === 3)
    await page.locator('.wa-roll-lane', { hasText: 'Lead' }).click()
    check(`${name}: lead lane activates`, await page.locator('.wa-roll-lane', { hasText: 'Lead' }).evaluate((node) => node.classList.contains('active')))
    if (name === 'phone' || name === 'landscape') await page.locator('.wa-page-synth .wa-subtab', { hasText: 'Tools' }).click()
    await page.locator('.wa-field-modes button', { hasText: 'Drift' }).click()
    const before = await page.locator('.wa-xy-readout').textContent()
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(300)
    await page.keyboard.up('KeyD')
    const after = await page.locator('.wa-xy-readout').textContent()
    check(`${name}: signal garden responds to keyboard`, before !== after, `${before} → ${after}`)

    await openMode(page, 'CLIPS')
    // the first-run demo seeds an arrangement, so these assert a DELTA rather
    // than assuming the chain starts empty
    const blocksBefore = await page.locator('.wa-chain-block').count()
    await page.locator('.wa-composer-head button', { hasText: 'Scene' }).click()
    check(`${name}: arrangement block added`, await page.locator('.wa-chain-block').count() === blocksBefore + 1)
    // automation folds shut by default since S1 — open it to interact
    await page.evaluate(() => { document.querySelectorAll('.wa-fold').forEach((d) => { d.open = true } ) })
    const rampsBefore = await page.locator('.wa-ramp-row').count()
    await page.locator('.wa-automation-editor button', { hasText: 'Ramp' }).click()
    check(`${name}: automation ramp added`, await page.locator('.wa-ramp-row').count() === rampsBefore + 1)
    // With folds open, the composer may scroll internally — overlap is checked
    // open; fit/reachability are checked against the CLOSED default state.
    const foldOverlap = await page.evaluate(() => {
      const synth = document.querySelector('.wa-arrange-lane:last-child')?.getBoundingClientRect()
      const automation = document.querySelector('.wa-automation-editor')?.getBoundingClientRect()
      const composer = document.querySelector('.wa-composer')
      const composerScrolls = composer ? ['auto', 'scroll'].includes(getComputedStyle(composer).overflowY) : false
      return {
        overlap: synth && automation ? Math.max(0, synth.bottom - automation.top) : 999,
        composerScrolls,
      }
    })
    check(`${name}: Arrange lanes clear automation`, foldOverlap.overlap <= 0 || foldOverlap.composerScrolls, `${Math.round(foldOverlap.overlap)}px overlap`)
    await page.evaluate(() => { document.querySelectorAll('.wa-fold').forEach((d) => { d.open = false } ) })
    const arrangeLayout = await page.evaluate(() => {
      const page = document.querySelector('.wa-page-song')
      const panel = document.querySelector('.wa-arrange-main > .wa-panel')
      const folds = document.querySelector('.wa-fold')?.getBoundingClientRect()
      const pageRect = page?.getBoundingClientRect()
      const overflow = page ? getComputedStyle(page).overflowY : 'hidden'
      return {
        panelClip: panel ? panel.scrollHeight - panel.clientHeight : 999,
        reachable: !!page && !!pageRect && !!folds &&
          folds.bottom - pageRect.top <= page.scrollHeight + 1 &&
          (page.scrollHeight <= page.clientHeight + 1 || overflow === 'auto' || overflow === 'scroll'),
        pageScroll: page ? page.scrollHeight - page.clientHeight : 999,
      }
    })
    check(`${name}: Arrange panel does not hide content`, arrangeLayout.panelClip <= 1, `${Math.round(arrangeLayout.panelClip)}px clipped`)
    check(`${name}: all Arrange controls are reachable`, arrangeLayout.reachable, `${Math.round(arrangeLayout.pageScroll)}px internal scroll`)

    if (name === 'phone' || name === 'landscape') {
      const targets = await page.locator('.wa-primary-nav .wa-modekey').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
      check(`${name}: mode targets are touch-sized`, targets.every((size) => size >= 44), targets.join(','))
      const headerCollisions = await page.evaluate(() => {
        const lcd = document.querySelector('.wa-lcd')?.getBoundingClientRect()
        if (!lcd) return ['missing LCD']
        return [...document.querySelectorAll('.wa-title > *')].filter((node) => {
          const style = getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          const r = node.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.left < lcd.right - 1 && r.right > lcd.left + 1 && r.top < lcd.bottom - 1 && r.bottom > lcd.top + 1
        }).map((node) => node.className || node.tagName)
      })
      check(`${name}: header controls clear the status display`, headerCollisions.length === 0, headerCollisions.join(', ') || 'clear')
      const transport = await page.locator('.wa-transport').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
      check(`${name}: primary transport does not scroll`, transport.scroll <= transport.client + 1, `${transport.scroll}/${transport.client}`)
      await page.locator('.wa-transport-more').click()
      check(`${name}: secondary transport is disclosed`, await page.locator('.wa-transport-timing').isVisible() && await page.locator('.wa-transport-actions').isVisible())
      check(`${name}: CLIPS exposes scene range`, /Scenes \d+–\d+ of 16/.test((await page.locator('.wa-scene-position').textContent()) ?? ''))
      await openMode(page, 'DRUMS')
      // Flat nav (S2): all six keys must sit inside the viewport on the dock.
      const keyBounds = await page.locator('.wa-primary-nav .wa-modekey').evaluateAll((nodes) => nodes.map((node) => {
        const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }))
      check(`${name}: mode keys stay inside the viewport`, keyBounds.length === 6 && keyBounds.every((r) => r.top >= 0 && r.left >= 0 && r.right <= width + 1 && r.bottom <= height + 1), `${keyBounds.length} keys`)
      await openMode(page, 'CLIPS')
      await page.locator('.wa-transport button', { hasText: '? Tutorial' }).click()
      const tutorialTop = await page.evaluate(() => {
        const card = document.querySelector('.wa-tutorial-card'); if (!card) return false
        const r = card.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 8, r.top + 8)
        return r.top >= 0 && r.bottom <= innerHeight && !!top && card.contains(top)
      })
      check(`${name}: tutorial card stays above its target`, tutorialTop)
      await page.locator('.wa-tutorial-card button', { hasText: 'Close' }).click()
      await page.locator('.wa-transport-more').click()
    }
    await page.screenshot({ path: `C:/tmp/studio-${name}.png`, fullPage: false })
    await openMode(page, 'DJ')
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
