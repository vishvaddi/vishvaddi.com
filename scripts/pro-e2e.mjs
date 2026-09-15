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

// Free-use quota (docs/PRO_PLAN.md addendum): POST /api/pro/use gates every
// requirePro() call before it runs. `status` fixed always answers the same
// way; `status` as a function gets called once per request (for the
// allowed-then-blocked sequence below).
const stubUse = (context, status) =>
  context.route('**/api/pro/use', (route) => {
    const body = typeof status === 'function' ? status() : status
    route.fulfill({ status: body.allowed === false ? 402 : 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const errors = []

  // ── public visitor: not Pro, Stripe configured, free quota already used up ──
  const publicCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(publicCtx, { pro: false, source: null, configured: true, freeRemaining: 0, freeLimit: 1 })
  await stubUse(publicCtx, { allowed: false, remaining: 0, resetsAt: Math.floor(Date.now() / 1000) + 86400, freeLimit: 1 })
  const publicPage = await publicCtx.newPage()
  publicPage.on('pageerror', (error) => errors.push(String(error)))

  await publicPage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await publicPage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.1, 0.2, 0.8]) })
  await publicPage.waitForSelector('.pdf-page-card')
  const urlBefore = publicPage.url()
  await publicPage.locator('#pdf-export').click()
  // requirePro asks /api/pro/use before deciding, so the panel arrives a tick later.
  await publicPage.waitForSelector('#pro-upsell', { timeout: 5000 }).catch(() => {})
  check('Pro: PDF export shows the upsell panel for a public visitor', await publicPage.locator('#pro-upsell').count() === 1)
  check('Pro: upsell panel click does not navigate', publicPage.url() === urlBefore)
  const singularHeading = await publicPage.locator('#pro-upsell .pro-upsell-lede').textContent()
  check('Pro: upsell heading says "free export" (singular) with freeLimit:1 stubbed', (singularHeading || '').includes('used your free export'))

  await publicPage.goto(`${BASE}/site/cut-list/`, { waitUntil: 'domcontentloaded' })
  await publicPage.waitForSelector('#save-pdf:not([hidden])')
  await publicPage.locator('#save-pdf').click()
  await publicPage.waitForSelector('#pro-upsell[data-feature="cut-list-save-pdf"]', { timeout: 5000 }).catch(() => {})
  check('Pro: cut-list Save as PDF shows the upsell panel', await publicPage.locator('#pro-upsell[data-feature="cut-list-save-pdf"]').count() === 1)

  await publicPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  check('Pro: /pro renders two plan buttons', await publicPage.locator('.pro-upsell-plans .pro-upsell-btn').count() === 2)
  check(
    'Pro: /pro has no horizontal scroll at 390px',
    await publicPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  )

  await publicPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  check('Pro: [data-private] is hidden without the owner marker', (await publicPage.locator('footer a[href="/logout"][data-private]').isHidden()))

  // ── free quota: an allowed use leaves a note; a blocked one shows the panel ──
  const freeCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  // freeLimit: 3 here (not the current default of 1) proves the client derives
  // the pluralised copy from the server's response instead of hardcoding it.
  await stubStatus(freeCtx, { pro: false, source: null, configured: true, freeRemaining: 2, freeLimit: 3 })
  let useCall = 0
  await stubUse(freeCtx, () => (useCall++ === 0 ? { allowed: true, remaining: 2, freeLimit: 3 } : { allowed: false, remaining: 0, resetsAt: Math.floor(Date.now() / 1000) + 86400, freeLimit: 3 }))
  const freePage = await freeCtx.newPage()
  freePage.on('pageerror', (error) => errors.push(String(error)))

  await freePage.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await freePage.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.2, 0.6, 0.3]) })
  await freePage.waitForSelector('.pdf-page-card')
  await freePage.locator('#pdf-export').click()
  await freePage.waitForSelector('.pro-free-note[data-feature="pdf-export"]')
  check('Free quota: an allowed export leaves a note, not a panel', await freePage.locator('#pro-upsell').count() === 0)

  await freePage.locator('#pdf-export').click()
  await freePage.waitForSelector('#pro-upsell')
  const blockedHeading = await freePage.locator('#pro-upsell .pro-upsell-lede').textContent()
  check('Free quota: a blocked export (402) shows the upsell panel with the quota heading', (blockedHeading || '').includes('used your 3 free exports'))

  await freePage.close()
  await freeCtx.close()

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

  check('Pro pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))

  await publicPage.close()
  await ownerPage.close()
  await publicCtx.close()
  await ownerCtx.close()

  // ── funnel counters: session nudge on the 3rd distinct tool page, tool_view/nudge beacons ──
  const nudgeCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(nudgeCtx, { pro: false, source: null, configured: true, freeRemaining: 1, freeLimit: 1 })
  await stubUse(nudgeCtx, { allowed: true, remaining: 0, freeLimit: 1 })
  const metricCalls = []
  await nudgeCtx.route('**/api/metric', (route) => {
    try { metricCalls.push(route.request().postDataJSON()) } catch { /* non-JSON beacon body — ignore */ }
    route.fulfill({ status: 204 })
  })
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
  check('Metrics: tool_view beacon recorded for each tool page visited', metricCalls.filter((call) => call?.event === 'tool_view').length === 3)
  check('Metrics: nudge_shown beacon recorded once', metricCalls.filter((call) => call?.event === 'nudge_shown').length === 1)

  await nudgePage.locator('.vv-nudge-dismiss').click()
  check('Nudge: dismiss button removes the bar', await nudgePage.locator('.vv-nudge').count() === 0)

  await nudgePage.close()
  await nudgeCtx.close()

  // ── funnel counters: checkout_click beacon on the /pro page's plan buttons ──
  const checkoutCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(checkoutCtx, { pro: false, source: null, configured: true, freeRemaining: 1, freeLimit: 1 })
  const checkoutMetricCalls = []
  await checkoutCtx.route('**/api/metric', (route) => {
    try { checkoutMetricCalls.push(route.request().postDataJSON()) } catch { /* ignore */ }
    route.fulfill({ status: 204 })
  })
  await checkoutCtx.route('**/api/pro/checkout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${BASE}/pro?cancelled=1` }) }),
  )
  const checkoutPage = await checkoutCtx.newPage()
  checkoutPage.on('pageerror', (error) => errors.push(String(error)))

  await checkoutPage.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  const freeLimitCopy = await checkoutPage.locator('#free-limit-copy').textContent()
  check('Pro: /pro Free section reads "1 export" from freeLimit:1', (freeLimitCopy || '').includes('1 export'))

  await checkoutPage.locator('.pro-upsell-plans .pro-upsell-btn').first().click()
  await checkoutPage.waitForTimeout(300) // the beacon fires before the stubbed checkout redirect races it
  check('Metrics: checkout_click beacon recorded on plan button click', checkoutMetricCalls.some((call) => call?.event === 'checkout_click'))

  await checkoutPage.close()
  await checkoutCtx.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
