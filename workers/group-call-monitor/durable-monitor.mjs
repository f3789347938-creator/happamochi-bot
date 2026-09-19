import { DurableObject } from 'cloudflare:workers';
import { AlarmLoop } from './alarm-loop.mjs';
import { runMonitor } from './monitor.mjs';
import { MonitorStore } from './store.mjs';
import { OaClient } from './oa-client.mjs';
import { ReadStore } from './read-store.mjs';
import { ReadReceiptService } from './read-service.mjs';

/** Route every kick for one OA through the same getByName(OA_BOT_ID) instance. */
export class GroupCallMonitor extends DurableObject {
  #loop;

  constructor(ctx, env) {
    super(ctx, env);
    // No constructor alarm scheduling: a pending alarm must survive re-instantiation.
    this.#loop = new AlarmLoop(ctx.storage, () => {
      const client = new OaClient({ botId: env.OA_BOT_ID, cookie: env.OA_COOKIE });
      const config = { botId: env.OA_BOT_ID, scope: env.CHAT_SCOPE || '', enabled: env.SEND_ENABLED === 'true' };
      const readService = env.READ_RECEIPTS_ENABLED === 'true' ? new ReadReceiptService(new ReadStore(env.DB), client, config) : undefined;
      return runMonitor(new MonitorStore(env.DB), client, config, { streamSeconds: 240, reconcileFirst: false, readService });
    });
  }

  ensureStarted() { return this.#loop.ensureStarted(); }

  schedulerStatus() { return this.#loop.schedulerStatus(); }

  async alarm() {
    // Await the stream: DO waitUntil() does not extend the object's lifetime.
    await this.#loop.alarm();
  }
}
