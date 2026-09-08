import { STAGES, SKILL_RULES } from './physics.mjs';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const number = value => value.toLocaleString('ja-JP');

export function snapshotResult(game, best, bestAtStart) {
  const highest = Number.isInteger(game.highest) && STAGES[game.highest] ? game.highest : 0;
  return Object.freeze({ score: count(game.score), highest, merges: count(game.merges),
    skillUses: Math.min(count(game.skillUses), SKILL_RULES.maxUsesPerGame),
    best: Math.max(count(best), count(game.score)), isNewBest: count(game.score) > count(bestAtStart) });
}

export function publicShareUrl(configuredUrl = '') {
  // Only an explicitly configured public launch URL may leave the game.
  // Never use location.href: LIFF redirects may contain login credentials.
  try {
    if (!configuredUrl.trim()) return '';
    const url = new URL(configuredUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function resultText(result, configuredUrl = '') {
  const stage = STAGES[result.highest];
  const lines = ['もち合体パズル', `スコア：${number(result.score)}点`,
    `到達：${stage.name}（${result.highest + 1}/${STAGES.length}）`,
    `合体：${number(result.merges)}回`, `スキル：${result.skillUses}/${SKILL_RULES.maxUsesPerGame}回`];
  const url = publicShareUrl(configuredUrl);
  if (url) lines.push('', 'あなたも挑戦してみてね！', url);
  return lines.join('\n');
}

export function lineShareUrl(text) { return `https://line.me/R/share?text=${encodeURIComponent(text)}`; }

export function canShareImage(navigator, file) {
  try { return Boolean(file && navigator?.share && navigator?.canShare?.({ files: [file] })); }
  catch { return false; }
}

export async function shareResultImage(navigator, file) {
  if (!canShareImage(navigator, file)) return 'unavailable';
  try {
    // Called directly from the player's click; the file is prepared beforehand.
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

function roundedBox(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath(); ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

export function drawResultCard(canvas, result, drawMochi) {
  const ctx = canvas.getContext('2d');
  canvas.width = 960; canvas.height = 1040;
  const font = '"Hiragino Maru Gothic ProN", Meiryo, sans-serif';
  const background = ctx.createLinearGradient(0, 0, 960, 1040);
  background.addColorStop(0, '#dff7ff'); background.addColorStop(1, '#8bd2f4');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 960, 1040);
  roundedBox(ctx, 42, 42, 876, 956, 44, '#ffffffed');
  ctx.textAlign = 'center'; ctx.fillStyle = '#234259'; ctx.font = `800 52px ${font}`;
  ctx.fillText('もち合体パズル', 480, 139);
  ctx.font = `700 44px ${font}`; ctx.fillStyle = '#5c7e94';
  ctx.fillText(result.isNewBest ? 'ベスト更新！' : '今回のスコア', 480, 226);
  const score = number(result.score);
  let size = 164;
  do { ctx.font = `850 ${size}px system-ui, sans-serif`; if (ctx.measureText(score).width <= 734) break; size -= 4; } while (size > 44);
  ctx.fillStyle = '#1d536c'; ctx.fillText(score, 480, 388);
  roundedBox(ctx, 106, 428, 748, 384, 40, '#eaf8ff');
  drawMochi(ctx, result.highest, 480, 590, 146);
  ctx.font = `800 54px ${font}`; ctx.fillStyle = '#234259';
  ctx.fillText(STAGES[result.highest].name, 480, 773);
  ctx.font = `700 42px ${font}`; ctx.fillStyle = '#5c7e94';
  ctx.fillText(`合体 ${number(result.merges)}回`, 284, 895);
  ctx.fillText(`スキル ${result.skillUses}/${SKILL_RULES.maxUsesPerGame}回`, 678, 895);
  ctx.font = `650 40px ${font}`; ctx.fillStyle = '#63859a';
  ctx.fillText(`進化レベル ${result.highest + 1} / ${STAGES.length}`, 480, 960);
}
