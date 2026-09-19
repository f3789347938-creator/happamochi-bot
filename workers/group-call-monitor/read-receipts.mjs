const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const CHAT_ID = /^C[0-9a-fA-F]{32}$/;
const USER_ID = /^U[0-9a-fA-F]{32}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Parse decoded SSE wire JSON. The caller must enforce monitoring scope and
 * membership; history entries without a reader ID are deliberately insufficient.
 * Older watermarks are valid replay data, not proof that a newer message was read.
 */
export function parseGroupReadReceipt(event, { botId, chatId, now = Date.now() } = {}) {
  if (typeof botId !== "string" || !botId || botId.trim() !== botId) return null;
  if (typeof chatId !== "string" || chatId.length !== 33 || !CHAT_ID.test(chatId)) return null;
  if (!isPositiveTimestamp(now) || !isRecord(event)) return null;
  if (event.event !== "chat" || event.subEvent !== "chatRead" || event.botId !== botId || event.chatId !== chatId) return null;

  const payload = event.payload;
  if (!isRecord(payload) || payload.type !== "chatRead" || !isRecord(payload.source) || !isRecord(payload.read)) return null;
  if (payload.source.chatId !== chatId) return null;
  const { userId } = payload.source;
  if (typeof userId !== "string" || userId.length !== 33 || !USER_ID.test(userId) || userId.toLowerCase() === botId.toLowerCase()) return null;

  const eventAt = payload.timestamp;
  const { watermark } = payload.read;
  if (!isPositiveTimestamp(eventAt) || !isPositiveTimestamp(watermark)) return null;
  if (eventAt - now > MAX_FUTURE_SKEW_MS || watermark - now > MAX_FUTURE_SKEW_MS) return null;
  if (watermark - eventAt > MAX_FUTURE_SKEW_MS) return null;

  return { chatId, userId, watermark, eventAt };
}

function displayName(value) {
  if (typeof value !== "string") return "名前未取得";
  // Names are plain text, never markup, links, or extra result lines.
  const singleLine = value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").trim();
  if (!singleLine) return "名前未取得";
  const points = Array.from(singleLine);
  return points.length > 40 ? `${points.slice(0, 39).join("")}…` : singleLine;
}

/** Format only readers the caller has confirmed for the requested check. */
export function formatReadReceipts(readers, { maxNames = 40 } = {}) {
  if (!Array.isArray(readers)) throw new TypeError("Readers must be an array");
  if (!Number.isSafeInteger(maxNames) || maxNames < 1 || maxNames > 50) throw new RangeError("Name limit must be between 1 and 50");
  const unique = new Map();
  for (const reader of readers) {
    if (!isRecord(reader) || typeof reader.userId !== "string" || reader.userId.length !== 33 || !USER_ID.test(reader.userId)) continue;
    const key = reader.userId.toLowerCase();
    if (!unique.has(key)) unique.set(key, displayName(reader.displayName));
  }
  const names = [...unique.values()];
  const lines = [`既読が確認できた人（${names.length}人）`];
  if (names.length === 0) lines.push("まだ既読イベントを受信していません。");
  else {
    lines.push(...names.slice(0, maxNames).map(name => `・${name}`));
    if (names.length > maxNames) lines.push(`ほか${names.length - maxNames}人`);
  }
  return lines.join("\n");
}
