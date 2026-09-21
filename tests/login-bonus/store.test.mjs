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
const TEST_MIGRATION = readFileSync(new URL('../../migrations/0029_login_bonus_test.sql', import.meta.url), 'utf8')
const USER = 'U_login_alice'
const OTHER = 'U_login_bob'
const OWNER = `U${'a'.repeat(32)}`
const NON_OWNER = `U${'b'.repeat(32)}`
const DAY_MS = 86_400_000
const NOW = Date.parse('2026-09-22T03:00:00.000Z')

function fixture(t, { testUserId } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(new URL('../../migrations/0015_personalization.sql', import.meta.url), 'utf8'))
  db.exec(MIGRATION)
  db.exec(TEST_MIGRATION)
  for (const user of [USER, OTHER, OWNER, NON_OWNER]) db.prepare(`INSERT INTO user_profiles
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
  const env = { LOGIN_BONUS_TEST_USER_ID: testUserId, DB: { prepare, async batch(statements) {
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

test('only the configured exact UID gets points for new same-day events; its first event is not paid twice', async t => {
  const f = fixture(t, { testUserId: OWNER })
  for (const user of [OWNER, NON_OWNER]) f.db.prepare("UPDATE user_profiles SET display_name = 'なの' WHERE user_id = ?").run(user)
  const first = await claim(f, 'first', NOW, OWNER)
  assert.equal(first.rewardPoints, 500)
  assert.equal(first.balance, 725)
  assert.equal(f.count('login_bonus_test_claims'), 0)
  for (let index = 1; index <= 3; index++) {
    const result = await claim(f, `repeat-${index}`, NOW, OWNER)
    assert.deepEqual(result, { ...first, balance: 725 + index * 500 })
  }
  const otherFirst = await claim(f, 'other-first', NOW, NON_OWNER)
  assert.deepEqual(await claim(f, 'other-repeat', NOW, NON_OWNER), { ...otherFirst, claimed: false })
  assert.equal(f.profile(NON_OWNER).points, 725, 'the same display name never grants the private exception')
  assert.equal(f.profile(OWNER).points, 2225)
  assert.equal(f.count('login_bonus_test_claims'), 3)
  const state = f.db.prepare('SELECT * FROM login_bonus_state WHERE user_id = ?').get(OWNER)
  assert.equal(state.total_days, 1)
  assert.equal(state.streak_days, 1)
  assert.equal(f.ledger().filter(row => row.reason === 'login_bonus_test').length, 3)
})

test('an absent, malformed, multiple, differently cased or whitespace-padded test UID never enables repeat rewards', async t => {
  const invalid = [undefined, null, '', 'なの', USER, 123, [OWNER], `${OWNER},${NON_OWNER}`, `${OWNER}\n${NON_OWNER}`,
    `${OWNER} ${NON_OWNER}`, ` ${OWNER}`, `${OWNER} `, OWNER.toUpperCase(), OWNER.slice(1)]
  for (const testUserId of invalid) {
    const f = fixture(t, { testUserId })
    const first = await claim(f, 'first', NOW, OWNER)
    assert.deepEqual(await claim(f, 'second', NOW, OWNER), { ...first, claimed: false }, String(testUserId))
    assert.equal(f.count('login_bonus_test_claims'), 0)
    assert.equal(f.profile(OWNER).points, 725)
  }
})

test('owner repeat awards use the current day reward while calendar totals, streak and seven-day cap stay normal', async t => {
  const f = fixture(t, { testUserId: OWNER })
  let balance = 225
  for (let index = 0; index < 9; index++) {
    const now = NOW + index * DAY_MS
    const expected = Math.min(index + 1, 7) * 500
    const first = await claim(f, `first-${index}`, now, OWNER)
    balance += expected
    assert.equal(first.balance, balance)
    const repeat = await claim(f, `repeat-${index}`, now, OWNER)
    balance += expected
    assert.deepEqual(repeat, { ...first, balance })
    assert.equal(repeat.totalDays, index + 1)
    assert.equal(repeat.streakDays, index + 1)
    assert.equal(repeat.rewardPoints, expected)
  }
  const afterGap = await claim(f, 'after-gap', NOW + 10 * DAY_MS, OWNER)
  assert.equal(afterGap.totalDays, 10)
  assert.equal(afterGap.streakDays, 1)
  assert.equal(afterGap.rewardPoints, 500)
  assert.equal(f.profile(OWNER).points, balance + 500)
  assert.equal(f.count('login_bonus_claims'), 10)
  assert.equal(f.count('login_bonus_test_claims'), 9)
})

test('parallel owner repeats settle each distinct event exactly once, including the first event race', async t => {
  const f = fixture(t, { testUserId: OWNER })
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => claim(f, `event-${index % 20}`, NOW, OWNER)))
  assert.equal(results.filter(result => result.claimed).length, 20)
  assert.ok(results.every(result => result.totalDays === 1 && result.streakDays === 1 && result.rewardPoints === 500))
  assert.equal(f.profile(OWNER).points, 225 + 20 * 500)
  assert.equal(f.count('login_bonus_claims'), 1)
  assert.equal(f.count('login_bonus_test_claims'), 19)
  assert.equal(f.count('login_bonus_events'), 20)
  assert.equal(f.ledger().length, 20)
})

test('the same owner repeat returns its stored receipt on replay today or on a later day without extra points', async t => {
  const f = fixture(t, { testUserId: OWNER })
  const first = await claim(f, 'first', NOW, OWNER)
  const repeat = await claim(f, 'repeat', NOW, OWNER)
  f.db.prepare('UPDATE user_profiles SET points = points - 100 WHERE user_id = ?').run(OWNER)
  for (const now of [NOW, NOW + DAY_MS, NOW + 5 * DAY_MS]) {
    assert.deepEqual(await claim(f, 'first', now, OWNER), { ...first, claimed: false })
    assert.deepEqual(await claim(f, 'repeat', now, OWNER), { ...repeat, claimed: false })
  }
  assert.equal(f.profile(OWNER).points, 1125)
  assert.equal(f.count('login_bonus_claims'), 1)
  const next = await claim(f, 'next-day', NOW + DAY_MS, OWNER)
  assert.equal(next.rewardPoints, 1000)
  assert.equal(next.streakDays, 2)
  assert.deepEqual(await claim(f, 'repeat', NOW + 2 * DAY_MS, OWNER), { ...repeat, claimed: false })
  assert.equal(f.profile(OWNER).points, 2125)
})

test('enabling owner testing cannot award an event previously handled without the exception', async t => {
  const f = fixture(t)
  const first = await claim(f, 'first', NOW, OWNER)
  await claim(f, 'previous-duplicate', NOW, OWNER)
  f.env.LOGIN_BONUS_TEST_USER_ID = OWNER
  assert.deepEqual(await claim(f, 'first', NOW, OWNER), { ...first, claimed: false })
  assert.deepEqual(await claim(f, 'previous-duplicate', NOW, OWNER), { ...first, claimed: false })
  assert.equal(f.count('login_bonus_test_claims'), 0)
  assert.equal(f.profile(OWNER).points, 725)
  assert.equal((await claim(f, 'new-test', NOW, OWNER)).balance, 1225)
})

test('removing or changing the private UID stops new repeat awards but preserves old test receipts', async t => {
  const f = fixture(t, { testUserId: OWNER })
  const first = await claim(f, 'first', NOW, OWNER)
  const repeat = await claim(f, 'repeat', NOW, OWNER)
  delete f.env.LOGIN_BONUS_TEST_USER_ID
  assert.deepEqual(await claim(f, 'repeat', NOW, OWNER), { ...repeat, claimed: false })
  assert.deepEqual(await claim(f, 'disabled-command', NOW, OWNER), { ...first, claimed: false })
  f.env.LOGIN_BONUS_TEST_USER_ID = NON_OWNER
  assert.deepEqual(await claim(f, 'changed-command', NOW, OWNER), { ...first, claimed: false })
  f.env.LOGIN_BONUS_TEST_USER_ID = OWNER
  assert.deepEqual(await claim(f, 'disabled-command', NOW, OWNER), { ...first, claimed: false })
  assert.deepEqual(await claim(f, 'changed-command', NOW, OWNER), { ...first, claimed: false })
  assert.equal(f.profile(OWNER).points, 1225)
  assert.equal(f.count('login_bonus_test_claims'), 1)
})

test('a repeat ledger collision rolls back the new event, test receipt and balance without altering the daily claim', async t => {
  const f = fixture(t, { testUserId: OWNER })
  await claim(f, 'first', NOW, OWNER)
  const originalClaims = f.claims()
  const originalState = { ...f.db.prepare('SELECT * FROM login_bonus_state WHERE user_id = ?').get(OWNER) }
  f.db.prepare("INSERT INTO point_ledger(user_id, delta, reason, reason_key) VALUES(?, 0, 'collision', ?)")
    .run(OWNER, `login-test:${OWNER}:repeat`)
  await assert.rejects(claim(f, 'repeat', NOW, OWNER), unavailable)
  assert.equal(f.profile(OWNER).points, 725)
  assert.equal(f.count('login_bonus_events'), 1)
  assert.equal(f.count('login_bonus_test_claims'), 0)
  assert.deepEqual(f.claims(), originalClaims)
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM login_bonus_state WHERE user_id = ?').get(OWNER) }, originalState)
  f.db.prepare("DELETE FROM point_ledger WHERE reason = 'collision'").run()
  assert.equal((await claim(f, 'repeat', NOW, OWNER)).balance, 1225)
})

test('a failed receipt query rolls back the complete owner transaction, including an ordinary first claim', async t => {
  const f = fixture(t, { testUserId: OWNER })
  const prepare = f.env.DB.prepare
  f.env.DB.prepare = (sql, ...args) => prepare(sql.startsWith('SELECT e.attempt_id') ? 'SELECT * FROM missing_login_test_table WHERE a = ? AND b = ?' : sql, ...args)
  await assert.rejects(claim(f, 'first', NOW, OWNER), unavailable)
  assert.equal(f.profile(OWNER).points, 225)
  assert.equal(f.count('login_bonus_claims'), 0)
  assert.equal(f.count('login_bonus_test_claims'), 0)
  assert.equal(f.count('login_bonus_events'), 0)
  assert.equal(f.count('login_bonus_state'), 0)
  assert.equal(f.ledger().length, 0)
  f.env.DB.prepare = prepare
  assert.equal((await claim(f, 'first', NOW, OWNER)).balance, 725)
})

test('owner identity does not bypass missing signed event keys or missing profiles', async t => {
  const f = fixture(t, { testUserId: OWNER })
  await assert.rejects(claim(f, '', NOW, OWNER), error => error.code === 'invalid_input')
  f.db.prepare('DELETE FROM user_profiles WHERE user_id = ?').run(OWNER)
  await assert.rejects(claim(f, 'first', NOW, OWNER), unavailable)
  assert.equal(f.count('login_bonus_events'), 0)
  assert.equal(f.count('login_bonus_claims'), 0)
  assert.equal(f.count('login_bonus_test_claims'), 0)
})

test('the repeat-award migration can be reapplied without changing any receipt or balance', async t => {
  const f = fixture(t, { testUserId: OWNER })
  await claim(f, 'first', NOW, OWNER)
  const repeat = await claim(f, 'repeat', NOW, OWNER)
  const before = f.profile(OWNER)
  const ledger = f.ledger()
  const receipts = f.db.prepare('SELECT * FROM login_bonus_test_claims').all().map(row => ({ ...row }))
  f.db.exec(TEST_MIGRATION)
  f.db.exec(TEST_MIGRATION)
  assert.deepEqual(f.profile(OWNER), before)
  assert.deepEqual(f.ledger(), ledger)
  assert.deepEqual(f.db.prepare('SELECT * FROM login_bonus_test_claims').all().map(row => ({ ...row })), receipts)
  assert.deepEqual(await claim(f, 'repeat', NOW, OWNER), { ...repeat, claimed: false })
})
