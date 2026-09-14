import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4417) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  // ── Recipes ──
  await page.goto(`${BASE}/kitchen/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#kit-add')
  check('Kitchen: export button, import input and sync toggle present',
    (await page.locator('#kit-store button', { hasText: 'Export JSON' }).count()) === 1 &&
    (await page.locator('#kit-store input[type="file"]').count()) === 1 &&
    (await page.locator('#kit-store input[data-store-sync="kitchen"]').count()) === 1)

  const addRecipe = async ({ title, servings, prep, cook, tags, ings, steps }) => {
    await page.locator('#kit-add').click()
    await page.locator('#kit-title').fill(title)
    await page.locator('#kit-servings').fill(String(servings))
    await page.locator('#kit-prep').fill(String(prep))
    await page.locator('#kit-cook').fill(String(cook))
    await page.locator('#kit-tagsin').fill(tags)
    await page.locator('#kit-ings').fill(ings)
    await page.locator('#kit-steps').fill(steps)
    await page.locator('#kit-save').click()
  }
  await addRecipe({ title: 'Test fried rice', servings: 2, prep: 5, cook: 10, tags: 'quick, prep', ings: '2 cups rice\n3 eggs\n1 tbsp soy sauce\nsalt', steps: 'Cook the rice\nFry everything' })
  check('Kitchen: added recipe is listed', (await page.locator('[data-recipe-id]').count()) === 1 && (await page.locator('.rec-title').first().textContent()) === 'Test fried rice')
  check('Kitchen: detail opens after save with parsed ingredients', !(await page.locator('#kit-detail').isHidden()) && (await page.locator('#kit-detail-ings li').count()) === 4)
  const firstQty = () => page.locator('#kit-detail-ings li .q').first().textContent()
  check('Kitchen: ingredient shows parsed qty + unit', (await firstQty()) === '2 cup')
  await page.locator('#kit-scale').fill('4')
  await page.locator('#kit-scale').dispatchEvent('input')
  check('Kitchen: servings scaler doubles the quantity', (await firstQty()) === '4 cup')
  await page.locator('#kit-scale').fill('1')
  await page.locator('#kit-scale').dispatchEvent('input')
  check('Kitchen: scaler formats fractions', (await firstQty()) === '1 cup' && (await page.locator('#kit-detail-ings li .q').nth(2).textContent()) === '1/2 tbsp')
  check('Kitchen: copy as Markdown button present', (await page.locator('#kit-copy-md').count()) === 1)

  await addRecipe({ title: 'Slow beef', servings: 4, prep: 20, cook: 120, tags: 'slow', ings: '500 g beef\n1 onion', steps: 'Braise' })
  check('Kitchen: two recipes listed', (await page.locator('[data-recipe-id]').count()) === 2)
  await page.locator('#kit-search').fill('beef')
  check('Kitchen: search filters by ingredient', (await page.locator('[data-recipe-id]').count()) === 1 && (await page.locator('.rec-title').first().textContent()) === 'Slow beef')
  await page.locator('#kit-search').fill('')
  await page.locator('[data-tag="quick"]').click()
  check('Kitchen: tag chip filters', (await page.locator('[data-recipe-id]').count()) === 1 && (await page.locator('.rec-title').first().textContent()) === 'Test fried rice')
  await page.locator('[data-tag="quick"]').click()
  await page.locator('#kit-sort').selectOption('quickest')
  check('Kitchen: sort by quickest', (await page.locator('.rec-title').first().textContent()) === 'Test fried rice')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-recipe-id]')
  check('Kitchen: recipes persist across reload', (await page.locator('[data-recipe-id]').count()) === 2)
  check('Kitchen: no horizontal scroll at 390px', await noSideScroll(page))

  // ── Plan ──
  await page.goto(`${BASE}/kitchen/plan/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#plan-grid .kit-day')
  const start = await page.locator('#plan-start').inputValue()
  check('Plan: 14 day cards and start date defaults to a Monday', (await page.locator('#plan-grid .kit-day').count()) === 14 && new Date(start + 'T00:00:00').getDay() === 1, start)
  check('Plan: recipe datalist lists both recipes', (await page.locator('#recipe-list option').count()) === 2)

  const firstDinner = page.locator('[data-cell$=":dinner"]').first()
  await firstDinner.fill('Test fried rice')
  await firstDinner.dispatchEvent('change')
  const shopText = () => page.locator('#shop-list').textContent()
  check('Plan: assigning a recipe builds the shopping list', /2 cup rice/.test(await shopText()) && /3 eggs/.test(await shopText()))
  const firstServings = page.locator('[data-servings$=":dinner"]').first()
  await firstServings.fill('4')
  await firstServings.dispatchEvent('change')
  check('Plan: cell servings scale the list', /4 cup rice/.test(await shopText()) && /6 eggs/.test(await shopText()))
  const secondDinner = page.locator('[data-cell$=":dinner"]').nth(1)
  await secondDinner.fill('Test fried rice')
  await secondDinner.dispatchEvent('change')
  check('Plan: same item + unit merges across days', /6 cup rice/.test(await shopText()) && (await page.locator('[data-shop-key="rice|cup"]').count()) === 1)
  check('Plan: aisle grouping present', /pantry/.test(await shopText()) && /dairy/.test(await shopText()))

  await page.locator('[data-tick="eggs|"]').check()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-tick="eggs|"]')
  check('Plan: ticks persist across reload', await page.locator('[data-tick="eggs|"]').isChecked() && (await page.locator('[data-shop-key="eggs|"]').getAttribute('class')).includes('done'))
  check('Plan: assignments persist across reload', (await page.locator('[data-cell$=":dinner"]').first().inputValue()) === 'Test fried rice')

  await page.locator('[data-away]').nth(2).check()
  check('Plan: away day greys the row', (await page.locator('#plan-grid .kit-day').nth(2).getAttribute('class')).includes('away'))

  await page.locator('#plan-autofill').click()
  const dinnerValues = await page.locator('[data-cell$=":dinner"]').evaluateAll((els) => els.map((e) => e.value))
  const filled = dinnerValues.filter(Boolean).length
  check('Plan: auto-fill populates empty dinners and respects the away day', filled >= 10 && dinnerValues[2] === '', `${filled} filled`)
  check('Plan: weekday cap keeps the slow recipe off weeknights',
    dinnerValues.every((v, i) => { const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate() + i); const dow = d.getDay(); return !(dow >= 1 && dow <= 5) || !v.startsWith('Slow beef') }))
  const sundayIdx = dinnerValues.findIndex((_, i) => { const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate() + i); return d.getDay() === 0 })
  check('Plan: Sunday leftovers roll into the next day', /^Leftovers: /.test(dinnerValues[sundayIdx + 1] || ''), dinnerValues[sundayIdx + 1])
  check('Plan: copy list and export controls present', (await page.locator('#shop-copy').count()) === 1 && (await page.locator('#kit-store input[data-store-sync="kitchen"]').count()) === 1)
  check('Plan: no horizontal scroll at 390px', await noSideScroll(page))
  check('Kitchen pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
