import { DurableObject } from 'cloudflare:workers';
import { AlarmLoop } from './alarm-loop.mjs';
import { runMonitor } from './monitor.mjs';
import { MonitorStore } from './store.mjs';
import { OaClient } from './oa-client.mjs';

/** Route every kick for one OA through the same getByName(OA_BOT_ID) instance. */
export class GroupCallMonitor extends DurableObject {
  #loop;

  constructor(ctx, env) {
    super(ctx, env);
    // No constructor alarm scheduling: a pending alarm must survive re-instantiation.
    this.#loop = new AlarmLoop(ctx.storage, () => runMonitor(
      new MonitorStore(env.DB),
      new OaClient({ botId: env.OA_BOT_ID, cookie: env.OA_COOKIE }),
      { botId: env.OA_BOT_ID, scope: env.CHAT_SCOPE || '', enabled: env.SEND_ENABLED === 'true' },
      { streamSeconds: 240, reconcileFirst: false },
    ));
  }

  ensureStarted() { return this.#loop.ensureStarted(); }

  schedulerStatus() { return this.#loop.schedulerStatus(); }

  async alarm() {
    // Await the stream: DO waitUntil() does not extend the object's lifetime.
    await this.#loop.alarm();
  }
}
