// LINE内で完結する、着せ替え・ガチャ・図鑑のFlexカード。
// 画像は公開アセットのみ。ユーザーIDや残高をURL/Postbackに含めない。
import type { LineMessage } from '../../lib/line'
import { appearanceUrl, cosmeticImageUrl } from './art'
import { COSMETICS, getCosmetic, type Cosmetic } from './catalog'
import { GACHA_CONFIRMATION_SECONDS, GACHA_COST } from './store'

export interface AppearanceInput { costumeId: string; backgroundId: string }
export type WardrobeKind = 'costume' | 'background'
export type WardrobeFilter = 'all' | 'owned'
export const COSMETICS_PER_PAGE = 6

const BLUE = '#009FDE'
const PALE = '#E4F7FF'
const INK = '#17364C'
const MUTED = '#55788A'
const FOOTER = '© 2026 HappaMochi Bot'
const number = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('ja-JP')

function text(value: string, options: Record<string, any> = {}): Record<string, any> {
  return { type: 'text', text: value, size: 'sm', color: INK, wrap: true, ...options }
}

const messageAction = (text: string) => ({ type: 'message' as const, text })
type ActionTarget = string | ReturnType<typeof messageAction>

function action(label: string, data: ActionTarget, primary = false): Record<string, any> {
  return {
    type: 'button', height: 'sm', style: primary ? 'primary' : 'secondary',
    ...(primary ? { color: BLUE } : {}),
    action: typeof data === 'string' ? { type: 'postback', label, data } : { ...data, label },
  }
}

function row(contents: Record<string, any>[]): Record<string, any> {
  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents }
}

function panel(contents: Record<string, any>[]): Record<string, any> {
  return {
    type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'md',
    backgroundColor: '#FFFFFF', borderColor: '#A8DFF2', borderWidth: '1px',
    cornerRadius: 'md', contents,
  }
}

function bubble(title: string, contents: Record<string, any>[]): Record<string, any> {
  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: BLUE, paddingAll: 'md',
      contents: [text(title, { color: '#FFFFFF', size: 'lg', weight: 'bold', align: 'center' })],
    },
    body: { type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'md', backgroundColor: PALE, contents },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: 'sm', backgroundColor: BLUE,
      contents: [text(FOOTER, { color: '#FFFFFF', size: 'xxs', align: 'center' })],
    },
  }
}

function flex(altText: string, contents: Record<string, any>): LineMessage {
  return { type: 'flex', altText, contents }
}

function artwork(baseUrl: string, appearance: AppearanceInput): Record<string, any> {
  return {
    type: 'image', url: appearanceUrl(baseUrl, appearance), size: 'full',
    aspectRatio: '3:2', aspectMode: 'cover',
  }
}

function ownedCount(ids: Set<string>, kind: WardrobeKind): number {
  return COSMETICS.filter((item) => item.kind === kind && ids.has(item.id)).length
}

export function buildWardrobeCard(input: {
  baseUrl: string; appearance: AppearanceInput; ownedIds: Set<string>; points: number
}): LineMessage {
  const costume = getCosmetic(input.appearance.costumeId)
  const background = getCosmetic(input.appearance.backgroundId)
  const line = (value: string, options: Record<string, any> = {}) => text(value, {
    size: '13px', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit', ...options,
  })
  const compactAction = (label: string, data: ActionTarget, primary = false) => ({
    type: 'box', layout: 'vertical', height: '32px', flex: 1,
    justifyContent: 'center', cornerRadius: '6px', paddingStart: '4px', paddingEnd: '4px',
    backgroundColor: primary ? BLUE : '#FFFFFF', borderColor: '#A8DFF2', borderWidth: '1px',
    action: typeof data === 'string' ? { type: 'postback', data } : data,
    contents: [line(label, { align: 'center', color: primary ? '#FFFFFF' : INK, weight: primary ? 'bold' : 'regular' })],
  })
  const controls = (contents: Record<string, any>[]) => ({
    type: 'box', layout: 'horizontal', height: '32px', flex: 0, margin: '6px', spacing: '6px', contents,
  })
  return flex('着せ替え：衣装・背景の変更ときせかえガチャ', {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', height: '36px', paddingAll: '6px',
      backgroundColor: BLUE, justifyContent: 'center',
      contents: [line('もちの着せ替え', { size: '17px', weight: 'bold', color: '#FFFFFF', align: 'center' })],
    },
    body: {
      type: 'box', layout: 'vertical', height: '270px', paddingAll: '8px', backgroundColor: PALE,
      contents: [
        {
          type: 'box', layout: 'horizontal', height: '84px', flex: 0, paddingAll: '8px', spacing: '8px',
          alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#A8DFF2', borderWidth: '1px', cornerRadius: '6px',
          contents: [
            {
              type: 'box', layout: 'vertical', width: '90px', height: '60px', flex: 0, cornerRadius: '4px',
              contents: [artwork(input.baseUrl, input.appearance)],
            },
            {
              type: 'box', layout: 'vertical', flex: 1, spacing: '5px', justifyContent: 'center',
              contents: [
                line(`衣装：${costume?.name ?? 'いつものもち'}`, { weight: 'bold' }),
                line(`背景：${background?.name ?? 'いつもの背景'}`, { size: '12px' }),
                line(`${number(input.points)} P`, { color: MUTED, size: '13px' }),
              ],
            },
          ],
        },
        controls([
          compactAction(`衣装 ${ownedCount(input.ownedIds, 'costume')}/120`, 'pf|dress|list|costume|owned|1'),
          compactAction(`背景 ${ownedCount(input.ownedIds, 'background')}/30`, 'pf|dress|list|background|owned|1'),
        ]),
        controls([compactAction(`きせかえガチャ ${number(GACHA_COST)} P`, messageAction('ガチャ'), true)]),
        {
          type: 'box', layout: 'vertical', height: '14px', flex: 0, margin: '4px', justifyContent: 'center',
          contents: [line('未所持から1点・重複なし', { size: '11px', color: MUTED, align: 'center' })],
        },
        controls([compactAction('ランキングアイコン設定', 'pf|rankicon|home')]),
        controls([compactAction('カードテーマ', 'pf|themes'), compactAction('ステータス', 'pf|status')]),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', height: '20px', paddingAll: '0px', backgroundColor: BLUE, justifyContent: 'center',
      contents: [line(FOOTER, { size: '10px', color: '#FFFFFF', align: 'center' })],
    },
  })
}

export function buildGachaConfirmation(input: {
  baseUrl: string; points: number; token: string; remaining: number
}): LineMessage {
  const enough = input.points >= GACHA_COST
  const remaining = Math.max(0, Math.floor(input.remaining))
  const odds = remaining > 0 ? `${(100 / remaining).toFixed(4).replace(/\.?0+$/, '')}%` : '0%'
  const content: Record<string, any>[] = [
    panel([
      {
        type: 'image', url: `${input.baseUrl.replace(/\/$/, '')}/static/dressup/gacha-preview.png`,
        size: 'full', aspectRatio: '3:2', aspectMode: 'fit',
      },
      text(`${number(GACHA_COST)}ポイント使って、きせかえガチャを1回まわす？`, { size: 'lg', weight: 'bold', align: 'center' }),
      { type: 'separator', color: '#CCE7F0' },
      text(`いま持っているポイント：${number(input.points)}`, { align: 'center', color: MUTED }),
      text(`現在、未所持${remaining}点（各${odds}）。実行時の未所持アイテムから均等抽選。重複なし。`, { size: 'xxs', color: MUTED }),
      text(`この確認を開いた方のみ有効です。有効期限は${GACHA_CONFIRMATION_SECONDS / 60}分。Yesを押すまでポイントは減りません。`, { size: 'xxs', color: MUTED }),
    ]),
  ]
  if (enough && remaining > 0) {
    content.push(row([
      action('Yes', `pf|dress|draw|${input.token}`, true),
      action('No', `pf|dress|cancel|${input.token}`),
    ]))
  } else {
    content.push(text(remaining === 0 ? 'すべての衣装・背景を入手済みです！' : `あと${number(GACHA_COST - input.points)}ポイント必要です。`, { weight: 'bold', align: 'center' }))
    content.push(action('戻る', `pf|dress|cancel|${input.token}`))
  }
  return flex('きせかえガチャの確認（まだポイントは消費されません）', bubble('きせかえガチャ', content))
}

export function buildGachaResult(input: {
  baseUrl: string; item: Cosmetic; balance: number; spent: number
}): LineMessage {
  return flex(`ガチャで「${input.item.name}」を入手しました！`, bubble('NEW！ 新しい着せ替え', [
    panel([
      { type: 'image', url: cosmeticImageUrl(input.baseUrl, input.item.id), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' },
      text(input.item.name, { size: 'xl', weight: 'bold', align: 'center' }),
      text(`${input.item.kind === 'costume' ? '衣装' : '背景'} / ${input.item.category}`, { align: 'center', color: MUTED }),
      text(`消費 ${number(input.spent)} P ／ 残高 ${number(input.balance)} P`, { size: 'xs', align: 'center' }),
      text('コレクションに追加しました。衣装・ランキングアイコンは自分で設定できます。', { size: 'xxs', color: MUTED, align: 'center' }),
    ]),
    action('さっそく着せ替える', `pf|dress|equip|${input.item.id}`, true),
    ...(input.item.kind === 'costume' ? [action('ランキングアイコンにする', `pf|rankicon|set|${input.item.id}`)] : []),
    row([action('もう一度（確認へ）', messageAction('ガチャ')), action('着せ替えに戻る', 'pf|dress|home')]),
  ]))
}

export function buildCosmeticPreview(input: {
  baseUrl: string; item: Cosmetic; appearance: AppearanceInput; owned: boolean
}): LineMessage {
  const appearance = {
    ...input.appearance,
    ...(input.item.kind === 'costume' ? { costumeId: input.item.id } : { backgroundId: input.item.id }),
  }
  return flex(`「${input.item.name}」の試着プレビュー（未反映）`, bubble('試着プレビュー', [
    panel([
      artwork(input.baseUrl, appearance),
      text(input.item.name, { size: 'lg', weight: 'bold', align: 'center' }),
      text('プレビューです。装備・ポイントは変更していません。', { size: 'xs', color: MUTED, align: 'center' }),
      text(input.owned ? '「これを装備する」でステータスに反映されます。ランキングアイコンは設定で変更できます。' : '未所持のアイテムです。ガチャで入手すると装備できます。', { size: 'xs', color: MUTED }),
    ]),
    input.owned ? action('これを装備する', `pf|dress|equip|${input.item.id}`, true) : action('ガチャの確認へ', messageAction('ガチャ'), true),
    row([
      action('一覧に戻る', `pf|dress|list|${input.item.kind}|all|1`),
      action('着せ替えに戻る', 'pf|dress|home'),
    ]),
  ]))
}

export function buildWardrobeList(input: {
  baseUrl: string; kind: WardrobeKind; filter: WardrobeFilter; items: Cosmetic[];
  appearance: AppearanceInput; ownedIds: Set<string>; page: number; pageCount: number; total: number
}): LineMessage {
  const title = input.kind === 'costume' ? '衣装一覧' : '背景一覧'
  const activeId = input.kind === 'costume' ? input.appearance.costumeId : input.appearance.backgroundId
  const pages = Math.max(1, Math.floor(input.pageCount) || 1)
  const page = Math.min(pages, Math.max(1, Math.floor(input.page) || 1))
  const bubbles = input.items.slice(0, COSMETICS_PER_PAGE).map((item) => {
    const owned = input.ownedIds.has(item.id)
    const active = item.id === activeId
    return bubble(title, [
      panel([
        { type: 'image', url: cosmeticImageUrl(input.baseUrl, item.id), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' },
        text(item.name, { size: 'lg', weight: 'bold', align: 'center' }),
        text(`${item.id} · ${item.category}`, { size: 'xs', color: MUTED, align: 'center' }),
        text(active ? '装備中' : owned ? '所持済み' : '未所持 · ガチャで入手', { weight: 'bold', color: active ? BLUE : MUTED, align: 'center' }),
      ]),
      action('試着（変更なし）', `pf|dress|preview|${item.id}`),
      ...(owned && !active ? [action('これを装備する', `pf|dress|equip|${item.id}`, true)] : []),
    ])
  })
  const nav: Record<string, any>[] = [
    text(`${input.filter === 'owned' ? '所持アイテム' : 'すべてのアイテム'}：${input.total}点`, { size: 'lg', weight: 'bold' }),
    text(`${page} / ${pages} ページ`, { color: MUTED }),
    ...(input.total === 0 ? [text('該当するアイテムはありません。')] : []),
  ]
  const moves: Record<string, any>[] = []
  if (page > 1) moves.push(action('前のページ', `pf|dress|list|${input.kind}|${input.filter}|${page - 1}`))
  if (page < pages) moves.push(action('次のページ', `pf|dress|list|${input.kind}|${input.filter}|${page + 1}`, true))
  if (moves.length) nav.push(row(moves))
  nav.push(
    row([
      action('すべて', `pf|dress|list|${input.kind}|all|1`, input.filter === 'all'),
      action('所持のみ', `pf|dress|list|${input.kind}|owned|1`, input.filter === 'owned'),
    ]),
    text('初期衣装・背景の各1点は無料です。未所持アイテムは試着しても装備されません。', { size: 'xxs', color: MUTED }),
    action('きせかえガチャ', messageAction('ガチャ'), true),
    action('着せ替えに戻る', 'pf|dress|home'),
  )
  bubbles.push(bubble(`${title} · ページ操作`, nav))
  return flex(`${title}（${page}/${pages}ページ）`, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles })
}
