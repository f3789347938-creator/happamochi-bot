import { MochiPhysics, STAGES, WORLD, POWER, SKILLS, SKILL_RULES, BLAST, clamp } from './physics.mjs';
import { MochiEffects } from './effects.mjs';
import { LINE_CONFIG } from './line-config.js';
import { snapshotResult, resultText, lineShareUrl, drawResultCard, canShareImage, shareResultImage } from './share.mjs';
// ランキング送信。ranking.mjs は前から置いてあったが、ゲーム本体を新版に
// 差し替えたときに呼び出しが消えてしまい、スコアが1件も保存されていなかった。
import { startScoreRun, submitScore } from './ranking.mjs?v=20260921-rewards';
import { PuzzleRewardSession } from './reward-session.mjs?v=20260921-rewards';
import { gameRewardText } from '../game-rewards.mjs?v=20260921-rewards';

const $ = selector => document.querySelector(selector);
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const atlas = new Image();
let sprites = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fx = new MochiEffects(ctx, { reducedMotion, drawMochi });
const number = value => Math.round(value).toLocaleString('ja-JP');
const STORE_KEY = 'mochi-merge-v1';
let stored = {};
try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { /* Storage is optional in embedded browsers. */ }
let best = Number.isSafeInteger(stored.best) && stored.best >= 0 ? stored.best : 0;
let soundEnabled = stored.sound === true;
let audioContext;
let audioOutput;
let game;
let ready = false;
let paused = false;
let aimX = 210;
let activePointer = null;
let bestAtStart = best;
let lastFrame = 0;
let accumulator = 0;
let lastAnnouncement = 0;
let snackTarget = null;
let sharedResult = null;
let resultImageFile = null;
let resultImageUrl = null;
let resultImageGeneration = 0;
let imageShareBusy = false;
let lineReady = Promise.resolve();
let gameRun = null;
const skillButtons = [...document.querySelectorAll('[data-skill]')];

function savePreferences() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ best, sound: soundEnabled })); } catch { /* The game remains playable. */ }
}

function clearResultSharing() {
  resultImageGeneration++;
  sharedResult = null; resultImageFile = null; imageShareBusy = false;
  if (resultImageUrl) URL.revokeObjectURL(resultImageUrl);
  resultImageUrl = null;
  $('#line-share-button').removeAttribute('href');
  $('#image-share-button').hidden = true; $('#image-share-button').disabled = true;
  $('#image-save-button').removeAttribute('href'); $('#image-save-button').removeAttribute('download');
  $('#image-save-button').setAttribute('aria-disabled', 'true'); $('#image-save-button').tabIndex = -1;
  $('#share-status').textContent = '';
}

function beginRewardRun() {
  // Keep start/save requests in play order even when replay is pressed quickly.
  gameRun = new PuzzleRewardSession({ ready: lineReady, previous: gameRun, start: startScoreRun, submit: submitScore });
  $('#rank-status').textContent = '';
  $('#game-points-status').textContent = '';
  $('#rank-retry-button').hidden = true;
}

async function sendScoreToRanking() {
  const session = gameRun;
  if (!session) return;
  // Capture before awaiting LINE/network; a replay must not replace these numbers.
  const score = { score: game.score, merges: game.merges, stage: game.highest };
  $('#rank-status').textContent = '記録を保存しています…';
  $('#game-points-status').textContent = 'ガチャ用ポイントを確認しています…';
  $('#rank-retry-button').hidden = true;
  try {
    const saved = await session.save(score);
    if (session !== gameRun || !game.gameOver) return;
    $('#rank-status').textContent = saved.message || '';
    $('#game-points-status').textContent = saved.reward ? gameRewardText(saved.reward) : 'ガチャ用ポイントの付与結果はまだ確認できていません。';
    $('#rank-retry-button').hidden = !saved.retryable;
  } catch {
    if (session !== gameRun || !game.gameOver) return;
    $('#rank-status').textContent = '通信できませんでした。記録を再送できます。';
    $('#game-points-status').textContent = 'ガチャ用ポイントの付与結果はまだ確認できていません。';
    $('#rank-retry-button').hidden = false;
  }
}

function prepareResultSharing() {
  clearResultSharing();
  const result = snapshotResult(game, best, bestAtStart), generation = resultImageGeneration;
  sharedResult = result;
  const text = resultText(result, LINE_CONFIG.shareUrl);
  $('#line-share-button').href = lineShareUrl(text);
  const card = $('#result-card');
  card.setAttribute('aria-label', text);
  try {
    drawResultCard(card, result, drawMochi);
    $('#share-status').textContent = '結果画像を準備しています…';
    card.toBlob(blob => {
      if (generation !== resultImageGeneration) return;
      if (!blob) { $('#share-status').textContent = '画像を作れませんでした。LINEへは文章で共有できます。'; return; }
      try {
        resultImageUrl = URL.createObjectURL(blob);
        const filename = `mochi-merge-${result.score}.png`;
        const save = $('#image-save-button'); save.href = resultImageUrl; save.download = filename;
        save.setAttribute('aria-disabled', 'false'); save.tabIndex = 0;
        if (typeof File === 'function') resultImageFile = new File([blob], filename, { type: 'image/png' });
        const available = canShareImage(navigator, resultImageFile);
        $('#image-share-button').hidden = !available; $('#image-share-button').disabled = !available;
        $('#share-status').textContent = '';
      } catch { $('#share-status').textContent = '画像の共有を準備できませんでした。LINEへは文章で共有できます。'; }
    }, 'image/png');
  } catch { $('#share-status').textContent = '画像を作れませんでした。LINEへは文章で共有できます。'; }
}

async function shareImage() {
  if (!sharedResult || !resultImageFile || imageShareBusy) return;
  const result = sharedResult;
  imageShareBusy = true; $('#image-share-button').disabled = true;
  $('#share-status').textContent = '共有先にLINEを選んでね。';
  const status = await shareResultImage(navigator, resultImageFile);
  if (result !== sharedResult) return;
  imageShareBusy = false; $('#image-share-button').disabled = false;
  $('#share-status').textContent = status === 'shared' ? '画像の共有操作が完了しました。'
    : status === 'cancelled' ? '画像の共有をキャンセルしました。'
    : '画像を共有できませんでした。「画像を保存」からLINEに添付できます。';
}

function playTone(kind, level = 0) {
  if (!soundEnabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (!audioOutput) {
      audioOutput = audioContext.createDynamicsCompressor();
      audioOutput.threshold.value = -12; audioOutput.knee.value = 12; audioOutput.ratio.value = 6;
      audioOutput.attack.value = 0.008; audioOutput.release.value = 0.15; audioOutput.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    const t = audioContext.currentTime;
    const tones = { merge: [523.25, 659.25, 783.99, 1046.5].slice(0, level >= 3 ? 4 : 3),
      roll: [261.63, 392, 523.25, 783.99], snack: [180, 95, 65], evolve: [523.25, 659.25, 783.99, 1046.5],
      over: [349.23, 293.66, 261.63], drop: [196] }[kind] || [392];
    tones.forEach((frequency, i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = ['snack', 'roll', 'evolve'].includes(kind) ? 'triangle' : 'sine';
      const start = t + i * 0.055;
      oscillator.frequency.setValueAtTime(frequency * (kind === 'merge' ? 1 + level * 0.04 : 1), start);
      if (kind === 'drop') oscillator.frequency.exponentialRampToValueAtTime(130, start + 0.09);
      if (kind === 'snack') oscillator.frequency.exponentialRampToValueAtTime(40, start + 0.28);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(kind === 'snack' ? 0.06 : 0.04, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      oscillator.connect(gain); gain.connect(audioOutput);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + 0.32);
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

function prepareSprites() {
  // Cache each stage once. Standard Canvas compositing preserves the source
  // texture and alpha without depending on Canvas filters in embedded browsers.
  sprites = STAGES.map(stage => {
    const [sx, sy, sw, sh] = stage.sprite;
    const sprite = document.createElement('canvas'); sprite.width = sw; sprite.height = sh;
    const context = sprite.getContext('2d');
    context.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
    if (stage.tint) {
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = stage.tint; context.fillRect(0, 0, sw, sh);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
      context.globalCompositeOperation = 'source-over';
    }
    return sprite;
  });
}

function drawMochi(context, level, x, y, radius, angle = 0, squash = 0, alpha = 1) {
  const stage = STAGES[level], sprite = sprites[level];
  if (!sprite) return;
  const sw = sprite.width, sh = sprite.height;
  const unit = radius * 2 / sw;
  context.save(); context.translate(x, y); context.rotate(angle);
  context.scale(1 + squash, 1 - squash * 0.78);
  context.globalAlpha = alpha;
  context.shadowColor = 'rgba(46,84,105,0.12)'; context.shadowBlur = radius * 0.11; context.shadowOffsetY = radius * 0.035;
  context.drawImage(sprite, -radius, -stage.anchor * unit, radius * 2, sh * unit);
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
  syncSkills();
}

function announce(text) { $('#announcement').textContent = text; }

function syncSkills() {
  const power = game?.power ?? POWER.initial, selecting = Boolean(game?.activeSkill), evolving = game?.activeSkill === 'evolve';
  $('#power-gauge').value = power;
  $('#power-value').textContent = `${power} / ${POWER.max}`;
  $('#power-gauge').classList.toggle('is-full', power === POWER.max);
  const remaining = game?.skillDropsRemaining ?? 0;
  const uses = game?.skillUsesRemaining ?? SKILL_RULES.maxUsesPerGame;
  const status = uses === 0 ? 'このプレイのスキルは使い切ったよ'
    : remaining > 0 ? `残り${uses}回 · 次はあと${remaining}個落としてから`
    : `スキルは全種類合わせて、残り${uses}回`;
  if ($('#skill-status').textContent !== status) $('#skill-status').textContent = status;
  for (const button of skillButtons) {
    const available = ready && !paused && game.canUseSkill(button.dataset.skill);
    button.disabled = !available;
    button.classList.toggle('is-ready', available);
  }
  $('#skill-buttons').hidden = selecting;
  $('#target-controls').hidden = !selecting;
  const target = game?.bodies.find(body => body.id === snackTarget);
  $('#selection-title').textContent = evolving ? (target && target.mochi.level < STAGES.length - 1 ? `${STAGES[target.mochi.level].short} → ${STAGES[target.mochi.level + 1].short}` : '進化させたいもちを選んでね')
    : target ? `${game.blastTargets(target.id).length}個まとめて消せる！` : 'ボムの中心を選んでね';
  $('#control-hint').textContent = selecting ? (evolving ? '進化させたいもちをタップ' : '光ったもちをまとめて消す') : '左右に動かして、指を離す';
  $('#keyboard-hint').textContent = selecting ? '矢印で選択 · Enterで決定 · Escでやめる' : 'PCでは ← → とスペースでも遊べます';
  canvas.classList.toggle('snack-targeting', selecting);
  $('#play-area').classList.toggle('is-fusing', Boolean(ready && game.time < game.fusionEndsAt));
  $('#play-area').classList.toggle('is-paused', paused);
}

function releasePointer() {
  const pointer = activePointer; activePointer = null;
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
}

function cancelSkillSelection() {
  if (!game?.cancelSkill()) return;
  snackTarget = null; releasePointer();
  syncSkills(); render();
  if (!paused) canvas.focus({ preventScroll: true });
  announce('スキルをキャンセルしました。パワーは減りません。');
}

function activateSkill(skill) {
  if (!ready || paused || !game.canUseSkill(skill)) return;
  releasePointer(); fx.reset();
  if (skill === 'roll') {
    game.useRoll();
  } else if (skill === 'snack') {
    if (!game.beginSnack()) return;
    snackTarget = game.bodies.at(-1)?.id ?? null;
    announce('ボムの中心を選んでください。光ったもちを最大6個消します。');
  } else if (skill === 'evolve') {
    if (!game.beginEvolve()) return;
    snackTarget = [...game.bodies].reverse().find(body => body.mochi.level < STAGES.length - 1)?.id ?? null;
    announce('進化させたいもちをタップしてください。矢印キーでも選べます。');
  }
  syncSkills(); render(); canvas.focus({ preventScroll: true });
}

function handleEvent(event) {
  if (event.type === 'drop') {
    syncHUD(); playTone('drop'); aimX = game.clampX(aimX);
  } else if (event.type === 'merge') {
    syncHUD(true); playTone('merge', event.level);
    const text = event.final ? 'もち祭り！' : event.combo > 1 ? `${event.combo}連鎖！` : '合体！';
    fx.merge(event, game.time);
    if (game.time - lastAnnouncement > 700) {
      announce(`${text} ${event.points}点。スコア ${game.score}点。`); lastAnnouncement = game.time;
    }
  } else if (event.type === 'skill') {
    snackTarget = null; aimX = game.clampX(aimX); syncHUD(true); playTone(event.skill);
    fx.skill(event, game.time);
    announce(`${SKILLS[event.skill].name}を使いました。残りパワー${game.power}。`);
  } else if (event.type === 'over') {
    activePointer = null; syncHUD(); playTone('over');
    $('#result-score').textContent = number(game.score);
    $('#result-best').textContent = number(best);
    $('#result-summary').textContent = `${game.merges}回合体 · ${STAGES[game.highest].name}まで成長`;
    $('#result-eyebrow').textContent = game.score > bestAtStart ? 'ベスト更新！' : 'おつかれさま！';
    prepareResultSharing();
    // 結果をランキングへ送る。失敗してもゲームの進行は止めない。
    sendScoreToRanking();
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
  ctx.clearRect(0, 0, WORLD.width, WORLD.height); ctx.save();
  const camera = ready && !game.activeSkill ? fx.camera(game.time) : { x: 0, y: 0 };
  ctx.translate(camera.x, camera.y); drawBowl();
  if (!ready || !game) { ctx.restore(); return; }
  fx.drawBack(game.time);
  const target = game.bodies.find(body => body.id === snackTarget);
  const victims = new Set(game.activeSkill === 'snack' ? game.blastTargets(snackTarget) : []);
  if (game.activeSkill === 'snack' && target) {
    ctx.save(); ctx.beginPath(); ctx.arc(target.position.x, target.position.y, BLAST.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb24423'; ctx.fill(); ctx.strokeStyle = '#f1a443'; ctx.setLineDash([7, 6]); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  for (const body of game.bodies) {
    const data = body.mochi, elapsed = game.time - data.hitAt;
    const squash = !reducedMotion && elapsed >= 0 && elapsed < 450 ? Math.sin(elapsed / 450 * Math.PI * 3) * Math.exp(-elapsed / 175) * data.hitStrength * 0.19 : 0;
    const age = game.time - data.bornAt;
    const pop = !reducedMotion && data.merged && age < 420 ? 0.72 + 0.28 * clamp(age / 160, 0, 1) + 0.18 * Math.sin(age / 420 * Math.PI) : 1;
    let x = body.position.x, y = body.position.y, angle = body.angle;
    const fusion = game.fusionPairs.find(pair => !pair.done && (pair.a === body || pair.b === body));
    if (fusion) {
      const from = fusion.a === body ? fusion.fromA : fusion.fromB;
      const progress = clamp((game.time - fusion.startsAt) / (fusion.mergesAt - fusion.startsAt), 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      if (!reducedMotion) {
        x = from.x + (fusion.x - from.x) * eased; y = from.y + (fusion.y - from.y) * eased - Math.sin(progress * Math.PI) * 40;
        angle += Math.sin(progress * Math.PI) * (fusion.a === body ? 0.18 : -0.18);
        ctx.save(); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo((from.x + x) / 2, Math.min(from.y, y) - 25, x, y);
        ctx.strokeStyle = '#53ddfa9c'; ctx.shadowColor = '#65e8ff'; ctx.shadowBlur = 10; ctx.lineWidth = 5 * (1 - progress) + 1; ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, STAGES[data.level].radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#53d8ef'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    }
    drawMochi(ctx, data.level, x, y, STAGES[data.level].radius * pop, angle, squash);
    if (game.activeSkill) {
      const highlighted = victims.has(body) || (game.activeSkill === 'evolve' && body.id === snackTarget && data.level < STAGES.length - 1);
      ctx.save(); ctx.beginPath();
      body.vertices.forEach((vertex, index) => index ? ctx.lineTo(vertex.x, vertex.y) : ctx.moveTo(vertex.x, vertex.y)); ctx.closePath();
      ctx.strokeStyle = highlighted ? (game.activeSkill === 'evolve' ? '#985beb' : '#f39232') : 'rgba(255,255,255,.55)';
      ctx.lineWidth = highlighted ? 4 : 1; ctx.stroke(); ctx.restore();
    }
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
  fx.drawFront(game.time); ctx.restore();
  if (!game.activeSkill && !game.gameOver) fx.drawBanner(game.time);
  $('#danger-note').hidden = game.danger < 0.12 || game.gameOver;
  syncSkills();
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
  if (!ready || paused || game.gameOver || game.activeSkill || document.hidden) { accumulator = 0; return; }
  accumulator += delta;
  const step = 1000 / 60;
  let updated = false;
  while (accumulator >= step) { game.step(step); accumulator -= step; updated = true; }
  if (updated) render();
}

function openDialog(id) {
  releasePointer(); paused = true;
  game?.cancelSkill(); snackTarget = null;
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
  syncSkills(); render();
}
function closeDialog(id) { document.getElementById(id).close(); }

function resetGame() {
  clearResultSharing();
  beginRewardRun();
  releasePointer(); game.reset(); bestAtStart = best; fx.reset(); aimX = 210; snackTarget = null;
  accumulator = 0; lastFrame = performance.now(); lastAnnouncement = 0;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  paused = false; syncHUD(); render(); canvas.focus({ preventScroll: true });
  announce('新しいゲームです。最初のおもちを落としてください。');
}

function updateAim(event) {
  const rect = canvas.getBoundingClientRect();
  aimX = game.clampX((event.clientX - rect.left) / rect.width * WORLD.width);
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * WORLD.width, y: (event.clientY - rect.top) / rect.height * WORLD.height };
}

function snackHit(event) {
  const point = pointFromEvent(event);
  const exact = window.Matter.Query.point([...game.bodies].reverse(), point)[0];
  if (exact) return exact.id;
  const nearby = game.bodies.map(body => ({ body, gap: Math.hypot(point.x - body.position.x, point.y - body.position.y) - STAGES[body.mochi.level].radius }))
    .filter(item => item.gap <= 8).sort((a, b) => a.gap - b.gap)[0];
  return nearby?.body.id ?? null;
}

function confirmTarget() {
  const evolved = game.activeSkill === 'evolve';
  const used = evolved ? game.evolveMochi(snackTarget) : game.eatMochi(snackTarget);
  if (!used) announce(evolved ? '王様もち以外の、進化させたいもちを選んでください。' : 'ボムの中心になるもちを選んでください。パワーはまだ使っていません。');
}

canvas.addEventListener('pointerdown', event => {
  if (!ready || paused || game.gameOver || (!game.canDrop && !game.activeSkill) || activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  if (game.activeSkill) snackTarget = snackHit(event); else updateAim(event);
  render();
});
canvas.addEventListener('pointermove', event => {
  if (!ready || paused || game.gameOver || (activePointer !== null && activePointer !== event.pointerId)) return;
  if (activePointer !== null || event.pointerType === 'mouse') {
    if (game.activeSkill) snackTarget = snackHit(event); else updateAim(event);
    render();
  }
});
canvas.addEventListener('pointerup', event => {
  if (activePointer !== event.pointerId) return;
  event.preventDefault(); releasePointer();
  if (!paused && ready) {
    if (game.activeSkill) {
      snackTarget = snackHit(event);
      confirmTarget();
    } else { updateAim(event); game.drop(aimX); }
  }
  render();
});
for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
  if (activePointer === event.pointerId) { activePointer = null; render(); }
});
canvas.addEventListener('keydown', event => {
  if (!ready || paused || game.gameOver) return;
  if (game.activeSkill) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape', 'p', 'P'].includes(event.key)) event.preventDefault();
    if (event.key.startsWith('Arrow')) {
      const ids = game.bodies.filter(body => game.activeSkill !== 'evolve' || body.mochi.level < STAGES.length - 1).map(body => body.id), current = ids.indexOf(snackTarget);
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      snackTarget = ids[current < 0 ? (direction < 0 ? ids.length - 1 : 0) : (current + direction + ids.length) % ids.length];
      const selected = game.bodies.find(body => body.id === snackTarget);
      if (selected) announce(`${STAGES[selected.mochi.level].name}を選択中。Enterで決定します。`);
    }
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat && snackTarget !== null) confirmTarget();
    if (event.key === 'Escape') cancelSkillSelection();
    if (['p', 'P'].includes(event.key)) openDialog('pause-dialog');
    render(); return;
  }
  if (['1', '2', '3'].includes(event.key)) {
    event.preventDefault(); if (!event.repeat) activateSkill(['roll', 'snack', 'evolve'][Number(event.key) - 1]); return;
  }
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
$('#rank-retry-button').addEventListener('click', () => { void sendScoreToRanking(); });
$('#play-again-button').addEventListener('click', resetGame);
$('#line-share-button').addEventListener('click', event => {
  if (!sharedResult) { event.preventDefault(); return; }
  $('#share-status').textContent = 'LINE側で送信先と内容を確認してね。';
});
$('#image-share-button').addEventListener('click', shareImage);
$('#image-save-button').addEventListener('click', event => {
  if (!resultImageUrl) { event.preventDefault(); return; }
  $('#share-status').textContent = '保存した画像は、LINEのトークに添付して送れます。';
});
$('#reload-button').addEventListener('click', () => location.reload());
// スタート画面のタップ・クリック・Enter/Spaceで開始する。
// <button> なのでキーボードのEnter/Spaceはブラウザがclickに変換してくれる。
$('#start-screen')?.addEventListener('click', startGameFromScreen);
for (const button of skillButtons) {
  button.querySelector('.skill-cost').textContent = SKILLS[button.dataset.skill].cost;
  button.setAttribute('aria-label', `${SKILLS[button.dataset.skill].name}、パワー${SKILLS[button.dataset.skill].cost}消費`);
  button.addEventListener('click', () => activateSkill(button.dataset.skill));
}
$('#cancel-target').addEventListener('click', cancelSkillSelection);
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  paused = Boolean(document.querySelector('dialog[open]')); lastFrame = performance.now(); accumulator = 0;
  syncSkills(); render();
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
      const timer = setTimeout(() => reject(new Error('LINE SDK timeout')), 8000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('LINE SDK unavailable')); };
      document.head.appendChild(script);
    });
    let initTimer;
    try {
      await Promise.race([
        window.liff.init({ liffId: LINE_CONFIG.liffId }),
        new Promise((_, reject) => { initTimer = setTimeout(() => reject(new Error('LINE init timeout')), 8000); }),
      ]);
    } finally { clearTimeout(initTimer); }
  } catch { /* Standalone play remains available if LINE is unreachable. */ }
}

// === スタート画面 ========================================================
// 開いた瞬間に遊び始めてしまうと、指を置いた場所にもちが落ちて事故になる。
// タップしてから始める画面をはさむ。
function showStartScreen() {
  const screen = $('#start-screen');
  if (!screen) return;
  // タイトルのおもち。段階は真ん中あたり(葉っぱもち)を使う。
  const icon = $('#start-mochi');
  if (icon) drawIcon(icon, Math.min(3, STAGES.length - 1), 0.46);
  // 前回の記録があれば出す。0のときは出さない。
  const bestLabel = $('#start-best');
  if (bestLabel) {
    if (best > 0) {
      bestLabel.textContent = `ベスト ${number(best)}`;
      bestLabel.hidden = false;
    } else {
      bestLabel.hidden = true;
    }
  }
  screen.hidden = false;
  // ボタン類はゲームが始まるまで押させない。
  $('#pause-button').disabled = true;
  $('#restart-button').disabled = true;
  try { screen.focus({ preventScroll: true }); } catch { /* 端末差は無視 */ }
}

function startGameFromScreen() {
  const screen = $('#start-screen');
  if (!screen || screen.hidden) return;
  screen.hidden = true;
  $('#pause-button').disabled = false;
  $('#restart-button').disabled = false;
  beginRewardRun();
  // ここで初めて操作を受け付ける。
  ready = true;
  syncHUD();
  // 盤面を触れるようにしておく(PCのキーボード操作のため)。
  try { canvas.focus({ preventScroll: true }); } catch { /* 端末差は無視 */ }
}

async function initialize() {
  syncSound(); $('#best').textContent = number(best); resize();
  try {
    if (!window.Matter?.Engine) throw new Error('Physics unavailable');
    atlas.src = './assets/mochi-atlas.png'; await atlas.decode(); prepareSprites();
    $('#stage-count').textContent = `${STAGES.length}種類`;
    const finalStage = STAGES.at(-1);
    $('#final-merge-rule').textContent = `${finalStage.name}2個は消えて、${number(finalStage.points)}点以上のボーナスになります。`;
    for (let level = 0; level < STAGES.length; level++) {
      const stage = STAGES[level], item = document.createElement('li');
      const icon = document.createElement('canvas'); icon.width = 144; icon.height = 144; icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'stage-name'; label.textContent = stage.short;
      const numberLabel = document.createElement('span'); numberLabel.className = 'stage-number'; numberLabel.textContent = String(level + 1); numberLabel.setAttribute('aria-hidden', 'true');
      item.setAttribute('aria-label', `${level + 1}段階目：${stage.name}`);
      label.append(numberLabel); item.append(icon, label); $('#evolution').append(item); drawIcon(icon, level, 0.28 + level / (STAGES.length - 1) * 0.12);
    }
    for (const icon of document.querySelectorAll('[data-mochi]')) drawIcon(icon, Number(icon.dataset.mochi), 0.42);
    drawIcon($('#brand-mochi'), 3, 0.44);
    game = new MochiPhysics(window.Matter, { onEvent: handleEvent });
    $('#loading').hidden = true; $('#play-area').setAttribute('aria-busy', 'false');
    // 準備できたら、まずスタート画面を出す。
    // ready は押されるまで false のままなので、入力・物理・落下は動かない
    // (既存の各ハンドラが !ready で必ず抜ける作りをそのまま利用している)。
    showStartScreen();
    lineReady = initializeLine();
    syncHUD(); render(); requestAnimationFrame(frame);
  } catch (error) {
    $('#loading').hidden = true; $('#load-error').hidden = false; $('#play-area').setAttribute('aria-busy', 'false');
    $('#pause-button').disabled = true; console.error('The mochi game could not initialize.', error);
  }
}

void initialize();
