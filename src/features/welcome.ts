// Welcome message when a new member joins a group (LINE `memberJoined` event).
// Delivered via Reply (free) since LINE gives us a replyToken on join events too.
import type { LineEnv, LineMessage } from '../lib/line'

export async function buildWelcomeMessages(
  env: LineEnv,
  groupId: string,
  joinedMembers: { userId: string; displayName?: string }[]
): Promise<LineMessage[] | null> {
  const setting = await env.DB.prepare(
    `SELECT enabled, custom_message FROM group_welcome_settings WHERE group_id = ?`
  )
    .bind(groupId)
    .first<{ enabled: number; custom_message: string | null }>()

  if (setting && setting.enabled === 0) return null

  const names = joinedMembers.map((m) => m.displayName || '新しいメンバー').join('、')
  const custom = setting?.custom_message
  const text = custom
    ? `🎉 ${names} さん、ようこそ!\n\n${custom}`
    : `🎉 ${names} さん、ようこそ!\nグループへの参加を歓迎します😊`

  return [{ type: 'text', text }]
}

export async function setWelcomeSetting(env: LineEnv, groupId: string, enabled: boolean, customMessage?: string) {
  await env.DB.prepare(
    `INSERT INTO group_welcome_settings (group_id, enabled, custom_message) VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET enabled = excluded.enabled,
       custom_message = COALESCE(excluded.custom_message, group_welcome_settings.custom_message),
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(groupId, enabled ? 1 : 0, customMessage ?? null)
    .run()
}
