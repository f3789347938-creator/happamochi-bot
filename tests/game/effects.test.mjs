import test from 'node:test';
import assert from 'node:assert/strict';
import { MochiEffects } from '../../public/static/game/effects.mjs';

test('long bursts stay bounded and expired effects are discarded', () => {
  const fx = new MochiEffects(null);
  for (let i = 0; i < 150; i++) fx.merge({ x: 210, y: 350, level: 3, combo: i + 1, points: 70, final: false }, 0);
  assert.ok(fx.items.length <= 240);
  assert.ok(fx.items.filter(item => item.type === 'label').length <= 4);
  fx.prune(3000); assert.equal(fx.items.length, 0);
  fx.reset(); assert.equal(fx.banner, null); assert.equal(fx.kick, null);
});

test('reduced motion keeps outcome labels without particles, rings or camera motion', () => {
  const fx = new MochiEffects(null, { reducedMotion: true });
  fx.merge({ x: 210, y: 350, level: 2, combo: 3, points: 50, final: false }, 0);
  fx.skill({ skill: 'evolve', fromLevel: 0, level: 1, x: 210, y: 350, points: 10 }, 0);
  assert.ok(fx.items.some(item => item.type === 'label'));
  assert.ok(fx.items.every(item => !['particle', 'ring'].includes(item.type)));
  assert.deepEqual(fx.camera(100), { x: 0, y: 0 });
});
