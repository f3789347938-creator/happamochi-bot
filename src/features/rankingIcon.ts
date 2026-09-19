import type { LineEnv, LineMessage } from '../lib/line'
import type { ProfileCtx } from './profile'
import { ensureProfile } from './profile/core'
import { costumeIconUrl } from './dressup/art'
import { COSMETICS, DEFAULT_COSTUME, getCosmetic, type Cosmetic } from './dressup/catalog'
import { listOwnedCosmeticIds } from './dressup/store'

/** null follows the current LINE picture, independently of the status costume. */
export interface RankingIcon { costumeId: string | null }
type IconResult = { ok: true } | { ok: false; reason: 'invalid_item' | 'not_owned' | 'unknown_user' }
const PER_PAGE = 6

function normalizeIcon(id?: string | null): RankingIcon {
  const item = id ? getCosmetic(id) : undefined
  return { costumeId: item?.kind === 'costume' ? item.id : null }
}

// Verify ownership when reading too, so removed inventory never leaves an
// unavailable costume visible. All request values use bound SQL parameters.
const ICON_JOINS = `LEFT JOIN ranking_icons r ON r.user_id = p.user_id
  LEFT JOIN dressup_catalog c ON c.item_id = r.costume_id AND c.kind = 'costume'
  LEFT JOIN dressup_inventory i ON i.user_id = p.user_id AND i.item_id = c.item_id`
const ICON_VALUE = `CASE WHEN c.is_default = 1 OR i.item_id IS NOT NULL THEN c.item_id ELSE NULL END`

async function resolveIcons(
  env: LineEnv, requestedIds: string[], key: 'public_id' | 'user_id'
): Promise<Record<string, RankingIcon>> {
  const ids = [...new Set(requestedIds)]
  const icons: Record<string, RankingIcon> = Object.create(null)
  for (const id of ids) icons[id] = { costumeId: null }
  try {
    for (let offset = 0; offset < ids.length; offset += 75) {
      const chunk = ids.slice(offset, offset + 75)
      const { results } = await env.DB.prepare(
        `SELECT p.${key} AS identity, ${ICON_VALUE} AS costume_id
         FROM user_profiles p ${ICON_JOINS}
         WHERE p.${key} IN (${chunk.map(() => '?').join(',')})`
      ).bind(...chunk).all<{ identity: string; costume_id: string | null }>()
      for (const row of results ?? []) icons[row.identity] = normalizeIcon(row.costume_id)
    }
  } catch (error) {
    // The additive schema can land after code in a rolling deployment. Only
    // missing cosmetic tables fall back; unrelated database errors propagate.
    if (!/no such table: (?:ranking_icons|dressup_catalog|dressup_inventory)\b/i.test(String(error))) throw error
  }
  return icons
}

/** Public page/card lookup never returns private LINE user IDs. */
export async function getRankingIconsByPublicIds(env: LineEnv, publicIds: string[]): Promise<Record<string, RankingIcon>> {
  return resolveIcons(env, publicIds, 'public_id')
}

/** Internal lookup for game score rows. Do not serialize these keys publicly. */
export async function getRankingIconsByUserIds(env: LineEnv, userIds: string[]): Promise<Record<string, RankingIcon>> {
  return resolveIcons(env, userIds, 'user_id')
}

export async function getRankingIcon(env: LineEnv, userId: string): Promise<RankingIcon> {
  return (await getRankingIconsByUserIds(env, [userId]))[userId]
}

export function rankingIconUrl(baseUrl: string, icon?: RankingIcon | null, pictureUrl?: string | null): string {
  const normalized = normalizeIcon(icon?.costumeId)
  if (normalized.costumeId) return costumeIconUrl(baseUrl, normalized.costumeId)
  if (typeof pictureUrl === 'string' && pictureUrl.length <= 1000) {
    try {
      const url = new URL(pictureUrl)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href
    } catch { /* A missing or invalid LINE picture uses the neutral mascot. */ }
  }
  return new URL(DEFAULT_COSTUME.imagePath, baseUrl).href
}

export async function setRankingIcon(env: LineEnv, userId: string, costumeId: string | null): Promise<IconResult> {
  const item = costumeId === null ? null : getCosmetic(costumeId)
  if (costumeId !== null && item?.kind !== 'costume') return { ok: false, reason: 'invalid_item' }
  // Selection and ownership check are one atomic statement. A gacha draw or
  // status wardrobe change never writes this table or rewrites picture_url.
  const result = await env.DB.prepare(
    `INSERT INTO ranking_icons (user_id, costume_id)
     SELECT p.user_id, ? FROM user_profiles p WHERE p.user_id = ?
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM dressup_catalog c WHERE c.item_id = ? AND c.kind = 'costume'
           AND (c.is_default = 1 OR EXISTS (SELECT 1 FROM dressup_inventory i
             WHERE i.user_id = p.user_id AND i.item_id = c.item_id))))
     ON CONFLICT(user_id) DO UPDATE SET costume_id = excluded.costume_id, updated_at = CURRENT_TIMESTAMP`
  ).bind(costumeId, userId, costumeId, costumeId).run()
  if (result.meta.changes > 0) return { ok: true }
  const profile = await env.DB.prepare('SELECT user_id FROM user_profiles WHERE user_id = ?').bind(userId).first()
  return { ok: false, reason: profile ? 'not_owned' : 'unknown_user' }
}

const textMessage = (text: string): LineMessage => ({ type: 'text', text })
const label = (text: string, options: Record<string, unknown> = {}) => ({
  type: 'text', text, size: 'sm', color: '#17364C', wrap: true, ...options,
})
const button = (label: string, data: string, primary = false) => ({
  type: 'button', height: 'sm', style: primary ? 'primary' : 'secondary',
  ...(primary ? { color: '#009FDE' } : {}), action: { type: 'postback', label, data },
})
function iconImage(baseUrl: string, icon: RankingIcon, pictureUrl?: string | null) {
  return { type: 'image', url: rankingIconUrl(baseUrl, icon, pictureUrl), size: 'lg', aspectRatio: '1:1', aspectMode: icon.costumeId ? 'fit' : 'cover', align: 'center' }
}
function bubble(title: string, contents: Record<string, unknown>[]) {
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#009FDE', paddingAll: 'md', contents: [label(title, { weight: 'bold', color: '#FFFFFF', align: 'center', size: 'lg' })] },
    body: { type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'md', backgroundColor: '#E4F7FF', contents },
  }
}

/** Settings home stays compact; collection item cards keep their larger preview. */
function settingsCard(baseUrl: string, icon: RankingIcon, pictureUrl: string | null, count: number): LineMessage {
  const blue = '#009FDE'
  const pale = '#E4F7FF'
  const text = (value: string, size: string, options: Record<string, unknown> = {}) => ({
    type: 'text', text: value, size, color: '#17364C',
    wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit', ...options,
  })
  const action = (label: string, data: string, primary = false, margin = '4px') => ({
    type: 'box', layout: 'vertical', height: '32px', flex: 0, margin,
    cornerRadius: '7px', borderWidth: '1px', borderColor: blue,
    backgroundColor: primary ? blue : '#FFFFFF', justifyContent: 'center',
    paddingStart: '6px', paddingEnd: '6px', action: { type: 'postback', data },
    contents: [text(label, '13px', { align: 'center', color: primary ? '#FFFFFF' : '#17364C', weight: primary ? 'bold' : 'regular' })],
  })
  const currentName = icon.costumeId ? getCosmetic(icon.costumeId)!.name : 'LINEプロフィール画像'
  return {
    type: 'flex', altText: `ランキングアイコン設定：${currentName}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', height: '36px', paddingAll: '0px',
        paddingStart: '8px', paddingEnd: '8px', backgroundColor: blue, justifyContent: 'center',
        contents: [text('ランキングアイコン設定', '16px', { weight: 'bold', color: '#FFFFFF', align: 'center' })],
      },
      body: {
        type: 'box', layout: 'vertical', height: '210px', paddingAll: '10px', backgroundColor: pale,
        contents: [
          {
            type: 'box', layout: 'horizontal', height: '56px', flex: 0, spacing: '8px', alignItems: 'center',
            contents: [
              {
                type: 'box', layout: 'vertical', width: '56px', height: '56px', flex: 0,
                cornerRadius: '7px', backgroundColor: '#FFFFFF',
                contents: [{ ...iconImage(baseUrl, icon, pictureUrl), size: 'full' }],
              },
              {
                type: 'box', layout: 'vertical', flex: 1, justifyContent: 'center',
                contents: [
                  text(icon.costumeId ? '使用中' : '使用中・デフォルト', '10px', { color: '#55788A' }),
                  text(currentName, '13px', { weight: 'bold', margin: '3px' }),
                  text('変更無料・衣装とは別設定', '10px', { color: '#55788A', margin: '3px' }),
                ],
              },
            ],
          },
          {
            type: 'box', layout: 'vertical', height: '16px', flex: 0, margin: '6px', justifyContent: 'center',
            contents: [text('ガチャで入手した衣装もアイコンに。', '10px', { color: '#55788A', align: 'center' })],
          },
          action(`所持アイコンを選ぶ (${count}/120)`, 'pf|rankicon|list|1', true, '8px'),
          action('LINEプロフィール画像に戻す', 'pf|rankicon|line'),
          action('ガチャでアイコンを増やす', 'pf|dress|gacha'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', height: '20px', paddingAll: '0px', backgroundColor: blue, justifyContent: 'center',
        contents: [text('© 2026 HappaMochi Bot', '10px', { color: '#FFFFFF', align: 'center' })],
      },
    },
  }
}

export async function getRankingIconSettings(env: LineEnv, ctx: ProfileCtx): Promise<LineMessage> {
  if (!ctx.userId) return textMessage('LINEのユーザー情報を確認できませんでした。')
  const profile = await ensureProfile(env, ctx.userId, ctx.displayName, ctx.pictureUrl)
  const [icon, ownedIds] = await Promise.all([getRankingIcon(env, ctx.userId), listOwnedCosmeticIds(env, ctx.userId)])
  const count = COSMETICS.filter(item => item.kind === 'costume' && ownedIds.includes(item.id)).length
  return settingsCard(ctx.baseUrl, icon, profile.picture_url, count)
}

async function iconList(env: LineEnv, ctx: ProfileCtx, requestedPage: number): Promise<LineMessage> {
  await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const [icon, ids] = await Promise.all([getRankingIcon(env, ctx.userId!), listOwnedCosmeticIds(env, ctx.userId!)])
  const items: Cosmetic[] = [DEFAULT_COSTUME, ...COSMETICS.filter(item => item.kind === 'costume' && ids.includes(item.id))]
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE))
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  const contents = items.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(item => bubble('ランキングアイコン', [
    iconImage(ctx.baseUrl, { costumeId: item.id }),
    label(item.name, { size: 'lg', weight: 'bold', align: 'center' }),
    label(icon.costumeId === item.id ? '使用中' : item.id === DEFAULT_COSTUME.id ? '初期アイコン・無料' : 'ガチャで入手済み', { align: 'center', color: '#55788A' }),
    button(icon.costumeId === item.id ? 'このアイコンを使用中' : 'このアイコンにする', `pf|rankicon|set|${item.id}`, true),
  ]))
  const navigation: Record<string, unknown>[] = [label(`${page} / ${pages} ページ`, { weight: 'bold', align: 'center' })]
  if (page > 1) navigation.push(button('前のページ', `pf|rankicon|list|${page - 1}`))
  if (page < pages) navigation.push(button('次のページ', `pf|rankicon|list|${page + 1}`, true))
  navigation.push(button('ガチャで増やす', 'pf|dress|gacha'), button('アイコン設定に戻る', 'pf|rankicon|home'))
  contents.push(bubble('アイコン一覧・ページ操作', navigation))
  return { type: 'flex', altText: `所持ランキングアイコン（${page}/${pages}ページ）`, contents: { type: 'carousel', contents } }
}

async function selectIcon(env: LineEnv, ctx: ProfileCtx, costumeId: string | null): Promise<LineMessage[]> {
  await ensureProfile(env, ctx.userId!, ctx.displayName, ctx.pictureUrl)
  const result = await setRankingIcon(env, ctx.userId!, costumeId)
  if (!result.ok) {
    const messages = {
      invalid_item: 'そのランキングアイコンは見つかりませんでした。',
      not_owned: 'まだ持っていないアイコンです。ガチャで入手してから設定してください。',
      unknown_user: 'プロフィールを確認できませんでした。「ステータス」を開いてからお試しください。',
    }
    return [textMessage(messages[result.reason])]
  }
  return [textMessage(costumeId ? `ランキングアイコンを「${getCosmetic(costumeId)!.name}」に変更しました。` : 'ランキングアイコンをLINEのプロフィール画像に戻しました。'), await getRankingIconSettings(env, ctx)]
}

export async function handleRankingIconText(env: LineEnv, ctx: ProfileCtx, raw: string): Promise<LineMessage[] | null> {
  if (!ctx.userId) return null
  const value = raw.trim()
  if (['ランキングアイコン', 'アイコン設定', 'ランキングアイコン設定'].includes(value)) return [await getRankingIconSettings(env, ctx)]
  return null
}

export async function handleRankingIconPostback(env: LineEnv, ctx: ProfileCtx, data: string): Promise<LineMessage[] | null> {
  if (!ctx.userId || !data.startsWith('pf|rankicon|')) return null
  const parts = data.split('|')
  if (parts[2] === 'home') return [await getRankingIconSettings(env, ctx)]
  if (parts[2] === 'list') return [await iconList(env, ctx, Number(parts[3]))]
  if (parts[2] === 'line') return selectIcon(env, ctx, null)
  if (parts[2] === 'set') return selectIcon(env, ctx, parts[3] ?? '')
  return [textMessage('この操作は使えません。「ランキングアイコン」から設定を開き直してください。')]
}
