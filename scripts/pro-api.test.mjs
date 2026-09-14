import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { PinAttempts, base64Url } from '../worker/auth.ts'

// In-memory stand-in for the three D1 tables the Pro routes and the
// personal-tool sync route touch — see migrations/0003_site_store.sql and
// migrations/0004_pro.sql. Matched by exact SQL text, mirroring the
// prefix-matched fakeD1 in scripts/store-api.test.mjs.
function fakeD1() {
  const store = new Map()
  const licences = new Map()
  const events = new Map()
  const byStripeSub = (sub) => [...licences.values()].find((row) => row.stripe_subscription === sub)

  const prepare = (sql) => ({
    bind: (...args) => ({
      async first() {
        if (sql === 'SELECT revision, json, updated_at FROM site_store WHERE key = ?') {
          const row = store.get(args[0]); return row ? { ...row } : null
        }
        if (sql === 'SELECT status FROM pro_licences WHERE licence_hash = ?') {
          const row = licences.get(args[0]); return row ? { status: row.status } : null
        }
        if (sql === 'SELECT plan, status, current_period_end, last_seen FROM pro_licences WHERE licence_hash = ?') {
          const row = licences.get(args[0])
          return row ? { plan: row.plan, status: row.status, current_period_end: row.current_period_end, last_seen: row.last_seen } : null
        }
        if (sql === 'SELECT plan, status FROM pro_licences WHERE licence_hash = ?') {
          const row = licences.get(args[0]); return row ? { plan: row.plan, status: row.status } : null
        }
        if (sql === 'SELECT licence_hash FROM pro_licences WHERE stripe_subscription = ?') {
          const row = byStripeSub(args[0]); return row ? { licence_hash: row.licence_hash } : null
        }
        if (sql === 'SELECT event_id FROM pro_events WHERE event_id = ?') {
          return events.has(args[0]) ? { event_id: args[0] } : null
        }
        throw new Error(`fakeD1: unexpected first(): ${sql}`)
      },
      async run() {
        if (/^INSERT INTO site_store/.test(sql)) {
          store.set(args[0], { revision: 1, json: args[1], updated_at: args[2] })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE site_store/.test(sql)) {
          const row = store.get(args[3])
          if (!row || row.revision !== args[4]) return { success: true, meta: { changes: 0 } }
          store.set(args[3], { revision: args[0], json: args[1], updated_at: args[2] })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM site_store/.test(sql)) {
          store.delete(args[0]); return { success: true, meta: { changes: 1 } }
        }
        if (sql.startsWith('INSERT INTO pro_licences') && args.length === 9) {
          const [licence_hash, stripe_customer, stripe_subscription, plan, status, current_period_end, email, created_at, updated_at] = args
          licences.set(licence_hash, { licence_hash, stripe_customer, stripe_subscription, plan, status, current_period_end, email, created_at, updated_at, last_seen: null })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.startsWith('INSERT INTO pro_licences')) {
          const [licence_hash, stripe_customer, stripe_subscription, plan, email, created_at, updated_at] = args
          licences.set(licence_hash, { licence_hash, stripe_customer, stripe_subscription, plan, status: 'active', current_period_end: null, email, created_at, updated_at, last_seen: null })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.startsWith('INSERT INTO pro_events')) {
          events.set(args[0], { event_id: args[0], received_at: args[1] })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql === 'UPDATE pro_licences SET last_seen = ? WHERE licence_hash = ?') {
          const row = licences.get(args[1]); if (row) row.last_seen = args[0]
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === 'UPDATE pro_licences SET status = ?, plan = ?, current_period_end = ?, updated_at = ? WHERE licence_hash = ?') {
          const row = licences.get(args[4])
          if (row) Object.assign(row, { status: args[0], plan: args[1], current_period_end: args[2], updated_at: args[3] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === "UPDATE pro_licences SET status = 'active', updated_at = ? WHERE licence_hash = ?") {
          const row = licences.get(args[1]); if (row) Object.assign(row, { status: 'active', updated_at: args[0] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === 'UPDATE pro_licences SET status = ?, plan = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription = ?') {
          const row = byStripeSub(args[4])
          if (row) Object.assign(row, { status: args[0], plan: args[1], current_period_end: args[2], updated_at: args[3] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === 'UPDATE pro_licences SET status = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription = ?') {
          const row = byStripeSub(args[3])
          if (row) Object.assign(row, { status: args[0], current_period_end: args[1], updated_at: args[2] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === "UPDATE pro_licences SET status = 'cancelled', updated_at = ? WHERE stripe_subscription = ?") {
          const row = byStripeSub(args[1]); if (row) Object.assign(row, { status: 'cancelled', updated_at: args[0] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === "UPDATE pro_licences SET status = 'past_due', updated_at = ? WHERE stripe_subscription = ?") {
          const row = byStripeSub(args[1]); if (row) Object.assign(row, { status: 'past_due', updated_at: args[0] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        throw new Error(`fakeD1: unexpected run(): ${sql}`)
      },
    }),
  })
  return { prepare, store, licences, events }
}

function setup() {
  const records = new Map()
  let queue = Promise.resolve()
  const txn = { get: async (key) => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value)) }
  const state = { storage: { transaction(callback) { const r = queue.then(() => callback(txn)); queue = r.catch(() => {}); return r } } }
  const limiter = new PinAttempts(state)
  const db = fakeD1()
  let assetHits = 0
  const env = {
    SITE_PIN: '012345', SESSION_SECRET: 'test-only-session-key-never-use-in-production',
    PIN_ATTEMPTS: { idFromName: (name) => name, get: () => limiter },
    ASSETS: { fetch: async () => { assetHits++; return new Response('asset') } },
    DEEP_SWARM_DB: db,
  }
  return { env, db, assetHits: () => assetHits }
}

const CONFIGURED = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
  STRIPE_PRICE_YEAR: 'price_year_1',
  STRIPE_PRICE_MONTH: 'price_month_1',
}

const request = (path, options = {}) => new Request(`https://example.com${path}`, options)
const jsonPost = (path, body, headers = {}) => new Request(`https://example.com${path}`, {
  method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
})

async function login(env) {
  const res = await worker.fetch(new Request('https://example.com/login', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body: 'pin=012345',
  }), env)
  return res.headers.get('Set-Cookie').split(';')[0]
}

async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function stripeSignature(secret, payload, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `t=${t},v1=${hex}`
}

function seedLicence(db, { hash, subscription = 'sub_1', customer = 'cus_1', plan = 'year', status = 'active', periodEnd = 1999999999 }) {
  db.licences.set(hash, {
    licence_hash: hash, stripe_customer: customer, stripe_subscription: subscription, plan, status,
    current_period_end: periodEnd, email: null, created_at: Date.now(), updated_at: Date.now(), last_seen: null,
  })
}

test('PUBLIC_PATHS: /site/ falls through without a session, /kitchen/ and /api/store/ stay gated', async () => {
  const { env, assetHits } = setup()
  const site = await worker.fetch(request('/site/'), env)
  assert.equal(site.status, 200)
  assert.equal(assetHits(), 1)
  assert.equal((await worker.fetch(request('/kitchen/'), env)).status, 401)
  assert.equal((await worker.fetch(request('/api/store/x'), env)).status, 401)
})

test('status: unconfigured/configured, owner, and Pro licence', async () => {
  const { env, db } = setup()
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), env)).json(), { pro: false, source: null, configured: false })

  const configuredEnv = { ...env, ...CONFIGURED }
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), configuredEnv)).json(), { pro: false, source: null, configured: true })

  const sessionCookie = await login(configuredEnv)
  const ownerStatus = await worker.fetch(request('/api/pro/status', { headers: { Cookie: sessionCookie } }), configuredEnv)
  assert.deepEqual(await ownerStatus.json(), { pro: true, source: 'owner', configured: true })

  const rawKey = 'VV-DDDD-EEEE-FFFF'
  const hash = await sha256(rawKey)
  seedLicence(db, { hash, subscription: 'sub_2', plan: 'month', status: 'past_due', periodEnd: 1888888888 })
  const restored = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '198.51.100.1' }), configuredEnv)
  const proCookie = restored.headers.get('Set-Cookie').split(';')[0]
  const licenceStatus = await worker.fetch(request('/api/pro/status', { headers: { Cookie: proCookie } }), configuredEnv)
  assert.deepEqual(await licenceStatus.json(), { pro: true, source: 'licence', plan: 'month', periodEnd: 1888888888, configured: true })
})

test('checkout: 503 unconfigured, 400 bad plan, 403 bad origin, 200 with a session url when configured', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'year' }), env)).status, 503)

  const configuredEnv = { ...env, ...CONFIGURED }
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'week' }), configuredEnv)).status, 400)
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'year' }, { Origin: 'https://evil.example' }), configuredEnv)).status, 403)

  const originalFetch = globalThis.fetch
  let capturedUrl, capturedBody
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url); capturedBody = init.body
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_123' }), { status: 200 })
  }
  try {
    const ok = await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'year' }), configuredEnv)
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { url: 'https://checkout.stripe.com/pay/cs_test_123' })
    assert.equal(capturedUrl, 'https://api.stripe.com/v1/checkout/sessions')
    assert.match(capturedBody, /line_items%5B0%5D%5Bprice%5D=price_year_1/)
    assert.match(capturedBody, /success_url=.*pay%2Fsuccess/)
  } finally { globalThis.fetch = originalFetch }
})

test('/pay/success issues a licence key once, sets both cookies, and re-visits show "already issued"', async () => {
  const { env } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.startsWith('https://api.stripe.com/v1/checkout/sessions/cs_test_1')) {
      return new Response(JSON.stringify({
        payment_status: 'paid',
        customer: { id: 'cus_3', email: 'vish@example.com' },
        subscription: { id: 'sub_3', status: 'active', current_period_end: 1999999999, items: { data: [{ price: { id: CONFIGURED.STRIPE_PRICE_YEAR } }] } },
      }), { status: 200 })
    }
    if (href.startsWith('https://api.stripe.com/v1/customers/cus_3')) return new Response(JSON.stringify({ id: 'cus_3' }), { status: 200 })
    throw new Error(`unexpected fetch: ${href}`)
  }
  try {
    const first = await worker.fetch(request('/pay/success?session_id=cs_test_1'), configuredEnv)
    assert.equal(first.status, 200)
    const html = await first.text()
    assert.match(html, /VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)
    const setCookie = first.headers.get('Set-Cookie') || ''
    assert.match(setCookie, /__Host-pro=/)
    assert.match(setCookie, /vv_pro=1/)

    const second = await worker.fetch(request('/pay/success?session_id=cs_test_1'), configuredEnv)
    const html2 = await second.text()
    assert.doesNotMatch(html2, /VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)
    assert.match(html2, /already/i)
  } finally { globalThis.fetch = originalFetch }
})

test('/pay/success shows "payment not completed" for an unpaid or unknown session', async () => {
  const { env } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payment_status: 'unpaid', subscription: null }), { status: 200 })
  try {
    const response = await worker.fetch(request('/pay/success?session_id=cs_test_2'), configuredEnv)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /not completed/i)
    assert.equal(response.headers.get('Set-Cookie'), null)
  } finally { globalThis.fetch = originalFetch }
})

test('restore: succeeds for an active licence, rejects unknown keys, and rate-limits after five per IP', async () => {
  const { env, db } = setup()
  const rawKey = 'VV-TEST-0001-0001'
  const hash = await sha256(rawKey)
  seedLicence(db, { hash, subscription: 'sub_4', plan: 'year', status: 'active' })

  const ok = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '203.0.113.1' }), env)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, plan: 'year' })

  const results = await Promise.all(Array.from({ length: 12 }, () =>
    worker.fetch(jsonPost('/api/pro/restore', { key: 'VV-WRONG-0000-0000' }, { 'CF-Connecting-IP': '203.0.113.2' }), env)))
  assert.equal(results.filter((r) => r.status === 401).length, 5)
  assert.equal(results.filter((r) => r.status === 429).length, 7)
})

test('logout clears both Pro cookies', async () => {
  const { env } = setup()
  const response = await worker.fetch(new Request('https://example.com/api/pro/logout', { method: 'POST', headers: { Origin: 'https://example.com' } }), env)
  assert.equal(response.status, 204)
  assert.match(response.headers.get('Set-Cookie'), /__Host-pro=;.*Max-Age=0/)
  assert.match(response.headers.get('Set-Cookie'), /vv_pro=;.*Max-Age=0/)
})

test('webhook: rejects a bad or stale signature, applies a handled event once, and ignores a replay', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const secret = CONFIGURED.STRIPE_WEBHOOK_SECRET
  const hash = 'lic5hash'
  seedLicence(db, { hash, subscription: 'sub_5', status: 'active' })
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_5' } } })

  const badSig = await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=deadbeef' }, body: payload }), configuredEnv)
  assert.equal(badSig.status, 400)

  const staleHeader = await stripeSignature(secret, payload, Math.floor(Date.now() / 1000) - 400)
  const stale = await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': staleHeader }, body: payload }), configuredEnv)
  assert.equal(stale.status, 400)

  const goodHeader = await stripeSignature(secret, payload)
  const accepted = await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': goodHeader }, body: payload }), configuredEnv)
  assert.equal(accepted.status, 200)
  assert.equal(db.licences.get(hash).status, 'cancelled')

  db.licences.get(hash).status = 'active' // prove the replay below is a genuine no-op, not a coincidence
  const replay = await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': goodHeader }, body: payload }), configuredEnv)
  assert.equal(replay.status, 200)
  assert.equal(db.licences.get(hash).status, 'active')

  const failedPayload = JSON.stringify({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_5' } } })
  const failedHeader = await stripeSignature(secret, failedPayload)
  await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': failedHeader }, body: failedPayload }), configuredEnv)
  assert.equal(db.licences.get(hash).status, 'past_due')
})

test('/api/store/<key>: owner keeps a plain key, a Pro cookie gets a namespaced key, and DELETE only touches its own row', async () => {
  const { env, db } = setup()
  const rawKey = 'VV-AAAA-BBBB-CCCC'
  const hash = await sha256(rawKey)
  seedLicence(db, { hash, subscription: 'sub_6', plan: 'year', status: 'active' })
  const restored = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '192.0.2.50' }), env)
  const proCookie = restored.headers.get('Set-Cookie').split(';')[0]

  const put = await worker.fetch(new Request('https://example.com/api/store/cutlist', {
    method: 'PUT', headers: { Origin: 'https://example.com', Cookie: proCookie }, body: JSON.stringify({ revision: 0, doc: { version: 1, data: { a: 1 } } }),
  }), env)
  assert.equal(put.status, 201)
  assert.ok(db.store.has(`pro:${hash}:cutlist`))
  assert.ok(!db.store.has('cutlist'))

  const sessionCookie = await login(env)
  const ownerPut = await worker.fetch(new Request('https://example.com/api/store/cutlist', {
    method: 'PUT', headers: { Origin: 'https://example.com', Cookie: sessionCookie }, body: JSON.stringify({ revision: 0, doc: { version: 1, data: { a: 2 } } }),
  }), env)
  assert.equal(ownerPut.status, 201)
  assert.ok(db.store.has('cutlist'))

  const proDelete = await worker.fetch(new Request('https://example.com/api/store/cutlist', { method: 'DELETE', headers: { Origin: 'https://example.com', Cookie: proCookie } }), env)
  assert.equal(proDelete.status, 204)
  assert.ok(!db.store.has(`pro:${hash}:cutlist`))
  assert.ok(db.store.has('cutlist')) // the owner's own row is untouched by the Pro customer's delete
})
