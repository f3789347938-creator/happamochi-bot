import { RULES, createRound, applyAction, publicRound } from './engine.mjs';

const $ = (id) => document.getElementById(id);
const PRACTICE_KEY = 'happamochi.casino.practice.v1';
const PENDING_KEY = 'happamochi.casino.pending.v1';
const STARTING_COINS = 10000;
const MODES = {
  draw: { name: 'ポーカー', caption: 'JACKS OR BETTER', hello: 'どの役ができるかな？' },
  duel: { name: '上級ポーカー', caption: 'FIVE CARD DRAW', hello: 'さあ、真剣勝負！' },
  blackjack: { name: 'ブラックジャック', caption: 'BLACKJACK PAYS 3 TO 2', hello: '21を目指そう！' },
};
const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
const suitNames = { S: 'スペード', H: 'ハート', D: 'ダイヤ', C: 'クラブ' };
let storageFailed = false;
function storageRead(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; } }
function storageWrite(store, key, value) { try { value === null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch { storageFailed = true; } }
function blankPractice() { return { balance: STARTING_COINS, profit: 0, round: null, history: [] }; }
function loadPractice() {
  let saved;
  try { saved = storageRead(localStorage, PRACTICE_KEY); } catch { return blankPractice(); }
  if (!saved || !Number.isFinite(saved.balance) || saved.balance < 0 || !Number.isFinite(saved.profit) || !Array.isArray(saved.history)) return blankPractice();
  if (saved.round) { try { if (!Object.hasOwn(MODES, saved.round.mode)) return blankPractice(); publicRound(saved.round); } catch { return blankPractice(); } }
  saved.history = saved.history.filter((item) => item && Object.hasOwn(MODES, item.mode) && Number.isFinite(item.net)).slice(0, 20);
  return saved;
}
const practice = loadPractice();
let source = 'practice';
let live = { balance: 0, profit: 0, round: null, history: [] };
let config = { enabled: false, liffId: '' };
let configLoaded = false;
let accessToken = '';
let liveSubject = '';
let busy = false;
let connecting = false;
let selected = new Set();
let requestedMode = new URLSearchParams(location.search).get('mode');
if (practice.round?.finished && Object.hasOwn(MODES, requestedMode) && requestedMode !== practice.round.mode) { practice.round = null; savePractice(); }
let mode = practice.round ? practice.round.mode : (Object.hasOwn(MODES, requestedMode) ? requestedMode : 'draw');
let stake = practice.round?.stake || RULES.stakes[mode][0];
let pending = null;
let pendingAccounts = Object.create(null);
try {
  const saved = storageRead(sessionStorage, PENDING_KEY);
  if (saved?.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)) Object.assign(pendingAccounts, saved.entries);
  else if (typeof saved?.subject === 'string') pendingAccounts[saved.subject] = saved;
} catch { /* Practice works with storage disabled. */ }
let lastCardKey = '';
let dialogReturnFocus = null;

const fmt = (value) => Number(value || 0).toLocaleString('ja-JP');
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmt(Math.abs(value || 0))}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unit = () => source === 'practice' ? 'コイン' : 'pt';
const current = () => source === 'practice' ? { ...practice, round: practice.round ? publicRound(practice.round) : null } : live;
const active = () => { const round = current().round; return round && !round.finished ? round : null; };
function savePractice() { try { storageWrite(localStorage, PRACTICE_KEY, practice); } catch { storageFailed = true; } }
function savePending() {
  if (!liveSubject) return;
  if (pending) pendingAccounts[liveSubject] = pending;
  else delete pendingAccounts[liveSubject];
  try { storageWrite(sessionStorage, PENDING_KEY, { entries: pendingAccounts }); } catch { /* Retain the same request in memory. */ }
}
function pendingFor(subject) {
  const entry = Object.hasOwn(pendingAccounts, subject) ? pendingAccounts[subject] : null;
  return entry && entry.subject === subject && ['/api/casino/start', '/api/casino/action'].includes(entry.path) && typeof entry.body?.requestId === 'string' ? entry : null;
}
function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = `notice${error ? ' error' : ''}`;
  $('notice').hidden = !message;
}
function button(label, handler, className = '') {
  const el = document.createElement('button'); el.type = 'button'; el.className = className; el.textContent = label; el.addEventListener('click', handler); return el;
}
function cardElement(card, index, { selectable = false, animated = true } = {}) {
  const el = document.createElement(selectable ? 'button' : 'div');
  const rank = card ? card.slice(0, -1) : '';
  const suit = card ? card.slice(-1) : '';
  el.className = `playing-card${!card ? ' card-back' : ''}${suit === 'H' || suit === 'D' ? ' red' : ''}${'JQK'.includes(rank) && rank ? ' face-card' : ''}${selectable ? ' selectable' : ''}${selectable && selected.has(index) ? ' selected' : ''}`;
  el.style.setProperty('--card-index', index);
  if (!animated) el.style.animation = 'none';
  if (!card) { el.setAttribute('aria-label', '裏向きのカード'); return el; }
  el.setAttribute('aria-label', `${index + 1}枚目 ${suitNames[suit]}の${rank}${selectable ? (selected.has(index) ? '、交換する' : '、残す') : ''}`);
  el.dataset.card = card;
  el.dataset.index = String(index);
  el.innerHTML = `<span class="card-corner">${esc(rank)}<span>${suitSymbols[suit]}</span></span><span class="card-center" aria-hidden="true">${'JQK'.includes(rank) ? esc(rank) : suitSymbols[suit]}</span><span class="card-corner bottom" aria-hidden="true">${esc(rank)}<span>${suitSymbols[suit]}</span></span>${selectable && selected.has(index) ? '<span class="swap-badge" aria-hidden="true">交換</span>' : ''}`;
  if (selectable) {
    el.type = 'button'; el.setAttribute('aria-pressed', String(selected.has(index))); el.disabled = busy || connecting;
    el.addEventListener('click', () => {
      if (busy || connecting) return;
      selected.has(index) ? selected.delete(index) : selected.add(index); render();
      $('player-cards').querySelector(`[data-index="${index}"]`)?.focus({ preventScroll: true });
    });
  }
  return el;
}
function render() {
  const env = current(); const round = env.round; const ongoing = Boolean(round && !round.finished);
  if (ongoing) mode = round.mode;
  if (!RULES.stakes[mode].includes(stake)) stake = RULES.stakes[mode][0];
  $('practice-button').classList.toggle('source-active', source === 'practice');
  $('points-button').classList.toggle('source-active', source === 'points');
  $('practice-button').setAttribute('aria-pressed', String(source === 'practice'));
  $('points-button').setAttribute('aria-pressed', String(source === 'points'));
  $('practice-button').disabled = busy || connecting;
  $('points-button').disabled = busy || connecting;
  $('source-description').textContent = source === 'practice' ? '練習コインで気軽にプレイ' : '葉っぱもちのポイントでプレイ';
  document.querySelectorAll('[data-mode]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
    tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode));
    tab.disabled = busy || connecting;
  });
  $('mode-caption').textContent = MODES[mode].caption;
  $('payout-button').textContent = mode === 'duel' ? 'ルール ↗' : '配当表 ↗';
  $('balance-label').textContent = source === 'practice' ? '練習コイン' : '所持ポイント';
  $('balance-unit').textContent = source === 'practice' ? ' coins' : ' pt';
  $('profit-label').textContent = source === 'practice' ? '練習の収支' : 'カジノの収支';
  $('balance-value').textContent = fmt(env.balance);
  $('profit-value').textContent = signed(env.profit);
  $('profit-value').className = env.profit > 0 ? 'positive' : env.profit < 0 ? 'negative' : '';
  const dealerCards = round?.dealer?.cards || [];
  const showOpponent = mode !== 'draw' && Boolean(round);
  $('opponent-area').hidden = !showOpponent;
  document.querySelector('.game-table').classList.toggle('has-opponent', showOpponent);
  $('dealer-cards').replaceChildren(...dealerCards.map((card, i) => cardElement(card, i, { animated: `${round?.id}:${round?.version}` !== lastCardKey })));
  $('dealer-score').textContent = mode === 'blackjack' && round?.dealer?.total !== undefined ? `${round.dealer.total}${!round.finished ? ' + ?' : ''}` : round?.dealer?.drawCount !== undefined ? `${round.dealer.drawCount}枚交換` : '';
  $('pot-label').textContent = mode === 'duel' && round ? `POT ${fmt(round.pot)} ${unit()}` : mode === 'blackjack' ? 'GET CLOSER TO 21' : 'ONE DRAW · FIVE CARDS';
  $('dealer-message').textContent = round?.finished ? (round.net > 0 ? 'お見事！' : round.result === 'push' ? '引き分けだね' : '遊んでくれてありがとう') : mode === 'duel' && round?.dealer?.drawCount !== undefined ? `${round.dealer.drawCount}枚、交換したよ` : MODES[mode].hello;
  $('hand-role').textContent = mode === 'blackjack' && round ? `${round.total}${round.soft ? ' / ソフト' : ''}` : round?.role || '';
  $('hand-hint').textContent = round?.canDraw ? '交換したいカードをタップ' : round?.finished ? '今回のハンド' : round ? 'あなたのハンド' : 'カードを配ってスタート';
  $('player-cards').classList.toggle('blackjack-hand', mode === 'blackjack');
  const hand = round?.hand || Array(mode === 'blackjack' ? 2 : 5).fill(null);
  const key = `${round?.id}:${round?.version}`;
  $('player-cards').replaceChildren(...hand.map((card, i) => cardElement(card, i, { selectable: Boolean(round?.canDraw), animated: key !== lastCardKey })));
  lastCardKey = key;
  $('selection-hint').textContent = round?.canDraw ? (selected.size ? `${selected.size}枚を交換 · ${5 - selected.size}枚を残す` : 'タップしたカードだけ交換します') : round?.finished ? '結果を確認してから、次のゲームへ' : round?.message || (mode === 'blackjack' ? 'A は 1 または 11。21を超えたらバースト' : '遊び方は右上の「？」から');
  $('result-banner').hidden = !round?.finished;
  if (round?.finished) {
    $('result-banner').className = `result-banner${round.net < 0 ? ' loss' : ''}`;
    const resultName = mode === 'draw' ? round.role : round.result === 'win' ? 'あなたの勝ち' : round.result === 'push' ? '引き分け' : round.result === 'fold' ? 'フォールド' : 'ディーラーの勝ち';
    $('result-banner').innerHTML = `<strong>${esc(resultName)} <span class="result-value">${signed(round.net)}</span></strong><p>受取 ${fmt(round.payout)} ${unit()} − 使用 ${fmt(round.spent)} ${unit()}${round.fee ? `（うち参加料 ${fmt(round.fee)}）` : ''}</p>`;
  }
  $('stakes-section').hidden = ongoing || Boolean(source === 'points' && pending);
  $('stake-label').textContent = source === 'practice' ? '参加コイン' : '参加ポイント';
  $('fee-label').textContent = mode === 'duel' ? `参加料 ${fmt(stake * .1)} ${unit()}` : '選んだ額を使ってスタート';
  $('stake-options').replaceChildren(...RULES.stakes[mode].map((amount) => {
    const el = button(fmt(amount), () => { if (busy || connecting) return; stake = amount; render(); }, `stake-chip${amount === stake ? ' selected' : ''}`);
    el.setAttribute('aria-pressed', String(amount === stake)); el.dataset.stake = String(amount); el.disabled = busy || connecting; return el;
  }));
  $('actions').replaceChildren();
  if (source === 'points' && pending) {
    addAction(accessToken ? '通信を再確認' : 'ログインし直す', '同じ操作の結果を確認します', () => accessToken ? sendPending() : connectPoints(), { disabled: busy || connecting, id: 'retry' });
  } else if (!ongoing) {
    const cost = stake + (mode === 'duel' ? stake * .1 : 0);
    addAction(round?.finished ? 'もう一度配る' : 'カードを配る', `${fmt(cost)} ${unit()}${mode === 'duel' ? `（参加料 ${fmt(stake * .1)} 含む）` : ''}`, () => startRound(), { disabled: busy || connecting || env.balance < cost, id: 'start' });
  } else {
    for (const action of round.actions || []) {
      const label = action.id === 'draw' ? (selected.size ? `${selected.size}枚を交換する` : 'このまま勝負') : action.label;
      const detail = action.cost > 0 ? `${fmt(action.cost)} ${unit()}追加` : ({ draw: selected.size ? '選んだカードだけ交換' : '5枚とも残す', check: '追加なしで進む', fold: 'この勝負を終える', hit: 'もう1枚引く', stand: 'この点数で勝負' }[action.id] || '追加なし');
      addAction(label, detail, () => act(action.id), { disabled: busy || connecting || env.balance < action.cost, id: action.id, secondary: ['check', 'hit', 'call'].includes(action.id), danger: action.id === 'fold' });
    }
  }
  const affordable = ongoing ? true : env.balance >= stake + (mode === 'duel' ? stake * .1 : 0);
  $('action-note').textContent = connecting ? 'LINEのログイン状態を確認しています…' : busy ? 'テーブルを更新しています…' : !affordable ? `${source === 'practice' ? '練習コイン' : 'ポイント'}が足りません。参加額を下げてください` : mode === 'duel' && ongoing ? '追加で出す額は各ボタンに表示されています' : source === 'practice' ? '練習コインは実際のポイントに影響しません' : '勝ちは保証されません。無理のない参加額で遊ぼう';
  $('refill-button').hidden = source !== 'practice' || ongoing || env.balance >= Math.min(...RULES.stakes[mode]) || busy || connecting;
  if (storageFailed && !$('notice').textContent) notice('このブラウザでは練習内容を保存できません。ページを閉じるとリセットされます。');
}
function addAction(label, detail, handler, options = {}) {
  const el = button('', handler, `action-button${options.secondary ? ' secondary' : ''}${options.danger ? ' danger' : ''}`);
  el.innerHTML = `${esc(busy || connecting ? '確認中…' : label)}<small>${esc(detail)}</small>`;
  el.dataset.action = options.id; el.disabled = options.disabled; $('actions').append(el);
}
function acceptPractice(transition) {
  const { state, delta } = transition;
  if (!Number.isFinite(delta) || practice.balance + delta < 0) throw new Error('練習コインが足りません');
  practice.balance += delta; practice.profit += delta; practice.round = state;
  const round = publicRound(state);
  if (round.finished && !practice.history.some((item) => item.id === round.id)) {
    practice.history.unshift({ id: round.id, mode: round.mode, stake: round.stake, spent: round.spent, payout: round.payout, net: round.net, result: round.result, createdAt: new Date().toISOString() });
    practice.history = practice.history.slice(0, 20);
  }
  savePractice(); selected.clear(); render();
}
function practiceMove(callback) {
  // Prevent a second tap on the same screen position from choosing the next action.
  busy = true;
  try { acceptPractice(callback()); }
  catch (error) { notice(error.message || 'この操作はできません。', true); }
  finally { render(); setTimeout(() => { busy = false; render(); }, 350); }
}
async function startRound() {
  if (busy || connecting || active()) return;
  notice(''); selected.clear();
  if (source === 'practice') {
    practiceMove(() => createRound({ id: requestId(), mode, stake }));
  } else {
    pending = { subject: liveSubject, path: '/api/casino/start', body: { mode, stake, requestId: requestId() } }; savePending(); await sendPending();
  }
}
async function act(action) {
  if (busy || connecting) return;
  const round = current().round; if (!round || round.finished) return;
  const legal = round.actions?.find((item) => item.id === action);
  if (!legal || legal.cost > current().balance) return;
  notice('');
  const move = { action, ...(action === 'draw' ? { discards: [...selected].sort((a, b) => a - b) } : {}) };
  if (source === 'practice') {
    practiceMove(() => applyAction(practice.round, move));
  } else {
    pending = { subject: liveSubject, path: '/api/casino/action', body: { roundId: round.id, version: round.version, ...move, requestId: requestId() } }; savePending(); await sendPending();
  }
}
async function api(path, body, token = accessToken) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error?.message || '通信に失敗しました'); error.status = response.status; error.code = data.error?.code; throw error; }
    return data;
  } finally { clearTimeout(timer); }
}
function acceptLive(envelope) {
  live = envelope;
  if (live.round) { mode = live.round.mode; stake = live.round.stake; }
  selected.clear(); render();
}
async function sendPending() {
  if (!pending || busy || !accessToken || pending.subject !== liveSubject) return;
  busy = true; render(); notice('');
  const operation = pending;
  try {
    const envelope = await api(operation.path, operation.body);
    pending = null; savePending(); acceptLive(envelope);
  } catch (error) {
    if (error.status === 401) {
      accessToken = ''; initializedLiff = false;
      notice('ログイン期限が切れました。「ログインし直す」で接続すると、同じ操作の結果を確認できます。', true);
    } else if (error.status && error.status < 500) {
      pending = null; savePending();
      if (error.status === 409) {
        try { acceptLive(await api('/api/casino/session')); } catch { /* Show the original error and allow a later refresh. */ }
      }
      notice(error.message || '操作を確認できませんでした。', true);
    } else {
      // The original request might have succeeded. Never generate a replacement ID.
      try { acceptLive(await api('/api/casino/session')); } catch { /* Keep the durable pending request until it can be confirmed. */ }
      notice('通信結果を確認できませんでした。「通信を再確認」で同じ操作の結果を確認してください。同じ操作で二重に引かれることはありません。', true);
    }
  } finally { busy = false; render(); }
}

function showDialog(title, html, returnFocus = document.activeElement) {
  dialogReturnFocus = returnFocus;
  $('dialog-title').textContent = title; $('dialog-body').innerHTML = html;
  if (!$('info-dialog').open) $('info-dialog').showModal();
}
function closeDialog() { $('info-dialog').close(); dialogReturnFocus?.focus?.(); }
function payoutHtml() {
  if (mode === 'duel') return duelRules();
  if (mode === 'blackjack') return `<p>参加額 <strong>${fmt(stake)} ${unit()}</strong> のときの受取額です。</p><table class="payout-table"><thead><tr><th>結果</th><th>受取</th></tr></thead><tbody><tr><td>最初の2枚で21</td><td>${fmt(stake * 2.5)}</td></tr><tr><td>勝ち</td><td>${fmt(stake * 2)}</td></tr><tr><td>引き分け</td><td>${fmt(stake)}</td></tr><tr><td>負け / バースト</td><td>0</td></tr></tbody></table><p class="dialog-note">受取額には参加額が含まれます。ダブルでは参加額と通常の受取額が2倍になります。</p>`;
  return `<p>参加額 <strong>${fmt(stake)} ${unit()}</strong> のときの受取額です。</p><table class="payout-table"><thead><tr><th>できた役</th><th>受取</th></tr></thead><tbody>${RULES.pokerPayouts.map((row) => `<tr${current().round?.role === row.label ? ' class="current-role"' : ''}><td>${esc(row.label)}</td><td>${fmt(stake * row.multiplier)}</td></tr>`).join('')}</tbody></table><p class="dialog-note">受取額には参加額が含まれます。例：${fmt(stake)} コインでツーペアなら、受取 ${fmt(stake * 1.5)}・収支 +${fmt(stake * .5)}。役ができても参加額を下回ることがあります。</p>`;
}
function duelRules() {
  return '<ol><li>参加額と参加料10%を使い、もちディーラーと5枚のポーカーで勝負します。</li><li>交換前に「チェック / ベット」。相手が賭けたら「コール / レイズ / 降りる」を選びます。</li><li>交換したいカードをタップ。0〜5枚を一度だけ交換できます。</li><li>交換後にもう一度ベットし、強い役の側がポットを受け取ります。同じ強さなら山分けです。</li></ol><p class="dialog-note">ベットは参加額と同額。レイズは各ラウンド1回まで。参加料は戻りません。ディーラーは自分の手札だけを見て判断し、ブラフをすることもあります。</p>';
}
function showRules() {
  let html;
  if (mode === 'draw') html = '<ol><li>参加額を選んで「カードを配る」。5枚のカードが配られます。</li><li>交換したいカードをタップすると「交換」マークが付きます。もう一度タップすると解除できます。</li><li>0〜5枚を一度だけ交換。完成した役に応じてコインを受け取ります。</li></ol><h3>役の見方</h3><p>同じ数字が2枚でワンペア、3枚でスリーカード。同じマークが5枚でフラッシュ、数字が5枚連続するとストレートです。Aは最も大きい数字としても、A・2・3・4・5の並びとしても使えます。</p>';
  else if (mode === 'duel') html = duelRules();
  else html = '<ol><li>参加額を選んで2枚のカードを受け取ります。</li><li>「ヒット」で1枚追加。「スタンド」で今の点数で勝負します。</li><li>21を超えるとバースト。超えなければ、ディーラーより21に近い方の勝ちです。</li></ol><h3>カードの点数</h3><p>2〜10はその数字、J・Q・Kは10。Aはバーストしない範囲で11、それ以外は1になります。</p><h3>ダブルとディーラー</h3><p>最初の2枚でのみ「ダブル」ができます。同額を追加して1枚だけ引き、勝負します。ディーラーは17以上で必ず止まります（Aを11とする17も含む）。スプリットと保険はありません。</p>';
  showDialog(`${MODES[mode].name}の遊び方`, `${html}<p class="dialog-note">練習コインと葉っぱもちのポイントは別のものです。必ず勝てる方法はありません。カードは毎ゲーム、新しい52枚のデッキから配られます。</p>`);
}
async function showHistory() {
  if (source === 'points' && !busy && !connecting) {
    busy = true; render();
    try { const data = await api('/api/casino/history'); live.history = data.history; }
    catch { notice('履歴を更新できませんでした。最後に取得した履歴を表示します。', true); }
    finally { busy = false; render(); }
  }
  const history = current().history;
  showDialog(source === 'practice' ? '練習のプレイ履歴' : 'ポイントのプレイ履歴', history.length ? `<p class="dialog-note">直近20ゲームの収支です。進行中の参加額は上の残高に反映されています。</p>${history.map((item) => `<div class="history-item"><strong>${esc(MODES[item.mode]?.name || item.mode)}</strong><span class="history-result ${item.net > 0 ? 'positive' : item.net < 0 ? 'negative' : ''}">${signed(item.net)}</span><small>受取 ${fmt(item.payout)} − 使用 ${fmt(item.spent)} ${unit()}<br>${esc(new Date(item.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></div>`).join('')}` : '<p>まだ完了したゲームはありません。最初のひと勝負を楽しもう。</p>');
}
let configPromise;
async function loadConfig() {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    if (location.protocol === 'file:') { configLoaded = true; return; }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch('/api/casino/config', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('config');
      const data = await response.json();
      if (typeof data.enabled !== 'boolean' || typeof data.liffId !== 'string') throw new Error('config');
      config = data; configLoaded = true;
    } catch {
      configLoaded = false; configPromise = null;
      throw new Error('ポイント機能に接続できませんでした。通信を確認して「もちポイント」をもう一度押してください。');
    } finally { clearTimeout(timer); }
  })();
  return configPromise;
}
let sdkPromise;
async function loadLiff() {
  if (globalThis.liff) return globalThis.liff;
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; script.async = true;
    const timer = setTimeout(() => { sdkPromise = null; script.remove(); reject(new Error('LINEの接続に時間がかかっています。もう一度お試しください。')); }, 12000);
    script.onload = () => { clearTimeout(timer); resolve(globalThis.liff); };
    script.onerror = () => { clearTimeout(timer); sdkPromise = null; script.remove(); reject(new Error('LINEに接続できませんでした。')); };
    document.head.append(script);
  });
  return sdkPromise;
}
let initializedLiff = false;
async function connectPoints(allowLogin = false) {
  if (busy || connecting) return;
  connecting = true; render();
  try {
    if (!configLoaded) await loadConfig();
    if (!config.enabled || !config.liffId) {
      showDialog('ポイントで遊ぶ', '<p>ポイントで遊ぶ機能は準備中です。練習モードでは3つのゲームをすぐに楽しめます。</p><p class="dialog-note">練習コインを使っても、葉っぱもちの所持ポイントは変わりません。</p>', $('points-button')); return;
    }
    if (active() && source === 'practice') { notice('練習のゲームが途中です。最後まで遊んでからポイントに切り替えてください。'); return; }
    const liff = await loadLiff();
    if (!initializedLiff) { await liff.init({ liffId: config.liffId, withLoginOnExternalBrowser: false }); initializedLiff = true; }
    if (!liff.isLoggedIn()) {
      if (allowLogin) { liff.login({ redirectUri: location.href }); return; }
      showDialog('LINEでつづける', '<p>ログインすると、葉っぱもちの所持ポイントで遊べます。参加額を選んでカードを配るまで、ポイントは使われません。</p><button type="button" id="line-login-button" class="auth-button">LINEでログイン</button>', $('points-button'));
      $('line-login-button').addEventListener('click', () => { closeDialog(); connectPoints(true); }); return;
    }
    const candidateToken = liff.getAccessToken();
    if (!candidateToken) throw new Error('ログイン状態を確認できません。LINEから開き直してください。');
    // This identity only partitions local retry receipts. The server independently
    // verifies the access token and never accepts a client-supplied user ID.
    const profile = await liff.getProfile();
    if (typeof profile?.userId !== 'string' || !profile.userId) throw new Error('LINEアカウントを確認できませんでした。もう一度接続してください。');
    const envelope = await api('/api/casino/session', undefined, candidateToken);
    const switchedAccount = liveSubject && liveSubject !== profile.userId;
    accessToken = candidateToken; liveSubject = profile.userId; pending = pendingFor(liveSubject);
    source = 'points'; acceptLive(envelope);
    notice(pending ? '前回の通信結果を確認するため「通信を再確認」を押してください。' : switchedAccount ? 'LINEアカウントを切り替えました。別のアカウントの操作は送信していません。' : '葉っぱもちのポイントに切り替えました。');
  } catch (error) { notice(error.message || 'ログインに失敗しました。', true); }
  finally { connecting = false; render(); }
}

document.querySelectorAll('[data-mode]').forEach((tab) => tab.addEventListener('click', () => {
  if (busy || connecting) return;
  if (active() && active().mode !== tab.dataset.mode) { notice('進行中のゲームを終えると、ほかのゲームに切り替えられます。'); return; }
  if (source === 'points' && pending) { notice('先に「通信を再確認」で前回の結果を確認してください。'); return; }
  notice(''); mode = tab.dataset.mode; stake = RULES.stakes[mode][0]; selected.clear();
  if (source === 'practice' && practice.round?.finished) { practice.round = null; savePractice(); }
  if (source === 'points' && live.round?.finished) live.round = null;
  lastCardKey = ''; render();
}));
$('practice-button').addEventListener('click', () => {
  if (busy || connecting || source === 'practice') return;
  if (active() || pending) { notice('進行中のポイントのゲームを終えてから、練習に切り替えてください。'); return; }
  source = 'practice'; selected.clear(); notice(''); if (practice.round) { mode = practice.round.mode; stake = practice.round.stake; } render();
});
$('points-button').addEventListener('click', () => connectPoints());
$('help-button').addEventListener('click', showRules);
$('payout-button').addEventListener('click', () => showDialog(mode === 'duel' ? '上級ポーカーのルール' : '配当表', payoutHtml()));
$('history-button').addEventListener('click', showHistory);
$('dialog-close').addEventListener('click', closeDialog);
$('info-dialog').addEventListener('click', (event) => { if (event.target === $('info-dialog')) { const box = $('info-dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(); } });
$('refill-button').addEventListener('click', () => {
  if (source !== 'practice' || active() || busy || connecting) return;
  Object.assign(practice, blankPractice()); selected.clear(); savePractice(); notice('練習コイン・収支・履歴をリセットしました。'); render();
});
window.addEventListener('storage', (event) => {
  if (event.key !== PRACTICE_KEY || source !== 'practice') return;
  Object.assign(practice, loadPractice()); selected.clear(); notice('別の画面で更新された練習ゲームを読み込みました。'); render();
});
render();
loadConfig().catch(() => { /* A connection error never blocks local practice. */ });
