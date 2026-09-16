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
  const metrics = new Map() // key `${day}|${event}` -> count (migrations/0007_metrics.sql)
  const byStripeSub = (sub) => [...licences.values()].find((row) => row.stripe_subscription === sub)
  // Simulates the webhook and /pay/success racing: the next pass-row lookup
  // misses even though the other path's row is already there.
  const race = { hideNextPassLookup: false }

  const prepare = (sql) => ({
    bind: (...args) => ({
      async first() {
        if (sql === 'SELECT revision, json, updated_at FROM site_store WHERE key = ?') {
          const row = store.get(args[0]); return row ? { ...row } : null
        }
        if (sql === 'SELECT plan, status, current_period_end, last_seen FROM pro_licences WHERE licence_hash = ?') {
          const row = licences.get(args[0])
          return row ? { plan: row.plan, status: row.status, current_period_end: row.current_period_end, last_seen: row.last_seen } : null
        }
        if (sql === 'SELECT plan, status, current_period_end FROM pro_licences WHERE licence_hash = ?') {
          const row = licences.get(args[0]); return row ? { plan: row.plan, status: row.status, current_period_end: row.current_period_end } : null
        }
        if (sql === 'SELECT licence_hash, plan, status, current_period_end, key_shown_at FROM pro_licences WHERE stripe_subscription = ?') {
          if (race.hideNextPassLookup) { race.hideNextPassLookup = false; return null }
          const row = byStripeSub(args[0])
          return row ? { licence_hash: row.licence_hash, plan: row.plan, status: row.status, current_period_end: row.current_period_end, key_shown_at: row.key_shown_at ?? null } : null
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
          if (byStripeSub(stripe_subscription)) throw new Error('D1_ERROR: UNIQUE constraint failed: pro_licences.stripe_subscription')
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
  return { prepare, store, licences, events, metrics, race }
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
  STRIPE_PRICE_PASS: 'price_pass_1',
}

const request = (path, options = {}) => new Request(`https://example.com${path}`, options)
const jsonPost = (path, body, headers = {}) => new Request(`https://example.com${path}`, {
  method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
})
const nowSec = () => Math.floor(Date.now() / 1000)
const WEEK_S = 7 * 24 * 3600
const KEY_RE = /VV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/
const auDate = (unixSeconds) => new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeZone: 'Australia/Sydney' }).format(new Date(unixSeconds * 1000))

function cookieMaxAge(response, name) {
  const match = (response.headers.get('Set-Cookie') || '').match(new RegExp(`${name}=[^;]*;[^,]*?Max-Age=(\\d+)`))
  return match ? Number(match[1]) : null
}

function signedProExpiry(response) {
  const match = (response.headers.get('Set-Cookie') || '').match(/__Host-pro=[A-Za-z0-9_-]{43}\.(\d+)\./)
  return match ? Number(match[1]) : null
}

// A pass Checkout Session as Stripe returns it: the webhook payload carries the
// customer as an id, a retrieve with expand[]=customer carries the object.
function passSession({ id = 'cs_pass_1', customer = 'cus_pass_1', created = nowSec() - 60, paymentStatus = 'paid', plan = 'pass', expanded = false } = {}) {
  return {
    id, object: 'checkout.session', mode: 'payment', created, payment_status: paymentStatus, subscription: null,
    customer: expanded ? { id: customer, email: 'pass@example.com' } : customer,
    customer_details: { email: 'pass@example.com' },
    metadata: plan == null ? {} : { plan },
  }
}

// Stub Stripe for the pass flow: session retrieve + customer metadata read/write.
function stubStripeForPass(session) {
  const state = { storedKey: null, metadataWrites: 0 }
  const customerId = session.customer
  const fetch = async (url, init = {}) => {
    const href = String(url)
    if (href.startsWith(`https://api.stripe.com/v1/customers/${customerId}`)) {
      if ((init.method || 'GET') === 'POST') {
        state.metadataWrites++
        state.storedKey = new URLSearchParams(String(init.body)).get('metadata[licence_key]')
        return new Response(JSON.stringify({ id: customerId }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: customerId, metadata: state.storedKey ? { licence_key: state.storedKey } : {} }), { status: 200 })
    }
    if (href.startsWith(`https://api.stripe.com/v1/checkout/sessions/${session.id}`)) {
      return new Response(JSON.stringify({ ...session, customer: { id: customerId, email: 'pass@example.com' } }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${href}`)
  }
  return { state, fetch }
}

async function sendWebhook(env, event) {
  const payload = JSON.stringify(event)
  const header = await stripeSignature(CONFIGURED.STRIPE_WEBHOOK_SECRET, payload)
  return worker.fetch(new Request('https://example.com/api/pro/webhook', { method: 'POST', headers: { 'Stripe-Signature': header }, body: payload }), env)
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
  // deepEqual also proves the retired quota fields (freeLimit/freeRemaining) are gone.
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), env)).json(), { pro: false, source: null, configured: false })

  const configuredEnv = { ...env, ...CONFIGURED }
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status'), configuredEnv)).json(), { pro: false, source: null, configured: true })
  assert.equal((await (await worker.fetch(request('/api/pro/status'), { ...configuredEnv, STRIPE_PRICE_PASS: '' })).json()).configured, false)

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
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'decade' }), configuredEnv)).status, 400)
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'week' }), configuredEnv)).status, 400) // retired plan
  // A missing pass price leaves the whole paywall unconfigured rather than half-open.
  assert.equal((await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'year' }), { ...configuredEnv, STRIPE_PRICE_PASS: '' })).status, 503)
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
    const yearForm = new URLSearchParams(capturedBody)
    assert.equal(yearForm.get('mode'), 'subscription')
    assert.equal(yearForm.get('customer_creation'), null) // Stripe rejects it outside payment mode

    const pass = await worker.fetch(jsonPost('/api/pro/checkout', { plan: 'pass' }), configuredEnv)
    assert.equal(pass.status, 200)
    const form = new URLSearchParams(capturedBody)
    assert.equal(form.get('mode'), 'payment')
    assert.equal(form.get('customer_creation'), 'always')
    assert.equal(form.get('line_items[0][price]'), 'price_pass_1')
    assert.equal(form.get('line_items[0][quantity]'), '1')
    assert.equal(form.get('metadata[plan]'), 'pass')
    assert.equal(form.get('payment_intent_data[metadata][plan]'), 'pass')
    assert.equal(form.get('payment_method_types[0]'), 'card')
    const expiresIn = Number(form.get('expires_at')) - nowSec()
    assert.ok(expiresIn >= 1800 && expiresIn <= 24 * 3600, `expires_at within Stripe's 30 min–24 h window (got ${expiresIn}s)`)
  } finally { globalThis.fetch = originalFetch }
})

test('pass: webhook first mints the key; /pay/success then shows it once with the en-AU end date and cookies capped at the pass end', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const session = passSession({ id: 'cs_pass_wh', customer: 'cus_pass_wh' })
  const periodEnd = session.created + WEEK_S
  const stub = stubStripeForPass(session)
  const originalFetch = globalThis.fetch
  globalThis.fetch = stub.fetch
  try {
    const hook = await sendWebhook(configuredEnv, { id: 'evt_pass_wh', type: 'checkout.session.completed', data: { object: session } })
    assert.equal(hook.status, 200)
    assert.equal(db.licences.size, 1)
    const row = [...db.licences.values()][0]
    assert.equal(row.stripe_subscription, 'pass_cs_pass_wh')
    assert.equal(row.plan, 'pass')
    assert.equal(row.status, 'active')
    assert.equal(row.current_period_end, periodEnd)
    assert.equal(row.stripe_customer, 'cus_pass_wh')
    assert.ok(stub.state.storedKey, 'webhook wrote the key to the Stripe customer')
    assert.equal(row.licence_hash, await sha256(stub.state.storedKey))
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1)

    const first = await worker.fetch(request('/pay/success?session_id=cs_pass_wh'), configuredEnv)
    const html = await first.text()
    assert.ok(html.includes(stub.state.storedKey), 'success page shows the webhook-minted key')
    assert.ok(html.includes(`Your 7-day Pro pass is active until ${auDate(periodEnd)}.`))
    assert.match(html, /active until \d{1,2} [A-Z][a-z]+ \d{4}\./)
    assert.equal(signedProExpiry(first), periodEnd, 'signed cookie expiry is the pass end')
    const age = cookieMaxAge(first, '__Host-pro')
    assert.ok(age <= periodEnd - nowSec() && age >= periodEnd - nowSec() - 5, `__Host-pro Max-Age capped at the pass end (got ${age})`)
    assert.equal(cookieMaxAge(first, 'vv_pro'), age)
    assert.equal(db.licences.size, 1)
    assert.equal(stub.state.metadataWrites, 1, 'the success page never re-mints or overwrites the key')
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1, 'not counted twice')

    const second = await worker.fetch(request('/pay/success?session_id=cs_pass_wh'), configuredEnv)
    const html2 = await second.text()
    assert.doesNotMatch(html2, KEY_RE)
    assert.match(html2, /shown once already/)
    assert.ok(html2.includes(auDate(periodEnd)))

    const status = await worker.fetch(request('/api/pro/status', { headers: { Cookie: first.headers.get('Set-Cookie').split(';')[0] } }), configuredEnv)
    assert.deepEqual(await status.json(), { pro: true, source: 'licence', plan: 'pass', periodEnd, configured: true })
  } finally { globalThis.fetch = originalFetch }
})

test('pass: /pay/success first mints the key; the later webhook and its replay reuse the row', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const session = passSession({ id: 'cs_pass_sp', customer: 'cus_pass_sp' })
  const stub = stubStripeForPass(session)
  const originalFetch = globalThis.fetch
  globalThis.fetch = stub.fetch
  try {
    const first = await worker.fetch(request('/pay/success?session_id=cs_pass_sp'), configuredEnv)
    const html = await first.text()
    const shownKey = html.match(KEY_RE)?.[0]
    assert.ok(shownKey)
    assert.equal(shownKey, stub.state.storedKey)
    assert.match(html, /7-day Pro pass is active until/)
    assert.equal(signedProExpiry(first), session.created + WEEK_S)

    const event = { id: 'evt_pass_sp', type: 'checkout.session.completed', data: { object: session } }
    assert.equal((await sendWebhook(configuredEnv, event)).status, 200)
    assert.equal((await sendWebhook(configuredEnv, event)).status, 200) // replay
    assert.equal(db.licences.size, 1)
    assert.equal([...db.licences.values()][0].licence_hash, await sha256(shownKey), 'the key the customer saw still works')
    assert.equal(stub.state.metadataWrites, 1)
    assert.equal(stub.state.storedKey, shownKey)
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1)

    const revisit = await worker.fetch(request('/pay/success?session_id=cs_pass_sp'), configuredEnv)
    assert.doesNotMatch(await revisit.text(), KEY_RE)
  } finally { globalThis.fetch = originalFetch }
})

test('pass: losing the insert race to the other path keeps the winner\'s key and never shows a dead one', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const session = passSession({ id: 'cs_pass_race', customer: 'cus_pass_race' })
  const stub = stubStripeForPass(session)
  const originalFetch = globalThis.fetch
  globalThis.fetch = stub.fetch
  try {
    await sendWebhook(configuredEnv, { id: 'evt_pass_race', type: 'checkout.session.completed', data: { object: session } })
    const winnerKey = stub.state.storedKey
    db.race.hideNextPassLookup = true
    const page = await worker.fetch(request('/pay/success?session_id=cs_pass_race'), configuredEnv)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.equal(html.match(KEY_RE)?.[0], winnerKey)
    assert.equal(db.licences.size, 1)
    assert.equal(stub.state.metadataWrites, 1)
    assert.equal(db.metrics.get(`${today()}|pay_success`), 1)
  } finally { globalThis.fetch = originalFetch }
})

test('pass: the webhook ignores unpaid sessions and one-off payments that are not our pass', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => { throw new Error(`unexpected fetch: ${url}`) }
  try {
    assert.equal((await sendWebhook(configuredEnv, { id: 'evt_unpaid', type: 'checkout.session.completed', data: { object: passSession({ id: 'cs_unpaid', paymentStatus: 'unpaid' }) } })).status, 200)
    assert.equal((await sendWebhook(configuredEnv, { id: 'evt_other', type: 'checkout.session.completed', data: { object: passSession({ id: 'cs_other', plan: null }) } })).status, 200)
    assert.equal(db.licences.size, 0)
    assert.equal(db.metrics.size, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('pass: once expired, status is not Pro, restore is 401 and /api/store is 401; subscriptions ignore period end', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const rawKey = 'VV-PASS-2222-3333'
  const hash = await sha256(rawKey)
  const periodEnd = nowSec() + 3600
  seedLicence(db, { hash, subscription: 'pass_cs_seed', plan: 'pass', status: 'active', periodEnd })

  const restored = await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '203.0.113.60' }), configuredEnv)
  assert.equal(restored.status, 200)
  assert.deepEqual(await restored.json(), { ok: true, plan: 'pass' })
  assert.equal(signedProExpiry(restored), periodEnd)
  const age = cookieMaxAge(restored, '__Host-pro')
  assert.ok(age <= 3600 && age >= 3595, `restore cookie capped at the pass end (got ${age})`)
  assert.equal(cookieMaxAge(restored, 'vv_pro'), age)
  const proCookie = restored.headers.get('Set-Cookie').split(';')[0]
  assert.equal((await worker.fetch(request('/api/store/x', { headers: { Cookie: proCookie } }), configuredEnv)).status, 404) // authorised, just empty

  db.licences.get(hash).current_period_end = nowSec() - 1
  assert.deepEqual(await (await worker.fetch(request('/api/pro/status', { headers: { Cookie: proCookie } }), configuredEnv)).json(), { pro: false, source: null, configured: true })
  assert.equal((await worker.fetch(request('/api/store/x', { headers: { Cookie: proCookie } }), configuredEnv)).status, 401)
  assert.equal((await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '203.0.113.61' }), configuredEnv)).status, 401)

  db.licences.get(hash).current_period_end = null // a pass with no end must never count as active
  assert.equal((await worker.fetch(jsonPost('/api/pro/restore', { key: rawKey }, { 'CF-Connecting-IP': '203.0.113.62' }), configuredEnv)).status, 401)

  // A subscription whose renewal webhook is late stays active past current_period_end, with a full-year cookie.
  const subKey = 'VV-SUBS-4444-5555'
  seedLicence(db, { hash: await sha256(subKey), subscription: 'sub_late', plan: 'year', status: 'active', periodEnd: nowSec() - 100 })
  const subRestore = await worker.fetch(jsonPost('/api/pro/restore', { key: subKey }, { 'CF-Connecting-IP': '203.0.113.63' }), configuredEnv)
  assert.equal(subRestore.status, 200)
  assert.equal(cookieMaxAge(subRestore, '__Host-pro'), 365 * 24 * 3600)
  const subCookie = subRestore.headers.get('Set-Cookie').split(';')[0]
  assert.equal((await (await worker.fetch(request('/api/pro/status', { headers: { Cookie: subCookie } }), configuredEnv)).json()).pro, true)
})

test('pass: subscription webhooks never touch a pass row, and an expired pass revisiting /pay/success gets no cookie', async () => {
  const { env, db } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const session = passSession({ id: 'cs_pass_old', customer: 'cus_pass_old', created: nowSec() - WEEK_S - 60 })
  const stub = stubStripeForPass(session)
  const originalFetch = globalThis.fetch
  globalThis.fetch = stub.fetch
  try {
    await sendWebhook(configuredEnv, { id: 'evt_pass_old', type: 'checkout.session.completed', data: { object: session } })
    const row = [...db.licences.values()][0]
    assert.equal(row.current_period_end, session.created + WEEK_S)

    await sendWebhook(configuredEnv, { id: 'evt_sub_upd', type: 'customer.subscription.updated', data: { object: { id: 'pass_cs_pass_old', status: 'active', current_period_end: 2999999999, items: { data: [{ price: { id: CONFIGURED.STRIPE_PRICE_YEAR } }] } } } })
    await sendWebhook(configuredEnv, { id: 'evt_sub_del', type: 'customer.subscription.deleted', data: { object: { id: 'pass_cs_pass_old' } } })
    await sendWebhook(configuredEnv, { id: 'evt_inv_fail', type: 'invoice.payment_failed', data: { object: { subscription: 'pass_cs_pass_old' } } })
    assert.equal(row.plan, 'pass')
    assert.equal(row.status, 'active')
    assert.equal(row.current_period_end, session.created + WEEK_S)

    const page = await worker.fetch(request('/pay/success?session_id=cs_pass_old'), configuredEnv)
    assert.match(await page.text(), /no longer active/)
    assert.equal(page.headers.get('Set-Cookie'), null)
    assert.equal(row.key_shown_at ?? null, null)
  } finally { globalThis.fetch = originalFetch }
})

test('/api/pro/use is gone (404) and sets no anon cookie', async () => {
  const { env } = setup()
  const res = await worker.fetch(jsonPost('/api/pro/use', { feature: 'pdf-export' }), env)
  assert.equal(res.status, 404)
  assert.equal(res.headers.get('Set-Cookie'), null)
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

test('/pay/success HEAD has no side effects (no Stripe call, no cookie) so prefetchers cannot spend the key view', async () => {
  const { env } = setup()
  const configuredEnv = { ...env, ...CONFIGURED }
  const originalFetch = globalThis.fetch
  let stripeCalls = 0
  globalThis.fetch = async () => { stripeCalls++; return new Response('{}', { status: 200 }) }
  try {
    const response = await worker.fetch(request('/pay/success?session_id=cs_test_head', { method: 'HEAD' }), configuredEnv)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(stripeCalls, 0)
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

  for (const event of ['export_free', 'export_pro', 'brand_saved']) {
    const res = await worker.fetch(new Request('https://example.com/api/metric', {
      method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
    }), env)
    assert.equal(res.status, 204)
    assert.equal(db.metrics.get(`${today()}|${event}`), 1, `${event} is whitelisted`)
  }

  assert.equal((await worker.fetch(new Request('https://example.com/api/metric?days=30'), env)).status, 401)

  const sessionCookie = await login(env)
  const ownerGet = await worker.fetch(new Request('https://example.com/api/metric?days=30', { headers: { Cookie: sessionCookie } }), env)
  assert.equal(ownerGet.status, 200)
  const rows = (await ownerGet.json()).sort((a, b) => a.event.localeCompare(b.event))
  assert.deepEqual(rows, [
    { day: today(), event: 'brand_saved', count: 1 },
    { day: today(), event: 'export_free', count: 1 },
    { day: today(), event: 'export_pro', count: 1 },
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
