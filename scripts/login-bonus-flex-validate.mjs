// Validate against LINE without delivering any message to a user or group.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
let token = process.env.LINE_CHANNEL_ACCESS_TOKEN
if (!token) {
  try {
    const vars = readFileSync(new URL('.dev.vars', root), 'utf8')
    token = vars.match(/^\s*LINE_CHANNEL_ACCESS_TOKEN\s*=\s*(.+?)\s*$/m)?.[1].replace(/^["']|["']$/g, '')
  } catch { /* Report only the missing credential name, never its contents. */ }
}
if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required for validation')

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('src/features/loginBonus/flex.ts', root))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
})
const { buildLoginBonusCard } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const examples = [
  { claimed: true, day: '2026-09-22', totalDays: 1, streakDays: 1, rewardDays: 1, rewardPoints: 500, balance: 501 },
  { claimed: true, day: '2026-09-22', totalDays: 5, streakDays: 5, rewardDays: 5, rewardPoints: 2500, balance: 7500 },
  { claimed: false, day: '2026-09-22', totalDays: 10, streakDays: 10, rewardDays: 7, rewardPoints: 3500, balance: 25000 },
]
const response = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
  method: 'POST', redirect: 'error',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ messages: examples.map(buildLoginBonusCard) }),
})
if (!response.ok) {
  const result = await response.json().catch(() => ({}))
  console.error(JSON.stringify({ status: response.status, details: result.details ?? [], message: result.message ?? 'validation failed' }))
  process.exitCode = 1
} else console.log('LINE accepted all 3 login bonus cards; no messages sent.')
