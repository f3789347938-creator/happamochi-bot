import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from './matter-loader.mjs';
import { MochiPhysics, WORLD, STAGES } from '../../public/static/game/physics.mjs';

const advance = (game, frames) => { for (let i = 0; i < frames; i++) game.step(); };
const seedRandom = start => { let n = start; return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; }; };

test('two dropped white mochi merge once and remain inside the bowl', () => {
  const events = [], game = new MochiPhysics(Matter, { onEvent: e => events.push(e) });
  assert.ok(game.drop(210));
  assert.equal(game.drop(210), null, 'rapid releases cannot bypass the cooldown');
  advance(game, 100);
  assert.equal(game.gameOver, false);
  assert.ok(game.drop(210));
  advance(game, 160);
  assert.equal(game.score, 10);
  assert.equal(game.bodies.length, 1);
  assert.equal(game.bodies[0].mochi.level, 1);
  assert.equal(events.filter(e => e.type === 'merge').length, 1);
  assert.ok(game.bodies[0].bounds.max.y <= WORLD.bottom + 1);
});

test('different kinds can touch without merging', () => {
  const game = new MochiPhysics(Matter);
  game.addMochi(0, 170, 470); game.addMochi(1, 218, 470);
  advance(game, 200);
  assert.equal(game.bodies.length, 2); assert.equal(game.score, 0);
});

test('simultaneous three-way contact never consumes one mochi twice', () => {
  const game = new MochiPhysics(Matter);
  game.addMochi(0, 185, 400); game.addMochi(0, 210, 400); game.addMochi(0, 235, 400);
  advance(game, 1);
  assert.equal(game.score, 10); assert.equal(game.bodies.length, 2);
  assert.deepEqual(game.bodies.map(b => b.mochi.level).sort(), [0, 1]);
});

test('a falling merge can trigger a second merge and its chain bonus', () => {
  const game = new MochiPhysics(Matter);
  game.addMochi(1, 205, 502);
  game.addMochi(0, 190, 450); game.addMochi(0, 220, 450);
  advance(game, 160);
  assert.equal(game.merges, 2); assert.equal(game.score, 45);
  assert.equal(game.bodies.length, 1); assert.equal(game.bodies[0].mochi.level, 2);
});

test('two final-stage mochi clear and award the final bonus', () => {
  const game = new MochiPhysics(Matter);
  game.addMochi(10, 160, 415); game.addMochi(10, 270, 415);
  advance(game, 2);
  assert.equal(game.bodies.length, 0); assert.equal(game.score, 1500);
  assert.equal(game.highest, 10);
});

test('all ten upgrades lead to the eleventh kind without clearing early', () => {
  assert.equal(STAGES.length, 11);
  for (let level = 0; level < 10; level++) {
    const events = [], game = new MochiPhysics(Matter, { onEvent: event => events.push(event) });
    const radius = STAGES[level].radius;
    game.addMochi(level, 210 - radius * 0.8, 350);
    game.addMochi(level, 210 + radius * 0.8, 350);
    advance(game, 120);
    assert.equal(game.bodies.length, 1, `stage ${level + 1} must upgrade, not disappear`);
    assert.equal(game.bodies[0].mochi.level, level + 1);
    assert.equal(game.highest, level + 1);
    assert.equal(events.filter(event => event.type === 'merge').length, 1);
    assert.equal(events.find(event => event.type === 'merge').final, false);
    assert.ok(Math.max(...game.bodies[0].vertices.map(vertex => vertex.y)) <= WORLD.bottom + 1);
  }
});

test('random drops use the first five kinds and never grant an advanced stage', () => {
  const game = new MochiPhysics(Matter, { random: seedRandom(123) });
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const level = game.pickLevel();
    assert.ok(level >= 0 && level <= 4);
    seen.add(level);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
  const maximumRoll = new MochiPhysics(Matter, { random: () => 1 - Number.EPSILON });
  assert.equal(maximumRoll.pickLevel(), 4);
});

test('overflow has a landing grace period, then ends the game once', () => {
  const events = [], game = new MochiPhysics(Matter, { onEvent: e => events.push(e) });
  const stuck = game.addMochi(0, 210, 118);
  Matter.Body.setStatic(stuck, true);
  advance(game, 190);
  assert.equal(game.gameOver, false); assert.ok(game.danger > 0);
  advance(game, 60);
  assert.equal(game.gameOver, true);
  advance(game, 100);
  assert.equal(events.filter(e => e.type === 'over').length, 1);
  assert.equal(game.drop(210), null);
});

test('a mochi rescued below the line cancels its overflow countdown', () => {
  const game = new MochiPhysics(Matter), body = game.addMochi(0, 210, 118);
  Matter.Body.setStatic(body, true); advance(game, 150);
  assert.ok(game.danger > 0);
  Matter.Body.setPosition(body, { x: 210, y: 300 }); advance(game, 300);
  assert.equal(game.danger, 0); assert.equal(game.gameOver, false);
});

test('reset clears the old game and leaves a playable new board', () => {
  const game = new MochiPhysics(Matter);
  game.addMochi(0, 200, 400); game.addMochi(0, 215, 400); advance(game, 10);
  game.reset();
  assert.equal(game.score, 0); assert.equal(game.merges, 0); assert.equal(game.danger, 0);
  assert.equal(game.bodies.length, 0); assert.equal(Matter.Composite.allBodies(game.engine.world).length, 3);
  game.drop(210); advance(game, 100); game.drop(210); advance(game, 120);
  assert.equal(game.score, 10);
});

test('randomized full games keep finite bodies, legal stages and bounded positions', () => {
  for (let run = 1; run <= 5; run++) {
    const rng = seedRandom(run), game = new MochiPhysics(Matter, { random: rng });
    for (let frame = 0; frame < 15000 && !game.gameOver; frame++) {
      if (game.canDrop) game.drop(24 + rng() * 372);
      game.step();
      for (const body of game.bodies) {
        assert.ok(Number.isFinite(body.position.x) && Number.isFinite(body.position.y));
        assert.ok(STAGES[body.mochi.level]);
        assert.ok(Math.max(...body.vertices.map(vertex => vertex.y)) < WORLD.bottom + 3, 'no mochi falls through the floor');
        assert.ok(body.position.x > WORLD.left - 5 && body.position.x < WORLD.right + 5, 'no mochi escapes the sides');
      }
    }
    assert.ok(game.score > 0); assert.ok(game.drops > 10);
  }
});
