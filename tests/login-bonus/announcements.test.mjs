// Login notices stay beside the unchanged receipt and use only mocked LINE replies.
// Run: node --test tests/login-bonus/announcements.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundled = await build({
  stdin: {
    contents: `
      export { default as app } from './src/index.tsx';
      export { buildLoginBonusCard } from './src/features/loginBonus/flex.ts';
      export { handleLoginBonusText } from './src/features/loginBonus/index.ts';
      export { ANNOUNCEMENTS, buildAnnouncementMessage } from './src/features/announcements.ts';
    `,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    sourcefile: 'login-announcements-test.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const { app, buildLoginBonusCard, handleLoginBonusText, ANNOUNCEMENTS, buildAnnouncementMessage } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

const sample = {
  claimed: true, day: '2026-09-22', totalDays: 5, streakDays: 5,
  rewardDays: 5, rewardPoints: 2500, balance: 4123,
}
const USER = `U${'a'.repeat(32)}`
const GROUP = `C${'b'.repeat(32)}`
const OTHER_GROUP = `C${'c'.repeat(32)}`
const SECRET = 'offline-login-announcement-secret'
const TOKEN = 'offline-login-announcement-token'
const notice = index => ({
  id: `fixture_notice_${index}`, title: `更新${index}`, body: `お知らせ本文${index}`,
  date: '2026/09/22', button: { label: '機能を使う', action: { type: 'message', label: '機能を使う', text: 'ヘルプ' } },
})
function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
const texts = value => nodes(value).filter(node => node.type === 'text' || node.type === 'span').map(node => node.text ?? '').join('\n')
const bubbles = message => message.contents.type === 'carousel' ? message.contents.contents : [message.contents]
const previews = message => bubbles(message).slice(1)

test('no announcements retains the standalone receipt, while notices follow the exact same receipt', () => {
  const standalone = buildLoginBonusCard(sample)
  assert.equal(standalone.contents.type, 'bubble')
  assert.deepEqual(buildLoginBonusCard(sample, []), standalone)
  for (const count of [1, 3, 11, 15]) {
    const announcements = Array.from({ length: count }, (_, index) => notice(index))
    const before = structuredClone(announcements)
    const message = buildLoginBonusCard(sample, announcements)
    assert.equal(message.type, 'flex')
    assert.equal(message.contents.type, 'carousel')
    assert.equal(bubbles(message).length, Math.min(count + 1, 12), 'reserve the first of the twelve LINE bubbles for the receipt')
    assert.deepEqual(bubbles(message)[0], standalone.contents, 'adding notices cannot change the existing receipt or its layout')
    assert.deepEqual(announcements, before, 'the registry remains caller-owned')
    assert.ok(message.altText.length <= 1500)
    assert.ok(Buffer.byteLength(JSON.stringify(message.contents)) < 50_000)
    for (const [index, preview] of previews(message).entries()) {
      assert.ok(texts(preview).includes(announcements[index].title), 'registry order is retained')
      assert.equal(preview.size, standalone.contents.size)
      assert.deepEqual(preview.footer, standalone.contents.footer)
      for (const key of ['paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd']) {
        assert.equal(preview.header[key], standalone.contents.header[key])
      }
      for (const key of ['paddingAll', 'spacing']) assert.equal(preview.body[key], standalone.contents.body[key])
      assert.deepEqual(nodes(preview).filter(node => node.type === 'message'), [{ type: 'message', label: '詳しく見る', text: 'お知らせ' }])
      assert.ok(!nodes(preview).some(node => node.type === 'image'), 'notices remain native, readable Flex text')
    }
  }
})

test('only preview text is capped: long notices cannot increase the carousel height or clip the receipt', () => {
  const long = {
    ...notice('long'), title: '非常に長いお知らせのタイトル'.repeat(8),
    body: Array.from({ length: 10 }, (_, index) => `確認行${index}：${'長くても全文表示で読めます。'.repeat(3)}`).join('\n'),
  }
  const message = buildLoginBonusCard(sample, [long])
  assert.equal(previews(message).length, 1, 'a long notice is one short preview rather than full-height detail pages')
  const preview = previews(message)[0]
  const panelTexts = nodes(preview.body.contents[0]).filter(node => node.type === 'text')
  assert.equal(panelTexts.length, 3, 'preview keeps title, body and date together')
  assert.deepEqual(panelTexts.map(node => node.maxLines), [1, 4, 1])
  assert.deepEqual(panelTexts.map(node => node.size), ['14px', '12px', '11px'])
  assert.equal(preview.body.contents[0].flex, 1, 'short notices absorb spare carousel space above the CTA')
  for (const node of nodes(bubbles(message)[0])) {
    assert.equal(node.height, undefined, 'the receipt can still accommodate the user font size')
    assert.equal(node.maxHeight, undefined)
    if (node.type === 'text') assert.equal(node.maxLines, undefined, 'reward information remains complete')
  }
  const details = buildAnnouncementMessage(long)
  const detailedText = texts(details)
  for (const line of long.body.split('\n')) assert.ok(detailedText.includes(line), 'the full announcement keeps every line')
  for (const node of nodes(details).filter(node => node.type === 'text')) assert.equal(node.maxLines, undefined)
})

test('large Unicode notices remain inside LINE payload limits and blank preview fields never become invalid text', () => {
  const oversized = { ...notice('large'), title: '🍃'.repeat(5000), body: '🍡'.repeat(20000), date: '更新日'.repeat(1000) }
  const message = buildLoginBonusCard(sample, Array.from({ length: 15 }, (_, index) => ({ ...oversized, id: `large-${index}` })))
  assert.equal(bubbles(message).length, 12)
  assert.ok(Buffer.byteLength(JSON.stringify(message.contents)) < 50_000, 'even the largest carousel fits the LINE Flex contents limit')
  for (const preview of previews(message)) {
    const fields = nodes(preview.body.contents[0]).filter(node => node.type === 'text')
    for (const [index, field] of fields.entries()) {
      assert.ok(Array.from(field.text).length <= [80, 240, 32][index])
      assert.ok(field.text.isWellFormed(), 'truncating a Japanese/emoji notice cannot split a surrogate pair')
    }
  }
  const blank = buildLoginBonusCard(sample, [{ ...notice('blank'), title: '  ', body: '\n ', date: '' }])
  for (const node of nodes(blank).filter(node => node.type === 'text')) assert.ok(node.text.trim().length > 0)
})

function fixture(t) {
  t.mock.method(Date, 'now', () => Date.parse('2026-09-22T03:00:00.000Z'))
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const migration of [
    '0001_initial_schema.sql', '0002_broadcast_queue.sql', '0004_reply_api_logs.sql',
    '0005_group_metadata_left_at.sql', '0006_othello.sql', '0007_othello_timeout_and_suppress.sql',
    '0012_group_hourly_activity.sql', '0013_announcement_sends.sql', '0015_personalization.sql',
    '0020_exp_last_text.sql', '0021_exp_cooldown.sql', '0022_mentions.sql', '0023_replies.sql',
    '0026_message_points.sql', '0028_login_bonus.sql', '0029_login_bonus_test.sql',
  ]) db.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'))
  const prepare = (sql, args = []) => {
    const execute = () => {
      const statement = db.prepare(sql)
      if (statement.columns().length) return { success: true, results: statement.all(...args).map(row => ({ ...row })), meta: {} }
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
  const env = { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: TOKEN, DB: {
    prepare,
    async batch(statements) {
      db.exec('BEGIN')
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results }
      catch (error) { db.exec('ROLLBACK'); throw error }
    },
  } }
  const replies = []
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    assert.equal(url.origin, 'https://api.line.me', 'all transport stays inside the LINE stub')
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`)
    if (url.pathname === `/v2/bot/group/${GROUP}/member/${USER}` && !init.method) return Response.json({ userId: USER, displayName: 'Fixture user' })
    if (url.pathname === `/v2/bot/group/${GROUP}/summary` && !init.method) return Response.json({ groupId: GROUP, groupName: 'Fixture group' })
    if (url.pathname === '/v2/bot/message/reply' && init.method === 'POST') {
      replies.push(JSON.parse(init.body))
      return Response.json({})
    }
    throw new Error(`Unexpected offline LINE operation: ${url.pathname}`)
  })
  let sequence = 0
  async function sendLogin() {
    sequence += 1
    const body = JSON.stringify({ destination: 'offline-destination', events: [{
      type: 'message', source: { type: 'group', groupId: GROUP, userId: USER },
      replyToken: `offline-reply-${sequence}`, webhookEventId: `offline-event-${sequence}`, timestamp: Date.now(),
      message: { type: 'text', text: 'ログイン', id: `offline-message-${sequence}` },
    }] })
    const waiting = []
    const response = await app.fetch(new Request('https://happamochi.example/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', SECRET).update(body).digest('base64') }, body,
    }), env, { waitUntil(promise) { waiting.push(promise) }, passThroughOnException() {} })
    await Promise.all(waiting)
    assert.equal(response.status, 200)
    assert.deepEqual(db.prepare('SELECT error_message FROM webhook_debug_logs WHERE error_message IS NOT NULL').all(), [], 'a webhook ACK cannot hide a handler failure')
    assert.equal(replies.length, sequence, 'every login emits exactly one Reply API request')
    return replies.at(-1).messages
  }
  return { db, env, replies, sendLogin }
}

test('the handler filters group-only notices in both groups and DMs and repeated login cannot award again', async t => {
  const f = fixture(t)
  const original = ANNOUNCEMENTS.slice()
  t.after(() => ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length, ...original))
  ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length, notice('public'), { ...notice('private'), targetGroupIds: [GROUP] })
  const cases = [
    { groupId: GROUP, expected: ['public', 'private'] },
    { groupId: OTHER_GROUP, expected: ['public'] },
    { groupId: undefined, expected: ['public'] },
  ]
  for (const [index, { groupId, expected }] of cases.entries()) {
    const messages = await handleLoginBonusText(f.env, { userId: USER, isGroup: Boolean(groupId), groupId, eventKey: `handler-login-${index}` }, 'ログイン')
    assert.equal(messages.length, 1)
    assert.deepEqual(previews(messages[0]).map(preview => nodes(preview).find(node => node.type === 'text' && node.text?.startsWith('更新'))?.text), expected.map(value => `更新${value}`))
    if (index === 0) assert.match(texts(bubbles(messages[0])[0]), /今日も来てくれてありがとう！/)
    else assert.match(texts(bubbles(messages[0])[0]), /2026\/09\/22分は受け取り済み/)
  }
  assert.equal(f.db.prepare('SELECT points FROM user_profiles WHERE user_id=?').get(USER).points, 500)
  assert.equal(f.db.prepare("SELECT count(*) n FROM point_ledger WHERE reason='login_bonus'").get().n, 1)
})

test('a signed group login sends notices once beside its receipt and absorbs the queued duplicate without losing other broadcasts', async t => {
  const f = fixture(t)
  f.db.prepare('INSERT INTO pending_broadcasts(group_id,kind,message_json) VALUES(?,?,?)')
    .run(GROUP, 'custom', JSON.stringify([{ type: 'text', text: '別の通知' }]))
  const first = await f.sendLogin()
  assert.equal(first.filter(message => message.type === 'flex').length, 1, 'the automatic full announcement must not be appended after the login carousel')
  assert.equal(first[0].contents.type, 'carousel')
  const eligible = ANNOUNCEMENTS.filter(item => !item.targetGroupIds || item.targetGroupIds.includes(GROUP))
  assert.equal(previews(first[0]).length, Math.min(eligible.length, 11))
  assert.ok(first.some(message => message.type === 'text' && message.text === '別の通知'))
  const queued = f.db.prepare('SELECT kind,delivered FROM pending_broadcasts ORDER BY id').all()
  assert.ok(queued.some(row => row.kind === 'announcement'), 'exercise a real pending automatic announcement')
  assert.ok(queued.every(row => row.delivered === 1), 'the duplicate and ordinary notification are both acknowledged')
  const repeated = await f.sendLogin()
  assert.equal(repeated.length, 1)
  assert.match(texts(bubbles(repeated[0])[0]), /分は受け取り済み/)
  assert.deepEqual(previews(repeated[0]), previews(first[0]), 'notices remain available after claiming the bonus')
  assert.equal(f.db.prepare("SELECT count(*) n FROM point_ledger WHERE reason='login_bonus'").get().n, 1)
})

test('a login with more than eleven notices keeps the automatic announcement pending while other broadcasts still send', async t => {
  const f = fixture(t)
  const original = ANNOUNCEMENTS.slice()
  t.after(() => ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length, ...original))
  ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length, ...Array.from({ length: 15 }, (_, index) => notice(index)))
  f.db.prepare('INSERT INTO pending_broadcasts(group_id,kind,message_json) VALUES(?,?,?)')
    .run(GROUP, 'birthday', JSON.stringify([{ type: 'text', text: '誕生日おめでとう！' }]))
  const messages = await f.sendLogin()
  assert.equal(messages.filter(message => message.type === 'flex').length, 1, 'overflow notices cannot append a taller automatic carousel')
  assert.equal(messages[0].contents.type, 'carousel')
  assert.equal(bubbles(messages[0]).length, 12)
  assert.equal(previews(messages[0]).length, 11)
  assert.ok(messages.some(message => message.type === 'text' && message.text === '誕生日おめでとう！'))
  const pending = f.db.prepare("SELECT delivered FROM pending_broadcasts WHERE kind='announcement'").all()
  assert.ok(pending.length > 0, 'the automatic announcement was actually queued')
  assert.ok(pending.every(row => row.delivered === 0), 'notices omitted from the preview must remain available for a later reply')
  assert.equal(f.db.prepare("SELECT delivered FROM pending_broadcasts WHERE kind='birthday'").get().delivered, 1)
})

test('an unsuccessful login still delivers the pending announcement instead of absorbing content the user never saw', async t => {
  const f = fixture(t)
  f.db.exec('DROP TABLE login_bonus_state')
  const messages = await f.sendLogin()
  assert.equal(messages.filter(message => message.type === 'flex').length, 1)
  assert.equal(messages[0].type, 'text')
  assert.match(messages[0].text, /受け取り結果を確認できませんでした/)
  assert.equal(messages[1].type, 'flex')
  assert.ok(texts(messages[1]).includes(ANNOUNCEMENTS[0].title), 'the queued full notice remains deliverable without a login preview')
  assert.ok(f.db.prepare("SELECT delivered FROM pending_broadcasts WHERE kind='announcement'").all().every(row => row.delivered === 1))
})
