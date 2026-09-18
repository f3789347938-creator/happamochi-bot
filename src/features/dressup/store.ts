import type { LineEnv } from '../../lib/line'
import { DEFAULT_BACKGROUND, DEFAULT_COSTUME, getCosmetic } from './catalog'

// Keep synchronized with the debit and guards in migration 0024.
export const GACHA_COST = 3000
export const GACHA_CONFIRMATION_SECONDS = 10 * 60

export interface Appearance {
  costumeId: string
  backgroundId: string
}

export type DressupFailureReason =
  | 'invalid_confirmation' | 'not_owner' | 'expired' | 'canceled' | 'already_used'
  | 'insufficient_points' | 'collection_complete' | 'unknown_user'
  | 'invalid_item' | 'not_owned'

type Failure = { ok: false; reason: DressupFailureReason }
type Confirmation = {
  user_id: string
  state: 'pending' | 'canceled' | 'drawn'
  expires_at: number
  item_id: string | null
  balance_after: number | null
  expired: number
}

function defaultAppearance(): Appearance {
  return { costumeId: DEFAULT_COSTUME.id, backgroundId: DEFAULT_BACKGROUND.id }
}

function normalizedAppearance(row?: { costume_id: string | null; background_id: string | null } | null): Appearance {
  const costume = row?.costume_id ? getCosmetic(row.costume_id) : undefined
  const background = row?.background_id ? getCosmetic(row.background_id) : undefined
  return {
    costumeId: costume?.kind === 'costume' ? costume.id : DEFAULT_COSTUME.id,
    backgroundId: background?.kind === 'background' ? background.id : DEFAULT_BACKGROUND.id,
  }
}

export async function getAppearance(env: LineEnv, userId: string): Promise<Appearance> {
  const row = await env.DB.prepare(
    `SELECT costume_id, background_id FROM dressup_appearances WHERE user_id = ?`
  ).bind(userId).first<{ costume_id: string; background_id: string }>()
  return normalizedAppearance(row)
}

/** Public IDs only; never expose a LINE user ID in cards or asset URLs. */
export async function getAppearanceByPublicIds(
  env: LineEnv, publicIds: string[]
): Promise<Record<string, Appearance>> {
  const ids = [...new Set(publicIds)]
  const appearances: Record<string, Appearance> = Object.create(null)
  for (const id of ids) appearances[id] = defaultAppearance()
  // D1 limits bound parameters; ranking pages can contain more than one batch.
  for (let offset = 0; offset < ids.length; offset += 75) {
    const chunk = ids.slice(offset, offset + 75)
    const { results } = await env.DB.prepare(
      `SELECT p.public_id, a.costume_id, a.background_id FROM user_profiles p
       LEFT JOIN dressup_appearances a ON a.user_id = p.user_id
       WHERE p.public_id IN (${chunk.map(() => '?').join(',')})`
    ).bind(...chunk).all<{ public_id: string; costume_id: string | null; background_id: string | null }>()
    for (const row of results ?? []) appearances[row.public_id] = normalizedAppearance(row)
  }
  return appearances
}

export async function listOwnedCosmeticIds(env: LineEnv, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT item_id FROM dressup_inventory WHERE user_id = ? ORDER BY item_id`
  ).bind(userId).all<{ item_id: string }>()
  return [...new Set([
    DEFAULT_COSTUME.id, DEFAULT_BACKGROUND.id,
    ...(results ?? []).map(row => row.item_id).filter(id => !!getCosmetic(id)),
  ])]
}

/** The caller ensures the existing bot profile first; this does not award points. */
export async function createGachaConfirmation(
  env: LineEnv, userId: string
): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomUUID()
  const row = await env.DB.prepare(
    `INSERT INTO dressup_confirmations (token, user_id, expires_at)
     SELECT ?, user_id, unixepoch() + ? FROM user_profiles WHERE user_id = ?
     RETURNING expires_at`
  ).bind(token, GACHA_CONFIRMATION_SECONDS, userId).first<{ expires_at: number }>()
  if (!row) throw new Error('unknown_user')
  return { token, expiresAt: row.expires_at }
}

function validToken(token: string): boolean {
  return typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
}

async function failedConfirmation(env: LineEnv, userId: string, token: string): Promise<Failure> {
  const row = await env.DB.prepare(
    `SELECT user_id, state, expires_at, item_id, balance_after,
            expires_at <= unixepoch() AS expired
     FROM dressup_confirmations WHERE token = ?`
  ).bind(token).first<Confirmation>()
  if (!row) return { ok: false, reason: 'invalid_confirmation' }
  if (row.user_id !== userId) return { ok: false, reason: 'not_owner' }
  if (row.state === 'canceled') return { ok: false, reason: 'canceled' }
  if (row.state === 'drawn') return { ok: false, reason: 'already_used' }
  if (row.expired) return { ok: false, reason: 'expired' }
  const profile = await env.DB.prepare(`SELECT points FROM user_profiles WHERE user_id = ?`)
    .bind(userId).first<{ points: number }>()
  if (!profile) return { ok: false, reason: 'unknown_user' }
  const available = await env.DB.prepare(
    `SELECT c.item_id FROM dressup_catalog c WHERE c.is_default = 0
      AND NOT EXISTS (SELECT 1 FROM dressup_inventory i WHERE i.user_id = ? AND i.item_id = c.item_id)
      LIMIT 1`
  ).bind(userId).first()
  if (!available) return { ok: false, reason: 'collection_complete' }
  if (profile.points < GACHA_COST) return { ok: false, reason: 'insufficient_points' }
  // A guarded write can only miss for one of these cases; do not assume success.
  return { ok: false, reason: 'invalid_confirmation' }
}

export async function cancelGacha(
  env: LineEnv, userId: string, token: string
): Promise<{ ok: true } | Failure> {
  if (!validToken(token)) return { ok: false, reason: 'invalid_confirmation' }
  const result = await env.DB.prepare(
    `UPDATE dressup_confirmations SET state = 'canceled'
     WHERE token = ? AND user_id = ? AND state = 'pending'`
  ).bind(token, userId).run()
  if (result.meta.changes > 0) return { ok: true }
  return failedConfirmation(env, userId, token)
}

export async function drawGacha(
  env: LineEnv, userId: string, token: string
): Promise<{ ok: true; itemId: string; spent: number; balance: number } | Failure> {
  if (!validToken(token)) return { ok: false, reason: 'invalid_confirmation' }
  // No read/check/write race: SQLite selects from CURRENT inventory while it
  // owns the write lock. The triggers make debit + grant + ledger + token
  // consumption atomic, even with different tokens or webhook redelivery.
  const result = await env.DB.prepare(
    `UPDATE dressup_confirmations
     SET state = 'drawn',
         item_id = (SELECT c.item_id FROM dressup_catalog c WHERE c.is_default = 0
           AND NOT EXISTS (SELECT 1 FROM dressup_inventory i
             WHERE i.user_id = dressup_confirmations.user_id AND i.item_id = c.item_id)
           ORDER BY random() LIMIT 1),
         balance_after = (SELECT points - ? FROM user_profiles WHERE user_id = dressup_confirmations.user_id)
     WHERE token = ? AND user_id = ? AND state = 'pending' AND expires_at > unixepoch()
       AND EXISTS (SELECT 1 FROM user_profiles WHERE user_id = dressup_confirmations.user_id AND points >= ?)
       AND EXISTS (SELECT 1 FROM dressup_catalog c WHERE c.is_default = 0
         AND NOT EXISTS (SELECT 1 FROM dressup_inventory i
           WHERE i.user_id = dressup_confirmations.user_id AND i.item_id = c.item_id))`
  ).bind(GACHA_COST, token, userId, GACHA_COST).run()
  if (!result.meta.changes) return failedConfirmation(env, userId, token)
  const award = await env.DB.prepare(
    `SELECT item_id, balance_after FROM dressup_confirmations
     WHERE token = ? AND user_id = ? AND state = 'drawn'`
  ).bind(token, userId).first<{ item_id: string; balance_after: number }>()
  if (!award) throw new Error('dressup_award_missing')
  return { ok: true, itemId: award.item_id, spent: GACHA_COST, balance: award.balance_after }
}

export async function equipCosmetic(
  env: LineEnv, userId: string, itemId: string
): Promise<{ ok: true } | Failure> {
  const item = typeof itemId === 'string' ? getCosmetic(itemId) : undefined
  if (!item) return { ok: false, reason: 'invalid_item' }
  // Only a trusted enum-derived column name is interpolated, never user input.
  const column = item.kind === 'costume' ? 'costume_id' : 'background_id'
  const costumeId = item.kind === 'costume' ? item.id : DEFAULT_COSTUME.id
  const backgroundId = item.kind === 'background' ? item.id : DEFAULT_BACKGROUND.id
  const result = await env.DB.prepare(
    `INSERT INTO dressup_appearances (user_id, costume_id, background_id)
     SELECT p.user_id, ?, ? FROM user_profiles p WHERE p.user_id = ?
       AND EXISTS (SELECT 1 FROM dressup_catalog c WHERE c.item_id = ?
         AND (c.is_default = 1 OR EXISTS (SELECT 1 FROM dressup_inventory i
           WHERE i.user_id = p.user_id AND i.item_id = c.item_id)))
     ON CONFLICT(user_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = CURRENT_TIMESTAMP`
  ).bind(costumeId, backgroundId, userId, item.id).run()
  if (result.meta.changes > 0) return { ok: true }
  const profile = await env.DB.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).bind(userId).first()
  return { ok: false, reason: profile ? 'not_owned' : 'unknown_user' }
}
