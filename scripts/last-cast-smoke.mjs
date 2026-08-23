import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'https://vishvaddi.com'
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const errors = []
let wasmResponse

page.on('pageerror', error => errors.push(String(error)))
page.on('response', response => {
  if (new URL(response.url()).pathname === '/games/last-cast/index.wasm') wasmResponse = response
})

try {
  const response = await page.goto(`${base}/games/last-cast/`, { waitUntil: 'domcontentloaded' })
  if (!response?.ok()) throw new Error(`page returned ${response?.status()}`)
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#canvas')
    return canvas && canvas.width > 0 && canvas.height > 0 && !document.querySelector('#status')
  }, null, { timeout: 60000 })
  if (!wasmResponse?.ok()) throw new Error(`wasm returned ${wasmResponse?.status() ?? 'no response'}`)
  const headers = wasmResponse.headers()
  if (headers['content-encoding'] !== 'gzip') throw new Error(`wasm encoding was ${headers['content-encoding'] ?? 'missing'}`)
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(`LAST CAST LIVE OK — canvas ready; wasm ${wasmResponse.status()} gzip`)
} finally {
  await browser.close()
}
