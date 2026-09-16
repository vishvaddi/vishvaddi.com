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

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII='
const BRAND = { name: 'Acme Shopfitting', line: 'ABN 12 345 678 901', logo: TINY_PNG }

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
  check('Free: one post-export hint under the button', await freePage.locator('.vv-export-hint').count() === 1 && (await freePage.locator('.vv-export-hint').textContent() || '').includes('Pro puts your business name on it instead'))
  await freePage.locator('#save-pdf').click()
  check('Free: hint shows at most once per page view', await freePage.locator('.vv-export-hint').count() === 1)
  await freePage.locator('.vv-export-hint-dismiss').click()
  check('Free: hint is dismissible', await freePage.locator('.vv-export-hint').count() === 0)
  await freePage.evaluate(() => window.dispatchEvent(new Event('afterprint')))

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

  // ── /pro: plans, brand editor for a free visitor ──
  await freePage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  const planLabels = await freePage.locator('#pro-plans .pro-upsell-plans .pro-upsell-btn').allInnerTexts()
  check('Pro page: at least two plan buttons, all priced in A$', planLabels.length >= 2 && planLabels.every((label) => label.includes('A$')), planLabels.join(' | '))
  check('Pro page: no quota copy left', !(await freePage.locator('main').textContent() || '').match(/free exports? (left|this month)|#free-limit-copy/) && await freePage.locator('#free-limit-copy').count() === 0)
  check('Brand editor: free visitor sees "Applies to your exports with Pro"', await freePage.locator('#brand-free-note').isVisible() && (await freePage.locator('#brand-free-note').textContent() || '').includes('Applies to your exports with Pro'))
  await freePage.locator('#brand-name').fill(BRAND.name)
  await freePage.locator('#brand-line').fill(BRAND.line)
  const previewText = await freePage.locator('#brand-preview').textContent() || ''
  check('Brand editor: live preview shows the typed name and the free footer version', previewText.includes(BRAND.name) && previewText.includes('Made free at vishvaddi.com'), previewText)

  const bigLogo = await freePage.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 400
    const ctx = canvas.getContext('2d'); const image = ctx.createImageData(canvas.width, canvas.height)
    for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 2654435761) % 251
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await freePage.locator('#brand-logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(bigLogo, 'base64') })
  await freePage.waitForSelector('#brand-preview .vv-brand-logo', { timeout: 5000 }).catch(() => {})
  check('Brand editor: uploaded logo appears in the preview', await freePage.locator('#brand-preview .vv-brand-logo').count() >= 1)
  await freePage.locator('#brand-form button[type="submit"]').click()
  const stored = await freePage.evaluate(async () => {
    const brand = JSON.parse(localStorage.getItem('vv_brand') || 'null')
    if (!brand?.logo) return { brand }
    const img = new Image(); img.src = brand.logo; await img.decode()
    return { brand, logoWidth: img.naturalWidth, logoBytes: brand.logo.length }
  })
  check('Brand editor: saves name and line to localStorage', stored.brand?.name === BRAND.name && stored.brand?.line === BRAND.line)
  check('Brand editor: logo downscaled to ≤400 px wide and ≤200 KB', /^data:image\/(png|jpeg);base64,/.test(stored.brand?.logo || '') && stored.logoWidth <= 400 && stored.logoBytes <= 200_000, `${stored.logoWidth}px, ${stored.logoBytes} bytes`)
  check('Metrics: brand_saved beacon recorded', freeMetrics.some((call) => call?.event === 'brand_saved'))
  check('Pro page: no horizontal scroll at 390px', await freePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))

  await freePage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  check('Pro: [data-private] is hidden without the owner marker', (await freePage.locator('footer a[href="/logout"][data-private]').isHidden()))

  await freePage.close()
  await freeCtx.close()

  // ── Pro with a saved brand: brand on exports, no footer, no hint ──
  const brandCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  await stubStatus(brandCtx, { pro: true, source: 'licence', plan: 'year', configured: true })
  const brandUse = await countUseCalls(brandCtx)
  const brandMetrics = await recordMetrics(brandCtx)
  await stubPrint(brandCtx)
  await brandCtx.addInitScript((brand) => {
    document.cookie = 'vv_pro=1; path=/'
    try { localStorage.setItem('vv_brand', JSON.stringify(brand)) } catch { /* about:blank has no storage */ }
  }, BRAND)
  const brandPage = await brandCtx.newPage()
  brandPage.on('pageerror', (error) => errors.push(String(error)))

  await brandPage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await brandPage.waitForSelector('#save-pdf:not([hidden])')
  await brandPage.locator('#save-pdf').click()
  await brandPage.emulateMedia({ media: 'print' })
  const brandHeader = brandPage.locator('.vv-export-brand--brand')
  check('Pro brand: print shows the brand header, not the footer', await brandHeader.isVisible() && (await brandHeader.textContent() || '').includes(BRAND.name) && await brandPage.locator('.vv-export-brand--footer').count() === 0)
  const brandPrinted = await pdfText(await brandPage.pdf({ format: 'A4' }))
  check('Pro brand: printed PDF carries the business name and no vishvaddi footer', brandPrinted.pages[0].includes(BRAND.name) && !brandPrinted.pages.some((text) => text.includes('Made free at vishvaddi.com')))
  await brandPage.emulateMedia({ media: 'screen' })
  await brandPage.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  check('Pro brand: no free-footer hint', await brandPage.locator('.vv-export-hint').count() === 0)

  await brandPage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await brandPage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.2, 0.6, 0.3]) })
  await brandPage.waitForSelector('.pdf-page-card')
  const brandDownload = brandPage.waitForEvent('download', { timeout: 10000 })
  await brandPage.locator('#pdf-export').click()
  const brandPdf = await pdfText(readFileSync(await (await brandDownload).path()))
  check('Pro brand: PDF Toolkit export has the brand text and no footer', brandPdf.pages.every((text) => text.includes(BRAND.name) && text.includes(BRAND.line) && !text.includes('vishvaddi.com')), brandPdf.pages.join(' | '))

  await brandPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  check('Pro brand: /pro preview shows exactly the brand and hides the free note', await brandPage.locator('#brand-free-note').isHidden() && await brandPage.locator('#brand-preview .brand-sheet').count() === 1 && !((await brandPage.locator('#brand-preview').textContent()) || '').includes('vishvaddi.com'))
  check('Metrics: export_pro beacons recorded for Pro', brandMetrics.filter((call) => call?.event === 'export_pro').length >= 2 && !brandMetrics.some((call) => call?.event === 'export_free'))
  check('Pro brand: zero /api/pro/use requests', brandUse.calls === 0, String(brandUse.calls))

  await brandPage.close()
  await brandCtx.close()

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

  // A 3rd distinct tool page would trigger the nudge for a public visitor —
  // confirm the owner marker suppresses it.
  await ownerPage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await ownerPage.goto(`${BASE}/site/sheet/`, { waitUntil: 'domcontentloaded' })
  check('Nudge: never shown with the owner marker even at the 3rd distinct tool page', await ownerPage.locator('.vv-nudge').count() === 0)

  await ownerPage.close()
  await ownerCtx.close()

  // ── funnel counters: session nudge on the 3rd distinct tool page, tool_view/nudge beacons ──
  const nudgeCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(nudgeCtx, { pro: false, source: null, configured: true })
  const metricCalls = await recordMetrics(nudgeCtx)
  const nudgePage = await nudgeCtx.newPage()
  nudgePage.on('pageerror', (error) => errors.push(String(error)))

  await nudgePage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  check('Nudge: not shown on the 1st distinct tool page', await nudgePage.locator('.vv-nudge').count() === 0)

  await nudgePage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  check('Nudge: not shown on the 2nd distinct tool page', await nudgePage.locator('.vv-nudge').count() === 0)

  await nudgePage.goto(`${BASE}/site/sheet/`, { waitUntil: 'domcontentloaded' })
  await nudgePage.waitForSelector('.vv-nudge', { timeout: 3000 }).catch(() => {})
  check('Nudge: shown on the 3rd distinct tool page', await nudgePage.locator('.vv-nudge').count() === 1)
  check('Nudge: links to /pro', await nudgePage.locator('.vv-nudge a[href="/pro"]').count() === 1)
  check('Nudge: copy sells the brand, not an export limit', (await nudgePage.locator('.vv-nudge').textContent() || '').includes('your business name on every export, plus sync'))
  check('Metrics: tool_view beacon recorded for each tool page visited', metricCalls.filter((call) => call?.event === 'tool_view').length === 3)
  check('Metrics: nudge_shown beacon recorded once', metricCalls.filter((call) => call?.event === 'nudge_shown').length === 1)

  await nudgePage.locator('.vv-nudge-dismiss').click()
  check('Nudge: dismiss button removes the bar', await nudgePage.locator('.vv-nudge').count() === 0)

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
