// Offline regressions for game rewards using the production TS and real SQLite.
// Run: node --test scripts/game-rewards-test.mjs
// No LINE access, production database, or external network is used.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  stdin: {
    contents: `export * as rewards from './src/features/gameRewards.ts'; export * as puzzle from './src/features/mochiScore.ts'; export * as survivor from './src/features/survivor.ts';`,
    resolveDir: root, sourcefile: 'game-rewards-test.ts', loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const app = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const A = { userId: 'U_reward_alice', displayName: 'Alice', pictureUrl: 'https://avatar.example/alice.png' }
const B = { userId: 'U_reward_bob', displayName: 'Bob', pictureUrl: 'https://avatar.example/bob.png' }
const NOW = Date.parse('2026-09-21T03:00:00.000Z')
const migrations = ['0015_personalization.sql', '0018_mochi_scores.sql', '0019_survivor.sql', '0027_game_rewards.sql']

function fixture(t, { points = 225, exp = 3840 } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const filename of migrations) db.exec(readFileSync(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'))
  for (const [index, user] of [A, B].entries()) {
    db.prepare('INSERT INTO user_profiles(user_id,public_id,display_name,picture_url,total_exp,points,active_theme,equipped_title) VALUES(?,?,?,?,?,?,?,?)')
      .run(user.userId, `public-game-${index}`, user.displayName, user.pictureUrl, exp, points, 'black', 'existing-title')
  }
  const prepare = (sql, parameters = []) => {
    const execute = () => {
      const statement = db.prepare(sql)
      if (statement.columns().length) {
        const results = statement.all(...parameters).map(row => ({ ...row }))
        return { success: true, results, meta: { changes: db.prepare('SELECT changes() n').get().n } }
      }
      const result = statement.run(...parameters)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return {
      bind: (...values) => prepare(sql, values), execute,
      async first(column) { const row = db.prepare(sql).get(...parameters); return row ? column ? row[column] : { ...row } : null },
      async all() { return { success: true, results: db.prepare(sql).all(...parameters).map(row => ({ ...row })), meta: {} } },
      async run() { return execute() },
    }
  }
  const env = { DB: { prepare, async batch(statements) {
    // SQL execution stays synchronous inside the transaction. Await points in
    // production code still interleave, as simultaneous D1 callers would.
    db.exec('BEGIN')
    try { const result = statements.map(statement => statement.execute()); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  } } }
  t.after(() => db.close())
  const profile = (user = A) => ({ ...db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(user.userId) })
  const ledger = (user = A) => db.prepare('SELECT * FROM point_ledger WHERE user_id = ? ORDER BY id').all(user.userId).map(row => ({ ...row }))
  return { db, env, profile, ledger }
}

async function start(f, game = 'puzzle', now = NOW - 60_000, user = A, id = crypto.randomUUID()) {
  await app.rewards.startGameRewardRun(f.env, user, game, id, now)
  return id
}

function receipt(f, game, id) {
  const row = f.db.prepare('SELECT * FROM game_reward_runs WHERE game = ? AND run_id = ?').get(game, id)
  return row ? { ...row } : null
}

async function complete(f, { game = 'puzzle', score = 10_000, now = NOW, elapsed = 60_000, user = A } = {}) {
  const id = await start(f, game, now - elapsed, user)
  const result = await app.rewards.finishGameRewardRun(f.env, user, game, id, score, now)
  return { id, result, receipt: receipt(f, game, id) }
}

function daily(f, day, user = A) {
  return f.db.prepare('SELECT earned_points FROM game_reward_daily WHERE user_id = ? AND reward_day = ?').get(user.userId, day)?.earned_points ?? 0
}

test('the additive migration preserves existing balances, EXP and profile settings on repeat application', t => {
  const f = fixture(t)
  const before = f.profile()
  f.db.exec(readFileSync(new URL('../migrations/0027_game_rewards.sql', import.meta.url), 'utf8'))
  assert.deepEqual(f.profile(), before)
  assert.equal(f.db.prepare('SELECT count(*) n FROM game_reward_runs').get().n, 0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM game_reward_daily').get().n, 0)
  assert.equal(f.ledger().length, 0)
})

test('completed games credit floor(score/100), capped at 100 points per play, without changing EXP or appearance', async t => {
  const f = fixture(t)
  const original = f.profile()
  let awarded = 0
  const cases = [[0, 0], [99, 0], [100, 1], [199, 1], [9999, 99], [10_000, 100], [250_000, 100]]
  for (const [score, expected] of cases) {
    const run = await complete(f, { score })
    assert.equal(run.result.points, expected, `score ${score}`)
    assert.equal(run.receipt.points, expected)
    awarded += expected
    assert.equal(f.profile().points, original.points + awarded)
    assert.equal(daily(f, '2026-09-21'), awarded)
  }
  for (const key of ['public_id', 'total_exp', 'active_theme', 'equipped_title']) assert.equal(f.profile()[key], original[key])
  assert.equal(f.ledger().reduce((sum, row) => sum + row.delta, 0), awarded)
})

test('a retry or simultaneous completion of one run changes the balance and ledger exactly once', async t => {
  const f = fixture(t)
  const id = await start(f)
  const before = f.profile().points
  await Promise.all(Array.from({ length: 24 }, () => app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, 8765, NOW)))
  const recorded = receipt(f, 'puzzle', id)
  assert.equal(recorded.points, 87)
  assert.equal(f.profile().points, before + 87)
  assert.equal(daily(f, '2026-09-21'), 87)
  assert.equal(f.ledger().length, 1)
  assert.equal(f.ledger()[0].reason, 'game_puzzle')
  assert.equal(f.ledger()[0].reason_key, `game:puzzle:${id}`)
  await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, 99_999, NOW + 86_400_000)
  assert.deepEqual(receipt(f, 'puzzle', id), recorded, 'retry cannot replace its original score, day or award')
  assert.equal(f.profile().points, before + 87)
})

test('the 1000-point daily allowance is shared by both games and truncates the final reward', async t => {
  const f = fixture(t)
  const before = f.profile().points
  for (let i = 0; i < 9; i++) await complete(f, { game: i % 2 ? 'survivor' : 'puzzle' })
  await complete(f, { game: 'survivor', score: 7500 })
  const last = await complete(f, { game: 'puzzle', score: 10_000 })
  const capped = await complete(f, { game: 'survivor', score: 10_000 })
  assert.equal(last.result.points, 25)
  assert.equal(capped.result.points, 0)
  assert.equal(f.profile().points, before + 1000)
  assert.equal(daily(f, '2026-09-21'), 1000)
  assert.equal(f.ledger().reduce((sum, row) => sum + row.delta, 0), 1000)
  const bob = await complete(f, { user: B })
  assert.equal(bob.result.points, 100, 'another user has a separate daily allowance')
  assert.equal(daily(f, '2026-09-21', B), 100)
})

test('simultaneous finishes in both games cannot exceed the remaining shared daily allowance', async t => {
  const f = fixture(t)
  for (let i = 0; i < 9; i++) await complete(f)
  await complete(f, { score: 5000 })
  const before = f.profile().points
  const puzzle = await start(f, 'puzzle')
  const survivor = await start(f, 'survivor')
  await Promise.all([
    app.rewards.finishGameRewardRun(f.env, A, 'puzzle', puzzle, 10_000, NOW),
    app.rewards.finishGameRewardRun(f.env, A, 'survivor', survivor, 10_000, NOW),
  ])
  assert.equal(receipt(f, 'puzzle', puzzle).points + receipt(f, 'survivor', survivor).points, 50)
  assert.equal(f.profile().points, before + 50)
  assert.equal(daily(f, '2026-09-21'), 1000)
  assert.equal(f.ledger().reduce((sum, row) => sum + row.delta, 0), 1000)
})

test('the daily allowance resets at Japan midnight and an old capped run cannot be replayed into the next day', async t => {
  const f = fixture(t)
  const beforeMidnight = Date.parse('2026-09-21T14:59:59.999Z')
  const midnight = beforeMidnight + 1
  for (let i = 0; i < 10; i++) await complete(f, { now: beforeMidnight })
  const capped = await complete(f, { now: beforeMidnight, game: 'survivor' })
  const nextDayRun = await start(f, 'puzzle', midnight - 60_000)
  const nextDay = await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', nextDayRun, 10_000, midnight)
  assert.equal(nextDay.points, 100)
  assert.equal(receipt(f, 'puzzle', nextDayRun).reward_day, '2026-09-22')
  assert.equal(daily(f, '2026-09-21'), 1000)
  assert.equal(daily(f, '2026-09-22'), 100)
  const beforeReplay = f.profile().points
  await app.rewards.finishGameRewardRun(f.env, A, 'survivor', capped.id, 10_000, midnight)
  assert.equal(receipt(f, 'survivor', capped.id).points, 0)
  assert.equal(receipt(f, 'survivor', capped.id).reward_day, '2026-09-21')
  assert.equal(f.profile().points, beforeReplay)
  assert.equal(daily(f, '2026-09-22'), 100)
})

test('eligibility uses the server start time: 29.999 seconds earns zero; 30 seconds earns points', async t => {
  const f = fixture(t)
  const before = f.profile().points
  const short = await complete(f, { elapsed: 29_999 })
  assert.equal(short.result.points, 0)
  await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', short.id, 10_000, NOW + 60_000)
  assert.equal(receipt(f, 'puzzle', short.id).points, 0, 'an ineligible finish is terminal even if retried later')
  assert.equal(f.profile().points, before)
  const enough = await complete(f, { elapsed: 30_000 })
  assert.equal(enough.result.points, 100)
  assert.equal(f.profile().points, before + 100)
})

test('zero and sub-100 scores remain terminal and cannot be upgraded by replaying a larger score', async t => {
  const f = fixture(t)
  const before = f.profile().points
  for (const score of [0, 99]) {
    const run = await complete(f, { score })
    const recorded = receipt(f, 'puzzle', run.id)
    await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', run.id, 10_000, NOW + 60_000)
    assert.deepEqual(receipt(f, 'puzzle', run.id), recorded)
  }
  assert.equal(f.profile().points, before)
  assert.equal(f.ledger().reduce((sum, row) => sum + row.delta, 0), 0)
})

test('reward eligibility expires after 24 hours without granting or later reviving points', async t => {
  const f = fixture(t)
  const boundary = await complete(f, { elapsed: 86_400_000 })
  assert.equal(boundary.result.points, 100, 'exactly 24 hours is within the specified lifetime')
  const before = f.profile().points
  const expired = await complete(f, { elapsed: 86_400_001 })
  assert.equal(expired.result.points, 0)
  await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', expired.id, 10_000, NOW + 60_000)
  assert.equal(receipt(f, 'puzzle', expired.id).points, 0)
  assert.equal(f.profile().points, before)
})

test('a different user cannot start, finish or cancel another user’s reward run', async t => {
  const f = fixture(t)
  const id = await start(f)
  const before = receipt(f, 'puzzle', id)
  for (const action of [
    () => app.rewards.startGameRewardRun(f.env, B, 'puzzle', id, NOW),
    () => app.rewards.finishGameRewardRun(f.env, B, 'puzzle', id, 10_000, NOW, true),
    () => app.rewards.cancelGameRewardRun(f.env, B, 'puzzle', id, NOW),
  ]) {
    await assert.rejects(action, error => error.status === 403)
    assert.deepEqual(receipt(f, 'puzzle', id), before)
  }
  assert.equal(f.profile().points, 225)
  assert.equal(f.profile(B).points, 225)
  const result = await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, 10_000, NOW)
  assert.equal(result.points, 100)
})

test('legacy or unknown runs never mint rewards; a missing run is rejected unless legacy handling is explicitly enabled', async t => {
  const f = fixture(t)
  const missing = crypto.randomUUID()
  await assert.rejects(() => app.rewards.finishGameRewardRun(f.env, A, 'puzzle', missing, 10_000, NOW))
  const legacy = await app.rewards.finishGameRewardRun(f.env, A, 'survivor', missing, 10_000, NOW, true)
  const absent = await app.rewards.gameRewardWithoutRun(f.env, A, NOW)
  assert.equal(legacy.points, 0)
  assert.equal(legacy.status, 'legacy')
  assert.equal(absent.points, 0)
  assert.equal(absent.status, 'legacy')
  assert.equal(f.db.prepare('SELECT count(*) n FROM game_reward_runs').get().n, 0)
  assert.equal(f.profile().points, 225)
  assert.equal(f.ledger().length, 0)
})

test('ledger and balance failures roll back the run, daily allowance and credit together, allowing a clean retry', async t => {
  for (const fault of ['ledger', 'balance']) {
    const f = fixture(t)
    const id = await start(f)
    const before = receipt(f, 'puzzle', id)
    const sql = fault === 'ledger'
      ? "CREATE TRIGGER game_reward_test_fault BEFORE INSERT ON point_ledger BEGIN SELECT RAISE(ABORT, 'simulated reward failure'); END"
      : "CREATE TRIGGER game_reward_test_fault BEFORE UPDATE OF points ON user_profiles BEGIN SELECT RAISE(ABORT, 'simulated reward failure'); END"
    f.db.exec(sql)
    await assert.rejects(() => app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, 10_000, NOW), /simulated reward failure/)
    assert.deepEqual(receipt(f, 'puzzle', id), before, `${fault} failure cannot consume the run`)
    assert.equal(f.profile().points, 225)
    assert.equal(daily(f, '2026-09-21'), 0)
    assert.equal(f.ledger().length, 0)
    f.db.exec('DROP TRIGGER game_reward_test_fault')
    assert.equal((await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, 10_000, NOW)).points, 100)
    assert.equal(f.profile().points, 325)
    assert.equal(daily(f, '2026-09-21'), 100)
    assert.equal(f.ledger().length, 1)
  }
})

test('start retries preserve the first server timestamp; replacing or cancelling a game makes the old run ineligible', async t => {
  const f = fixture(t)
  const first = await start(f, 'puzzle', NOW - 60_000)
  const initial = receipt(f, 'puzzle', first)
  await app.rewards.startGameRewardRun(f.env, A, 'puzzle', first, NOW)
  assert.deepEqual(receipt(f, 'puzzle', first), initial)
  const second = await start(f, 'puzzle', NOW - 30_000)
  assert.equal(receipt(f, 'puzzle', first).status, 'superseded')
  assert.equal((await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', first, 10_000, NOW)).points, 0)
  await app.rewards.cancelGameRewardRun(f.env, A, 'puzzle', second, NOW)
  assert.equal(receipt(f, 'puzzle', second).status, 'superseded')
  assert.equal((await app.rewards.finishGameRewardRun(f.env, A, 'puzzle', second, 10_000, NOW)).points, 0)
  await assert.rejects(() => app.rewards.startGameRewardRun(f.env, A, 'puzzle', second, NOW + 60_000), error => error.status === 409)
  assert.equal(f.profile().points, 225)
  assert.equal(f.ledger().length, 0)
})

test('invalid IDs and scores cannot settle or mutate a valid run', async t => {
  const f = fixture(t)
  const id = await start(f)
  const before = receipt(f, 'puzzle', id)
  for (const score of [-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '10000', null]) {
    await assert.rejects(() => app.rewards.finishGameRewardRun(f.env, A, 'puzzle', id, score, NOW), error => error.status === 400)
  }
  for (const invalid of ['', 'short', '../a-file', 'x'.repeat(81), null, {}]) {
    await assert.rejects(() => app.rewards.startGameRewardRun(f.env, A, 'puzzle', invalid, NOW), error => error.status === 400)
    await assert.rejects(() => app.rewards.finishGameRewardRun(f.env, A, 'puzzle', invalid, 10_000, NOW), error => error.status === 400)
  }
  assert.deepEqual(receipt(f, 'puzzle', id), before)
  assert.equal(f.profile().points, 225)
  assert.equal(f.ledger().length, 0)
})

test('a failed companion start statement rolls back session replacement and preserves the previous pending run', async t => {
  const f = fixture(t)
  const old = await start(f, 'survivor')
  const before = receipt(f, 'survivor', old)
  const next = crypto.randomUUID()
  const failure = f.env.DB.prepare('INSERT INTO table_that_does_not_exist(value) VALUES (?)').bind(1)
  await assert.rejects(() => app.rewards.startGameRewardRun(f.env, A, 'survivor', next, NOW, [failure]), /no such table/)
  assert.deepEqual(receipt(f, 'survivor', old), before)
  assert.equal(receipt(f, 'survivor', next), null)
  assert.equal(f.profile().points, 225)
})

test('simultaneous starts preserve a single original timestamp or a single active session', async t => {
  const f = fixture(t)
  const sameId = crypto.randomUUID()
  await Promise.all([
    app.rewards.startGameRewardRun(f.env, A, 'puzzle', sameId, NOW - 60_000),
    app.rewards.startGameRewardRun(f.env, A, 'puzzle', sameId, NOW - 20_000),
  ])
  const original = receipt(f, 'puzzle', sameId)
  assert.equal(original.started_at, NOW - 60_000)
  assert.equal(original.expires_at, original.started_at + 86_400_000)
  assert.equal(f.db.prepare("SELECT count(*) n FROM game_reward_runs WHERE status = 'pending'").get().n, 1)
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID())
  const results = await Promise.allSettled(ids.map(id => app.rewards.startGameRewardRun(f.env, A, 'puzzle', id, NOW)))
  assert.ok(results.some(result => result.status === 'fulfilled'))
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 409))
  assert.equal(f.db.prepare("SELECT count(*) n FROM game_reward_runs WHERE status = 'pending'").get().n, 1)
  assert.equal(receipt(f, 'puzzle', sameId).status, 'superseded')
  assert.equal(f.profile().points, 225)
})

test('the puzzle score integration earns points only for a valid owned session and keeps legacy ranking support', async t => {
  const f = fixture(t)
  const legacy = await app.puzzle.submitScore(f.env, A, 5000, 50, 9, undefined, NOW)
  assert.equal(legacy.best, 5000)
  assert.equal(legacy.reward.status, 'legacy')
  assert.equal(legacy.reward.points, 0)
  const id = crypto.randomUUID()
  await app.puzzle.startPuzzleRun(f.env, A, id, NOW - 60_000)
  await assert.rejects(() => app.puzzle.submitScore(f.env, B, 5000, 50, 9, id, NOW), error => error.status === 403)
  assert.equal(f.db.prepare('SELECT count(*) n FROM mochi_scores WHERE user_id = ?').get(B.userId).n, 0)
  await assert.rejects(() => app.puzzle.submitScore(f.env, A, 5000, 0, 9, id, NOW), error => error.status === 400)
  assert.equal(receipt(f, 'puzzle', id).status, 'pending', 'invalid scores cannot consume a good run')
  const result = await app.puzzle.submitScore(f.env, A, 9900, 100, 9, id, NOW)
  assert.equal(result.reward.points, 99)
  assert.equal(result.best, 9900)
  assert.equal(f.profile().points, 324)
  await app.puzzle.submitScore(f.env, A, 20_000, 200, 9, id, NOW + 86_400_000)
  assert.equal(receipt(f, 'puzzle', id).score, 9900)
  assert.equal(f.profile().points, 324)
  assert.equal(f.ledger().length, 1)
})

test('a puzzle ranking failure cannot double-credit the reward on retry', async t => {
  const f = fixture(t)
  const id = crypto.randomUUID()
  await app.puzzle.startPuzzleRun(f.env, A, id, NOW - 60_000)
  f.db.exec("CREATE TRIGGER game_reward_test_rank_failure BEFORE INSERT ON mochi_scores BEGIN SELECT RAISE(ABORT, 'simulated ranking failure'); END")
  await assert.rejects(() => app.puzzle.submitScore(f.env, A, 5000, 50, 9, id, NOW), /simulated ranking failure/)
  assert.equal(f.profile().points, 275)
  assert.equal(receipt(f, 'puzzle', id).score, 5000)
  assert.equal(f.ledger().length, 1)
  f.db.exec('DROP TRIGGER game_reward_test_rank_failure')
  const retry = await app.puzzle.submitScore(f.env, A, 5000, 50, 9, id, NOW + 1000)
  assert.equal(retry.reward.points, 50)
  assert.equal(retry.best, 5000)
  assert.equal(f.profile().points, 275)
  assert.equal(f.ledger().length, 1)
})

function survivorReport(score = 900) {
  return {
    score, seconds: 60, kills: 120, bossKills: 0, cleanBosses: 0, maxAttackKills: 0,
    treasures: 0, commanders: 0, traps: 0, weapons: { kunai: { damage: 900, kills: 120 } },
  }
}

async function startSurvivor(f, user = A, at = NOW - 60_000) {
  const id = crypto.randomUUID()
  await app.survivor.ensurePlayer(f.env, user, at)
  await app.survivor.startRun(f.env, user, { id, mode: 'normal', weapon: 'kunai', ruleset: app.survivor.RULESET }, at)
  return id
}

test('concurrent survivor starts with different IDs cannot report success for an orphan reward session', async t => {
  const f = fixture(t)
  await app.survivor.ensurePlayer(f.env, A, NOW)
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  const results = await Promise.allSettled(ids.map(id => app.survivor.startRun(f.env, A,
    { id, mode: 'normal', weapon: 'kunai', ruleset: app.survivor.RULESET }, NOW)))
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      assert.ok(f.db.prepare('SELECT id FROM survivor_runs WHERE id = ?').get(ids[index]), 'every successful start must have a stored survivor run')
    }
  }
  assert.equal(results[0].status, 'fulfilled', 'the first committed start survives the rejected competing transaction')
  assert.equal(results[1].status, 'rejected')
  assert.match(String(results[1].reason), /UNIQUE constraint failed: survivor_runs.owner/)
  assert.equal(receipt(f, 'survivor', ids[0]).status, 'pending', 'the failed transaction must roll back reward supersession')
  assert.equal(receipt(f, 'survivor', ids[1]), null, 'the failed transaction must roll back its reward session')
  assert.equal(f.db.prepare("SELECT count(*) n FROM game_reward_runs r LEFT JOIN survivor_runs s ON s.id = r.run_id WHERE r.game = 'survivor' AND r.status = 'pending' AND s.id IS NULL").get().n, 0)
  assert.equal(f.db.prepare('SELECT count(*) n FROM survivor_runs WHERE finished_at IS NULL').get().n, 1)
})

test('concurrent survivor starts with the same ID remain idempotent and return the persisted game configuration', async t => {
  const f = fixture(t)
  await app.survivor.ensurePlayer(f.env, A, NOW)
  const id = crypto.randomUUID()
  const results = await Promise.all([NOW - 1000, NOW].map(at => app.survivor.startRun(f.env, A,
    { id, mode: 'normal', weapon: 'kunai', ruleset: app.survivor.RULESET }, at)))
  const stored = f.db.prepare('SELECT * FROM survivor_runs WHERE id = ?').get(id)
  for (const result of results) {
    assert.equal(result.id, stored.id)
    assert.equal(result.mode, stored.mode)
    assert.equal(result.seed, stored.seed, 'a retry must not return a new seed for an existing run')
    assert.equal(result.weapon, stored.weapon)
    assert.equal(result.week.key, app.survivor.weekAt(stored.started_at).key)
  }
  assert.equal(stored.started_at, NOW - 1000)
  assert.equal(receipt(f, 'survivor', id).started_at, stored.started_at)
  assert.equal(f.db.prepare('SELECT count(*) n FROM survivor_runs').get().n, 1)
  assert.equal(f.db.prepare('SELECT count(*) n FROM game_reward_runs').get().n, 1)
})

test('survivor integrates the same reward balance and concurrent score finishes only award the stored outcome', async t => {
  const f = fixture(t)
  const id = await startSurvivor(f)
  await assert.rejects(() => app.survivor.finishRun(f.env, B, { id, report: survivorReport() }, NOW), error => error.status === 404)
  await assert.rejects(() => app.survivor.finishRun(f.env, A, { id, report: survivorReport(99_999_999) }, NOW), error => error.status === 400)
  assert.equal(receipt(f, 'survivor', id).status, 'pending')
  await Promise.all([
    app.survivor.finishRun(f.env, A, { id, report: survivorReport(900) }, NOW),
    app.survivor.finishRun(f.env, A, { id, report: survivorReport(1900) }, NOW + 1),
  ])
  const stored = f.db.prepare('SELECT * FROM survivor_runs WHERE id = ?').get(id)
  assert.equal(stored.score, 900, 'first conditional finish is the accepted outcome')
  assert.equal(receipt(f, 'survivor', id).score, stored.score)
  assert.equal(receipt(f, 'survivor', id).finished_at, stored.finished_at)
  assert.equal(f.profile().points, 234)
  assert.equal(f.ledger().length, 1)
  assert.equal((await app.survivor.getPlayer(f.env, A.userId)).plays, 1)
  assert.equal((await app.survivor.getPlayer(f.env, A.userId)).best_score, 900)
})

test('a failed survivor reward retried after Japan midnight uses the saved score, finish time and original day cap', async t => {
  const f = fixture(t)
  const beforeMidnight = Date.parse('2026-09-21T14:59:59.000Z')
  for (let i = 0; i < 9; i++) await complete(f, { now: beforeMidnight })
  await complete(f, { now: beforeMidnight, score: 9500 })
  const id = await startSurvivor(f, A, beforeMidnight - 60_000)
  f.db.exec("CREATE TRIGGER game_reward_test_survivor_failure BEFORE INSERT ON point_ledger WHEN NEW.reason = 'game_survivor' BEGIN SELECT RAISE(ABORT, 'simulated survivor reward failure'); END")
  await assert.rejects(() => app.survivor.finishRun(f.env, A, { id, report: survivorReport(900) }, beforeMidnight), /simulated survivor reward failure/)
  assert.equal(f.db.prepare('SELECT score FROM survivor_runs WHERE id = ?').get(id).score, 900, 'validated game score was already saved')
  assert.equal(receipt(f, 'survivor', id).status, 'pending', 'failed credit stays retryable')
  assert.equal(daily(f, '2026-09-21'), 995)
  f.db.exec('DROP TRIGGER game_reward_test_survivor_failure')
  const retry = await app.survivor.finishRun(f.env, A, { id, report: { score: 999_999 } }, beforeMidnight + 60_000)
  assert.equal(retry.already, true)
  assert.equal(retry.reward.points, 5)
  assert.equal(receipt(f, 'survivor', id).score, 900)
  assert.equal(receipt(f, 'survivor', id).reward_day, '2026-09-21')
  assert.equal(receipt(f, 'survivor', id).finished_at, beforeMidnight)
  assert.equal(daily(f, '2026-09-21'), 1000)
  assert.equal(daily(f, '2026-09-22'), 0)
  assert.equal(f.profile().points, 1225)
})

test('starting another survivor game must recover a saved reward using its original JST day or preserve it on failure', async t => {
  const f = fixture(t)
  const beforeMidnight = Date.parse('2026-09-21T14:59:59.000Z')
  const nextDay = beforeMidnight + 2000
  for (let i = 0; i < 9; i++) await complete(f, { now: beforeMidnight })
  await complete(f, { now: beforeMidnight, score: 9500 })
  const oldId = await startSurvivor(f, A, beforeMidnight - 60_000)
  f.db.exec("CREATE TRIGGER game_reward_test_recovery_failure BEFORE INSERT ON point_ledger WHEN NEW.reason = 'game_survivor' BEGIN SELECT RAISE(ABORT, 'simulated survivor recovery failure'); END")
  await assert.rejects(() => app.survivor.finishRun(f.env, A, { id: oldId, report: survivorReport(900) }, beforeMidnight), /simulated survivor recovery failure/)
  const pending = receipt(f, 'survivor', oldId)
  const nextId = crypto.randomUUID()
  const body = { id: nextId, mode: 'normal', weapon: 'kunai', ruleset: app.survivor.RULESET }
  await assert.rejects(() => app.survivor.startRun(f.env, A, body, nextDay), /simulated survivor recovery failure/)
  assert.deepEqual(receipt(f, 'survivor', oldId), pending, 'another start must not supersede an unpaid saved outcome')
  assert.equal(receipt(f, 'survivor', nextId), null)
  assert.equal(f.db.prepare('SELECT id FROM survivor_runs WHERE id = ?').get(nextId), undefined)
  assert.equal(daily(f, '2026-09-21'), 995)
  f.db.exec('DROP TRIGGER game_reward_test_recovery_failure')
  const next = await app.survivor.startRun(f.env, A, body, nextDay)
  assert.equal(next.id, nextId)
  const recovered = receipt(f, 'survivor', oldId)
  assert.equal(recovered.status, 'awarded')
  assert.equal(recovered.points, 5)
  assert.equal(recovered.score, 900)
  assert.equal(recovered.finished_at, beforeMidnight)
  assert.equal(recovered.reward_day, '2026-09-21')
  assert.equal(daily(f, '2026-09-21'), 1000)
  assert.equal(daily(f, '2026-09-22'), 0)
  assert.equal(receipt(f, 'survivor', nextId).status, 'pending')
  assert.equal(f.db.prepare('SELECT finished_at FROM survivor_runs WHERE id = ?').get(nextId).finished_at, null)
  assert.equal(f.profile().points, 1225)
  const finished = await app.survivor.finishRun(f.env, A, { id: nextId, report: survivorReport(900) }, nextDay + 60_000)
  assert.equal(finished.reward.points, 9)
  assert.equal(daily(f, '2026-09-22'), 9)
  assert.equal(f.profile().points, 1234)
})

test('the transactional start guard cannot supersede a survivor outcome saved after the recovery query', async t => {
  const f = fixture(t)
  const oldId = await startSurvivor(f)
  f.db.exec("CREATE TRIGGER game_reward_test_window_failure BEFORE INSERT ON point_ledger WHEN NEW.reason = 'game_survivor' BEGIN SELECT RAISE(ABORT, 'simulated unpaid saved outcome'); END")
  await assert.rejects(() => app.survivor.finishRun(f.env, A, { id: oldId, report: survivorReport(900) }, NOW), /simulated unpaid saved outcome/)
  const pending = receipt(f, 'survivor', oldId)
  const nextId = crypto.randomUUID()
  // Invoke the transactional stage directly, as though this finish became
  // visible only after startRun had already checked for unpaid saved outcomes.
  await assert.rejects(() => app.rewards.startGameRewardRun(f.env, A, 'survivor', nextId, NOW + 1000), /UNIQUE constraint failed: game_reward_runs.user_id, game_reward_runs.game/)
  assert.deepEqual(receipt(f, 'survivor', oldId), pending)
  assert.equal(receipt(f, 'survivor', nextId), null)
  assert.equal(f.db.prepare('SELECT score FROM survivor_runs WHERE id = ?').get(oldId).score, 900)
  assert.equal(f.profile().points, 225)
  f.db.exec('DROP TRIGGER game_reward_test_window_failure')
  const recovered = await app.survivor.finishRun(f.env, A, { id: oldId, report: {} }, NOW + 1000)
  assert.equal(recovered.reward.points, 9)
  assert.equal(f.profile().points, 234)
})

test('legacy survivor sessions keep their scores but never gain retroactive points', async t => {
  const f = fixture(t)
  await app.survivor.ensurePlayer(f.env, A, NOW - 60_000)
  for (const finished of [false, true]) {
    const id = crypto.randomUUID()
    f.db.prepare(`INSERT INTO survivor_runs(id,owner,mode,week,ruleset,weapon,seed,started_at,finished_at,score,seconds,kills)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, A.userId, 'normal', '2026-W39', app.survivor.RULESET, 'kunai', 1, NOW - 60_000, finished ? NOW : null, finished ? 900 : 0, finished ? 60 : 0, finished ? 120 : 0)
    const result = await app.survivor.finishRun(f.env, A, { id, report: survivorReport() }, NOW)
    assert.equal(result.reward.points, 0)
    assert.equal(result.reward.status, 'legacy')
    assert.equal(receipt(f, 'survivor', id), null)
    assert.equal(f.db.prepare('SELECT score FROM survivor_runs WHERE id = ?').get(id).score, 900)
  }
  assert.equal(f.profile().points, 225)
  assert.equal(f.ledger().length, 0)
})
