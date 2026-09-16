const TAU=Math.PI*2;
export function drawEnemy(r,g,e){
 const c=r.c,big=e.kind==='boss',elite=e.kind==='elite',size=big?156:elite?94:e.r*2.7,index=e.sprite??1;
 if(e.spawnIn>0){c.save();c.globalAlpha=.6;r.circle(e.x,e.y,e.r+12,null,e.color||'#e5d7a0',2);c.strokeStyle=e.color||'#e5d7a0';c.lineWidth=3;for(let i=0;i<3;i++){const a=(r.reduced?0:g.time*1.7)+i*TAU/3;c.beginPath();c.arc(e.x,e.y,e.r+20,a,a+.75);c.stroke();}c.restore();r.sprite(index,e.x,e.y,size,1,Math.max(.08,1-e.spawnIn));return;}
 const tell=e.tell>0?Math.min(1,e.tell/(e.tellDuration||1.2)):0,wind=1-tell,fire=e.attackFlash||0,stride=g.time*(e.pattern==='hop'?10:7)+e.id,hop=r.reduced?0:-Math.abs(Math.sin(stride))*(big?1.5:3.5);
 c.save();c.translate(e.x,e.y+9);c.scale(1,.38);r.circle(0,0,e.r,'#102c3477');c.restore();
 if(e.tell>0){c.save();c.globalAlpha=.55;r.circle(e.x,e.y-9,e.r+9,null,'#ffbe86',2.5);c.lineWidth=3;c.strokeStyle='#fff0b6';c.beginPath();c.arc(e.x,e.y-9,e.r+14,-Math.PI/2,-Math.PI/2+TAU*wind);c.stroke();c.restore();}
 const sequenceDash=e.sequencing&&g.threats.find(t=>t.id===e.sequencing)?.paths.find(path=>path.dash&&path.active);
 if(!r.reduced&&sequenceDash){const a=sequenceDash.angle;for(let i=3;i>=1;i--)r.sprite(index,e.x-Math.cos(a)*i*19,e.y-Math.sin(a)*i*19,size,1,.1*(4-i),.9);}
 if(!r.reduced&&e.dash>0){const a=Math.atan2(e.dashY,e.dashX);for(let i=3;i>=1;i--)r.sprite(index,e.x-Math.cos(a)*i*18,e.y-Math.sin(a)*i*18,size,1,.09*(4-i),.9);}
 const hitTime=Number.isFinite(e.impactAt)?Math.max(0,g.time-e.impactAt)/.16:1,flinch=r.reduced||hitTime>=1?0:Math.sin(hitTime*Math.PI)*(1-hitTime)*(e.impactStrength||3),hitAngle=e.impactAngle||0;
 c.save();c.translate(e.x+Math.cos(hitAngle)*flinch,e.y+hop+Math.sin(hitAngle)*flinch);if(!r.reduced){c.rotate(e.tell>0?Math.sin(g.time*23)*.035*wind:e.dash>0?Math.sign(e.dashX)*.22:Math.sin(stride)*(big?.018:.05));c.scale(1+(e.tell>0?.15*wind:fire*.2),1-(e.tell>0?.16*wind:fire*.15));}
 r.sprite(index,0,0,size,e.x<g.player.x?1:-1,1,1+(r.reduced?0:Math.cos(stride*2)*.035),Math.max(0,(e.flash-.065)/.055));c.restore();
 if(elite||g.stageIndex>=3){c.save();c.globalAlpha=elite?.8:.45;r.circle(e.x,e.y+3,e.r+4,null,elite?'#ffdf8f':e.color,elite?2.5:1.5);c.restore();}
 if(e.boostUntil>g.time){c.save();c.strokeStyle='#b6ffd5';c.lineWidth=2;for(let i=0;i<2;i++){const y=e.y-e.r-15-i*7;c.beginPath();c.moveTo(e.x-5,y+4);c.lineTo(e.x,y);c.lineTo(e.x+5,y+4);c.stroke();}c.restore();}
 if(e.slow>0){c.save();c.globalAlpha=.18;r.circle(e.x,e.y-4,e.r+4,'#9eefff');c.restore();}
 if((elite||big)&&e.hp<e.maxHp){c.fillStyle='#152a35c9';c.fillRect(e.x-27,e.y-e.r-29,54,5);c.fillStyle='#ffd78d';c.fillRect(e.x-27,e.y-e.r-29,54*Math.max(0,e.hp/e.maxHp),5);}
}
// Always drawn above friendly effects. Red = danger; mint = enemy support.
export function drawThreats(r,g){
 const c=r.c;c.save();c.lineCap='round';c.lineJoin='round';
 for(const t of g.threats){
  if(t.done)continue;
  for(const path of t.paths){
   if(t.sequence&&path.finished)continue;const active=t.sequence?path.active:t.fired,progress=active?1:t.sequence?Math.min(1,t.age/path.fireAt):Math.max(0,1-t.delay/t.maxDelay),alpha=active?.9:.65;
   if(t.released&&t.delay>0&&path.shape==='circle'&&!r.reduced){const f=Math.max(0,Math.min(1,t.delay/(t.flightDuration||.6))),x=path.x+(t.releaseX-path.x)*f,y=path.y+(t.releaseY-path.y)*f-Math.sin(f*Math.PI)*135;c.save();c.strokeStyle='#ffb969';c.lineWidth=4;c.globalAlpha=.8;c.beginPath();c.moveTo(x-9,y-28);c.lineTo(x,y);c.stroke();r.circle(x,y,8,'#fff0bf','#ff8565',2);r.glow(x,y,25,'#ffae72',.65);c.restore();}
   const color=path.support?'#a9ffcc':'#ff846e';c.save();c.translate(path.x,path.y);
   if(path.shape==='circle'){
    if(!r.visible(path.x,path.y,path.r)){c.restore();continue;}c.globalAlpha=active?.24:.1;c.fillStyle=color;c.beginPath();c.arc(0,0,path.r,0,TAU);if(path.innerR){c.moveTo(path.innerR,0);c.arc(0,0,path.innerR,0,TAU,true);}c.fill('evenodd');
    c.globalAlpha=alpha;c.lineWidth=active?5:2;c.strokeStyle=color;c.stroke();c.strokeStyle='#fff0cf';c.lineWidth=3;c.beginPath();c.arc(0,0,path.r+4,-Math.PI/2,-Math.PI/2+TAU*progress);c.stroke();
    if(!path.support){c.strokeStyle='#ffe7d0';c.lineWidth=2;for(let i=0;i<4;i++){const a=i*TAU/4;c.beginPath();c.moveTo(Math.cos(a)*(path.r-14),Math.sin(a)*(path.r-14));c.lineTo(Math.cos(a)*(path.r-4),Math.sin(a)*(path.r-4));c.stroke();}}
    if(t.sequence){c.globalAlpha=.95;c.font='bold 17px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff4d7';c.fillText(String(path.order),0,path.innerR?-(path.r+path.innerR)/2:0);}
    if(active&&!r.reduced&&!path.innerR){c.globalAlpha=.55;r.circle(0,0,path.r*(1+.4*(t.sequence?Math.max(0,(t.age-path.fireAt)/path.duration):1-t.life/.24)),null,'#fff1bd',3);r.glow(0,0,path.r*.8,color,.5);}
   }else{
    c.rotate(path.angle);const width=path.width;c.globalAlpha=active?.22:.12;c.fillStyle=color;c.fillRect(0,-width,path.length,width*2);
    c.globalAlpha=alpha;c.strokeStyle=active?'#fff2cb':color;c.lineWidth=active?4:2;c.setLineDash(active?[]:[12,8]);c.strokeRect(0,-width,path.length,width*2);c.setLineDash([]);
    c.globalAlpha=active?.8:.65;c.lineWidth=active?Math.max(3,width*.65):1.5;c.beginPath();c.moveTo(0,0);c.lineTo(path.length*(active?1:progress),0);c.stroke();
    if(t.sequence){c.globalAlpha=.95;c.font='bold 17px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff4d7';c.fillText(String(path.order),Math.min(150,path.length/2),-width-14);}
    if(!active){c.globalAlpha=.85;for(let x=45;x<path.length;x+=90){c.beginPath();c.moveTo(x-7,-5);c.lineTo(x,0);c.lineTo(x-7,5);c.stroke();}}
   }c.restore();
  }
 }c.restore();
}
