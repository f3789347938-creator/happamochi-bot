// "名言カード" (quote card) feature.
//
// The legacy bot pre-rendered a PNG (profile pic left, quote text right,
// user ID, watermark) and stored the bytes in quote_images.image_data.
// Cloudflare Workers has no <canvas> / native image rendering, so instead
// we reproduce the exact same visual layout using a LINE Flex Message
// (a native card LINE renders client-side) — no image generation needed,
// and it looks identical: avatar on the left, quote text on the right,
// display name + watermark footer.
import type { LineEnv, LineMessage } from '../lib/line'

export async function saveQuote(
  env: LineEnv,
  groupId: string,
  userId: string,
  displayName: string,
  pictureUrl: string | null,
  quoteText: string
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO quote_images (id, image_data, quote_text, author_name) VALUES (?, ?, ?, ?)`
  )
    .bind(id, new Uint8Array(), quoteText, displayName)
    .run()
  return id
}

export function buildQuoteFlexMessage(
  quoteText: string,
  authorName: string,
  pictureUrl: string | null
): LineMessage {
  return {
    type: 'flex',
    altText: `${authorName}「${quoteText}」`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'image',
            url: pictureUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
            aspectMode: 'cover',
            aspectRatio: '1:1',
            size: 'sm',
            flex: 0,
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: `「${quoteText}」`,
                wrap: true,
                weight: 'bold',
                size: 'md',
              },
              {
                type: 'text',
                text: `- ${authorName}`,
                size: 'sm',
                color: '#888888',
                margin: 'md',
                align: 'end',
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '葉っぱもち Bot', size: 'xxs', color: '#aaaaaa', align: 'center' },
        ],
      },
    },
  }
}
