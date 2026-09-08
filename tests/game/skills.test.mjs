import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from './matter-loader.mjs';
import { MochiPhysics, WORLD, STAGES, POWER, SKILLS } from '../../public/static/game/physics.mjs';

const advance = (game, frames) => { for (let i = 0; i < frames; i++) game.step(); };
const seeded = start => { let n = start; return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; }; };

function fillPairs(game, levels) {
  levels.forEach((level, index) => {
    const y = 440 - index * 90;
    game.addMochi(level, 92, y); game.addMochi(level, 328, y);
  });
}

test('start with zero power, earn five per natural merge, and cap at one hundred', () => {
  const game = new MochiPhysics(Matter);
  assert.equal(game.power, 0);
  game.addMochi(0, 200, 400); game.addMochi(0, 220, 400); advance(game, 2);
  assert.equal(game.power, 5);
  for (let i = 0; i < 22; i++) {
    game.addMochi(10, 160, 320); game.addMochi(10, 270, 320); advance(game, 2);
    assert.equal(game.power, Math.min(100, 5 + (i + 1) * 5));
  }
});

test('empty boards, missing pairs and insufficient power do not waste skills', () => {
  const game = new MochiPhysics(Matter); game.power = 100;
  assert.equal(game.useRoll(), false); assert.equal(game.beginSnack(), false); assert.equal(game.beginEvolve(), false);
  game.addMochi(0, 90, 440); game.addMochi(1, 320, 440);
  assert.equal(game.useRoll(), false); assert.equal(game.power, 100);
  game.power = 0;
  assert.equal(game.beginSnack(), false); assert.equal(game.beginEvolve(), false); assert.equal(game.canUseSkill('unknown'), false);
  assert.equal(game.skillUses, 0);
});

test('super fusion merges three distant pairs, scores each once and does not refund power', () => {
  const events = [], game = new MochiPhysics(Matter, { onEvent: event => events.push(event) });
  fillPairs(game, [6, 4, 2]); game.power = 100;
  assert.equal(game.useRoll(), true); assert.equal(game.power, 30); assert.equal(game.skillUses, 1);
  assert.equal(game.fusionPairs.length, 3);
  assert.equal(new Set(game.fusionPairs.flatMap(pair => [pair.a.id, pair.b.id])).size, 6);
  assert.equal(game.drop(210), null); assert.equal(game.useRoll(), false); assert.equal(game.beginEvolve(), false);
  advance(game, 65);
  assert.deepEqual(game.bodies.map(body => body.mochi.level).sort((a, b) => a - b), [3, 5, 7]);
  assert.equal(game.score, 385); assert.equal(game.power, 30);
  assert.equal(events.filter(event => event.type === 'merge' && event.origin === 'roll').length, 3);
  assert.equal(game.fusionPairs.length, 0); assert.equal(game.canDrop, true);
});

test('super fusion takes at most three pairs and prioritizes advanced kinds', () => {
  const events = [], game = new MochiPhysics(Matter, { onEvent: event => events.push(event) });
  fillPairs(game, [3, 2, 1, 0]); game.power = 100; game.useRoll(); advance(game, 61);
  const forced = events.filter(event => event.type === 'merge' && event.origin === 'roll');
  assert.deepEqual(forced.map(event => event.level), [3, 2, 1]);
  assert.equal(game.bodies.filter(body => body.mochi.level === 0).length, 2);
  assert.equal(game.bodies.length, 5);
});

test('bomb removes exactly the previewed group of at most six and leaves distant mochi', () => {
  const events = [], game = new MochiPhysics(Matter, { onEvent: event => events.push(event) });
  const selected = game.addMochi(0, 210, 390);
  for (let i = 0; i < 6; i++) game.addMochi(i + 1, 175 + i * 12, 400 + i * 2);
  const far = game.addMochi(0, 65, 160);
  const preview = game.blastTargets(selected.id).map(body => body.id);
  assert.equal(preview.length, 6); assert.ok(preview.includes(selected.id)); assert.ok(!preview.includes(far.id));
  game.power = 100; game.beginSnack(); assert.equal(game.eatMochi(selected.id), true);
  assert.equal(game.power, 10); assert.equal(game.score, 0); assert.equal(game.merges, 0);
  assert.equal(game.bodies.length, 2); assert.ok(game.bodies.includes(far));
  assert.ok(game.bodies.every(body => !preview.includes(body.id)));
  assert.equal(events.find(event => event.type === 'skill').victims.length, 6);
  assert.equal(game.eatMochi(selected.id), false); assert.equal(game.power, 10);
});

test('target selection freezes time; cancellation and invalid targets spend nothing', () => {
  for (const skill of ['snack', 'evolve']) {
    const game = new MochiPhysics(Matter), body = game.addMochi(1, 210, 400); game.power = 100;
    const begin = () => skill === 'snack' ? game.beginSnack() : game.beginEvolve();
    const confirm = id => skill === 'snack' ? game.eatMochi(id) : game.evolveMochi(id);
    assert.equal(begin(), true);
    const time = game.time, position = { ...body.position }; advance(game, 400);
    assert.equal(game.time, time); assert.deepEqual(body.position, position); assert.equal(game.drop(210), null);
    assert.equal(confirm(-1), false); assert.equal(game.power, 100); assert.equal(game.activeSkill, skill);
    game.cancelSkill(); assert.equal(game.power, 100); assert.equal(game.bodies.length, 1);
    assert.equal(game.skillDropsRemaining, 0);
    assert.equal(begin(), true); assert.equal(confirm(body.id), true);
    assert.equal(game.power, skill === 'snack' ? 10 : 40); assert.equal(confirm(body.id), false);
    assert.equal(game.skillDropsRemaining, 8);
    assert.equal(game.activeSkill, null); assert.equal(game.beginEvolve(), false);
  }
});

test('single mochi evolution guarantees one upgrade and can start a natural chain', () => {
  const game = new MochiPhysics(Matter); game.power = 100;
  game.addMochi(1, 205, 502); const target = game.addMochi(0, 205, 450);
  game.beginEvolve(); assert.equal(game.evolveMochi(target.id), true);
  assert.equal(game.power, 40); assert.equal(game.score, 10); assert.equal(game.merges, 0);
  assert.deepEqual(game.bodies.map(body => body.mochi.level), [1, 1]);
  advance(game, 160);
  assert.equal(game.bodies.length, 1); assert.equal(game.bodies[0].mochi.level, 2);
  assert.equal(game.score, 40); assert.equal(game.power, 45); assert.equal(game.merges, 1);
  assert.equal(game.skillDropsRemaining, 8);
});

test('evolution reaches the king but never creates an invalid twelfth stage', () => {
  const game = new MochiPhysics(Matter); game.power = 100;
  const toasted = game.addMochi(9, 210, 400);
  game.beginEvolve(); assert.equal(game.evolveMochi(toasted.id), true);
  assert.equal(game.bodies[0].mochi.level, 10); assert.equal(game.highest, 10);
  const selection = new MochiPhysics(Matter); selection.power = 100;
  const king = selection.addMochi(10, 210, 400);
  assert.equal(selection.beginEvolve(), false);
  selection.addMochi(0, 75, 200);
  assert.equal(selection.beginEvolve(), true); assert.equal(selection.evolveMochi(king.id), false);
  assert.equal(selection.power, 100); assert.equal(selection.activeSkill, 'evolve');
});

test('super fusion rescues an overflowing pair without losing during the animation', () => {
  const game = new MochiPhysics(Matter);
  for (const x of [80, 340]) Matter.Body.setStatic(game.addMochi(0, x, 118), true);
  advance(game, 190); assert.ok(game.danger > 0); assert.equal(game.gameOver, false);
  game.power = 100; game.useRoll(); assert.equal(game.danger, 0);
  advance(game, 180); assert.equal(game.gameOver, false);
  assert.equal(game.bodies.length, 1); assert.equal(game.bodies[0].mochi.level, 1);
});

test('reset cancels pending fusion and game over rejects skills and confirmations', () => {
  const game = new MochiPhysics(Matter); fillPairs(game, [0]); game.power = 100; game.useRoll(); game.reset();
  advance(game, 150);
  assert.equal(game.power, POWER.initial); assert.equal(game.score, 0); assert.equal(game.merges, 0);
  assert.equal(game.bodies.length, 0); assert.equal(game.fusionPairs.length, 0); assert.equal(game.skillUses, 0);
  assert.equal(game.skillDropsRemaining, 0);
  const body = game.addMochi(0, 210, 430); game.power = 100; game.beginEvolve(); game.gameOver = true;
  assert.equal(game.evolveMochi(body.id), false); assert.equal(game.eatMochi(body.id), false);
  game.cancelSkill(); assert.equal(game.useRoll(), false); assert.equal(game.beginSnack(), false); assert.equal(game.beginEvolve(), false);
  assert.equal(game.power, 100);
});

test('each skill requires its new full cost even when the board has a valid target', () => {
  for (const [skill, cost] of [['roll', 70], ['snack', 90], ['evolve', 60]]) {
    const game = new MochiPhysics(Matter); fillPairs(game, [0]);
    game.power = cost - 5; assert.equal(game.canUseSkill(skill), false);
    game.power = cost; assert.equal(game.canUseSkill(skill), true);
    if (skill === 'roll') game.useRoll();
    else if (skill === 'snack') { game.beginSnack(); game.eatMochi(game.bodies[0].id); }
    else { game.beginEvolve(); game.evolveMochi(game.bodies[0].id); }
    assert.equal(game.power, 0); assert.equal(game.skillUses, 1);
    assert.equal(game.skillDropsRemaining, 8);
  }
});

test('all skills share an eight-drop lock that time, merges and cancelled drops cannot bypass', () => {
  for (const first of Object.keys(SKILLS)) {
    const game = new MochiPhysics(Matter); fillPairs(game, [0]); game.power = 100;
    if (first === 'roll') game.useRoll();
    else if (first === 'snack') { game.beginSnack(); game.eatMochi(game.bodies[0].id); }
    else { game.beginEvolve(); game.evolveMochi(game.bodies[0].id); }
    // Refill power to isolate the shared drop requirement from affordability.
    game.power = 100; advance(game, 1000);
    assert.equal(game.skillDropsRemaining, 8);
    const pair = [game.addMochi(0, 80, 430), game.addMochi(0, 340, 430)];
    game.mergePair(...pair);
    assert.equal(game.skillDropsRemaining, 8);
    for (const skill of Object.keys(SKILLS)) assert.equal(game.canUseSkill(skill), false);
    for (let count = 1; count <= 8; count++) {
      assert.ok(game.drop(55 + count * 35));
      assert.equal(game.drop(210), null);
      assert.equal(game.skillDropsRemaining, 8 - count);
      advance(game, 35);
      if (count < 8) for (const skill of Object.keys(SKILLS)) assert.equal(game.canUseSkill(skill), false);
    }
    fillPairs(game, [2]); game.power = 100;
    for (const skill of Object.keys(SKILLS)) assert.equal(game.canUseSkill(skill), true);
    assert.equal(game.beginEvolve(), true); game.cancelSkill();
    assert.equal(game.skillDropsRemaining, 0);
    game.beginSnack(); game.eatMochi(game.bodies[0].id);
    assert.equal(game.skillDropsRemaining, 8);
    game.reset(); assert.equal(game.skillDropsRemaining, 0); assert.equal(game.power, 0);
  }
});

test('the third use exhausts every skill even with power and the drop lock cleared; reset restores uses', () => {
  const game = new MochiPhysics(Matter); fillPairs(game, [1]); game.power = 100;
  game.skillUses = 2;
  assert.equal(game.skillUsesRemaining, 1);
  game.beginEvolve(); game.cancelSkill(); assert.equal(game.skillUsesRemaining, 1);
  game.beginEvolve(); assert.equal(game.evolveMochi(game.bodies[0].id), true);
  assert.equal(game.skillUses, 3); assert.equal(game.skillUsesRemaining, 0);
  advance(game, 100); game.power = 100; game.skillReadyAfterDrop = game.drops; fillPairs(game, [2]);
  for (const skill of Object.keys(SKILLS)) assert.equal(game.canUseSkill(skill), false);
  assert.equal(game.useRoll(), false); assert.equal(game.beginSnack(), false); assert.equal(game.beginEvolve(), false);
  game.reset(); assert.equal(game.skillUsesRemaining, 3); assert.equal(game.power, 0);
  fillPairs(game, [0]); game.power = 100;
  for (const skill of Object.keys(SKILLS)) assert.equal(game.canUseSkill(skill), true);
});

test('full games using upgraded skills preserve power, stage count and boundaries', () => {
  const used = new Set();
  for (let run = 4; run <= 6; run++) {
    const rng = seeded(run), game = new MochiPhysics(Matter, { random: rng, onEvent: event => { if (event.type === 'skill') used.add(event.skill); } });
    let skillTurn = run - 4;
    for (let frame = 0; frame < 18000 && !game.gameOver; frame++) {
      const skill = ['roll', 'snack', 'evolve'][skillTurn % 3];
      if (game.canUseSkill(skill) && rng() < 0.1) {
        if (skill === 'snack') { game.beginSnack(); game.eatMochi(game.bodies[Math.floor(rng() * game.bodies.length)].id); }
        else if (skill === 'roll') game.useRoll();
        else { const eligible = game.bodies.filter(body => body.mochi.level < 10); game.beginEvolve(); game.evolveMochi(eligible[Math.floor(rng() * eligible.length)].id); }
        skillTurn++;
      }
      if (game.canDrop) game.drop(24 + rng() * 372);
      game.step();
      assert.ok(game.power >= 0 && game.power <= 100 && game.power % 5 === 0);
      assert.ok(game.skillUses <= 3 && game.skillUsesRemaining >= 0);
      for (const body of game.bodies) {
        assert.ok(STAGES[body.mochi.level]);
        assert.ok(Number.isFinite(body.position.x) && Number.isFinite(body.position.y));
        assert.ok(Math.max(...body.vertices.map(v => v.y)) < WORLD.bottom + 3);
        assert.ok(Math.min(...body.vertices.map(v => v.x)) > WORLD.left - 3);
        assert.ok(Math.max(...body.vertices.map(v => v.x)) < WORLD.right + 3);
      }
    }
    assert.ok(game.skillUses > 0);
  }
  assert.deepEqual([...used].sort(), ['evolve', 'roll', 'snack']);
});
