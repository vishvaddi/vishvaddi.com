import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const viewports = [
  ['desktop', 1440, 900],
  ['laptop', 1280, 720],
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

    for (const mode of ['DRUMS', 'PADS', 'SYNTH', 'CLIPS', 'MIX']) {
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
      }
    }

    await page.locator('.wa-modekey', { hasText: 'SYNTH' }).click()
    check(`${name}: three synth lanes`, await page.locator('.wa-roll-lane').count() === 3)
    await page.locator('.wa-roll-lane', { hasText: 'Lead' }).click()
    check(`${name}: lead lane activates`, await page.locator('.wa-roll-lane', { hasText: 'Lead' }).evaluate((node) => node.classList.contains('active')))
    await page.locator('.wa-field-modes button', { hasText: 'Scan' }).click()
    const before = await page.locator('.wa-xy-readout').textContent()
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(300)
    await page.keyboard.up('KeyD')
    const after = await page.locator('.wa-xy-readout').textContent()
    check(`${name}: band scan responds to keyboard`, before !== after, `${before} → ${after}`)

    await page.locator('.wa-modekey', { hasText: 'CLIPS' }).click()
    await page.locator('.wa-composer-head button', { hasText: 'Add selected' }).click()
    check(`${name}: arrangement block added`, await page.locator('.wa-chain-block').count() === 1)
    await page.locator('.wa-automation-editor button', { hasText: 'Ramp' }).click()
    check(`${name}: automation ramp added`, await page.locator('.wa-ramp-row').count() === 1)

    if (name === 'phone' || name === 'landscape') {
      const targets = await page.locator('.wa-modekey').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
      check(`${name}: mode targets are touch-sized`, targets.every((size) => size >= 44), targets.join(','))
    }
    await page.screenshot({ path: `C:/tmp/studio-${name}.png`, fullPage: false })
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
