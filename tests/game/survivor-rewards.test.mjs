import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordClient, waitForRecordLogin } from '../../public/static/survivor/record-client.js';

const receipt = { points: 100, balance: 2100, dailyEarned: 1000, dailyLimit: 1000, status: 'awarded' };
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };
const report = { score: 11000, seconds: 150, kills: 20, level: 4, ended: 'death' };
function setup(t, fetcher) {
  const oldWindow = globalThis.window;
  globalThis.window = { liff: { isLoggedIn: () => true, getAccessToken: () => 'test-token' } };
  t.after(() => { globalThis.window = oldWindow; });
  const client = new RecordClient(storage(), fetcher);
  client.account = 'account-a';
  return client;
}
const response = reward => ({ ok: true, json: async () => ({ profile: { bestScore: 11000 }, unlocked: ['first'], reward }) });

test('stalled LINE initialization releases departure without continuing a late start', async () => {
  let resolve, continued = false;
  const readiness = new Promise(r => { resolve = r; });
  const departure = waitForRecordLogin(() => readiness, 5).then(() => { continued = true; });
  await assert.rejects(departure, /LINE連携に時間がかかっています/);
  resolve({ status: 'ready' });
  await Promise.resolve();
  assert.equal(continued, false);
});

test('LINE wait preserves initialization outcomes and does not skip token authentication', async t => {
  const client = setup(t, () => assert.fail('request sent without a token'));
  assert.deepEqual(await waitForRecordLogin(async () => ({ status: 'ready' }), 50), { status: 'ready' });
  assert.deepEqual(await waitForRecordLogin(async () => ({ status: 'error' }), 50), { status: 'error' });
  globalThis.window.liff.getAccessToken = () => null;
  await assert.rejects(client.load(), error => error.status === 401);
});

test('survivor finish keeps receipt by run ID and preserves unlocked return contract', async t => {
  let requests = 0;
  const client = setup(t, async () => { requests++; return response(receipt); });
  client.enqueue('survivor-run-1', report);
  assert.deepEqual(await client.flush(), ['first']);
  assert.deepEqual(client.rewardFor('survivor-run-1'), receipt);
  client.enqueue('survivor-run-1', { ...report, score: 99999 });
  assert.deepEqual(await client.flush(), []);
  assert.equal(requests, 1);
  assert.equal(client.pending.length, 0);
});

test('survivor network retry sends the same pending run and records a receipt only after success', async t => {
  const requests = [];
  const client = setup(t, async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) throw new Error('offline');
    return response(receipt);
  });
  client.enqueue('survivor-retry-1', report);
  await assert.rejects(client.flush(), /offline/);
  assert.equal(client.rewardFor('survivor-retry-1'), null);
  assert.equal(client.pending.length, 1);
  await client.flush();
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(client.rewardFor('survivor-retry-1'), receipt);
});

test('survivor receipts stay associated with each result when older outbox entries are also flushed', async t => {
  const client = setup(t, async (url, options) => response(JSON.parse(options.body).id === 'old-run-1' ? { ...receipt, points: 30 } : { ...receipt, points: 0, status: 'daily_limit' }));
  client.enqueue('old-run-1', report);
  client.enqueue('current-run-1', report);
  client.enqueue('other-account-run', report, 'account-b');
  await client.flush();
  assert.equal(client.rewardFor('old-run-1').points, 30);
  assert.equal(client.rewardFor('current-run-1').status, 'daily_limit');
  assert.equal(client.rewardFor('other-account-run'), null);
  assert.equal(client.queue.length, 1);
});

test('survivor rejected result does not create a reward or destroy existing retry behavior', async t => {
  const client = setup(t, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid report' }) }));
  client.enqueue('invalid-run-1', report);
  await client.flush();
  assert.equal(client.blocked[0].id, 'invalid-run-1');
  assert.equal(client.rewardFor('invalid-run-1'), null);
});
