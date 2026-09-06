// 称号カタログ(title-catalog.json)から、共通称号のシードSQLを生成する。
//
// 重要:
//   ・既存の title_master / user_titles(グループ別称号)には一切触らない。
//     生成先は common_title_master / common_title_category だけ。
//   ・INSERT OR IGNORE なので再実行しても重複しない(再取り込みで
//     件数が増えないことを保証する)。
//   ・名前が既存称号と同じでも自動統合しない。指示どおり別管理のまま。
//
// 実行:
//   node scripts/gen-title-seed.mjs <title-catalog.json>
//   → migrations/0016_common_titles_seed.sql を出力
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const src = process.argv[2] ?? '/tmp/pv9/title-catalog.json'
const catalog = JSON.parse(fs.readFileSync(src, 'utf8'))

/** 検索・重複判定用の正規化。表示名は書き換えない。 */
function normalize(s) {
  return s.normalize('NFKC').toLowerCase().trim()
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const lines = [
  '-- 共通称号カタログ(300種類)のシード。scripts/gen-title-seed.mjs が生成。',
  '--',
  '-- 既存の title_master(グループ別称号)には一切触らない。こちらは',
  '-- common_title_master として完全に別管理する。名前が同じ称号があっても',
  '-- 自動統合しない(指示どおり)。',
  '--',
  '-- INSERT OR IGNORE なので、再実行しても件数は増えない。',
  '',
]

// --- カテゴリ ---
lines.push('INSERT OR IGNORE INTO common_title_category (id, name, kind, display_order) VALUES')
const catRows = catalog.categories.map(
  (c) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.kind)}, ${c.display_order})`
)
lines.push(catRows.join(',\n') + ';')
lines.push('')

// --- 称号 ---
// 1文あたりの行数を抑えるため 50件ずつに分割する(D1の1文の長さ制限対策)。
const titles = catalog.titles
const seenId = new Set()
const seenNorm = new Map()
const rows = []
for (const t of titles) {
  if (seenId.has(t.id)) throw new Error(`ID重複: ${t.id}`)
  seenId.add(t.id)
  const norm = normalize(t.name)
  if (seenNorm.has(norm)) {
    throw new Error(`正規化名の重複: ${t.name} (${t.id}) と ${seenNorm.get(norm)}`)
  }
  seenNorm.set(norm, t.id)

  const u = t.unlock ?? { type: 'free' }
  const type = u.type
  let value = 'NULL'
  if (type === 'level') value = String(u.min_level)
  else if (type === 'othello_wins') value = String(u.min_wins)

  rows.push(
    `  (${q(t.id)}, ${q(t.category)}, ${q(t.name)}, ${q(norm)}, ${t.display_order}, ` +
      `${q(type)}, ${value}, ${q(t.unlock_label)}, ${q(t.unlock_rule_status)})`
  )
}

const CHUNK = 50
for (let i = 0; i < rows.length; i += CHUNK) {
  lines.push(
    'INSERT OR IGNORE INTO common_title_master\n' +
      '  (id, category, name, name_norm, display_order, unlock_type, unlock_value, unlock_label, rule_status)\n' +
      'VALUES'
  )
  lines.push(rows.slice(i, i + CHUNK).join(',\n') + ';')
  lines.push('')
}

const out = path.join(ROOT, 'migrations', '0016_common_titles_seed.sql')
fs.writeFileSync(out, lines.join('\n'))

// --- 検証 ---
const byCat = {}
for (const t of titles) byCat[t.category] = (byCat[t.category] ?? 0) + 1
const free = titles.filter((t) => t.unlock?.type === 'free' || t.acquisition === 'free').length
const lvl = titles.filter((t) => t.unlock?.type === 'level').length
const oth = titles.filter((t) => t.unlock?.type === 'othello_wins').length

console.log(`\n  称号 ${titles.length}件 / カテゴリ ${catalog.categories.length}件`)
console.log(`  ID一意: ${seenId.size === titles.length ? 'OK' : 'NG'}`)
console.log(`  正規化名一意: ${seenNorm.size === titles.length ? 'OK' : 'NG'}`)
console.log(`  自由選択 ${free} / レベル解放 ${lvl} / オセロ実績 ${oth}`)
console.log(`  カテゴリ別件数:`)
for (const c of catalog.categories) {
  const n = byCat[c.id] ?? 0
  const ok = n === c.count ? '✅' : '❌'
  console.log(`    ${ok} ${c.name.padEnd(10, '　')} ${n} (定義 ${c.count})`)
}
console.log(`\n  出力: migrations/0016_common_titles_seed.sql (${(fs.statSync(out).size / 1024).toFixed(0)} KB)\n`)
