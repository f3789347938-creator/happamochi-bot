import { parseGroupCall, formatCallMessage } from './calls.mjs';
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

export async function reconcile(store, client, config, cutoff, owner) {
  let next = (await store.state()).discovery_next || undefined;
  for (let page = 0; page < 4; page++) {
    await store.renew(owner, Date.now());
    const chats = await client.chats({ next, limit: 25 });
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
    if (!allowedChat(chat.chat_id, config.scope)) {
      await store.checkedChat(chat.chat_id, Date.now());
      continue;
    }
    let backward = chat.history_backward || undefined;
    const scanCutoff = backward ? chat.scan_cutoff : Math.min(cutoff, unresolved.get(chat.chat_id) ?? cutoff);
    const through = backward ? chat.scan_through : Date.now();
    for (let page = 0; page < 6 && budget > 0; page++) {
      await store.renew(owner, Date.now());
      const history = await client.history(chat.chat_id, { backward, limit: 100 });
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

export async function runMonitor(store, client, config, { streamSeconds = 40 } = {}) {
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
    await reconcile(store, client, config, cutoff, owner);
    await dispatch(store, client, config, owner);
    if (streamSeconds <= 0) return { ok: true, reconciled: true };
    // Live v2 tokens expire in about a minute. Backfill can take longer.
    const token = await client.streamToken();
    await store.renew(owner, Date.now());
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), streamSeconds * 1000);
    let latestId = cursor;
    let lastCheckpoint = Date.now();
    try {
      const response = await fetch(client.streamUrl(token, cursor), { signal: abort.signal, headers: { Accept: 'text/event-stream' }, redirect: 'manual' });
      if (!response.ok) throw Object.assign(new Error('stream_http_error'), { status: response.status });
      for await (const frame of parseSse(response.body)) {
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
          if (kind === 'chat' && event?.subEvent === 'callHistory' && event.botId === config.botId) {
            const payload = event.payload || {};
            if (!payload.source?.chatId || payload.source.chatId === event.chatId) {
              await observe(store, { ...payload, timestamp: payload.timestamp ?? event.timestamp }, event.chatId, config, cutoff);
              await dispatch(store, client, config, owner);
            }
          }
        }
        if (frame.id) latestId = frame.id;
        if (Date.now() - lastCheckpoint > 10000) {
          await store.renew(owner, Date.now());
          await store.cursor(latestId, Date.now());
          lastCheckpoint = Date.now();
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      if (latestId) await store.cursor(latestId, Date.now());
    }
    return { ok: true };
  } catch (error) {
    failure = errorCode(error);
    console.error(JSON.stringify({ service: 'group-call-monitor', error: failure }));
    return { ok: false, error: failure };
  } finally { await store.release(owner, failure); }
}
