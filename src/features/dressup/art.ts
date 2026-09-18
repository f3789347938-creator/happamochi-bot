import { DEFAULT_BACKGROUND, DEFAULT_COSTUME, getCosmetic } from './catalog'

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

export function appearanceUrl(baseUrl: string, input: Appearance): string {
  const a = normalizedAppearance(input)
  return `${origin(baseUrl)}/dressup-art/${a.costumeId}/${a.backgroundId}.png?v=1`
}

export function cosmeticImageUrl(baseUrl: string, id: string): string {
  const item = getCosmetic(id)
  if (!item) throw new Error('Unknown cosmetic')
  return `${origin(baseUrl)}${item.imagePath}`
}

/** Already-validated PNG data URLs only. No remote references are given to resvg. */
export function appearanceSvg(costumePng: string, backgroundPng: string): string {
  for (const uri of [costumePng, backgroundPng]) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri)) throw new Error('Expected an inline PNG')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="768" height="512" viewBox="0 0 768 512">
    <image x="0" y="0" width="768" height="512" preserveAspectRatio="xMidYMid slice" xlink:href="${backgroundPng}"/>
    <ellipse cx="384" cy="449" rx="181" ry="24" fill="#142c44" opacity=".10"/>
    <image x="152" y="66" width="464" height="390" preserveAspectRatio="xMidYMax meet" xlink:href="${costumePng}"/>
  </svg>`
}
