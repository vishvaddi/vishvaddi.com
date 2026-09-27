import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'

// Site audit 25/09/26: unknown pages returned an empty 404 body (1.2) and
// unslashed page URLs bounced through a temporary 307 (1.4).

const request = (path, headers = {}) => new Request(`https://example.com${path}`, { headers })
const navigate = (path) => request(path, { 'Sec-Fetch-Dest': 'document', Accept: 'text/html,*/*' })

function env(assets) {
  return {
    ASSETS: {
      fetch: async (req) => {
        const url = new URL(req.url)
        return assets(url.pathname)
      },
    },
  }
}

const staticSite = env((path) => {
  if (path === '/404') return new Response('<h1>Page not found</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  if (path === '/site/calc') return new Response(null, { status: 307, headers: { Location: 'https://example.com/site/calc/' } })
  if (path === '/site/calc/') return new Response('<h1>Calculator</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  return new Response(null, { status: 404 })
})

test('an unknown page navigation gets the styled 404 page with status 404', async () => {
  const res = await worker.fetch(navigate('/zzz'), staticSite)
  assert.equal(res.status, 404)
  assert.match(res.headers.get('Content-Type'), /text\/html/)
  assert.match(await res.text(), /Page not found/)
})

test('a plain Accept: text/html request (curl -H) is treated as a navigation too', async () => {
  const res = await worker.fetch(request('/latest', { Accept: 'text/html' }), staticSite)
  assert.equal(res.status, 404)
  assert.match(await res.text(), /Page not found/)
})

test('non-navigation and API 404s keep their original body', async () => {
  const asset = await worker.fetch(request('/missing.js'), staticSite)
  assert.equal(asset.status, 404)
  assert.equal(await asset.text(), '')
  const api = await worker.fetch(navigate('/api/'), staticSite)
  assert.equal(api.status, 404)
  assert.equal(await api.text(), '')
})

test('the unslashed page redirect becomes a permanent 301 to the same path', async () => {
  const res = await worker.fetch(navigate('/site/calc'), staticSite)
  assert.equal(res.status, 301)
  assert.equal(res.headers.get('Location'), 'https://example.com/site/calc/')
})

test('other 307s pass through untouched', async () => {
  const elsewhere = env(() => new Response(null, { status: 307, headers: { Location: 'https://example.com/other/' } }))
  const res = await worker.fetch(navigate('/site/calc'), elsewhere)
  assert.equal(res.status, 307)
})

test('the slashed page itself is served as-is', async () => {
  const res = await worker.fetch(navigate('/site/calc/'), staticSite)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /Calculator/)
})
