import type { LineEnv, LineMessage } from '../../lib/line'
import { buildCard } from './flex'

export type CasinoMode = 'draw' | 'duel' | 'blackjack'

const COMMANDS: Record<string, CasinoMode | 'all'> = {
  'カジノ': 'all', 'もちカジノ': 'all', 'ポーカー': 'draw',
  '通常ポーカー': 'draw', '上級ポーカー': 'duel',
  'ブラックジャック': 'blackjack',
}

export function casinoMode(value: string | undefined): CasinoMode {
  return value === 'duel' || value === 'blackjack' ? value : 'draw'
}

/** The stable link resolves configuration on the server, not in cached Flex. */
export function casinoOpenUrl(siteUrl: string, mode: CasinoMode = 'draw'): string {
  return `${siteUrl.replace(/\/$/, '')}/casino?mode=${mode}`
}

export function casinoLaunchUrl(env: Pick<LineEnv, 'CASINO_ENABLED' | 'CASINO_LIFF_ID'>, mode: CasinoMode): string {
  if (env.CASINO_ENABLED === 'true' && env.CASINO_LIFF_ID?.trim()) {
    return `https://liff.line.me/${encodeURIComponent(env.CASINO_LIFF_ID.trim())}?mode=${mode}`
  }
  return `/static/casino/?mode=${mode}`
}

/** Opening this card or any link never starts a round or spends points. */
export function buildCasinoCommand(raw: string, siteUrl: string): LineMessage[] | null {
  const key = raw.trim()
  if (!Object.hasOwn(COMMANDS, key)) return null
  const command = COMMANDS[key]
  const modes: { mode: CasinoMode; label: string; value: string }[] = [
    { mode: 'draw', label: '通常ポーカー', value: '5枚のカードを1度だけ交換して役を作る' },
    { mode: 'duel', label: '上級ポーカー', value: 'もちディーラーと駆け引きで勝負' },
    { mode: 'blackjack', label: 'ブラックジャック', value: '21を超えずにディーラーと勝負' },
  ]
  if (command !== 'all') modes.sort((a, b) => Number(b.mode === command) - Number(a.mode === command))
  return [buildCard({
    category: 'ゲーム', title: '葉っぱもち カジノ',
    body: '3つのカードゲーム。練習コインでも気軽に遊べるよ。',
    rows: modes.map(({ label, value }) => ({ label, value })),
    buttons: modes.map(({ mode, label }, index) => ({
      label, data: '', uri: casinoOpenUrl(siteUrl, mode), kind: index === 0 ? 'primary' : 'sub',
    })),
    altText: '葉っぱもち カジノ｜通常ポーカー・上級ポーカー・ブラックジャック',
  })]
}
