// Exercise the emitted deployment artifact, not an esbuild bundle of source.
// No server, credentials, external network, or additional dependencies needed.
// Run: node --test tests/dressup/build-artifact.test.mjs
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '../..')
const outDir = mkdtempSync(resolve(tmpdir(), 'happamochi-build-artifact-'))
const workerPath = resolve(outDir, '_worker.js')
const scriptPath = resolve(root, 'scripts/inject-wasm.mjs')
const markerStart = '// HAPPAMOCHI_IMAGE_RUNTIME_START\n'
const markerEnd = '// HAPPAMOCHI_IMAGE_RUNTIME_END\n'
const imports = [
  ['__yogaWasm', 'yoga.wasm', '__HAPPAMOCHI_YOGA_WASM__'],
  ['__resvgWasm', 'resvg.wasm', '__HAPPAMOCHI_RESVG_WASM__'],
  ['__notoSansJpFontBold', 'NotoSansJP-Bold.bin', '__HAPPAMOCHI_FONT_TTF__'],
  ['__notoSansJpFontRegular', 'NotoSansJP-Regular.bin', '__HAPPAMOCHI_FONT_TTF_REGULAR__'],
]
let worker

function assertRuntimePrelude(source) {
  assert.ok(source.startsWith(markerStart), 'runtime initialization precedes bundled module evaluation')
  for (const line of [markerStart.trim(), markerEnd.trim(), ...imports.flatMap(([name, file, global]) => [
    `import ${name} from './assets/${file}';`, `globalThis.${global} = ${name};`,
  ])]) assert.equal(source.split(line).length - 1, 1, `exactly one ${line}`)
  assert.ok(source.indexOf('globalThis.__filename ??=') < source.indexOf(markerEnd))
  assert.ok(source.indexOf("process.type = 'renderer'") < source.indexOf(markerEnd))
  for (const [, file] of imports) {
    const bytes = readFileSync(resolve(outDir, 'assets', file))
    assert.ok(bytes.length > 100, `${file} was copied`)
    if (file.endsWith('.wasm')) assert.ok(WebAssembly.validate(bytes), `${file} is valid WASM`)
  }
}

before(async () => {
  // Hono's adapter otherwise writes its route manifest to the default dist,
  // even with an overridden outDir. Seed this documented output in the isolated
  // fixture so these builds never modify the real release directory.
  writeFileSync(resolve(outDir, '_routes.json'), JSON.stringify({
    version: 1, include: ['/*'], exclude: ['/static/*'],
  }))
  // Two builds in one process catch an import()-cached post-build script.
  for (let pass = 0; pass < 2; pass++) {
    await build({
      root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error',
      build: { outDir, emptyOutDir: false },
      // Hono's config hook overrides inline build.outDir. Override only that
      // path after its config hook, keeping every real production build hook.
      plugins: [{ name: 'test:isolated-output', enforce: 'post',
        config: () => ({ build: { outDir, emptyOutDir: false } }),
      }],
    })
    assertRuntimePrelude(readFileSync(workerPath, 'utf8'))
  }
})

after(() => {
  delete globalThis.__happamochiArtifactImports
  // Only this test's mkdtemp directory is ever removed.
  rmSync(outDir, { recursive: true, force: true })
})

test('every Vite build emits exactly one complete, deployable image runtime prelude', () => {
  assertRuntimePrelude(readFileSync(workerPath, 'utf8'))
})

test('manual reinjection is byte-idempotent and upgrades legacy unmarked output', () => {
  const original = readFileSync(workerPath, 'utf8')
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(process.execPath, [scriptPath, outDir], { cwd: root, stdio: 'pipe' })
    assert.equal(readFileSync(workerPath, 'utf8'), original)
  }
  writeFileSync(workerPath, original.replace(markerStart, '').replace(markerEnd, ''))
  execFileSync(process.execPath, [scriptPath, outDir], { cwd: root, stdio: 'pipe' })
  assert.equal(readFileSync(workerPath, 'utf8'), original)
})

async function loadBuiltWorker() {
  if (worker) return worker
  const source = readFileSync(workerPath, 'utf8')
  assertRuntimePrelude(source)
  // Node does not implement Pages' CompiledWasm/Data imports. Translate ONLY
  // those four imports to the same module values Wrangler supplies. Do not set
  // the runtime globals or Emscripten shims: the built prelude must do that.
  const modules = Object.create(null)
  for (const [, file, global] of imports) {
    assert.equal(globalThis[global], undefined, `${global} is not preinitialized by the test`)
    const bytes = readFileSync(resolve(outDir, 'assets', file))
    modules[file] = file.endsWith('.wasm')
      ? await WebAssembly.compile(bytes)
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  globalThis.__happamochiArtifactImports = modules
  let executable = source
  for (const [name, file] of imports) {
    executable = executable.replace(`import ${name} from './assets/${file}';`,
      `const ${name} = globalThis.__happamochiArtifactImports[${JSON.stringify(file)}];`)
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Unexpected external fetch from built worker') }
  try {
    worker = (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`)).default
  } finally {
    globalThis.fetch = originalFetch
    delete globalThis.__happamochiArtifactImports
  }
  for (const [, file, global] of imports) assert.equal(globalThis[global], modules[file])
  return worker
}

function assertPng(bytes, width, height) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(bytes.readUInt32BE(16), width)
  assert.equal(bytes.readUInt32BE(20), height)
  assert.equal(bytes[24], 8, '8-bit PNG')
  assert.ok([2, 6].includes(bytes[25]), 'RGB/RGBA PNG')
  const compressed = []
  let ended = false
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    assert.ok(end <= bytes.length)
    assert.equal(crc32(bytes.subarray(offset + 4, end - 4)), bytes.readUInt32BE(end - 4))
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4))
    if (type === 'IEND') { ended = true; assert.equal(end, bytes.length) }
    offset = end
  }
  assert.ok(ended && compressed.length > 0)
  const expectedBytes = (width * (bytes[25] === 6 ? 4 : 3) + 1) * height
  const scanlines = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes })
  assert.equal(scanlines.length, expectedBytes, 'complete, decompressible pixel data')
  assert.ok(bytes.length > 1000 && bytes.length < 4 * 1024 * 1024)
}

test('actual built worker serves standard, status and icon PNG routes with only its emitted assets', async () => {
  const built = await loadBuiltWorker()
  const calls = []
  const env = { ASSETS: { async fetch(request) {
    const url = new URL(request.url)
    assert.equal(url.origin, 'https://mochi.example')
    assert.match(url.pathname, /^\/static\/dressup\/(?:C|BG)\d{3}\.png$/)
    calls.push(url.pathname)
    return new Response(readFileSync(resolve(outDir, `.${url.pathname}`)), {
      headers: { 'Content-Type': 'image/png' },
    })
  } } }
  const context = { waitUntil() {}, passThroughOnException() {} }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Unexpected external fetch from image route') }
  try {
    const health = await built.fetch(new Request('https://mochi.example/'), env, context)
    assert.equal(health.status, 200)
    for (const [path, width, height] of [
      ['C000/BG000.png?view=status&v=3', 768, 384],
      ['C001/BG001.png?view=status&v=3', 768, 384],
      ['C000/BG000.png?view=icon&v=3', 192, 144],
      ['C001/BG000.png?view=icon&v=3', 192, 144],
      ['C120/BG030.png?v=1', 768, 512],
    ]) {
      const response = await built.fetch(new Request(`https://mochi.example/dressup-art/${path}`), env, context)
      assert.equal(response.status, 200, `${path} must not silently fail while health is 200`)
      assert.equal(response.headers.get('Content-Type'), 'image/png')
      assertPng(Buffer.from(await response.arrayBuffer()), width, height)
    }
    assert.equal(calls.length, 8, 'icon routes read only their costume; composite routes read both assets')
  } finally {
    globalThis.fetch = originalFetch
  }
})
