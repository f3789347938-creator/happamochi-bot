// チェス対局のデータアクセス層。
// 対局ロジック(engine.ts)・Flex生成(flex.ts)・Webhook処理(index.ts)から
// DBアクセスを分離している。
import type { LineEnv } from '../../lib/line'

export interface ChessGame {
  id: string
  group_id: string
  status: 'waiting' | 'playing' | 'finished' | 'aborted'
  creator_user_id: string
  /** 募集カード表示用。DBには持たず実行時に補完する */
  creator_name?: string | null
  white_user_id: string | null
  black_user_id: string | null
  white_name: string | null
  black_name: string | null
  white_picture: string | null
  black_picture: string | null
  start_fen: string
  current_fen: string
  moves_json: string
  pgn: string
  turn: 'w' | 'b'
  version: number
  sel_square: string | null
  sel_token: string | null
  pending_from: string | null
  pending_to: string | null
  pending_token: string | null
  draw_by: string | null
  draw_expires_at: string | null
  resign_by: string | null
  resign_token: string | null
  resign_expires_at: string | null
  expires_at: string | null
  result: string | null
  result_reason: string | null
  rematch_by: string | null
  rematch_expires_at: string | null
  rematch_child_id: string | null
  created_at: string
  updated_at: string
}

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export function isoPlusMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString().replace('T', ' ').slice(0, 19)
}

export function isExpired(iso: string | null): boolean {
  if (!iso) return false
  return nowIso() > iso
}

/** ランダムなID。crypto.randomUUID は Workers で利用可能。 */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** 短いトークン(選択・昇格・投了確認の識別子) */
export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

export function parseMoves(game: ChessGame): string[] {
  try {
    const v = JSON.parse(game.moves_json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** そのグループの「募集中または対局中」の対局(なければ null) */
export async function getActiveGame(env: LineEnv, groupId: string): Promise<ChessGame | null> {
  return env.DB.prepare(
    `SELECT * FROM chess_games
      WHERE group_id = ? AND status IN ('waiting','playing')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(groupId)
    .first<ChessGame>()
}

export async function getGameById(env: LineEnv, id: string): Promise<ChessGame | null> {
  return env.DB.prepare(`SELECT * FROM chess_games WHERE id = ?`).bind(id).first<ChessGame>()
}

/** 直近の終局した対局(再戦提案の対象) */
export async function getLastFinished(env: LineEnv, groupId: string): Promise<ChessGame | null> {
  return env.DB.prepare(
    `SELECT * FROM chess_games
      WHERE group_id = ? AND status = 'finished'
      ORDER BY updated_at DESC LIMIT 1`
  )
    .bind(groupId)
    .first<ChessGame>()
}

/**
 * 募集を作成する。
 * 1グループ1件の部分UNIQUEインデックスがあるため、同時実行で2件目が
 * 来た場合は INSERT が失敗する。呼び出し側はその場合 null を受け取る。
 */
export async function createRecruit(
  env: LineEnv,
  groupId: string,
  creatorUserId: string
): Promise<ChessGame | null> {
  const id = newId()
  try {
    await env.DB.prepare(
      `INSERT INTO chess_games
        (id, group_id, status, creator_user_id, start_fen, current_fen, turn, expires_at)
       VALUES (?, ?, 'waiting', ?, ?, ?, 'w', ?)`
    )
      .bind(id, groupId, creatorUserId, INITIAL_FEN, INITIAL_FEN, isoPlusMinutes(10))
      .run()
  } catch {
    // UNIQUE制約違反 = すでにこのグループで募集/対局がある
    return null
  }
  return getGameById(env, id)
}

/**
 * 募集に参加して対局を成立させる。白黒はランダム。
 *
 * 同時に複数人が参加しても1人だけ確定させるため、
 * WHERE に status='waiting' AND white_user_id IS NULL を入れた
 * 条件付きUPDATEにして、変更行数が0なら失敗として扱う。
 */
export async function joinGame(
  env: LineEnv,
  gameId: string,
  joinerUserId: string,
  creatorProfile: { name: string | null; picture: string | null },
  joinerProfile: { name: string | null; picture: string | null }
): Promise<ChessGame | null> {
  const creatorIsWhite = Math.random() < 0.5
  const game = await getGameById(env, gameId)
  if (!game) return null

  const whiteId = creatorIsWhite ? game.creator_user_id : joinerUserId
  const blackId = creatorIsWhite ? joinerUserId : game.creator_user_id
  const whiteP = creatorIsWhite ? creatorProfile : joinerProfile
  const blackP = creatorIsWhite ? joinerProfile : creatorProfile

  const res = await env.DB.prepare(
    `UPDATE chess_games
        SET status = 'playing',
            white_user_id = ?, black_user_id = ?,
            white_name = ?, black_name = ?,
            white_picture = ?, black_picture = ?,
            expires_at = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND status = 'waiting' AND white_user_id IS NULL`
  )
    .bind(whiteId, blackId, whiteP.name, blackP.name, whiteP.picture, blackP.picture, gameId)
    .run()

  if (!res.meta.changes) return null
  return getGameById(env, gameId)
}

/** 募集の取り消し(作成者のみ。呼び出し側で権限確認済みであること) */
export async function cancelRecruit(env: LineEnv, gameId: string, userId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET status = 'aborted', result = 'aborted',
            result_reason = '募集を取り消しました', updated_at = datetime('now')
      WHERE id = ? AND status = 'waiting' AND creator_user_id = ?`
  )
    .bind(gameId, userId)
    .run()
  return !!res.meta.changes
}

/** 期限切れの募集を掃除する(遅延評価。cron不要) */
export async function expireStaleRecruits(env: LineEnv, groupId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE chess_games SET status = 'aborted', result = 'aborted',
            result_reason = '募集が期限切れになりました', updated_at = datetime('now')
      WHERE group_id = ? AND status = 'waiting'
        AND expires_at IS NOT NULL AND expires_at < ?`
  )
    .bind(groupId, nowIso())
    .run()
}

/** 駒の選択状態を保存する。version は変えない(手番は進まない)。 */
export async function setSelection(
  env: LineEnv,
  gameId: string,
  version: number,
  square: string,
  token: string
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET sel_square = ?, sel_token = ?, updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing'`
  )
    .bind(square, token, gameId, version)
    .run()
  return !!res.meta.changes
}

/** 未確定の選択だけを解除する */
export async function clearSelection(env: LineEnv, gameId: string, version: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET sel_square = NULL, sel_token = NULL, updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing'`
  )
    .bind(gameId, version)
    .run()
  return !!res.meta.changes
}

/** 昇格待ちにする(まだ指し手は確定しない) */
export async function setPendingPromotion(
  env: LineEnv,
  gameId: string,
  version: number,
  from: string,
  to: string,
  token: string
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games
        SET pending_from = ?, pending_to = ?, pending_token = ?, updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing' AND pending_token IS NULL`
  )
    .bind(from, to, token, gameId, version)
    .run()
  return !!res.meta.changes
}

/**
 * 指し手を確定する。
 *
 * version を条件に入れた条件付きUPDATEにしているため、
 * 同じ指し手が二重に確定することはない(二重タップ・Webhook再送対策)。
 * 確定時に選択状態・昇格待ち・未回答の引き分け提案・投了確認を全て消す。
 */
export async function commitMove(
  env: LineEnv,
  gameId: string,
  expectedVersion: number,
  fen: string,
  moves: string[],
  pgn: string,
  turn: 'w' | 'b',
  over: { result: string; reason: string } | null
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games
        SET current_fen = ?, moves_json = ?, pgn = ?, turn = ?,
            version = version + 1,
            sel_square = NULL, sel_token = NULL,
            pending_from = NULL, pending_to = NULL, pending_token = NULL,
            draw_by = NULL, draw_expires_at = NULL,
            resign_by = NULL, resign_token = NULL, resign_expires_at = NULL,
            status = CASE WHEN ? IS NULL THEN status ELSE 'finished' END,
            result = COALESCE(?, result),
            result_reason = COALESCE(?, result_reason),
            updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing'`
  )
    .bind(
      fen,
      JSON.stringify(moves),
      pgn,
      turn,
      over ? over.result : null,
      over ? over.result : null,
      over ? over.reason : null,
      gameId,
      expectedVersion
    )
    .run()
  return !!res.meta.changes
}

/** 引き分け提案 */
export async function proposeDraw(env: LineEnv, gameId: string, version: number, userId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET draw_by = ?, draw_expires_at = ?, updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing' AND draw_by IS NULL`
  )
    .bind(userId, isoPlusMinutes(5), gameId, version)
    .run()
  return !!res.meta.changes
}

export async function clearDraw(env: LineEnv, gameId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE chess_games SET draw_by = NULL, draw_expires_at = NULL, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(gameId)
    .run()
}

/** 対局を終了させる(投了・合意引き分け・中断) */
export async function finishGame(
  env: LineEnv,
  gameId: string,
  version: number,
  result: string,
  reason: string,
  status: 'finished' | 'aborted' = 'finished'
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games
        SET status = ?, result = ?, result_reason = ?,
            sel_square = NULL, sel_token = NULL,
            pending_from = NULL, pending_to = NULL, pending_token = NULL,
            draw_by = NULL, draw_expires_at = NULL,
            resign_by = NULL, resign_token = NULL, resign_expires_at = NULL,
            version = version + 1,
            updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing'`
  )
    .bind(status, result, reason, gameId, version)
    .run()
  return !!res.meta.changes
}

/** 投了の確認待ちを立てる(本人専用の2段確認) */
export async function setResignPending(
  env: LineEnv,
  gameId: string,
  userId: string,
  token: string
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET resign_by = ?, resign_token = ?, resign_expires_at = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status = 'playing'`
  )
    .bind(userId, token, isoPlusMinutes(5), gameId)
    .run()
  return !!res.meta.changes
}

/** 再戦提案 */
export async function proposeRematch(env: LineEnv, gameId: string, userId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE chess_games SET rematch_by = ?, rematch_expires_at = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'finished' AND rematch_child_id IS NULL`
  )
    .bind(userId, isoPlusMinutes(5), gameId)
    .run()
  return !!res.meta.changes
}

/**
 * 再戦を成立させ、白黒を入れ替えた新しい対局を作る。
 *
 * 連打での重複作成を防ぐため、まず親の rematch_child_id を
 * 条件付きUPDATEで押さえてから子を作る。
 */
export async function acceptRematch(
  env: LineEnv,
  parent: ChessGame
): Promise<{ ok: boolean; child?: ChessGame; reason?: string }> {
  // 別の募集・対局が始まっていたら成立させない
  const active = await getActiveGame(env, parent.group_id)
  if (active) return { ok: false, reason: 'すでに別の対局か募集が始まっています。' }

  const childId = newId()
  const claim = await env.DB.prepare(
    `UPDATE chess_games SET rematch_child_id = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'finished' AND rematch_child_id IS NULL`
  )
    .bind(childId, parent.id)
    .run()
  if (!claim.meta.changes) return { ok: false, reason: 'すでに再戦が作成されています。' }

  // 白黒を入れ替える
  try {
    await env.DB.prepare(
      `INSERT INTO chess_games
        (id, group_id, status, creator_user_id,
         white_user_id, black_user_id, white_name, black_name, white_picture, black_picture,
         start_fen, current_fen, turn)
       VALUES (?, ?, 'playing', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'w')`
    )
      .bind(
        childId,
        parent.group_id,
        parent.rematch_by ?? parent.creator_user_id,
        parent.black_user_id,
        parent.white_user_id,
        parent.black_name,
        parent.white_name,
        parent.black_picture,
        parent.white_picture,
        INITIAL_FEN,
        INITIAL_FEN
      )
      .run()
  } catch {
    // 1グループ1件のUNIQUEに引っかかった場合は押さえを戻す
    await env.DB.prepare(`UPDATE chess_games SET rematch_child_id = NULL WHERE id = ?`)
      .bind(parent.id)
      .run()
    return { ok: false, reason: 'すでに別の対局が始まっています。' }
  }

  const child = await getGameById(env, childId)
  return { ok: true, child: child ?? undefined }
}

/** 対局者の退出・BOT退出時の中断(どちらかの勝ちにはしない) */
export async function abortGamesForGroup(env: LineEnv, groupId: string, reason: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE chess_games SET status = 'aborted', result = 'aborted', result_reason = ?,
            updated_at = datetime('now')
      WHERE group_id = ? AND status IN ('waiting','playing')`
  )
    .bind(reason, groupId)
    .run()
}

export async function abortGamesForUser(env: LineEnv, groupId: string, userId: string, reason: string): Promise<ChessGame | null> {
  const game = await getActiveGame(env, groupId)
  if (!game) return null
  if (game.white_user_id !== userId && game.black_user_id !== userId && game.creator_user_id !== userId) return null
  await env.DB.prepare(
    `UPDATE chess_games SET status = 'aborted', result = 'aborted', result_reason = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status IN ('waiting','playing')`
  )
    .bind(reason, game.id)
    .run()
  return getGameById(env, game.id)
}

// --- Webhookイベントの重複排除 -------------------------------------------

/**
 * すでに処理済みのイベントなら false を返す。
 * PRIMARY KEY の一意制約で、LINEの再送による二重処理を防ぐ。
 */
export async function markEventProcessed(env: LineEnv, eventId: string | null): Promise<boolean> {
  if (!eventId) return true // IDが無いイベントは重複排除できない(処理は続行)
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO chess_processed_events (event_id) VALUES (?)`
    )
      .bind(eventId)
      .run()
    return !!res.meta.changes
  } catch {
    return true
  }
}

// --- 送信箱(DB更新とLINE送信の分離) --------------------------------------

export async function enqueueOutbox(
  env: LineEnv,
  gameId: string,
  groupId: string,
  payload: unknown
): Promise<number | null> {
  try {
    const res = await env.DB.prepare(
      `INSERT INTO chess_outbox (game_id, group_id, payload) VALUES (?, ?, ?)`
    )
      .bind(gameId, groupId, JSON.stringify(payload))
      .run()
    return (res.meta.last_row_id as number) ?? null
  } catch {
    return null
  }
}

export async function markOutboxSent(env: LineEnv, id: number | null): Promise<void> {
  if (id === null) return
  await env.DB.prepare(
    `UPDATE chess_outbox SET state = 'sent', sent_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run()
}

export async function markOutboxFailed(env: LineEnv, id: number | null, error: string): Promise<void> {
  if (id === null) return
  await env.DB.prepare(
    `UPDATE chess_outbox SET state = 'failed', attempts = attempts + 1,
            last_error = ? WHERE id = ?`
  )
    .bind(error.slice(0, 300), id)
    .run()
}
