import { applyAction, createRound, publicRound } from '../../../public/static/casino/engine.mjs'

export class CasinoError extends Error {
  constructor(public code: string, message: string, public status: 400 | 401 | 403 | 409 | 503 = 400) {
    super(message)
    this.name = 'CasinoError'
  }
}

type DB = D1Database
type Mode = 'draw' | 'duel' | 'blackjack'
type Receipt = { payload: string; round_id: string }
type RoundRow = { state_json: string; version: number; finished: number }
export type StartInput = { mode: Mode; stake: number; requestId: string }
export type ActionInput = { roundId: string; version: number; action: string; discards?: number[]; requestId: string }

export function validateRequestId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(value)) {
    throw new CasinoError('INVALID_REQUEST', '操作IDが正しくありません。画面を開き直してください。')
  }
}

function mapDatabaseError(error: unknown): CasinoError {
  const text = error instanceof Error ? error.message : ''
  if (text.includes('casino_insufficient_points')) return new CasinoError('INSUFFICIENT_POINTS', 'この操作に必要なポイントが足りません。', 409)
  if (text.includes('casino_active_round')) return new CasinoError('ACTIVE_ROUND', 'プレイ中のゲームを先に終えてください。', 409)
  if (text.includes('casino_stale_round') || text.includes('casino_round_conflict')) return new CasinoError('STALE_ROUND', 'ゲームが更新されています。最新の状態を確認してください。', 409)
  return new CasinoError('UNAVAILABLE', '今はゲームを更新できません。時間をおいて再接続してください。', 503)
}

function engineError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    throw new CasinoError('INVALID_ACTION', 'この操作は現在のゲームでは選べません。')
  }
  throw error
}

async function receipt(db: DB, userId: string, requestId: string, payload: string): Promise<Receipt | null> {
  const found = await db.prepare('SELECT payload, round_id FROM casino_receipts WHERE user_id = ? AND request_id = ?')
    .bind(userId, requestId).first<Receipt>()
  if (found && found.payload !== payload) {
    throw new CasinoError('REQUEST_CONFLICT', '同じ操作IDで別の操作は送れません。最新の状態を確認してください。', 409)
  }
  return found
}

/** A single SQLite statement owns the transition, all points and its retry receipt. */
async function commit(db: DB, userId: string, requestId: string, payload: string,
  expectedVersion: number, transition: { state: any; delta: number }, cost: number) {
  const { state, delta } = transition
  if (![state.spent, state.payout, state.net, delta, cost].every(Number.isSafeInteger) || cost < 0) {
    throw new CasinoError('UNAVAILABLE', 'ゲームの更新を停止しました。再接続してください。', 503)
  }
  try {
    await db.prepare(`INSERT INTO casino_receipts
      (user_id, request_id, payload, round_id, expected_version, mode, stake, version,
       finished, state_json, spent, payout, net, result, cost, delta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, requestId, payload, state.id, expectedVersion, state.mode, state.stake,
        state.version, state.finished ? 1 : 0, JSON.stringify(state), state.spent,
        state.payout, state.net, state.result || '', cost, delta).run()
  } catch (error) {
    // Includes concurrent delivery of the same request and uncertain network
    // outcomes. A committed receipt wins; a changed payload can never replay it.
    const existing = await receipt(db, userId, requestId, payload)
    if (existing) return existing.round_id
    throw mapDatabaseError(error)
  }
  return state.id as string
}

export async function getCasinoEnvelope(db: DB, userId: string, preferredRoundId?: string) {
  // D1 batch reads form one transaction, so the balance, active cards and history
  // cannot come from opposite sides of a concurrent wager.
  const rows = await db.batch([
    db.prepare('SELECT points FROM user_profiles WHERE user_id = ?').bind(userId),
    db.prepare(`SELECT state_json FROM casino_rounds WHERE user_id = ?
      AND (finished = 0 OR round_id = ?) ORDER BY finished ASC, created_at DESC LIMIT 1`)
      .bind(userId, preferredRoundId || ''),
    db.prepare(`SELECT round_id AS id, mode, stake, spent, payout, net, result,
      created_at AS createdAt FROM casino_rounds WHERE user_id = ? AND finished = 1
      ORDER BY updated_at DESC, rowid DESC LIMIT 20`).bind(userId),
    db.prepare(`SELECT COALESCE(SUM(delta), 0) AS profit FROM point_ledger
      WHERE user_id = ? AND reason IN ('casino_wager', 'casino_payout')`).bind(userId),
  ])
  const profile = rows[0].results[0] as { points: number } | undefined
  const round = rows[1].results[0] as { state_json: string } | undefined
  if (!profile) throw new CasinoError('UNAVAILABLE', 'プロフィールを読み込めませんでした。', 503)
  return {
    balance: profile.points,
    profit: (rows[3].results[0] as { profit: number }).profit,
    round: round ? publicRound(JSON.parse(round.state_json)) : null,
    history: rows[2].results,
  }
}

export async function startCasinoRound(db: DB, userId: string, input: StartInput) {
  validateRequestId(input.requestId)
  const payload = JSON.stringify({ kind: 'start', mode: input.mode, stake: input.stake })
  const existing = await receipt(db, userId, input.requestId, payload)
  if (existing) return getCasinoEnvelope(db, userId, existing.round_id)
  let transition
  try { transition = createRound({ id: crypto.randomUUID(), mode: input.mode, stake: input.stake }) }
  catch (error) { engineError(error) }
  const id = await commit(db, userId, input.requestId, payload, 0, transition!, transition!.state.spent)
  return getCasinoEnvelope(db, userId, id)
}

export async function actCasinoRound(db: DB, userId: string, input: ActionInput) {
  validateRequestId(input.requestId)
  const payload = JSON.stringify({ kind: 'action', roundId: input.roundId, version: input.version,
    action: input.action, discards: input.discards === undefined ? null : [...input.discards].sort((a, b) => a - b) })
  const existing = await receipt(db, userId, input.requestId, payload)
  if (existing) return getCasinoEnvelope(db, userId, existing.round_id)
  const row = await db.prepare('SELECT state_json, version, finished FROM casino_rounds WHERE round_id = ? AND user_id = ?')
    .bind(input.roundId, userId).first<RoundRow>()
  if (!row || row.finished || row.version !== input.version) {
    throw new CasinoError('STALE_ROUND', 'ゲームが更新されています。最新の状態を確認してください。', 409)
  }
  const state = JSON.parse(row.state_json)
  const action = publicRound(state).actions.find((item: { id: string }) => item.id === input.action)
  if (!action) throw new CasinoError('INVALID_ACTION', 'この操作は現在のゲームでは選べません。')
  let transition
  try { transition = applyAction(state, { action: input.action, ...(input.discards === undefined ? {} : { discards: input.discards }) }) }
  catch (error) { engineError(error) }
  const id = await commit(db, userId, input.requestId, payload, input.version, transition!, action.cost)
  return getCasinoEnvelope(db, userId, id)
}
