import { DEFAULT_BACKGROUND, DEFAULT_COSTUME, getCosmetic } from './catalog'
import costumeBounds from './costume-bounds.json'

export type ArtworkView = 'standard' | 'status' | 'icon'

export interface Appearance {
  costumeId: string
  backgroundId: string
}

/** Only catalog-owned IDs become public asset paths; never include LINE IDs. */
export function normalizedAppearance(input: Appearance): Appearance {
  const costume = getCosmetic(input.costumeId)
  const background = getCosmetic(input.backgroundId)
  return {
    costumeId: costume?.kind === 'costume' ? costume.id : DEFAULT_COSTUME.id,
    backgroundId: background?.kind === 'background' ? background.id : DEFAULT_BACKGROUND.id,
  }
}

function origin(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid asset origin')
  return url.origin
}

export function appearanceUrl(baseUrl: string, input: Appearance, view: ArtworkView = 'standard'): string {
  const a = normalizedAppearance(input)
  const backgroundId = view === 'icon' ? DEFAULT_BACKGROUND.id : a.backgroundId
  const query = view === 'standard' ? 'v=1' : `view=${view}&v=2`
  return `${origin(baseUrl)}/dressup-art/${a.costumeId}/${backgroundId}.png?${query}`
}

export function costumeIconUrl(baseUrl: string, costumeId: string): string {
  return appearanceUrl(baseUrl, { costumeId, backgroundId: DEFAULT_BACKGROUND.id }, 'icon')
}

export function cosmeticImageUrl(baseUrl: string, id: string): string {
  const item = getCosmetic(id)
  if (!item) throw new Error('Unknown cosmetic')
  return `${origin(baseUrl)}${item.imagePath}`
}

/** Already-validated PNG data URLs only. No remote references are given to resvg. */
export function appearanceSvg(costumePng: string, backgroundPng: string, view: ArtworkView = 'standard', costumeId = 'C000'): string {
  for (const uri of [costumePng, backgroundPng]) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri)) throw new Error('Expected an inline PNG')
  }
  if (view === 'status' || view === 'icon') {
    const bounds = costumeBounds[costumeId as keyof typeof costumeBounds] ?? costumeBounds.C000
    const icon = view === 'icon'
    const width = icon ? 192 : 768
    const height = icon ? 144 : 384
    const [x, y, w, h] = icon ? [4, 2, 184, 140] : [136, 12, 496, 358]
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${icon ? '' : `<image width="768" height="384" preserveAspectRatio="xMidYMin slice" xlink:href="${backgroundPng}"/><ellipse cx="384" cy="358" rx="178" ry="16" fill="#142c44" opacity=".08"/>`}
      <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${bounds.box.join(' ')}" preserveAspectRatio="xMidYMax meet">
        <image width="${bounds.width}" height="${bounds.height}" xlink:href="${costumePng}"/>
      </svg>
    </svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="768" height="512" viewBox="0 0 768 512">
    <image x="0" y="0" width="768" height="512" preserveAspectRatio="xMidYMid slice" xlink:href="${backgroundPng}"/>
    <ellipse cx="384" cy="449" rx="181" ry="24" fill="#142c44" opacity=".10"/>
    <image x="152" y="66" width="464" height="390" preserveAspectRatio="xMidYMax meet" xlink:href="${costumePng}"/>
  </svg>`
}
