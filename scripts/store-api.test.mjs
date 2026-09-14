import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { PinAttempts } from '../worker/auth.ts'

// In-memory stand-in for the one D1 table the route touches.
function fakeD1() {
  const rows = new Map()
  const prepare = (sql) => ({
    bind: (...args) => ({
      async first() {
        if (/^SELECT/.test(sql)) { const row = rows.get(args[0]); return row ? { ...row } : null }
        throw new Error('first() on non-select')
      },
      async run() {
        if (/^INSERT/.test(sql)) { rows.set(args[0], { revision: 1, json: args[1], updated_at: args[2] }); return { success: true, meta: { changes: 1 } } }
        if (/^UPDATE/.test(sql)) {
          const row = rows.get(args[3])
          if (!row || row.revision !== args[4]) return { success: true, meta: { changes: 0 } }
          rows.set(args[3], { revision: args[0], json: args[1], updated_at: args[2] })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE/.test(sql)) { rows.delete(args[0]); return { success: true, meta: { changes: 1 } } }
        throw new Error(`unexpected sql: ${sql}`)
      },
    }),
  })
  return { prepare, rows }
}

async function session() {
  const records = new Map()
  let queue = Promise.resolve()
  const txn = { get: async (key) => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value)) }
  const state = { storage: { transaction(callback) { const r = queue.then(() => callback(txn)); queue = r.catch(() => {}); return r } } }
  const limiter = new PinAttempts(state)
  const db = fakeD1()
  const env = {
    SITE_PIN: '012345', SESSION_SECRET: 'test-only-session-key-never-use-in-production',
    PIN_ATTEMPTS: { idFromName: (name) => name, get: () => limiter },
    ASSETS: { fetch: async () => new Response('asset') },
    DEEP_SWARM_DB: db,
  }
  const login = await worker.fetch(new Request('https://example.com/login', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body: 'pin=012345',
  }), env)
  const cookie = login.headers.get('Set-Cookie').split(';')[0]
  const call = (path, options = {}) => worker.fetch(new Request(`https://example.com${path}`, {
    ...options, headers: { Cookie: cookie, Origin: 'https://example.com', ...(options.headers || {}) },
  }), env)
  return { call, env, db }
}

const doc = (data) => JSON.stringify({ revision: 0, doc: { version: 1, data } })

test('store route is closed without a session', async () => {
  const { env } = await session()
  assert.equal((await worker.fetch(new Request('https://example.com/api/store/kitchen'), env)).status, 401)
})

test('store round-trips a document with revision checks', async () => {
  const { call } = await session()
  assert.equal((await call('/api/store/kitchen')).status, 404)
  const created = await call('/api/store/kitchen', { method: 'PUT', body: doc({ recipes: [1] }) })
  assert.equal(created.status, 201)
  assert.equal((await created.json()).revision, 1)

  const read = await (await call('/api/store/kitchen')).json()
  assert.equal(read.revision, 1)
  assert.deepEqual(read.doc, { version: 1, data: { recipes: [1] } })

  const stale = await call('/api/store/kitchen', { method: 'PUT', body: doc({ recipes: [2] }) })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).revision, 1)

  const next = await call('/api/store/kitchen', { method: 'PUT', body: JSON.stringify({ revision: 1, doc: { version: 1, data: { recipes: [2] } } }) })
  assert.equal(next.status, 200)
  assert.equal((await next.json()).revision, 2)

  assert.equal((await call('/api/store/kitchen', { method: 'DELETE' })).status, 204)
  assert.equal((await call('/api/store/kitchen')).status, 404)
})

test('store rejects bad keys, foreign origins, malformed and oversized documents', async () => {
  const { call } = await session()
  assert.equal((await call('/api/store/Not%20Valid')).status, 404)
  assert.equal((await call('/api/store/kitchen', { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: doc({}) })).status, 403)
  assert.equal((await call('/api/store/kitchen', { method: 'PUT', body: '{nope' })).status, 400)
  assert.equal((await call('/api/store/kitchen', { method: 'PUT', body: JSON.stringify({ revision: 0, doc: { data: {} } }) })).status, 400)
  assert.equal((await call('/api/store/kitchen', { method: 'PUT', body: JSON.stringify({ revision: 0, doc: { version: 1, data: 'x'.repeat(2_000_001) } }) })).status, 413)
  assert.equal((await call('/api/store/kitchen', { method: 'POST', body: doc({}) })).status, 405)
})

test('store answers 503 when D1 is not bound', async () => {
  const { call, env } = await session()
  env.DEEP_SWARM_DB = undefined
  assert.equal((await call('/api/store/kitchen')).status, 503)
})
