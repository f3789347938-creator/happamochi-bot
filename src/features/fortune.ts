// Daily zodiac fortune ("今日の運勢"). No cron trigger — fortunes are
// generated deterministically (seeded by date+sign) the first time they're
// requested each day, cached in daily_zodiac_fortunes, then queued via the
// push-free broadcast for the group that asked.
import type { LineEnv } from '../lib/line'
import { enqueueBroadcast } from '../lib/line'

const ZODIAC_SIGNS = [
  '牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座',
  '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座',
]

const FORTUNE_LEVELS = ['絶好調✨', '好調😊', '普通🙂', 'ちょっと注意⚠️', '慎重に🙏']
const LUCKY_ITEMS = ['青いペン', 'コーヒー', '観葉植物', '手帳', 'イヤホン', 'ハンカチ', '折り紙', 'キャンドル']
const LUCKY_COLORS = ['赤', '青', '緑', '黄', '紫', '白', 'オレンジ', 'ピンク']
const ADVICES = [
  '普段話さない人に話しかけてみて。',
  '無理せずゆっくり過ごすのが吉。',
  '新しいことを始めるチャンス。',
  '整理整頓が運気アップの鍵。',
  '感謝の気持ちを言葉にしてみて。',
]

// Simple seeded PRNG so the same date+sign always yields the same fortune.
function seededPick<T>(arr: T[], seed: number): T {
  const x = Math.sin(seed) * 10000
  const idx = Math.floor((x - Math.floor(x)) * arr.length)
  return arr[idx]
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export async function getOrCreateDailyFortune(env: LineEnv, dateStr: string, zodiacSign: string) {
  const existing = await env.DB.prepare(
    `SELECT * FROM daily_zodiac_fortunes WHERE date = ? AND zodiac_sign = ?`
  )
    .bind(dateStr, zodiacSign)
    .first<any>()
  if (existing) return existing

  // Generate all 12 signs' fortunes together so the ranking is consistent.
  const shuffled = [...ZODIAC_SIGNS].sort((a, b) => hashStr(dateStr + a) - hashStr(dateStr + b))

  for (let i = 0; i < shuffled.length; i++) {
    const sign = shuffled[i]
    const seed = hashStr(dateStr + sign)
    const overall = seededPick(FORTUNE_LEVELS, seed)
    const love = seededPick(FORTUNE_LEVELS, seed + 1)
    const money = seededPick(FORTUNE_LEVELS, seed + 2)
    const work = seededPick(FORTUNE_LEVELS, seed + 3)
    const item = seededPick(LUCKY_ITEMS, seed + 4)
    const color = seededPick(LUCKY_COLORS, seed + 5)
    const number = (seed % 9) + 1
    const advice = seededPick(ADVICES, seed + 6)

    await env.DB.prepare(
      `INSERT OR IGNORE INTO daily_zodiac_fortunes
         (date, zodiac_sign, ranking, overall_fortune, love_fortune, money_fortune, work_fortune,
          lucky_item, lucky_color, lucky_number, advice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(dateStr, sign, i + 1, overall, love, money, work, item, color, number, advice)
      .run()
  }

  return env.DB.prepare(`SELECT * FROM daily_zodiac_fortunes WHERE date = ? AND zodiac_sign = ?`)
    .bind(dateStr, zodiacSign)
    .first<any>()
}

export async function registerZodiacSign(env: LineEnv, userId: string, sign: string) {
  await env.DB.prepare(
    `INSERT INTO user_zodiac_signs (user_id, zodiac_sign) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET zodiac_sign = excluded.zodiac_sign`
  )
    .bind(userId, sign)
    .run()
}

export function formatFortuneText(f: any): string {
  return (
    `🔮 ${f.zodiac_sign}の今日の運勢 (第${f.ranking}位)\n\n` +
    `総合運: ${f.overall_fortune}\n` +
    `恋愛運: ${f.love_fortune}\n` +
    `金運: ${f.money_fortune}\n` +
    `仕事運: ${f.work_fortune}\n\n` +
    `ラッキーアイテム: ${f.lucky_item}\n` +
    `ラッキーカラー: ${f.lucky_color}\n` +
    `ラッキーナンバー: ${f.lucky_number}\n\n` +
    `💬 ${f.advice}`
  )
}

export function todayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

export { ZODIAC_SIGNS }

// Queue today's fortune for a group's registered members (once per day per
// group), delivered push-free on the next incoming message.
export async function checkAndQueueGroupFortune(env: LineEnv, groupId: string) {
  const dateStr = todayJst()
  const already = await env.DB.prepare(`SELECT 1 FROM daily_fortune_sent WHERE group_id = ? AND sent_date = ?`)
    .bind(groupId, dateStr)
    .first()
  if (already) return

  // Only trigger automatically if at least one member in this group has
  // registered a zodiac sign — otherwise stay silent (feature is opt-in).
  const members = await env.DB.prepare(
    `SELECT DISTINCT gm.user_id, uz.zodiac_sign, gm.display_name
       FROM group_members gm JOIN user_zodiac_signs uz ON uz.user_id = gm.user_id
      WHERE gm.group_id = ? LIMIT 10`
  )
    .bind(groupId)
    .all<{ user_id: string; zodiac_sign: string; display_name: string }>()

  if (!members.results || members.results.length === 0) return

  const lines: string[] = []
  for (const m of members.results) {
    const f = await getOrCreateDailyFortune(env, dateStr, m.zodiac_sign)
    if (f) lines.push(`${m.display_name}(${m.zodiac_sign}): ${f.overall_fortune}`)
  }
  if (lines.length === 0) return

  await enqueueBroadcast(
    env,
    groupId,
    'fortune',
    [{ type: 'text', text: `🔮 今日の運勢\n\n${lines.join('\n')}` }],
    `fortune_${groupId}_${dateStr}`
  )
  await env.DB.prepare(`INSERT OR IGNORE INTO daily_fortune_sent (group_id, sent_date) VALUES (?, ?)`)
    .bind(groupId, dateStr)
    .run()
}
