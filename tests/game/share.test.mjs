import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotResult, resultText, publicShareUrl, lineShareUrl, canShareImage, shareResultImage } from '../../public/static/game/share.mjs';

test('shared results are frozen at game over and use this run rather than a past best', () => {
  const game = { score: 12345, highest: 8, merges: 27, skillUses: 2 };
  const result = snapshotResult(game, 20000, 20000);
  game.score = 0; game.highest = 0; game.merges = 0; game.skillUses = 0;
  assert.ok(Object.isFrozen(result));
  assert.equal(result.score, 12345); assert.equal(result.highest, 8); assert.equal(result.isNewBest, false);
  const text = resultText(result);
  assert.ok(text.includes('スコア：12,345点')); assert.ok(text.includes('いちご大福（9/11）'));
  assert.ok(text.includes('合体：27回')); assert.ok(text.includes('スキル：2/3回'));
  assert.ok(!text.includes('20,000'));
});

test('invalid numbers and stages cannot appear in the result text', () => {
  const result = snapshotResult({ score: Infinity, highest: 11, merges: -1, skillUses: 9 }, NaN, 0);
  assert.deepEqual(result, { score: 0, highest: 0, merges: 0, skillUses: 3, best: 0, isNewBest: false });
  const text = resultText(result);
  assert.ok(text.includes('白もち（1/11）')); assert.ok(!/NaN|Infinity|undefined/.test(text));
});

test('LINE URL preserves Japanese and newlines in one encoded text parameter', () => {
  const result = snapshotResult({ score: 1500, highest: 10, merges: 20, skillUses: 3 }, 1500, 1200);
  const text = resultText(result, 'https://game.example/play/');
  const url = new URL(lineShareUrl(text));
  assert.equal(url.origin, 'https://line.me'); assert.equal(url.pathname, '/R/share');
  assert.equal(url.searchParams.get('text'), text); assert.deepEqual([...url.searchParams.keys()], ['text']);
  assert.ok(text.includes('王様もち（11/11）')); assert.ok(text.endsWith('https://game.example/play/'));
});

test('private trial and login parameters are never automatically added to shares', () => {
  const result = snapshotResult({ score: 10, highest: 1, merges: 1, skillUses: 0 }, 10, 0);
  assert.ok(!resultText(result).includes('https://'));
  assert.equal(publicShareUrl('https://game.example/play/?access_token=private&liff.state=secret#id_token'), 'https://game.example/play/');
  for (const url of ['', '/play', 'javascript:alert(1)', 'http://game.example', 'https://user:secret@game.example']) assert.equal(publicShareUrl(url), '');
});

test('unsupported file sharing returns without opening or sending anything', async () => {
  const file = new Blob(['test'], { type: 'image/png' });
  let calls = 0;
  const unsupported = { canShare: () => false, share: () => { calls++; } };
  assert.equal(canShareImage(unsupported, file), false);
  assert.equal(await shareResultImage(unsupported, file), 'unavailable');
  assert.equal(canShareImage({ canShare: () => { throw Error('not supported'); }, share() {} }, file), false);
  assert.equal(await shareResultImage({}, file), 'unavailable'); assert.equal(calls, 0);
});

test('file sharing handles success, cancellation and failure without retrying or sending text', async () => {
  const file = new Blob(['test'], { type: 'image/png' });
  for (const [outcome, name] of [['shared', null], ['cancelled', 'AbortError'], ['failed', 'NotAllowedError']]) {
    let calls = 0;
    const navigator = { canShare: () => true, share: async data => {
      calls++; assert.deepEqual(Object.keys(data), ['files']); assert.deepEqual(data.files, [file]);
      if (name) { const error = new Error('test'); error.name = name; throw error; }
    } };
    assert.equal(await shareResultImage(navigator, file), outcome); assert.equal(calls, 1);
  }
});
