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
  // eslint-disable-next-line no-var
  var __HAPPAMOCHI_FONT_TTF_REGULAR__: ArrayBuffer | undefined
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

// Quote text gets smaller as it gets longer, so long posts still fit —
// matches the legacy bot's behavior (a one-line quote like "だった" renders
// huge; a multi-line URL-laden post renders much smaller).
function quoteFontSize(text: string): number {
  const len = text.length
  if (len <= 8) return 54
  if (len <= 20) return 44
  if (len <= 50) return 32
  if (len <= 100) return 24
  return 18
}

// "No avatar" design: a centered card on a navy gradient background with
// large decorative quotation-mark glyphs in the corners — matches legacy
// row 394698b0-0174-4624-a803-f36e07afae12 (quote_text="名言", author="なの").
// This is the design used whenever we don't have a usable profile photo
// (pictureUrl is null, or fetching it failed).
function buildNoAvatarCard(quoteText: string, authorName: string) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        backgroundImage: 'linear-gradient(135deg, #171a30 0%, #0c0d18 100%)',
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              position: 'absolute',
              top: '18px',
              left: '38px',
              fontSize: '100px',
              fontWeight: 400,
              color: 'rgba(255, 255, 255, 0.12)',
            },
            children: '\u201C',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              position: 'absolute',
              bottom: '-30px',
              right: '38px',
              fontSize: '100px',
              fontWeight: 400,
              color: 'rgba(255, 255, 255, 0.12)',
            },
            children: '\u201D',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              maxWidth: '900px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#ffffff',
                    fontSize: `${quoteFontSize(quoteText)}px`,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    textAlign: 'center',
                    justifyContent: 'center',
                    wordBreak: 'break-word',
                  },
                  children: quoteText,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#8a91ad',
                    fontSize: '20px',
                    fontWeight: 400,
                    marginTop: '40px',
                  },
                  children: `— ${authorName}`,
                },
              },
            ],
          },
        },
      ],
    },
  }
}

// "With avatar" design: a real profile photo filling the left half (with a
// soft fade into the dark panel), a near-black panel on the right with the
// quote text / author / userId, and a "HappaMochi Bot" watermark bottom
// right — matches legacy rows b340a8cc-...-df016 and a1fa3dba-...-e1aa.
function buildAvatarCard(
  quoteText: string,
  authorName: string,
  userId: string,
  avatarDataUrl: string
) {
  const halfWidth = CARD_WIDTH / 2
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        backgroundColor: '#050505',
      },
      children: [
        // Left half: the real profile photo, cover-cropped, with a soft
        // fade on its right edge into the dark panel (no hard divider line).
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: `${halfWidth}px`,
              height: `${CARD_HEIGHT}px`,
              position: 'relative',
              backgroundColor: '#050505',
              backgroundImage: `url(${avatarDataUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '150px',
                    height: `${CARD_HEIGHT}px`,
                    backgroundImage:
                      'linear-gradient(to right, rgba(5,5,5,0) 0%, rgba(5,5,5,1) 100%)',
                  },
                },
              },
            ],
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
              width: `${halfWidth}px`,
              height: `${CARD_HEIGHT}px`,
              backgroundColor: '#050505',
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
                    fontSize: `${quoteFontSize(quoteText)}px`,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  },
                  children: quoteText,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#ffffff',
                    fontSize: '24px',
                    fontWeight: 400,
                    marginTop: '40px',
                  },
                  children: `@${authorName}`,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#555555',
                    fontSize: '16px',
                    fontWeight: 400,
                    marginTop: '8px',
                  },
                  children: userId,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    position: 'absolute',
                    right: '25px',
                    bottom: '18px',
                    color: '#666666',
                    fontSize: '18px',
                    fontWeight: 400,
                  },
                  children: 'HappaMochi Bot',
                },
              },
            ],
          },
        },
      ],
    },
  }
}

// Renders the "meigen card" (quote card). Which of the two legacy designs
// gets used depends on whether we have a real profile photo: with one, we
// use the photo-left/dark-panel-right layout; without one (pictureUrl was
// null, or fetching/decoding it failed), we fall back to the centered
// navy-gradient design with decorative quotation marks. Both layouts were
// reverse-engineered from real rows in the production `quote_images` table
// per the user's explicit "make it identical to the old one" request.
export async function generateQuoteCardPng(input: QuoteCardInput): Promise<Uint8Array> {
  await ensureInit()

  const fontDataBold = globalThis.__HAPPAMOCHI_FONT_TTF__
  const fontDataRegular = globalThis.__HAPPAMOCHI_FONT_TTF_REGULAR__
  if (!fontDataBold || !fontDataRegular) {
    throw new Error('font data not found on globalThis — did the build run scripts/inject-wasm.mjs?')
  }

  const avatarDataUrl = input.pictureUrl ? await fetchImageAsDataUrl(input.pictureUrl) : null

  const markup = avatarDataUrl
    ? buildAvatarCard(input.quoteText, input.authorName, input.userId, avatarDataUrl)
    : buildNoAvatarCard(input.quoteText, input.authorName)

  const svg = await satori(markup as any, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      {
        name: 'Noto Sans JP',
        data: fontDataRegular,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Noto Sans JP',
        data: fontDataBold,
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
