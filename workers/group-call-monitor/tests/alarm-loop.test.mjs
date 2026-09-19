import test from 'node:test';
import assert from 'node:assert/strict';
import { AlarmLoop } from '../alarm-loop.mjs';

function fixture() {
  const state = new Map();
  const alarms = [];
  let alarm = null;
  let now = 1_789_835_500_000;
  const storage = {
    async get(key) { return structuredClone(state.get(key)); },
    async put(key, value) { state.set(key, structuredClone(value)); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; alarms.push(value); },
  };
  return {
    storage, alarms,
    clock: () => now,
    advance(ms) { now += ms; },
    consumeAlarm() { alarm = null; },
  };
}

test('ensureStarted schedules once, preserves existing alarms, and never runs the job directly', async () => {
  const f = fixture();
  let runs = 0;
  const loop = new AlarmLoop(f.storage, async () => { runs++; return { ok: true }; }, { now: f.clock });
  assert.equal((await loop.schedulerStatus()).nextAlarm, null);
  assert.equal((await loop.ensureStarted()).nextAlarm, f.clock());
  await loop.ensureStarted();
  assert.deepEqual(f.alarms, [f.clock()]);
  assert.equal(runs, 0);
});

test('normal completion awaits work and replaces the durable watchdog with a prompt next alarm', async () => {
  const f = fixture();
  let release;
  const job = new Promise(resolve => { release = resolve; });
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const loop = new AlarmLoop(f.storage, async () => { started(); return job; }, { now: f.clock });
  const pending = loop.alarm();
  await entered;
  assert.deepEqual(f.alarms, [f.clock() + 300_000]);
  assert.equal((await loop.schedulerStatus()).running, true);
  f.advance(240_000);
  release({ ok: true, secret: 'must-not-be-saved' });
  assert.deepEqual(await pending, { ok: true });
  const status = await loop.schedulerStatus();
  assert.equal(status.running, false);
  assert.equal(status.lastFinishedAt - status.lastStartedAt, 240_000);
  assert.equal(status.nextAlarm, f.clock() + 250);
  assert.deepEqual(status.lastResult, { ok: true });
  assert.equal(status.consecutiveFailures, 0);
  assert.ok(!JSON.stringify(status).includes('must-not-be-saved'));
});

test('Cron kicks and a duplicate alarm cannot schedule or start a second running stream', async () => {
  const f = fixture();
  let release;
  let started;
  const job = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let runs = 0;
  const loop = new AlarmLoop(f.storage, () => { runs++; started(); return job; }, { now: f.clock });
  const pending = loop.alarm();
  await entered;
  const scheduled = [...f.alarms];
  const status = await loop.ensureStarted();
  assert.equal(status.running, true);
  assert.deepEqual(await loop.alarm(), { skipped: 'already_running' });
  assert.deepEqual(f.alarms, scheduled);
  assert.equal(runs, 1);
  release({ ok: true });
  await pending;
});

test('transient failures back off, persist across reconstruction, cap at one minute, and reset after success', async () => {
  const f = fixture();
  const delays = [2000, 4000, 8000, 16000, 32000, 60000, 60000];
  for (const delay of delays) {
    f.consumeAlarm();
    const loop = new AlarmLoop(f.storage, async () => ({ ok: false, error: 'line_http_503' }), { now: f.clock });
    await loop.alarm();
    assert.equal((await loop.schedulerStatus()).nextAlarm - f.clock(), delay);
    f.advance(delay);
  }
  const success = new AlarmLoop(f.storage, async () => ({ ok: true }), { now: f.clock });
  await success.alarm();
  assert.equal((await success.schedulerStatus()).consecutiveFailures, 0);
  const nextFailure = new AlarmLoop(f.storage, async () => ({ ok: false, error: 'request_timeout' }), { now: f.clock });
  await nextFailure.alarm();
  assert.equal((await nextFailure.schedulerStatus()).nextAlarm - f.clock(), 2000);
});

test('authentication and rate-limit errors wait one minute without leaking error details', async () => {
  for (const status of [401, 403, 429]) {
    const f = fixture();
    const loop = new AlarmLoop(f.storage, async () => {
      throw Object.assign(new Error('cookie=must-not-be-saved'), { status, response: 'private response' });
    }, { now: f.clock });
    assert.deepEqual(await loop.alarm(), { ok: false, error: `line_http_${status}` });
    const metadata = await loop.schedulerStatus();
    assert.equal(metadata.nextAlarm - f.clock(), 60_000);
    assert.ok(!JSON.stringify(metadata).includes('must-not-be-saved'));
    assert.ok(!JSON.stringify(metadata).includes('private response'));
  }
});

test('an existing D1 lease backs off without modifying or releasing the lease', async () => {
  const f = fixture();
  const loop = new AlarmLoop(f.storage, async () => ({ skipped: 'already_running' }), { now: f.clock });
  assert.deepEqual(await loop.alarm(), { skipped: 'already_running' });
  assert.equal((await loop.schedulerStatus()).nextAlarm - f.clock(), 2000);
  await loop.alarm();
  assert.equal((await loop.schedulerStatus()).nextAlarm - f.clock(), 4000);
});

test('watchdog survives interrupted completion and can restart a reconstructed loop', async () => {
  const f = fixture();
  const setAlarm = f.storage.setAlarm;
  let failReplacement = true;
  f.storage.setAlarm = async time => {
    if (failReplacement && time < f.clock() + 300_000) throw new Error('storage unavailable during completion');
    return setAlarm(time);
  };
  let runs = 0;
  const run = async () => { runs++; return { ok: true }; };
  const original = new AlarmLoop(f.storage, run, { now: f.clock });
  await assert.rejects(original.alarm(), /storage unavailable/);
  assert.equal((await original.schedulerStatus()).running, false);
  assert.equal(await f.storage.getAlarm(), f.clock() + 300_000);
  const recovered = new AlarmLoop(f.storage, run, { now: f.clock });
  const writes = f.alarms.length;
  await recovered.ensureStarted();
  assert.equal(f.alarms.length, writes, 'a kick must preserve the persisted recovery alarm');
  failReplacement = false;
  f.advance(300_000);
  f.consumeAlarm();
  await recovered.alarm();
  assert.equal(runs, 2, 'after restart the monitor may re-enter; its durable outbox owns delivery deduplication');
  assert.equal((await recovered.schedulerStatus()).nextAlarm, f.clock() + 250);
});

test('failure to persist watchdog prevents external work and propagates for platform retry', async () => {
  const f = fixture();
  f.storage.setAlarm = async () => { throw new Error('alarm storage unavailable'); };
  let runs = 0;
  const loop = new AlarmLoop(f.storage, async () => { runs++; }, { now: f.clock });
  await assert.rejects(loop.alarm(), /alarm storage unavailable/);
  assert.equal(runs, 0);
  assert.equal((await loop.schedulerStatus()).running, false);
});

test('unknown returned or thrown errors become safe metadata and schedule recovery', async () => {
  for (const run of [
    async () => ({ ok: false, error: 'cookie=must-not-be-saved', token: 'private' }),
    async () => { throw new Error('cookie=must-not-be-saved'); },
    async () => undefined,
  ]) {
    const f = fixture();
    const loop = new AlarmLoop(f.storage, run, { now: f.clock });
    assert.deepEqual(await loop.alarm(), { ok: false, error: 'monitor_error' });
    const status = await loop.schedulerStatus();
    assert.equal(status.nextAlarm - f.clock(), 2000);
    assert.ok(!JSON.stringify(status).includes('must-not-be-saved'));
  }
});

test('a reconstructed interrupted run is kicked immediately while a finished backoff is preserved', async () => {
  const f = fixture();
  const put = f.storage.put;
  let runs = 0;
  f.storage.put = async (key, state) => {
    if (state.lastFinishedAt !== null) throw new Error('interrupted before completion was saved');
    return put(key, state);
  };
  const interrupted = new AlarmLoop(f.storage, async () => { runs++; return { ok: true }; }, { now: f.clock });
  await assert.rejects(interrupted.alarm(), /interrupted before completion/);
  const before = await interrupted.schedulerStatus();
  assert.equal(before.lastStartedAt, f.clock());
  assert.equal(before.lastFinishedAt, null);
  assert.equal(before.nextAlarm, f.clock() + 300_000);
  f.storage.put = put;
  f.advance(1000);

  const restarted = new AlarmLoop(f.storage, async () => {
    runs++;
    return { ok: false, error: 'line_http_429' };
  }, { now: f.clock });
  assert.equal((await restarted.ensureStarted()).nextAlarm, f.clock(), 'interrupted execution must not wait five minutes for its watchdog');
  assert.equal(runs, 1, 'RPC only changes the alarm; it must not create another stream itself');
  f.consumeAlarm();
  await restarted.alarm();
  const completed = await restarted.schedulerStatus();
  assert.equal(completed.lastFinishedAt, completed.lastStartedAt);
  assert.equal(completed.nextAlarm, f.clock() + 60_000);
  const writes = f.alarms.length;
  const anotherInstance = new AlarmLoop(f.storage, async () => { runs++; }, { now: f.clock });
  await anotherInstance.ensureStarted();
  assert.equal(f.alarms.length, writes, 'a completed rate-limit backoff must not be shortened by Cron or reconstruction');
  assert.equal((await anotherInstance.schedulerStatus()).nextAlarm, completed.nextAlarm);
  assert.equal(runs, 2);
});
