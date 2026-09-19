/**
 * Deterministic help card renderer. Run with:
 *   node --experimental-strip-types scripts/render-help-assets.mjs
 *
 * Uses the project's existing Satori, resvg and Japanese font assets. Each PNG
 * is an independent full-width Flex image: a command image owns its message
 * action, so the visual and tap target cannot drift apart across LINE clients.
 * The approved mascot JPEG is embedded unchanged, including its proportions.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import satori from 'satori'
import opentype from '@shuding/opentype.js'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { HELP_DESIGN as D } from '../src/features/menu/helpDesign.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/static/help')
const previewArg = process.argv.indexOf('--preview')
if (previewArg !== -1 && !process.argv[previewArg + 1]) throw new Error('--preview requires a PNG output path')
const previewPath = previewArg === -1 ? null : path.resolve(process.argv[previewArg + 1])
const C = D.colors
const fontRegular = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Regular.ttf'))
const fontBold = fs.readFileSync(path.join(ROOT, 'public/static/fonts/NotoSansJP-Bold.ttf'))
const mascot = fs.readFileSync(path.join(ROOT, 'public/static', D.mascotFile))
const parseFont = (buffer) => opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
const metrics = { 400: parseFont(fontRegular), 700: parseFont(fontBold) }
const fonts = [
  { name: 'Help Noto Sans JP', data: fontRegular, weight: 400, style: 'normal' },
  { name: 'Help Noto Sans JP', data: fontBold, weight: 700, style: 'normal' },
]
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')
const designHash = crypto.createHash('sha256')
  .update(JSON.stringify(D))
  .update(fs.readFileSync(import.meta.filename))
  .update(fontRegular).update(fontBold).update(mascot).digest('hex')
const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
const checks = []
const assets = []

await initWasm(fs.readFileSync(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')))
fs.mkdirSync(OUT, { recursive: true })
if (previewPath) fs.mkdirSync(path.dirname(previewPath), { recursive: true })

function measure(text, size, weight = 400, letterSpacing = 0) {
  return metrics[weight].getAdvanceWidth(text, size, { kerning: true }) + Math.max(0, [...text].length - 1) * letterSpacing
}

/** Convert text to SVG paths, keeping the chosen font identical on all clients. */
async function text(textValue, x, y, width, size, weight, color, opts = {}) {
  const lineHeight = opts.lineHeight ?? size * 1.35
  const letterSpacing = opts.letterSpacing ?? 0
  const measured = measure(textValue, size, weight, letterSpacing)
  if (measured > width + 0.5) throw new Error(`Help text overflows: ${textValue} (${measured.toFixed(2)} > ${width})`)
  checks.push({ text: textValue, width: Number(measured.toFixed(2)), available: width })
  const rendered = await satori({
    type: 'div',
    props: {
      style: {
        display: 'flex', width, height: lineHeight,
        fontFamily: 'Help Noto Sans JP', fontSize: size, fontWeight: weight,
        color, lineHeight: `${lineHeight}px`, letterSpacing,
        whiteSpace: 'nowrap',
        justifyContent: opts.center ? 'center' : 'flex-start',
      },
      children: textValue,
    },
  }, { width, height: lineHeight, fonts })
  // Satori's paths are already font-independent; leave enough viewBox height
  // for Japanese ascenders/descenders instead of clipping a text box.
  const inside = rendered.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const ink = opts.heavy ? `stroke="${color}" stroke-width="0.23" stroke-linejoin="round" paint-order="stroke fill"` : ''
  return `<g transform="translate(${x} ${y})" ${ink}>${inside}</g>`
}

function background(height, offset = 0) {
  // Continuous card coordinates make separately downloaded strips join cleanly.
  return `<defs><radialGradient id="haze"><stop stop-color="#FFFFFF" stop-opacity="0.8"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>
    <rect width="260" height="${height}" fill="${C.cardBg}"/>
    <g transform="translate(0 ${-offset})">
      <ellipse cx="-12" cy="12" rx="54" ry="92" fill="url(#haze)"/>
      <ellipse cx="273" cy="318" rx="54" ry="156" fill="url(#haze)"/>
      <ellipse cx="22" cy="413" rx="85" ry="50" fill="url(#haze)"/>
    </g>`
}

function brandLeaf() {
  return `<g transform="translate(21 15)">
    <path d="M1 19C0 8 7 1 21 0C23 13 15 22 2 21Z" fill="#42C6EF"/>
    <path d="M0 23L19 3M8 14L8 7M13 10L19 11" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M0 23L5 18" stroke="#45BEEA" stroke-width="1.2" stroke-linecap="round"/>
  </g>`
}

function sprig() {
  return `<g transform="translate(203 25)" fill="#98E1F6" opacity="0.8">
    <path d="M16 43Q18 23 23 8" fill="none" stroke="#AFE8F8" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M20 25C10 9 24-7 32 1C39 9 27 22 20 25Z"/>
    <path d="M16 31C1 31-5 14 5 17C13 18 18 25 16 31Z"/>
    <path d="M24 36C30 27 39 28 37 34C35 40 27 39 24 36Z"/>
    <circle cx="37" cy="44" r="4"/>
  </g>`
}

async function headerContent(title) {
  return brandLeaf() + sprig()
    + await text(D.brandText, 48, 14, 142, D.type.brand, 400, C.head, { lineHeight: 22 })
    + await text(title, 20, 37, 216, D.type.title, 700, C.head, { lineHeight: 40, heavy: true })
}

async function save(role, height, content) {
  const svg = svgOpen(D.width, height) + content + '</svg>'
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: D.width * D.scale } })
  const image = rendered.render()
  const png = Buffer.from(image.asPng())
  image.free()
  rendered.free()
  const width = png.readUInt32BE(16)
  const actualHeight = png.readUInt32BE(20)
  if (width !== D.width * D.scale || actualHeight !== height * D.scale) throw new Error(`Unexpected PNG size for ${role}`)
  const file = `${role}-${sha(png).slice(0, 12)}.png`
  fs.writeFileSync(path.join(OUT, file), png)
  const meta = { file, width, height: actualHeight }
  assets.push({ ...meta, png, role })
  return meta
}

function splitDescription(command) {
  if (measure(command.desc, D.type.description) <= D.tile.textWidth) return [command.desc]
  // Preserve the full supplied description, with a natural break before its note.
  const note = command.desc.indexOf('（')
  if (note > 0 && measure(command.desc.slice(0, note), D.type.description) <= D.tile.textWidth
    && measure(command.desc.slice(note), D.type.description) <= D.tile.textWidth) {
    return [command.desc.slice(0, note), command.desc.slice(note)]
  }
  const comma = command.desc.indexOf('、') + 1
  if (comma > 0 && measure(command.desc.slice(0, comma), D.type.description) <= D.tile.textWidth
    && measure(command.desc.slice(comma), D.type.description) <= D.tile.textWidth) {
    return [command.desc.slice(0, comma), command.desc.slice(comma)]
  }
  const lines = []
  let line = ''
  for (const ch of command.desc) {
    if (line && measure(line + ch, D.type.description) > D.tile.textWidth) {
      lines.push(line)
      line = ''
    }
    line += ch
  }
  if (line) lines.push(line)
  if (lines.length > 2) throw new Error(`Help description requires more than two lines: ${command.desc}`)
  return lines
}

const header = await save('header', D.headerHeight, background(D.headerHeight) + await headerContent(D.commandTitle))
const footer = await save('footer', D.footerHeight,
  `<rect width="260" height="32" fill="${C.accent}"/>`
  + await text(D.footerText, 8, 6, 244, 12, 400, C.onAccent, { center: true, lineHeight: 20 }))

const mascotData = 'data:image/jpeg;base64,' + mascot.toString('base64')
let coverSvg = background(D.coverHeight) + await headerContent(D.coverTitle)
coverSvg += `<image href="${mascotData}" x="40" y="74" width="180" height="180" preserveAspectRatio="xMidYMid meet"/>
  <g fill="none" stroke="#8FDFF7" stroke-width="4.6" stroke-linecap="round" opacity="0.88">
    <path d="M30 151L25 144M30 169L23 166M223 174L229 168M228 193L236 192"/>
  </g>`
coverSvg += await text(D.welcomeTitle, 16, 246, 228, D.type.welcome, 700, C.head,
  { lineHeight: 32, letterSpacing: -0.4, heavy: true })
for (const [i, line] of D.introLines.entries()) {
  coverSvg += await text(line, 16, 282 + i * 22, 228, D.type.intro, 400, C.desc, { lineHeight: 22 })
}
const cover = await save('cover', D.coverHeight, coverSvg)
const cta = await save('cta', D.ctaHeight, background(D.ctaHeight, D.coverHeight)
  + `<rect x="10" y="16" width="240" height="50" rx="13" fill="${C.accent}"/>`
  + await text(D.ctaLabel, 23, 23, 196, D.type.cta, 700, C.onAccent, { center: true, lineHeight: 34, heavy: true })
  + `<path d="M226 35L232 41L226 47" fill="none" stroke="#FFFFFF" stroke-width="3.1" stroke-linejoin="round"/>`)

const rows = []
for (const [index, command] of D.commands.entries()) {
  const lines = splitDescription(command)
  const labelLineHeight = 24
  const descLineHeight = 17.5
  const blockHeight = labelLineHeight + lines.length * descLineHeight
  const top = (D.tile.height - blockHeight) / 2
  if (blockHeight > D.tile.height - 4) throw new Error(`Help row too tall: ${command.label}`)
  let content = background(D.rowHeight, D.headerHeight + (index % D.perCard) * D.rowHeight)
    + `<rect x="12" y="0.5" width="236" height="63" rx="13" fill="#FFFFFF" stroke="${C.line}" stroke-width="0.7"/>`
    + await text(command.label, D.tile.textX, top, D.tile.textWidth, D.type.command, 700, C.accent,
      { lineHeight: labelLineHeight, heavy: true })
  for (const [lineIndex, line] of lines.entries()) {
    content += await text(line, D.tile.textX, top + labelLineHeight + lineIndex * descLineHeight,
      D.tile.textWidth, D.type.description, 400, C.desc, { lineHeight: descLineHeight })
  }
  content += `<path d="M230 27L233.5 32L230 37" fill="none" stroke="${C.arrow}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`
  const row = await save(`row-${String(index + 1).padStart(2, '0')}`, D.rowHeight, content)
  rows.push({ ...command, ...row })
}

const manifest = { version: 1, designHash, header, cover, cta, footer, rows }
fs.writeFileSync(path.join(ROOT, 'src/features/menu/helpAssets.json'), JSON.stringify(manifest, null, 2) + '\n')
// Previously sent LINE cards retain their hashed image URLs. Keep those images
// available after a reorder so opening an older card does not produce a 404.

const previewCards = [[cover, cta, footer]]
for (let i = 0; i < rows.length; i += D.perCard) previewCards.push([header, ...rows.slice(i, i + D.perCard), footer])
for (const [index, card] of previewCards.entries()) {
  const actualHeight = card.reduce((sum, asset) => sum + asset.height / D.scale, 0)
  const fullPage = index === 0 || card.length === D.perCard + 2
  if (actualHeight > D.height || (fullPage && actualHeight !== D.height)) {
    throw new Error(`Card ${index + 1} height ${actualHeight} is incompatible with ${D.height}`)
  }
}
if (previewPath) {
const lookup = new Map(assets.map((asset) => [asset.file, asset]))
const gap = 10
const inset = 14
const previewWidth = inset * 2 + previewCards.length * D.width + (previewCards.length - 1) * gap
const previewHeight = D.height + inset * 2
let preview = svgOpen(previewWidth, previewHeight)
  + `<rect width="${previewWidth}" height="${previewHeight}" fill="#EDFAFF"/>`
  + '<defs><filter id="shadow" x="-15%" y="-8%" width="130%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#76D8F4" flood-opacity="0.27"/></filter></defs>'
for (const [index, card] of previewCards.entries()) {
  const x = inset + index * (D.width + gap)
  preview += `<defs><clipPath id="card-${index}"><rect x="${x}" y="${inset}" width="260" height="462" rx="15"/></clipPath></defs>`
    + `<rect x="${x}" y="${inset}" width="260" height="462" rx="15" fill="${C.cardBg}" filter="url(#shadow)"/>`
    + `<g clip-path="url(#card-${index})">`
  let y = inset
  for (const asset of card) {
    const height = asset.height / D.scale
    // LINE aligns carousel footers; a final page with fewer commands keeps
    // its spare body area empty instead of stretching the command images.
    if (asset.file === footer.file) y = inset + D.height - D.footerHeight
    preview += `<image x="${x}" y="${y}" width="260" height="${height}" href="data:image/png;base64,${lookup.get(asset.file).png.toString('base64')}"/>`
    y += height
  }
  preview += '</g>'
}
preview += '</svg>'
const previewRenderer = new Resvg(preview, { fitTo: { mode: 'width', value: previewWidth * D.scale } })
const previewImage = previewRenderer.render()
fs.writeFileSync(previewPath, previewImage.asPng())
previewImage.free()
previewRenderer.free()
fs.writeFileSync(previewPath.replace(/\.png$/i, '') + '-layout-checks.json', JSON.stringify({ designHash, checks, cards: previewCards.length }, null, 2) + '\n')
console.log(`Preview: ${previewPath}`)
}
console.log(`Help assets: ${assets.length} PNGs; ${checks.length} text-width checks; ${previewCards.length} cards × ${D.width}×${D.height}.`)
