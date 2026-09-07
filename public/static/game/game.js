import { MochiPhysics, STAGES, WORLD, clamp } from './physics.mjs';
import { LINE_CONFIG } from './line-config.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const atlas = new Image();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const number = value => Math.round(value).toLocaleString('ja-JP');
const STORE_KEY = 'mochi-merge-v1';
let stored = {};
try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { /* Storage is optional in embedded browsers. */ }
let best = Number.isSafeInteger(stored.best) && stored.best >= 0 ? stored.best : 0;
let soundEnabled = stored.sound === true;
let audioContext;
let game;
let ready = false;
let paused = false;
let aimX = 210;
let activePointer = null;
let effects = [];
let bestAtStart = best;
let lastFrame = 0;
let accumulator = 0;
let lastAnnouncement = 0;

function savePreferences() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ best, sound: soundEnabled })); } catch { /* The game remains playable. */ }
}

function playTone(kind, level = 0) {
  if (!soundEnabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    const t = audioContext.currentTime;
    const tones = kind === 'merge' ? [392, 523.25, 659.25].slice(0, level >= 3 ? 3 : 2) : kind === 'over' ? [349.23, 293.66, 261.63] : [220];
    tones.forEach((frequency, i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = 'sine';
      const start = t + i * 0.065;
      oscillator.frequency.setValueAtTime(frequency * (kind === 'merge' ? 1 + level * 0.08 : 1), start);
      if (kind === 'drop') oscillator.frequency.exponentialRampToValueAtTime(130, start + 0.09);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.055, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.23);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(start); oscillator.stop(start + 0.25);
    });
  } catch { /* Sound is optional. */ }
}

function syncSound() {
  $('#sound-button').setAttribute('aria-pressed', String(soundEnabled));
  const label = soundEnabled ? '音をオフにする' : '音をオンにする';
  $('#sound-button').setAttribute('aria-label', label);
  $('#sound-button').title = label;
  $('#sound-path').setAttribute('d', soundEnabled ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6');
}

function drawMochi(context, level, x, y, radius, angle = 0, squash = 0, alpha = 1) {
  if (!atlas.complete || !atlas.naturalWidth) return;
  const stage = STAGES[level];
  const [sx, sy, sw, sh] = stage.sprite;
  const unit = radius * 2 / sw;
  context.save(); context.translate(x, y); context.rotate(angle);
  context.scale(1 + squash, 1 - squash * 0.78);
  context.globalAlpha = alpha;
  context.shadowColor = 'rgba(46,84,105,0.12)'; context.shadowBlur = radius * 0.11; context.shadowOffsetY = radius * 0.035;
  context.drawImage(atlas, sx, sy, sw, sh, -radius, -stage.anchor * unit, radius * 2, sh * unit);
  context.restore();
}

function drawIcon(target, level, ratio = 0.4) {
  const context = target.getContext('2d');
  context.clearRect(0, 0, target.width, target.height);
  drawMochi(context, level, target.width / 2, target.height * 0.53, target.width * ratio);
}

function syncHUD(pop = false) {
  $('#score').textContent = number(game.score);
  $('#score').style.fontSize = game.score >= 1000000 ? '19px' : game.score >= 10000 ? '24px' : '';
  if (game.score > best) { best = game.score; savePreferences(); }
  $('#best').textContent = number(best);
  $('#best').style.fontSize = best >= 1000000 ? '16px' : best >= 10000 ? '20px' : '';
  drawIcon($('#next-canvas'), game.nextLevel, 0.38);
  $('#next-canvas').setAttribute('aria-label', `次のおもち：${STAGES[game.nextLevel].name}`);
  if (pop && !reducedMotion) {
    $('#score').classList.remove('score-pop'); void $('#score').offsetWidth; $('#score').classList.add('score-pop');
  }
}

function announce(text) { $('#announcement').textContent = text; }

function handleEvent(event) {
  if (event.type === 'drop') {
    syncHUD(); playTone('drop'); aimX = game.clampX(aimX);
  } else if (event.type === 'merge') {
    syncHUD(true); playTone('merge', event.level);
    const text = event.final ? 'もちフィーバー！' : event.combo > 1 ? `${event.combo}連鎖！` : '合体！';
    effects.push({ type: 'label', x: event.x, y: event.y, text, points: event.points, born: game.time, final: event.final });
    if (!reducedMotion) {
      const count = event.final ? 28 : 10;
      for (let i = 0; i < count; i++) {
        const angle = Math.PI * 2 * i / count;
        effects.push({ type: 'particle', x: event.x, y: event.y, vx: Math.cos(angle) * (0.025 + Math.random() * 0.045), vy: Math.sin(angle) * (0.035 + Math.random() * 0.04), color: STAGES[event.level].color, born: game.time, radius: 2 + Math.random() * 3 });
      }
    }
    if (game.time - lastAnnouncement > 700) {
      announce(`${text} ${event.points}点。スコア ${game.score}点。`); lastAnnouncement = game.time;
    }
  } else if (event.type === 'over') {
    activePointer = null; syncHUD(); playTone('over');
    $('#result-score').textContent = number(game.score);
    $('#result-best').textContent = number(best);
    $('#result-summary').textContent = `${game.merges}回合体 · ${STAGES[game.highest].name}まで成長`;
    $('#result-eyebrow').textContent = game.score > bestAtStart ? 'ベスト更新！' : 'おつかれさま！';
    drawIcon($('#result-mochi'), game.highest, 0.43);
    announce(`ゲーム終了。スコア ${game.score}点。もう一度遊べます。`);
    requestAnimationFrame(() => openDialog('over-dialog'));
  }
}

function drawBowl() {
  const { left, right, bottom, line } = WORLD;
  ctx.save();
  const fill = ctx.createLinearGradient(0, 98, 0, bottom);
  fill.addColorStop(0, 'rgba(255,255,255,0.1)'); fill.addColorStop(1, 'rgba(247,253,255,0.36)');
  ctx.beginPath(); ctx.moveTo(left, 101); ctx.lineTo(right, 101); ctx.lineTo(right, bottom - 18);
  ctx.quadraticCurveTo(right, bottom, right - 18, bottom); ctx.lineTo(left + 18, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - 18); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(left, 100); ctx.lineTo(left, bottom - 15);
  ctx.quadraticCurveTo(left, bottom + 1, left + 17, bottom + 1); ctx.lineTo(right - 17, bottom + 1);
  ctx.quadraticCurveTo(right, bottom + 1, right, bottom - 15); ctx.lineTo(right, 100);
  ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(60,121,153,0.2)'; ctx.shadowBlur = 11; ctx.shadowOffsetY = 6;
  ctx.strokeStyle = 'rgba(243,251,255,0.96)'; ctx.lineWidth = 12; ctx.stroke();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(131,184,211,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left + 4, 102); ctx.lineTo(left + 4, bottom - 18);
  ctx.quadraticCurveTo(left + 4, bottom - 4, left + 18, bottom - 4); ctx.lineTo(right - 18, bottom - 4);
  ctx.quadraticCurveTo(right - 4, bottom - 4, right - 4, bottom - 18); ctx.lineTo(right - 4, 102);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
  ctx.setLineDash([5, 8]); ctx.beginPath(); ctx.moveTo(left + 13, line); ctx.lineTo(right - 13, line);
  ctx.lineWidth = game?.danger > 0.05 ? 2.2 : 1.5;
  ctx.strokeStyle = game?.danger > 0.05 ? `rgba(213,100,93,${0.45 + game.danger * 0.45})` : 'rgba(88,140,170,0.32)'; ctx.stroke();
  ctx.setLineDash([]);
  if (game?.danger > 0) {
    ctx.strokeStyle = '#d7736d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(left + 13, line);
    ctx.lineTo(left + 13 + (right - left - 26) * game.danger, line); ctx.stroke();
  }
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, WORLD.width, WORLD.height); drawBowl();
  if (!ready || !game) return;
  for (const body of game.bodies) {
    const data = body.mochi, elapsed = game.time - data.hitAt;
    const squash = !reducedMotion && elapsed >= 0 && elapsed < 450 ? Math.sin(elapsed / 450 * Math.PI * 3) * Math.exp(-elapsed / 175) * data.hitStrength * 0.13 : 0;
    drawMochi(ctx, data.level, body.position.x, body.position.y, STAGES[data.level].radius, body.angle, squash);
  }
  if (!game.gameOver && game.canDrop) {
    const stage = STAGES[game.currentLevel], x = game.clampX(aimX), y = WORLD.spawnY;
    const landing = game.landingY(x);
    if (landing > y + stage.radius * 2) {
      drawMochi(ctx, game.currentLevel, x, landing, stage.radius, 0, 0, activePointer !== null ? 0.19 : 0.11);
      ctx.save(); ctx.setLineDash([1, 10]); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y + stage.radius + 10); ctx.lineTo(x, landing - stage.radius * 0.9 - 4); ctx.stroke(); ctx.restore();
    }
    const bob = activePointer === null && !reducedMotion ? Math.sin(game.time / 450) * 1.4 : 0;
    drawMochi(ctx, game.currentLevel, x, y + bob, stage.radius);
    if (game.drops === 0) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.86)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (const direction of [-1, 1]) {
        const from = x + direction * (stage.radius + 15), to = x + direction * (stage.radius + 54);
        ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(to, y); ctx.moveTo(to - direction * 7, y - 5); ctx.lineTo(to, y); ctx.lineTo(to - direction * 7, y + 5); ctx.stroke();
      }
      ctx.font = '600 15px "Hiragino Kaku Gothic ProN", Meiryo, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#668da4';
      ctx.fillText('最初のおもちを落としてみよう', 210, 301); ctx.restore();
    }
  }
  effects = effects.filter(effect => game.time - effect.born < (effect.type === 'label' ? 1050 : 700));
  for (const effect of effects) {
    const age = game.time - effect.born; ctx.save();
    if (effect.type === 'particle') {
      ctx.globalAlpha = Math.max(0, 1 - age / 700); ctx.fillStyle = effect.color;
      ctx.beginPath(); ctx.arc(effect.x + effect.vx * age, effect.y + effect.vy * age + age * age * 0.00008, effect.radius, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = Math.min(1, Math.max(0, (1050 - age) / 450));
      const textX = clamp(effect.x, 88, 332), textY = Math.max(153, effect.y - 22 - (reducedMotion ? 0 : age * 0.035));
      ctx.font = `800 ${effect.final ? 23 : 24}px "Hiragino Maru Gothic ProN", Meiryo, sans-serif`;
      ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#fffdf4';
      ctx.strokeText(effect.text, textX, textY); ctx.fillStyle = '#d9983a'; ctx.fillText(effect.text, textX, textY);
      ctx.font = '800 17px system-ui,sans-serif'; ctx.lineWidth = 4;
      ctx.strokeText(`+${effect.points}`, textX, textY + 23); ctx.fillStyle = '#678c5d'; ctx.fillText(`+${effect.points}`, textX, textY + 23);
    }
    ctx.restore();
  }
  $('#danger-note').hidden = game.danger < 0.12 || game.gameOver;
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WORLD.width * ratio); canvas.height = Math.round(WORLD.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); render();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastFrame) lastFrame = now;
  const delta = Math.min(now - lastFrame, 50); lastFrame = now;
  if (!ready || paused || game.gameOver || document.hidden) { accumulator = 0; return; }
  accumulator += delta;
  const step = 1000 / 60;
  let updated = false;
  while (accumulator >= step) { game.step(step); accumulator -= step; updated = true; }
  if (updated) render();
}

function openDialog(id) {
  activePointer = null; paused = true;
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}
function closeDialog(id) { document.getElementById(id).close(); }

function resetGame() {
  game.reset(); bestAtStart = best; effects = []; aimX = 210; activePointer = null;
  accumulator = 0; lastFrame = performance.now(); lastAnnouncement = 0;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  paused = false; syncHUD(); render(); canvas.focus({ preventScroll: true });
  announce('新しいゲームです。最初のおもちを落としてください。');
}

function updateAim(event) {
  const rect = canvas.getBoundingClientRect();
  aimX = game.clampX((event.clientX - rect.left) / rect.width * WORLD.width);
}

canvas.addEventListener('pointerdown', event => {
  if (!ready || paused || !game.canDrop || activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true }); updateAim(event); render();
});
canvas.addEventListener('pointermove', event => {
  if (!ready || paused || game.gameOver || (activePointer !== null && activePointer !== event.pointerId)) return;
  if (activePointer !== null || event.pointerType === 'mouse') { updateAim(event); render(); }
});
canvas.addEventListener('pointerup', event => {
  if (activePointer !== event.pointerId) return;
  event.preventDefault(); updateAim(event); activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!paused && ready) game.drop(aimX);
  render();
});
for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
  if (activePointer === event.pointerId) { activePointer = null; render(); }
});
canvas.addEventListener('keydown', event => {
  if (!ready || paused || game.gameOver) return;
  if (['ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Escape', 'p', 'P'].includes(event.key)) event.preventDefault();
  if (event.key === 'ArrowLeft') aimX = game.clampX(aimX - 12);
  if (event.key === 'ArrowRight') aimX = game.clampX(aimX + 12);
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) game.drop(aimX);
  if (['Escape', 'p', 'P'].includes(event.key)) openDialog('pause-dialog');
  render();
});

$('#sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled; savePreferences(); syncSound(); if (soundEnabled) playTone('merge', 0); });
$('#help-button').addEventListener('click', () => openDialog('help-dialog'));
$('#how-to-link').addEventListener('click', () => openDialog('help-dialog'));
$('#pause-button').addEventListener('click', () => { if (ready) openDialog(game.gameOver ? 'over-dialog' : 'pause-dialog'); });
$('#resume-button').addEventListener('click', () => closeDialog('pause-dialog'));
$('#restart-button').addEventListener('click', () => { openDialog('reset-dialog'); closeDialog('pause-dialog'); });
$('#cancel-restart').addEventListener('click', () => closeDialog('reset-dialog'));
$('#confirm-restart').addEventListener('click', resetGame);
$('#play-again-button').addEventListener('click', resetGame);
$('#reload-button').addEventListener('click', () => location.reload());
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  paused = Boolean(document.querySelector('dialog[open]')); lastFrame = performance.now(); accumulator = 0;
  if (!paused && ready && !game.gameOver) canvas.focus({ preventScroll: true });
});
$('#over-dialog').addEventListener('cancel', event => event.preventDefault());
document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now(); accumulator = 0;
  if (document.hidden && ready && !paused && !game.gameOver && game.drops > 0) openDialog('pause-dialog');
});
window.addEventListener('pagehide', savePreferences);
window.addEventListener('resize', resize);

async function initializeLine() {
  // Public LIFF ID is configured after registration by the owner in LINE Developers.
  if (!LINE_CONFIG.liffId) return;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    await window.liff.init({ liffId: LINE_CONFIG.liffId });
  } catch { /* Standalone play remains available if LINE is unreachable. */ }
}

async function initialize() {
  syncSound(); $('#best').textContent = number(best); resize();
  try {
    if (!window.Matter?.Engine) throw new Error('Physics unavailable');
    atlas.src = './assets/mochi-atlas.png'; await atlas.decode();
    for (let level = 0; level < STAGES.length; level++) {
      const stage = STAGES[level], item = document.createElement('li');
      const icon = document.createElement('canvas'); icon.width = 144; icon.height = 144; icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'stage-name'; label.textContent = stage.short;
      const numberLabel = document.createElement('span'); numberLabel.className = 'stage-number'; numberLabel.textContent = `STEP ${level + 1}`;
      label.append(numberLabel); item.append(icon, label); $('#evolution').append(item); drawIcon(icon, level, 0.26 + level * 0.035);
    }
    for (const icon of document.querySelectorAll('[data-mochi]')) drawIcon(icon, Number(icon.dataset.mochi), 0.42);
    drawIcon($('#brand-mochi'), 2, 0.44);
    game = new MochiPhysics(window.Matter, { onEvent: handleEvent });
    ready = true; $('#loading').hidden = true; $('#play-area').setAttribute('aria-busy', 'false');
    syncHUD(); render(); requestAnimationFrame(frame); void initializeLine();
  } catch (error) {
    $('#loading').hidden = true; $('#load-error').hidden = false; $('#play-area').setAttribute('aria-busy', 'false');
    $('#pause-button').disabled = true; console.error('The mochi game could not initialize.', error);
  }
}

void initialize();
