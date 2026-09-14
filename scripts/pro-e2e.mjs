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
  await stubStatus(publicCtx, { pro: false, source: null, configured: true, freeRemaining: 0 })
  await stubUse(publicCtx, { allowed: false, remaining: 0, resetsAt: Math.floor(Date.now() / 1000) + 86400 })
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
  check('Pro: [data-private] is hidden without the owner marker', (await publicPage.locator('a[href="/feeds"][data-private]').isHidden()))

  // ── free quota: an allowed use leaves a note; a blocked one shows the panel ──
  const freeCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubStatus(freeCtx, { pro: false, source: null, configured: true, freeRemaining: 2 })
  let useCall = 0
  await stubUse(freeCtx, () => (useCall++ === 0 ? { allowed: true, remaining: 2 } : { allowed: false, remaining: 0, resetsAt: Math.floor(Date.now() / 1000) + 86400 }))
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
  check('Pro: [data-private] is visible with the owner marker', (await ownerPage.locator('a[href="/feeds"][data-private]').isVisible()))

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
