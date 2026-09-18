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
const { appearanceUrl, costumeIconUrl, cosmeticImageUrl, appearanceSvg } = await load('src/features/dressup/art.ts')
const costumeBounds = JSON.parse(readFileSync(resolve(root, 'src/features/dressup/costume-bounds.json'), 'utf8'))

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

test('status and icon URLs use versioned finite views, without changing standard v1 URLs', () => {
  const appearance = { costumeId: 'C001', backgroundId: 'BG030' }
  assert.equal(appearanceUrl('https://example.com/ignored/path?private=secret', appearance),
    'https://example.com/dressup-art/C001/BG030.png?v=1')
  assert.equal(appearanceUrl('https://example.com', appearance, 'standard'),
    'https://example.com/dressup-art/C001/BG030.png?v=1')
  assert.equal(appearanceUrl('https://example.com', appearance, 'status'),
    'https://example.com/dressup-art/C001/BG030.png?view=status&v=2')
  assert.equal(appearanceUrl('https://example.com', appearance, 'icon'),
    'https://example.com/dressup-art/C001/BG000.png?view=icon&v=2')
  assert.equal(costumeIconUrl('https://example.com', 'C001'),
    'https://example.com/dressup-art/C001/BG000.png?view=icon&v=2')
  assert.equal(costumeIconUrl('https://example.com', 'Uprivate-user'),
    'https://example.com/dressup-art/C000/BG000.png?view=icon&v=2')
  assert.equal(costumeIconUrl('https://example.com', 'BG001'),
    'https://example.com/dressup-art/C000/BG000.png?view=icon&v=2')
  assert.throws(() => costumeIconUrl('javascript:evil()', 'C001'))
})

test('SVG embeds only PNG bytes and positions a 3:2 background plus costume', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const svg = appearanceSvg(png, png)
  assert.ok(svg.includes('width="768" height="512"'))
  assert.equal((svg.match(/<image /g) ?? []).length, 2)
  assert.throws(() => appearanceSvg('https://evil.test/image.png', png))
  assert.throws(() => appearanceSvg('data:image/png;base64,x" onload="alert(1)', png))
})

test('status SVG is 2:1 with cropped artwork; icon SVG is 4:3 and contains no backdrop', () => {
  const costume = 'data:image/png;base64,iVBORw0KGgo='
  const background = 'data:image/png;base64,iVBORw0KGgoAAAA='
  const status = appearanceSvg(costume, background, 'status', 'C001')
  assert.match(status, /width="768" height="384" viewBox="0 0 768 384"/)
  assert.equal((status.match(/<image /g) ?? []).length, 2)
  assert.ok(status.includes(background))
  assert.ok(status.includes(`viewBox="${costumeBounds.C001.box.join(' ')}"`))
  const icon = appearanceSvg(costume, background, 'icon', 'C001')
  assert.match(icon, /width="192" height="144" viewBox="0 0 192 144"/)
  assert.equal((icon.match(/<image /g) ?? []).length, 1)
  assert.ok(!icon.includes(background), 'no background PNG is embedded in transparent icons')
  assert.ok(!icon.includes('<ellipse'), 'no opaque backdrop or ground shadow')
  assert.ok(icon.includes(`viewBox="${costumeBounds.C001.box.join(' ')}"`))
  for (const view of ['status', 'icon']) {
    assert.throws(() => appearanceSvg('https://evil.test/costume.png', background, view, 'C001'))
    assert.throws(() => appearanceSvg(costume, 'data:image/png;base64,x" onload="alert(1)', view, 'C001'))
    const fallback = appearanceSvg(costume, background, view, '../private')
    assert.ok(!fallback.includes('../private'))
    assert.ok(fallback.includes(`viewBox="${costumeBounds.C000.box.join(' ')}"`))
  }
})

test('crop bounds cover every costume and stay within each real source PNG', () => {
  const costumes = [DEFAULT_COSTUME, ...COSMETICS.filter((item) => item.kind === 'costume')]
  assert.equal(Object.keys(costumeBounds).length, costumes.length)
  for (const costume of costumes) {
    const bounds = costumeBounds[costume.id]
    assert.ok(bounds, costume.id)
    const png = readFileSync(resolve(root, `public${costume.imagePath}`))
    assert.equal(bounds.width, png.readUInt32BE(16), costume.id)
    assert.equal(bounds.height, png.readUInt32BE(20), costume.id)
    assert.equal(bounds.box.length, 4)
    assert.ok(bounds.box.every(Number.isFinite))
    const [x, y, width, height] = bounds.box
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, costume.id)
    assert.ok(x + width <= bounds.width && y + height <= bounds.height, costume.id)
  }
})
