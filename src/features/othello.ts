// "オセロ" (Othello/Reversi) feature.
//
// The board is rendered as a Flex Message: each of the 64 cells is a `box`
// component with `backgroundColor` (board green, or a lighter green to mark
// a legal move) and, only on cells that are a legal move for whoever's turn
// it currently is, a `postback` action carrying the cell's coordinates.
// Tapping a cell fires a `postback` webhook event (with its own replyToken),
// which is how we apply the move and reply with the updated board — no
// Push API involved anywhere.
//
// One active game per group (group_id is the primary key of othello_games).
import type { LineEnv, LineMessage } from '../lib/line'

const SIZE = 8
type Cell = '.' | 'B' | 'W'
type Color = 'B' | 'W'

export interface OthelloGame {
  group_id: string
  board: string
  turn: Color
  black_user_id: string
  black_name: string | null
  white_user_id: string | null
  white_name: string | null
  status: 'waiting' | 'playing' | 'finished'
}

function idx(r: number, c: number) {
  return r * SIZE + c
}

function initialBoard(): string {
  const b = new Array(SIZE * SIZE).fill('.') as Cell[]
  b[idx(3, 3)] = 'W'
  b[idx(3, 4)] = 'B'
  b[idx(4, 3)] = 'B'
  b[idx(4, 4)] = 'W'
  return b.join('')
}

function opponent(color: Color): Color {
  return color === 'B' ? 'W' : 'B'
}

const DIRECTIONS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]

// Returns the list of [row, col] cells that would be flipped if `color`
// plays at (r, c), or null if that move is illegal (occupied cell, or no
// opponent line gets bracketed in any of the 8 directions).
function flipsForMove(board: string, color: Color, r: number, c: number): [number, number][] | null {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null
  if (board[idx(r, c)] !== '.') return null
  const opp = opponent(color)
  const allFlips: [number, number][] = []

  for (const [dr, dc] of DIRECTIONS) {
    const line: [number, number][] = []
    let nr = r + dr
    let nc = c + dc
    while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[idx(nr, nc)] === opp) {
      line.push([nr, nc])
      nr += dr
      nc += dc
    }
    if (line.length > 0 && nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[idx(nr, nc)] === color) {
      allFlips.push(...line)
    }
  }

  return allFlips.length > 0 ? allFlips : null
}

function legalMoves(board: string, color: Color): [number, number][] {
  const moves: [number, number][] = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (flipsForMove(board, color, r, c)) moves.push([r, c])
    }
  }
  return moves
}

function hasLegalMove(board: string, color: Color): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (flipsForMove(board, color, r, c)) return true
    }
  }
  return false
}

function applyMoveOnBoard(board: string, color: Color, r: number, c: number): string {
  const flips = flipsForMove(board, color, r, c)
  if (!flips) throw new Error('illegal move')
  const cells = board.split('') as Cell[]
  cells[idx(r, c)] = color
  for (const [fr, fc] of flips) cells[idx(fr, fc)] = color
  return cells.join('')
}

function countPieces(board: string): { black: number; white: number } {
  let black = 0
  let white = 0
  for (const ch of board) {
    if (ch === 'B') black++
    else if (ch === 'W') white++
  }
  return { black, white }
}

export async function getGame(env: LineEnv, groupId: string): Promise<OthelloGame | null> {
  const row = await env.DB.prepare(`SELECT * FROM othello_games WHERE group_id = ?`)
    .bind(groupId)
    .first<OthelloGame>()
  return row ?? null
}

export async function startGame(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string | null
): Promise<{ ok: true; game: OthelloGame } | { ok: false; reason: string }> {
  const existing = await getGame(env, groupId)
  if (existing && existing.status !== 'finished') {
    return { ok: false, reason: '既にオセロが進行中です。「オセロ終了」で終了できます。' }
  }

  const game: OthelloGame = {
    group_id: groupId,
    board: initialBoard(),
    turn: 'B',
    black_user_id: userId,
    black_name: displayName,
    white_user_id: null,
    white_name: null,
    status: 'waiting',
  }

  await env.DB.prepare(
    `INSERT INTO othello_games (group_id, board, turn, black_user_id, black_name, white_user_id, white_name, status)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, 'waiting')
     ON CONFLICT(group_id) DO UPDATE SET
       board = excluded.board,
       turn = excluded.turn,
       black_user_id = excluded.black_user_id,
       black_name = excluded.black_name,
       white_user_id = NULL,
       white_name = NULL,
       status = 'waiting',
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(groupId, game.board, game.turn, userId, displayName)
    .run()

  return { ok: true, game }
}

export async function joinGame(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string | null
): Promise<{ ok: true; game: OthelloGame } | { ok: false; reason: string }> {
  const game = await getGame(env, groupId)
  if (!game) return { ok: false, reason: '進行中のオセロがありません。「オセロ開始」で開始できます。' }
  if (game.status !== 'waiting') return { ok: false, reason: '今は参加を受け付けていません。' }
  if (game.black_user_id === userId) return { ok: false, reason: '自分自身とは対局できません。他の人が「オセロ参加」と送ってください。' }

  await env.DB.prepare(
    `UPDATE othello_games SET white_user_id = ?, white_name = ?, status = 'playing', updated_at = CURRENT_TIMESTAMP
     WHERE group_id = ?`
  )
    .bind(userId, displayName, groupId)
    .run()

  game.white_user_id = userId
  game.white_name = displayName
  game.status = 'playing'
  return { ok: true, game }
}

export async function endGame(
  env: LineEnv,
  groupId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const game = await getGame(env, groupId)
  if (!game) return { ok: false, reason: '進行中のオセロがありません。' }
  if (game.black_user_id !== userId && game.white_user_id !== userId) {
    return { ok: false, reason: '対局者のみ終了できます。' }
  }
  await env.DB.prepare(`DELETE FROM othello_games WHERE group_id = ?`).bind(groupId).run()
  return { ok: true }
}

// Applies a move by `userId` at (row, col). Handles turn validation, illegal
// move rejection, auto-pass when the next player has no legal move, and
// game-end detection (finished status kept until the next "オセロ開始").
export async function applyMove(
  env: LineEnv,
  groupId: string,
  userId: string,
  row: number,
  col: number
): Promise<{ ok: true; game: OthelloGame; note?: string } | { ok: false; reason: string }> {
  const game = await getGame(env, groupId)
  if (!game) return { ok: false, reason: '進行中のオセロがありません。' }
  if (game.status !== 'playing') return { ok: false, reason: 'このオセロは対局中ではありません。' }

  const myColor: Color | null =
    userId === game.black_user_id ? 'B' : userId === game.white_user_id ? 'W' : null
  if (!myColor) return { ok: false, reason: 'この対局の参加者ではありません。' }
  if (myColor !== game.turn) return { ok: false, reason: '相手の番です。' }

  const flips = flipsForMove(game.board, myColor, row, col)
  if (!flips) return { ok: false, reason: 'そこには置けません。' }

  let board = applyMoveOnBoard(game.board, myColor, row, col)
  let turn = opponent(myColor)
  let status: OthelloGame['status'] = 'playing'
  let note: string | undefined

  if (!hasLegalMove(board, turn)) {
    if (!hasLegalMove(board, myColor)) {
      status = 'finished'
    } else {
      note = `${turn === 'B' ? '黒' : '白'}は置ける場所がないため、パスされました。`
      turn = myColor
    }
  }

  await env.DB.prepare(
    `UPDATE othello_games SET board = ?, turn = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`
  )
    .bind(board, turn, status, groupId)
    .run()

  game.board = board
  game.turn = turn
  game.status = status
  return { ok: true, game, note }
}

// ─── Flex Message rendering ───

const BOARD_COLOR = '#2e7d32'
const LEGAL_COLOR = '#66bb6a'
const CELL_PX = 40
const STONE_PX = 32
const STONE_PAD = (CELL_PX - STONE_PX) / 2

function renderCell(cell: Cell, legal: boolean, r: number, c: number): Record<string, any> {
  if (cell === '.') {
    const box: Record<string, any> = {
      type: 'box',
      layout: 'vertical',
      contents: [],
      width: `${CELL_PX}px`,
      height: `${CELL_PX}px`,
      backgroundColor: legal ? LEGAL_COLOR : BOARD_COLOR,
    }
    if (legal) {
      box.action = { type: 'postback', data: `othello:${r},${c}` }
    }
    return box
  }

  const stoneColor = cell === 'B' ? '#111111' : '#f5f5f5'
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        contents: [],
        width: `${STONE_PX}px`,
        height: `${STONE_PX}px`,
        cornerRadius: `${STONE_PX / 2}px`,
        backgroundColor: stoneColor,
      },
    ],
    width: `${CELL_PX}px`,
    height: `${CELL_PX}px`,
    backgroundColor: BOARD_COLOR,
    paddingAll: `${STONE_PAD}px`,
  }
}

function renderBoard(game: OthelloGame): Record<string, any> {
  const legal = game.status === 'playing' ? new Set(legalMoves(game.board, game.turn).map(([r, c]) => `${r},${c}`)) : new Set<string>()
  const rows: Record<string, any>[] = []
  for (let r = 0; r < SIZE; r++) {
    const cells: Record<string, any>[] = []
    for (let c = 0; c < SIZE; c++) {
      const cell = game.board[idx(r, c)] as Cell
      cells.push(renderCell(cell, legal.has(`${r},${c}`), r, c))
    }
    rows.push({ type: 'box', layout: 'horizontal', contents: cells, spacing: 'none' })
  }
  return {
    type: 'box',
    layout: 'vertical',
    contents: rows,
    backgroundColor: '#1b5e20',
    paddingAll: '4px',
    cornerRadius: 'sm',
  }
}

function statusText(game: OthelloGame): string {
  const { black, white } = countPieces(game.board)
  const blackName = game.black_name ?? '黒番'
  const whiteName = game.white_name ?? '白番'

  if (game.status === 'waiting') {
    return `対局相手を待っています\n⚫${blackName}\n「オセロ参加」で参加できます`
  }
  if (game.status === 'finished') {
    let result: string
    if (black > white) result = `⚫${blackName} の勝ち！`
    else if (white > black) result = `⚪${whiteName} の勝ち！`
    else result = '引き分け！'
    return `対局終了\n⚫${black} - ${white}⚪\n${result}`
  }
  const turnName = game.turn === 'B' ? blackName : whiteName
  const turnMark = game.turn === 'B' ? '⚫' : '⚪'
  return `⚫${black} - ${white}⚪\n${turnMark} ${turnName} の番です`
}

export function buildOthelloMessage(game: OthelloGame, note?: string): LineMessage {
  const contents: Record<string, any>[] = [
    { type: 'text', text: statusText(game), wrap: true, weight: 'bold', size: 'sm' },
  ]
  if (note) {
    contents.push({ type: 'text', text: note, wrap: true, size: 'xs', color: '#888888' })
  }
  contents.push(renderBoard(game))

  return {
    type: 'flex',
    altText: 'オセロ',
    contents: {
      type: 'bubble',
      size: 'giga',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents,
      },
    },
  }
}
