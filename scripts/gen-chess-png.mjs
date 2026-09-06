import { Resvg, initWasm } from '@resvg/resvg-wasm'
import fs from 'node:fs'
import path from 'node:path'
await initWasm(fs.readFileSync('/home/user/happamochi-bot/node_modules/@resvg/resvg-wasm/index_bg.wasm'))
const SRC='/home/user/happamochi-bot/assets/chess-svg'
const OUT='/home/user/happamochi-bot/public/static/chess'
for(const f of fs.readdirSync(SRC).filter(x=>x.endsWith('.svg'))){
  const svg=fs.readFileSync(path.join(SRC,f),'utf8')
  const png=new Resvg(svg,{fitTo:{mode:'width',value:180},background:'rgba(0,0,0,0)'}).render().asPng()
  const out=path.join(OUT,f.replace('.svg','.png'))
  fs.writeFileSync(out,png)
  console.log(f.replace('.svg','.png'), png.length,'bytes')
}
