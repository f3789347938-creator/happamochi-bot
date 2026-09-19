import assert from "node:assert/strict";
import test from "node:test";
import { formatReadReceipts, parseGroupReadReceipt } from "../read-receipts.mjs";

const CHAT = "C0123456789abcdef0123456789abcdef";
const OTHER_CHAT = "Cabcdef0123456789abcdef0123456789";
const BOT = "U00000000000000000000000000000000";
const USER = "U11111111111111111111111111111111";
const USER2 = "Uabcdefabcdefabcdefabcdefabcdefab";
const NOW = 1_789_835_500_000;
const OPTIONS = { botId: BOT, chatId: CHAT, now: NOW };

function fixture(payload = {}, envelope = {}) {
  return {
    event: "chat", subEvent: "chatRead", botId: BOT, chatId: CHAT,
    payload: {
      type: "chatRead", timestamp: NOW - 500,
      source: { chatId: CHAT, userId: USER },
      read: { watermark: NOW - 500 }, ...payload,
    }, ...envelope,
  };
}

test("observed group SSE shape retains only the receipt fields without mutating input", () => {
  const event = fixture({ unrelated: "not retained" }, { unrelated: "not retained" });
  const original = structuredClone(event);
  assert.deepEqual(parseGroupReadReceipt(event, OPTIONS), {
    chatId: CHAT, userId: USER, watermark: NOW - 500, eventAt: NOW - 500,
  });
  assert.deepEqual(event, original);
  assert.deepEqual(parseGroupReadReceipt(event, OPTIONS), parseGroupReadReceipt(event, OPTIONS));
});

test("accepts old watermark and replayed events without promoting their watermarks", () => {
  const old = NOW - 24 * 60 * 60 * 1000;
  assert.deepEqual(parseGroupReadReceipt(fixture({ read: { watermark: old } }), OPTIONS), {
    chatId: CHAT, userId: USER, watermark: old, eventAt: NOW - 500,
  });
  assert.equal(parseGroupReadReceipt(fixture({ timestamp: old, read: { watermark: old } }), OPTIONS).eventAt, old);
});

test("requires the exact read event and both matching chat IDs", () => {
  for (const envelope of [
    { event: "message" }, { event: undefined }, { subEvent: "read" }, { subEvent: undefined },
    { botId: USER }, { botId: undefined }, { chatId: OTHER_CHAT }, { chatId: undefined },
  ]) assert.equal(parseGroupReadReceipt(fixture({}, envelope), OPTIONS), null);
  for (const payload of [
    { type: "read" }, { type: "message" }, { type: undefined },
    { source: { chatId: OTHER_CHAT, userId: USER } }, { source: { userId: USER } },
  ]) assert.equal(parseGroupReadReceipt(fixture(payload), OPTIONS), null);
});

test("history without a reader, bot reads, and invalid user identities are rejected", () => {
  for (const userId of [undefined, null, "", 12, BOT, BOT.toLowerCase(), "u" + "1".repeat(32), "R" + "1".repeat(32), "U123", USER + "1", USER + "\n", "U" + "z".repeat(32)]) {
    assert.equal(parseGroupReadReceipt(fixture({ source: { chatId: CHAT, userId } }), OPTIONS), null);
  }
  const hexBot = "Uabcdefabcdefabcdefabcdefabcdefab";
  assert.equal(parseGroupReadReceipt(fixture({ source: { chatId: CHAT, userId: hexBot.toUpperCase() } }, { botId: hexBot }), { ...OPTIONS, botId: hexBot }), null);
  assert.equal(parseGroupReadReceipt(fixture().payload, OPTIONS), null);
});

test("validates group IDs, clock, and required options", () => {
  for (const chatId of [null, 1, "", CHAT.toLowerCase(), "R" + "1".repeat(32), "C123", CHAT + "1", CHAT + "\n", "C" + "z".repeat(32)]) {
    assert.equal(parseGroupReadReceipt(fixture(), { ...OPTIONS, chatId }), null);
  }
  const uppercaseChat = CHAT.toUpperCase();
  assert.ok(parseGroupReadReceipt(fixture({ source: { chatId: uppercaseChat, userId: USER2.toUpperCase() } }, { chatId: uppercaseChat }), { ...OPTIONS, chatId: uppercaseChat }));
  for (const now of [0, -1, 1.2, "1789835500000", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseGroupReadReceipt(fixture(), { ...OPTIONS, now }), null);
  }
  for (const botId of [undefined, null, 1, "", " ", ` ${BOT}`]) {
    assert.equal(parseGroupReadReceipt(fixture(), { ...OPTIONS, botId }), null);
  }
  assert.equal(parseGroupReadReceipt(fixture()), null);
});

test("rejects malformed records and non-integer or non-positive timestamp values", () => {
  for (const event of [null, undefined, [], "event", 12, {}, { payload: [] }]) {
    assert.equal(parseGroupReadReceipt(event, OPTIONS), null);
  }
  for (const payload of [null, [], "payload", { type: "chatRead", source: [], read: {} }]) {
    assert.equal(parseGroupReadReceipt(fixture({}, { payload }), OPTIONS), null);
  }
  for (const value of [0, -1, 0.5, "1789835500000", undefined, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseGroupReadReceipt(fixture({ timestamp: value }), OPTIONS), null);
    assert.equal(parseGroupReadReceipt(fixture({ read: { watermark: value } }), OPTIONS), null);
  }
  for (const value of [null, [], "value", undefined]) {
    assert.equal(parseGroupReadReceipt(fixture({ source: value }), OPTIONS), null);
    assert.equal(parseGroupReadReceipt(fixture({ read: value }), OPTIONS), null);
  }
});

test("enforces five-minute bounds against both the event time and current clock", () => {
  assert.ok(parseGroupReadReceipt(fixture({ timestamp: NOW, read: { watermark: NOW + 300_000 } }), OPTIONS));
  assert.equal(parseGroupReadReceipt(fixture({ timestamp: NOW, read: { watermark: NOW + 300_001 } }), OPTIONS), null);
  assert.ok(parseGroupReadReceipt(fixture({ timestamp: NOW + 300_000, read: { watermark: NOW + 300_000 } }), OPTIONS));
  assert.equal(parseGroupReadReceipt(fixture({ timestamp: NOW + 300_001, read: { watermark: NOW } }), OPTIONS), null);
  assert.equal(parseGroupReadReceipt(fixture({ timestamp: NOW + 300_000, read: { watermark: NOW + 300_001 } }), OPTIONS), null);
  assert.ok(parseGroupReadReceipt(fixture({ timestamp: NOW - 600_000, read: { watermark: NOW - 300_000 } }), OPTIONS));
  assert.equal(parseGroupReadReceipt(fixture({ timestamp: NOW - 600_000, read: { watermark: NOW - 299_999 } }), OPTIONS), null);
});

test("formats confirmed distinct people and explicitly avoids calling the rest unread", () => {
  assert.equal(formatReadReceipts([
    { userId: USER, displayName: "もち" },
    { userId: USER2, displayName: "はっぱ" },
    { userId: USER, displayName: "duplicate" },
    { userId: USER2.toUpperCase(), displayName: "duplicate case" },
  ]), "既読が確認できた人（2人）\n・もち\n・はっぱ\n\n※イベント未受信の人が、未読とは限りません。");
  assert.equal(formatReadReceipts([]), "既読が確認できた人（0人）\nまだ既読イベントを受信していません。\n\n※イベント未受信の人が、未読とは限りません。");
});

test("names cannot add output lines and missing names do not expose IDs", () => {
  const text = formatReadReceipts([
    { userId: USER, displayName: " \u202eA\r\nB\u0000C " },
    { userId: USER2 },
    { userId: "invalid", displayName: "do not show" }, null,
  ]);
  assert.ok(text.includes("・A B C\n・名前未取得"));
  assert.equal(text.includes(USER), false);
  assert.equal(text.includes("do not show"), false);
  assert.equal(text.includes("\u202e"), false);
});

test("bounds names and output without changing the total confirmed count", () => {
  const readers = Array.from({ length: 500 }, (_, index) => ({
    userId: `U${index.toString(16).padStart(32, "0")}`, displayName: "🌿".repeat(100),
  }));
  const text = formatReadReceipts(readers, { maxNames: 50 });
  assert.ok(text.startsWith("既読が確認できた人（500人）\n"));
  assert.equal(text.split("\n").filter(line => line.startsWith("・")).length, 50);
  assert.ok(text.includes("ほか450人"));
  assert.ok(text.length < 5000);
  assert.equal(text.isWellFormed(), true);
  assert.ok(text.includes("・" + "🌿".repeat(39) + "…"));
  for (const maxNames of [0, 51, -1, 1.2, "1", NaN, Infinity]) assert.throws(() => formatReadReceipts([], { maxNames }), RangeError);
  for (const readers of [null, {}, "names"]) assert.throws(() => formatReadReceipts(readers), TypeError);
});
