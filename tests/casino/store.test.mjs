import test from 'node:test'
import assert from 'node:assert/strict'
import { createRound, applyAction } from '../../public/static/casino/engine.mjs'
import { fixture, fullDeck, insertTransition, loadBackend, USER, OTHER } from './backend-fixture.mjs'

const { startCasinoRound, actCasinoRound, getCasinoEnvelope } = await loadBackend()
const start = (DB, requestId = 'start-request-0001', extra = {}) => startCasinoRound(DB, USER, { mode: 'draw', stake: 500, requestId, ...extra })
const draw = (DB, round, requestId = 'draw-request-0001', discards = [0, 1, 2, 3, 4]) => actCasinoRound(DB, USER,
  { roundId: round.id, version: round.version, action: 'draw', discards, requestId })
const count = (sql, table) => sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
const rejectCode = code => error => error?.code === code

test('a wager, active cards and profit resume together; retries neither reshuffle nor debit twice', async t => {
  const { DB, sql } = fixture(t)
  const [first, replay] = await Promise.all([start(DB), start(DB)])
  assert.deepEqual(first, replay)
  assert.equal(first.balance, 4500)
  assert.equal(first.profit, -500)
  assert.equal(first.round.finished, false)
  assert.equal(new Set(first.round.hand).size, 5)
  assert.equal('deck' in first.round, false)
  assert.equal('dealerCards' in first.round, false)
  assert.deepEqual(await getCasinoEnvelope(DB, USER), first)
  assert.equal(count(sql, 'casino_receipts'), 1)
  assert.deepEqual(sql.prepare('SELECT delta, reason FROM point_ledger').all().map(row => ({ ...row })), [{ delta: -500, reason: 'casino_wager' }])
  await assert.rejects(start(DB, 'start-request-0001', { stake: 100 }), rejectCode('REQUEST_CONFLICT'))
})

test('one active round covers all modes and concurrent starts; different users remain independent', async t => {
  const { DB, sql } = fixture(t)
  const attempts = await Promise.allSettled([start(DB, 'different-start-a'), start(DB, 'different-start-b', { mode: 'duel', stake: 200 })])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(attempts.find(item => item.status === 'rejected').reason.code, 'ACTIVE_ROUND')
  assert.equal(count(sql, 'casino_receipts'), 1)
  await startCasinoRound(DB, OTHER, { mode: 'draw', stake: 100, requestId: 'other-user-start' })
  assert.equal(count(sql, 'casino_rounds'), 2)
})

test('settlement is durable once and session cannot disclose a completed deck', async t => {
  const { DB, sql } = fixture(t)
  const { round } = await start(DB)
  const settled = await draw(DB, round)
  assert.equal(settled.round.finished, true)
  assert.equal(settled.balance, 4500 + settled.round.payout)
  assert.equal(settled.profit, settled.round.net)
  assert.equal(settled.history.length, 1)
  assert.deepEqual(await draw(DB, round), settled)
  assert.equal(count(sql, 'casino_receipts'), 2)
  assert.equal((await getCasinoEnvelope(DB, USER)).round, null)
  await assert.rejects(draw(DB, round, 'different-action'), rejectCode('STALE_ROUND'))
  const next = await start(DB, 'next-game-request')
  const oldRetry = await draw(DB, round)
  assert.deepEqual(oldRetry.round, next.round, 'an old retry must resume the newer active game')
})

test('concurrent exchange attempts have one winner and cannot buy a reroll', async t => {
  const { DB, sql } = fixture(t)
  const { round } = await start(DB)
  const attempts = await Promise.allSettled([draw(DB, round, 'exchange-one'), draw(DB, round, 'exchange-two')])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(attempts.find(item => item.status === 'rejected').reason.code, 'STALE_ROUND')
  assert.equal(count(sql, 'casino_receipts'), 2)
  const { balance, profit, history } = await getCasinoEnvelope(DB, USER)
  assert.equal(balance, 5000 + profit)
  assert.equal(history.length, 1)
})

test('foreign rounds, invalid selections and changed retry payload cannot spend points', async t => {
  const { DB, sql } = fixture(t)
  const { round } = await start(DB)
  await assert.rejects(actCasinoRound(DB, OTHER, { roundId: round.id, version: 1, action: 'draw', discards: [], requestId: 'foreign-request' }), rejectCode('STALE_ROUND'))
  await assert.rejects(draw(DB, round, 'invalid-exchange', [1, 1]), rejectCode('INVALID_ACTION'))
  await draw(DB, round, 'valid-exchange', [0, 1])
  await assert.rejects(draw(DB, round, 'valid-exchange', [0, 2]), rejectCode('REQUEST_CONFLICT'))
  assert.equal(count(sql, 'casino_receipts'), 2)
})

test('insufficient entry funds leave no receipt, round or balance changes', async t => {
  const { DB, sql } = fixture(t, 100)
  await assert.rejects(start(DB), rejectCode('INSUFFICIENT_POINTS'))
  assert.equal(count(sql, 'casino_rounds'), 0)
  assert.equal(count(sql, 'casino_receipts'), 0)
  assert.equal(count(sql, 'point_ledger'), 0)
  assert.equal((await getCasinoEnvelope(DB, USER)).balance, 100)
})

test('even an immediately winning natural requires the initial wager', t => {
  const { sql } = fixture(t, 50)
  const transition = createRound({ id: 'natural-round', mode: 'blackjack', stake: 100 }, { deck: fullDeck('AS', '9H', 'KH', '7C') })
  assert.equal(transition.delta, 150)
  assert.throws(() => insertTransition(sql, transition), /casino_insufficient_points/)
  assert.equal(count(sql, 'casino_receipts'), 0)
  assert.equal(count(sql, 'point_ledger'), 0)
})

test('winning double still needs additional wager; failure preserves the original cards and can stand instead', async t => {
  const { sql, DB } = fixture(t, 150)
  const transition = createRound({ id: 'double-round', mode: 'blackjack', stake: 100 }, { deck: fullDeck('5S', '9H', '6H', '7C', 'KD', '2C') })
  insertTransition(sql, transition)
  const win = applyAction(transition.state, { action: 'double' })
  assert.ok(win.delta > 0, 'fixture double wins while requiring an unaffordable wager')
  await assert.rejects(actCasinoRound(DB, USER, { roundId: 'double-round', version: 1, action: 'double', requestId: 'double-request' }), rejectCode('INSUFFICIENT_POINTS'))
  const unchanged = await getCasinoEnvelope(DB, USER)
  assert.equal(unchanged.balance, 50)
  assert.deepEqual(unchanged.round.hand, ['5S', '6H'])
  assert.equal(unchanged.round.version, 1)
  assert.equal(count(sql, 'casino_receipts'), 1)
  const standing = await actCasinoRound(DB, USER, { roundId: 'double-round', version: 1, action: 'stand', requestId: 'stand-request' })
  assert.equal(standing.round.finished, true)
})

test('settled debit and return are separate ledger entries; accounting remains balanced', t => {
  const { sql } = fixture(t, 100)
  insertTransition(sql, createRound({ id: 'natural-round', mode: 'blackjack', stake: 100 }, { deck: fullDeck('AS', '9H', 'KH', '7C') }))
  assert.equal(sql.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(USER).points, 250)
  assert.deepEqual(sql.prepare('SELECT delta FROM point_ledger ORDER BY id').all().map(row => row.delta), [-100, 250])
})

test('a downstream ledger failure rolls back receipt, balance and cards together', async t => {
  const { DB, sql } = fixture(t)
  sql.prepare('INSERT INTO point_ledger(user_id, delta, reason, reason_key) VALUES (?, 0, ?, ?)')
    .run(USER, 'fixture', `casino:${USER}:start-request-0001:wager`)
  await assert.rejects(start(DB), rejectCode('UNAVAILABLE'))
  assert.equal(count(sql, 'casino_receipts'), 0)
  assert.equal(count(sql, 'casino_rounds'), 0)
  assert.equal((await getCasinoEnvelope(DB, USER)).balance, 5000)
})

test('history is limited to the latest twenty settled rounds and never exposes state JSON', async t => {
  const { DB } = fixture(t, 10000)
  for (let index = 0; index < 23; index++) {
    const { round } = await start(DB, `history-start-${index}`, { stake: 100 })
    await draw(DB, round, `history-draw-${index}`, [])
  }
  const snapshot = await getCasinoEnvelope(DB, USER)
  assert.equal(snapshot.history.length, 20)
  assert.ok(snapshot.history.every(row => Object.keys(row).sort().join() === ['id', 'mode', 'stake', 'spent', 'payout', 'net', 'result', 'createdAt'].sort().join()))
})
