// SQL-boundary regression: execute individual prepared statements as D1 does,
// including Wrangler's appended migration-history statement. No remote access.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { unstable_splitSqlQuery } from 'wrangler'

const source = readFileSync(new URL('../../migrations/0024_dressup.sql', import.meta.url), 'utf8')
const profileSource = readFileSync(new URL('../../migrations/0015_personalization.sql', import.meta.url), 'utf8')
const historyStatement = "INSERT INTO d1_migrations (name) VALUES ('0024_dressup.sql');"

test('remote-compatible triggers contain only their final END and retain all five conditional guards', () => {
  const statements = unstable_splitSqlQuery(source)
  assert.equal(statements.length, 11)
  const triggers = statements.filter((sql) => /^CREATE TRIGGER /i.test(sql))
  assert.equal(triggers.length, 3)
  for (const trigger of triggers) {
    assert.doesNotMatch(trigger, /\bCASE\b/i, 'avoid nested CASE/END in remote SQL parsing')
    assert.equal((trigger.match(/\bEND\b/gi) ?? []).length, 1)
    assert.match(trigger, /\bEND\s*$/i)
  }
  assert.equal((triggers.join('\n').match(/SELECT RAISE\(ABORT, '[^']+'\)\s+WHERE/g) ?? []).length, 5)
})

test('migration plus bookkeeping execute as separate prepared statements without changing existing profiles', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(profileSource)
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)')
    db.prepare("INSERT INTO user_profiles (user_id, public_id, points, total_exp) VALUES ('alice', 'public-alice', 15000, 98765)").run()
    const before = db.prepare('SELECT * FROM user_profiles').all()
    const statements = unstable_splitSqlQuery(`${source}\n${historyStatement}`)
    assert.equal(statements.length, 12)
    db.exec('BEGIN')
    for (const statement of statements) db.prepare(statement).run()
    db.exec('COMMIT')
    assert.deepEqual(db.prepare('SELECT * FROM user_profiles').all(), before)
    assert.equal(db.prepare('SELECT count(*) n FROM dressup_catalog').get().n, 152)
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'dressup_%'").get().n, 3)
    assert.equal(db.prepare('SELECT name FROM d1_migrations').get().name, '0024_dressup.sql')
  } finally {
    db.close()
  }
})
