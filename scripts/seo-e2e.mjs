import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4409) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

const SITE_TOOLS = ['calc', 'notepad', 'convert', 'materials', 'geometry', 'rate', 'charge-rate', 'prices', 'programme', 'cut-list', 'lattice', 'records', 'voice', 'sketch', 'gauges', 'pdf', 'quickref']
const AUDIO_TOOLS = ['chords', 'prep', 'bpm', 'metronome', 'lofi', 'ear', 'analyser']
const PATHS = [
  '/site/', '/audio/',
  ...SITE_TOOLS.map((slug) => `/site/${slug}/`),
  ...AUDIO_TOOLS.map((slug) => `/audio/${slug}/`),
]
const RESPONSIVE_SAMPLES = ['/site/cut-list/', '/site/pdf/', '/audio/chords/']

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  const titles = new Map()

  for (const path of PATHS) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    const title = await page.title()
    check(`${path}: title present and <=70 chars`, title.length > 0 && title.length <= 70, `"${title}" (${title.length})`)
    if (titles.has(title)) check(`${path}: title unique`, false, `duplicates ${titles.get(title)}`)
    titles.set(title, path)

    const description = await page.locator('meta[name="description"]').getAttribute('content')
    check(`${path}: meta description present`, !!description && description.length > 0)

    const robots = await page.locator('meta[name="robots"]').count()
    check(`${path}: not noindex`, robots === 0)

    const ldJsonBlocks = await page.locator('script[type="application/ld+json"]').allTextContents()
    let hasFaqPage = false
    let allParse = ldJsonBlocks.length > 0
    for (const raw of ldJsonBlocks) {
      try {
        const data = JSON.parse(raw)
        const types = new Set()
        const collect = (node) => {
          if (!node || typeof node !== 'object') return
          if (Array.isArray(node)) { node.forEach(collect); return }
          if (node['@type']) types.add(node['@type'])
          if (Array.isArray(node['@graph'])) node['@graph'].forEach(collect)
        }
        collect(data)
        if (types.has('FAQPage')) hasFaqPage = true
      } catch {
        allParse = false
      }
    }
    check(`${path}: JSON-LD present and parses`, allParse)
    check(`${path}: JSON-LD includes FAQPage`, hasFaqPage)
  }

  await page.goto(`${BASE}/pro/`, { waitUntil: 'domcontentloaded' })
  check('Pro: updates form removed (16/09)', await page.locator('#waitlist-form, #waitlist-email').count() === 0)

  const phonePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  phonePage.on('pageerror', (error) => errors.push(String(error)))
  for (const path of RESPONSIVE_SAMPLES) {
    await phonePage.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    const { scrollWidth, clientWidth } = await phonePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    check(`${path}: no horizontal scroll at 390px`, scrollWidth <= clientWidth + 1, `${scrollWidth} vs ${clientWidth}`)
  }
  await phonePage.close()

  check('SEO pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
