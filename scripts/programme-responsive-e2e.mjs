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
} catch (error) {
  check('landscape: run completed', false, String(error).slice(0, 180))
} finally {
  await browser.close()
}

if (failures) process.exit(1)
