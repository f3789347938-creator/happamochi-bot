/** Shared rules and pure transitions. Only publicRound may leave the points server. */
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const PACK = SUITS.flatMap(suit => RANKS.map(rank => `${rank}${suit}`));
const CARD_SET = new Set(PACK);
const VALUES = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));

export const RULES = Object.freeze({
  stakes: { draw: [100, 500, 1000], duel: [200, 500, 800, 1000], blackjack: [100, 500, 1000, 2500] },
  pokerPayouts: [
    { id: 'royal', label: 'ロイヤルフラッシュ', multiplier: 100 },
    { id: 'straight-flush', label: 'ストレートフラッシュ', multiplier: 50 },
    { id: 'four', label: 'フォーカード', multiplier: 25 },
    { id: 'full-house', label: 'フルハウス', multiplier: 7 },
    { id: 'flush', label: 'フラッシュ', multiplier: 5 },
    { id: 'straight', label: 'ストレート', multiplier: 4 },
    { id: 'trips', label: 'スリーカード', multiplier: 2 },
    { id: 'two-pair', label: 'ツーペア', multiplier: 1.5 },
    { id: 'high-pair', label: 'J以上のワンペア', multiplier: 1 },
    { id: 'low-pair', label: '10以下のワンペア', multiplier: 0.5 },
    { id: 'high-card', label: 'ハイカード', multiplier: 0 },
  ],
  duel: { feeRate: 0.1, maxRaises: 1, fixedBet: 'ante', maximumSpendMultiplier: 5.1 },
  blackjack: { natural: 2.5, win: 2, push: 1, standOnSoft17: true, double: true, split: false, insurance: false },
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function randomInt(maximum, options = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 0x100000000) fail('INVALID_RANDOM', '乱数の範囲が不正です。');
  if (options.rng) {
    const value = options.rng();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) fail('INVALID_RANDOM', 'テスト用乱数が不正です。');
    return Math.floor(value * maximum);
  }
  // Reject the incomplete tail so every integer is equally likely.
  const ceiling = Math.floor(0x100000000 / maximum) * maximum;
  const buffer = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= ceiling);
  return buffer[0] % maximum;
}

function makeDeck(options) {
  if (options.deck !== undefined) {
    if (!Array.isArray(options.deck) || options.deck.length !== 52 || new Set(options.deck).size !== 52 || options.deck.some(card => !CARD_SET.has(card))) {
      fail('INVALID_DECK', 'テスト用の山札が不正です。');
    }
    return [...options.deck];
  }
  const deck = [...PACK];
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomInt(index + 1, options);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

function take(state, count = 1) {
  if (state.deck.length < count) fail('INVALID_STATE', '山札が不足しています。');
  return state.deck.splice(0, count);
}

function cardValue(card) { return VALUES[card.slice(0, -1)]; }
function descending(a, b) { return b - a; }

/** Category 0..9; kickers are ordered for lexicographic comparison. */
export function evaluatePoker(cards) {
  if (!Array.isArray(cards) || cards.length !== 5 || new Set(cards).size !== 5 || cards.some(card => !CARD_SET.has(card))) {
    fail('INVALID_CARDS', '5枚の異なるカードが必要です。');
  }
  const ranks = cards.map(cardValue).sort(descending);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card.at(-1) === cards[0].at(-1));
  const distinct = [...counts.keys()].sort(descending);
  const wheel = distinct.join(',') === '14,5,4,3,2';
  const straightHigh = distinct.length === 5 && (distinct[0] - distinct[4] === 4 || wheel) ? (wheel ? 5 : distinct[0]) : 0;
  let category, id, kickers;
  if (flush && straightHigh === 14) { category = 9; id = 'royal'; kickers = [14]; }
  else if (flush && straightHigh) { category = 8; id = 'straight-flush'; kickers = [straightHigh]; }
  else if (groups[0][1] === 4) { category = 7; id = 'four'; kickers = groups.map(([rank]) => rank); }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { category = 6; id = 'full-house'; kickers = groups.map(([rank]) => rank); }
  else if (flush) { category = 5; id = 'flush'; kickers = ranks; }
  else if (straightHigh) { category = 4; id = 'straight'; kickers = [straightHigh]; }
  else if (groups[0][1] === 3) { category = 3; id = 'trips'; kickers = groups.map(([rank]) => rank); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { category = 2; id = 'two-pair'; kickers = groups.map(([rank]) => rank); }
  else if (groups[0][1] === 2) { category = 1; id = groups[0][0] >= 11 ? 'high-pair' : 'low-pair'; kickers = groups.map(([rank]) => rank); }
  else { category = 0; id = 'high-card'; kickers = ranks; }
  const rule = RULES.pokerPayouts.find(item => item.id === id);
  return { category, id, kickers, label: rule.label, multiplier: rule.multiplier };
}

export function comparePoker(a, b) {
  const left = Array.isArray(a) ? evaluatePoker(a) : a;
  const right = Array.isArray(b) ? evaluatePoker(b) : b;
  if (left.category !== right.category) return Math.sign(left.category - right.category);
  for (let index = 0; index < left.kickers.length; index++) {
    if (left.kickers[index] !== right.kickers[index]) return Math.sign(left.kickers[index] - right.kickers[index]);
  }
  return 0;
}

function blackjackValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    const value = cardValue(card);
    if (value === 14) { total += 11; aces++; }
    else total += Math.min(10, value);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

function settle(state, result, payout, message, revealDealer = false) {
  state.finished = true;
  state.phase = 'finished';
  state.result = result;
  state.payout = payout;
  state.net = payout - state.spent;
  state.message = message;
  state.revealDealer = revealDealer;
}

function blackjackFinish(state) {
  const player = blackjackValue(state.hand);
  if (player.total > 21) {
    settle(state, 'lose', 0, 'バースト。21を超えました。', true);
    return;
  }
  while (blackjackValue(state.dealerCards).total < 17) state.dealerCards.push(...take(state));
  const dealer = blackjackValue(state.dealerCards);
  const wager = state.spent;
  if (dealer.total > 21) settle(state, 'win', wager * 2, 'ディーラーがバースト。あなたの勝ち！', true);
  else if (player.total > dealer.total) settle(state, 'win', wager * 2, 'あなたの勝ち！', true);
  else if (player.total === dealer.total) settle(state, 'push', wager, '引き分け。賭けた分が戻ります。', true);
  else settle(state, 'lose', 0, 'ディーラーの勝ち。', true);
}

function payPlayerBet(state, amount) {
  state.spent += amount;
  state.net = state.payout - state.spent;
  state.pot += amount;
  state.betting.player += amount;
}

function payDealerBet(state, amount) {
  state.pot += amount;
  state.betting.dealer += amount;
}

function duelShowdown(state) {
  const comparison = comparePoker(state.hand, state.dealerCards);
  if (comparison > 0) settle(state, 'win', state.pot, 'あなたの勝ち！ ポットを獲得。', true);
  else if (comparison === 0) settle(state, 'push', state.pot / 2, '引き分け。ポットを半分ずつ受け取ります。', true);
  else settle(state, 'lose', 0, 'ディーラーの勝ち。', true);
}

function bettingComplete(state) {
  if (state.phase === 'betting-before') {
    state.phase = 'draw';
    state.message = '交換するカードを選んでください。';
  } else duelShowdown(state);
}

// Dealer policy receives only its own cards and public betting context. It cannot
// inspect the player's hand or the remaining deck when choosing its action.
function dealerDecision(cards, phase, facingBet, canRaise, options) {
  const rank = evaluatePoker(cards);
  const roll = randomInt(10000, options) / 10000;
  const after = phase === 'betting-after';
  if (!facingBet) {
    const chance = rank.category >= 3 ? 0.9 : rank.category === 2 ? 0.75 : rank.category === 1 ? (rank.kickers[0] >= 11 ? 0.55 : 0.28) : 0.1;
    return roll < chance ? 'bet' : 'check';
  }
  const foldChance = rank.category === 0 ? (after ? 0.68 : 0.26) : rank.category === 1 && rank.kickers[0] < 11 ? (after ? 0.22 : 0.06) : 0;
  if (roll < foldChance) return 'fold';
  const raiseChance = rank.category >= 3 ? 0.62 : rank.category === 2 ? 0.32 : rank.category === 1 && rank.kickers[0] >= 11 ? 0.1 : 0.035;
  if (canRaise && roll > 1 - raiseChance) return 'raise';
  return 'call';
}

function dealerDiscards(cards) {
  const rank = evaluatePoker(cards);
  if (rank.category >= 4) return [];
  const counts = new Map();
  cards.forEach(card => counts.set(cardValue(card), (counts.get(cardValue(card)) ?? 0) + 1));
  if (rank.category > 0) return cards.flatMap((card, index) => counts.get(cardValue(card)) === 1 ? [index] : []);
  // Four to a flush is more promising than keeping an unrelated high card.
  for (const suit of SUITS) {
    if (cards.filter(card => card.at(-1) === suit).length === 4) return cards.flatMap((card, index) => card.at(-1) !== suit ? [index] : []);
  }
  // Keep four cards in an open-ended straight (2–5 through 10–K).
  for (let low = 2; low <= 10; low++) {
    const inRun = cards.map((card, index) => ({ index, value: cardValue(card) }))
      .filter(card => card.value >= low && card.value <= low + 3);
    if (inRun.length === 4) {
      const keep = new Set(inRun.map(card => card.index));
      return cards.flatMap((_, index) => keep.has(index) ? [] : [index]);
    }
  }
  const highest = Math.max(...cards.map(cardValue));
  return cards.flatMap((card, index) => cardValue(card) === highest ? [] : [index]);
}

function validateDiscards(discards) {
  if (!Array.isArray(discards) || discards.length > 5 || new Set(discards).size !== discards.length || discards.some(index => !Number.isInteger(index) || index < 0 || index > 4)) {
    fail('INVALID_DISCARDS', '交換するカードは0〜4の重複しない番号で指定してください。');
  }
}

export function createRound({ id, mode, stake } = {}, options = {}) {
  if (typeof id !== 'string' || !id || id.length > 128) fail('INVALID_INPUT', 'ゲームIDが不正です。');
  if (!Object.hasOwn(RULES.stakes, mode)) fail('INVALID_MODE', 'ゲームの種類が不正です。');
  if (!Number.isSafeInteger(stake) || !RULES.stakes[mode].includes(stake)) fail('INVALID_STAKE', '参加ポイントが不正です。');
  const fee = mode === 'duel' ? stake / 10 : 0;
  const state = {
    id, mode, stake, version: 1,
    phase: mode === 'draw' ? 'draw' : mode === 'duel' ? 'betting-before' : 'blackjack',
    finished: false, hand: [], dealerCards: [], deck: makeDeck(options),
    drawCount: null, revealDealer: false, pot: mode === 'duel' ? stake * 2 : 0,
    spent: stake + fee, fee, payout: 0, net: -(stake + fee), result: '',
    message: mode === 'draw' ? '交換するカードを選んでください。' : mode === 'duel' ? 'チェックで進むか、ベットを選んでください。' : 'カードを引くか、ここで止めるか選んでください。',
    betting: { player: 0, dealer: 0, raises: 0 },
  };
  if (mode === 'blackjack') {
    state.hand.push(...take(state));
    state.dealerCards.push(...take(state));
    state.hand.push(...take(state));
    state.dealerCards.push(...take(state));
    const playerNatural = blackjackValue(state.hand).total === 21;
    const dealerNatural = blackjackValue(state.dealerCards).total === 21;
    if (playerNatural && dealerNatural) settle(state, 'push', stake, 'お互いにブラックジャック。引き分け。', true);
    else if (playerNatural) settle(state, 'win', stake * RULES.blackjack.natural, 'ブラックジャック！', true);
    else if (dealerNatural) settle(state, 'lose', 0, 'ディーラーがブラックジャック。', true);
  } else {
    state.hand = take(state, 5);
    if (mode === 'duel') state.dealerCards = take(state, 5);
  }
  return { state, delta: state.net };
}

function availableActions(state) {
  if (state.finished) return [];
  if (state.phase === 'draw') return [{ id: 'draw', label: '交換して勝負', cost: 0 }];
  if (state.mode === 'blackjack') {
    return [
      { id: 'hit', label: 'ヒット', cost: 0 },
      { id: 'stand', label: 'スタンド', cost: 0 },
      ...(state.hand.length === 2 ? [{ id: 'double', label: 'ダブル', cost: state.stake }] : []),
    ];
  }
  const owed = state.betting.dealer - state.betting.player;
  if (owed > 0) {
    return [
      { id: 'call', label: 'コール', cost: owed },
      ...(state.betting.raises < RULES.duel.maxRaises ? [{ id: 'raise', label: 'レイズ', cost: owed + state.stake }] : []),
      { id: 'fold', label: '降りる', cost: 0 },
    ];
  }
  return [{ id: 'check', label: 'チェック', cost: 0 }, { id: 'bet', label: 'ベット', cost: state.stake }];
}

export function applyAction(previous, { action, discards } = {}, options = {}) {
  if (!previous || previous.finished) fail('ROUND_FINISHED', 'このゲームは終了しています。');
  if (!availableActions(previous).some(item => item.id === action)) fail('INVALID_ACTION', '今はその操作を選べません。');
  if (action !== 'draw' && discards !== undefined) fail('INVALID_DISCARDS', 'カード交換の操作で指定してください。');
  const state = structuredClone(previous);
  state.version++;
  const oldNet = state.net;
  if (action === 'draw') {
    const selected = discards === undefined ? [] : discards;
    validateDiscards(selected);
    const dealerSelected = state.mode === 'duel' ? dealerDiscards(state.dealerCards) : [];
    // Sorted indices give the same exchange for the same set of taps.
    for (const index of [...selected].sort((a, b) => a - b)) state.hand[index] = take(state)[0];
    if (state.mode === 'draw') {
      const role = evaluatePoker(state.hand);
      const payout = state.stake * role.multiplier;
      settle(state, payout > state.spent ? 'win' : payout === state.spent ? 'push' : 'lose', payout,
        payout ? `${role.label}！ ${payout.toLocaleString('ja-JP')}ポイントの払戻し。` : '今回は役なし。');
    } else {
      for (const index of dealerSelected) state.dealerCards[index] = take(state)[0];
      state.drawCount = dealerSelected.length;
      state.phase = 'betting-after';
      state.betting = { player: 0, dealer: 0, raises: 0 };
      state.message = `ディーラーは${dealerSelected.length}枚交換。最後のベットです。`;
    }
  } else if (state.mode === 'blackjack') {
    if (action === 'hit') {
      state.hand.push(...take(state));
      if (blackjackValue(state.hand).total >= 21) blackjackFinish(state);
      else state.message = 'もう1枚引くか、ここで止めるか選んでください。';
    } else if (action === 'double') {
      state.spent += state.stake;
      state.net = -state.spent;
      state.hand.push(...take(state));
      blackjackFinish(state);
    } else blackjackFinish(state);
  } else if (action === 'fold') {
    settle(state, 'fold', 0, '降りました。追加のポイントはかかりません。');
  } else if (action === 'check') {
    const decision = dealerDecision(state.dealerCards, state.phase, false, false, options);
    if (decision === 'bet') {
      payDealerBet(state, state.stake);
      state.message = `ディーラーが${state.stake.toLocaleString('ja-JP')}ポイントをベット。`;
    } else bettingComplete(state);
  } else if (action === 'call') {
    payPlayerBet(state, state.betting.dealer - state.betting.player);
    bettingComplete(state);
  } else {
    const owed = state.betting.dealer - state.betting.player;
    payPlayerBet(state, owed + state.stake);
    if (action === 'raise') state.betting.raises++;
    const decision = dealerDecision(state.dealerCards, state.phase, true, state.betting.raises < RULES.duel.maxRaises, options);
    if (decision === 'fold') settle(state, 'win', state.pot, 'ディーラーが降りました。ポットを獲得。');
    else if (decision === 'raise') {
      const dealerOwes = state.betting.player - state.betting.dealer;
      payDealerBet(state, dealerOwes + state.stake);
      state.betting.raises++;
      state.message = 'ディーラーがレイズ。コールするか、降りるか選んでください。';
    } else {
      payDealerBet(state, state.betting.player - state.betting.dealer);
      bettingComplete(state);
    }
  }
  state.net = state.payout - state.spent;
  return { state, delta: state.net - oldNet };
}

export function publicRound(state) {
  if (!state) return null;
  const publicState = {
    id: state.id, mode: state.mode, stake: state.stake, version: state.version,
    phase: state.phase, finished: state.finished, hand: [...state.hand],
    dealer: { cards: state.dealerCards.map((card, index) => state.revealDealer || (state.mode === 'blackjack' && index === 0) ? card : null) },
    role: state.mode === 'blackjack' ? '' : evaluatePoker(state.hand).label,
    pot: state.pot, spent: state.spent, fee: state.fee, payout: state.payout,
    net: state.net, result: state.result, message: state.message,
    actions: availableActions(state), canDraw: !state.finished && state.phase === 'draw',
  };
  if (state.drawCount !== null) publicState.dealer.drawCount = state.drawCount;
  if (state.mode === 'blackjack') {
    const player = blackjackValue(state.hand);
    publicState.total = player.total;
    publicState.soft = player.soft;
    publicState.role = state.hand.length === 2 && player.total === 21 ? 'ブラックジャック' : `${player.total}${player.soft ? '（ソフト）' : ''}`;
    publicState.dealer.total = blackjackValue(state.revealDealer ? state.dealerCards : state.dealerCards.slice(0, 1)).total;
  }
  return publicState;
}
