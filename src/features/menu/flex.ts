// ヘルプメニュー(hmhelp)の新規Flexカード。
//
// 適用範囲の注意:
//   ここで作るのは「新規に追加する案内画面」だけ。
//   実装済みのFlex(ステータス/着せ替え/購入確認/共通称号一覧/カテゴリ選択/
//   チェス3種/オセロ盤面/お知らせ)には、このデザインもフッターも戻るボタンも
//   一切適用しない。既存カードはそのまま既存のビルダーが返した物を送る。
//
// デザイン(仕様書 v4):
//   白・水色のフラット。薄水色のブランド帯、濃紺の見出し、一行の要約、
//   ラベル/値の行、主ボタン1つ+副ボタン、フッターに © 2026 HappaMochi Bot。
//   写真・3D・大きなヒーロー・巨大アイコン・過度な影は使わない。
import type { LineMessage } from '../../lib/line'

const C = {
  brandBg: '#EAF6FD', // ブランド帯の薄水色
  brandText: '#4A7C97',
  cardBg: '#FFFFFF',
  title: '#123A56', // 濃紺の見出し
  body: '#456B82',
  label: '#7C9AAD',
  value: '#123A56',
  primaryBg: '#0E9AD6', // 主ボタン
  primaryText: '#FFFFFF',
  subBg: '#F2F9FD', // 副ボタン
  subText: '#1B5E80',
  border: '#D6E9F5',
  line: '#E8F2F8',
  footer: '#8FAEC0',
} as const

export const FOOTER_TEXT = '© 2026 HappaMochi Bot'

export interface Row {
  label: string
  value: string
}

export type BtnKind = 'primary' | 'sub'

export interface Btn {
  label: string
  /** postback に載せるデータ。サーバーが解釈する短いトークンのみ。 */
  data: string
  kind?: BtnKind
  /** URIボタン(個人ランキングの公開ページなど) */
  uri?: string
  /** 押せない状態のボタン。action を付けない(押しても何も起きない) */
  disabled?: boolean
}

function button(b: Btn): Record<string, any> {
  const primary = b.kind === 'primary'
  const box: Record<string, any> = {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: primary ? C.primaryBg : C.subBg,
    borderColor: primary ? C.primaryBg : C.border,
    borderWidth: '1px',
    cornerRadius: 'md',
    paddingAll: 'md',
    alignItems: 'center',
    contents: [
      {
        type: 'text',
        text: b.label,
        size: 'sm',
        weight: 'bold',
        color: primary ? C.primaryText : C.subText,
        wrap: true,
        flex: 1,
      },
      {
        type: 'text',
        text: '›',
        size: 'sm',
        color: primary ? C.primaryText : C.subText,
        align: 'end',
        flex: 0,
      },
    ],
  }
  // 押せないボタンには action を付けない。LINEは action の無い box を
  // 単なる装飾として描画するので、押しても何も起こらない。
  if (!b.disabled) {
    box.action = b.uri
      ? { type: 'uri', label: b.label.slice(0, 20), uri: b.uri }
      : { type: 'postback', data: b.data }
  }
  return box
}

export interface CardInput {
  /** ブランド帯の右に出す分類名(名言 / 個人 / ゲーム など) */
  category: string
  title: string
  /** 一行の要約 */
  body: string
  rows?: Row[]
  buttons: Btn[]
  /** カルーセルの何枚目かを出す場合("01 / 06") */
  pageLabel?: string
  /** altText(トーク一覧やプッシュ通知に出る文字) */
  altText?: string
}

/** 1枚分のバブルを作る。カルーセルにも単体にも使える。 */
export function buildBubble(input: CardInput): Record<string, any> {
  const body: Record<string, any>[] = [
    {
      type: 'text',
      text: input.title,
      size: 'xl',
      weight: 'bold',
      color: C.title,
      wrap: true,
    },
    {
      type: 'text',
      text: input.body,
      size: 'sm',
      color: C.body,
      wrap: true,
      margin: 'sm',
    },
  ]

  const rows = input.rows ?? []
  if (rows.length > 0) {
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      spacing: 'sm',
      contents: rows.map((r, i) => ({
        type: 'box',
        layout: 'vertical',
        contents: [
          ...(i > 0
            ? [{ type: 'separator', color: C.line, margin: 'none' } as Record<string, any>]
            : []),
          {
            type: 'box',
            layout: 'baseline',
            margin: i > 0 ? 'sm' : 'none',
            contents: [
              { type: 'text', text: r.label, size: 'xxs', color: C.label, flex: 3, wrap: true },
              {
                type: 'text',
                text: r.value,
                size: 'xxs',
                color: C.value,
                flex: 7,
                align: 'end',
                wrap: true,
              },
            ],
          },
        ],
      })),
    })
  }

  if (input.buttons.length > 0) {
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      spacing: 'sm',
      contents: input.buttons.map(button),
    })
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: C.brandBg,
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: '葉っぱもち Bot',
          size: 'xs',
          color: C.brandText,
          flex: 1,
          wrap: false,
        },
        {
          type: 'text',
          text: input.pageLabel ?? input.category,
          size: 'xs',
          color: C.brandText,
          align: 'end',
          flex: 0,
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.cardBg,
      paddingAll: 'lg',
      contents: body,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.cardBg,
      paddingAll: 'md',
      contents: [
        // フッターは切り取らずに必ず出す(仕様)
        {
          type: 'text',
          text: FOOTER_TEXT,
          size: 'xxs',
          color: C.footer,
          align: 'center',
          wrap: false,
        },
      ],
    },
  }
}

/** 単体カードのFlexメッセージ。 */
export function buildCard(input: CardInput): LineMessage {
  return {
    type: 'flex',
    altText: input.altText ?? `${input.title}（葉っぱもち Bot）`,
    contents: buildBubble(input),
  } as LineMessage
}

/** 複数バブルの横スワイプカルーセル。LINEの上限は12枚。 */
export function buildCarousel(bubbles: Record<string, any>[], altText: string): LineMessage {
  return {
    type: 'flex',
    altText,
    contents: { type: 'carousel', contents: bubbles.slice(0, 12) },
  } as LineMessage
}
