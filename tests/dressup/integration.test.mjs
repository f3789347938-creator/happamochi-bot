// Offline integration tests: actual command handlers + SQL + LINE Flex + public HTML.
// Run: node --test tests/dressup/integration.test.mjs (Node 22+ with node:sqlite).
// No live LINE API, credentials, persistent database, or external messaging is used.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundled = await build({
  stdin: {
    contents: `
      export { handleProfileText, handleProfilePostback } from './src/features/profile/index.ts';
      export { renderPersonalRankingPage, renderPublicStatusPage } from './src/features/profile/page.ts';
      export { buildRankingCarousel } from './src/features/rankingCards.ts';
      export { getAppearance, listOwnedCosmeticIds, GACHA_COST } from './src/features/dressup/store.ts';
      export { COSMETICS, DEFAULT_COSTUME, DEFAULT_BACKGROUND, getCosmetic } from './src/features/dressup/catalog.ts';
    `,
    resolveDir: root, sourcefile: 'dressup-integration-entry.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const app = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

const BASE = 'https://mochi.example'
const A = 'U_private_alice_00000000000000001'
const B = 'U_private_bob_0000000000000000002'
const C = 'U_private_charlie_000000000000003'
const D = 'U_private_dora_000000000000000004'
const users = [A, B, C, D]
const names = ['Alice', 'Bob', 'Charlie', 'Dora']
const publicIds = ['publicalice0001', 'publicbob00002', 'publiccharlie3', 'publicdora0004']

function fixture(t, { dressup = true, points = 15225 } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const migrations = ['0015_personalization.sql', '0018_mochi_scores.sql', '0019_survivor.sql']
  if (dressup) migrations.push('0024_dressup.sql')
  for (const file of migrations) sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  const prepare = (query, bindings = []) => ({
    bind: (...values) => prepare(query, values),
    async first(column) {
      const row = sqlite.prepare(query).get(...bindings)
      return row ? (column ? row[column] : { ...row }) : null
    },
    async all() {
      return { success: true, results: sqlite.prepare(query).all(...bindings).map((row) => ({ ...row })), meta: {} }
    },
    async run() {
      const result = sqlite.prepare(query).run(...bindings)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    },
  })
  const DB = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  const exp = [3840, 3260, 2980, 2460]
  users.forEach((id, index) => {
    sqlite.prepare(`INSERT INTO user_profiles
      (user_id, public_id, display_name, picture_url, total_exp, points)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, publicIds[index], names[index], `https://avatar.example/${index}.png`, exp[index], points)
  })
  t.after(() => sqlite.close())
  const env = { DB }
  const context = (userId = A) => {
    const index = users.indexOf(userId)
    return { userId, displayName: names[index], pictureUrl: `https://avatar.example/${index}.png`, baseUrl: BASE }
  }
  const text = async (command, userId = A) => {
    const messages = await app.handleProfileText(env, context(userId), command)
    validateMessages(messages)
    return messages
  }
  const postback = async (data, userId = A) => {
    const messages = await app.handleProfilePostback(env, context(userId), data)
    validateMessages(messages)
    return messages
  }
  const balance = (userId = A) => sqlite.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(userId).points
  const snapshot = () => JSON.stringify({
    profiles: sqlite.prepare('SELECT * FROM user_profiles ORDER BY user_id').all(),
    inventory: dressup ? sqlite.prepare('SELECT * FROM dressup_inventory ORDER BY user_id, item_id').all() : [],
    appearance: dressup ? sqlite.prepare('SELECT * FROM dressup_appearances ORDER BY user_id').all() : [],
    ledger: sqlite.prepare('SELECT * FROM point_ledger ORDER BY id').all(),
  })
  return { env, sqlite, context, text, postback, balance, snapshot }
}

function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
const texts = (value) => nodes(value).filter((node) => node.type === 'text').map((node) => node.text).join('\n')
const actions = (value) => nodes(value).filter((node) => node.type === 'postback' || node.type === 'uri')
const images = (value) => nodes(value).filter((node) => node.type === 'image')
const actionFor = (value, label) => {
  const action = actions(value).find((node) => node.label === label)
  assert.ok(action, `Missing action: ${label}`)
  return action.data
}

function validateMessages(messages) {
  assert.ok(Array.isArray(messages), 'recognized command returns message array')
  assert.ok(messages.length <= 5, 'LINE permits at most five reply messages')
  for (const message of messages) {
    if (message.type !== 'flex') continue
    assert.ok(message.altText && message.altText.length <= 400)
    if (message.contents.type === 'carousel') assert.ok(message.contents.contents.length <= 12)
    for (const bubble of nodes(message).filter((node) => node.type === 'bubble')) {
      assert.ok(Buffer.byteLength(JSON.stringify(bubble)) < 30000, 'each Flex bubble fits 30 KB')
    }
    for (const image of images(message)) {
      assert.equal(image.width, undefined, 'LINE Flex image.width is invalid')
      assert.match(image.url, /^https:\/\//)
      assert.ok(image.url.length <= 2000)
    }
    for (const action of actions(message)) {
      if (action.type === 'postback') assert.ok(action.data.length <= 300)
      if (action.type === 'uri') assert.match(action.uri, /^https:\/\//)
    }
  }
  const output = JSON.stringify(messages)
  for (const user of users) assert.ok(!output.includes(user), 'no private LINE user IDs in replies or asset URLs')
}

test('status and wardrobe use catalog appearance while preserving card themes and cumulative EXP', async (t) => {
  const f = fixture(t)
  const before = f.snapshot()
  const status = await f.text('ステータス')
  assert.ok(images(status).some((image) => image.url.includes('/dressup-art/C000/BG000.png')))
  assert.match(texts(status), /15,225/)
  assert.ok(actions(status).some((action) => action.data === 'pf|dress|home'))
  const wardrobe = await f.text('着せ替え')
  assert.match(texts(wardrobe), /衣装120種＋背景30種/)
  assert.ok(actions(wardrobe).some((action) => action.data === 'pf|themes'))
  assert.ok(actions(wardrobe).some((action) => action.data === 'pf|dress|gacha'))
  assert.match(texts(await f.text('カードテーマ')), /水色/)
  assert.match(texts(await f.postback('pf|themes')), /水色/)
  assert.equal(f.snapshot(), before)
  assert.equal(await app.handleProfileText(f.env, f.context(), 'こんにちは'), null)
  assert.equal(await app.handleProfileText(f.env, { ...f.context(), userId: null }, 'ガチャ'), null)
})

test('confirmation matches 3,000-point Yes/No UI; cancel invalidates previously copied Yes', async (t) => {
  const f = fixture(t)
  const before = f.snapshot()
  const confirmation = await f.text('ガチャ')
  assert.equal(app.GACHA_COST, 3000)
  assert.match(texts(confirmation), /3,000ポイント/)
  assert.match(texts(confirmation), /15,225/)
  assert.match(texts(confirmation), /未所持150点/)
  assert.match(texts(confirmation), /0\.6667%/)
  const yes = actionFor(confirmation, 'Yes')
  const no = actionFor(confirmation, 'No')
  assert.equal(yes.split('|').at(-1), no.split('|').at(-1))
  assert.equal(f.snapshot(), before, 'opening confirmation does not consume points or grant items')
  assert.match(texts(await f.postback(no)), /キャンセルしました/)
  assert.match(texts(await f.postback(yes)), /キャンセル済み/)
  assert.equal(f.snapshot(), before)
})

test('actual Yes grants once, charges exactly 3,000, and changes appearance only after equip', async (t) => {
  const f = fixture(t)
  const confirmation = await f.text('きせかえガチャ')
  const yes = actionFor(confirmation, 'Yes')
  const result = await f.postback(yes)
  assert.equal(f.balance(), 12225)
  assert.match(texts(result), /消費 3,000 P ／ 残高 12,225 P/)
  assert.deepEqual(await app.getAppearance(f.env, A), { costumeId: 'C000', backgroundId: 'BG000' })
  const obtained = f.sqlite.prepare('SELECT item_id FROM dressup_inventory WHERE user_id = ?').get(A).item_id
  assert.ok(app.getCosmetic(obtained))
  assert.match(texts(result), new RegExp(app.getCosmetic(obtained).name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(texts(await f.postback(yes)), /処理済み/)
  assert.equal(f.balance(), 12225)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS c FROM point_ledger').get().c, 1)
  await f.postback(actionFor(result, 'さっそく着せ替える'))
  const appearance = await app.getAppearance(f.env, A)
  const field = app.getCosmetic(obtained).kind === 'costume' ? 'costumeId' : 'backgroundId'
  assert.equal(appearance[field], obtained)
  const status = await f.postback('pf|status')
  assert.ok(images(status).some((image) => image.url.includes(`/dressup-art/${appearance.costumeId}/${appearance.backgroundId}.png`)))
  assert.equal(f.balance(), 12225, 'equipping is free')
})

test('insufficient balance hides Yes and rejects a forged draw without mutation', async (t) => {
  const f = fixture(t, { points: 2999 })
  const before = f.snapshot()
  const confirmation = await f.text('着せ替えガチャ')
  assert.match(texts(confirmation), /あと1ポイント必要/)
  assert.ok(!actions(confirmation).some((action) => action.data?.startsWith('pf|dress|draw|')))
  const token = actionFor(confirmation, '戻る').split('|').at(-1)
  const result = await f.postback(`pf|dress|draw|${token}`)
  assert.match(texts(result), /ポイントが足りない/)
  assert.equal(f.snapshot(), before)
})

test('another user cannot confirm or cancel someone else’s draw', async (t) => {
  const f = fixture(t)
  const confirmation = await f.text('ガチャ', A)
  const before = f.snapshot()
  assert.match(texts(await f.postback(actionFor(confirmation, 'Yes'), B)), /別の方/)
  assert.match(texts(await f.postback(actionFor(confirmation, 'No'), B)), /別の方/)
  assert.equal(f.snapshot(), before)
  await f.postback(actionFor(confirmation, 'Yes'), A)
  assert.equal(f.balance(A), 12225)
  assert.equal(f.balance(B), 15225)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS c FROM dressup_inventory WHERE user_id = ?').get(B).c, 0)
})

test('unowned costume and background previews are read-only; forged equip is rejected', async (t) => {
  const f = fixture(t)
  const before = f.snapshot()
  for (const item of ['C001', 'BG001']) {
    const preview = await f.postback(`pf|dress|preview|${item}`)
    assert.match(texts(preview), /プレビュー/)
    assert.match(texts(preview), /未所持/)
    assert.ok(!actions(preview).some((action) => action.data === `pf|dress|equip|${item}`))
    assert.match(texts(await f.postback(`pf|dress|equip|${item}`)), /まだ持っていない/)
  }
  assert.match(texts(await f.text('衣装装備 C001')), /まだ持っていない/)
  assert.match(texts(await f.text('背景装備 BG001')), /まだ持っていない/)
  assert.match(texts(await f.text('衣装装備 BG001')), /見つかりません/)
  assert.match(texts(await f.postback('pf|dress|preview|../../secret')), /見つかりません/)
  assert.match(texts(await f.postback('pf|dress|draw|fake-token')), /無効/)
  assert.equal(f.snapshot(), before)
})

test('inventory ownership is per-user and equipped costume/background are independent', async (t) => {
  const f = fixture(t)
  f.sqlite.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)').run(A, 'C001')
  f.sqlite.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)').run(A, 'BG001')
  const before = f.snapshot()
  const preview = await f.postback('pf|dress|preview|C001', A)
  assert.equal(actionFor(preview, 'これを装備する'), 'pf|dress|equip|C001')
  assert.equal(f.snapshot(), before)
  await f.text('衣装装備 C001', A)
  await f.text('背景装備 BG001', A)
  assert.deepEqual(await app.getAppearance(f.env, A), { costumeId: 'C001', backgroundId: 'BG001' })
  assert.match(texts(await f.postback('pf|dress|equip|C001', B)), /まだ持っていない/)
  assert.deepEqual(await app.getAppearance(f.env, B), { costumeId: 'C000', backgroundId: 'BG000' })
  await f.postback('pf|dress|equip|C000', A)
  assert.deepEqual(await app.getAppearance(f.env, A), { costumeId: 'C000', backgroundId: 'BG001' })
  assert.equal(f.balance(A), 15225)
})

test('catalogs clamp invalid pages and never make unowned equipment selectable', async (t) => {
  const f = fixture(t)
  for (const [kind, count, last] of [['costume', 121, 21], ['background', 31, 6]]) {
    for (const [requested, expected] of [['NaN', 1], ['Infinity', 1], ['-20', 1], ['0', 1], ['999999', last], ['3.5', 3]]) {
      const reply = await f.postback(`pf|dress|list|${kind}|all|${requested}`)
      assert.match(texts(reply), new RegExp(`${expected} / ${last} ページ`))
      assert.match(texts(reply), new RegExp(`すべてのアイテム：${count}点`))
      assert.ok(reply[0].contents.contents.length <= 7)
      assert.ok(!actions(reply).some((action) => /^pf\|dress\|equip\|(?:C(?!000)|BG(?!000))/.test(action.data ?? '')))
    }
    const owned = await f.postback(`pf|dress|list|${kind}|owned|1`)
    assert.match(texts(owned), /所持アイテム：1点/)
  }
  await f.text('衣装一覧')
  await f.text('背景一覧')
})

test('complete collection never opens a paid draw or changes the balance', async (t) => {
  const f = fixture(t)
  f.sqlite.prepare(`INSERT INTO dressup_inventory (user_id, item_id)
    SELECT ?, item_id FROM dressup_catalog WHERE is_default = 0`).run(A)
  const before = f.snapshot()
  assert.match(texts(await f.text('ガチャ')), /すべて入手済み/)
  assert.equal(f.snapshot(), before)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS c FROM dressup_confirmations').get().c, 0)
})

test('LINE ranking retains cumulative EXP, three rows/cards and original game scoring/images', async (t) => {
  const f = fixture(t)
  f.sqlite.prepare(`INSERT INTO mochi_scores (user_id, display_name, picture_url, best_score, best_merges, plays)
    VALUES (?, 'Puzzle Player', 'https://avatar.example/puzzle.png', 5000, 42, 1)`).run(A)
  f.sqlite.prepare(`INSERT INTO survivor_players (user_id, display_name, picture_url, best_score, best_seconds, plays, created_at)
    VALUES (?, 'Survivor Player', 'https://avatar.example/survivor.png', 900, 125, 1, 1)`).run(A)
  f.sqlite.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)').run(A, 'C001')
  await f.postback('pf|dress|equip|C001')
  f.sqlite.prepare('UPDATE user_profiles SET total_exp = 3260 WHERE user_id = ?').run(C)
  const before = f.snapshot()
  const message = await app.buildRankingCarousel(f.env, BASE, A)
  validateMessages([message])
  assert.equal(message.contents.type, 'carousel')
  assert.equal(message.contents.contents.length, 3)
  const [personal, puzzle, survivor] = message.contents.contents
  const rows = personal.body.contents.filter((node) => node.type === 'box')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((row) => row.contents[0].contents[0].text), ['1', '2', '2'])
  assert.deepEqual(rows.map((row) => row.contents[2].contents[0].text), ['Alice', 'Bob', 'Charlie'])
  assert.match(texts(personal), /累計 3,840 EXP/)
  assert.ok(!texts(personal).includes('週間'))
  assert.ok(images(personal).some((image) => image.url.includes('/dressup-art/C001/BG000.png')))
  assert.ok(actions(personal).some((action) => action.data === 'pf|status'))
  assert.match(texts(puzzle), /5,000 点 ・ 42 回合体/)
  assert.match(texts(survivor), /900 pt ・ 2:05 生存/)
  assert.equal(images(puzzle)[0].url, 'https://avatar.example/puzzle.png')
  assert.equal(images(survivor)[0].url, 'https://avatar.example/survivor.png')
  assert.equal(f.snapshot(), before)
})

test('public pages show equipped artwork, escape display names and never expose LINE IDs', async (t) => {
  const f = fixture(t)
  for (const item of ['C001', 'BG001']) {
    f.sqlite.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)').run(A, item)
    await f.postback(`pf|dress|equip|${item}`)
  }
  const maliciousName = '<img src=x onerror="alert(1)">'
  f.sqlite.prepare('UPDATE user_profiles SET display_name = ? WHERE user_id = ?').run(maliciousName, A)
  const before = f.snapshot()
  const ranking = await app.renderPersonalRankingPage(f.env, BASE)
  const status = await app.renderPublicStatusPage(f.env, BASE, publicIds[0])
  assert.equal(status.found, true)
  for (const html of [ranking, status.html]) {
    assert.ok(html.includes('/dressup-art/C001/BG001.png'))
    assert.ok(!html.includes(maliciousName))
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'))
    for (const user of users) assert.ok(!html.includes(user))
  }
  assert.match(ranking, /累計EXPの多い順/)
  assert.ok(ranking.includes(`/u/${publicIds[0]}`))
  assert.ok(status.html.includes(app.getCosmetic('C001').name))
  assert.ok(status.html.includes(app.getCosmetic('BG001').name))
  assert.match(status.html, /<dt>衣装<\/dt>/)
  assert.match(status.html, /<dt>背景<\/dt>/)
  assert.equal((await app.renderPublicStatusPage(f.env, BASE, 'missing-public')).found, false)
  assert.equal(f.snapshot(), before)
})

test('before additive migration, public ranking/status retain legacy avatars and existing data', async (t) => {
  const f = fixture(t, { dressup: false })
  const before = f.snapshot()
  const statusMessage = await f.text('ステータス')
  assert.ok(images(statusMessage).some((image) => image.url === 'https://avatar.example/0.png'))
  const ranking = await app.buildRankingCarousel(f.env, BASE, A)
  validateMessages([ranking])
  assert.equal(images(ranking.contents.contents[0])[0].url, 'https://avatar.example/0.png')
  const page = await app.renderPersonalRankingPage(f.env, BASE)
  const status = await app.renderPublicStatusPage(f.env, BASE, publicIds[0])
  assert.ok(page.includes('https://avatar.example/0.png'))
  assert.ok(status.html.includes('https://avatar.example/0.png'))
  assert.equal(status.found, true)
  assert.equal(f.snapshot(), before)
})
