// Offline visual QA of the actual Flex builders. This approximates LINE layout;
// the native LINE client remains the authority for final font/layout rendering.
// --screenshot tries Chromium and falls back to offline Satori/resvg; --svg
// directly uses the fallback. --ranking compares LINE default and gacha icons.
// --status-only uses the default status reference fixture (mock LINE avatar).
// Add --compare-custom to place a customized status beside the default one.
// --settings shows wardrobe home and ranking icon settings; --compare-custom
// adds an equipped example page. --baseline reads these two builders from HEAD.
// --default shows C000/BG000. --fixtures=FILE loads
// a saved actual Flex fixture for baseline comparisons without rewriting it.
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { Resvg, initWasm } from '@resvg/resvg-wasm'

const root = path.resolve(import.meta.dirname, '..')
const rankingOnly = process.argv.includes('--ranking')
const statusOnly = process.argv.includes('--status-only')
const settingsOnly = process.argv.includes('--settings')
const compareCustom = process.argv.includes('--compare-custom')
if ([rankingOnly,statusOnly,settingsOnly].filter(Boolean).length > 1) throw new Error('Choose --ranking, --status-only or --settings')
const baseUrl = process.env.DRESSUP_PREVIEW_BASE || 'https://line-group-bbs.pages.dev'
const output = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(root, 'samples/dressup'))
fs.mkdirSync(output, { recursive: true })
const bundle = await build({
  stdin: { contents: `export { buildStatusCard } from './src/features/profile/flex.ts'; export { buildGachaConfirmation, buildWardrobeCard } from './src/features/dressup/flex.ts'; export { getRankingIconSettings } from './src/features/rankingIcon.ts'; export { buildRankingCarousel } from './src/features/rankingCards.ts'; export { appearanceSvg } from './src/features/dressup/art.ts';`, resolveDir: root },
  bundle: true, write: false, platform: 'neutral', format: 'esm',
  plugins: process.argv.includes('--baseline') ? [{ name:'settings-head-baseline', setup(builder) {
    builder.onLoad({filter:/(?:dressup[\\/]flex|rankingIcon)\.ts$/}, args => ({
      contents:execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'show',`HEAD:${path.relative(root,args.path).replaceAll('\\','/')}`],{cwd:root,encoding:'utf8'}),loader:'ts',
    }))
  } }] : [],
})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'))
const names = ['こはく', 'なの', 'もちこ', 'しずく', 'まめ']
for (const [i, name] of names.entries()) {
  db.prepare('INSERT INTO user_profiles(user_id,public_id,display_name,picture_url,total_exp,points) VALUES(?,?,?,?,?,?)').run(`preview-${i}`, `public-${i}`, name, `https://profile-preview.example/${i}.png`, [3840,3260,2980,2460,2180][i], 12500)
  db.prepare('INSERT INTO dressup_appearances(user_id,costume_id,background_id) VALUES(?,?,?)').run(`preview-${i}`, ['C049','C001','C061','C050','C000'][i], ['BG004','BG001','BG007','BG012','BG000'][i])
}
const defaultArt = process.argv.includes('--default')
if (defaultArt) db.prepare("UPDATE dressup_appearances SET costume_id='C000',background_id='BG000' WHERE user_id='preview-1'").run()
const env = { DB: { prepare(sql) { let args = []; return {
  bind(...v) { args = v; return this },
  async first(col) { const row = db.prepare(sql).get(...args); return row ? col ? row[col] : row : null },
  async all() { return { results: db.prepare(sql).all(...args) } },
  async run() { const result = db.prepare(sql).run(...args); return { success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)} } },
} } } }
const theme = {id:'aqua',name:'水色',price:0,header_bg:'#009FDE',body_bg:'#E4F7FF',text_color:'#17364C',accent:'#16BCEC',header_text:'#FFFFFF',display_order:1}
const status = api.buildStatusCard({
  profile:{user_id:'preview-1', public_id:'public-1', display_name:'なの', picture_url:null,total_exp:3260,points:12500,active_theme:'aqua',equipped_title:null},
  // QA reference values only, not the production EXP-to-level calculation.
  level:{level:24,expInLevel:1320,expNeeded:2400,percent:55}, theme,rank:2,titleName:'のんびりもち',
  appearance:defaultArt ? {costumeId:'C000',backgroundId:'BG000'} : {costumeId:'C001',backgroundId:'BG001'},baseUrl,
})
// Exact screenshot values are a visual QA fixture only. Production always
// calculates rank, EXP, points and fortune from the real user and current date.
const referenceStatusInput = {
  profile:{user_id:'preview-1',public_id:'public-1',display_name:'なの',picture_url:'https://profile-preview.example/1.png',total_exp:212,points:212,active_theme:'aqua',equipped_title:null},
  level:{level:3,expInLevel:4,expNeeded:116,percent:100*4/116},
  theme,rank:39,titleName:'マイペース',fortune:'小吉',
  appearance:{costumeId:'C000',backgroundId:'BG000'},baseUrl,
}
const statusDocuments = [{label:'初期ステータス · LINEプロフィール画像',message:api.buildStatusCard(referenceStatusInput)}]
if (compareCustom) statusDocuments.push({label:'着せ替え後 · 衣装と背景',message:api.buildStatusCard({...referenceStatusInput,appearance:{costumeId:'C001',backgroundId:'BG001'}})})
const gacha = api.buildGachaConfirmation({baseUrl,points:15225,token:'00000000-0000-4000-8000-000000000000',remaining:150})
const ranking = await api.buildRankingCarousel(env, baseUrl, 'preview-1')
const fixtureArg = process.argv.find(arg => arg.startsWith('--fixtures='))
const rankingDocuments = [{label:'初期設定 · LINEプロフィール画像',message:{...ranking,contents:ranking.contents.contents[0]}}]
if (rankingOnly) {
  db.prepare('INSERT INTO dressup_inventory(user_id,item_id) VALUES(?,?)').run('preview-1', 'C001')
  db.prepare('INSERT INTO ranking_icons(user_id,costume_id) VALUES(?,?)').run('preview-1', 'C001')
  const selected = await api.buildRankingCarousel(env, baseUrl, 'preview-1')
  rankingDocuments.push({label:'設定変更後 · 2位のガチャ衣装アイコン',message:{...selected,contents:selected.contents.contents[0]}})
}
const settingsDocuments=[]
if (settingsOnly) {
  const ctx={userId:'preview-1',displayName:'なの',pictureUrl:'https://profile-preview.example/1.png',baseUrl}
  settingsDocuments.push(
    {label:'着せ替えホーム · 初期の衣装と背景',message:api.buildWardrobeCard({baseUrl,appearance:{costumeId:'C000',backgroundId:'BG000'},ownedIds:new Set(['C000','BG000']),points:12500})},
    {label:'アイコン設定 · 初期LINEプロフィール',message:await api.getRankingIconSettings(env,ctx)},
  )
  if (compareCustom) {
    for (const id of ['C001','BG001']) db.prepare('INSERT INTO dressup_inventory(user_id,item_id) VALUES(?,?)').run('preview-1',id)
    db.prepare('INSERT INTO ranking_icons(user_id,costume_id) VALUES(?,?)').run('preview-1','C001')
    settingsDocuments.push(
      {label:'着せ替えホーム · 装備後の衣装と背景',message:api.buildWardrobeCard({baseUrl,appearance:{costumeId:'C001',backgroundId:'BG001'},ownedIds:new Set(['C000','BG000','C001','BG001']),points:9500})},
      {label:'アイコン設定 · 入手済みの衣装を使用',message:await api.getRankingIconSettings(env,ctx)},
    )
  }
}
const documents = fixtureArg ? JSON.parse(fs.readFileSync(fixtureArg.slice('--fixtures='.length), 'utf8')) : settingsOnly ? settingsDocuments : statusOnly ? statusDocuments : rankingOnly ? rankingDocuments : [{label:'ステータス',message:status},{label:'ランキング（累計EXP）',message:{...ranking,contents:ranking.contents.contents[0]}},{label:'きせかえガチャ',message:gacha}]
// Use local asset bytes: the visual check needs no server or external requests.
await initWasm(fs.readFileSync(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')))
const inlinePng = filename => `data:image/png;base64,${fs.readFileSync(filename).toString('base64')}`
const images = new Map()
// Local illustrative profiles keep QA deterministic and require no LINE access.
for (let i=0;i<names.length;i++) {
  const colors = ['#73AAB8','#9C92B9','#A2AF8B','#C69B83','#819BBC']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="${colors[i]}"/><circle cx="48" cy="35" r="17" fill="#F8FAFF"/><path d="M14 96V87a34 34 0 0 1 68 0v9" fill="#F8FAFF"/></svg>`
  const renderer = new Resvg(svg)
  try { const rendered = renderer.render(); try { images.set(`https://profile-preview.example/${i}.png`, `data:image/png;base64,${Buffer.from(rendered.asPng()).toString('base64')}`) } finally { rendered.free() } } finally { renderer.free() }
}
function collectImages(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'image' && !images.has(node.url)) {
    const url = new URL(node.url)
    const pathname = url.pathname
    const match = pathname.match(/^\/dressup-art\/(C\d{3})\/(BG\d{3})\.png$/)
    if (match) {
      const view = ['status','icon'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'standard'
      const svg = api.appearanceSvg(...match.slice(1).map(id => inlinePng(path.join(root, 'public/static/dressup', `${id}.png`))), view, match[1])
      const renderer = new Resvg(svg)
      try {
        const rendered = renderer.render()
        try {
          const png = Buffer.from(rendered.asPng())
          fs.writeFileSync(path.join(output, `${match[1]}-${match[2]}-${view}.png`), png)
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
const regular = fs.readFileSync(path.join(root, 'public/static/fonts/NotoSansJP-Regular.ttf'))
const bold = fs.readFileSync(path.join(root, 'public/static/fonts/NotoSansJP-Bold.ttf'))
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const lengths = {none:0,xxs:2,xs:4,sm:8,md:16,lg:20,xl:24,xxl:32}
const fontSizes = {xxs:11,xs:12,sm:14,md:16,lg:19,xl:23,xxl:29,xxxl:36,xxxxl:48,xxxxxl:64}
const imageSizes = {xxs:40,xs:48,sm:56,md:80,lg:120,xl:160,xxl:200,full:'100%'}
const bubbleWidths = {nano:120,micro:160,deca:220,hecto:240,kilo:260,mega:300,giga:400}
const scalar = value => typeof value === 'string' && /^-?\d+(\.\d+)?px$/.test(value) ? Number.parseFloat(value) : value
const length = value => lengths[value] ?? scalar(value)
const align = value => ({start:'flex-start',end:'flex-end'})[value] ?? value
const el = (type,style,children,props={}) => ({type,props:{style,...props,...(children === undefined ? {} : {children})}})
const textWidth = (text,size) => [...text].reduce((w,ch) => w + (/[^\x00-\x7f]/.test(ch) ? 1 : /[il.,:;! ]/.test(ch) ? .3 : .58)*size,0)

// Keep fixed dimensions/flex:0 intact. For unconstrained horizontal children,
// share remaining space; vertical children retain their intrinsic/fixed height.
function flexNode(n,ctx={}) {
  if (!n) return null
  if (n.type === 'bubble') {
    const width = bubbleWidths[n.size] ?? 300
    return el('article',{display:'flex',flexDirection:'column',width,flexShrink:0,borderRadius:14,overflow:'hidden',backgroundColor:'#FFFFFF'},
      ['header','hero','body','footer'].filter(k=>n[k]).map(k=>flexNode(n[k],{axis:'column',width,section:k})),
      {'data-bubble':true,'data-native-width':width})
  }
  const horizontal = ctx.axis === 'row'
  const fixed = horizontal ? n.width !== undefined : n.height !== undefined
  const grow = fixed ? 0 : n.flex ?? (horizontal && ['box','text','image','button'].includes(n.type) ? 1 : 0)
  const style = {display:'flex',boxSizing:'border-box',minWidth:0,flexGrow:grow,flexShrink:n.flex === 0 || fixed || !horizontal ? 0 : 1}
  if (grow > 0) style.flexBasis = 0
  for (const key of ['width','height','maxWidth','maxHeight','backgroundColor','borderColor']) if (n[key] !== undefined) style[key] = scalar(n[key])
  if (n.borderWidth) Object.assign(style,{borderWidth:length(n.borderWidth),borderStyle:'solid'})
  if (n.cornerRadius) style.borderRadius = length(n.cornerRadius)
  if (n.background?.type === 'linearGradient') {
    const bg = n.background
    style.backgroundImage = 'linear-gradient('+(bg.angle ?? '180deg')+', '+bg.startColor+', '+(bg.centerColor ? bg.centerColor+' '+(bg.centerPosition ?? '50%')+', ' : '')+bg.endColor+')'
  }
  if (n.position === 'absolute') style.position = 'absolute'
  for (const [from,to] of [['offsetTop','top'],['offsetBottom','bottom'],['offsetStart','left'],['offsetEnd','right']]) if (n[from] !== undefined) {
    style.position ??= 'relative'
    style[to] = scalar(n[from])
  }
  if (n.margin !== undefined) style[horizontal ? 'marginLeft' : 'marginTop'] = length(n.margin)
  if (n.gravity) style.alignSelf = align({top:'start',bottom:'end',center:'center'}[n.gravity] ?? n.gravity)
  if (n.type === 'box') {
    const axis = ['horizontal','baseline'].includes(n.layout) ? 'row' : 'column'
    Object.assign(style,{flexDirection:axis,position:style.position ?? 'relative',overflow:'hidden'})
    const padding = length(n.paddingAll ?? (ctx.section ? '20px' : '0px'))
    style.padding = padding
    for (const [from,to] of [['paddingTop','paddingTop'],['paddingBottom','paddingBottom'],['paddingStart','paddingLeft'],['paddingEnd','paddingRight']]) if (n[from] !== undefined) style[to] = length(n[from])
    if (n.spacing) style.gap = length(n.spacing)
    if (n.alignItems || n.layout === 'baseline') style.alignItems = align(n.alignItems ?? 'baseline')
    if (n.justifyContent) style.justifyContent = align(n.justifyContent)
    const ownWidth = typeof style.width === 'number' ? style.width : ctx.width
    const available = ownWidth - Number(style.paddingLeft ?? padding) - Number(style.paddingRight ?? padding)
    const children = n.contents ?? []
    const gaps = Number(length(n.spacing ?? 'none'))*Math.max(0,children.length-1)
    let fixedWidth=0, weights=0
    if (axis === 'row') for (const child of children) {
      if (child.width) fixedWidth += Number(scalar(child.width)) || 0
      else if (child.flex === 0 && child.type === 'image') fixedWidth += Number(imageSizes[child.size] ?? scalar(child.size) ?? 80) || 0
      else if (child.flex === 0 && child.type === 'text') fixedWidth += textWidth(child.text ?? '',fontSizes[child.size] ?? scalar(child.size) ?? 16)
      else if (child.flex !== 0) weights += child.flex ?? 1
    }
    return el('div',style,children.map(child=>{
      const width = axis === 'column' ? available : child.width ? Number(scalar(child.width)) : child.flex === 0 ? undefined : Math.max(0,(available-fixedWidth-gaps)*(child.flex ?? 1)/(weights || 1))
      return flexNode(child,{axis,width,height:style.height})
    }))
  }
  if (n.type === 'text') {
    let size = fontSizes[n.size] ?? scalar(n.size) ?? 16
    if (n.adjustMode === 'shrink-to-fit' && ctx.width > 0) size = Math.min(size,Math.max(8,ctx.width / Math.max(1,textWidth(n.text ?? '',1))))
    Object.assign(style,{display:'flex',justifyContent:n.align === 'center' ? 'center' : n.align === 'end' ? 'flex-end' : 'flex-start',fontSize:size,fontWeight:n.weight === 'bold' ? 700 : 400,color:n.color ?? '#17364C',textAlign:({start:'left',end:'right'})[n.align] ?? n.align ?? 'left',lineHeight:1.25+Number(scalar(n.lineSpacing ?? 0))/size,whiteSpace:n.wrap === true ? 'pre-wrap' : 'nowrap'})
    // Yoga otherwise sizes a plain text div to its glyphs in a vertical box,
    // making center/end alignment appear left-aligned in the PNG fallback.
    if (!horizontal && style.width === undefined) style.width='100%'
    if (!n.wrap) Object.assign(style,{overflow:'hidden',textOverflow:'ellipsis'})
    if (n.maxLines) style.lineClamp=n.maxLines
    return el('div',style,n.text ?? '')
  }
  if (n.type === 'image') {
    const width = imageSizes[n.size] ?? scalar(n.size) ?? 80
    const ratio = (n.aspectRatio ?? '1:1').split(':').map(Number)
    Object.assign(style,{width,maxWidth:'100%',objectFit:n.aspectMode === 'cover' ? 'cover' : 'contain',objectPosition:({top:'top',bottom:'bottom'})[n.gravity] ?? 'center',flexGrow:0,flexShrink:0})
    if (typeof width === 'number') style.height=width*ratio[1]/ratio[0]
    else if (ctx.height && typeof ctx.height === 'number') style.height=ctx.height
    else if (ctx.width > 0) style.height=ctx.width*ratio[1]/ratio[0]
    else style.aspectRatio=ratio[0]/ratio[1]
    return el('img',style,undefined,{src:images.get(n.url)})
  }
  if (n.type === 'button') {
    const primary=n.style === 'primary', link=n.style === 'link'
    Object.assign(style,{height:n.height === 'sm' ? 40 : 52,justifyContent:'center',alignItems:'center',padding:'0 8px',borderRadius:8,fontSize:16,color:primary ? '#FFFFFF' : link ? n.color ?? '#42659A' : '#17364C',backgroundColor:primary ? n.color ?? '#17C950' : link ? 'transparent' : '#DDE1E8'})
    return el('div',style,n.action?.label ?? '')
  }
  if (n.type === 'separator') return el('div',{...style,flexGrow:0,flexShrink:0,...(horizontal ? {width:1,alignSelf:'stretch'} : {height:1,width:'100%'}),backgroundColor:n.color ?? '#E0E0E0'})
  if (n.type === 'filler' || n.type === 'spacer') return el('div',{...style,flexGrow:n.flex ?? 1})
  return null
}

const unitless=new Set(['fontWeight','lineHeight','lineClamp','flexGrow','flexShrink','flex','opacity','zIndex','aspectRatio'])
function serialize(node) {
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return escape(node)
  const {style,children,...props}=node.props
  const css=Object.entries(style).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v === 'number' && !unitless.has(k) ? v+'px' : v)).join(';')
  const attrs=Object.entries(props).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')
  return '<'+node.type+' style="'+escape(css)+'" '+attrs+'>'+ (node.type === 'img' ? '' : (Array.isArray(children) ? children : [children]).map(serialize).join('')+'</'+node.type+'>')
}
function previewTree(selected) {
  const width=selected.reduce((sum,doc)=>sum+(bubbleWidths[doc.message.contents.size] ?? 300),0)+48+(selected.length-1)*24
  return el('main',{display:'flex',flexDirection:'column',width,padding:24,backgroundColor:'#EDF8FC',fontFamily:'Noto',color:'#17364C'},[
    el('div',{fontSize:13,fontWeight:700,marginBottom:16},'実装Flexのレイアウト確認 · QA'),
    el('div',{display:'flex',alignItems:'flex-start',gap:24},selected.map(doc=>el('section',{display:'flex',flexDirection:'column',width:bubbleWidths[doc.message.contents.size] ?? 300,flexShrink:0},[
      el('div',{fontSize:12,lineHeight:1.3,fontWeight:700,marginBottom:10},doc.label+' · '+(bubbleWidths[doc.message.contents.size] ?? 300)+'px'),
      flexNode(doc.message.contents),
    ]))),
    el('div',{fontSize:10,lineHeight:1.4,marginTop:18,color:'#61778A'},'実装Flexから描画。名前・数値・LINEプロフィール画像は確認用サンプルです。LINE実機とは文字組みに差があります。'),
  ])
}
const mainDocs=(rankingOnly ? documents : documents.filter(doc=>!doc.label.includes('ガチャ'))).slice(0,2)
const gachaDocs=rankingOnly || statusOnly || settingsOnly ? [] : documents.filter(doc=>doc.label.includes('ガチャ'))
const pages=[{name:'preview',tree:previewTree(mainDocs)},...(gachaDocs.length ? [{name:'gacha',tree:previewTree(gachaDocs)}] : []),...(settingsOnly && documents.length>2 ? [{name:'customized',tree:previewTree(documents.slice(2,4))}] : [])]
const fontCss='@font-face{font-family:Noto;src:url(data:font/ttf;base64,'+regular.toString('base64')+');font-weight:400}@font-face{font-family:Noto;src:url(data:font/ttf;base64,'+bold.toString('base64')+');font-weight:700}'
for (const page of pages) {
  page.html='<!doctype html><meta charset="utf-8"><style>'+fontCss+'*{box-sizing:border-box}body{margin:0;font-family:Noto,sans-serif}img{display:block}</style>'+serialize(page.tree)
  fs.writeFileSync(path.join(output,page.name+'.html'),page.html)
}
fs.writeFileSync(path.join(output,'flex-samples.json'),JSON.stringify(documents,null,2))
db.close()
console.log('Offline HTML and actual Flex fixtures written: '+output)
if (process.argv.includes('--screenshot') || process.argv.includes('--svg')) {
  let browser
  if (!process.argv.includes('--svg')) {
    try {
      const require=createRequire(import.meta.url)
      const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.join(root,'node_modules'),'playwright'))
      browser=await chromium.launch({headless:true,args:['--no-sandbox']})
    } catch(error) { console.warn('Chromium unavailable; using Satori/resvg approximation: '+String(error.message).split('\n')[0]) }
  }
  const metrics={renderer:browser ? 'chromium' : 'satori-resvg',nativeLineScreenshot:false,pages:[]}
  if (browser) {
    try {
      for (const document of pages) {
        const page=await browser.newPage({viewport:{width:document.tree.props.style.width,height:1000},deviceScaleFactor:2})
        await page.setContent(document.html,{waitUntil:'load'})
        await page.evaluate(()=>document.fonts.ready)
        const broken=await page.locator('img').evaluateAll(nodes=>nodes.filter(n=>!n.complete||!n.naturalWidth).length)
        if(broken) throw new Error('Broken preview images: '+broken)
        metrics.pages.push({name:document.name,cards:await page.locator('[data-bubble]').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})))})
        await page.screenshot({path:path.join(output,document.name+'.png'),fullPage:true})
        await page.close()
      }
    } finally { await browser.close() }
  } else {
    globalThis.__filename ??= './satori-standalone-yoga.js'
    process.type='renderer'
    const {default:satori,init}=await import('satori/standalone')
    await init(await WebAssembly.compile(fs.readFileSync(path.join(root,'node_modules/satori/yoga.wasm'))))
    for (const document of pages) {
      const cards=[]
      const svg=await satori(document.tree,{
        width:document.tree.props.style.width,
        fonts:[{name:'Noto',data:regular,weight:400,style:'normal'},{name:'Noto',data:bold,weight:700,style:'normal'}],
        onNodeDetected:node=>{if(node.props?.['data-bubble']) cards.push({width:node.width,height:node.height})},
      })
      fs.writeFileSync(path.join(output,document.name+'.svg'),svg)
      const renderer=new Resvg(svg)
      try {const rendered=renderer.render();try {fs.writeFileSync(path.join(output,document.name+'.png'),Buffer.from(rendered.asPng()))}finally{rendered.free()}}finally{renderer.free()}
      metrics.pages.push({name:document.name,cards})
    }
  }
  fs.writeFileSync(path.join(output,'layout-metrics.json'),JSON.stringify(metrics,null,2))
  console.log(JSON.stringify(metrics,null,2))
}
