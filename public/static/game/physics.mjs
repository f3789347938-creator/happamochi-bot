export const WORLD = Object.freeze({ width: 420, height: 560, left: 22, right: 398, bottom: 532, line: 128, spawnY: 53 });
export const STAGES = Object.freeze([
  { name: '白もち', short: 'しろ', radius: 22, color: '#fffaf3', points: 10, sprite: [68, 103, 383, 339], anchor: 169.5 },
  { name: 'さくらもち', short: 'さくら', radius: 32, color: '#ffc2d1', points: 30, sprite: [573, 98, 390, 344], anchor: 172 },
  { name: '葉っぱもち', short: '葉っぱ', radius: 46, color: '#c4e69a', points: 70, sprite: [1084, 63, 389, 379], anchor: 209.5 },
  { name: 'きなこもち', short: 'きなこ', radius: 64, color: '#ffe49b', points: 150, sprite: [66, 598, 386, 344], anchor: 172 },
  { name: 'こんがりもち', short: 'こんがり', radius: 86, color: '#f5cd96', points: 500, sprite: [573, 598, 390, 345], anchor: 172.5 },
]);
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export class MochiPhysics {
  constructor(Matter, { random = Math.random, onEvent = () => {} } = {}) {
    this.M = Matter;
    this.random = random;
    this.onEvent = onEvent;
    this.engine = Matter.Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
    this.engine.gravity.y = 1.25;
    this.pending = new Map();
    const collect = event => {
      for (const pair of event.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        if (event.name === 'collisionStart') {
          for (const body of [a, b]) {
            if (body.mochi && body.speed > 0.9) {
              body.mochi.hitAt = this.time;
              body.mochi.hitStrength = Math.min(body.speed / 9, 1);
            }
          }
        }
        if (a.mochi && b.mochi && a.mochi.level === b.mochi.level) {
          const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
          this.pending.set(key, [a, b]);
        }
      }
    };
    Matter.Events.on(this.engine, 'collisionStart collisionActive', collect);
    this.reset();
  }

  reset() {
    const { Composite, Engine, Bodies } = this.M;
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.pending.clear();
    this.bodies = [];
    this.time = 0;
    this.score = 0;
    this.drops = 0;
    this.merges = 0;
    this.highest = 0;
    this.combo = 0;
    this.lastMerge = -10000;
    this.currentLevel = 0;
    this.nextLevel = 0;
    this.readyAt = 0;
    this.gameOver = false;
    this.danger = 0;
    Composite.add(this.engine.world, [
      Bodies.rectangle(6, -100, 32, 1400, { isStatic: true, friction: 0.35, restitution: 0.05 }),
      Bodies.rectangle(414, -100, 32, 1400, { isStatic: true, friction: 0.35, restitution: 0.05 }),
      Bodies.rectangle(210, 552, 440, 40, { isStatic: true, friction: 0.65, restitution: 0.1 }),
    ]);
  }

  pickLevel() {
    const roll = this.random();
    return roll < 0.52 ? 0 : roll < 0.87 ? 1 : 2;
  }

  get canDrop() { return !this.gameOver && this.time >= this.readyAt; }
  clampX(x, level = this.currentLevel) {
    const radius = STAGES[level].radius;
    return clamp(Number.isFinite(x) ? x : 210, WORLD.left + radius + 2, WORLD.right - radius - 2);
  }

  addMochi(level, x, y, options = {}) {
    if (!Number.isInteger(level) || !STAGES[level]) throw new Error('Invalid mochi level');
    const { Bodies, Body, Composite } = this.M;
    const radius = STAGES[level].radius;
    const body = Bodies.circle(this.clampX(x, level), Math.min(y, WORLD.bottom - radius * 0.89 - 1), radius, {
      restitution: 0.15, friction: 0.32, frictionStatic: 0.55, frictionAir: 0.006,
      density: 0.0015, slop: 0.035, sleepThreshold: 80,
    }, 32);
    Body.scale(body, 1, 0.89);
    body.mochi = { level, bornAt: this.time, dangerTime: 0, hitAt: -1000, hitStrength: 0, ...options };
    Composite.add(this.engine.world, body);
    this.bodies.push(body);
    this.highest = Math.max(this.highest, level);
    return body;
  }

  drop(x) {
    if (!this.canDrop) return null;
    const body = this.addMochi(this.currentLevel, x, WORLD.spawnY);
    this.M.Body.setVelocity(body, { x: 0, y: 0.7 });
    this.drops++;
    this.currentLevel = this.nextLevel;
    this.nextLevel = this.pickLevel();
    this.readyAt = this.time + 520;
    this.onEvent({ type: 'drop', body });
    return body;
  }

  processMerges() {
    const claimed = new Set();
    for (const [a, b] of this.pending.values()) {
      if (claimed.has(a.id) || claimed.has(b.id) || !this.bodies.includes(a) || !this.bodies.includes(b)) continue;
      const level = a.mochi.level;
      if (level !== b.mochi.level) continue;
      claimed.add(a.id); claimed.add(b.id);
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      const velocity = { x: (a.velocity.x + b.velocity.x) * 0.18, y: Math.min((a.velocity.y + b.velocity.y) * 0.15, 0) - 0.3 };
      this.M.Composite.remove(this.engine.world, [a, b]);
      this.bodies = this.bodies.filter(body => body !== a && body !== b);
      this.combo = this.time - this.lastMerge < 1500 ? this.combo + 1 : 1;
      this.lastMerge = this.time;
      const bonus = Math.min(this.combo - 1, 4) * 5;
      const points = STAGES[level].points + bonus;
      this.score += points;
      this.merges++;
      const final = level === STAGES.length - 1;
      if (!final) {
        const made = this.addMochi(level + 1, x, y, { hitAt: this.time, hitStrength: 0.8 });
        this.M.Body.setVelocity(made, velocity);
        this.M.Body.setAngularVelocity(made, (a.angularVelocity + b.angularVelocity) * 0.12);
      }
      // Wake the pile after a merge removes its support.
      for (const body of this.bodies) this.M.Sleeping.set(body, false);
      this.onEvent({ type: 'merge', level, x, y, points, combo: this.combo, final, score: this.score });
    }
    this.pending.clear();
  }

  containBodies() {
    // A growing merged body can temporarily overlap its neighbours. Keep the
    // visible geometry inside the bowl even if that pressure overwhelms the
    // solver for a frame; otherwise a mochi may tunnel through a thin floor.
    for (const body of this.bodies) {
      let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const vertex of body.vertices) {
        minX = Math.min(minX, vertex.x); maxX = Math.max(maxX, vertex.x); maxY = Math.max(maxY, vertex.y);
      }
      const dx = minX < WORLD.left ? WORLD.left - minX : maxX > WORLD.right ? WORLD.right - maxX : 0;
      const dy = maxY > WORLD.bottom ? WORLD.bottom - maxY : 0;
      if (dx || dy) {
        this.M.Body.translate(body, { x: dx, y: dy });
        this.M.Body.setVelocity(body, {
          x: dx && body.velocity.x * dx < 0 ? -body.velocity.x * 0.08 : body.velocity.x,
          y: dy && body.velocity.y > 0 ? -body.velocity.y * 0.08 : body.velocity.y,
        });
      }
    }
  }

  step(delta = 1000 / 60) {
    if (this.gameOver) return;
    const dt = clamp(delta, 0, 1000 / 60);
    this.time += dt;
    this.M.Engine.update(this.engine, dt);
    this.containBodies();
    this.processMerges();
    let danger = 0;
    for (const body of this.bodies) {
      const data = body.mochi;
      const mature = this.time - data.bornAt > 1250;
      // Matter's broad-phase bounds include predicted motion, not just visible geometry.
      const aboveLine = Math.min(...body.vertices.map(vertex => vertex.y)) < WORLD.line;
      data.dangerTime = mature && aboveLine ? data.dangerTime + dt : 0;
      danger = Math.max(danger, data.dangerTime / 2400);
    }
    this.danger = clamp(danger, 0, 1);
    if (this.danger >= 1) {
      this.gameOver = true;
      this.onEvent({ type: 'over', score: this.score, merges: this.merges, highest: this.highest });
    }
  }

  landingY(x, level = this.currentLevel) {
    const radius = STAGES[level].radius;
    let y = WORLD.bottom - radius * 0.89;
    for (const body of this.bodies) {
      const sum = radius + STAGES[body.mochi.level].radius;
      const dx = Math.abs(x - body.position.x);
      if (dx < sum) y = Math.min(y, body.position.y - Math.sqrt(sum * sum - dx * dx) * 0.89);
    }
    return Math.max(WORLD.spawnY, y);
  }
}
