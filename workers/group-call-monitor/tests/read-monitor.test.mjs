import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MonitorStore } from '../store.mjs';
import { runMonitor } from '../monitor.mjs';

const CHAT = 'C0123456789abcdef0123456789abcdef';
const OTHER_CHAT = 'Cabcdef0123456789abcdef0123456789';
const BOT = 'U00000000000000000000000000000000';
const READER = 'U11111111111111111111111111111111';
const CONFIG = { botId: BOT, scope: CHAT, enabled: true };
const BASE_CURSOR = 'before-read-events';

async function fixture(t, config = CONFIG) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return sqlite.prepare(sql).run(...args); },
  }; } };
  const store = new MonitorStore(db);
  const earlier = Date.now() - 60_000;
  await store.state(earlier);
  await store.activateScope(config.scope, config.enabled, earlier);
  await store.cursor(BASE_CURSOR, earlier);
  return store;
}

function event(subEvent, payload, overrides = {}) {
  return { event: 'chat', subEvent, botId: BOT, chatId: CHAT, payload, ...overrides };
}

function readEvent(now = Date.now()) {
  return event('chatRead', {
    type: 'chatRead', timestamp: now, source: { chatId: CHAT, userId: READER }, read: { watermark: now },
  });
}

function commandEvent(now = Date.now()) {
  return event('message', {
    type: 'message', timestamp: now, source: { chatId: CHAT, userId: READER },
    message: { id: 'command-message', type: 'text', text: '既読セット' },
  });
}

function ackEvent(now = Date.now()) {
  return event('messageSent', {
    type: 'messageSent', timestamp: now, source: { chatId: CHAT, userId: BOT }, sendId: 'read-command-send-id',
    message: { id: 'confirmation-message', type: 'text', text: '既読をセットしました。' },
  });
}

function frame(data, id) {
  return `id: ${id}\nevent: ${data.event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function client(overrides = {}) {
  return {
    async streamToken() { return {}; },
    streamUrl() { return 'https://chat-streaming-api.line.biz/api/v2/sse'; },
    async chats() { return { list: [] }; },
    async sendText() { throw new Error('Unexpected notification'); },
    ...overrides,
  };
}

function fakeReadService(log, overrides = {}) {
  return {
    store: {
      async cleanup() { log.push('cleanup'); },
      async quarantineInterrupted() { log.push('quarantine'); },
      async acknowledge(...args) { log.push(['read-ack', ...args]); },
    },
    async receive(data, id, cutoff) { log.push(['receive', data.subEvent, id, cutoff]); },
    ...overrides,
  };
}

test('runMonitor routes read signals, commands, and acknowledgements before committing their cursor', async t => {
  const store = await fixture(t);
  const now = Date.now();
  const log = [];
  const api = client();
  const ack = store.acknowledge.bind(store);
  t.mock.method(store, 'acknowledge', async (...args) => { log.push(['call-ack', ...args]); return ack(...args); });
  const cursor = store.cursor.bind(store);
  t.mock.method(store, 'cursor', async (...args) => { log.push(['cursor', args[0]]); return cursor(...args); });
  t.mock.method(globalThis, 'fetch', async () => {
    log.push('stream');
    return new Response(frame(commandEvent(now), 'command') + frame(readEvent(now + 1), 'read') + frame(ackEvent(now + 2), 'ack'));
  });
  assert.equal((await runMonitor(store, api, CONFIG, { readService: fakeReadService(log) })).ok, true);
  const cutoff = (await store.state()).scope_activated_at;
  assert.deepEqual(log, [
    'cleanup', 'quarantine', 'stream',
    ['receive', 'message', 'command', cutoff], ['receive', 'chatRead', 'read', cutoff],
    ['call-ack', CHAT, 'read-command-send-id', now + 2],
    ['read-ack', CHAT, 'read-command-send-id', now + 2],
    ['receive', 'messageSent', 'ack', cutoff], ['cursor', 'ack'],
  ]);
  assert.equal((await store.state()).cursor, 'ack');
});

test('foreign bots, chats outside scope, non-chat events and non-group chats never reach readService', async t => {
  for (const [name, config, overrides] of [
    ['foreign bot', CONFIG, { botId: READER }],
    ['other group', CONFIG, { chatId: OTHER_CHAT }],
    ['empty scope', { ...CONFIG, scope: '' }, {}],
    ['non-chat event', CONFIG, { event: 'callSession' }],
    ['one-to-one chat', { ...CONFIG, scope: 'all' }, { chatId: READER }],
  ]) await t.test(name, async t => {
    const store = await fixture(t, config);
    const log = [];
    const input = { ...ackEvent(), ...overrides };
    t.mock.method(globalThis, 'fetch', async () => new Response(frame(input, 'ignored-event')));
    const acknowledge = t.mock.method(store, 'acknowledge');
    assert.equal((await runMonitor(store, client(), config, { readService: fakeReadService(log) })).ok, true);
    assert.deepEqual(log, ['cleanup', 'quarantine']);
    assert.equal(acknowledge.mock.callCount(), 0);
    assert.equal((await store.state()).cursor, 'ignored-event', 'ignored traffic can be checkpointed safely');
  });
});

test('disabled sends do not receive commands or reads but may confirm already-attempted sends', async t => {
  const config = { ...CONFIG, enabled: false };
  const store = await fixture(t, config);
  const log = [];
  const confirmation = ackEvent();
  t.mock.method(globalThis, 'fetch', async () => new Response(frame(commandEvent(), 'command') + frame(readEvent(), 'read') + frame(confirmation, 'ack')));
  const acknowledge = t.mock.method(store, 'acknowledge');
  assert.equal((await runMonitor(store, client(), config, { readService: fakeReadService(log) })).ok, true);
  assert.deepEqual(log, ['cleanup', 'quarantine', ['read-ack', CHAT, confirmation.payload.sendId, confirmation.payload.timestamp]]);
  assert.equal(acknowledge.mock.callCount(), 1);
  assert.equal((await store.state()).cursor, 'ack');
});

test('a failing read write stops the cursor and replays that frame before later commands', async t => {
  const store = await fixture(t);
  const log = [];
  const read = readEvent();
  const command = commandEvent();
  const cursors = [];
  const api = client({ streamUrl(token, cursor) { cursors.push(cursor); return 'https://chat-streaming-api.line.biz/api/v2/sse'; } });
  let run = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response(++run === 1
    ? frame(command, 'accepted-command') + frame(read, 'retry-read') + frame(command, 'later-command')
    : frame(read, 'retry-read') + frame(command, 'later-command')));
  let fail = true;
  const service = fakeReadService(log, { async receive(data, id) {
    log.push(['receive', id]);
    if (id === 'retry-read' && fail) { fail = false; throw new Error('Simulated receipt transaction failure'); }
  } });
  assert.deepEqual(await runMonitor(store, api, CONFIG, { readService: service }), { ok: false, error: 'monitor_error' });
  assert.equal((await store.state()).cursor, 'accepted-command');
  assert.deepEqual(log.filter(x => Array.isArray(x)), [['receive', 'accepted-command'], ['receive', 'retry-read']]);
  assert.equal((await runMonitor(store, api, CONFIG, { readService: service })).ok, true);
  assert.deepEqual(cursors, [BASE_CURSOR, 'accepted-command']);
  assert.deepEqual(log.filter(x => Array.isArray(x)), [
    ['receive', 'accepted-command'], ['receive', 'retry-read'], ['receive', 'retry-read'], ['receive', 'later-command'],
  ]);
  assert.equal((await store.state()).cursor, 'later-command');
});

test('read acknowledgement failure also preserves the cursor for replay', async t => {
  const store = await fixture(t);
  const log = [];
  const wire = ackEvent();
  const service = fakeReadService(log);
  let attempts = 0;
  service.store.acknowledge = async () => { if (++attempts === 1) throw new Error('Simulated acknowledgement failure'); };
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response(frame(wire, 'pending-ack')));
  assert.equal((await runMonitor(store, client(), CONFIG, { readService: service })).ok, false);
  assert.equal((await store.state()).cursor, BASE_CURSOR);
  assert.equal(log.filter(x => Array.isArray(x)).length, 0, 'receive must wait for acknowledgement success');
  assert.equal((await runMonitor(store, client(), CONFIG, { readService: service })).ok, true);
  assert.equal(attempts, 2);
  assert.equal((await store.state()).cursor, 'pending-ack');
  assert.equal(log.filter(x => Array.isArray(x) && x[0] === 'receive').length, 1);
});

test('existing live call notification and its durable outbox still work with readService', async t => {
  const store = await fixture(t);
  const now = Date.now();
  const log = [];
  const call = event('callHistory', { type: 'message', timestamp: now, source: { chatId: CHAT },
    message: { id: 'canonical-call-id', type: 'callHistory', serviceType: 'GROUP_CALL', result: 'INFO', duration: 3129 } });
  t.mock.method(globalThis, 'fetch', async () => new Response(frame(readEvent(now), 'read') + frame(call, 'call')));
  const sent = [];
  const api = client({ async sendText(chatId, text) { sent.push({ chatId, text }); } });
  assert.equal((await runMonitor(store, api, CONFIG, { readService: fakeReadService(log), reconcileFirst: false })).ok, true);
  assert.deepEqual(sent, [{ chatId: CHAT, text: 'グループ通話が終了しました\n通話時間：3秒' }]);
  assert.equal((await store.status()).recent[0].status, 'sent');
  assert.equal((await store.status()).recent[0].message_id, 'canonical-call-id');
  assert.deepEqual(log.filter(x => Array.isArray(x)).map(x => x.slice(0, 3)), [['receive', 'chatRead', 'read'], ['receive', 'callHistory', 'call']]);
  assert.equal((await store.state()).cursor, 'call');
});

test('absence of readService leaves commands inert and existing acknowledgement routing intact', async t => {
  const store = await fixture(t);
  const confirmation = ackEvent();
  t.mock.method(globalThis, 'fetch', async () => new Response(frame(commandEvent(), 'command') + frame(readEvent(), 'read') + frame(confirmation, 'ack')));
  const acknowledge = t.mock.method(store, 'acknowledge');
  assert.equal((await runMonitor(store, client(), CONFIG)).ok, true);
  assert.equal(acknowledge.mock.callCount(), 1);
  assert.deepEqual(acknowledge.mock.calls[0].arguments, [CHAT, confirmation.payload.sendId, confirmation.payload.timestamp]);
  assert.equal((await store.status()).recent.length, 0);
  assert.equal((await store.state()).cursor, 'ack');
});
