import { readFileSync } from 'node:fs'
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

// pdf-lib parses the file (proves it's a valid PDF); pdfjs pulls the drawn text
// back out of the content streams, which pdf-lib can't do.
const pdfText = async (bytes) => {
  const parsed = await PDFDocument.load(bytes)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const doc = await task.promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str).join(' '))
  await task.destroy()
  return { pageCount: parsed.getPageCount(), pages }
}

const stubStatus = (context, status) =>
  context.route('**/api/pro/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }),
  )

// The quota endpoint is gone (last addendum, docs/PRO_PLAN.md): every call is a regression.
const countUseCalls = async (context) => {
  const counter = { calls: 0 }
  await context.route('**/api/pro/use', (route) => { counter.calls++; route.fulfill({ status: 404 }) })
  return counter
}

const recordMetrics = async (context) => {
  const calls = []
  await context.route('**/api/metric', (route) => {
    try { calls.push(route.request().postDataJSON()) } catch { /* non-JSON beacon body — ignore */ }
    route.fulfill({ status: 204 })
  })
  return calls
}

// Headless print is a no-op that never fires afterprint; stub it so the test
// controls when "printing" ends.
const stubPrint = (context) => context.addInitScript(() => { window.print = () => { window.__printCalls = (window.__printCalls || 0) + 1 } })


let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const errors = []

  // ── free visitor: exports run with the vishvaddi footer, no quota ──
  const freeCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  await stubStatus(freeCtx, { pro: false, source: null, configured: true })
  const freeUse = await countUseCalls(freeCtx)
  const freeMetrics = await recordMetrics(freeCtx)
  await stubPrint(freeCtx)
  const freePage = await freeCtx.newPage()
  freePage.on('pageerror', (error) => errors.push(String(error)))

  await freePage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await freePage.waitForSelector('#save-pdf:not([hidden])')
  await freePage.locator('#save-pdf').click()
  check('Free: Cut List Save as PDF prints straight away (no panel)', await freePage.evaluate(() => window.__printCalls) === 1 && await freePage.locator('#pro-upsell').count() === 0)
  const footer = freePage.locator('.vv-export-brand--footer')
  check('Free: print footer element injected once', await footer.count() === 1)
  check('Free: footer hidden on screen', await footer.isHidden())
  await freePage.emulateMedia({ media: 'print' })
  check('Free: footer visible in print media with the vishvaddi line', await footer.isVisible() && (await footer.textContent() || '').includes('Made free at vishvaddi.com'))
  const printed = await pdfText(await freePage.pdf({ format: 'A4' }))
  check('Free: the printed Cut List PDF really contains the footer text', printed.pages.some((text) => text.includes('Made free at vishvaddi.com')), `${printed.pageCount} page(s)`)
  await freePage.emulateMedia({ media: 'screen' })
  await freePage.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  check('Free: footer removed after print', await freePage.locator('.vv-export-brand').count() === 0)
  check('Free: one post-export hint under the button', await freePage.locator('.vv-export-hint').count() === 1 && (await freePage.locator('.vv-export-hint').textContent() || '').includes('Pro exports are clean'))
  await freePage.locator('#save-pdf').click()
  check('Free: hint shows at most once per page view', await freePage.locator('.vv-export-hint').count() === 1)
  await freePage.locator('.vv-export-hint-dismiss').click()
  check('Free: hint is dismissible', await freePage.locator('.vv-export-hint').count() === 0)
  await freePage.evaluate(() => window.dispatchEvent(new Event('afterprint')))

  await freePage.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  check('Free: Ctrl+P (browser print, no button) still gets the footer', await freePage.locator('.vv-export-brand--footer').count() === 1)
  await freePage.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  check('Free: browser-print footer removed after print', await freePage.locator('.vv-export-brand').count() === 0)

  const csvDownload = freePage.waitForEvent('download', { timeout: 5000 }).catch(() => null)
  await freePage.locator('#export-csv').click()
  check('Free: Cut List CSV export downloads with no panel', !!(await csvDownload) && await freePage.locator('#pro-upsell').count() === 0)

  await freePage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await freePage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.1, 0.2, 0.8]) })
  await freePage.waitForSelector('.pdf-page-card')
  const urlBefore = freePage.url()
  const pdfDownload = freePage.waitForEvent('download', { timeout: 10000 })
  await freePage.locator('#pdf-export').click()
  const freePdf = await pdfText(readFileSync(await (await pdfDownload).path()))
  check('Free: PDF Toolkit export downloads without navigating', freePage.url() === urlBefore && await freePage.locator('#pro-upsell').count() === 0)
  check('Free: exported PDF text contains vishvaddi.com on every page', freePdf.pages.length > 0 && freePdf.pages.every((text) => text.includes('vishvaddi.com')), freePdf.pages.join(' | '))

  check('Metrics: export_free beacons recorded, no export_pro', freeMetrics.filter((call) => call?.event === 'export_free').length >= 3 && !freeMetrics.some((call) => call?.event === 'export_pro'))

  // Pro-only features: panel, never a request to the removed quota endpoint.
  await freePage.setViewportSize({ width: 1400, height: 950 })
  await freePage.goto(`${BASE}/studio/`, { waitUntil: 'domcontentloaded' })
  await freePage.locator('.wa-menu > summary', { hasText: 'File' }).click()
  await freePage.locator('.wa-studio-menu-body button', { hasText: 'Project & export' }).click()
  for (const [label, feature] of [['Export MP3', 'studio-mp3-export'], ['Export stems', 'studio-stem-export']]) {
    await freePage.locator('.wa-export-dialog button', { hasText: label }).click()
    check(`Pro-only: ${feature} shows the upsell panel`, await freePage.locator(`.pro-upsell[data-feature="${feature}"]`).count() === 1)
  }
  await freePage.setViewportSize({ width: 390, height: 844 })
  check('Pro-only: zero /api/pro/use requests across every free export and panel', freeUse.calls === 0, String(freeUse.calls))

  // ── /pro: plans for a free visitor ──
  await freePage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  const planLabels = await freePage.locator('#pro-plans .pro-upsell-plans .pro-upsell-btn').allInnerTexts()
  check('Pro page: at least two plan buttons, all priced in A$', planLabels.length >= 2 && planLabels.every((label) => label.includes('A$')), planLabels.join(' | '))
  // Inside the Play Store app (sessionStorage flag set by chrome.js from an android-app:// referrer) there's no web checkout.
  await freePage.evaluate(() => sessionStorage.setItem('vv_twa', '1'))
  await freePage.reload({ waitUntil: 'domcontentloaded' })
  await freePage.waitForSelector('#pro-plans .pro-upsell-note', { timeout: 5000 }).catch(() => {})
  check('Play app: /pro shows no checkout buttons, only where to buy', await freePage.locator('#pro-plans .pro-upsell-btn').filter({ hasText: 'A$' }).count() === 0 && ((await freePage.locator('#pro-plans').textContent()) || '').includes('Pro is available at vishvaddi.com'))
  await freePage.evaluate(() => sessionStorage.removeItem('vv_twa'))
  check('Pro page: no quota copy left', !(await freePage.locator('main').textContent() || '').match(/free exports? (left|this month)|#free-limit-copy/) && await freePage.locator('#free-limit-copy').count() === 0)
  check('Pro page: brand editor and updates form are gone', await freePage.locator('#brand-form, #brand-preview, #waitlist-form').count() === 0 && !((await freePage.locator('main').textContent()) || '').includes('business name'))
  check('Pro page: no horizontal scroll at 390px', await freePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))

  await freePage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  check('Pro: [data-private] is hidden without the owner marker', (await freePage.locator('footer a[href="/logout"][data-private]').isHidden()))

  await freePage.close()
  await freeCtx.close()

  // ── Pro licence: clean exports (no footer, no hint), sign-out on /pro ──
  const proCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  await stubStatus(proCtx, { pro: true, source: 'licence', plan: 'year', configured: true })
  const proUse = await countUseCalls(proCtx)
  const proMetrics = await recordMetrics(proCtx)
  await stubPrint(proCtx)
  await proCtx.addInitScript(() => { document.cookie = 'vv_pro=1; path=/' })
  let logoutCalls = 0
  await proCtx.route('**/api/pro/logout', (route) => { logoutCalls++; route.fulfill({ status: 204 }) })
  const proPage = await proCtx.newPage()
  proPage.on('pageerror', (error) => errors.push(String(error)))

  await proPage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await proPage.waitForSelector('#save-pdf:not([hidden])')
  await proPage.locator('#save-pdf').click()
  check('Pro: print injects no footer', await proPage.locator('.vv-export-brand').count() === 0)
  await proPage.emulateMedia({ media: 'print' })
  const proPrinted = await pdfText(await proPage.pdf({ format: 'A4' }))
  check('Pro: printed Cut List PDF has no vishvaddi footer', !proPrinted.pages.some((text) => text.includes('Made free at vishvaddi.com')))
  await proPage.emulateMedia({ media: 'screen' })
  check('Pro: no free-footer hint', await proPage.locator('.vv-export-hint').count() === 0)

  await proPage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await proPage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.2, 0.6, 0.3]) })
  await proPage.waitForSelector('.pdf-page-card')
  const proDownload = proPage.waitForEvent('download', { timeout: 10000 })
  await proPage.locator('#pdf-export').click()
  const proPdf = await pdfText(readFileSync(await (await proDownload).path()))
  check('Pro: PDF Toolkit export has no footer', proPdf.pages.every((text) => !text.includes('vishvaddi.com')))

  await proPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  const signOut = proPage.locator('#pro-plans button', { hasText: 'Sign out of Pro on this browser' })
  await signOut.waitFor({ timeout: 5000 }).catch(() => {})
  check('Pro: /pro offers "Sign out of Pro on this browser" for a licence holder', await signOut.count() === 1)
  await Promise.all([proPage.waitForEvent('load', { timeout: 5000 }).catch(() => {}), signOut.click()])
  check('Pro: sign-out calls /api/pro/logout and reloads', logoutCalls === 1)
  check('Metrics: export_pro beacons recorded for Pro', proMetrics.filter((call) => call?.event === 'export_pro').length >= 2 && !proMetrics.some((call) => call?.event === 'export_free'))
  check('Pro: zero /api/pro/use requests', proUse.calls === 0, String(proUse.calls))

  await proPage.close()
  await proCtx.close()

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

  await ownerPage.close()
  await ownerCtx.close()

  // ── funnel counters: tool_view beacons; the 3rd-view nudge bar was removed 17/09/26 ──
  const nudgeCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(nudgeCtx, { pro: false, source: null, configured: true })
  const metricCalls = await recordMetrics(nudgeCtx)
  const nudgePage = await nudgeCtx.newPage()
  nudgePage.on('pageerror', (error) => errors.push(String(error)))

  await nudgePage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await nudgePage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await nudgePage.goto(`${BASE}/site/sheet/`, { waitUntil: 'domcontentloaded' })
  await nudgePage.waitForTimeout(500)
  check('Nudge: no top-of-page Pro bar even on the 3rd distinct tool page', await nudgePage.locator('.vv-nudge').count() === 0)
  check('Metrics: tool_view beacon recorded for each tool page visited', metricCalls.filter((call) => call?.event === 'tool_view').length === 3)
  check('Metrics: no nudge_shown beacon', metricCalls.filter((call) => call?.event === 'nudge_shown').length === 0)

  await nudgePage.close()
  await nudgeCtx.close()

  // ── funnel counters: checkout_click beacon on the /pro page's plan buttons ──
  const checkoutCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(checkoutCtx, { pro: false, source: null, configured: true })
  const checkoutMetricCalls = await recordMetrics(checkoutCtx)
  await checkoutCtx.route('**/api/pro/checkout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${BASE}/pro?cancelled=1` }) }),
  )
  const checkoutPage = await checkoutCtx.newPage()
  checkoutPage.on('pageerror', (error) => errors.push(String(error)))

  await checkoutPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  await checkoutPage.locator('#pro-plans .pro-upsell-plans .pro-upsell-btn').first().click()
  await checkoutPage.waitForTimeout(300) // the beacon fires before the stubbed checkout redirect races it
  check('Metrics: checkout_click beacon recorded on plan button click', checkoutMetricCalls.some((call) => call?.event === 'checkout_click'))

  await checkoutPage.close()
  await checkoutCtx.close()

  check('Pro pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
