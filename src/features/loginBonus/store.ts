import type { LineEnv } from '../../lib/line'

export interface LoginBonusResult {
  claimed: boolean
  day: string
  totalDays: number
  streakDays: number
  rewardDays: number
  rewardPoints: number
  balance: number
}

export class LoginBonusError extends Error {
  constructor(public code: 'invalid_input' | 'unavailable') {
    super(code === 'invalid_input' ? 'ログイン情報を確認できませんでした。' : 'ログインボーナスを確認できませんでした。もう一度お試しください。')
    this.name = 'LoginBonusError'
  }
}

interface Receipt {
  attempt_id: string
  awarded_event_key: string
  claim_day: string
  total_days: number
  streak_days: number
  reward_days: number
  reward_points: number
  balance_after: number
}

/**
 * Call after ensureProfile, with source.userId and a signed LINE webhook/message
 * event key. The date is the server's JST day, never a client supplied timestamp.
 * Duplicate events return their original receipt even if replayed on a later day.
 */
export async function claimLoginBonus(
  env: LineEnv, userId: string, eventKey: string, now = Date.now()
): Promise<LoginBonusResult> {
  if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(userId) ||
      typeof eventKey !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(eventKey) ||
      !Number.isSafeInteger(now) || now < 0 || now > 253402267199999) {
    throw new LoginBonusError('invalid_input')
  }
  const day = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const attemptId = crypto.randomUUID()
  // This private single-user switch is never accepted from a command, display
  // name, group, or request body. Malformed/multiple IDs disable it entirely.
  const testUserId = env.LOGIN_BONUS_TEST_USER_ID
  const repeatForOwner = typeof testUserId === 'string' && /^U[0-9a-f]{32}$/.test(testUserId) && testUserId === userId
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO login_bonus_events(user_id, event_key, claim_day, attempt_id, received_at)
        VALUES(?, ?, ?, ?, ?) ON CONFLICT(user_id, event_key) DO NOTHING`)
        .bind(userId, eventKey, day, attemptId, now),
      // Only a new event owned by this exact invocation can earn a repeat. The
      // day's initial event already received its ordinary bonus in the trigger.
      ...(repeatForOwner ? [env.DB.prepare(`INSERT INTO login_bonus_test_claims
          (user_id, event_key, claim_day, total_days, streak_days, reward_days, reward_points, balance_after, claimed_at)
        SELECT e.user_id, e.event_key, c.claim_day, c.total_days, c.streak_days,
          c.reward_days, c.reward_points, p.points + c.reward_points, e.received_at
        FROM login_bonus_events e
        JOIN login_bonus_claims c ON c.user_id = e.user_id AND c.claim_day = e.claim_day
        JOIN user_profiles p ON p.user_id = e.user_id
        WHERE e.user_id = ? AND e.event_key = ? AND e.attempt_id = ?
          AND e.claim_day = ? AND e.event_key <> c.awarded_event_key
        ON CONFLICT(user_id, event_key) DO NOTHING`)
        .bind(userId, eventKey, attemptId, day)] : []),
      // A test receipt remains the authoritative response to its event even
      // after the private switch is removed or a later date has been claimed.
      env.DB.prepare(`SELECT e.attempt_id, COALESCE(t.event_key, c.awarded_event_key) AS awarded_event_key,
          COALESCE(t.claim_day, c.claim_day) AS claim_day,
          COALESCE(t.total_days, c.total_days) AS total_days,
          COALESCE(t.streak_days, c.streak_days) AS streak_days,
          COALESCE(t.reward_days, c.reward_days) AS reward_days,
          COALESCE(t.reward_points, c.reward_points) AS reward_points,
          COALESCE(t.balance_after, c.balance_after) AS balance_after
        FROM login_bonus_events e
        JOIN login_bonus_claims c ON c.user_id = e.user_id AND c.claim_day = e.claim_day
        JOIN user_profiles p ON p.user_id = e.user_id
        LEFT JOIN login_bonus_test_claims t ON t.user_id = e.user_id AND t.event_key = e.event_key
        WHERE e.user_id = ? AND e.event_key = ?`)
        .bind(userId, eventKey),
    ])
    const receipt = results.at(-1)?.results?.[0] as Receipt | undefined
    if (results.some(result => !result.success) || !receipt ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receipt.claim_day) ||
        !Number.isSafeInteger(receipt.total_days) || receipt.total_days < 1 ||
        !Number.isSafeInteger(receipt.streak_days) || receipt.streak_days < 1 || receipt.streak_days > receipt.total_days ||
        receipt.reward_days !== Math.min(receipt.streak_days, 7) || receipt.reward_points !== receipt.reward_days * 500 ||
        !Number.isSafeInteger(receipt.balance_after) || receipt.balance_after < receipt.reward_points) {
      throw new LoginBonusError('unavailable')
    }
    return {
      claimed: receipt.attempt_id === attemptId && receipt.awarded_event_key === eventKey,
      day: receipt.claim_day,
      totalDays: receipt.total_days,
      streakDays: receipt.streak_days,
      rewardDays: receipt.reward_days,
      rewardPoints: receipt.reward_points,
      balance: receipt.balance_after,
    }
  } catch {
    // D1 errors may include bound identifiers. Surface no SQL, identity or cause.
    throw new LoginBonusError('unavailable')
  }
}
