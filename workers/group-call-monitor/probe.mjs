// Read-only verification. OA_COOKIE is accepted only through the environment.
import { OaClient, parseSse } from './oa-client.mjs';
import { parseGroupCall } from './calls.mjs';
const botId = process.env.OA_BOT_ID;
const chatId = process.env.OA_CHAT_ID;
const client = new OaClient({ botId, cookie: process.env.OA_COOKIE });
try {
  const history = await client.history(chatId);
  console.log(JSON.stringify({ historyCount: history.list.length, calls: history.list.map(x => parseGroupCall(x, chatId)).filter(Boolean) }));
  const token = await client.streamToken();
  console.log(JSON.stringify({ streamTokenReady: Boolean(token.streamingApiToken), version: token.streamingApiVersion, expiry: token.expiredAt, hasCursor: Boolean(token.lastEventId) }));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25000);
  const types = {};
  try {
    const response = await fetch(client.streamUrl(token, token.lastEventId || ''), { signal: abort.signal, headers: { Accept: 'text/event-stream' }, redirect: 'manual' });
    console.log(JSON.stringify({ streamHttpStatus: response.status }));
    if (!response.ok) throw Object.assign(new Error('stream failed'), { status: response.status });
    for await (const frame of parseSse(response.body)) {
      let event;
      try { event = JSON.parse(frame.data); } catch {
        console.log(JSON.stringify({ nonJsonFrame: true, event: frame.event, dataLength: frame.data.length, firstCharacter: frame.data[0], idLength: frame.id.length }));
        continue;
      }
      if (!event || typeof event !== 'object') {
        console.log(JSON.stringify({ controlFrame: true, event: frame.event, dataType: typeof event }));
        continue;
      }
      const type = `${event.event || frame.event}:${event.subEvent || ''}`;
      types[type] = (types[type] || 0) + 1;
      if (event.subEvent === 'callHistory' && event.chatId === chatId) console.log(JSON.stringify({ call: event.payload?.message, timestamp: event.payload?.timestamp }));
    }
  } catch (error) { if (!abort.signal.aborted) throw error; }
  finally { clearTimeout(timer); }
  console.log(JSON.stringify({ observedEventTypes: types }));
} catch (error) {
  console.log(JSON.stringify({ error: 'LINE probe failed', operation: error.operation || 'stream', status: error.status || 0 }));
  process.exitCode = 1;
}
