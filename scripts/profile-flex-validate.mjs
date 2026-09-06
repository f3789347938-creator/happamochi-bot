// 個人ステータス関連のFlexを LINE公式の検証APIに投げて、実際にLINEが
// 受け付けるかを確認する。
//
// なぜ必要か:
//   実機で「チェス」が無反応だった原因は image に存在しない `width` を
//   指定していたことで、LINEが 400 を返していたため。バイト数だけの確認では
//   気づけなかった。ローカルで組めてもLINE側の受理は別問題なので、
//   新しいカードも必ず公式APIで確かめる。
//
//   POST https://api.line.me/v2/bot/message/validate/reply （送信はされない）
//
// 実行: node scripts/profile-flex-validate.mjs
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'samples', 'profile-flex')

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

// 実装ファイルをそのまま読み込む（写しではなく本物を検証する）
const bundle = await build({
  entryPoints: [path.join(ROOT, 'src/features/profile/flex.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
})
const tmp = path.join(ROOT, 'scripts', '.flex-bundle.mjs')
fs.writeFileSync(tmp, bundle.outputFiles[0].text)
const flex = await import(`file://${tmp}`)
fs.unlinkSync(tmp)

const AQUA = {
  id: 'aqua', name: '水色', price: 0,
  header_bg: '#009FDE', body_bg: '#E4F7FF', text_color: '#17364C',
  accent: '#16BCEC', header_text: '#FFFFFF', sort_order: 1,
}
const BLACK = {
  id: 'black', name: 'ブラック', price: 500,
  header_bg: '#17212B', body_bg: '#202C37', text_color: '#F5F9FD',
  accent: '#7DD3FC', header_text: '#F5F9FD', sort_order: 3,
}
const profile = (over = {}) => ({
  user_id: 'Uxxxx', public_id: 'pub1234567890', display_name: 'はる',
  picture_url: 'https://example.com/a.png', total_exp: 2000, points: 3599,
  active_theme: 'aqua', equipped_title: 'free_daily_001', ...over,
})
const lv = { level: 19, expInLevel: 188, expNeeded: 244, percent: 77.0 }
const title = (over = {}) => ({
  id: 'free_daily_001', name: '夜型', category_id: 'daily', description: 'よふかし',
  unlock_type: 'free', unlock_level: null, unlock_othello_wins: null, name_norm: '夜型', ...over,
})

const samples = []
const add = (name, msg) => samples.push({ name, msg })

// ステータスカード
add('status-normal', flex.buildStatusCard({ profile: profile(), level: lv, theme: AQUA, rank: 2320, titleName: '夜型', fortune: '中吉' }))
add('status-no-title-no-rank-0exp', flex.buildStatusCard({
  profile: profile({ picture_url: null, display_name: null, total_exp: 0, points: 0, equipped_title: null }),
  level: { level: 1, expInLevel: 0, expNeeded: 100, percent: 0 },
  theme: AQUA, rank: null, titleName: null, fortune: '大吉',
}))
add('status-black-theme', flex.buildStatusCard({ profile: profile({ active_theme: 'black' }), level: lv, theme: BLACK, rank: 2, titleName: '夜型', fortune: '末吉' }))
add('status-no-fortune', flex.buildStatusCard({ profile: profile(), level: lv, theme: AQUA, rank: 1, titleName: '夜型', fortune: null }))
add('status-preview', flex.buildStatusCard({
  profile: profile(), level: lv, theme: BLACK, rank: 5, titleName: '夜型', fortune: '吉',
  preview: { themeName: 'ブラック', applyData: 'pf|buy|black', backData: 'pf|themes' },
}))
add('status-note', flex.buildStatusCard({ profile: profile(), level: lv, theme: AQUA, rank: 9999999, titleName: '長い称号名'.repeat(4), fortune: '小吉', note: '押した方自身のステータスを表示しています。' }))

// 着せ替え
add('themes', flex.buildThemeCard({
  profile: profile(), theme: AQUA, ui: AQUA, level: lv,
  themes: [AQUA, { ...AQUA, id: 'white', name: 'ホワイト', price: 300 }, BLACK, { ...AQUA, id: 'sakura', name: 'さくらピンク', price: 700 }],
  ownedIds: new Set(['aqua', 'white']),
}))
add('purchase-confirm', flex.buildPurchaseConfirm({ theme: BLACK, ui: AQUA, points: 1200, confirmData: 'pf|buyok|black', backData: 'pf|themes' }))

// 共通称号
const mk = (i) => ({ title: title({ id: `t${i}`, name: `称号${i}` }), available: i % 2 === 0, reason: i % 2 === 0 ? null : 'Lv.30で解放' })
add('titles-list', flex.buildTitleListCard({
  ui: AQUA, filter: 'all', categoryId: null, query: null, page: 1, totalPages: 12,
  rows: [1, 2, 3, 4, 5].map(mk), equippedId: 't2',
  equipData: (id) => `pf|equipp|${id}|all|-|-|1`, navData: (p) => `pf|tl|all|-|-|${p}`,
  backData: 'pf|status', categoryData: 'pf|cat|all|-|1', searchData: 'pf|searchhelp',
  filterData: (f) => `pf|tl|${f}|-|-|1`,
}))
add('titles-empty', flex.buildTitleListCard({
  ui: AQUA, filter: 'locked', categoryId: null, query: 'zzzz', page: 1, totalPages: 0,
  rows: [], equippedId: null,
  equipData: (id) => `pf|equipp|${id}|locked|-|zzzz|1`, navData: (p) => `pf|tl|locked|-|zzzz|${p}`,
  backData: 'pf|status', categoryData: 'pf|cat|locked|zzzz|1', searchData: 'pf|searchhelp',
  filterData: (f) => `pf|tl|${f}|-|zzzz|1`,
}))
add('categories', flex.buildCategoryCard({
  ui: AQUA, page: 1, totalPages: 2,
  rows: [
    { id: 'daily', name: '暮らし・時間', total: 20, usable: 20 },
    { id: 'growth', name: '成長', total: 20, usable: 3 },
  ],
  selectData: (id) => `pf|tl|all|${id}|-|1`, navData: (p) => `pf|cat|all|-|${p}`, backData: 'pf|titles',
}))

fs.mkdirSync(OUT, { recursive: true })
for (const s of samples) {
  fs.writeFileSync(path.join(OUT, `${s.name}.json`), JSON.stringify(s.msg, null, 2))
}

// サイズ確認（Flexは30,000バイト上限）
let maxBytes = 0
for (const s of samples) {
  const b = Buffer.byteLength(JSON.stringify(s.msg.contents ?? s.msg), 'utf8')
  maxBytes = Math.max(maxBytes, b)
  if (b > 30000) console.log(`  ❌ ${s.name}: ${b} バイト（30,000超）`)
}
console.log(`サンプル ${samples.length} 件を ${path.relative(ROOT, OUT)} に出力（最大 ${maxBytes} バイト）`)

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
