import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { setImmediate as tick } from 'node:timers/promises';
import { OaClient, OaApiError } from '../oa-client.mjs';

const ORIGIN = 'https://chat.line.biz';
const SEED = 'ses=initial-unit-session; __Host-chat-ses=initial-unit-host; XSRF-TOKEN=initial-unit-csrf; analytics=preserve-unit-value';
const values = header => Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const at = part.indexOf('=');
  return [part.slice(0, at), part.slice(at + 1)];
}));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(url, { body = {}, cookies = [], status = 200, location } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  if (location) headers.set('location', location);
  const result = new Response(JSON.stringify(body), { status, headers });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function client(options) { return new OaClient({ botId: 'U-unit-bot', cookie: SEED, ...options }); }
function assertSafeError(error, forbidden = []) {
  assert.ok(error instanceof OaApiError);
  assert.equal(error.cause, undefined);
  const text = `${String(error)}\n${inspect(error)}\n${JSON.stringify(error)}`;
  for (const secret of ['initial-unit-session', 'initial-unit-host', 'initial-unit-csrf', ...forbidden]) {
    assert.ok(!text.includes(secret), 'the public error must not include a credential or underlying error text');
  }
  return true;
}

test('cookie refresh is persisted before later requests can use it, and survives a new OaClient', async () => {
  const enteredSave = deferred();
  const finishSave = deferred();
  const calls = [];
  let persisted;
  const api = client({
    saveCookies: async snapshot => {
      persisted = JSON.parse(JSON.stringify(snapshot));
      enteredSave.resolve();
      await finishSave.promise;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(url, calls.length === 1 ? { cookies: [
        '__Host-chat-ses=refreshed-unit-host; Path=/; Secure; HttpOnly',
        'XSRF-TOKEN=refreshed-unit-csrf; Path=/; Secure',
      ] } : {});
    },
  });
  const first = api.history('C-unit-chat');
  await enteredSave.promise;
  assert.equal(values(calls[0].init.headers.get('cookie'))['__Host-chat-ses'], 'initial-unit-host');
  const second = api.members('C-unit-chat');
  await tick();
  assert.equal(calls.length, 1, 'the second request must wait for durable cookie storage');
  finishSave.resolve();
  await Promise.all([first, second]);
  assert.equal(values(calls[1].init.headers.get('cookie'))['__Host-chat-ses'], 'refreshed-unit-host');
  assert.equal(values(calls[1].init.headers.get('cookie'))['XSRF-TOKEN'], 'refreshed-unit-csrf');
  assert.equal(values(calls[1].init.headers.get('cookie')).analytics, 'preserve-unit-value');

  let restoredHeader;
  const restarted = client({ cookieSnapshot: persisted, fetchImpl: async (url, init) => {
    restoredHeader = init.headers.get('cookie');
    return response(url);
  } });
  await restarted.history('C-unit-chat');
  assert.equal(values(restoredHeader)['__Host-chat-ses'], 'refreshed-unit-host');
  assert.equal(values(restoredHeader)['XSRF-TOKEN'], 'refreshed-unit-csrf');
  const safe = JSON.stringify(restarted.sessionMetadata());
  assert.ok(!safe.includes('refreshed-unit-host'));
  assert.ok(!safe.includes('refreshed-unit-csrf'));
  assert.ok(!inspect(restarted).includes('refreshed-unit-host'));
});

test('a storage failure keeps old credentials and does not poison subsequent persistence', async () => {
  const calls = [];
  let saves = 0;
  let persisted;
  const api = client({
    saveCookies: async snapshot => {
      saves += 1;
      if (saves === 1) throw new Error('private-storage-error discarded-unit-session');
      persisted = snapshot;
    },
    fetchImpl: async (url, init) => {
      calls.push(init.headers.get('cookie'));
      const next = calls.length === 1 ? 'discarded-unit-session' : calls.length === 3 ? 'durable-unit-session' : null;
      return response(url, { cookies: next ? [`ses=${next}; Path=/; Secure`] : [] });
    },
  });
  await assert.rejects(api.history('C-unit-chat'), error => assertSafeError(error, ['private-storage-error', 'discarded-unit-session']));
  await api.history('C-unit-chat');
  assert.equal(values(calls[1]).ses, 'initial-unit-session');
  assert.equal(api.sessionMetadata().revision, 0);
  await api.history('C-unit-chat');
  await api.history('C-unit-chat');
  assert.equal(saves, 2);
  assert.equal(values(calls[3]).ses, 'durable-unit-session');
  assert.equal(persisted.revision, 1);
});

test('concurrent replies with stale sent cookies cannot overwrite a newer durable session', async () => {
  const pending = [];
  const allStarted = deferred();
  const snapshots = [];
  let probeHeader;
  const api = client({
    saveCookies: async snapshot => { snapshots.push(JSON.parse(JSON.stringify(snapshot))); },
    fetchImpl: async (url, init) => {
      if (pending.length >= 2) {
        probeHeader = init.headers.get('cookie');
        return response(url);
      }
      const result = deferred();
      pending.push({ url, sent: init.headers.get('cookie'), result });
      if (pending.length === 2) allStarted.resolve();
      return result.promise;
    },
  });
  const earlier = api.history('C-unit-chat');
  const later = api.members('C-unit-chat');
  await allStarted.promise;
  assert.equal(pending[0].sent, pending[1].sent);
  pending[1].result.resolve(response(pending[1].url, { cookies: [
    'ses=newer-unit-session; Path=/; Secure',
    'XSRF-TOKEN=newer-unit-csrf; Path=/; Secure',
  ] }));
  await later;
  pending[0].result.resolve(response(pending[0].url, { cookies: [
    'ses=late-unit-session; Path=/; Secure',
    'XSRF-TOKEN=late-unit-csrf; Path=/; Secure',
    'chat-device-group=106; Path=/; Secure',
  ] }));
  await earlier;
  await api.chats();
  assert.equal(values(probeHeader).ses, 'newer-unit-session');
  assert.equal(values(probeHeader)['XSRF-TOKEN'], 'newer-unit-csrf');
  assert.equal(values(probeHeader)['chat-device-group'], '106', 'independent nonconflicting cookie updates still apply');
  assert.equal(snapshots.length, 2);
  assert.ok(!JSON.stringify(snapshots).includes('late-unit-session'));
  assert.ok(!JSON.stringify(snapshots).includes('late-unit-csrf'));
});

test('a fresh configured secret wins over a snapshot from the previous secret after restart', async () => {
  let saved;
  const before = client({
    saveCookies: async snapshot => { saved = snapshot; },
    fetchImpl: async url => response(url, { cookies: ['ses=old-persisted-unit-session; Path=/; Secure'] }),
  });
  await before.chats();
  let sent;
  const after = client({
    cookie: SEED.replace('initial-unit-session', 'rotated-unit-session'), cookieSnapshot: saved,
    fetchImpl: async (url, init) => { sent = init.headers.get('cookie'); return response(url); },
  });
  await after.chats();
  assert.equal(values(sent).ses, 'rotated-unit-session');
  assert.ok(!sent.includes('old-persisted-unit-session'));
});

test('requests stay on the Chat origin with manual redirects and never follow a login Location', async () => {
  const calls = [];
  let saves = 0;
  const api = client({
    saveCookies: async () => { saves += 1; },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(new URL(url).origin, ORIGIN);
      assert.equal(init.redirect, 'manual');
      return response(url, { status: 302, location: 'https://account.line.biz/private-unit-location',
        cookies: ['tmp_idp-oauth2=ignored-unit-oauth; Path=/; Secure'] });
    },
  });
  await assert.rejects(api.history('C-unit-chat'), error => {
    assertSafeError(error, ['private-unit-location', 'ignored-unit-oauth']);
    assert.equal(error.status, 302);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(saves, 0);
  assert.equal(api.sessionMetadata().revision, 0);
});

test('a fetch adapter returning a foreign or insecure response URL cannot update Chat cookies', async () => {
  for (const foreignUrl of ['https://account.line.biz/redirected', 'https://chat.line.biz.attacker.invalid/', 'http://chat.line.biz/']) {
    let calls = 0, saves = 0;
    let nextHeader;
    const api = client({
      saveCookies: async () => { saves += 1; },
      fetchImpl: async (url, init) => {
        assert.equal(init.redirect, 'manual');
        calls += 1;
        if (calls === 1) return response(foreignUrl, { cookies: ['ses=foreign-unit-session; Path=/; Secure'] });
        nextHeader = init.headers.get('cookie');
        return response(url);
      },
    });
    await assert.rejects(api.chats(), error => assertSafeError(error, [foreignUrl, 'foreign-unit-session']));
    await api.chats();
    assert.equal(saves, 0);
    assert.equal(values(nextHeader).ses, 'initial-unit-session');
  }
});

test('refresh invalidates the cached CSRF token before the next authenticated write', async () => {
  const calls = [];
  let csrfCalls = 0;
  const api = client({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/csrfToken')) {
      csrfCalls += 1;
      return response(url, { body: { headerName: 'X-CSRF-TOKEN', token: `unit-csrf-${csrfCalls}` } });
    }
    if (url.includes('/messages?')) return response(url, { cookies: ['ses=renewed-unit-session; Path=/; Secure'] });
    return response(url, { body: { streamingApiToken: 'unit-stream-token' } });
  } });
  await api.csrf();
  await api.history('C-unit-chat');
  await api.streamToken();
  assert.equal(csrfCalls, 2);
  const write = calls.find(call => call.url.endsWith('/streamingApiToken'));
  assert.equal(write.init.headers.get('x-csrf-token'), 'unit-csrf-2');
  assert.equal(values(write.init.headers.get('cookie')).ses, 'renewed-unit-session');
});

test('a delayed CSRF response cannot cache a token for a cookie generation that was replaced in flight', async () => {
  const csrfStarted = deferred();
  const oldResponse = deferred();
  let csrfCalls = 0;
  let posted;
  const api = client({ fetchImpl: async (url, init) => {
    if (url.endsWith('/csrfToken')) {
      csrfCalls += 1;
      if (csrfCalls === 1) {
        csrfStarted.resolve(url);
        return oldResponse.promise;
      }
      return response(url, { body: { headerName: 'X-CSRF-TOKEN', token: 'fresh-session-unit-csrf' } });
    }
    if (url.includes('/messages?')) return response(url, { cookies: ['ses=replaced-in-flight-unit-session; Path=/; Secure'] });
    posted = { cookie: init.headers.get('cookie'), csrf: init.headers.get('x-csrf-token') };
    return response(url, { body: { streamingApiToken: 'unit-stream-token' } });
  } });
  const firstCsrf = api.csrf();
  const oldUrl = await csrfStarted.promise;
  await api.history('C-unit-chat');
  oldResponse.resolve(response(oldUrl, { body: { headerName: 'X-CSRF-TOKEN', token: 'old-session-unit-csrf' } }));
  await firstCsrf;
  await api.streamToken();
  assert.equal(values(posted.cookie).ses, 'replaced-in-flight-unit-session');
  assert.equal(posted.csrf, 'fresh-session-unit-csrf', 'a POST must not combine a refreshed cookie with a CSRF token from its predecessor');
  assert.equal(csrfCalls, 2);
});

test('upstream failures remain sanitized while a valid response cookie deletion is persisted', async () => {
  let saved;
  let call = 0;
  let nextHeader;
  const api = client({
    saveCookies: async snapshot => { saved = snapshot; },
    fetchImpl: async (url, init) => {
      call += 1;
      if (call === 1) return response(url, { status: 401, body: { error: 'private-upstream-unit-text' },
        cookies: ['__Host-chat-ses=; Path=/; Secure; Max-Age=0'] });
      nextHeader = init.headers.get('cookie');
      return response(url);
    },
  });
  await assert.rejects(api.history('C-unit-chat'), error => {
    assertSafeError(error, ['private-upstream-unit-text']);
    assert.equal(error.status, 401);
    return true;
  });
  assert.ok(saved);
  await api.history('C-unit-chat');
  assert.equal(values(nextHeader)['__Host-chat-ses'], undefined);
  assert.equal(values(nextHeader).ses, 'initial-unit-session');
});
