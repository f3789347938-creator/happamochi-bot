import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ReadStore } from '../read-store.mjs';

const CHAT = 'C0123456789abcdef0123456789abcdef';
const OTHER_CHAT = 'Cabcdef0123456789abcdef0123456789';
const OWNER = 'Uowner';
const OTHER_OWNER = 'Uother';
const NOW = 1_789_835_500_000;
const DAY = 86_400_000;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../read-schema.sql', import.meta.url), 'utf8'));
  const result = (sql, args) => {
    const statement = sqlite.prepare(sql);
    if (statement.columns().length) return { results: statement.all(...args).map(row => ({ ...row })), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(statement.run(...args).changes) } };
  };
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { const row = sqlite.prepare(sql).get(...args); return row ? { ...row } : null; },
        async all() { return result(sql, args); },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        execute() { return result(sql, args); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, store: new ReadStore(db) };
}

function command(eventId, action = 'list', userId = OWNER, eventAt = NOW) {
  return { chatId: CHAT, eventId, userId, action, eventAt, ...(action === 'start' ? { checkpointAt: eventAt } : {}) };
}

function getCommand(sqlite, eventId) {
  return sqlite.prepare('SELECT * FROM oa_read_commands WHERE chat_id=? AND event_id=?').get(CHAT, eventId);
}

test('sessions reset and stop only the requesting owner, expire exactly after 24 hours', async () => {
  const { store } = fixture();
  const first = await store.startSession(CHAT, OWNER, NOW - 10, NOW);
  await store.startSession(CHAT, OTHER_OWNER, NOW - 20, NOW);
  await store.startSession(OTHER_CHAT, OWNER, NOW - 30, NOW);
  assert.equal(first.expires_at, NOW + DAY);
  await store.startSession(CHAT, OWNER, NOW + 100, NOW + 100);
  assert.equal((await store.getSession(CHAT, OWNER, NOW + 100)).checkpoint_at, NOW + 100);
  assert.equal((await store.getSession(CHAT, OTHER_OWNER, NOW + 100)).checkpoint_at, NOW - 20);
  assert.equal(await store.stopSession(CHAT, OWNER), true);
  assert.equal(await store.getSession(CHAT, OWNER, NOW + 100), null);
  assert.ok(await store.getSession(OTHER_CHAT, OWNER, NOW + 100));
  assert.ok(await store.getSession(CHAT, OTHER_OWNER, NOW + DAY - 1));
  assert.equal(await store.getSession(CHAT, OTHER_OWNER, NOW + DAY), null);
});

test('receipt collection requires an active session in the same chat', async () => {
  const { store, sqlite } = fixture();
  assert.equal(await store.recordReceipt(CHAT, 'Ureader', NOW, NOW, NOW), false);
  await store.startSession(OTHER_CHAT, OWNER, NOW, NOW);
  assert.equal(await store.recordReceipt(CHAT, 'Ureader', NOW, NOW, NOW), false);
  await store.startSession(CHAT, OWNER, NOW, NOW);
  assert.equal(await store.recordReceipt(CHAT, 'Ureader', NOW, NOW, NOW), true);
  assert.equal(await store.recordReceipt(CHAT, 'Unot-stored', NOW + DAY, NOW + DAY, NOW + DAY), false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM oa_read_receipts').get().count, 1);
});

test('out-of-order receipt updates independently retain both maximum timestamps', async () => {
  const { store } = fixture();
  await store.startSession(CHAT, OWNER, NOW, NOW);
  await store.recordReceipt(CHAT, 'Ureader', NOW + 30, NOW + 10, NOW + 100);
  await store.recordReceipt(CHAT, 'Ureader', NOW + 20, NOW + 40, NOW + 100);
  await store.recordReceipt(CHAT, 'Ureader', NOW + 5, NOW + 5, NOW + 100);
  assert.deepEqual(await store.listReceipts(CHAT, OWNER, NOW + 100), [
    { user_id: 'Ureader', watermark: NOW + 30, event_at: NOW + 40 },
  ]);
});

test('owner lists use their own inclusive checkpoint and never leak another chat or expired session', async () => {
  const { store } = fixture();
  await store.startSession(CHAT, OWNER, NOW, NOW);
  await store.startSession(CHAT, OTHER_OWNER, NOW + 20, NOW + 20);
  await store.startSession(OTHER_CHAT, OWNER, NOW, NOW);
  await store.recordReceipt(CHAT, 'Uboundary', NOW, NOW, NOW + 30);
  await store.recordReceipt(CHAT, 'Ulater', NOW + 20, NOW + 30, NOW + 30);
  await store.recordReceipt(CHAT, 'Uearlier', NOW - 1, NOW + 30, NOW + 30);
  await store.recordReceipt(OTHER_CHAT, 'Uforeign', NOW + 30, NOW + 30, NOW + 30);
  assert.deepEqual((await store.listReceipts(CHAT, OWNER, NOW + 30)).map(row => row.user_id), ['Ulater', 'Uboundary']);
  assert.deepEqual((await store.listReceipts(CHAT, OTHER_OWNER, NOW + 30)).map(row => row.user_id), ['Ulater']);
  assert.deepEqual(await store.listReceipts(CHAT, 'Uno-session', NOW + 30), []);
  assert.deepEqual(await store.listReceipts(CHAT, OWNER, NOW + DAY), []);
});

test('racing duplicate start commands produce one claim and cannot reset a later checkpoint', async () => {
  const { store, sqlite } = fixture();
  const claims = await Promise.all([store.claimCommand(command('start-1', 'start'), NOW), store.claimCommand(command('start-1', 'start'), NOW)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const row = claims.find(Boolean);
  assert.equal(row.status, 'processing');
  assert.match(row.send_id, /^[0-9a-f-]{36}$/);
  await store.claimCommand(command('start-2', 'start', OWNER, NOW + 50), NOW + 50);
  assert.equal(await store.claimCommand(command('start-1', 'start'), NOW + 100), null);
  assert.equal((await store.getSession(CHAT, OWNER, NOW + 100)).checkpoint_at, NOW + 50);
  assert.equal(getCommand(sqlite, 'start-1').send_id, row.send_id);
});

test('a duplicate stop cannot delete a later start or another owner session', async () => {
  const { store } = fixture();
  await store.startSession(CHAT, OWNER, NOW, NOW);
  await store.startSession(CHAT, OTHER_OWNER, NOW, NOW);
  assert.ok(await store.claimCommand(command('stop-1', 'stop'), NOW));
  assert.equal(await store.getSession(CHAT, OWNER, NOW), null);
  assert.ok(await store.getSession(CHAT, OTHER_OWNER, NOW));
  await store.claimCommand(command('start-after-stop', 'start', OWNER, NOW + 10), NOW + 10);
  assert.equal(await store.claimCommand(command('stop-1', 'stop'), NOW + 20), null);
  assert.ok(await store.getSession(CHAT, OWNER, NOW + 20));
});

test('session failure rolls back the command claim so retry can apply both atomically', async () => {
  const { store, sqlite } = fixture();
  sqlite.exec("CREATE TRIGGER fail_session BEFORE INSERT ON oa_read_sessions BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await assert.rejects(store.claimCommand(command('atomic-start', 'start'), NOW), /injected failure/);
  assert.equal(getCommand(sqlite, 'atomic-start'), undefined);
  sqlite.exec('DROP TRIGGER fail_session');
  assert.ok(await store.claimCommand(command('atomic-start', 'start'), NOW));
  assert.ok(await store.getSession(CHAT, OWNER, NOW));
});

test('sending is an atomic one-time claim and timeout cannot be blindly retried', async () => {
  const { store, sqlite } = fixture();
  const row = await store.claimCommand(command('send-once'), NOW);
  const claims = await Promise.all([store.markSending(row, 'reply', NOW), store.markSending(row, 'reply', NOW)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(getCommand(sqlite, 'send-once').attempts, 1);
  assert.equal(await store.finishCommand(row, 'uncertain', 'request_timeout', NOW + 10), true);
  assert.equal(await store.markSending(row, 'reply', NOW + 20), false);
  assert.equal(await store.claimCommand(command('send-once'), NOW + 20), null);
});

test('matching sendId acknowledgement is scoped and sent cannot regress after a late error', async () => {
  const { store, sqlite } = fixture();
  const row = await store.claimCommand(command('ack-first'), NOW);
  await store.markSending(row, 'reply', NOW);
  assert.equal(await store.acknowledge(OTHER_CHAT, row.send_id, NOW + 10), false);
  assert.equal(await store.acknowledge(CHAT, 'not-the-send-id', NOW + 10), false);
  assert.equal(await store.acknowledge(CHAT, row.send_id, NOW + 10), true);
  assert.equal(await store.finishCommand(row, 'uncertain', 'request_timeout', NOW + 20), false);
  assert.equal(await store.finishCommand(row, 'failed', 'line_http_500', NOW + 30), false);
  assert.equal(await store.finishCommand(row, 'sent', null, NOW + 40), false);
  const saved = getCommand(sqlite, 'ack-first');
  assert.equal(saved.status, 'sent');
  assert.equal(saved.sent_at, NOW + 10);
  assert.equal(saved.error_code, null);
});

test('interrupted processing and sending are quarantined while new work and sent rows remain intact', async () => {
  const { store, sqlite } = fixture();
  await store.claimCommand(command('processing'), NOW);
  const sending = await store.claimCommand(command('sending'), NOW);
  await store.markSending(sending, 'reply', NOW);
  const sent = await store.claimCommand(command('sent'), NOW);
  await store.markSending(sent, 'reply', NOW);
  await store.finishCommand(sent, 'sent', null, NOW);
  await store.claimCommand(command('fresh', 'list', OWNER, NOW + 120_001), NOW + 120_001);
  assert.equal(await store.quarantineInterrupted(NOW + 120_001), 2);
  for (const eventId of ['processing', 'sending']) assert.equal(getCommand(sqlite, eventId).status, 'uncertain');
  assert.equal(getCommand(sqlite, 'fresh').status, 'processing');
  assert.equal(getCommand(sqlite, 'sent').status, 'sent');
});

test('cleanup protects receipts needed by either owner and removes them after the last eligible session ends', async () => {
  const { store, sqlite } = fixture();
  await store.startSession(CHAT, OWNER, NOW - 100, NOW);
  await store.startSession(CHAT, OTHER_OWNER, NOW + 10, NOW + 10);
  await store.recordReceipt(CHAT, 'Uold-needed', NOW, NOW, NOW + 30);
  await store.recordReceipt(CHAT, 'Uboth-needed', NOW + 20, NOW + 20, NOW + 30);
  await store.recordReceipt(CHAT, 'Uunneeded', NOW - 101, NOW + 20, NOW + 30);
  assert.equal((await store.cleanup(NOW + 30)).receiptsDeleted, 1);
  await store.stopSession(CHAT, OWNER);
  assert.equal((await store.cleanup(NOW + 40)).receiptsDeleted, 1);
  assert.deepEqual((await store.listReceipts(CHAT, OTHER_OWNER, NOW + 40)).map(row => row.user_id), ['Uboth-needed']);
  assert.deepEqual(await store.cleanup(NOW + DAY + 10), { sessionsDeleted: 1, receiptsDeleted: 1, commandsDeleted: 0 });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM oa_read_receipts').get().count, 0);
});

test('seven-day command cleanup cannot make an old SSE event executable again', async () => {
  const { store, sqlite } = fixture();
  const original = command('retained', 'start');
  await store.claimCommand(original, NOW);
  assert.equal((await store.cleanup(NOW + 7 * DAY - 1)).commandsDeleted, 0);
  assert.ok(getCommand(sqlite, 'retained'));
  assert.equal((await store.cleanup(NOW + 7 * DAY)).commandsDeleted, 1);
  assert.equal(await store.claimCommand(original, NOW + 7 * DAY), null);
  assert.equal(getCommand(sqlite, 'retained'), undefined);
});

test('invalid and excessively future timestamps cannot create persistent read evidence', async () => {
  const { store, sqlite } = fixture();
  await store.startSession(CHAT, OWNER, NOW, NOW);
  for (const value of [null, '1789835500000', 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, NOW + 300_001]) {
    await assert.rejects(store.recordReceipt(CHAT, 'Uinvalid', value, NOW, NOW));
    await assert.rejects(store.recordReceipt(CHAT, 'Uinvalid', NOW, value, NOW));
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM oa_read_receipts').get().count, 0);
});
