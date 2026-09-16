// もち軍団サバイバル(引き継ぎパック v14)のサーバー側。
//
// 元パックの worker/index.js は、プレイヤーIDをこう取っていた:
//
//     const id = request.headers.get('oai-authenticated-user-id')
//
// これは別サービス(OpenAI Sites)が付けてくれるヘッダー前提の実装で、
// そのままLINEに持ち込むと curl でヘッダーを自分で付けるだけで
// 他人の記録を書き換えられる。パック自身も「そのまま一般公開しないこと」
// と書いている。
//
// そこで、もち合体パズルで既に使っている verifyLiffToken() に置き換える。
// クライアントは liff.getAccessToken() のトークンだけを送り、
// userId は必ずサーバーがLINEに問い合わせて得た値だけを使う。
// (features/mochiScore.ts の冒頭コメントと同じ方針)
//
// 不正対策として、元パックの validateReport() の検算ロジックは
// そのまま移植している。これは「出撃時間に対して倒せる敵の上限」などを
// サーバー側で計算し、physically ありえない戦績を弾くもの。
// 完全な再現検証ではないので、範囲内での改ざんは防げない。そこは正直に書いておく。

import type { LineEnv } from '../lib/line'
import { verifyLiffToken as verifyToken, type VerifiedUser } from './mochiScore'

// サバイバルは、もち合体パズルとは【別のLINEログインチャネル】で動く。
//   パズル  : 2011492233 (LIFF 2011492233-0cUBhY55)
//   サバイバル: 2011633519 (LIFF 2011633519-1hQ8eJSO)
//
// LINEのユーザーIDはプロバイダー単位で発行されるので、チャネルが別でも
// 同じ人なら同じ userId になる。だから既存のBotのデータ(user_profiles)と
// 突き合わせられる。実際に本人のIDで存在を確認済み。
//
// ただし「どのチャネルで発行されたトークンか」は必ず突き合わせる。
// これを省くと、別チャネルのトークンを持ち込んで書き込める穴になる。
export const SURVIVOR_CHANNEL_ID = '2011633519'

/** サバイバル用のトークン検証。必ずサバイバルのチャネルIDで確認する。 */
export function verifyLiffToken(accessToken: string): Promise<VerifiedUser | null> {
  return verifyToken(accessToken, SURVIVOR_CHANNEL_ID)
}

/** ゲーム側 records.js と必ず一致させる。ズレたら出撃を拒否する。 */
export const RULESET = 'endless-depth-2'

/** 元パックの weaponIds をそのまま持ってくる */
const WEAPON_IDS = [
  'kunai', 'bat', 'katana', 'shotgun', 'revolver', 'lightchaser', 'void',
  'sword', 'twinLance', 'spatula', 'clarinet', 'starPunch', 'lasso',
  'dualKatana', 'sai', 'microphone', 'nunchucks', 'staff', 'secret',
] as const

export interface SurvivorReport {
  score: number
  seconds: number
  kills: number
  bossKills: number
  cleanBosses: number
  maxAttackKills: number
  treasures: number
  commanders: number
  traps: number
  weapons: Record<string, { damage: number; kills: number }>
  mainWeapon?: string
  hero?: string
  level?: number
  evolved?: string[]
  recordTitle?: string
}

export class SurvivorError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const fail = (status: number, message: string) => new SurvivorError(status, message)

// ─── 週の区切り ────────────────────────────────────────────────
// 元パックの records.js weekAt() と同じ計算にする。
// 月曜始まりのISO週で、週ごとに固定の武器とシードを配る。
export function weekAt(now: number = Date.now()): { key: string; weapon: string; seed: number } {
  const d = new Date(now)
  // UTC基準の木曜日でISO週番号を出す(ISO 8601の定義)
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const day = new Date(utc).getUTCDay() || 7
  const thursday = utc + (4 - day) * 86400000
  const year = new Date(thursday).getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const week = Math.floor((thursday - jan1) / 604800000) + 1
  const key = `${year}-W${String(week).padStart(2, '0')}`
  // 週番号から決定的に武器とシードを決める(毎週同じ条件で競える)
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { key, weapon: WEAPON_IDS[h % WEAPON_IDS.length], seed: h }
}

// ─── 戦績の検算 ────────────────────────────────────────────────
// 元パックの spawnTempo / STAGES を使った上限計算を移植する。
// ここはゲーム側の enemies.js に依存するので、定数を写してある。
// ゲームのバランスを変えたらここも合わせる必要がある。

/** enemies.js の spawnTempo() 相当 */
function spawnTempo(seconds: number): { interval: number; burst: number } {
  // 時間が進むほど湧きが速く・多くなる
  const interval = Math.max(0.28, 1.5 - seconds / 220)
  const burst = 1 + Math.floor(seconds / 90)
  return { interval, burst }
}

/**
 * 出撃時間から「ありえる最大値」を出し、それを超える戦績を拒否する。
 *
 * 注意: これは上限チェックであって完全な検証ではない。
 * 上限の範囲内に収まる改ざんは防げない。盤面の再計算をしない限り無理。
 */
export function validateReport(
  raw: unknown,
  run: { started_at: number; mode: string; weapon: string; seconds: number; score: number; kills: number },
  now: number
): SurvivorReport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, '記録がありません。')
  const r = raw as Record<string, unknown>

  const num = (k: string): number => {
    const v = r[k]
    if (v === undefined) return 0
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw fail(400, '記録の数値が正しくありません。')
    }
    return v
  }
  const int = (k: string): number => {
    const v = num(k)
    if (!Number.isSafeInteger(v)) throw fail(400, '記録の数値が正しくありません。')
    return v
  }

  const seconds = num('seconds')
  const score = int('score')
  const kills = int('kills')
  const bossKills = int('bossKills')
  const cleanBosses = int('cleanBosses')
  const maxAttackKills = int('maxAttackKills')
  const treasures = int('treasures')
  const commanders = int('commanders')
  const traps = int('traps')

  // 武器ごとの内訳
  const w = r.weapons
  if (!w || typeof w !== 'object' || Array.isArray(w)) {
    throw fail(400, '武器ごとの記録が正しくありません。')
  }
  const weapons = w as Record<string, { damage?: unknown; kills?: unknown }>
  const entries = Object.entries(weapons)
  if (entries.length > 100) throw fail(400, '武器ごとの記録が正しくありません。')
  let weaponKillSum = 0
  for (const [id, v] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(id)) {
      throw fail(400, '武器ごとの記録が正しくありません。')
    }
    if (!v || typeof v !== 'object') throw fail(400, '武器ごとの記録が正しくありません。')
    const dmg = (v as any).damage
    const k = (v as any).kills
    if (typeof dmg !== 'number' || !Number.isFinite(dmg) || dmg < 0) {
      throw fail(400, '武器ごとの記録が正しくありません。')
    }
    if (!Number.isSafeInteger(k) || (k as number) < 0) {
      throw fail(400, '武器ごとの記録が正しくありません。')
    }
    weaponKillSum += k as number
  }

  // 実際に経過した時間より長く生存したことにはできない(5秒の猶予)
  const elapsed = Math.max(0, (now - run.started_at) / 1000)
  if (seconds > elapsed + 5) throw fail(400, '出撃時間と戦績が一致しません。')

  // 時間あたりに湧く敵の上限から、倒せる数の上限を出す
  const tempo = spawnTempo(seconds)
  const encounters = seconds < 50 ? 0 : 1 + Math.floor((seconds - 50) / 65)
  const bosses = Math.floor(seconds / 120)
  const elites = seconds < 60 ? 0 : 1 + Math.floor((seconds - 60) / 50)
  const maxSpawns =
    seconds < 0.8 ? 0 : Math.ceil(seconds / tempo.interval) * tempo.burst + bosses + elites + encounters * 6

  if (kills > maxSpawns) throw fail(400, '出撃時間と戦績が一致しません。')
  if (bossKills > bosses || bossKills > kills) throw fail(400, '出撃時間と戦績が一致しません。')
  if (cleanBosses > bossKills) throw fail(400, '出撃時間と戦績が一致しません。')
  if (maxAttackKills > 320 || maxAttackKills > kills) throw fail(400, '出撃時間と戦績が一致しません。')

  // スコアの上限。敵1体あたりの最大得点(1.25倍の余裕つき)で見積もる。
  const NORMAL_MAX = 150
  const BOSS_MAX = 900
  const scoreCap =
    (kills - bossKills) * Math.round(NORMAL_MAX * 1.25) + bossKills * Math.round(BOSS_MAX * 1.25)
  if (score > scoreCap) throw fail(400, '出撃時間と戦績が一致しません。')

  // イベント(宝箱・隊長・罠)の回数上限
  if (
    treasures > Math.ceil(encounters / 3) ||
    commanders > Math.floor((encounters + 1) / 3) ||
    traps > Math.floor(encounters / 3) ||
    treasures + commanders + traps > encounters
  ) {
    throw fail(400, '撃破の内訳を確認できませんでした。')
  }

  // 武器ごとの撃破数の合計は、総撃破数と一致しなければならない
  if (weaponKillSum !== kills) throw fail(400, '撃破の内訳を確認できませんでした。')

  // 週間チャレンジは装備が固定
  const mainWeapon = typeof r.mainWeapon === 'string' ? r.mainWeapon : undefined
  const hero = typeof r.hero === 'string' ? r.hero : undefined
  if (run.mode === 'challenge' && (mainWeapon !== run.weapon || hero !== 'common')) {
    throw fail(400, '週間チャレンジの装備条件が一致しません。')
  }

  // 保存済みより古い記録での上書きを拒否(二重計上・巻き戻し防止)
  if (seconds < (run.seconds || 0) || score < (run.score || 0) || kills < (run.kills || 0)) {
    throw fail(409, '保存済みの戦績より古い記録です。')
  }

  return {
    score, seconds, kills, bossKills, cleanBosses, maxAttackKills,
    treasures, commanders, traps,
    weapons: weapons as SurvivorReport['weapons'],
    mainWeapon, hero,
    level: typeof r.level === 'number' ? Math.max(1, Math.floor(r.level)) : 1,
    evolved: Array.isArray(r.evolved) ? (r.evolved as string[]).filter(x => typeof x === 'string').slice(0, 20) : [],
    recordTitle: typeof r.recordTitle === 'string' ? r.recordTitle.slice(0, 30) : undefined,
  }
}

// ─── DB操作 ────────────────────────────────────────────────────

/** 初回アクセス時に行を作る。既にあれば名前と画像だけ最新にする。 */
export async function ensurePlayer(env: LineEnv, user: VerifiedUser, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO survivor_players (user_id, display_name, picture_url, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       picture_url  = excluded.picture_url,
       updated_at   = CURRENT_TIMESTAMP`
  ).bind(user.userId, user.displayName, user.pictureUrl, now).run()
}

export interface PlayerRow {
  user_id: string
  display_name: string | null
  picture_url: string | null
  title: string
  outfit: string
  effect: string
  best_score: number
  best_seconds: number
  clean_bosses: number
  max_attack_kills: number
  boss_kills: number
  treasures: number
  commanders: number
  traps: number
  plays: number
}

export async function getPlayer(env: LineEnv, userId: string): Promise<PlayerRow | null> {
  return await env.DB.prepare(`SELECT * FROM survivor_players WHERE user_id = ?`)
    .bind(userId)
    .first<PlayerRow>()
}

/** 出撃を開始する。二重出撃は拒否する。 */
export async function startRun(
  env: LineEnv,
  user: VerifiedUser,
  body: { id?: unknown; mode?: unknown; weapon?: unknown; ruleset?: unknown },
  now: number
): Promise<{ id: string; mode: string; seed: number; weapon: string; week: ReturnType<typeof weekAt> }> {
  if (body.ruleset !== RULESET) {
    throw fail(409, 'ゲームが更新されました。ページを再読み込みしてから出撃してください。')
  }
  if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)) {
    throw fail(400, '出撃を開始できませんでした。')
  }
  const week = weekAt(now)

  // 同じIDで再送されたら、同じ結果を返す(通信の再試行に耐える)
  const existing = await env.DB.prepare(`SELECT * FROM survivor_runs WHERE id = ?`)
    .bind(body.id)
    .first<any>()
  if (existing) {
    if (existing.owner !== user.userId || existing.finished_at !== null || existing.ruleset !== RULESET) {
      throw fail(409, 'この出撃は終了しています。')
    }
    return {
      id: existing.id, mode: existing.mode, seed: existing.seed,
      weapon: existing.weapon, week: weekAt(existing.started_at),
    }
  }

  // 進んでいない出撃(スコアも撃破も0)は、ユーザーに片付けさせない。
  //
  // 元パックは「記録画面で整理してから始めてください」と出して手動操作を
  // 求めていたが、これは開発者にしか意味が分からないし、普通に遊んでいても
  // 発生する。実機で「出撃を開始できませんでした」が出て詰まったのは
  // まさにこれで、通信が切れたりLIFFを閉じたりするだけで残ってしまう。
  //
  // 進捗0の出撃は捨てても失うものが無いので、ここで黙って消す。
  // 進捗のある出撃(途中で閉じた等)だけは消さずに残し、下で案内する。
  await env.DB.prepare(
    `DELETE FROM survivor_runs
      WHERE owner = ? AND finished_at IS NULL AND score = 0 AND kills = 0`
  ).bind(user.userId).run()

  const active = await env.DB.prepare(
    `SELECT id FROM survivor_runs WHERE owner = ? AND finished_at IS NULL`
  ).bind(user.userId).first<{ id: string }>()
  if (active) {
    // 進捗のある出撃が残っている場合。これも放置すると永久に詰まるので、
    // その出撃をこちらで終了扱いにしてから新しい出撃を始めさせる。
    // (戦績は finish を通っていないので加算されない。記録が消えるのではなく
    //  「送信されなかった分が確定しない」だけ)
    await env.DB.prepare(
      `UPDATE survivor_runs SET finished_at = ? WHERE id = ? AND finished_at IS NULL`
    ).bind(now, active.id).run()
  }

  const mode = body.mode === 'challenge' ? 'challenge' : 'normal'
  const weapon =
    mode === 'challenge'
      ? week.weapon
      : (WEAPON_IDS as readonly string[]).includes(body.weapon as string)
        ? (body.weapon as string)
        : 'kunai'
  const seed = mode === 'challenge' ? week.seed : crypto.getRandomValues(new Uint32Array(1))[0]

  await env.DB.prepare(
    `INSERT INTO survivor_runs (id, owner, mode, week, ruleset, weapon, seed, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(body.id, user.userId, mode, week.key, RULESET, weapon, seed, now).run()

  return { id: body.id, mode, seed, weapon, week }
}

/** 進んでいない出撃だけ取り消せる。確定した戦績は消せない。 */
export async function abandonRun(env: LineEnv, user: VerifiedUser, id: unknown): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM survivor_runs
      WHERE id = ? AND owner = ? AND finished_at IS NULL AND score = 0 AND kills = 0`
  ).bind(String(id), user.userId).run()
}

/** 出撃を終える。検算に通った戦績だけ保存する。 */
export async function finishRun(
  env: LineEnv,
  user: VerifiedUser,
  body: { id?: unknown; report?: unknown },
  now: number
): Promise<{ saved: true; best: number; rank: number | null; already?: boolean }> {
  const run = await env.DB.prepare(`SELECT * FROM survivor_runs WHERE id = ? AND owner = ?`)
    .bind(String(body.id), user.userId)
    .first<any>()
  if (!run) throw fail(404, 'この出撃の記録が見つかりません。')

  // 二重送信は黙って成功扱い(同じ戦績が2回加算されないように)
  if (run.finished_at !== null) {
    const p = await getPlayer(env, user.userId)
    return { saved: true, best: p?.best_score ?? 0, rank: await rankOf(env, p?.best_score ?? 0), already: true }
  }

  const r = validateReport(body.report, run, now)

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE survivor_runs
          SET finished_at = ?, score = ?, seconds = ?, kills = ?, boss_kills = ?,
              clean_bosses = ?, max_attack_kills = ?, treasures = ?, commanders = ?,
              traps = ?, report = ?
        WHERE id = ? AND owner = ? AND finished_at IS NULL`
    ).bind(
      now, Math.floor(r.score), r.seconds, Math.floor(r.kills), Math.floor(r.bossKills),
      Math.floor(r.cleanBosses), Math.floor(r.maxAttackKills), Math.floor(r.treasures),
      Math.floor(r.commanders), Math.floor(r.traps), JSON.stringify(r), run.id, user.userId
    ),
    // 自己ベストと累計を、確定済みの出撃から再集計する。
    // 差分加算ではなく毎回集計し直すので、二重計上が起きない。
    env.DB.prepare(
      `UPDATE survivor_players SET
         best_score       = COALESCE((SELECT MAX(score)    FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL AND mode = 'normal'), 0),
         best_seconds     = COALESCE((SELECT MAX(seconds)  FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         clean_bosses     = COALESCE((SELECT MAX(clean_bosses) FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         max_attack_kills = COALESCE((SELECT MAX(max_attack_kills) FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         boss_kills       = COALESCE((SELECT SUM(boss_kills) FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         treasures        = COALESCE((SELECT SUM(treasures)  FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         commanders       = COALESCE((SELECT SUM(commanders) FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         traps            = COALESCE((SELECT SUM(traps)      FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         plays            = COALESCE((SELECT COUNT(*)        FROM survivor_runs WHERE owner = ? AND finished_at IS NOT NULL), 0),
         updated_at       = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).bind(
      user.userId, user.userId, user.userId, user.userId, user.userId,
      user.userId, user.userId, user.userId, user.userId, user.userId
    ),
  ])

  const p = await getPlayer(env, user.userId)
  const best = p?.best_score ?? 0
  return { saved: true, best, rank: await rankOf(env, best) }
}

async function rankOf(env: LineEnv, score: number): Promise<number | null> {
  if (score <= 0) return null
  const above = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM survivor_players WHERE best_score > ?`
  ).bind(score).first<{ c: number }>()
  return (above?.c ?? 0) + 1
}

export interface SurvivorRankRow {
  user_id: string
  display_name: string | null
  picture_url: string | null
  best_score: number
  best_seconds: number
  boss_kills: number
  plays: number
}

/** 上位一覧。読むだけなのでログイン不要。 */
export async function getSurvivorRanking(env: LineEnv, limit = 20): Promise<SurvivorRankRow[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)
  const res = await env.DB.prepare(
    `SELECT user_id, display_name, picture_url, best_score, best_seconds, boss_kills, plays
       FROM survivor_players
      WHERE best_score > 0
      ORDER BY best_score DESC, best_seconds DESC, updated_at ASC
      LIMIT ?`
  ).bind(n).all<SurvivorRankRow>()
  return res.results ?? []
}

/** 本人の記録と順位 */
export async function getMySurvivor(
  env: LineEnv,
  userId: string
): Promise<{ row: PlayerRow; rank: number | null } | null> {
  const row = await getPlayer(env, userId)
  if (!row) return null
  return { row, rank: await rankOf(env, row.best_score) }
}
