import test from 'node:test'
import assert from 'node:assert/strict'
import { createRound } from '../../public/static/casino/engine.mjs'
import { fixture, fullDeck, insertTransition, loadBackend, USER, OTHER } from './backend-fixture.mjs'

const { Hono, registerCasinoRoutes } = await loadBackend()
function server(t, options = {}) {
  const f = fixture(t, options.balance)
  Object.assign(f.env, options.env)
  const app = new Hono()
  registerCasinoRoutes(app)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    assert.equal(url.origin, 'https://api.line.me')
    calls.push(url.pathname)
    if (url.pathname === '/oauth2/v2.1/verify') {
      const token = url.searchParams.get('access_token')
      if (token === 'expired') return Response.json({}, { status: 401 })
      return Response.json({ client_id: token === 'wrong-channel' ? 'another-channel' : options.channel || '2011492233', expires_in: 3000 })
    }
    if (url.pathname === '/v2/profile') return Response.json({ userId: new Headers(init.headers).get('authorization') === 'Bearer other-user' ? OTHER : USER, displayName: 'テストもち' })
    throw new Error('unexpected LINE endpoint')
  })
  const request = (path, body, token = 'valid-user', extraHeaders = {}) => app.fetch(new Request(`https://casino.example/api/casino/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), f.env)
  return { ...f, request, calls }
}

async function error(response, status, code) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).error.code, code)
}

test('config is public and disabled points endpoints do not attempt authentication', async t => {
  const { request, calls } = server(t, { env: { CASINO_ENABLED: 'false' } })
  const config = await request('config', undefined, null)
  assert.equal(config.status, 200)
  assert.equal(config.headers.get('cache-control'), 'no-store')
  const value = await config.json()
  assert.equal(value.enabled, false)
  assert.deepEqual(value.rules.stakes.draw, [100, 500, 1000])
  await error(await request('session'), 503, 'DISABLED')
  assert.deepEqual(calls, [])
})

test('enable flag alone is insufficient without a registered LIFF app', async t => {
  const { request } = server(t, { env: { CASINO_LIFF_ID: '' } })
  assert.equal((await (await request('config')).json()).enabled, false)
  await error(await request('start', { mode: 'draw', stake: 100, requestId: 'request-start' }), 503, 'DISABLED')
})

test('LINE server token verification rejects missing, expired and wrong-channel credentials', async t => {
  const { request, sql } = server(t)
  await error(await request('session', undefined, null, { 'oai-authenticated-user-id': USER, cookie: `userId=${USER}` }), 401, 'UNAUTHORIZED')
  await error(await request('session', undefined, 'expired'), 401, 'UNAUTHORIZED')
  await error(await request('session', undefined, 'wrong-channel'), 401, 'UNAUTHORIZED')
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM casino_receipts').get().n, 0)
})

test('explicit login channel is verified and session never grants points', async t => {
  const { request, sql } = server(t, { channel: 'new-login-channel', env: { CASINO_LOGIN_CHANNEL_ID: 'new-login-channel' } })
  const response = await request('session')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { balance: 5000, profit: 0, round: null, history: [] })
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM point_ledger').get().n, 0)
})

test('identity, cards, outcomes and test RNG cannot be supplied by HTTP clients', async t => {
  const { request, sql } = server(t)
  const base = { mode: 'draw', stake: 100, requestId: 'valid-request' }
  for (const extra of [{ userId: OTHER }, { deck: fullDeck() }, { payout: 100000 }, { rng: 0.5 }, { balance: 100000 }]) {
    await error(await request('start', { ...base, ...extra }), 400, 'INVALID_REQUEST')
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM casino_receipts').get().n, 0)
})

test('malformed bodies and illegal values are rejected without mutation', async t => {
  const { request, sql } = server(t)
  for (const value of ['{', 'null', '[]', '{}', JSON.stringify({ mode: 'draw', stake: 0, requestId: 'valid-request' }),
    JSON.stringify({ mode: 'draw', stake: 100, requestId: '../escape' }), ' '.repeat(4100)]) {
    await error(await request('start', value), 400, 'INVALID_REQUEST')
  }
  await error(await request('start', '{}', 'valid-user', { 'content-type': 'text/plain' }), 400, 'INVALID_REQUEST')
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM casino_receipts').get().n, 0)
})

test('authenticated round resumes, finishes and replays with a hidden server deck', async t => {
  const { request } = server(t)
  const started = await request('start', { mode: 'draw', stake: 100, requestId: 'start-request' })
  assert.equal(started.status, 200)
  const first = await started.json()
  assert.equal(first.balance, 4900)
  assert.equal('state_json' in first.round, false)
  assert.equal('deck' in first.round, false)
  const resumed = await (await request('session')).json()
  assert.deepEqual(resumed, first)
  await error(await request('action', { roundId: first.round.id, version: 1, action: 'draw', discards: [1, 1], requestId: 'invalid-action' }), 400, 'INVALID_REQUEST')
  await error(await request('action', { roundId: first.round.id, version: 1, action: 'draw', discards: [], requestId: 'foreign-action' }, 'other-user'), 409, 'STALE_ROUND')
  const input = { roundId: first.round.id, version: 1, action: 'draw', discards: [0, 2], requestId: 'valid-action' }
  const finished = await (await request('action', input)).json()
  assert.equal(finished.round.finished, true)
  assert.deepEqual(await (await request('action', input)).json(), finished)
  assert.equal((await (await request('history')).json()).history.length, 1)
})

test('blackjack session exposes only the upcard and its visible total', async t => {
  const { request, sql } = server(t)
  insertTransition(sql, createRound({ id: 'private-blackjack', mode: 'blackjack', stake: 100 }, { deck: fullDeck('5S', '9H', '6H', '7C') }))
  const { round } = await (await request('session')).json()
  assert.deepEqual(round.dealer.cards, ['9H', null])
  assert.equal(round.dealer.total, 9)
  assert.equal(JSON.stringify(round).includes('7C'), false)
  const other = await (await request('session', undefined, 'other-user')).json()
  assert.equal(other.round, null)
  assert.equal(other.profit, 0)
})

test('unexpected database failures are uncached and disclose no internal error', async t => {
  const { request, env } = server(t)
  env.DB.batch = async () => { throw new Error('private deck or SQL details') }
  const response = await request('session')
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const value = await response.json()
  assert.equal(value.error.code, 'UNAVAILABLE')
  assert.equal(JSON.stringify(value).includes('private'), false)
})
