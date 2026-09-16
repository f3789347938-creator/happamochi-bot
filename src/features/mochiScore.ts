// もち合体パズル(LIFFミニゲーム)のスコアランキング。
//
// ■ なりすまし対策の考え方
//
// クライアント(ブラウザ)から来る値は、すべて改ざんできる前提で扱う。
// 特に「誰のスコアか」をクライアントに決めさせては絶対にいけない。
// liff.getProfile() の結果を送らせる実装だと、DevTools や curl から
// 他人の userId と好きなスコアを送れてしまう。
//
// そのため、
//   1. クライアントは liff.getAccessToken() のアクセストークンだけを送る
//   2. サーバーが LINE に問い合わせてトークンを検証する
//        GET https://api.line.me/oauth2/v2.1/verify?access_token=...
//        → client_id が自分のチャネルIDと一致するかを必ず確認する
//          (他チャネルで発行されたトークンを持ち込む攻撃を防ぐ)
//   3. 同じトークンで userId を取得する
//        GET https://api.line.me/v2/profile
//   4. サーバーが得た userId でだけ書き込む
// という流れにしている。userId はリクエストボディから一切読まない。
//
// ■ チャネルID
// LINEログインチャネル「葉っぱ」のチャネルID。LIFF ID のハイフンより前と
// 同じ値。公開して良い値(OAuthのclient_idとしてURLに載る)。
// チャネルシークレットはこの検証に不要なので、コードには持たせない。
import type { LineEnv } from '../lib/line'

export const LOGIN_CHANNEL_ID = '2011492233'

// スコアの妥当性の上限。
// 最大の段階(1500点)ばかりを現実的でない回数作っても届かない値を上限にする。
// これ以上は物理的に出ないので、明らかな改ざんとして弾く。
// (完全な検証はサーバーで盤面を再計算しないと無理なので、
//  「ありえない値を拒否する」までに留める。ここは正直に限界を書いておく)
const MAX_PLAUSIBLE_SCORE = 5_000_000
const MAX_PLAUSIBLE_MERGES = 100_000
const MAX_STAGE_INDEX = 10 // STAGES は11段階(0..10)

export interface VerifiedUser {
  userId: string
  displayName: string | null
  pictureUrl: string | null
}

/**
 * アクセストークンを LINE に問い合わせて検証し、本人の userId を得る。
 * 検証に失敗したら null。呼び出し側は null なら必ず拒否する。
 *
 * expectedChannelId:
 *   そのトークンを発行したチャネルのID。省略時はもち合体パズルの
 *   チャネル(LOGIN_CHANNEL_ID)を期待する。
 *   ゲームごとにLINEログインチャネルが別なので、「このゲームの
 *   チャネルで発行されたトークンか」をここで必ず突き合わせる。
 *   これをしないと、別チャネルのトークンを持ち込んで書き込める穴になる。
 */
export async function verifyLiffToken(
  accessToken: string,
  expectedChannelId: string = LOGIN_CHANNEL_ID
): Promise<VerifiedUser | null> {
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length > 4096) return null
  if (!expectedChannelId) return null

  // 1. トークンそのものの検証。ここで client_id を必ず突き合わせる。
  let verify: { client_id?: string; expires_in?: number }
  try {
    const res = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    )
    if (!res.ok) return null
    verify = await res.json()
  } catch {
    return null
  }

  // 他のチャネルで発行されたトークンを持ち込まれても受け付けない。
  if (verify.client_id !== expectedChannelId) return null
  // 期限切れ(LINEは expires_in を返す。0以下なら失効)
  if (typeof verify.expires_in === 'number' && verify.expires_in <= 0) return null

  // 2. 同じトークンで本人のプロフィールを取る。userId はここからしか取らない。
  try {
    const res = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const p = await res.json<{ userId?: string; displayName?: string; pictureUrl?: string }>()
    if (!p.userId || typeof p.userId !== 'string') return null
    return {
      userId: p.userId,
      displayName: typeof p.displayName === 'string' ? p.displayName.slice(0, 100) : null,
      pictureUrl: typeof p.pictureUrl === 'string' ? p.pictureUrl.slice(0, 500) : null,
    }
  } catch {
    return null
  }
}

/** 送られてきた数値が現実的な範囲かを確かめる */
export function isPlausibleScore(score: unknown, merges: unknown, stage: unknown): boolean {
  const ok = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
  if (!ok(score, MAX_PLAUSIBLE_SCORE)) return false
  if (!ok(merges, MAX_PLAUSIBLE_MERGES)) return false
  if (!ok(stage, MAX_STAGE_INDEX)) return false
  // 1回も合体していないのに高得点はありえない(最小の合体で10点)
  if ((score as number) > 0 && (merges as number) === 0) return false
  return true
}

export interface ScoreRow {
  user_id: string
  display_name: string | null
  picture_url: string | null
  best_score: number
  best_merges: number
  best_stage: number
  plays: number
}

/**
 * 自己ベストだけを更新する。
 * 低いスコアを送っても best_score は下がらない(plays だけ増える)。
 */
export async function submitScore(
  env: LineEnv,
  user: VerifiedUser,
  score: number,
  merges: number,
  stage: number
): Promise<{ best: number; updated: boolean; rank: number | null }> {
  await env.DB.prepare(
    `INSERT INTO mochi_scores (user_id, display_name, picture_url, best_score, best_merges, best_stage, plays)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       picture_url  = excluded.picture_url,
       -- 自己ベストのみ更新。低い記録で上書きしない。
       best_score   = MAX(best_score, excluded.best_score),
       best_merges  = MAX(best_merges, excluded.best_merges),
       best_stage   = MAX(best_stage, excluded.best_stage),
       plays        = plays + 1,
       updated_at   = CURRENT_TIMESTAMP`
  )
    .bind(user.userId, user.displayName, user.pictureUrl, score, merges, stage)
    .run()

  const row = await env.DB.prepare(`SELECT best_score FROM mochi_scores WHERE user_id = ?`)
    .bind(user.userId)
    .first<{ best_score: number }>()
  const best = row?.best_score ?? score

  // 自分より上に何人いるかで順位を出す(同点は同順位)
  const above = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM mochi_scores WHERE best_score > ?`
  )
    .bind(best)
    .first<{ c: number }>()

  return { best, updated: best === score && score > 0, rank: (above?.c ?? 0) + 1 }
}

/** 上位を取る */
export async function getRanking(env: LineEnv, limit = 20): Promise<ScoreRow[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)
  const res = await env.DB.prepare(
    `SELECT user_id, display_name, picture_url, best_score, best_merges, best_stage, plays
       FROM mochi_scores
      WHERE best_score > 0
      ORDER BY best_score DESC, updated_at ASC
      LIMIT ?`
  )
    .bind(n)
    .all<ScoreRow>()
  return res.results ?? []
}

/** 本人の記録と順位 */
export async function getMyScore(
  env: LineEnv,
  userId: string
): Promise<{ row: ScoreRow; rank: number } | null> {
  const row = await env.DB.prepare(
    `SELECT user_id, display_name, picture_url, best_score, best_merges, best_stage, plays
       FROM mochi_scores WHERE user_id = ?`
  )
    .bind(userId)
    .first<ScoreRow>()
  if (!row) return null
  const above = await env.DB.prepare(`SELECT COUNT(*) AS c FROM mochi_scores WHERE best_score > ?`)
    .bind(row.best_score)
    .first<{ c: number }>()
  return { row, rank: (above?.c ?? 0) + 1 }
}
