import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.goto(`${BASE}/site/programme/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('programme_v1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.prog-tpl').first().click()

  const geometry = await page.evaluate(() => {
    const root = document.querySelector('#programme-root')?.getBoundingClientRect()
    return {
      rootWidth: root?.width ?? 0,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      chartVisible: getComputedStyle(document.querySelector('.prog-gantt-wrap')).display !== 'none',
      tableHidden: getComputedStyle(document.querySelector('.prog-table-wrap')).display === 'none',
    }
  })
  check('landscape: editor uses at least 90% of viewport', geometry.rootWidth >= geometry.viewportWidth * 0.9, `${geometry.rootWidth}/${geometry.viewportWidth}`)
  check('landscape: no document horizontal overflow', geometry.documentWidth <= geometry.viewportWidth + 1, `${geometry.documentWidth}/${geometry.viewportWidth}`)
  check('landscape: chart-first mode is active', geometry.chartVisible && geometry.tableHidden)
  check('landscape: console clean', errors.length === 0, errors.slice(0, 2).join(' | '))

  await page.locator('[aria-label="Toggle fullscreen"]').click()
  await page.waitForTimeout(250)
  const fullscreen = await page.evaluate(() => {
    const root = document.querySelector('#programme-root')?.getBoundingClientRect()
    const chart = document.querySelector('.prog-gantt')?.getBoundingClientRect()
    return {
      active: !!document.fullscreenElement,
      rootWidth: root?.width ?? 0,
      chartWidth: chart?.width ?? 0,
      viewportWidth: innerWidth,
    }
  })
  check('landscape: fullscreen activates', fullscreen.active)
  check('landscape: fit recalculates after fullscreen', fullscreen.chartWidth >= fullscreen.rootWidth * 0.88, `${Math.round(fullscreen.chartWidth)}/${Math.round(fullscreen.rootWidth)}`)
  await page.locator('[aria-label="Toggle fullscreen"]').click()

  const originalTitle = await page.inputValue('.prog-title')
  await page.locator('[data-programme-help]').click()
  check('tutorial: searchable help opens', await page.locator('.prog-tut-browse:not([hidden])').count() === 1)
  await page.locator('.prog-tut-btn', { hasText: 'Guided tour' }).click()
  check('tutorial: disposable demo opens', (await page.inputValue('.prog-title')).startsWith('TUTORIAL'))
  check('tutorial: comprehensive walkthrough is exposed', (await page.textContent('.prog-tut-step')) === '1 / 12')
  await page.locator('.prog-tut-btn', { hasText: 'Close' }).click()
  check('tutorial: closing restores the live programme', await page.inputValue('.prog-title') === originalTitle)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const desktopGeometry = await page.evaluate(() => {
    const root = document.querySelector('#programme-root')?.getBoundingClientRect()
    const rail = document.querySelector('.site-rail')?.getBoundingClientRect()
    return {
      rootLeft: root?.left ?? 0,
      rootRight: root?.right ?? 0,
      rootWidth: root?.width ?? 0,
      railRight: rail?.right ?? 0,
      railVisible: rail ? getComputedStyle(document.querySelector('.site-rail')).display !== 'none' : false,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  check('desktop: site rail is visible', desktopGeometry.railVisible)
  check('desktop: editor clears the site rail', desktopGeometry.rootLeft >= desktopGeometry.railRight + 12, `${desktopGeometry.rootLeft}/${desktopGeometry.railRight}`)
  check('desktop: editor uses remaining workspace', desktopGeometry.rootWidth >= 900, `${desktopGeometry.rootWidth}px`)
  check('desktop: editor stays inside viewport', desktopGeometry.rootRight <= desktopGeometry.viewportWidth - 12, `${desktopGeometry.rootRight}/${desktopGeometry.viewportWidth}`)
  check('desktop: no document horizontal overflow', desktopGeometry.documentWidth <= desktopGeometry.viewportWidth + 1, `${desktopGeometry.documentWidth}/${desktopGeometry.viewportWidth}`)
} catch (error) {
  check('landscape: run completed', false, String(error).slice(0, 180))
} finally {
  await browser.close()
}

if (failures) process.exit(1)
