// LINE Messaging API helpers.
//
// Key design point: LINE's Push API (bot speaks first, unprompted) has a
// monthly free-tier quota (commonly 200 msgs/month) and returns HTTP 429
// once exhausted. The Reply API (bot replies to an incoming message using
// a one-time replyToken) is completely free and unlimited.
//
// This bot therefore NEVER relies on push() for routine notifications.
// Instead, features enqueue messages into `pending_broadcasts` (see
// migrations/0002) and the webhook handler flushes that queue into the
// Reply call for whatever message just came in. push() is kept only as an
// explicit, rarely-used escape hatch (e.g. manual admin test) and every
// call is logged to push_api_logs so quota issues are visible in the DB.

export type LineMessage = Record<string, any>

const LINE_API = 'https://api.line.me/v2/bot'

export interface LineEnv {
  LINE_CHANNEL_ACCESS_TOKEN: string
  LINE_CHANNEL_SECRET: string
  DB: D1Database
}

// Returns { ok, status, body } so callers can decide whether it's safe to
// mark anything (e.g. queued broadcasts) as delivered. A replyToken can only
// be used ONCE, so we only ever send the first 5-message chunk here; any
// overflow beyond 5 messages must be handled by the caller (re-queue it).
export async function replyMessage(
  env: LineEnv,
  replyToken: string,
  messages: LineMessage[]
): Promise<{ ok: boolean; status: number; body: string }> {
  const chunk = messages.slice(0, 5)
  if (chunk.length === 0) return { ok: true, status: 200, body: '' }

  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: chunk }),
  })
  const bodyText = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body: bodyText }
}

// Explicit push — logged, and intended for rare manual/admin use only.
// Routine bot-initiated messages should go through enqueueBroadcast() below.
export async function pushMessage(env: LineEnv, to: string, messages: LineMessage[]) {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  })
  const bodyText = await res.text().catch(() => '')
  await env.DB.prepare(
    `INSERT INTO push_api_logs (target_id, status_code, response_body, message_preview) VALUES (?, ?, ?, ?)`
  )
    .bind(to, res.status, bodyText.slice(0, 500), JSON.stringify(messages[0] ?? {}).slice(0, 500))
    .run()
  return { ok: res.ok, status: res.status, body: bodyText }
}

export async function getProfile(env: LineEnv, userId: string, groupId?: string) {
  const url = groupId
    ? `${LINE_API}/group/${groupId}/member/${userId}`
    : `${LINE_API}/profile/${userId}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  })
  if (!res.ok) return null
  return res.json() as Promise<{ userId: string; displayName: string; pictureUrl?: string }>
}

export async function getGroupSummary(env: LineEnv, groupId: string) {
  const res = await fetch(`${LINE_API}/group/${groupId}/summary`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  })
  if (!res.ok) return null
  return res.json() as Promise<{ groupId: string; groupName: string; pictureUrl?: string }>
}

// ─── Signature verification (HMAC-SHA256, Web Crypto — no Node 'crypto') ───
export async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return computed === signature
}

// ─── Push-free broadcast queue ───
// Enqueue a notification for a group. It will be delivered as part of the
// Reply payload the next time someone in that group sends a message.
export async function enqueueBroadcast(
  env: LineEnv,
  groupId: string,
  kind: string,
  messages: LineMessage[],
  dedupKey?: string
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pending_broadcasts (group_id, kind, message_json, dedup_key) VALUES (?, ?, ?, ?)`
  )
    .bind(groupId, kind, JSON.stringify(messages), dedupKey ?? null)
    .run()
}

export interface DrainedBroadcasts {
  messages: LineMessage[]
  ids: number[]
}

// Peek at all undelivered broadcasts for a group (oldest first). Does NOT
// mark anything as delivered — the caller must actually send the messages
// successfully first, then call markBroadcastsDelivered(ids). This avoids
// losing notifications if the reply call fails (bad/expired replyToken,
// network error, etc): they simply stay queued and get picked up again on
// the next incoming message. Returns at most 5 total messages (LINE's
// per-reply-call limit) — any overflow stays queued for next time.
export async function peekBroadcasts(env: LineEnv, groupId: string): Promise<DrainedBroadcasts> {
  const { results } = await env.DB.prepare(
    `SELECT id, message_json FROM pending_broadcasts WHERE group_id = ? AND delivered = 0 ORDER BY id ASC LIMIT 20`
  )
    .bind(groupId)
    .all<{ id: number; message_json: string }>()

  if (!results || results.length === 0) return { messages: [], ids: [] }

  const out: LineMessage[] = []
  const ids: number[] = []
  for (const row of results) {
    const msgs: LineMessage[] = JSON.parse(row.message_json)
    if (out.length + msgs.length > 5) break
    out.push(...msgs)
    ids.push(row.id)
  }
  return { messages: out, ids }
}

// Mark specific broadcast rows as delivered. Only call this AFTER confirming
// the LINE API call that carried them actually succeeded.
export async function markBroadcastsDelivered(env: LineEnv, ids: number[]) {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  await env.DB.prepare(
    `UPDATE pending_broadcasts SET delivered = 1, delivered_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .run()
}
