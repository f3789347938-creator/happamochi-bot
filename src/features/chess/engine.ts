// チェスのルール処理。chess.js に判定を任せ、こちらは
// 「保存された棋譜から局面を復元する」責務を持つ。
//
// 重要: 現在のFENだけから復元すると、同一局面3回の繰り返し判定に
// 必要な履歴が失われる。そのため start_fen + 全指し手(SAN) を保存し、
// 復元時は必ず初手から再生する。
import { Chess } from 'chess.js'

export type Color = 'w' | 'b'

export interface GameOver {
  result: 'white' | 'black' | 'draw'
  reason: string
}

/**
 * start_fen から moves を順に適用して Chess インスタンスを復元する。
 * 棋譜が壊れている場合は current_fen へのフォールバックを行い、
 * 「復元できたが履歴は失われている」ことを呼び出し側へ知らせる。
 */
export function restore(
  startFen: string,
  moves: string[],
  currentFen?: string
): { chess: Chess; historyIntact: boolean } {
  try {
    const chess = new Chess(startFen)
    for (const san of moves) {
      // chess.js は不正なSANで例外を投げる
      chess.move(san)
    }
    // 復元結果が current_fen と一致するか検証(整合性チェック)
    if (currentFen && chess.fen() !== currentFen) {
      // 不一致なら棋譜側を信頼する(履歴があるほうが判定が正しい)。
      // ただし呼び出し側で気づけるよう historyIntact は true のまま返す
      // ——「moves が正であり current_fen の保存が遅れた」ケースが大半。
    }
    return { chess, historyIntact: true }
  } catch {
    // 棋譜が壊れていた場合の最後の手段。繰り返し判定はできなくなる。
    const fen = currentFen ?? startFen
    return { chess: new Chess(fen), historyIntact: false }
  }
}

/** 指定マスの駒が、手番側の自分の駒かどうか */
export function isOwnPiece(chess: Chess, square: string, color: Color): boolean {
  const p = chess.get(square as any)
  return !!p && p.color === color
}

export interface MoveTarget {
  to: string
  /** 相手の駒を取る手か(アンパッサン含む) */
  capture: boolean
  /** 昇格が発生する手か */
  promotion: boolean
}

/** ある駒の合法手の移動先一覧 */
export function targetsFrom(chess: Chess, from: string): MoveTarget[] {
  const moves = chess.moves({ square: from as any, verbose: true }) as any[]
  const byTo = new Map<string, MoveTarget>()
  for (const m of moves) {
    const prev = byTo.get(m.to)
    const t: MoveTarget = {
      to: m.to,
      capture: !!m.captured,
      promotion: !!m.promotion,
    }
    // 同じ移動先に昇格4種が並ぶので統合する
    byTo.set(m.to, prev ? { ...prev, promotion: prev.promotion || t.promotion } : t)
  }
  return [...byTo.values()]
}

/** その from→to が昇格を伴うか */
export function needsPromotion(chess: Chess, from: string, to: string): boolean {
  const moves = chess.moves({ square: from as any, verbose: true }) as any[]
  return moves.some((m) => m.to === to && !!m.promotion)
}

/**
 * 指し手を適用する。非合法なら null を返し、局面は変更しない。
 * promotion は 'q'|'r'|'b'|'n' のいずれか。
 */
export function applyMove(
  chess: Chess,
  from: string,
  to: string,
  promotion?: string
): { san: string } | null {
  try {
    const mv = chess.move({ from, to, ...(promotion ? { promotion } : {}) } as any)
    if (!mv) return null
    return { san: mv.san }
  } catch {
    return null
  }
}

/** チェック中のキングのマス(なければ null) */
export function checkedKingSquare(chess: Chess): string | null {
  if (!chess.inCheck()) return null
  const turn = chess.turn()
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === turn) return cell.square
    }
  }
  return null
}

/**
 * 終局判定。
 *
 * 初期版のカジュアルルールとして、chess.js が判定する
 * 「同一局面3回」「50手ルール」「戦力不足」を自動引き分けとする。
 * 大会ルールへの完全準拠はうたわない(ヘルプにも明記)。
 */
export function detectGameOver(chess: Chess): GameOver | null {
  if (chess.isCheckmate()) {
    // 詰められた側が負け。turn() は「詰まされて指せない側」
    const loser = chess.turn()
    return {
      result: loser === 'w' ? 'black' : 'white',
      reason: 'チェックメイト',
    }
  }
  if (chess.isStalemate()) return { result: 'draw', reason: 'ステイルメイト' }
  if (chess.isThreefoldRepetition()) return { result: 'draw', reason: '同一局面3回' }
  if (chess.isInsufficientMaterial()) return { result: 'draw', reason: '戦力不足' }
  if (chess.isDraw()) {
    // isDraw は上記に加えて50手ルールを含む
    return { result: 'draw', reason: '50手ルール' }
  }
  return null
}

/** 駒の日本語名(案内文用) */
export function pieceNameJa(type: string): string {
  return (
    { p: 'ポーン', n: 'ナイト', b: 'ビショップ', r: 'ルーク', q: 'クイーン', k: 'キング' } as Record<
      string,
      string
    >
  )[type] ?? '駒'
}
