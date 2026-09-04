// Weekly group activity ranking — computed lazily (no cron) the first time
// someone messages the group after Monday JST each week, then queued via
// the push-free broadcast.
import type { LineEnv } from '../lib/line'
import { enqueueBroadcast } from '../lib/line'

function mondayOfWeek(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const day = jst.getUTCDay() // 0=Sun
  const diff = (day + 6) % 7 // days since Monday
  jst.setUTCDate(jst.getUTCDate() - diff)
  return jst.toISOString().slice(0, 10)
}

export async function checkAndQueueWeeklyRanking(env: LineEnv, groupId: string) {
  const weekStart = mondayOfWeek(new Date())

  const already = await env.DB.prepare(
    `SELECT 1 FROM weekly_ranking_sends WHERE group_id = ? AND week_start_date = ?`
  )
    .bind(groupId, weekStart)
    .first()
  if (already) return

  // Active members in the last 7 days for this group.
  const { results } = await env.DB.prepare(
    `SELECT user_id, SUM(message_count) as total
       FROM group_activities
      WHERE group_id = ? AND activity_date >= date(?, '-7 days')
      GROUP BY user_id
      ORDER BY total DESC LIMIT 5`
  )
    .bind(groupId, weekStart)
    .all<{ user_id: string; total: number }>()

  if (!results || results.length === 0) return

  // Resolve display names.
  const lines: string[] = []
  for (let i = 0; i < results.length; i++) {
    const member = await env.DB.prepare(
      `SELECT display_name FROM group_members WHERE group_id = ? AND user_id = ?`
    )
      .bind(groupId, results[i].user_id)
      .first<{ display_name: string }>()
    lines.push(`${i + 1}位: ${member?.display_name ?? '不明'} (${results[i].total}件)`)
  }

  await enqueueBroadcast(
    env,
    groupId,
    'ranking',
    [{ type: 'text', text: `週間発言数ランキング\n\n${lines.join('\n')}` }],
    `ranking_${groupId}_${weekStart}`
  )
  await env.DB.prepare(
    `INSERT OR IGNORE INTO weekly_ranking_sends (group_id, week_start_date) VALUES (?, ?)`
  )
    .bind(groupId, weekStart)
    .run()
}
