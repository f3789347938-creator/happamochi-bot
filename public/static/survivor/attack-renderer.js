import {bottlePose,weaponPose} from './motion.js';
const TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

function flame(c,x,y,width,height,phase,alpha=1){
 const bend=Math.sin(phase)*width*.4;
 c.save();c.translate(x,y);c.globalAlpha*=alpha;
 for(const [scale,color] of [[1,'#ee5929'],[.72,'#ffba49'],[.38,'#fff1af']]){
  c.fillStyle=color;c.beginPath();c.moveTo(-width*scale,0);
  c.bezierCurveTo(-width*scale*1.15,-height*.32,bend-width*.4,-height*.65,bend*scale,-height*scale);
  c.bezierCurveTo(bend+width*scale*.3,-height*.44,width*scale*1.2,-height*.22,width*scale,0);
  c.quadraticCurveTo(0,width*.5,-width*scale,0);c.fill();
 }c.restore();
}

export function drawBottleShadow(r,s){
 const pose=bottlePose(s),c=r.c;c.save();c.translate(pose.x,pose.y+3);c.scale(1,.4);c.globalAlpha=.28-pose.height*.0018;
 r.circle(0,0,9+pose.height*.035,'#102b2a');c.restore();
}

export function drawBottle(r,g,s){
 const pose=bottlePose(s),c=r.c;if(!r.visible(pose.x,pose.y-pose.height,45))return;
 const scale=clamp(s.r/7,.95,1.7);c.save();c.translate(pose.x,pose.y-pose.height);c.rotate(r.reduced?s.angle:pose.rotation);c.scale(scale,scale);
 if(s.zone?.kind==='em'){
  r.circle(0,0,10,'#455f64','#c0dcd9',2);c.fillStyle='#80c8dc';c.fillRect(-7,-3,14,5);c.fillStyle='#b0c1c0';c.fillRect(-5,-14,10,6);c.strokeStyle='#e8f5df';c.lineWidth=2;c.beginPath();c.moveTo(-2,-15);c.lineTo(8,-12);c.lineTo(11,-2);c.stroke();c.restore();return;
 }
 // A broad body, narrow glass neck, fuel line and specular edge remain legible on phones.
 c.lineWidth=1.8;c.strokeStyle='#dcffe2';c.fillStyle='#427859';
 c.beginPath();c.moveTo(-4,-15);c.lineTo(4,-15);c.lineTo(4,-8);c.quadraticCurveTo(8,-5,8,-2);c.lineTo(8,12);c.quadraticCurveTo(0,16,-8,12);c.lineTo(-8,-2);c.quadraticCurveTo(-8,-5,-4,-8);c.closePath();c.fill();c.stroke();
 c.fillStyle='#b98732';c.fillRect(-5,2,10,9);c.fillStyle='#e7c68a';c.fillRect(-8,-1,16,5);
 c.strokeStyle='#edfff8';c.globalAlpha=.82;c.lineWidth=2;c.beginPath();c.moveTo(-4,-5);c.lineTo(-4,10);c.stroke();c.globalAlpha=1;
 c.strokeStyle='#e2c8a0';c.lineWidth=3;c.beginPath();c.moveTo(0,-15);c.quadraticCurveTo(5,-19,1,-23);c.stroke();
 flame(c,1,-22,4,12,r.reduced?0:g.time*24+s.id,.95);c.restore();
}

export function drawFireZone(r,g,z){
 const c=r.c,age=Math.max(0,z.maxLife-z.life),spread=.18+.82*clamp(age/.2,0,1),fade=clamp(z.life/.65,0,1),radius=z.r*spread;
 c.save();c.globalAlpha=.24*fade;r.circle(z.x,z.y,z.r,'#492817');
 c.globalAlpha=.24*fade;r.circle(z.x,z.y,radius,'#f87a23');
 c.globalAlpha=.3*fade;r.circle(z.x,z.y,z.r,null,'#e5a95f',1.5);
 if(!r.reduced){c.globalAlpha=1;r.glow(z.x,z.y,radius*1.18,'#ff8b38',fade*.18);}
 // Irregular pools, flame tongues and rising embers use time/zone ID, never combat RNG.
 const count=r.reduced?6:10;
 for(let i=0;i<count;i++){
  const angle=i*2.39996+z.id,ring=i===0?0:Math.sqrt(i/count)*.83;
  const x=z.x+Math.cos(angle)*radius*ring,y=z.y+Math.sin(angle)*radius*ring,phase=r.reduced?i:g.time*(8+i%3)+i*1.9;
  const height=(16+z.r*.16)*(r.reduced?1:1+Math.sin(phase)*.16)*spread;
  c.globalAlpha=fade*.82;flame(c,x,y,(5+z.r*.035)*spread,height,phase);
 }
 if(!r.reduced){
  for(let i=0;i<5;i++){
   const t=(g.time*.7+i*.217+z.id*.13)%1,a=i*2.4+z.id,x=z.x+Math.cos(a)*radius*.65+t*10,y=z.y+Math.sin(a)*radius*.65;
   c.globalAlpha=(1-t)*fade*.12;r.circle(x,y-18-t*45,5+t*11,'#a99887');
   c.globalAlpha=(1-t)*fade*.75;r.circle(x-5,y-8-t*42,1.3,'#ffd491');
  }
 }c.restore();
}

export function drawGlass(r,g){
 const c=r.c;c.save();for(const f of g.effects.glass){if(!r.visible(f.x,f.y,55))continue;
  c.save();c.translate(f.x,f.y-(r.reduced?0:f.height));c.rotate(r.reduced?0:f.angle);c.globalAlpha=Math.min(1,f.life*3)*(r.reduced?.45:.85);
  c.fillStyle='#8ccba8';c.strokeStyle='#e6ffdf';c.lineWidth=1;c.beginPath();c.moveTo(-f.size,0);c.lineTo(f.size*.5,-f.size*.65);c.lineTo(f.size*.8,f.size*.5);c.closePath();c.fill();c.stroke();c.restore();
 }c.restore();
}

export function drawHeldWeapon(r,g){
 const c=r.c,p=g.player,pose=weaponPose(g),id=pose.id;
 if(!['kunai','bat','katana','lightchaser','sword','shotgun','revolver','void','twinLance'].includes(id))return;
 c.save();c.translate(p.x,p.y-6);c.rotate(r.reduced?g.attackAim:pose.angle);c.translate(r.reduced?26:pose.reach,7);
 c.lineJoin='round';c.lineCap='round';c.lineWidth=2;c.strokeStyle='#16312f';
 if(id==='shotgun'||id==='revolver'||id==='void'){
  const long=id!=='revolver',length=long?27:19;c.fillStyle=id==='void'?'#6c5895':'#47616a';
  c.fillRect(-9,-6,length,11);c.strokeRect(-9,-6,length,11);c.fillStyle='#beced1';c.fillRect(length-10,-4,12,5);c.fillStyle='#172e34';c.fillRect(length,-4,3,5);
  c.fillStyle='#9b7955';c.fillRect(-8,4,7,11);c.fillStyle='#edf6e2';c.fillRect(-6,-5,length-10,2);
  if(id==='revolver'){c.fillStyle='#a7b2af';c.fillRect(-4,-3,7,7);}else{c.fillStyle='#2b4145';c.fillRect(3,3,10,4);}
 }else if(id==='bat'){
  c.fillStyle='#b77a42';c.beginPath();c.moveTo(-8,-3);c.lineTo(4,-4);c.quadraticCurveTo(16,-8,31,-7);c.quadraticCurveTo(40,0,31,7);c.quadraticCurveTo(16,8,4,4);c.lineTo(-8,3);c.closePath();c.fill();c.stroke();
  c.strokeStyle='#f4d5a1';c.lineWidth=2;c.beginPath();c.moveTo(8,-3);c.lineTo(30,-4);c.stroke();
  c.strokeStyle='#5d4734';for(let x=-6;x<3;x+=3){c.beginPath();c.moveTo(x,-3);c.lineTo(x+1,3);c.stroke();}
 }else{
  const length=id==='kunai'?23:45,color=id==='lightchaser'?'#ffe69b':id==='sword'?'#d2b8f5':'#dceee8';
  c.fillStyle=color;c.beginPath();c.moveTo(2,-5);c.lineTo(length,0);c.lineTo(2,5);c.closePath();c.fill();c.stroke();
  c.strokeStyle='#ffffff';c.lineWidth=1.4;c.beginPath();c.moveTo(3,-3);c.lineTo(length-2,0);c.stroke();
  c.strokeStyle='#d0ac66';c.lineWidth=4;c.beginPath();c.moveTo(1,-8);c.lineTo(1,8);c.stroke();c.strokeStyle='#4c4c55';c.lineWidth=6;c.beginPath();c.moveTo(-9,0);c.lineTo(0,0);c.stroke();
 }
 // The gripping hand follows recoil/swing while the feet stay at the real hitbox.
 r.circle(-8,7,6,'#fff5e0','#694d41',1.5);c.restore();
}
export function drawThrowArm(r,g){
 const c=r.c,p=g.player,throwing=g.motion.throw,cd=g.cooldowns.fire??1,wind=!throwing&&g.lv('fire')&&cd>0&&cd<.14?1-cd/.14:0;
 if(throwing||wind){const t=throwing?1-throwing.life/throwing.maxLife:0,angle=(throwing?.angle??g.time*.2)-(r.reduced?0:wind*.7),reach=r.reduced?24:24+Math.sin(t*Math.PI)*15-wind*10;
  c.save();c.translate(p.x,p.y-19);c.rotate(angle);c.strokeStyle='#fff2df';c.lineWidth=7;c.lineCap='round';c.beginPath();c.moveTo(12,4);c.lineTo(reach,0);c.stroke();r.circle(reach,0,6,'#fff5e0','#694d41',1.5);c.restore();
  if(wind)drawBottle(r,g,{originX:p.x+Math.cos(angle)*reach,originY:p.y+Math.sin(angle)*reach,targetX:p.x,targetY:p.y,age:0,maxLife:1,angle,id:0,r:7});
 }
}
