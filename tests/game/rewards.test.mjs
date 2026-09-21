import test from 'node:test';
import assert from 'node:assert/strict';
import { PuzzleRewardSession } from '../../public/static/game/reward-session.mjs';
import { gameRewardText } from '../../public/static/game-rewards.mjs';
import { startScoreRun, submitScore } from '../../public/static/game/ranking.mjs';

const receipt = { points: 75, balance: 1225, dailyEarned: 275, dailyLimit: 1000, status: 'awarded' };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('puzzle waits for LINE readiness and sends the original result only once', async () => {
  const ready = deferred(), saved = deferred(), starts = [], submissions = [];
  const session = new PuzzleRewardSession({ id: 'puzzle-run-1', ready: ready.promise,
    start: async id => { starts.push(id); return { id }; },
    submit: score => { submissions.push(score); return saved.promise; },
  });
  const score = { score: 7500, merges: 25, stage: 6 };
  const pending = session.save(score);
  score.score = 1;
  assert.equal(session.save({ score: 999999 }), pending);
  assert.deepEqual(starts, []);
  ready.resolve();
  await session.started;
  await Promise.resolve();
  assert.deepEqual(starts, ['puzzle-run-1']);
  assert.deepEqual(submissions, [{ score: 7500, merges: 25, stage: 6, runId: 'puzzle-run-1' }]);
  saved.resolve({ ok: true, reward: receipt });
  assert.deepEqual((await pending).reward, receipt);
  assert.deepEqual((await session.save({ score: 99999 })).reward, receipt);
  assert.equal(submissions.length, 1);
});

test('puzzle retry retains run ID and frozen score instead of starting a new run', async () => {
  let starts = 0;
  const calls = [];
  const session = new PuzzleRewardSession({ id: 'retry-run-1', ready: Promise.resolve(),
    start: async id => { starts++; return { id }; },
    submit: async payload => { calls.push(payload); return calls.length === 1 ? { ok: false, retryable: true } : { ok: true, reward: receipt }; },
  });
  assert.equal((await session.save({ score: 7500, merges: 25, stage: 6 })).ok, false);
  assert.equal((await session.save({ score: 0, merges: 0, stage: 0 })).ok, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(starts, 1);
});

test('replay waits for previous start/save ordering, then starts even if previous save rejects', async () => {
  const saving = deferred();
  let nextStarted = false;
  const previous = new PuzzleRewardSession({ id: 'old-run-1', start: async id => ({ id }),
    submit: async () => { await saving.promise; throw new Error('network error'); },
  });
  const pending = previous.save({ score: 7500, merges: 25, stage: 6 });
  const rejected = assert.rejects(pending, /network error/);
  const next = new PuzzleRewardSession({ id: 'new-run-2', previous,
    start: async id => { nextStarted = true; return { id }; }, submit: async () => ({ ok: true }),
  });
  await previous.started;
  assert.equal(nextStarted, false);
  saving.resolve();
  await rejected;
  assert.equal((await next.started).id, 'new-run-2');
  assert.equal(nextStarted, true);
});

test('guest play does not submit a score or invent a point balance', async () => {
  const session = new PuzzleRewardSession({ id: 'guest-run-1', start: async () => ({ status: 'guest' }), submit: () => assert.fail('guest submitted') });
  const result = await session.save({ score: 5000 });
  assert.equal(result.retryable, false);
  assert.deepEqual(result.reward, { status: 'guest' });
  assert.match(gameRewardText(result.reward), /LINEログイン/);
  assert.doesNotMatch(gameRewardText(result.reward), /保有|＋/);
});

test('failed start preserves ranking without claiming reward or creating a late start', async () => {
  const calls = [];
  const session = new PuzzleRewardSession({ id: 'failed-run-1', start: async () => { throw new Error('offline'); },
    submit: async score => { calls.push(score); return { ok: true, reward: { ...receipt, points: 0, status: 'legacy' } }; },
  });
  const result = await session.save({ score: 7500, merges: 25, stage: 6 });
  assert.equal('runId' in calls[0], false);
  assert.equal(result.reward.status, 'start_error');
  assert.match(gameRewardText(result.reward), /開始を記録できなかった/);
});

test('zero score does not call the score endpoint', async () => {
  const session = new PuzzleRewardSession({ id: 'zero-run-1', start: async id => ({ id }), submit: () => assert.fail('zero submitted') });
  assert.equal((await session.save({ score: 0, merges: 0, stage: 0 })).reward.status, 'no_score');
});

test('reward display uses only server amounts and gives specific zero-point reasons', () => {
  assert.match(gameRewardText(receipt), /＋75 P.*保有 1,225 P.*今日 275 \/ 1,000 P/);
  for (const [status, reason] of Object.entries({ too_short: '30秒未満', no_score: '100スコア', daily_limit: '上限', expired: '期限', superseded: '新しいプレイ', legacy: '開始記録', offline: '記録なし' })) {
    const text = gameRewardText({ ...receipt, points: 0, status });
    assert.ok(text.includes(reason), status);
    assert.doesNotMatch(text, /＋75/);
  }
  assert.doesNotMatch(gameRewardText({ status: 'unknown', points: NaN, balance: -1 }), /NaN|保有/);
  assert.match(gameRewardText(null), /確認できません/);
});

test('puzzle API uses token and run ID, returning the exact server reward', async t => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  t.after(() => { globalThis.window = oldWindow; globalThis.fetch = oldFetch; });
  globalThis.window = { liff: { isLoggedIn: () => true, getAccessToken: () => 'test-token' } };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => url.endsWith('/start') ? { id: 'api-run-1' } : { best: 7500, rank: 3, updated: false, reward: receipt } };
  };
  assert.deepEqual(await startScoreRun('api-run-1'), { id: 'api-run-1', status: 'ready' });
  const result = await submitScore({ score: 7500, merges: 25, stage: 6, runId: 'api-run-1' });
  assert.deepEqual(calls.map(c => c.url), ['/api/mochi/runs/start', '/api/mochi/score']);
  assert.deepEqual(calls[0].body, { accessToken: 'test-token', id: 'api-run-1' });
  assert.equal(calls[1].body.runId, 'api-run-1');
  assert.equal(calls[1].body.accessToken, 'test-token');
  assert.equal('userId' in calls[1].body, false);
  assert.deepEqual(result.reward, receipt);
});
