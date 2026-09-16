// /site/materials/<family> search-intent answer pages gate. Drives the real
// built pages in system Chrome via playwright-core: page-count caps per
// family, the first-sentence number against an independent reimplementation
// of the /site/materials formulas (not the page's own source, so a bug in
// the shared module would still be caught), JSON-LD parses, the "change the
// numbers" link round-trips to the live calculator with the same number, and
// no phone-width overflow or console errors.
// Usage: node scripts/materials-answers-e2e.mjs [baseURL|dist]   (default http://localhost:4321)
import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4405) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://localhost:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

// Independent reimplementation of src/data/materials-calc.ts — deliberately
// not imported, so this harness can't be fooled by a bug shared between the
// calculator and the answer pages.
const auFmt = (n, max = 2) => n.toLocaleString('en-AU', { maximumFractionDigits: max })
const up = (n) => Math.max(0, Math.ceil(n))
const pct = (waste) => 1 + (waste || 0) / 100
const sheetCount = (area, w, h, waste) => up((area * pct(waste)) / ((w / 1000) * (h / 1000)))
const tileCount = sheetCount
const paintLitres = (area, openings, coats, cov) => ((Math.max(0, area - openings)) * coats) / cov
const concreteVolume = (l, w, d, waste) => l * w * (d / 1000) * pct(waste)
const concreteBags = (vol) => up(vol / 0.0108)

const FAMILY_CAP = 40
const TOTAL_CAP = 150

// A handful of sample pages per family, spanning the grid — not every page,
// but enough to catch a systematic formula or formatting mistake.
const PLASTERBOARD_SAMPLES = [
  { slug: '4x5m-room-2-4m-ceiling', l: 4, w: 5, h: 2.4 },
  { slug: '6x6m-room-2-7m-ceiling', l: 6, w: 6, h: 2.7 },
  { slug: '3x3m-room-2-55m-ceiling', l: 3, w: 3, h: 2.55 },
]
const PAINT_SAMPLES = [
  { slug: '3x3m-room-2-4m-ceiling', l: 3, w: 3, h: 2.4 },
  { slug: '5x6m-room-2-7m-ceiling', l: 5, w: 6, h: 2.7 },
]
const TILE_SAMPLES = [
  { slug: '10sqm-300x600mm-tiles', area: 10, tw: 300, th: 600 },
  { slug: '25sqm-600x600mm-tiles', area: 25, tw: 600, th: 600 },
  { slug: '4sqm-300x300mm-tiles', area: 4, tw: 300, th: 300 },
]
const CONCRETE_SAMPLES = [
  { slug: '4x4m-slab-100mm', l: 4, w: 4, d: 100 },
  { slug: '6x9m-slab-150mm', l: 6, w: 9, d: 150 },
]

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // The static dist server has no Worker; the funnel counter's POST would 404 into the console check.
  await ctx.route('**/api/metric', (route) => route.fulfill({ status: 204 }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  // ---- family index pages: page counts within caps -----------------------
  const familyCounts = {}
  for (const family of ['plasterboard', 'paint', 'tiles', 'concrete']) {
    await page.goto(`${BASE}/site/materials/${family}/`, { waitUntil: 'domcontentloaded' })
    const linkCount = await page.locator('.mat-index-grid a').count()
    familyCounts[family] = linkCount
    check(`${family}: index lists between 1 and ${FAMILY_CAP} pages`, linkCount > 0 && linkCount <= FAMILY_CAP, `${linkCount} pages`)
    const title = await page.title()
    check(`${family} index: title present`, title.length > 0 && title.length <= 70, `"${title}"`)
    const ldBlocks = await page.locator('script[type="application/ld+json"]').count()
    check(`${family} index: has no stray JSON-LD`, ldBlocks === 0)
  }
  const total = Object.values(familyCounts).reduce((a, b) => a + b, 0)
  check(`total answer pages within ${TOTAL_CAP} cap`, total <= TOTAL_CAP, `${total} pages`)

  // ---- materials hub links to each family index ---------------------------
  await page.goto(`${BASE}/site/materials/`, { waitUntil: 'domcontentloaded' })
  const jobLinks = await page.locator('.mat-jobs-list a').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
  for (const family of ['plasterboard', 'paint', 'tiles', 'concrete']) {
    check(`materials hub links to /site/materials/${family}/`, jobLinks.includes(`/site/materials/${family}/`))
  }

  // ---- per-page correctness -------------------------------------------------
  const readPage = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    const title = await page.title()
    const description = await page.locator('meta[name="description"]').getAttribute('content')
    const h1 = await page.locator('h1').first().textContent()
    const lead = await page.locator('.mat-answer-lead').textContent()
    const changeHref = await page.locator('.btn-row a.btn').getAttribute('href')
    const ldBlocks = await page.locator('script[type="application/ld+json"]').allTextContents()
    const neighbours = await page.locator('.mat-answer-neighbours a').count()
    return { title, description, h1, lead, changeHref, ldBlocks, neighbours }
  }

  const checkJsonLd = (path, ldBlocks) => {
    let parses = ldBlocks.length > 0
    let hasFaq = false, hasHowTo = false
    for (const raw of ldBlocks) {
      try {
        const data = JSON.parse(raw)
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data]
        for (const node of graph) {
          if (node['@type'] === 'FAQPage') hasFaq = true
          if (node['@type'] === 'HowTo') hasHowTo = true
        }
      } catch { parses = false }
    }
    check(`${path}: JSON-LD parses`, parses)
    check(`${path}: JSON-LD includes FAQPage`, hasFaq)
    check(`${path}: JSON-LD includes HowTo`, hasHowTo)
  }

  for (const s of PLASTERBOARD_SAMPLES) {
    const path = `/site/materials/plasterboard/${s.slug}/`
    const r = await readPage(path)
    const wallArea = 2 * (s.l + s.w) * s.h
    const expected = up((wallArea * pct(10)) / 2.88)
    check(`${path}: title present and <=70 chars`, r.title.length > 0 && r.title.length <= 70, `"${r.title}" (${r.title.length})`)
    check(`${path}: meta description present`, !!r.description)
    check(`${path}: H1 states the question`, r.h1.includes('?'))
    check(`${path}: lead sentence has the calculator's number`, r.lead.includes(auFmt(expected, 0)), `expected ${auFmt(expected, 0)}, got "${r.lead}"`)
    check(`${path}: 2-4 neighbour links`, r.neighbours >= 2 && r.neighbours <= 4, `${r.neighbours}`)
    checkJsonLd(path, r.ldBlocks)

    // Change-the-numbers link round-trips to the live calculator.
    await page.goto(`${BASE}${r.changeHref}`, { waitUntil: 'domcontentloaded' })
    const shown = await page.locator('#sheet .stat-grid .stat').first().locator('.n').textContent()
    check(`${path}: change-the-numbers link shows the same number on /site/materials`, shown.includes(auFmt(expected, 0)), `expected ${auFmt(expected, 0)}, got "${shown}"`)
  }

  for (const s of PAINT_SAMPLES) {
    const path = `/site/materials/paint/${s.slug}/`
    const r = await readPage(path)
    const wallArea = 2 * (s.l + s.w) * s.h
    const expected = paintLitres(wallArea, 2, 2, 11)
    check(`${path}: title present and <=70 chars`, r.title.length > 0 && r.title.length <= 70, `"${r.title}"`)
    check(`${path}: lead sentence has the calculator's number`, r.lead.includes(auFmt(expected, 2)), `expected ${auFmt(expected, 2)}, got "${r.lead}"`)
    checkJsonLd(path, r.ldBlocks)
    await page.goto(`${BASE}${r.changeHref}`, { waitUntil: 'domcontentloaded' })
    const shown = await page.locator('#paint .stat-grid .stat').first().locator('.n').textContent()
    check(`${path}: change-the-numbers link shows the same number on /site/materials`, shown.includes(auFmt(expected, 2)), `expected ${auFmt(expected, 2)}, got "${shown}"`)
  }

  for (const s of TILE_SAMPLES) {
    const path = `/site/materials/tiles/${s.slug}/`
    const r = await readPage(path)
    const expected = tileCount(s.area, s.tw, s.th, 10)
    check(`${path}: title present and <=70 chars`, r.title.length > 0 && r.title.length <= 70, `"${r.title}"`)
    check(`${path}: lead sentence has the calculator's number`, r.lead.includes(auFmt(expected, 0)), `expected ${auFmt(expected, 0)}, got "${r.lead}"`)
    checkJsonLd(path, r.ldBlocks)
    await page.goto(`${BASE}${r.changeHref}`, { waitUntil: 'domcontentloaded' })
    const shown = await page.locator('#tiles .stat-grid .stat').first().locator('.n').textContent()
    check(`${path}: change-the-numbers link shows the same number on /site/materials`, shown.includes(auFmt(expected, 0)), `expected ${auFmt(expected, 0)}, got "${shown}"`)
  }

  for (const s of CONCRETE_SAMPLES) {
    const path = `/site/materials/concrete/${s.slug}/`
    const r = await readPage(path)
    const vol = concreteVolume(s.l, s.w, s.d, 5)
    check(`${path}: title present and <=70 chars`, r.title.length > 0 && r.title.length <= 70, `"${r.title}"`)
    check(`${path}: lead sentence has the calculator's number`, r.lead.includes(auFmt(vol, 2)), `expected ${auFmt(vol, 2)}, got "${r.lead}"`)
    checkJsonLd(path, r.ldBlocks)
    await page.goto(`${BASE}${r.changeHref}`, { waitUntil: 'domcontentloaded' })
    const shown = await page.locator('#concrete .stat-grid .stat').first().locator('.n').textContent()
    check(`${path}: change-the-numbers link shows the same number on /site/materials`, shown.includes(auFmt(vol, 2)), `expected ${auFmt(vol, 2)}, got "${shown}"`)
  }

  // ---- phone width: no horizontal overflow --------------------------------
  const phonePage = await ctx.newPage()
  phonePage.on('pageerror', (error) => errors.push(String(error)))
  await phonePage.setViewportSize({ width: 390, height: 844 })
  const RESPONSIVE_SAMPLES = [
    '/site/materials/plasterboard/4x5m-room-2-4m-ceiling/',
    '/site/materials/paint/3x3m-room-2-4m-ceiling/',
    '/site/materials/tiles/10sqm-300x600mm-tiles/',
    '/site/materials/concrete/4x4m-slab-100mm/',
    '/site/materials/plasterboard/',
  ]
  for (const path of RESPONSIVE_SAMPLES) {
    await phonePage.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    const { scrollWidth, clientWidth } = await phonePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    check(`${path}: no horizontal scroll at 390px`, scrollWidth <= clientWidth + 1, `${scrollWidth} vs ${clientWidth}`)
  }
  await phonePage.close()

  check('Materials answer pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 300))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
