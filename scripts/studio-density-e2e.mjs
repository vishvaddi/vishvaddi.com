// Studio density gate — the objective test behind the "tighten the GUI" work.
// Ink coverage = share of the viewport actually covered by painted leaf
// elements. A mode that leaves bare case showing scores low; a mode that
// spills past the aperture reports overflow. Doctrine: metal never scrolls,
// only glass does — so any remaining scroll must sit inside an overflow-auto
// element, never on the page.
// Usage: node scripts/studio-density-e2e.mjs [baseURL]
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:4321'
const MODES = ['DRUMS', 'PADS', 'SYNTH', 'CLIPS', 'MIX']
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, minInk: 50 },
  { name: 'laptop', width: 1280, height: 720, minInk: 45 },
]
// A console is legitimately sparser than an editor: long faders need vertical
// room and strips are narrow by nature, so MIX carries its own floor rather
// than being padded with furniture it does not need.
const INK_FLOOR = { MIX: 42 }
const MAX_TRAILING = 40

const results = []
let failed = 0
const check = (name, ok, detail = '') => {
  results.push(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })

try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/studio/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('vv_studio_tutorial_seen', '1') })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.wa-transport', { timeout: 20000 })

    for (const mode of MODES) {
      await page.locator('.wa-modekey', { hasText: mode }).click()
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => {
        const VW = innerWidth, VH = innerHeight, G = 12
        const cells = new Set()
        // Ink = instrument surface: controls and screens at any depth, plus
        // leaf text. Counting only childless nodes undercounts badly — a pad
        // is a <button> wrapping a label, so a 183px pad scored as empty.
        const CONTROLS = 'button, input, select, textarea, canvas, [role="slider"], .wa-cell, .wa-clip, .wa-meter, .wa-key'
        const mark = (r) => {
          if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > VH) return
          for (let y = Math.max(0, r.top); y < Math.min(VH, r.bottom); y += G)
            for (let x = Math.max(0, r.left); x < Math.min(VW, r.right); x += G)
              cells.add(`${Math.floor(x / G)},${Math.floor(y / G)}`)
        }
        document.querySelectorAll(`.wa-win :is(${CONTROLS})`).forEach((e) => mark(e.getBoundingClientRect()))
        document.querySelectorAll('.wa-win *').forEach((e) => {
          if (e.children.length || !e.textContent.trim()) return
          mark(e.getBoundingClientRect())
        })
        const ink = (cells.size / ((VW / G) * (VH / G))) * 100
        const page = document.querySelector('.wa-page:not([hidden])')
        // Metal only. Anything inside a scrollable container is glass and is
        // allowed to exceed the aperture — that is the whole doctrine.
        const inGlass = (e) => {
          for (let n = e.parentElement; n && n !== page; n = n.parentElement) {
            const oy = getComputedStyle(n).overflowY
            if (oy === 'auto' || oy === 'scroll') return true
          }
          return false
        }
        const boxes = [...page.querySelectorAll('*')].filter((e) => !inGlass(e))
          .map((e) => e.getBoundingClientRect()).filter((r) => r.height > 2)
        const deepest = boxes.length ? Math.max(...boxes.map((r) => r.bottom)) : 0
        // scrollers that are legitimately "glass" (overflow-y auto/scroll)
        const metalScroll = document.documentElement.scrollHeight - innerHeight
        return { ink: +ink.toFixed(1), overflow: Math.round(deepest - VH), trailing: Math.round(VH - deepest), metalScroll: Math.round(metalScroll) }
      })
      const tag = `${vp.name}/${mode}`
      const floor = INK_FLOOR[mode] ?? vp.minInk
      check(`${tag}: ink coverage`, m.ink >= floor, `${m.ink}% (min ${floor}%)`)
      check(`${tag}: no page overflow`, m.overflow <= 0, m.overflow > 0 ? `overflows ${m.overflow}px` : 'fits')
      check(`${tag}: no trailing void`, m.trailing <= MAX_TRAILING, `${Math.max(0, m.trailing)}px bare case`)
      check(`${tag}: metal does not scroll`, m.metalScroll <= 0, `${m.metalScroll}px page scroll`)
    }
    await ctx.close()
  }
} catch (err) {
  check(`RUN ABORTED: ${String(err).slice(0, 160)}`, false)
} finally {
  await browser.close()
}

console.log(`\nStudio density vs ${BASE}\n${results.join('\n')}\n`)
if (failed) { console.error(`${failed} check(s) FAILED`); process.exit(1) }
console.log('density green')
