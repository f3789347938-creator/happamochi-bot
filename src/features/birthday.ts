// Birthday notifications — no cron trigger needed (and hosted deploy
// disallows `triggers` anyway). Instead: every time a message arrives in a
// group, we lazily check "is today anyone's birthday in this group, and
// have we already sent it today?" — if not sent yet, queue it via the
// push-free broadcast so it rides along on this exact incoming message.
import type { LineEnv } from '../lib/line'
import { enqueueBroadcast } from '../lib/line'

export async function registerBirthday(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string,
  month: number,
  day: number
) {
  await env.DB.prepare(
    `INSERT INTO member_birthdays (group_id, user_id, display_name, birth_month, birth_day)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       birth_month = excluded.birth_month,
       birth_day = excluded.birth_day`
  )
    .bind(groupId, userId, displayName, month, day)
    .run()
}

export async function checkAndQueueBirthdays(env: LineEnv, groupId: string) {
  const now = new Date()
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const month = jstNow.getUTCMonth() + 1
  const day = jstNow.getUTCDate()
  const todayStr = jstNow.toISOString().slice(0, 10)

  const alreadySent = await env.DB.prepare(
    `SELECT 1 FROM daily_fortune_sent WHERE group_id = ? AND sent_date = ? `
  )
    .bind(`birthday_${groupId}`, todayStr)
    .first()
  if (alreadySent) return

  const { results } = await env.DB.prepare(
    `SELECT display_name FROM member_birthdays WHERE group_id = ? AND birth_month = ? AND birth_day = ?`
  )
    .bind(groupId, month, day)
    .all<{ display_name: string }>()

  if (!results || results.length === 0) return

  const names = results.map((r) => r.display_name).join('、')
  await enqueueBroadcast(
    env,
    groupId,
    'birthday',
    [{ type: 'text', text: `🎂 今日は ${names} さんの誕生日です!\nおめでとうございます🎉` }],
    `birthday_${groupId}_${todayStr}`
  )

  await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_fortune_sent (group_id, sent_date) VALUES (?, ?)`
  )
    .bind(`birthday_${groupId}`, todayStr)
    .run()
}
