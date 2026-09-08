// 「ランキング」コマンドの返信カード(横スワイプのカルーセル)。
//
// 1枚目: 葉っぱもちランキング(個人のLv / 累計EXP)
// 2枚目: もち合体パズル(LIFFミニゲームのスコア)
//
// 既存の実装には触らない方針なので、
//   ・順位の計算は既存の profile/core.ts と mochiScore.ts をそのまま呼ぶ
//   ・このファイルは「取ってきた値をカードに並べる」だけ
// にしている。
//
// アイコンについて:
//   LINEのプロフィール画像URL(picture_url)を image として出す。
//   ・LINE Flexの image に width は無い(指定するとHTTP 400 になる)。
//     過去にチェスでこれを踏んで実機が無反応になったので、絶対に付けない。
//   ・https 以外や空の場合は画像を出さず、色付きの枠だけを出す
//     (壊れた画像アイコンが並ぶのを防ぐ)。
import type { LineEnv, LineMessage } from '../lib/line'
import { listRanking, getPersonalRank, countProfiles } from './profile/core'
import { getRanking as getMochiRanking, getMyScore as getMyMochiScore } from './mochiScore'

const C = {
  headerBg: '#0E9AD6',
  headerText: '#ffffff',
  cardBg: '#ffffff',
  rowBg: '#F4FAFE',
  rowBorder: '#DCEEF8',
  name: '#1B3A47',
  sub: '#6B8A9C',
  footer: '#8AA7B6',
  buttonBg: '#0E9AD6',
}

// 1位/2位/3位の色。4位以降は普通の色。
const MEDAL = ['#D4A017', '#9AA5AC', '#B5793A']

const FOOTER_TEXT = '© 2026 HappaMochi Bot'
const TOP_N = 3

function medalColor(rank: number): string {
  return MEDAL[rank - 1] ?? C.sub
}

/** 安全に出せる画像URLか。LINEは https のみ受け付ける。 */
function safeImage(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  if (!url.startsWith('https://')) return null
  if (url.length > 1000) return null
  return url
}

/** 1行分。アイコン + 名前 + 補足。 */
function row(
  rank: number,
  name: string,
  sub: string,
  pictureUrl: string | null
): Record<string, any> {
  const img = safeImage(pictureUrl)

  // アイコン枠。画像があれば image、無ければ空の箱(枠だけ)にする。
  const icon: Record<string, any> = img
    ? {
        type: 'box',
        layout: 'vertical',
        width: '44px',
        height: '44px',
        cornerRadius: '8px',
        backgroundColor: C.rowBorder,
        contents: [
          // image に width は付けない(LINEに存在しないプロパティ)
          { type: 'image', url: img, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' },
        ],
      }
    : {
        type: 'box',
        layout: 'vertical',
        width: '44px',
        height: '44px',
        cornerRadius: '8px',
        backgroundColor: C.rowBorder,
        justifyContent: 'center',
        contents: [
          {
            type: 'text',
            text: name.slice(0, 1) || '?',
            size: 'lg',
            weight: 'bold',
            align: 'center',
            color: C.sub,
          },
        ],
      }

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    alignItems: 'center',
    paddingAll: '10px',
    backgroundColor: C.rowBg,
    cornerRadius: 'md',
    borderColor: C.rowBorder,
    borderWidth: '1px',
    contents: [
      {
        type: 'text',
        text: String(rank),
        size: 'lg',
        weight: 'bold',
        color: medalColor(rank),
        flex: 0,
        align: 'center',
        gravity: 'center',
      },
      icon,
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'none',
        contents: [
          { type: 'text', text: name, size: 'md', weight: 'bold', color: C.name, wrap: false },
          { type: 'text', text: sub, size: 'xs', color: C.sub, wrap: false },
        ],
      },
    ],
  }
}

/** 「まだ記録がないよ」の行 */
function emptyRow(text: string): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '16px',
    backgroundColor: C.rowBg,
    cornerRadius: 'md',
    contents: [{ type: 'text', text, size: 'sm', color: C.sub, align: 'center', wrap: true }],
  }
}

/** カード1枚。タイトル + 上位3行 + 自分の順位 + もっと見るボタン */
function card(
  title: string,
  rows: Record<string, any>[],
  myLine: string,
  moreUrl: string
): Record<string, any> {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'baseline',
      backgroundColor: C.headerBg,
      paddingAll: 'md',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, color: C.headerText, weight: 'bold', size: 'lg', flex: 0 },
        { type: 'text', text: `1〜${TOP_N}位`, color: C.headerText, size: 'xs', flex: 0 },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'md',
      backgroundColor: C.cardBg,
      contents: [
        ...rows,
        { type: 'text', text: myLine, size: 'xs', color: C.sub, align: 'center', wrap: true, margin: 'md' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'md',
      backgroundColor: C.cardBg,
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: C.buttonBg,
          height: 'sm',
          action: { type: 'uri', label: 'ランキングをもっと見る', uri: moreUrl },
        },
        { type: 'text', text: FOOTER_TEXT, size: 'xxs', color: C.footer, align: 'center' },
      ],
    },
  }
}

const num = (n: number) => n.toLocaleString('ja-JP')

/**
 * 「ランキング」コマンドの返信。
 * 個人ランキングとゲームスコアを横スワイプのカルーセルで並べる。
 *
 * userId は「自分の順位」を出すためだけに使う。取れないときは省略する。
 */
export async function buildRankingCarousel(
  env: LineEnv,
  siteUrl: string,
  userId: string | null
): Promise<LineMessage> {
  // ─── 1枚目: 葉っぱもちランキング(Lv / 累計EXP) ───
  let happaRows: Record<string, any>[]
  let happaMine = ''
  try {
    const top = await listRanking(env, TOP_N, 0)
    happaRows =
      top.length > 0
        ? top.map((r) =>
            row(
              r.rank,
              r.display_name ?? '名前なし',
              `Lv.${r.level} exp ${num(r.total_exp)}`,
              r.picture_url
            )
          )
        : [emptyRow('まだ記録がありません')]

    const total = await countProfiles(env)
    const myRank = userId ? await getPersonalRank(env, userId) : null
    happaMine =
      myRank !== null
        ? `あなたの順位: ${myRank}位 / ${num(total)}人`
        : 'まだ順位がついてないよ' + (total > 0 ? ` / ${num(total)}人参加中` : '')
  } catch {
    happaRows = [emptyRow('ランキングを取得できませんでした')]
    happaMine = ''
  }

  // ─── 2枚目: もち合体パズル(ゲームのスコア) ───
  let mochiRows: Record<string, any>[]
  let mochiMine = ''
  try {
    const top = await getMochiRanking(env, TOP_N)
    mochiRows =
      top.length > 0
        ? top.map((r, i) =>
            row(i + 1, r.display_name ?? '名前なし', `best ${num(r.best_score)}`, r.picture_url)
          )
        : [emptyRow('まだ記録がありません\n「ヘルプ」→ゲームから遊べます')]

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM mochi_scores WHERE best_score > 0`
    ).first<{ c: number }>()
    const players = countRow?.c ?? 0

    // ゲームのIDはLINEログインチャネルのものなので、BotのuserIdでは
    // 一致しないことがある。その場合は「まだ順位がついてないよ」を出す。
    const mine = userId ? await getMyMochiScore(env, userId) : null
    mochiMine =
      mine !== null
        ? `あなたの順位: ${mine.rank}位 / ${num(players)}人`
        : 'まだ順位がついてないよ' + (players > 0 ? ` / ${num(players)}人参加中` : '')
  } catch {
    mochiRows = [emptyRow('ランキングを取得できませんでした')]
    mochiMine = ''
  }

  return {
    type: 'flex',
    altText: 'ランキング',
    contents: {
      type: 'carousel',
      contents: [
        card('葉っぱもちランキング', happaRows, happaMine, `${siteUrl}/ranking/personal`),
        card('もち合体パズル', mochiRows, mochiMine, `${siteUrl}/ranking/mochi`),
      ],
    },
  }
}
