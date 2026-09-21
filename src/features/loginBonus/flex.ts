import type { LineMessage } from '../../lib/line'

export interface LoginBonusCardInput {
  claimed: boolean
  day: string
  totalDays: number
  streakDays: number
  rewardDays: number
  rewardPoints: number
  balance: number
}

const BLUE = '#009FDE'
const AQUA = '#E4F7FF'
const BORDER = '#BFDDE5'
const INK = '#333333'
const MUTED = '#647B82'
const GRAY = '#929B9D'

const format = (value: number) => value.toLocaleString('ja-JP')

function text(value: string, size: string, extra: Record<string, any> = {}): Record<string, any> {
  return { type: 'text', text: value, size, color: INK, wrap: true, scaling: true, ...extra }
}

function dayRow(label: string, days: number): Record<string, any> {
  return {
    type: 'box', layout: 'baseline', spacing: '6px',
    contents: [
      text(label, '12px', { color: MUTED, flex: 1 }),
      text(`${format(days)}日`, '12px', { color: BLUE, weight: 'bold', align: 'end', flex: 0 }),
    ],
  }
}

/**
 * Native, single-bubble version of the reference login card (kilo width).
 * Padding retains its lower white space without a fixed height: larger LINE
 * fonts and longer counts can grow naturally instead of clipping the reward.
 */
export function buildLoginBonusCard(input: LoginBonusCardInput): LineMessage {
  const { claimed, day, totalDays, streakDays, rewardDays, rewardPoints, balance } = input
  const points = `${format(rewardPoints)}ポイント`
  const receivedLabel = `${day.replaceAll('-', '/')}分は受け取り済み`
  const receipt = claimed ? `${points}を受け取りました。` : `${receivedLabel}です（${points}）。`

  return {
    type: 'flex',
    altText: `${day} ログインボーナス：${receipt} 合計${format(totalDays)}日／連続${format(streakDays)}日。受取時の保有ポイント：${format(balance)}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: BLUE,
        paddingTop: '8px', paddingBottom: '8px', paddingStart: '10px', paddingEnd: '10px',
        contents: [text('ログインボーナス', '15px', { color: '#FFFFFF', weight: 'bold', align: 'center' })],
      },
      body: {
        type: 'box', layout: 'vertical', backgroundColor: AQUA, paddingAll: '10px', spacing: '8px',
        contents: [
          {
            type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF',
            borderColor: BORDER, borderWidth: '1px', cornerRadius: '6px',
            paddingTop: '10px', paddingBottom: '60px', paddingStart: '8px', paddingEnd: '8px',
            contents: [
              text(claimed ? '今日も来てくれてありがとう！' : receivedLabel, '14px', { weight: 'bold', align: 'center' }),
              { type: 'separator', color: BORDER, margin: '6px' },
              {
                type: 'box', layout: 'vertical', margin: '8px', spacing: '5px',
                contents: [dayRow('合計ログイン', totalDays), dayRow('連続ログイン', streakDays)],
              },
              { type: 'separator', color: BORDER, margin: '8px' },
              text(points, '18px', { color: BLUE, weight: 'bold', margin: '10px' }),
              text(`連続${format(rewardDays)}日分 ×500`, '12px', { color: GRAY, margin: '4px' }),
              text('連続ログインは7日分まで増えるよ', '11px', { color: GRAY, align: 'end', margin: '10px' }),
            ],
          },
          {
            type: 'box', layout: 'vertical', backgroundColor: BLUE, cornerRadius: '8px',
            paddingTop: '10px', paddingBottom: '10px', paddingStart: '8px', paddingEnd: '8px',
            action: { type: 'postback', label: 'ステータスを確認する', data: 'pf|status' },
            contents: [text('ステータスを確認する', '16px', { color: '#FFFFFF', align: 'center' })],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: BLUE,
        paddingTop: '5px', paddingBottom: '5px', paddingStart: '8px', paddingEnd: '8px',
        contents: [text('© 2026 HappaMochi Bot', '10px', { color: '#FFFFFF', align: 'center' })],
      },
    },
  }
}
