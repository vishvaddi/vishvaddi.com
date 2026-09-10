// Opens a book in the built Reader at phone portrait and landscape sizes and
// saves screenshots so the Kindle-style layout can be eyeballed without a
// device. Usage: node scripts/reader-phone-shots.mjs <outDir>
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serveBuiltSite } from './serve-built-site.mjs'

const out = process.argv[2] ?? 'tmp/reader-shots'
mkdirSync(out, { recursive: true })
// SHOT_BASE points at a running `wrangler dev` (the library needs the Worker proxies); otherwise serve dist statically.
const site = process.env.SHOT_BASE ? { base: process.env.SHOT_BASE, close: async () => {} } : await serveBuiltSite(4409)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  // The library and the text proxy live in the Worker; stub the text endpoint so
  // this runs against the static build with nothing but one Chrome process.
  const para = 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters. '
  const body = Array.from({ length: 220 }, (_, i) => (i % 9 === 0 ? 'CHAPTER ' + (i / 9 + 1) + '\n\n' : '') + para.repeat(1 + (i % 3))).join('\n\n')
  await page.route('**/api/book*', (route) => route.fulfill({ contentType: 'text/plain; charset=utf-8', body }))
  await page.goto(`${site.base}/reader/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => openBook({ id: 'shot-sample', title: 'Pride and Prejudice (sample)', formats: { 'text/plain': 'https://www.gutenberg.org/ebooks/1342' } }))
  await page.waitForFunction(() => document.querySelectorAll('#left-panel p').length > 0, null, { timeout: 60000 })
  await page.waitForTimeout(600)
  const state = await page.evaluate(() => ({
    immersive: document.body.classList.contains('reader-immersive'),
    pageInfo: document.getElementById('page-info')?.textContent,
    panelH: document.getElementById('left-panel')?.clientHeight,
    viewportH: window.innerHeight,
    overflow: (() => { const p = document.getElementById('left-panel'); return p ? p.scrollHeight - p.clientHeight : null })(),
  }))
  console.log('portrait (opens with controls hidden)', JSON.stringify({ ...state, hidden: await page.evaluate(() => document.body.classList.contains('reader-chrome-hidden')) }))
  await page.screenshot({ path: join(out, 'portrait-immersive.jpg'), type: 'jpeg', quality: 60 })
  // centre tap shows the overlay controls
  const box = await page.locator('#spread').boundingBox()
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(500)
  console.log('portrait-chrome-shown', JSON.stringify(await page.evaluate(() => ({ hidden: document.body.classList.contains('reader-chrome-hidden'), pageInfo: document.getElementById('page-info')?.textContent }))))
  await page.screenshot({ path: join(out, 'portrait.jpg'), type: 'jpeg', quality: 60 })
  // right-third tap turns the page
  const before = await page.evaluate(() => document.getElementById('page-info')?.textContent)
  await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2)
  await page.waitForTimeout(400)
  console.log('tap-next', JSON.stringify({ before, after: await page.evaluate(() => document.getElementById('page-info')?.textContent) }))
  // landscape
  await page.setViewportSize({ width: 844, height: 390 })
  // repagination of a whole novel is async; wait until the page fits again
  await page.waitForFunction(() => { const p = document.getElementById('left-panel'); return p && p.scrollHeight - p.clientHeight <= 0 && p.clientHeight < 500 }, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(300)
  const land = await page.evaluate(() => ({
    pageInfo: document.getElementById('page-info')?.textContent,
    panelH: document.getElementById('left-panel')?.clientHeight,
    viewportH: window.innerHeight,
    overflow: (() => { const p = document.getElementById('left-panel'); return p ? p.scrollHeight - p.clientHeight : null })(),
    hidden: document.body.classList.contains('reader-chrome-hidden'),
  }))
  console.log('landscape', JSON.stringify(land))
  await page.screenshot({ path: join(out, 'landscape-immersive.jpg'), type: 'jpeg', quality: 60 })
  const box2 = await page.locator('#spread').boundingBox()
  await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2)
  await page.waitForTimeout(500)
  console.log('landscape-chrome-shown', JSON.stringify(await page.evaluate(() => ({ hidden: document.body.classList.contains('reader-chrome-hidden') }))))
  await page.screenshot({ path: join(out, 'landscape-chrome.jpg'), type: 'jpeg', quality: 60 })
} finally {
  await browser.close()
  await site.close()
}
