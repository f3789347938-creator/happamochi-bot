// ヘルプメニューの新規Flexを LINE公式の検証APIに投げて、実際にLINEが
// 受け付けるかを確認する。
//
// なぜ必要か:
//   実機で「チェス」が無反応だった原因は image に存在しない `width` を
//   指定していたことで、LINEが 400 を返していたため。ローカルで組めても
//   LINE側の受理は別問題なので、新しいカードは必ず公式APIで確かめる。
//
//   POST https://api.line.me/v2/bot/message/validate/reply （送信はされない）
//
// 稼働中のローカルサーバーから実際のカードを取り出して検証するので、
// 「実装が返す本物」をそのまま確認できる。
//
// 実行: node scripts/menu-flex-validate.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'samples', 'menu-flex')
const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'
const G = 'Cmenu_test_grp1'
const A = 'Umenu_test_alice_000000000000001'

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

async function fetchMenu(data, { dm = false } = {}) {
  const payload = dm ? { data, userId: A } : { data, groupId: G, userId: A }
  const res = await fetch(`${BASE}/debug/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  return (body.would_reply_with ?? [])[0] ?? null
}

async function fetchCommand(text) {
  const res = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: G, userId: A }),
  })
  const body = await res.json()
  return (body.would_reply_with ?? [])[0] ?? null
}

// 検証する画面。新規に作った32画面のうち、実際にカードを生成するものすべて。
const CASES = [
  ['help-carousel', () => fetchCommand('ヘルプ')],
  ['M-main', () => fetchMenu('hm|n|M')],
  ['Q01-quote', () => fetchMenu('hm|n|Q01')],
  ['Q01-with-decor', () => fetchMenu('hm|n|Q01~bold,虹,7')],
  ['Q02-decor-menu', () => fetchMenu('hm|n|Q02~bold,虹,7')],
  ['Q03-style', () => fetchMenu('hm|n|Q03')],
  ['Q04-color-p1', () => fetchMenu('hm|n|Q04:1')],
  ['Q04-color-p3', () => fetchMenu('hm|n|Q04:3')],
  ['Q05-font-p1', () => fetchMenu('hm|n|Q05:1')],
  ['Q05-font-p2', () => fetchMenu('hm|n|Q05:2')],
  ['Q06-reply', () => fetchMenu('hm|n|Q06')],
  ['Q07-tags', () => fetchMenu('hm|n|Q07')],
  ['Q08-tag-input', () => fetchMenu('hm|n|Q08')],
  ['G01-games', () => fetchMenu('hm|n|G01')],
  ['G20-othello', () => fetchMenu('hm|n|G20')],
  ['G21-chess', () => fetchMenu('hm|n|G21')],
  ['R01-ranking', () => fetchMenu('hm|n|R01')],
  ['C01-settings', () => fetchMenu('hm|n|C01')],
  ['C02-birthday', () => fetchMenu('hm|n|C02')],
  ['C03-unsend', () => fetchMenu('hm|n|C03')],
  ['C04-welcome', () => fetchMenu('hm|n|C04')],
  ['C05-welcome-input', () => fetchMenu('hm|n|C05')],
  ['H01-guide', () => fetchMenu('hm|n|H01')],
  ['H03-commands-p1', () => fetchMenu('hm|n|H03:1')],
  ['H03-commands-p2', () => fetchMenu('hm|n|H03:2')],
  ['H03-commands-p3', () => fetchMenu('hm|n|H03:3')],
  ['H03-commands-p4', () => fetchMenu('hm|n|H03:4')],
  ['confirm-unsend', () => fetchMenu('hm|c|unsend_off')],
  ['confirm-welcome', () => fetchMenu('hm|c|welcome_on')],
  ['confirm-birthday-dm', () => fetchMenu('hm|c|birthday_off', { dm: true })],
  ['X02-not-allowed', () => fetchMenu('hm|x|オセロ開始')],
  ['X03-stale', () => fetchMenu('hm|n|ZZZ')],
  ['X04-error', () => fetchMenu('hm|c|unknown_op')],
  ['dm-main', () => fetchMenu('hm|n|M', { dm: true })],
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
