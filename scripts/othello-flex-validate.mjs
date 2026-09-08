// オセロの盤面カードを LINE公式の検証APIに投げて、実際にLINEが受け付けるかを確認する。
//
// なぜ必要か:
//   実機で「チェス」が無反応だった原因は image に存在しない `width` を
//   指定していたことで、LINEが 400 を返していたため。ローカルで組めても
//   LINE側の受理は別問題なので、カードを変えたら必ず公式APIで確かめる。
//
//   POST https://api.line.me/v2/bot/message/validate/reply （送信はされない）
//
// 今回は終局カードに footer(戦績ボタン) を追加したので、
// waiting / playing / finished の3状態すべてを検証する。
//
// 実行: node scripts/othello-flex-validate.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'samples', 'othello-flex')
const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'

function loadToken() {
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) return process.env.LINE_CHANNEL_ACCESS_TOKEN
  const p = path.join(ROOT, '.dev.vars')
  if (!fs.existsSync(p)) return null
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*LINE_CHANNEL_ACCESS_TOKEN\s*=\s*(.+?)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return null
}

async function fetchCard(payload) {
  const res = await fetch(`${BASE}/debug/othello-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  return body.message ?? null
}

// 終局形(空きマス無し)。黒40 / 白24 で黒の勝ち。
const FINISHED = 'B'.repeat(40) + 'W'.repeat(24)
// 引き分け形(32対32)
const DRAW = 'B'.repeat(32) + 'W'.repeat(32)
// 白の勝ち
const WHITE_WIN = 'W'.repeat(40) + 'B'.repeat(24)

// 表示名が長い場合。盤面だけで約27,000バイトあるため、
// 名前を短くする前は結合絵文字20文字×2人で 30,557バイト = 上限超えになり、
// LINEが400を返してカードが1枚も届かなかった。実際に受理されるか確かめる。
const EMOJI20 = '👨‍👩‍👧‍👦'.repeat(20)
const JP20 = 'あ'.repeat(20)

const CASES = [
  ['waiting', () => fetchCard({ status: 'waiting' })],
  ['playing-black-turn', () => fetchCard({ status: 'playing', turn: 'B' })],
  ['playing-white-turn', () => fetchCard({ status: 'playing', turn: 'W' })],
  ['finished-black-win', () => fetchCard({ status: 'finished', board: FINISHED })],
  ['finished-white-win', () => fetchCard({ status: 'finished', board: WHITE_WIN })],
  ['finished-draw', () => fetchCard({ status: 'finished', board: DRAW })],
  [
    'finished-long-emoji-names',
    () => fetchCard({ status: 'finished', board: FINISHED, blackName: EMOJI20, whiteName: EMOJI20 }),
  ],
  [
    'finished-long-jp-names',
    () => fetchCard({ status: 'finished', board: FINISHED, blackName: JP20, whiteName: JP20 }),
  ],
  [
    'playing-long-emoji-names',
    () => fetchCard({ status: 'playing', blackName: EMOJI20, whiteName: EMOJI20 }),
  ],
]

const samples = []
for (const [name, fn] of CASES) {
  const msg = await fn()
  if (!msg) {
    console.log(`  ⚠️  ${name}: カードを取得できませんでした`)
    continue
  }
  samples.push({ name, msg })
}

fs.mkdirSync(OUT, { recursive: true })
let maxBytes = 0
for (const s of samples) {
  fs.writeFileSync(path.join(OUT, `${s.name}.json`), JSON.stringify(s.msg, null, 2))
  const b = Buffer.byteLength(JSON.stringify(s.msg.contents ?? s.msg), 'utf8')
  maxBytes = Math.max(maxBytes, b)
  if (b > 30000) console.log(`  ❌ ${s.name}: ${b} バイト（30,000超）`)
}
console.log(`サンプル ${samples.length} 件を ${path.relative(ROOT, OUT)} に出力（最大 ${maxBytes} バイト）\n`)

const token = loadToken()
if (!token) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN が見つからないため、LINEの検証APIは実行しません。')
  process.exit(2)
}

let ok = 0
let ng = 0
for (const s of samples) {
  const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [s.msg] }),
  })
  if (res.status === 200) {
    ok++
    console.log(`  ✅ ${s.name}`)
  } else {
    ng++
    console.log(`  ❌ ${s.name} → HTTP ${res.status} ${await res.text()}`)
  }
}
console.log(`\nLINE検証API: 受理 ${ok} / 却下 ${ng}`)
process.exit(ng === 0 ? 0 : 1)
