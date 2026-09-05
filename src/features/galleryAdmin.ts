// 名言カードギャラリーの管理者認証。
//
// 「管理者だけが削除できる機能」用。BotのLINE機能・/webhook・quote.ts /
// imageGen.ts には一切関与しない、/gallery/admin* 専用の完全に独立した
// 認証レイヤー。
//
// 設計:
// - パスワードは Cloudflare Pages のシークレット GALLERY_ADMIN_PASSWORD
//   (本番: `wrangler pages secret put`、ローカル: .dev.vars) に保存する。
//   フロントエンドやgitには一切含めない。
// - ログイン成功時、有効期限つきの署名済みトークンを Cookie にセットする。
//   セッションをDBやメモリに保存しない(Cloudflare Workersはメモリ状態を
//   保持できないため)、ステートレスな HMAC-SHA256 署名トークン方式。
// - トークン形式: `${expiresAtMs}.${hexHmac}` — 期限切れ or 署名不一致は
//   即座に「未ログイン」として扱う。
import type { LineEnv } from '../lib/line'

const COOKIE_NAME = 'gallery_admin_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12時間

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// タイミング攻撃を避けるための定数時間比較。
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function isAdminConfigured(env: LineEnv): boolean {
  return typeof env.GALLERY_ADMIN_PASSWORD === 'string' && env.GALLERY_ADMIN_PASSWORD.length > 0
}

// 入力されたパスワードが正しければ、Set-Cookie用のトークン文字列を返す。
// 誤っていた場合、または管理者パスワードが未設定の場合は null。
export async function createSessionToken(env: LineEnv, password: string): Promise<string | null> {
  if (!isAdminConfigured(env)) return null
  if (!timingSafeEqual(password, env.GALLERY_ADMIN_PASSWORD as string)) return null

  const expiresAt = Date.now() + SESSION_TTL_MS
  const sig = await hmacHex(env.GALLERY_ADMIN_PASSWORD as string, String(expiresAt))
  return `${expiresAt}.${sig}`
}

// Cookieヘッダーから該当Cookieの値を取り出す(Hono cookie helperは使わず、
// このファイル単体で完結させる — Bot本体のimportグラフに影響を与えない)。
function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export async function isAdminRequest(env: LineEnv, cookieHeader: string | undefined): Promise<boolean> {
  if (!isAdminConfigured(env)) return false
  const token = readCookie(cookieHeader, COOKIE_NAME)
  if (!token) return false
  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0) return false
  const expiresAtStr = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)
  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false

  const expectedSig = await hmacHex(env.GALLERY_ADMIN_PASSWORD as string, expiresAtStr)
  return timingSafeEqual(sig, expectedSig)
}

export function buildSessionCookie(token: string): string {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
