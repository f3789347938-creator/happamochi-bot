import type { LineEnv } from '../lib/line'
import { ensureProfile, jstDateString } from './profile/core'
import type { VerifiedUser } from './mochiScore'

export type RewardGame = 'puzzle' | 'survivor'
export const GAME_DAILY_LIMIT = 1000 as const
export const GAME_RUN_TTL = 24 * 60 * 60 * 1000
export interface GameRewardResult {
  points: number
  balance: number
  dailyEarned: number
  dailyLimit: typeof GAME_DAILY_LIMIT
  status: 'awarded' | 'too_short' | 'no_score' | 'daily_limit' | 'expired' | 'superseded' | 'legacy'
}

export class GameRewardError extends Error {
  constructor(public status: 400 | 403 | 409, message: string) { super(message) }
}

interface RewardRun {
  game: RewardGame
  run_id: string
  user_id: string
  started_at: number
  expires_at: number
  finished_at: number | null
  status: GameRewardResult['status'] | 'pending'
  points: number
  balance_after: number | null
  daily_earned_after: number | null
}

function validRunId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    throw new GameRewardError(400, 'ゲームの開始情報が正しくありません。')
  }
}

async function readRun(env: LineEnv, game: RewardGame, id: string): Promise<RewardRun | null> {
  return env.DB.prepare('SELECT * FROM game_reward_runs WHERE game = ? AND run_id = ?')
    .bind(game, id).first<RewardRun>()
}

/** Retry keeps the first server start time. A new ID ends the previous session. */
export async function startGameRewardRun(
  env: LineEnv, user: VerifiedUser, game: RewardGame, id: unknown,
  now = Date.now(), extraStatements: D1PreparedStatement[] = []
): Promise<{ id: string }> {
  validRunId(id)
  const existing = await readRun(env, game, id)
  if (existing) {
    if (existing.user_id !== user.userId) throw new GameRewardError(403, 'このゲームは別の方のものです。')
    if (existing.status !== 'pending' || existing.expires_at < now) {
      throw new GameRewardError(409, 'このゲームは終了しています。新しく始めてください。')
    }
    return { id }
  }
  await ensureProfile(env, user.userId, user.displayName, user.pictureUrl)
  await env.DB.batch([
    env.DB.prepare(`UPDATE game_reward_runs SET status = 'superseded', finished_at = ?
      WHERE user_id = ? AND game = ? AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM game_reward_runs WHERE game = ? AND run_id = ?)
        AND NOT (game = 'survivor' AND EXISTS (
          SELECT 1 FROM survivor_runs s WHERE s.id = game_reward_runs.run_id
            AND s.owner = game_reward_runs.user_id AND s.finished_at IS NOT NULL AND s.report IS NOT NULL))`)
      .bind(now, user.userId, game, game, id),
    env.DB.prepare(`INSERT INTO game_reward_runs(game, run_id, user_id, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(game, run_id) DO NOTHING`)
      .bind(game, id, user.userId, now, now + GAME_RUN_TTL),
    ...extraStatements,
  ])
  const created = await readRun(env, game, id)
  if (!created || created.user_id !== user.userId) throw new GameRewardError(403, 'このゲームは別の方のものです。')
  if (created.status !== 'pending') throw new GameRewardError(409, '別のゲームが開始されました。')
  return { id }
}

/** Older clients keep ranking support but cannot create retroactive rewards. */
export async function gameRewardWithoutRun(
  env: LineEnv, user: VerifiedUser, now = Date.now(), status: 'legacy' | 'superseded' = 'legacy'
): Promise<GameRewardResult> {
  const profile = await ensureProfile(env, user.userId, user.displayName, user.pictureUrl)
  const row = await env.DB.prepare('SELECT earned_points FROM game_reward_daily WHERE user_id = ? AND reward_day = ?')
    .bind(user.userId, jstDateString(new Date(now))).first<{ earned_points: number }>()
  return { points: 0, balance: profile.points, dailyEarned: row?.earned_points ?? 0, dailyLimit: GAME_DAILY_LIMIT, status }
}

/** Call only with a validated, server-owned score and completion timestamp. */
export async function finishGameRewardRun(
  env: LineEnv, user: VerifiedUser, game: RewardGame, id: unknown, score: number,
  now = Date.now(), allowLegacy = false
): Promise<GameRewardResult> {
  validRunId(id)
  if (!Number.isSafeInteger(score) || score < 0) throw new GameRewardError(400, 'ゲームのスコアが正しくありません。')
  const run = await readRun(env, game, id)
  if (!run) {
    if (allowLegacy) return gameRewardWithoutRun(env, user, now)
    throw new GameRewardError(409, 'ゲームの開始を確認できませんでした。新しく始めてください。')
  }
  if (run.user_id !== user.userId) throw new GameRewardError(403, 'このゲームは別の方のものです。')
  if (run.status === 'superseded') return gameRewardWithoutRun(env, user, now, 'superseded')
  // The trigger atomically settles the shared daily cap, immutable receipt,
  // ledger and balance. Concurrent finishes can update the pending row once.
  await env.DB.prepare(`UPDATE game_reward_runs SET finished_at = ?, score = ?, reward_day = ?
    WHERE game = ? AND run_id = ? AND user_id = ? AND status = 'pending' AND finished_at IS NULL`)
    .bind(now, score, jstDateString(new Date(now)), game, id, user.userId).run()
  const receipt = await readRun(env, game, id)
  if (!receipt || receipt.status === 'pending') throw new Error('Game reward receipt was not settled')
  if (receipt.status === 'superseded') return gameRewardWithoutRun(env, user, now, 'superseded')
  return {
    points: receipt.points, balance: receipt.balance_after ?? 0,
    dailyEarned: receipt.daily_earned_after ?? 0, dailyLimit: GAME_DAILY_LIMIT,
    status: receipt.status,
  }
}

export async function cancelGameRewardRun(
  env: LineEnv, user: VerifiedUser, game: RewardGame, id: unknown, now = Date.now()
): Promise<void> {
  validRunId(id)
  const run = await readRun(env, game, id)
  if (run && run.user_id !== user.userId) throw new GameRewardError(403, 'このゲームは別の方のものです。')
  await env.DB.prepare(`UPDATE game_reward_runs SET status = 'superseded', finished_at = ?
    WHERE game = ? AND run_id = ? AND user_id = ? AND status = 'pending'`)
    .bind(now, game, id, user.userId).run()
}
