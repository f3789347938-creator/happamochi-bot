// "Message unsend (deletion) detection" feature.
//
// LINE sends an `unsend` webhook event when a user deletes a message they
// previously sent. We look up the original text/sender we cached in
// group_messages, format a notification, and enqueue it via the push-free
// broadcast queue (drained on the group's next incoming message).
import type { LineEnv } from '../lib/line'
import { enqueueBroadcast } from '../lib/line'

interface UnsendEvent {
  type: 'unsend'
  timestamp: number
  source: { type: string; groupId?: string; userId?: string }
  unsend: { messageId: string }
}

export async function handleUnsend(env: LineEnv, event: UnsendEvent) {
  const groupId = event.source.groupId
  const messageId = event.unsend.messageId
  if (!groupId) return // unsend outside a group isn't handled

  // Is this group opted out of unsend notifications?
  const setting = await env.DB.prepare(
    `SELECT enabled FROM unsend_restore_settings WHERE group_id = ?`
  )
    .bind(groupId)
    .first<{ enabled: number }>()
  if (setting && setting.enabled === 0) {
    await debugLog(env, messageId, groupId, 0, 'Notifications disabled for this group')
    return
  }

  // Find the original message we cached when it was first sent.
  const original = await env.DB.prepare(
    `SELECT display_name, picture_url, message_text, created_at
       FROM group_messages WHERE group_id = ? AND message_id = ?`
  )
    .bind(groupId, messageId)
    .first<{ display_name: string; picture_url: string | null; message_text: string; created_at: string }>()

  if (!original) {
    await debugLog(env, messageId, groupId, 0, 'Message not found in database - might be too fast or too old')
    return
  }

  const unsentAtIso = new Date().toISOString()

  // Record the unsend event itself (idempotent — a duplicate webhook retry
  // must not create a second row / second notification).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO unsent_messages
       (group_id, message_id, user_id, display_name, picture_url, message_text, sent_at, unsent_at, notified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  )
    .bind(
      groupId,
      messageId,
      event.source.userId ?? 'unknown',
      original.display_name ?? 'Unknown',
      original.picture_url,
      original.message_text,
      original.created_at,
      unsentAtIso
    )
    .run()

  const dedupKey = `unsend_${groupId}_${messageId}`
  const notifyText =
    `メッセージが取り消されました\n\n` +
    `送信者: ${original.display_name ?? '不明'}\n` +
    `内容: ${original.message_text}\n\n` +
    `取り消された時刻: ${formatJst(unsentAtIso)}`

  await enqueueBroadcast(env, groupId, 'unsend', [{ type: 'text', text: notifyText }], dedupKey)

  // Mark as "queued for notification" (kept for parity with legacy schema;
  // actual delivered flag lives in pending_broadcasts).
  await env.DB.prepare(`UPDATE unsent_messages SET notified = 1 WHERE group_id = ? AND message_id = ?`)
    .bind(groupId, messageId)
    .run()

  await debugLog(env, messageId, groupId, 1, 'SUCCESS: Queued for push-free notification on next message')
}

async function debugLog(env: LineEnv, messageId: string, groupId: string, found: number, error: string) {
  await env.DB.prepare(
    `INSERT INTO unsend_debug_logs (message_id, group_id, found_in_db, error_message) VALUES (?, ?, ?, ?)`
  )
    .bind(messageId, groupId, found, error)
    .run()
}

function formatJst(iso: string): string {
  const d = new Date(iso)
  // JST = UTC+9
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  const h = String(jst.getUTCHours()).padStart(2, '0')
  const min = String(jst.getUTCMinutes()).padStart(2, '0')
  const s = String(jst.getUTCSeconds()).padStart(2, '0')
  return `${y}/${m}/${day} ${h}:${min}:${s}`
}
