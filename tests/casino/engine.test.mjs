import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createRound, applyAction, publicRound, evaluatePoker, comparePoker } from '../../public/static/casino/engine.mjs';

const allCards = ['S', 'H', 'D', 'C'].flatMap(suit => ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map(rank => rank + suit));
const deck = (first) => [...first, ...allCards.filter(card => !first.includes(card))];
const options = (first, random = 0.5) => ({ deck: deck(first), rng: () => random });
const start = (mode, first, stake = mode === 'duel' ? 200 : 100) => createRound({ id: 'test-round', mode, stake }, options(first)).state;
const act = (state, action, discards, random = 0.5) => applyAction(state, { action, ...(discards === undefined ? {} : { discards }) }, { rng: () => random });
const validPoker = ['2S', '4H', '6D', '8C', '10S'];

test('all poker ranks and exact total-return multipliers', () => {
  const cases = [
    [['AS', 'KS', 'QS', 'JS', '10S'], 'royal', 100],
    [['9H', '8H', '7H', '6H', '5H'], 'straight-flush', 50],
    [['2S', '2H', '2D', '2C', 'AS'], 'four', 25],
    [['3S', '3H', '3D', 'AS', 'AH'], 'full-house', 7],
    [['2D', '4D', '6D', '8D', 'JD'], 'flush', 5],
    [['AS', '2D', '3H', '4C', '5D'], 'straight', 4],
    [['QS', 'QH', 'QD', '4C', '5D'], 'trips', 2],
    [['KS', 'KH', '2D', '2C', '5D'], 'two-pair', 1.5],
    [['JS', 'JH', '2D', '4C', '5D'], 'high-pair', 1],
    [['10S', '10H', '2D', '4C', '5D'], 'low-pair', 0.5],
    [validPoker, 'high-card', 0],
  ];
  for (const [cards, id, multiplier] of cases) {
    const rank = evaluatePoker(cards);
    assert.equal(rank.id, id);
    assert.equal(rank.multiplier, multiplier);
    const state = start('draw', cards, 500);
    const result = act(state, 'draw', []);
    assert.equal(result.state.payout, multiplier * 500);
    assert.equal(result.state.net, multiplier * 500 - 500);
    assert.equal(result.delta, multiplier * 500);
  }
});

test('poker order resolves every kicker and ace-low straights correctly', () => {
  const comparisons = [
    [['AS', 'AH', '2C', '4D', '6S'], ['KS', 'KH', 'QC', 'JD', '10S']],
    [['AS', 'AH', 'KC', '4D', '6S'], ['AC', 'AD', 'QC', 'JD', '10S']],
    [['AS', 'AH', 'KC', '6D', '4S'], ['AC', 'AD', 'KD', '6H', '3S']],
    [['QS', 'QH', 'JC', 'JD', '2S'], ['QC', 'QD', '10C', '10D', 'AS']],
    [['QS', 'QH', 'JC', 'JD', 'AS'], ['QC', 'QD', 'JH', 'JS', 'KS']],
    [['QS', 'QH', 'QC', 'KD', '2S'], ['QH', 'QD', 'QC', 'JS', '10S']],
    [['QS', 'QH', 'QC', '2D', '2S'], ['JH', 'JD', 'JC', 'AS', 'AH']],
    [['AS', 'QS', '10S', '8S', '5S'], ['AH', 'QH', '10H', '8H', '4H']],
    [['2S', '3H', '4C', '5D', '6S'], ['AS', '2H', '3C', '4D', '5S']],
    [['2S', '2H', '2C', '2D', 'AS'], ['2S', '2H', '2C', '2D', 'KS']],
  ];
  for (const [winner, loser] of comparisons) {
    assert.equal(comparePoker(winner, loser), 1);
    assert.equal(comparePoker(loser, winner), -1);
  }
  assert.equal(comparePoker(['AS', 'KH', 'QD', 'JC', '10S'], ['AH', 'KS', 'QC', 'JD', '10H']), 0);
  assert.equal(evaluatePoker(['AS', '2S', '3S', '4S', '5S']).id, 'straight-flush');
  assert.equal(evaluatePoker(['QS', 'KS', 'AH', '2S', '3S']).id, 'high-card');
});

test('poker rejects duplicate, unknown, missing and extra cards', () => {
  for (const hand of [[], ['AS', 'AS', '2S', '3S', '4S'], ['1S', '2S', '3S', '4S', '5S'], [...validPoker, 'AS'], null]) {
    assert.throws(() => evaluatePoker(hand), { code: 'INVALID_CARDS' });
  }
});

test('valid stakes are enforced and input prototypes are not treated as game modes', () => {
  for (const [mode, stakes] of Object.entries(RULES.stakes)) {
    for (const stake of stakes) assert.equal(createRound({ id: 'valid', mode, stake }).state.stake, stake);
  }
  for (const stake of [-1, 0, 1, 200.5, NaN, '100', Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createRound({ id: 'invalid', mode: 'draw', stake }), { code: 'INVALID_STAKE' });
  }
  assert.throws(() => createRound({ id: 'invalid', mode: '__proto__', stake: 100 }), { code: 'INVALID_MODE' });
  assert.throws(() => createRound({ mode: 'draw', stake: 100 }), { code: 'INVALID_INPUT' });
  assert.throws(() => createRound({ id: 'invalid', mode: 'draw', stake: 100 }, { deck: [] }), { code: 'INVALID_DECK' });
});

test('draw allows zero through five exchanges and never reuses dealt cards', () => {
  for (let count = 0; count <= 5; count++) {
    const state = start('draw', validPoker);
    const original = structuredClone(state);
    const discards = Array.from({ length: count }, (_, i) => i);
    const result = act(state, 'draw', discards);
    assert.deepEqual(state, original, 'transition is non-mutating');
    assert.equal(result.state.version, state.version + 1);
    assert.equal(result.state.finished, true);
    for (let index = 0; index < 5; index++) {
      if (index < count) assert.ok(!state.hand.includes(result.state.hand[index]));
      else assert.equal(result.state.hand[index], state.hand[index]);
    }
    assert.equal(new Set(result.state.hand).size, 5);
    assert.throws(() => act(result.state, 'draw', []), { code: 'ROUND_FINISHED' });
  }
});

test('exchange validation rejects ambiguous indices, and selection order does not affect result', () => {
  const state = start('draw', validPoker);
  for (const indices of [[0, 0], [-1], [5], [0.5], ['0'], null, '0', [0, 1, 2, 3, 4, 5]]) {
    assert.throws(() => act(state, 'draw', indices), { code: 'INVALID_DISCARDS' });
  }
  assert.deepEqual(act(state, 'draw', [3, 1]).state.hand, act(state, 'draw', [1, 3]).state.hand);
  assert.throws(() => act(state, 'check'), { code: 'INVALID_ACTION' });
});

test('public draw state contains no private deck or mutable references', () => {
  const state = start('draw', validPoker);
  const view = publicRound(state);
  assert.deepEqual(view.dealer.cards, []);
  assert.equal('deck' in view, false);
  assert.equal('betting' in view, false);
  view.hand[0] = 'AS';
  assert.equal(state.hand[0], '2S');
});

test('duel checks, exchanges and showdown account for fee outside the pot', () => {
  let state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', '4H', '6C', '9D', 'JS']);
  let deltaSum = -220;
  assert.equal(state.spent, 220);
  assert.equal(state.fee, 20);
  assert.equal(state.pot, 400);
  assert.deepEqual(publicRound(state).dealer.cards, [null, null, null, null, null]);
  let result = act(state, 'check', undefined, 0.9);
  state = result.state; deltaSum += result.delta;
  assert.equal(state.phase, 'draw');
  result = act(state, 'draw', []);
  state = result.state; deltaSum += result.delta;
  assert.equal(state.phase, 'betting-after');
  assert.equal(publicRound(state).dealer.drawCount, 4);
  result = act(state, 'check', undefined, 0.99);
  state = result.state; deltaSum += result.delta;
  assert.equal(state.finished, true);
  assert.equal(deltaSum, state.net);
  assert.equal(state.net, state.payout - state.spent);
  assert.equal(publicRound(state).dealer.cards.every(Boolean), true);
});

test('duel dealer fold returns the whole pot including just-placed bet but does not expose its cards', () => {
  const state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', '4H', '6C', '9D', 'JS']);
  const result = act(state, 'bet', undefined, 0);
  assert.equal(result.state.finished, true);
  assert.equal(result.state.result, 'win');
  assert.equal(result.state.spent, 420);
  assert.equal(result.state.payout, 600);
  assert.equal(result.state.net, 180);
  assert.equal(result.delta, 400);
  assert.deepEqual(publicRound(result.state).dealer.cards, [null, null, null, null, null]);
});

test('duel facing a bet exposes exact call and raise costs; a player raise completes betting', () => {
  let state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', 'AD', '6C', '9D', 'JS']);
  state = act(state, 'check', undefined, 0.1).state;
  assert.deepEqual(publicRound(state).actions.map(a => [a.id, a.cost]), [['call', 200], ['raise', 400], ['fold', 0]]);
  assert.throws(() => act(state, 'check'), { code: 'INVALID_ACTION' });
  const result = act(state, 'raise', undefined, 0.5);
  assert.equal(result.state.phase, 'draw');
  assert.equal(result.state.spent, 620);
  assert.equal(result.state.pot, 1200);
  assert.equal(result.delta, -400);
  assert.equal(result.state.betting.raises, 1);
});

test('duel dealer raise caps the round at one raise and call then moves to draw', () => {
  let state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', 'AD', '6C', '9D', 'JS']);
  state = act(state, 'bet', undefined, 0.99).state;
  assert.deepEqual(publicRound(state).actions.map(a => [a.id, a.cost]), [['call', 200], ['fold', 0]]);
  assert.throws(() => act(state, 'raise'), { code: 'INVALID_ACTION' });
  const result = act(state, 'call');
  assert.equal(result.state.phase, 'draw');
  assert.equal(result.state.spent, 620);
  assert.equal(result.state.pot, 1200);
  assert.equal(result.delta, -200);
});

test('duel fold is terminal and never charges the pending call', () => {
  let state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', 'AD', '6C', '9D', 'JS']);
  state = act(state, 'check', undefined, 0.1).state;
  const result = act(state, 'fold');
  assert.equal(result.state.result, 'fold');
  assert.equal(result.state.net, -220);
  assert.equal(result.delta, 0);
  assert.equal(result.state.payout, 0);
  assert.deepEqual(publicRound(result.state).dealer.cards, [null, null, null, null, null]);
});

test('duel showdown uses kickers and splits tied pots while keeping entry fee', () => {
  const player = ['AS', 'KH', 'QD', 'JC', '10S'];
  const dealer = ['AH', 'KS', 'QC', 'JD', '10H'];
  let state = start('duel', [...player, ...dealer]);
  state = act(state, 'check', undefined, 0.99).state;
  state = act(state, 'draw', []).state;
  assert.equal(state.drawCount, 0);
  state = act(state, 'check', undefined, 0.99).state;
  assert.equal(state.finished, true);
  assert.equal(state.result, 'push');
  assert.equal(state.payout, 200);
  assert.equal(state.net, -20);
});

test('two fully raised duel rounds cap total exposure at 5 ante plus the one entry fee', () => {
  let state = start('duel', ['AS', 'KH', 'QD', 'JC', '10S', 'AH', 'KS', 'QC', 'JD', '10H']);
  let deltaSum = -220;
  const expected = [
    ['bet', undefined, 200, 1000],
    ['call', undefined, 200, 1200],
    ['draw', [], 0, 1200],
    ['bet', undefined, 200, 1800],
    ['call', undefined, 200, 2000],
  ];
  for (const [action, discards, cost, pot] of expected) {
    assert.equal(publicRound(state).actions.find(item => item.id === action).cost, cost);
    const previousSpent = state.spent;
    const result = act(state, action, discards, 0.99);
    state = result.state;
    deltaSum += result.delta;
    assert.equal(state.spent - previousSpent, cost);
    assert.equal(state.pot, pot);
    assert.equal(state.fee, 20);
  }
  assert.equal(state.spent, 1020);
  assert.equal(state.payout, 1000);
  assert.equal(state.result, 'push');
  assert.equal(state.net, -20);
  assert.equal(deltaSum, state.net);
});

test('duel dealer behavior cannot change when only the player hand changes', () => {
  const dealer = ['AH', 'AD', '6C', '9D', 'JS'];
  const weak = start('duel', ['2S', '4H', '6D', '8C', '10S', ...dealer]);
  const strong = start('duel', ['2S', '2H', '2D', '2C', '10S', ...dealer]);
  for (const random of [0, 0.1, 0.5, 0.99]) {
    for (const action of ['check', 'bet']) {
      const left = act(weak, action, undefined, random).state;
      const right = act(strong, action, undefined, random).state;
      assert.equal(left.phase, right.phase);
      assert.equal(left.pot, right.pot);
      assert.deepEqual(left.betting, right.betting);
    }
  }
});

test('duel exchange is available once and no betting action accepts discards', () => {
  let state = start('duel', ['2S', '2H', '6D', '8C', '10S', 'AH', '4H', '6C', '9D', 'JS']);
  assert.throws(() => act(state, 'draw', []), { code: 'INVALID_ACTION' });
  assert.throws(() => act(state, 'check', []), { code: 'INVALID_DISCARDS' });
  state = act(state, 'check', undefined, 0.99).state;
  state = act(state, 'draw', [2, 3, 4]).state;
  assert.throws(() => act(state, 'draw', []), { code: 'INVALID_ACTION' });
});

test('blackjack natural pays 3:2 profit, ties return stake, dealer natural loses immediately', () => {
  const natural = createRound({ id: 'bj-natural', mode: 'blackjack', stake: 100 }, options(['AS', '9H', 'KC', '7D']));
  assert.equal(natural.state.finished, true);
  assert.equal(natural.state.payout, 250);
  assert.equal(natural.delta, 150);
  assert.equal(natural.state.version, 1);
  const tie = start('blackjack', ['AS', 'AH', 'KC', 'QD']);
  assert.equal(tie.result, 'push');
  assert.equal(tie.net, 0);
  const loss = start('blackjack', ['9S', 'AH', 'KC', 'QD']);
  assert.equal(loss.result, 'lose');
  assert.equal(loss.net, -100);
});

test('unfinished blackjack publishes only the dealer upcard and its value', () => {
  const state = start('blackjack', ['AS', '9H', '6C', '7D']);
  const view = publicRound(state);
  assert.deepEqual(view.dealer, { cards: ['9H', null], total: 9 });
  assert.equal(view.total, 17);
  assert.equal(view.soft, true);
  assert.equal(JSON.stringify(view).includes('7D'), false);
});

test('blackjack dealer stands on soft 17 and ordinary win returns twice stake', () => {
  const state = start('blackjack', ['10S', 'AH', '9C', '6D', 'KC']);
  const result = act(state, 'stand');
  assert.deepEqual(result.state.dealerCards, ['AH', '6D']);
  assert.equal(publicRound(result.state).dealer.total, 17);
  assert.equal(result.state.payout, 200);
  assert.equal(result.delta, 200);
  assert.equal(result.state.net, 100);
});

test('blackjack ace becomes one to avoid bust; three-card 21 is not a natural', () => {
  let state = start('blackjack', ['AS', '10H', '6C', '7D', '9S', '5H']);
  state = act(state, 'hit').state;
  assert.equal(publicRound(state).total, 16);
  assert.equal(publicRound(state).soft, false);
  assert.equal(state.finished, false);
  assert.ok(!publicRound(state).actions.some(action => action.id === 'double'));
  assert.throws(() => act(state, 'double'), { code: 'INVALID_ACTION' });
  state = act(state, 'hit').state;
  assert.equal(state.finished, true);
  assert.equal(publicRound(state).total, 21);
  assert.equal(state.payout, 200);
});

test('blackjack double adds exactly one stake and one card then settles', () => {
  const state = start('blackjack', ['5S', '9H', '6C', '7D', 'KC', '10D']);
  assert.equal(publicRound(state).actions.find(action => action.id === 'double').cost, 100);
  const result = act(state, 'double');
  assert.equal(result.state.hand.length, 3);
  assert.equal(result.state.finished, true);
  assert.equal(result.state.spent, 200);
  assert.equal(result.state.payout, 400);
  assert.equal(result.state.net, 200);
  assert.equal(result.delta, 300);
});

test('blackjack bust loses without further dealer draws, and tie returns whole doubled wager', () => {
  const bust = act(start('blackjack', ['10S', '9H', '6C', '7D', 'KC']), 'hit');
  assert.equal(bust.state.result, 'lose');
  assert.equal(bust.state.payout, 0);
  assert.equal(bust.delta, 0);
  assert.equal(bust.state.dealerCards.length, 2);
  const tiedDouble = act(start('blackjack', ['5S', '10H', '6C', 'QD', '9S']), 'double');
  assert.equal(tiedDouble.state.result, 'push');
  assert.equal(tiedDouble.state.payout, 200);
  assert.equal(tiedDouble.state.net, 0);
});

test('blackjack handles multiple aces and a losing double without an extra charge after settlement', () => {
  let state = start('blackjack', ['AS', '10H', 'AC', '7D', 'AD', '8S']);
  assert.equal(publicRound(state).total, 12);
  assert.equal(publicRound(state).soft, true);
  state = act(state, 'hit').state;
  assert.equal(publicRound(state).total, 13);
  assert.equal(publicRound(state).soft, true);
  state = act(state, 'hit').state;
  assert.equal(state.payout, 200);
  assert.equal(publicRound(state).total, 21);
  const loss = act(start('blackjack', ['10S', '10H', '6C', 'QD', 'KS']), 'double');
  assert.equal(loss.state.spent, 200);
  assert.equal(loss.state.payout, 0);
  assert.equal(loss.delta, -100);
  assert.equal(loss.state.net, -200);
  assert.throws(() => act(loss.state, 'stand'), { code: 'ROUND_FINISHED' });
});

test('crypto shuffles preserve a complete unique deck across modes', () => {
  const arrangements = new Set();
  for (const mode of ['draw', 'duel', 'blackjack']) {
    for (let iteration = 0; iteration < 20; iteration++) {
      const state = createRound({ id: `random-${mode}-${iteration}`, mode, stake: RULES.stakes[mode][0] }).state;
      const complete = [...state.hand, ...state.dealerCards, ...state.deck];
      assert.equal(complete.length, 52);
      assert.equal(new Set(complete).size, 52);
      assert.deepEqual([...complete].sort(), [...allCards].sort());
      arrangements.add(state.hand.join(','));
    }
  }
  assert.ok(arrangements.size > 50, 'independent rounds should not repeat a fixed deck');
});
