// Offline point-award regressions: real message handler SQL, isolated SQLite.
// Run: node --test tests/profile/message-points.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundled = await build({
  stdin: {
    contents: `export { addExpForMessage, EXP_COOLDOWN_SECONDS } from './src/features/profile/core.ts'; export { analyzePointText, areSimilarPointTexts } from './src/features/profile/messagePoints.ts';`,
    resolveDir: root, sourcefile: 'message-points-test.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const app = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const A = 'U_points_alice'
const B = 'U_points_bob'
const GROUP = 'C_points_room_one'
const OTHER_GROUP = 'C_points_room_two'
const content = (length, offset = 0) => Array.from({ length }, (_, index) => String.fromCodePoint(0x4e00 + offset + index)).join('')

function fixture(t, { points = 15225, exp = 3840 } = {}) {
  const db = new DatabaseSync(':memory:')
  const migrations = ['0001_initial_schema.sql', '0015_personalization.sql', '0020_exp_last_text.sql', '0021_exp_cooldown.sql', '0026_message_points.sql']
  for (const file of migrations) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  for (const [user, publicId, name] of [[A, 'public-points-alice', 'Alice'], [B, 'public-points-bob', 'Bob']]) {
    db.prepare('INSERT INTO user_profiles(user_id,public_id,display_name,picture_url,total_exp,points,active_theme,equipped_title) VALUES(?,?,?,?,?,?,?,?)')
      .run(user, publicId, name, `https://avatar.example/${publicId}.png`, exp, points, 'black', 'existing-title')
  }
  const prepare = (sql, args = []) => {
    const execute = () => {
      const result = db.prepare(sql).run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return {
      bind: (...values) => prepare(sql, values), execute,
      async first(column) { const row = db.prepare(sql).get(...args); return row ? column ? row[column] : { ...row } : null },
      async all() { return { success: true, results: db.prepare(sql).all(...args).map(row => ({ ...row })), meta: {} } },
      async run() { return execute() },
    }
  }
  const env = { DB: { prepare, async batch(statements) {
    // Keep the complete batch synchronous, matching D1's transactional execution.
    db.exec('BEGIN')
    try { const result = statements.map(statement => statement.execute()); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  } } }
  t.after(() => db.close())
  const profile = (user = A) => ({ ...db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user) })
  const send = async (event, message, context = {}, user = A) => {
    const result = await app.addExpForMessage(env, user, event, null, null, message, context)
    assert.equal(db.prepare('SELECT count(*) n FROM exp_events WHERE points_delta < 0 OR points_delta > 10').get().n, 0, 'no pending or out-of-range award receipt escapes the transaction')
    return result
  }
  const age = (user = A, seconds = 6) => db.prepare("UPDATE exp_last_message SET last_exp_at = strftime('%Y-%m-%d %H:%M:%f','now',?) WHERE user_id = ?").run(`-${seconds} seconds`, user)
  const quote = (id, sender = B, group = GROUP) => db.prepare('INSERT INTO group_messages(group_id,message_id,user_id,message_text) VALUES(?,?,?,?)').run(group, id, sender, 'Original message')
  const snapshot = () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name").all()
    return JSON.stringify(Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])))
  }
  return { db, env, profile, send, age, quote, snapshot }
}

test('the additive receipt migration preserves historical EXP, balances and deduplication state', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const file of ['0015_personalization.sql', '0020_exp_last_text.sql', '0021_exp_cooldown.sql']) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
  db.prepare('INSERT INTO user_profiles(user_id,public_id,total_exp,points,active_theme) VALUES(?,?,?,?,?)').run(A, 'legacy-public', 345678, 12345, 'sakura')
  db.prepare('INSERT INTO exp_events(event_key,user_id,created_at) VALUES(?,?,?)').run('legacy-message', A, '2026-09-01 10:00:00')
  db.prepare('INSERT INTO exp_last_message(user_id,last_text,last_exp_at,updated_at) VALUES(?,?,?,?)').run(A, '以前の発言', '2026-09-01 10:00:00.123', '2026-09-01 10:00:00')
  const before = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(A)
  db.exec(readFileSync(new URL('../../migrations/0026_message_points.sql', import.meta.url), 'utf8'))
  assert.deepEqual(db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(A), before)
  const legacyReceipt = db.prepare('SELECT * FROM exp_events WHERE event_key = ?').get('legacy-message')
  assert.equal(legacyReceipt.user_id, A)
  assert.equal(legacyReceipt.created_at, '2026-09-01 10:00:00')
  assert.equal(legacyReceipt.points_delta, 0, 'previous events do not receive retroactive variable points')
  const state = db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A)
  assert.equal(state.last_text, '以前の発言')
  assert.equal(state.last_exp_at, '2026-09-01 10:00:00.123')
})

test('meaningful text length earns the published point tiers at every boundary', async t => {
  const boundaries = [[1, 1], [9, 1], [10, 2], [29, 2], [30, 3], [79, 3], [80, 5], [149, 5], [150, 8]]
  const f = fixture(t)
  for (const [index, [length, points]] of boundaries.entries()) {
    const message = content(length, index * 200)
    const analysis = app.analyzePointText(message)
    assert.equal(analysis.effectiveLength, length)
    assert.equal(analysis.basePoints, points)
    f.age()
    const before = f.profile()
    await f.send(`threshold-${length}`, message)
    assert.equal(f.profile().points - before.points, points, `${length} meaningful characters`)
    assert.equal(f.profile().total_exp - before.total_exp, 1, 'points vary but EXP remains one per awarded message')
    const receipt = f.db.prepare('SELECT points_delta, exp_before FROM exp_events WHERE event_key = ?').get(`threshold-${length}`)
    assert.equal(receipt.points_delta, points)
    assert.equal(receipt.exp_before, before.total_exp)
  }
})

test('Unicode letters count as visible characters, and whitespace, URLs, emojis and repeated patterns cannot pad the reward', () => {
  assert.equal(app.analyzePointText('ＡＢＣＤＥＦＧＨＩＪ').effectiveLength, 10)
  assert.equal(app.analyzePointText('ＡＢＣＤＥＦＧＨＩＪ').basePoints, 2)
  const astralLetters = Array.from({ length: 9 }, (_, index) => String.fromCodePoint(0x20000 + index)).join('')
  assert.equal(astralLetters.length, 18, 'fixture has surrogate pairs')
  assert.equal(app.analyzePointText(astralLetters).effectiveLength, 9)
  assert.equal(app.analyzePointText(astralLetters).basePoints, 1)
  assert.equal(app.analyzePointText('a\u0301b\u0301c\u0301d\u0301e\u0301f\u0301g\u0301h\u0301i\u0301').effectiveLength, 9)
  const actual = content(9)
  const padded = `  ${[...actual].join(' \t\n\u200b')} https://example.com/${'path-segment'.repeat(40)} ${'😀'.repeat(150)}   `
  assert.equal(app.analyzePointText(padded).basePoints, 1)
  assert.equal(app.analyzePointText(padded).effectiveLength, 9)
  for (const unit of ['あ', 'あいうえお', '0123456789']) {
    assert.equal(app.analyzePointText(unit.repeat(40)).basePoints, app.analyzePointText(unit).basePoints, `repeating ${unit} does not raise its tier`)
  }
  for (const symbols of ['😀'.repeat(150), '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣', '!!! ... ！！！']) {
    assert.equal(app.analyzePointText(symbols).effectiveLength, 0)
    assert.equal(app.analyzePointText(symbols).basePoints, 1)
  }
})

test('near-duplicate detection tolerates edits to long text without treating unrelated or short messages alike', () => {
  const normalize = value => app.analyzePointText(value).normalizedText
  assert.equal(app.areSimilarPointTexts(normalize('今日は公園で友達とサッカーをして遊びました。'), normalize('今日は 公園で友達とサッカーをして遊びました！')), true)
  assert.equal(app.areSimilarPointTexts(normalize(content(80)), normalize(content(79) + '語')), true)
  assert.equal(app.areSimilarPointTexts(normalize(content(80)), normalize(content(80, 500))), false)
  assert.equal(app.areSimilarPointTexts(normalize('ありがとう'), normalize('ありがとね')), false)
  assert.equal(app.areSimilarPointTexts(null, null), false)
})

test('identical or nearly identical text earns neither points nor EXP even after cooldown', async t => {
  const f = fixture(t)
  const before = f.profile()
  await f.send('similar-initial', content(80))
  f.age()
  const awardedState = f.db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A)
  await f.send('similar-punctuation', content(80) + '！')
  assert.deepEqual(f.db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A), awardedState)
  await f.send('similar-one-edit', content(79) + '語')
  assert.deepEqual(f.db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A), awardedState, 'similarity rejection preserves the last awarded text and time')
  assert.equal(f.profile().points - before.points, 5)
  assert.equal(f.profile().total_exp - before.total_exp, 1)
  f.age()
  await f.send('unrelated-text', content(80, 500))
  assert.equal(f.profile().points - before.points, 10)
  assert.equal(f.profile().total_exp - before.total_exp, 2)
})

test('changing emoji or symbol padding cannot turn the same meaningful body into a new reward', async t => {
  const f = fixture(t)
  const body = content(150)
  const emojiA = Array.from({ length: 24 }, (_, index) => String.fromCodePoint(0x1f600 + index)).join('')
  const emojiB = Array.from({ length: 24 }, (_, index) => String.fromCodePoint(0x1f680 + index)).join('')
  const symbols = '+−×÷=≠≈∞√∑∏∫∂∆∇∈∉⊂⊃∪∩⊕⊗⊥'
  const variants = [body + emojiA, emojiB + body, body + symbols, Array.from(body).join('😀')]
  const before = f.profile()
  await f.send('padding-original', body)
  for (const [index, padded] of variants.entries()) {
    const analysis = app.analyzePointText(padded)
    assert.equal(analysis.normalizedText, app.analyzePointText(body).normalizedText, 'nonmeaningful decorations do not change a text duplicate key')
    assert.equal(analysis.effectiveLength, 150)
    assert.equal(analysis.basePoints, 8)
    f.age()
    await f.send(`padding-variant-${index}`, padded)
    assert.equal(f.profile().points - before.points, 8)
    assert.equal(f.profile().total_exp - before.total_exp, 1)
    assert.equal(f.db.prepare('SELECT points_delta FROM exp_events WHERE event_key = ?').get(`padding-variant-${index}`).points_delta, 0)
  }
})

test('media earns one point and one EXP without replacing existing balances, theme or title', async t => {
  const f = fixture(t)
  const before = f.profile()
  await f.send('media-first', null)
  const after = f.profile()
  assert.equal(after.points, before.points + 1)
  assert.equal(after.total_exp, before.total_exp + 1)
  for (const key of ['public_id', 'display_name', 'picture_url', 'active_theme', 'equipped_title']) assert.equal(after[key], before[key])
  f.age()
  await f.send('media-next', undefined)
  assert.equal(f.profile().points, before.points + 2)
  assert.equal(f.profile().total_exp, before.total_exp + 2)
})

test('reply bonus requires a known different sender in the same group and respects the ten-point maximum', async t => {
  const f = fixture(t)
  f.quote('other-message')
  f.quote('own-message', A)
  f.quote('other-room-message', B, OTHER_GROUP)
  const cases = [
    ['reply', { groupId: GROUP, quotedMessageId: 'other-message' }, 10, 150],
    ['short-reply', { groupId: GROUP, quotedMessageId: 'other-message' }, 3, 9],
    ['media-reply', { groupId: GROUP, quotedMessageId: 'other-message' }, 3, null],
    ['self', { groupId: GROUP, quotedMessageId: 'own-message' }, 8, 150],
    ['unknown', { groupId: GROUP, quotedMessageId: 'missing-message' }, 8, 150],
    ['cross-group', { groupId: GROUP, quotedMessageId: 'other-room-message' }, 8, 150],
    ['private', { groupId: null, quotedMessageId: 'other-message' }, 8, 150],
    ['plain', { groupId: GROUP }, 8, 150],
  ]
  for (const [index, [event, context, expected, length]] of cases.entries()) {
    f.age()
    const before = f.profile()
    await f.send(event, length === null ? null : content(length, index * 200), context)
    assert.equal(f.profile().points - before.points, expected, event)
    assert.equal(f.profile().total_exp - before.total_exp, 1, 'reply points never multiply EXP')
  }
})

test('five-second cooldown is global across groups and private messages; replayed events never earn later', async t => {
  const f = fixture(t)
  assert.equal(app.EXP_COOLDOWN_SECONDS, 5)
  const before = f.profile()
  await f.send('global-1', content(9), { groupId: GROUP })
  const awardedState = f.db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A)
  await f.send('global-2', content(9, 100), { groupId: OTHER_GROUP })
  await f.send('global-3', content(9, 200), { groupId: null })
  assert.deepEqual(f.db.prepare('SELECT * FROM exp_last_message WHERE user_id = ?').get(A), awardedState, 'cooldown rejection cannot replace the credited text or extend the cooldown')
  assert.deepEqual(f.db.prepare('SELECT points_delta FROM exp_events WHERE event_key IN (?,?) ORDER BY event_key').all('global-2', 'global-3').map(row => row.points_delta), [0, 0])
  assert.equal(f.profile().points - before.points, 1)
  assert.equal(f.profile().total_exp - before.total_exp, 1)
  f.age()
  await f.send('global-2', content(9, 100), { groupId: OTHER_GROUP })
  await f.send('global-1', content(150, 900), { groupId: GROUP })
  assert.equal(f.profile().points - before.points, 1, 'replay cannot turn a blocked or already awarded event into a new reward')
  await f.send('global-4', content(9, 300), { groupId: OTHER_GROUP })
  assert.equal(f.profile().points - before.points, 2)
  assert.equal(f.profile().total_exp - before.total_exp, 2)
})

test('a failed award rolls back event receipt, cooldown and balances so the same event can retry safely', async t => {
  const f = fixture(t)
  const before = f.snapshot()
  f.db.exec(`CREATE TEMP TRIGGER reject_point_award BEFORE UPDATE OF points ON user_profiles
    WHEN NEW.user_id = '${A}' AND NEW.points > OLD.points BEGIN SELECT RAISE(ABORT, 'injected point update failure'); END`)
  await f.send('atomic-event', content(150))
  assert.equal(f.snapshot(), before)
  f.db.exec('DROP TRIGGER reject_point_award')
  await f.send('atomic-event', content(150))
  assert.equal(f.profile().points, 15233)
  assert.equal(f.profile().total_exp, 3841)
  f.age()
  await f.send('atomic-event', content(150))
  assert.equal(f.profile().points, 15233)
})

test('a level-up receipt reports the 99 to 100 EXP transition once despite variable points and redelivery', async t => {
  const f = fixture(t, { exp: 99, points: 700 })
  assert.deepEqual(await f.send('level-up', content(150)), { leveledUpTo: 2 })
  assert.equal(f.profile().total_exp, 100)
  assert.equal(f.profile().points, 708)
  const receipt = f.db.prepare('SELECT exp_before, points_delta FROM exp_events WHERE event_key = ?').get('level-up')
  assert.equal(receipt.exp_before, 99)
  assert.equal(receipt.points_delta, 8)
  assert.deepEqual(await f.send('level-up-cooldown', content(150, 300)), { leveledUpTo: null })
  f.age()
  assert.deepEqual(await f.send('level-up', content(150)), { leveledUpTo: null })
  assert.equal(f.profile().total_exp, 100)
  assert.equal(f.profile().points, 708)
  assert.deepEqual(await f.send('after-level-up', content(150, 600)), { leveledUpTo: null })
  assert.equal(f.profile().total_exp, 101)
  assert.equal(f.profile().points, 716)
})

test('simultaneous distinct messages cannot both win the same user cooldown; another user earns independently', async t => {
  const f = fixture(t)
  const beforeA = f.profile(A)
  const beforeB = f.profile(B)
  await Promise.all([
    f.send('concurrent-a1', content(150), { groupId: GROUP }, A),
    f.send('concurrent-a2', content(150, 300), { groupId: OTHER_GROUP }, A),
    f.send('concurrent-b1', content(150, 600), { groupId: GROUP }, B),
  ])
  assert.equal(f.profile(A).points - beforeA.points, 8)
  assert.equal(f.profile(A).total_exp - beforeA.total_exp, 1)
  assert.equal(f.profile(B).points - beforeB.points, 8)
  assert.equal(f.profile(B).total_exp - beforeB.total_exp, 1)
})
