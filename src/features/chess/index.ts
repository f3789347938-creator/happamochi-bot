// チェス機能の入口。テキストコマンドとPostbackを処理する。
//
// 【本人確認について】
// 操作者は必ず署名検証済みWebhookの source.userId で判定する。
// Postback data に入れた文字列は「どの対局・どの局面・どの選択に対する
// 操作か」の照合にだけ使い、本人確認には一切使わない。
// userId が取れない場合は参加・移動などを許可しない。
import type { LineEnv, LineMessage } from '../../lib/line'
import { getProfile } from '../../lib/line'
import {
  actionButton,
  buildBoardCard,
  buildPromotionCard,
  buildRecruitCard,
  displayName,
  type BoardView,
} from './flex'
import {
  applyMove,
  checkedKingSquare,
  detectGameOver,
  isOwnPiece,
  needsPromotion,
  pieceNameJa,
  restore,
  targetsFrom,
} from './engine'
import {
  abortGamesForGroup,
  abortGamesForUser,
  acceptRematch,
  cancelRecruit,
  clearDraw,
  clearSelection,
  commitMove,
  createRecruit,
  expireStaleRecruits,
  finishGame,
  getActiveGame,
  getGameById,
  getLastFinished,
  isExpired,
  joinGame,
  newToken,
  parseMoves,
  proposeDraw,
  proposeRematch,
  setPendingPromotion,
  setResignPending,
  setSelection,
  type ChessGame,
} from './store'

/** 駒画像の配信ベースURL(HTTPS) */
function imageBase(baseUrl: string): string {
  return `${baseUrl}/static/chess`
}

// --- Postback data の組み立て -------------------------------------------
// 300文字制限に対し、実測は最長でも約40文字。
// 形式: 種別|対局ID|局面version|付加情報
// 付加情報には座標や短いトークンだけを入れ、userIdや表示名は入れない。

const T = {
  join: (g: string) => `cj|${g}`,
  cancel: (g: string) => `cx|${g}`,
  select: (g: string, v: number, sq: string) => `cs|${g}|${v}|${sq}`,
  move: (g: string, v: number, tok: string, sq: string) => `cm|${g}|${v}|${tok}|${sq}`,
  clear: (g: string, v: number) => `cc|${g}|${v}`,
  promo: (g: string, v: number, tok: string, p: string) => `cp|${g}|${v}|${tok}|${p}`,
  drawOffer: (g: string, v: number) => `cd|${g}|${v}`,
  drawAccept: (g: string, v: number) => `cda|${g}|${v}`,
  drawDecline: (g: string, v: number) => `cdd|${g}|${v}`,
  resignAsk: (g: string, v: number) => `cr|${g}|${v}`,
  resignYes: (g: string, tok: string) => `cry|${g}|${tok}`,
  rematchOffer: (g: string) => `cro|${g}`,
  rematchAccept: (g: string) => `cra|${g}`,
} as const

export interface ChessCtx {
  groupId: string
  userId: string | null
  baseUrl: string
}

// --- 盤面カードの生成 -----------------------------------------------------

function buildViewForGame(game: ChessGame, opts?: { note?: string }): {
  view: BoardView
  noticeTitle: string
  noticeSub?: string
} {
  const moves = parseMoves(game)
  const { chess } = restore(game.start_fen, moves, game.current_fen)
  const turnName = game.turn === 'w'
    ? displayName(game.white_name, '白')
    : displayName(game.black_name, '黒')

  let dots: string[] = []
  let captures: string[] = []
  let noticeTitle: string
  let noticeSub: string | undefined

  if (game.sel_square) {
    const targets = targetsFrom(chess, game.sel_square)
    dots = targets.filter((t) => !t.capture).map((t) => t.to)
    captures = targets.filter((t) => t.capture).map((t) => t.to)
    const piece = chess.get(game.sel_square as any)
    noticeTitle = '移動先をタップ'
    noticeSub = `${turnName}：${game.sel_square} の${piece ? pieceNameJa(piece.type) : '駒'}を選択中`
  } else {
    noticeTitle = `${turnName}さんの番`
    noticeSub = '動かす駒をタップしてください。'
  }

  if (chess.inCheck()) {
    noticeSub = `${noticeSub ?? ''}${noticeSub ? ' / ' : ''}チェックされています。`
  }
  if (game.draw_by && !isExpired(game.draw_expires_at)) {
    const proposer = game.draw_by === game.white_user_id
      ? displayName(game.white_name, '白')
      : displayName(game.black_name, '黒')
    noticeSub = `${noticeSub ?? ''} / ${proposer}さんが引き分けを提案中`
  }
  if (opts?.note) noticeSub = opts.note

  const view: BoardView = {
    fen: game.current_fen,
    selected: game.sel_square,
    dots,
    captures,
    checked: checkedKingSquare(chess),
    squareToken: (alg) => {
      if (game.status !== 'playing') return null
      if (game.sel_square) {
        // 選択中: 移動先 or 別の駒の選択
        if (dots.includes(alg) || captures.includes(alg)) {
          return T.move(game.id, game.version, game.sel_token ?? '0', alg)
        }
        return T.select(game.id, game.version, alg)
      }
      return T.select(game.id, game.version, alg)
    },
  }

  return { view, noticeTitle, noticeSub }
}

function boardMessage(game: ChessGame, baseUrl: string, note?: string): LineMessage {
  const { view, noticeTitle, noticeSub } = buildViewForGame(game, { note })
  const extra: Record<string, any>[] = []

  // 引き分け提案中は応答ボタンを出す(権限はサーバー側で判定)
  if (game.status === 'playing' && game.draw_by && !isExpired(game.draw_expires_at)) {
    extra.push(
      actionButton('引き分けを承諾', T.drawAccept(game.id, game.version), true),
      actionButton('拒否', T.drawDecline(game.id, game.version))
    )
  }
  // 投了確認待ち
  if (game.status === 'playing' && game.resign_token && !isExpired(game.resign_expires_at)) {
    const who = game.resign_by === game.white_user_id
      ? displayName(game.white_name, '白')
      : displayName(game.black_name, '黒')
    extra.push(actionButton(`${who}さん：投了を確定`, T.resignYes(game.id, game.resign_token), true))
  }

  return buildBoardCard({
    game,
    view,
    statusLabel: '対局中',
    noticeTitle,
    noticeSub,
    imageBase: imageBase(baseUrl),
    clearToken: game.sel_square ? T.clear(game.id, game.version) : null,
    drawToken: T.drawOffer(game.id, game.version),
    resignToken: T.resignAsk(game.id, game.version),
    extraButtons: extra.length ? extra : undefined,
  })
}

function resultMessage(game: ChessGame, baseUrl: string, note?: string): LineMessage {
  const { view } = buildViewForGame(game)
  const w = displayName(game.white_name, '白')
  const b = displayName(game.black_name, '黒')
  let title: string
  if (game.result === 'white') title = `${w}さん(白)の勝ち`
  else if (game.result === 'black') title = `${b}さん(黒)の勝ち`
  else if (game.result === 'draw') title = '引き分け'
  else title = '対局中断'

  const extra: Record<string, any>[] = []
  if (game.status === 'finished' && !game.rematch_child_id) {
    if (game.rematch_by && !isExpired(game.rematch_expires_at)) {
      extra.push(actionButton('再戦を承諾', T.rematchAccept(game.id), true))
    } else {
      extra.push(actionButton('再戦を提案', T.rematchOffer(game.id)))
    }
  }

  return buildBoardCard({
    game,
    view: { ...view, squareToken: () => null },
    statusLabel: game.status === 'aborted' ? '中断' : '終局',
    noticeTitle: title,
    noticeSub: note ?? game.result_reason ?? undefined,
    imageBase: imageBase(baseUrl),
    clearToken: null,
    drawToken: null,
    resignToken: null,
    extraButtons: extra.length ? extra : undefined,
  })
}

function recruitMessage(game: ChessGame, baseUrl: string, note?: string): LineMessage {
  return buildRecruitCard(game, imageBase(baseUrl), T.join(game.id), T.cancel(game.id), note)
}

function text(t: string): LineMessage {
  return { type: 'text', text: t }
}

const HELP = `チェス（グループ対局）の使い方

【はじめる】
「チェス」… 対局相手の募集カードを出します
別の人が「対局に参加」を押すと開始（白黒はランダム）
募集は10分で期限切れ。作成者だけが取り消せます

【指す】
1. 手番の人が自分の駒をタップ
2. 表示された移動先（点＝移動、枠＝駒を取る）をタップで確定
・駒を選んだだけでは手番は進みません
・別の自分の駒を押せば選択を変更できます
・「選び直す」で未確定の選択だけ解除します

【盤面を見る】
「チェス」または「盤面」… 現在の盤面を再送します

【終わり方】
・チェックメイト／ステイルメイト
・投了（本人の確認操作が必要）
・引き分け提案 → 相手が承諾したときのみ成立

【採用ルール（初期版のカジュアルルール）】
・通常移動、駒の取得、キャスリング、アンパッサン、
　チェック、チェックメイト、ステイルメイトに対応
・ポーン昇格はクイーン／ルーク／ビショップ／ナイトから選択
・同一局面3回、50手ルール、戦力不足は自動で引き分け
・時間制限はありません
※厳密な大会ルールへの完全準拠はうたっていません

【その他】
・1グループにつき募集中／対局中は1件です
・終局後は「再戦を提案」で白黒を入れ替えて再戦できます（5分で失効）`

// --- テキストコマンド -----------------------------------------------------

/**
 * テキストコマンドを処理する。該当しなければ null を返す
 * (= 無関係な会話には反応しない)。
 */
export async function handleChessText(
  env: LineEnv,
  ctx: ChessCtx,
  raw: string
): Promise<LineMessage[] | null> {
  const t = raw.trim()

  if (t === 'チェス ヘルプ' || t === 'チェスヘルプ') return [text(HELP)]

  const isBoardCmd = t === '盤面'
  const isChessCmd = t === 'チェス'
  if (!isBoardCmd && !isChessCmd) return null

  // 期限切れの募集を先に掃除する(再起動後も期限が効くようDB基準で判定)
  await expireStaleRecruits(env, ctx.groupId)

  const active = await getActiveGame(env, ctx.groupId)

  // 対局中/募集中は「再送」のみ。新規作成も選択状態の変更もしない。
  if (active) {
    if (active.status === 'playing') return [boardMessage(active, ctx.baseUrl)]
    const withName = await withCreatorName(env, ctx, active)
    return [recruitMessage(withName, ctx.baseUrl)]
  }

  if (isBoardCmd) {
    const last = await getLastFinished(env, ctx.groupId)
    if (last) return [resultMessage(last, ctx.baseUrl)]
    return [text('現在この グループでは対局していません。「チェス」で募集できます。')]
  }

  // 「チェス」で新規募集
  if (!ctx.userId) return [text('募集を作成できませんでした。ユーザー情報が取得できません。')]

  const created = await createRecruit(env, ctx.groupId, ctx.userId)
  if (!created) {
    const again = await getActiveGame(env, ctx.groupId)
    if (again?.status === 'playing') return [boardMessage(again, ctx.baseUrl)]
    if (again) return [recruitMessage(await withCreatorName(env, ctx, again), ctx.baseUrl)]
    return [text('募集を作成できませんでした。もう一度お試しください。')]
  }
  return [recruitMessage(await withCreatorName(env, ctx, created), ctx.baseUrl)]
}

/** 募集カード表示用に作成者名を補完する(DBには保存しない) */
async function withCreatorName(env: LineEnv, ctx: ChessCtx, game: ChessGame): Promise<ChessGame> {
  if (game.creator_name !== undefined) return game
  const p = await safeProfile(env, game.creator_user_id, ctx.groupId)
  return { ...game, creator_name: p.name }
}

/** プロフィール取得。失敗しても対局を続けられるよう例外を出さない。 */
async function safeProfile(
  env: LineEnv,
  userId: string,
  groupId: string
): Promise<{ name: string | null; picture: string | null }> {
  try {
    const p = await getProfile(env, userId, groupId)
    return { name: p?.displayName ?? null, picture: p?.pictureUrl ?? null }
  } catch {
    return { name: null, picture: null }
  }
}

// --- Postback -------------------------------------------------------------

/**
 * Postbackを処理する。チェス以外の data なら null を返す。
 *
 * 全ての操作で、送信元グループ・対局ID・状態・操作権限・手番を
 * サーバー側で照合する。
 */
export async function handleChessPostback(
  env: LineEnv,
  ctx: ChessCtx,
  data: string
): Promise<LineMessage[] | null> {
  if (!/^c[a-z]{1,2}\|/.test(data)) return null

  const parts = data.split('|')
  const kind = parts[0]

  // userId が取れない場合はいかなる操作も許可しない
  if (!ctx.userId) return [text('操作できませんでした。ユーザー情報が取得できません。')]
  const me = ctx.userId

  const gameId = parts[1]
  if (!gameId) return [text('不正な操作です。')]

  const game = await getGameById(env, gameId)
  if (!game) return [text('対局が見つかりません。')]

  // 別グループのカードからの操作を拒否
  if (game.group_id !== ctx.groupId) return [text('この対局はこのグループのものではありません。')]

  switch (kind) {
    case 'cj':
      return handleJoin(env, ctx, game, me)
    case 'cx':
      return handleCancel(env, ctx, game, me)
    case 'cs':
      return handleSelect(env, ctx, game, me, Number(parts[2]), parts[3])
    case 'cm':
      return handleMove(env, ctx, game, me, Number(parts[2]), parts[3], parts[4])
    case 'cc':
      return handleClear(env, ctx, game, me, Number(parts[2]))
    case 'cp':
      return handlePromotion(env, ctx, game, me, Number(parts[2]), parts[3], parts[4])
    case 'cd':
      return handleDrawOffer(env, ctx, game, me, Number(parts[2]))
    case 'cda':
      return handleDrawAccept(env, ctx, game, me, Number(parts[2]))
    case 'cdd':
      return handleDrawDecline(env, ctx, game, me, Number(parts[2]))
    case 'cr':
      return handleResignAsk(env, ctx, game, me, Number(parts[2]))
    case 'cry':
      return handleResignYes(env, ctx, game, me, parts[2])
    case 'cro':
      return handleRematchOffer(env, ctx, game, me)
    case 'cra':
      return handleRematchAccept(env, ctx, game, me)
    default:
      return [text('不明な操作です。')]
  }
}

function isPlayer(game: ChessGame, userId: string): boolean {
  return game.white_user_id === userId || game.black_user_id === userId
}

function playerColor(game: ChessGame, userId: string): 'w' | 'b' | null {
  if (game.white_user_id === userId) return 'w'
  if (game.black_user_id === userId) return 'b'
  return null
}

/** 古いカードからの操作。連打で同じ案内を大量に送らないため簡潔に1通だけ返す。 */
function staleNotice(): LineMessage[] {
  return [text('このカードは古い状態です。「盤面」と送ると最新の盤面が表示されます。')]
}

async function handleJoin(env: LineEnv, ctx: ChessCtx, game: ChessGame, me: string): Promise<LineMessage[]> {
  if (game.status !== 'waiting') {
    if (game.status === 'playing') return [text('すでに対局が始まっています。')]
    return [text('この募集は終了しています。')]
  }
  if (isExpired(game.expires_at)) {
    await expireStaleRecruits(env, ctx.groupId)
    return [text('この募集は期限切れです。「チェス」で新しく募集できます。')]
  }
  // 自分の募集への重複参加を拒否
  if (game.creator_user_id === me) return [text('自分の募集には参加できません。他の人の参加をお待ちください。')]

  const creatorProfile = await safeProfile(env, game.creator_user_id, ctx.groupId)
  const joinerProfile = await safeProfile(env, me, ctx.groupId)

  // 同時参加でも1人だけ確定する(条件付きUPDATE)
  const started = await joinGame(env, game.id, me, creatorProfile, joinerProfile)
  if (!started) {
    const cur = await getGameById(env, game.id)
    if (cur?.status === 'playing') return [text('ほぼ同時に別の人が参加しました。次の対局をお待ちください。')]
    return [text('参加できませんでした。')]
  }
  return [boardMessage(started, ctx.baseUrl)]
}

async function handleCancel(env: LineEnv, ctx: ChessCtx, game: ChessGame, me: string): Promise<LineMessage[]> {
  if (game.status !== 'waiting') return [text('この募集はすでに終了しています。')]
  // 取消は作成者だけ
  if (game.creator_user_id !== me) return [text('募集を取り消せるのは作成者だけです。')]
  const ok = await cancelRecruit(env, game.id, me)
  return [text(ok ? '募集を取り消しました。' : '取り消しできませんでした。')]
}

async function handleSelect(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number,
  square: string
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  if (game.pending_token) return [text('昇格する駒の選択が完了していません。')]

  const color = playerColor(game, me)
  // 盤面操作は現在の手番の本人だけ
  if (!color) return [text('対局者のみ操作できます。')]
  if (color !== game.turn) return [text('相手の手番です。')]

  if (!/^[a-h][1-8]$/.test(square ?? '')) return [text('マスの指定が不正です。')]

  const moves = parseMoves(game)
  const { chess } = restore(game.start_fen, moves, game.current_fen)

  if (!isOwnPiece(chess, square, color)) {
    const p = chess.get(square as any)
    return [text(p ? '相手の駒は選べません。' : 'そのマスに自分の駒はありません。')]
  }
  const targets = targetsFrom(chess, square)
  if (targets.length === 0) return [text('その駒は今動かせません。')]

  const token = newToken()
  const ok = await setSelection(env, game.id, version, square, token)
  if (!ok) return staleNotice()

  const updated = await getGameById(env, game.id)
  return [boardMessage(updated!, ctx.baseUrl)]
}

async function handleClear(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  const color = playerColor(game, me)
  if (!color) return [text('対局者のみ操作できます。')]
  if (color !== game.turn) return [text('相手の手番です。')]
  if (!game.sel_square && !game.pending_token) return [text('解除する選択はありません。')]

  // 未確定の選択(と昇格待ち)だけを解除。確定済みの指し手は戻さない。
  await env.DB.prepare(
    `UPDATE chess_games SET sel_square = NULL, sel_token = NULL,
            pending_from = NULL, pending_to = NULL, pending_token = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND version = ? AND status = 'playing'`
  )
    .bind(game.id, version)
    .run()

  const updated = await getGameById(env, game.id)
  return [boardMessage(updated!, ctx.baseUrl)]
}

async function handleMove(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number,
  selToken: string,
  to: string
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  if (game.pending_token) return [text('昇格する駒の選択が完了していません。')]

  const color = playerColor(game, me)
  if (!color) return [text('対局者のみ操作できます。')]
  if (color !== game.turn) return [text('相手の手番です。')]

  // 選び直した後の古い移動先を弾く
  if (!game.sel_square || !game.sel_token || game.sel_token !== selToken) return staleNotice()
  if (!/^[a-h][1-8]$/.test(to ?? '')) return [text('マスの指定が不正です。')]

  const from = game.sel_square
  const moves = parseMoves(game)
  const { chess } = restore(game.start_fen, moves, game.current_fen)

  // サーバー側で必ず再検証(改変された座標を拒否)
  const legal = targetsFrom(chess, from).some((t) => t.to === to)
  if (!legal) return [text('その手は指せません。')]

  // 昇格が必要なら、確定せず選択カードを出す
  if (needsPromotion(chess, from, to)) {
    const token = newToken()
    const ok = await setPendingPromotion(env, game.id, version, from, to, token)
    if (!ok) return staleNotice()
    const updated = await getGameById(env, game.id)
    return [
      buildPromotionCard(updated!, imageBase(ctx.baseUrl), from, to, (p) =>
        T.promo(game.id, version, token, p)
      ),
    ]
  }

  return commitAndRender(env, ctx, game, chess, from, to, undefined, version, moves)
}

async function handlePromotion(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number,
  token: string,
  piece: string
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  const color = playerColor(game, me)
  if (!color) return [text('対局者のみ操作できます。')]
  if (color !== game.turn) return [text('相手の手番です。')]

  // 二重確定を防ぐ: 昇格待ちが無い/トークン不一致なら拒否
  if (!game.pending_token || game.pending_token !== token) return staleNotice()
  if (!['q', 'r', 'b', 'n'].includes(piece)) return [text('昇格先の指定が不正です。')]
  if (!game.pending_from || !game.pending_to) return staleNotice()

  const moves = parseMoves(game)
  const { chess } = restore(game.start_fen, moves, game.current_fen)
  return commitAndRender(env, ctx, game, chess, game.pending_from, game.pending_to, piece, version, moves)
}

/** 指し手を確定し、DB更新後にカードを返す。 */
async function commitAndRender(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  chess: ReturnType<typeof restore>['chess'],
  from: string,
  to: string,
  promotion: string | undefined,
  version: number,
  moves: string[]
): Promise<LineMessage[]> {
  const applied = applyMove(chess, from, to, promotion)
  if (!applied) return [text('その手は指せません。')]

  const over = detectGameOver(chess)
  const nextMoves = [...moves, applied.san]

  // version 条件付きUPDATE。二重タップでも1回しか確定しない。
  const ok = await commitMove(
    env,
    game.id,
    version,
    chess.fen(),
    nextMoves,
    chess.pgn(),
    chess.turn() as 'w' | 'b',
    over ? { result: over.result, reason: over.reason } : null
  )
  if (!ok) return staleNotice()

  const updated = await getGameById(env, game.id)
  if (!updated) return [text('盤面を取得できませんでした。')]

  if (updated.status === 'finished') return [resultMessage(updated, ctx.baseUrl)]
  return [boardMessage(updated, ctx.baseUrl)]
}

async function handleDrawOffer(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  // 引き分け提案は対局者のみ(手番でなくてもよい)
  if (!isPlayer(game, me)) return [text('対局者のみ操作できます。')]
  if (game.draw_by && !isExpired(game.draw_expires_at)) return [text('すでに引き分けの提案が出ています。')]

  const ok = await proposeDraw(env, game.id, version, me)
  if (!ok) return staleNotice()
  const updated = await getGameById(env, game.id)
  const who = displayName(me === game.white_user_id ? game.white_name : game.black_name, '対局者')
  const other = displayName(me === game.white_user_id ? game.black_name : game.white_name, 'もう一方')
  // 提案中も対局は続けられる(指し手の確定で未回答の提案は失効する)
  return [
    boardMessage(
      updated!,
      ctx.baseUrl,
      `${who}さんが引き分けを提案しました。${other}さんが承諾すると引き分けになります(5分で失効)。このまま指し続けることもできます。`
    ),
  ]
}

async function handleDrawAccept(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  if (!isPlayer(game, me)) return [text('対局者のみ操作できます。')]
  if (!game.draw_by) return [text('引き分けの提案はありません。')]
  if (isExpired(game.draw_expires_at)) {
    await clearDraw(env, game.id)
    return [text('引き分けの提案は期限切れです。')]
  }
  // 承諾できるのは提案者ではないもう一方だけ
  if (game.draw_by === me) return [text('自分の提案は承諾できません。相手の応答をお待ちください。')]

  const ok = await finishGame(env, game.id, version, 'draw', '合意により引き分け')
  if (!ok) return staleNotice()
  const updated = await getGameById(env, game.id)
  return [resultMessage(updated!, ctx.baseUrl)]
}

async function handleDrawDecline(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  if (!isPlayer(game, me)) return [text('対局者のみ操作できます。')]
  if (!game.draw_by) return [text('引き分けの提案はありません。')]
  if (game.draw_by === me) return [text('自分の提案は拒否できません。')]

  await clearDraw(env, game.id)
  const updated = await getGameById(env, game.id)
  return [boardMessage(updated!, ctx.baseUrl, '引き分けの提案は拒否されました。対局を続けます。')]
}

async function handleResignAsk(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  version: number
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (game.version !== version) return staleNotice()
  // 投了は対局者本人のみ
  if (!isPlayer(game, me)) return [text('対局者のみ操作できます。')]

  const token = newToken()
  const ok = await setResignPending(env, game.id, me, token)
  if (!ok) return staleNotice()
  const updated = await getGameById(env, game.id)
  const who = displayName(me === game.white_user_id ? game.white_name : game.black_name, '対局者')
  return [boardMessage(updated!, ctx.baseUrl, `${who}さんが投了しようとしています。本人が「投了を確定」を押すと成立します。`)]
}

async function handleResignYes(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string,
  token: string
): Promise<LineMessage[]> {
  if (game.status !== 'playing') return [text('この対局は進行中ではありません。')]
  if (!game.resign_token || game.resign_token !== token) return staleNotice()
  if (isExpired(game.resign_expires_at)) return [text('投了の確認は期限切れです。もう一度お試しください。')]
  // 本人以外(相手・観戦者)は確定できない
  if (game.resign_by !== me) return [text('投了を確定できるのは本人だけです。')]

  const color = playerColor(game, me)
  if (!color) return [text('対局者のみ操作できます。')]
  const winner = color === 'w' ? 'black' : 'white'
  const loserName = displayName(color === 'w' ? game.white_name : game.black_name, '対局者')

  const ok = await finishGame(env, game.id, game.version, winner, `${loserName}さんの投了`)
  if (!ok) return staleNotice()
  const updated = await getGameById(env, game.id)
  return [resultMessage(updated!, ctx.baseUrl)]
}

async function handleRematchOffer(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string
): Promise<LineMessage[]> {
  if (game.status !== 'finished') return [text('終局した対局にのみ再戦を提案できます。')]
  // 元の対局者だけが提案できる
  if (!isPlayer(game, me)) return [text('再戦を提案できるのは、この対局の対局者だけです。')]
  if (game.rematch_child_id) return [text('すでに再戦が始まっています。「盤面」で確認できます。')]

  const active = await getActiveGame(env, ctx.groupId)
  if (active) return [text('すでに別の対局か募集が進行中です。')]

  if (game.rematch_by && !isExpired(game.rematch_expires_at)) {
    if (game.rematch_by === me) return [text('すでに再戦を提案しています。相手の承諾をお待ちください。')]
  } else {
    const ok = await proposeRematch(env, game.id, me)
    if (!ok) return [text('再戦を提案できませんでした。')]
  }
  const updated = await getGameById(env, game.id)
  return [resultMessage(updated!, ctx.baseUrl, '再戦が提案されました。もう一方が承諾すると、白黒を入れ替えて開始します(5分で失効)。')]
}

async function handleRematchAccept(
  env: LineEnv,
  ctx: ChessCtx,
  game: ChessGame,
  me: string
): Promise<LineMessage[]> {
  if (game.status !== 'finished') return [text('終局した対局にのみ再戦を承諾できます。')]
  if (!isPlayer(game, me)) return [text('再戦を承諾できるのは、この対局の対局者だけです。')]
  if (game.rematch_child_id) return [text('すでに再戦が始まっています。「盤面」で確認できます。')]
  if (!game.rematch_by) return [text('再戦の提案はありません。')]
  if (isExpired(game.rematch_expires_at)) return [text('再戦の提案は期限切れです。')]
  // 承諾は提案者ではないもう一方だけ
  if (game.rematch_by === me) return [text('自分の提案は承諾できません。相手の応答をお待ちください。')]

  const res = await acceptRematch(env, game)
  if (!res.ok || !res.child) return [text(res.reason ?? '再戦を開始できませんでした。')]
  return [boardMessage(res.child, ctx.baseUrl)]
}

// --- グループ退出・BOT退出 -----------------------------------------------

/** BOTがグループから退出 → 進行中の対局を中断として保存 */
export async function onBotLeftGroup(env: LineEnv, groupId: string): Promise<void> {
  await abortGamesForGroup(env, groupId, 'BOTがグループから退出したため中断しました')
}

/** 対局者がグループを退出 → 中断(自動的にどちらかの勝ちにはしない) */
export async function onMemberLeftGroup(
  env: LineEnv,
  groupId: string,
  userId: string,
  baseUrl: string
): Promise<LineMessage[] | null> {
  const aborted = await abortGamesForUser(env, groupId, userId, '対局者がグループを退出したため中断しました')
  if (!aborted) return null
  if (aborted.status === 'aborted' && aborted.white_user_id) {
    return [resultMessage(aborted, baseUrl)]
  }
  return [text('対局者の退出により、チェスの対局を中断しました。')]
}

// --- 検証用: 各状態のFlex JSONを生成する ---------------------------------
// LINEへ実送信するコードとまったく同じ関数(boardMessage / resultMessage /
// recruitMessage / buildPromotionCard)を通すため、サンプルと実配信内容が
// 乖離しない。scripts/chess-flex-samples.mjs から使う。
export function debugBuildCard(
  kind: 'board' | 'result' | 'recruit' | 'promotion',
  game: ChessGame,
  baseUrl: string,
  opts?: { note?: string; from?: string; to?: string }
): LineMessage {
  if (kind === 'recruit') return recruitMessage(game, baseUrl, opts?.note)
  if (kind === 'result') return resultMessage(game, baseUrl, opts?.note)
  if (kind === 'promotion') {
    return buildPromotionCard(
      game,
      imageBase(baseUrl),
      opts?.from ?? game.pending_from ?? 'a7',
      opts?.to ?? game.pending_to ?? 'a8',
      (p) => T.promo(game.id, game.version, game.pending_token ?? '0', p)
    )
  }
  return boardMessage(game, baseUrl, opts?.note)
}
