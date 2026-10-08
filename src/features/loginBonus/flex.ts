import type { LineMessage } from '../../lib/line'
import type { AnnouncementContent } from '../announcements'

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

function previewText(value: string, limit: number): string {
  const characters = Array.from(value.trim())
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : value.trim() || '詳しく見るから確認できます。'
}

/**
 * Native login receipt (kilo width), optionally followed by notice previews.
 * Content-sized with compact padding: larger LINE fonts and longer counts
 * can grow naturally instead of clipping the reward.
 */
export function buildLoginBonusCard(
  input: LoginBonusCardInput,
  announcements: AnnouncementContent[] = []
): LineMessage {
  const { claimed, day, totalDays, streakDays, rewardDays, rewardPoints, balance } = input
  const points = `${format(rewardPoints)}ポイント`
  const receivedLabel = `${day.replaceAll('-', '/')}分は受け取り済み`
  const receipt = claimed ? `${points}を受け取りました。` : `${receivedLabel}です（${points}）。`

  const message: LineMessage = {
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
            paddingTop: '10px', paddingBottom: '10px', paddingStart: '8px', paddingEnd: '8px',
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

  if (announcements.length === 0) return message

  // A Flex carousel stretches every body to the tallest one. Reuse the
  // existing login shell and keep previews shorter than its receipt panel;
  // never append the full-size announcement cards here. The receipt itself
  // remains unchanged, including its font scaling and natural height.
  const login = message.contents
  const previews = announcements.slice(0, 11).map(notice => ({
    ...login,
    header: {
      ...login.header,
      contents: [text('お知らせ', '15px', { color: '#FFFFFF', weight: 'bold', align: 'center' })],
    },
    body: {
      ...login.body,
      contents: [
        {
          ...login.body.contents[0],
          flex: 1,
          contents: [
            text(previewText(notice.title, 80), '14px', { weight: 'bold', align: 'center', maxLines: 1, flex: 0 }),
            { type: 'separator', color: BORDER, margin: '6px' },
            text(previewText(notice.body, 240), '12px', { color: MUTED, margin: '8px', maxLines: 4, flex: 1 }),
            text(previewText(notice.date ?? day.replaceAll('-', '/'), 32), '11px', {
              color: GRAY, align: 'end', margin: '10px', maxLines: 1, flex: 0,
            }),
          ],
        },
        {
          ...login.body.contents[1],
          flex: 0,
          action: { type: 'message', label: '詳しく見る', text: 'お知らせ' },
          contents: [text('詳しく見る', '16px', { color: '#FFFFFF', align: 'center' })],
        },
      ],
    },
  }))
  return {
    ...message,
    altText: `${message.altText}。お知らせは右にスワイプして確認できます。`,
    contents: { type: 'carousel', contents: [login, ...previews] },
  }
}
