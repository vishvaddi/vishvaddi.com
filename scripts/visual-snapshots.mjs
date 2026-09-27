// Screenshot a route list at phone and desktop sizes, light and dark, for the
// current skin and the v2 rebrand skin, so each rollout stage can be diffed.
//   node scripts/visual-snapshots.mjs dist [outDir] [route-filter]
// Output: <outDir>/<skin>-<theme>-<viewport>/<route>.png (default .snapshots/).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

const ROUTES = [
  '/', '/site/', '/site/calc/', '/site/programme/', '/site/cut-list/', '/site/pdf/',
  '/site/materials/paint/3x3m-room-2-4m-ceiling/', '/audio/', '/audio/analyser/',
  '/prepping/', '/prepping/tools/', '/radio/', '/feeds/', '/reader/', '/games/',
  '/pro/', '/privacy/', '/404', '/offline/', '/work/',
]
const VIEWPORTS = [['phone', 390, 844], ['desk', 1440, 900]]
const SKINS = ['v1', 'v2']
const THEMES = ['light', 'dark']

const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4477) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
const OUT = process.argv[3] || '.snapshots'
const FILTER = process.argv[4] || ''
const routes = ROUTES.filter((r) => r.includes(FILTER))

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
let count = 0
try {
  for (const skin of SKINS) for (const theme of THEMES) for (const [vpName, width, height] of VIEWPORTS) {
    const dir = join(OUT, `${skin}-${theme}-${vpName}`)
    mkdirSync(dir, { recursive: true })
    // bypassCSP: the site's script-src 'self' otherwise blocks the init script below.
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', bypassCSP: true })
    // Both attributes are set before any stylesheet applies, the same way the
    // inline theme script does it in production.
    await context.addInitScript(([s, t]) => {
      // Chrome runs init scripts before <html> exists; wait for it.
      const apply = () => {
        const el = document.documentElement
        if (!el) return false
        el.setAttribute('data-theme', t)
        if (s === 'v2') el.setAttribute('data-skin', 'v2')
        return true
      }
      if (!apply()) new MutationObserver((_, o) => { if (apply()) o.disconnect() }).observe(document, { childList: true })
    }, [skin, theme])
    for (const route of routes) {
      const page = await context.newPage()
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(400)
        const name = route === '/' ? 'home' : route.replace(/^\/|\/$/g, '').replace(/\//g, '_')
        await page.screenshot({ path: join(dir, `${name}.png`), fullPage: vpName === 'phone' })
        count++
      } catch (error) {
        console.error(`  ! ${skin}/${theme}/${vpName} ${route}: ${String(error).slice(0, 120)}`)
      } finally {
        await page.close()
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  await builtSite?.close()
}
console.log(`${count} snapshots in ${OUT}`)
