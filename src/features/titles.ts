import type { LineEnv } from '../lib/line'

export async function grantTitle(env: LineEnv, userId: string, groupId: string, titleName: string) {
  const title = await env.DB.prepare(`SELECT id FROM title_master WHERE title_name = ?`)
    .bind(titleName)
    .first<{ id: number }>()
  if (!title) return
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_titles (user_id, group_id, title_id) VALUES (?, ?, ?)`
  )
    .bind(userId, groupId, title.id)
    .run()
}

export async function equipTitle(env: LineEnv, userId: string, groupId: string, titleName: string) {
  await env.DB.prepare(
    `UPDATE user_titles SET is_equipped = 0 WHERE user_id = ? AND group_id = ?`
  )
    .bind(userId, groupId)
    .run()
  const title = await env.DB.prepare(`SELECT id FROM title_master WHERE title_name = ?`)
    .bind(titleName)
    .first<{ id: number }>()
  if (!title) return false
  const res = await env.DB.prepare(
    `UPDATE user_titles SET is_equipped = 1 WHERE user_id = ? AND group_id = ? AND title_id = ?`
  )
    .bind(userId, groupId, title.id)
    .run()
  return (res.meta.rows_written ?? 0) > 0
}

export async function getEquippedTitle(env: LineEnv, userId: string, groupId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT tm.title_name FROM user_titles ut JOIN title_master tm ON tm.id = ut.title_id
      WHERE ut.user_id = ? AND ut.group_id = ? AND ut.is_equipped = 1`
  )
    .bind(userId, groupId)
    .first<{ title_name: string }>()
  return row?.title_name ?? null
}

export async function listUserTitles(env: LineEnv, userId: string, groupId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT tm.title_name FROM user_titles ut JOIN title_master tm ON tm.id = ut.title_id
      WHERE ut.user_id = ? AND ut.group_id = ?`
  )
    .bind(userId, groupId)
    .all<{ title_name: string }>()
  return (results ?? []).map((r) => r.title_name)
}
