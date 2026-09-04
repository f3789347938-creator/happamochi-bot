// Caches every incoming group text message so that:
//  1. unsend detection can look up the original content later
//  2. member/activity stats can be computed
import type { LineEnv } from '../lib/line'

export async function cacheGroupMessage(
  env: LineEnv,
  groupId: string,
  messageId: string,
  userId: string,
  displayName: string | null,
  pictureUrl: string | null,
  text: string
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO group_messages (group_id, message_id, user_id, display_name, picture_url, message_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(groupId, messageId, userId, displayName, pictureUrl, text)
    .run()
}

export async function touchGroupMember(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string | null
) {
  await env.DB.prepare(
    `INSERT INTO group_members (group_id, user_id, display_name, last_active_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(group_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       last_active_at = CURRENT_TIMESTAMP`
  )
    .bind(groupId, userId, displayName)
    .run()

  const today = new Date().toISOString().slice(0, 10)
  await env.DB.prepare(
    `INSERT INTO group_activities (group_id, user_id, activity_date, message_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(group_id, user_id, activity_date) DO UPDATE SET
       message_count = message_count + 1`
  )
    .bind(groupId, userId, today)
    .run()
}

export async function ensureGroupMetadata(env: LineEnv, groupId: string, groupName: string | null) {
  await env.DB.prepare(
    `INSERT INTO group_metadata (group_id, group_name) VALUES (?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       group_name = COALESCE(excluded.group_name, group_metadata.group_name),
       left_at = NULL,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(groupId, groupName)
    .run()
}

// Marks a group as "left" when LINE sends a `leave` event (bot removed from
// the group). Previously this event was silently dropped (fell through to
// `default: return` in the webhook switch), so group_metadata never reflected
// that the bot was no longer a member — rows just went stale forever.
export async function markGroupLeft(env: LineEnv, groupId: string) {
  await env.DB.prepare(
    `UPDATE group_metadata SET left_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE group_id = ?`
  )
    .bind(groupId)
    .run()
}
