import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4400) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://localhost:4321'
const viewportFilter = process.argv[3]
const viewports = [
  ['desktop', 1440, 900],
  ['laptop', 1280, 720],
  ['tablet', 1024, 768],
  ['phone', 390, 844],
  ['landscape', 844, 390],
].filter(([name]) => !viewportFilter || name === viewportFilter)
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
  if (['DRUMS', 'PADS', 'SYNTH', 'MIX'].includes(mode)) await page.locator('.wa-modekey[data-intent="make"]').click()
  await page.locator(`.wa-modekey[data-mode="${key}"]`).click()
  if (mode === 'PADS') await page.locator('.wa-beat-tabs .wa-subtab', { hasText: 'Play' }).click()
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
      localStorage.setItem('vv_studio_start_v1_seen', '1')
      localStorage.removeItem('vv_studio_mode')
      localStorage.removeItem('vv_studio_workspace')
      localStorage.removeItem('vv_studio_beat_view')
      localStorage.removeItem('vv_studio_sample_view')
      localStorage.removeItem('vv_studio_synthview')
      localStorage.removeItem('vv_studio_synth_simple')
      localStorage.removeItem('vv_studio_synth_properties')
      localStorage.removeItem('vv_studio_drum_properties')
      localStorage.removeItem('vv_studio_drum_step_page')
      localStorage.removeItem('vv_studio_keyboard_roll')
      localStorage.removeItem('vv_studio_keyboard_patch')
      localStorage.removeItem('vv_studio_mix_view')
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
    check(`${name}: BEAT is the opening screen`, await page.locator('.wa-page-beat').isVisible())
    check(`${name}: four primary intents`, await page.locator('.wa-primary-nav .wa-modekey').count() === 4)
    check(`${name}: Make exposes four contextual instruments`, await page.locator('.wa-context-nav .wa-modekey').count() === 4)
    check(`${name}: conventional application menus are present`, await page.locator('.wa-studio-menu > .wa-menu').count() === 4)
    if (name === 'desktop' || name === 'laptop') {
      const shellDensity = await page.evaluate(() => ({
        appbar: document.querySelector('.wa-appbar')?.getBoundingClientRect().height ?? 999,
        rail: document.querySelector('.wa-modebar')?.getBoundingClientRect().width ?? 999,
      }))
      check(`${name}: application bar stays DAW-dense`, shellDensity.appbar <= 48, `${Math.round(shellDensity.appbar)}px`)
      check(`${name}: mode rail stays DAW-dense`, shellDensity.rail <= 56, `${Math.round(shellDensity.rail)}px`)
      for (const [label, className, key] of [
        ['Browser', 'wa-browser-hidden', 'vv_studio_browser_pane'],
        ['Inspector', 'wa-inspector-hidden', 'vv_studio_inspector_pane'],
        ['Device dock', 'wa-device-hidden', 'vv_studio_device_pane'],
      ]) {
        await page.locator('.wa-menu > summary', { hasText: 'View' }).click()
        await page.locator('.wa-menu[open] button', { hasText: label }).click()
        check(`${name}: ${label.toLowerCase()} pane can collapse`, await page.locator('.wa-win').evaluate((node, cls) => node.classList.contains(cls), className))
        check(`${name}: ${label.toLowerCase()} pane preference persists`, await page.evaluate((storageKey) => localStorage.getItem(storageKey) === 'hidden', key))
        await page.locator('.wa-menu > summary', { hasText: 'View' }).click()
        await page.locator('.wa-menu[open] button', { hasText: label }).click()
      }
    }
    await page.screenshot({ path: `studio-beat-${name}.png`, fullPage: false })
    await page.locator('.wa-beat-tabs .wa-subtab', { hasText: 'Sample' }).click()
    check(`${name}: one-shot editor opens without stacking the chopper`, await page.locator('.wa-load-selected').isVisible() && !await page.locator('.wa-break-card').isVisible())
    await page.locator('.wa-sample-tabs .wa-subtab', { hasText: 'Chop' }).click()
    check(`${name}: break chopper replaces the one-shot editor`, await page.locator('.wa-break-card button', { hasText: 'Load break' }).isVisible() && !await page.locator('.wa-load-selected').isVisible())
    check(`${name}: empty chopper explains its next action`, await page.locator('.wa-chop-empty').isVisible())
    await page.screenshot({ path: `studio-sample-${name}.png`, fullPage: false })
    await page.locator('.wa-beat-tabs .wa-subtab', { hasText: 'Play' }).click()

    for (const mode of ['DRUMS', 'PADS', 'SYNTH', 'CLIPS', 'DJ', 'MIX']) {
      await openMode(page, mode)
      check(`${name}: ${mode} opens`, await page.locator(modeRoute[mode][1]).isVisible())
      if (['DRUMS', 'PADS', 'SYNTH', 'MIX'].includes(mode)) {
        const pageScroll = await page.locator(modeRoute[mode][1]).evaluate((node) => ({ overflow: getComputedStyle(node).overflowY, range: node.scrollHeight - node.clientHeight }))
        check(`${name}: ${mode} stays in the fixed frame`, pageScroll.range <= 1 && pageScroll.overflow !== 'scroll', `${pageScroll.overflow} · ${Math.round(pageScroll.range)}px`)
      }
      if (mode === 'DRUMS') await page.screenshot({ path: `studio-drums-${name}.png`, fullPage: false })
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
          const channelTops = [...document.querySelectorAll('.wa-mixer .wa-ch')].map((channel) => Math.round(channel.getBoundingClientRect().top))
          const mix = document.querySelector('.wa-page-mix')
          return {
            channelRows: new Set(channelTops).size,
            overflow: mix ? getComputedStyle(mix).overflowY : '',
            scrollRange: mix ? mix.scrollHeight - mix.clientHeight : 0,
          }
        })
        check(`${name}: MIX channels stay on one row`, mixLayout.channelRows === 1, `${mixLayout.channelRows} rows`)
        check(`${name}: MIX frame does not scroll`, mixLayout.scrollRange <= 1 && mixLayout.overflow === 'hidden', `${mixLayout.overflow} · ${Math.round(mixLayout.scrollRange)}px`)
        const mixEnd = await page.evaluate(() => {
          const page = document.querySelector('.wa-page-mix .wa-mix-flex')?.getBoundingClientRect()
          const detail = document.querySelector('.wa-page-mix .wa-devdetail')?.getBoundingClientRect()
          const controls = [...document.querySelectorAll('.wa-page-mix .wa-devdetail .wa-device:not([style*="display: none"]) .wa-slider-row')].map((node) => node.getBoundingClientRect())
          return !!page && !!detail && detail.bottom <= page.bottom + 2 && detail.top < page.bottom && controls.every((control) => control.top >= detail.top - 1 && control.bottom <= detail.bottom + 1)
        })
        check(`${name}: complete device controls remain visible`, mixEnd)
        const orb = await page.locator('.wa-page-mix .wa-orb[data-visualizer="lysergic-sphere"]').evaluate((node) => {
          const rect = node.getBoundingClientRect(); return { visible: node.checkVisibility(), width: rect.width, height: rect.height }
        })
        check(`${name}: Lysergic sphere is permanently visible`, orb.visible && orb.width >= 240 && orb.height >= 180, `${Math.round(orb.width)}×${Math.round(orb.height)}px`)
        check(`${name}: MIX uses the single Lysergic sphere`, await page.locator('.wa-page-mix .wa-orb[data-visualizer="lysergic-sphere"]').count() === 1 && await page.locator('.wa-page-mix .wa-spectral, .wa-page-mix .wa-master-scope').count() === 0)
        if (name === 'desktop') await page.screenshot({ path: 'studio-mix-desktop.png', fullPage: false })
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'DRUMS') {
        const cell = await page.locator('.wa-grid .wa-cell').first().evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))
        check(`${name}: DRUMS cells remain usable`, cell.width >= 36 && cell.height >= 36, `${Math.round(cell.width)}×${Math.round(cell.height)}px`)
        const visibleSteps = await page.locator('.wa-page-drums .wa-row').first().locator('.wa-cell:visible').count()
        check(`${name}: DRUMS pages eight steps in place`, visibleSteps === 8 && /1–8/.test((await page.locator('.wa-step-range').textContent()) ?? ''), `${visibleSteps} steps`)
        check(`${name}: DRUMS step pager is visible`, await page.locator('.wa-step-pager-mobile').isVisible())
        await page.locator('.wa-step-pager-mobile button[aria-label="Next step page"]').click()
        check(`${name}: DRUMS pager reaches the second half`, /9–16/.test((await page.locator('.wa-step-range').textContent()) ?? ''))
        await page.locator('.wa-step-pager-mobile button[aria-label="Previous step page"]').click()
        await page.locator('.wa-drum-properties-toggle').click()
        check(`${name}: DRUMS properties open as a drawer`, await page.locator('.wa-drums-workspace > .wa-lane-aside').isVisible())
        check(`${name}: DRUMS drawer uses focused property pages`, await page.locator('.wa-drum-property-tabs .wa-subtab').count() === 4)
        await page.locator('.wa-drums-workspace .wa-properties-close').click()
      }
      if ((name === 'desktop' || name === 'laptop') && mode === 'DRUMS') {
        const propertyWidth = await page.evaluate(() => {
          const tabsNode = document.querySelector('.wa-drum-property-tabs')
          const inspectorNode = document.querySelector('.wa-lane-inspector')
          const tabs = tabsNode?.getBoundingClientRect()
          const inspector = inspectorNode?.getBoundingClientRect()
          const style = tabsNode ? getComputedStyle(tabsNode) : null
          const parent = inspectorNode ? getComputedStyle(inspectorNode) : null
          return tabs && inspector ? { tabs: tabs.width, inspector: inspector.width, css: style?.width, display: style?.display, flex: style?.flex, parent: parent?.display } : { tabs: 0, inspector: 1 }
        })
        check(`${name}: drum property tabs use the rail width`, propertyWidth.tabs >= propertyWidth.inspector * .9, `${Math.round(propertyWidth.tabs)}/${Math.round(propertyWidth.inspector)} · ${propertyWidth.css} ${propertyWidth.display} ${propertyWidth.flex} in ${propertyWidth.parent}`)
        await page.locator('.wa-drum-property-tabs .wa-subtab', { hasText: 'Sends' }).click()
        const sends = await page.locator('.wa-lane-sends').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
        check(`${name}: drum sends stay inside the inspector`, sends.scroll <= sends.client + 1, `${sends.scroll}/${sends.client}`)
        const drumLayout = await page.evaluate(() => ({
          row: document.querySelector('.wa-page-drums .wa-row')?.getBoundingClientRect().height ?? 0,
          inspector: document.querySelector('.wa-drums-workspace > .wa-lane-aside')?.getBoundingClientRect().width ?? 0,
        }))
        check(`${name}: DRUMS rows and property rail have working space`, drumLayout.row >= 38 && drumLayout.inspector >= 280, `${Math.round(drumLayout.row)}px / ${Math.round(drumLayout.inspector)}px`)
      }
      if ((name === 'phone' || name === 'landscape') && mode === 'PADS') {
        const pads = await page.locator('.wa-mpc-pad').evaluateAll((nodes) => nodes.map((node) => {
          const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
        }))
        const overlaps = pads.some((a, i) => pads.some((b, j) => i < j && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1))
        check(`${name}: PADS remain separated`, !overlaps && pads.every((pad) => pad.width >= 60 && pad.height >= 72), `${Math.round(Math.min(...pads.map((pad) => pad.width)))}×${Math.round(Math.min(...pads.map((pad) => pad.height)))}px min`)
        await page.locator('.wa-beat-controls-toggle').click()
        check(`${name}: BEAT controls open as a drawer`, await page.locator('.wa-mpc-side').isVisible())
        await page.locator('.wa-beat-controls-close').click()
      }
      if (mode === 'PADS') {
        if (name === 'phone' || name === 'landscape') await page.locator('.wa-beat-controls-toggle').click()
        await page.locator('.wa-pad-view-toggle .wa-subtab:visible', { hasText: 'All steps' }).first().click()
        const allPadRows = await page.locator('.wa-device-dock[data-sequence-view="all"] .wa-event-grid > .wa-row:visible').count()
        check(`${name}: all-pad view exposes every pad lane`, allPadRows === 16, `${allPadRows}/16 lanes`)
        check(`${name}: all-pad sequencer replaces the performance surface`, !await page.locator('.wa-mpc-pad:visible').count())
        check(`${name}: pad view preference persists`, await page.evaluate(() => localStorage.getItem('vv_studio_pad_sequence_view')) === 'all')
        check(`${name}: all-pad switch shows its active state`, await page.locator('.wa-device-dock [data-sequence-view="all"]').evaluate((node) => node.classList.contains('active')) && !await page.locator('.wa-device-dock [data-sequence-view="selected"]').evaluate((node) => node.classList.contains('active')))
        if (name === 'desktop') await page.screenshot({ path: 'studio-pads-all-desktop.png', fullPage: false })
        await page.locator('.wa-device-dock .wa-pad-view-toggle .wa-subtab:visible', { hasText: 'Pads' }).click()
        check(`${name}: performance pads remain available`, await page.locator('.wa-mpc-pad:visible').count() === 16)
        if (name === 'phone' || name === 'landscape') await page.locator('.wa-beat-controls-close').click()
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
        check(`${name}: MIX exposes three in-place pages`, await page.locator('.wa-mix-tabs .wa-subtab').count() === 3)
        await page.locator('.wa-mix-tabs .wa-subtab', { hasText: 'Devices' }).click()
        check(`${name}: MIX device page replaces channels`, await page.locator('.wa-mix-flex').isVisible() && !await page.locator('.wa-mix-channels').isVisible())
        await page.locator('.wa-mix-tabs .wa-subtab', { hasText: 'Scope' }).click()
        check(`${name}: MIX scope page replaces devices`, await page.locator('.wa-mix-scope').isVisible() && !await page.locator('.wa-mix-flex').isVisible())
        await page.locator('.wa-mix-tabs .wa-subtab', { hasText: 'Channels' }).click()
      }
      if (mode === 'SYNTH') {
        const hint = await page.locator('.wa-keys-hint').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
        check(`${name}: synth key hint is contained`, hint.scroll <= hint.client + 1, `${hint.scroll}/${hint.client}`)
        if (name !== 'phone' && name !== 'landscape') check(`${name}: synth property rail stays visible`, await page.locator('.wa-synth-properties').isVisible())
        else {
          await page.locator('.wa-synth-properties-toggle').click()
          check(`${name}: synth properties open as a drawer`, await page.locator('.wa-synth-properties').isVisible())
          check(`${name}: synth drawer uses focused property pages`, await page.locator('.wa-synth-properties .wa-property-tabs .wa-subtab').count() === 3)
          await page.locator('.wa-synth-properties .wa-properties-close').click()
        }
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
          const performanceButtons = [...document.querySelectorAll('.wa-dj-deck .wa-dj-performance .wa-btn')]
            .filter((node) => node.checkVisibility())
            .map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, clipped: node.scrollWidth > node.clientWidth + 1 }))
          const turntable = document.querySelector('.wa-dj-deck-a .wa-dj-turntable')?.getBoundingClientRect()
          const start = document.querySelector('.wa-dj-deck-a .wa-dj-start')?.getBoundingClientRect()
          const speed = document.querySelector('.wa-dj-deck-a .wa-dj-speed')?.getBoundingClientRect()
          const intersects = (a, b) => !!a && !!b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
          const contained = (outer, inner) => !!outer && !!inner && inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1
          const quartzClear = !platter || !quartz || quartz.bottom <= platter.top || quartz.right <= platter.left || quartz.left >= platter.right
          return { widths: decks.map((deck) => Math.round(deck.width)), tops: decks.map((deck) => Math.round(deck.top)), lefts: decks.map((deck) => Math.round(deck.left)), deckHostScroll: hostEl ? hostEl.scrollWidth - hostEl.clientWidth : 0, crossfader: crossfader?.width ?? 0, platter: platter?.width ?? 0, platterControlsClear: contained(turntable, platter) && contained(turntable, start) && contained(turntable, speed) && !intersects(platter, start) && !intersects(platter, speed), quartzClear, quartzGap: platter && quartz ? platter.top - quartz.bottom : 0, pitchWidth: pitch?.width ?? 0, pitchHeight: pitch?.height ?? 0, hostBottom: host?.bottom ?? 0, libraryTop: library?.top ?? 0, performanceButtons, mixerScroll: mixer ? mixer.scrollHeight - mixer.clientHeight : 999, mixerBottom: mixerRect?.bottom ?? 0, recordBottom: recordStatus?.bottom ?? 999 }
        })
        check(`${name}: DJ exposes two usable decks`, djLayout.widths.length === 2 && djLayout.widths.every((width) => width >= (name === 'desktop' || name === 'laptop' ? 260 : 320)), djLayout.widths.join('/'))
        check(`${name}: DJ crossfader is usable`, djLayout.crossfader >= 90, `${Math.round(djLayout.crossfader)}px`)
        if (name === 'desktop' || name === 'laptop' || name === 'tablet') {
          check(`${name}: DJ platter is turntable-sized`, djLayout.platter >= 220, `${Math.round(djLayout.platter)}px`)
          check(`${name}: DJ platter clears 33/45 and start controls`, djLayout.platterControlsClear)
          check(`${name}: quartz badge clears the platter`, djLayout.quartzClear, `${Math.round(djLayout.quartzGap)}px gap`)
          check(`${name}: DJ pitch control is vertical`, djLayout.pitchHeight > djLayout.pitchWidth * 2, `${Math.round(djLayout.pitchWidth)}×${Math.round(djLayout.pitchHeight)}px`)
        } else check(`${name}: compact DJ view removes the decorative platter`, djLayout.platter === 0)
        check(`${name}: DJ performance buttons do not squash`, djLayout.performanceButtons.length > 0 && djLayout.performanceButtons.every((button) => button.width >= 28 && button.height >= 30 && !button.clipped), `${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.width)))}×${Math.round(Math.min(...djLayout.performanceButtons.map((button) => button.height)))}px min`)
        check(`${name}: DJ mixer needs no internal scroll`, djLayout.mixerScroll <= 1 && djLayout.recordBottom <= djLayout.mixerBottom + 1, `${Math.round(djLayout.mixerScroll)}px overflow`)
        if (name === 'phone') {
          check(`${name}: DJ decks swipe horizontally`, Math.abs(djLayout.tops[1] - djLayout.tops[0]) <= 2 && djLayout.lefts[1] > djLayout.lefts[0] + 250 && djLayout.deckHostScroll > 0, `${djLayout.lefts.join('/')} · scroll ${Math.round(djLayout.deckHostScroll)}px`)
        } else if (name === 'landscape') {
          check(`${name}: both DJ decks share the performance surface`, Math.abs(djLayout.tops[1] - djLayout.tops[0]) <= 2 && djLayout.lefts[1] > djLayout.lefts[0] + 250 && djLayout.recordBottom <= djLayout.hostBottom + 1, `${djLayout.lefts.join('/')} · mixer ${Math.round(djLayout.recordBottom)}/${Math.round(djLayout.hostBottom)}`)
        }
      }
    }

    await openMode(page, 'SYNTH')
    check(`${name}: three synth lanes`, await page.locator('.wa-roll-lane').count() === 3)
    await page.locator('.wa-roll-lane', { hasText: 'Lead' }).click()
    check(`${name}: lead lane activates`, await page.locator('.wa-roll-lane', { hasText: 'Lead' }).evaluate((node) => node.classList.contains('active')))
    check(`${name}: synth has Notes and Sound only`, await page.locator('.wa-page-synth .wa-subtab').evaluateAll((nodes) => nodes.filter((node) => ['Notes', 'Sound'].includes(node.textContent.trim())).length) === 2 && await page.locator('.wa-page-synth .wa-subtab', { hasText: 'Tools' }).count() === 0)
    await page.locator('.wa-page-synth .wa-subtab', { hasText: 'Sound' }).click()
    check(`${name}: essential synth controls fit the main surface`, await page.locator('.wa-synth-quick').isVisible() && await page.locator('.wa-synth-quick .wa-slider-row').count() === 7)
    const soundDensity = await page.locator('.wa-synth-quick .wa-slider-row').evaluateAll((nodes) => ({
      tallest: Math.max(...nodes.map((node) => node.getBoundingClientRect().height)),
      average: nodes.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0) / nodes.length,
    }))
    check(`${name}: synth controls use instrument density`, soundDensity.tallest <= 150, `${Math.round(soundDensity.average)}px average / ${Math.round(soundDensity.tallest)}px max`)
    await page.locator('.wa-synth-modebar button', { hasText: 'Advanced' }).click()
    check(`${name}: advanced synth uses seven fixed banks`, await page.locator('.wa-synth-bank-nav .wa-subtab').count() === 7)
    for (const bank of ['OSC 1', 'OSC 2', 'NOISE', 'FILTER', 'Envelopes', 'LFO', 'MATRIX']) {
      await page.locator('.wa-synth-bank-nav .wa-subtab', { hasText: bank, exact: true }).click()
      if (name === 'landscape' && bank === 'OSC 1') await page.screenshot({ path: 'studio-synth-osc-landscape.png', fullPage: false })
      const bankFit = await page.locator('.wa-vpatch:not(.wa-simple)').evaluate((node) => {
        const host = node.getBoundingClientRect()
        const visible = [...node.querySelectorAll(':scope > [data-synth-bank], :scope > [data-synth-bank] .wa-slider-row, :scope > [data-synth-bank] select, :scope > [data-synth-bank] canvas')].filter((child) => child.checkVisibility())
        const controls = visible.map((child) => child.getBoundingClientRect())
        const contained = (control) => control.top >= host.top - 1 && control.bottom <= host.bottom + 1 && control.left >= host.left - 1 && control.right <= host.right + 1
        const bounds = (rect) => ({ left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) })
        return {
          scroll: node.scrollHeight - node.clientHeight,
          count: controls.length,
          contained: controls.every(contained),
          host: bounds(host),
          offenders: visible
            .filter((child) => !contained(child.getBoundingClientRect()))
            .map((child) => ({ name: child.className || child.tagName, ...bounds(child.getBoundingClientRect()) }))
            .slice(0, 3),
        }
      })
      check(`${name}: ${bank} synth bank fits without scrolling`, bankFit.count > 0 && bankFit.scroll <= 1 && bankFit.contained, `${bankFit.count} modules · ${Math.round(bankFit.scroll)}px · host ${JSON.stringify(bankFit.host)} · ${JSON.stringify(bankFit.offenders)}`)
    }
    await page.screenshot({ path: `studio-synth-advanced-${name}.png`, fullPage: false })
    await page.locator('.wa-synth-modebar button', { hasText: 'Essentials' }).click()
    check(`${name}: keyboard stays out of the workspace until requested`, !await page.locator('.wa-page-synth > .wa-keys').isVisible())
    await page.locator('.wa-keyboard-toggle').click()
    check(`${name}: keyboard remains available on demand`, await page.locator('.wa-page-synth > .wa-keys').isVisible())
    await page.screenshot({ path: `studio-sound-${name}.png`, fullPage: false })

    await openMode(page, 'CLIPS')
    // the first-run demo seeds an arrangement, so these assert a DELTA rather
    // than assuming the chain starts empty
    const blocksBefore = await page.locator('.wa-chain-block').count()
    await page.locator('.wa-composer-head button', { hasText: 'Clip' }).click()
    check(`${name}: arrangement block added`, await page.locator('.wa-chain-block').count() === blocksBefore + 1)
    if (await page.locator('.wa-arrange-selection').isVisible()) await page.locator('.wa-arrange-selection button[aria-label="Close clip inspector"]').click()
    // automation folds shut by default since S1 — open it to interact
    await page.evaluate(() => { document.querySelectorAll('.wa-fold').forEach((d) => { d.open = true } ) })
    const rampsBefore = await page.locator('.wa-ramp-row').count()
    await page.locator('.wa-automation-editor button', { hasText: 'Ramp' }).click()
    check(`${name}: automation ramp added`, await page.locator('.wa-ramp-row').count() === rampsBefore + 1)
    if (await page.locator('.wa-arrange-selection').isVisible()) await page.locator('.wa-arrange-selection button[aria-label="Close clip inspector"]').click()
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
    await page.screenshot({ path: `studio-arrange-${name}.png`, fullPage: false })

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
      const transport = await page.locator('.wa-appbar > .wa-transport').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
      check(`${name}: primary transport does not scroll`, transport.scroll <= transport.client + 1, `${transport.scroll}/${transport.client}`)
      await page.locator('.wa-transport-more').click()
      check(`${name}: secondary timing is disclosed`, await page.locator('.wa-transport-timing').isVisible())
      await page.locator('.wa-transport-more').click()
      check(`${name}: CLIPS exposes scene range`, /Scenes \d+–\d+ of 16/.test((await page.locator('.wa-scene-position').textContent()) ?? ''))
      await openMode(page, 'PADS')
      // The four outcome destinations must sit inside the viewport on the dock.
      const keyBounds = await page.locator('.wa-primary-nav .wa-modekey').evaluateAll((nodes) => nodes.map((node) => {
        const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }))
      check(`${name}: mode keys stay inside the viewport`, keyBounds.length === 4 && keyBounds.every((r) => r.top >= 0 && r.left >= 0 && r.right <= width + 1 && r.bottom <= height + 1), `${keyBounds.length} keys`)
      await openMode(page, 'CLIPS')
      await page.locator('.wa-menu > summary', { hasText: 'Help' }).click()
      await page.locator('.wa-menu[open] .wa-studio-menu-body button', { hasText: 'Help & shortcuts' }).click()
      const tutorialTop = await page.evaluate(() => {
        const card = document.querySelector('.wa-tutorial-card'); if (!card) return false
        const r = card.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 8, r.top + 8)
        return r.top >= 0 && r.bottom <= innerHeight && !!top && card.contains(top)
      })
      check(`${name}: tutorial card stays above its target`, tutorialTop)
      await page.locator('.wa-tutorial-card button', { hasText: 'Close' }).click()
    }
    await page.screenshot({ path: `studio-${name}.png`, fullPage: false })
    await openMode(page, 'DJ')
    await page.screenshot({ path: `studio-dj-${name}.png`, fullPage: false })
    check(`${name}: console clean`, errors.length === 0, errors.slice(0, 2).join(' | '))
  } catch (error) {
    check(`${name}: run completed`, false, String(error).slice(0, 180))
  } finally {
    await context.close()
  }
}
await browser.close()
if (builtSite) await builtSite.close()

console.log(`\nVishAmp responsive E2E\n${lines.join('\n')}\n`)
if (failures) process.exit(1)
