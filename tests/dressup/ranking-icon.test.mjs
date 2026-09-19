import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { unstable_splitSqlQuery } from 'wrangler'

const bundled = await build({
  stdin: {
    contents: `
      export * from './src/features/rankingIcon.ts';
      export { handleProfileText, handleProfilePostback } from './src/features/profile/index.ts';
      export { handleMenuText, handleMenuPostback } from './src/features/menu/index.ts';
      export { createGachaConfirmation, drawGacha, equipCosmetic, getAppearance } from './src/features/dressup/store.ts';
    `,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const app = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const BASE = 'https://mochi.example'
const A = 'U_private_alice', B = 'U_private_bob'
const migration = readFileSync(new URL('../../migrations/0025_ranking_icons.sql', import.meta.url), 'utf8')

function fixture(t, { migrate = true } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of ['0015_personalization.sql', '0024_dressup.sql']) {
    db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
  }
  if (migrate) db.exec(migration)
  for (const [user, publicId] of [[A, 'public-alice'], [B, 'public-bob']]) {
    db.prepare('INSERT INTO user_profiles (user_id, public_id, picture_url, points, total_exp) VALUES (?, ?, ?, 12000, 54321)')
      .run(user, publicId, `https://avatar.example/${publicId}.png`)
  }
  const calls = []
  const prepare = (sql, parameters = []) => ({
    bind: (...values) => prepare(sql, values),
    async first(column) {
      const row = db.prepare(sql).get(...parameters)
      return row ? (column ? row[column] : { ...row }) : null
    },
    async all() {
      calls.push(parameters)
      return { success: true, results: db.prepare(sql).all(...parameters).map(row => ({ ...row })) }
    },
    async run() {
      const result = db.prepare(sql).run(...parameters)
      return { success: true, meta: { changes: Number(result.changes) } }
    },
  })
  t.after(() => db.close())
  const env = { DB: { prepare } }
  const ctx = (userId = A) => ({ userId, displayName: null, pictureUrl: null, baseUrl: BASE })
  const grant = (item, userId = A) => db.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)').run(userId, item)
  return { db, env, ctx, grant, calls }
}

function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
const texts = value => nodes(value).filter(node => node.type === 'text').map(node => node.text).join('\n')
const actions = value => nodes(value).filter(node => node.type === 'postback')
const images = value => nodes(value).filter(node => node.type === 'image')
function validate(messages) {
  assert.ok(messages?.length > 0 && messages.length <= 5)
  for (const node of nodes(messages)) {
    if (node.type === 'postback') {
      if (node.label !== undefined) assert.ok(Array.from(node.label).length <= 20, `LINE button label too long: ${node.label}`)
      assert.ok(node.data.length <= 300)
    }
    if (node.type === 'image') {
      assert.match(node.url, /^https:\/\//)
      assert.equal(node.width, undefined)
    }
    if (node.type === 'carousel') assert.ok(node.contents.length <= 12)
    if (node.type === 'bubble') assert.ok(Buffer.byteLength(JSON.stringify(node)) <= 30000)
  }
  assert.ok(!JSON.stringify(messages).includes(A))
  assert.ok(!JSON.stringify(messages).includes(B))
}

test('additive migration leaves historical profiles, wardrobe and balances intact, with LINE icons', async t => {
  const f = fixture(t, { migrate: false })
  f.grant('C001')
  await app.equipCosmetic(f.env, A, 'C001')
  const before = f.db.prepare('SELECT * FROM user_profiles ORDER BY user_id').all()
  const appearance = await app.getAppearance(f.env, A)
  for (const statement of unstable_splitSqlQuery(migration)) f.db.prepare(statement).run()
  f.db.exec(migration)
  assert.deepEqual(f.db.prepare('SELECT * FROM user_profiles ORDER BY user_id').all(), before)
  assert.deepEqual(await app.getAppearance(f.env, A), appearance)
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: null })
  assert.equal(f.db.prepare('SELECT count(*) n FROM ranking_icons').get().n, 0)
  assert.equal(app.rankingIconUrl(BASE, await app.getRankingIcon(f.env, A), before[0].picture_url), before[0].picture_url)
})

test('owned selection persists, is independent of status clothes and resets to current LINE picture for free', async t => {
  const f = fixture(t)
  f.grant('C001'); f.grant('C002')
  const before = f.db.prepare('SELECT points, total_exp, picture_url FROM user_profiles WHERE user_id = ?').get(A)
  assert.deepEqual(await app.setRankingIcon(f.env, A, 'C001'), { ok: true })
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: 'C001' })
  assert.deepEqual(await app.getAppearance(f.env, A), { costumeId: 'C000', backgroundId: 'BG000' })
  await app.equipCosmetic(f.env, A, 'C002')
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: 'C001' })
  assert.deepEqual((await app.getRankingIconsByPublicIds(f.env, ['public-alice']))['public-alice'], { costumeId: 'C001' })
  assert.deepEqual((await app.getRankingIconsByUserIds(f.env, [A]))[A], { costumeId: 'C001' })
  assert.deepEqual(f.db.prepare('SELECT points, total_exp, picture_url FROM user_profiles WHERE user_id = ?').get(A), before)
  assert.deepEqual(await app.setRankingIcon(f.env, A, null), { ok: true })
  const current = await app.getRankingIcon(f.env, A)
  assert.deepEqual(current, { costumeId: null })
  assert.equal(app.rankingIconUrl(BASE, current, 'https://avatar.example/new.png'), 'https://avatar.example/new.png')
  assert.equal(f.db.prepare('SELECT count(*) n FROM point_ledger').get().n, 0)
})

test('forged unavailable/other-user/background/path selection never changes either user', async t => {
  const f = fixture(t)
  f.grant('C001'); f.grant('BG001')
  await app.setRankingIcon(f.env, A, 'C001')
  assert.deepEqual(await app.setRankingIcon(f.env, B, 'C001'), { ok: false, reason: 'not_owned' })
  assert.deepEqual(await app.setRankingIcon(f.env, A, 'C002'), { ok: false, reason: 'not_owned' })
  for (const id of ['BG001', '../../secret', 'C999', '']) assert.deepEqual(await app.setRankingIcon(f.env, A, id), { ok: false, reason: 'invalid_item' })
  assert.deepEqual(await app.setRankingIcon(f.env, 'missing-user', null), { ok: false, reason: 'unknown_user' })
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: 'C001' })
  assert.deepEqual(await app.getRankingIcon(f.env, B), { costumeId: null })
  f.db.prepare('DELETE FROM dressup_inventory WHERE user_id = ? AND item_id = ?').run(A, 'C001')
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: null }, 'revoked ownership cannot continue displaying the item')
  assert.deepEqual(await app.setRankingIcon(f.env, B, 'C000'), { ok: true }, 'free initial icon remains available')
})

test('a successful gacha draw unlocks a selectable costume without auto-equipping or overwriting the icon', async t => {
  const f = fixture(t)
  f.db.exec(`INSERT INTO dressup_inventory (user_id, item_id) SELECT '${A}', item_id FROM dressup_catalog WHERE is_default = 0 AND item_id <> 'C120'`)
  const { token } = await app.createGachaConfirmation(f.env, A)
  const draw = await app.drawGacha(f.env, A, token)
  assert.equal(draw.ok, true)
  assert.equal(draw.itemId, 'C120')
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: null })
  assert.deepEqual(await app.setRankingIcon(f.env, A, 'C120'), { ok: true })
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: 'C120' })
  assert.equal(f.db.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(A).points, 9000)
  f.db.exec(`INSERT INTO dressup_inventory (user_id, item_id) SELECT '${B}', item_id FROM dressup_catalog WHERE is_default = 0 AND item_id <> 'C120'`)
  await app.setRankingIcon(f.env, B, 'C001')
  const secondConfirmation = await app.createGachaConfirmation(f.env, B)
  const secondDraw = await app.drawGacha(f.env, B, secondConfirmation.token)
  assert.equal(secondDraw.ok, true)
  assert.equal(secondDraw.itemId, 'C120')
  assert.deepEqual(await app.getRankingIcon(f.env, B), { costumeId: 'C001' })
})

test('public batched lookup stays within D1 parameter limits and never returns private IDs', async t => {
  const f = fixture(t)
  f.grant('C001')
  await app.setRankingIcon(f.env, A, 'C001')
  const ids = ['public-alice', 'public-bob', ...Array.from({ length: 160 }, (_, i) => `missing-${i}`), 'public-alice']
  const result = await app.getRankingIconsByPublicIds(f.env, ids)
  assert.equal(Object.keys(result).length, 162)
  assert.deepEqual(result['public-alice'], { costumeId: 'C001' })
  assert.deepEqual(result['missing-0'], { costumeId: null })
  assert.ok(f.calls.every(parameters => parameters.length <= 75))
  assert.equal(f.calls.length, 3)
  assert.ok(!JSON.stringify(result).includes(A))
  const emptyCalls = f.calls.length
  assert.equal(Object.keys(await app.getRankingIconsByPublicIds(f.env, [])).length, 0)
  assert.equal(f.calls.length, emptyCalls)
})

test('missing icon migration falls back to LINE but unexpected DB failures still propagate', async t => {
  const f = fixture(t, { migrate: false })
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: null })
  const broken = { DB: { prepare() { throw new Error('database unavailable') } } }
  await assert.rejects(() => app.getRankingIconsByPublicIds(broken, ['public-alice']), /database unavailable/)
  for (const invalid of [null, 'javascript:alert(1)', 'http://avatar.example/a.png', 'https://name:password@avatar.example/a.png']) {
    assert.equal(app.rankingIconUrl(BASE, null, invalid), `${BASE}/static/dressup/C000.png`)
  }
})

test('real text/settings/list/select/reset routes use actor ownership and valid bounded Flex messages', async t => {
  const f = fixture(t)
  for (let i = 1; i <= 120; i++) f.grant(`C${String(i).padStart(3, '0')}`)
  const before = f.db.prepare('SELECT points, total_exp, picture_url FROM user_profiles WHERE user_id = ?').get(A)
  for (const command of ['ランキングアイコン', 'アイコン設定', 'ランキングアイコン設定']) {
    const messages = await app.handleProfileText(f.env, f.ctx(), command)
    validate(messages)
    assert.match(texts(messages), /使用中・デフォルト\s+LINEプロフィール画像/)
    assert.equal(images(messages)[0].url, before.picture_url)
    assert.ok(actions(messages).some(action => action.data === 'pf|rankicon|list|1'))
  }
  for (const page of ['1', '2', '-10', 'Infinity', '999999', 'NaN']) {
    const messages = await app.handleProfilePostback(f.env, f.ctx(), `pf|rankicon|list|${page}`)
    validate(messages)
    assert.ok(actions(messages).some(action => action.data === 'pf|rankicon|home'))
  }
  const selected = await app.handleProfilePostback(f.env, f.ctx(), 'pf|rankicon|set|C001')
  validate(selected)
  assert.match(texts(selected), /変更しました/)
  assert.match(images(selected)[0].url, /\/dressup-art\/C001\/BG000.png\?view=icon/)
  const denied = await app.handleProfilePostback(f.env, f.ctx(B), 'pf|rankicon|set|C001')
  validate(denied)
  assert.match(texts(denied), /まだ持っていない/)
  assert.deepEqual(await app.getRankingIcon(f.env, A), { costumeId: 'C001' })
  assert.deepEqual(await app.getRankingIcon(f.env, B), { costumeId: null })
  const reset = await app.handleProfilePostback(f.env, f.ctx(), 'pf|rankicon|line')
  validate(reset)
  assert.match(texts(reset), /プロフィール画像に戻しました/)
  assert.equal(images(reset)[0].url, before.picture_url)
  assert.deepEqual(f.db.prepare('SELECT points, total_exp, picture_url FROM user_profiles WHERE user_id = ?').get(A), before)
})

test('settings menu button opens the same ranking icon settings without spending points', async t => {
  const f = fixture(t)
  const menuCtx = { isGroup: false, userId: A, displayName: null, siteUrl: BASE }
  const before = f.db.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(A).points
  for (const command of ['設定', '個人設定']) {
    const menu = app.handleMenuText(menuCtx, command)
    validate(menu)
    const entry = actions(menu).find(action => action.data === 'hm|x|ランキングアイコン')
    assert.equal(entry?.data, 'hm|x|ランキングアイコン')
    const transition = await app.handleMenuPostback(f.env, menuCtx, entry.data)
    assert.equal(transition.runExisting, 'ランキングアイコン')
    const setting = await app.handleProfileText(f.env, f.ctx(), transition.runExisting)
    validate(setting)
    assert.match(texts(setting), /使用中・デフォルト\s+LINEプロフィール画像/)
  }
  assert.equal(f.db.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(A).points, before)
  assert.equal(f.db.prepare('SELECT count(*) n FROM ranking_icons').get().n, 0)
})
