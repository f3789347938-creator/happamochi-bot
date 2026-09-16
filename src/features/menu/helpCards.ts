// ヘルプ専用カルーセル。見本の書体・余白・装飾を端末ごとに変えないため、
// コードから描画した画像をヘッダー / コマンド1件 / フッター単位で並べる。
// 各行の画像自体に既存の message アクションを付ける。座標の重ね合わせは使わない。
// 文言・配色・正式素材は helpDesign.ts に集約。npm run build で画像も再生成する。
// 共用 menu/flex.ts、ゲーム、DB、各コマンドの処理は変更しない。
import type { LineMessage } from '../../lib/line'
import { HELP_DESIGN } from './helpDesign'
import assets from './helpAssets.json'

interface Asset {
  file: string
  width: number
  height: number
}

interface Command {
  label: string
  desc: string
  send?: string
  noAction?: boolean
}

const PER_CARD = HELP_DESIGN.perCard // 1ページ5件。配列から自動分割する。
const FLEX_LIMIT = 30000
const FLEX_SAFE = 28500
const CAROUSEL_MAX = 12
const bytesOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

function picture(asset: Asset, siteUrl: string, action?: Record<string, string>): Record<string, any> {
  return {
    type: 'image',
    url: `${siteUrl.replace(/\/$/, '')}/static/help/${asset.file}`,
    size: 'full',
    aspectRatio: `${asset.width}:${asset.height}`,
    aspectMode: 'fit',
    flex: 0,
    // image に width/height は付けない。比率だけで縮尺を揃える。
    ...(action ? { action } : {}),
  }
}

function row(cmd: Command, siteUrl: string): Record<string, any> {
  const asset = assets.rows.find((item) => item.label === cmd.label)
  // 古い画像と新しいアクションの組合せを公開しない。
  if (!asset || asset.desc !== cmd.desc || (asset.send ?? '') !== (cmd.send ?? '')
    || Boolean(asset.noAction) !== Boolean(cmd.noAction)) {
    throw new Error(`Help artwork is stale: ${cmd.label}. Run npm run build.`)
  }
  return picture(asset, siteUrl, cmd.noAction ? undefined : {
    type: 'message', label: cmd.label, text: cmd.send ?? cmd.label,
  })
}

function bubble(contents: Record<string, any>[], siteUrl: string): Record<string, any> {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
      backgroundColor: HELP_DESIGN.colors.cardBg,
      contents,
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
      backgroundColor: HELP_DESIGN.colors.accent,
      contents: [picture(assets.footer, siteUrl)],
    },
  }
}

export function buildHelpCarousel(siteUrl: string): LineMessage {
  const cover = bubble([
    picture(assets.cover, siteUrl),
    picture(assets.cta, siteUrl, { type: 'uri', label: '公式サイトを見る', uri: siteUrl }),
  ], siteUrl)
  const pages = []
  for (let start = 0; start < HELP_DESIGN.commands.length; start += PER_CARD) {
    const commands = HELP_DESIGN.commands.slice(start, start + PER_CARD)
    pages.push(bubble([
      picture(assets.header, siteUrl),
      ...commands.map((cmd) => row(cmd, siteUrl)),
    ], siteUrl))
  }
  let cards = [cover, ...pages].slice(0, CAROUSEL_MAX)
  while (cards.length > 2 && bytesOf({ type: 'carousel', contents: cards }) > FLEX_SAFE) {
    cards = cards.slice(0, -1)
  }
  return {
    type: 'flex',
    altText: '葉っぱもちのヘルプ（横にスワイプ・各項目をタップできます）',
    contents: { type: 'carousel', contents: cards },
  }
}

export const HELP_FLEX_LIMIT = FLEX_LIMIT

export function helpCommandTexts(): string[] {
  return HELP_DESIGN.commands.filter((cmd: Command) => !cmd.noAction)
    .map((cmd: Command) => cmd.send ?? cmd.label)
}
