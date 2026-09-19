import { OaClient } from './oa-client.mjs';
import { MonitorStore } from './store.mjs';
import { parseGroupCall } from './calls.mjs';
export { GroupCallMonitor } from './durable-monitor.mjs';

function client(env) { return new OaClient({ botId: env.OA_BOT_ID, cookie: env.OA_COOKIE }); }
function monitor(env) { return env.CALL_MONITOR.getByName(env.OA_BOT_ID, { locationHint: 'apac' }); }
async function authorized(request, env) {
  const supplied = request.headers.get('Authorization') || '';
  if (!env.ADMIN_TOKEN || !supplied.startsWith('Bearer ')) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return crypto.subtle.timingSafeEqual(await digest(supplied.slice(7)), await digest(env.ADMIN_TOKEN));
}
export default {
  async scheduled(controller, env) {
    // Cron only repairs a missing alarm; one DO owns the OA's live connection.
    await monitor(env).ensureStarted();
  },
  async fetch(request, env) {
    if (!await authorized(request, env)) return new Response('Not found', { status: 404 });
    const path = new URL(request.url).pathname;
    const store = new MonitorStore(env.DB);
    if (path === '/status' && request.method === 'GET') {
      const [state, scheduler] = await Promise.all([store.status(), monitor(env).schedulerStatus()]);
      return Response.json({ ...state, scheduler, scope: env.CHAT_SCOPE, sending: env.SEND_ENABLED === 'true', readReceipts: env.READ_RECEIPTS_ENABLED === 'true' });
    }
    if (path === '/probe' && request.method === 'GET') {
      try {
        const api = client(env);
        const history = await api.history(env.TEST_CHAT_ID);
        const token = await api.streamToken();
        return Response.json({ ok: true, historyCount: history.list?.length, streamReady: Boolean(token.streamingApiToken), calls: history.list.map(entry => parseGroupCall(entry, env.TEST_CHAT_ID)).filter(Boolean) });
      } catch (error) { return Response.json({ ok: false, operation: error.operation || 'probe', status: error.status || 0 }, { status: 502 }); }
    }
    if (path === '/run' && request.method === 'POST') return Response.json(await monitor(env).ensureStarted());
    return new Response('Not found', { status: 404 });
  }
};
