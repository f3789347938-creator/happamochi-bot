import type { Hono, Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { LineEnv } from '../../lib/line'
import { LOGIN_CHANNEL_ID, verifyLiffToken } from '../mochiScore'
import { ensureProfile } from '../profile/core'
import { RULES } from '../../../public/static/casino/engine.mjs'
import { actCasinoRound, CasinoError, getCasinoEnvelope, startCasinoRound, validateRequestId } from './store'

type CasinoContext = Context<{ Bindings: LineEnv }>

export function casinoEnabled(env: LineEnv): boolean {
  return env.CASINO_ENABLED === 'true' && Boolean(env.CASINO_LIFF_ID?.trim())
}

async function authenticatedUser(c: CasinoContext): Promise<string> {
  if (!casinoEnabled(c.env)) throw new CasinoError('DISABLED', 'ポイントでのプレイは準備中です。練習モードで遊べます。', 503)
  const authorization = c.req.header('authorization') || ''
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1]
  if (!token || token.length > 4096) throw new CasinoError('UNAUTHORIZED', 'LINEでログインし直してください。', 401)
  const user = await verifyLiffToken(token, c.env.CASINO_LOGIN_CHANNEL_ID || LOGIN_CHANNEL_ID)
  if (!user) throw new CasinoError('UNAUTHORIZED', 'LINEでログインし直してください。', 401)
  await ensureProfile(c.env, user.userId, user.displayName, user.pictureUrl)
  return user.userId
}

async function body(c: CasinoContext, keys: string[]) {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') || '')) {
    throw new CasinoError('INVALID_REQUEST', 'JSON形式で操作を送信してください。')
  }
  if (Number(c.req.header('content-length')) > 4096) throw new CasinoError('INVALID_REQUEST', '操作のデータが大きすぎます。')
  const text = await c.req.text()
  if (text.length > 4096) throw new CasinoError('INVALID_REQUEST', '操作のデータが大きすぎます。')
  let value
  try { value = JSON.parse(text) } catch { throw new CasinoError('INVALID_REQUEST', '操作のデータを読み取れません。') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new CasinoError('INVALID_REQUEST', '操作に使えないデータが含まれています。')
  }
  validateRequestId(value.requestId)
  return value
}

function endpoint(handler: (c: CasinoContext) => Promise<Response> | Response) {
  return async (c: CasinoContext) => {
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    try { return await handler(c) }
    catch (error) {
      const safe = error instanceof CasinoError ? error : new CasinoError('UNAVAILABLE', '今はゲームに接続できません。再接続して状態を確認してください。', 503)
      return c.json({ error: { code: safe.code, message: safe.message } }, safe.status)
    }
  }
}

export function registerCasinoRoutes(app: Hono<{ Bindings: LineEnv }>) {
  // Includes malformed bodies, unknown API paths and method errors.
  app.use('/api/casino/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    await next()
  })
  app.use('/api/casino/*', bodyLimit({ maxSize: 4096, onError: c =>
    c.json({ error: { code: 'INVALID_REQUEST', message: '操作のデータが大きすぎます。' } }, 400) }))
  app.get('/api/casino/config', endpoint(c => c.json({
    liffId: c.env.CASINO_LIFF_ID?.trim() || '', enabled: casinoEnabled(c.env), rules: RULES,
  })))
  app.get('/api/casino/session', endpoint(async c => {
    const userId = await authenticatedUser(c)
    return c.json(await getCasinoEnvelope(c.env.DB, userId))
  }))
  app.get('/api/casino/history', endpoint(async c => {
    const userId = await authenticatedUser(c)
    return c.json(await getCasinoEnvelope(c.env.DB, userId))
  }))
  app.post('/api/casino/start', endpoint(async c => {
    const userId = await authenticatedUser(c)
    const input = await body(c, ['mode', 'stake', 'requestId'])
    if (!['draw', 'duel', 'blackjack'].includes(input.mode) || !Number.isSafeInteger(input.stake)
      || !RULES.stakes[input.mode as keyof typeof RULES.stakes]?.includes(input.stake)) {
      throw new CasinoError('INVALID_REQUEST', 'ゲームか参加ポイントが正しくありません。')
    }
    return c.json(await startCasinoRound(c.env.DB, userId, input))
  }))
  app.post('/api/casino/action', endpoint(async c => {
    const userId = await authenticatedUser(c)
    const input = await body(c, ['roundId', 'version', 'action', 'discards', 'requestId'])
    if (typeof input.roundId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(input.roundId)
      || !Number.isSafeInteger(input.version) || input.version < 1
      || !['draw', 'check', 'bet', 'call', 'raise', 'fold', 'hit', 'stand', 'double'].includes(input.action)
      || (input.discards !== undefined && (input.action !== 'draw' || !Array.isArray(input.discards)
        || input.discards.length > 5 || input.discards.some((index: unknown) => !Number.isInteger(index) || Number(index) < 0 || Number(index) > 4)
        || new Set(input.discards).size !== input.discards.length))) {
      throw new CasinoError('INVALID_REQUEST', '操作か交換するカードが正しくありません。')
    }
    return c.json(await actCasinoRound(c.env.DB, userId, input))
  }))
}
