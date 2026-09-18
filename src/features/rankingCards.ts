// 「ランキング」の横スワイプカード。順位・レベルの計算は既存の各機能を使う。
import type { LineEnv, LineMessage } from '../lib/line'
import { listRanking, getPersonalRank, countProfiles } from './profile/core'
import { getRanking as getMochiRanking, getMyScore as getMyMochiScore } from './mochiScore'
import { getSurvivorRanking, getMySurvivor } from './survivor'
import { getRankingIconsByPublicIds, getRankingIconsByUserIds, rankingIconUrl, type RankingIcon } from './rankingIcon'

const C = {
  blue: '#039BE5', bodyBg: '#E1F5FE', rowBg: '#FFFFFF', border: '#BFE3EF', name: '#333333', sub: '#6F858B',
}
const MEDAL = ['#D4AF37', '#949DA3', '#B87939']
const TOP_N = 3
const FOOTER_TEXT = '© 2026 HappaMochi Bot'
const num = (n: number) => Math.floor(n).toLocaleString('ja-JP')
const noIcons = (): Record<string, RankingIcon> => ({})

/** LINEのimageにwidthは指定しない。サイズ・枠は外側のBoxが持つ。 */
function row(rank: number, name: string, sub: string, pictureUrl: string | null, costume = false): Record<string, any> {
  const image = pictureUrl?.startsWith('https://') && pictureUrl.length <= 1000 ? pictureUrl : null
  return {
    type: 'box', layout: 'horizontal', height: '56px', flex: 0,
    spacing: '6px', alignItems: 'center',
    paddingAll: '5px', paddingStart: '7px', paddingEnd: '7px',
    backgroundColor: C.rowBg, cornerRadius: '5px', borderColor: C.border, borderWidth: '1px',
    contents: [
      {
        type: 'box', layout: 'vertical', width: '12px', flex: 0, justifyContent: 'center',
        contents: [{
          type: 'text', text: String(rank), size: '13px', weight: 'bold',
          color: MEDAL[rank - 1] ?? C.sub, align: 'center', wrap: false,
        }],
      },
      {
        type: 'box', layout: 'vertical', width: '44px', height: '44px', flex: 0,
        cornerRadius: '4px', borderColor: C.border, borderWidth: '1px',
        backgroundColor: C.bodyBg, justifyContent: 'center',
        contents: image
          ? [{ type: 'image', url: image, size: 'full', aspectRatio: '1:1', aspectMode: costume ? 'fit' : 'cover' }]
          : [{ type: 'text', text: Array.from(name.trim())[0] ?? '?', size: '16px', weight: 'bold', align: 'center', color: C.sub }],
      },
      {
        type: 'box', layout: 'vertical', flex: 1, spacing: '1px', justifyContent: 'center',
        contents: [
          { type: 'text', text: name.trim() || '名前なし', size: '16px', weight: 'bold', color: C.name, wrap: false, maxLines: 1 },
          { type: 'text', text: sub, size: '11px', color: C.sub, weight: 'regular', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit' },
        ],
      },
    ],
  }
}

function emptyRow(text: string): Record<string, any> {
  return {
    type: 'box', layout: 'vertical', height: '56px', flex: 0, paddingAll: '7px',
    backgroundColor: C.rowBg, cornerRadius: '5px', borderColor: C.border, borderWidth: '1px',
    justifyContent: 'center',
    contents: [{ type: 'text', text, size: '11px', color: C.sub, align: 'center', wrap: true }],
  }
}

/** 見本の比率: 幅260px、上帯37px + 本文267px + 下帯22px = 高さ326px。 */
function card(title: string, rows: Record<string, any>[], myLine: string, moreUrl: string): Record<string, any> {
  return {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'horizontal', height: '37px', paddingAll: '0px',
      paddingStart: '9px', paddingEnd: '9px', backgroundColor: C.blue,
      alignItems: 'center', justifyContent: 'center', spacing: '4px',
      contents: [
        { type: 'text', text: title, size: '16px', weight: 'bold', color: '#FFFFFF', flex: 0, wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit' },
        { type: 'text', text: `1〜${TOP_N}位`, size: '11px', weight: 'bold', color: '#FFFFFF', flex: 0, wrap: false, gravity: 'center', offsetTop: '3px' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', height: '267px', paddingAll: '8px', backgroundColor: C.bodyBg,
      contents: [
        // 記録が3人未満・取得失敗でも帯とボタンの位置を変えない。
        { type: 'box', layout: 'vertical', height: '178px', flex: 0, spacing: '5px', contents: rows },
        {
          type: 'box', layout: 'vertical', height: '14px', flex: 0, margin: '10px', justifyContent: 'center',
          contents: [{ type: 'text', text: myLine || 'まだ順位がついていません', size: '11px', color: C.sub, align: 'center', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit' }],
        },
        {
          type: 'box', layout: 'vertical', height: '40px', flex: 0, margin: '9px',
          backgroundColor: C.blue, cornerRadius: '8px', justifyContent: 'center',
          action: { type: 'uri', label: 'ランキングをもっと見る', uri: moreUrl },
          contents: [{ type: 'text', text: 'ランキングをもっと見る', size: '17px', color: '#FFFFFF', align: 'center', wrap: false, maxLines: 1, adjustMode: 'shrink-to-fit' }],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', height: '22px', paddingAll: '0px',
      backgroundColor: C.blue, justifyContent: 'center',
      contents: [{ type: 'text', text: FOOTER_TEXT, size: '11px', weight: 'bold', color: '#FFFFFF', align: 'center', wrap: false }],
    },
    styles: {
      header: { backgroundColor: C.blue }, body: { backgroundColor: C.bodyBg },
      footer: { backgroundColor: C.blue, separator: false },
    },
  }
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 個人EXP・パズル・サバイバルを同じ大きさのカルーセルで返す。 */
export async function buildRankingCarousel(env: LineEnv, siteUrl: string, userId: string | null): Promise<LineMessage> {
  const baseUrl = siteUrl.replace(/\/$/, '')
  let happaRows: Record<string, any>[]
  let happaMine = ''
  try {
    const top = await listRanking(env, TOP_N, 0)
    // 未設定・移行前はLINEのプロフィール画像。着せ替えとアイコン選択は独立。
    const icons = await getRankingIconsByPublicIds(env, top.map(r => r.public_id)).catch(noIcons)
    happaRows = top.length
      ? top.map(r => row(r.rank, r.display_name ?? '名前なし', `Lv.${r.level} exp: ${num(r.total_exp)}`,
          rankingIconUrl(baseUrl, icons[r.public_id], r.picture_url), !!icons[r.public_id]?.costumeId))
      : [emptyRow('まだ記録がありません')]
    const [myRank, players] = await Promise.all([userId ? getPersonalRank(env, userId) : null, countProfiles(env)])
    happaMine = myRank !== null
      ? `あなたの順位: ${num(myRank)}位 / ${num(players)}人`
      : 'まだ順位がついていません'
  } catch {
    happaRows = [emptyRow('ランキングを取得できませんでした')]
  }

  let mochiRows: Record<string, any>[]
  let mochiMine = ''
  try {
    const top = await getMochiRanking(env, TOP_N)
    const icons = await getRankingIconsByUserIds(env, top.map(r => r.user_id)).catch(noIcons)
    mochiRows = top.length
      ? top.map((r, i) => row(i + 1, r.display_name ?? '名前なし', `${num(r.best_score)} 点 ・ ${num(r.best_merges)} 回合体`,
          rankingIconUrl(baseUrl, icons[r.user_id], r.picture_url), !!icons[r.user_id]?.costumeId))
      : [emptyRow('まだ記録がありません\n「パズル」で遊べます')]
    const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM mochi_scores WHERE best_score > 0`).first<{ c: number }>()
    const players = count?.c ?? 0
    const mine = userId ? await getMyMochiScore(env, userId) : null
    mochiMine = mine !== null && mine.row.best_score > 0
      ? `あなたの順位: ${num(mine.rank)}位 / ${num(players)}人`
      : 'まだ順位がついていません'
  } catch {
    mochiRows = [emptyRow('ランキングを取得できませんでした')]
  }

  let survRows: Record<string, any>[]
  let survMine = ''
  try {
    const top = await getSurvivorRanking(env, TOP_N)
    const icons = await getRankingIconsByUserIds(env, top.map(r => r.user_id)).catch(noIcons)
    survRows = top.length
      ? top.map((r, i) => row(i + 1, r.display_name ?? '名前なし', `${num(r.best_score)} pt ・ ${mmss(r.best_seconds)} 生存`,
          rankingIconUrl(baseUrl, icons[r.user_id], r.picture_url), !!icons[r.user_id]?.costumeId))
      : [emptyRow('まだ記録がありません\n「サバイバル」で遊べます')]
    const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM survivor_players WHERE plays > 0`).first<{ c: number }>()
    const players = count?.c ?? 0
    const mine = userId ? await getMySurvivor(env, userId) : null
    survMine = mine !== null && mine.rank !== null
      ? `あなたの順位: ${num(mine.rank)}位 / ${num(players)}人`
      : 'まだ順位がついていません'
  } catch {
    survRows = [emptyRow('ランキングを取得できませんでした')]
  }

  return {
    type: 'flex', altText: 'ランキング',
    contents: { type: 'carousel', contents: [
      card('葉っぱもちランキング', happaRows, happaMine, `${baseUrl}/ranking/personal`),
      card('もち合体パズル', mochiRows, mochiMine, `${baseUrl}/ranking/mochi`),
      card('もち軍団サバイバル', survRows, survMine, `${baseUrl}/ranking/survivor`),
    ] },
  }
}
