// Reusable "one-time announcement" delivery system.
//
// Same push-free pattern as birthdays/fortune/ranking/othello-timeout: no
// cron, no push — instead, every incoming group message triggers a lazy
// check ("has this group already received announcement X? if not, queue
// it"), and the queued Flex message rides along on the very next Reply
// call via `enqueueBroadcast` / `flushQueueOnReply`.
//
// Exactly-once-per-group delivery is guaranteed by the UNIQUE `dedup_key`
// column on `pending_broadcasts` (see migrations/0002_broadcast_queue.sql):
// `announcement_<announcementId>_<groupId>`. Once a row with that key
// exists, `enqueueBroadcast`'s `INSERT OR IGNORE` becomes a no-op forever,
// regardless of how many more messages arrive in that group.
//
// To add a NEW announcement in the future: just append an entry to the
// ANNOUNCEMENTS array below (new unique `id`, title, items, optional
// footer). No other code changes are needed — delivery, dedup, Flex
// design (incl. automatic Carousel split if the item list is long), and
// group targeting are all handled generically by this file.
import type { LineEnv, LineMessage } from '../lib/line'
import { enqueueBroadcast } from '../lib/line'

// --- Content model -------------------------------------------------------

export interface AnnouncementContent {
  /** Unique, stable ID — becomes part of the dedup key. Never reuse/change
   *  an existing id once it has been deployed, or groups that already saw
   *  it could see it again under a "new" id. */
  id: string
  /** Short title shown in the header, e.g. "アップデートのお知らせ". */
  title: string
  /** Emoji shown above the title in the header. Defaults to "📢". */
  icon?: string
  /** Bullet items making up the body. Long lists are automatically split
   *  across multiple bubbles (Carousel) so nothing gets visually cramped. */
  items: string[]
  /** Optional closing note shown once, on the last bubble only
   *  (e.g. "コマンド一覧は「ヘルプ」と送ると確認できます"). */
  footer?: string
  /** Restrict delivery to only these group IDs. Omit for "all groups"
   *  (the normal case once a feature is confirmed working). Used here to
   *  scope the very first test run to just "botテスト". */
  targetGroupIds?: string[]
}

// --- Registry --------------------------------------------------------------
// Add future announcements here — nothing else needs to change.

const BOT_TEST_GROUP_ID = 'C69deb597234d891abaf8b643b186476c' // "botテスト"

export const ANNOUNCEMENTS: AnnouncementContent[] = [
  {
    id: 'update_2026_09_05_othello',
    title: 'アップデートのお知らせ',
    icon: '📢',
    items: [
      'オセロ：誰も参加しないまま5分放置された場合も、待機中からタイムアウトするようになりました',
      'オセロ：タイムアウト通知のメッセージを少し見やすく調整しました',
      'オセロ：「相手の番です」→ 手番の人の名前が表示されるようになりました',
      'オセロ：対局に参加していない人がタップした時のエラーに、その人の名前が表示されるようになりました',
      'オセロ：対局中はヘッダーに「〇〇さんの番です」と手番が表示されるようになりました',
      'オセロ：タップできるマスの色が、手番（黒・白）に応じて変わるようになりました',
    ],
    footer: 'コマンド一覧は「ヘルプ」と送ると確認できます🍵',
    // Test run: only send in "botテスト" for now. Remove targetGroupIds
    // (or list more group IDs) once the user confirms it looks good.
    targetGroupIds: [BOT_TEST_GROUP_ID],
  },
]

// --- Flex rendering ----------------------------------------------------

const HEADER_BG = '#37474f'
const ACCENT = '#26a69a'
const MAX_ITEMS_PER_BUBBLE = 6

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function buildBubble(
  content: AnnouncementContent,
  items: string[],
  pageIndex: number,
  pageCount: number,
  isLast: boolean
): Record<string, any> {
  const bodyContents: Record<string, any>[] = items.map((item) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: '✅', flex: 0, size: 'sm', color: ACCENT },
      { type: 'text', text: item, flex: 1, size: 'sm', color: '#333333', wrap: true },
    ],
  }))

  if (isLast && content.footer) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    bodyContents.push({
      type: 'text',
      text: content.footer,
      wrap: true,
      size: 'xs',
      color: '#888888',
      margin: 'md',
    })
  }

  const headerContents: Record<string, any>[] = [
    { type: 'text', text: content.icon ?? '📢', size: 'xxl', align: 'center' },
    { type: 'text', text: content.title, color: '#ffffff', weight: 'bold', size: 'lg', align: 'center', margin: 'sm' },
  ]
  if (pageCount > 1) {
    headerContents.push({
      type: 'text',
      text: `${pageIndex + 1} / ${pageCount}`,
      color: '#ffffffb0',
      size: 'xs',
      align: 'center',
    })
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: HEADER_BG,
      paddingAll: 'lg',
      contents: headerContents,
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: 'lg',
      contents: bodyContents,
    },
  }
}

export function buildAnnouncementMessage(content: AnnouncementContent): LineMessage {
  const pages = chunk(content.items, MAX_ITEMS_PER_BUBBLE)
  const bubbles = pages.map((items, idx) =>
    buildBubble(content, items, idx, pages.length, idx === pages.length - 1)
  )

  const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }

  return {
    type: 'flex',
    altText: content.title,
    contents,
  }
}

// --- Lazy check-and-enqueue (called from handleMessageEvent) -----------

export async function checkAndQueueAnnouncements(env: LineEnv, groupId: string) {
  for (const announcement of ANNOUNCEMENTS) {
    if (announcement.targetGroupIds && !announcement.targetGroupIds.includes(groupId)) {
      continue
    }

    const dedupKey = `announcement_${announcement.id}_${groupId}`

    const already = await env.DB.prepare(`SELECT 1 FROM pending_broadcasts WHERE dedup_key = ?`)
      .bind(dedupKey)
      .first()
    if (already) continue

    await enqueueBroadcast(env, groupId, 'announcement', [buildAnnouncementMessage(announcement)], dedupKey)
  }
}
