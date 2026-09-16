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
import { enqueueBroadcast } from '../lib/line'
import type { LineMessage, LineEnv } from '../lib/line'

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

// 新しいお知らせを本番の全グループに出す前に、まず1グループだけで見た目を
// 確認したいときに targetGroupIds: [BOT_TEST_GROUP_ID] として使う。
// 現在登録済みの3件は確認済みのため全グループ対象(targetGroupIds なし)。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BOT_TEST_GROUP_ID = 'C69deb597234d891abaf8b643b186476c' // "botテスト"

export const ANNOUNCEMENTS: AnnouncementContent[] = [
  // 過去のお知らせ(オセロ改善 / タグ機能 / 称号機能)は、内容が古くなったため
  // 一覧から削除した。announcement_sends の記録も消してリセットしてあるので、
  // 下の新しいお知らせが各グループに1回ずつ届く。
  {
    id: 'notice_2026_09_16_games',
    title: '新しいゲームのお知らせ！',
    body:
      '・新しいゲームが2つ遊べるようになりました\n' +
      '「パズル」…同じもちをくっつけて育てるパズル\n' +
      '「サバイバル」…倒れるまでスコアに挑戦\n' +
      '・LINEの中でそのまま遊べます\n' +
      '・「ランキング」で順位を確認できます',
    highlightWord: 'ゲーム',
    // ゲームが2つあるのに「パズル」だけを送るボタンでは片方しか開けないので、
    // 両方(と他のコマンド)をたどれるヘルプに送る。
    button: {
      label: 'ヘルプで確認',
      action: { type: 'message', label: 'ヘルプで確認', text: 'ヘルプ' },
    },
  },
]

// --- Flex rendering ("notice card" design) ------------------------------

// --- 配色 (水色テーマ) ---------------------------------------------------
// ユーザー指定の3色を基準にしている:
//   ヘッダーの水色 #BAE7FA / ボタンの水色 #9DDDF4 / 文字のネイビー #15384D
//
// 重要: ヘッダーとボタンが淡い水色になったため、以前の「白文字」では
// 文字が読めなくなる(実測コントラスト比 ヘッダー 1.32:1 / ボタン 1.49:1)。
// そのため、この2箇所の文字色は白ではなくネイビーにしている
// (ヘッダー 9.33:1 / ボタン 8.26:1 でどちらも十分な可読性)。
// 併せてフッターも濃紺から水色系に寄せ、ネイビー文字にしている。
const HEADER_BG = '#BAE7FA'        // ヘッダー(水色)
const HEADER_TEXT = '#15384D'      // ヘッダー文字(ネイビー)
const CARD_BG_OUTER = '#EAF6FD'    // カードの外側の淡い水色地
const CARD_BG = '#ffffff'
const CARD_BORDER = '#C4E4F5'      // 水色系の枠線
const TITLE_COLOR = '#15384D'      // 見出し(ネイビー)
const BODY_COLOR = '#3C6478'       // 本文(白地で 6.39:1)
const DATE_COLOR = '#7DA3B8'       // 日付(補助情報なので淡く)
const BUTTON_BG = '#9DDDF4'        // ボタン(水色)
const BUTTON_TEXT = '#15384D'      // ボタン文字(ネイビー)
const FOOTER_BG = '#D6EEFA'        // フッター(ヘッダーより淡い水色)
const FOOTER_TEXT = '#15384D'      // フッター文字(ネイビー)
const HIGHLIGHT_COLOR = '#0E7FA8'  // 強調(白地で 4.55:1、水色寄りのアクセント)
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

  // LINEのFlex `button` は style:'primary' だと文字色が白で固定され、
  // 淡い水色(#9DDDF4)の上では 1.49:1 しかなく読めない。文字色を指定できる
  // プロパティが button には無いため、タップ領域を持つ box(action付き)で
  // 自前に組み、中のテキストをネイビーにしている。見た目・挙動はボタンと
  // 同じで、action の内容(message/uri/postback)もそのまま渡している。
  const buttonBox = {
    type: 'box',
    layout: 'vertical',
    backgroundColor: BUTTON_BG,
    cornerRadius: 'md',
    paddingAll: 'md',
    action: { type: button.action.type, label: button.label, ...omitLabelAndType(button.action) },
    contents: [
      {
        type: 'text',
        text: button.label,
        color: BUTTON_TEXT,
        weight: 'bold',
        size: 'sm',
        align: 'center',
      },
    ],
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
      contents: [{ type: 'text', text: 'お知らせ', color: HEADER_TEXT, weight: 'bold', size: 'md', align: 'center' }],
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
        { type: 'text', text: `© ${jstYear()} 葉っぱもち nano-bot`, color: FOOTER_TEXT, size: 'xs', align: 'center' },
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

// --- 未送信のお知らせを1回だけ自動送信する ------------------------------
//
// 「お知らせ」コマンドは何度でも見返せるが(上の
// getLatestAnnouncementMessages)、それとは別に、新しいお知らせを
// ANNOUNCEMENTS に追加したときは、各グループに **1回だけ** 自動で届く。
//
// 仕組み(週間ランキング features/ranking.ts と同じ遅延評価方式):
//   1. グループでメッセージを受信するたびに checkAndQueueAnnouncements()
//      が呼ばれる。
//   2. そのグループに対して「まだ送っていない id」があるか調べる。
//      (announcement_sends テーブルで管理)
//   3. あればブロードキャストキューに積み、送信済みとして記録する。
//   4. 実際の送信は、その発言への Reply に便乗して行われる(Push API不使用)。
//
// したがって:
//   ・新しい id を追加 → 各グループで次の発言時に1回だけ届く
//   ・そのあとは、次に新しい id を追加するまで自動送信されない
//   ・既存の id の文面だけを直した場合は「送信済み」なので再送されない
//     (再送したいなら id を新しくする)
export async function checkAndQueueAnnouncements(env: LineEnv, groupId: string) {
  // このグループが対象になるお知らせだけに絞る
  // (targetGroupIds が指定されているものは、そのグループ限定)
  const visible = ANNOUNCEMENTS.filter(
    (a) => !a.targetGroupIds || a.targetGroupIds.includes(groupId)
  )
  if (visible.length === 0) return

  // 既に送信済みの id を取得
  const placeholders = visible.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT announcement_id FROM announcement_sends
      WHERE group_id = ? AND announcement_id IN (${placeholders})`
  )
    .bind(groupId, ...visible.map((a) => a.id))
    .all<{ announcement_id: string }>()

  const alreadySent = new Set((results ?? []).map((r) => r.announcement_id))
  const unsent = visible.filter((a) => !alreadySent.has(a.id))
  if (unsent.length === 0) return

  // 未送信ぶんをまとめて1通のFlex(複数ならCarousel)にする。
  // LINEの1リプライ5メッセージ制限があるため、Flex 1通に束ねるのが安全。
  const message = buildAnnouncementsMessage(unsent)

  await enqueueBroadcast(
    env,
    groupId,
    'announcement',
    [message],
    // dedup_key: 同じ組み合わせを二重にキューしない
    `announcement_${groupId}_${unsent.map((a) => a.id).join('+')}`
  )

  // 送信済みとして記録する。
  //
  // 注意: ここでキュー投入直後に記録している。キューは delivered=0 のまま
  // 残り、Reply成功まで再試行されるので「キューに入った=最終的に届く」と
  // みなして良い。逆にReply成功を待って記録しようとすると、キューの
  // 送信経路(lib/line.ts)にお知らせ専用の後処理を差し込む必要があり、
  // 既存のブロードキャスト処理に手を入れることになるため採らない。
  for (const a of unsent) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO announcement_sends (group_id, announcement_id) VALUES (?, ?)`
    )
      .bind(groupId, a.id)
      .run()
  }
}
