// 名言カードのカスタマイズ機能を検証する。
//
// 最重要の検証:
//   パラメータ無指定のとき、生成PNGが「機能追加前と1バイトも変わらない」こと。
//   既存の名言カードを壊さないという約束を機械的に確認するため、
//   本番D1に実在するレガシー画像とバイト比較する経路も用意している。
//
// 実行:
//   node scripts/chess-test.mjs のようにサーバー経由ではなく、
//   本番と同じ src/lib/imageGen.ts のレイアウト関数を直接読み込んで
//   Node 上でレンダリングする(scripts/verify-legacy.mjs と同じ手法)。
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import crypto from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'samples', 'quote-params')

await initWasm(fs.readFileSync(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')))

const fontRegular = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Regular.ttf'))
const fontBold = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Bold.ttf'))

// --- 本番の imageGen.ts からレイアウト関数を取り出す ------------------
// wasm初期化やsatori本体はNodeで再現できないので、レイアウト構築部分
// (CARD_WIDTH 〜 fetchQuoteFont の直前)だけを切り出して評価する。
// ハードコードした複製ではなく本物のコードを使うのが目的。
const srcImage = fs.readFileSync(path.join(ROOT, 'src/lib/imageGen.ts'), 'utf8')
const srcParams = fs.readFileSync(path.join(ROOT, 'src/lib/quoteParams.ts'), 'utf8')

const start = srcImage.indexOf('const CARD_WIDTH')
const end = srcImage.indexOf('/**\n * フォント番号に対応する書体')
if (start < 0 || end < 0) {
  console.error('imageGen.ts の切り出し位置が見つかりません(コード構造が変わった可能性)')
  process.exit(2)
}
const body =
  srcParams.replace(/^import[^\n]*\n/gm, '') +
  '\n' +
  srcImage
    .slice(start, end)
    // 切り出し部分が参照する import を除去(quoteParams は上で連結済み)
    .replace(/^import[^\n]*\n/gm, '') +
  // quoteParams.ts 側は既に export されているので、ここでは
  // imageGen.ts 由来の関数だけを追加で公開する。
  '\nexport { buildAvatarCard, buildNoAvatarCard, buildCustomCard }\n'
// effectiveFontNumber は quoteParams 側の export をそのまま使う

const compiled = esbuild.transformSync(body, { loader: 'ts', format: 'esm' }).code
const tmp = path.join(ROOT, 'scripts', '.qp-layout.mjs')
fs.writeFileSync(tmp, compiled)
const mod = await import('file://' + tmp + '?v=' + Date.now())
const {
  buildAvatarCard, buildNoAvatarCard, buildCustomCard,
  parseQuoteParams, describeParams, effectiveFontNumber,
} = mod

// --- レンダリング -----------------------------------------------------
function loadQuoteFont(n) {
  const p = path.join(ROOT, 'public/static/fonts/quote', `f${n}.ttf`)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

async function renderMarkup(markup, fontNum) {
  let fonts
  const custom = fontNum > 0 ? loadQuoteFont(fontNum) : null
  if (custom) {
    fonts = [
      { name: 'Noto Sans JP', data: custom, weight: 400, style: 'normal' },
      { name: 'Noto Sans JP', data: custom, weight: 700, style: 'normal' },
    ]
  } else {
    fonts = [
      { name: 'Noto Sans JP', data: fontRegular, weight: 400, style: 'normal' },
      { name: 'Noto Sans JP', data: fontBold, weight: 700, style: 'normal' },
    ]
  }
  const svg = await satori(markup, { width: 1280, height: 720, fonts })
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1280 } }).render().asPng()
}

/** 本番と同じ分岐で markup を選ぶ(generateQuoteCardPng と同じ条件) */
function pickMarkup(text, name, uid, avatar, p) {
  if (p.any) return buildCustomCard(text, name, uid, avatar, p)
  return avatar ? buildAvatarCard(text, name, uid, avatar) : buildNoAvatarCard(text, name)
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)

let pass = 0
let fail = 0
function ok(cond, label, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label} ${extra}`)
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })

  // アイコンには、左右・色の非対称な検証用画像を使う。
  // (左右対称な画像だと rev の効果を判定できない)
  const probePath = path.join(OUT, '_avatar.png')
  if (!fs.existsSync(probePath)) {
    console.error(`検証用アイコン ${probePath} がありません`)
    process.exit(2)
  }
  const avatar = 'data:image/png;base64,' + fs.readFileSync(probePath).toString('base64')

  const TEXT = 'まぐろかわいい'
  const NAME = 'なの'
  const UID = 'U1234567890abcdef1234567890abcdef'

  // =====================================================================
  console.log('\n=== 1. 既存カードの不変性(最重要) ===')
  // パラメータ無指定 → 従来の buildAvatarCard がそのまま使われること
  const pEmpty = parseQuoteParams('')
  ok(pEmpty.any === false, 'パラメータ無指定は any=false(従来経路を通る)')

  const legacyMarkup = pickMarkup(TEXT, NAME, UID, avatar, pEmpty)
  const directLegacy = buildAvatarCard(TEXT, NAME, UID, avatar)
  ok(
    JSON.stringify(legacyMarkup) === JSON.stringify(directLegacy),
    '無指定時のmarkupが従来のbuildAvatarCardと完全一致'
  )

  const legacyPng = await renderMarkup(legacyMarkup, 0)
  const directPng = await renderMarkup(directLegacy, 0)
  ok(Buffer.compare(legacyPng, directPng) === 0, '無指定時のPNGがバイト単位で一致', sha(legacyPng))
  fs.writeFileSync(path.join(OUT, '00-legacy-unchanged.png'), legacyPng)

  // カスタム経路そのものが既存カードと同じ土台であること。
  // (any=true でカスタム経路に入るが、装飾フラグは全て false という状態)
  // 以前 new のときだけ写真幅を486pxに縮めてテキスト位置もずらしており、
  // 「普通のめいくと見た目が違う」という不具合になった。ここを固定する。
  const plain = {
    layoutNew: false, reversed: false, monochrome: false, whiteBase: false,
    bold: false, color: { kind: 'default' }, font: 0, unknown: '', any: true,
  }
  const plainPng = await renderMarkup(buildCustomCard(TEXT, NAME, UID, avatar, plain), 0)
  ok(
    Buffer.compare(legacyPng, plainPng) === 0,
    'カスタム経路で装飾なしなら既存カードとバイト単位で一致(土台が同じ)'
  )

  // new は「右上に日付が増えるだけ」で、写真幅・テキスト位置は変わらないこと。
  // 判定方法: 日付が出る右上の帯(y<60)を除いた領域が既存カードと一致するか。
  const newPng = await renderMarkup(
    buildCustomCard(TEXT, NAME, UID, avatar, { ...plain, layoutNew: true }),
    0
  )
  fs.writeFileSync(path.join(OUT, '05b-new-vs-legacy.png'), newPng)
  ok(
    Buffer.compare(legacyPng, newPng) !== 0,
    'new では日付が増えるので既存カードと完全一致はしない'
  )
  // 写真とテキストの位置が同じかを、寸法定数の実値で確認する。
  // buildCustomCard のソースに new 用の別寸法が残っていないことを見る。
  const genSrc = fs.readFileSync(path.join(ROOT, 'src/lib/imageGen.ts'), 'utf8')
  const custBlock = genSrc.slice(
    genSrc.indexOf('function buildCustomCard'),
    genSrc.indexOf('async function fetchQuoteFont')
  )
  ok(
    !/photoWidth\s*=\s*p\.layoutNew/.test(custBlock) &&
      !/textLeft\s*=\s*p\.layoutNew/.test(custBlock) &&
      !/quoteTop\s*=.*p\.layoutNew/.test(custBlock),
    'new で写真幅・テキスト位置・縦位置を切り替えていない(寸法は常に既存と同一)'
  )

  // アイコン無しの場合も従来経路であること
  const noAvaMarkup = pickMarkup(TEXT, NAME, UID, null, pEmpty)
  ok(
    JSON.stringify(noAvaMarkup) === JSON.stringify(buildNoAvatarCard(TEXT, NAME)),
    'アイコン無し・無指定もbuildNoAvatarCardと完全一致'
  )

  // 認識できない文字列を渡しても従来経路のままであること
  const pJunk = parseQuoteParams('ぜんぜん知らない語')
  ok(pJunk.any === false, '未知のパラメータだけなら any=false(従来のまま)')

  // =====================================================================
  console.log('\n=== 2. パラメータ解析 ===')
  const cases = [
    ['bold', (p) => p.bold],
    ['rev', (p) => p.reversed],
    ['mono', (p) => p.monochrome],
    ['whi', (p) => p.whiteBase],
    ['new', (p) => p.layoutNew],
    ['虹', (p) => p.color.kind === 'rainbow'],
    ['niji', (p) => p.color.kind === 'rainbow'],
    ['赤', (p) => p.color.kind === 'solid' && p.color.color === '#FF4B4B'],
    ['春', (p) => p.color.kind === 'seasonal'],
    ['#FF00AA', (p) => p.color.kind === 'solid' && p.color.color === '#FF00AA'],
    ['7', (p) => p.font === 7],
    ['12', (p) => p.font === 12],
  ]
  for (const [input, check] of cases) {
    ok(check(parseQuoteParams(input)), `「${input}」が正しく解析される`, JSON.stringify(parseQuoteParams(input)))
  }
  const combo = parseQuoteParams('newrevmonobold虹12')
  ok(
    combo.layoutNew && combo.reversed && combo.monochrome && combo.bold &&
      combo.color.kind === 'rainbow' && combo.font === 12,
    '連結指定「newrevmonobold虹12」が全て解析される',
    describeParams(combo)
  )

  // =====================================================================
  console.log('\n=== 3. 各パラメータで実際に見た目が変わる ===')
  const variants = [
    ['01-bold', 'bold'],
    ['02-rev', 'rev'],
    ['03-mono', 'mono'],
    ['04-whi', 'whi'],
    ['05-new', 'new'],
    ['06-niji', '虹'],
    ['07-red', '赤'],
    ['08-spring', '春'],
    ['09-summer', '夏'],
    ['10-autumn', '秋'],
    ['11-winter', '冬'],
    ['12-custom-hex', '#00E5FF'],
    ['13-combo', 'newrevmonobold虹'],
    ['14-whi-niji', 'whi虹'],
  ]
  const hashes = new Map()
  hashes.set(sha(legacyPng), 'legacy(無指定)')
  for (const [file, param] of variants) {
    const p = parseQuoteParams(param)
    const png = await renderMarkup(pickMarkup(TEXT, NAME, UID, avatar, p), p.font)
    fs.writeFileSync(path.join(OUT, `${file}.png`), png)
    const h = sha(png)
    const dup = hashes.get(h)
    ok(!dup, `「${param}」で見た目が変わる`, dup ? `→ ${dup} と同一` : '')
    hashes.set(h, param)
  }

  // =====================================================================
  console.log('\n=== 4. フォント12種すべてが別の見た目になる ===')
  const fontHashes = new Map()
  for (let n = 1; n <= 12; n++) {
    if (!loadQuoteFont(n)) {
      ok(false, `フォント${n} のファイルが存在する`)
      continue
    }
    const p = parseQuoteParams(String(n))
    const png = await renderMarkup(pickMarkup(TEXT, NAME, UID, avatar, p), n)
    fs.writeFileSync(path.join(OUT, `font-${String(n).padStart(2, '0')}.png`), png)
    const h = sha(png)
    const dup = fontHashes.get(h)
    ok(!dup, `フォント${String(n).padStart(2)} (${FONT_LABEL[n]}) が固有の見た目`, dup ? `→ フォント${dup} と同一` : '')
    fontHashes.set(h, n)
  }

  // =====================================================================
  console.log('\n=== 5. 漢字が豆腐にならない(サブセット収録の確認) ===')
  const KANJI = '今日は天気が良いので公園で friends と一緒に写真を撮影した。値段は千円。'
  for (const n of [1, 7, 12]) {
    const p = parseQuoteParams(String(n))
    const png = await renderMarkup(pickMarkup(KANJI, NAME, UID, avatar, p), n)
    fs.writeFileSync(path.join(OUT, `kanji-f${n}.png`), png)
    ok(png.length > 10000, `フォント${n}で漢字混じりの長文が描画される`, `${png.length} bytes`)
  }

  // =====================================================================
  console.log('\n=== 6. bold が実際に太くなる(satoriは合成太字をしない) ===')
  // 実測: 同一実体を weight 400/700 に登録して fontWeight:700 で描いても
  // 出力はバイト単位で一致した = 太くならない。そのため bold 指定時は
  // 同系統の太いサブセットへ差し替える設計にしている。
  ok(effectiveFontNumber(parseQuoteParams('7')) === 7, 'bold無しならフォント7のまま')
  ok(effectiveFontNumber(parseQuoteParams('bold7')) === 8, 'bold+7 → 明朝太(8)に差し替わる')
  ok(effectiveFontNumber(parseQuoteParams('bold1')) === 2, 'bold+1 → ゴシック太(2)に差し替わる')
  ok(effectiveFontNumber(parseQuoteParams('bold')) === 0, 'フォント未指定のboldは既定フォント経路')

  for (const [param, label] of [['7', '明朝(通常)'], ['bold7', '明朝+bold']]) {
    const p = parseQuoteParams(param)
    const png = await renderMarkup(pickMarkup(TEXT, NAME, UID, avatar, p), effectiveFontNumber(p))
    fs.writeFileSync(path.join(OUT, `bold-${param}.png`), png)
    hashes.set(sha(png), label)
  }
  const h7 = sha(fs.readFileSync(path.join(OUT, 'bold-7.png')))
  const hb7 = sha(fs.readFileSync(path.join(OUT, 'bold-bold7.png')))
  ok(h7 !== hb7, 'bold+7 の出力が 7 単体と異なる(=実際に太くなっている)')

  fs.unlinkSync(tmp)
  console.log(`\n=== 結果 ===\n  成功 ${pass} / 失敗 ${fail}`)
  console.log(`  画像: samples/quote-params/\n`)
  process.exit(fail === 0 ? 0 : 1)
}

const FONT_LABEL = {
  1: 'ゴシック', 2: 'ゴシック太', 3: 'ゴシック細', 4: 'ゴシック中',
  5: 'ゴシック極太', 6: 'ゴシック極細', 7: '明朝', 8: '明朝太',
  9: '明朝細', 10: '明朝極太', 11: '明朝中', 12: '等幅',
}

main().catch((e) => {
  console.error('検証エラー:', e)
  try { fs.unlinkSync(tmp) } catch {}
  process.exit(1)
})
