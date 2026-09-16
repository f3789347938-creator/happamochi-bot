import {bottlePose} from './motion.js';
const TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function drawGhosts(r,g){
 const c=r.c;for(const f of g.effects.ghosts){if(!r.visible(f.x,f.y,120))continue;const t=1-f.life/f.maxLife,size=f.size??58,index=f.sprite??({imp:1,orange:2,ice:5,elite:1,boss:3}[f.kind]||1);c.save();c.translate(r.reduced?f.originX:f.x,r.reduced?f.originY:f.y);if(!r.reduced)c.rotate(f.angle);const scale=r.reduced?1:1+.28*Math.sin(t*Math.PI)-.7*t;c.scale(scale,scale);r.sprite(index,0,0,size,1,(1-t)*.8,r.reduced?1:1-t*.4);c.restore();}
}
export function drawTrails(r,g){
 const c=r.c;c.save();c.globalCompositeOperation='lighter';c.lineCap='round';c.lineJoin='round';let glows=0;
 for(const s of g.shots){
  if(!r.visible(s.x,s.y,s.r+90)||s.trail.length<2)continue;const color=s.color||'#fff0b0',width=clamp(s.r*.85,4,22);
  const bottle=s.kind==='bottle',pose=bottle?bottlePose(s):null,trail=r.reduced?s.trail.slice(-2):s.trail;c.beginPath();c.moveTo(trail[0].x,trail[0].y-(trail[0].height||0));for(let i=1;i<trail.length;i++)c.lineTo(trail[i].x,trail[i].y-(trail[i].height||0));c.lineTo(s.x,s.y-(pose?.height||0));
  c.strokeStyle=color;c.globalAlpha=r.reduced?.18:.2;c.lineWidth=width*2.2;c.stroke();c.globalAlpha=.68;c.lineWidth=width*.55;c.stroke();c.globalAlpha=.8;c.strokeStyle='#f4fff0';c.lineWidth=Math.max(1,width*.16);c.stroke();
  if(!r.reduced&&glows++<72){c.globalAlpha=1;r.glow(s.x,s.y-(pose?.height||0),Math.min(40,s.r*2.6),color,.4);}
 }
 c.restore();
}
// Layered outlines keep the interiors of damage areas clear for enemy movement.
export function drawAttackShapes(r,g){
 const c=r.c;c.save();c.lineCap='round';c.lineJoin='round';c.globalCompositeOperation='lighter';
 for(const l of g.lasers){
  if(!r.visible(l.x,l.y,l.length))continue;const alpha=clamp(l.life*3,0,1),color=l.color||'#83f7df';c.beginPath();
  if(l.kind==='inward')c.arc(l.x,l.y,Math.max(0,l.radius),0,TAU);
  else{const dx=Math.cos(l.angle)*l.length,dy=Math.sin(l.angle)*l.length;c.moveTo(l.x-dx,l.y-dy);c.lineTo(l.x+dx,l.y+dy);}
  c.strokeStyle=color;c.globalAlpha=alpha*.18;c.lineWidth=l.width+22;c.stroke();c.globalAlpha=alpha*.75;c.lineWidth=l.width;c.stroke();c.strokeStyle='#f5ffff';c.globalAlpha=alpha*.95;c.lineWidth=Math.max(2,l.width*.26);c.stroke();
  if(!r.reduced&&l.kind!=='inward'){
   c.save();c.translate(l.x,l.y);c.rotate(l.angle);c.strokeStyle='#e9fff9';c.lineWidth=2;c.globalAlpha=alpha*.75;
   for(let i=0;i<5;i++){const x=((g.time*430+i*l.length*.4)%(l.length*2))-l.length;c.beginPath();c.moveTo(x-13,-l.width*.5-5);c.lineTo(x,0);c.lineTo(x-13,l.width*.5+5);c.stroke();}c.restore();
  }
  if(!r.reduced&&l.kind==='inward'){c.globalAlpha=alpha*.65;c.lineWidth=2;for(let i=0;i<4;i++){const a=g.time*2+i*TAU/4;c.beginPath();c.arc(l.x,l.y,Math.max(0,l.radius-7),a,a+.28);c.stroke();}}
 }
 for(const s of g.slashes){
  if(!r.visible(s.x,s.y,s.r+20))continue;const t=clamp(1-s.life/s.maxLife,0,1),fade=(1-t)**.65,start=s.angle-s.halfAngle,span=s.halfAngle*2,head=r.reduced?start+span:start+span*Math.min(1,.16+t*2.8),tail=r.reduced?start:Math.max(start,head-span*.7),radius=s.r*(r.reduced?1:.91+.09*t),inner=radius*.73;
  c.fillStyle=s.color;c.globalAlpha=fade*.38;c.beginPath();c.arc(s.x,s.y,radius,tail,head);c.arc(s.x,s.y,inner,head,tail,true);c.closePath();c.fill();
  c.strokeStyle=s.color;c.globalAlpha=fade*.3;c.lineWidth=15;c.beginPath();c.arc(s.x,s.y,radius,tail,head);c.stroke();c.globalAlpha=fade*.95;c.lineWidth=5;c.stroke();
  c.strokeStyle='#fffce9';c.lineWidth=3;c.beginPath();c.arc(s.x,s.y,radius,Math.max(tail,head-span*.28),head);c.stroke();c.globalAlpha=fade*.55;c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,radius*.82,tail,head);c.stroke();
  if(!r.reduced){
   for(let i=1;i<=3;i++){const rr=radius*(1-i*.075);c.strokeStyle=i===1?'#fffce9':s.color;c.globalAlpha=fade*(.45-i*.08);c.lineWidth=5-i;c.beginPath();c.arc(s.x,s.y,rr,Math.max(start,tail-i*.12),Math.max(start,head-i*.1));c.stroke();}
   const x=s.x+Math.cos(head)*radius,y=s.y+Math.sin(head)*radius;c.save();c.translate(x,y);c.rotate(head+Math.PI/2);c.globalAlpha=fade;c.fillStyle='#fffdeb';c.beginPath();c.moveTo(-23,0);c.lineTo(0,-4);c.lineTo(16,0);c.lineTo(0,4);c.closePath();c.fill();c.restore();
  }
  if(!r.reduced&&t<.5){c.globalAlpha=1;r.glow(s.x+Math.cos(head)*radius,s.y+Math.sin(head)*radius,26,s.color,fade*.55);}
 }
 for(const b of g.beams){
  const dx=b.tx-b.x,dy=b.ty-b.y,len=Math.hypot(dx,dy)||1;if(!r.visible((b.x+b.tx)/2,(b.y+b.ty)/2,len*.5+40))continue;
  const fade=clamp(b.life/b.maxLife,0,1),nx=-dy/len,ny=dx/len,steps=clamp(Math.ceil(len/32),4,16),color=b.gold?'#ffe06f':'#83f7df';c.beginPath();c.moveTo(b.x,b.y);
  for(let i=1;i<steps;i++){const t=i/steps,jolt=(i%2?1:-1)*(r.reduced?4:9+Math.sin(i*2.7+b.tx)*5);c.lineTo(b.x+dx*t+nx*jolt,b.y+dy*t+ny*jolt);}c.lineTo(b.tx,b.ty);
  c.strokeStyle=color;c.globalAlpha=fade*.2;c.lineWidth=21;c.stroke();c.globalAlpha=fade*.85;c.lineWidth=7;c.stroke();c.strokeStyle='#ffffef';c.lineWidth=2.8;c.globalAlpha=fade;c.stroke();
  if(!r.reduced){c.strokeStyle=color;c.globalAlpha=fade*.65;c.lineWidth=2;for(let i=1;i<=2;i++){const t=i*.28,x=b.x+dx*t,y=b.y+dy*t,side=i%2?1:-1;c.beginPath();c.moveTo(x,y);c.lineTo(x+dx*.045+nx*18*side,y+dy*.045+ny*18*side);c.lineTo(x+dx*.12+nx*27*side,y+dy*.12+ny*27*side);c.stroke();}}
  c.globalAlpha=1;r.glow(b.tx,b.ty,43,color,fade*.65);
 }
 c.restore();
}
export function drawImpacts(r,g){
 const c=r.c,fx=g.effects;c.save();c.globalCompositeOperation='lighter';c.lineCap='round';
 for(const f of fx.shockwaves){
  if(!r.visible(f.x,f.y,f.r))continue;const t=1-f.life/f.maxLife,fade=1-t,rad=f.r*(r.reduced?.85:.12+.88*(1-(1-t)**3));
  c.globalAlpha=fade*(r.reduced?.35:.7);r.circle(f.x,f.y,rad,null,f.color,Math.max(1,13*fade));c.globalAlpha=fade*.85;r.circle(f.x,f.y,rad*.96,null,'#fffce2',Math.max(1,3*fade));
  if(!r.reduced){c.globalAlpha=fade*.4;r.circle(f.x,f.y,rad*(.62+.2*t),null,f.color,4*fade+1);if(t<.22){c.globalAlpha=1;r.glow(f.x,f.y,Math.min(100,rad*.65),f.color,(.22-t)*2);}c.globalAlpha=fade*.6;c.strokeStyle=f.color;c.lineWidth=2;for(let i=0;i<8;i++){const a=i*TAU/8;c.beginPath();c.moveTo(f.x+Math.cos(a)*rad*.86,f.y+Math.sin(a)*rad*.86);c.lineTo(f.x+Math.cos(a)*(rad+14*fade),f.y+Math.sin(a)*(rad+14*fade));c.stroke();}}
 }
 for(const f of fx.muzzles){
  if(!r.visible(f.x,f.y,90))continue;const a=f.life/f.maxLife,size=f.r*(r.reduced?.8:.65+.35*a);c.save();c.translate(f.x,f.y);c.rotate(f.angle);c.globalAlpha=1;r.glow(0,0,size*1.4,f.color,a*.65);c.globalAlpha=a*.85;c.fillStyle=f.color;c.beginPath();c.moveTo(-10,0);c.lineTo(size*.35,-size*.3);c.lineTo(size,0);c.lineTo(size*.35,size*.3);c.closePath();c.fill();c.fillStyle='#fffdeb';c.beginPath();c.moveTo(-6,0);c.lineTo(size*.25,-size*.1);c.lineTo(size*.76,0);c.lineTo(size*.25,size*.1);c.closePath();c.fill();c.restore();
 }
 for(const f of fx.impacts){
  if(!r.visible(f.x,f.y,f.r*1.5))continue;const t=1-f.life/f.maxLife,fade=1-t,killed=f.kind==='kill',size=f.r*(r.reduced?.7:.4+.75*Math.sqrt(t));c.save();c.translate(f.x,f.y);c.rotate(f.angle);c.globalAlpha=1;r.glow(0,0,size*1.15,f.color,fade*.55);
  if(killed){c.globalAlpha=fade*.7;r.circle(0,0,size,null,f.color,Math.max(1,5*fade));if(!r.reduced){c.globalAlpha=fade*.4;r.circle(0,0,size*.72,null,'#ffffe2',1.5);}}
  c.globalAlpha=fade*.9;c.strokeStyle=f.color;c.lineWidth=(killed?4:3)*fade+1;const rays=r.reduced?4:killed?8:6;
  for(let i=0;i<rays;i++){const a=i/rays*TAU,stretch=i%2===0?1:.65;c.beginPath();c.moveTo(Math.cos(a)*size*.48,Math.sin(a)*size*.48);c.lineTo(Math.cos(a)*size*stretch,Math.sin(a)*size*stretch);c.stroke();}
  const core=r.reduced?size*.18:size*.5*Math.max(0,1-t*3.2);if(core>0){c.globalAlpha=r.reduced?fade*.6:fade;c.fillStyle='#fffef0';c.beginPath();c.moveTo(-core*1.4,0);c.lineTo(-core*.15,-core*.15);c.lineTo(0,-core);c.lineTo(core*.15,-core*.15);c.lineTo(core*1.4,0);c.lineTo(core*.15,core*.15);c.lineTo(0,core);c.lineTo(-core*.15,core*.15);c.closePath();c.fill();}c.restore();
 }
 if(!r.reduced)for(const f of fx.sparks){if(!r.visible(f.x,f.y,30))continue;const a=f.life/f.maxLife;c.globalAlpha=a;c.strokeStyle=f.color;c.lineWidth=f.size*(.5+a*.5);c.beginPath();c.moveTo(f.x,f.y);c.lineTo(f.x-f.vx*.04,f.y-f.vy*.04);c.stroke();if(a>.65){c.fillStyle='#fffce6';c.fillRect(f.x-1,f.y-1,2,2);}}
 c.restore();
}
export function drawScreenEffects(r,g){
 const c=r.c,fx=g.effects,w=r.width,h=r.height;c.save();c.setTransform(r.dpr,0,0,r.dpr,0,0);
 if(fx.pulse&&!r.reduced){const t=1-fx.pulse.life/fx.pulse.maxLife,edge=c.createRadialGradient(w/2,h/2,Math.min(w,h)*.28,w/2,h/2,Math.hypot(w,h)*.6);edge.addColorStop(0,'#00000000');edge.addColorStop(1,fx.pulse.color);c.globalAlpha=(1-t)*.3;c.fillStyle=edge;c.fillRect(0,0,w,h);c.globalAlpha=1;}
 if(fx.reward&&!fx.pulse){
  const f=fx.reward,t=1-f.life/f.maxLife,tier=f.tier||1,pop=r.reduced?1:1+Math.sin(Math.min(1,t*5)*Math.PI)*.2;c.save();c.translate(w/2,h*.23-Math.min(12,t*14));c.scale(pop,pop);c.globalAlpha=Math.min(1,f.life*3,t*12);c.textAlign='center';c.lineJoin='round';c.strokeStyle='#102b2e';c.lineWidth=6;
  const title=tier===3?'大連鎖！':tier===2?'一掃！':'';if(title){c.font='900 '+Math.min(28,w/14)+'px sans-serif';c.strokeText(title,0,-25);c.fillStyle=tier===3?'#a7ffdf':'#ffe28d';c.fillText(title,0,-25);}
  c.font='900 '+Math.min(24,w/16)+'px sans-serif';const label=f.kills+'体まとめて撃破！';c.strokeText(label,0,0);c.fillStyle='#fff3b5';c.fillText(label,0,0);c.font='900 18px sans-serif';c.strokeText('+'+f.points.toLocaleString('ja-JP')+' pt',0,26);c.fillStyle='#baffdf';c.fillText('+'+f.points.toLocaleString('ja-JP')+' pt',0,26);c.restore();
 }
 c.restore();
}
