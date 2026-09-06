import { chromium } from 'playwright-core'
import { PDFDocument, rgb } from 'pdf-lib'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321'
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto(`${BASE}/radio/`, { waitUntil: 'domcontentloaded' })
  await page.locator('.preset-btn').first().click()
  await page.locator('#favourite-btn').click()
  await page.locator('#station-toggle').click()
  await page.locator('[data-filter="favourite"]').click()
  check('Radio: current station can be saved and filtered locally', await page.locator('.station-row').count() === 1)
  await page.locator('#random-station-btn').click()

  await page.goto(`${BASE}/prepping/gear/`, { waitUntil: 'domcontentloaded' })
  const firstLoadout = page.locator('[data-loadout="blackout"] input').first()
  await firstLoadout.check()
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('Gear: task readiness persists locally', await page.locator('[data-loadout="blackout"] input').first().isChecked())

  await page.goto(`${BASE}/prepping/knots/`, { waitUntil: 'domcontentloaded' })
  check('Knots: eight essential lessons render', await page.locator('.knot-card').count() === 8)
  const firstPath = page.locator('.knot-card').first().locator('.rope')
  const before = await firstPath.getAttribute('d')
  await page.locator('.knot-card').first().locator('[data-action="next"]').click()
  check('Knots: step control changes the animated diagram', await firstPath.getAttribute('d') !== before)

  await page.goto(`${BASE}/site/`, { waitUntil: 'domcontentloaded' })
  check('Hub: every tool states problem and privacy', await page.locator('[data-tool-item]').count() === await page.locator('[data-tool-item] .tool-privacy').count())

  await page.goto(`${BASE}/site/pdf/`, { waitUntil: 'domcontentloaded' })
  await page.locator('#pdf-file').setInputFiles({ name: 'base.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.1, 0.2, 0.8]) })
  await page.waitForSelector('.pdf-page-card')
  await page.locator('.pdf-options').first().locator('summary').click()
  await page.locator('#pdf-stamp-preset').selectOption({ label: 'FOR REVIEW' })
  check('PDF: estimator preset populates the issue mark', await page.locator('#pdf-stamp').inputValue() === 'FOR REVIEW')
  await page.locator('#pdf-compare-panel summary').click()
  await page.locator('#pdf-compare-file').setInputFiles({ name: 'revision.pdf', mimeType: 'application/pdf', buffer: await makePdf([0.8, 0.15, 0.1]) })
  await page.locator('#pdf-compare-render').click()
  await page.waitForSelector('#pdf-compare-canvas.ready')
  check('PDF: drawing overlay renders and can export', !(await page.locator('#pdf-compare-export').isDisabled()))
  check('PDF: preflight reports before export', await page.locator('#pdf-preflight li').count() > 0)
  check('Feature pages: console is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
} catch (error) {
  check('suite completed', false, String(error).slice(0, 240))
} finally {
  await browser.close()
}

if (failures) process.exit(1)
