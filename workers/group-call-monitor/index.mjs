import { OaClient } from './oa-client.mjs';
import { MonitorStore } from './store.mjs';
import { runMonitor } from './monitor.mjs';
import { parseGroupCall } from './calls.mjs';

function config(env) {
  return { botId: env.OA_BOT_ID, scope: env.CHAT_SCOPE || '', enabled: env.SEND_ENABLED === 'true' };
}
function client(env) { return new OaClient({ botId: env.OA_BOT_ID, cookie: env.OA_COOKIE }); }
async function authorized(request, env) {
  const supplied = request.headers.get('Authorization') || '';
  if (!env.ADMIN_TOKEN || !supplied.startsWith('Bearer ')) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return crypto.subtle.timingSafeEqual(await digest(supplied.slice(7)), await digest(env.ADMIN_TOKEN));
}
export default {
  async scheduled(controller, env) {
    const result = await runMonitor(new MonitorStore(env.DB), client(env), config(env), { streamSeconds: Number(env.STREAM_SECONDS) || 40 });
    if (result.ok === false) throw new Error(result.error);
  },
  async fetch(request, env) {
    if (!await authorized(request, env)) return new Response('Not found', { status: 404 });
    const path = new URL(request.url).pathname;
    const store = new MonitorStore(env.DB);
    if (path === '/status' && request.method === 'GET') return Response.json({ ...(await store.status()), scope: env.CHAT_SCOPE, sending: env.SEND_ENABLED === 'true' });
    if (path === '/probe' && request.method === 'GET') {
      try {
        const api = client(env);
        const history = await api.history(env.TEST_CHAT_ID);
        const token = await api.streamToken();
        return Response.json({ ok: true, historyCount: history.list?.length, streamReady: Boolean(token.streamingApiToken), calls: history.list.map(entry => parseGroupCall(entry, env.TEST_CHAT_ID)).filter(Boolean) });
      } catch (error) { return Response.json({ ok: false, operation: error.operation || 'probe', status: error.status || 0 }, { status: 502 }); }
    }
    if (path === '/run' && request.method === 'POST') return Response.json(await runMonitor(store, client(env), config(env), { streamSeconds: 0 }));
    return new Response('Not found', { status: 404 });
  }
};
