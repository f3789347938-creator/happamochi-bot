import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const load = async (path) => {
  const output = await build({ entryPoints: [resolve(root, path)], bundle: true, write: false, format: 'esm', platform: 'neutral' })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const { COSMETICS, DEFAULT_COSTUME, DEFAULT_BACKGROUND, getCosmetic } = await load('src/features/dressup/catalog.ts')
const { appearanceUrl, cosmeticImageUrl, appearanceSvg } = await load('src/features/dressup/art.ts')

test('catalog retains all 120 numbered costumes and 30 backgrounds plus separate defaults', () => {
  assert.equal(COSMETICS.length, 150)
  assert.equal(new Set(COSMETICS.map(i => i.id)).size, 150)
  assert.equal(COSMETICS.filter(i => i.kind === 'costume').length, 120)
  assert.equal(COSMETICS.filter(i => i.kind === 'background').length, 30)
  assert.equal(getCosmetic('C001').name, 'おやすみもち')
  assert.equal(getCosmetic('C120').name, '星座もち')
  assert.equal(getCosmetic('BG001').name, '月と雲')
  assert.equal(getCosmetic('BG030').name, 'かぼちゃの館')
  assert.equal(DEFAULT_COSTUME.id, 'C000')
  assert.equal(DEFAULT_BACKGROUND.id, 'BG000')
  assert.equal(getCosmetic('__proto__'), undefined)
  assert.equal(getCosmetic('../C001'), undefined)
})

test('all catalog PNGs exist, have bounded size and valid dimensions', () => {
  for (const item of [DEFAULT_COSTUME, DEFAULT_BACKGROUND, ...COSMETICS]) {
    assert.match(item.imagePath, /^\/static\/dressup\/[A-Za-z0-9_\-/.]+\.png$/)
    const file = resolve(root, `public${item.imagePath}`)
    assert.ok(existsSync(file), item.imagePath)
    const bytes = readFileSync(file)
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.ok(bytes.length < 4 * 1024 * 1024, item.id)
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 1536, item.id)
    assert.ok(bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 1024, item.id)
  }
})

test('appearance URL only uses catalog IDs and never identity or external sources', () => {
  const url = appearanceUrl('https://example.com', { costumeId: 'C001', backgroundId: 'BG001' })
  assert.equal(url, 'https://example.com/dressup-art/C001/BG001.png?v=1')
  assert.equal(appearanceUrl('https://example.com', { costumeId: 'Uprivate-user', backgroundId: 'https://evil.test/x' }),
    'https://example.com/dressup-art/C000/BG000.png?v=1')
  assert.throws(() => cosmeticImageUrl('https://example.com', '../private'))
  assert.throws(() => cosmeticImageUrl('javascript:evil()', 'C001'))
})

test('SVG embeds only PNG bytes and positions a 3:2 background plus costume', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const svg = appearanceSvg(png, png)
  assert.ok(svg.includes('width="768" height="512"'))
  assert.equal((svg.match(/<image /g) ?? []).length, 2)
  assert.throws(() => appearanceSvg('https://evil.test/image.png', png))
  assert.throws(() => appearanceSvg('data:image/png;base64,x" onload="alert(1)', png))
})
