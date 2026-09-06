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
import {
  DEFAULT_PARAMS,
  baseTextColor,
  effectiveFontNumber,
  perCharColors,
  type QuoteParams,
} from './quoteParams'

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
  /**
   * カスタマイズ指定。未指定(または解析結果が全て既定)のときは、
   * 従来と完全に同一のカードを生成する。
   */
  params?: QuoteParams
  /**
   * フォント番号が指定されたときに、そのフォント実体を取得するための
   * ベースURL(同一オリジン)。Workers ではバンドルに12書体を積めないため、
   * 静的アセットとして配信し、必要な1本だけ実行時に取得する。
   */
  baseUrl?: string
}

// レガシー(〜2026年6月)の名言カードは、引用文のフォントサイズを文字数で
// 変えていなかった。本番D1に残るレガシー画像9枚(2026-02〜03)を実測した
// ところ、文字数 2/3/4/5/6/7/12/13 のいずれでも 1文字あたりの送り幅が
// 48〜50px、字高が 42〜45px でほぼ一定であり、縦位置(引用文 y=265、
// 著者 y=393、userId y=430)も文字数に依らず完全固定だった。
//   len= 2 "ああ"                幅 90px → 45.0px/字
//   len= 5 "あいうえお"           幅242px → 48.4px/字
//   len= 7 "タマタマだよ…"        幅337px → 48.1px/字
//   len=13 "僕は太ももに挟まれたいです" 幅645px → 49.6px/字
// つまりレガシーは 50px 固定。文字数で 54/44/32/24/18px と切り替える
// 実装はリビルド時に入った差異なので、固定サイズに戻す。
// (ただし極端な長文は右パネルからはみ出すため、レガシーに実例が無い
//  長さについてのみ、はみ出し防止の縮小を残す。レガシー実物の最長は
//  13文字であり、それ以下では必ず 50px になる。)
const QUOTE_FONT_SIZE_LEGACY = 50

function quoteFontSize(text: string): number {
  const len = text.length
  // レガシー実測レンジ(13文字以下)は必ず50px固定。
  if (len <= 24) return QUOTE_FONT_SIZE_LEGACY
  // 以降はレガシーに実例が無い領域。はみ出しを防ぐためだけの縮小。
  if (len <= 50) return 36
  if (len <= 100) return 26
  return 20
}

// アバター無しカード(フォールバック)側の引用文サイズ。こちらは右パネルが
// 無く画面中央に組むため、アバター有りカードとは別系統。レガシー実物
// (394698b0 / quote_text="名言")の実測は 字高41px・幅84px で、
// fontWeight 700 + fontSize 44px の描画結果(字高41px・幅84px)と一致した。
function noAvatarQuoteFontSize(text: string): number {
  const len = text.length
  if (len <= 24) return 44
  if (len <= 50) return 34
  if (len <= 100) return 26
  return 20
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
        // レガシー実物(394698b0)の実測ピクセル値と厳密一致するグラデーション。
        // 左上/右下 = rgb(15,15,35) = #0f0f23、中央 = rgb(26,26,62) = #1a1a3e。
        // 以前の '#171a30 → #0c0d18' の2色版は左上(23,26,48)/右下(12,13,24)と
        // なりレガシーと一致しなかった。
        backgroundImage: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)',
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
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.1)',
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
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.1)',
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
              // レガシー実物は引用文ベースラインが y=311..351。中央揃えのみ
              // だと y=308..348 と上に出るため、実測差分だけ下げる。
              marginTop: '5px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    color: '#ffffff',
                    fontSize: `${noAvatarQuoteFontSize(quoteText)}px`,
                    // レガシー実物は太字(700)。400だと字幅が合わない。
                    fontWeight: 700,
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
                    // レガシー実測の著者名色は rgb(170,170,204) = #aaaacc。
                    color: '#aaaacc',
                    fontSize: '20px',
                    fontWeight: 700,
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
  // 以下の数値はすべて本番D1に残るレガシー画像(2026-02〜03の9枚)を
  // ピクセル実測して合わせたもの。推測値は無い。
  //
  //   ・写真領域はレガシー実測で x=0〜636、フェードは x=454〜636
  //     (幅182px)。つまり写真の描画幅は従来どおり 640 が正しい。
  //     一度 519 に縮めたことがあるが、それはテキスト中心を合わせる
  //     ための帳尻合わせで、写真が削れてフェードが急に見える原因に
  //     なったので撤回した。写真幅は 640、フェード幅は 182 が実測値。
  //   ・テキストの中心はレガシー9枚とも x=898〜901.5(=899.5)。
  //     写真幅640のままだと単純な右半分の中心は959.5でズレるため、
  //     テキストは右パネルではなくカード全体に対する絶対配置にし、
  //     中心が899.5になるよう left/width を直接指定する。
  //   ・背景は純黒 #000000(レガシー実測 rgb(0,0,0))。
  //   ・引用文/著者/userId はレガシーでは文字数に依らず縦位置が固定
  //     (引用文 y=265、著者 y=393、userId y=430)。
  const PHOTO_WIDTH = 640
  const FADE_WIDTH = 182
  // テキストブロックの中心を x=899.5 にする。左端と幅から中心が決まる:
  // center = TEXT_LEFT + TEXT_WIDTH / 2
  const TEXT_LEFT = 559
  const TEXT_WIDTH = 681
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        backgroundColor: '#000000',
        position: 'relative',
      },
      children: [
        // 左: プロフィール写真。右端を黒へソフトフェードさせる。
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${PHOTO_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
              backgroundColor: '#000000',
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
                    width: `${FADE_WIDTH}px`,
                    height: `${CARD_HEIGHT}px`,
                    backgroundImage:
                      'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%)',
                  },
                },
              },
            ],
          },
        },
        // 右: 引用文 / @表示名 / userId。レガシーに合わせ縦位置は固定。
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              position: 'absolute',
              top: '249px',
              left: `${TEXT_LEFT}px`,
              width: `${TEXT_WIDTH}px`,
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
              position: 'absolute',
              top: '385px',
              left: `${TEXT_LEFT}px`,
              width: `${TEXT_WIDTH}px`,
              color: '#ffffff',
              fontSize: '24px',
              fontWeight: 400,
              textAlign: 'center',
              justifyContent: 'center',
            },
            children: `@${authorName}`,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              position: 'absolute',
              top: '424px',
              left: `${TEXT_LEFT}px`,
              width: `${TEXT_WIDTH}px`,
              // レガシー実測: userId の描画幅は x=747..1051(305px)。
              // 15px では 268px と細く、17px で 303px となり一致する。
              color: '#aaaaaa',
              fontSize: '17px',
              fontWeight: 400,
              textAlign: 'center',
              justifyContent: 'center',
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
              right: '13px',
              bottom: '8px',
              color: '#777777',
              fontSize: '14px',
              fontWeight: 400,
            },
            children: 'HappaMochi Bot',
          },
        },
      ],
    },
  }
}

// =========================================================================
// カスタマイズ対応カード
// =========================================================================
// 重要: この経路は「パラメータが1つ以上指定されたときだけ」使う。
// 無指定時は上の buildAvatarCard / buildNoAvatarCard をそのまま通すので、
// 既存の名言カードの見た目は1ピクセルも変わらない。

/** 日付を JST の YYYY-MM-DD で返す(右上表示用) */
function todayJstStamp(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 本文を「1文字ごとに色を変えられる」形で組む。
 * 虹・季節テーマのときは1文字ずつ span 相当の div を並べる。
 * それ以外は1つのテキストノードのまま返す(改行処理を satori に任せる)。
 */
function quoteChildren(text: string, p: QuoteParams): any {
  const colors = perCharColors(text, p.color)
  if (!colors) return text

  // 1文字ずつ色を変える場合、flex-wrap で折り返す。
  // 空白と改行は幅を保つために nbsp に置き換える。
  return Array.from(text).map((ch, i) => ({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        color: colors[i],
        // 半角スペースは flex 子要素だと潰れるので幅を明示する
        ...(ch === ' ' || ch === '\u3000' ? { width: ch === ' ' ? '0.5em' : '1em' } : {}),
      },
      children: ch === '\n' ? '' : ch,
    },
  }))
}

function buildCustomCard(
  quoteText: string,
  authorName: string,
  userId: string,
  avatarDataUrl: string | null,
  p: QuoteParams
) {
  // レイアウト寸法。
  //   standard: 既存カードと同じ 写真640 / フェード182 / テキスト中心899.5
  //   new     : 写真を狭めて(38%)テキスト領域を広く取る。MiqXの実測比率。
  const photoWidth = p.layoutNew ? 486 : 640
  const fadeWidth = p.layoutNew ? 150 : 182
  const textLeft = p.layoutNew ? 470 : 559
  const textWidth = p.layoutNew ? 790 : 681

  const bg = p.whiteBase ? '#FFFFFF' : '#000000'
  const fadeTo = p.whiteBase ? '255,255,255' : '0,0,0'
  const textColor = baseTextColor(p)
  const subColor = p.whiteBase ? '#555555' : '#ffffff'
  const idColor = p.whiteBase ? '#9a9a9a' : '#aaaaaa'
  const markColor = p.whiteBase ? '#b0b0b0' : '#777777'
  const perChar = perCharColors(quoteText, p.color) !== null

  // 本文サイズ。1文字ごとに色を付ける場合も同じ基準を使う。
  const qSize = avatarDataUrl ? quoteFontSize(quoteText) : noAvatarQuoteFontSize(quoteText)

  const children: any[] = []

  // --- 背景(アイコン無しのとき) ---
  if (!avatarDataUrl && !p.whiteBase) {
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${CARD_WIDTH}px`,
          height: `${CARD_HEIGHT}px`,
          backgroundImage:
            'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)',
        },
      },
    })
  }

  // --- 左: アイコン ---
  if (avatarDataUrl) {
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${photoWidth}px`,
          height: `${CARD_HEIGHT}px`,
          backgroundColor: bg,
          backgroundImage: `url(${avatarDataUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          // mono: 白黒 / rev: 左右反転。
          // satori はどちらも backgroundImage に対して効く(実測で確認済み)。
          ...(p.monochrome ? { filter: 'grayscale(1)' } : {}),
          ...(p.reversed ? { transform: 'scaleX(-1)' } : {}),
        },
      },
    })
    // フェードは写真とは別要素にして、親の scaleX(-1) の影響を受けないように
    // する。写真の子要素にすると反転が伝播してフェードが左端に出てしまい、
    // 写真の右端が黒へ溶けずに切り立った境界になる(実際にそうなった)。
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: `${photoWidth - fadeWidth}px`,
          width: `${fadeWidth}px`,
          height: `${CARD_HEIGHT}px`,
          backgroundImage: `linear-gradient(to right, rgba(${fadeTo},0) 0%, rgba(${fadeTo},1) 100%)`,
        },
      },
    })
  }

  // --- 引用文 ---
  const quoteTop = avatarDataUrl ? (p.layoutNew ? 236 : 249) : 250
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'absolute',
        top: `${quoteTop}px`,
        left: avatarDataUrl ? `${textLeft}px` : '140px',
        width: avatarDataUrl ? `${textWidth}px` : '1000px',
        color: textColor,
        fontSize: `${qSize}px`,
        fontWeight: p.bold ? 700 : 400,
        lineHeight: 1.4,
        textAlign: 'center',
        justifyContent: 'center',
        wordBreak: 'break-word',
        // 1文字ずつ色を付けるときは折り返しを自前で行う
        ...(perChar ? { flexWrap: 'wrap', alignItems: 'center' } : {}),
      },
      children: quoteChildren(quoteText, p),
    },
  })

  // --- 著者名 ---
  const authorTop = avatarDataUrl ? (p.layoutNew ? 380 : 385) : 400
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'absolute',
        top: `${authorTop}px`,
        left: avatarDataUrl ? `${textLeft}px` : '140px',
        width: avatarDataUrl ? `${textWidth}px` : '1000px',
        color: subColor,
        fontSize: '24px',
        fontWeight: 400,
        textAlign: 'center',
        justifyContent: 'center',
      },
      children: `@${authorName}`,
    },
  })

  // --- userId ---
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'absolute',
        top: `${authorTop + 39}px`,
        left: avatarDataUrl ? `${textLeft}px` : '140px',
        width: avatarDataUrl ? `${textWidth}px` : '1000px',
        color: idColor,
        fontSize: '17px',
        fontWeight: 400,
        textAlign: 'center',
        justifyContent: 'center',
      },
      children: userId,
    },
  })

  // --- 右上の日付。new レイアウトのときだけ出す ---
  if (p.layoutNew) {
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          position: 'absolute',
          right: '20px',
          top: '16px',
          color: markColor,
          fontSize: '18px',
          fontWeight: 400,
        },
        children: todayJstStamp(),
      },
    })
  }

  // --- ウォーターマーク ---
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'absolute',
        right: '13px',
        bottom: '8px',
        color: markColor,
        fontSize: '14px',
        fontWeight: 400,
      },
      children: 'HappaMochi Bot',
    },
  })

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        backgroundColor: bg,
        position: 'relative',
      },
      children,
    },
  }
}

/**
 * フォント番号に対応する書体を同一オリジンから取得する。
 * 取得できなければ null を返し、呼び出し側は既定フォントにフォールバックする
 * (フォント指定の失敗でカード生成全体を落とさない)。
 */
async function fetchQuoteFont(baseUrl: string, n: number): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${baseUrl}/static/fonts/quote/f${n}.ttf`)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
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

  const p = input.params ?? DEFAULT_PARAMS

  // パラメータが何も指定されていないときは、従来のレイアウト関数を
  // そのまま通す。ここを分岐させておくことで、既存の名言カードの
  // 出力が1ピクセルも変わらないことを保証する。
  const markup = p.any
    ? buildCustomCard(input.quoteText, input.authorName, input.userId, avatarDataUrl, p)
    : avatarDataUrl
      ? buildAvatarCard(input.quoteText, input.authorName, input.userId, avatarDataUrl)
      : buildNoAvatarCard(input.quoteText, input.authorName)

  // フォント指定があれば、その書体を同一オリジンから取得して
  // 既定フォントより先に登録する(satori は先に一致した書体を使う)。
  const fonts: any[] = []
  // bold と併用された場合は同系統の太い書体に差し替える
  // (satori は合成太字をしないため。effectiveFontNumber のコメント参照)
  const fontNo = effectiveFontNumber(p)
  if (fontNo > 0 && input.baseUrl) {
    const custom = await fetchQuoteFont(input.baseUrl, fontNo)
    if (custom) {
      // サブセットは単一ウェイトなので 400/700 の両方に同じ実体を割り当てる。
      // 太さは「どの実体を選ぶか」で決まっており、fontWeight では変わらない。
      fonts.push(
        { name: 'Noto Sans JP', data: custom, weight: 400, style: 'normal' },
        { name: 'Noto Sans JP', data: custom, weight: 700, style: 'normal' }
      )
    }
  }
  if (fonts.length === 0) {
    fonts.push(
      { name: 'Noto Sans JP', data: fontDataRegular, weight: 400, style: 'normal' },
      { name: 'Noto Sans JP', data: fontDataBold, weight: 700, style: 'normal' }
    )
  }

  const svg = await satori(markup as any, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts,
  })

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH },
  })
  const rendered = resvg.render()
  const png = rendered.asPng()
  return png
}
