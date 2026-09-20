// Actual queue SQL and disposable SQLite; all LINE requests use a local stub.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { replyWithBroadcasts } from '../../src/lib/line.ts'

const GROUP = 'C_announcement_delivery_fixture'
const text = value => ({ type: 'text', text: value })

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const file of ['0002_broadcast_queue.sql', '0004_reply_api_logs.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  }
  const hooks = {}
  const DB = { prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this },
    async first() { await hooks.beforeFirst?.(sql, args); return sqlite.prepare(sql).get(...args) ?? null },
    async all() { return { results: sqlite.prepare(sql).all(...args) } },
    async run() { await hooks.beforeRun?.(sql, args); return sqlite.prepare(sql).run(...args) },
  } } }
  const env = { DB, LINE_CHANNEL_ACCESS_TOKEN: 'offline-test-only', LINE_CHANNEL_SECRET: 'offline-test-only' }
  const add = (kind, messages, group = GROUP, delivered = 0) => Number(sqlite.prepare(
    'INSERT INTO pending_broadcasts(group_id,kind,message_json,delivered) VALUES(?,?,?,?)'
  ).run(group, kind, JSON.stringify(messages), delivered).lastInsertRowid)
  const state = id => sqlite.prepare('SELECT delivered FROM pending_broadcasts WHERE id=?').get(id).delivered
  return { env, sqlite, hooks, add, state }
}

function stubReplies(t, implementation = async () => new Response('{}')) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply')
    assert.equal(init.method, 'POST')
    const request = JSON.parse(init.body)
    assert.ok(request.messages.length >= 1 && request.messages.length <= 5)
    requests.push(request)
    return implementation(request, requests.length)
  })
  return requests
}

test('announcement is claimed once under concurrent webhook replies', async t => {
  const { env, add, state } = fixture(t)
  const id = add('announcement', [text('latest announcement')])
  const requests = stubReplies(t, async () => {
    assert.equal(state(id), 2, 'send must begin only after a successful database claim')
    await Promise.resolve()
    return new Response('{}')
  })
  await Promise.all(Array.from({ length: 12 }, (_, index) => replyWithBroadcasts(env, GROUP, `reply-${index}`, [])))
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].messages, [text('latest announcement')])
  assert.equal(state(id), 1)
  await replyWithBroadcasts(env, GROUP, 'later-reply', [])
  assert.equal(requests.length, 1)
})

test('manual announcement absorbs its queued automatic copy while ordinary broadcasts still send', async t => {
  const { env, add, state } = fixture(t)
  const birthday = add('birthday', [text('birthday')])
  const announcement = add('announcement', [text('automatic notice')])
  const requests = stubReplies(t)
  const direct = [text('manual current carousel')]
  await replyWithBroadcasts(env, GROUP, 'manual', direct, { announcementCommand: true })
  assert.deepEqual(requests[0].messages, [text('manual current carousel'), text('birthday')])
  assert.deepEqual(direct, [text('manual current carousel')], 'caller-owned direct messages are unchanged')
  assert.equal(state(birthday), 1)
  assert.equal(state(announcement), 1)
  await replyWithBroadcasts(env, GROUP, 'later', [])
  assert.equal(requests.length, 1)
  await replyWithBroadcasts(env, GROUP, 'manual-again', direct, { announcementCommand: true })
  assert.equal(requests.length, 2, 'explicitly asking again can still view the notice')
})

test('announcement priority avoids losing manual absorption behind a long ordinary backlog', async t => {
  const { env, add, state } = fixture(t)
  const ordinary = Array.from({ length: 25 }, (_, index) => add('custom', [text(`ordinary-${index}`)]))
  const announcement = add('announcement', [text('automatic notice')])
  const requests = stubReplies(t)
  await replyWithBroadcasts(env, GROUP, 'manual', [text('manual notice')], { announcementCommand: true })
  assert.deepEqual(requests[0].messages, [text('manual notice'), ...Array.from({ length: 4 }, (_, index) => text(`ordinary-${index}`))])
  assert.equal(state(announcement), 1)
  assert.deepEqual(ordinary.map(state), [...Array(4).fill(1), ...Array(21).fill(0)])
})

test('the five-message cap marks only whole queue entries actually sent', async t => {
  const { env, add, state } = fixture(t)
  const notice = add('announcement', [text('notice')])
  const ordinary = add('ranking', [text('ranking')])
  const requests = stubReplies(t)
  const direct = Array.from({ length: 4 }, (_, index) => text(`direct-${index}`))
  await replyWithBroadcasts(env, GROUP, 'four-direct', direct)
  assert.deepEqual(requests[0].messages, [...direct, text('notice')])
  assert.equal(state(notice), 1)
  assert.equal(state(ordinary), 0)
  await replyWithBroadcasts(env, GROUP, 'next', [])
  assert.deepEqual(requests[1].messages, [text('ranking')])
  assert.equal(state(ordinary), 1)
})

test('a full direct reply leaves announcements unclaimed for the next reply', async t => {
  const { env, add, state } = fixture(t)
  const notice = add('announcement', [text('notice')])
  const requests = stubReplies(t)
  const direct = Array.from({ length: 6 }, (_, index) => text(`direct-${index}`))
  await replyWithBroadcasts(env, GROUP, 'full', direct)
  assert.deepEqual(requests[0].messages, direct.slice(0, 5))
  assert.equal(state(notice), 0)
  await replyWithBroadcasts(env, GROUP, 'later', [])
  assert.deepEqual(requests[1].messages, [text('notice')])
  assert.equal(state(notice), 1)
})

test('multi-message ordinary rows are not partially sent or marked and retain FIFO order', async t => {
  const { env, add, state } = fixture(t)
  const large = add('custom', [text('a'), text('b'), text('c')])
  const later = add('custom', [text('later')])
  const direct = [text('1'), text('2'), text('3')]
  const requests = stubReplies(t)
  await replyWithBroadcasts(env, GROUP, 'insufficient-room', direct)
  assert.deepEqual(requests[0].messages, direct)
  assert.equal(state(large), 0)
  assert.equal(state(later), 0)
  await replyWithBroadcasts(env, GROUP, 'room-available', [])
  assert.deepEqual(requests[1].messages, [text('a'), text('b'), text('c'), text('later')])
  assert.equal(state(large), 1)
  assert.equal(state(later), 1)
})

test('definite HTTP rejection releases only the announcements claimed by this reply', async t => {
  for (const status of [400, 401, 403, 429]) await t.test(String(status), async t => {
    const { env, add, state } = fixture(t)
    const notice = add('announcement', [text('notice')])
    const ordinary = add('birthday', [text('birthday')])
    const priorUncertain = add('announcement', [text('uncertain older notice')], GROUP, 2)
    const requests = stubReplies(t, async (_request, attempt) => new Response('{}', { status: attempt === 1 ? status : 200 }))
    await replyWithBroadcasts(env, GROUP, 'rejected', [])
    assert.equal(state(notice), 0)
    assert.equal(state(ordinary), 0)
    assert.equal(state(priorUncertain), 2)
    await replyWithBroadcasts(env, GROUP, 'retry-next-message', [])
    assert.equal(requests.length, 2)
    assert.equal(state(notice), 1)
    assert.equal(state(ordinary), 1)
    assert.equal(state(priorUncertain), 2)
  })
})

test('network failure and HTTP 5xx retain uncertain announcement claims without changing ordinary retries', async t => {
  for (const failure of ['network', 500, 502, 503, 504]) await t.test(String(failure), async t => {
    const { env, add, state } = fixture(t)
    const notice = add('announcement', [text('notice')])
    const ordinary = add('birthday', [text('birthday')])
    const requests = stubReplies(t, async (_request, attempt) => {
      if (attempt === 1) {
        if (failure === 'network') throw new DOMException('offline timeout', 'TimeoutError')
        return new Response('{}', { status: failure })
      }
      return new Response('{}')
    })
    await replyWithBroadcasts(env, GROUP, 'uncertain', [])
    assert.equal(state(notice), 2)
    assert.equal(state(ordinary), 0)
    await replyWithBroadcasts(env, GROUP, 'next-message', [])
    assert.deepEqual(requests[1].messages, [text('birthday')])
    assert.equal(state(notice), 2)
    assert.equal(state(ordinary), 1)
  })
})

test('audit-log failure after LINE success cannot automatically resend the announcement', async t => {
  const { env, add, state, hooks } = fixture(t)
  const notice = add('announcement', [text('notice')])
  const requests = stubReplies(t)
  hooks.beforeRun = sql => { if (sql.includes('INSERT INTO reply_api_logs')) throw new Error('simulated log write failure') }
  await assert.rejects(replyWithBroadcasts(env, GROUP, 'accepted-but-log-failed', []), /simulated log write failure/)
  assert.equal(state(notice), 2)
  hooks.beforeRun = undefined
  await replyWithBroadcasts(env, GROUP, 'next', [])
  assert.equal(requests.length, 1)
})

test('other groups and sent, claimed, or replaced announcements are not selected', async t => {
  const { env, add, state } = fixture(t)
  const ids = [
    add('announcement', [text('other group')], 'C_other_group', 0),
    ...[1, 2, 3].map(value => add('announcement', [text(`state-${value}`)], GROUP, value)),
  ]
  const requests = stubReplies(t)
  await replyWithBroadcasts(env, GROUP, 'none', [])
  assert.equal(requests.length, 0)
  assert.deepEqual(ids.map(state), [0, 1, 2, 3])
})

test('an announcement superseded between selection and claim cannot be sent', async t => {
  const { env, sqlite, add, state, hooks } = fixture(t)
  const notice = add('announcement', [text('obsolete')])
  hooks.beforeFirst = sql => {
    if (sql.includes('SET delivered = 2')) sqlite.prepare('UPDATE pending_broadcasts SET delivered=3 WHERE id=?').run(notice)
  }
  const requests = stubReplies(t)
  await replyWithBroadcasts(env, GROUP, 'raced', [])
  assert.equal(requests.length, 0)
  assert.equal(state(notice), 3)
})
