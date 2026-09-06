// samples/chess-flex/*.json を LINE公式の検証APIに投げて、
// 実際にLINEが受け付けるかどうかを確認する。
//
// なぜ必要か:
//   バイト数の検証だけでは不十分だった。実機で「チェス」が無反応だった原因は
//   image コンポーネントに存在しない `width` を指定していたことで、
//   LINEが 400 (unknown field /header/contents/0/width) を返していたため。
//   ローカルではJSONを組み立てられてもLINE側の受理は別問題なので、
//   公式の検証APIで必ず確かめる。
//
// 使うAPI（メッセージは送信されない。検証のみ）:
//   POST https://api.line.me/v2/bot/message/validate/reply
//
// 実行:
//   node scripts/chess-flex-validate.mjs
//   (LINE_CHANNEL_ACCESS_TOKEN は .dev.vars から自動で読む)
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, 'samples', 'chess-flex')

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

const token = loadToken()
if (!token) {
  console.error(
    'LINE_CHANNEL_ACCESS_TOKEN が見つかりません。\n' +
      '.dev.vars に設定するか、環境変数で渡してください。'
  )
  process.exit(2)
}

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()

if (files.length === 0) {
  console.error(`${DIR} にJSONがありません。先に scripts/chess-flex-samples.mjs を実行してください。`)
  process.exit(2)
}

let fail = 0
console.log(`\nLINE検証API (validate/reply) で ${files.length} 件を検査します\n`)

for (const f of files) {
  const message = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages: [message] }),
  })
  const bodyText = await res.text().catch(() => '')

  if (res.status === 200) {
    console.log(`  ✅ ${f}`)
  } else {
    fail++
    console.log(`  ❌ ${f}  HTTP ${res.status}`)
    try {
      const j = JSON.parse(bodyText)
      console.log(`     ${j.message ?? ''}`)
      for (const d of j.details ?? []) {
        console.log(`     → ${d.property}: ${d.message}`)
      }
    } catch {
      console.log(`     ${bodyText.slice(0, 400)}`)
    }
  }
  // 検証APIにも流量制限があるため、少し間隔を空ける
  await new Promise((r) => setTimeout(r, 300))
}

console.log(
  fail === 0
    ? `\n  ${files.length}件すべてLINEに受理されました\n`
    : `\n  ${fail}件がLINEに拒否されました（このままでは実機で表示されません）\n`
)
process.exit(fail === 0 ? 0 : 1)
