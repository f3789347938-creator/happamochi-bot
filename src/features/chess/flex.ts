// チェス盤のFlex Message生成。
//
// 【LINEの仕様上できないこと(デザイン画像との差異)】
//  1. 送信済みカードの書き換えはできない。タップした瞬間に同じカードの色が
//     変わる挙動は不可能なので、選択時・移動確定時にそれぞれ新しいカードを
//     送る設計にしている。
//  2. Flex内でHTML/CSS/JSは動かない。影・グラデーション・独自フォントは
//     使えないため、公式に存在するプロパティ(backgroundColor, borderWidth,
//     cornerRadius 等)のみで表現している。
//  3. 画像の重ね合わせ(駒の上にドット)はできないため、空マスの合法手は
//     ドット、駒があるマス(取れる手)は枠、という区別にしている。
//
// 30KB制限に対する実測値: 初期盤面 約21KB / 選択中 約22KB / 最大 約23KB。
import type { LineMessage } from '../../lib/line'
import type { ChessGame } from './store'

export const IVORY = '#F3EEDB'
export const SAGE = '#779677'
export const GOLD = '#D9B45B'
export const DARKBG = '#122D28'
const PANEL = '#1B3F38'
const BOARD_FRAME = '#0E241F'
const DANGER = '#C0392B'
const MUTED = '#8FA894'

const FILES = 'abcdefgh'

const PIECE_FILE: Record<string, string> = {
  P: 'wp', N: 'wn', B: 'wb', R: 'wr', Q: 'wq', K: 'wk',
  p: 'bp', n: 'bn', b: 'bb', r: 'br', q: 'bq', k: 'bk',
}

/** 表示名。取得失敗時の代替名も含む。長すぎる名前は表示上だけ省略する。 */
export function displayName(name: string | null, fallback: string): string {
  const n = (name ?? '').trim()
  if (!n) return fallback
  return n.length > 14 ? `${n.slice(0, 13)}…` : n
}

function initialOf(name: string | null, fallback: string): string {
  const n = (name ?? '').trim() || fallback
  return Array.from(n)[0] ?? '?'
}

export type SquareState = 'sel' | 'dot' | 'cap' | 'check' | null

export interface BoardView {
  /** FEN の盤面部分 */
  fen: string
  selected: string | null
  /** 空マスの合法手 */
  dots: string[]
  /** 駒を取れる合法手 */
  captures: string[]
  /** チェック中のキング */
  checked: string | null
  /** 各マスのpostback data を作る関数。null を返すとタップ不可にする */
  squareToken: (alg: string) => string | null
}

function squareBox(
  alg: string,
  isLight: boolean,
  pieceChar: string | null,
  state: SquareState,
  token: string | null,
  imageBase: string
): Record<string, any> {
  let contents: Record<string, any>[]

  if (state === 'dot' && !pieceChar) {
    // 空マスの合法手 → 中央にゴールドの点
    contents = [
      {
        type: 'box',
        layout: 'vertical',
        width: '28%',
        height: '28%',
        cornerRadius: '999px',
        backgroundColor: GOLD,
        contents: [{ type: 'filler' }],
      },
    ]
  } else if (pieceChar) {
    contents = [
      {
        type: 'image',
        url: `${imageBase}/${PIECE_FILE[pieceChar]}.png`,
        size: 'full',
        aspectMode: 'fit',
      },
    ]
  } else {
    contents = [{ type: 'filler' }]
  }

  const box: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: state === 'sel' ? GOLD : isLight ? IVORY : SAGE,
    contents,
  }

  // 枠での区別: 選択中=ゴールド / 取れる手=ゴールド / チェック=赤
  if (state === 'check') {
    box.borderColor = DANGER
    box.borderWidth = '3px'
  } else if (state === 'cap') {
    box.borderColor = GOLD
    box.borderWidth = '3px'
  } else if (state === 'sel') {
    box.borderColor = '#8A6D1F'
    box.borderWidth = '2px'
  }

  // マス全面をタップ領域にする
  if (token) box.action = { type: 'postback', data: token }

  return box
}

/** 8×8の盤面 + 座標(左8〜1, 下a〜h)。白が下で固定、反転しない。 */
function renderBoard(view: BoardView, imageBase: string): Record<string, any> {
  const ranks = view.fen.split(' ')[0].split('/')
  const rows: Record<string, any>[] = []

  for (let r = 0; r < 8; r++) {
    const rankNum = 8 - r
    const cells: Record<string, any>[] = [
      {
        type: 'box',
        layout: 'vertical',
        width: '13px',
        justifyContent: 'center',
        contents: [{ type: 'text', text: String(rankNum), size: 'xxs', color: MUTED, align: 'center' }],
      },
    ]

    let f = 0
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) {
          cells.push(cell(view, f, rankNum, null, imageBase))
          f++
        }
      } else {
        cells.push(cell(view, f, rankNum, ch, imageBase))
        f++
      }
    }
    rows.push({ type: 'box', layout: 'horizontal', contents: cells, height: '38px', spacing: 'none' })
  }

  // 下端の a〜h
  rows.push({
    type: 'box',
    layout: 'horizontal',
    height: '15px',
    spacing: 'none',
    contents: [
      { type: 'box', layout: 'vertical', width: '13px', contents: [{ type: 'filler' }] },
      ...FILES.split('').map((c) => ({
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: c, size: 'xxs', color: MUTED, align: 'center' }],
      })),
    ],
  })

  return {
    type: 'box',
    layout: 'vertical',
    contents: rows,
    spacing: 'none',
    backgroundColor: BOARD_FRAME,
    paddingAll: 'xs',
    cornerRadius: 'sm',
  }
}

function cell(
  view: BoardView,
  fileIdx: number,
  rankNum: number,
  pieceChar: string | null,
  imageBase: string
): Record<string, any> {
  const alg = FILES[fileIdx] + rankNum
  // a1(file=0,rank=1) が暗色。 (0+1)%2===1 → 暗色 なので isLight は逆
  const isLight = (fileIdx + rankNum) % 2 === 0
  let state: SquareState = null
  if (alg === view.selected) state = 'sel'
  else if (view.captures.includes(alg)) state = 'cap'
  else if (view.dots.includes(alg)) state = 'dot'
  else if (alg === view.checked) state = 'check'

  return squareBox(alg, isLight, pieceChar, state, view.squareToken(alg), imageBase)
}

function playerRow(
  name: string | null,
  fallback: string,
  colorLabel: '白' | '黒',
  picture: string | null,
  isTurn: boolean
): Record<string, any> {
  const avatar: Record<string, any> = picture
    ? {
        type: 'image',
        url: picture,
        size: 'full',
        aspectMode: 'cover',
        aspectRatio: '1:1',
      }
    : {
        type: 'text',
        text: initialOf(name, fallback),
        align: 'center',
        gravity: 'center',
        color: DARKBG,
        weight: 'bold',
        size: 'sm',
      }

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    alignItems: 'center',
    paddingAll: 'sm',
    backgroundColor: PANEL,
    cornerRadius: 'md',
    borderColor: isTurn ? GOLD : PANEL,
    borderWidth: isTurn ? '2px' : '1px',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '32px',
        height: '32px',
        cornerRadius: '999px',
        backgroundColor: SAGE,
        justifyContent: 'center',
        flex: 0,
        contents: [avatar],
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          { type: 'text', text: displayName(name, fallback), color: IVORY, size: 'sm', weight: 'bold', maxLines: 1 },
          { type: 'text', text: colorLabel, color: MUTED, size: 'xxs' },
        ],
      },
      {
        type: 'text',
        text: colorLabel === '黒' ? '●' : '○',
        color: IVORY,
        size: 'lg',
        flex: 0,
        gravity: 'center',
      },
    ],
  }
}

function header(statusLabel: string, imageBase: string): Record<string, any> {
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: DARKBG,
    paddingAll: 'md',
    alignItems: 'center',
    contents: [
      { type: 'image', url: `${imageBase}/wn.png`, width: '18px', flex: 0, aspectMode: 'fit' },
      { type: 'text', text: 'CHESS', color: IVORY, weight: 'bold', size: 'md', flex: 1, margin: 'sm' },
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        cornerRadius: '999px',
        borderColor: GOLD,
        borderWidth: '1px',
        paddingAll: 'xs',
        paddingStart: 'md',
        paddingEnd: 'md',
        contents: [{ type: 'text', text: statusLabel, color: GOLD, size: 'xxs', align: 'center' }],
      },
    ],
  }
}

function noticeBox(title: string, sub?: string): Record<string, any> {
  const contents: Record<string, any>[] = [
    { type: 'text', text: title, color: IVORY, size: 'sm', weight: 'bold', wrap: true },
  ]
  if (sub) contents.push({ type: 'text', text: sub, color: MUTED, size: 'xxs', margin: 'xs', wrap: true })
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: PANEL,
    cornerRadius: 'md',
    paddingAll: 'md',
    contents,
  }
}

function footerButton(label: string, token: string | null): Record<string, any> {
  const box: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    paddingAll: 'sm',
    contents: [{ type: 'text', text: label, size: 'xxs', color: IVORY, align: 'center', wrap: true }],
  }
  if (token) box.action = { type: 'postback', data: token }
  return box
}

// --- 対局中の盤面カード ---------------------------------------------------

export interface BoardCardInput {
  game: ChessGame
  view: BoardView
  statusLabel: string
  noticeTitle: string
  noticeSub?: string
  imageBase: string
  /** フッターの各操作のトークン(権限がなくてもボタン自体は出す) */
  clearToken: string | null
  drawToken: string | null
  resignToken: string | null
  /** 追加で下に置くボタン群(引き分け応答・再戦など) */
  extraButtons?: Record<string, any>[]
}

export function buildBoardCard(input: BoardCardInput): LineMessage {
  const { game, view, imageBase } = input
  const whiteTurn = game.turn === 'w' && game.status === 'playing'
  const blackTurn = game.turn === 'b' && game.status === 'playing'

  const body: Record<string, any>[] = [
    playerRow(game.black_name, '黒のプレイヤー', '黒', game.black_picture, blackTurn),
    renderBoard(view, imageBase),
    playerRow(game.white_name, '白のプレイヤー', '白', game.white_picture, whiteTurn),
    noticeBox(input.noticeTitle, input.noticeSub),
  ]
  if (input.extraButtons?.length) {
    body.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: input.extraButtons })
  }

  const bubble: Record<string, any> = {
    type: 'bubble',
    size: 'giga',
    header: header(input.statusLabel, imageBase),
    body: { type: 'box', layout: 'vertical', backgroundColor: DARKBG, paddingAll: 'md', spacing: 'sm', contents: body },
    footer: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: DARKBG,
      paddingStart: 'sm',
      paddingEnd: 'sm',
      paddingBottom: 'sm',
      spacing: 'sm',
      contents: [
        footerButton('選び直す', input.clearToken),
        footerButton('引き分け提案', input.drawToken),
        footerButton('投了', input.resignToken),
      ],
    },
  }

  return { type: 'flex', altText: buildAltText(game, input.statusLabel), contents: bubble }
}

/** 通知用altText: 対局者・手番・状態を簡潔に */
export function buildAltText(game: ChessGame, statusLabel: string): string {
  const w = displayName(game.white_name, '白')
  const b = displayName(game.black_name, '黒')
  if (game.status === 'playing') {
    const turnName = game.turn === 'w' ? w : b
    return `チェス[${statusLabel}] ${w}(白) vs ${b}(黒) — ${turnName}さんの番`
  }
  if (game.status === 'waiting') return `チェス[${statusLabel}] ${displayName(game.creator_name, '作成者')}さんが対局相手を募集中`
  return `チェス[${statusLabel}] ${w}(白) vs ${b}(黒)`
}

// --- 募集カード -----------------------------------------------------------

export function buildRecruitCard(
  game: ChessGame,
  imageBase: string,
  joinToken: string,
  cancelToken: string,
  note?: string
): LineMessage {
  const name = displayName(game.creator_name, '作成者')
  const contents: Record<string, any>[] = [
    noticeBox(`${name}さんが対局相手を募集中`, '同じグループの別の人が「対局に参加」を押すと開始します。白黒はランダムで決まります。'),
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: GOLD,
          cornerRadius: 'md',
          paddingAll: 'md',
          action: { type: 'postback', data: joinToken },
          contents: [{ type: 'text', text: '対局に参加', size: 'sm', weight: 'bold', color: DARKBG, align: 'center' }],
        },
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: PANEL,
          cornerRadius: 'md',
          paddingAll: 'md',
          action: { type: 'postback', data: cancelToken },
          contents: [{ type: 'text', text: '募集を取り消す', size: 'sm', color: IVORY, align: 'center' }],
        },
      ],
    },
    { type: 'text', text: '募集は10分で期限切れになります。', size: 'xxs', color: MUTED, margin: 'md', wrap: true },
  ]
  if (note) contents.push({ type: 'text', text: note, size: 'xxs', color: GOLD, margin: 'sm', wrap: true })

  return {
    type: 'flex',
    altText: `チェス[募集中] ${name}さんが対局相手を募集中`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: header('募集中', imageBase),
      body: { type: 'box', layout: 'vertical', backgroundColor: DARKBG, paddingAll: 'md', contents },
    },
  }
}

// --- 昇格選択カード -------------------------------------------------------

export function buildPromotionCard(
  game: ChessGame,
  imageBase: string,
  from: string,
  to: string,
  tokenFor: (piece: string) => string
): LineMessage {
  const mover = game.turn === 'w' ? game.white_name : game.black_name
  const name = displayName(mover, game.turn === 'w' ? '白' : '黒')
  const prefix = game.turn === 'w' ? 'w' : 'b'
  const choices: [string, string][] = [
    ['q', 'クイーン'],
    ['r', 'ルーク'],
    ['b', 'ビショップ'],
    ['n', 'ナイト'],
  ]

  return {
    type: 'flex',
    altText: `チェス[昇格待ち] ${name}さんがポーンの昇格先を選択中`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: header('昇格待ち', imageBase),
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: DARKBG,
        paddingAll: 'md',
        contents: [
          noticeBox(`${name}：昇格する駒を選んでください`, `${from} → ${to}。選択するまで指し手は確定せず、相手の手番になりません。`),
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            margin: 'md',
            contents: choices.map(([p, label]) => ({
              type: 'box',
              layout: 'vertical',
              backgroundColor: PANEL,
              cornerRadius: 'md',
              paddingAll: 'sm',
              alignItems: 'center',
              action: { type: 'postback', data: tokenFor(p) },
              contents: [
                { type: 'image', url: `${imageBase}/${prefix}${p}.png`, width: '28px', aspectMode: 'fit' },
                { type: 'text', text: label, size: 'xxs', color: IVORY, align: 'center', margin: 'sm', wrap: true },
              ],
            })),
          },
        ],
      },
    },
  }
}

// --- 汎用のボタン(引き分け応答・再戦・投了確認) ---------------------------

export function actionButton(label: string, token: string, primary = false): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: primary ? GOLD : PANEL,
    cornerRadius: 'md',
    paddingAll: 'sm',
    action: { type: 'postback', data: token },
    contents: [
      {
        type: 'text',
        text: label,
        size: 'xs',
        weight: primary ? 'bold' : 'regular',
        color: primary ? DARKBG : IVORY,
        align: 'center',
        wrap: true,
      },
    ],
  }
}
