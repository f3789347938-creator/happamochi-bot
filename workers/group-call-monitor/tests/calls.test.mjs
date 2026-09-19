import assert from "node:assert/strict";
import test from "node:test";
import { formatCallMessage, formatDuration, parseGroupCall } from "../calls.mjs";

const CHAT = "C0123456789abcdef0123456789abcdef";
const OTHER_CHAT = "Cabcdef0123456789abcdef0123456789";
const NOW = 1_789_835_500_000;
const LONG_ID = "632508022237167721";
const MAX_DURATION = 30 * 24 * 60 * 60 * 1000;

function fixture(message = {}, entry = {}) {
  return {
    timestamp: 1_789_835_463_933,
    message: { id: LONG_ID, type: "callHistory", serviceType: "GROUP_CALL", result: "INFO", version: "UNKNOWN", duration: 3129, ...message },
    ...entry,
  };
}

test("observed group-call end retains exact string ID and derives start only from duration", () => {
  const entry = fixture({}, { source: { userId: "not-retained" }, chatId: OTHER_CHAT });
  const call = parseGroupCall(entry, CHAT, { now: NOW });
  assert.deepEqual(call, {
    chatId: CHAT,
    messageId: LONG_ID,
    endedAt: 1_789_835_463_933,
    durationMs: 3129,
    startedAt: 1_789_835_460_804,
  });
  // The separately observed start was 10 ms later. Matching it is not required.
  assert.notEqual(call.startedAt, 1_789_835_460_814);
  assert.equal(entry.source.userId, "not-retained");
  assert.equal(formatCallMessage(call), "グループ通話が終了しました\n通話時間：3秒");
});

test("both observed durations are milliseconds, not seconds", () => {
  const call = parseGroupCall(fixture({ duration: 7891 }, { timestamp: 1_789_834_219_096 }), CHAT, { now: NOW });
  assert.equal(call.startedAt, 1_789_834_211_205);
  assert.equal(formatDuration(call.durationMs), "7秒");
});

test("start records, unrelated calls, and non-INFO results do not notify", async (t) => {
  const messages = [
    { duration: 0 },
    { type: "text" },
    { type: "CALL_HISTORY" },
    { serviceType: "AUDIO" },
    { serviceType: "VIDEO" },
    { serviceType: "PSTN" },
    { serviceType: undefined },
    ...["NORMAL", "FAIL", "CANCELED", "BUSY", "REJECTED", "NO_RESPONSE", undefined].map(result => ({ result })),
  ];
  for (const [index, message] of messages.entries()) {
    await t.test(`excluded message ${index}`, () => assert.equal(parseGroupCall(fixture(message), CHAT, { now: NOW }), null));
  }
});

test("malformed durations and identifiers fail closed", async (t) => {
  const messages = [
    ...[-1, 0.5, "3129", null, undefined, NaN, Infinity, -Infinity, MAX_DURATION + 1, Number.MAX_SAFE_INTEGER + 1].map(duration => ({ duration })),
    ...["", " ", ` ${LONG_ID}`, `${LONG_ID} `, 123, Number(LONG_ID), 123n, null, undefined, {}].map(id => ({ id })),
  ];
  for (const [index, message] of messages.entries()) {
    await t.test(`invalid field ${index}`, () => assert.equal(parseGroupCall(fixture(message), CHAT, { now: NOW }), null));
  }
});

test("rejects malformed envelopes and timestamps", async (t) => {
  const entries = [null, undefined, [], "entry", {}, { message: [] }, { message: null },
    ...[-1, 0, 1.2, "1789835463933", NaN, Infinity, null, undefined, Number.MAX_SAFE_INTEGER + 1].map(timestamp => fixture({}, { timestamp })),
  ];
  for (const [index, entry] of entries.entries()) {
    await t.test(`invalid envelope ${index}`, () => assert.equal(parseGroupCall(entry, CHAT, { now: NOW }), null));
  }
  assert.equal(parseGroupCall(fixture({ duration: 100 }, { timestamp: 99 }), CHAT, { now: NOW }), null);
});

test("accepts subsecond and long calls without day wrapping", () => {
  assert.equal(parseGroupCall(fixture({ duration: 1 }), CHAT, { now: NOW }).durationMs, 1);
  assert.equal(parseGroupCall(fixture({ duration: MAX_DURATION }), CHAT, { now: NOW }).durationMs, MAX_DURATION);
  assert.equal(formatDuration(MAX_DURATION), "720時間0分0秒");
});

test("baseline excludes old ends without excluding a call that started before baseline", () => {
  const endedAt = fixture().timestamp;
  assert.equal(parseGroupCall(fixture(), CHAT, { now: NOW, cutoff: endedAt + 1 }), null);
  assert.equal(parseGroupCall(fixture(), CHAT, { now: NOW, cutoff: endedAt }).endedAt, endedAt);
  assert.equal(parseGroupCall(fixture(), CHAT, { now: NOW, cutoff: endedAt - 1 }).durationMs, 3129);
});

test("future skew is limited to five minutes", () => {
  assert.ok(parseGroupCall(fixture({}, { timestamp: NOW + 300_000 }), CHAT, { now: NOW }));
  assert.equal(parseGroupCall(fixture({}, { timestamp: NOW + 300_001 }), CHAT, { now: NOW }), null);
});

test("chat identifiers and clocks are validated", () => {
  for (const chatId of [null, 1, "", "c0123456789abcdef0123456789abcdef", "C0123", CHAT + "0", "Cz123456789abcdef0123456789abcdef"]) {
    assert.equal(parseGroupCall(fixture(), chatId, { now: NOW }), null);
  }
  assert.ok(parseGroupCall(fixture(), CHAT.toUpperCase(), { now: NOW }));
  for (const now of [0, -1, 1.5, "1789835500000", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseGroupCall(fixture(), CHAT, { now }), null);
  }
  for (const cutoff of [-1, 0.5, "0", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseGroupCall(fixture(), CHAT, { now: NOW, cutoff }), null);
  }
});

test("Japanese duration labels floor milliseconds and preserve elapsed hours", () => {
  for (const [ms, expected] of [[0, "1秒未満"], [999, "1秒未満"], [1000, "1秒"], [59_999, "59秒"], [60_000, "1分0秒"], [61_999, "1分1秒"], [3_600_000, "1時間0分0秒"], [3_723_999, "1時間2分3秒"], [90_000_000, "25時間0分0秒"]]) {
    assert.equal(formatDuration(ms), expected);
  }
  for (const invalid of [-1, 1.5, NaN, Infinity, "1000", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatDuration(invalid), RangeError);
  }
});

test("repeated normalized input returns the same event key without parser-local state", () => {
  assert.deepEqual(parseGroupCall(fixture(), CHAT, { now: NOW }), parseGroupCall(fixture(), CHAT, { now: NOW }));
  // Persistent deduplication belongs to the caller's transaction/outbox.
  const other = parseGroupCall(fixture(), OTHER_CHAT, { now: NOW });
  assert.equal(other.chatId, OTHER_CHAT);
  assert.equal(other.messageId, LONG_ID);
});
