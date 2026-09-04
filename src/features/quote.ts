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
import { generateQuoteCardPng } from '../lib/imageGen'

// Generates the PNG and stores it in quote_images. Returns the row id,
// which becomes part of the publicly-served image URL
// (GET /quote-image/:id in src/index.tsx).
export async function saveQuote(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string,
  pictureUrl: string | null,
  quoteText: string
): Promise<string> {
  const id = crypto.randomUUID()

  const png = await generateQuoteCardPng({
    quoteText,
    authorName: displayName,
    userId,
    pictureUrl,
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
