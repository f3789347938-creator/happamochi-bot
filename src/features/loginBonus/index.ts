import type { LineEnv, LineMessage } from '../../lib/line'
import { ensureProfile } from '../profile/core'
import { claimLoginBonus } from './store'
import { buildLoginBonusCard } from './flex'
import { getVisibleAnnouncements } from '../announcements'

interface LoginBonusContext {
  /** Identity and event key from the verified LINE message webhook. */
  userId?: string
  eventKey?: string | null
  displayName?: string | null
  pictureUrl?: string | null
  isGroup?: boolean
  groupId?: string
}

export async function handleLoginBonusText(
  env: LineEnv,
  ctx: LoginBonusContext,
  text: string
): Promise<LineMessage[] | null> {
  if (text !== 'ログイン') return null
  if (!ctx.userId || !ctx.eventKey) {
    return [{ type: 'text', text: '受け取り情報を確認できませんでした。トークに「ログイン」と送ってください。' }]
  }

  try {
    await ensureProfile(env, ctx.userId, ctx.displayName, ctx.pictureUrl)
    const result = await claimLoginBonus(env, ctx.userId, ctx.eventKey)
    const announcements = getVisibleAnnouncements(ctx.isGroup ? ctx.groupId ?? null : null)
    return [buildLoginBonusCard(result, announcements)]
  } catch {
    // A committed award is safe to retry: the daily receipt prevents another credit.
    return [{ type: 'text', text: 'ログインボーナスの受け取り結果を確認できませんでした。少し待ってから、もう一度「ログイン」と送ってください。' }]
  }
}
