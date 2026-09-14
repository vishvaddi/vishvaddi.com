import { chromium } from 'playwright-core'
import { serveBuiltSite } from './serve-built-site.mjs'

// Training, album checklist and the narration/scan upgrades. Kitchen and
// Money have their own harnesses.
const builtSite = process.argv[2] === 'dist' ? await serveBuiltSite(4406) : null
const BASE = builtSite?.base ?? process.argv[2] ?? 'http://127.0.0.1:4321'
let failures = 0
const check = (name, value, detail = '') => {
  console.log(`  ${value ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!value) failures++
}

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('dialog', (dialog) => dialog.accept())

  // ── Training ──
  await page.goto(`${BASE}/training/`, { waitUntil: 'domcontentloaded' })
  check('Training: default programme renders three days', await page.locator('#tr-day option').count() === 3)
  check('Training: store controls present', await page.locator('#training-store [data-store-sync]').count() === 1 && await page.locator('#training-store input[type=file]').count() === 1)
  const squat = page.locator('.tr-ex[data-exercise="squat"]')
  check('Training: first session suggests the start weight', (await squat.locator('.rec-sub').textContent()).includes('@ 60 kg'))
  for (const row of await squat.locator('.tr-set:not(.tr-set-head)').all()) {
    await row.locator('.tr-reps').fill('5')
    await row.locator('.tr-rpe').fill('7')
  }
  await page.locator('#tr-save').click()
  check('Training: saving lands in History', await page.locator('#tr-history .tr-session').count() === 1)
  await page.locator('.fit-tab[data-tab="Today"]').click()
  await page.locator('#tr-day').selectOption('a')
  const squatAgain = page.locator('.tr-ex[data-exercise="squat"]')
  check('Training: clean session progresses the load to 65 kg', (await squatAgain.locator('.rec-sub').textContent()).includes('@ 65 kg') && (await squatAgain.locator('.rec-chip').textContent()) === 'progress')
  await page.locator('.fit-tab[data-tab="Progress"]').click()
  check('Training: progress shows an e1RM sparkline', await page.locator('.tr-trend[data-exercise="squat"] .tr-spark').count() === 1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.fit-tab[data-tab="History"]').click()
  check('Training: sessions persist locally', await page.locator('#tr-history .tr-session').count() === 1)
  const trWidth = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('Training: no horizontal scroll at phone width', trWidth)

  // ── Album checklist ──
  await page.goto(`${BASE}/music/`, { waitUntil: 'domcontentloaded' })
  check('Albums: checklist mounts on the Listening page', await page.locator('#albums-app').count() === 1 && await page.locator('#albums-store [data-store-sync]').count() === 1)
  await page.locator('.alb-import summary').click()
  await page.locator('#alb-list-name').fill('Test 3')
  await page.locator('#alb-list-text').fill('1. Marvin Gaye – What\'s Going On (1971)\n2. The Beach Boys – Pet Sounds (1966)\n3. Joni Mitchell – Blue (1971)')
  await page.locator('#alb-add-list').click()
  check('Albums: pasted list imports three albums', await page.locator('.alb-row').count() === 3, await page.locator('#alb-import-status').textContent())
  await page.locator('#alb-list-name').fill('Test B')
  await page.locator('#alb-list-text').fill('Beach Boys – Pet Sounds\nNirvana – Nevermind')
  await page.locator('#alb-add-list').click()
  await page.locator('#alb-filter-list').selectOption('')
  check('Albums: second list merges the duplicate', await page.locator('.alb-row').count() === 4)
  // The row re-renders (and leaves the unplayed view) on change, so a plain click
  // beats check(), which waits to verify state on a detached node.
  await page.locator('.alb-row').first().locator('input[type=checkbox]').click()
  await page.waitForFunction(() => document.querySelectorAll('.alb-row').length === 3)
  check('Albums: ticking hides it from unplayed view', await page.locator('.alb-row').count() === 3)
  await page.locator('#alb-pick').click()
  check('Albums: pick suggests an unplayed album', !(await page.locator('#alb-pick-card').isHidden()))
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('Albums: ticks persist', (await page.locator('#alb-stats .stat .n').first().textContent()).startsWith('1 / 4'))

  // ── Reader narration + local files ──
  await page.goto(`${BASE}/reader/`, { waitUntil: 'domcontentloaded' })
  check('Reader: voice module exposes segment/normalise', await page.evaluate(() => Boolean(window.SiteVoice && window.SiteVoice.segment && window.SiteVoice.normalise)))
  check('Reader: text cleaner loaded', await page.evaluate(() => Boolean(window.TextClean && window.TextClean.clean)))
  const scan = 'MY BOOK\n\nCHAPTER I\n\nIt was a bright cold day in April and the clocks were strik-\ning thirteen. Winston Smith slipped quickly through the\nglass doors.\n\n7\n\nMY BOOK\n\nThe hallway smelt of boiled cabbage and old rag mats and\nthe lift was out of order.\n\n8\n\nMY BOOK\n\nHe went on up the stairs to the flat, seven flights, and\nrested on each landing.\n\n9\n'
  await page.locator('#open-file-input').setInputFiles({ name: 'scan.txt', mimeType: 'text/plain', buffer: Buffer.from(scan) })
  await page.waitForSelector('#left-panel p', { timeout: 15000 })
  const pageText = await page.locator('#left-panel').innerText()
  check('Reader: local scan opens as a book with wrapped lines rejoined', /striking thirteen/.test(pageText) && !/^\s*7\s*$/m.test(pageText))
  check('Reader: running head dropped', !/MY BOOK/.test(pageText))
  const segs = await page.evaluate(() => window.SiteVoice.segment('CHAPTER I\n\nOne. Two.\n\n"Hi," she said.').map((s) => s.pauseAfter))
  check('Reader: segments carry chapter and paragraph pauses', JSON.stringify(segs) === JSON.stringify([2000, 0, 800, 800]), JSON.stringify(segs))

  await page.goto(`${BASE}/feeds/`, { waitUntil: 'domcontentloaded' })
  check('Feeds: voice module has pause table', await page.evaluate(() => Boolean(window.SiteVoice && window.SiteVoice.PAUSE && window.SiteVoice.PAUSE.paragraph === 800)))

  check('Life pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser?.close()
  await builtSite?.close()
}

if (failures) process.exit(1)
