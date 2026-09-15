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
  const freeUses = new Map()
  const metrics = new Map() // key `${day}|${event}` -> count (migrations/0007_metrics.sql)
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
        if (sql === 'SELECT licence_hash, key_shown_at FROM pro_licences WHERE stripe_subscription = ?') {
          const row = byStripeSub(args[0]); return row ? { licence_hash: row.licence_hash, key_shown_at: row.key_shown_at ?? null } : null
        }
        if (sql === 'SELECT event_id FROM pro_events WHERE event_id = ?') {
          return events.has(args[0]) ? { event_id: args[0] } : null
        }
        if (sql === 'SELECT count, window_start FROM free_uses WHERE bucket = ?') {
          const row = freeUses.get(args[0]); return row ? { ...row } : null
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
        if (sql === 'UPDATE pro_licences SET key_shown_at = ? WHERE licence_hash = ?') {
          const row = licences.get(args[1]); if (row) row.key_shown_at = args[0]
          return { success: true, meta: { changes: row ? 1 : 0 } }
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
        if (sql === 'INSERT INTO free_uses (bucket, count, window_start) VALUES (?, ?, ?)') {
          freeUses.set(args[0], { count: args[1], window_start: args[2] })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql === 'UPDATE free_uses SET count = ?, window_start = ? WHERE bucket = ?') {
          const row = freeUses.get(args[2]); if (row) Object.assign(row, { count: args[0], window_start: args[1] })
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (sql === 'INSERT INTO metrics (day, event, count) VALUES (?, ?, 1) ON CONFLICT(day, event) DO UPDATE SET count = count + excluded.count') {
          const key = `${args[0]}|${args[1]}`
          metrics.set(key, (metrics.get(key) || 0) + 1)
          return { success: true, meta: { changes: 1 } }
        }
        throw new Error(`fakeD1: unexpected run(): ${sql}`)
      },
      async all() {
        if (sql === 'SELECT day, event, count FROM metrics WHERE day >= ? ORDER BY day ASC, event ASC') {
          const since = args[0]
          const rows = [...metrics.entries()]
            .filter(([key]) => key.split('|')[0] >= since)
            .map(([key, count]) => { const [day, event] = key.split('|'); return { day, event, count } })
            .sort((a, b) => (a.day === b.day ? a.event.localeCompare(b.event) : a.day.localeCompare(b.day)))
          return { results: rows, success: true }
        }
        throw new Error(`fakeD1: unexpected all(): ${sql}`)
      },
    }),
  })
  return { prepare, store, licences, events, freeUses, metrics }
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
    SITE_LOCKED: '1', SITE_PIN: '012345', SESSION_SECRET: 'test-only-session-key-never-use-in-production',
    // Tightened Addendum 3 (docs/PRO_PLAN.md) — matches wrangler.jsonc's FREE_USES.
    FREE_USES: '1',
    PIN_ATTEMPTS: { idFromName: (name) => name, get: () => limiter },
    ASSETS: { fetch: async () => { assetHits++; return new Response('asset') } },
    DEEP_SWARM_DB: db,
  }
  return { env, db, assetHits: () => assetHits }
}

const today = () => new Date().toISOString().slice(0, 10)

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
const useRequest = (feature, headers = {}) => jsonPost('/api/pro/use', { feature }, headers)

function extractAnonCookie(response) {
  const raw = response.headers.get('Set-Cookie') || ''
  const match = raw.match(/__Host-anon=([^;,]+)/)
  return match ? `__Host-anon=${match[1]}` : null
}

// Mirrors worker/pro.ts's hmacBase64Url (same keyFor formula) so tests can
// seed/derive the IP bucket key without exercising the handler first.
async function hmacBase64Url(env, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${env.SESSION_SECRET}:${env.SITE_PIN}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return base64Url(new Uint8Array(signature))
}

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
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), env)).json(), { pro: false, source: null, configured: false, freeRemaining: 1, freeLimit: 1 })

  const configuredEnv = { ...env, ...CONFIGURED }
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), configuredEnv)).json(), { pro: false, source: null, configured: true, freeRemaining: 1, freeLimit: 1 })

  const sessionCookie = await login(configuredEnv)
  const ownerStatus = await worker.fetch(request('/api/pro/status', { headers: { Cookie: sessionCookie } }), configuredEnv)
  assert.deepEqual(await ownerStatus.json(), { pro: true, source: 'owner', configured: true, freeRemaining: null, freeLimit: 1 })

  const rawKey = 'VV-DDDD-EEEE-FFFF'
  const hash = await sha256(rawKey)
  seedLicence(db, { hash, subscription: 'sub_2', plan: 'month', status: 'past_due', periodEnd: 1888888888 })
  const restored = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '198.51.100.1' }), configuredEnv)
  const proCookie = restored.headers.get('Set-Cookie').split(';')[0]
  const licenceStatus = await worker.fetch(request('/api/pro/status', { headers: { Cookie: proCookie } }), configuredEnv)
  assert.deepEqual(await licenceStatus.json(), { pro: true, source: 'licence', plan: 'month', periodEnd: 1888888888, configured: true, freeRemaining: null, freeLimit: 1 })
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
  const { env, db } = setup()
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
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1)

    const second = await worker.fetch(request('/pay/success?session_id=cs_test_1'), configuredEnv)
    const html2 = await second.text()
    assert.doesNotMatch(html2, /VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)
    assert.match(html2, /already/i)
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1) // unchanged — no new key issued on the revisit
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
  assert.equal(db.metrics.get(`${today()}|restore_ok`), 1)

  const results = await Promise.all(Array.from({ length: 12 }, () =>
    worker.fetch(jsonPost('/api/pro/restore', { key: 'VV-WRONG-0000-0000' }, { 'CF-Connecting-IP': '203.0.113.2' }), env)))
  assert.equal(results.filter((r) => r.status === 401).length, 5)
  assert.equal(results.filter((r) => r.status === 429).length, 7)
  assert.equal(db.metrics.get(`${today()}|restore_ok`), 1) // failed attempts never bump it
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

test('free quota: one use allowed, the second is blocked, freeLimit is reported, and owner/Pro bypass entirely', async () => {
  const { env, db } = setup()

  const first = await worker.fetch(useRequest('pdf-export'), env)
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { allowed: true, remaining: 0, freeLimit: 1 })
  const cookie = extractAnonCookie(first)
  assert.ok(cookie)

  const second = await worker.fetch(useRequest('pdf-export', { Cookie: cookie }), env)
  assert.equal(second.status, 402)
  const secondBody = await second.json()
  assert.equal(secondBody.allowed, false)
  assert.equal(secondBody.remaining, 0)
  assert.equal(secondBody.freeLimit, 1)
  assert.ok(secondBody.resetsAt > Math.floor(Date.now() / 1000))

  const sessionCookie = await login(env)
  assert.deepEqual(await (await worker.fetch(useRequest('pdf-export', { Cookie: sessionCookie }), env)).json(), { allowed: true, pro: true, freeLimit: 1 })

  const rawKey = 'VV-FREE-0001-0002'
  const hash = await sha256(rawKey)
  seedLicence(db, { hash, subscription: 'sub_free_1', plan: 'year', status: 'active' })
  const restored = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '203.0.113.9' }), env)
  const proCookie = restored.headers.get('Set-Cookie').split(';')[0]
  assert.deepEqual(await (await worker.fetch(useRequest('pdf-export', { Cookie: proCookie }), env)).json(), { allowed: true, pro: true, freeLimit: 1 })
})

test('free quota: the IP bucket blocks a fresh anon cookie once the IP itself is exhausted', async () => {
  const { env } = setup()
  const ip = '198.51.100.77'
  const first = await worker.fetch(useRequest('pdf-export', { 'CF-Connecting-IP': ip }), env)
  assert.equal(first.status, 200) // no Cookie, so this is a genuinely fresh anon id sharing the IP

  const blocked = await worker.fetch(useRequest('pdf-export', { 'CF-Connecting-IP': ip }), env)
  assert.equal(blocked.status, 402)
  assert.deepEqual((await blocked.json()).allowed, false)
})

test('free quota: a window older than 30 days resets the bucket instead of blocking it', async () => {
  const { env, db } = setup()
  const ip = '203.0.113.44'
  const bucket = `ip:${await hmacBase64Url(env, ip)}`
  db.freeUses.set(bucket, { count: 5, window_start: Date.now() - 31 * 24 * 3600 * 1000 })

  const res = await worker.fetch(useRequest('pdf-export', { 'CF-Connecting-IP': ip }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { allowed: true, remaining: 0, freeLimit: 1 })
  assert.equal(db.freeUses.get(bucket).count, 1)
})

test('free quota: a cookie with a bad signature is ignored and replaced', async () => {
  const { env } = setup()
  const forgedId = base64Url(crypto.getRandomValues(new Uint8Array(16)))
  const forged = `__Host-anon=${forgedId}.${'A'.repeat(43)}`

  const res = await worker.fetch(useRequest('pdf-export', { Cookie: forged }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { allowed: true, remaining: 0, freeLimit: 1 })
  const setCookie = res.headers.get('Set-Cookie') || ''
  assert.match(setCookie, /__Host-anon=/)
  assert.ok(!setCookie.includes(forgedId)) // the forged id is discarded, not reused
})

test('metric: whitelist enforced, same-origin required (Origin or Sec-Fetch-Site), owner GET reads rows, anon GET is 401', async () => {
  const { env, db } = setup()

  const rejected = await worker.fetch(new Request('https://example.com/api/metric', {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'upsell_shown' }),
  }), env)
  assert.equal(rejected.status, 403)
  assert.equal(db.metrics.size, 0)

  const unknown = await worker.fetch(new Request('https://example.com/api/metric', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'not-a-real-event' }),
  }), env)
  assert.equal(unknown.status, 204)
  assert.equal(db.metrics.size, 0) // whitelisted-only — no row for an unknown event

  const known = await worker.fetch(new Request('https://example.com/api/metric', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'nudge_shown' }),
  }), env)
  assert.equal(known.status, 204)
  assert.equal(db.metrics.get(`${today()}|nudge_shown`), 1)

  // sendBeacon carries no custom headers on some paths — Sec-Fetch-Site (browser-set,
  // never page script) is the fallback same-origin signal; body here is form-style text.
  const viaSecFetch = await worker.fetch(new Request('https://example.com/api/metric', {
    method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' }, body: 'event=nudge_click',
  }), env)
  assert.equal(viaSecFetch.status, 204)
  assert.equal(db.metrics.get(`${today()}|nudge_click`), 1)

  assert.equal((await worker.fetch(new Request('https://example.com/api/metric?days=30'), env)).status, 401)

  const sessionCookie = await login(env)
  const ownerGet = await worker.fetch(new Request('https://example.com/api/metric?days=30', { headers: { Cookie: sessionCookie } }), env)
  assert.equal(ownerGet.status, 200)
  const rows = (await ownerGet.json()).sort((a, b) => a.event.localeCompare(b.event))
  assert.deepEqual(rows, [
    { day: today(), event: 'nudge_click', count: 1 },
    { day: today(), event: 'nudge_shown', count: 1 },
  ])
})

test('/pay/success after the webhook already minted the key shows that key once, from Stripe customer metadata', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const originalFetch = globalThis.fetch
  let storedKey = null
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url)
    if (href.startsWith('https://api.stripe.com/v1/customers/cus_9')) {
      if ((init.method || 'GET') === 'POST') { storedKey = new URLSearchParams(String(init.body)).get('metadata[licence_key]'); return new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 }) }
      return new Response(JSON.stringify({ id: 'cus_9', metadata: storedKey ? { licence_key: storedKey } : {} }), { status: 200 })
    }
    if (href.startsWith('https://api.stripe.com/v1/checkout/sessions/cs_test_9')) {
      return new Response(JSON.stringify({
        payment_status: 'paid',
        customer: { id: 'cus_9', email: 'race@example.com' },
        subscription: { id: 'sub_9', status: 'active', current_period_end: 1999999999, items: { data: [{ price: { id: CONFIGURED.STRIPE_PRICE_YEAR } }] } },
      }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${href}`)
  }
  try {
    const payload = JSON.stringify({ id: 'evt_race', type: 'checkout.session.completed', data: { object: { id: 'cs_test_9', subscription: 'sub_9', customer: 'cus_9', metadata: { plan: 'year' }, customer_details: { email: 'race@example.com' } } } })
    const header = await stripeSignature(CONFIGURED.STRIPE_WEBHOOK_SECRET, payload)
    const hook = await worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': header }, body: payload }), configuredEnv)
    assert.equal(hook.status, 200)
    assert.ok(storedKey, 'webhook wrote the key to the customer')
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1, 'webhook counted the sale')

    const first = await worker.fetch(request('/pay/success?session_id=cs_test_9'), configuredEnv)
    const html = await first.text()
    assert.match(html, new RegExp(storedKey), 'success page shows the webhook-minted key')
    assert.match(first.headers.get('Set-Cookie') || '', /__Host-pro=/)
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1, 'not counted twice')

    const second = await worker.fetch(request('/pay/success?session_id=cs_test_9'), configuredEnv)
    const html2 = await second.text()
    assert.doesNotMatch(html2, /VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)
    assert.match(html2, /shown once already/)
    assert.doesNotMatch(html2, /check your email/)
  } finally { globalThis.fetch = originalFetch }
})
