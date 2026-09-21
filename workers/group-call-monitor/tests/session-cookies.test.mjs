import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { SessionCookies } from '../session-cookies.mjs';

const NOW = Date.parse('2026-09-21T03:00:00.000Z');
const SEED = 'ses=seed-session-value; __Host-chat-ses=seed-host-value; XSRF-TOKEN=seed-csrf-value; chat-device-group=105; analytics=preserved-seed-value';
const jar = (options = {}) => new SessionCookies({ cookie: SEED, now: NOW, ...options });
const values = header => Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const split = part.indexOf('=');
  return [part.slice(0, split), part.slice(split + 1)];
}));
const headers = (...cookies) => {
  const result = new Headers();
  for (const value of cookies) result.append('set-cookie', value);
  return result;
};
const rawHeaders = (...cookies) => ({ getSetCookie: () => cookies });
const copySnapshot = source => JSON.parse(JSON.stringify(source.snapshot()));

test('the seed keeps existing cookies and an empty response changes nothing', () => {
  const session = jar();
  assert.deepEqual(values(session.header(NOW)), values(SEED));
  assert.equal(session.accept(new Headers(), session.header(NOW), NOW), false);
  assert.deepEqual(values(session.header(NOW)), values(SEED));
});

test('existing visible-ASCII tracker values remain compatible without making tracker cookies refreshable', () => {
  const cookie = 'ses=seed-session; tracker={"sid":"unit-test","sq":16}; theme=light';
  const session = jar({ cookie });
  assert.deepEqual(values(session.header(NOW)), values(cookie));
  assert.equal(session.accept(headers('tracker=replaced; Path=/; Secure', 'theme=dark; Path=/; Secure'), cookie, NOW), false);
  assert.deepEqual(values(session.header(NOW)), values(cookie));
});

test('only session, host session, CSRF and device cookies can refresh, while unrelated seed cookies survive', () => {
  const session = jar();
  assert.equal(session.accept(headers(
    'ses=refreshed-session; Path=/; Secure; HttpOnly; SameSite=None',
    '__Host-chat-ses=refreshed-host; Path=/; Secure; HttpOnly',
    'XSRF-TOKEN=refreshed%2Fcsrf%3D; Path=/; Secure',
    'chat-device-group=106; Path=/; Secure',
    'analytics=hostile-replacement; Path=/; Secure',
    'new-tracker=not-allowed; Path=/; Secure',
  ), SEED, NOW), true);
  assert.deepEqual(values(session.header(NOW)), {
    ses: 'refreshed-session', '__Host-chat-ses': 'refreshed-host',
    'XSRF-TOKEN': 'refreshed%2Fcsrf%3D', 'chat-device-group': '106', analytics: 'preserved-seed-value',
  });
});

test('session cookies accept only the permitted LINE domains and explicit secure root path', () => {
  for (const domain of ['', 'chat.line.biz', '.chat.line.biz', 'line.biz', '.line.biz']) {
    const session = jar();
    const scope = domain ? `; Domain=${domain}` : '';
    assert.equal(session.accept(headers(`ses=allowed-value; Path=/; Secure${scope}`), SEED, NOW), true, domain || 'host-only');
    assert.equal(values(session.header(NOW)).ses, 'allowed-value');
  }
  for (const attributes of [
    'Path=/; Secure; Domain=attacker.invalid',
    'Path=/; Secure; Domain=chat.line.biz.attacker.invalid',
    'Path=/; Secure; Domain=evil-line.biz',
    'Path=/; Secure; Domain=biz',
    'Path=/; Secure; Domain=other.line.biz',
    'Path=/; Secure; Domain=chat.line.biz.',
    'Secure', 'Path=/api; Secure', 'Path=//; Secure', 'Path=; Secure', 'Path=/',
  ]) {
    const session = jar();
    assert.equal(session.accept(headers(`ses=rejected-value; ${attributes}`), SEED, NOW), false, attributes);
    assert.equal(values(session.header(NOW)).ses, 'seed-session-value');
  }
});

test('__Host-chat-ses rejects every Domain attribute, including an otherwise permitted LINE domain', () => {
  for (const domain of ['', 'chat.line.biz', '.chat.line.biz', 'line.biz', '.line.biz']) {
    const session = jar();
    assert.equal(session.accept(headers(`__Host-chat-ses=bad-host-value; Path=/; Secure; Domain=${domain}`), SEED, NOW), false);
    assert.equal(values(session.header(NOW))['__Host-chat-ses'], 'seed-host-value');
  }
});

test('Max-Age takes precedence over Expires and expiry is enforced at the exact boundary', () => {
  const session = jar();
  assert.equal(session.accept(headers('ses=short-lived; Path=/; Secure; Max-Age=60; Expires=Sat, 01 Jan 2000 00:00:00 GMT'), SEED, NOW), true);
  assert.equal(values(session.header(NOW + 59_999)).ses, 'short-lived');
  assert.equal(values(session.header(NOW + 60_000)).ses, undefined);
  assert.equal(values(session.header(NOW + 60_000))['__Host-chat-ses'], 'seed-host-value');
  const byDate = jar();
  const expiry = new Date(NOW + 120_000).toUTCString();
  byDate.accept(headers(`XSRF-TOKEN=expires-token; Path=/; Secure; Expires=${expiry}`), SEED, NOW);
  assert.equal(values(byDate.header(NOW + 119_999))['XSRF-TOKEN'], 'expires-token');
  assert.equal(values(byDate.header(NOW + 120_000))['XSRF-TOKEN'], undefined);
});

test('zero or negative Max-Age and past Expires delete cookies without deleting unrelated credentials', () => {
  for (const attributes of [
    'Max-Age=0; Expires=Tue, 22 Sep 2026 03:00:00 GMT',
    'Max-Age=-1',
    'Expires=Sat, 01 Jan 2000 00:00:00 GMT',
  ]) {
    const session = jar();
    assert.equal(session.accept(headers(`ses=deleted; Path=/; Secure; ${attributes}`), SEED, NOW), true);
    assert.equal(values(session.header(NOW)).ses, undefined);
    assert.equal(values(session.header(NOW))['__Host-chat-ses'], 'seed-host-value');
    assert.equal(values(session.header(NOW)).analytics, 'preserved-seed-value');
  }
});

test('a refreshed snapshot restores state and expiry for the same configured seed', () => {
  const session = jar();
  session.accept(headers('ses=persisted-session; Path=/; Secure; Max-Age=60', 'XSRF-TOKEN=persisted-csrf; Path=/; Secure'), SEED, NOW);
  const saved = copySnapshot(session);
  const restored = jar({ snapshot: saved, now: NOW + 30_000 });
  assert.equal(values(restored.header(NOW + 30_000)).ses, 'persisted-session');
  assert.equal(values(restored.header(NOW + 30_000))['XSRF-TOKEN'], 'persisted-csrf');
  const expired = jar({ snapshot: saved, now: NOW + 60_000 });
  assert.equal(values(expired.header(NOW + 60_000)).ses, undefined, 'an expired persisted cookie must not fall back to the old seed');
  assert.equal(values(expired.header(NOW + 60_000))['XSRF-TOKEN'], 'persisted-csrf');
});

test('snapshot deletion survives restoration instead of reviving the original seed value', () => {
  const session = jar();
  session.accept(headers('__Host-chat-ses=; Path=/; Secure; Max-Age=0'), SEED, NOW);
  const restored = jar({ snapshot: copySnapshot(session), now: NOW + 1000 });
  assert.equal(values(restored.header(NOW + 1000))['__Host-chat-ses'], undefined);
  assert.equal(values(restored.header(NOW + 1000)).ses, 'seed-session-value');
});

test('rotating the configured seed discards an old persisted session completely', () => {
  const session = jar();
  session.accept(headers('ses=old-persisted-value; Path=/; Secure', 'XSRF-TOKEN=old-persisted-csrf; Path=/; Secure'), SEED, NOW);
  const newSeed = SEED.replace('seed-session-value', 'new-configured-session');
  const restored = jar({ cookie: newSeed, snapshot: copySnapshot(session), now: NOW + 1000 });
  assert.deepEqual(values(restored.header(NOW + 1000)), values(newSeed));
});

test('malformed persisted snapshots are ignored without disturbing the configured credentials', () => {
  for (const snapshot of [null, [], {}, 'invalid-json', { version: 999, seedCookie: SEED, updates: [] }]) {
    const restored = jar({ snapshot });
    assert.deepEqual(values(restored.header(NOW)), values(SEED));
  }
});

test('snapshot credentials are validated before restore and malformed records cannot partially replace the seed', () => {
  const session = jar();
  session.accept(headers('ses=valid-persisted-value; Path=/; Secure', 'XSRF-TOKEN=valid-persisted-csrf; Path=/; Secure'), SEED, NOW);
  for (const patch of [
    { name: 'unapproved-cookie' }, { value: 'secret\r\nHost: attacker.invalid' },
    { value: 'has a space' }, { domain: 'attacker.invalid' },
    { hostOnly: true, domain: 'line.biz' }, { path: '/api' }, { secure: false },
    { expiresAt: 'tomorrow' }, { updatedAt: -1 },
  ]) {
    const snapshot = copySnapshot(session);
    Object.assign(snapshot.updates[1], patch);
    const restored = jar({ snapshot });
    assert.deepEqual(values(restored.header(NOW)), values(SEED));
  }
});

test('snapshots are detached from live state and canonical seed ordering does not discard valid refreshes', () => {
  const session = jar();
  session.accept(headers('ses=detached-session; Path=/; Secure'), SEED, NOW);
  const saved = session.snapshot();
  const reorderedSeed = SEED.split('; ').reverse().join('; ');
  const restored = jar({ cookie: reorderedSeed, snapshot: saved });
  saved.updates[0].value = 'externally-mutated-value';
  assert.equal(values(session.header(NOW)).ses, 'detached-session');
  assert.equal(values(restored.header(NOW)).ses, 'detached-session');
});

test('late responses compare each cookie with the sent header and cannot roll a newer refresh back', () => {
  const session = jar();
  const sent = session.header(NOW);
  session.accept(headers('ses=new-session; Path=/; Secure', 'XSRF-TOKEN=new-csrf; Path=/; Secure'), sent, NOW + 1);
  assert.equal(session.accept(headers(
    'ses=stale-session; Path=/; Secure',
    'XSRF-TOKEN=stale-csrf; Path=/; Secure',
    'chat-device-group=106; Path=/; Secure',
  ), sent, NOW + 2), true, 'a nonconflicting device update can still be accepted');
  assert.equal(values(session.header(NOW + 2)).ses, 'new-session');
  assert.equal(values(session.header(NOW + 2))['XSRF-TOKEN'], 'new-csrf');
  assert.equal(values(session.header(NOW + 2))['chat-device-group'], '106');
  assert.equal(session.accept(headers('ses=stale-again; Path=/; Secure'), sent, NOW + 3), false);
  const newestSent = session.header(NOW + 3);
  assert.equal(session.accept(headers('ses=next-session; Path=/; Secure'), newestSent, NOW + 4), true);
  assert.equal(values(session.header(NOW + 4)).ses, 'next-session');
});

test('a stale response cannot delete a refreshed cookie or resurrect a deleted cookie', () => {
  const session = jar();
  session.accept(headers('ses=new-session; Path=/; Secure'), SEED, NOW + 1);
  assert.equal(session.accept(headers('ses=; Path=/; Secure; Max-Age=0'), SEED, NOW + 2), false);
  assert.equal(values(session.header(NOW + 2)).ses, 'new-session');
  const sent = session.header(NOW + 2);
  assert.equal(session.accept(headers('ses=; Path=/; Secure; Max-Age=0'), sent, NOW + 3), true);
  assert.equal(session.accept(headers('ses=stale-revival; Path=/; Secure'), sent, NOW + 4), false);
  assert.equal(values(session.header(NOW + 4)).ses, undefined);
});

test('previously absent allowed cookies refresh once even when multiple responses used the same seed header', () => {
  const session = jar({ cookie: 'ses=only-seed' });
  const sent = session.header(NOW);
  assert.equal(session.accept(headers('XSRF-TOKEN=first-new-token; Path=/; Secure'), sent, NOW), true);
  assert.equal(session.accept(headers('XSRF-TOKEN=late-new-token; Path=/; Secure'), sent, NOW + 1), false);
  assert.equal(values(session.header(NOW + 1))['XSRF-TOKEN'], 'first-new-token');
});

test('a request made before cookie expiry can refresh after expiry when no newer response changed that cookie', () => {
  const session = jar();
  session.accept(headers('ses=short-session; Path=/; Secure; Max-Age=1'), SEED, NOW);
  const sent = session.header(NOW + 500);
  assert.equal(values(session.header(NOW + 1000)).ses, undefined);
  assert.equal(session.accept(headers('ses=renewed-after-expiry; Path=/; Secure; Max-Age=60'), sent, NOW + 1500), true);
  assert.equal(values(session.header(NOW + 1500)).ses, 'renewed-after-expiry');
});

test('all supported Set-Cookie header APIs preserve separate cookies and Expires commas', () => {
  const entries = [
    'ses=combined-session; Path=/; Secure; Expires=Tue, 22 Sep 2026 03:00:00 GMT',
    'XSRF-TOKEN=combined%3Dcsrf; Path=/; Secure',
    '__Host-chat-ses=combined-host; Path=/; Secure; Expires=Wed, 23 Sep 2026 03:00:00 GMT',
  ];
  const carriers = [
    headers(...entries),
    { getAll: name => name.toLowerCase() === 'set-cookie' ? entries : [] },
    { get: name => name.toLowerCase() === 'set-cookie' ? entries.join(', ') : null },
  ];
  for (const carrier of carriers) {
    const session = jar();
    assert.equal(session.accept(carrier, SEED, NOW), true);
    const result = values(session.header(NOW));
    assert.equal(result.ses, 'combined-session');
    assert.equal(result['XSRF-TOKEN'], 'combined%3Dcsrf');
    assert.equal(result['__Host-chat-ses'], 'combined-host');
    assert.equal(result.analytics, 'preserved-seed-value');
  }
});

test('unsupported header getter methods fall back safely to the combined header API', () => {
  const session = jar();
  const carrier = {
    getSetCookie() { throw new TypeError('not supported'); },
    getAll() { throw new TypeError('not supported'); },
    get(name) { return name.toLowerCase() === 'set-cookie' ? 'ses=fallback-session; Path=/; Secure' : null; },
  };
  assert.equal(session.accept(carrier, SEED, NOW), true);
  assert.equal(values(session.header(NOW)).ses, 'fallback-session');
});

test('unsafe seed headers are rejected without echoing their contents in errors', () => {
  for (const cookie of [
    'ses=sensitive-unit-value\r\nHost: attacker.invalid',
    'ses=sensitive-unit-value\nX-Evil: injected',
    'ses=sensitive-unit-value\u0000',
    'ses=秘密-sensitive-unit-value',
  ]) {
    assert.throws(() => jar({ cookie }), error => {
      assert.ok(!String(error).includes('sensitive-unit-value'));
      assert.ok(!inspect(error).includes('sensitive-unit-value'));
      return true;
    });
  }
});

test('unsafe response cookie values and attributes cannot inject a request header', () => {
  for (const value of [
    'ses=sensitive-unit-value\r\nX-Evil: injected; Path=/; Secure',
    'ses=sensitive-unit-value\u0000; Path=/; Secure',
    'ses=秘密-sensitive-unit-value; Path=/; Secure',
    'ses=has a space; Path=/; Secure',
    'ses="; Path=/; Secure',
    'ses="unclosed-value; Path=/; Secure',
    'ses=unexpected-quote"; Path=/; Secure',
    'ses=value; Path=/; Secure\r\nX-Evil: injected',
  ]) {
    const session = jar();
    assert.equal(session.accept(rawHeaders(value), SEED, NOW), false);
    assert.deepEqual(values(session.header(NOW)), values(SEED));
  }
});

test('metadata, JSON and inspection hide secret values; only the intentional snapshot includes restorable secrets', () => {
  const session = jar();
  session.accept(headers('ses=private-refreshed-value; Path=/; Secure; Max-Age=60'), SEED, NOW);
  const diagnostics = `${JSON.stringify(session.metadata(NOW))}\n${inspect(session.metadata(NOW))}\n${JSON.stringify(session)}\n${inspect(session)}`;
  for (const forbidden of ['seed-session-value', 'seed-host-value', 'seed-csrf-value', 'preserved-seed-value', 'private-refreshed-value']) {
    assert.ok(!diagnostics.includes(forbidden), `diagnostics must not contain ${forbidden}`);
  }
  assert.equal(JSON.stringify(session), '{}');
  assert.ok(JSON.stringify(session.snapshot()).includes('private-refreshed-value'), 'snapshot is intentionally secret-bearing persistence data');
});
