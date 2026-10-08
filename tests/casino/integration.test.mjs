import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createRound, applyAction, publicRound } from '../../public/static/casino/engine.mjs';

// A seeded source makes full-game failures replayable. Production uses Web Crypto.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function checkPublicBoundary(state) {
  const visible = publicRound(state);
  assert.equal(visible.deck, undefined);
  assert.equal(visible.dealerCards, undefined);
  assert.equal(visible.betting, undefined);
  assert.deepEqual(visible.hand, state.hand);
  if (!state.revealDealer) {
    if (state.mode === 'duel') assert.ok(visible.dealer.cards.every(card => card === null));
    if (state.mode === 'blackjack') {
      assert.equal(visible.dealer.cards[0], state.dealerCards[0]);
      assert.ok(visible.dealer.cards.slice(1).every(card => card === null));
      const face = state.dealerCards[0].slice(0, -1);
      assert.equal(visible.dealer.total, face === 'A' ? 11 : /[JQK]/.test(face) ? 10 : Number(face));
    }
  }
  const cards = [...state.hand, ...state.dealerCards, ...state.deck];
  assert.equal(new Set(cards).size, cards.length, 'cards are never duplicated across live hands and deck');
  assert.equal(visible.net, visible.payout - visible.spent);
  assert.ok(Number.isSafeInteger(visible.net));
  assert.ok(Number.isSafeInteger(visible.payout));
  return visible;
}

for (const mode of Object.keys(RULES.stakes)) {
  test(`${mode}: 300 reproducible legal games settle with conserved balances and private cards`, () => {
    const coverage = new Set();
    for (let seed = 1; seed <= 300; seed++) {
      const rng = random(seed * 7157);
      const stake = RULES.stakes[mode][seed % RULES.stakes[mode].length];
      let { state, delta } = createRound({ id: `${mode}-${seed}`, mode, stake }, { rng });
      let accumulated = delta;
      let steps = 0;
      while (!state.finished) {
        const visible = checkPublicBoundary(state);
        assert.ok(visible.actions.length > 0, `seed ${seed}: unfinished round needs an action`);
        const choice = visible.actions[Math.floor(rng() * visible.actions.length)];
        coverage.add(choice.id);
        const action = { action: choice.id };
        if (choice.id === 'draw') action.discards = [0, 1, 2, 3, 4].filter(() => rng() < 0.5);
        const before = structuredClone(state);
        const next = applyAction(state, action, { rng });
        assert.deepEqual(state, before, `seed ${seed}: transition mutated previous state`);
        assert.equal(next.state.version, state.version + 1);
        assert.ok(next.state.spent >= state.spent);
        assert.ok(Number.isSafeInteger(next.delta));
        accumulated += next.delta;
        assert.equal(accumulated, next.state.net, `seed ${seed}: ledger changes diverged from round net`);
        state = next.state;
        assert.ok(++steps < 30, `seed ${seed}: game did not terminate`);
      }
      const final = checkPublicBoundary(state);
      assert.deepEqual(final.actions, []);
      assert.equal(final.canDraw, false);
      assert.equal(accumulated, final.payout - final.spent);
      assert.throws(() => applyAction(state, { action: 'stand' }), { code: 'ROUND_FINISHED' });
      if (mode === 'duel') assert.ok(final.spent <= stake * RULES.duel.maximumSpendMultiplier + 0.001);
    }
    const expected = mode === 'draw' ? ['draw'] : mode === 'blackjack' ? ['hit', 'stand', 'double'] : ['check', 'bet', 'call', 'raise', 'fold', 'draw'];
    for (const action of expected) assert.ok(coverage.has(action), `game corpus must exercise ${action}`);
  });
}
