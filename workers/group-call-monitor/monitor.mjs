import { parseGroupCall, parseGroupCallSignal, formatCallMessage } from './calls.mjs';
import { parseSse } from './oa-client.mjs';

export function allowedChat(chatId, scope) {
  return /^C[0-9a-f]{32}$/i.test(chatId ?? '') && (scope === 'all' || scope.split(',').map(x => x.trim()).includes(chatId));
}

export function errorCode(error) {
  return Number.isInteger(error?.status) ? `line_http_${error.status}` :
    error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'request_timeout' : 'monitor_error';
}

export async function observe(store, entry, chatId, config, cutoff) {
  if (!allowedChat(chatId, config.scope)) return;
  const call = parseGroupCall(entry, chatId, { cutoff });
  if (call) await store.observedCall(call, formatCallMessage(call), config.enabled);
}

export async function receiveCall(store, client, event, config, cutoff, owner) {
  const payload = event.payload || {};
  const chatId = event.chatId || payload.source?.chatId;
  if (event.botId !== config.botId || !allowedChat(chatId, config.scope)) return;
  if (event.chatId && payload.source?.chatId && event.chatId !== payload.source.chatId) return;
  // Use the actual message timestamp, never the outer delivery timestamp, to
  // match the ID-less SSE signal with the canonical entry returned by history.
  const signal = parseGroupCallSignal(payload, chatId, { cutoff });
  if (!signal) return;
  if (parseGroupCall(payload, chatId, { cutoff })) {
    await observe(store, payload, chatId, config, cutoff);
  } else if (!await store.hasCall(chatId, signal.endedAt, signal.durationMs)) {
    const history = await client.history(chatId, { limit: 100 });
    if (!Array.isArray(history.list)) throw new Error('invalid_history_response');
    for (const entry of history.list) {
      if (entry.sendId) await store.acknowledge(chatId, entry.sendId, entry.timestamp);
      await observe(store, entry, chatId, config, cutoff);
    }
    if (!await store.hasCall(chatId, signal.endedAt, signal.durationMs)) {
      await store.queueChat(chatId);
      // Do not checkpoint this signal yet. Reconnect will replay it after a
      // short backoff, while durable history recovery continues where it left off.
      throw new Error('call_history_pending');
    }
  }
  await dispatch(store, client, config, owner);
}

export async function dispatch(store, client, config, owner) {
  if (!config.enabled) return;
  const activated = (await store.state()).scope_activated_at;
  for (const row of await store.pending()) {
    if (row.ended_at < activated) {
      await store.finish(row, 'observed', 'before_scope_activation');
      continue;
    }
    if (Date.now() - row.ended_at > 15 * 60 * 1000) {
      await store.finish(row, 'failed', 'notification_too_old');
      continue;
    }
    if (!allowedChat(row.chat_id, config.scope)) continue;
    await store.renew(owner, Date.now());
    if (!await store.claim(row, Date.now())) continue;
    try {
      await client.sendText(row.chat_id, row.message_text, row.send_id);
      await store.finish(row, 'sent');
    } catch (error) {
      // Management API sendId has no documented idempotency guarantee.
      // A timeout/5xx may have accepted the message: never blindly resend it.
      const rejected = error?.status >= 400 && error?.status < 500;
      await store.finish(row, rejected ? 'failed' : 'uncertain', errorCode(error));
      if (error?.status === 401 || error?.status === 403 || error?.status === 429) throw error;
    }
  }
}

export async function reconcile(store, client, config, cutoff, owner, { signal } = {}) {
  let next = (await store.state()).discovery_next || undefined;
  for (let page = 0; page < 4; page++) {
    if (signal?.aborted) return;
    await store.renew(owner, Date.now());
    const chats = await client.chats({ next, limit: 25 });
    if (signal?.aborted) return;
    if (!Array.isArray(chats.list)) throw new Error('invalid_chats_response');
    let oldest = Infinity;
    for (const chat of chats.list) {
      const updated = Math.max(Number(chat.updatedAt) || 0, Number(chat.latestEvent?.timestamp) || 0);
      oldest = Math.min(oldest, updated);
      if (chat.chatType !== 'GROUP' || !allowedChat(chat.chatId, config.scope) || updated < cutoff) continue;
      // updatedAt can precede history visibility: rescan the recent window even
      // when the chat timestamp has not changed. Persistent IDs suppress repeats.
      await store.queueChat(chat.chatId);
    }
    if (!chats.next || oldest < cutoff || chats.list.length === 0) {
      await store.discoveryCursor('');
      break;
    }
    if (chats.next === next) throw new Error('chat_cursor_stalled');
    next = chats.next;
    await store.discoveryCursor(next);
  }
  const unresolved = new Map();
  for (const row of await store.unresolvedChats(Date.now())) {
    if (!allowedChat(row.chat_id, config.scope)) continue;
    unresolved.set(row.chat_id, row.since - 60000);
    await store.queueChat(row.chat_id);
  }
  let budget = 35;
  for (const chat of await store.queuedChats()) {
    if (signal?.aborted) return;
    if (!allowedChat(chat.chat_id, config.scope)) {
      await store.checkedChat(chat.chat_id, Date.now());
      continue;
    }
    let backward = chat.history_backward || undefined;
    const scanCutoff = backward ? chat.scan_cutoff : Math.min(cutoff, unresolved.get(chat.chat_id) ?? cutoff);
    const through = backward ? chat.scan_through : Date.now();
    for (let page = 0; page < 6 && budget > 0; page++) {
      if (signal?.aborted) return;
      await store.renew(owner, Date.now());
      const history = await client.history(chat.chat_id, { backward, limit: 100 });
      if (signal?.aborted) return;
      budget--;
      if (!Array.isArray(history.list)) throw new Error('invalid_history_response');
      for (const entry of history.list) {
        if (entry.sendId) await store.acknowledge(chat.chat_id, entry.sendId, entry.timestamp);
        await observe(store, entry, chat.chat_id, config, cutoff);
      }
      const minimum = Math.min(...history.list.map(entry => Number(entry.timestamp) || Infinity));
      if (!history.backward || history.list.length === 0 || minimum < scanCutoff) {
        await store.checkedChat(chat.chat_id, through);
        break;
      }
      if (history.backward === backward) throw new Error('history_cursor_stalled');
      backward = history.backward;
      // Save each page so busy chats cannot repeatedly starve page seven.
      await store.historyProgress(chat.chat_id, backward, scanCutoff, through);
    }
    await dispatch(store, client, config, owner);
    if (budget <= 0) break;
  }
}

export async function runMonitor(store, client, config, { streamSeconds = 40, reconcileFirst = true } = {}) {
  const owner = crypto.randomUUID();
  const now = Date.now();
  if (!await store.acquire(owner, now)) return { skipped: 'already_running' };
  let failure = null;
  try {
    await store.activateScope(config.scope, config.enabled, now);
    const state = await store.state();
    const cutoff = Math.max(state.initialized_at, state.scope_activated_at, now - 15 * 60 * 1000);
    await store.quarantineInterrupted(now);
    // On bootstrap, use the server's current stream cursor, never replay old calls.
    let cursor = state.cursor;
    if (!cursor) {
      const initialToken = await client.streamToken();
      cursor = initialToken.lastEventId || '';
      if (cursor) await store.cursor(cursor, now);
    }
    if (reconcileFirst || streamSeconds <= 0) {
      await reconcile(store, client, config, cutoff, owner);
      await dispatch(store, client, config, owner);
    }
    if (streamSeconds <= 0) return { ok: true, reconciled: true };
    // Live v2 tokens expire in about a minute. Backfill can take longer.
    const token = await client.streamToken();
    await store.renew(owner, Date.now());
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), streamSeconds * 1000);
    let latestId = cursor;
    let lastCheckpoint = Date.now();
    let recovery;
    let recoveryFailure;
    let idleTimer;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort.abort(), 30000);
    };
    try {
      const response = await fetch(client.streamUrl(token, cursor), { signal: abort.signal, headers: { Accept: 'text/event-stream' }, redirect: 'manual' });
      if (!response.ok) throw Object.assign(new Error('stream_http_error'), { status: response.status });
      resetIdleTimer();
      // Start reading the live stream first; history scans must not hold up
      // new call notifications. Atomic outbox claims also cover this overlap.
      if (!reconcileFirst) recovery = reconcile(store, client, config, cutoff, owner, { signal: abort.signal })
        .catch(error => { recoveryFailure = error; abort.abort(); });
      for await (const frame of parseSse(response.body)) {
        resetIdleTimer();
        if (Date.now() - lastCheckpoint > 10000) {
          await store.renew(owner, Date.now());
          await store.cursor(latestId, Date.now());
          lastCheckpoint = Date.now();
        }
        // LINE sends a literal "ping" heartbeat, not JSON; it must not advance the replay cursor.
        if (frame.event === 'ping') continue;
        if (frame.event === 'reload' || frame.data === 'reload') break;
        if (frame.event === 'fail') throw new Error('stream_failed');
        if (frame.data) {
          let event;
          try { event = JSON.parse(frame.data); } catch { event = null; }
          const kind = event?.event || frame.event;
          if (kind === 'chat' && event?.botId === config.botId && allowedChat(event.chatId, config.scope) && event.payload?.sendId) {
            await store.acknowledge(event.chatId, event.payload.sendId, event.payload.timestamp);
          }
          if (kind === 'chat' && event?.payload?.message?.type === 'callHistory') {
            await receiveCall(store, client, event, config, cutoff, owner);
          }
        }
        if (frame.id) latestId = frame.id;
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      clearTimeout(idleTimer);
      abort.abort();
      await recovery;
      if (latestId) await store.cursor(latestId, Date.now());
    }
    if (recoveryFailure) throw recoveryFailure;
    return { ok: true };
  } catch (error) {
    failure = errorCode(error);
    console.error(JSON.stringify({ service: 'group-call-monitor', error: failure }));
    return { ok: false, error: failure };
  } finally { await store.release(owner, failure); }
}
