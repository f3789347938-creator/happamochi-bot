// ローカル検証用ハーネス: src/lib/imageGen.ts と同じレイアウトを Node 上で
// レンダリングし、レガシー画像と数値比較するために使う。本番コードには影響しない。
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
await initWasm(fs.readFileSync(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')))

const fontRegular = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Regular.ttf'))
const fontBold = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Bold.ttf'))

export async function render(markup, out) {
  const svg = await satori(markup, {
    width: 1280, height: 720,
    fonts: [
      { name: 'Noto Sans JP', data: fontRegular, weight: 400, style: 'normal' },
      { name: 'Noto Sans JP', data: fontBold, weight: 700, style: 'normal' },
    ],
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1280 } }).render().asPng()
  fs.writeFileSync(out, png)
  return out
}
