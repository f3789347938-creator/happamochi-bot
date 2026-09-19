import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MonitorStore } from '../store.mjs';
import { allowedChat, observe, dispatch, reconcile, runMonitor } from '../monitor.mjs';

const chatId = 'Cf2b0d931f735b48b044c47d841a32fda';
const scope = { scope: chatId, enabled: true };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return sqlite.prepare(sql).run(...args); }
  }; } };
  return { sqlite, store: new MonitorStore(db) };
}
function entry(now, id = '632508022237167721') {
  return { type: 'message', timestamp: now, message: { id, type: 'callHistory', serviceType: 'GROUP_CALL', result: 'INFO', duration: 3129 } };
}

test('only configured group chats can receive notifications', () => {
  assert.equal(allowedChat(chatId, 'all'), true);
  assert.equal(allowedChat(chatId.replace(/^C/, 'U'), 'all'), false);
  assert.equal(allowedChat(chatId, 'C00000000000000000000000000000000'), false);
  assert.equal(allowedChat(chatId, ''), false);
});

test('replayed events and overlapping workers cannot double send', async () => {
  const { store } = fixture();
  const now = Date.now();
  assert.equal(await store.acquire('first', now), true);
  assert.equal(await store.acquire('second', now + 1), false);
  await observe(store, entry(now), chatId, scope, now - 1);
  await observe(store, entry(now), chatId, scope, now - 1);
  let sent = 0;
  const api = { async sendText(id, text, sendId) { sent++; assert.equal(id, chatId); assert.ok(text.includes('3秒')); assert.match(sendId, /^[\da-f-]+$/); } };
  await dispatch(store, api, scope, 'first');
  await dispatch(store, api, scope, 'first');
  assert.equal(sent, 1);
  assert.equal((await store.status()).recent[0].status, 'sent');
});

test('timeout stays uncertain and is not sent again on restart', async () => {
  const { store } = fixture();
  const now = Date.now();
  await store.acquire('first', now);
  await observe(store, entry(now), chatId, scope, now - 1);
  let attempts = 0;
  const api = { async sendText() { attempts++; throw new DOMException('timeout', 'TimeoutError'); } };
  await dispatch(store, api, scope, 'first');
  await observe(store, entry(now), chatId, scope, now - 1);
  await dispatch(store, api, scope, 'first');
  assert.equal(attempts, 1);
  assert.equal((await store.status()).recent[0].status, 'uncertain');
});

test('interrupted send is quarantined without a blind retry', async () => {
  const { store } = fixture();
  const now = Date.now();
  await observe(store, entry(now), chatId, scope, now - 1);
  const [row] = await store.pending();
  await store.claim(row, now - 130000);
  await store.quarantineInterrupted(now);
  assert.equal((await store.pending()).length, 0);
  assert.equal((await store.status()).recent[0].status, 'uncertain');
});

test('matching server sendId resolves uncertainty without another POST', async () => {
  const { store } = fixture();
  const now = Date.now();
  await observe(store, entry(now), chatId, scope, now - 1);
  const [row] = await store.pending();
  await store.claim(row, now);
  await store.finish(row, 'uncertain', 'request_timeout');
  await store.acknowledge('C00000000000000000000000000000000', row.send_id, now);
  assert.equal((await store.status()).recent[0].status, 'uncertain');
  await store.acknowledge(chatId, row.send_id, now);
  assert.equal((await store.status()).recent[0].status, 'sent');
  assert.equal((await store.pending()).length, 0);
});

test('bootstrap ignores past calls, and dry-run records never later send', async () => {
  const { store } = fixture();
  const now = Date.now();
  await observe(store, entry(now - 1000), chatId, scope, now);
  assert.equal((await store.status()).recent.length, 0);
  await observe(store, entry(now + 1), chatId, { ...scope, enabled: false }, now);
  await observe(store, entry(now + 1), chatId, scope, now);
  assert.equal((await store.pending()).length, 0);
  assert.equal((await store.status()).recent[0].status, 'observed');
});

test('history pagination catches a call hidden by newer text messages', async () => {
  const { store } = fixture();
  const now = Date.now();
  await store.acquire('first', now);
  let pages = 0;
  const api = {
    async chats() { return { list: [{ chatId, chatType: 'GROUP', updatedAt: now }] }; },
    async history(id, options) {
      pages++;
      if (!options.backward) return { list: [{ timestamp: now, message: { type: 'text', text: 'ignored' } }], backward: 'older' };
      return { list: [entry(now - 1000), { timestamp: now - 10000, message: { type: 'text' } }] };
    },
    async sendText() {}
  };
  await reconcile(store, api, scope, now - 5000, 'first');
  assert.equal(pages, 2);
  assert.equal((await store.status()).recent[0].status, 'sent');
});

test('send crash after API success is recorded uncertain, not sent twice', async () => {
  const { store } = fixture();
  const now = Date.now();
  await store.acquire('first', now);
  await observe(store, entry(now), chatId, scope, now - 1);
  const finish = store.finish.bind(store);
  store.finish = async (row, status, error) => { if (status === 'sent') throw new Error('D1 unavailable'); return finish(row, status, error); };
  let sent = 0;
  await dispatch(store, { async sendText() { sent++; } }, scope, 'first');
  await dispatch(store, { async sendText() { sent++; } }, scope, 'first');
  assert.equal(sent, 1);
  assert.equal((await store.status()).recent[0].status, 'uncertain');
});

test('live stream ignores non-JSON heartbeat and commits call cursor after sending', async t => {
  const { store } = fixture();
  const now = Date.now();
  const wire = { event: 'chat', subEvent: 'callHistory', botId: 'test-bot', chatId,
    payload: { ...entry(now + 20), source: { chatId } } };
  const body = `id: heartbeat-one\nevent: ping\ndata: ping\n\nid: call-event\nevent: chat\ndata: ${JSON.stringify(wire)}\n\nid: heartbeat-two\nevent: ping\ndata: ping\n\n`;
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  let sent = 0;
  const api = {
    async streamToken() { return { lastEventId: 'initial-cursor' }; },
    streamUrl() { return 'https://chat-streaming-api.line.biz/api/v2/sse'; },
    async chats() { return { list: [] }; },
    async sendText() { sent++; }
  };
  assert.equal((await runMonitor(store, api, { ...scope, botId: 'test-bot' })).ok, true);
  assert.equal(sent, 1);
  assert.equal((await store.state()).cursor, 'call-event');
});

test('mismatched source chat and other bot stream events cannot post', async t => {
  const { store } = fixture();
  const now = Date.now();
  const frames = [
    { event: 'chat', subEvent: 'callHistory', botId: 'other-bot', chatId, payload: entry(now + 20) },
    { event: 'chat', subEvent: 'callHistory', botId: 'test-bot', chatId, payload: { ...entry(now + 20), source: { chatId: 'C00000000000000000000000000000000' } } }
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(frames.map(x => `event: chat\ndata: ${JSON.stringify(x)}\n\n`).join('')));
  let sent = 0;
  const api = { async streamToken() { return {}; }, streamUrl() { return 'https://chat-streaming-api.line.biz/api/v2/sse'; }, async chats() { return { list: [] }; }, async sendText() { sent++; } };
  assert.equal((await runMonitor(store, api, { ...scope, botId: 'test-bot' })).ok, true);
  assert.equal(sent, 0);
  assert.equal((await store.status()).recent.length, 0);
});

test('history scan resumes across runs to recover a call on the seventh page', async () => {
  const { store } = fixture();
  const now = Date.now();
  const cutoff = now - 60_000;
  await store.acquire('first', now);
  const visited = [];
  let sent = 0;
  const api = {
    async chats() { return { list: [{ chatId, chatType: 'GROUP', updatedAt: now }] }; },
    async history(id, { backward }) {
      assert.equal(id, chatId);
      const page = backward === undefined ? 0 : Number(backward.slice('page:'.length));
      assert.ok(Number.isInteger(page) && page >= 0 && page <= 6);
      visited.push(page);
      if (page === 6) return { list: [entry(now - 10_000)] };
      return {
        list: Array.from({ length: 100 }, (_, index) => ({
          timestamp: now - page * 100 - index,
          message: { id: `text-${page}-${index}`, type: 'text', text: 'ignored' },
        })),
        backward: `page:${page + 1}`,
      };
    },
    async sendText() { sent++; },
  };
  await reconcile(store, api, scope, cutoff, 'first');
  assert.equal(sent, 0, 'the first bounded scan should stop before the seventh page');
  await reconcile(store, api, scope, cutoff, 'first');
  assert.ok(visited.includes(6), 'the second run must reach the saved continuation');
  assert.equal(sent, 1);
  assert.equal((await store.status()).recent[0].status, 'sent');
  await reconcile(store, api, scope, cutoff, 'first');
  assert.equal(sent, 1, 'overlapping history must not send the same call again');
});

test('unchanged chat updatedAt does not hide a call whose history arrives later', async () => {
  const { store } = fixture();
  const now = Date.now();
  const cutoff = now - 60_000;
  await store.acquire('first', now);
  let visible = false;
  let historyCalls = 0;
  let sent = 0;
  const api = {
    async chats() { return { list: [{ chatId, chatType: 'GROUP', updatedAt: now - 1000 }] }; },
    async history() {
      historyCalls++;
      return { list: visible ? [entry(now - 1000)] : [] };
    },
    async sendText() { sent++; },
  };
  await reconcile(store, api, scope, cutoff, 'first');
  assert.equal(sent, 0);
  visible = true;
  await reconcile(store, api, scope, cutoff, 'first');
  assert.ok(historyCalls >= 2, 'recent history must be revisited even if updatedAt is unchanged');
  assert.equal(sent, 1);
  assert.equal((await store.status()).recent[0].status, 'sent');
});

test('a delayed history sendId resolves a timeout without another send', async () => {
  const { store } = fixture();
  const now = Date.now();
  const cutoff = now - 60_000;
  await store.acquire('first', now);
  await observe(store, entry(now - 1000), chatId, scope, cutoff);
  const [row] = await store.pending();
  let acknowledged = false;
  let attempts = 0;
  const api = {
    async chats() { return { list: [{ chatId, chatType: 'GROUP', updatedAt: now - 1000 }] }; },
    async history() {
      return { list: acknowledged ? [{
        type: 'messageSent',
        timestamp: now - 500,
        sendId: row.send_id,
        message: { id: '632508022237167722', type: 'text', text: row.message_text },
      }] : [] };
    },
    async sendText() {
      attempts++;
      throw new DOMException('timeout after server accepted the message', 'TimeoutError');
    },
  };
  await dispatch(store, api, scope, 'first');
  assert.equal((await store.status()).recent[0].status, 'uncertain');
  await reconcile(store, api, scope, cutoff, 'first');
  assert.equal((await store.status()).recent[0].status, 'uncertain');
  acknowledged = true;
  await reconcile(store, api, scope, cutoff, 'first');
  assert.equal((await store.status()).recent[0].status, 'sent');
  assert.equal(attempts, 1, 'history confirmation must not issue another POST');
  assert.equal((await store.pending()).length, 0);
});

test('chat discovery resumes on page five instead of restarting the first four pages', async () => {
  const { store } = fixture();
  const now = Date.now();
  const cutoff = now - 60_000;
  await store.acquire('first', now);
  const visited = [];
  let sent = 0;
  const api = {
    async chats({ next }) {
      const page = next === undefined ? 0 : Number(next.slice('chats:'.length));
      assert.ok(Number.isInteger(page) && page >= 0 && page <= 4);
      visited.push(page);
      if (page === 4) return { list: [{ chatId, chatType: 'GROUP', updatedAt: now }] };
      return {
        list: Array.from({ length: 100 }, (_, index) => ({
          chatId: `U${String(page * 100 + index).padStart(32, '0')}`,
          chatType: 'USER',
          updatedAt: now,
        })),
        next: `chats:${page + 1}`,
      };
    },
    async history(id) { assert.equal(id, chatId); return { list: [entry(now - 1000)] }; },
    async sendText(id) { assert.equal(id, chatId); sent++; },
  };
  const config = { scope: 'all', enabled: true };
  await reconcile(store, api, config, cutoff, 'first');
  assert.equal(sent, 0);
  await reconcile(store, api, config, cutoff, 'first');
  assert.deepEqual(visited, [0, 1, 2, 3, 4]);
  assert.equal(sent, 1);
  assert.equal((await store.status()).recent[0].status, 'sent');
});

test('expanding the authorized scope excludes both queued and newly discovered past calls', async () => {
  const { store } = fixture();
  const now = Date.now();
  const addedChat = 'C00000000000000000000000000000001';
  await store.acquire('first', now);
  await store.activateScope(chatId, true, now - 10_000);
  await observe(store, entry(now - 1000, 'old-pending'), chatId, scope, now - 10_000);
  assert.equal((await store.pending()).length, 1);
  await store.activateScope('all', true, now);
  assert.equal((await store.pending()).length, 0);
  const state = await store.state();
  assert.equal(state.scope_activated_at, now);
  const delivered = [];
  const api = {
    async chats() { return { list: [{ chatId: addedChat, chatType: 'GROUP', updatedAt: now + 1 }] }; },
    async history() { return { list: [entry(now + 1, 'new-call'), entry(now - 1, 'old-undiscovered')] }; },
    async sendText(id, text) { delivered.push({ id, text }); },
  };
  const config = { scope: 'all', enabled: true };
  await reconcile(store, api, config, state.scope_activated_at, 'first');
  assert.deepEqual(delivered, [{ id: addedChat, text: '📞 グループ通話が終了しました\n通話時間：3秒' }]);
  const status = await store.status();
  assert.equal(status.recent.find(row => row.message_id === 'old-pending').status, 'observed');
  assert.equal(status.recent.some(row => row.message_id === 'old-undiscovered'), false);
  assert.equal(status.recent.find(row => row.message_id === 'new-call').status, 'sent');
});
