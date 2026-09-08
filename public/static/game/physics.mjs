export const WORLD = Object.freeze({ width: 420, height: 560, left: 22, right: 398, bottom: 532, line: 128, spawnY: 53 });
export const STAGES = Object.freeze([
  { name: '白もち', short: 'しろ', radius: 18, color: '#fffaf3', points: 10, sprite: [68, 103, 383, 339], anchor: 169.5 },
  { name: 'さくらもち', short: 'さくら', radius: 24, color: '#ffc2d1', points: 30, sprite: [573, 98, 390, 344], anchor: 172 },
  { name: 'きなこもち', short: 'きなこ', radius: 30, color: '#ffe49b', points: 50, sprite: [66, 598, 386, 344], anchor: 172 },
  { name: '葉っぱもち', short: '葉っぱ', radius: 37, color: '#c4e69a', points: 70, sprite: [1084, 63, 389, 379], anchor: 209.5 },
  { name: '黒ごまもち', short: '黒ごま', radius: 45, color: '#777781', points: 100, tint: '#655f6a', sprite: [68, 103, 383, 339], anchor: 169.5 },
  { name: '紫いももち', short: '紫いも', radius: 54, color: '#b895dd', points: 150, tint: '#af76d5', sprite: [68, 103, 383, 339], anchor: 169.5 },
  { name: 'チョコもち', short: 'チョコ', radius: 64, color: '#99684e', points: 220, tint: '#9f6f57', sprite: [573, 598, 390, 345], anchor: 172.5 },
  { name: 'みたらしもち', short: 'みたらし', radius: 75, color: '#e8ad54', points: 320, tint: '#f5aa3f', sprite: [573, 598, 390, 345], anchor: 172.5 },
  { name: 'いちご大福', short: 'いちご', radius: 87, color: '#ef778c', points: 500, tint: '#ff79a5', sprite: [573, 98, 390, 344], anchor: 172 },
  { name: 'こんがりもち', short: 'こんがり', radius: 100, color: '#f5cd96', points: 800, sprite: [573, 598, 390, 345], anchor: 172.5 },
  { name: '王様もち', short: '王様', radius: 114, color: '#f6ca56', points: 1500, tint: '#f4c842', sprite: [68, 103, 383, 339], anchor: 169.5 },
]);
// Only the first five stages fall directly; later stages must be made by merging.
export const DROP_WEIGHTS = Object.freeze([0.30, 0.25, 0.20, 0.15, 0.10]);
export const POWER = Object.freeze({ max: 100, initial: 0, perMerge: 5 });
export const SKILL_RULES = Object.freeze({ dropsBetweenUses: 8, maxUsesPerGame: 3 });
export const BLAST = Object.freeze({ radius: 120, maxBodies: 6 });
export const SKILLS = Object.freeze({
  roll: Object.freeze({ name: '超合体', cost: 70 }),
  snack: Object.freeze({ name: 'もちボム', cost: 90 }),
  evolve: Object.freeze({ name: 'もち進化', cost: 60 }),
});
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
    this.power = POWER.initial;
    this.skillUses = 0;
    this.activeSkill = null;
    this.skillReadyAt = 0;
    this.skillReadyAfterDrop = 0;
    this.fusionPairs = [];
    this.fusionEndsAt = 0;
    this.protectionUntil = 0;
    Composite.add(this.engine.world, [
      Bodies.rectangle(6, -100, 32, 1400, { isStatic: true, friction: 0.35, restitution: 0.05 }),
      Bodies.rectangle(414, -100, 32, 1400, { isStatic: true, friction: 0.35, restitution: 0.05 }),
      Bodies.rectangle(210, 552, 440, 40, { isStatic: true, friction: 0.65, restitution: 0.1 }),
    ]);
  }

  pickLevel() {
    let roll = this.random();
    for (let level = 0; level < DROP_WEIGHTS.length; level++) {
      roll -= DROP_WEIGHTS[level];
      if (roll < 0) return level;
    }
    return DROP_WEIGHTS.length - 1;
  }

  get canDrop() { return !this.gameOver && !this.activeSkill && this.time >= this.readyAt && this.time >= this.fusionEndsAt; }

  get skillDropsRemaining() { return Math.max(0, this.skillReadyAfterDrop - this.drops); }
  get skillUsesRemaining() { return Math.max(0, SKILL_RULES.maxUsesPerGame - this.skillUses); }

  canUseSkill(skill) {
    const config = SKILLS[skill];
    if (!config || !this.canDrop || this.time < this.skillReadyAt || this.skillDropsRemaining > 0 || this.skillUsesRemaining === 0 || this.power < config.cost) return false;
    if (skill === 'evolve') return this.bodies.some(body => body.mochi.level < STAGES.length - 1);
    if (skill === 'roll') {
      const seen = new Set();
      return this.bodies.some(body => {
        const level = body.mochi.level;
        if (seen.has(level)) return true;
        seen.add(level); return false;
      });
    }
    return this.bodies.length > 0;
  }

  spendSkill(skill, details = {}) {
    this.power -= SKILLS[skill].cost;
    this.skillUses++;
    this.skillReadyAt = skill === 'roll' ? this.fusionEndsAt + 250 : this.time + 500;
    this.skillReadyAfterDrop = this.drops + SKILL_RULES.dropsBetweenUses;
    this.onEvent({ type: 'skill', skill, ...details, power: this.power });
  }

  useRoll() {
    if (!this.canUseSkill('roll')) return false;
    const sorted = [...this.bodies].sort((a, b) => b.mochi.level - a.mochi.level || a.id - b.id), used = new Set();
    this.fusionPairs = [];
    for (const a of sorted) {
      if (used.has(a.id)) continue;
      const b = sorted.filter(body => body !== a && !used.has(body.id) && body.mochi.level === a.mochi.level)
        .sort((left, right) => Math.hypot(left.position.x - a.position.x, left.position.y - a.position.y) - Math.hypot(right.position.x - a.position.x, right.position.y - a.position.y))[0];
      if (!b) continue;
      used.add(a.id); used.add(b.id);
      const next = Math.min(a.mochi.level + 1, STAGES.length - 1), offset = this.fusionPairs.length * 170;
      this.fusionPairs.push({ a, b, fromA: { ...a.position }, fromB: { ...b.position },
        x: this.clampX((a.position.x + b.position.x) / 2, next),
        y: Math.min((a.position.y + b.position.y) / 2, WORLD.bottom - STAGES[next].radius * 0.89 - 1),
        startsAt: this.time + offset, mergesAt: this.time + offset + 420, done: false });
      if (this.fusionPairs.length === 3) break;
    }
    this.fusionEndsAt = this.fusionPairs.at(-1).mergesAt + 240;
    this.protectPile(this.fusionEndsAt - this.time + 700);
    this.spendSkill('roll', { pairs: this.fusionPairs.length });
    return true;
  }

  protectPile(duration = 700) {
    this.protectionUntil = this.time + duration;
    this.danger = 0;
    for (const body of this.bodies) { body.mochi.dangerTime = 0; this.M.Sleeping.set(body, false); }
  }

  beginSnack() {
    if (!this.canUseSkill('snack')) return false;
    this.activeSkill = 'snack';
    return true;
  }

  eatMochi(id) {
    if (this.gameOver || this.activeSkill !== 'snack' || this.power < SKILLS.snack.cost) return false;
    const body = this.bodies.find(item => item.id === id);
    if (!body) return false;
    const targets = this.blastTargets(id), removed = new Set(targets);
    const victims = targets.map(item => ({ level: item.mochi.level, x: item.position.x, y: item.position.y, angle: item.angle }));
    this.M.Composite.remove(this.engine.world, targets);
    this.bodies = this.bodies.filter(item => !removed.has(item));
    for (const [key, pair] of this.pending) if (pair.some(item => removed.has(item))) this.pending.delete(key);
    this.activeSkill = null;
    this.protectPile();
    this.spendSkill('snack', { x: body.position.x, y: body.position.y, victims, radius: BLAST.radius });
    return true;
  }

  blastTargets(id) {
    const selected = this.bodies.find(body => body.id === id);
    if (!selected) return [];
    const distance = body => Math.hypot(body.position.x - selected.position.x, body.position.y - selected.position.y);
    const neighbours = this.bodies.filter(body => body !== selected && distance(body) <= BLAST.radius)
      .sort((a, b) => distance(a) - distance(b) || a.id - b.id);
    return [selected, ...neighbours.slice(0, BLAST.maxBodies - 1)];
  }

  beginEvolve() {
    if (!this.canUseSkill('evolve')) return false;
    this.activeSkill = 'evolve';
    return true;
  }

  evolveMochi(id) {
    if (this.gameOver || this.activeSkill !== 'evolve' || this.power < SKILLS.evolve.cost) return false;
    const body = this.bodies.find(item => item.id === id);
    if (!body || body.mochi.level === STAGES.length - 1) return false;
    const fromLevel = body.mochi.level, level = fromLevel + 1, { x, y } = body.position;
    this.M.Composite.remove(this.engine.world, body);
    this.bodies = this.bodies.filter(item => item !== body);
    for (const [key, pair] of this.pending) if (pair.includes(body)) this.pending.delete(key);
    const made = this.addMochi(level, x, y, { hitAt: this.time, hitStrength: 1, merged: true });
    this.M.Body.setVelocity(made, { x: 0, y: -0.6 });
    const points = STAGES[fromLevel].points;
    this.score += points;
    this.activeSkill = null;
    this.protectPile();
    this.spendSkill('evolve', { fromLevel, level, x: made.position.x, y: made.position.y, points });
    return true;
  }

  cancelSkill() {
    const selected = Boolean(this.activeSkill);
    this.activeSkill = null;
    return selected;
  }
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
    const pairs = [...this.pending.values()];
    this.pending.clear();
    for (const [a, b] of pairs) this.mergePair(a, b);
  }

  mergePair(a, b, origin = 'natural', position = null) {
      if (a === b || !this.bodies.includes(a) || !this.bodies.includes(b) || a.mochi.level !== b.mochi.level) return false;
      const level = a.mochi.level;
      const x = position?.x ?? (a.position.x + b.position.x) / 2;
      const y = position?.y ?? (a.position.y + b.position.y) / 2;
      const velocity = { x: (a.velocity.x + b.velocity.x) * 0.18, y: Math.min((a.velocity.y + b.velocity.y) * 0.15, 0) - 0.3 };
      this.M.Composite.remove(this.engine.world, [a, b]);
      this.bodies = this.bodies.filter(body => body !== a && body !== b);
      this.combo = this.time - this.lastMerge < 1500 ? this.combo + 1 : 1;
      this.lastMerge = this.time;
      const bonus = Math.min(this.combo - 1, 4) * 5;
      const points = STAGES[level].points + bonus;
      this.score += points;
      this.merges++;
      // Forced fusions award points, but cannot refill the skill that caused them.
      if (origin === 'natural') this.power = Math.min(POWER.max, this.power + POWER.perMerge);
      const final = level === STAGES.length - 1;
      if (!final) {
        const made = this.addMochi(level + 1, x, y, { hitAt: this.time, hitStrength: 1, merged: true });
        this.M.Body.setVelocity(made, velocity);
        this.M.Body.setAngularVelocity(made, (a.angularVelocity + b.angularVelocity) * 0.12);
      }
      // Wake the pile after a merge removes its support.
      for (const body of this.bodies) this.M.Sleeping.set(body, false);
      this.onEvent({ type: 'merge', level, x, y, points, combo: this.combo, final, score: this.score, origin });
      return true;
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
    if (this.gameOver || this.activeSkill) return;
    const dt = clamp(delta, 0, 1000 / 60);
    this.time += dt;
    if (this.fusionPairs.length) {
      for (const pair of this.fusionPairs) {
        if (!pair.done && this.time >= pair.mergesAt) { pair.done = true; this.mergePair(pair.a, pair.b, 'roll', pair); }
      }
      this.containBodies();
      if (this.time >= this.fusionEndsAt) this.fusionPairs = [];
      return;
    }
    this.M.Engine.update(this.engine, dt);
    this.containBodies();
    this.processMerges();
    let danger = 0;
    for (const body of this.bodies) {
      const data = body.mochi;
      const mature = this.time - data.bornAt > 1250;
      // Matter's broad-phase bounds include predicted motion, not just visible geometry.
      const aboveLine = Math.min(...body.vertices.map(vertex => vertex.y)) < WORLD.line;
      data.dangerTime = mature && aboveLine && this.time >= this.protectionUntil ? data.dangerTime + dt : 0;
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
