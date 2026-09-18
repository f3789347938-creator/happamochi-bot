// Offline visual QA of the actual Flex builders. This approximates LINE layout;
// the native LINE client remains the authority for final font/layout rendering.
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { Resvg, initWasm } from '@resvg/resvg-wasm'

const root = path.resolve(import.meta.dirname, '..')
const baseUrl = process.env.DRESSUP_PREVIEW_BASE || 'https://line-group-bbs.pages.dev'
const output = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(root, 'samples/dressup'))
fs.mkdirSync(output, { recursive: true })
const bundle = await build({
  stdin: { contents: `export { buildStatusCard } from './src/features/profile/flex.ts'; export { buildGachaConfirmation } from './src/features/dressup/flex.ts'; export { buildRankingCarousel } from './src/features/rankingCards.ts'; export { appearanceSvg } from './src/features/dressup/art.ts';`, resolveDir: root },
  bundle: true, write: false, platform: 'neutral', format: 'esm',
})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'))
const names = ['こはく', 'なの', 'もちこ']
for (const [i, name] of names.entries()) {
  db.prepare('INSERT INTO user_profiles(user_id,public_id,display_name,total_exp,points) VALUES(?,?,?,?,?)').run(`preview-${i}`, `public-${i}`, name, 10000 - i * 1000, 15000)
  db.prepare('INSERT INTO dressup_appearances(user_id,costume_id,background_id) VALUES(?,?,?)').run(`preview-${i}`, ['C049','C001','C061'][i], ['BG004','BG001','BG007'][i])
}
const env = { DB: { prepare(sql) { let args = []; return {
  bind(...v) { args = v; return this },
  async first(col) { const row = db.prepare(sql).get(...args); return row ? col ? row[col] : row : null },
  async all() { return { results: db.prepare(sql).all(...args) } },
} } } }
const theme = {id:'aqua',name:'水色',price:0,header_bg:'#009FDE',body_bg:'#E4F7FF',text_color:'#17364C',accent:'#16BCEC',header_text:'#FFFFFF',display_order:1}
const status = api.buildStatusCard({
  profile:{user_id:'preview-1', public_id:'public-1', display_name:'なの', picture_url:null,total_exp:9000,points:15000,active_theme:'aqua',equipped_title:null},
  level:{level:24,expInLevel:132,expNeeded:284,percent:46}, theme,rank:2,titleName:'のんびりもち',
  appearance:{costumeId:'C001',backgroundId:'BG001'},baseUrl,
})
const gacha = api.buildGachaConfirmation({baseUrl,points:15000,token:'00000000-0000-4000-8000-000000000000',remaining:150})
const ranking = await api.buildRankingCarousel(env, baseUrl, 'preview-1')
const documents = [{label:'ステータス',message:status},{label:'きせかえガチャ',message:gacha},{label:'ランキング（累計EXPを維持）',message:{...ranking,contents:ranking.contents.contents[0]}}]
// Use local asset bytes: the visual check needs no server or external requests.
await initWasm(fs.readFileSync(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')))
const inlinePng = filename => `data:image/png;base64,${fs.readFileSync(filename).toString('base64')}`
const images = new Map()
function collectImages(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'image' && !images.has(node.url)) {
    const pathname = new URL(node.url).pathname
    const match = pathname.match(/^\/dressup-art\/(C\d{3})\/(BG\d{3})\.png$/)
    if (match) {
      const svg = api.appearanceSvg(...match.slice(1).map(id => inlinePng(path.join(root, 'public/static/dressup', `${id}.png`))))
      const renderer = new Resvg(svg)
      try {
        const rendered = renderer.render()
        try {
          const png = Buffer.from(rendered.asPng())
          fs.writeFileSync(path.join(output, `${match[1]}-${match[2]}.png`), png)
          images.set(node.url, `data:image/png;base64,${png.toString('base64')}`)
        }
        finally { rendered.free() }
      } finally { renderer.free() }
    } else {
      const file = path.resolve(root, 'public', pathname.replace(/^\//, ''))
      if (!file.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Invalid image path')
      images.set(node.url, inlinePng(file))
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(collectImages)
    else if (value && typeof value === 'object') collectImages(value)
  }
}
documents.forEach(x => collectImages(x.message))
const fontUri = `data:font/ttf;base64,${fs.readFileSync(path.join(root, 'public/static/fonts/NotoSansJP-Regular.ttf')).toString('base64')}`
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const sizes = {none:'0',xxs:'2px',xs:'4px',sm:'8px',md:'16px',lg:'20px',xl:'24px',xxl:'32px'}
const fontSizes = {xxs:'11px',xs:'12px',sm:'14px',md:'16px',lg:'19px',xl:'23px',xxl:'29px',xxxl:'36px'}
const size = x => sizes[x] ?? x
function render(n) {
  if (!n) return ''
  if (n.type === 'bubble') return `<article class="card">${render(n.header)}${render(n.body)}${render(n.footer)}</article>`
  const style = {boxSizing:'border-box'}
  for (const k of ['width','height','backgroundColor','borderColor','borderWidth']) if(n[k]) style[k]=n[k]
  if(n.borderWidth) style.borderStyle='solid'
  if(n.cornerRadius) style.borderRadius=size(n.cornerRadius)
  if(n.paddingAll) style.padding=size(n.paddingAll)
  for(const [key,css] of [['paddingTop','paddingTop'],['paddingBottom','paddingBottom'],['paddingStart','paddingLeft'],['paddingEnd','paddingRight']]) if(n[key]) style[css]=size(n[key])
  if(n.margin) style.marginTop=size(n.margin)
  if(n.flex !== undefined) style.flex=String(n.flex)
  else if(n.type !== 'separator') style.flexShrink='1'
  let content=''
  let tag='div'
  if(n.type==='box') {
    Object.assign(style,{display:'flex',flexDirection:n.layout==='horizontal'||n.layout==='baseline'?'row':'column',minWidth:'0',overflow:'hidden'})
    if(n.spacing) style.gap=size(n.spacing)
    if(n.alignItems) style.alignItems=n.alignItems
    if(n.justifyContent) style.justifyContent=n.justifyContent
    content=(n.contents??[]).map(render).join('')
  } else if(n.type==='text') {
    Object.assign(style,{fontSize:fontSizes[n.size]??n.size??'16px',color:n.color??'#17364C',fontWeight:n.weight==='bold'?'700':'400',textAlign:n.align==='end'?'right':n.align??'left',lineHeight:'1.5',minWidth:'0'})
    if(n.wrap===false) Object.assign(style,{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})
    content=escape(n.text)
  } else if(n.type==='image') {
    tag='img';style.width='100%';style.display='block'
    style.aspectRatio=(n.aspectRatio??'1:1').replace(':',' / ')
    style.objectFit=n.aspectMode==='cover'?'cover':'contain'
  } else if(n.type==='button') {
    tag='button';Object.assign(style,{flex:'1',border:'none',borderRadius:'8px',padding:'12px 8px',fontSize:'16px',fontFamily:'inherit',color:n.style==='primary'?'white':'#17364C',backgroundColor:n.style==='primary'?(n.color??'#009FDE'):'#DDE1E8'})
    content=escape(n.action.label)
  } else if(n.type==='separator') {Object.assign(style,{minWidth:'1px',minHeight:'1px',backgroundColor:n.color??'#CCDDE5'})}
  else if(n.type==='filler') style.flex='1'
  else return ''
  const css=Object.entries(style).map(([k,v])=>`${k.replace(/[A-Z]/g,x=>`-${x.toLowerCase()}`)}:${v}`).join(';')
  return tag==='img'?`<img src="${escape(images.get(n.url))}" style="${escape(css)}">`:`<${tag} style="${escape(css)}">${content}</${tag}>`
}
const html=`<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Noto;src:url('${fontUri}')}*{box-sizing:border-box}body{margin:0;padding:34px;background:#F1F9FD;font-family:Noto,sans-serif;color:#17364C}.columns{display:flex;gap:28px;align-items:flex-start}.column{width:350px;flex:none}.card{border-radius:18px;overflow:hidden;background:white;box-shadow:0 8px 25px #193d5712}h2{font-size:17px;margin:0 0 16px}.note{font-size:12px;color:#61778A;margin:24px 0 0}</style><div class="columns">${documents.map(x=>`<section class="column"><h2>${escape(x.label)}</h2>${render(x.message.contents)}</section>`).join('')}</div><p class="note">実装したFlex Messageのローカル確認用プレビュー。LINE実機の文字サイズ・表示とは差が生じる場合があります。</p>`
fs.writeFileSync(path.join(output,'preview.html'),html)
fs.writeFileSync(path.join(output,'flex-samples.json'),JSON.stringify(documents,null,2))
console.log(`Offline preview written: ${path.join(output,'preview.html')}`)
if (!process.argv.includes('--screenshot')) {
  db.close()
  process.exit(0)
}
const require=createRequire(import.meta.url)
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.join(root,'node_modules'),'playwright'))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try {
  const page=await browser.newPage({viewport:{width:1174,height:1100},deviceScaleFactor:1.5})
  await page.setContent(html,{waitUntil:'networkidle'})
  await page.evaluate(()=>document.fonts.ready)
  const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src))
  if(broken.length) throw new Error(`Failed preview images: ${broken.join(', ')}`)
  await page.screenshot({path:path.join(output,'preview.png'),fullPage:true})
} finally {await browser.close();db.close()}
console.log(`Preview written: ${path.join(output,'preview.png')}`)
