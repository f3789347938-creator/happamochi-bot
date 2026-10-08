import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

export const USER = `U${'a'.repeat(32)}`
export const OTHER = `U${'b'.repeat(32)}`
export async function loadBackend() {
  const built = await build({
    stdin: { contents: `export * from './src/features/casino/store.ts'; export * from './src/features/casino/routes.ts'; export { Hono } from 'hono';`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
}

export function fixture(t, balance = 5000) {
  const sql = new DatabaseSync(':memory:')
  t.after(() => sql.close())
  for (const name of ['0015_personalization.sql', '0030_casino.sql']) {
    sql.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'))
  }
  sql.prepare('INSERT INTO user_profiles (user_id, public_id, points) VALUES (?, ?, ?)').run(USER, 'casino-user-a', balance)
  sql.prepare('INSERT INTO user_profiles (user_id, public_id, points) VALUES (?, ?, ?)').run(OTHER, 'casino-user-b', balance)
  const prepare = (query, args = []) => {
    const execute = () => {
      const statement = sql.prepare(query)
      if (statement.columns().length) return { success: true, results: statement.all(...args).map(row => ({ ...row })), meta: {} }
      const result = statement.run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return {
      bind: (...values) => prepare(query, values), execute,
      async first(column) { const row = sql.prepare(query).get(...args); return row ? column ? row[column] : { ...row } : null },
      async all() { return { success: true, results: sql.prepare(query).all(...args).map(row => ({ ...row })), meta: {} } },
      async run() { return execute() },
    }
  }
  const DB = { prepare, async batch(statements) {
    sql.exec('BEGIN')
    try { const results = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return results }
    catch (error) { sql.exec('ROLLBACK'); throw error }
  } }
  return { sql, DB, env: { DB, LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    CASINO_ENABLED: 'true', CASINO_LIFF_ID: '2011492233-casino' } }
}

export const fullDeck = (...first) => [...first, ...['S', 'H', 'D', 'C'].flatMap(suit =>
  ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map(rank => rank + suit)).filter(card => !first.includes(card))]

// A trusted engine transition goes through the actual production SQL trigger.
export function insertTransition(sql, { state, delta }, { userId = USER, cost = state.spent,
  expectedVersion = 0, requestId = 'seed-request-0001' } = {}) {
  sql.prepare(`INSERT INTO casino_receipts
    (user_id, request_id, payload, round_id, expected_version, mode, stake, version,
    finished, state_json, spent, payout, net, result, cost, delta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, requestId, '{}', state.id, expectedVersion, state.mode, state.stake,
      state.version, state.finished ? 1 : 0, JSON.stringify(state), state.spent, state.payout,
      state.net, state.result || '', cost, delta)
}
