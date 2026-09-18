// 「ランキング」コマンドの返信カード(横スワイプのカルーセル)。
//
// 1枚目: 葉っぱもちランキング(個人の累計EXP・上位5人)
// 2枚目: もち合体パズル(LIFFミニゲームのスコア)
//
// 既存の実装には触らない方針なので、
//   ・順位の計算は既存の profile/core.ts と mochiScore.ts をそのまま呼ぶ
//   ・このファイルは「取ってきた値をカードに並べる」だけ
// にしている。
//
// アイコンについて:
//   個人ランキングは着せ替えたもち、ゲームランキングはLINEの画像を出す。
//   着せ替えDBの移行前などは従来のプロフィール画像へフォールバックする。
//   ・LINE Flexの image に width は無い(指定するとHTTP 400 になる)。
//     過去にチェスでこれを踏んで実機が無反応になったので、絶対に付けない。
//   ・https 以外や空の場合は画像を出さず、色付きの枠だけを出す
//     (壊れた画像アイコンが並ぶのを防ぐ)。
import type { LineEnv, LineMessage } from '../lib/line'
import { listRanking, getPersonalRank } from './profile/core'
import { getRanking as getMochiRanking, getMyScore as getMyMochiScore } from './mochiScore'
import { getSurvivorRanking, getMySurvivor } from './survivor'
import { costumeIconUrl } from './dressup/art'
import { getAppearanceByPublicIds } from './dressup/store'

// このランキングカード専用の色。
// 他のFlex(ステータス・メニュー・チェス等)と共有しないよう、
// このファイル内に閉じて持つ。ここを変えても他のカードには影響しない。
const C = {
  // 上帯・主ボタン・下帯で同じ青を使う
  blue: '#039BE5',
  onBlue: '#FFFFFF',
  // 本文の土台はごく薄い水色。各順位行が白なので、行が浮いて見える
  bodyBg: '#E1F5FE',
  rowBg: '#FFFFFF',
  // 順位行とアバターの細い枠
  border: '#BFE3EF',
  name: '#333333',
  sub: '#6F858B',
}

// 1位/2位/3位の色(金・銀・銅)。4位以降は補足色。
const MEDAL = ['#D4AF37', '#949DA3', '#B87939']

// Botの正式表記。参照元のBot名は使わない。
const FOOTER_TEXT = '© 2026 HappaMochi Bot'
const TOP_N = 3
const PERSONAL_TOP_N = 5

// 個人カードだけを参考画像に合わせる。既存ゲーム2枚の色・寸法は変えない。
const PERSONAL = {
  navy: '#073875',
  blue: '#009FEC',
  border: '#B6E5FF',
  selected: '#EDF8FF',
  medals: ['#C89533', '#009FEC', '#B87939'],
  muted: '#768BAD',
}

// 見本に合わせた寸法。
const AVATAR_PX = 44 // アバター一辺
const RADIUS_SM = '5px' // 順位行・アバターの角丸
const BORDER_W = '1px'

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

/** 名前を1行に収める。長い値でもカードの幅・高さを増やさない。 */
function personalName(name: string): string {
  const characters = Array.from(name.trim() || '名前なし')
  return characters.length > 24 ? `${characters.slice(0, 23).join('')}…` : characters.join('')
}

/** 個人ランキング専用の41px行。透明な衣装PNGに背景・アバター枠は付けない。 */
function personalRow(input: {
  rank: number
  name: string
  exp: number
  pictureUrl: string | null
  mine: boolean
}): Record<string, any> {
  const image = safeImage(input.pictureUrl)
  return {
    type: 'box', layout: 'horizontal', height: '41px', spacing: '4px',
    alignItems: 'center', paddingAll: '0px', paddingStart: '6px', paddingEnd: '8px',
    backgroundColor: input.mine ? PERSONAL.selected : '#FFFFFF',
    borderColor: input.mine ? PERSONAL.blue : PERSONAL.border,
    borderWidth: input.mine ? '2px' : '1px', cornerRadius: '6px', flex: 0,
    contents: [
      {
        type: 'box', layout: 'vertical', width: '15px', flex: 0, justifyContent: 'center',
        contents: [{
          type: 'text', text: String(input.rank), size: '20px', weight: 'bold', align: 'center',
          color: PERSONAL.medals[input.rank - 1] ?? PERSONAL.muted,
          wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit',
        }],
      },
      image
        ? { type: 'image', url: image, size: '50px', flex: 0, aspectRatio: '4:3', aspectMode: 'fit' }
        : {
            type: 'box', layout: 'vertical', width: '36px', height: '36px', flex: 0,
            justifyContent: 'center', contents: [{
              type: 'text', text: Array.from(input.name.trim())[0] ?? '?', align: 'center',
              size: '15px', color: PERSONAL.muted,
            }],
          },
      {
        type: 'box', layout: 'vertical', flex: 1, justifyContent: 'center', spacing: '1px',
        contents: [
          {
            type: 'text', text: personalName(input.name), size: '13px', weight: 'bold',
            color: PERSONAL.navy, wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit',
          },
          ...(input.mine ? [{
            type: 'box', layout: 'vertical', width: '35px', height: '12px', flex: 0,
            backgroundColor: PERSONAL.blue, cornerRadius: '6px', justifyContent: 'center',
            contents: [{ type: 'text', text: 'あなた', color: '#FFFFFF', size: '9px', weight: 'bold', align: 'center', wrap: false }],
          }] : []),
        ],
      },
      {
        type: 'box', layout: 'vertical', width: '66px', flex: 0, justifyContent: 'center', spacing: '0px',
        contents: [
          {
            type: 'text', text: num(input.exp), size: '16px', weight: 'bold', color: PERSONAL.navy,
            align: 'end', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit',
          },
          { type: 'text', text: 'EXP', size: '8px', color: PERSONAL.navy, align: 'end', wrap: false },
        ],
      },
    ],
  }
}

/** 44px見出し + 268px本文 + 20pxフッター = 332px。ゲームカードとは独立。 */
function personalCard(rows: Record<string, any>[], myLine: string, siteUrl: string): Record<string, any> {
  const moreUrl = `${siteUrl}/ranking/personal`
  const logo = safeImage(`${siteUrl.replace(/\/$/, '')}/static/dressup/brand-leaf.png`)
  const sections = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', height: '44px', paddingAll: '0px',
      paddingTop: '7px', paddingStart: '10px', paddingEnd: '10px', paddingBottom: '3px',
      backgroundColor: '#FFFFFF', action: { type: 'uri', label: 'ランキングをもっと見る', uri: moreUrl },
      contents: [
        {
          type: 'box', layout: 'horizontal', height: '22px', alignItems: 'center',
          contents: [
            {
              type: 'text', text: 'ランキング', size: '20px', weight: 'bold', color: PERSONAL.navy,
              flex: 1, wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit',
            },
            {
              type: 'box', layout: 'horizontal', width: '85px', flex: 0, spacing: '3px', alignItems: 'center',
              contents: [
                ...(logo ? [{ type: 'image', url: logo, size: '18px', flex: 0, aspectRatio: '1:1', aspectMode: 'fit' }] : []),
                { type: 'text', text: '葉っぱもち', size: '11px', weight: 'bold', color: PERSONAL.navy, wrap: false, adjustMode: 'shrink-to-fit' },
              ],
            },
          ],
        },
        {
          type: 'box', layout: 'vertical', height: '12px', justifyContent: 'center',
          contents: [{ type: 'text', text: '累計トークEXP', size: '10px', color: PERSONAL.navy, wrap: false }],
        },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', height: '268px', paddingAll: '0px',
      paddingStart: '10px', paddingEnd: '10px', paddingBottom: '5px', backgroundColor: '#FFFFFF',
      contents: [
        { type: 'box', layout: 'vertical', height: '217px', spacing: '3px', contents: rows, flex: 0 },
        {
          type: 'box', layout: 'vertical', height: '16px', margin: '2px', justifyContent: 'center', flex: 0,
          contents: [{
            type: 'text', text: myLine || 'まだ順位がついていません', size: '10px', color: PERSONAL.navy,
            align: 'center', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit',
          }],
        },
        {
          type: 'box', layout: 'vertical', height: '26px', margin: '2px', flex: 0,
          backgroundColor: PERSONAL.blue, cornerRadius: '6px', justifyContent: 'center',
          action: { type: 'postback', label: '自分のステータス', data: 'pf|status' },
          contents: [{ type: 'text', text: '自分のステータス', size: '14px', weight: 'bold', color: '#FFFFFF', align: 'center', wrap: false }],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', height: '20px', paddingAll: '0px', justifyContent: 'center',
      backgroundColor: PERSONAL.blue,
      contents: [{ type: 'text', text: 'HappaMochi Bot', size: '10px', color: '#FFFFFF', align: 'center', wrap: false }],
    },
  }
  // LINE stretches carousel bodies to the tallest game card. Keep these three
  // visual sections inside the header: a bubble without a body keeps its height.
  return {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', height: '332px', paddingAll: '0px',
      backgroundColor: '#FFFFFF',
      contents: [sections.header, sections.body, sections.footer],
    },
  }
}

/** 1行分。アイコン + 名前 + 補足。 */
function row(
  rank: number,
  name: string,
  sub: string,
  pictureUrl: string | null
): Record<string, any> {
  const img = safeImage(pictureUrl)

  // アバター。正方形をcover表示し、角だけ少し丸める(丸アイコンにはしない)。
  // 枠は image ではなく、それを包む Box に付ける
  // (image に borderColor は無い。width も無いので絶対に付けない)。
  const avatarBox: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    width: `${AVATAR_PX}px`,
    height: `${AVATAR_PX}px`,
    flex: 0,
    cornerRadius: RADIUS_SM,
    borderColor: C.border,
    borderWidth: BORDER_W,
    backgroundColor: C.bodyBg,
    justifyContent: 'center',
    contents: img
      ? [{ type: 'image', url: img, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }]
      : [
          // 画像が取れない人は頭文字を出す。行の高さは変えない。
          {
            type: 'text',
            text: Array.from(name.trim())[0] ?? '?',
            size: 'md',
            weight: 'bold',
            align: 'center',
            color: C.sub,
          },
        ],
  }

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    alignItems: 'center',
    // アバター上下の余白を詰めてコンパクトな行にする。
    // height は指定しない(文字サイズを大きくした端末で文字が切れるため)。
    paddingAll: '6px',
    paddingStart: '8px',
    paddingEnd: '10px',
    backgroundColor: C.rowBg,
    cornerRadius: RADIUS_SM,
    borderColor: C.border,
    borderWidth: BORDER_W,
    contents: [
      // 順位の数字。名前より控えめにする(小さめ・金銀銅)。
      // 幅を固定して、名前の開始位置を3行で揃える。
      {
        type: 'box',
        layout: 'vertical',
        width: '18px',
        flex: 0,
        justifyContent: 'center',
        contents: [
          {
            type: 'text',
            text: String(rank),
            size: 'sm',
            weight: 'bold',
            color: medalColor(rank),
            align: 'center',
          },
        ],
      },
      avatarBox,
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'none',
        justifyContent: 'center',
        contents: [
          // 名前は濃いグレーの太字。長い名前は末尾を省略し、
          // 下の数値まで押し出さないよう wrap しない。
          { type: 'text', text: name, size: 'md', weight: 'bold', color: C.name, wrap: false },
          // 数値は灰色・通常の太さ
          { type: 'text', text: sub, size: 'xs', color: C.sub, wrap: false, weight: 'regular' },
        ],
      },
    ],
  }
}

/** 「まだ記録がないよ」の行。順位行と同じ白地・細枠にそろえる。 */
function emptyRow(text: string): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '14px',
    backgroundColor: C.rowBg,
    cornerRadius: RADIUS_SM,
    borderColor: C.border,
    borderWidth: BORDER_W,
    contents: [{ type: 'text', text, size: 'sm', color: C.sub, align: 'center', wrap: true }],
  }
}

/**
 * カード1枚。
 *
 * 構造(見本と同じ):
 *   header … 左右いっぱいの青帯。タイトル(白・太字) + 「1〜3位」(小さい白)
 *   body   … ごく薄い水色の土台。その上に白い順位行3つ、自分の順位、ボタン
 *   footer … 左右いっぱいの青帯に白文字の著作権表示
 *
 * 青帯を左右いっぱいに出すため、header と footer には paddingAll を付けず、
 * 内側で上下の余白だけを取る。body 側だけ左右に余白を持たせる。
 */
function card(
  title: string,
  rows: Record<string, any>[],
  myLine: string,
  moreUrl: string,
  showStatus = false
): Record<string, any> {
  return {
    type: 'bubble',
    // 見本のカード幅に合わせる。mega より一段細い。
    // カルーセル内の全バブルで同じ値にそろえる。
    size: 'kilo',

    header: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: C.blue,
      // 左右は0にして青帯を端まで届かせ、上下だけ余白を取る
      paddingAll: '0px',
      paddingTop: '10px',
      paddingBottom: '10px',
      paddingStart: '10px',
      paddingEnd: '10px',
      spacing: 'sm',
      alignItems: 'center',
      justifyContent: 'center',
      contents: [
        // タイトルと「1〜3位」をまとめて中央に置く。
        // 左右の filler は flex を明示する(省略すると均等にならない)。
        { type: 'filler', flex: 1 },
        {
          type: 'text',
          text: title,
          color: C.onBlue,
          weight: 'bold',
          size: 'md',
          flex: 0,
          // 見出しが長くても「ランキング」が消えないよう、
          // 縮小して収める(省略記号で切らない)。
          adjustMode: 'shrink-to-fit',
        },
        {
          type: 'text',
          text: `1〜${TOP_N}位`,
          color: C.onBlue,
          size: 'xxs',
          flex: 0,
          gravity: 'bottom',
        },
        { type: 'filler', flex: 1 },
      ],
    },

    body: {
      type: 'box',
      layout: 'vertical',
      // 行間は詰める(見本は行がぴったり並んでいる)
      spacing: 'xs',
      backgroundColor: C.bodyBg,
      paddingAll: '8px',
      contents: [
        ...rows,
        // 自分の順位。水色の土台の上に灰色文字で中央寄せ。
        {
          type: 'text',
          text: myLine,
          size: 'xs',
          color: C.sub,
          align: 'center',
          wrap: true,
          margin: 'md',
        },
        // 「ランキングをもっと見る」。ヘッダーと同じ青。
        {
          type: 'button',
          style: 'primary',
          color: C.blue,
          height: 'sm',
          margin: 'sm',
          action: { type: 'uri', label: 'ランキングをもっと見る', uri: moreUrl },
        },
        ...(showStatus
          ? [{
              type: 'button',
              style: 'link',
              color: C.blue,
              height: 'sm',
              action: { type: 'postback', label: '自分のステータス', data: 'pf|status' },
            }]
          : []),
      ],
    },

    // 著作権帯。カード下端いっぱいの青帯に白文字。
    // 左右の padding を0にして、青帯の両端が白く残らないようにする。
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.blue,
      paddingAll: '0px',
      paddingTop: '6px',
      paddingBottom: '6px',
      contents: [
        {
          type: 'text',
          text: FOOTER_TEXT,
          size: 'xxs',
          weight: 'bold',
          color: C.onBlue,
          align: 'center',
        },
      ],
    },

    // バブル自体の余白を消して、青帯を左右・下端まで届かせる。
    // (cornerRadius は Box のプロパティなので Bubble には付けない)
    styles: {
      header: { backgroundColor: C.blue },
      body: { backgroundColor: C.bodyBg },
      footer: { backgroundColor: C.blue, separator: false },
    },
  }
}

const num = (n: number) => Math.floor(n).toLocaleString('ja-JP')

/** 秒を 0:00 形式にする(生存時間の表示用) */
const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

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
  // ─── 1枚目: 葉っぱもちランキング(累計EXP・表示だけ5人へ) ───
  let happaRows: Record<string, any>[]
  let happaMine = ''
  try {
    const top = await listRanking(env, PERSONAL_TOP_N, 0)
    // 本人の強調は公開IDで照合する。LINE IDはカードやURLに含めない。
    const own = userId
      ? await env.DB.prepare(`SELECT public_id FROM user_profiles WHERE user_id = ?`)
          .bind(userId).first<{ public_id: string }>()
      : null
    // 取得に失敗しても既存ランキング自体は表示する。LINE IDはURLに載せない。
    const appearances = await getAppearanceByPublicIds(env, top.map((r) => r.public_id)).catch(
      () => ({} as Record<string, { costumeId: string; backgroundId: string }>)
    )
    happaRows =
      top.length > 0
        ? top.map((r) =>
            personalRow({
              rank: r.rank,
              name: r.display_name ?? '名前なし',
              exp: r.total_exp,
              pictureUrl: appearances[r.public_id]
                ? costumeIconUrl(siteUrl, appearances[r.public_id].costumeId)
                : r.picture_url,
              mine: r.public_id === own?.public_id,
            })
          )
        : [emptyRow('まだ記録がありません')]

    const myRank = userId ? await getPersonalRank(env, userId) : null
    happaMine =
      myRank !== null
        ? `あなたは現在 ${num(myRank)}位`
        : 'まだ順位がついていません'
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
            // パズルも同じ理由で「best:」をやめ、単位つきにする。
            row(
              i + 1,
              r.display_name ?? '名前なし',
              `${num(r.best_score)} 点 ・ ${num(r.best_merges)} 回合体`,
              r.picture_url
            )
          )
        : [emptyRow('まだ記録がありません\n「パズル」で遊べます')]

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

  // ─── 3枚目: もち軍団サバイバル ───
  let survRows: Record<string, any>[]
  let survMine = ''
  try {
    const top = await getSurvivorRanking(env, TOP_N)
    survRows =
      top.length > 0
        ? top.map((r, i) =>
            // 「best: 10」だと単位が無く、"ベスト10位" にも読めてしまう。
            // ゲーム内の表記(pt)に合わせ、生存時間も添えて何の数字か分かるようにする。
            row(
              i + 1,
              r.display_name ?? '名前なし',
              `${num(r.best_score)} pt ・ ${mmss(r.best_seconds)} 生存`,
              r.picture_url
            )
          )
        : [emptyRow('まだ記録がありません\n「サバイバル」で遊べます')]

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM survivor_players WHERE plays > 0`
    ).first<{ c: number }>()
    const players = countRow?.c ?? 0

    const mine = userId ? await getMySurvivor(env, userId) : null
    survMine =
      mine !== null && mine.rank !== null
        ? `あなたの順位: ${mine.rank}位 / ${num(players)}人`
        : 'まだ順位がついてないよ' + (players > 0 ? ` / ${num(players)}人参加中` : '')
  } catch {
    survRows = [emptyRow('ランキングを取得できませんでした')]
    survMine = ''
  }

  return {
    type: 'flex',
    altText: 'ランキング',
    contents: {
      type: 'carousel',
      contents: [
        personalCard(happaRows, happaMine, siteUrl),
        card('もち合体パズル', mochiRows, mochiMine, `${siteUrl}/ranking/mochi`),
        card('もち軍団サバイバル', survRows, survMine, `${siteUrl}/ranking/survivor`),
      ],
    },
  }
}
