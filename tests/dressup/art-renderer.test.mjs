// Offline production PNG renderer tests. No Worker server, network or new deps.
// Run: node --test tests/dressup/art-renderer.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const BASE = 'https://mochi.example'

// Match scripts/inject-wasm.mjs: initialize the same compiled modules and the
// Emscripten environment before evaluating the production renderer module.
globalThis.__filename ??= './satori-standalone-yoga.js'
process.type = 'renderer'
globalThis.__HAPPAMOCHI_YOGA_WASM__ = await WebAssembly.compile(
  readFileSync(resolve(root, 'node_modules/satori/yoga.wasm')),
)
globalThis.__HAPPAMOCHI_RESVG_WASM__ = await WebAssembly.compile(
  readFileSync(resolve(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
)
globalThis.fetch = async () => { throw new Error('Unexpected external fetch in offline artwork renderer') }
const bundled = await build({
  entryPoints: [resolve(root, 'src/features/dressup/art-renderer.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const { renderAppearanceResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)

function request(costume = 'C001', background = 'BG001', query = '') {
  return new Request(`${BASE}/dressup-art/${costume}/${background}.png${query}`)
}

function assetFixture(override) {
  const calls = []
  const assets = {
    async fetch(req) {
      const url = new URL(req.url)
      calls.push(url.href)
      assert.equal(url.origin, BASE, 'only the current static-asset origin is used')
      assert.match(url.pathname, /^\/static\/dressup\/(?:C|BG)\d{3}\.png$/)
      const replacement = await override?.(url)
      if (replacement) return replacement
      return new Response(readFileSync(resolve(root, `public${url.pathname}`)), {
        headers: { 'Content-Type': 'image/png' },
      })
    },
  }
  return { assets, calls }
}

// Decode the generated PNG, including chunk CRCs, zlib data and all five PNG
// scanline filters. Checking only the PNG signature would miss corrupt output.
function decodePng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const compressed = []
  let width, height, channels, ended = false
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'complete PNG chunk')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    assert.ok(end <= bytes.length, 'PNG chunk stays inside the file')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(end - 4))
    if (type === 'IHDR') {
      assert.equal(offset, 8)
      assert.equal(length, 13)
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.equal(data[8], 8, '8-bit pixels')
      assert.ok([2, 6].includes(data[9]), 'RGB or RGBA output')
      channels = data[9] === 6 ? 4 : 3
      assert.deepEqual([...data.subarray(10)], [0, 0, 0], 'standard compression, filters, no interlace')
    } else if (type === 'IDAT') compressed.push(data)
    else if (type === 'IEND') {
      assert.equal(length, 0)
      assert.equal(end, bytes.length)
      ended = true
    }
    offset = end
  }
  assert.ok(ended && compressed.length > 0, 'complete image data and end marker')
  assert.equal(width, 768)
  assert.equal(height, 512)
  assert.ok(bytes.length < 4 * 1024 * 1024)
  const stride = width * channels
  const filtered = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height })
  assert.equal(filtered.length, (stride + 1) * height)
  const pixels = Buffer.alloc(stride * height)
  const paeth = (left, up, diagonal) => {
    const prediction = left + up - diagonal
    const a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - diagonal)
    return a <= b && a <= c ? left : b <= c ? up : diagonal
  }
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]
    assert.ok(filter <= 4, 'known scanline filter')
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const left = x >= channels ? pixels[index - channels] : 0
      const up = y ? pixels[index - stride] : 0
      const diagonal = y && x >= channels ? pixels[index - stride - channels] : 0
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][filter]
      pixels[index] = (filtered[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  const colors = new Set()
  let visible = 0
  for (let index = 0; index < pixels.length; index += channels * 97) {
    if (channels === 3 || pixels[index + 3] > 0) {
      visible++
      colors.add(pixels.subarray(index, index + 3).toString('hex'))
    }
  }
  assert.ok(visible > 100, 'artwork is not transparent')
  assert.ok(colors.size > 100, 'artwork is not a blank solid image')
  return { width, height, pixels }
}

async function expectPng(response) {
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'image/png')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400')
  const bytes = Buffer.from(await response.arrayBuffer())
  decodePng(bytes)
  return bytes
}

test('production WASM renderer composites real defaults and catalog boundary assets into decodable PNGs', async () => {
  const outputs = []
  for (const [costume, background] of [['C000', 'BG000'], ['C001', 'BG001'], ['C120', 'BG030']]) {
    const { assets, calls } = assetFixture()
    outputs.push(await expectPng(await renderAppearanceResponse(request(costume, background), assets, costume, background)))
    assert.deepEqual(calls.sort(), [`${BASE}/static/dressup/${costume}.png`, `${BASE}/static/dressup/${background}.png`].sort())
  }
  assert.notDeepEqual(outputs[0], outputs[1])
  assert.notDeepEqual(outputs[1], outputs[2])
})

test('invalid, swapped, traversal and external-URL IDs return 404 without asset reads', async () => {
  const { assets, calls } = assetFixture()
  for (const [costume, background] of [
    ['C999', 'BG001'], ['C001', 'BG999'], ['BG001', 'C001'], ['../C001', 'BG001'],
    ['https://external.invalid/private', 'BG001'], ['C001', '__proto__'], ['', 'BG001'],
  ]) {
    const response = await renderAppearanceResponse(request(), assets, costume, background)
    assert.equal(response.status, 404)
  }
  assert.deepEqual(calls, [])
})

test('missing ASSETS binding returns 503 without attempting network fetches', async () => {
  const response = await renderAppearanceResponse(request(), undefined, 'C001', 'BG001')
  assert.equal(response.status, 503)
  assert.equal(await response.text(), 'Asset binding unavailable')
})

test('canonical cache key ignores arbitrary queries and cached responses skip asset reads', async () => {
  const { assets, calls } = assetFixture()
  const entries = new Map()
  const matches = [], writes = []
  const cache = {
    async match(key) { matches.push(key.url); return entries.get(key.url)?.clone() },
    async put(key, value) { writes.push(key.url); entries.set(key.url, value.clone()) },
  }
  const first = await expectPng(await renderAppearanceResponse(request('C001', 'BG001', '?arbitrary=one'), assets, 'C001', 'BG001', cache))
  const second = await expectPng(await renderAppearanceResponse(request('C001', 'BG001', '?arbitrary=two'), assets, 'C001', 'BG001', cache))
  const key = `${BASE}/dressup-art/C001/BG001.png?v=1`
  assert.deepEqual(matches, [key, key])
  assert.deepEqual(writes, [key])
  assert.equal(calls.length, 2)
  assert.deepEqual(first, second)
})

test('cache match and put failures both fall back to successful real rendering', async () => {
  for (const failure of ['match', 'put', 'both']) {
    const { assets, calls } = assetFixture()
    const cache = {
      async match() { if (failure !== 'put') throw new Error('cache match failed'); return undefined },
      async put() { if (failure !== 'match') throw new Error('cache put failed') },
    }
    await expectPng(await renderAppearanceResponse(request(), assets, 'C001', 'BG001', cache))
    assert.equal(calls.length, 2)
  }
})

test('missing, malformed, oversized and throwing static assets return retryable 503, not broken PNGs', async () => {
  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1)
  oversized.set([137, 80, 78, 71])
  for (const replacement of [
    () => new Response('missing', { status: 404 }),
    () => new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(oversized),
    () => { throw new Error('asset binding failed') },
  ]) {
    const { assets } = assetFixture((url) => url.pathname.endsWith('/C001.png') ? replacement() : undefined)
    const response = await renderAppearanceResponse(request(), assets, 'C001', 'BG001')
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Retry-After'), '30')
    assert.equal(await response.text(), 'Artwork temporarily unavailable')
  }
})
