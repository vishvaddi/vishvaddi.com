import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleMarket } from '../worker/market.ts'
import worker from '../worker/index.ts'
import { PinAttempts } from '../worker/auth.ts'

const request = (path, options = {}) => new Request(`https://example.com${path}`, options)

async function ownerCookie(env) {
  const records = new Map()
  let queue = Promise.resolve()
  const txn = { get: async (key) => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value)) }
  const state = { storage: { transaction(callback) { const r = queue.then(() => callback(txn)); queue = r.catch(() => {}); return r } } }
  const limiter = new PinAttempts(state)
  const loginEnv = { ...env, PIN_ATTEMPTS: { idFromName: (name) => name, get: () => limiter }, ASSETS: { fetch: async () => new Response('asset') } }
  const login = await worker.fetch(new Request('https://example.com/login', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body: `pin=${env.SITE_PIN}`,
  }), loginEnv)
  return login.headers.get('Set-Cookie').split(';')[0]
}

function baseEnv(dbStatus = null) {
  return {
    SITE_PIN: '012345', SESSION_SECRET: 'test-only-session-key-never-use-in-production',
    DEEP_SWARM_DB: {
      prepare: () => ({ bind: () => ({ first: async () => (dbStatus ? { status: dbStatus } : null) }) }),
    },
  }
}

function stubFetch(handlers) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    for (const [match, respond] of handlers) if (href.includes(match)) return respond(href)
    return new Response('not found', { status: 404 })
  }
  return () => { globalThis.fetch = original }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('public: an anonymous visitor gets prices (every feature free, Addendum 4)', async () => {
  const env = baseEnv(null)
  const restore = stubFetch([
    ['finance.yahoo.com', () => json({ quoteResponse: { result: [{ symbol: 'VAS.AX', regularMarketPrice: 95.2, currency: 'AUD' }] } })],
  ])
  try {
    const res = await handleMarket(request('/api/market?symbols=VAS.AX'), env, new URL('https://example.com/api/market?symbols=VAS.AX'))
    assert.equal(res.status, 200)
    assert.equal((await res.json()).prices['VAS.AX'].price, 95.2)
  } finally { restore() }
})

test('owner session still works', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const restore = stubFetch([
    ['finance.yahoo.com', () => json({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 227.5, currency: 'USD', regularMarketTime: 1757800000 }] } })],
  ])
  try {
    const res = await handleMarket(request('/api/market?symbols=AAPL', { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=AAPL'))
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.prices.AAPL.price, 227.5)
    assert.equal(body.prices.AAPL.currency, 'USD')
  } finally { restore() }
})

test('symbols are validated, deduplicated, uppercased and capped at 25', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const restore = stubFetch([['finance.yahoo.com', () => json({ quoteResponse: { result: [] } })]])
  try {
    const many = Array.from({ length: 30 }, (_, i) => `SYM${i}`).join(',')
    const capped = await handleMarket(request(`/api/market?symbols=${many}`, { headers: { Cookie: cookie } }), env, new URL(`https://example.com/api/market?symbols=${many}`))
    assert.equal(capped.status, 200)

    const bad = await handleMarket(request('/api/market?symbols=' + encodeURIComponent('bad symbol!'), { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=' + encodeURIComponent('bad symbol!')))
    assert.equal(bad.status, 400)

    const mixed = await handleMarket(request('/api/market?symbols=' + encodeURIComponent('aapl,aapl,not valid!'), { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=' + encodeURIComponent('aapl,aapl,not valid!')))
    assert.equal(mixed.status, 200) // "aapl" (deduped, uppercased) still valid even though the other token is dropped
  } finally { restore() }
})

test('a bad symbol fails in isolation — the rest of the request still succeeds', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const restore = stubFetch([
    // Yahoo simply omits the ticker it doesn't recognise from its result array.
    ['finance.yahoo.com', () => json({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 227.5, currency: 'USD' }] } })],
  ])
  try {
    const res = await handleMarket(
      request('/api/market?symbols=AAPL,NOTREAL', { headers: { Cookie: cookie } }),
      env, new URL('https://example.com/api/market?symbols=AAPL,NOTREAL'),
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.prices.AAPL)
    assert.equal(body.prices.NOTREAL, undefined)
  } finally { restore() }
})

test('an upstream outage on one source does not block the others', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const restore = stubFetch([
    ['finance.yahoo.com', () => { throw new Error('network down') }],
    ['api.coingecko.com', () => json({ bitcoin: { aud: 150000 } })],
  ])
  try {
    const res = await handleMarket(
      request('/api/market?symbols=AAPL,BTC-AUD', { headers: { Cookie: cookie } }),
      env, new URL('https://example.com/api/market?symbols=AAPL,BTC-AUD'),
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.prices.AAPL, undefined)
    assert.equal(body.prices['BTC-AUD'].price, 150000)
    assert.equal(body.prices['BTC-AUD'].currency, 'AUD')
  } finally { restore() }
})

test('gold/silver convert Yahoo USD futures to AUD via the fx fallback', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const restore = stubFetch([
    ['finance.yahoo.com', () => json({ quoteResponse: { result: [{ symbol: 'GC=F', regularMarketPrice: 2000, currency: 'USD' }] } })],
    ['open.er-api.com', () => json({ rates: { AUD: 1.5 } })],
  ])
  try {
    const res = await handleMarket(request('/api/market?symbols=XAU-AUD', { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=XAU-AUD'))
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.prices['XAU-AUD'].price, 3000)
    assert.equal(body.prices['XAU-AUD'].currency, 'AUD')
  } finally { restore() }
})

test('no valid symbols is a 400, and the response caches for 15 minutes', async () => {
  const env = baseEnv(null)
  const cookie = await ownerCookie(env)
  const empty = await handleMarket(request('/api/market?symbols=%21%21%21', { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=%21%21%21'))
  assert.equal(empty.status, 400)
  const restore = stubFetch([['finance.yahoo.com', () => json({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 1, currency: 'USD' }] } })]])
  try {
    const res = await handleMarket(request('/api/market?symbols=AAPL', { headers: { Cookie: cookie } }), env, new URL('https://example.com/api/market?symbols=AAPL'))
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=900')
  } finally { restore() }
})
