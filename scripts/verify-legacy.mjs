// 本番の src/lib/imageGen.ts のレイアウト関数を実際に読み込んでレンダリングし、
// レガシー実物との一致を検証する。ハードコードした複製ではなく本物を使う。
import fs from 'node:fs'
import path from 'node:path'
import { render } from './render-local.mjs'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(ROOT,'src/lib/imageGen.ts'),'utf8')
// wasm初期化やsatori本体を含まない、レイアウト構築部分だけを抜き出す
const start = src.indexOf('const CARD_WIDTH')
const end = src.indexOf('// Renders the "meigen card"')
const body = src.slice(start,end) + '\nexport { buildAvatarCard, buildNoAvatarCard, quoteFontSize, noAvatarQuoteFontSize }\n'
const out = esbuild.transformSync(body, { loader:'ts', format:'esm' }).code
const tmp = path.join(ROOT,'scripts','.layout.mjs')
fs.writeFileSync(tmp, out)
const { buildAvatarCard, buildNoAvatarCard } = await import('file://'+tmp+'?v='+Date.now())

const avatar = fs.readFileSync('/tmp/qcmp/avatar.b64','utf8')
const cases = JSON.parse(process.argv[2])
for (const c of cases) {
  const markup = c.noavatar
    ? buildNoAvatarCard(c.q, c.name)
    : buildAvatarCard(c.q, c.name, c.uid, avatar)
  await render(markup, c.out)
  console.log('rendered', c.out)
}
fs.unlinkSync(tmp)
