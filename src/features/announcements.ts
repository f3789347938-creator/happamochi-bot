// Reusable "announcement / notice card" system.
//
// Delivered on-demand via a text command (see routeCommand in index.tsx)
// -- NOT a one-time auto-send. Every time someone sends the command, they
// get the current announcement again (Reply API only, ordinary message ->
// reply, exactly like every other command). Intentionally simple: no
// queue, no dedup, no lazy check -- just render + reply.
//
// To add a NEW announcement in the future: just append an entry to the
// ANNOUNCEMENTS array below (new unique id, title, body, optional
// button/date/highlightWord). No other code changes are needed -- the
// notice-card Flex design and automatic Carousel split (when the body
// text is too long for one card) are handled generically by this file.
// targetGroupIds can still be used to limit which groups the command
// responds in, e.g. while testing a new announcement.
import type { LineMessage } from '../lib/line'

// --- Content model -------------------------------------------------------

export type FlexAction =
  | { type: 'message'; label: string; text: string }
  | { type: 'uri'; label: string; uri: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }

export interface AnnouncementContent {
  /** Unique, stable ID — becomes part of the dedup key. Never reuse/change
   *  an existing id once it has been deployed, or groups that already saw
   *  it could see it again under a "new" id. */
  id: string
  /** Card title, e.g. "アップデートのお知らせ！". */
  title: string
  /** Card description. Use \n for line breaks (each line becomes a bullet-
   *  ish row). If this is too long for one card, it's automatically split
   *  into a Carousel of "(1/2)" / "(2/2)" ... cards. */
  body: string
  /** A word inside `body` to visually highlight (bold accent color), e.g.
   *  a feature name or mention — purely cosmetic. */
  highlightWord?: string
  /** Date string shown bottom-right of the card, e.g. "2026/09/05".
   *  Defaults to today's date (JST) if omitted. */
  date?: string
  /** Button shown below the card. Defaults to a "ヘルプを見る" button that
   *  sends "ヘルプ" as a message (safe Reply-API-only default: a `message`
   *  action fires its own ordinary message event with its own replyToken,
   *  never Push). */
  button?: { label: string; action: FlexAction }
  /** Restrict delivery to only these group IDs. Omit for "all groups"
   *  (the normal case once a feature is confirmed working). */
  targetGroupIds?: string[]
}

// --- Registry --------------------------------------------------------------
// Add future announcements here — nothing else needs to change.

const BOT_TEST_GROUP_ID = 'C69deb597234d891abaf8b643b186476c' // "botテスト"

export const ANNOUNCEMENTS: AnnouncementContent[] = [
  {
    id: 'update_2026_09_05_othello',
    title: 'アップデートのお知らせ！',
    body:
      '・オセロが5分放置でタイムアウトするように改善\n' +
      '・タイムアウト通知のメッセージを見やすく調整\n' +
      '・「相手の番です」が手番の人の名前入りに変更\n' +
      '・参加していない人のタップエラーに名前を追加\n' +
      '・対局中はヘッダーに手番の人を表示するように変更\n' +
      '・タップできるマスの色が手番（黒・白）ごとに変化',
    button: { label: 'ヘルプを見る', action: { type: 'message', label: 'ヘルプを見る', text: 'ヘルプ' } },
    // Test run: only respond in "botテスト" for now. Remove targetGroupIds
    // (or list more group IDs) once the user confirms it looks good.
    targetGroupIds: [BOT_TEST_GROUP_ID],
  },
  {
    id: 'notice_2026_09_05_openchat',
    title: 'オープンチャット開設のお知らせ！',
    body:
      '・雑談用の「オープンチャット」を試験的に開設\n' +
      '・誰でも自由に参加OK、気軽に顔を出してね\n' +
      '・荒らし対策のため運営が随時ようすを見てます',
    highlightWord: 'オープンチャット',
    button: { label: 'ヘルプを見る', action: { type: 'message', label: 'ヘルプを見る', text: 'ヘルプ' } },
    targetGroupIds: [BOT_TEST_GROUP_ID],
  },
  {
    id: 'notice_2026_09_05_ranking',
    title: '月間ランキングのお知らせ！',
    body:
      '・今月のオセロ対戦数ランキングを集計中\n' +
      '・上位入賞者はヘッダーでお祝い予定\n' +
      '・エントリー方法は特になし、遊べば自動集計',
    highlightWord: 'ランキング',
    button: { label: 'ヘルプを見る', action: { type: 'message', label: 'ヘルプを見る', text: 'ヘルプ' } },
    targetGroupIds: [BOT_TEST_GROUP_ID],
  },
]

// --- Flex rendering ("notice card" design) ------------------------------

const HEADER_BG = '#2a323d'
const CARD_BG_OUTER = '#eef1f4'
const CARD_BG = '#ffffff'
const CARD_BORDER = '#d5dbe3'
const TITLE_COLOR = '#1a1a2e'
const BODY_COLOR = '#4a5568'
const DATE_COLOR = '#a0aab5'
const BUTTON_BG = '#3b4a5a'
const FOOTER_BG = '#1f2937'
const HIGHLIGHT_COLOR = '#2b6cb0'
// When an announcement is split into a multi-card Carousel, every card
// must render at the SAME size, or the bubbles end up visibly different
// heights depending on how much text landed on each page. Two things make
// that possible (applied ONLY in the Carousel case — a lone card is left
// to size naturally to its content instead):
//   1. The white card box gets a fixed pixel height (CARD_HEIGHT_PX).
//   2. A filler sits between the body text and the date, so the date is
//      always pinned to the bottom of that fixed height no matter how
//      much (or little) text is above it.
// Splitting is done by LINE COUNT (not character count) and evenly
// balanced across pages (e.g. 10 lines -> 5+5, never 6+4), so multi-card
// announcements don't have one near-empty trailing card either.
const CARD_HEIGHT_PX = 300
const MAX_LINES_PER_CARD = 6

function todayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

function jstYear(): number {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear()
}

// Splits `body` into an even number of lines per page (never a short
// trailing page) so every card in a Carousel has a similar amount of
// content — combined with the fixed CARD_HEIGHT_PX + bottom-pinned date,
// this guarantees all cards render at identical size.
function splitBody(body: string): string[] {
  const lines = body.split('\n')
  if (lines.length <= MAX_LINES_PER_CARD) return [body]

  const pageCount = Math.ceil(lines.length / MAX_LINES_PER_CARD)
  const perPage = Math.ceil(lines.length / pageCount)
  const pages: string[] = []
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage).join('\n'))
  }
  return pages
}

// Renders the body text as a single `text` component, splitting out
// `highlightWord` (if present) into its own colored `span` for emphasis.
function renderBodyText(bodyPage: string, highlightWord?: string): Record<string, any> {
  const base = { wrap: true, size: 'xs', margin: 'md' }
  if (!highlightWord) {
    return { type: 'text', text: bodyPage, color: BODY_COLOR, ...base }
  }
  const idx = bodyPage.indexOf(highlightWord)
  if (idx === -1) {
    return { type: 'text', text: bodyPage, color: BODY_COLOR, ...base }
  }
  const before = bodyPage.slice(0, idx)
  const after = bodyPage.slice(idx + highlightWord.length)
  const spans: Record<string, any>[] = []
  if (before) spans.push({ type: 'span', text: before, color: BODY_COLOR })
  spans.push({ type: 'span', text: highlightWord, color: HIGHLIGHT_COLOR, weight: 'bold' })
  if (after) spans.push({ type: 'span', text: after, color: BODY_COLOR })
  return { type: 'text', contents: spans, ...base }
}

function buildBubble(
  content: AnnouncementContent,
  bodyPage: string,
  pageIndex: number,
  pageCount: number,
  forceCardStyle: boolean = false
): Record<string, any> {
  // The "(1/2)" style page suffix only makes sense when THIS announcement's
  // own body was split into multiple pages -- it's unrelated to whether this
  // bubble also happens to be riding alongside OTHER announcements' bubbles
  // in a bundled multi-announcement Carousel (see buildAnnouncementsMessage).
  const titleText = pageCount > 1 ? `${content.title}（${pageIndex + 1}/${pageCount}）` : content.title
  const dateText = content.date ?? todayJst()
  const button = content.button ?? {
    label: 'ヘルプを見る',
    action: { type: 'message' as const, label: 'ヘルプを見る', text: 'ヘルプ' },
  }

  // Fixed height (+ bottom-pinned date via filler) is needed whenever this
  // bubble ends up riding in a multi-card Carousel -- whether that's because
  // ONE long announcement got auto-split into multiple pages (pageCount > 1),
  // or because MULTIPLE separate announcements are being bundled together
  // into one Carousel (forceCardStyle, passed in by the caller in that case).
  // Either way, every card in the same Carousel must match heights, or the
  // bubbles end up visibly different sizes. For a lone card (the common
  // case), leave it to size naturally to its content instead; forcing a
  // fixed height there just stretches it out with empty space.
  const isCarousel = pageCount > 1 || forceCardStyle

  const card: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    backgroundColor: CARD_BG,
    cornerRadius: 'md',
    borderColor: CARD_BORDER,
    borderWidth: '1px',
    paddingAll: 'lg',
    contents: [
      { type: 'text', text: titleText, weight: 'bold', size: 'md', align: 'center', color: TITLE_COLOR, wrap: true },
      { type: 'separator', margin: 'md', color: CARD_BORDER },
      renderBodyText(bodyPage, content.highlightWord),
      ...(isCarousel ? [{ type: 'filler' }] : []),
      { type: 'text', text: dateText, size: 'xs', color: DATE_COLOR, align: 'end', margin: isCarousel ? undefined : 'md' },
    ],
  }
  if (isCarousel) {
    // Only fix the height (and rely on the filler above) when there are
    // multiple cards that need to visually match.
    card.height = `${CARD_HEIGHT_PX}px`
  }

  const buttonBox = {
    type: 'button',
    style: 'primary',
    color: BUTTON_BG,
    height: 'sm',
    action: { type: button.action.type, label: button.label, ...omitLabelAndType(button.action) },
  }

  return {
    type: 'bubble',
    // size: 'kilo' -- determined by actual pixel measurement, not guessing.
    // Both the reference screenshot and our rendered screenshot were
    // downloaded and measured with Python/PIL (both images are the same
    // 461x1024px, so a direct pixel comparison is valid): the reference
    // card's header bar measured ~321px wide, ours (at the previous
    // default 'mega') measured ~371px wide -- 16% too wide, not a match.
    // LINE's bubble size scale is not evenly spaced in pixels; a LINE API
    // expert's conference-measured "block count" per size (nano=7, micro=9,
    // deca=12, hecto=13, kilo=14, mega=16, giga=26 -- see
    // https://taichunmin.idv.tw/blog/2021-09-10-line-flex-width.html) lets
    // us predict each size's rendered width from our own measured mega
    // width (371px * blocks/16): nano=162px, micro=209px, deca=278px,
    // hecto=301px, kilo=325px, giga=603px. Comparing those predictions to
    // the measured reference width (321px), 'kilo' (325px) is off by only
    // ~1%, while every other size (including the previous 'mega') is off
    // by 6% or more. So the reference bubble is almost certainly 'kilo',
    // not the default 'mega'.
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: HEADER_BG,
      paddingAll: 'lg',
      contents: [{ type: 'text', text: 'お知らせ', color: '#ffffff', weight: 'bold', size: 'md', align: 'center' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: CARD_BG_OUTER,
      paddingAll: 'lg',
      spacing: 'lg',
      contents: [card, buttonBox],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FOOTER_BG,
      paddingAll: 'md',
      contents: [
        { type: 'text', text: `© ${jstYear()} 葉っぱもち nano-bot`, color: '#ffffff', size: 'xs', align: 'center' },
      ],
    },
  }
}

function omitLabelAndType(action: FlexAction): Record<string, any> {
  const { type, label, ...rest } = action
  return rest
}

export function buildAnnouncementMessage(content: AnnouncementContent): LineMessage {
  return buildAnnouncementsMessage([content])
}

// Bundles ONE OR MORE distinct announcements into a single Flex message.
//
// - 1 announcement, body fits on one card -> a lone bubble (unchanged from
//   before: no page suffix, natural height).
// - 1 announcement, body too long for one card -> that announcement's own
//   "(1/2)"/"(2/2)"... auto-split Carousel (unchanged from before).
// - 2+ announcements -> ALL of their bubbles (including any auto-split
//   pages) are flattened into ONE Carousel, each still labeled with its own
//   title (+ "(n/m)" only if that particular announcement itself was split),
//   so multiple distinct notices can be swiped through together -- matching
//   how the reference bot bundles multiple different announcements into one
//   Carousel rather than one announcement's pages.
//
// A Carousel can only directly contain `bubble` objects (not nested
// carousels), so this always flattens to a single flat bubble array.
export function buildAnnouncementsMessage(contents: AnnouncementContent[]): LineMessage {
  const perAnnouncementBubbles = contents.map((content) => {
    const pages = splitBody(content.body)
    return pages.map((page, idx) => ({ content, page, idx, pageCount: pages.length }))
  })
  const flat = perAnnouncementBubbles.flat()
  // Once there's more than one bubble in the final Carousel -- whether from
  // multiple announcements, one split announcement, or a mix of both --
  // every bubble needs the fixed-height "card style" so they all match.
  const forceCardStyle = flat.length > 1
  const bubbles = flat.map(({ content, page, idx, pageCount }) =>
    buildBubble(content, page, idx, pageCount, forceCardStyle)
  )

  const flexContents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
  const altText = contents.length === 1 ? contents[0].title : contents.map((c) => c.title).join(' / ')

  return {
    type: 'flex',
    altText,
    contents: flexContents,
  }
}

// --- Command handler (called from routeCommand) -------------------------

// Returns the Flex message(s) for the announcement(s) targeting this group,
// bundled into a single Carousel when there's more than one, or [] if
// there's nothing to show (no announcements registered, or the only one(s)
// are restricted to other groups via targetGroupIds).
export function getLatestAnnouncementMessages(groupId: string | null): LineMessage[] {
  const visible = ANNOUNCEMENTS.filter(
    (a) => !a.targetGroupIds || (groupId !== null && a.targetGroupIds.includes(groupId))
  )
  if (visible.length === 0) return []
  return [buildAnnouncementsMessage(visible)]
}
