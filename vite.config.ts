import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'

// Keep this in Vite itself: Cloudflare and direct `vite build` invocations do
// not necessarily run package.json's post-build shell commands.
function imageRuntimeAssets(): Plugin {
  let config: ResolvedConfig
  let failed = false
  return {
    name: 'happamochi:image-runtime-assets',
    apply: (_config, { command, mode }) => command === 'build' && mode !== 'client',
    enforce: 'post',
    configResolved(resolved) { config = resolved },
    buildStart() { failed = false },
    buildEnd(error) { failed = Boolean(error) },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (failed || config.build.write === false) return
        // A fresh process is intentional: an import() is cached and would skip
        // injection on subsequent builds in the same process/watch session.
        execFileSync(process.execPath, [
          fileURLToPath(new URL('./scripts/inject-wasm.mjs', import.meta.url)),
          resolve(config.root, config.build.outDir),
        ], { cwd: config.root, stdio: 'inherit' })
      },
    },
  }
}

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    }),
    imageRuntimeAssets(),
  ]
})
