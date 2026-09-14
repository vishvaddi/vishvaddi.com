import { chromium } from 'playwright-core'
import { PDFDocument, rgb } from 'pdf-lib'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4408) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const makePdf = async (colour) => {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([300, 420])
  page.drawRectangle({ x: 45, y: 80, width: 190, height: 240, borderWidth: 5, borderColor: rgb(...colour) })
  return Buffer.from(await pdf.save())
}

const stubStatus = (context, status) =>
  context.route('**/api/pro/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }),
  )

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const errors = []

  // ── public visitor: not Pro, Stripe configured ──
  const publicCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(publicCtx, { pro: false, source: null, configured: true })
  const publicPage = await publicCtx.newPage()
  publicPage.on('pageerror', (error) => errors.push(String(error)))

  await publicPage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await publicPage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.1, 0.2, 0.8]) })
  await publicPage.waitForSelector('.pdf-page-card')
  const urlBefore = publicPage.url()
  await publicPage.locator('#pdf-export').click()
  check('Pro: PDF export shows the upsell panel for a public visitor', await publicPage.locator('#pro-upsell').count() === 1)
  check('Pro: upsell panel click does not navigate', publicPage.url() === urlBefore)

  await publicPage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await publicPage.waitForSelector('#save-pdf:not([hidden])')
  await publicPage.locator('#save-pdf').click()
  check('Pro: cut-list Save as PDF shows the upsell panel', await publicPage.locator('#pro-upsell[data-feature="cut-list-save-pdf"]').count() === 1)

  await publicPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  check('Pro: /pro renders two plan buttons', await publicPage.locator('.pro-upsell-plans .pro-upsell-btn').count() === 2)
  check(
    'Pro: /pro has no horizontal scroll at 390px',
    await publicPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  )

  await publicPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  check('Pro: [data-private] is hidden without the owner marker', (await publicPage.locator('footer a[href="/logout"][data-private]').isHidden()))

  // ── owner: always Pro, marker cookie set before first paint ──
  const ownerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(ownerCtx, { pro: true, source: 'owner' })
  await ownerCtx.addInitScript(() => { document.cookie = 'vv_owner=1; path=/'; })
  const ownerPage = await ownerCtx.newPage()
  ownerPage.on('pageerror', (error) => errors.push(String(error)))

  await ownerPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  check('Pro: [data-private] is visible with the owner marker', (await ownerPage.locator('footer a[href="/logout"][data-private]').isVisible()))

  await ownerPage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await ownerPage.waitForSelector('#export-project:not([hidden])')
  await ownerPage.locator('#export-project').click()
  check('Pro: owner sees no upsell panel on /site/cut-list/', await ownerPage.locator('#pro-upsell').count() === 0)

  check('Pro pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))

  await publicPage.close()
  await ownerPage.close()
  await publicCtx.close()
  await ownerCtx.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
