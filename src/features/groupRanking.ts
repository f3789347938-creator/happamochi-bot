// グループ発言数ランキング。
//
// 【既存機能への非干渉について】
// このモジュールは既存の集計処理(groupTracking.ts の touchGroupMember)を
// 一切変更しない。時間帯別の内訳だけを新テーブル group_hourly_activity に
// 追加で積む。呼び出し側(index.tsx)では try/catch で隔離しており、ここが
// 失敗しても Bot 本体の処理は止まらない。
//
// 【重要: 日付の扱い】
// 既存の group_activities.activity_date は
//   new Date().toISOString().slice(0,10)
// すなわち **UTC日付** で記録されている(誕生日・占い機能はJSTを使っており
// 実装が揃っていないが、既存データ44,939行がUTC基準で積み上がっている以上、
// 後から変換はできない)。ランキングの一覧・日別グラフは既存の
// group_activities を集計源にするため、**UTC日付境界**で扱う。
// 一方、新規に積む group_hourly_activity は「主な活動時間帯」を出すための
// ものなので、JSTの日付・JSTの時で記録する。この差はコード内で明示的に
// 区別しており、混同しないこと。
import type { LineEnv } from '../lib/line'

// ---------------------------------------------------------------------------
// 記録側
// ---------------------------------------------------------------------------

/**
 * 時間帯別の発言数を +1 する。JST基準の日付・時で記録する。
 *
 * 既存の touchGroupMember() と同じタイミングで、同じ「1メッセージ=1件」の
 * 数え方をする(ユーザー指示によりコマンドも除外しない)。
 * 失敗しても例外を投げず false を返すだけにして、呼び出し側の既存処理に
 * 影響を与えない。
 */
export async function recordHourlyActivity(env: LineEnv, groupId: string): Promise<boolean> {
  try {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const date = jst.toISOString().slice(0, 10)
    const hour = jst.getUTCHours()
    await env.DB.prepare(
      `INSERT INTO group_hourly_activity (group_id, activity_date, hour_jst, message_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(group_id, activity_date, hour_jst) DO UPDATE SET
         message_count = message_count + 1`
    )
      .bind(groupId, date, hour)
      .run()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 期間の計算
// ---------------------------------------------------------------------------

export type RankingPeriod = 'today' | 'week' | 'month'

export interface PeriodRange {
  /** 集計開始日 (YYYY-MM-DD, 内包) */
  start: string
  /** 集計終了日 (YYYY-MM-DD, 内包) */
  end: string
  /** 直前の同じ長さの確定期間(順位変動の比較用) */
  prevStart: string
  prevEnd: string
  label: string
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return ymd(d)
}

/**
 * 期間を計算する。
 *
 * 集計源の group_activities が UTC日付で積まれているため、境界も UTC で
 * 揃える(JSTで切ると既存行と1日ずれて数が合わなくなる)。
 * 「今週」は月曜始まり・日曜終わり。
 */
export function resolvePeriod(period: RankingPeriod, now = new Date()): PeriodRange {
  const today = ymd(now)

  if (period === 'today') {
    return {
      start: today,
      end: today,
      prevStart: addDays(today, -1),
      prevEnd: addDays(today, -1),
      label: '今日',
    }
  }

  if (period === 'week') {
    const d = new Date(`${today}T00:00:00Z`)
    const dow = d.getUTCDay() // 0=Sun
    const sinceMonday = (dow + 6) % 7
    const start = addDays(today, -sinceMonday)
    const end = addDays(start, 6)
    return {
      start,
      end,
      prevStart: addDays(start, -7),
      prevEnd: addDays(start, -1),
      label: '今週',
    }
  }

  // month
  const d = new Date(`${today}T00:00:00Z`)
  const start = `${today.slice(0, 7)}-01`
  const endD = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  const prevEnd = addDays(start, -1)
  const prevStart = `${prevEnd.slice(0, 7)}-01`
  return { start, end: ymd(endD), prevStart, prevEnd, label: '今月' }
}

export type SizeFilter = 'all' | 'small' | 'medium' | 'large'

export function sizeFilterLabel(f: SizeFilter): string {
  return f === 'small' ? '20人以下' : f === 'medium' ? '21〜50人' : f === 'large' ? '51人以上' : 'すべて'
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export interface RankingRow {
  rank: number
  groupId: string
  groupName: string | null
  messages: number
  speakers: number
  /** 集計上把握できているメンバー数(発言実績のある人のみ) */
  knownMembers: number
  /** 前期間からの順位変動。null = 比較データなし(NEW) */
  delta: number | null
}

export interface RankingResult {
  rows: RankingRow[]
  total: number
  page: number
  totalPages: number
  range: PeriodRange
  /** 集計対象になった発言の総数(全グループ合計) */
  grandTotal: number
  /** データ取得に失敗したか */
  errored: boolean
}

const PAGE_SIZE = 20

function sizeCondition(f: SizeFilter): string {
  // knownMembers は集計後にしか分からないので HAVING で絞る
  if (f === 'small') return 'HAVING members <= 20'
  if (f === 'medium') return 'HAVING members BETWEEN 21 AND 50'
  if (f === 'large') return 'HAVING members >= 51'
  return ''
}

/**
 * 指定期間のグループ別発言数ランキングを返す。
 *
 * 同数は同順位(競技順位方式: 1,1,3,...)。
 * 順位変動は「前の確定期間」の順位との差。前期間にデータが無ければ null。
 */
export async function getGroupRanking(
  env: LineEnv,
  opts: { period: RankingPeriod; size: SizeFilter; q: string; page: number }
): Promise<RankingResult> {
  const range = resolvePeriod(opts.period)
  const empty: RankingResult = {
    rows: [],
    total: 0,
    page: 1,
    totalPages: 1,
    range,
    grandTotal: 0,
    errored: false,
  }

  try {
    // 期間内の集計。group_metadata と突き合わせ、Botが退出済みのグループは除く。
    const { results } = await env.DB.prepare(
      `SELECT a.group_id                AS group_id,
              m.group_name              AS group_name,
              SUM(a.message_count)      AS messages,
              COUNT(DISTINCT a.user_id) AS speakers,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = a.group_id) AS members
         FROM group_activities a
         LEFT JOIN group_metadata m ON m.group_id = a.group_id
        WHERE a.activity_date BETWEEN ? AND ?
          AND (m.left_at IS NULL OR m.group_id IS NULL)
        GROUP BY a.group_id
        ${sizeCondition(opts.size)}
        ORDER BY messages DESC, a.group_id ASC`
    )
      .bind(range.start, range.end)
      .all<{
        group_id: string
        group_name: string | null
        messages: number
        speakers: number
        members: number
      }>()

    let all = results ?? []

    // 前期間の順位(同じ絞り込み条件で算出して比較する)
    const prev = await env.DB.prepare(
      `SELECT a.group_id AS group_id, SUM(a.message_count) AS messages
         FROM group_activities a
         LEFT JOIN group_metadata m ON m.group_id = a.group_id
        WHERE a.activity_date BETWEEN ? AND ?
          AND (m.left_at IS NULL OR m.group_id IS NULL)
        GROUP BY a.group_id
        ORDER BY messages DESC, a.group_id ASC`
    )
      .bind(range.prevStart, range.prevEnd)
      .all<{ group_id: string; messages: number }>()

    const prevRank = new Map<string, number>()
    {
      let rank = 0
      let prevVal: number | null = null
      const rows = prev.results ?? []
      rows.forEach((r, i) => {
        if (prevVal === null || r.messages !== prevVal) {
          rank = i + 1
          prevVal = r.messages
        }
        prevRank.set(r.group_id, rank)
      })
    }

    // 現期間の順位(同数は同順位)
    const ranked: RankingRow[] = []
    {
      let rank = 0
      let prevVal: number | null = null
      all.forEach((r, i) => {
        if (prevVal === null || r.messages !== prevVal) {
          rank = i + 1
          prevVal = r.messages
        }
        const before = prevRank.get(r.group_id)
        ranked.push({
          rank,
          groupId: r.group_id,
          groupName: r.group_name,
          messages: r.messages,
          speakers: r.speakers,
          knownMembers: r.members ?? 0,
          delta: before === undefined ? null : before - rank,
        })
      })
    }

    // グループ名検索(順位を確定させた後に絞る = 順位番号は全体基準のまま)
    const q = opts.q.trim().toLowerCase()
    const filtered = q
      ? ranked.filter((r) => (r.groupName ?? '').toLowerCase().includes(q))
      : ranked

    const grandTotal = ranked.reduce((s, r) => s + r.messages, 0)
    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const page = Math.min(Math.max(1, opts.page), totalPages)
    const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return { rows, total, page, totalPages, range, grandTotal, errored: false }
  } catch {
    return { ...empty, errored: true }
  }
}

// ---------------------------------------------------------------------------
// グループ詳細
// ---------------------------------------------------------------------------

export interface GroupDetail {
  groupId: string
  groupName: string | null
  rank: number | null
  messages: number
  speakers: number
  knownMembers: number
  /** 日別の発言数(期間内の全日。0の日も含む) */
  daily: { date: string; count: number }[]
  /** 主な活動時間帯。集計開始前で不明なら null */
  peakHours: { from: number; to: number } | null
  /** 時間帯集計に使えた件数(0なら「集計開始後に表示」) */
  hourlySamples: number
  /** 紐づく募集スレッド(あれば) */
  thread: { id: string; title: string; category: string } | null
  range: PeriodRange
}

export async function getGroupDetail(
  env: LineEnv,
  groupId: string,
  period: RankingPeriod
): Promise<GroupDetail | null> {
  const range = resolvePeriod(period)

  try {
    const agg = await env.DB.prepare(
      `SELECT SUM(a.message_count) AS messages,
              COUNT(DISTINCT a.user_id) AS speakers
         FROM group_activities a
        WHERE a.group_id = ? AND a.activity_date BETWEEN ? AND ?`
    )
      .bind(groupId, range.start, range.end)
      .first<{ messages: number | null; speakers: number | null }>()

    const meta = await env.DB.prepare(
      `SELECT group_name FROM group_metadata WHERE group_id = ?`
    )
      .bind(groupId)
      .first<{ group_name: string | null }>()

    // グループが存在しない(=一度も記録がない)場合は null
    if (!meta && !agg?.messages) return null

    const members = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`
    )
      .bind(groupId)
      .first<{ n: number }>()

    // 日別。0件の日も埋めて、グラフと合計が必ず一致するようにする。
    const dailyRows = await env.DB.prepare(
      `SELECT activity_date AS d, SUM(message_count) AS c
         FROM group_activities
        WHERE group_id = ? AND activity_date BETWEEN ? AND ?
        GROUP BY activity_date ORDER BY activity_date`
    )
      .bind(groupId, range.start, range.end)
      .all<{ d: string; c: number }>()

    const byDate = new Map((dailyRows.results ?? []).map((r) => [r.d, r.c]))
    const daily: { date: string; count: number }[] = []
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      daily.push({ date: d, count: byDate.get(d) ?? 0 })
      if (daily.length > 40) break
    }

    // 主な活動時間帯(新テーブル。集計開始前は空になる)
    const hourly = await env.DB.prepare(
      `SELECT hour_jst AS h, SUM(message_count) AS c
         FROM group_hourly_activity
        WHERE group_id = ? AND activity_date BETWEEN ? AND ?
        GROUP BY hour_jst`
    )
      .bind(groupId, range.start, range.end)
      .all<{ h: number; c: number }>()

    const hourCounts = new Array(24).fill(0)
    let hourlySamples = 0
    for (const r of hourly.results ?? []) {
      hourCounts[r.h] = r.c
      hourlySamples += r.c
    }

    // 連続する4時間の合計が最大になる窓を「主な活動時間帯」とする
    let peakHours: { from: number; to: number } | null = null
    if (hourlySamples > 0) {
      let best = -1
      let bestStart = 0
      for (let s = 0; s < 24; s++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += hourCounts[(s + k) % 24]
        if (sum > best) {
          best = sum
          bestStart = s
        }
      }
      peakHours = { from: bestStart, to: (bestStart + 4) % 24 }
    }

    // 順位: 一覧と同じ条件で算出
    let rank: number | null = null
    const rankRows = await env.DB.prepare(
      `SELECT a.group_id AS group_id, SUM(a.message_count) AS messages
         FROM group_activities a
         LEFT JOIN group_metadata m ON m.group_id = a.group_id
        WHERE a.activity_date BETWEEN ? AND ?
          AND (m.left_at IS NULL OR m.group_id IS NULL)
        GROUP BY a.group_id ORDER BY messages DESC, a.group_id ASC`
    )
      .bind(range.start, range.end)
      .all<{ group_id: string; messages: number }>()
    {
      let r = 0
      let prevVal: number | null = null
      ;(rankRows.results ?? []).forEach((row, i) => {
        if (prevVal === null || row.messages !== prevVal) {
          r = i + 1
          prevVal = row.messages
        }
        if (row.group_id === groupId) rank = r
      })
    }

    // 募集スレッドとの紐付け: グループ名と一致するタイトルがあれば案内する。
    // (グループIDと掲示板投稿を結びつける正式なキーは既存DBに存在しないため、
    //  勝手な同一視はせず「名前が一致する募集」だけを候補として出す)
    let thread: GroupDetail['thread'] = null
    if (meta?.group_name) {
      const t = await env.DB.prepare(
        `SELECT id, title, category FROM threads WHERE title = ? ORDER BY created_at DESC LIMIT 1`
      )
        .bind(meta.group_name)
        .first<{ id: string; title: string; category: string }>()
      if (t) thread = t
    }

    return {
      groupId,
      groupName: meta?.group_name ?? null,
      rank,
      messages: agg?.messages ?? 0,
      speakers: agg?.speakers ?? 0,
      knownMembers: members?.n ?? 0,
      daily,
      peakHours,
      hourlySamples,
      thread,
      range,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// LINEコマンド「ランキング」用
// ---------------------------------------------------------------------------

/**
 * そのグループの今週の順位・発言数・サイトURLを1通のテキストで返す。
 * 既存の週間個人ランキング(features/ranking.ts)とは別物で、そちらには
 * 一切触れていない。
 */
export async function buildGroupRankingReply(
  env: LineEnv,
  groupId: string,
  siteUrl: string
): Promise<string> {
  try {
    const detail = await getGroupDetail(env, groupId, 'week')
    const range = resolvePeriod('week')
    const periodLabel = `${range.start.replace(/-/g, '.')} - ${range.end.replace(/-/g, '.')}`

    if (!detail || detail.messages === 0) {
      return [
        '今週のグループランキング',
        `集計期間: ${periodLabel}`,
        '',
        'このグループの今週の発言はまだ集計されていません。',
        '',
        `全体のランキングはこちら\n${siteUrl}/ranking`,
      ].join('\n')
    }

    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT a.group_id FROM group_activities a
         LEFT JOIN group_metadata m ON m.group_id = a.group_id
         WHERE a.activity_date BETWEEN ? AND ?
           AND (m.left_at IS NULL OR m.group_id IS NULL)
         GROUP BY a.group_id)`
    )
      .bind(range.start, range.end)
      .first<{ n: number }>()

    const rankLine =
      detail.rank !== null
        ? `順位: ${detail.rank}位${total?.n ? ` / ${total.n}グループ中` : ''}`
        : '順位: 集計中'

    return [
      '今週のグループランキング',
      `集計期間: ${periodLabel}`,
      '',
      rankLine,
      `今週の発言数: ${detail.messages.toLocaleString('en-US')}件`,
      `今週発言した人: ${detail.speakers}人`,
      '',
      `くわしくはこちら\n${siteUrl}/ranking?group=${encodeURIComponent(groupId)}`,
    ].join('\n')
  } catch {
    return 'ランキングの取得に失敗しました。しばらくしてからもう一度お試しください。'
  }
}
