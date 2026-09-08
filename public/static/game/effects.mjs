import { WORLD, STAGES, clamp } from './physics.mjs';

const palette = ['#ffcd45', '#ff6da7', '#45d9ff', '#ad86ff', '#71f0c0', '#ffffff'];
const font = '"Hiragino Maru Gothic ProN", Meiryo, sans-serif';

export class MochiEffects {
  constructor(context, { reducedMotion = false, drawMochi = () => {} } = {}) {
    this.ctx = context; this.reducedMotion = reducedMotion; this.drawMochi = drawMochi; this.reset();
  }

  reset() { this.items = []; this.banner = null; this.kick = null; }

  add(item) {
    this.items.push(item);
    while (this.items.length > 240) {
      const particle = this.items.findIndex(effect => effect.type === 'particle');
      this.items.splice(particle < 0 ? 0 : particle, 1);
    }
  }

  prune(now) { this.items = this.items.filter(item => now - item.born < item.life); }

  burst(x, y, now, color, strength = 1) {
    this.add({ type: 'halo', x, y, born: now, life: 540, color, radius: 65 + strength * 40 });
    if (this.reducedMotion) return;
    this.add({ type: 'ring', x, y, born: now, life: 640, color, radius: 65 + strength * 46 });
    const count = Math.min(76, Math.round(22 + strength * 15));
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + Math.random() * 0.2, speed = 0.065 + Math.random() * 0.07 + strength * 0.013;
      this.add({ type: 'particle', x, y, born: now, life: 600 + Math.random() * 420,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.035,
        color: i % 3 ? palette[i % palette.length] : color, size: 2.5 + Math.random() * 3.5,
        shape: i % 3, spin: (Math.random() - 0.5) * 0.015 });
    }
  }

  label(text, points, x, y, now, big = false, color = '#e9a321') {
    const labels = this.items.filter(item => item.type === 'label');
    if (labels.length >= 4) this.items = this.items.filter(item => item !== labels[0]);
    this.add({ type: 'label', text, points, x, y, born: now, life: 1100, big, color });
  }

  impact(now, force = 4) { if (!this.reducedMotion) this.kick = { born: now, life: 330, force: Math.min(force, 7) }; }

  camera(now) {
    if (!this.kick || this.reducedMotion) return { x: 0, y: 0 };
    const progress = clamp((now - this.kick.born) / this.kick.life, 0, 1), amplitude = this.kick.force * (1 - progress) ** 2;
    return { x: Math.sin(progress * 31) * amplitude, y: Math.sin(progress * 43) * amplitude * 0.55 };
  }

  showBanner(title, detail, color, now) { this.banner = { title, detail, color, born: now, life: 1050 }; }

  merge(event, now) {
    const strength = Math.min(4, 1 + event.level * 0.17 + (event.combo - 1) * 0.35);
    const color = event.final ? '#ffce3d' : event.combo > 1 ? '#ff70ac' : '#ffc947';
    this.burst(event.x, event.y, now, color, event.final ? 4 : strength);
    this.label(event.final ? 'もち祭り！' : event.combo > 1 ? `${event.combo}連鎖！` : '合体！', event.points, event.x, event.y, now, event.combo > 1 || event.final, color);
    this.impact(now, 2 + strength);
    if (event.final) this.showBanner('もち祭り！', `王様もちを合体！ +${event.points}`, '#ffd140', now);
    else if (event.combo >= 3) this.showBanner(`${event.combo}連鎖！`, `${STAGES[event.level + 1].name}に進化`, '#ff8fbf', now);
  }

  skill(event, now) {
    if (event.skill === 'roll') {
      this.showBanner('超合体！', `離れたもちを ${event.pairs}組 まとめて合体`, '#4ae4ff', now);
      this.impact(now, 4);
    } else if (event.skill === 'snack') {
      this.showBanner('もちボム！', `${event.victims.length}個まとめて消去`, '#ffc255', now);
      this.burst(event.x, event.y, now, '#ffad47', 4);
      this.impact(now, 7);
      for (const victim of event.victims) {
        this.add({ ...victim, type: 'vanish', born: now, life: 560,
          vx: (victim.x - event.x) * 0.0012, vy: -0.06 - Math.abs(victim.y - event.y) * 0.0004 });
      }
      this.label(`${event.victims.length}個消去！`, null, event.x, event.y, now, true, '#ea8726');
    } else if (event.skill === 'evolve') {
      this.showBanner('もち進化！', `${STAGES[event.fromLevel].short} → ${STAGES[event.level].short}`, '#b58aff', now);
      this.add({ type: 'beam', x: event.x, y: event.y, born: now, life: 800, color: '#b386ff' });
      this.burst(event.x, event.y, now, '#bd88ff', 2.5);
      this.label('進化！', event.points, event.x, event.y, now, true, '#9563cd');
      this.impact(now, 5);
    }
  }

  drawBack(now) {
    this.prune(now);
    const ctx = this.ctx;
    for (const item of this.items) {
      if (!['halo', 'beam'].includes(item.type)) continue;
      const progress = clamp((now - item.born) / item.life, 0, 1);
      ctx.save();
      if (item.type === 'halo') {
        const radius = item.radius * (this.reducedMotion ? 1 : 0.6 + progress * 0.8);
        const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, radius);
        glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.2, item.color); glow.addColorStop(1, item.color + '00');
        ctx.globalAlpha = (this.reducedMotion ? 0.18 : 0.65) * (1 - progress);
        ctx.fillStyle = glow; ctx.fillRect(item.x - radius, item.y - radius, radius * 2, radius * 2);
      } else {
        const gradient = ctx.createLinearGradient(0, 50, 0, item.y + 50);
        gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(0.65, item.color); gradient.addColorStop(1, '#ffffff00');
        ctx.globalAlpha = (this.reducedMotion ? 0.12 : 0.35) * (1 - progress);
        ctx.fillStyle = gradient; ctx.fillRect(item.x - 46, 50, 92, Math.max(1, item.y));
      }
      ctx.restore();
    }
  }

  drawFront(now) {
    const ctx = this.ctx;
    for (const item of this.items) {
      const age = now - item.born, progress = clamp(age / item.life, 0, 1);
      if (['halo', 'beam'].includes(item.type)) continue;
      ctx.save();
      if (item.type === 'ring') {
        ctx.globalAlpha = (1 - progress) ** 1.5; ctx.strokeStyle = item.color; ctx.lineWidth = 5 * (1 - progress) + 1;
        const radius = 8 + (1 - (1 - progress) ** 3) * item.radius;
        ctx.beginPath(); ctx.arc(item.x, item.y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(item.x, item.y, radius * 0.78, 0, Math.PI * 2); ctx.stroke();
      } else if (item.type === 'particle') {
        ctx.globalAlpha = Math.min(1, (1 - progress) * 2);
        ctx.translate(item.x + item.vx * age, item.y + item.vy * age + age * age * 0.000105);
        ctx.rotate(age * item.spin); ctx.fillStyle = item.color;
        if (item.shape === 0) { ctx.beginPath(); ctx.arc(0, 0, item.size, 0, Math.PI * 2); ctx.fill(); }
        else if (item.shape === 1) ctx.fillRect(-item.size, -item.size * 0.6, item.size * 2, item.size * 1.2);
        else {
          ctx.fillRect(-item.size * 1.5, -1, item.size * 3, 2); ctx.fillRect(-1, -item.size * 1.5, 2, item.size * 3);
        }
      } else if (item.type === 'vanish') {
        this.drawMochi(ctx, item.level, item.x + (this.reducedMotion ? 0 : item.vx * age), item.y + (this.reducedMotion ? 0 : item.vy * age),
          STAGES[item.level].radius * (this.reducedMotion ? 1 : 1 - progress * 0.85), item.angle + (this.reducedMotion ? 0 : progress * 0.6), 0, 1 - progress);
      } else if (item.type === 'label') {
        const size = item.big ? 34 : 27;
        const x = clamp(item.x, 110, WORLD.width - 110), y = clamp(item.y - 32 - (this.reducedMotion ? 0 : progress * 46), 155, WORLD.bottom - 40);
        const scale = this.reducedMotion ? 1 : 1 + Math.sin(Math.min(1, age / 220) * Math.PI) * 0.18;
        ctx.globalAlpha = Math.min(1, (1 - progress) * 3); ctx.translate(x, y); ctx.scale(scale, scale);
        ctx.font = `900 ${size}px ${font}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.strokeText(item.text, 0, 0);
        ctx.fillStyle = item.color; ctx.fillText(item.text, 0, 0);
        if (typeof item.points === 'number') {
          ctx.font = `850 21px system-ui, sans-serif`; ctx.lineWidth = 5;
          ctx.strokeText(`+${item.points}`, 0, 27); ctx.fillStyle = '#3a8992'; ctx.fillText(`+${item.points}`, 0, 27);
        }
      }
      ctx.restore();
    }
  }

  drawBanner(now) {
    if (!this.banner) return;
    const item = this.banner, age = now - item.born;
    if (age >= item.life) { this.banner = null; return; }
    const ctx = this.ctx, enter = clamp(age / 160, 0, 1), leave = clamp((age - 800) / 250, 0, 1);
    const x = this.reducedMotion ? 210 : 210 - (1 - enter) ** 3 * 400 + leave ** 2 * 400;
    ctx.save(); ctx.globalAlpha = this.reducedMotion ? Math.min(1, (item.life - age) / 200) : 1;
    ctx.translate(x, 191); if (!this.reducedMotion) ctx.rotate(-0.035);
    ctx.shadowColor = '#21456935'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#163752e8'; ctx.strokeStyle = item.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-140, -41); ctx.lineTo(140, -41); ctx.quadraticCurveTo(153, -41, 153, -28);
    ctx.lineTo(153, 29); ctx.quadraticCurveTo(153, 42, 140, 42); ctx.lineTo(-140, 42); ctx.quadraticCurveTo(-153, 42, -153, 29);
    ctx.lineTo(-153, -28); ctx.quadraticCurveTo(-153, -41, -140, -41); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowColor = 'transparent'; ctx.textAlign = 'center'; ctx.fillStyle = item.color; ctx.font = `900 34px ${font}`; ctx.fillText(item.title, 0, -3);
    ctx.fillStyle = '#ffffff'; ctx.font = `700 14px ${font}`; ctx.fillText(item.detail, 0, 24);
    ctx.restore();
  }
}
