import { readFile, writeFile } from 'node:fs/promises'
import { Resvg, initWasm } from '@resvg/resvg-wasm'

await initWasm(await readFile(new URL('../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)))
const assets = new URL('../public/static/dressup/', import.meta.url)
const bounds = {}
for (let index = 0; index <= 120; index++) {
  const id = `C${String(index).padStart(3, '0')}`
  const png = await readFile(new URL(`${id}.png`, assets))
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`
  const renderer = new Resvg(svg)
  const rendered = renderer.render()
  const pixels = rendered.pixels
  let left = width, top = height, right = 0, bottom = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] > 24) {
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  // A two-pixel safety margin retains antialiased edges.
  left = Math.max(0, left - 2); top = Math.max(0, top - 2)
  right = Math.min(width - 1, right + 2); bottom = Math.min(height - 1, bottom + 2)
  bounds[id] = { width, height, box: [left, top, right - left + 1, bottom - top + 1] }
  rendered.free(); renderer.free()
}
await writeFile(new URL('../src/features/dressup/costume-bounds.json', import.meta.url), JSON.stringify(bounds, null, 2) + '\n')

const leaf = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs><linearGradient id="blue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#90E1FF"/><stop offset="1" stop-color="#29B8F6"/></linearGradient></defs>
  <path d="M38 87C39 60 54 35 78 15" fill="none" stroke="#74D2F5" stroke-width="5" stroke-linecap="round"/>
  <path d="M47 59C29 34 54 11 90 5C91 35 74 63 47 59Z" fill="url(#blue)"/>
  <path d="M48 58L78 20" fill="none" stroke="#DDF8FF" stroke-width="2" stroke-linecap="round"/>
  <path d="M33 73C14 77 4 62 10 54C24 50 39 62 33 73Z" fill="url(#blue)"/>
</svg>`
// Source and generated PNG are kept together for reproducible native-vector branding.
await writeFile(new URL('brand-leaf.svg', assets), leaf + '\n')
const renderer = new Resvg(leaf)
const rendered = renderer.render()
await writeFile(new URL('brand-leaf.png', assets), rendered.asPng())
rendered.free(); renderer.free()
console.log(`Prepared ${Object.keys(bounds).length} costume bounds and leaf branding.`)
