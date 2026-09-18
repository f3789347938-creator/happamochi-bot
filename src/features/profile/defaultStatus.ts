import type { LineMessage } from '../../lib/line'
import type { StatusCardInput } from './flex'

/** Initial status layout, measured from the reference: 300 × 278 px. */
export function buildDefaultStatusCard(input: StatusCardInput): LineMessage {
  const { profile, level, theme, rank, titleName, fortune, preview, note } = input
  const oneLine = (text: string, size: string, extra: Record<string, unknown> = {}) => ({
    type: 'text', text, size, color: theme.text_color,
    wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit', ...extra,
  })
  const name = (profile.display_name ?? '').trim() || 'ユーザー'
  const percent = Math.min(100, Math.max(0, Math.round(level.percent) || 0))
  let picture: string | null = null
  if (profile.picture_url && profile.picture_url.length <= 1000) {
    try {
      const url = new URL(profile.picture_url)
      if (url.protocol === 'https:' && !url.username && !url.password) picture = url.href
    } catch { /* A missing LINE photo is represented by the initial. */ }
  }
  const button = (text: string, data: string, filled: boolean) => ({
    type: 'box', layout: 'vertical', height: '31px', flex: 1,
    justifyContent: 'center', paddingStart: '4px', paddingEnd: '4px', cornerRadius: '8px',
    backgroundColor: filled ? theme.accent : theme.body_bg,
    borderColor: theme.accent, borderWidth: '1px', action: { type: 'postback', data },
    contents: [oneLine(text, '14px', { color: filled ? theme.header_text : theme.text_color, weight: filled ? 'bold' : 'regular', align: 'center' })],
  })
  const body: Record<string, unknown>[] = [
    {
      type: 'box', layout: 'vertical', height: '31px', flex: 0,
      backgroundColor: theme.accent, cornerRadius: '8px', justifyContent: 'center',
      paddingStart: '8px', paddingEnd: '8px', action: { type: 'postback', data: 'pf|titles' },
      contents: [oneLine(titleName ?? '未設定', '17px', { weight: 'bold', color: theme.header_text, align: 'center' })],
    },
    {
      type: 'box', layout: 'vertical', height: '117px', flex: 0, margin: '9px',
      paddingAll: '8px', borderColor: theme.accent, borderWidth: '1px', cornerRadius: '8px',
      backgroundColor: theme.body_bg,
      contents: [
        {
          type: 'box', layout: 'horizontal', height: '68px', flex: 0, spacing: '8px', alignItems: 'center',
          contents: [
            {
              type: 'box', layout: 'vertical', width: '56px', height: '56px', flex: 0,
              cornerRadius: '999px', backgroundColor: theme.header_bg, justifyContent: 'center',
              contents: picture
                ? [{ type: 'image', url: picture, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' }]
                : [oneLine(Array.from(name)[0] ?? '?', '23px', { color: theme.header_text, weight: 'bold', align: 'center' })],
            },
            {
              type: 'box', layout: 'vertical', flex: 1, justifyContent: 'center',
              contents: [
                oneLine(name, '20px', { weight: 'bold' }),
                {
                  type: 'box', layout: 'horizontal', height: '18px', margin: '5px', flex: 0, alignItems: 'center', spacing: '4px',
                  contents: [
                    oneLine(`Lv. ${level.level}`, '14px', { flex: 2 }),
                    oneLine(`exp ${level.expInLevel} / ${level.expNeeded}`, '13px', { flex: 5, color: theme.accent, align: 'end' }),
                  ],
                },
                {
                  type: 'box', layout: 'vertical', height: '12px', flex: 0, margin: '3px',
                  cornerRadius: '999px', backgroundColor: theme.body_bg, borderColor: theme.accent, borderWidth: '1px',
                  contents: percent > 0 ? [{
                    type: 'box', layout: 'vertical', width: `${percent}%`, height: '10px', flex: 0,
                    backgroundColor: theme.accent, cornerRadius: '999px', contents: [{ type: 'filler' }],
                  }] : [{ type: 'filler' }],
                },
              ],
            },
          ],
        },
        {
          type: 'box', layout: 'horizontal', height: '25px', flex: 0, margin: '6px', alignItems: 'center', spacing: '6px',
          contents: [
            ...(fortune ? [{
              type: 'box', layout: 'vertical', width: '44px', height: '25px', flex: 0,
              backgroundColor: theme.accent, cornerRadius: '999px', justifyContent: 'center',
              contents: [oneLine(fortune, '15px', { weight: 'bold', color: theme.header_text, align: 'center' })],
            }] : []),
            oneLine(`保有ポイント: ${profile.points.toLocaleString('ja-JP')}`, '14px', { flex: 1, align: 'end' }),
          ],
        },
      ],
    },
    ...(preview ? [{
      type: 'box', layout: 'vertical', height: '22px', flex: 0, justifyContent: 'center',
      contents: [oneLine(`${preview.themeName} のプレビュー（未適用）`, '11px', { align: 'center', color: theme.accent })],
    }] : []),
    {
      type: 'box', layout: 'horizontal', height: '31px', flex: 0, margin: '8px', spacing: '4px',
      contents: preview
        ? [button('このテーマにする', preview.applyData, true), button('戻る', preview.backData, false)]
        : [button('着せ替え', 'pf|dress|home', true), button('称号変更', 'pf|titles', false)],
    },
    ...(note ? [{
      type: 'box', layout: 'vertical', height: '20px', flex: 0, justifyContent: 'center',
      contents: [oneLine(note, '10px', { color: theme.accent })],
    }] : []),
  ]
  return {
    type: 'flex', altText: `${Array.from(name).slice(0, 40).join('')} のステータス（Lv.${level.level}${rank !== null ? ` / ${rank}位` : ''}）`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', height: '44px', paddingAll: '8px', justifyContent: 'center', backgroundColor: theme.header_bg,
        contents: [oneLine(rank !== null ? `Ranking：${rank.toLocaleString('ja-JP')}位` : 'Ranking：未集計', '20px', { weight: 'bold', color: theme.header_text, align: 'center' })],
      },
      body: { type: 'box', layout: 'vertical', height: `${212 + (preview ? 22 : 0) + (note ? 20 : 0)}px`, paddingAll: '8px', backgroundColor: theme.body_bg, contents: body },
      footer: {
        type: 'box', layout: 'vertical', height: '22px', paddingAll: '0px', justifyContent: 'center', backgroundColor: theme.header_bg,
        contents: [oneLine('© 2026 HappaMochi Bot', '11px', { color: theme.header_text, align: 'center' })],
      },
    },
  }
}
