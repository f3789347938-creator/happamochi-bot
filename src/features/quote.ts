// "名言カード" (quote card) feature.
//
// The legacy bot pre-rendered a real PNG (profile pic left, quote text
// right, display name, user id, watermark) and stored the bytes in
// quote_images.image_data. A previous rebuild of this bot mistakenly
// replaced that with a LINE Flex Message, wrongly assuming Cloudflare
// Workers couldn't do image generation. This version restores the actual
// PNG generation using satori + @resvg/resvg-wasm (see ../lib/imageGen.ts)
// and delivers it to LINE as a real imageMessage, matching the legacy
// behavior and the real rows found in the production quote_images table.
import type { LineEnv, LineMessage } from '../lib/line'
import { generateQuoteCardPng, type QuoteTheme } from '../lib/imageGen'
import { parseQuoteParams, type QuoteParams } from '../lib/quoteParams'
import { DEFAULT_THEME_ID, resolveThemeForUser } from './profile/core'

// Generates the PNG and stores it in quote_images. Returns the row id,
// which becomes part of the publicly-served image URL
// (GET /quote-image/:id in src/index.tsx).
export async function saveQuote(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string,
  pictureUrl: string | null,
  quoteText: string,
  // カスタマイズ指定。未指定なら従来と完全に同一のカードを生成する。
  opts?: { params?: QuoteParams; baseUrl?: string }
): Promise<string> {
  const id = crypto.randomUUID()

  // カードテーマ(着せ替え)を反映する。
  // 対象は「カードに名前が載る発言者本人」= この関数の userId。
  // 他人への返信から生成する場合は、呼び出し側が引用元の発言者IDを
  // userId として渡しているので、そのまま本人のテーマになる。
  // 水色(既定)のときは theme を渡さず、従来と同一のカードにする。
  // 読み込み失敗時も resolveThemeForUser が水色を返すので生成は壊れない。
  let theme: QuoteTheme | undefined
  try {
    const t = await resolveThemeForUser(env, userId)
    if (t.id !== DEFAULT_THEME_ID) {
      theme = {
        id: t.id,
        bg: t.body_bg,
        text: t.text_color,
        sub: t.text_color,
        muted: t.accent,
        mark: t.accent,
      }
    }
  } catch {
    theme = undefined
  }

  const png = await generateQuoteCardPng({
    quoteText,
    authorName: displayName,
    userId,
    pictureUrl,
    params: opts?.params,
    baseUrl: opts?.baseUrl,
    theme,
  })

  // D1's .bind() does NOT accept a Uint8Array as a BLOB value — it falls
  // back to generic stringification (Uint8Array.prototype.toString(), i.e.
  // Array.prototype.join(',')), which silently corrupts the PNG into a
  // decimal-CSV ASCII text string ("137,80,78,71,13,10,26,10,0,0,0,...").
  // D1 requires a real ArrayBuffer for BLOB columns, so we must slice one
  // out of the Uint8Array (can't just use png.buffer directly in case the
  // Uint8Array is a view over a larger/pooled buffer with a nonzero
  // byteOffset or byteLength < buffer.byteLength).
  const imageBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)

  await env.DB.prepare(
    `INSERT INTO quote_images (id, image_data, quote_text, author_name) VALUES (?, ?, ?, ?)`
  )
    .bind(id, imageBuffer, quoteText, displayName)
    .run()

  return id
}

// Builds the LINE imageMessage pointing at our own public delivery
// endpoint. Both URLs must be plain HTTPS and publicly reachable — LINE's
// servers fetch them directly, they are never sent inline.
export function buildQuoteImageMessage(baseUrl: string, imageId: string): LineMessage {
  const url = `${baseUrl}/quote-image/${imageId}`
  return {
    type: 'image',
    originalContentUrl: url,
    previewImageUrl: url,
  }
}
