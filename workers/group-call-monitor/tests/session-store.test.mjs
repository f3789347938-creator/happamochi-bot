import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, SessionStoreError } from '../session-store.mjs';

const OPTIONS = { botId: 'Utest-bot', cookie: '__Host-chat-ses=private-seed; XSRF-TOKEN=private-xsrf', adminToken: 'private-admin-token-for-testing' };
const snapshot = (revision = 1) => ({ version: 1, seedCookie: OPTIONS.cookie, revision, updates: [{ name: '__Host-chat-ses', value: `private-renewed-cookie-${revision}`, expiresAt: 1_790_000_000_000 }] });

function fixture() {
  const data = new Map();
  const storage = {
    async get(key) { return structuredClone(data.get(key)); },
    async put(key, value) { data.set(key, structuredClone(value)); },
  };
  return { data, storage, store: new SessionStore(storage, OPTIONS), envelope: () => [...data.values()][0] };
}

function safeError(error, operation) {
  assert.ok(error instanceof SessionStoreError);
  assert.equal(error.message, `OA session storage ${operation} failed`);
  assert.equal(error.operation, operation);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error) + String(error), /private-|very-secret/);
  return true;
}

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('missing snapshot is null and saved data has no plaintext secrets', async () => {
  const f = fixture();
  assert.equal(await f.store.load(), null);
  await f.store.save(snapshot());
  const saved = f.envelope(), serialized = JSON.stringify([...f.data]);
  assert.equal(saved.version, 1);
  assert.match(saved.seedFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(saved.iv, 'base64').length, 12);
  assert.ok(Buffer.from(saved.ciphertext, 'base64').length > 16);
  assert.doesNotMatch(serialized, /private-|__Host-chat-ses|XSRF-TOKEN|seedCookie|updates/);
  assert.equal(JSON.stringify(f.store), '{}');
});

test('a restarted store decrypts the snapshot and does not share returned object references', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  const restarted = new SessionStore(f.storage, OPTIONS);
  const loaded = await restarted.load();
  assert.deepEqual(loaded, snapshot());
  loaded.updates[0].value = 'mutated';
  assert.deepEqual(await restarted.load(), snapshot());
});

test('every save uses a fresh nonce, including identical snapshots', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  const first = structuredClone(f.envelope());
  await f.store.save(snapshot());
  assert.notEqual(f.envelope().iv, first.iv);
  assert.notEqual(f.envelope().ciphertext, first.ciphertext);
  assert.deepEqual(await f.store.load(), snapshot());
});

test('manual seed rotation ignores old ciphertext, including simultaneous admin-token rotation', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  const rotatedOptions = { ...OPTIONS, cookie: '__Host-chat-ses=new-private-seed', adminToken: 'rotated-private-admin-token' };
  const rotated = new SessionStore(f.storage, rotatedOptions);
  assert.equal(await rotated.load(), null);
  const next = { ...snapshot(2), seedCookie: rotatedOptions.cookie };
  await rotated.save(next);
  assert.deepEqual(await new SessionStore(f.storage, rotatedOptions).load(), next);
  assert.equal(await f.store.load(), null);
});

test('wrong admin token and another bot cannot decrypt the stored cookie', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  await assert.rejects(new SessionStore(f.storage, { ...OPTIONS, adminToken: 'incorrect-private-admin' }).load(), error => safeError(error, 'load'));
  await assert.rejects(new SessionStore(f.storage, { ...OPTIONS, botId: 'Uanother-bot' }).load(), error => safeError(error, 'load'));
  // Relabeling the public envelope cannot make it decrypt under another bot's key.
  const [key, envelope] = [...f.data][0];
  f.data.set(key, { ...envelope, botId: 'Uanother-bot' });
  await assert.rejects(new SessionStore(f.storage, { ...OPTIONS, botId: 'Uanother-bot' }).load(), error => safeError(error, 'load'));
});

test('ciphertext, nonce, envelope tampering and malformed encodings fail with sanitized errors', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  const [key, original] = [...f.data][0];
  const mutateByte = text => { const bytes = Buffer.from(text, 'base64'); bytes[0] ^= 1; return bytes.toString('base64'); };
  const cases = [
    { ...original, ciphertext: mutateByte(original.ciphertext) },
    { ...original, iv: mutateByte(original.iv) },
    { ...original, version: 2 },
    { ...original, seedFingerprint: 'invalid' },
    { ...original, ciphertext: '%%%very-secret' },
    { ...original, iv: 'AA==' },
  ];
  for (const envelope of cases) {
    f.data.set(key, envelope);
    await assert.rejects(f.store.load(), error => safeError(error, 'load'));
  }
});

test('encryption and writes are serialized in invocation order, with immediate snapshot capture', async t => {
  const f = fixture(), entered = deferred(), release = deferred();
  const writes = [], put = f.storage.put;
  f.storage.put = async (key, value) => { writes.push(structuredClone(value)); await put(key, value); };
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let encryptions = 0;
  t.mock.method(crypto.subtle, 'encrypt', async (...args) => {
    encryptions++;
    if (encryptions === 1) { entered.resolve(); await release.promise; }
    return encrypt(...args);
  });
  const mutable = snapshot(1);
  const first = f.store.save(mutable);
  await entered.promise;
  mutable.revision = 999;
  const second = f.store.save(snapshot(2));
  const latest = f.store.load();
  await Promise.resolve();
  assert.equal(encryptions, 1, 'newer encryption must not overtake the older one');
  release.resolve();
  await first;
  await second;
  assert.deepEqual(await latest, snapshot(2));
  const firstWritten = new SessionStore({ ...f.storage, async get() { return writes[0]; } }, OPTIONS);
  assert.deepEqual(await firstWritten.load(), snapshot(1));
});

test('failed write preserves the prior value and does not poison later operations', async () => {
  const f = fixture();
  await f.store.save(snapshot());
  const put = f.storage.put;
  f.storage.put = async () => { throw new Error('very-secret-storage-error'); };
  await assert.rejects(f.store.save(snapshot(2)), error => safeError(error, 'save'));
  assert.deepEqual(await f.store.load(), snapshot());
  f.storage.put = put;
  await f.store.save(snapshot(3));
  assert.deepEqual(await f.store.load(), snapshot(3));
});

test('encryption failure is sanitized and a queued newer save still completes', async t => {
  const f = fixture();
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let calls = 0;
  t.mock.method(crypto.subtle, 'encrypt', async (...args) => {
    if (++calls === 1) throw new Error('very-secret-encryption-error');
    return encrypt(...args);
  });
  const failed = f.store.save(snapshot(1));
  const succeeded = f.store.save(snapshot(2));
  await assert.rejects(failed, error => safeError(error, 'save'));
  await succeeded;
  assert.deepEqual(await f.store.load(), snapshot(2));
});

test('read failure and non-serializable/oversized snapshots never expose input or underlying errors', async () => {
  const f = fixture();
  f.storage.get = async () => { throw new Error('very-secret-read-error'); };
  await assert.rejects(f.store.load(), error => safeError(error, 'load'));
  const cyclic = { private: 'very-secret' }; cyclic.self = cyclic;
  for (const invalid of [undefined, null, [], cyclic, { value: 'x'.repeat(65_536) }, { toJSON() { throw new Error('very-secret-json-error'); } }]) {
    await assert.rejects(f.store.save(invalid), error => safeError(error, 'save'));
  }
  assert.equal(f.data.size, 0);
});

test('invalid configuration errors contain neither token nor cookie', () => {
  const f = fixture();
  for (const options of [{ ...OPTIONS, botId: 'very-secret/invalid' }, { ...OPTIONS, cookie: '' }, { ...OPTIONS, adminToken: '' }]) {
    assert.throws(() => new SessionStore(f.storage, options), error => safeError(error, 'configuration'));
  }
});
