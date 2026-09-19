const STATE_KEY = 'group-call-alarm-loop:v1';
const WATCHDOG_MS = 5 * 60 * 1000;
const SUCCESS_DELAY_MS = 250;
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 60_000;
const SLOW_RETRY_ERRORS = new Set(['line_http_401', 'line_http_403', 'line_http_429']);

function safeError(code) {
  return typeof code === 'string' && (/^line_http_(?:0|[1-5][0-9]{2})$/.test(code) ||
    ['monitor_error', 'request_timeout', 'lease_lost'].includes(code)) ? code : 'monitor_error';
}

function safeResult(result) {
  if (result?.ok === true) return { ok: true };
  if (result?.skipped === 'already_running') return { skipped: 'already_running' };
  return { ok: false, error: safeError(result?.error) };
}

function failedResult(error) {
  if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) {
    return { ok: false, error: `line_http_${error.status}` };
  }
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  return { ok: false, error: timedOut ? 'request_timeout' : 'monitor_error' };
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeState(state) {
  return {
    lastStartedAt: timestamp(state?.lastStartedAt),
    lastFinishedAt: timestamp(state?.lastFinishedAt),
    lastResult: state?.lastResult == null ? null : safeResult(state.lastResult),
    consecutiveFailures: Number.isSafeInteger(state?.consecutiveFailures)
      ? Math.max(0, Math.min(30, state.consecutiveFailures)) : 0,
  };
}

/** One awaited run per alarm. Storage must implement the Durable Object KV/alarm API. */
export class AlarmLoop {
  #storage;
  #run;
  #now;
  #running = false;

  constructor(storage, run, { now = Date.now } = {}) {
    this.#storage = storage;
    this.#run = run;
    this.#now = now;
  }

  async schedulerStatus() {
    const state = safeState(await this.#storage.get(STATE_KEY));
    const nextAlarm = timestamp(await this.#storage.getAlarm());
    return { running: this.#running, ...state, nextAlarm };
  }

  async ensureStarted() {
    // getAlarm() alone is insufficient: it can be null while an alarm is running.
    if (this.#running) return this.schedulerStatus();
    const nextAlarm = await this.#storage.getAlarm();
    const state = safeState(await this.#storage.get(STATE_KEY));
    const interrupted = state.lastStartedAt !== null && state.lastStartedAt > (state.lastFinishedAt ?? -1);
    if (!this.#running && (nextAlarm == null || interrupted)) await this.#storage.setAlarm(this.#now());
    return this.schedulerStatus();
  }

  async alarm() {
    if (this.#running) return { skipped: 'already_running' };
    this.#running = true;
    try {
      const startedAt = this.#now();
      // Persist the next wake before external work; finally cannot run after a crash.
      await this.#storage.setAlarm(startedAt + WATCHDOG_MS);
      const previous = safeState(await this.#storage.get(STATE_KEY));
      await this.#storage.put(STATE_KEY, { ...previous, lastStartedAt: startedAt });

      let result;
      try { result = safeResult(await this.#run()); }
      catch (error) { result = failedResult(error); }

      const failures = result.ok === true ? 0 : Math.min(30, previous.consecutiveFailures + 1);
      const delay = result.ok === true ? SUCCESS_DELAY_MS :
        SLOW_RETRY_ERRORS.has(result.error) ? MAX_RETRY_MS :
          Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
      await this.#storage.put(STATE_KEY, {
        lastStartedAt: startedAt,
        lastFinishedAt: this.#now(),
        lastResult: result,
        consecutiveFailures: failures,
      });
      // Keep the watchdog intact if persisting the result or this replacement fails.
      // Errors here propagate so the platform's own alarm retry also remains available.
      await this.#storage.setAlarm(this.#now() + delay);
      return result;
    } finally {
      this.#running = false;
    }
  }
}
