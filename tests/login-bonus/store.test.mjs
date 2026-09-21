// Offline data regressions: production TypeScript, real SQLite, no LINE/network.
// Run: node --test tests/login-bonus/store.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

const compiled = await transform(readFileSync(new URL('../../src/features/loginBonus/store.ts', import.meta.url), 'utf8'), {
  loader: 'ts', format: 'esm', target: 'node22', logLevel: 'silent',
})
const { claimLoginBonus, LoginBonusError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)
const MIGRATION = readFileSync(new URL('../../migrations/0028_login_bonus.sql', import.meta.url), 'utf8')
const USER = 'U_login_alice'
const OTHER = 'U_login_bob'
const DAY_MS = 86_400_000
const NOW = Date.parse('2026-09-22T03:00:00.000Z')

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(new URL('../../migrations/0015_personalization.sql', import.meta.url), 'utf8'))
  db.exec(MIGRATION)
  for (const user of [USER, OTHER]) db.prepare(`INSERT INTO user_profiles
    (user_id, public_id, display_name, points, total_exp, active_theme, equipped_title)
    VALUES(?, ?, 'Existing name', 225, 3840, 'sakura', 'existing-title')`).run(user, `public-${user}`)
  const queries = []
  const prepare = (sql, parameters = []) => ({
    bind: (...values) => prepare(sql, values),
    execute() {
      queries.push({ sql, parameters })
      const statement = db.prepare(sql)
      if (statement.columns().length) return { success: true, results: statement.all(...parameters).map(row => ({ ...row })), meta: {} }
      statement.run(...parameters)
      // Deliberately do not use sqlite changes(): D1 may count trigger writes.
      return { success: true, results: [], meta: { changes: 999 } }
    },
  })
  const env = { DB: { prepare, async batch(statements) {
    db.exec('BEGIN')
    try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results }
    catch (error) { db.exec('ROLLBACK'); throw error }
  } } }
  t.after(() => db.close())
  const profile = (user = USER) => ({ ...db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user) })
  const count = table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n
  const claims = () => db.prepare('SELECT * FROM login_bonus_claims ORDER BY user_id, claim_day').all().map(row => ({ ...row }))
  const ledger = () => db.prepare('SELECT * FROM point_ledger ORDER BY id').all().map(row => ({ ...row }))
  return { db, env, profile, count, claims, ledger, queries }
}

const claim = (f, event, now = NOW, user = USER) => claimLoginBonus(f.env, user, event, now)
const unavailable = error => error instanceof LoginBonusError && error.code === 'unavailable'

test('the first daily login gives 500 existing gacha points, preserving EXP/profile and recording one ledger entry', async t => {
  const f = fixture(t)
  const original = f.profile()
  const result = await claim(f, 'webhook:first')
  assert.deepEqual(result, { claimed: true, day: '2026-09-22', totalDays: 1, streakDays: 1, rewardDays: 1, rewardPoints: 500, balance: 725 })
  assert.equal(f.profile().points, 725)
  for (const key of ['public_id', 'display_name', 'total_exp', 'active_theme', 'equipped_title']) assert.equal(f.profile()[key], original[key])
  assert.equal(f.count('login_bonus_claims'), 1)
  assert.equal(f.ledger().length, 1)
  assert.equal(f.ledger()[0].reason, 'login_bonus')
  assert.equal(f.ledger()[0].reason_key, `login:${USER}:2026-09-22`)
  assert.equal(f.ledger()[0].delta, 500)
})

test('all groups and DMs share the daily receipt, including duplicates after spending points', async t => {
  const f = fixture(t)
  const first = await claim(f, 'event:group-a')
  f.db.prepare('UPDATE user_profiles SET points = points - 100 WHERE user_id = ?').run(USER)
  for (const event of ['event:group-a', 'event:group-b', 'event:dm']) {
    assert.deepEqual(await claim(f, event), { ...first, claimed: false })
  }
  assert.equal(f.profile().points, 625, 'a duplicate neither awards again nor invents a fresh balance receipt')
  assert.equal(f.count('login_bonus_claims'), 1)
  assert.equal(f.count('login_bonus_events'), 3)
  assert.equal(f.ledger().length, 1)
})

test('ten consecutive days keep counting while rewardDays and points cap at 7 and 3500', async t => {
  const f = fixture(t)
  let balance = 225
  for (let day = 1; day <= 10; day++) {
    const result = await claim(f, `day-${day}`, NOW + (day - 1) * DAY_MS)
    balance += Math.min(day, 7) * 500
    assert.equal(result.claimed, true)
    assert.equal(result.totalDays, day)
    assert.equal(result.streakDays, day)
    assert.equal(result.rewardDays, Math.min(day, 7))
    assert.equal(result.rewardPoints, Math.min(day, 7) * 500)
    assert.equal(result.balance, balance)
  }
  assert.equal(f.profile().points, balance)
  assert.equal(f.count('login_bonus_claims'), 10)
})

test('a missed JST date resets only the streak, while total claimed days keep increasing', async t => {
  const f = fixture(t)
  await claim(f, 'day-1')
  await claim(f, 'day-2', NOW + DAY_MS)
  const afterGap = await claim(f, 'day-4', NOW + 3 * DAY_MS)
  assert.equal(afterGap.totalDays, 3)
  assert.equal(afterGap.streakDays, 1)
  assert.equal(afterGap.rewardPoints, 500)
  const resumed = await claim(f, 'day-5', NOW + 4 * DAY_MS)
  assert.equal(resumed.totalDays, 4)
  assert.equal(resumed.streakDays, 2)
  assert.equal(resumed.rewardPoints, 1000)
})

test('one millisecond across Japan midnight starts the next day while UTC has not changed date', async t => {
  const f = fixture(t)
  const before = Date.parse('2026-09-22T14:59:59.999Z')
  const first = await claim(f, 'before-midnight', before)
  const next = await claim(f, 'at-midnight', before + 1)
  assert.equal(first.day, '2026-09-22')
  assert.equal(next.day, '2026-09-23')
  assert.equal(next.streakDays, 2)
  assert.equal(next.rewardPoints, 1000)
  assert.deepEqual(await claim(f, 'same-jst-day', before + 60_000), { ...next, claimed: false })
})

test('calendar adjacency works through month, leap day and year boundaries', async t => {
  for (const start of ['2028-02-28T03:00:00Z', '2026-12-31T03:00:00Z']) {
    const f = fixture(t)
    const time = Date.parse(start)
    await claim(f, 'first', time)
    assert.equal((await claim(f, 'second', time + DAY_MS)).streakDays, 2)
    assert.equal((await claim(f, 'third', time + 2 * DAY_MS)).streakDays, 3)
  }
})

test('simultaneous distinct and duplicate events award only once without using meta.changes', async t => {
  const f = fixture(t)
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => claim(f, `event-${index % 20}`)))
  assert.equal(results.filter(result => result.claimed).length, 1)
  assert.ok(results.every(result => result.totalDays === 1 && result.balance === 725))
  assert.equal(f.profile().points, 725)
  assert.equal(f.count('login_bonus_claims'), 1)
  assert.equal(f.count('login_bonus_events'), 20)
  assert.equal(f.ledger().length, 1)
})

test('replaying an awarding or non-awarding old event after midnight cannot claim a new day', async t => {
  const f = fixture(t)
  const first = await claim(f, 'day-1-award')
  await claim(f, 'day-1-duplicate')
  for (const key of ['day-1-award', 'day-1-duplicate']) {
    assert.deepEqual(await claim(f, key, NOW + DAY_MS), { ...first, claimed: false })
  }
  assert.equal(f.profile().points, 725)
  assert.equal(f.count('login_bonus_claims'), 1)
  const next = await claim(f, 'day-2-new', NOW + DAY_MS)
  assert.equal(next.rewardPoints, 1000)
  assert.deepEqual(await claim(f, 'day-1-duplicate', NOW + 5 * DAY_MS), { ...first, claimed: false })
  assert.equal(f.profile().points, 1725)
})

test('users have independent daily receipts even if given the same event key', async t => {
  const f = fixture(t)
  const results = await Promise.all([claim(f, 'shared-id'), claim(f, 'shared-id', NOW, OTHER)])
  assert.ok(results.every(result => result.claimed && result.rewardPoints === 500))
  assert.equal(f.profile(USER).points, 725)
  assert.equal(f.profile(OTHER).points, 725)
  assert.equal(f.ledger().length, 2)
})

test('missing identity, event key, invalid clock and missing profile fail closed', async t => {
  const f = fixture(t)
  for (const [user, event, now] of [[USER, '', NOW], [USER, undefined, NOW], ['', 'e', NOW], [USER, 'e\nheader', NOW], [USER, 'e', NaN], [USER, 'e', -1], [USER, 'e', Infinity]]) {
    await assert.rejects(claimLoginBonus(f.env, user, event, now), error => error instanceof LoginBonusError && error.code === 'invalid_input')
  }
  assert.equal(f.queries.length, 0)
  await assert.rejects(claim(f, 'missing-user', NOW, 'U_missing'), unavailable)
  assert.equal(f.count('login_bonus_events'), 0)
  assert.equal(f.count('login_bonus_claims'), 0)
  assert.equal(f.profile().points, 225)
})

test('a ledger failure rolls back event, receipt, state and points; the exact event remains retryable', async t => {
  const f = fixture(t)
  f.db.prepare("INSERT INTO point_ledger(user_id, delta, reason, reason_key) VALUES(?, 0, 'collision', ?)")
    .run(USER, `login:${USER}:2026-09-22`)
  await assert.rejects(claim(f, 'retry-me'), unavailable)
  assert.equal(f.profile().points, 225)
  assert.equal(f.count('login_bonus_events'), 0)
  assert.equal(f.count('login_bonus_claims'), 0)
  assert.equal(f.count('login_bonus_state'), 0)
  f.db.prepare("DELETE FROM point_ledger WHERE reason = 'collision'").run()
  assert.equal((await claim(f, 'retry-me')).claimed, true)
  assert.equal(f.profile().points, 725)
})

test('a failure after ledger insertion also rolls back every part of the award', async t => {
  const f = fixture(t)
  f.db.exec("CREATE TRIGGER reject_login_state BEFORE INSERT ON login_bonus_state BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
  await assert.rejects(claim(f, 'retry-me'), unavailable)
  assert.equal(f.profile().points, 225)
  assert.equal(f.ledger().length, 0)
  assert.equal(f.count('login_bonus_claims'), 0)
  assert.equal(f.count('login_bonus_events'), 0)
  f.db.exec('DROP TRIGGER reject_login_state')
  assert.equal((await claim(f, 'retry-me')).rewardPoints, 500)
})

test('a delayed new event cannot rewind a newer claimed date; an old known event still returns its receipt', async t => {
  const f = fixture(t)
  const first = await claim(f, 'first')
  await claim(f, 'next', NOW + DAY_MS)
  await assert.rejects(claim(f, 'delayed', NOW), unavailable)
  assert.deepEqual(await claim(f, 'first', NOW), { ...first, claimed: false })
  assert.equal(f.count('login_bonus_events'), 2)
  assert.equal((await claim(f, 'third', NOW + 2 * DAY_MS)).streakDays, 3)
})

test('reapplying the migration preserves both existing and newly awarded data', async t => {
  const f = fixture(t)
  const first = await claim(f, 'first')
  const originalProfile = f.profile()
  const originalClaims = f.claims()
  const originalLedger = f.ledger()
  f.db.exec(MIGRATION)
  f.db.exec(MIGRATION)
  assert.deepEqual(f.profile(), originalProfile)
  assert.deepEqual(f.claims(), originalClaims)
  assert.deepEqual(f.ledger(), originalLedger)
  assert.deepEqual(await claim(f, 'first'), { ...first, claimed: false })
})

test('receipt lookups use primary indexes and login history is never counted or scanned per claim', async t => {
  const f = fixture(t)
  for (let index = 0; index < 30; index++) await claim(f, `day-${index}`, NOW + index * DAY_MS)
  const reads = f.queries.filter(query => /^SELECT/.test(query.sql))
  assert.equal(reads.length, 30)
  for (const query of reads.slice(-1)) {
    const plans = f.db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.parameters)
    assert.ok(plans.every(plan => !/\bSCAN\b/.test(plan.detail)), plans.map(plan => plan.detail).join('\n'))
    assert.ok(plans.every(plan => /\bSEARCH\b/.test(plan.detail)))
  }
  assert.ok(f.queries.every(query => !/\bCOUNT\s*\(/i.test(query.sql)))
})
