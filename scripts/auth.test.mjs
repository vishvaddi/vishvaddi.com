import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import worker from '../worker/index.ts'
import { PinAttempts, pinGate } from '../worker/auth.ts'

function setup() {
  const records = new Map()
  let queue = Promise.resolve()
  const txn = { get: async (key) => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value)) }
  const state = { storage: { transaction(callback) {
    const result = queue.then(() => callback(txn))
    queue = result.catch(() => {})
    return result
  } } }
  const limiter = new PinAttempts(state)
  let assets = 0
  const env = {
    // Test-only credentials; production has no defaults.
    SITE_PIN: '012345', SESSION_SECRET: 'test-only-session-key-never-use-in-production',
    PIN_ATTEMPTS: { idFromName: (name) => name, get: () => limiter },
    ASSETS: { fetch: async () => { assets++; return new Response('private asset', { headers: { 'Cache-Control': 'public, max-age=31536000' } }) } },
  }
  return { env, records, state, assets: () => assets }
}

const request = (path = '/', options = {}) => new Request(`https://example.com${path}`, options)
const login = (pin = '012345', headers = {}) => request('/login', {
  method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: `pin=${pin}`,
})
const tokenFrom = (response) => response.headers.get('Set-Cookie').split(';')[0]

test('all content stays closed without a session, including APIs and alternate hostnames', async () => {
  const { env, assets } = setup()
  for (const path of ['/', '/site/', '/_astro/app.js', '/api/deep-swarm/account', '/fonts/font.woff2', '/games/deep-swarm/', '/%6cogin', '//login', '/login/']) {
    assert.equal((await worker.fetch(request(path), env)).status, 401, path)
  }
  assert.equal((await worker.fetch(new Request('https://alternate.workers.dev/site/'), env)).status, 401)
  assert.equal((await worker.fetch(request('/', { headers: { 'Sec-Fetch-Dest': 'document' } }), env)).headers.get('Location'), '/login')
  assert.equal(assets(), 0)
})

test('configuration and limiter failures fail closed', async () => {
  const { env, assets } = setup()
  for (const missing of ['SITE_PIN', 'SESSION_SECRET', 'PIN_ATTEMPTS']) {
    assert.equal((await worker.fetch(request('/'), { ...env, [missing]: undefined })).status, 503)
  }
  env.PIN_ATTEMPTS.get = () => ({ fetch: async () => { throw Error('offline') } })
  assert.equal((await worker.fetch(login(), env)).status, 503)
  env.PIN_ATTEMPTS.get = () => ({ fetch: async () => new Response(null, { status: 500 }) })
  assert.equal((await worker.fetch(login(), env)).status, 503)
  assert.equal(assets(), 0)
})

test('PIN login supports leading zeroes and issues a signed secure seven-day cookie', async () => {
  const { env, assets } = setup()
  const response = await worker.fetch(login(), env)
  assert.equal(response.status, 303)
  assert.match(response.headers.get('Set-Cookie'), /__Host-site-session=.*; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict/)
  const unlocked = await worker.fetch(request('/site/', { headers: { Cookie: tokenFrom(response) } }), env)
  assert.equal(await unlocked.text(), 'private asset')
  assert.equal(unlocked.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(unlocked.headers.get('CDN-Cache-Control'), 'no-store')
  assert.equal(assets(), 1)
})

test('invalid PINs, cross-origin forms and oversized streamed bodies cannot log in', async () => {
  const { env } = setup()
  for (const pin of ['999999', '12345', '1234567', 'abcdef', '012345&pin=012345']) {
    assert.equal((await worker.fetch(login(pin), env)).status, 401)
  }
  assert.equal((await worker.fetch(login('012345', { Origin: 'https://evil.example' }), env)).status, 403)
  assert.equal((await worker.fetch(login('012345', { 'Content-Type': 'application/json' }), env)).status, 415)
  const fresh = setup()
  assert.equal((await worker.fetch(login('1'.repeat(129)), fresh.env)).status, 413)
  assert.equal((await worker.fetch(new Request('http://example.com/login'), env)).status, 400)
})

test('forged, expired, rotated and malformed sessions are rejected', async () => {
  const { env } = setup()
  const signedIn = tokenFrom(await worker.fetch(login(), env))
  assert.equal((await pinGate(request('/', { headers: { Cookie: signedIn + 'x' } }), env)).status, 401)
  const pieces = signedIn.split('.')
  pieces[1] = 'A'.repeat(22)
  assert.equal((await pinGate(request('/', { headers: { Cookie: pieces.join('.') } }), env)).status, 401)
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 604801000
    assert.equal((await pinGate(request('/', { headers: { Cookie: signedIn } }), env)).status, 401)
  } finally { Date.now = realNow }
  assert.equal((await pinGate(request('/', { headers: { Cookie: signedIn } }), { ...env, SITE_PIN: '654321' })).status, 401)
  assert.equal((await pinGate(request('/', { headers: { Cookie: signedIn } }), { ...env, SESSION_SECRET: 'another-test-only-session-key-never-use' })).status, 401)
})

test('per-IP limit survives reconstruction, concurrent guesses and rolling-window expiry', async () => {
  const { env, state, records } = setup()
  const results = await Promise.all(Array.from({ length: 12 }, () => worker.fetch(login('999999'), env)))
  assert.equal(results.filter((res) => res.status === 401).length, 5)
  assert.equal(results.filter((res) => res.status === 429).length, 7)
  assert.ok(Number(results.find((res) => res.status === 429).headers.get('Retry-After')) > 0)
  const restored = new PinAttempts(state)
  env.PIN_ATTEMPTS.get = () => restored
  assert.equal((await worker.fetch(login(), env)).status, 429)
  for (const entry of records.get('attempts')) entry.at -= 900001
  assert.equal((await worker.fetch(login(), env)).status, 303)
})

test('global cap blocks distributed guesses and later releases the slot', async () => {
  const { env, records } = setup()
  for (let index = 0; index < 20; index++) {
    assert.equal((await worker.fetch(login('999999', { 'CF-Connecting-IP': `192.0.2.${index}` }), env)).status, 401)
  }
  assert.equal((await worker.fetch(login('012345', { 'CF-Connecting-IP': '192.0.2.99' }), env)).status, 429)
  for (const entry of records.get('attempts')) entry.at -= 3600001
  assert.equal((await worker.fetch(login(), env)).status, 303)
})

test('logout needs a same-origin POST and clears the cookie without deleting saved data', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(request('/logout'), env)).headers.get('Set-Cookie'), null)
  assert.equal((await worker.fetch(request('/logout', { method: 'POST' }), env)).status, 403)
  const response = await worker.fetch(request('/logout', { method: 'POST', headers: { Origin: 'https://example.com' } }), env)
  assert.equal(response.status, 303)
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/)
  assert.equal(response.headers.get('Clear-Site-Data'), '"cache"')
})

test('login is self-contained, uncached and never includes credentials', async () => {
  const { env } = setup()
  const response = await worker.fetch(request('/login'), env)
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /inputmode="numeric"/)
  assert.doesNotMatch(html, new RegExp(`${env.SITE_PIN}|${env.SESSION_SECRET}`))
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})

test('retirement worker is public and removes only old content caches', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(request('/sw.js'), { ...env, SITE_PIN: undefined })).status, 200)
  const events = {}
  const deleted = []
  const actions = []
  const code = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, {
    self: {
      addEventListener: (name, callback) => { events[name] = callback },
      skipWaiting: () => actions.push('skip'),
      registration: { unregister: async () => actions.push('unregister') },
      clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://example.com/site/', navigate: async () => actions.push('navigate') }] },
    },
    caches: { keys: async () => ['workbox-precache-v2', 'books', 'gutendex', 'user-work'], delete: async (name) => deleted.push(name) },
  })
  events.install()
  let pending = Promise.resolve()
  events.activate({ waitUntil: (promise) => { pending = promise } })
  await pending
  assert.deepEqual(deleted, ['workbox-precache-v2', 'books', 'gutendex'])
  assert.deepEqual(actions, ['skip', 'unregister', 'navigate'])
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  assert.match(config, /"run_worker_first": true/)
  const chrome = await readFile(new URL('../public/scripts/chrome.js', import.meta.url), 'utf8')
  assert.doesNotMatch(chrome, /serviceWorker\.register\(/)
})
