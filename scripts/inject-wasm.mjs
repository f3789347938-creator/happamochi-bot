// Post-build step: Vite's SSR build cannot handle `import x from './y.wasm'`
// (Node.js throws ERR_UNKNOWN_FILE_EXTENSION), so we vite-build the worker
// WITHOUT any wasm/font imports, then patch the compiled dist/_worker.js to
// prepend static imports for the wasm binaries + font file. wrangler's own
// esbuild step (which runs during `wrangler pages deploy`) DOES understand
// `.wasm` static imports (pre-compiles them into WebAssembly.Module) and
// binary `.ttf` imports (via the `rules` config in wrangler.jsonc), so this
// works even though Vite itself cannot do it.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distDir = resolve(root, 'dist')
const workerPath = resolve(distDir, '_worker.js')

// Copy the raw wasm/font assets next to _worker.js so the injected relative
// imports below can resolve them.
mkdirSync(resolve(distDir, 'assets'), { recursive: true })
copyFileSync(resolve(root, 'node_modules/satori/yoga.wasm'), resolve(distDir, 'assets/yoga.wasm'))
copyFileSync(resolve(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm'), resolve(distDir, 'assets/resvg.wasm'))
// NOTE: Pages' `_worker.js` bundler (buildRawWorker in wrangler) does NOT
// read wrangler.jsonc's `rules` field — it only applies its own hardcoded
// DEFAULT_MODULE_RULES ({type:"Data", globs:["**/*.bin"]},
// {type:"CompiledWasm", globs:["**/*.wasm"]}). A `.ttf` import fails with
// "No loader is configured for .ttf files" even though a matching `Data`
// rule exists in wrangler.jsonc. Renaming to `.bin` makes it match the
// built-in Data rule and bundle correctly as an ArrayBuffer.
copyFileSync(resolve(root, 'public/static/fonts/NotoSansJP-Bold.ttf'), resolve(distDir, 'assets/NotoSansJP-Bold.bin'))
// NOTE: satori is deliberately pinned to 0.32.0 (see package.json) — 0.33.0
// added a HarfBuzz-based text shaper whose Emscripten loader self-triggers
// a `fetch('hb.wasm')` at module-eval time (top-level, outside any request
// handler). Cloudflare Workers forbids I/O in global scope, so that fetch
// is rejected, harfbuzz falls back to a sync XMLHttpRequest reader, and
// workerd has no XMLHttpRequest -> hard crash ("XMLHttpRequest is not
// defined") on every single render, with no viable workaround short of
// patching harfbuzz's own bundled loader bytecode. 0.32.0 doesn't bundle
// harfbuzz at all, so this whole class of failure doesn't exist. Do not
// upgrade satori past 0.32.x without re-verifying this on workerd first.

const original = readFileSync(workerPath, 'utf-8')

// IMPORTANT: this shim MUST run before the `import` statements below, not
// just before our own code calls into satori. The yoga-layout wasm loader
// bundled inside satori/standalone is Emscripten-generated code that
// creates a top-level Promise (i.e. it starts running immediately when the
// module graph is loaded, NOT lazily when satori's init() is called). That
// loader determines its own script path with (minified, but equivalent
// to): `typeof __filename !== 'undefined' ? __filename : (typeof
// WorkerGlobalScope !== 'undefined' && self.location.href)`. workerd
// defines `WorkerGlobalScope` but has no `self.location` at all (no
// page/script URL concept inside a Worker), so the fallback branch throws
// "Cannot read properties of undefined (reading 'href')" while the module
// graph is still being evaluated — before ensureInit() in imageGen.ts ever
// gets a chance to run. Defining a global `__filename` up front makes the
// ternary take the first branch and never touch `self.location`. (This
// value is only ever used by Emscripten as a locateFile() base path
// fallback, which we don't rely on — we hand init() a pre-compiled
// WebAssembly.Module directly.)
// Second Emscripten branch to defuse: after the __filename fix above, the
// loader next checks `typeof process === 'object' && process.versions?.node
// && process.type !== 'renderer'` to decide it's "real" Node.js and tries
// to `require('fs')` to read the wasm file from disk by path — which
// doesn't exist/work in Workers (nodejs_compat's `process` polyfill makes
// the first two conditions true, so this branch is reached; there is no
// wasm *file on disk* to require() a reader for since we hand init() an
// already-compiled WebAssembly.Module). Setting `process.type = 'renderer'`
// makes that condition false, routing it into the harmless
// browser/WorkerGlobalScope branch instead, whose fetch/XHR-based file
// readers are never actually invoked because we never ask it to load a
// wasm file by URL.
const prelude = `globalThis.__filename ??= './satori-standalone-yoga.js';
if (typeof process === 'object' && process) { process.type = 'renderer' }
import __yogaWasm from './assets/yoga.wasm';
import __resvgWasm from './assets/resvg.wasm';
import __notoSansJpFont from './assets/NotoSansJP-Bold.bin';
globalThis.__HAPPAMOCHI_YOGA_WASM__ = __yogaWasm;
globalThis.__HAPPAMOCHI_RESVG_WASM__ = __resvgWasm;
globalThis.__HAPPAMOCHI_FONT_TTF__ = __notoSansJpFont;
`

writeFileSync(workerPath, prelude + original)
console.log('[inject-wasm] patched dist/_worker.js with static wasm/font imports')
