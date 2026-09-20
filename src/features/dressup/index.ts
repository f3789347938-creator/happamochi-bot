import type { LineEnv, LineMessage } from '../../lib/line'
import { getProfile } from '../../lib/line'
import type { ProfileCtx } from '../profile'
import { ensureProfile } from '../profile/core'
import { handleRankingIconPostback, handleRankingIconText } from '../rankingIcon'
import { COSMETICS, DEFAULT_BACKGROUND, DEFAULT_COSTUME, getCosmetic } from './catalog'
import {
  cancelGacha, createGachaConfirmation, drawGacha, equipCosmetic,
  getAppearance, listOwnedCosmeticIds,
} from './store'
import {
  buildCosmeticPreview, buildGachaConfirmation, buildGachaResult, buildWardrobeCard,
  buildWardrobeList, COSMETICS_PER_PAGE, type WardrobeFilter, type WardrobeKind,
} from './flex'

const text = (value: string): LineMessage => ({ type: 'text', text: value })

const FAILURE_MESSAGES: Record<string, string> = {
  invalid_confirmation: '確認画面が無効です。「ガチャ」から新しい確認画面を開いてください。',
  not_owner: 'この確認画面は別の方のものです。「ガチャ」と送って、ご自身の確認画面を開いてください。',
  expired: '確認画面の有効期限が切れました。「ガチャ」からもう一度開いてください。',
  canceled: 'この確認はキャンセル済みです。「ガチャ」から新しい確認画面を開いてください。',
  already_used: 'このガチャは処理済みです。ポイントを二重に消費することはありません。',
  insufficient_points: 'ポイントが足りないため、ガチャを実行できませんでした。',
  collection_complete: '衣装120種類・背景30種類をすべて入手済みです！ポイントは消費されません。',
  unknown_user: 'プロフィールを確認できませんでした。「ステータス」を開いてからお試しください。',
  invalid_item: 'その衣装・背景は見つかりませんでした。',
  not_owned: 'まだ持っていないアイテムです。ガチャで入手してから装備してください。',
}

function failure(reason?: string): LineMessage {
  return text(FAILURE_MESSAGES[reason ?? ''] ?? '処理を完了できませんでした。着せ替え画面から状態をご確認ください。')
}

async function confirmationFailure(env: LineEnv, ctx: ProfileCtx, reason?: string): Promise<LineMessage> {
  if (reason !== 'not_owner' || !ctx.userId) return failure(reason)
  // The actor comes from the webhook source, never from the confirmation owner.
  let name = ctx.displayName?.trim()
  if (!name) {
    const profile = await getProfile(env, ctx.userId, ctx.groupId).catch(() => null)
    name = profile?.displayName?.trim()
  }
  if (!name) {
    const saved = await env.DB.prepare('SELECT display_name FROM user_profiles WHERE user_id = ?')
      .bind(ctx.userId).first<{ display_name: string | null }>().catch(() => null)
    name = saved?.display_name?.trim()
  }
  const addressee = name ? `${name.replace(/\s+/gu, ' ')}さんへ` : 'ボタンを押した方へ'
  return text(`${addressee}\n${FAILURE_MESSAGES.not_owner}`)
}

async function wardrobe(env: LineEnv, ctx: ProfileCtx): Promise<LineMessage> {
  const profile = await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const [appearance, owned] = await Promise.all([
    getAppearance(env, ctx.userId!), listOwnedCosmeticIds(env, ctx.userId!),
  ])
  return buildWardrobeCard({ baseUrl: ctx.baseUrl, appearance, ownedIds: new Set(owned), points: profile.points })
}

async function confirmation(env: LineEnv, ctx: ProfileCtx): Promise<LineMessage> {
  const profile = await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const owned = new Set(await listOwnedCosmeticIds(env, ctx.userId!))
  const remaining = COSMETICS.filter((item) => !owned.has(item.id)).length
  if (!remaining) return failure('collection_complete')
  const { token } = await createGachaConfirmation(env, ctx.userId!)
  return buildGachaConfirmation({ baseUrl: ctx.baseUrl, points: profile.points, token, remaining })
}

async function list(
  env: LineEnv, ctx: ProfileCtx, kind: WardrobeKind, filter: WardrobeFilter, requestedPage: number
): Promise<LineMessage> {
  await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const [appearance, ownedIds] = await Promise.all([
    getAppearance(env, ctx.userId!), listOwnedCosmeticIds(env, ctx.userId!),
  ])
  const owned = new Set(ownedIds)
  const initial = kind === 'costume' ? DEFAULT_COSTUME : DEFAULT_BACKGROUND
  const all = [initial, ...COSMETICS.filter((item) => item.kind === kind)]
  const filtered = filter === 'owned' ? all.filter((item) => owned.has(item.id)) : all
  const pageCount = Math.max(1, Math.ceil(filtered.length / COSMETICS_PER_PAGE))
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  return buildWardrobeList({
    baseUrl: ctx.baseUrl, appearance, kind, filter, ownedIds: owned, page, pageCount,
    total: filtered.length,
    items: filtered.slice((page - 1) * COSMETICS_PER_PAGE, page * COSMETICS_PER_PAGE),
  })
}

async function equip(env: LineEnv, ctx: ProfileCtx, itemId: string): Promise<LineMessage[]> {
  await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const result = await equipCosmetic(env, ctx.userId!, itemId)
  if (!result.ok) return [failure(result.reason)]
  return [text(`「${getCosmetic(itemId)?.name ?? itemId}」を装備しました。ステータスに反映されます。ランキングの画像は「ランキングアイコン」で設定できます。`), await wardrobe(env, ctx)]
}

export async function handleDressupText(
  env: LineEnv, ctx: ProfileCtx, raw: string
): Promise<LineMessage[] | null> {
  if (!ctx.userId) return null
  const rankingIcon = await handleRankingIconText(env, ctx, raw)
  if (rankingIcon) return rankingIcon
  const value = raw.trim()
  if (value === '着せ替え' || value === 'きせかえ') return [await wardrobe(env, ctx)]
  if (['ガチャ', '着せ替えガチャ', 'きせかえガチャ'].includes(value)) return [await confirmation(env, ctx)]
  if (value === '衣装一覧') return [await list(env, ctx, 'costume', 'all', 1)]
  if (value === '背景一覧') return [await list(env, ctx, 'background', 'all', 1)]
  const command = value.match(/^(衣装装備|背景装備)[ 　]+(.+)$/s)
  if (command) {
    const kind = command[1] === '衣装装備' ? 'costume' : 'background'
    const query = command[2].trim()
    const item = getCosmetic(query.toUpperCase()) ?? [DEFAULT_COSTUME, DEFAULT_BACKGROUND, ...COSMETICS].find((candidate) => candidate.name === query)
    if (!item || item.kind !== kind) return [failure('invalid_item')]
    return equip(env, ctx, item.id)
  }
  return null
}

export async function handleDressupPostback(
  env: LineEnv, ctx: ProfileCtx, data: string
): Promise<LineMessage[] | null> {
  if (!ctx.userId) return null
  const rankingIcon = await handleRankingIconPostback(env, ctx, data)
  if (rankingIcon) return rankingIcon
  if (!data.startsWith('pf|dress|')) return null
  const parts = data.split('|')
  const op = parts[2]
  if (op === 'home') return [await wardrobe(env, ctx)]
  // Old cards must not open confirmations silently. New buttons send the ガチャ message.
  if (op === 'gacha') return []
  if (op === 'list') {
    const kind: WardrobeKind = parts[3] === 'background' ? 'background' : 'costume'
    const filter: WardrobeFilter = parts[4] === 'owned' ? 'owned' : 'all'
    return [await list(env, ctx, kind, filter, Number(parts[5]))]
  }
  if (op === 'preview') {
    const item = getCosmetic(parts[3] ?? '')
    if (!item) return [failure('invalid_item')]
    await ensureProfile(env, ctx.userId, ctx.displayName, ctx.pictureUrl)
    const [appearance, ownedIds] = await Promise.all([getAppearance(env, ctx.userId), listOwnedCosmeticIds(env, ctx.userId)])
    return [buildCosmeticPreview({ baseUrl: ctx.baseUrl, item, appearance, owned: ownedIds.includes(item.id) })]
  }
  if (op === 'equip') return equip(env, ctx, parts[3] ?? '')
  if (op === 'cancel') {
    const result = await cancelGacha(env, ctx.userId, parts[3] ?? '')
    if (!result.ok) return [await confirmationFailure(env, ctx, result.reason)]
    return [text('ガチャをキャンセルしました。ポイントは消費していません。'), await wardrobe(env, ctx)]
  }
  if (op === 'draw') {
    const result = await drawGacha(env, ctx.userId, parts[3] ?? '')
    if (!result.ok) return [await confirmationFailure(env, ctx, result.reason)]
    const item = getCosmetic(result.itemId)
    if (!item) return [text('アイテムを入手しました。「着せ替え」でコレクションをご確認ください。')]
    return [buildGachaResult({ baseUrl: ctx.baseUrl, item, balance: result.balance, spent: result.spent })]
  }
  return [text('この操作は使えません。「着せ替え」から画面を開き直してください。')]
}
