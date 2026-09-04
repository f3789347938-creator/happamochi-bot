// PNG "quote card" image generation on Cloudflare Workers.
//
// Stack: satori (HTML/CSS -> SVG) + @resvg/resvg-wasm (SVG -> PNG).
//
// Cloudflare Workers-specific constraints this file works around:
//
// 1. Workers BLOCK dynamic `WebAssembly.instantiate(bytes)` at runtime.
//    The wasm binaries must be statically `import`ed so wrangler's esbuild
//    can pre-compile them into `WebAssembly.Module` objects. Vite's SSR
//    build can't handle `.wasm` imports directly (Node throws
//    ERR_UNKNOWN_FILE_EXTENSION), so the actual `import ... from
//    './assets/yoga.wasm'` statements are injected into the *compiled*
//    dist/_worker.js by scripts/inject-wasm.mjs (a post-build step), which
//    stashes the resulting WebAssembly.Module objects on `globalThis`. This
//    module just reads them back out of `globalThis`.
// 2. Satori's own internal `fetch()` for <img> tags does not work on
//    Workers — images must be fetched manually and passed in as base64
//    data URLs.
// 3. Satori only decodes PNG/JPEG, not WebP — LINE profile pictures must be
//    requested in a PNG-friendly form (LINE's CDN honors a `.png`-ish path
//    swap for avatar URLs in practice; if fetching fails we simply omit the
//    avatar rather than crash the whole card).
// 4. No Node `Buffer` in the Vite SSR build — base64 encoding is done with
//    chunked `btoa`.

// IMPORTANT: import from 'satori/standalone', NOT the default 'satori'
// entrypoint. The default entrypoint pulls in `yoga-layout`, which tries to
// initialize its bundled WASM dynamically at import time — exactly the
// `WebAssembly.instantiate(bytes)` pattern Cloudflare Workers blocks.
// `satori/standalone`'s `init(input)` instead accepts an already-compiled
// `WebAssembly.Module` directly (see the InitInput type in satori's
// typings) and instantiates *that* — which Workers allows, since the
// blocked operation is compiling raw bytes, not instantiating a
// pre-compiled Module. The module we hand it is the one wrangler's esbuild
// pre-compiled from the static `import ... from './assets/yoga.wasm'` that
// scripts/inject-wasm.mjs injects into the built worker (see ensureInit()).
import satori, { init as initSatori } from 'satori/standalone'
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm'

declare global {
  // eslint-disable-next-line no-var
  var __HAPPAMOCHI_YOGA_WASM__: WebAssembly.Module | undefined
  // eslint-disable-next-line no-var
  var __HAPPAMOCHI_RESVG_WASM__: WebAssembly.Module | undefined
  // eslint-disable-next-line no-var
  var __HAPPAMOCHI_FONT_TTF__: ArrayBuffer | undefined
}

let initialized = false
let initPromise: Promise<void> | null = null

async function ensureInit(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const yogaWasm = globalThis.__HAPPAMOCHI_YOGA_WASM__
    const resvgWasm = globalThis.__HAPPAMOCHI_RESVG_WASM__
    if (!yogaWasm || !resvgWasm) {
      throw new Error(
        'wasm modules not found on globalThis — did the build run scripts/inject-wasm.mjs?'
      )
    }
    // NOTE: the `globalThis.__filename` shim needed to stop yoga-layout's
    // Emscripten loader from crashing on Workers (no `self.location`) is
    // set at the very top of the built worker by scripts/inject-wasm.mjs
    // — it must run before this module's top-level code (satori/standalone
    // -> yoga-layout) is even evaluated, so it can't live here.

    // satori/standalone's init() accepts an already-compiled
    // WebAssembly.Module directly (see InitInput in the typings) — no
    // separate yoga-wasm-web init step is needed.
    await initSatori(yogaWasm)
    await initResvg(resvgWasm)
    initialized = true
  })()

  return initPromise
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunked to avoid blowing the call stack on String.fromCharCode(...bytes)
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, Math.min(i + 8192, bytes.length))
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j])
    }
  }
  return btoa(binary)
}

// Fetch an external image and inline it as a base64 data URL, because
// Satori's built-in fetch doesn't work inside Workers. Returns null (never
// throws) so a broken avatar never takes down the whole card.
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/png,image/jpeg,image/*,*/*',
      },
    })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    // Satori can only decode PNG/JPEG — bail out on webp/etc rather than crash.
    if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/jpg') {
      return null
    }
    const buf = await res.arrayBuffer()
    return `data:${contentType};base64,${arrayBufferToBase64(buf)}`
  } catch {
    return null
  }
}

const CARD_WIDTH = 1280
const CARD_HEIGHT = 720

export interface QuoteCardInput {
  quoteText: string
  authorName: string
  userId: string
  pictureUrl: string | null
}

// Renders the "meigen card" (quote card): a photo on the left (the LINE
// profile picture, if fetchable), a dark panel on the right with the quote
// text, display name, user id, and a small watermark bottom-right —
// matching the legacy bot's layout that was verified against real rows in
// the production `quote_images` table.
export async function generateQuoteCardPng(input: QuoteCardInput): Promise<Uint8Array> {
  await ensureInit()

  const fontData = globalThis.__HAPPAMOCHI_FONT_TTF__
  if (!fontData) {
    throw new Error('font data not found on globalThis — did the build run scripts/inject-wasm.mjs?')
  }

  const avatarDataUrl = input.pictureUrl ? await fetchImageAsDataUrl(input.pictureUrl) : null

  const markup = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        backgroundColor: '#111111',
      },
      children: [
        // Left half: avatar photo (or a plain dark-grey placeholder panel).
        {
          type: 'div',
          props: {
            // NOTE: do NOT set `backgroundImage: undefined` when there's no
            // avatar — satori's CSS property resolver crashes with "Cannot
            // read properties of undefined (reading 'trim')" on any style
            // key whose value is explicitly `undefined` (as opposed to the
            // key being absent). Always build a plain object with only the
            // keys we actually want.
            style: avatarDataUrl
              ? {
                  display: 'flex',
                  width: `${CARD_WIDTH / 2}px`,
                  height: `${CARD_HEIGHT}px`,
                  backgroundColor: '#2a2a2a',
                  backgroundImage: `url(${avatarDataUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : {
                  display: 'flex',
                  width: `${CARD_WIDTH / 2}px`,
                  height: `${CARD_HEIGHT}px`,
                  backgroundColor: '#2a2a2a',
                },
          },
        },
        // Right half: quote text + author + userId, watermark bottom-right.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              width: `${CARD_WIDTH / 2}px`,
              height: `${CARD_HEIGHT}px`,
              backgroundColor: '#111111',
              padding: '60px',
              position: 'relative',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#ffffff',
                    fontSize: '48px',
                    fontWeight: 700,
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  },
                  children: input.quoteText,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#cccccc',
                    fontSize: '32px',
                    marginTop: '40px',
                  },
                  children: `@${input.authorName}`,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#777777',
                    fontSize: '22px',
                    marginTop: '8px',
                  },
                  children: input.userId,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    position: 'absolute',
                    right: '30px',
                    bottom: '20px',
                    color: '#666666',
                    fontSize: '20px',
                  },
                  children: 'HappaMochiBot',
                },
              },
            ],
          },
        },
      ],
    },
  }

  const svg = await satori(markup as any, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      {
        name: 'Noto Sans JP',
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  })

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH },
  })
  const rendered = resvg.render()
  const png = rendered.asPng()
  return png
}
