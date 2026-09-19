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
  assert.equal(bubbles(messages[0]).length, 3)
  assertUnboundedContent(messages[0])
  for (const [index, notice] of app.ANNOUNCEMENTS.entries()) {
    const bubble = bubbles(messages[0])[index]
    assert.ok(texts(bubble).includes(notice.title))
    assert.equal(contentText(bodyText(bubble)), notice.body)
    assert.ok(textNodes(bubble).some(node => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(contentText(node))), 'date remains rendered after the complete body')
    const action = bubble.body.contents.find(node => node.action)?.action
    assert.equal(action.type, 'message')
    assert.equal(action.text, index === 0 ? 'ガチャ' : 'ヘルプ')
    assert.equal(action.label, notice.button.label)
  }
  const gacha = texts(bubbles(messages[0])[0])
  for (const required of ['衣装', '背景', '100種類', 'PayPay 1万円分', '2027/9/19']) assert.ok(gacha.includes(required), `${required} must remain visible in the native message`)
  assert.match(texts(bubbles(messages[0])[1]), /めんかく/)
  assert.match(texts(bubbles(messages[0])[1]), /りぷかく/)
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

test('fixing announcement layout keeps sent IDs and prior queues without resending to existing groups', async t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const file of ['0002_broadcast_queue.sql', '0013_announcement_sends.sql']) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  const group = 'C_already_notified_fixture'
  for (const id of [...expectedIds, 'retired_notice_fixture']) db.prepare('INSERT INTO announcement_sends(group_id,announcement_id,sent_at) VALUES(?,?,?)').run(group, id, '2026-09-19 10:00:00')
  db.prepare('INSERT INTO pending_broadcasts(group_id,kind,message_json,dedup_key) VALUES(?,?,?,?)').run(group, 'birthday', '[{"type":"text","text":"Prior pending message"}]', 'unrelated_fixture')
  const snapshot = () => ({ history: db.prepare('SELECT * FROM announcement_sends ORDER BY group_id, announcement_id').all(), queue: db.prepare('SELECT * FROM pending_broadcasts ORDER BY id').all() })
  const prepare = (sql, args = []) => ({
    bind: (...values) => prepare(sql, values),
    async all() { return { results: db.prepare(sql).all(...args) } },
    async run() {
      assert.match(sql.trim(), /^INSERT\s+OR\s+IGNORE\s+INTO\s+(?:announcement_sends|pending_broadcasts)\b/i, 'no clearing existing records')
      const result = db.prepare(sql).run(...args)
      return { success: true, meta: { changes: Number(result.changes) } }
    },
  })
  const env = { DB: { prepare } }
  const before = snapshot()
  await app.checkAndQueueAnnouncements(env, group)
  assert.deepEqual(snapshot(), before)
  await app.checkAndQueueAnnouncements(env, 'C_new_fixture')
  const afterNew = snapshot()
  for (const previous of before.history) assert.deepEqual(afterNew.history.find(row => row.group_id === previous.group_id && row.announcement_id === previous.announcement_id), previous)
  assert.deepEqual(afterNew.queue[0], before.queue[0])
  assert.equal(afterNew.queue.length, before.queue.length + 1)
  assertUnboundedContent(JSON.parse(afterNew.queue.at(-1).message_json)[0])
  await app.checkAndQueueAnnouncements(env, 'C_new_fixture')
  assert.deepEqual(snapshot(), afterNew, 'same stable notice IDs do not enqueue twice')
})
