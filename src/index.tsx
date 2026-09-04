import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import {
  replyMessage,
  pushMessage,
  getProfile,
  getGroupSummary,
  verifySignature,
  peekBroadcasts,
  markBroadcastsDelivered,
  type LineEnv,
  type LineMessage,
} from './lib/line'
import { handleUnsend } from './features/unsend'
import { cacheGroupMessage, touchGroupMember, ensureGroupMetadata } from './features/groupTracking'
import { buildWelcomeMessages } from './features/welcome'
import { registerBirthday, checkAndQueueBirthdays } from './features/birthday'
import {
  getOrCreateDailyFortune,
  formatFortuneText,
  registerZodiacSign,
  todayJst,
  ZODIAC_SIGNS,
  checkAndQueueGroupFortune,
} from './features/fortune'
import { checkAndQueueWeeklyRanking } from './features/ranking'
import { saveQuote, buildQuoteFlexMessage } from './features/quote'
import { addTagToGroup, listGroupTags, removeTagFromGroup } from './features/tags'
import { setWelcomeSetting } from './features/welcome'
import { equipTitle, getEquippedTitle, listUserTitles } from './features/titles'

type Bindings = LineEnv

const app = new Hono<{ Bindings: Bindings }>()

app.use('/static/*', serveStatic({ root: './public' }))

// ─── Health check ───
app.get('/', (c) => c.text('HappaMochi Bot is running 🍡'))

// ─── Debug: simulate a text command WITHOUT touching LINE ───
// LINEに実際のメッセージを送らず、Botのコマンドロジックが「何を返そうとしているか」
// だけをJSONで確認できるエンドポイント。テスト用のreplyToken/署名は不要。
// 本番用途ではなく、動作確認専用(データベースへの書き込みは実際に発生する点に注意)。
app.post('/debug/simulate', async (c) => {
  const { text, groupId, userId } = await c.req.json<{ text: string; groupId?: string; userId?: string }>()
  if (!text) return c.json({ error: 'text is required' }, 400)

  const ctx = {
    text: text.trim(),
    isGroup: true,
    groupId: groupId ?? 'Cdebug_simulated_group',
    userId: userId ?? 'Udebug_simulated_user',
    displayName: 'デバッグユーザー',
    pictureUrl: null,
  }

  try {
    const directReplies = await routeCommand(c.env, ctx)
    const { messages: queued, ids: queuedIds } = await peekBroadcasts(c.env, ctx.groupId!)
    return c.json({
      input: { text: ctx.text, groupId: ctx.groupId, userId: ctx.userId },
      would_reply_with: [...directReplies, ...queued].slice(0, 5),
      pending_broadcast_queue_ids_not_yet_sent: queuedIds,
      note: 'これはLINEに送信されていません。ロジックが生成した返信内容の確認のみです。',
    })
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 500)
  }
})

// ─── LINE Webhook ───
app.post('/webhook', async (c) => {
  const bodyText = await c.req.text()
  const signature = c.req.header('x-line-signature') ?? null

  const valid = await verifySignature(c.env.LINE_CHANNEL_SECRET, bodyText, signature)

  await c.env.DB.prepare(
    `INSERT INTO webhook_debug_logs (timestamp, request_body, has_signature, event_type) VALUES (?, ?, ?, ?)`
  )
    .bind(new Date().toISOString(), bodyText.slice(0, 2000), signature ? 1 : 0, valid ? 'valid' : 'invalid_signature')
    .run()

  if (!valid) return c.json({ error: 'invalid signature' }, 401)

  const payload = JSON.parse(bodyText) as { events: any[] }

  for (const event of payload.events ?? []) {
    try {
      await handleEvent(c.env, event)
    } catch (e: any) {
      await c.env.DB.prepare(
        `INSERT INTO webhook_debug_logs (timestamp, request_body, has_signature, event_type, error_message) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(new Date().toISOString(), JSON.stringify(event).slice(0, 2000), 1, event.type, String(e?.message ?? e))
        .run()
    }
  }

  return c.json({ ok: true })
})

async function handleEvent(env: Bindings, event: any) {
  switch (event.type) {
    case 'unsend':
      await handleUnsend(env, event)
      return

    case 'message':
      await handleMessageEvent(env, event)
      return

    case 'memberJoined':
      await handleMemberJoined(env, event)
      return

    case 'join':
      if (event.source.type === 'group') {
        await ensureGroupMetadata(env, event.source.groupId, null)
      }
      return

    default:
      return
  }
}

async function handleMemberJoined(env: Bindings, event: any) {
  const groupId = event.source.groupId
  if (!groupId) return
  const joined = event.joined?.members ?? []
  const resolved = await Promise.all(
    joined.map(async (m: any) => {
      const p = await getProfile(env, m.userId, groupId)
      return { userId: m.userId, displayName: p?.displayName }
    })
  )
  const messages = await buildWelcomeMessages(env, groupId, resolved)
  if (messages && event.replyToken) {
    await flushQueueOnReply(env, groupId, event.replyToken, messages)
  }
}

async function handleMessageEvent(env: Bindings, event: any) {
  const source = event.source
  const isGroup = source.type === 'group'
  const groupId = source.groupId
  const userId = source.userId
  const replyToken: string | undefined = event.replyToken
  const message = event.message

  let displayName: string | null = null
  let pictureUrl: string | null = null
  if (userId) {
    const profile = await getProfile(env, userId, isGroup ? groupId : undefined)
    displayName = profile?.displayName ?? null
    pictureUrl = profile?.pictureUrl ?? null
  }

  if (isGroup) {
    await ensureGroupMetadata(env, groupId, null)
    await touchGroupMember(env, groupId, userId, displayName)

    if (message.type === 'text') {
      await cacheGroupMessage(env, groupId, message.id, userId, displayName, pictureUrl, message.text)
    }

    // Lazily check push-free scheduled-ish features (no cron available).
    await checkAndQueueBirthdays(env, groupId)
    await checkAndQueueGroupFortune(env, groupId)
    await checkAndQueueWeeklyRanking(env, groupId)
  }

  if (message.type !== 'text' || !replyToken) {
    // Still flush any queued broadcasts if we at least have a replyToken.
    if (replyToken && isGroup) await flushQueueOnReply(env, groupId, replyToken, [])
    return
  }

  const text: string = message.text.trim()
  const directReplies = await routeCommand(env, {
    text,
    isGroup,
    groupId,
    userId,
    displayName,
    pictureUrl,
  })

  if (isGroup) {
    await flushQueueOnReply(env, groupId, replyToken, directReplies)
  } else if (directReplies.length > 0) {
    await replyMessage(env, replyToken, directReplies)
  }
}

// Combine (a) any direct reply this command produced with (b) whatever is
// sitting in the push-free broadcast queue for this group, then send it all
// in ONE free Reply call (LINE allows up to 5 messages per reply).
//
// IMPORTANT: queued broadcasts are only marked delivered AFTER we confirm
// the reply call actually succeeded. If the reply fails (expired/invalid
// replyToken, network error, etc.) the broadcast rows stay pending and will
// be retried on the next incoming message — nothing is silently lost.
async function flushQueueOnReply(env: Bindings, groupId: string, replyToken: string, direct: LineMessage[]) {
  const { messages: queued, ids: queuedIds } = await peekBroadcasts(env, groupId)
  const combined = [...direct, ...queued].slice(0, 5)
  if (combined.length === 0) return

  const result = await replyMessage(env, replyToken, combined)
  if (result.ok) {
    await markBroadcastsDelivered(env, queuedIds)
  }
  // If it failed, direct replies are lost (nothing we can do — the
  // replyToken is already spent/invalid either way), but queued broadcasts
  // remain pending and will be included in the next reply attempt.
}

interface CommandCtx {
  text: string
  isGroup: boolean
  groupId?: string
  userId?: string
  displayName: string | null
  pictureUrl: string | null
}

async function routeCommand(env: Bindings, ctx: CommandCtx): Promise<LineMessage[]> {
  const { text } = ctx

  if (text === 'ヘルプ' || text.toLowerCase() === 'help') {
    return [{ type: 'text', text: HELP_TEXT }]
  }

  if (text === '運勢' || text === '今日の運勢') {
    if (!ctx.userId) return []
    const sign = await env.DB.prepare(`SELECT zodiac_sign FROM user_zodiac_signs WHERE user_id = ?`)
      .bind(ctx.userId)
      .first<{ zodiac_sign: string }>()
    if (!sign) {
      return [{ type: 'text', text: `星座が未登録です。「星座登録 蟹座」のように送ってください。\n(${ZODIAC_SIGNS.join('/')})` }]
    }
    const f = await getOrCreateDailyFortune(env, todayJst(), sign.zodiac_sign)
    return f ? [{ type: 'text', text: formatFortuneText(f) }] : []
  }

  const zodiacMatch = text.match(/^星座登録\s*(.+)$/)
  if (zodiacMatch && ctx.userId) {
    const sign = zodiacMatch[1].trim()
    if (!ZODIAC_SIGNS.includes(sign)) {
      return [{ type: 'text', text: `不明な星座です。次のいずれかを送ってください:\n${ZODIAC_SIGNS.join('/')}` }]
    }
    await registerZodiacSign(env, ctx.userId, sign)
    return [{ type: 'text', text: `${sign}を登録しました🔮` }]
  }

  const birthdayMatch = text.match(/^誕生日登録\s*(\d{1,2})\/(\d{1,2})$/)
  if (birthdayMatch && ctx.isGroup && ctx.groupId && ctx.userId) {
    const month = parseInt(birthdayMatch[1], 10)
    const day = parseInt(birthdayMatch[2], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      await registerBirthday(env, ctx.groupId, ctx.userId, ctx.displayName ?? '不明', month, day)
      return [{ type: 'text', text: `誕生日を${month}/${day}として登録しました🎂` }]
    }
    return [{ type: 'text', text: '日付の形式が正しくありません。例: 誕生日登録 4/1' }]
  }

  if (text === '取り消し通知オフ' && ctx.isGroup && ctx.groupId) {
    await env.DB.prepare(
      `INSERT INTO unsend_restore_settings (group_id, enabled) VALUES (?, 0)
       ON CONFLICT(group_id) DO UPDATE SET enabled = 0, updated_at = CURRENT_TIMESTAMP`
    )
      .bind(ctx.groupId)
      .run()
    return [{ type: 'text', text: '取り消し通知をオフにしました' }]
  }

  if (text === '取り消し通知オン' && ctx.isGroup && ctx.groupId) {
    await env.DB.prepare(
      `INSERT INTO unsend_restore_settings (group_id, enabled) VALUES (?, 1)
       ON CONFLICT(group_id) DO UPDATE SET enabled = 1, updated_at = CURRENT_TIMESTAMP`
    )
      .bind(ctx.groupId)
      .run()
    return [{ type: 'text', text: '取り消し通知をオンにしました' }]
  }

  if (text === 'ウェルカムオフ' && ctx.isGroup && ctx.groupId) {
    await setWelcomeSetting(env, ctx.groupId, false)
    return [{ type: 'text', text: 'ウェルカムメッセージをオフにしました' }]
  }
  if (text === 'ウェルカムオン' && ctx.isGroup && ctx.groupId) {
    await setWelcomeSetting(env, ctx.groupId, true)
    return [{ type: 'text', text: 'ウェルカムメッセージをオンにしました' }]
  }
  const welcomeMsgMatch = text.match(/^ウェルカムメッセージ設定\s*(.+)$/s)
  if (welcomeMsgMatch && ctx.isGroup && ctx.groupId) {
    await setWelcomeSetting(env, ctx.groupId, true, welcomeMsgMatch[1].trim())
    return [{ type: 'text', text: 'ウェルカムメッセージを設定しました' }]
  }

  const quoteMatch = text.match(/^名言[:：]\s*(.+)$/s)
  if (quoteMatch && ctx.isGroup && ctx.groupId && ctx.userId) {
    const quoteText = quoteMatch[1].trim()
    await saveQuote(env, ctx.groupId, ctx.userId, ctx.displayName ?? '不明', ctx.pictureUrl, quoteText)
    return [buildQuoteFlexMessage(quoteText, ctx.displayName ?? '不明', ctx.pictureUrl)]
  }

  const tagAddMatch = text.match(/^タグ追加\s*(.+)$/)
  if (tagAddMatch && ctx.isGroup && ctx.groupId) {
    await addTagToGroup(env, ctx.groupId, tagAddMatch[1].trim())
    return [{ type: 'text', text: `タグ「${tagAddMatch[1].trim()}」を追加しました` }]
  }
  const tagRemoveMatch = text.match(/^タグ削除\s*(.+)$/)
  if (tagRemoveMatch && ctx.isGroup && ctx.groupId) {
    await removeTagFromGroup(env, ctx.groupId, tagRemoveMatch[1].trim())
    return [{ type: 'text', text: `タグ「${tagRemoveMatch[1].trim()}」を削除しました` }]
  }
  if (text === 'タグ一覧' && ctx.isGroup && ctx.groupId) {
    const tags = await listGroupTags(env, ctx.groupId)
    return [{ type: 'text', text: tags.length > 0 ? `タグ: ${tags.join('、')}` : 'タグは設定されていません' }]
  }

  if (text === '称号一覧' && ctx.isGroup && ctx.groupId && ctx.userId) {
    const titles = await listUserTitles(env, ctx.userId, ctx.groupId)
    if (titles.length === 0) return [{ type: 'text', text: '所持している称号はありません' }]
    const equipped = await getEquippedTitle(env, ctx.userId, ctx.groupId)
    const lines = titles.map((t) => (t === equipped ? `★${t}（装備中）` : `・${t}`))
    return [{ type: 'text', text: `🏆 所持称号一覧\n${lines.join('\n')}` }]
  }

  const equipMatch = text.match(/^称号装備\s*(.+)$/)
  if (equipMatch && ctx.isGroup && ctx.groupId && ctx.userId) {
    const titleName = equipMatch[1].trim()
    const owned = await listUserTitles(env, ctx.userId, ctx.groupId)
    if (!owned.includes(titleName)) {
      return [{ type: 'text', text: `「${titleName}」は所持していません` }]
    }
    await equipTitle(env, ctx.userId, ctx.groupId, titleName)
    return [{ type: 'text', text: `称号「${titleName}」を装備しました🏆` }]
  }

  if (text === '称号確認' && ctx.isGroup && ctx.groupId && ctx.userId) {
    const equipped = await getEquippedTitle(env, ctx.userId, ctx.groupId)
    return [{ type: 'text', text: equipped ? `装備中の称号: 🏆${equipped}` : '称号は装備していません' }]
  }

  return []
}

const HELP_TEXT = `🍡 葉っぱもち Bot ヘルプ

【基本】
ヘルプ - このメッセージを表示

【占い】
星座登録 [星座名] - 星座を登録
運勢 - 今日の運勢を確認

【誕生日】
誕生日登録 [月]/[日] - 誕生日を登録(自動でお祝い通知)

【取り消し通知】
メッセージが削除されると自動で通知(取り消し通知オフ/オンで切替)

【ウェルカム】
ウェルカムオン/オフ - 新メンバー歓迎メッセージの切替
ウェルカムメッセージ設定 [本文] - カスタム歓迎文を設定

【名言カード】
名言:[テキスト] - 名言カードを生成

【タグ】
タグ追加/削除/一覧 [タグ名]

【称号】
称号一覧 - 所持している称号を確認
称号装備 [称号名] - 称号を装備
称号確認 - 現在装備中の称号を確認`

export default app
