// Real Hono webhook + signature verification + SQLite, with every fetch mocked.
// Run after build:help: node --test tests/login-bonus/webhook.test.mjs
// No credentials, network, persistent database, or messages to real users.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `
      export { default } from './src/index.tsx';
      export { HELP_DESIGN } from './src/features/menu/helpDesign.ts';
      export { default as HELP_ASSETS } from './src/features/menu/helpAssets.json';
    `,
    resolveDir: root, sourcefile: 'login-webhook-test-entry.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const { default: app, HELP_DESIGN, HELP_ASSETS } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const SECRET = 'offline-login-webhook-unit-secret'
const TOKEN = 'offline-login-webhook-unit-token'
// Valid LINE-shaped identities, deliberately synthetic and never a real owner.
const A = `U${'a'.repeat(32)}`, B = `U${'b'.repeat(32)}`
const firstSeven = ['ヘルプ', 'ステータス', '既読セット', 'りぷかく', 'めんかく', 'ランキング', 'めいく']
const migrations = [
  '0001_initial_schema.sql', '0004_reply_api_logs.sql', '0015_personalization.sql',
  '0020_exp_last_text.sql', '0021_exp_cooldown.sql', '0026_message_points.sql', '0028_login_bonus.sql',
  '0029_login_bonus_test.sql',
]

function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
const textOf = value => nodes(value).filter(node => node.type === 'text').map(node => node.text).join('\n')

function fixture(t, { testUserId, displayNames = {} } = {}) {
  // Keep the real handler's server clock inside one JST day even when this
  // suite happens to run across midnight. No client timestamp controls awards.
  let now = Date.parse('2026-09-22T03:00:00.000Z')
  t.mock.method(Date, 'now', () => now)
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of migrations) db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
  t.after(() => db.close())
  const prepare = (sql, args = []) => {
    const execute = () => {
      const statement = db.prepare(sql)
      if (statement.columns().length) return { success: true, results: statement.all(...args).map(row => ({ ...row })), meta: { changes: 0 } }
      const result = statement.run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return {
      bind: (...values) => prepare(sql, values), execute,
      async first(column) { const row = db.prepare(sql).get(...args); return row ? column ? row[column] : { ...row } : null },
      async all() { return { success: true, results: db.prepare(sql).all(...args).map(row => ({ ...row })), meta: {} } },
      async run() { return execute() },
    }
  }
  const env = {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: TOKEN,
    LOGIN_BONUS_TEST_USER_ID: testUserId,
    DB: { prepare, async batch(statements) {
      // Each complete batch is synchronous and transactional, as in D1.
      db.exec('BEGIN')
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results }
      catch (error) { db.exec('ROLLBACK'); throw error }
    } },
  }
  const calls = [], replies = []
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    calls.push({ url: url.toString(), method: init.method ?? 'GET' })
    assert.equal(url.origin, 'https://api.line.me', 'all external transport is stubbed and restricted to expected LINE operations')
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`)
    if (url.pathname.startsWith('/v2/bot/profile/') && !init.method) {
      const userId = url.pathname.slice('/v2/bot/profile/'.length)
      return Response.json({ userId, displayName: displayNames[userId] ?? (userId === A ? 'Alice' : 'Bob'), pictureUrl: 'https://avatar.example/unit.png' })
    }
    if (url.pathname === '/v2/bot/message/reply' && init.method === 'POST') {
      replies.push(JSON.parse(init.body))
      return Response.json({})
    }
    throw new Error('Unexpected offline webhook fetch')
  })

  let sequence = 0
  const event = (overrides = {}) => {
    sequence += 1
    const { user = A, text = 'ログイン', eventId = `unit-event-${sequence}`, messageId = `unit-message-${sequence}`, ...rest } = overrides
    return {
      type: 'message', source: { type: 'user', ...(user ? { userId: user } : {}) },
      replyToken: `unit-reply-${sequence}`, timestamp: Date.now(),
      ...(eventId === null ? {} : { webhookEventId: eventId }),
      message: { type: 'text', text, ...(messageId === null ? {} : { id: messageId }) },
      ...rest,
    }
  }
  const send = async (events, { signature, tamper } = {}) => {
    const signedBody = JSON.stringify({ destination: 'U_offline_destination', events: Array.isArray(events) ? events : [events] })
    const signed = signature ?? createHmac('sha256', SECRET).update(signedBody).digest('base64')
    const waiting = []
    const res = await app.fetch(new Request('https://happamochi.example/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': signed },
      body: tamper ? tamper(signedBody) : signedBody,
    }), env, { waitUntil(promise) { waiting.push(promise) }, passThroughOnException() {} })
    await Promise.all(waiting)
    // handleEvent intentionally catches errors; a 200 ACK alone is not evidence
    // that the command, points transaction, or mocked reply actually succeeded.
    assert.deepEqual(db.prepare('SELECT error_message FROM webhook_debug_logs WHERE error_message IS NOT NULL').all(), [])
    return res
  }
  const profile = (user = A) => db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user)
  const bonus = (user = A) => db.prepare("SELECT * FROM point_ledger WHERE user_id = ? AND reason = 'login_bonus' ORDER BY id").all(user)
  const allBonus = (user = A) => db.prepare("SELECT * FROM point_ledger WHERE user_id = ? AND reason IN ('login_bonus', 'login_bonus_test') ORDER BY id").all(user)
  const state = (user = A) => ({ ...db.prepare('SELECT last_day, total_days, streak_days FROM login_bonus_state WHERE user_id = ?').get(user) })
  const setNow = value => { now = Date.parse(value); assert.ok(Number.isSafeInteger(now)) }
  const lastMessage = () => replies.at(-1)?.messages?.[0]
  return { db, env, event, send, calls, replies, profile, bonus, allBonus, state, setNow, lastMessage }
}

test('a signed DM login credits 500 bonus points separately from its ordinary 1 point and sends the native receipt', async t => {
  const f = fixture(t)
  const request = f.event()
  const res = await f.send(request)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(f.profile().points, 501)
  assert.equal(f.profile().total_exp, 1)
  assert.equal(f.bonus().length, 1)
  assert.equal(f.bonus()[0].delta, 500)
  assert.equal(f.db.prepare('SELECT points_delta FROM exp_events WHERE event_key = ?').get(request.webhookEventId).points_delta, 1)
  assert.equal(f.db.prepare('SELECT awarded_event_key FROM login_bonus_claims WHERE user_id = ?').get(A).awarded_event_key, request.webhookEventId)
  assert.equal(f.replies.length, 1)
  assert.equal(f.replies[0].replyToken, request.replyToken)
  assert.equal(f.lastMessage().type, 'flex')
  assert.match(textOf(f.lastMessage()), /今日も来てくれてありがとう！/)
  assert.match(textOf(f.lastMessage()), /500ポイント/)
  assert.deepEqual(nodes(f.lastMessage()).find(node => node.type === 'postback'), {
    type: 'postback', label: 'ステータスを確認する', data: 'pf|status',
  })
  assert.equal(f.db.prepare('SELECT ok FROM reply_api_logs').get().ok, 1)
});

test('same-day new commands and a redelivered signed event never duplicate the bonus or receipt balance', async t => {
  const f = fixture(t)
  const original = f.event()
  await f.send(original)
  const otherCommand = f.event()
  await f.send(otherCommand)
  assert.match(textOf(f.lastMessage()), /\d{4}\/\d{2}\/\d{2}分は受け取り済み/)
  await f.send({ ...original, deliveryContext: { isRedelivery: true } })
  assert.match(textOf(f.lastMessage()), /\d{4}\/\d{2}\/\d{2}分は受け取り済み/)
  assert.equal(f.profile().points, 501)
  assert.equal(f.bonus().length, 1)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_claims').get().n, 1)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_events').get().n, 2)
  const state = f.db.prepare('SELECT total_days, streak_days FROM login_bonus_state WHERE user_id = ?').get(A)
  assert.equal(state.total_days, 1)
  assert.equal(state.streak_days, 1)
});

test('each signed source user receives an independent daily login award', async t => {
  const f = fixture(t)
  await f.send(f.event({ user: A }))
  await f.send(f.event({ user: B }))
  for (const user of [A, B]) {
    assert.equal(f.profile(user).points, 501)
    assert.equal(f.bonus(user).length, 1)
    assert.equal(f.bonus(user)[0].delta, 500)
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_claims').get().n, 2)
});

test('invalid signatures and bodies changed after signing cannot create profiles, bonus receipts, or replies', async t => {
  const f = fixture(t)
  const first = await f.send(f.event(), { signature: 'invalid-unit-signature' })
  assert.equal(first.status, 401)
  const second = await f.send(f.event(), { tamper: body => body.replace(A, B) })
  assert.equal(second.status, 401)
  assert.equal(f.calls.length, 0)
  for (const table of ['user_profiles', 'exp_events', 'login_bonus_events', 'login_bonus_claims', 'point_ledger', 'reply_api_logs']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  }
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM webhook_debug_logs WHERE event_type = 'invalid_signature'").get().n, 2)
});

test('message.id supplies the fallback event key when webhookEventId is unavailable', async t => {
  const f = fixture(t)
  const request = f.event({ eventId: null, messageId: 'fallback-unit-message' })
  await f.send(request)
  await f.send({ ...request, deliveryContext: { isRedelivery: true } })
  const receipt = f.db.prepare('SELECT event_key FROM login_bonus_events WHERE user_id = ?').get(A)
  assert.equal(receipt.event_key, 'msg_fallback-unit-message')
  assert.equal(f.profile().points, 501)
  assert.equal(f.bonus().length, 1)
  assert.match(textOf(f.lastMessage()), /\d{4}\/\d{2}\/\d{2}分は受け取り済み/)
});

test('missing both event identities or the signed source user fails closed without a login award', async t => {
  const f = fixture(t)
  await f.send(f.event({ eventId: null, messageId: null }))
  assert.match(textOf(f.lastMessage()), /受け取り情報を確認できませんでした/)
  await f.send(f.event({ user: null }))
  assert.match(textOf(f.lastMessage()), /受け取り情報を確認できませんでした/)
  for (const table of ['user_profiles', 'exp_events', 'login_bonus_events', 'login_bonus_claims', 'point_ledger']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  }
});

test('only the configured owner earns the normal daily amount for each new signed login while day counters advance once', async t => {
  const f = fixture(t, { testUserId: A })
  for (let i = 0; i < 3; i++) {
    await f.send(f.event())
    assert.match(textOf(f.lastMessage()), /今日も来てくれてありがとう！/)
    assert.match(textOf(f.lastMessage()), /500ポイント/)
  }
  assert.equal(f.profile().points, 1501, 'three 500-point awards plus the ordinary first-message point')
  assert.deepEqual(f.allBonus().map(row => [row.reason, row.delta]), [
    ['login_bonus', 500], ['login_bonus_test', 500], ['login_bonus_test', 500],
  ])
  assert.deepEqual(f.state(), { last_day: '2026-09-22', total_days: 1, streak_days: 1 })
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_claims').get().n, 1)

  f.setNow('2026-09-22T15:00:00.000Z') // September 23, midnight in Japan.
  await f.send(f.event())
  await f.send(f.event())
  assert.match(textOf(f.lastMessage()), /1,000ポイント/)
  assert.deepEqual(f.allBonus().map(row => row.delta), [500, 500, 500, 1000, 1000])
  assert.deepEqual(f.state(), { last_day: '2026-09-23', total_days: 2, streak_days: 2 })
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_claims').get().n, 2)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_test_claims').get().n, 3)
  const messagePoints = f.db.prepare('SELECT SUM(points_delta) AS n FROM exp_events WHERE user_id = ?').get(A).n
  assert.equal(f.profile().points, 3500 + messagePoints, 'bonus credits and ordinary message awards reconcile with the balance')
});

test('a different signed UID with the same display name cannot acquire owner repeats from names or request fields', async t => {
  const f = fixture(t, { testUserId: A, displayNames: { [A]: 'Same owner name', [B]: 'Same owner name' } })
  await f.send(f.event({ user: A }))
  await f.send(f.event({ user: B }))
  await f.send(f.event({ user: B, displayName: 'Same owner name', userId: A, LOGIN_BONUS_TEST_USER_ID: B }))
  assert.equal(f.profile(A).display_name, f.profile(B).display_name)
  assert.equal(f.profile(B).points, 501)
  assert.equal(f.allBonus(B).length, 1)
  assert.match(textOf(f.lastMessage()), /2026\/09\/22分は受け取り済み/)
  assert.deepEqual(f.state(B), { last_day: '2026-09-22', total_days: 1, streak_days: 1 })
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_test_claims WHERE user_id = ?').get(B).n, 0)
});

test('the private owner switch rejects absent, malformed, padded, multiple, or case-changed IDs', async t => {
  const cases = [
    ['absent', undefined, A], ['empty', '', A],
    ['leading space', ` ${A}`, A], ['trailing space', `${A} `, A],
    ['multiple UIDs', `${A},${B}`, A], ['different valid UID', B, A],
    ['uppercase hex even when equal to actor', `U${'A'.repeat(32)}`, `U${'A'.repeat(32)}`],
    ['malformed but equal to actor', 'U_unit_owner', 'U_unit_owner'],
  ]
  for (const [label, testUserId, user] of cases) {
    await t.test(label, async t => {
      const f = fixture(t, { testUserId })
      await f.send(f.event({ user }))
      await f.send(f.event({ user }))
      assert.equal(f.profile(user).points, 501)
      assert.equal(f.allBonus(user).length, 1)
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_test_claims').get().n, 0)
      assert.match(textOf(f.lastMessage()), /分は受け取り済み/)
    })
  }
});

test('owner event redeliveries never award again, including across JST midnight and after the next daily claim', async t => {
  const f = fixture(t, { testUserId: A })
  f.setNow('2026-09-22T14:59:59.999Z')
  const daily = f.event(), repeated = f.event()
  await f.send(daily)
  await f.send(repeated)
  const beforeReplay = f.profile().points
  const redeliver = event => ({ ...event, replyToken: 'unit-new-delivery-token', deliveryContext: { isRedelivery: true } })
  await f.send(redeliver(repeated))
  assert.equal(f.profile().points, beforeReplay)

  f.setNow('2026-09-22T15:00:00.000Z')
  for (const original of [daily, repeated]) {
    await f.send(redeliver(original))
    assert.match(textOf(f.lastMessage()), /2026\/09\/22分は受け取り済み/)
    assert.match(textOf(f.lastMessage()), /500ポイント/)
    assert.equal(f.profile().points, beforeReplay)
  }
  assert.equal(f.allBonus().length, 2)
  assert.deepEqual(f.state(), { last_day: '2026-09-22', total_days: 1, streak_days: 1 })

  await f.send(f.event())
  const afterNextDay = f.profile().points
  await f.send(redeliver(repeated))
  assert.equal(f.profile().points, afterNextDay)
  assert.deepEqual(f.allBonus().map(row => row.delta), [500, 500, 1000])
  assert.deepEqual(f.state(), { last_day: '2026-09-23', total_days: 2, streak_days: 2 })
  assert.match(textOf(f.lastMessage()), /2026\/09\/22分は受け取り済み/)
  assert.match(textOf(f.lastMessage()), /500ポイント/)
});

test('owner message-ID fallback earns once per fresh message and retains replay protection', async t => {
  const f = fixture(t, { testUserId: A })
  await f.send(f.event({ eventId: null, messageId: 'owner-fallback-first' }))
  const repeated = f.event({ eventId: null, messageId: 'owner-fallback-second' })
  await f.send(repeated)
  await f.send({ ...repeated, deliveryContext: { isRedelivery: true } })
  assert.deepEqual(f.allBonus().map(row => row.delta), [500, 500])
  assert.equal(f.profile().points, 1001)
  assert.equal(f.db.prepare('SELECT event_key FROM login_bonus_test_claims').get().event_key, 'msg_owner-fallback-second')
  assert.match(textOf(f.lastMessage()), /分は受け取り済み/)
});

test('owner permission cannot bypass signed event identity or signature requirements', async t => {
  const f = fixture(t, { testUserId: A })
  await f.send(f.event({ eventId: null, messageId: null }))
  assert.match(textOf(f.lastMessage()), /受け取り情報を確認できませんでした/)
  await f.send(f.event({ eventId: '', messageId: null }))
  assert.match(textOf(f.lastMessage()), /受け取り情報を確認できませんでした/)
  await f.send(f.event({ user: null }))
  assert.match(textOf(f.lastMessage()), /受け取り情報を確認できませんでした/)
  const invalid = await f.send(f.event(), { signature: 'invalid-owner-event-signature' })
  assert.equal(invalid.status, 401)
  for (const table of ['user_profiles', 'exp_events', 'login_bonus_events', 'login_bonus_claims', 'login_bonus_test_claims', 'point_ledger']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  }
});

test('real help response retains its first seven commands and exposes login as a message action', async t => {
  const f = fixture(t)
  assert.deepEqual(HELP_DESIGN.commands.slice(0, 7).map(command => command.label), firstSeven)
  await f.send(f.event({ text: 'ヘルプ' }))
  const help = f.lastMessage()
  assert.equal(help.type, 'flex', 'run build:help before this test: stale artwork falls back to plain text')
  assert.equal(help.contents.type, 'carousel')
  const rowLabels = new Map(HELP_ASSETS.rows.map(row => [row.file, row.label]))
  const visibleOrder = nodes(help).filter(node => node.type === 'image')
    .map(image => rowLabels.get(new URL(image.url).pathname.split('/').at(-1))).filter(Boolean)
  assert.deepEqual(visibleOrder.slice(0, 7), firstSeven)
  assert.deepEqual(nodes(help).filter(node => node.type === 'message' && node.text === 'ログイン'), [
    { type: 'message', label: 'ログイン', text: 'ログイン' },
  ])
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM login_bonus_claims').get().n, 0, 'opening help never claims the bonus')
});
