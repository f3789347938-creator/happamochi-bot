// 名言カードの param 文字列を解析する。
//
// param は「フラグを連結した1本の文字列」で、区切り文字が無い。
// 例: "newrevmonobold虹3" = 新レイアウト + 反転 + 白黒 + 太字 + 虹色 + フォント3
//
// 区切りが無いため、解析は「長いトークンから順に切り出して消す」方式にする。
// (例えば "mono" を先に消さないと "new" の判定に影響しないが、色名の
//  "水" と "水色" のように前方一致するものがある場合は長い方を先に見る)
//
// 既存の挙動を壊さないための最重要ルール:
//   param が空(または未指定)のときは、必ず今までと完全に同一のカードを
//   生成する。パラメータは「指定されたときだけ」既定値から外れる。

/** 文字色。単色 or 虹(1文字ごとに色を変える) or 季節テーマ */
export type ColorMode =
  | { kind: 'default' }
  | { kind: 'solid'; color: string }
  | { kind: 'rainbow' }
  | { kind: 'seasonal'; colors: string[] }

export interface QuoteParams {
  /** new レイアウト(横位置と装飾が変わる)か */
  layoutNew: boolean
  /** アイコンを左右反転 */
  reversed: boolean
  /** アイコンを白黒 */
  monochrome: boolean
  /** 白ベースで生成 */
  whiteBase: boolean
  /** 本文を太字 */
  bold: boolean
  /** 文字色 */
  color: ColorMode
  /** フォント番号 1〜12。0 は既定(既存フォント) */
  font: number
  /** 解析できずに残った文字列(デバッグ・警告用) */
  unknown: string
  /** 何かひとつでも指定されたか。false なら完全に従来のカードを出す */
  any: boolean
}

export const DEFAULT_PARAMS: QuoteParams = {
  layoutNew: false,
  reversed: false,
  monochrome: false,
  whiteBase: false,
  bold: false,
  color: { kind: 'default' },
  font: 0,
  unknown: '',
  any: false,
}

// 単色。日本語1文字のトークンで指定する。
// 色の値は、黒背景でも白背景でも読める彩度・明度に寄せている。
const SOLID_COLORS: Record<string, string> = {
  赤: '#FF4B4B',
  橙: '#FF9A3C',
  黄: '#FFD93D',
  緑: '#4BD86B',
  青: '#4B9BFF',
  藍: '#5A5AD8',
  紫: '#B45AF2',
  桃: '#FF7EC8',
  水: '#4BE0E8',
  白: '#FFFFFF',
  黒: '#111111',
  金: '#E6C34A',
  銀: '#C8CDD6',
}

// 季節テーマ。1文字ごとにこの配色を巡回させる。
const SEASON_COLORS: Record<string, string[]> = {
  春: ['#FFB7D5', '#FF8FC0', '#FFD1E3', '#F7A8C4', '#FFC2DD'],
  夏: ['#3FD0F0', '#12B5D8', '#7BE3F5', '#0E9BC4', '#5CD9EE'],
  秋: ['#E8873C', '#D8632A', '#F0A85C', '#C24E22', '#E5954A'],
  冬: ['#8FC4E8', '#B8DCF0', '#6FA8D8', '#D6EBF8', '#A2CFEC'],
}

/** 虹色。1文字ごとにこの順で巡回する(MiqXの実物も1文字単位だった) */
export const RAINBOW_COLORS = [
  '#FF4B4B', // 赤
  '#FF9A3C', // 橙
  '#FFD93D', // 黄
  '#4BD86B', // 緑
  '#4BE0E8', // 水
  '#4B9BFF', // 青
  '#B45AF2', // 紫
]

/**
 * bold と併用されたときに使う「同系統の太いフォント」への対応表。
 *
 * satori は合成太字(fontWeight:700 で自前に太らせる)を行わない。
 * 実測: 明朝Regular(f7)を weight 400/700 の両方に登録して
 * fontWeight:700 で描画しても、400 の出力とPNGバイト単位で完全一致した。
 * つまり「太いウェイトの実体」を渡さない限り太字にならない。
 * そこで bold 指定時は、同じ書体系統の太いサブセットに差し替える。
 */
export const BOLD_VARIANT: Record<number, number> = {
  1: 2, // ゴシック → ゴシック太
  2: 5, // ゴシック太 → ゴシック極太
  3: 1, // ゴシック細 → ゴシック
  4: 2, // ゴシック中 → ゴシック太
  5: 5, // ゴシック極太 (これ以上太いものが無い)
  6: 3, // ゴシック極細 → ゴシック細
  7: 8, // 明朝 → 明朝太
  8: 10, // 明朝太 → 明朝極太
  9: 7, // 明朝細 → 明朝
  10: 10, // 明朝極太 (最太)
  11: 8, // 明朝中 → 明朝太
  12: 12, // 等幅 (太いサブセットを別に持っていない)
}

/**
 * 実際に読み込むフォント番号を返す。
 * bold 指定があれば同系統の太い書体に差し替える。
 * フォント未指定(0)のときは 0 を返し、呼び出し側が既定フォント
 * (NotoSansJP Regular/Bold の2ウェイト)を使う — この経路では
 * satori が本物の Bold 実体を持っているので bold が正しく効く。
 */
export function effectiveFontNumber(p: QuoteParams): number {
  if (p.font === 0) return 0
  if (!p.bold) return p.font
  return BOLD_VARIANT[p.font] ?? p.font
}

/** フォント番号 → 表示名(ヘルプ用) */
export const FONT_LABELS: Record<number, string> = {
  1: 'ゴシック',
  2: 'ゴシック太',
  3: 'ゴシック細',
  4: 'ゴシック中',
  5: 'ゴシック極太',
  6: 'ゴシック極細',
  7: '明朝',
  8: '明朝太',
  9: '明朝細',
  10: '明朝極太',
  11: '明朝中',
  12: '等幅',
}

/**
 * param 文字列を解析する。
 *
 * 解析順が重要:
 *   1. 英字フラグ(長いものから) … 'mono' が 'new' より先である必要はないが、
 *      'new' を先に消すと 'renew' のような入力で誤爆するため、
 *      いずれも「見つけたら消す」方式で長い順に処理する。
 *   2. カスタムカラー(#RRGGBB / RRGGBB)
 *   3. 虹 / 季節 / 単色(日本語1文字)
 *   4. フォント番号(1〜12。2桁を先に見ないと "12" が "1"+"2" になる)
 */
export function parseQuoteParams(raw: string | null | undefined): QuoteParams {
  const p: QuoteParams = { ...DEFAULT_PARAMS, color: { kind: 'default' } }
  if (!raw) return p

  let s = raw.trim()
  if (!s) return p

  // --- 英字フラグ。長いトークンから消す ---
  // standard は既定なので消すだけで何も変えない。
  for (const token of ['standard', 'mono', 'bold', 'whi', 'rev', 'new'] as const) {
    const i = s.toLowerCase().indexOf(token)
    if (i < 0) continue
    s = s.slice(0, i) + s.slice(i + token.length)
    if (token === 'mono') p.monochrome = true
    else if (token === 'bold') p.bold = true
    else if (token === 'whi') p.whiteBase = true
    else if (token === 'rev') p.reversed = true
    else if (token === 'new') p.layoutNew = true
  }

  // --- カスタムカラー ---
  // "#RRGGBB" / "#RGB" / 素の "RRGGBB"(英数字6桁) を受け付ける。
  const hex = s.match(/#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/)
  if (hex) {
    let v = hex[1]
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]
    // 6桁の16進は数字だけの場合フォント番号と紛れるが、
    // フォント番号は1〜12の1〜2桁なので6桁と衝突しない。
    p.color = { kind: 'solid', color: `#${v.toUpperCase()}` }
    s = s.replace(hex[0], '')
  }

  // --- 虹 ---
  for (const token of ['niji', '虹']) {
    const i = s.toLowerCase().indexOf(token)
    if (i >= 0) {
      p.color = { kind: 'rainbow' }
      s = s.slice(0, i) + s.slice(i + token.length)
      break
    }
  }

  // --- 季節テーマ ---
  if (p.color.kind === 'default') {
    for (const [k, colors] of Object.entries(SEASON_COLORS)) {
      if (s.includes(k)) {
        p.color = { kind: 'seasonal', colors }
        s = s.replace(k, '')
        break
      }
    }
  }

  // --- 単色 ---
  if (p.color.kind === 'default') {
    for (const [k, color] of Object.entries(SOLID_COLORS)) {
      if (s.includes(k)) {
        p.color = { kind: 'solid', color }
        s = s.replace(k, '')
        break
      }
    }
  }

  // --- フォント番号。2桁(10,11,12)を先に見る ---
  const fm = s.match(/\b(1[0-2]|[1-9])\b/) ?? s.match(/(1[0-2]|[1-9])/)
  if (fm) {
    const n = Number(fm[1])
    if (n >= 1 && n <= 12) {
      p.font = n
      s = s.replace(fm[1], '')
    }
  }

  p.unknown = s.replace(/[\s,、.。]+/g, '').trim()
  p.any =
    p.layoutNew ||
    p.reversed ||
    p.monochrome ||
    p.whiteBase ||
    p.bold ||
    p.font > 0 ||
    p.color.kind !== 'default'

  return p
}

/**
 * 文字ごとの色を返す。単色/既定なら null(=呼び出し側が一括で色指定する)。
 * 虹・季節テーマのときだけ 1文字ずつの配列を返す。
 */
export function perCharColors(text: string, color: ColorMode): string[] | null {
  if (color.kind === 'rainbow') {
    return Array.from(text).map((_, i) => RAINBOW_COLORS[i % RAINBOW_COLORS.length])
  }
  if (color.kind === 'seasonal') {
    return Array.from(text).map((_, i) => color.colors[i % color.colors.length])
  }
  return null
}

/** 単色/既定のときの文字色。whiteBase のときは黒基調にする */
export function baseTextColor(p: QuoteParams): string {
  if (p.color.kind === 'solid') return p.color.color
  if (p.whiteBase) return '#1A1A1A'
  return '#ffffff'
}

/**
 * 「装飾指定として丸ごと解釈できたか」を返す。
 *
 * なぜ必要か:
 *   「めいく虹」のようにスペース無しを許すと、返信モードの判定が
 *   「めいくで作った」「めいくしたい」「めいくって何」といった
 *   ふつうの会話にも一致してしまう(実測で確認)。
 *   そこで、めいくの直後に続く文字列が「全て装飾として解釈できた場合」
 *   だけ装飾付きコマンドと見なし、解釈できない文字が残っていれば
 *   コマンドではない=無反応にする。
 *
 *   空文字列(=「めいく」だけ)は装飾なしのコマンドなので true。
 */
export function isPureParamString(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return true
  const p = parseQuoteParams(s)
  // 何も認識できなかった、または認識できない文字が残った → 装飾ではない
  return p.any && p.unknown === ''
}

/** 解析結果を人が読める形にする(確認メッセージ用) */
export function describeParams(p: QuoteParams): string {
  const parts: string[] = []
  if (p.layoutNew) parts.push('新レイアウト')
  if (p.reversed) parts.push('アイコン反転')
  if (p.monochrome) parts.push('アイコン白黒')
  if (p.whiteBase) parts.push('白ベース')
  if (p.bold) parts.push('太字')
  if (p.color.kind === 'rainbow') parts.push('虹色')
  else if (p.color.kind === 'seasonal') parts.push('季節テーマ')
  else if (p.color.kind === 'solid') parts.push(`色 ${p.color.color}`)
  if (p.font) parts.push(`フォント${p.font}(${FONT_LABELS[p.font] ?? ''})`)
  return parts.length ? parts.join(' / ') : '既定'
}
