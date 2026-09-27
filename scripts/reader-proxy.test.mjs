import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'

// Reader 504 audit (25/09/26): /api/gutenberg-opds must list books even when
// gutenberg.org's OPDS feed is down, slow or returning errors.

const env = () => ({ ASSETS: { fetch: async () => new Response('asset') } })
const request = (path) => new Request(`https://example.com${path}`)

function opdsPage(startIndex, count = 25) {
  const entries = Array.from({ length: count }, (_, i) => {
    const id = startIndex + i
    return `<entry><id>https://www.gutenberg.org/ebooks/${id}</id><title>Book ${id}</title><content type="text">Author ${id}</content></entry>`
  }).join('')
  const next = `<link rel="next" href="/ebooks/search.opds/?sort_order=downloads&amp;start_index=${startIndex + count}"/>`
  return new Response(`<feed>${next}${entries}</feed>`, { headers: { 'Content-Type': 'application/atom+xml' } })
}

function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    calls.push(href)
    return handler(new URL(href))
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('default list fans out four OPDS pages in parallel and returns 100 items', async () => {
  const { calls, restore } = stubFetch((u) => {
    assert.equal(u.hostname, 'www.gutenberg.org')
    return opdsPage(Number(u.searchParams.get('start_index')))
  })
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.results.length, 100)
    assert.equal(data.results[0].title, 'Book 1')
    assert.equal(data.results[0].authors[0].name, 'Author 1')
    assert.match(data.next, /start_index=101/)
    assert.deepEqual(calls.map((c) => new URL(c).searchParams.get('start_index')).sort((a, b) => a - b), ['1', '26', '51', '76'])
  } finally { restore() }
})

test('OPDS 5xx falls back to Gutendex in the same item shape', async () => {
  const { restore } = stubFetch((u) => {
    if (u.hostname === 'www.gutenberg.org') return new Response('bad gateway', { status: 502 })
    if (u.hostname === 'gutendex.com') {
      return Response.json({ results: [
        { id: 1342, title: 'Pride and Prejudice', authors: [{ name: 'Austen, Jane', birth_year: 1775 }], formats: { 'text/html': 'x' } },
        { id: 'junk', title: 'Dropped' },
      ] })
    }
    return new Response('not found', { status: 404 })
  })
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('X-Reader-Source'), 'gutendex')
    const data = await res.json()
    assert.equal(data.results.length, 1)
    assert.deepEqual(data.results[0], {
      id: 1342,
      title: 'Pride and Prejudice',
      authors: [{ name: 'Austen, Jane' }],
      formats: {
        'image/jpeg': 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
        'text/plain; charset=utf-8': 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
      },
    })
    assert.equal(data.next, null)
  } finally { restore() }
})

test('a rejected OPDS fetch (timeout) also falls back to Gutendex', async () => {
  const { restore } = stubFetch((u) => {
    if (u.hostname === 'www.gutenberg.org') throw new Error('The operation was aborted due to timeout')
    return Response.json({ results: [{ id: 11, title: 'Alice', authors: [] }] })
  })
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 200)
    assert.equal((await res.json()).results[0].id, 11)
  } finally { restore() }
})

test('a later page failing still returns the earlier pages', async () => {
  const { restore } = stubFetch((u) => {
    const start = Number(u.searchParams.get('start_index'))
    return start > 26 ? new Response('gateway timeout', { status: 504 }) : opdsPage(start)
  })
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.results.length, 50)
    assert.match(data.next, /start_index=51/)
  } finally { restore() }
})

test('both sources down and no last-good copy → 504 with an empty list', async () => {
  const { restore } = stubFetch(() => new Response('down', { status: 503 }))
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 504)
    assert.deepEqual(await res.json(), { results: [] })
  } finally { restore() }
})

test('last-good copy is served stale when both live sources fail', async () => {
  const store = new Map()
  globalThis.caches = {
    default: {
      match: async (req) => { const hit = store.get(req.url); return hit ? hit.clone() : undefined },
      put: async (req, res) => { store.set(req.url, res) },
    },
  }
  const good = stubFetch((u) => opdsPage(Number(u.searchParams.get('start_index'))))
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env(), { waitUntil: () => {} })
    assert.equal(res.status, 200)
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(store.size, 1)
  } finally { good.restore() }
  const down = stubFetch(() => new Response('down', { status: 503 }))
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?sort_order=downloads'), env())
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('X-Reader-Source'), 'last-good')
    assert.equal((await res.json()).results.length, 100)
  } finally {
    down.restore()
    delete globalThis.caches
  }
})

test('a search is not replaced by the popular-books fallback', async () => {
  const { restore } = stubFetch((u) => {
    if (u.hostname === 'www.gutenberg.org') return new Response('down', { status: 503 })
    throw new Error('Gutendex must not be called for a search')
  })
  try {
    const res = await worker.fetch(request('/api/gutenberg-opds?query=dickens'), env())
    assert.equal(res.status, 504)
  } finally { restore() }
})

test('cursor requests are validated and chained as before', async () => {
  const { restore } = stubFetch((u) => opdsPage(Number(u.searchParams.get('start_index'))))
  try {
    const bad = await worker.fetch(request('/api/gutenberg-opds?cursor=' + encodeURIComponent('https://evil.example/x')), env())
    assert.equal(bad.status, 400)
    const ok = await worker.fetch(request('/api/gutenberg-opds?cursor=' + encodeURIComponent('https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads&start_index=101')), env())
    assert.equal(ok.status, 200)
    const data = await ok.json()
    assert.equal(data.results.length, 100)
    assert.equal(data.results[0].id, 101)
  } finally { restore() }
})
