import type { LineEnv } from '../lib/line'

export async function addTagToGroup(env: LineEnv, groupId: string, tagName: string) {
  await env.DB.prepare(`INSERT OR IGNORE INTO tags (tag_name) VALUES (?)`).bind(tagName).run()
  const tag = await env.DB.prepare(`SELECT id FROM tags WHERE tag_name = ?`).bind(tagName).first<{ id: number }>()
  if (!tag) return
  await env.DB.prepare(`INSERT OR IGNORE INTO group_tags (group_id, tag_id) VALUES (?, ?)`)
    .bind(groupId, tag.id)
    .run()
}

export async function listGroupTags(env: LineEnv, groupId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.tag_name FROM group_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.group_id = ?`
  )
    .bind(groupId)
    .all<{ tag_name: string }>()
  return (results ?? []).map((r) => r.tag_name)
}

export async function removeTagFromGroup(env: LineEnv, groupId: string, tagName: string) {
  const tag = await env.DB.prepare(`SELECT id FROM tags WHERE tag_name = ?`).bind(tagName).first<{ id: number }>()
  if (!tag) return
  await env.DB.prepare(`DELETE FROM group_tags WHERE group_id = ? AND tag_id = ?`).bind(groupId, tag.id).run()
}
