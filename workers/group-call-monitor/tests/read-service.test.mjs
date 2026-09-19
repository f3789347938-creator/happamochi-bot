import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReadCommand, ReadReceiptService } from '../read-service.mjs';

const CHAT = 'C0123456789abcdef0123456789abcdef';
const OTHER_CHAT = 'Cabcdef0123456789abcdef0123456789';
const BOT = 'Uabcdefabcdefabcdefabcdefabcdefab';
const ALICE = 'U11111111111111111111111111111111';
const BOB = 'U22222222222222222222222222222222';
const FORMER = 'U33333333333333333333333333333333';
const NOW = 1_789_835_500_000;
const options = { botId: BOT, now: NOW, cutoff: NOW - 60_000 };

function message(text = '既読確認', userId = ALICE, timestamp = NOW - 100) {
  return {
    event: 'chat', subEvent: 'message', botId: BOT, chatId: CHAT,
    payload: { type: 'message', timestamp, source: { chatId: CHAT, userId },
      message: { type: 'textV2', text } },
  };
}

function receipt(userId = BOB) {
  return { event: 'chat', subEvent: 'chatRead', botId: BOT, chatId: CHAT,
    payload: { type: 'chatRead', timestamp: NOW - 50,
      source: { chatId: CHAT, userId }, read: { watermark: NOW - 75 } } };
}

function fixture({ store: overrides = {}, client: clientOverrides = {}, config = {} } = {}) {
  const calls = { claimed: [], sessions: [], receipts: [], recorded: [], sending: [], sent: [], finished: [], members: [] };
  const claimed = new Set();
  const store = {
    async claimCommand(command, now) {
      calls.claimed.push({ command, now });
      if (claimed.has(command.eventId)) return null;
      claimed.add(command.eventId);
      return { chat_id: command.chatId, user_id: command.userId, event_id: command.eventId,
        action: command.action, send_id: `send-${command.eventId}` };
    },
    async getSession(chatId, now) {
      calls.sessions.push({ chatId, now });
      return { checkpoint_at: NOW - 1000 };
    },
    async listReceipts(chatId, now) {
      calls.receipts.push({ chatId, now });
      return [{ user_id: BOB }];
    },
    async recordReceipt(...args) { calls.recorded.push(args); },
    async markSending(row, text, now) { calls.sending.push({ row, text, now }); return true; },
    async finishCommand(row, status, error, now) { calls.finished.push({ row, status, error, now }); },
    ...overrides,
  };
  const client = {
    async members(chatId, paging) {
      calls.members.push({ chatId, paging });
      return { list: [{ userId: ALICE, name: 'もち' }, { userId: BOB, name: 'はっぱ' }] };
    },
    async sendText(chatId, text, sendId) { calls.sent.push({ chatId, text, sendId }); },
    ...clientOverrides,
  };
  return { calls, store, client, service: new ReadReceiptService(store, client, { botId: BOT, enabled: true, scope: CHAT, ...config }) };
}

test('recognizes only the three exact commands from current human text messages', () => {
  for (const [text, action] of [['既読セット', 'start'], ['既読確認', 'list'], ['既読終了', 'stop']]) {
    for (const type of ['text', 'textV2']) {
      const event = message(` ${text}\n`);
      event.payload.message.type = type;
      assert.deepEqual(parseReadCommand(event, 'evt-1', options), {
        chatId: CHAT, userId: ALICE, eventId: 'evt-1', action, checkpointAt: NOW - 100, eventAt: NOW - 100,
      });
    }
  }
  for (const text of ['既読', '既読開始', '既読セットしてください', '既読確認\n既読終了', 'hello', '']) {
    assert.equal(parseReadCommand(message(text), 'evt-1', options), null);
  }
});

test('rejects own bot and OA send acknowledgements, even when text is a command', () => {
  for (const user of [BOT, BOT.toUpperCase(), BOT.toLowerCase()]) {
    assert.equal(parseReadCommand(message('既読セット', user), 'evt-1', options), null);
  }
  for (const field of ['sendId', 'bizId']) {
    const event = message();
    event.payload[field] = 'outgoing-message';
    assert.equal(parseReadCommand(event, 'evt-1', options), null);
  }
});

test('rejects mismatched bot/chat identity and non-group sources', () => {
  const events = [
    { ...message(), botId: ALICE }, { ...message(), chatId: OTHER_CHAT },
    { ...message(), event: 'other' }, { ...message(), subEvent: 'messageSent' },
  ];
  for (const userId of [undefined, null, '', ALICE + '1', 'user', 123]) {
    const event = message(); event.payload.source.userId = userId; events.push(event);
  }
  for (const chatId of [ALICE, 'R' + '1'.repeat(32), '', 'C123']) {
    const event = message(); event.chatId = event.payload.source.chatId = chatId; events.push(event);
  }
  const mismatch = message(); mismatch.payload.source.chatId = OTHER_CHAT; events.push(mismatch);
  for (const event of events) assert.equal(parseReadCommand(event, 'evt-1', options), null);
});

test('command replay cutoff and freshness are independent and bound future timestamps', () => {
  assert.ok(parseReadCommand(message('既読セット', ALICE, NOW - 60_000), 'evt', options));
  assert.equal(parseReadCommand(message('既読セット', ALICE, NOW - 60_001), 'evt', options), null);
  assert.ok(parseReadCommand(message('既読セット', ALICE, NOW - 900_000), 'evt', { ...options, cutoff: 0 }));
  assert.equal(parseReadCommand(message('既読セット', ALICE, NOW - 900_001), 'evt', { ...options, cutoff: 0 }), null);
  assert.ok(parseReadCommand(message('既読セット', ALICE, NOW + 300_000), 'evt', options));
  assert.equal(parseReadCommand(message('既読セット', ALICE, NOW + 300_001), 'evt', options), null);
});

test('rejects malformed messages, event IDs and timestamps without throwing', () => {
  for (const event of [null, undefined, [], 3, 'event', {}, { payload: null }, { payload: [] }]) {
    assert.equal(parseReadCommand(event, 'evt', options), null);
  }
  for (const eventId of [null, undefined, '', 'x'.repeat(257), 'bad\nID', 'a/b', 42]) {
    assert.equal(parseReadCommand(message(), eventId, options), null);
  }
  for (const timestamp of [undefined, null, -1, 0, '123', 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const event = message(); event.payload.timestamp = timestamp;
    assert.equal(parseReadCommand(event, 'evt', options), null);
  }
  for (const value of [null, [], { type: 'image', text: '既読確認' }, { type: 'textV2', text: 42 }]) {
    const event = message(); event.payload.message = value;
    assert.equal(parseReadCommand(event, 'evt', options), null);
  }
});

test('missing or malformed bot configuration cannot admit a command', () => {
  for (const botId of [undefined, null, '', 42, 'bot', ` ${BOT}`]) {
    const event = message(); event.botId = botId;
    assert.equal(parseReadCommand(event, 'evt', { ...options, botId }), null);
  }
});

test('service tolerates malformed event objects without any side effects', async () => {
  const f = fixture();
  for (const event of [null, undefined, [], 3, 'event', {}]) await f.service.receive(event, 'evt', options.cutoff, NOW);
  assert.equal(f.calls.claimed.length + f.calls.recorded.length + f.calls.members.length + f.calls.sent.length, 0);
});

test('disabled features and out-of-scope groups never claim commands, store receipts or send', async () => {
  for (const config of [{ enabled: false }, { scope: OTHER_CHAT }, { scope: '' }, { scope: undefined }]) {
    const f = fixture({ config });
    await f.service.receive(message('既読セット'), 'evt', options.cutoff, NOW);
    await f.service.receive(receipt(), 'read', options.cutoff, NOW);
    assert.equal(f.calls.claimed.length + f.calls.recorded.length + f.calls.members.length + f.calls.sent.length, 0);
  }
});

test('all scope and comma-separated allowlist accept the selected group', async () => {
  for (const scope of ['all', `${OTHER_CHAT}, ${CHAT}`]) {
    const f = fixture({ config: { scope } });
    await f.service.receive(message(), 'evt', options.cutoff, NOW);
    assert.equal(f.calls.sent.length, 1);
  }
});

test('receipt handling passes the exact observed watermark to the store and does not reply', async () => {
  const f = fixture();
  await f.service.receive(receipt(), 'read-1', options.cutoff, NOW);
  assert.deepEqual(f.calls.recorded, [[CHAT, BOB, NOW - 75, NOW - 50, NOW]]);
  assert.equal(f.calls.claimed.length + f.calls.sent.length + f.calls.members.length, 0);
});

test('manager read state, bot receipt and wrong-envelope receipt do not record readers', async () => {
  const f = fixture();
  for (const event of [{ ...receipt(), subEvent: 'read' }, receipt(BOT), { ...receipt(), botId: ALICE }, { ...receipt(), chatId: OTHER_CHAT }]) {
    await f.service.receive(event, 'read-1', options.cutoff, NOW);
  }
  assert.equal(f.calls.recorded.length + f.calls.claimed.length + f.calls.sent.length, 0);
});

test('set claims a group reset with the actor identity and a concise acknowledgement', async () => {
  const f = fixture();
  await f.service.receive(message('既読セット'), 'start-1', options.cutoff, NOW);
  assert.equal(f.calls.claimed[0].command.action, 'start');
  assert.equal(f.calls.claimed[0].command.userId, ALICE);
  assert.equal(f.calls.sent[0].sendId, 'send-start-1');
  assert.equal(f.calls.sent[0].text, 'もちさんが既読をセットしました。\n「既読確認」で名前を表示できます。');
  assert.equal(f.calls.sessions.length + f.calls.receipts.length, 0);
  assert.equal(f.calls.finished[0].status, 'sent');
});

test('different senders request the same group session and receive the same reader list', async () => {
  const f = fixture();
  await f.service.receive(message('既読確認', ALICE), 'alice-list', options.cutoff, NOW);
  await f.service.receive(message('既読確認', BOB), 'bob-list', options.cutoff, NOW);
  assert.deepEqual(f.calls.sessions, [{ chatId: CHAT, now: NOW }, { chatId: CHAT, now: NOW }]);
  assert.deepEqual(f.calls.receipts, [{ chatId: CHAT, now: NOW }, { chatId: CHAT, now: NOW }]);
  assert.match(f.calls.sent[0].text, /^このグループの既読確認\nセット：/);
  assert.equal(f.calls.sent[0].text, f.calls.sent[1].text);
});

test('unset group provides the set instruction without listing receipts', async () => {
  const f = fixture({ store: { async getSession() { return null; } } });
  await f.service.receive(message(), 'inactive', options.cutoff, NOW);
  assert.equal(f.calls.sent[0].text, 'このグループには既読がセットされていません。\n「既読セット」と送ってください。');
  assert.equal(f.calls.receipts.length, 0);
});

test('stop retains the actor identity in its claim and acknowledges the group stop', async () => {
  const f = fixture();
  await f.service.receive(message('既読終了', BOB), 'stop-1', options.cutoff, NOW);
  assert.deepEqual([f.calls.claimed[0].command.userId, f.calls.claimed[0].command.action], [BOB, 'stop']);
  assert.equal(f.calls.sent[0].text, 'このグループの既読記録を停止しました。');
});

test('replayed command is neither formatted again nor sent twice', async () => {
  const f = fixture();
  await f.service.receive(message('既読セット'), 'same', options.cutoff, NOW);
  await f.service.receive(message('既読セット'), 'same', options.cutoff, NOW);
  assert.equal(f.calls.claimed.length, 2);
  assert.equal(f.calls.members.length, 1);
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.calls.finished.length, 1);
});

test('stale set and stop acknowledge that no change was applied without claiming success', async () => {
  for (const text of ['既読セット', '既読終了']) {
    const f = fixture({ store: { async claimCommand(command) {
      return { chat_id: command.chatId, user_id: command.userId, event_id: command.eventId,
        action: command.action, send_id: 'send-stale', applied: 0 };
    } } });
    await f.service.receive(message(text), 'stale', options.cutoff, NOW);
    assert.equal(f.calls.sent.length, 1);
    assert.equal(f.calls.sent[0].text, '新しい既読設定があるため、この操作では変更しませんでした。');
    assert.equal(f.calls.members.length + f.calls.sessions.length + f.calls.receipts.length, 0);
    assert.equal(f.calls.sending[0].row.applied, 0);
    assert.equal(f.calls.finished[0].status, 'sent');
    assert.equal(f.calls.finished[0].error, null);
  }
});

test('losing the atomic send claim causes no network send or finish transition', async () => {
  const f = fixture({ store: { async markSending() { return false; } } });
  await f.service.receive(message(), 'lost', options.cutoff, NOW);
  assert.equal(f.calls.sent.length + f.calls.finished.length, 0);
});

test('send timeout is uncertain and a replay cannot blindly retry it', async () => {
  let attempts = 0;
  const f = fixture({ client: { async sendText() { attempts++; throw new Error('private transport detail'); } } });
  await f.service.receive(message(), 'timeout', options.cutoff, NOW);
  await f.service.receive(message(), 'timeout', options.cutoff, NOW);
  assert.equal(attempts, 1);
  assert.equal(f.calls.finished.length, 1);
  assert.deepEqual([f.calls.finished[0].status, f.calls.finished[0].error], ['uncertain', 'send_error']);
});

test('definite HTTP rejection is failed; auth/rate failures propagate to monitor backoff', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const error = Object.assign(new Error('private response'), { status });
    const f = fixture({ client: { async sendText() { throw error; } } });
    const run = f.service.receive(message(), `http-${status}`, options.cutoff, NOW);
    if ([401, 403, 429].includes(status)) await assert.rejects(run, value => value === error);
    else await run;
    assert.equal(f.calls.finished[0].status, status < 500 ? 'failed' : 'uncertain');
    assert.equal(f.calls.finished[0].error, `line_http_${status}`);
  }
});

test('lists only current verified member names, deduplicating receipts and avoiding raw IDs', async () => {
  const f = fixture({ store: { async listReceipts() { return [{ user_id: BOB }, { user_id: FORMER }, { user_id: BOB }]; } } });
  await f.service.receive(message(), 'names', options.cutoff, NOW);
  const text = f.calls.sent[0].text;
  assert.ok(text.includes('既読が確認できた人（1人）'));
  assert.equal(text.split('・はっぱ').length - 1, 1);
  for (const id of [ALICE, BOB, FORMER]) assert.equal(text.includes(id), false);
});

test('member pagination covers later readers and rejects looping cursors', async () => {
  const requests = [];
  const f = fixture({ client: { async members(chat, { next }) {
    requests.push(next);
    return next ? { list: [{ userId: BOB, name: 'second page' }] } : { list: [{ userId: ALICE, name: 'first page' }], next: 'page2' };
  } } });
  await f.service.receive(message(), 'pages', options.cutoff, NOW);
  assert.deepEqual(requests, [undefined, 'page2']);
  assert.ok(f.calls.sent[0].text.includes('・second page'));
  let attempts = 0;
  const broken = fixture({ client: { async members() { attempts++; return { list: [], next: 'same' }; } } });
  await broken.service.receive(message(), 'loop', options.cutoff, NOW);
  assert.equal(attempts, 2);
  assert.ok(broken.calls.sent[0].text.includes('名前を取得できませんでした'));
});

test('member API failures return useful recovery text without leaking exception details', async () => {
  const f = fixture({ client: { async members() { throw new Error('secret cookie and raw body'); } } });
  await f.service.receive(message(), 'member-error', options.cutoff, NOW);
  assert.ok(f.calls.sent[0].text.includes('「既読確認」'));
  assert.equal(f.calls.sent[0].text.includes('secret'), false);
  assert.equal(f.calls.finished[0].status, 'sent');
});

test('actor and reader names are single line, bounded, and cannot inject extra result lines', async () => {
  const f = fixture({ client: { async members() { return { list: [
    { userId: ALICE, name: '\u202eOWNER\u2028FORGED\n' + '🌿'.repeat(100) },
    { userId: BOB, name: 'reader\r\nFAKE\u2029LINE' },
  ] }; } } });
  await f.service.receive(message(), 'unsafe-names', options.cutoff, NOW);
  await f.service.receive(message('既読セット'), 'unsafe-actor', options.cutoff, NOW);
  const text = f.calls.sent[0].text;
  assert.ok(text.includes('・reader FAKE LINE'));
  assert.match(f.calls.sent[1].text, /^OWNER FORGED /);
  for (const { text: reply } of f.calls.sent) {
    assert.equal(/[\u2028\u2029\u202e]/u.test(reply), false);
    assert.ok(reply.length < 1000);
    assert.equal(reply.isWellFormed(), true);
  }
});

test('large reader groups stay under LINE text limits while reporting omitted count', async () => {
  const members = Array.from({ length: 500 }, (_, i) => ({ userId: `U${(i + 1).toString(16).padStart(32, '0')}`, name: '🌿'.repeat(100) }));
  members.push({ userId: ALICE, name: 'owner' });
  const f = fixture({
    store: { async listReceipts() { return members.slice(0, 500).map(x => ({ user_id: x.userId })); } },
    client: { async members() { return { list: members }; } },
  });
  await f.service.receive(message(), 'large', options.cutoff, NOW);
  const text = f.calls.sent[0].text;
  assert.ok(text.includes('既読が確認できた人（500人）'));
  assert.ok(text.includes('ほか460人'));
  assert.ok(text.length < 5000);
  assert.equal(text.isWellFormed(), true);
});
