// ヘルプメニュー(hmhelp)のコマンド・Postback処理。
//
// 安全性の要点(仕様 v4 の behavior_contract に対応):
//   ・操作主体は必ずWebhookの source.userId。postbackに載っている値は信用しない。
//     そのためトークンにユーザーIDを一切載せていない。
//   ・「メニューを開く」操作で状態を変えない。オセロ開始・チェス募集・購入・
//     装備をボタンから呼ばない。表示だけの既存コマンドに限り既存処理へ渡す。
//   ・設定変更は確認をはさむ。確認意図は menu_confirmations に保存し、
//     押した本人・グループ・期限・未使用を照合してからでないと実行しない。
//   ・既存の実装済みFlex(ステータス/着せ替え/購入確認/共通称号一覧/カテゴリ/
//     チェス3種/オセロ盤面/お知らせ)は作り直さず、既存の出力をそのまま返す。
//     このメニューのデザインやフッター、戻るボタンを既存カードに足さない。
//   ・Flexの中に入力欄は作らない。次の雑談を本文として勝手に拾わない。
import type { LineEnv, LineMessage } from '../../lib/line'
import { buildCard, buildCarousel, buildBubble } from './flex'
import { buildHelpCarousel } from './helpCards'
import {
  H03_PAGE_COUNT,
  MAIN_IDS,
  decorExample,
  mainScreens,
  screenC01,
  screenC02,
  screenC03,
  screenC04,
  screenC05,
  screenG01,
  screenG20,
  screenG21,
  screenG22,
  screenH01,
  screenH03,
  screenQ01,
  screenQ02,
  screenQ06,
  screenQ07,
  screenQ08,
  screenR01,
  screenSelection,
  screenX,
  COLOR_TOKENS,
  FONT_TOKENS,
  STYLE_TOKENS,
  type ScreenDef,
} from './screens'

export interface MenuCtx {
  isGroup: boolean
  groupId?: string
  /** Webhookが示す操作主体。これだけを信用する。 */
  userId?: string
  displayName: string | null
  /** 公開ページのURL(サーバー側の定数。推測でURLを作らない) */
  siteUrl: string
}

/**
 * 表示のみで副作用が無いと確認できた既存コマンドの許可リスト。
 * ここに無いコマンドはボタンから実行しない。
 *
 * 除外しているもの(状態を変えるので、ボタンからは実行しない):
 *   称号装備 / 共通称号装備 / 誕生日登録 / ウェルカム各種 / 取り消し通知各種 /
 *   タグ追加 / タグ削除 / めいく(画像生成と保存を行う)
 *
 * ゲームの開始は下の GAME_START_COMMANDS で別枠にしている。
 */
const SAFE_EXISTING_COMMANDS = new Set([
  'ステータス',
  '着せ替え',
  '共通称号一覧',
  '共通称号確認',
  '称号一覧',
  '称号確認',
  'お知らせ',
  'ランキング',
  'タグ一覧',
  'めいく装飾',
  'チェス ヘルプ',
  'オセロ戦績',
  '盤面',
])

/**
 * ゲームの開始・参加。押した本人が「対局したい」と明示したボタンなので、
 * 既存コマンドの処理をそのまま実行する。
 *
 * ここに入れてよい理由:
 *   ・ボタンのラベルが「オセロ」「チェス」で、押す意味が対局開始だと分かる
 *     (遊び方の案内は「遊び方」ボタンに分けてある)
 *   ・実行するのは既存コマンドそのままなので、重複対局の拒否・グループ外の
 *     案内・タイムアウト処理といった既存の判定がすべてそのまま働く
 *   ・購入や装備のように取り返しがつかない操作ではない(終了コマンドがある)
 *
 * それでも「終了」はボタンに置かない。進行中の対局を他の人が消せてしまうため。
 */
const GAME_START_COMMANDS = new Set(['オセロ開始', 'オセロ参加', 'チェス'])

/** 設定変更の許可リスト。確認カードの文言と、実行に使う既存コマンド。 */
interface OpDef {
  label: string
  /** 既存の routeCommand に渡すコマンド文字列(既存処理をそのまま使う) */
  command: string
  /** グループ内でのみ実行できる操作か */
  groupOnly: boolean
  after: string
}

const OPS: Record<string, OpDef> = {
  unsend_on: { label: '取り消し通知をオンにする', command: '取り消し通知オン', groupOnly: true, after: 'オン' },
  unsend_off: { label: '取り消し通知をオフにする', command: '取り消し通知オフ', groupOnly: true, after: 'オフ' },
  welcome_on: { label: 'ウェルカムをオンにする', command: 'ウェルカムオン', groupOnly: true, after: 'オン' },
  welcome_off: { label: 'ウェルカムをオフにする', command: 'ウェルカムオフ', groupOnly: true, after: 'オフ' },
  welcome_msg_clear: {
    label: 'ウェルカム本文を解除して既定文に戻す',
    command: 'ウェルカムメッセージ解除',
    groupOnly: true,
    after: '既定の文',
  },
  birthday_off: { label: '誕生日の登録を解除する', command: '誕生日登録解除', groupOnly: false, after: '未登録' },
}

const CONFIRM_TTL_SEC = 10 * 60

// === 設定の現在値の読み取り ==============================================
// 既存テーブルを読むだけ。書き込みは一切しない。
async function readUnsend(env: LineEnv, groupId?: string): Promise<string> {
  if (!groupId) return '取得できません（グループ外）'
  try {
    const row = await env.DB.prepare(
      `SELECT enabled FROM unsend_restore_settings WHERE group_id = ?`
    )
      .bind(groupId)
      .first<{ enabled: number }>()
    // 既存の unsend.ts は「行が無い」または enabled=1 を有効として扱う。
    if (!row) return 'オン（初期設定）'
    return row.enabled === 0 ? 'オフ' : 'オン'
  } catch {
    return '取得できません'
  }
}

async function readWelcome(
  env: LineEnv,
  groupId?: string
): Promise<{ state: string; message: string }> {
  if (!groupId) return { state: '取得できません（グループ外）', message: '—' }
  try {
    const row = await env.DB.prepare(
      `SELECT enabled, custom_message FROM group_welcome_settings WHERE group_id = ?`
    )
      .bind(groupId)
      .first<{ enabled: number; custom_message: string | null }>()
    if (!row) return { state: 'オフ（初期設定）', message: '既定の文' }
    const msg = row.custom_message && row.custom_message.trim().length > 0
      ? row.custom_message.length > 40
        ? `${row.custom_message.slice(0, 40)}…`
        : row.custom_message
      : '既定の文'
    return { state: row.enabled === 0 ? 'オフ' : 'オン', message: msg }
  } catch {
    return { state: '取得できません', message: '取得できません' }
  }
}

// === 装飾の選択状態 ======================================================
// Flexは送信済みカードを書き換えられないので、選択状態はトークンに載せて
// 次のカードへ持ち回る。ユーザーIDは載せない(押した本人=操作主体で判定)。
const KNOWN_TOKENS = new Set<string>([...STYLE_TOKENS, ...COLOR_TOKENS, ...FONT_TOKENS])

function normalizeTokens(raw: string): string[] {
  if (!raw || raw === '-') return []
  const out: string[] = []
  for (const t of raw.split(',')) {
    const v = t.trim()
    // 知らない値は捨てる(改ざん対策)。既存パーサーの解釈は変えない。
    if (v && KNOWN_TOKENS.has(v) && !out.includes(v)) out.push(v)
    if (out.length >= 6) break
  }
  return out
}

const tokenStr = (tokens: string[]) => (tokens.length > 0 ? tokens.join(',') : '-')

/**
 * 選択を1つ足す。同じ種類は置き換える(色を2つ選んでも最後の1つ)。
 *
 * 追加する値も必ず許可リストで確認する。ここを省くと、改ざんされた
 * postback の中身がそのままカードの文面に出てしまう。
 */
function addToken(tokens: string[], t: string): string[] {
  if (!KNOWN_TOKENS.has(t)) return tokens
  const kindOf = (v: string) =>
    (STYLE_TOKENS as readonly string[]).includes(v)
      ? 'style'
      : (COLOR_TOKENS as readonly string[]).includes(v)
        ? 'color'
        : 'font'
  // スタイルは重ねられる(bold+new など)。色とフォントは1つだけ。
  if (kindOf(t) === 'style') {
    return tokens.includes(t) ? tokens.filter((x) => x !== t) : [...tokens, t]
  }
  return [...tokens.filter((x) => kindOf(x) !== kindOf(t)), t]
}

// === 画面の組み立て ======================================================
function card(def: ScreenDef, tokens: string[] = []): LineMessage {
  // 装飾の選択状態を、次の画面へ渡すトークンへ埋め込む。
  const suffix = tokens.length > 0 ? `~${tokenStr(tokens)}` : ''
  const buttons = def.buttons.map((b) =>
    b.data.startsWith('hm|n|') && suffix ? { ...b, data: `${b.data}${suffix}` } : b
  )
  return buildCard({ ...def, buttons })
}

/** `ヘルプ` で出すメインカルーセル。 */
export function buildMainMenu(ctx: MenuCtx): LineMessage {
  const url = `${ctx.siteUrl}/ranking/personal`
  const defs = mainScreens(url, ctx.siteUrl)
  const bubbles = defs.map((d, i) =>
    buildBubble({ ...d, pageLabel: `${String(i + 1).padStart(2, '0')} / 0${defs.length}` })
  )
  return buildCarousel(bubbles, 'ヘルプ（メニュー）— 横にスワイプして選べます')
}

async function screenById(
  env: LineEnv,
  ctx: MenuCtx,
  id: string,
  arg: number,
  tokens: string[]
): Promise<LineMessage[] | null> {
  const url = `${ctx.siteUrl}/ranking/personal`

  // メインカルーセルへ戻る
  if (id === 'M' || MAIN_IDS.includes(id as any)) return [buildMainMenu(ctx)]

  switch (id) {
    case 'Q01':
      return [card(screenQ01(tokens), tokens)]
    case 'Q02':
      return [card(screenQ02(tokens), tokens)]
    case 'Q03':
    case 'Q04':
    case 'Q05': {
      const perPage = id === 'Q03' ? 5 : 6
      return [card(screenSelection(id, arg || 1, perPage), tokens)]
    }
    case 'Q06':
      return [card(screenQ06(tokens), tokens)]
    case 'Q07':
      return [card(screenQ07)]
    case 'Q08':
      return [card(screenQ08)]
    case 'G01':
      return [card(screenG01(ctx.siteUrl))]
    case 'G20':
      return [card(screenG20)]
    case 'G21':
      return [card(screenG21)]
    case 'G22':
      return [card(screenG22(ctx.siteUrl))]
    case 'R01':
      return [card(screenR01(url))]
    case 'C01': {
      const unsend = await readUnsend(env, ctx.groupId)
      const w = await readWelcome(env, ctx.groupId)
      return [card(screenC01(unsend, w.state))]
    }
    case 'C02':
      return [card(screenC02)]
    case 'C03':
      return [card(screenC03(await readUnsend(env, ctx.groupId)))]
    case 'C04': {
      const w = await readWelcome(env, ctx.groupId)
      return [card(screenC04(w.state, w.message))]
    }
    case 'C05':
      return [card(screenC05)]
    case 'H01':
      return [card(screenH01)]
    case 'H03':
      return [card(screenH03(arg || 1))]
    default:
      return null
  }
}

// === 確認の保存と照合 ====================================================
function newId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

async function createConfirmation(
  env: LineEnv,
  ctx: MenuCtx,
  op: string
): Promise<string | null> {
  const id = newId()
  const expires = Math.floor(Date.now() / 1000) + CONFIRM_TTL_SEC
  try {
    await env.DB.prepare(
      `INSERT INTO menu_confirmations (id, user_id, group_id, op, payload, expires_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    )
      .bind(id, ctx.userId ?? '', ctx.groupId ?? null, op, expires)
      .run()
    return id
  } catch {
    return null
  }
}

/**
 * 確認を1回だけ引き当てる。
 * 条件付きUPDATEで used=1 にできた行だけを有効とするので、連打しても
 * 二重に実行されない。押した本人・グループも同時に照合する。
 */
async function claimConfirmation(
  env: LineEnv,
  ctx: MenuCtx,
  id: string
): Promise<{ ok: boolean; op?: string; reason?: 'expired' | 'other' | 'missing' }> {
  try {
    const row = await env.DB.prepare(`SELECT * FROM menu_confirmations WHERE id = ?`)
      .bind(id)
      .first<{ user_id: string; group_id: string | null; op: string; used: number; expires_at: number }>()
    if (!row) return { ok: false, reason: 'missing' }
    // 本人以外は実行しない。他人のデータを変えないための最重要チェック。
    if (row.user_id !== (ctx.userId ?? '')) return { ok: false, reason: 'other' }
    if ((row.group_id ?? null) !== (ctx.groupId ?? null)) return { ok: false, reason: 'other' }
    if (row.used === 1) return { ok: false, reason: 'expired' }
    if (row.expires_at < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' }

    const upd = await env.DB.prepare(
      `UPDATE menu_confirmations SET used = 1 WHERE id = ? AND used = 0`
    )
      .bind(id)
      .run()
    if ((upd.meta?.changes ?? 0) === 0) return { ok: false, reason: 'expired' }
    return { ok: true, op: row.op }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}

function confirmCard(op: string, def: OpDef, id: string, before: string): LineMessage {
  return buildCard({
    category: '確認',
    title: 'この内容で変更しますか？',
    body: def.label,
    rows: [
      { label: '操作', value: def.label },
      { label: '変更前', value: before },
      { label: '変更後', value: def.after },
      { label: '注意', value: 'このボタンを押した人の操作として実行します' },
    ],
    buttons: [
      { label: '変更する', data: `hm|k|${id}`, kind: 'primary' },
      { label: 'キャンセル', data: op === 'birthday_off' ? 'hm|n|C02' : 'hm|n|C01', kind: 'sub' },
    ],
    altText: `確認: ${def.label}`,
  })
}

// === 入口: テキストコマンド ==============================================
/**
 * `ヘルプ` でメインカルーセルを返す。
 * 既存の別名(help)もそのまま同じ扱いにする。新しい呼び名は増やさない。
 */
export function handleMenuText(ctx: MenuCtx, raw: string): LineMessage[] | null {
  const t = raw.trim()
  // 「ヘルプ」はコマンド一覧のカルーセルを返す。
  // 各コマンドが押せるボタンになっているので、コマンド名を知らなくても使える。
  //
  // 従来のカード型メニュー(buildMainMenu)は消していない。案内画面の
  // 「戻る」やPostback(hm|n|M)から今までどおり開ける。
  if (t === 'ヘルプ' || t.toLowerCase() === 'help') return [buildHelpCarousel(ctx.siteUrl)]
  return null
}

// === 入口: Postback =====================================================
export interface MenuPostbackResult {
  messages?: LineMessage[]
  /** 既存の routeCommand へ渡して既存出力を得たいコマンド */
  runExisting?: string
}

export async function handleMenuPostback(
  env: LineEnv,
  ctx: MenuCtx,
  data: string
): Promise<MenuPostbackResult | null> {
  if (!data.startsWith('hm|')) return null
  const userId = ctx.userId
  if (!userId) {
    return { messages: [card(screenX('X02', 'この操作は利用者を特定できませんでした。'))] }
  }

  const parts = data.split('|')
  const kind = parts[1] ?? ''
  const rest = parts.slice(2).join('|')

  // --- 画面遷移(状態を変えない) ---
  if (kind === 'n') {
    // 形式: <画面ID>[:<引数>][~<装飾トークン>]
    const [head, tokenPart] = rest.split('~')
    const [id, argRaw] = (head ?? '').split(':')
    const arg = Number.parseInt(argRaw ?? '', 10)
    const tokens = normalizeTokens(tokenPart ?? '')
    const msgs = await screenById(env, ctx, id ?? '', Number.isFinite(arg) ? arg : 0, tokens)
    if (!msgs) {
      return { messages: [card(screenX('X03', 'この案内は開けませんでした。メニューから開き直してください。'))] }
    }
    return { messages: msgs }
  }

  // --- 装飾の選択(状態を変えない。カードを出し直すだけ) ---
  if (kind === 'q') {
    const [choice, tokenPart] = rest.split('~')
    const current = normalizeTokens(tokenPart ?? '')
    const next = choice === '-' ? [] : addToken(current, (choice ?? '').trim())
    return { messages: [card(screenQ01(next), next)] }
  }

  // --- 表示だけの既存コマンドを実行して、既存カードをそのまま出す ---
  if (kind === 'x') {
    const cmd = rest
    const isGameStart = GAME_START_COMMANDS.has(cmd)
    if (!SAFE_EXISTING_COMMANDS.has(cmd) && !isGameStart) {
      // 許可リストに無いものは実行しない(状態変更を防ぐ)
      return { messages: [card(screenX('X02', 'この操作はボタンからは実行できません。'))] }
    }
    // 対局はグループ内だけ。個人トークでは既存コマンドが案内を返すので
    // そのまま渡してよいが、案内文はグループ前提なのでここで補足する。
    if (isGameStart && !ctx.isGroup) {
      return {
        messages: [
          card(screenX('X02', 'ゲームはグループのトークで遊ぶ機能です。グループに招待してから使ってください。')),
        ],
      }
    }
    return { runExisting: cmd }
  }

  // --- 設定変更の確認カードを出す(この時点では何も変えない) ---
  if (kind === 'c') {
    const op = rest
    const def = OPS[op]
    if (!def) {
      return { messages: [card(screenX('X03', 'この操作は取り扱えません。'))] }
    }
    if (def.groupOnly && !ctx.isGroup) {
      return {
        messages: [
          card(screenX('X02', 'この設定はグループのトークで変更してください。')),
        ],
      }
    }
    let before = '取得できません'
    if (op.startsWith('unsend')) before = await readUnsend(env, ctx.groupId)
    else if (op.startsWith('welcome')) {
      const w = await readWelcome(env, ctx.groupId)
      before = op === 'welcome_msg_clear' ? w.message : w.state
    } else if (op === 'birthday_off') before = 'ご自身の登録内容'

    const id = await createConfirmation(env, ctx, op)
    if (!id) {
      return { messages: [card(screenX('X04', '確認を用意できませんでした。もう一度お試しください。'))] }
    }
    return { messages: [confirmCard(op, def, id, before)] }
  }

  // --- 確認を確定して、既存の処理をそのまま実行する ---
  if (kind === 'k') {
    const claim = await claimConfirmation(env, ctx, rest)
    if (!claim.ok) {
      if (claim.reason === 'other') {
        return {
          messages: [
            card(screenX('X02', 'この確認はほかの方のものです。ご自身でメニューを開いてください。')),
          ],
        }
      }
      return {
        messages: [card(screenX('X03', 'この確認は使えなくなりました。もう一度メニューから操作してください。'))],
      }
    }
    const def = OPS[claim.op ?? '']
    if (!def) {
      return { messages: [card(screenX('X04', 'この操作は実行できませんでした。'))] }
    }
    // 既存コマンドの処理をそのまま呼ぶ。処理内容・保存範囲・出力は変えない。
    return { runExisting: def.command }
  }

  return { messages: [card(screenX('X03', 'このボタンは扱えませんでした。'))] }
}

/** 名言の送信例。テストと確認用に公開する。 */
export { decorExample }
