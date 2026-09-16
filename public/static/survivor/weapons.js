import {countAt,damageAt} from './reference-rules.js';
import {castExclusive} from './hero-combat.js';
const TAU=Math.PI*2;
export function castWeapon(g,id){
 const p=g.player,l=Math.min(5,g.lv(id)),e=g.evolvedWeapon(id),target=g.nearest(p,700),aim=target?Math.atan2(target.y-p.y,target.x-p.x):g.aim,face=g.options.aimAssist?aim:g.aim;
 const grade=g.options.weaponGrade,excellent=grade!=='normal',legend=grade==='legendary',n=countAt(id,l),damage=damageAt(id,l,e);
 if(id===g.mainWeapon||['starforge','havoc','havocNova'].includes(id)){if(!target)return .12;if(id==='bat'&&!g.nearest(p,(e?225:145+l*12)*g.range()+60))return .12;g.attackAim=['kunai','sword','havocNova'].includes(id)?aim:face;if(id!=='revolver'){if(['shotgun','void'].includes(id))g.effects.fire(p.x,p.y,g.attackAim,['void','sword','katana','havoc'].includes(id)?'#ceb9ff':['shotgun','lightchaser','starforge'].includes(id)?'#ffe294':'#aefbe0',['void','shotgun'].includes(id));g.emit('shot',{weapon:id});if(['katana','lightchaser','sword','starforge','havoc','havocNova'].includes(id))g.motion.strike={angle:g.attackAim,life:.34,maxLife:.34,color:'#d8ccff'};}}
 const shot=(angle,dmg,options={})=>g.projectile({x:p.x,y:p.y,angle,damage:dmg,weapon:id,...options});
 const fan=(count,angle,spread,dmg,options={})=>{for(let i=0;i<count;i++)shot(angle+(i-(count-1)/2)*spread,dmg,options);};
 const persistent=(count,spec)=>{const live=g.shots.filter(s=>s.weapon===id&&s.persistent&&s.life>0);for(const s of live){const speed=spec.speed*(1+g.lv('projectile')*.1),ratio=speed/(s.speed||speed);s.vx*=ratio;s.vy*=ratio;Object.assign(s,spec,{r:spec.r*g.range(),speed});}for(let i=live.length;i<count;i++)shot(face+i*Math.PI,damage,{...spec,persistent:true,life:999999});};
 switch(id){
 case 'kunai':if(target)fan(e?2:1+Math.floor(l/3),aim,.09,12+l*4,{speed:e?610:480,pierce:e?99:0,kind:e?'needle':'kunai',r:e?4:6,splitBudget:legend?1:0,splitKind:'needle',color:'#bffff0'});return .575;
 case 'bat':g.slash(face,legend?Math.PI:1.8,e?225:145+l*12,23+l*9,{knock:230,bleed:excellent,life:.2,color:'#ffde98'});return .85;
 case 'katana':for(const a of [face,face+Math.PI])fan(e?3:1+Math.floor(l/3),a,.24,18+l*7,{kind:'slash',r:20+l*4,speed:380,pierce:99,life:1.15,knock:40,leech:legend,color:e?'#d1c3ff':'#dbf8df'});return 1;
 case 'shotgun':fan(e?9:3+2*Math.ceil(l/2),face,e?.035:.095,e?24:8+l*3,{speed:e?760:480,life:1.25,pierce:legend?99:0,r:5,color:'#ffe7a3'});return .9;
 case 'revolver':{
  const state=g.weaponStates[id]??={ammo:6};if(state.ammo<=0){state.ammo=6;return 1.2;}state.ammo--;g.effects.fire(p.x,p.y,face,'#ffe294',true);g.emit('shot',{weapon:id});
  for(const offset of e?[-10,10]:[0])g.projectile({x:p.x-Math.sin(face)*offset,y:p.y+Math.cos(face)*offset,angle:face,damage:32+l*17,speed:640,r:9,pierce:0,refund:excellent,impactBlast:legend?60:0,knock:90,color:'#ffd4b0',weapon:id});return .5;
 }
 case 'lightchaser':{
  const state=g.weaponStates[id]??={attacks:0};state.attacks++;fan(e?3:1+Math.floor(l/2),face,.27,19+l*7,{kind:'slash',r:28,speed:390,pierce:99,life:1.3,blocksBullets:true,color:'#fff1a3'});
  if(excellent&&state.attacks%(e?3:5)===0)for(let i=0;i<8;i++)shot(i/8*TAU,35+l*7,{kind:'slash',r:24,speed:340,pierce:99,life:.8,blocksBullets:true,color:'#fff1a3'});
  if(legend&&state.attacks%10===0)g.zone({x:p.x,y:p.y,r:180*g.range(),life:2*g.duration(),damage:48,kind:'swordArray'});return .95;
 }
 case 'void':shot(face,15+l*5,{speed:340,r:17,life:1.2,kind:'void',zone:{kind:'vortex',r:90+l*10,life:(e?5.5:3.4)*g.duration(),damage:6+l*3,pull:e?135:90,burst:excellent?70:0,veil:e,veilBurst:legend?95:0,blocksBullets:true},color:'#c9aaff'});return 2.6;
 case 'sword':fan(2+Math.floor(l/2),aim,.35,16+l*5,{speed:450,homing:true,pierce:e?4:1,life:2.3,kind:'blade',color:'#d3c4ff'});if(e&&target)g.meteor(target.x,target.y,118,115,.7);return 1.5;
 case 'starforge':case 'havocNova':{
  const state=g.weaponStates.starforge??={attacks:0};state.attacks++;fan(2,face,Math.PI,35+l*9,{kind:'return',r:27,speed:350,pierce:99,repeat:.4,life:2.2,knock:130,color:'#ffef97'});
  if(state.attacks%2===0){g.addOverload();}
  if(id==='havocNova')fan(4,aim,.13,100,{kind:'blade',r:18,speed:630,pierce:99,life:1.1,vulnerability:g.options.forgeV>=2?.2:.1,color:'#dabaff'});return 2.3;
 }
 case 'havoc':fan([1,2,3,3,4][l-1],face,.16,(42+l*12)*(g.options.forgeV>=2?1.8:1),{kind:'blade',r:18,speed:540,pierce:99,life:1.05+(l>=3?.25:0),vulnerability:g.options.forgeV>=2?.2:.1,color:'#d7b7ff'});return Math.max(.7,2-(g.options.forgeV>=4?1-p.hp/p.maxHp:0));
 case 'boomerang':fan(e?2:n,face,e?Math.PI:.6,damage,{speed:310,r:e?25:16,kind:e?'spiral':'return',life:(e?2.6:2)*g.duration(),pierce:99,repeat:.45,catchReset:g.tech('boomerang'),color:'#f2ebb1'});return 2.7;
 case 'brick':if(e){for(let i=0;i<8;i++)shot(i/8*TAU,damage,{kind:'brick',r:16,speed:320,pierce:99,life:2,knock:170});}else for(let i=0;i<n;i++)shot(-Math.PI/2+(i-(n-1)/2)*.19,damage,{kind:'brick',r:12,speed:370,gravity:420,pierce:g.tech('brick')?99:0,life:1.9,knock:90});return 2.4;
 case 'drill':if(e)persistent(g.tech('drill','red')?2:1,{damage,speed:580,pierce:99,homing:true,r:5,repeat:.65,kind:'needle',color:'#bdf8ff'});else fan(n,aim,.75,damage,{speed:690,pierce:99,bouncing:true,life:1.7*g.duration(),kind:'needle',r:5,color:'#bdf8ff'});return e?.5:2.1;
 case 'droneA':case 'droneB':case 'destroyer':{
  const fused=id==='destroyer',origin=g.drone(id),homing=g.tech('droneA')||g.tech('droneB');
  const state=g.weaponStates[id]??={angle:0};state.angle+=(id==='droneB'?-.43:.43);state.firedAt=g.time;const total=fused?14:2+l,droneAim=target?Math.atan2(target.y-origin.y,target.x-origin.x):aim;
  for(let i=0;i<total;i++)g.projectile({x:origin.x,y:origin.y,angle:homing?droneAim+(i-(total-1)/2)*.15:state.angle+i/total*TAU,damage:fused?60:damage,speed:id==='droneB'?270:365,homing,life:1.65,r:5,weapon:id,kind:'missile',color:id==='droneB'?'#c9ffb1':'#ffc6df'});return id==='droneB'?1.4:1;
 }
 case 'durian':persistent(1,{damage,speed:170,kind:'spiky',r:e?39:24+l*2,pierce:99,repeat:.4,bouncing:true,shards:e,nearPlayer:g.tech('durian'),knock:75,color:'#f9eba0'});return .5;
 case 'field':g.hitArea(p.x,p.y,(65+l*12)*g.range()*(e?1.25:1),damage,{slow:e?.52:0});return .35;
 case 'orbit':g.orbitUntil=g.time+(e?999999:3.2+l*.3)*g.duration();return e?10:6;
 case 'laser':{
  if(e)g.laser({x:p.x,y:p.y,angle:0,length:290*g.range(),radius:290*g.range(),width:12,life:2.3*g.duration(),damage,kind:'inward',spin:0,follow:true,slow:g.tech('laser')?.65:0,color:'#befbff'});
  else for(let i=0;i<1+Math.floor(l/2);i++)g.laser({x:p.x,y:p.y,angle:g.time*.8+i*Math.PI/(1+Math.floor(l/2)),length:(240+l*8)*g.range(),width:8,life:.85*g.duration(),damage,spin:0,follow:false,slow:g.tech('laser')?.65:0,color:'#83f7df'});return 2.6;
 }
 case 'lightning':{
  const excluded=new Set();for(let i=0;i<n;i++){const foe=g.nearest(i===0?p:{x:p.x+(g.rng()-.5)*350,y:p.y+(g.rng()-.5)*450},620,excluded);if(!foe)break;g.zap(foe,damage,0,excluded);if(e)g.zone({x:foe.x,y:foe.y,r:140*g.range(),life:.7,damage:damage*.6,kind:'shockwave',tick:0});}return 2.6;
 }
 case 'mine':case 'inferno':case 'thunderMine':for(let i=0;i<(id==='mine'?n:3);i++){const a=g.rng()*TAU,r=40+g.rng()*100;g.mine({x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r,r:(id==='mine'?78+l*10:165)*g.range(),damage:id==='mine'?damage:360,kind:id,life:18*g.duration()});}return 4.7;
 case 'fire':{
  const count=e?12:n,speed=e?220:180,flight=.62,reach=speed*(1+g.lv('projectile')*.1)*flight,first=g.time*.2;
  g.motion.throw={angle:first,life:.32,maxLife:.32};g.emit('throw',{weapon:id});
  for(let i=0;i<count;i++){
   const a=i/count*TAU+first;
   shot(a,0,{x:p.x+Math.cos(first)*24,y:p.y+Math.sin(first)*24,kind:'bottle',speed,life:flight,arcHeight:e?76:62,r:7,noCollision:true,
    targetX:p.x+Math.cos(a)*reach,targetY:p.y+Math.sin(a)*reach,
    zone:{r:e?80:38+l*5,life:(e?5.5:3.2)*g.duration(),damage,kind:'fire'},color:'#ffa65b'});
  }return 4.8;
 }
 case 'rocket':fan(e?1:n,aim,.3,damage,{speed:e?185:250,r:e?19:11,life:4,kind:'rocket',explosion:(e?175:75+l*9)*g.range(),color:'#ffdb95'});return 3.5;
 case 'ball':fan(n,g.time*.8,TAU/n,damage,{speed:e?670:450,kind:'ball',r:e?11:9,pierce:99,repeat:.12,life:3.1*g.duration(),bouncing:true,ricochet:true,splitBudget:e?1:0,color:'#b5efff'});return 3.2;
 default:return castExclusive(g,id);
 }
}
