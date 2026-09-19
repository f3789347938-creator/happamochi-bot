import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { OaApiError, OaClient, parseSse } from '../oa-client.mjs';

const encoder = new TextEncoder();
const cookie = 'ses=unit-test-session';
const json = (value, init) => new Response(JSON.stringify(value), init);
const makeClient = fetchImpl => new OaClient({ botId: 'Ubot_123', cookie, fetchImpl });
const csrfResult = { headerName: 'X-Returned-XSRF-Token', token: 'unit-test-csrf' };

function byteStream(chunks, onCancel) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index === chunks.length) controller.close();
      else controller.enqueue(typeof chunks[index] === 'string' ? encoder.encode(chunks[index++]) : chunks[index++]);
    },
    cancel: onCancel,
  });
}

async function collect(stream) {
  const result = [];
  for await (const frame of parseSse(stream)) result.push(frame);
  return result;
}

function isSafeError(status, operation, forbidden = 'secret-response') {
  return error => {
    assert.ok(error instanceof OaApiError);
    assert.equal(error.status, status);
    assert.equal(error.operation, operation);
    assert.equal(error.cause, undefined);
    assert.ok(!inspect(error).includes(forbidden));
    assert.ok(!JSON.stringify(error).includes(forbidden));
    return true;
  };
}

test('constructor rejects invalid cookies without echoing them; object inspection hides credentials', () => {
  for (const invalidCookie of ['', 'secret-response', 'ses=secret-response\r\nHost: attacker.invalid', 'ses=秘密']) {
    assert.throws(() => new OaClient({ botId: 'Ubot', cookie: invalidCookie }), isSafeError(0, 'configuration'));
  }
  assert.throws(() => new OaClient({ botId: '../other', cookie }), isSafeError(0, 'configuration'));
  const client = makeClient(() => {});
  assert.equal(JSON.stringify(client), '{}');
  assert.ok(!inspect(client).includes('unit-test-session'));
});

test('history uses current route, opaque backward query and bounded page size', async () => {
  let called = 0;
  const envelope = { list: [{ message: { type: 'callHistory', duration: 7891 } }], backward: 'older' };
  const client = makeClient(async (url, init) => {
    called++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://chat.line.biz');
    assert.equal(parsed.pathname, '/api/v3/bots/Ubot_123/chats/Cgroup_1/messages');
    assert.equal(parsed.searchParams.get('backward'), 'opaque+/=?&next=bad');
    assert.equal(parsed.searchParams.get('limit'), '25');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.get('cookie'), cookie);
    assert.equal(init.headers.get('origin'), 'https://chat.line.biz');
    assert.equal(init.headers.get('referer'), 'https://chat.line.biz/');
    assert.equal(init.headers.get('x-oa-chat-client-version'), '20240513144702');
    assert.match(init.headers.get('user-agent'), /Mozilla\/5\.0/);
    assert.equal(init.headers.get('authorization'), null);
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    return json(envelope);
  });
  assert.deepEqual(await client.history('Cgroup_1', { backward: 'opaque+/=?&next=bad', limit: 25 }), envelope);
  assert.equal(called, 1);
  assert.throws(() => client.history('Cgroup_1', { limit: 101 }), isSafeError(0, 'history'));
  assert.throws(() => client.history('../other'), isSafeError(0, 'history'));
});

test('chats uses ALL, no pinned priority and encoded next cursor', async () => {
  const rows = { list: [{ chatId: 'group', chatType: 'GROUP' }, { chatId: 'user', chatType: 'USER' }], next: 'next-page' };
  const client = makeClient(async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/api/v2/bots/Ubot_123/chats');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      folderType: 'ALL', tagIds: '', autoTagIds: '', prioritizePinnedChat: 'false', limit: '25', next: 'page+/==',
    });
    return json(rows);
  });
  assert.deepEqual(await client.chats({ next: 'page+/==' }), rows);
  assert.throws(() => client.chats({ limit: 50 }), isSafeError(0, 'chats'));
});

test('streamToken obtains returned CSRF header and sends POST with no body', async () => {
  const calls = [];
  const token = { streamingApiToken: 'dummy-token', lastEventId: 'cursor', streamingApiVersion: 'v2' };
  const client = makeClient(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/csrfToken')) return json(csrfResult);
    assert.equal(init.method, 'POST');
    assert.equal('body' in init, false);
    assert.equal(init.headers.get('content-type'), null);
    assert.equal(init.headers.get(csrfResult.headerName), csrfResult.token);
    return json(token);
  });
  assert.deepEqual(await client.streamToken(), token);
  assert.deepEqual(await client.streamToken(), token);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.method, 'GET');
  assert.ok(calls[1].url.endsWith('/api/v1/bots/Ubot_123/streamingApiToken'));
});

test('concurrent POSTs share CSRF retrieval; explicit csrf refreshes', async () => {
  let csrfCalls = 0;
  const client = makeClient(async url => {
    if (url.endsWith('/csrfToken')) { csrfCalls++; return json(csrfResult); }
    return json({ streamingApiToken: 'dummy-token' });
  });
  await Promise.all([client.streamToken(), client.streamToken()]);
  assert.equal(csrfCalls, 1);
  const returned = await client.csrf();
  returned.token = 'tampered';
  assert.equal(csrfCalls, 2);
  await client.streamToken();
  assert.equal(csrfCalls, 2);
});

test('CSRF response cannot override sensitive headers or contain control characters', async () => {
  for (const result of [
    { headerName: 'Cookie', token: 'secret-response' },
    { headerName: 'X-XSRF-TOKEN', token: 'secret-response\nmalicious' },
    { data: csrfResult },
  ]) {
    let calls = 0;
    const client = makeClient(async () => { calls++; return json(result); });
    await assert.rejects(client.streamToken(), isSafeError(200, 'csrf'));
    assert.equal(calls, 1);
  }
});

test('stream URL uses response version and opaque encoded token/cursor', () => {
  const client = makeClient(() => {});
  const url = new URL(client.streamUrl({
    streamingApiToken: 'token+/=&value', streamingApiVersion: 'v2', streamingApiBaseUrl: 'https://chat-streaming-api.line.biz', lastEventId: 'server-head',
  }, 'saved+/=?cursor'));
  assert.equal(url.pathname, '/api/v2/sse');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    token: 'token+/=&value', deviceType: '', clientType: 'PC', pingSecs: '20', lastEventId: 'saved+/=?cursor',
  });
  const defaults = new URL(client.streamUrl({ streamingApiToken: 'token', lastEventId: 'server-head' }));
  assert.equal(defaults.host, 'chat-streaming-api.line.biz');
  assert.equal(defaults.pathname, '/api/v1/sse');
  assert.equal(defaults.searchParams.get('lastEventId'), '');
});

test('stream URL rejects hostile origins, ports, credentials, paths and versions without revealing token', () => {
  const client = makeClient(() => {});
  for (const base of ['http://chat-streaming-api.line.biz', 'https://line.biz.attacker.invalid', 'https://evil-line.biz',
    'https://line.biz@attacker.invalid', 'https://attacker@line.biz', 'https://line.biz:8443',
    'https://line.biz/redirect', 'https://line.biz/?url=attacker', 'https://line.biz/#fragment', 'not-a-url']) {
    assert.throws(() => client.streamUrl({ streamingApiToken: 'secret-response', streamingApiBaseUrl: base }), isSafeError(0, 'streamUrl'));
  }
  assert.throws(() => client.streamUrl({ streamingApiToken: 'secret-response', streamingApiVersion: '../v2' }), isSafeError(0, 'streamUrl'));
});

test('sendText uses flat textV2, literal brace escaping and the supplied stable sendId', async () => {
  const bodies = [];
  const client = makeClient(async (url, init) => {
    if (url.endsWith('/csrfToken')) return json(csrfResult);
    assert.equal(new URL(url).pathname, '/api/v1/bots/Ubot_123/chats/Cgroup/messages/send');
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(init.headers.get(csrfResult.headerName), csrfResult.token);
    bodies.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(await client.sendText('Cgroup', '通話終了 {7秒}\n🙂', 'group_event:123'), {});
  assert.deepEqual(bodies, [{ id: '', type: 'textV2', text: '通話終了 {{7秒}}\n🙂', sendId: 'group_event:123' }]);
});

test('HTTP failures discard body; POST failure is not retried', async () => {
  let calls = 0;
  let canceled = false;
  const client = makeClient(async url => {
    calls++;
    if (url.endsWith('/csrfToken')) return json(csrfResult);
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 503 });
  });
  await assert.rejects(client.sendText('Cgroup', 'ended', 'send-1'), isSafeError(503, 'sendText'));
  assert.equal(calls, 2);
  assert.equal(canceled, true);
  const authClient = makeClient(async () => new Response('secret-response', { status: 401 }));
  await assert.rejects(authClient.history('Cgroup'), isSafeError(401, 'history'));
});

test('transport/redirect and invalid JSON exceptions cannot leak response fragments or credentials', async () => {
  const broken = makeClient(async () => { throw new Error('secret-response in https://private.invalid'); });
  await assert.rejects(broken.chats(), isSafeError(0, 'chats'));
  const invalidJson = makeClient(async () => new Response('secret-response: not JSON'));
  await assert.rejects(invalidJson.chats(), isSafeError(200, 'chats'));
});

test('JSON byte cap applies to advertised and streamed length, cancelling the body', async () => {
  let advertisedCanceled = false;
  const oversizedHeader = makeClient(async () => new Response(new ReadableStream({ cancel() { advertisedCanceled = true; } }), {
    headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
  }));
  await assert.rejects(oversizedHeader.chats(), isSafeError(200, 'chats'));
  assert.equal(advertisedCanceled, true);
  let streamedCanceled = false;
  const oversizedBody = makeClient(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { streamedCanceled = true; },
  })));
  await assert.rejects(oversizedBody.chats(), isSafeError(200, 'chats'));
  assert.equal(streamedCanceled, true);
});

test('bounded JSON decoding preserves UTF-8 split across network chunks', async () => {
  const raw = encoder.encode(JSON.stringify({ list: ['通話🙂'] }));
  const client = makeClient(async () => new Response(byteStream(Array.from(raw, byte => Uint8Array.of(byte)))));
  assert.deepEqual(await client.chats(), { list: ['通話🙂'] });
});

test('15-second timeout covers a fetch that never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const client = makeClient((_, init) => { signal = init.signal; return new Promise(() => {}); });
  const pending = assert.rejects(client.history('Cgroup'), isSafeError(0, 'history'));
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(signal.aborted, true);
});

test('15-second timeout also cancels a stalled response body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let canceled = false;
  const client = makeClient(async () => new Response(new ReadableStream({ cancel() { canceled = true; } })));
  const pending = assert.rejects(client.history('Cgroup'), isSafeError(0, 'history'));
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(canceled, true);
});

test('SSE UTF-8, CRLF and JSON spanning data lines survive single-byte chunks', async () => {
  const text = '\ufeff: hello\r\nid: evt-1\r\nevent: chat\r\ndata: {"message":"通話🙂",\r\ndata: "duration":7891}\r\n\r\n';
  const frames = await collect(byteStream(Array.from(encoder.encode(text), byte => Uint8Array.of(byte))));
  assert.deepEqual(frames, [{ id: 'evt-1', event: 'chat', data: '{"message":"通話🙂",\n"duration":7891}' }]);
  assert.equal(JSON.parse(frames[0].data).duration, 7891);
});

test('SSE supports bare CR and LF, ID inheritance/reset and ignores a NUL-containing ID', async () => {
  const frames = await collect(byteStream(['id: one\rdata: first\r\rid: bad\0id\ndata: second\n\nid:\ndata: third\n\ndata: fourth\n\n']));
  assert.deepEqual(frames, [
    { id: 'one', event: 'message', data: 'first' },
    { id: 'one', event: 'message', data: 'second' },
    { id: '', event: 'message', data: 'third' },
    { id: '', event: 'message', data: 'fourth' },
  ]);
});

test('SSE comments/control-only frames do not emit and unfinished EOF frames are discarded', async () => {
  const frames = await collect(byteStream([': ping\n\nid: cursor\nevent: old\nretry: 1000\n\ndata\n\ndata:  leading\n\ndata: unfinished\n']));
  assert.deepEqual(frames, [
    { id: 'cursor', event: 'message', data: '' },
    { id: 'cursor', event: 'message', data: ' leading' },
  ]);
  assert.deepEqual(await collect(byteStream(['data: complete\r\r'])), [{ id: '', event: 'message', data: 'complete' }]);
});

test('SSE frame byte cap rejects giant lines and many small lines before retaining excessive data', async () => {
  for (const input of ['data: ' + 'x'.repeat(512 * 1024), 'data: あ\n'.repeat(60_000)]) {
    let canceled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(input)); },
      cancel() { canceled = true; },
    });
    await assert.rejects(collect(stream), isSafeError(0, 'sse'));
    assert.equal(canceled, true);
  }
});

test('SSE cap resets between frames; consumer cancellation releases the stream', async () => {
  const content = 'x'.repeat(300_000);
  const frames = await collect(byteStream([`data: ${content}\n\ndata: ${content}\n\n`]));
  assert.equal(frames.length, 2);
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: first\n\ndata: second\n\n')); },
    cancel() { canceled = true; },
  });
  for await (const frame of parseSse(stream)) { assert.equal(frame.data, 'first'); break; }
  assert.equal(canceled, true);
  assert.equal(stream.locked, false);
});

test('SSE network errors are sanitized', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('secret-response')); } });
  await assert.rejects(collect(stream), isSafeError(0, 'sse'));
});

test('SSE control events can have non-JSON data without interrupting later chat events', async () => {
  const frames = await collect(byteStream(['event: ping\ndata: \n\nevent: reload\ndata: reload\n\nevent: chat\nid: one\ndata: {"event":"chat"}\n\n']));
  assert.deepEqual(frames, [
    { id: '', event: 'ping', data: '' },
    { id: '', event: 'reload', data: 'reload' },
    { id: 'one', event: 'chat', data: '{"event":"chat"}' },
  ]);
});
