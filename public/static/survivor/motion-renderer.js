import {auraFor} from './cosmetics.js';
import {OUTFITS} from './records.js';
import {drawHeldWeapon,drawThrowArm} from './attack-renderer.js';
import {weaponPose} from './motion.js';
const TAU=Math.PI*2;
export function drawDroneTrails(r,g,companions){
 if(r.reduced)return;const c=r.c;c.save();c.lineCap='round';
 for(const o of companions){if(!o.drone)continue;const reverse=o.direction<0;c.strokeStyle=o.color;c.lineWidth=2;c.globalAlpha=.22;c.beginPath();c.ellipse(o.anchorX,o.anchorY-24,o.radius,o.radius*.63,0,o.phase+(reverse?.38:-.38),o.phase,reverse);c.stroke();
  for(let i=1;i<=3;i++){const a=o.phase+(reverse?1:-1)*i*.12;c.globalAlpha=(4-i)*.1;r.circle(o.anchorX+Math.cos(a)*o.radius,o.anchorY-24+Math.sin(a)*o.radius*.63,3-i*.5,o.color);}
 }c.restore();
}
export function drawDrone(r,g,o){
 const c=r.c,size=o.size,fire=o.fire,breath=r.reduced?0:Math.sin(g.time*4+o.phase)*.022;
 c.save();c.translate(o.x,o.depth+7);c.scale(1,.35);r.circle(0,0,size*.34,'#0d322d65');c.restore();
 c.save();c.translate(o.x,o.y);if(!r.reduced){c.rotate(o.tilt);c.scale(1+fire*.08-breath*.4,1-fire*.1+breath);}
 // The rotating energy rotor is separate from the hovering character body.
 c.save();c.translate(0,-size*.49);c.scale(1,.36);if(!r.reduced)c.rotate(o.spin);c.lineWidth=3;c.strokeStyle=o.color;
 for(let i=0;i<2;i++){const a=i*Math.PI;c.globalAlpha=.7;c.beginPath();c.arc(0,0,size*.59,a,a+2.35);c.stroke();c.globalAlpha=.95;r.circle(Math.cos(a)*size*.59,Math.sin(a)*size*.59,3,'#f7ffe5');}c.restore();
 r.sprite(4,0,0,size);c.globalAlpha=.7;r.circle(0,-size*.08,size*.43,null,o.color,1.6);
 if(fire>0){c.globalAlpha=fire*(r.reduced?.35:.8);r.circle(0,-5,size*(.48+(1-fire)*.3),null,o.color,2+fire*2);c.globalAlpha=1;r.glow(0,-5,size*.6,o.color,fire*.42);}
 c.restore();
}
export function drawHero(r,g){
 const c=r.c,p=g.player,m=g.motion,move=r.reduced?0:m.move,phase=m.stride,hop=-Math.abs(Math.sin(phase))*5*move,sprite=(OUTFITS.find(o=>o.id===g.options.outfit)||OUTFITS[0]).sprite;
 const aura=auraFor(g.options.aura),strike=m.strike,sw=strike?1-strike.life/strike.maxLife:0,recoil=r.reduced?0:Math.sin((1-m.fire)*Math.PI)*m.fire*6,lunge=r.reduced||!strike?0:Math.sin(sw*Math.PI)*7;
 if(aura.style&&!r.reduced){c.save();c.strokeStyle=aura.color;c.lineWidth=aura.style>=4?3:2;for(const t of m.trail){c.globalAlpha=t.life/.45*.28;r.circle(t.x,t.y+8,(1-t.life/.45)*15+4,null,aura.color,2);}c.restore();}
 c.save();c.translate(p.x,p.y+10);c.scale(1,.4);r.circle(0,0,22+hop*.25,'#143e3678');c.restore();
 if(move>.1){c.save();for(let i=0;i<2;i++){const t=(phase/Math.PI+i*.5)%1;c.globalAlpha=(1-t)*move*.14;r.circle(p.x-m.lean*(12+t*15)+(i?4:-4),p.y+11-m.leanY*(12+t*15),3+t*4,'#d1ecc4');}c.restore();}
 c.save();c.translate(p.x,p.y+5);c.scale(1,.48);c.globalAlpha=.75;r.circle(0,0,33,null,aura.color,2.5);
 if(aura.style){c.strokeStyle=aura.color;for(let i=0;i<2+aura.style;i++){const a=(r.reduced?0:g.time*.8)+i*TAU/(2+aura.style);c.lineWidth=2;c.beginPath();c.arc(0,0,39+aura.style,a,a+.3);c.stroke();if(aura.style>=3)r.circle(Math.cos(a)*47,Math.sin(a)*47,2.5,aura.color);}}c.restore();
 if(g.heroState.shield>0){r.circle(p.x,p.y,39,null,'#a9ddff',3);r.glow(p.x,p.y,55,'#a9ddff',.25);}
 const breath=r.reduced?0:Math.sin(g.time*2.4)*.025*(1-m.move),squash=breath+Math.cos(phase*2)*move*.07-(r.reduced?0:m.fire*.06);
 const wind=weaponPose(g).wind,attackAngle=strike?.angle??g.attackAim,offset=lunge-recoil-(r.reduced?0:wind*3);
 if(strike&&!r.reduced&&sw<.65){for(let i=2;i>=1;i--)r.sprite(sprite,p.x-Math.cos(attackAngle)*i*10,p.y-Math.sin(attackAngle)*i*10,75,g.facing,.12*(1-sw),1);}
 c.save();c.translate(p.x+Math.cos(attackAngle)*offset,p.y+Math.sin(attackAngle)*offset+hop+(r.reduced?0:Math.sin(g.time*2.4)*1.5*(1-m.move)));if(!r.reduced)c.rotate(m.lean*.12+Math.sin(phase)*move*.035+(strike?Math.sin(sw*TAU)*.2:Math.sin(g.attackAim)*recoil*.012));c.scale(1-squash*.5,1+squash);
 r.sprite(sprite,0,0,75,g.facing,p.invincible>0&&Math.floor(g.time*16)%2?.4:1);c.restore();
 drawHeldWeapon(r,g);drawThrowArm(r,g);
 c.save();c.translate(p.x,p.y);c.rotate(g.attackAim);c.strokeStyle='#fbffd4cc';c.lineWidth=2.5;c.beginPath();c.moveTo(38,-5);c.lineTo(44,0);c.lineTo(38,5);c.stroke();c.restore();
}
export function drawCompanion(r,g,o,type){
 const c=r.c,move=r.reduced?0:g.motion.move,phase=g.motion.stride+(o.id==='clone'?.8:1.7),hop=-Math.abs(Math.sin(phase))*move*3;
 c.save();c.translate(o.x,o.y+hop);if(!r.reduced)c.rotate(type==='orbit'?Math.sin(g.time*2.6)*.14:g.motion.lean*.1);
 r.sprite(o.id==='clone'?0:4,0,0,type==='orbit'?38:o.id==='bear'?80:65,1,1,1+Math.cos(phase*2)*move*.04);c.restore();
}
