// Reusable "announcement / notice card" system.
//
// The text command returns the current announcements on demand.
// Newly registered IDs are also queued once per group by
// checkAndQueueAnnouncements below. Both paths use Reply API only.
// Preserve existing IDs and history. A user-authorized delivery edition can
// reannounce the current collection once without deleting other group data.
//
// To add a NEW announcement in the future: just append an entry to the
// ANNOUNCEMENTS array below (new unique id, title, body, optional
// button/date/highlightWord). No other code changes are needed -- the
// notice-card Flex design and automatic Carousel split (when the body
// text is too long for one card) are handled generically by this file.
// targetGroupIds can still be used to limit which groups the command
// responds in, e.g. while testing a new announcement.
import type { LineMessage, LineEnv } from '../lib/line'
import { gameOpenUrl, survivorOpenUrl } from './menu/gameLink'

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
// targetGroupIds のないお知らせは全グループ対象。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BOT_TEST_GROUP_ID = 'C69deb597234d891abaf8b643b186476c' // "botテスト"

// 2026/09/20: owner requested one fresh announcement delivery in every group.
// Keep this stable when merely editing wording or adding the next notice.
export const ANNOUNCEMENT_DELIVERY_EDITION = '20260920_read_v1'

export const ANNOUNCEMENTS: AnnouncementContent[] = [
  {
    id: 'notice_2026_09_21_games_reopened',
    title: 'ゲームが遊べるように！',
    date: '2026/09/21',
    body: [
      '開けなかった不具合を修正！',
      '「パズル」「サバイバル」は',
      '誰でも遊べるようになりました。',
      '遊んでガチャ用ポイントもGET！',
      '今まで開けなかった人も、',
      'ぜひ遊んでみてね！',
    ].join('\n'),
    highlightWord: 'ガチャ用ポイント',
    button: {
      label: 'パズルで遊ぶ',
      action: { type: 'uri', label: 'パズルで遊ぶ', uri: gameOpenUrl('https://line-group-bbs.pages.dev') },
    },
  },
  {
    id: 'notice_2026_09_21_game_gacha_rewards',
    title: '遊んでガチャに挑戦！',
    date: '2026/09/21',
    body: [
      '30秒以上遊ぶと100点ごとに1P',
      '1回最大100P／1日合計1,000P',
      '「ガチャ」で衣装・背景を',
      '合計100種類以上集めると',
      'PayPay 1万円分プレゼント！',
      '期限：2027/9/19まで',
    ].join('\n'),
    highlightWord: 'PayPay 1万円分',
    button: {
      label: 'サバイバルで遊ぶ',
      action: { type: 'uri', label: 'サバイバルで遊ぶ', uri: survivorOpenUrl('https://line-group-bbs.pages.dev') },
    },
  },
  {
    id: 'notice_2026_09_20_read_receipts',
    title: '公式アカウント初！',
    date: '2026/09/20',
    body: [
      '既読確認が出来るのはこのアカウントだけです。',
      '・「既読セット」でスタート',
      '・「既読確認」で名前をチェック',
      '・最終確認時刻も日本時間で表示',
      '・再セットで記録をリセット',
      'ぜひグループで使ってみてね！',
    ].join('\n'),
    highlightWord: 'このアカウントだけ',
    button: {
      label: '既読確認を試してみる',
      action: { type: 'message', label: '既読確認を試してみる', text: '既読セット' },
    },
  },
  {
    id: 'notice_2026_09_19_dressup_gacha',
    title: '着せ替えガチャ登場！',
    date: '2026/09/19',
    body: [
      '・衣装120種＋背景30種',
      '・1回3,000P・重複なし',
      '・衣装・背景は「着せ替え」で設定',
      '・ガチャで100種類集めると',
      '　PayPay 1万円分プレゼント！',
      '・期限：2027/9/19まで',
    ].join('\n'),
    highlightWord: 'PayPay 1万円分',
    button: {
      label: 'ガチャを見てみる',
      action: { type: 'message', label: 'ガチャを見てみる', text: 'ガチャ' },
    },
  },
  {
    id: 'notice_2026_09_19_mentions_replies',
    title: '確認コマンドを追加！',
    date: '2026/09/19',
    body: [
      '・「めんかく」',
      '　自分宛のメンションを確認',
      '・「りぷかく」',
      '　自分の発言への返信を確認',
      '・グループで送るだけ！',
      '・記録された直近の最大4件を表示',
    ].join('\n'),
    button: {
      label: 'ヘルプで確認',
      action: { type: 'message', label: 'ヘルプで確認', text: 'ヘルプ' },
    },
  },
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
// LINE stretches carousel bodies to match the tallest bubble. Keep the
// inner card and text at their natural height so device-specific wrapping
// cannot clip important content such as rewards or deadlines.
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

// Balance logical lines across pages. A line may wrap again on the device;
// natural card height accommodates those extra visual lines.
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
  const base = { wrap: true, size: '13px', margin: '12px', flex: 1 }
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
  // Explicit span sizes avoid depending on inheritance from the text node.
  if (before) spans.push({ type: 'span', text: before, color: BODY_COLOR, size: base.size })
  spans.push({ type: 'span', text: highlightWord, color: HIGHLIGHT_COLOR, weight: 'bold', size: base.size })
  if (after) spans.push({ type: 'span', text: after, color: BODY_COLOR, size: base.size })
  return { type: 'text', contents: spans, ...base }
}

function buildBubble(
  content: AnnouncementContent,
  bodyPage: string,
  pageIndex: number,
  pageCount: number
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

  const card: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    backgroundColor: CARD_BG,
    cornerRadius: 'md',
    borderColor: CARD_BORDER,
    borderWidth: '1px',
    paddingAll: '12px',
    contents: [
      { type: 'text', text: titleText, weight: 'bold', size: '16px', align: 'center', color: TITLE_COLOR, wrap: true },
      { type: 'separator', margin: '12px', color: CARD_BORDER },
      renderBodyText(bodyPage, content.highlightWord),
      { type: 'text', text: dateText, size: '11px', color: DATE_COLOR, align: 'end', margin: '12px', wrap: true },
    ],
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
    paddingAll: '10px',
    flex: 0,
    action: { type: button.action.type, label: button.label, ...omitLabelAndType(button.action) },
    contents: [
      {
        type: 'text',
        text: button.label,
        color: BUTTON_TEXT,
        weight: 'bold',
        size: '14px',
        align: 'center',
        wrap: true,
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
      paddingAll: '12px',
      contents: [{ type: 'text', text: 'お知らせ', color: HEADER_TEXT, weight: 'bold', size: '16px', align: 'center', wrap: true }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: CARD_BG_OUTER,
      paddingAll: '12px',
      spacing: '12px',
      contents: [card, buttonBox],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: FOOTER_BG,
      paddingAll: '10px',
      contents: [
        { type: 'text', text: `© ${jstYear()} 葉っぱもち nano-bot`, color: FOOTER_TEXT, size: '11px', align: 'center', wrap: true },
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
  // Native carousel layout aligns body heights without a clipping height cap.
  const bubbles = flat.map(({ content, page, idx, pageCount }) =>
    buildBubble(content, page, idx, pageCount)
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
//   3. あればキュー投入と配信予約履歴を1トランザクションで記録する。
//   4. 実際の送信は、その発言への Reply に便乗して行われる(Push API不使用)。
//
// したがって:
//   ・新しい id を追加 → 各グループで次の発言時に1回だけ届く
//   ・そのあとは、次に新しい id を追加するまで自動送信されない
//   ・既存の id の文面だけを直した場合は「送信済み」なので再送されない
//   ・全件を一度だけ再案内するときは、明示的な依頼を受けて配信版を更新する
export async function checkAndQueueAnnouncements(env: LineEnv, groupId: string) {
  // このグループが対象になるお知らせだけに絞る
  // (targetGroupIds が指定されているものは、そのグループ限定)
  const visible = ANNOUNCEMENTS.filter(
    (a) => !a.targetGroupIds || a.targetGroupIds.includes(groupId)
  )
  if (visible.length === 0) return

  const deliveryId = (a: AnnouncementContent) => `${ANNOUNCEMENT_DELIVERY_EDITION}:${a.id}`
  const queuePrefix = `announcement_${ANNOUNCEMENT_DELIVERY_EDITION}_`
  // 既存の履歴は保持し、今回の配信版について予約済みかを確認する。
  const placeholders = visible.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT announcement_id FROM announcement_sends
      WHERE group_id = ? AND announcement_id IN (${placeholders})`
  )
    .bind(groupId, ...visible.map(deliveryId))
    .all<{ announcement_id: string }>()

  const alreadySent = new Set((results ?? []).map((r) => r.announcement_id))
  const unsent = visible.filter((a) => !alreadySent.has(deliveryId(a)))
  const statements = [env.DB.prepare(
    // 旧版の未送信お知らせは新版に置き換える。配信中や他種の通知には触れない。
    // delivered=3 は置換済み。過去の送信履歴と行そのものは残す。
    `UPDATE pending_broadcasts SET delivered=3
      WHERE group_id=? AND kind='announcement' AND delivered=0
      AND (dedup_key IS NULL OR substr(dedup_key,1,?)<>?)`
  ).bind(groupId, queuePrefix.length, queuePrefix)]
  if (unsent.length > 0) {
    // 全未送信項目を1通にまとめ、同時受信でも同一キーを一度だけ予約する。
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO pending_broadcasts (group_id,kind,message_json,dedup_key) VALUES (?,?,?,?)`
    ).bind(groupId, 'announcement', JSON.stringify([buildAnnouncementsMessage(unsent)]),
      `${queuePrefix}${groupId}_${unsent.map(a => a.id).join('+')}`))
    for (const a of unsent) {
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO announcement_sends (group_id,announcement_id) VALUES (?,?)`
      ).bind(groupId, deliveryId(a)))
    }
  }
  await env.DB.batch(statements)
}
