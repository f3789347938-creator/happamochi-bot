import { getCosmetic } from './catalog'
import { appearanceSvg } from './art'
import { renderArtworkSvgPng } from '../../lib/imageGen'

type AssetBinding = { fetch: (request: Request) => Promise<Response> }

async function inlinePng(assets: AssetBinding, origin: string, path: string): Promise<string> {
  const response = await assets.fetch(new Request(new URL(path, origin)))
  if (!response.ok) throw new Error('Cosmetic asset unavailable')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 4 * 1024 * 1024 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    throw new Error('Invalid cosmetic PNG')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/** Finite catalog combinations, publicly cacheable; never read profile data. */
export async function renderAppearanceResponse(
  request: Request,
  assets: AssetBinding | undefined,
  costumeId: string,
  backgroundId: string,
  cache?: Cache,
): Promise<Response> {
  const costume = getCosmetic(costumeId)
  const background = getCosmetic(backgroundId)
  if (costume?.kind !== 'costume' || background?.kind !== 'background') {
    return new Response('Not found', { status: 404 })
  }
  if (!assets) return new Response('Asset binding unavailable', { status: 503 })
  const origin = new URL(request.url).origin
  // Ignore arbitrary queries, so a cache-buster cannot amplify render cost.
  const cacheKey = new Request(`${origin}/dressup-art/${costume.id}/${background.id}.png?v=1`)
  const cached = await cache?.match(cacheKey).catch(() => undefined)
  if (cached) return cached
  try {
    const [costumePng, backgroundPng] = await Promise.all([
      inlinePng(assets, origin, costume.imagePath),
      inlinePng(assets, origin, background.imagePath),
    ])
    const png = await renderArtworkSvgPng(appearanceSvg(costumePng, backgroundPng), 768)
    const response = new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    // Cache failures must not prevent LINE from loading the successful PNG.
    if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined)
    return response
  } catch {
    return new Response('Artwork temporarily unavailable', { status: 503, headers: { 'Retry-After': '30' } })
  }
}
