import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Production Vite resolves extensionless TS imports. Match that for Node's
// built-in type stripping without downloading a test framework or TS loader.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  GACHA_COST, getAppearance, getAppearanceByPublicIds, listOwnedCosmeticIds,
  createGachaConfirmation, cancelGacha, drawGacha, equipCosmetic,
} = await import('../../src/features/dressup/store.ts');
const { COSMETICS } = await import('../../src/features/dressup/catalog.ts');

const profileMigration = readFileSync(new URL('../../migrations/0015_personalization.sql', import.meta.url), 'utf8');
const dressupMigration = readFileSync(new URL('../../migrations/0024_dressup.sql', import.meta.url), 'utf8');

function fixture(points = 15000) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(profileMigration);
  db.exec(dressupMigration);
  db.prepare(`INSERT INTO user_profiles (user_id, public_id, points, total_exp) VALUES (?, ?, ?, 98765)`).run('alice', 'public-alice', points);
  db.prepare(`INSERT INTO user_profiles (user_id, public_id, points, total_exp) VALUES (?, ?, ?, 54321)`).run('bob', 'public-bob', 20000);
  const env = {
    DB: {
      prepare(sql) {
        let parameters = [];
        return {
          bind(...values) { parameters = values; return this; },
          async first(column) {
            const row = db.prepare(sql).get(...parameters);
            return row ? (column ? row[column] : { ...row }) : null;
          },
          async all() { return { results: db.prepare(sql).all(...parameters).map(row => ({ ...row })), success: true }; },
          async run() {
            const result = db.prepare(sql).run(...parameters);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
        };
      },
    },
  };
  return {
    db, env,
    balance: (user = 'alice') => db.prepare('SELECT points FROM user_profiles WHERE user_id = ?').get(user)?.points,
    inventory: (user = 'alice') => db.prepare('SELECT item_id FROM dressup_inventory WHERE user_id = ? ORDER BY item_id').all(user).map(row => row.item_id),
    ledger: () => db.prepare("SELECT * FROM point_ledger WHERE reason = 'dressup_gacha'").all(),
  };
}

function completeCollection(db, userId, except = []) {
  const insert = db.prepare('INSERT INTO dressup_inventory (user_id, item_id) VALUES (?, ?)');
  for (const item of COSMETICS) if (!except.includes(item.id)) insert.run(userId, item.id);
}

test('catalog SQL exactly matches 120 costumes + 30 backgrounds and two free defaults', () => {
  const { db } = fixture();
  const sqlIds = db.prepare('SELECT item_id FROM dressup_catalog WHERE is_default = 0 ORDER BY item_id').all().map(row => row.item_id);
  assert.equal(COSMETICS.length, 150);
  assert.deepEqual(sqlIds, COSMETICS.map(item => item.id).sort());
  assert.equal(db.prepare("SELECT count(*) AS n FROM dressup_catalog WHERE kind = 'costume' AND is_default = 0").get().n, 120);
  assert.equal(db.prepare("SELECT count(*) AS n FROM dressup_catalog WHERE kind = 'background' AND is_default = 0").get().n, 30);
  assert.deepEqual(db.prepare('SELECT item_id FROM dressup_catalog WHERE is_default = 1 ORDER BY item_id').all().map(row => row.item_id), ['BG000', 'C000']);
  db.close();
});

test('migration can run twice without changing existing profile EXP, points or themes', () => {
  const { db } = fixture();
  const before = db.prepare('SELECT * FROM user_profiles').all();
  db.exec(dressupMigration);
  assert.deepEqual(db.prepare('SELECT * FROM user_profiles').all(), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM dressup_catalog').get().n, 152);
  db.close();
});

test('defaults are free; merely opening confirmation changes no balance or inventory', async () => {
  const { db, env, balance, inventory, ledger } = fixture();
  assert.deepEqual(await getAppearance(env, 'alice'), { costumeId: 'C000', backgroundId: 'BG000' });
  assert.deepEqual(await listOwnedCosmeticIds(env, 'alice'), ['C000', 'BG000']);
  const confirmation = await createGachaConfirmation(env, 'alice');
  assert.match(confirmation.token, /^[\da-f-]{36}$/);
  assert.ok(confirmation.expiresAt > Math.floor(Date.now() / 1000));
  assert.ok(confirmation.expiresAt <= Math.floor(Date.now() / 1000) + 601);
  assert.equal(balance(), 15000);
  assert.deepEqual(inventory(), []);
  assert.deepEqual(ledger(), []);
  db.close();
});

test('draw atomically charges 3000, records a ledger row and grants one item without changing EXP', async () => {
  const { db, env, balance, inventory, ledger } = fixture();
  const { token } = await createGachaConfirmation(env, 'alice');
  const result = await drawGacha(env, 'alice', token);
  assert.equal(result.ok, true);
  assert.equal(result.spent, GACHA_COST);
  assert.equal(result.balance, 12000);
  assert.equal(balance(), 12000);
  assert.deepEqual(inventory(), [result.itemId]);
  assert.equal(ledger().length, 1);
  assert.equal(ledger()[0].delta, -3000);
  assert.equal(ledger()[0].reason_key, `dressup:${token}`);
  assert.equal(db.prepare('SELECT total_exp FROM user_profiles WHERE user_id = ?').get('alice').total_exp, 98765);
  assert.deepEqual(await getAppearance(env, 'alice'), { costumeId: 'C000', backgroundId: 'BG000' });
  db.close();
});

test('same-token replay, concurrent Yes clicks and subsequent No cannot charge twice', async () => {
  const { db, env, balance, inventory, ledger } = fixture();
  const { token } = await createGachaConfirmation(env, 'alice');
  const results = await Promise.all(Array.from({ length: 24 }, () => drawGacha(env, 'alice', token)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.reason === 'already_used'));
  assert.deepEqual(await drawGacha(env, 'alice', token), { ok: false, reason: 'already_used' });
  assert.deepEqual(await cancelGacha(env, 'alice', token), { ok: false, reason: 'already_used' });
  assert.equal(balance(), 12000);
  assert.equal(inventory().length, 1);
  assert.equal(ledger().length, 1);
  db.close();
});

test('different simultaneous tokens never overdraw a balance sufficient for only one draw', async () => {
  const { db, env, balance, inventory, ledger } = fixture(3000);
  const confirmations = await Promise.all(Array.from({ length: 8 }, () => createGachaConfirmation(env, 'alice')));
  const results = await Promise.all(confirmations.map(({ token }) => drawGacha(env, 'alice', token)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.reason === 'insufficient_points'));
  assert.equal(balance(), 0);
  assert.equal(inventory().length, 1);
  assert.equal(ledger().length, 1);
  db.close();
});

test('concurrent different tokens select distinct currently-unowned items, including final items', async () => {
  const { db, env, balance, inventory, ledger } = fixture(30000);
  completeCollection(db, 'alice', ['C001', 'BG030']);
  const confirmations = await Promise.all(Array.from({ length: 10 }, () => createGachaConfirmation(env, 'alice')));
  const results = await Promise.all(confirmations.map(({ token }) => drawGacha(env, 'alice', token)));
  const successes = results.filter(result => result.ok);
  assert.equal(successes.length, 2);
  assert.deepEqual(successes.map(result => result.itemId).sort(), ['BG030', 'C001']);
  assert.deepEqual(successes.map(result => result.balance).sort((a, b) => b - a), [27000, 24000]);
  assert.ok(results.filter(result => !result.ok).every(result => result.reason === 'collection_complete'));
  assert.equal(balance(), 24000);
  assert.equal(inventory().length, 150);
  assert.equal(ledger().length, 2);
  db.close();
});

test('No permanently cancels a token and competing Yes/No can never both succeed', async () => {
  const { db, env, balance, inventory } = fixture();
  const first = await createGachaConfirmation(env, 'alice');
  assert.deepEqual(await cancelGacha(env, 'alice', first.token), { ok: true });
  assert.deepEqual(await drawGacha(env, 'alice', first.token), { ok: false, reason: 'canceled' });
  assert.deepEqual(await cancelGacha(env, 'alice', first.token), { ok: false, reason: 'canceled' });
  const second = await createGachaConfirmation(env, 'alice');
  const [no, yes] = await Promise.all([cancelGacha(env, 'alice', second.token), drawGacha(env, 'alice', second.token)]);
  assert.deepEqual(no, { ok: true });
  assert.deepEqual(yes, { ok: false, reason: 'canceled' });
  assert.equal(balance(), 15000);
  assert.equal(inventory().length, 0);
  db.close();
});

test('other users cannot confirm or cancel another person’s token', async () => {
  const { db, env, balance } = fixture();
  const { token } = await createGachaConfirmation(env, 'alice');
  assert.deepEqual(await drawGacha(env, 'bob', token), { ok: false, reason: 'not_owner' });
  assert.deepEqual(await cancelGacha(env, 'bob', token), { ok: false, reason: 'not_owner' });
  assert.equal((await drawGacha(env, 'alice', token)).ok, true);
  assert.equal(balance('bob'), 20000);
  db.close();
});

test('expired, missing, malformed and unknown confirmations cannot debit', async () => {
  const { db, env, balance, ledger } = fixture();
  const expiredToken = crypto.randomUUID();
  db.prepare("INSERT INTO dressup_confirmations (token, user_id, expires_at) VALUES (?, 'alice', unixepoch() - 1)").run(expiredToken);
  assert.deepEqual(await drawGacha(env, 'alice', expiredToken), { ok: false, reason: 'expired' });
  for (const token of ['', 'x', "' OR 1=1 --", crypto.randomUUID(), '../secret', null]) {
    assert.deepEqual(await drawGacha(env, 'alice', token), { ok: false, reason: 'invalid_confirmation' });
    assert.deepEqual(await cancelGacha(env, 'alice', token), { ok: false, reason: 'invalid_confirmation' });
  }
  await assert.rejects(() => createGachaConfirmation(env, 'missing-user'), /unknown_user/);
  assert.equal(balance(), 15000);
  assert.equal(ledger().length, 0);
  db.close();
});

test('insufficient points and a completed collection never consume points or award defaults', async () => {
  const { db, env, balance, ledger } = fixture(2999);
  const { token } = await createGachaConfirmation(env, 'alice');
  assert.deepEqual(await drawGacha(env, 'alice', token), { ok: false, reason: 'insufficient_points' });
  completeCollection(db, 'alice');
  assert.deepEqual(await drawGacha(env, 'alice', token), { ok: false, reason: 'collection_complete' });
  assert.equal(balance(), 2999);
  assert.equal(ledger().length, 0);
  assert.equal((await listOwnedCosmeticIds(env, 'alice')).length, 152);
  db.close();
});

test('ledger or inventory failures roll back debit, inventory and token consumption together', async () => {
  for (const fault of ['ledger', 'inventory']) {
    const { db, env, balance, inventory } = fixture();
    const { token } = await createGachaConfirmation(env, 'alice');
    if (fault === 'ledger') {
      db.prepare("INSERT INTO point_ledger (user_id, delta, reason, reason_key) VALUES ('alice', 0, 'fault', ?)").run(`dressup:${token}`);
    } else {
      db.exec("CREATE TRIGGER fault BEFORE INSERT ON dressup_inventory BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    }
    await assert.rejects(() => drawGacha(env, 'alice', token));
    assert.equal(balance(), 15000);
    assert.equal(inventory().length, 0);
    assert.deepEqual({ ...db.prepare('SELECT state, item_id, balance_after FROM dressup_confirmations WHERE token = ?').get(token) }, {
      state: 'pending', item_id: null, balance_after: null,
    });
    db.close();
  }
});

test('confirmation ownership, expiry and terminal states are immutable even through direct SQL', async () => {
  const { db, env } = fixture();
  const { token } = await createGachaConfirmation(env, 'alice');
  assert.throws(() => db.prepare("UPDATE dressup_confirmations SET user_id = 'bob' WHERE token = ?").run(token), /dressup_invalid_transition/);
  assert.throws(() => db.prepare('UPDATE dressup_confirmations SET expires_at = expires_at + 100 WHERE token = ?').run(token), /dressup_invalid_transition/);
  await cancelGacha(env, 'alice', token);
  assert.throws(() => db.prepare("UPDATE dressup_confirmations SET state = 'pending' WHERE token = ?").run(token), /dressup_invalid_transition/);
  db.close();
});

test('only owned cosmetics and defaults can be equipped; changing one slot retains the other', async () => {
  const { db, env, balance } = fixture();
  db.prepare("INSERT INTO dressup_inventory (user_id, item_id) VALUES ('alice', 'C001'), ('alice', 'BG001')").run();
  assert.deepEqual(await equipCosmetic(env, 'alice', 'C002'), { ok: false, reason: 'not_owned' });
  for (const id of ['', 'C999', 'BG999', 'C1', 'c001', '../C001', "C001'--", '__proto__', null]) {
    assert.deepEqual(await equipCosmetic(env, 'alice', id), { ok: false, reason: 'invalid_item' });
  }
  assert.deepEqual(await equipCosmetic(env, 'missing-user', 'C000'), { ok: false, reason: 'unknown_user' });
  assert.deepEqual(await equipCosmetic(env, 'bob', 'C001'), { ok: false, reason: 'not_owned' });
  const results = await Promise.all([equipCosmetic(env, 'alice', 'C001'), equipCosmetic(env, 'alice', 'BG001')]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual(await getAppearance(env, 'alice'), { costumeId: 'C001', backgroundId: 'BG001' });
  assert.deepEqual(await equipCosmetic(env, 'alice', 'C000'), { ok: true });
  assert.deepEqual(await getAppearance(env, 'alice'), { costumeId: 'C000', backgroundId: 'BG001' });
  assert.deepEqual(await equipCosmetic(env, 'alice', 'BG000'), { ok: true });
  assert.deepEqual(await getAppearance(env, 'alice'), { costumeId: 'C000', backgroundId: 'BG000' });
  assert.equal(balance(), 15000);
  db.close();
});

test('public-ID appearance batches use defaults, avoid raw user IDs and handle large lists', async () => {
  const { db, env } = fixture();
  db.prepare("INSERT INTO dressup_inventory (user_id, item_id) VALUES ('alice', 'C120')").run();
  await equipCosmetic(env, 'alice', 'C120');
  const ids = ['public-alice', 'public-bob', 'public-alice', 'missing', '__proto__', ...Array.from({ length: 120 }, (_, i) => `absent-${i}`)];
  const appearances = await getAppearanceByPublicIds(env, ids);
  assert.deepEqual(appearances['public-alice'], { costumeId: 'C120', backgroundId: 'BG000' });
  assert.deepEqual(appearances['public-bob'], { costumeId: 'C000', backgroundId: 'BG000' });
  assert.deepEqual(appearances.missing, { costumeId: 'C000', backgroundId: 'BG000' });
  assert.deepEqual(appearances.__proto__, { costumeId: 'C000', backgroundId: 'BG000' });
  assert.equal(Object.hasOwn(appearances, 'alice'), false);
  assert.equal(Object.keys(appearances).length, new Set(ids).size);
  assert.deepEqual(Object.keys(await getAppearanceByPublicIds(env, [])), []);
  db.close();
});
