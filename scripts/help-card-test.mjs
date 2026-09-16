// 画像を積んだヘルプFlexの回帰テスト。
// 描画結果は別途確認する。このテストは画像の配信・寸法・掲載順・既存操作を検証する。
// /debug/simulate は設定や対局のDBを書き換えるため、ローカル環境でのみ実行する。
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { HELP_DESIGN } from '../src/features/menu/helpDesign.ts'

const BASE = new URL(process.env.CHESS_TEST_BASE || 'http://localhost:3000')
if (!['localhost', '127.0.0.1', '[::1]'].includes(BASE.hostname)) {
  throw new Error('help-card-test はローカルDB専用です。CHESS_TEST_BASE に localhost を指定してください。')
}
const manifest = JSON.parse(await readFile(new URL('../src/features/menu/helpAssets.json', import.meta.url), 'utf8'))
const expectedPages = [
  ['ヘルプ', 'ステータス', 'ランキング', 'お知らせ', '着せ替え'],
  ['パズル', 'サバイバル', 'オセロ', 'オセロ参加', 'オセロ戦績'],
  ['チェス', '盤面', 'めいく 装飾', 'めいく:本文', '返信して めいく'],
  ['めいく bold虹7:文', 'ウェルカムオン', 'ウェルカムオフ', '取り消し通知オン', '取り消し通知オフ'],
]

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ❌ ${label} ${extra}`)
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const zero = (v) => v === 0 || v === '0' || v === '0px' || v === 'none'
const assetPath = (asset) => `/static/help/${asset.file}`
const pathOf = (node) => {
  try { return new URL(node?.url).pathname } catch { return '' }
}
const commandData = ({ label, desc, send, noAction }) => ({ label, desc, send, noAction: !!noAction })
const nodes = (n, out = []) => {
  if (!n || typeof n !== 'object') return out
  out.push(n)
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach((child) => nodes(child, out))
    else if (value && typeof value === 'object') nodes(value, out)
  }
  return out
}
const actions = (n) => nodes(n).map((node) => node.action).filter(Boolean)
const images = (n) => nodes(n).filter((node) => node.type === 'image')
const localFetch = (path, options = {}) => fetch(new URL(path, BASE), { ...options, redirect: 'error' })

async function simulate(text) {
  const res = await localFetch('/debug/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: 'Cpf_test_helpcmd', userId: 'Upf_test_helpcmd_00000000000001' }),
  })
  if (!res.ok) throw new Error(`simulate ${text}: HTTP ${res.status}`)
  return res.json()
}

async function menu(data) {
  const res = await localFetch('/debug/menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, groupId: 'Cmenu_test_help', userId: 'Umenu_test_help_0000000000000001' }),
  })
  return { status: res.status, body: await res.json() }
}

async function main() {
  console.log('=== 1. デザイン定義と画像一覧の一致 ===')
  ok(manifest.version === 1, '画像一覧の形式が version 1')
  ok(/^[a-f0-9]{64}$/.test(manifest.designHash ?? ''), '描画元を識別する SHA-256 がある')
  ok(HELP_DESIGN.perCard === 5, '1ページ5項目の指定を維持')
  ok(same(HELP_DESIGN.commands.map((c) => c.label), expectedPages.flat()), '20コマンドの掲載順を維持')
  ok(same(manifest.rows.map(commandData), HELP_DESIGN.commands.map(commandData)), '全行の画像とコマンド定義が一致')
  ok(HELP_DESIGN.coverTitle === 'ヘルプ' && HELP_DESIGN.commandTitle === 'コマンド一覧', '表紙と一覧の見出しを維持')
  ok(HELP_DESIGN.welcomeTitle === '葉っぱもちへようこそ', '「葉っぱもちへようこそ」を維持')
  ok(same(HELP_DESIGN.introLines, ['グループでも、1対1でも。', 'ゲームやランキング、画像づくりを', 'いつものトークで楽しもう。']), '紹介文3行を維持')
  ok(HELP_DESIGN.mascotFile === 'happamochi-e061df69.jpg', '正式なもち素材を継続使用')
  ok(HELP_DESIGN.footerText === '© 2026 HappaMochi Bot', 'フッター表記を維持')
  ok(HELP_DESIGN.colors.accent === '#039BE5', '共通の青が #039BE5')
  ok(HELP_DESIGN.colors.cardBg === '#F1FAFE', 'カード背景が淡い水色')
  ok(HELP_DESIGN.colors.itemBg === '#FFFFFF', 'コマンドの項目背景が白')
  ok(HELP_DESIGN.colors.desc === '#21445F', '説明文が見本に合わせた濃い青')
  for (const excluded of ['称号一覧', '称号確認', '称号検索 文字']) {
    ok(!manifest.rows.some((row) => row.label === excluded), `「${excluded}」を掲載していない`)
  }

  console.log('\n=== 2. 表紙1枚 + 一覧4枚のFlex ===')
  const r = await simulate('ヘルプ')
  const msg = r.would_reply_with?.[0]
  ok(msg?.type === 'flex', 'Flexで返る')
  ok(msg?.contents?.type === 'carousel', '横スワイプのカルーセルで返る')
  const cards = msg?.contents?.contents ?? []
  ok(cards.length === 5, '表紙1枚 + 一覧4枚')
  ok(cards.length <= 12, 'カルーセルの上限12枚以内')
  ok(cards.every((card) => card.size === 'kilo'), '全カードの幅が kilo')
  ok(typeof msg?.altText === 'string' && msg.altText.length > 0, '通知に表示する代替テキストがある')

  const expectedBodies = [
    [manifest.cover, manifest.cta],
    ...expectedPages.map((_, page) => [manifest.header, ...manifest.rows.slice(page * 5, page * 5 + 5)]),
  ]
  cards.forEach((card, index) => {
    const body = card.body?.contents ?? []
    const footer = card.footer?.contents ?? []
    ok(card.body?.layout === 'vertical' && zero(card.body?.paddingAll) && zero(card.body?.spacing), `${index + 1}枚目は画像間に追加余白を作らない`)
    ok(body.every((item) => item.type === 'image'), `${index + 1}枚目の本文は画像のみ`)
    ok(same(body.map(pathOf), expectedBodies[index]?.map(assetPath)), `${index + 1}枚目の画像・掲載順が指定どおり`)
    ok(zero(card.footer?.paddingAll) && footer.length === 1 && footer[0]?.type === 'image', `${index + 1}枚目のフッターは余白なしの画像1枚`)
    ok(pathOf(footer[0]) === assetPath(manifest.footer), `${index + 1}枚目は共通フッターを使用`)
    ok(!nodes(card).some((node) => node.type === 'filler' || node.type === 'spacer'), `${index + 1}枚目に余白を伸ばす filler がない`)
    if (index > 0) ok(body.length - 1 === 5, `${index + 1}枚目は見出し + 5コマンド`)
  })

  console.log('\n=== 3. 画像のタップと既存コマンドの対応 ===')
  const rowImages = cards.slice(1).flatMap((card) => (card.body?.contents ?? []).slice(1))
  const msgActions = actions(msg?.contents).filter((action) => action.type === 'message')
  ok(msgActions.length === 17, '押せるコマンドは従来どおり17個')
  ok(actions(msg?.contents).every((action) => action.type !== 'postback'), 'コマンドは発言として送る message アクション')
  ok(new Set(msgActions.map((action) => action.text)).size === msgActions.length, '送信コマンドに重複がない')
  manifest.rows.forEach((row, index) => {
    const action = rowImages[index]?.action
    if (row.noAction) {
      ok(action === undefined, `「${row.label}」は入力が必要なため説明のみ`)
    } else {
      ok(same(action, { type: 'message', label: row.label, text: row.send ?? row.label }), `「${row.label}」は従来のコマンドを送る`)
    }
  })
  ok(same(manifest.rows.filter((row) => row.noAction).map((row) => row.label), ['めいく:本文', '返信して めいく', 'めいく bold虹7:文']), '説明のみの3項目を維持')
  const uris = actions(cards[0]).filter((action) => action.type === 'uri')
  ok(uris.length === 1 && uris[0]?.label === '公式サイトを見る', '表紙に公式サイトのリンクが1つある')
  ok(uris[0]?.uri?.startsWith('https://'), '公式サイトのリンクは https')
  ok(cards[0]?.body?.contents?.[1]?.action === uris[0], '公式サイトの画像そのものをタップできる')
  ok(actions(msg?.contents).length === 18, '見出しやフッターに余計な操作がない')

  console.log('\n=== 4. 既存コマンド・メニューの回帰 ===')
  for (const command of msgActions) {
    const rr = await simulate(command.text)
    ok((rr.would_reply_with ?? []).length > 0, `「${command.text}」に既存処理が返信する`)
  }
  const oldMenu = await menu('hm|n|M')
  ok(oldMenu.status === 200 && oldMenu.body?.would_reply_with?.[0]?.contents?.type === 'carousel', '旧メニューが Postback から引き続き開く')
  const allCommands = await menu('hm|n|H03:1')
  ok(allCommands.status === 200 && (allCommands.body?.would_reply_with ?? []).length > 0, '旧全コマンド画面が開く')
  const alias = await simulate('help')
  ok(same(alias.would_reply_with?.[0], msg), 'help と ヘルプ が同じFlexを返す')

  console.log('\n=== 5. Flexサイズ・画像寸法・高さ揃え ===')
  const assets = [manifest.header, manifest.cover, manifest.cta, manifest.footer, ...manifest.rows]
  const assetsByPath = new Map(assets.map((asset) => [assetPath(asset), asset]))
  const allImages = images(msg?.contents)
  ok(assetsByPath.size === 24, '描画済みの24素材をすべて識別できる')
  ok(allImages.every((im) => im.url?.startsWith('https://')), '画像URLはすべて https')
  ok(allImages.every((im) => im.width === undefined && im.height === undefined), 'Flex image に未対応の width / height を指定していない')
  ok(allImages.every((im) => im.size === 'full' && im.aspectMode === 'fit'), 'すべての画像は全幅・縦横比維持で表示')
  ok(allImages.every((im) => im.margin === undefined || zero(im.margin)), '画像間に margin がない')
  ok(allImages.every((im) => {
    const asset = assetsByPath.get(pathOf(im))
    return asset && im.aspectRatio === `${asset.width}:${asset.height}`
  }), '全画像の aspectRatio が実素材の寸法と一致')
  const normalizedHeight = (list) => list.reduce((sum, asset) => sum + asset.height / asset.width, 0)
  const heights = expectedBodies.map((body) => normalizedHeight([...body, manifest.footer]))
  ok(Math.max(...heights) - Math.min(...heights) < 0.000001, '全5枚は画像の高さ合計が一致し、余白による高さ合わせが不要')
  ok(assets.every((asset) => asset.width > 0 && asset.width <= 1024 && asset.height > 0 && asset.height <= 1024), '各画像が1024px以内')
  ok(assets.every((asset) => asset.height <= asset.width * 3), '画像の縦横比がFlexの範囲内')
  ok(Buffer.byteLength(JSON.stringify(msg?.contents)) < 30000, 'Flex全体が従来の30KB予算以内')
  cards.forEach((card, index) => ok(Buffer.byteLength(JSON.stringify(card)) < 10000, `${index + 1}枚目が従来の10KB予算以内`))

  console.log('\n=== 6. 全PNGをローカル配信から検査 ===')
  for (const asset of assets) {
    // Flex内の本番URLにはアクセスせず、同じパスをローカルサーバーから取得する。
    const response = await localFetch(assetPath(asset))
    const png = Buffer.from(await response.arrayBuffer())
    ok(response.status === 200 && (response.headers.get('content-type') ?? '').includes('image/png'), `${asset.file} が PNG / 200 で配信される`)
    const valid = png.length >= 33 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.toString('ascii', 12, 16) === 'IHDR'
    ok(valid && png.readUInt32BE(16) === asset.width && png.readUInt32BE(20) === asset.height, `${asset.file} のPNG実寸が画像一覧と一致`)
    ok(png.length > 0 && png.length <= 1_000_000, `${asset.file} が1MB以内`)
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 12)
    ok(asset.file.endsWith(`-${hash}.png`), `${asset.file} のファイル名が内容ハッシュと一致`)
  }

  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${failures.length}`)
  if (failures.length > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
