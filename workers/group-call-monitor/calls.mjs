const MAX_CALL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const CHAT_ID = /^C[0-9a-fA-F]{32}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse an already-normalized OA history entry without retaining its other data. */
export function parseGroupCall(entry, chatId, { now = Date.now(), cutoff = 0 } = {}) {
  const call = parseGroupCallSignal(entry, chatId, { now, cutoff });
  if (!call) return null;
  const messageId = entry.message.id;
  // History IDs are opaque strings, never numeric conversions or local dummy IDs.
  if (typeof messageId !== 'string' || !messageId || messageId.trim() !== messageId) return null;
  return { ...call, messageId };
}

/** Live GROUP_CALL signals omit message.id; only history yields a durable ID. */
export function parseGroupCallSignal(entry, chatId, { now = Date.now(), cutoff = 0 } = {}) {
  if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) return null;
  if (!Number.isSafeInteger(now) || now <= 0) return null;
  if (!Number.isSafeInteger(cutoff) || cutoff < 0) return null;
  if (!isRecord(entry) || !isRecord(entry.message)) return null;

  const { message, timestamp: endedAt } = entry;
  if (message.type !== "callHistory" || message.serviceType !== "GROUP_CALL" || message.result !== "INFO") return null;

  const durationMs = message.duration;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_CALL_DURATION_MS) return null;
  if (!Number.isSafeInteger(endedAt) || endedAt <= 0 || endedAt < cutoff) return null;
  if (endedAt - now > MAX_FUTURE_SKEW_MS) return null;

  // This is an estimate from the reported duration, not a matched start event.
  const startedAt = endedAt - durationMs;
  if (startedAt < 0) return null;
  return { chatId, endedAt, durationMs, startedAt };
}

export function formatDuration(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("Duration must be a non-negative safe integer in milliseconds");
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds === 0) return "1秒未満";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}時間${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

export function formatCallMessage(call) {
  return `グループ通話が終了しました\n通話時間：${formatDuration(call.durationMs)}`;
}
