import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4471) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const csv = Buffer.from('﻿Date,Narrative,Debit,Credit,Balance\r\n01/09/2026,"WOOLWORTHS 1234, SYDNEY",45.20,,1000.00\r\n02/09/2026,SALARY ACME PTY,,3000.00,4000.00\r\n03/09/2026,NETFLIX.COM,22.99,,3977.01\r\n', 'utf8')

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('dialog', (dialog) => dialog.accept('Test Bank'))

  const stubStatus = (status) => page.route('**/api/pro/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }))
  await stubStatus({ pro: false, source: null, configured: true })
  await page.route('**/api/pro/use', (route) => route.fulfill({ status: 402, contentType: 'application/json', body: '{"allowed":false}' }))

  await page.goto(`${BASE}/money/`, { waitUntil: 'domcontentloaded' })
  check('Money: /money/ has no noindex meta (public + Pro-gated)', await page.locator('meta[name="robots"]').count() === 0)
  await page.waitForSelector('#money-tabs .money-tab')
  check('Money: eleven section tabs render', await page.locator('#money-tabs .money-tab').count() === 11)
  check('Money: no horizontal body scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

  await page.locator('[data-tab="budget"]').click()
  await page.locator('#mb-cat-name').fill('Pets')
  await page.locator('#mb-cat-budget').fill('100')
  await page.locator('#mb-cat-add').click()
  const petsRow = page.locator('.mb-row[data-cat="pets"]')
  check('Budget: new category row appears with full remaining', await petsRow.count() === 1 && (await petsRow.locator('.mb-remaining').textContent()).includes('100.00'))

  await page.locator('[data-tab="transactions"]').click()
  await page.locator('#mt-amount').fill('-25')
  await page.locator('#mt-desc').fill('Vet visit')
  await page.locator('#mt-cat').selectOption('pets')
  await page.locator('#mt-add').click()
  check('Transactions: manual add shows in the list', await page.locator('.mt-row').count() === 1)
  await page.locator('[data-tab="budget"]').click()
  check('Budget: remaining updates after the transaction', (await petsRow.locator('.mb-remaining').textContent()).includes('75.00'))

  await page.locator('[data-tab="transactions"]').click()
  await page.locator('#mt-csv').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: csv })
  await page.waitForSelector('#mt-import-go')
  check('Import: debit/credit columns auto-mapped', await page.locator('#mt-map-mode').inputValue() === 'split' && await page.locator('#mt-map-debit').inputValue() === '2' && await page.locator('#mt-map-credit').inputValue() === '3')
  check('Import: date format detected as DD/MM/YYYY', await page.locator('#mt-map-fmt').inputValue() === 'DMY')
  check('Import: preview shows the three rows', await page.locator('.mt-preview-row').count() === 3)
  await page.locator('#mt-map-preset').fill('Test Bank')
  await page.locator('#mt-import-go').click()
  await page.waitForSelector('#mt-import-status')
  const status = await page.locator('#mt-import-status').textContent()
  check('Import: three rows imported and auto-categorised', status.includes('Imported 3') && status.includes('2 auto-categorised'), status)
  await page.locator('#mt-f-month').fill('')
  check('Transactions: imported rows listed', await page.locator('.mt-row').count() === 4)
  await page.locator('#mt-csv').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: csv })
  await page.waitForSelector('#mt-import-go')
  check('Import: header signature preset recognised on second import', (await page.locator('#mt-import-status').textContent()).includes('Test Bank'))
  await page.locator('#mt-import-go').click()
  check('Import: re-import is fully de-duplicated', (await page.locator('#mt-import-status').textContent()).includes('Imported 0') && await page.locator('.mt-row').count() === 4)

  await page.locator('[data-tab="networth"]').click()
  await page.locator('#mn-name').fill('Everyday')
  await page.locator('#mn-type').selectOption('cash')
  await page.locator('#mn-balance').fill('2500')
  await page.locator('#mn-add').click()
  await page.locator('#mn-snapshot').click()
  const box = await page.locator('#money-nw-chart').boundingBox()
  check('Net worth: snapshot stored and chart canvas has size', box && box.width > 100 && box.height > 100 && await page.evaluate(() => JSON.parse(localStorage.getItem('vv_money')).data.snapshots.length === 1))

  await page.locator('[data-tab="debts"]').click()
  await page.locator('#md-name').fill('Card')
  await page.locator('#md-balance').fill('1000')
  await page.locator('#md-apr').fill('20')
  await page.locator('#md-min').fill('50')
  await page.locator('#md-add').click()
  await page.locator('#md-extra').fill('100')
  await page.locator('#md-extra').dispatchEvent('change')
  const months = Number(await page.locator('#md-aval-months').textContent())
  check('Debts: payoff planner reports months to debt-free', months > 0 && months < 20, String(months))
  check('Debts: comparison chart canvas rendered', (await page.locator('#money-debt-chart').boundingBox())?.width > 100)

  await page.locator('[data-tab="projections"]').click()
  check('Projections: growth stats and chart present', await page.locator('#money-growth-chart').count() === 1 && (await page.locator('[data-panel="projections"] .stat').count()) >= 6)

  check('Store: export button, import input and sync checkbox present', await page.locator('#money-store button', { hasText: 'Export JSON' }).count() === 1 && await page.locator('#money-store input[type="file"]').count() === 1 && await page.locator('#money-store [data-store-sync="money"]').count() === 1)
  check('Store: sync is off by default', !(await page.locator('#money-store [data-store-sync="money"]').isChecked()))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-tab="budget"]').click()
  check('Reload: budget category and transactions persist', await page.locator('.mb-row[data-cat="pets"]').count() === 1 && await page.evaluate(() => JSON.parse(localStorage.getItem('vv_money')).data.transactions.length === 4))
  await page.locator('[data-tab="overview"]').click()
  check('Overview: renders debt-free and net worth stats', (await page.locator('[data-panel="overview"] .stat').count()) >= 8)

  // ── Pro gating for a public visitor (stubbed /api/pro/status + /api/pro/use above) ──
  await page.locator('[data-tab="fire"]').click()
  check('FIRE: tab click shows the upsell panel for a public visitor', await page.locator('.pro-upsell[data-feature="fire"]').count() === 1)
  check('FIRE: panel itself stays hidden (gate is on opening the tab)', await page.locator('[data-panel="fire"]').isHidden())

  await page.locator('[data-tab="property"]').click()
  check('Property: viewing the tab stays open for a public visitor', await page.locator('[data-panel="property"]').isVisible())
  await page.locator('#mpr-name').fill('Investment unit')
  await page.locator('#mpr-price').fill('500000')
  await page.locator('#mpr-value').fill('800000')
  await page.locator('#mpr-add').click()
  check('Property: adding shows the upsell panel for a public visitor', await page.locator('.pro-upsell[data-feature="property"]').count() === 1)
  check('Property: no property was added for a public visitor', await page.locator('.mp-row').count() === 0)

  // ── Owner: always Pro ──
  await page.unroute('**/api/pro/status')
  await stubStatus({ pro: true, source: 'owner', configured: true })
  await page.evaluate(() => { document.cookie = 'vv_owner=1; path=/' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-tab="property"]').click()
  await page.locator('#mpr-name').fill('Investment unit')
  await page.locator('#mpr-price').fill('500000')
  await page.locator('#mpr-date').fill('2016-09-14')
  await page.locator('#mpr-value').fill('800000')
  await page.locator('#mpr-valued-at').fill('2026-09-14')
  await page.locator('#mpr-add').click()
  const propertyRow = page.locator('.mp-row')
  check('Property: owner can add a property and see LVR', await propertyRow.count() === 1 && (await propertyRow.first().innerText()).includes('LVR'))

  await page.locator('[data-tab="fire"]').click()
  check('FIRE: owner opens the tab straight through', await page.locator('[data-panel="fire"]').isVisible() && await page.locator('.pro-upsell').count() === 0)

  await page.locator('[data-tab="super"]').click()
  const superBox = await page.locator('#money-super-chart').boundingBox()
  check('Super: projection renders a chart', superBox && superBox.width > 100 && superBox.height > 100)

  await page.locator('[data-tab="overview"]').click()
  await page.locator('#mo-record').click()
  await page.locator('[data-tab="history"]').click()
  check('History: "Record this month" adds a row', await page.locator('.mh-row').count() === 1)

  check('Money: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
