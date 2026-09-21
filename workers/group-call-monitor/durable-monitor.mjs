import { DurableObject } from 'cloudflare:workers';
import { AlarmLoop } from './alarm-loop.mjs';
import { runMonitor } from './monitor.mjs';
import { MonitorStore } from './store.mjs';
import { OaClient } from './oa-client.mjs';
import { ReadStore } from './read-store.mjs';
import { ReadReceiptService } from './read-service.mjs';
import { SessionStore } from './session-store.mjs';
import { parseGroupCall } from './calls.mjs';

/** Route every kick for one OA through the same getByName(OA_BOT_ID) instance. */
export class GroupCallMonitor extends DurableObject {
  #loop;
  #sessionStore;
  #clientReady;

  constructor(ctx, env) {
    super(ctx, env);
    this.#sessionStore = new SessionStore(ctx.storage, { botId: env.OA_BOT_ID, cookie: env.OA_COOKIE, adminToken: env.ADMIN_TOKEN });
    // No constructor alarm scheduling: a pending alarm must survive re-instantiation.
    this.#loop = new AlarmLoop(ctx.storage, async () => {
      const client = await this.#client();
      client.refreshCsrfOnNextRequest();
      const config = { botId: env.OA_BOT_ID, scope: env.CHAT_SCOPE || '', enabled: env.SEND_ENABLED === 'true' };
      const readService = env.READ_RECEIPTS_ENABLED === 'true' ? new ReadReceiptService(new ReadStore(env.DB), client, config) : undefined;
      return runMonitor(new MonitorStore(env.DB), client, config, { streamSeconds: 240, reconcileFirst: false, readService });
    });
  }

  async #client() {
    this.#clientReady ??= this.#sessionStore.load().then(cookieSnapshot => new OaClient({
      botId: this.env.OA_BOT_ID, cookie: this.env.OA_COOKIE, cookieSnapshot,
      saveCookies: snapshot => this.#sessionStore.save(snapshot),
    }));
    try { return await this.#clientReady; }
    catch (error) { this.#clientReady = undefined; throw error; }
  }

  async sessionStatus() {
    try { return { state: 'loaded', ...(await this.#client()).sessionMetadata() }; }
    catch { return { state: 'storage_unavailable' }; }
  }

  async probe() {
    // The diagnostic must use the same current cookie jar as the live monitor.
    const client = await this.#client();
    const history = await client.history(this.env.TEST_CHAT_ID);
    const token = await client.streamToken();
    return { ok: true, historyCount: history.list?.length, streamReady: Boolean(token.streamingApiToken),
      calls: (history.list || []).map(entry => parseGroupCall(entry, this.env.TEST_CHAT_ID)).filter(Boolean) };
  }

  ensureStarted() { return this.#loop.ensureStarted(); }

  schedulerStatus() { return this.#loop.schedulerStatus(); }

  async alarm() {
    // Await the stream: DO waitUntil() does not extend the object's lifetime.
    await this.#loop.alarm();
  }
}
