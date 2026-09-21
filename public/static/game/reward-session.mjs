// A result owns its start request and score snapshot, including across retries.
export class PuzzleRewardSession {
  constructor({ ready, previous, start, submit, id = globalThis.crypto.randomUUID() }) {
    this.id = id;
    this.submit = submit;
    this.snapshot = null;
    this.pending = null;
    this.saved = null;
    const settledPrevious = Promise.resolve(previous?.pending || previous?.started).catch(() => {});
    this.started = Promise.all([ready, settledPrevious]).then(() => start(id)).catch(() => ({ status: 'start_error' }));
  }

  save(score) {
    if (this.saved) return Promise.resolve(this.saved);
    if (this.pending) return this.pending;
    if (!this.snapshot) this.snapshot = Object.freeze({ score: score.score, merges: score.merges, stage: score.stage });
    this.pending = (async () => {
      const start = await this.started;
      if (start.status === 'guest') return { ok: false, retryable: false, message: '', reward: { status: 'guest' } };
      if (!(this.snapshot.score > 0)) return { ok: false, retryable: false, message: '', reward: { status: 'no_score' } };
      const result = await this.submit({ ...this.snapshot, ...(start.id ? { runId: start.id } : {}) });
      if (result.ok) {
        if (!start.id) result.reward = { ...result.reward, status: 'start_error' };
        this.saved = result;
      }
      return result;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
