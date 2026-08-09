import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4322'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const routes = [
  '/site/calc/', '/site/notepad/', '/site/convert/', '/site/materials/', '/site/geometry/', '/site/rate/',
  '/site/charge-rate/', '/site/prices/', '/site/programme/', '/site/cut-list/', '/site/lattice/', '/site/span/',
  '/site/records/', '/site/voice/', '/site/sketch/', '/site/gauges/', '/site/pdf/', '/site/quickref/', '/site/resources/',
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [label, width, height, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    let pickerReference = null
    for (const route of routes) {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        pickerHeight: document.querySelector('.site-picker')?.getBoundingClientRect().height ?? 0,
        pickerLeft: document.querySelector('.site-picker')?.getBoundingClientRect().left ?? 0,
        pickerWidth: document.querySelector('.site-picker')?.getBoundingClientRect().width ?? 0,
        railLeft: document.querySelector('.site-rail')?.getBoundingClientRect().left ?? 0,
        railRight: document.querySelector('.site-rail')?.getBoundingClientRect().right ?? 0,
        toolLeft: document.querySelector('main > .blueprint')?.getBoundingClientRect().left ?? 0,
        h1Y: document.querySelector('h1')?.getBoundingClientRect().y ?? -1,
      }))
      check(`${label}: ${route} has no horizontal overflow`, geometry.overflow <= 1, String(geometry.overflow))
      if (mobile) {
        pickerReference ??= `${geometry.pickerLeft}/${geometry.pickerWidth}/${geometry.pickerHeight}`
        check(`${label}: ${route} uses the same compact picker`, `${geometry.pickerLeft}/${geometry.pickerWidth}/${geometry.pickerHeight}` === pickerReference, pickerReference)
      } else {
        check(`${label}: ${route} anchors the rail left`, geometry.railLeft <= 24, String(geometry.railLeft))
        check(`${label}: ${route} clears the rail`, geometry.toolLeft >= geometry.railRight + 24, `${geometry.toolLeft}/${geometry.railRight}`)
      }
    }
    check(`${label}: route console is clean`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await context.close()
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`${BASE}/site/calc/`, { waitUntil: 'domcontentloaded' })
  await page.locator('.site-picker summary').click()
  const order = await page.locator('.site-picker [data-site-tool-link]').allTextContents()
  check('navigation: Converter appears before Span Lookup', order.indexOf('Converter') < order.indexOf('Span Lookup'))
  await page.locator('.site-picker [data-site-tool-search]').fill('variation')
  check('navigation: search finds Site Records', await page.locator('.site-picker [data-site-tool-link]:visible').allTextContents().then(items => items.includes('Site Records')))

  await page.goto(`${BASE}/site/`, { waitUntil: 'domcontentloaded' })
  check('hub: Quick start is removed', await page.getByText('Quick start', { exact: true }).count() === 0)
  await page.locator('#site-hub-search').fill('gantt')
  check('hub: task search finds Programme', await page.locator('[data-tool-item]:visible .t').allTextContents().then(items => items.includes('Programme Builder')))

  await page.goto(`${BASE}/site/lattice/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('lattice_sheets_v1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.lat-tpl', { hasText: 'Trade estimate' }).click()
  check('Lattice: estimating template opens', await page.locator('.lat-title').inputValue() === 'Trade estimate')
  check('Lattice: cost roll-up is visible', await page.locator('.lat-rollup').first().textContent().then(text => text?.includes('$')))
  await page.locator('[aria-label="Open fullscreen workspace"]').click()
  check('Lattice: fullscreen workspace activates', await page.evaluate(() => !!document.fullscreenElement || !!document.querySelector('.lat-app-mode')))
  await page.keyboard.press('Escape')

  const firstCell = page.locator('.lat-cell').first()
  await firstCell.click()
  await page.keyboard.press('Control+Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Control+Enter')
  await page.keyboard.type('Grandchild')
  check('Lattice: Ctrl+Enter nests to arbitrary depth', await page.locator('.lat-crumbs button').count() >= 3)
  await page.keyboard.press('Alt+Enter')
  check('Lattice: Alt+Enter adds an editable sibling', await page.locator('.lat-edit').count() === 1)

  await page.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  check('Cut List 1D: default project optimises', await page.locator('.bars .bar').count() > 0)
  check('Cut List 1D: project interchange exists', await page.locator('#export-project, #import-project, #export-csv').count() === 3)
  await page.goto(`${BASE}/site/sheet/`, { waitUntil: 'domcontentloaded' })
  check('Cut List 2D: default project optimises', await page.locator('.sheet-svg').count() > 0)
  check('Cut List 2D: material and grain controls exist', await page.locator('.r-mat, .r-grain, .r-edge').count() >= 3)

  await page.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await page.locator('#pdf-blank').click()
  await page.waitForSelector('.pdf-page-card')
  check('PDF: blank page creates a real page card', await page.locator('.pdf-page-card').count() === 1)
  check('PDF: export enables', !(await page.locator('#pdf-export').isDisabled()))
  await page.locator('.pdf-page-card input[type=checkbox]').check()
  check('PDF: selection enables split/extract/images', await Promise.all(['pdf-extract', 'pdf-split', 'pdf-images'].map(id => page.locator(`#${id}`).isEnabled())).then(values => values.every(Boolean)))
  check('PDF: thumbnail renders', await page.locator('.pdf-thumb').evaluate(canvas => canvas.width > 0 && canvas.height > 0))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 220))
} finally {
  await browser.close()
}

if (failures) process.exit(1)
