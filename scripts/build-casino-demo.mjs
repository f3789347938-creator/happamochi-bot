import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'public/static/casino')
const destination = resolve(root, 'artifacts/casino/happamochi-casino-demo.html')
const [html, css, bundled] = await Promise.all([
  readFile(resolve(source, 'index.html'), 'utf8'),
  readFile(resolve(source, 'styles.css'), 'utf8'),
  build({
    entryPoints: [resolve(source, 'app.mjs')],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    target: ['chrome100', 'safari15.4'], charset: 'utf8', minify: true,
  }),
])

const cssTag = /<link\b(?=[^>]*href=["'](?:\.\/)?styles\.css["'])[^>]*>/i
const scriptTag = /<script\b(?=[^>]*src=["'](?:\.\/)?app\.mjs["'])[^>]*>\s*<\/script>/i
if (!cssTag.test(html) || !scriptTag.test(html)) throw new Error('Casino entry tags changed; update the demo bundler.')
const script = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const portable = html
  .replace(cssTag, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace(scriptTag, () => `<script>${script}</script>`)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, portable)
console.log(`Portable practice demo: ${destination} (${Buffer.byteLength(portable)} bytes)`)
