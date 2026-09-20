// Regression coverage for announcement text clipped by a fixed-height carousel.
// Run: node --test tests/announcements/render.test.mjs
// Actual Flex builders and disposable SQLite only; no LINE/network/live database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundled = await build({
  stdin: {
    contents: `export * from './src/features/announcements.ts';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    sourcefile: 'announcement-render-test.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const app = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const expectedIds = [
  'notice_2026_09_20_read_receipts',
  'notice_2026_09_19_dressup_gacha',
  'notice_2026_09_19_mentions_replies',
  'notice_2026_09_16_games',
]

function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
function contentText(node) {
  return typeof node.text === 'string' ? node.text : (node.contents ?? []).map(contentText).join('')
}
const textNodes = value => nodes(value).filter(node => node.type === 'text')
const texts = value => textNodes(value).map(contentText).join('\n')
const bubbles = message => message.contents.type === 'carousel' ? message.contents.contents : [message.contents]
const bodyText = bubble => bubble.body.contents[0].contents.find(node => node.type === 'text' && node.align !== 'center' && node.align !== 'end')

function assertUnboundedContent(message) {
  assert.equal(message.type, 'flex')
  for (const bubble of bubbles(message)) {
    assert.equal(bubble.type, 'bubble')
    assert.equal(bubble.size, 'kilo', 'retain the established native announcement width')
    assert.ok(Buffer.byteLength(JSON.stringify(bubble)) < 30000)
    const visit = (node, ancestors) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'text') {
        for (const ancestor of [...ancestors, node]) {
          assert.ok(ancestor.height === undefined || ancestor.height === 'auto', `text "${contentText(node).slice(0, 40)}" cannot sit inside a fixed height`)
          assert.ok(ancestor.maxHeight === undefined || ancestor.maxHeight === 'none', `text "${contentText(node).slice(0, 40)}" cannot sit inside a capped height`)
        }
      }
      for (const child of node.contents ?? []) visit(child, [...ancestors, node])
    }
    // Covers the white panel's title/body/date and the action below it.
    visit(bubble.body, [bubble])
    assert.equal(bodyText(bubble).wrap, true)
    for (const span of nodes(bodyText(bubble)).filter(node => node.type === 'span')) {
      assert.equal(span.size, bodyText(bubble).size, 'highlighted and plain span text use the same explicit body font size')
    }
    assert.equal(nodes(bubble).some(node => node.type === 'image'), false, 'announcements remain native text rather than poster images')
  }
}

test('registered notices preserve IDs, prize terms and command actions without a clipping height', () => {
  assert.deepEqual(app.ANNOUNCEMENTS.map(notice => notice.id), expectedIds)
  assert.equal(new Set(expectedIds).size, expectedIds.length)
  const messages = app.getLatestAnnouncementMessages('C_local_review')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].contents.type, 'carousel')
  assert.equal(bubbles(messages[0]).length, 4)
  assertUnboundedContent(messages[0])
  for (const [index, notice] of app.ANNOUNCEMENTS.entries()) {
    const bubble = bubbles(messages[0])[index]
    assert.ok(texts(bubble).includes(notice.title))
    assert.equal(contentText(bodyText(bubble)), notice.body)
    assert.ok(textNodes(bubble).some(node => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(contentText(node))), 'date remains rendered after the complete body')
    const action = bubble.body.contents.find(node => node.action)?.action
    assert.equal(action.type, 'message')
    assert.equal(action.text, ['既読セット', 'ガチャ', 'ヘルプ', 'ヘルプ'][index])
    assert.equal(action.label, notice.button.label)
  }
  const read = texts(bubbles(messages[0])[0])
  for (const required of ['公式アカウント初！', '既読確認が出来るのはこのアカウントだけです。', '既読セット', '既読確認', '日本時間', 'リセット', 'ぜひグループで使ってみてね！']) assert.ok(read.includes(required), `${required} must remain visible in the new first notice`)
  const gacha = texts(bubbles(messages[0])[1])
  for (const required of ['衣装', '背景', '100種類', 'PayPay 1万円分', '2027/9/19']) assert.ok(gacha.includes(required), `${required} must remain visible in the native message`)
  assert.match(texts(bubbles(messages[0])[2]), /めんかく/)
  assert.match(texts(bubbles(messages[0])[2]), /りぷかく/)
})

test('both standalone and mixed-length notices can grow with wrapped body, date and CTA', () => {
  const short = { id: 'fixture_short', title: '短いお知らせ', date: '2027/09/19', body: '短い本文', button: { label: 'ヘルプ', action: { type: 'message', label: 'ヘルプ', text: 'ヘルプ' } } }
  const long = { ...short, id: 'fixture_wrapped', title: '長い本文のお知らせ', body: '画面幅が狭くても賞金と締め切りまで全文が読めることを確認します。'.repeat(12) + '\n期限：2027/9/19' }
  for (const message of [app.buildAnnouncementMessage(short), app.buildAnnouncementMessage(long), app.buildAnnouncementsMessage([short, long])]) {
    assertUnboundedContent(message)
    for (const bubble of bubbles(message)) {
      assert.ok(texts(bubble).includes('2027/09/19'))
      assert.ok(bubble.body.contents.some(node => node.action?.text === 'ヘルプ'))
    }
  }
  assert.equal(contentText(bodyText(bubbles(app.buildAnnouncementMessage(long))[0])), long.body, 'a long logical line is wrapped, never truncated')
})

test('automatic paging retains every long-notice line and its highlight in order', () => {
  const lines = Array.from({ length: 19 }, (_, index) => `確認行${String(index + 1).padStart(2, '0')}：${'内容が折り返しても保持されます。'.repeat(index % 3 + 1)}`)
  lines[17] += ' PayPay 1万円分'
  lines[18] += ' 2027/9/19'
  const message = app.buildAnnouncementMessage({ id: 'fixture_paged', title: '長文のお知らせ', date: '2027/09/19', body: lines.join('\n'), highlightWord: 'PayPay 1万円分' })
  assert.equal(message.contents.type, 'carousel')
  assertUnboundedContent(message)
  const pages = bubbles(message)
  assert.ok(pages.length > 1 && pages.length <= 12)
  assert.deepEqual(pages.flatMap(bubble => contentText(bodyText(bubble)).split('\n')), lines)
  for (const [index, bubble] of pages.entries()) {
    assert.ok(contentText(bodyText(bubble)).split('\n').length <= 6)
    assert.ok(texts(bubble).includes(`長文のお知らせ（${index + 1}/${pages.length}）`))
  }
  assert.equal(nodes(message).filter(node => node.type === 'span' && node.text === 'PayPay 1万円分' && node.weight === 'bold').length, 1)
})

function fixture(t, hooks = {}) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const file of ['0002_broadcast_queue.sql', '0013_announcement_sends.sql']) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  const snapshot = () => ({ history: db.prepare('SELECT * FROM announcement_sends ORDER BY group_id, announcement_id').all(), queue: db.prepare('SELECT * FROM pending_broadcasts ORDER BY id').all() })
  const prepare = (sql, args = []) => ({
    sql, args,
    bind: (...values) => prepare(sql, values),
    async all() {
      const results = db.prepare(sql).all(...args)
      await hooks.afterRead?.()
      return { results }
    },
    async run() {
      const result = db.prepare(sql).run(...args)
      return { success: true, meta: { changes: Number(result.changes) } }
    },
  })
  const env = { DB: {
    prepare,
    async batch(statements) {
      // D1 batch is atomic. Execute synchronously here so another caller cannot
      // enter the same SQLite connection in the middle of this transaction.
      db.exec('BEGIN')
      try {
        const results = statements.map((statement, index) => {
          hooks.beforeStatement?.(statement, index)
          const result = db.prepare(statement.sql).run(...statement.args)
          return { success: true, meta: { changes: Number(result.changes) } }
        })
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  } }
  const addHistory = (group, ids) => {
    for (const id of ids) db.prepare('INSERT INTO announcement_sends(group_id,announcement_id,sent_at) VALUES(?,?,?)').run(group, id, '2026-09-19 10:00:00')
  }
  const addQueue = (group, key, kind = 'announcement', delivered = 0) => {
    const result = db.prepare('INSERT INTO pending_broadcasts(group_id,kind,message_json,dedup_key,delivered) VALUES(?,?,?,?,?)').run(group, kind, '[{"type":"text","text":"Prior pending message"}]', key, delivered)
    return Number(result.lastInsertRowid)
  }
  return { db, env, snapshot, addHistory, addQueue }
}

const editionIds = () => expectedIds.map(id => `${app.ANNOUNCEMENT_DELIVERY_EDITION}:${id}`)
const currentQueue = row => row.dedup_key?.startsWith(`announcement_${app.ANNOUNCEMENT_DELIVERY_EDITION}_`)

test('authorized delivery edition reannounces once while preserving historical records and other group data', async t => {
  const { env, snapshot, addHistory, addQueue } = fixture(t)
  const group = 'C_already_notified_fixture'
  assert.equal(app.ANNOUNCEMENT_DELIVERY_EDITION, '20260920_read_v1')
  addHistory(group, [...expectedIds.slice(1), 'retired_notice_fixture'])
  addHistory('C_other_fixture', expectedIds.slice(1))
  const oldPending = addQueue(group, 'announcement_old_pending')
  const oldNullKey = addQueue(group, null)
  addQueue(group, 'announcement_already_sent', 'announcement', 1)
  addQueue(group, 'announcement_in_flight', 'announcement', 2)
  addQueue(group, 'unrelated_fixture', 'birthday')
  addQueue('C_other_fixture', 'announcement_other_group')
  const before = snapshot()
  await app.checkAndQueueAnnouncements(env, group)
  const after = snapshot()
  for (const previous of before.history) assert.deepEqual(after.history.find(row => row.group_id === previous.group_id && row.announcement_id === previous.announcement_id), previous)
  for (const previous of before.queue) {
    const expected = [oldPending, oldNullKey].includes(previous.id) ? { ...previous, delivered: 3 } : previous
    assert.deepEqual({ ...after.queue.find(row => row.id === previous.id) }, { ...expected }, 'only this group\'s old unsent announcement is superseded')
  }
  assert.deepEqual(after.history.filter(row => row.group_id === group && editionIds().includes(row.announcement_id)).map(row => row.announcement_id).sort(), editionIds().sort())
  assert.equal(after.queue.length, before.queue.length + 1)
  const queued = after.queue.find(currentQueue)
  assert.equal(queued.group_id, group)
  assert.equal(queued.delivered, 0)
  const message = JSON.parse(queued.message_json)[0]
  assertUnboundedContent(message)
  assert.equal(bubbles(message).length, 4)
  assert.match(texts(bubbles(message)[0]), /公式アカウント初！/)
  await app.checkAndQueueAnnouncements(env, group)
  assert.deepEqual(snapshot(), after, 'the authorized edition queues only once even for a previously notified group')
})

test('new groups receive all current notices once, and rereading notices does not change automatic history', async t => {
  const { env, snapshot } = fixture(t)
  const group = 'C_new_fixture'
  await app.checkAndQueueAnnouncements(env, group)
  const first = snapshot()
  assert.equal(first.queue.length, 1)
  assert.equal(first.history.length, expectedIds.length)
  assert.ok(currentQueue(first.queue[0]))
  assert.deepEqual(first.history.map(row => row.announcement_id).sort(), editionIds().sort())
  assert.equal(bubbles(JSON.parse(first.queue[0].message_json)[0]).length, 4)
  assert.equal(bubbles(app.getLatestAnnouncementMessages(group)[0]).length, 4)
  await app.checkAndQueueAnnouncements(env, group)
  await app.checkAndQueueAnnouncements(env, group)
  assert.deepEqual(snapshot(), first)
  await app.checkAndQueueAnnouncements(env, 'C_second_fixture')
  assert.equal(snapshot().queue.length, 2, 'the once-only reservation is independent per group')
})

test('simultaneous messages reserve only one announcement queue after reading the same unsent history', async t => {
  let arrivals = 0
  let release
  const bothRead = new Promise(resolve => { release = resolve })
  const { env, snapshot } = fixture(t, { afterRead: async () => {
    if (++arrivals === 2) release()
    await bothRead
  } })
  await Promise.all([
    app.checkAndQueueAnnouncements(env, 'C_concurrent_fixture'),
    app.checkAndQueueAnnouncements(env, 'C_concurrent_fixture'),
  ])
  assert.equal(arrivals, 2)
  assert.equal(snapshot().queue.length, 1)
  assert.equal(snapshot().history.length, expectedIds.length)
  assert.ok(currentQueue(snapshot().queue[0]))
})

test('a failed history write rolls back old-queue replacement, new queue and earlier history writes together', async t => {
  let shouldFail = true
  let historyStatements = 0
  const { env, snapshot, addHistory, addQueue } = fixture(t, { beforeStatement: statement => {
    if (/INSERT OR IGNORE INTO announcement_sends/.test(statement.sql) && ++historyStatements === 2 && shouldFail) {
      throw new Error('fixture history write failure')
    }
  } })
  const group = 'C_rollback_fixture'
  addHistory(group, expectedIds.slice(1))
  addQueue(group, 'announcement_previous_pending')
  const before = snapshot()
  await assert.rejects(app.checkAndQueueAnnouncements(env, group), /fixture history write failure/)
  assert.deepEqual(snapshot(), before, 'no history or queue mutation survives a failed D1 batch')
  shouldFail = false
  await app.checkAndQueueAnnouncements(env, group)
  assert.equal(snapshot().queue.filter(currentQueue).length, 1, 'a later retry can still reserve the edition')
  assert.equal(snapshot().queue[0].delivered, 3)
  assert.equal(snapshot().history.length, before.history.length + expectedIds.length)
})
