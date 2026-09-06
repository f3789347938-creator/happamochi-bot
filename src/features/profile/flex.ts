// ステータス・着せ替え・共通称号のFlex Message。
//
// 見本(01-status.png / 02-themes.png / 03-titles.png)を基準にした
// コンパクトな構成。画像を貼るのではなくネイティブFlexで組む。
//
// LINE Flexの制約で注意した点:
//   ・image コンポーネントに width は指定できない(400になる)。
//     幅を決めるときは box でラップして box 側に width を持たせる。
//   ・送信済みのFlexは編集できないので、操作のたびに新しいカードを返す。
//   ・EXPバーは「外側の箱の中に、幅%を持つ内側の箱」で表現する。
import type { LineMessage } from '../../lib/line'
import type { CommonTitle, LevelInfo, Theme, TitleCategory, UserProfile } from './core'

const FOOTER_TEXT = '© 2026 HappaMochi Bot'

/** 表示名が長いと崩れるので、カードでは切り詰める(元データは変えない) */
function short(name: string | null, fallback: string, max = 16): string {
  const n = (name ?? '').trim() || fallback
  return Array.from(n).length > max ? Array.from(n).slice(0, max).join('') + '…' : n
}

/** テーマから、そのテーマ上で読める補助色を作る */
function subColor(theme: Theme): string {
  // 本文色をそのまま薄くはできないので、テーマごとに用意した
  // アクセント色を補助文字色として使う。
  return theme.accent
}

function footer(theme: Theme): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: theme.header_bg,
    paddingAll: 'sm',
    contents: [
      {
        type: 'text',
        text: FOOTER_TEXT,
        size: 'xxs',
        color: theme.header_text,
        align: 'center',
      },
    ],
  }
}

/** 丸いアイコン。画像が無ければ頭文字。 */
function avatarBox(
  profile: { display_name: string | null; picture_url: string | null },
  theme: Theme,
  size: string,
  fontSize: string
): Record<string, any> {
  const inner = profile.picture_url
    ? { type: 'image', url: profile.picture_url, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }
    : {
        type: 'text',
        text: Array.from((profile.display_name ?? '?').trim() || '?')[0] ?? '?',
        align: 'center',
        gravity: 'center',
        weight: 'bold',
        size: fontSize,
        color: theme.header_text,
      }
  return {
    type: 'box',
    layout: 'vertical',
    width: size,
    height: size,
    cornerRadius: '999px',
    backgroundColor: theme.header_bg,
    justifyContent: 'center',
    flex: 0,
    contents: [inner],
  }
}

/** EXPバー。percent は 0〜100 に丸めた値。 */
function expBar(theme: Theme, percent: number): Record<string, any> {
  const p = Math.min(100, Math.max(0, Math.round(percent)))
  const bar: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    height: '12px',
    backgroundColor: theme.body_bg,
    cornerRadius: '999px',
    borderColor: theme.accent,
    borderWidth: '1px',
    contents: [{ type: 'filler' }],
  }
  // 0% のときに幅0の箱を入れるとFlexが崩れるので、そのときは中身を置かない。
  if (p > 0) {
    bar.contents = [
      {
        type: 'box',
        layout: 'vertical',
        width: `${p}%`,
        height: '12px',
        backgroundColor: theme.accent,
        cornerRadius: '999px',
        contents: [{ type: 'filler' }],
      },
    ]
  }
  return bar
}

function smallButton(
  label: string,
  data: string,
  theme: Theme,
  filled: boolean
): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: filled ? theme.accent : theme.body_bg,
    borderColor: theme.accent,
    borderWidth: '1px',
    cornerRadius: 'md',
    paddingAll: 'sm',
    action: { type: 'postback', data },
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        weight: filled ? 'bold' : 'regular',
        color: filled ? theme.header_text : theme.text_color,
        align: 'center',
        wrap: true,
      },
    ],
  }
}

// === ステータスカード ====================================================
export interface StatusCardInput {
  profile: UserProfile
  level: LevelInfo
  theme: Theme
  /** 個人順位。集計できないときは null(見本の値で埋めない) */
  rank: number | null
  /** 装備中の共通称号名。未装備は null →「未設定」 */
  titleName: string | null
  /** その日の運勢(見本のバッジ)。求められないときは null で非表示 */
  fortune?: string | null
  /** プレビュー中なら、その旨を出して操作ボタンを変える */
  preview?: { themeName: string; applyData: string; backData: string }
  /** 本人以外が押したときの案内 */
  note?: string
}

export function buildStatusCard(input: StatusCardInput): LineMessage {
  const { profile, level, theme, rank, titleName } = input
  const name = short(profile.display_name, 'ユーザー')

  const body: Record<string, any>[] = [
    // 称号の帯
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.accent,
      cornerRadius: 'md',
      paddingAll: 'sm',
      contents: [
        {
          type: 'text',
          text: titleName ?? '未設定',
          size: 'md',
          weight: 'bold',
          color: theme.header_text,
          align: 'center',
          wrap: true,
        },
      ],
    },
    // 内側パネル: アイコン / 名前 / Lv・EXP / ポイント
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.body_bg,
      borderColor: theme.accent,
      borderWidth: '1px',
      cornerRadius: 'md',
      paddingAll: 'md',
      margin: 'md',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          alignItems: 'center',
          contents: [
            avatarBox(profile, theme, '56px', 'xl'),
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: name,
                  size: 'lg',
                  weight: 'bold',
                  color: theme.text_color,
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'sm',
                  contents: [
                    {
                      type: 'text',
                      text: `Lv. ${level.level}`,
                      size: 'sm',
                      color: theme.text_color,
                      flex: 0,
                    },
                    {
                      type: 'text',
                      text: `exp ${level.expInLevel} / ${level.expNeeded}`,
                      size: 'xs',
                      color: subColor(theme),
                      align: 'end',
                    },
                  ],
                },
                { ...expBar(theme, level.percent), margin: 'sm' },
              ],
            },
          ],
        },
        // 見本と同じ、運勢バッジ(左)と保有ポイント(右)の1行。
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          alignItems: 'center',
          contents: [
            input.fortune
              ? {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: theme.accent,
                  cornerRadius: '20px',
                  paddingAll: 'xs',
                  paddingStart: 'md',
                  paddingEnd: 'md',
                  flex: 0,
                  contents: [
                    {
                      type: 'text',
                      text: input.fortune,
                      size: 'sm',
                      weight: 'bold',
                      color: theme.header_text,
                      align: 'center',
                    },
                  ],
                }
              : { type: 'filler' },
            {
              type: 'text',
              text: `保有ポイント: ${profile.points.toLocaleString('ja-JP')}`,
              size: 'sm',
              color: theme.text_color,
              align: 'end',
              gravity: 'center',
            },
          ],
        },
      ],
    },
  ]

  // 操作ボタン。プレビュー中は「このテーマにする」「戻る」に差し替える。
  if (input.preview) {
    body.push({
      type: 'text',
      text: `${input.preview.themeName} のプレビュー（まだ適用していません）`,
      size: 'xxs',
      color: subColor(theme),
      margin: 'md',
      wrap: true,
    })
    body.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        smallButton('このテーマにする', input.preview.applyData, theme, true),
        smallButton('戻る', input.preview.backData, theme, false),
      ],
    })
  } else {
    body.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'md',
      contents: [
        smallButton('着せ替え', 'pf|themes', theme, true),
        smallButton('称号変更', 'pf|titles', theme, false),
      ],
    })
  }

  if (input.note) {
    body.push({
      type: 'text',
      text: input.note,
      size: 'xxs',
      color: subColor(theme),
      margin: 'md',
      wrap: true,
    })
  }

  return {
    type: 'flex',
    altText: `${name} のステータス（Lv.${level.level}${rank ? ` / ${rank}位` : ''}）`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: theme.header_bg,
        paddingAll: 'md',
        contents: [
          {
            type: 'text',
            // 順位が集計できないときは見本の値で埋めず、未集計と出す。
            text: rank !== null ? `Ranking：${rank.toLocaleString('ja-JP')}位` : 'Ranking：未集計',
            size: 'lg',
            weight: 'bold',
            color: theme.header_text,
            align: 'center',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: theme.body_bg,
        paddingAll: 'md',
        contents: body,
      },
      footer: footer(theme),
    },
  }
}

// === 着せ替え ============================================================
export interface ThemeCardInput {
  profile: UserProfile
  level: LevelInfo
  /** 操作画面自体は水色に統一する(指示) */
  uiTheme: Theme
  themes: Theme[]
  ownedIds: Set<string>
  activeId: string
}

/** テーマ1件のタイル。各テーマの実際の色で小さく見せる。 */
function themeTile(t: Theme, input: ThemeCardInput): Record<string, any> {
  const owned = input.ownedIds.has(t.id) || t.price === 0
  const active = input.activeId === t.id

  const actions: Record<string, any>[] = []
  if (active) {
    actions.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: t.accent,
      cornerRadius: 'md',
      paddingAll: 'xs',
      contents: [
        { type: 'text', text: '使用中', size: 'xs', weight: 'bold', color: t.header_text, align: 'center' },
      ],
    })
  } else if (owned) {
    actions.push({
      type: 'box',
      layout: 'vertical',
      borderColor: t.accent,
      borderWidth: '1px',
      cornerRadius: 'md',
      paddingAll: 'xs',
      action: { type: 'postback', data: `pf|apply|${t.id}` },
      contents: [
        { type: 'text', text: '使う', size: 'xs', color: t.text_color, align: 'center' },
      ],
    })
  } else {
    // 未所持: プレビュー(無料)と 交換(確認画面へ)
    actions.push({
      type: 'box',
      layout: 'vertical',
      borderColor: t.accent,
      borderWidth: '1px',
      cornerRadius: 'md',
      paddingAll: 'xs',
      action: { type: 'postback', data: `pf|preview|${t.id}` },
      contents: [
        { type: 'text', text: 'プレビュー', size: 'xs', color: t.text_color, align: 'center' },
      ],
    })
    actions.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: t.accent,
      cornerRadius: 'md',
      paddingAll: 'xs',
      margin: 'xs',
      action: { type: 'postback', data: `pf|buy|${t.id}` },
      contents: [
        {
          type: 'text',
          text: `${t.price}P で交換`,
          size: 'xs',
          weight: 'bold',
          color: t.header_text,
          align: 'center',
          wrap: true,
        },
      ],
    })
  }

  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: t.body_bg,
    borderColor: active ? t.accent : t.header_bg,
    borderWidth: active ? '2px' : '1px',
    cornerRadius: 'md',
    paddingAll: 'sm',
    spacing: 'xs',
    contents: [
      // テーマ名の帯(そのテーマのヘッダー色で見せる)
      {
        type: 'box',
        layout: 'vertical',
        backgroundColor: t.header_bg,
        cornerRadius: 'sm',
        paddingAll: 'xs',
        contents: [
          { type: 'text', text: t.name, size: 'xs', weight: 'bold', color: t.header_text, align: 'center' },
        ],
      },
      // 小さなプレビュー(名前 + Lv + バー)
      {
        type: 'text',
        text: short(input.profile.display_name, 'ユーザー', 8),
        size: 'xs',
        weight: 'bold',
        color: t.text_color,
        align: 'center',
        margin: 'xs',
      },
      {
        type: 'text',
        text: `Lv. ${input.level.level}   exp ${input.level.expInLevel}/${input.level.expNeeded}`,
        size: 'xxs',
        color: t.text_color,
        align: 'center',
      },
      expBar(t, input.level.percent),
      ...actions,
    ],
  }
}

export function buildThemeCard(input: ThemeCardInput): LineMessage {
  const ui = input.uiTheme
  const ts = input.themes
  const rows: Record<string, any>[] = []
  for (let i = 0; i < ts.length; i += 2) {
    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: i === 0 ? 'none' : 'sm',
      contents: ts.slice(i, i + 2).map((t) => themeTile(t, input)),
    })
  }

  return {
    type: 'flex',
    altText: '着せ替え（カードテーマの選択）',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.header_bg,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '着せ替え', size: 'lg', weight: 'bold', color: ui.header_text, align: 'center' },
          {
            type: 'text',
            text: `保有ポイント: ${input.profile.points.toLocaleString('ja-JP')}`,
            size: 'xs',
            color: ui.header_text,
            align: 'center',
            margin: 'xs',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.body_bg,
        paddingAll: 'md',
        contents: [
          ...rows,
          {
            type: 'text',
            text: '名言カードにも反映されます',
            size: 'xxs',
            color: ui.accent,
            align: 'center',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            borderColor: ui.accent,
            borderWidth: '1px',
            cornerRadius: 'md',
            paddingAll: 'sm',
            margin: 'sm',
            action: { type: 'postback', data: 'pf|status' },
            contents: [
              { type: 'text', text: 'ステータスに戻る', size: 'sm', color: ui.text_color, align: 'center' },
            ],
          },
        ],
      },
      footer: footer(ui),
    },
  }
}

/** 購入確認。価格・現在残高・交換後残高を出す。 */
export function buildPurchaseConfirm(
  theme: Theme,
  ui: Theme,
  balance: number
): LineMessage {
  const after = balance - theme.price
  const enough = after >= 0
  return {
    type: 'flex',
    altText: `${theme.name} を ${theme.price}ポイントで交換しますか`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.header_bg,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '交換の確認', size: 'lg', weight: 'bold', color: ui.header_text, align: 'center' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.body_bg,
        paddingAll: 'md',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: theme.header_bg,
            cornerRadius: 'md',
            paddingAll: 'sm',
            contents: [
              { type: 'text', text: theme.name, size: 'md', weight: 'bold', color: theme.header_text, align: 'center' },
            ],
          },
          ...[
            ['必要ポイント', `${theme.price.toLocaleString('ja-JP')} P`],
            ['現在の残高', `${balance.toLocaleString('ja-JP')} P`],
            ['交換後の残高', enough ? `${after.toLocaleString('ja-JP')} P` : '不足しています'],
          ].map(([k, v]) => ({
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: k, size: 'sm', color: ui.text_color, flex: 3 },
              { type: 'text', text: v, size: 'sm', weight: 'bold', color: ui.text_color, align: 'end', flex: 2 },
            ],
          })),
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            margin: 'md',
            contents: enough
              ? [
                  smallButton('交換する', `pf|buyok|${theme.id}`, ui, true),
                  smallButton('戻る', 'pf|themes', ui, false),
                ]
              : [smallButton('戻る', 'pf|themes', ui, false)],
          },
        ],
      },
      footer: footer(ui),
    },
  }
}

// === 共通称号一覧 ========================================================
export interface TitleListInput {
  ui: Theme
  profile: UserProfile
  level: LevelInfo
  /** 表示する5件 */
  items: { title: CommonTitle; usable: boolean; lockLabel: string | null; equipped: boolean }[]
  /** 見出しに出す絞り込みの説明 */
  scopeLabel: string
  totalCount: number
  filteredCount: number
  page: number
  pageCount: number
  filter: 'all' | 'usable' | 'locked'
  /** 現在の絞り込みを保ったままページ送りするためのトークン生成 */
  pageData: (page: number) => string
  filterData: (f: 'all' | 'usable' | 'locked') => string
  categoryData: string
  searchData: string
  /**
   * 称号を装備するトークン。装備後も同じ絞り込み・同じページを保つため、
   * 現在の状態を含めたトークンを呼び出し側で作る。
   */
  equipData: (titleId: string) => string
}

export const TITLES_PER_PAGE = 5

export function buildTitleListCard(input: TitleListInput): LineMessage {
  const ui = input.ui

  const tab = (label: string, f: 'all' | 'usable' | 'locked') => ({
    type: 'box',
    layout: 'vertical',
    backgroundColor: input.filter === f ? ui.accent : ui.body_bg,
    borderColor: ui.accent,
    borderWidth: '1px',
    paddingAll: 'xs',
    action: { type: 'postback', data: input.filterData(f) },
    contents: [
      {
        type: 'text',
        text: label,
        size: 'xs',
        weight: input.filter === f ? 'bold' : 'regular',
        color: input.filter === f ? ui.header_text : ui.text_color,
        align: 'center',
      },
    ],
  })

  const rows: Record<string, any>[] =
    input.items.length === 0
      ? [
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'lg',
            contents: [
              {
                type: 'text',
                text: '条件に合う称号がありません',
                size: 'sm',
                color: ui.text_color,
                align: 'center',
                wrap: true,
              },
              {
                type: 'text',
                text: '絞り込みを変えるか、すべてに戻してください',
                size: 'xxs',
                color: ui.accent,
                align: 'center',
                margin: 'sm',
                wrap: true,
              },
            ],
          },
        ]
      : input.items.map((it, i) => ({
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          paddingAll: 'sm',
          backgroundColor: it.equipped ? ui.body_bg : undefined,
          borderColor: it.equipped ? ui.accent : undefined,
          borderWidth: it.equipped ? '1px' : undefined,
          cornerRadius: it.equipped ? 'md' : undefined,
          margin: i === 0 ? 'none' : 'xs',
          contents: [
            {
              type: 'text',
              text: it.title.name,
              size: 'sm',
              weight: it.equipped ? 'bold' : 'regular',
              color: it.usable ? ui.text_color : ui.accent,
              flex: 3,
              wrap: true,
            },
            it.equipped
              ? {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: ui.accent,
                  cornerRadius: 'md',
                  paddingAll: 'xs',
                  flex: 2,
                  contents: [
                    { type: 'text', text: '装備中', size: 'xs', weight: 'bold', color: ui.header_text, align: 'center' },
                  ],
                }
              : it.usable
                ? {
                    type: 'box',
                    layout: 'vertical',
                    borderColor: ui.accent,
                    borderWidth: '1px',
                    cornerRadius: 'md',
                    paddingAll: 'xs',
                    flex: 2,
                    action: { type: 'postback', data: input.equipData(it.title.id) },
                    contents: [
                      { type: 'text', text: '装備', size: 'xs', color: ui.text_color, align: 'center' },
                    ],
                  }
                : {
                    // 未解放には有効な装備ボタンを付けない。条件だけ出す。
                    type: 'text',
                    text: it.lockLabel ?? '未解放',
                    size: 'xxs',
                    color: ui.accent,
                    align: 'end',
                    flex: 2,
                    wrap: true,
                  },
          ],
        }))

  const prevDisabled = input.page <= 1
  const nextDisabled = input.page >= input.pageCount || input.pageCount === 0

  const navButton = (label: string, disabled: boolean, page: number) => ({
    type: 'box',
    layout: 'vertical',
    borderColor: disabled ? ui.body_bg : ui.accent,
    borderWidth: '1px',
    cornerRadius: 'md',
    paddingAll: 'xs',
    flex: 2,
    // 無効なときは action を付けない(押しても何も起きない)
    ...(disabled ? {} : { action: { type: 'postback', data: input.pageData(page) } }),
    contents: [
      {
        type: 'text',
        text: label,
        size: 'xs',
        color: disabled ? ui.accent : ui.text_color,
        align: 'center',
      },
    ],
  })

  return {
    type: 'flex',
    altText: `称号を選ぶ（全${input.totalCount}種類）`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: ui.header_bg,
        paddingAll: 'md',
        alignItems: 'center',
        spacing: 'sm',
        contents: [
          avatarBox(input.profile, ui, '36px', 'md'),
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '称号を選ぶ', size: 'lg', weight: 'bold', color: ui.header_text },
              {
                type: 'text',
                text: `全${input.totalCount}種類・${short(input.profile.display_name, 'ユーザー', 8)} Lv.${input.level.level}`,
                size: 'xxs',
                color: ui.header_text,
                margin: 'xs',
                wrap: true,
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.body_bg,
        paddingAll: 'md',
        contents: [
          // 取得状態フィルタ
          {
            type: 'box',
            layout: 'horizontal',
            contents: [tab('すべて', 'all'), tab('使える', 'usable'), tab('未解放', 'locked')],
          },
          // 絞り込みの説明 + カテゴリ/検索
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            alignItems: 'center',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: `${input.scopeLabel}（${input.filteredCount}種類）`,
                size: 'xs',
                color: ui.text_color,
                flex: 4,
                wrap: true,
              },
              {
                type: 'box',
                layout: 'vertical',
                borderColor: ui.accent,
                borderWidth: '1px',
                cornerRadius: 'md',
                paddingAll: 'xs',
                flex: 2,
                action: { type: 'postback', data: input.categoryData },
                contents: [
                  { type: 'text', text: 'カテゴリ', size: 'xxs', color: ui.text_color, align: 'center' },
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                borderColor: ui.accent,
                borderWidth: '1px',
                cornerRadius: 'md',
                paddingAll: 'xs',
                flex: 2,
                action: { type: 'postback', data: input.searchData },
                contents: [
                  { type: 'text', text: '検索', size: 'xxs', color: ui.text_color, align: 'center' },
                ],
              },
            ],
          },
          // 一覧(5件)
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            borderColor: ui.accent,
            borderWidth: '1px',
            cornerRadius: 'md',
            paddingAll: 'sm',
            contents: rows,
          },
          // ページ送り。件数0なら「1 / 0」を出さない。
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            alignItems: 'center',
            contents: [
              navButton('前へ', prevDisabled, input.page - 1),
              {
                type: 'text',
                text: input.pageCount === 0 ? '—' : `${input.page} / ${input.pageCount}`,
                size: 'sm',
                color: ui.text_color,
                align: 'center',
                flex: 3,
              },
              navButton('次へ', nextDisabled, input.page + 1),
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            borderColor: ui.accent,
            borderWidth: '1px',
            cornerRadius: 'md',
            paddingAll: 'sm',
            margin: 'sm',
            action: { type: 'postback', data: 'pf|status' },
            contents: [
              { type: 'text', text: 'ステータスに戻る', size: 'sm', color: ui.text_color, align: 'center' },
            ],
          },
        ],
      },
      footer: footer(ui),
    },
  }
}

/** カテゴリ選択(14件を7件ずつ2ページ) */
export function buildCategoryCard(
  ui: Theme,
  categories: TitleCategory[],
  page: number,
  pageData: (p: number) => string,
  pickData: (categoryId: string | null) => string
): LineMessage {
  const PER = 7
  const pageCount = Math.max(1, Math.ceil(categories.length / PER))
  const p = Math.min(Math.max(1, page), pageCount)
  const slice = categories.slice((p - 1) * PER, p * PER)

  return {
    type: 'flex',
    altText: 'カテゴリを選ぶ',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.header_bg,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: 'カテゴリを選ぶ', size: 'md', weight: 'bold', color: ui.header_text, align: 'center' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ui.body_bg,
        paddingAll: 'md',
        spacing: 'xs',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            borderColor: ui.accent,
            borderWidth: '1px',
            cornerRadius: 'md',
            paddingAll: 'sm',
            action: { type: 'postback', data: pickData(null) },
            contents: [
              { type: 'text', text: 'すべてのカテゴリ', size: 'sm', color: ui.text_color, align: 'center' },
            ],
          },
          ...slice.map((c) => ({
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            borderColor: ui.accent,
            borderWidth: '1px',
            cornerRadius: 'md',
            paddingAll: 'sm',
            action: { type: 'postback', data: pickData(c.id) },
            contents: [
              { type: 'text', text: c.name, size: 'sm', color: ui.text_color, flex: 4, wrap: true },
              {
                type: 'text',
                text: c.kind === 'earned' ? '実績' : '自由',
                size: 'xxs',
                color: ui.accent,
                align: 'end',
                flex: 1,
              },
            ],
          })),
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                borderColor: p <= 1 ? ui.body_bg : ui.accent,
                borderWidth: '1px',
                cornerRadius: 'md',
                paddingAll: 'xs',
                flex: 2,
                ...(p <= 1 ? {} : { action: { type: 'postback', data: pageData(p - 1) } }),
                contents: [
                  { type: 'text', text: '前へ', size: 'xs', color: p <= 1 ? ui.accent : ui.text_color, align: 'center' },
                ],
              },
              { type: 'text', text: `${p} / ${pageCount}`, size: 'sm', color: ui.text_color, align: 'center', flex: 3 },
              {
                type: 'box',
                layout: 'vertical',
                borderColor: p >= pageCount ? ui.body_bg : ui.accent,
                borderWidth: '1px',
                cornerRadius: 'md',
                paddingAll: 'xs',
                flex: 2,
                ...(p >= pageCount ? {} : { action: { type: 'postback', data: pageData(p + 1) } }),
                contents: [
                  {
                    type: 'text',
                    text: '次へ',
                    size: 'xs',
                    color: p >= pageCount ? ui.accent : ui.text_color,
                    align: 'center',
                  },
                ],
              },
            ],
          },
        ],
      },
      footer: footer(ui),
    },
  }
}
