import {BY_ID,EVOLUTIONS,MAIN_WEAPONS,equipped,evolvedBase,createChoices,eligibleEvolutions,evolutionInputs} from './abilities.js';
import {SpatialGrid} from './spatial.js';
import {castWeapon} from './weapons.js';
import {CombatEffects} from './effects.js';
import {normalizeOptions,HERO_BY_ID,attackSlots,allowedSkill} from './heroes.js';
import {initHero,updateHero,activateHero,heroPower,heroHit,heroHurt,manualInfo} from './hero-combat.js';
import {damageAt} from './reference-rules.js';
import {stageAt,spawnStats,pickSpecies,pickTrash,spawnTempo,canSpawn,updateEnemyAI,updateThreats,prepareArrival} from './enemies.js';
import {DRONES,initialMotion,updateMotion,dronePose,bottlePose} from './motion.js';
import {initEncounters,updateEncounters,encounterKill,acceptTrap} from './encounters.js';
import {KILL_EFFECTS} from './records.js';
export const WORLD={startX:0,startY:0,tile:768,viewWidth:650};
export const LIMITS={enemies:320,shots:300,particles:300,gems:500,hostile:160,zones:42,lasers:24,mines:36,loot:18,rings:64};
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const distance2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
export function segmentDistance2(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1);return (x-ax-dx*t)**2+(y-ay-dy*t)**2;}
export const RECOVERY_PICK_COOLDOWN=60;
export function xpNeeded(level){return 5+Math.floor(level*1.65+level*level*.085)+Math.floor(2*Math.max(0,level-30)**2+.4*Math.max(0,level-50)**3);}
export function seededRandom(seed=12345){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
export function formatTime(seconds){const n=Math.max(0,Math.floor(seconds));return Math.floor(n/60).toString().padStart(2,'0')+':'+(n%60).toString().padStart(2,'0');}
export class Game{
 constructor(rng=Math.random){this.rng=rng;this.grid=new SpatialGrid();this.viewport={width:650,height:900};this.reset();}
 reset(main='kunai',options={}){
  this.options=normalizeOptions(options);initHero(this);this.coins=0;this.souls=0;this.overloadStacks=0;this.overloadUntil=0;
  this.effects=new CombatEffects();this.motion=initialMotion();this.attackAim=-Math.PI/2;this.cosmeticRng=seededRandom(71);this.lastChainEffect=-10;
  this.mainWeapon=MAIN_WEAPONS.some(w=>w.id===main)?main:'kunai';this.mode='menu';this.time=0;this.baseHP=100+this.options.metaHP;this.player={x:0,y:0,r:17,hp:this.baseHP,maxHp:this.baseHP,invincible:0,contactGrace:0};this.aim=-Math.PI/2;this.facing=1;this.moving=false;
  this.level=1;this.xp=0;this.score=0;this.kills=0;this.bossKills=0;this.combo=0;this.maxCombo=0;this.comboTime=0;this.bonusScore=0;this.wave=1;this.reviveUsed=false;this.stageIndex=0;this.threats=[];this.nextThreatAt=0;this.recoveryBudget=3;this.recoveryAt=0;this.recoverReadyAt=0;this.lastAttackHurt=-10;this.lastContactHurt=-10;this.veilGuard=2;this.veilBreakUntil=0;
  this.levels=this.mainWeapon==='twinLance'?{starforge:this.options.forgeE>=1?3:1,havoc:this.options.forgeE>=1?3:1}:{[this.mainWeapon]:this.mainWeapon==='kunai'&&this.options.weaponGrade!=='normal'?2:1};const hero=HERO_BY_ID[this.options.hero];if(hero.replaceMain){this.mainWeapon=hero.skill;this.levels={[hero.skill]:1};}else if(hero.initial)this.levels[hero.skill]=this.options.heroStars>=6?3:1;if(this.options.hero==='venato'&&this.options.awakening>=1)this.levels.adrenaline=3;this.evolved=[];this.choices=[];this.choiceSource='level';this.pendingPicks=0;this.chestPicks=0;
  this.enemies=[];this.shots=[];this.hostile=[];this.gems=[];this.loot=[];this.zones=[];this.lasers=[];this.mines=[];this.meteors=[];this.particles=[];this.rings=[];this.numbers=[];this.beams=[];this.slashes=[];this.events=[];
  this.cooldowns={};this.weaponStates={};this.orbitUntil=0;this.spawnTimer=.25;this.bossTimer=120;this.eliteTimer=60;this.lootTimer=24;this.regenTimer=0;this.nextId=1;this.shake=0;this.lastLeech=-10;this.grid.clear();
  this.weaponStats={};this.attackSource=null;this.attackSequence=0;this.attackKills=new Map();this.maxAttackKills=0;this.cleanBosses=0;this.damageTaken=0;this.lastAttack=null;this.recordBeaten=false;this.lastCosmeticKill=-1;initEncounters(this);
 }
 start(main='kunai',options={}){this.reset(main,options);this.mode='playing';this.emit('start');}
 setViewport(width,height){this.viewport={width:Math.max(400,width),height:Math.max(420,height)};}
 emit(type,data={}){if(type==='shot')this.motion.fire=1;this.events.push({type,...data});}
 drainEvents(){return this.events.splice(0);}
 lv(id){return this.levels[id]||0;}
 evolvedWeapon(id){return evolvedBase(id,this.evolved);}
 has(id){return this.evolved.includes(id);}
 speed(){return 190*(1+this.lv('speed')*.1)*(this.options.hero==='worm'&&this.heroState.active>0?1.3:1);}
 slots(){return attackSlots(this.options);}
 tech(id,grade='purple'){return (this.options.tech.includes(id)||['droneA','droneB'].includes(id)&&this.options.tech.includes('drone'))&&(grade!=='red'||(this.options.techRanks?this.options.techRanks[id]>=2:this.options.techGrade==='red'));}
 manual(){return manualInfo(this);}
 activateHero(){return this.withAttack('hero-'+this.options.hero,()=>activateHero(this));}
 withAttack(weapon,fn,attackId){const prev=this.attackSource;this.attackSource={weapon,attackId:attackId??++this.attackSequence};try{return fn();}finally{this.attackSource=prev;}}
 openDangerChest(){return acceptTrap(this);}
 addOverload(){this.overloadStacks=Math.min(this.options.forgeE>=5?3:2,(this.overloadUntil>this.time?this.overloadStacks:0)+1);this.overloadUntil=this.time+10;this.float(this.player.x,this.player.y-50,'過負荷 ×'+this.overloadStacks,'#ffe987');}
 veilActive(){return this.time>=this.veilBreakUntil&&this.veilGuard>0;}
 blockCircle(x,y,r){for(const b of this.hostile)if(distance2(b,{x,y})<(r+b.r)**2)b.life=0;}
 power(){return (1+this.options.metaPower+this.lv('power')*.1+Math.min(.3,this.souls*.003)+(this.overloadUntil>this.time?this.overloadStacks*(this.options.forgeE>=3?.35:.3):0))*heroPower(this);}
 range(){return 1+this.lv('size')*.1;}
 duration(){return 1+this.lv('duration')*.1;}
 cooldown(){return 1-this.lv('cooldown')*.08;}
 magnetRadius(){return 88*(1+this.lv('magnet'));}
 pause(){if(this.mode==='playing'){this.mode='paused';this.emit('pause');}}
 resume(){if(this.mode==='paused')this.mode='playing';}
 canRevive(){return this.mode==='lost'&&this.player.hp<=0&&!this.reviveUsed;}
 revive(){
  if(!this.canRevive())return false;
  this.reviveUsed=true;const p=this.player;p.hp=p.maxHp*.5;p.invincible=3;p.reviveGrace=3;this.moving=false;
  // Clear incoming shots and open a little space without awarding kills or score.
  this.hostile=[];this.threats=[];this.nextThreatAt=this.time+2;
  for(const e of this.enemies){const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy),safe=135+e.r;if(e.dead||d>=safe)continue;const a=d?Math.atan2(dy,dx):e.id*2.399963;e.x=p.x+Math.cos(a)*safe;e.y=p.y+Math.sin(a)*safe;e.dash=0;e.tell=0;e.attacking=null;e.chargesLeft=0;e.continuation=false;e.knockX=0;e.knockY=0;e.attackIn=Math.max(1,e.attackIn);}
  this.grid.clear();this.events=this.events.filter(e=>e.type!=='result');this.mode='playing';
  this.effects.celebrate(p.x,p.y);this.ring(p.x,p.y,240,'#73f4cb',.9);this.burst(p.x,p.y,35,'#d1ffe9',200);this.shake=7;this.emit('revive');return true;
 }
 choose(id){
  if(this.mode!=='choice')return false;const c=this.choices.find(c=>c.id===id);if(!c)return false;
  if(c.kind==='evolution'){
   const e=eligibleEvolutions(this.levels,this.evolved,this.options).find(e=>e.id===id);if(!e)return false;
   if(e.fusion){for(const r of evolutionInputs(e,this.levels,this.evolved,this.options)){delete this.levels[r];delete this.cooldowns[r];}this.levels[e.id]=6;}
   this.evolved.push(e.id);this.effects.celebrate(this.player.x,this.player.y);this.ring(this.player.x,this.player.y,220,'#ffdf8a',.85);this.burst(this.player.x,this.player.y,30,'#ffe795',210);this.shake=8;this.emit('evolution',{id,name:e.name});
  }else if(c.kind==='supply'){
   if(id==='recover'){if(this.time<this.recoverReadyAt)return false;this.recoverReadyAt=this.time+RECOVERY_PICK_COOLDOWN;this.heal(this.player.maxHp*.12);}
   if(id==='coins')this.coins+=Math.round(12*(1+this.lv('fortune')*.08));
   if(id==='collect')this.collectAll();
  }else{
   const a=BY_ID[id];if(!a||!allowedSkill(a,this.options)||this.lv(id)>=5||(!this.lv(id)&&a.main)||(!this.lv(id)&&equipped(this.levels,a.group).length>=(a.group==='attack'?this.slots():6)))return false;
   this.levels[id]=this.lv(id)+1;
   if(id==='vitality'){const old=this.player.maxHp;this.player.maxHp=this.baseHP*(1+this.lv(id)*.2);this.heal(this.player.maxHp-old);}
   if(id==='magnet')for(const g of this.gems)if(distance2(g,this.player)<this.magnetRadius()**2)g.pulling=true;
   if(a.group==='attack')this.cooldowns[id]=Math.min(this.cooldowns[id]||0,.15);
   this.emit('ability',{id,name:a.name,level:this.lv(id)});
  }
  this.pendingPicks--;this.choices=[];this.mode='playing';
  if(this.pendingPicks>0)this.openChoice(this.choiceSource,this.pendingPicks);else this.checkLevel();return true;
 }
 openChoice(source='level',count=1){if(this.mode!=='playing')return;this.mode='choice';this.choiceSource=source;this.pendingPicks=count;this.choices=createChoices(this.levels,this.evolved,this.rng,{...this.options,recoverAvailable:this.time>=this.recoverReadyAt});this.emit('level',{level:this.level,source,picks:count});}
 checkLevel(){if(this.mode!=='playing')return;const need=xpNeeded(this.level);if(this.xp>=need){this.xp-=need;this.level++;this.openChoice();}}
 addXp(amount){this.xp+=amount*(1+this.lv('xp')*.08);}
 nearest(point,range=650,excluded=new Set()){
  let best=null,d=range*range;for(const e of this.enemies){if(e.dead||e.spawnIn>0||excluded.has(e.id))continue;const v=distance2(point,e);if(v<d){d=v;best=e;}}return best;
 }
 spawnPosition(){
  const p=this.player,w=this.viewport.width*.5+90,h=this.viewport.height*.5+100,side=Math.floor(this.rng()*4);
  return side<2?{x:p.x+(side===0?-w:w),y:p.y+(this.rng()*2-1)*h}:{x:p.x+(this.rng()*2-1)*w,y:p.y+(side===2?-h:h)};
 }
 portalPosition(radius){const p=this.player,w=Math.max(150,this.viewport.width*.5-radius-28),h=Math.max(160,this.viewport.height*.5-radius-48),side=Math.floor(this.rng()*4);return side<2?{x:p.x+(side===0?-w:w),y:p.y+(this.rng()*2-1)*h*.65}:{x:p.x+(this.rng()*2-1)*w*.65,y:p.y+(side===2?-h:h)};}
 spawnEnemy(kind='imp',position){
  if(this.enemies.filter(e=>!e.dead).length>=LIMITS.enemies)return null;
  const spec=spawnStats(kind,this.time),portal=this.time>=480&&['bomb','cross','snipe','boss'].includes(spec.pattern),loc=position||(portal?this.portalPosition(spec.r):this.spawnPosition());
  const e={...spec,...loc,portal,id:this.nextId++,hp:spec.hp,maxHp:spec.hp,spawnIn:portal?1.35:spec.kind==='boss'?1.3:.65,flash:0,slow:0,slowFactor:1,knockX:0,knockY:0,orbitHit:0,shootIn:3,attackIn:portal?.35:2.5+this.rng()*2,tellDuration:spec.tell||1.2,tell:0,dash:0,dashX:0,dashY:0,attackIndex:0};
  if(e.kind==='boss')e.damageAtSpawn=this.damageTaken;
  this.enemies.push(e);prepareArrival(this,e);return e;
 }
 updateSpawns(dt){
  const stage=stageAt(this.time);this.wave=1+Math.floor(this.time/30);
  if(stage.index!==this.stageIndex){this.stageIndex=stage.index;this.emit('stage',{stage});}
  this.spawnTimer-=dt;
  if(this.spawnTimer<=0){const tempo=spawnTempo(this.time);for(let i=0;i<tempo.burst;i++){if(this.enemies.length>=LIMITS.enemies-3)break;const species=pickSpecies(this);this.spawnEnemy(canSpawn(this,species)?species:pickTrash(this));}this.spawnTimer=tempo.interval;}
  this.eliteTimer-=dt;if(this.eliteTimer<=0){if(this.enemies.filter(e=>e.kind==='elite'&&!e.dead).length<2)this.spawnEnemy('elite');this.eliteTimer=50;}
  this.bossTimer-=dt;if(this.bossTimer<=0){if(!this.enemies.some(e=>e.kind==='boss'&&!e.dead)){const boss=this.spawnEnemy('boss');if(boss){this.emit('boss',{name:boss.name});this.bossTimer=120;}else this.bossTimer=1;}else this.bossTimer=5;}
  this.lootTimer-=dt;if(this.lootTimer<=0){const a=this.rng()*Math.PI*2;this.dropLoot(['heal','magnet','bomb'][Math.floor(this.rng()*3)],this.player.x+Math.cos(a)*260,this.player.y+Math.sin(a)*300);this.lootTimer=28+this.rng()*20;}
 }
 projectile(spec){
  if(this.shots.length>=LIMITS.shots)return null;const speed=(spec.speed||400)*(1+this.lv('projectile')*.1),life=spec.life||2.2;
  const s={id:this.nextId++,r:6,pierce:0,repeat:0,kind:'pearl',color:'#c0fff1',knock:0,...this.attackSource,...spec,vx:Math.cos(spec.angle)*speed,vy:Math.sin(spec.angle)*speed,speed,r:(spec.r||6)*this.range(),life,maxLife:life,age:0,originX:spec.x,originY:spec.y,px:spec.x,py:spec.y,hit:new Set(),hitAt:new Map(),shardTimer:.6,returned:false,trail:[]};
  if(s.kind==='bottle'&&(!Number.isFinite(s.targetX)||!Number.isFinite(s.targetY))){s.targetX=s.originX+s.vx*life;s.targetY=s.originY+s.vy*life;s.originX+=Math.cos(s.angle)*24;s.originY+=Math.sin(s.angle)*24;s.x=s.px=s.originX;s.y=s.py=s.originY;}
  this.shots.push(s);return s;
 }
 zone(z){if(this.zones.length<LIMITS.zones)this.zones.push({id:this.nextId++,tick:0,...this.attackSource,...z,maxLife:z.life});}
 laser(z){if(this.lasers.length<LIMITS.lasers)this.lasers.push({id:this.nextId++,tick:0,...this.attackSource,...z,maxLife:z.life});}
 mine(m){if(this.mines.length<LIMITS.mines)this.mines.push({...this.attackSource,...m,arm:.65,phase:this.rng()*6.28});}
 meteor(x,y,r,damage,delay=.7){if(this.meteors.length<8)this.meteors.push({...this.attackSource,x,y,r:r*this.range(),damage,delay,maxDelay:delay});}
 ring(x,y,r,color='#b4ffe1',life=.45){if(this.rings.length<LIMITS.rings)this.rings.push({x,y,r,color,life,maxLife:life});}
 burst(x,y,count,color='#baffee',speed=110){for(let i=0;i<count&&this.particles.length<LIMITS.particles;i++){const a=this.cosmeticRng()*Math.PI*2,v=speed*(.3+this.cosmeticRng()*.7),life=.22+this.cosmeticRng()*.4;this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,color,life,maxLife:life,size:2+this.cosmeticRng()*3});}}
 float(x,y,text,color='#fff1ca'){if(this.numbers.length<24)this.numbers.push({x,y,text,color,life:.75,maxLife:.75});}
 heal(amount,passive=false){const p=this.player;if(p.hp<=0)return;let available=amount;if(passive){this.recoveryBudget=Math.min(p.maxHp*.03,this.recoveryBudget+(this.time-this.recoveryAt)*p.maxHp*.006);this.recoveryAt=this.time;available=Math.min(amount,this.recoveryBudget);}const n=Math.min(available,p.maxHp-p.hp);if(n<=0)return;if(passive)this.recoveryBudget-=n;p.hp+=n;this.float(p.x,p.y-40,'+'+Math.ceil(n),'#b4ffb1');this.ring(p.x,p.y,58,'#baffc0');this.emit('heal');}
 damagePlayer(amount,source='contact',attack=null){const p=this.player;if(p.hp<=0||p.invincible>0&&!(source==='attack'&&this.time-this.lastAttackHurt>=.85&&this.time-(this.lastContactHurt??-10)>=.25&&p.invincible<=(p.contactGrace||0)+.001))return;if(source==='attack')this.lastAttackHurt=this.time;else this.lastContactHurt=this.time;let actual=Math.max(1,amount*(1-this.lv('armor')*.1));if(this.options.hero==='worm'&&this.heroState.active>0)actual*=.7;const absorbed=Math.min(actual,this.heroState.shield);this.heroState.shield-=absorbed;actual-=absorbed;p.hp=Math.max(0,p.hp-actual);if(actual>0){this.damageTaken+=actual;if(p.hp===0)this.lastAttack={name:attack?.name||'敵との接触',pattern:attack?.pattern||source,damage:actual};heroHurt(this);}if(this.mainWeapon==='sword'&&this.souls){if(this.options.weaponGrade==='legendary'&&this.souls>=100){this.souls-=100;this.withAttack('sword',()=>this.blast(p.x,p.y,200,120));}else this.souls=0;}p.invincible=actual>0?.85:.2;p.contactGrace=source==='contact'?p.invincible:0;this.shake=6;this.float(p.x,p.y-32,actual?'−'+Math.ceil(actual):'GUARD',actual?'#ffb3c0':'#b2eaff');this.emit(actual?'hurt':'shield');}
 damageEnemy(e,base,options={}){
  if(e.dead||e.spawnIn>0||!Number.isFinite(base)||base<=0)return false;
  const actual=base*this.power()*(options.dot?1:heroHit(this,e,base))*(1+(e.vulnerableUntil>this.time?e.vulnerability:0));
  const weapon=options.weapon||this.attackSource?.weapon||'other',attackId=options.attackId??this.attackSource?.attackId??++this.attackSequence,stat=this.weaponStats[weapon]||(this.weaponStats[weapon]={damage:0,kills:0});stat.damage+=Math.min(actual,Math.max(0,e.hp));
  e.hp-=actual;e.flash=.12;this.effects.hit(e,actual,this.player,this.time,options);
  if(options.bleed)e.bleedWeapon=weapon;if(options.deathBlast)e.deathWeapon=weapon;
  if(options.bleed){e.bleedUntil=this.time+5;e.bleedDamage=base*.08;}if(options.vulnerability){e.vulnerability=options.vulnerability;e.vulnerableUntil=this.time+5;}if(options.deathBlast)e.deathBlast=options.deathBlast;
  if(options.slow){e.slow=Math.max(e.slow,.6);e.slowFactor=options.slow;}
  if(options.knock){const a=Math.atan2(e.y-this.player.y,e.x-this.player.x),strength=options.knock*(e.kind==='boss'?.08:1);e.knockX+=Math.cos(a)*strength;e.knockY+=Math.sin(a)*strength;}
  if(options.leech&&this.time-this.lastLeech>.5){this.lastLeech=this.time;this.heal(Math.min(this.player.maxHp*.008,actual*.03),true);}
  if(e.hp>0)return false;
  e.dead=true;if(this.mainWeapon==='sword'&&this.options.weaponGrade!=='normal')this.souls=Math.min(200,this.souls+1);
  const coinReward=e.kind==='boss'?65:e.kind==='elite'?6:['chase','hop','flank'].includes(e.pattern)?.05:.12;
  this.coins=Math.round((this.coins+coinReward*(1+this.lv('fortune')*.08))*10000)/10000;this.kills++;this.combo++;this.comboTime=2.5;this.maxCombo=Math.max(this.maxCombo,this.combo);
  const points=Math.round(e.score*(1+Math.min(.25,this.combo*.005)));this.score=Math.min(Number.MAX_SAFE_INTEGER,this.score+points);
  stat.kills++;let attack=this.attackKills.get(attackId);if(!attack||this.time-attack.at>.35)attack={at:this.time,kills:0};attack.kills++;this.attackKills.set(attackId,attack);this.maxAttackKills=Math.max(this.maxAttackKills,attack.kills);if(this.attackKills.size>256)this.attackKills.delete(this.attackKills.keys().next().value);
  if(!this.recordBeaten&&this.options.bestScore>0&&this.score>this.options.bestScore){this.recordBeaten=true;this.emit('personalBest',{score:this.score});this.effects.celebrate(this.player.x,this.player.y);}
  if(this.options.killEffect!=='default'&&this.time-this.lastCosmeticKill>.08){this.lastCosmeticKill=this.time;const fx=KILL_EFFECTS.find(f=>f.id===this.options.killEffect);if(fx){this.ring(e.x,e.y,42,fx.color,.5);this.burst(e.x,e.y,5,fx.color,115);}}
  this.effects.kill(e,points,this.player);if((this.combo===10||this.combo===25||this.combo%50===0)&&this.time-this.lastChainEffect>1){this.lastChainEffect=this.time;this.emit('milestone',{combo:this.combo});}
  this.burst(e.x,e.y,e.kind==='boss'?35:3,e.kind==='ice'?'#a6f5ff':e.kind==='orange'?'#ffd98b':'#e5b9ff',e.kind==='boss'?230:90);
  this.dropGem(e.x,e.y,e.xp);
  if(e.kind==='boss'){if(e.damageAtSpawn===this.damageTaken)this.cleanBosses++;this.effects.celebrate(e.x,e.y,'boss');this.bossKills++;this.dropLoot('chest',e.x,e.y);this.ring(e.x,e.y,200,'#ffdf83',.8);this.emit('bossKilled',{score:points});this.shake=9;}
  else if(e.kind==='elite'){this.dropLoot(this.rng()<.3?'chest':'heal',e.x,e.y);this.emit('eliteKilled');}
  if(options.refund&&this.weaponStates.revolver)this.weaponStates.revolver.ammo=Math.min(6,this.weaponStates.revolver.ammo+1);
  if(e.deathBlast&&!options.deathChain)this.blast(e.x,e.y,e.deathBlast,40*(this.options.heroStars>=6?2:1),{deathChain:true,weapon:e.deathWeapon||weapon,attackId});encounterKill(this,e);this.emit('kill',{combo:this.combo});return true;
 }
 hitArea(x,y,r,damage,options={}){for(const e of this.grid.near(x,y,r+64))if(distance2({x,y},e)<(r+e.r*.7)**2)this.damageEnemy(e,damage,options);}
 blast(x,y,r,damage,options={}){this.effects.explosion(x,y,r,options.color);this.ring(x,y,r,options.color||'#ffd985',.44);this.burst(x,y,10,options.color||'#ffe095',160);this.hitArea(x,y,r,damage,{knock:95,...options});this.emit('meteor');}
 slash(angle,halfAngle,r,damage,options={}){this.motion.strike={angle,life:.34,maxLife:.34,color:options.color||'#fff0af'};r*=this.range();const p=this.player;this.slashes.push({x:p.x,y:p.y,angle,halfAngle,r,life:options.life||.2,maxLife:options.life||.2,color:options.color||'#fff0af'});if(this.slashes.length>14)this.slashes.shift();for(const e of this.grid.near(p.x,p.y,r+60)){let a=Math.atan2(e.y-p.y,e.x-p.x)-angle;a=Math.atan2(Math.sin(a),Math.cos(a));if(distance2(e,p)<(r+e.r)**2&&Math.abs(a)<halfAngle)this.damageEnemy(e,damage,options);}}
 zap(enemy,damage,chains=0,excluded=new Set()){
  let current=enemy,prev={x:enemy.x-22,y:enemy.y-230};for(let i=0;i<=chains&&current;i++){excluded.add(current.id);if(this.beams.length<65)this.beams.push({x:prev.x,y:prev.y,tx:current.x,ty:current.y,life:.2,maxLife:.2,kind:'lightning',gold:true});this.damageEnemy(current,damage);this.ring(current.x,current.y,27,'#fff0a9',.22);prev=current;current=this.nearest(current,210,excluded);}
 }
 dropGem(x,y,value){
  if(this.gems.length>=LIMITS.gems){let nearest=this.gems[0];for(const g of this.gems)if(distance2(g,{x,y})<distance2(nearest,{x,y}))nearest=g;nearest.value+=value;return;}
  this.gems.push({x,y,value,pulling:false,phase:this.rng()*6.28});
 }
 dropLoot(kind,x,y){const chests=this.loot.filter(l=>l.kind==='chest');if(kind==='chest'&&chests.length>=6){const oldest=chests[0];this.loot=this.loot.filter(l=>l.id!==oldest.id);}if(this.loot.length>=LIMITS.loot){let far=this.loot[0];for(const l of this.loot)if(distance2(l,this.player)>distance2(far,this.player))far=l;this.loot=this.loot.filter(l=>l.id!==far.id);}this.loot.push({id:this.nextId++,kind,x,y,phase:this.rng()*6.28,pulling:false});}
 collectAll(){for(const g of this.gems)g.pulling=true;for(const l of this.loot)if(l.kind!=='chest')l.pulling=true;this.emit('collect');}
 orbiters(){
  const result=[],l=this.lv('orbit');if(l&&(this.evolvedWeapon('orbit')||this.time<this.orbitUntil)){const n=this.evolvedWeapon('orbit')?6:l+1,r=(65+l*5)*this.range();for(let i=0;i<n;i++){const a=this.time*2.6+i/n*Math.PI*2;result.push({x:this.player.x+Math.cos(a)*r,y:this.player.y+Math.sin(a)*r,guard:true});}}
  return result;
 }
 drone(id){return dronePose(this,id);}
 satellites(){const companions=Object.keys(DRONES).filter(id=>this.lv(id)).map(id=>this.drone(id));if(this.evolvedWeapon('starPunch'))companions.push({x:this.player.x-55,y:this.player.y-5,id:'clone'});if(this.options.hero==='joey'&&this.heroState.active>0)companions.push({x:this.player.x+65,y:this.player.y-5,id:'bear'});return companions;}
 addHostile(x,y,vx,vy,r=7,damage=12,attack=null){if(this.hostile.length<LIMITS.hostile)this.hostile.push({x,y,vx,vy,r,damage,life:6,attack});}
 updateEnemies(dt){
  const p=this.player,far=Math.max(this.viewport.width,this.viewport.height)*1.65;
  for(const e of [...this.enemies].sort((a,b)=>(a.kind==='boss'?-2:a.kind==='elite'?-1:0)-(b.kind==='boss'?-2:b.kind==='elite'?-1:0)||(a.lastAttackAt??-1)-(b.lastAttackAt??-1))){
   if(e.dead)continue;if(distance2(e,p)>far*far){if(e.kind==='boss'){Object.assign(e,this.spawnPosition());e.spawnIn=1.2;e.dash=0;e.tell=0;e.attackIn=2.5;this.threats=this.threats.filter(t=>t.owner!==e.id);}else{e.retired=true;continue;}}
   if(e.spawnIn>0){e.spawnIn-=dt;continue;}if(e.retired)continue;e.flash=Math.max(0,e.flash-dt);e.slow=Math.max(0,e.slow-dt);e.orbitHit=Math.max(0,e.orbitHit-dt);
   if(e.eventRole!=='treasure')updateEnemyAI(this,e,dt);
   if(distance2(e,p)<(e.r+p.r-3)**2){const protectedByVeil=this.veilActive()&&this.zones.some(z=>z.kind==='veil'&&z.life>0&&distance2(z,p)<z.r*z.r);if(!protectedByVeil||e.kind==='boss')this.damagePlayer(e.damage*(e.weakenUntil>this.time?.7:1),'contact',{name:e.name,pattern:'contact'});}
  }
  this.enemies=this.enemies.filter(e=>!e.dead&&!e.retired);this.grid.build(this.enemies);
  for(const e of this.enemies){if(e.kind==='boss'||e.spawnIn>0||e.sequencing&&this.threats.some(t=>t.id===e.sequencing&&!t.done))continue;for(const other of this.grid.near(e.x,e.y,48)){if(other.id<=e.id||other.kind==='boss'||other.sequencing&&this.threats.some(t=>t.id===other.sequencing&&!t.done))continue;const dx=other.x-e.x,dy=other.y-e.y,d2=dx*dx+dy*dy,r=(e.r+other.r)*.77;if(d2>0.001&&d2<r*r){const d=Math.sqrt(d2),f=(r-d)*.17/d;e.x-=dx*f;e.y-=dy*f;other.x+=dx*f;other.y+=dy*f;}}}
 }
 updateProjectiles(dt){
  const count=this.shots.length,p=this.player;for(let i=0;i<count;i++){
   const s=this.shots[i];if(s.life<=0)continue;
   if(s.kind==='bottle'&&Number.isFinite(s.targetX)&&Number.isFinite(s.targetY)){
    const before=bottlePose(s);s.trail.push({x:before.x,y:before.y,height:before.height});if(s.trail.length>7)s.trail.shift();
    s.px=s.x;s.py=s.y;s.age=Math.min(s.maxLife,s.age+dt);s.life=Math.max(0,s.maxLife-s.age);const pose=bottlePose(s);s.x=pose.x;s.y=pose.y;
    if(s.life<=0){
     if(s.zone)this.zone({weapon:s.weapon,attackId:s.attackId,x:s.x,y:s.y,...s.zone,r:s.zone.r*this.range()});
     if(s.zone?.kind==='fire'){this.effects.shatter(s.x,s.y,s.angle);this.emit('bottleBreak',{weapon:s.weapon});}else{this.effects.explosion(s.x,s.y,(s.zone?.r||80)*.6,'#a4eaff');this.emit('meteor');}
    }continue;
   }
   if(!s.persistent)s.life-=dt;s.age+=dt;s.px=s.x;s.py=s.y;s.trail.push({x:s.x,y:s.y});if(s.trail.length>7)s.trail.shift();if(s.life<=0){if(s.zone)this.zone({weapon:s.weapon,attackId:s.attackId,x:s.x,y:s.y,...s.zone,r:s.zone.r*this.range()});continue;}
   if(s.kind==='heroOrbit'){const a=s.angle+s.age*(s.orbitSpeed||2.4);s.x=p.x+Math.cos(a)*s.orbitRadius;s.y=p.y+Math.sin(a)*s.orbitRadius;}
   else if(s.kind==='spiral'){const r=Math.sin(s.age/s.maxLife*Math.PI)*240*this.range(),a=s.angle+s.age*4;s.x=p.x+Math.cos(a)*r;s.y=p.y+Math.sin(a)*r;}
   else{
    if(s.persistent&&distance2(s,p)>Math.max(this.viewport.width,this.viewport.height)**2*2){s.x=p.x;s.y=p.y;s.px=p.x;s.py=p.y;s.trail=[];}
    if(s.kind==='return'&&s.age>.85*this.duration()){if(!s.returned){s.hit.clear();s.returned=true;}const a=Math.atan2(p.y-s.y,p.x-s.x);s.vx=Math.cos(a)*s.speed*1.2;s.vy=Math.sin(a)*s.speed*1.2;if(distance2(s,p)<23**2){if(s.catchReset)this.cooldowns[s.weapon]=0;if(['starforge','havocNova'].includes(s.weapon)&&this.options.forgeE>=1){const state=this.weaponStates.starforge;state.returns=(state.returns||0)+1;if(state.returns%2===0)this.addOverload();}s.life=0;continue;}}
    if(s.homing){const t=this.nearest(s,400,s.repeat?new Set():s.hit);if(t){const a=Math.atan2(t.y-s.y,t.x-s.x),turn=1-Math.exp(-dt*7);s.vx+=(Math.cos(a)*s.speed-s.vx)*turn;s.vy+=(Math.sin(a)*s.speed-s.vy)*turn;}}
    if(s.gravity)s.vy+=s.gravity*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;
    if(s.bouncing){const hw=s.nearPlayer?170:this.viewport.width*.52,hh=s.nearPlayer?190:this.viewport.height*.52,ox=p.x,oy=p.y;if(Math.abs(s.x-ox)>hw){s.vx=s.x>ox?-Math.abs(s.vx):Math.abs(s.vx);s.x=clamp(s.x,ox-hw,ox+hw);}if(Math.abs(s.y-oy)>hh){s.vy=s.y>oy?-Math.abs(s.vy):Math.abs(s.vy);s.y=clamp(s.y,oy-hh,oy+hh);}}
   }
   if(s.shards){s.shardTimer-=dt;if(s.shardTimer<=0){s.shardTimer=.85;for(let j=0;j<8;j++)this.projectile({x:s.x,y:s.y,angle:j/8*Math.PI*2,damage:18,speed:365,life:.75,r:4,weapon:s.weapon,attackId:s.attackId,color:'#fff1b0'});}}
   if(s.blocksBullets)for(const b of this.hostile)if(segmentDistance2(b.x,b.y,s.px,s.py,s.x,s.y)<(b.r+s.r)**2)b.life=0;
   if(s.noCollision)continue;
   const move=Math.hypot(s.x-s.px,s.y-s.py),near=this.grid.near((s.x+s.px)/2,(s.y+s.py)/2,s.r+64+move/2);
   for(const e of near){
    if(e.dead||e.spawnIn>0||(s.repeat?this.time-(s.hitAt.get(e.id)??-999)<s.repeat:s.hit.has(e.id)))continue;
    if(segmentDistance2(e.x,e.y,s.px,s.py,s.x,s.y)>(s.r+e.r)**2)continue;
    s.hit.add(e.id);s.hitAt.set(e.id,this.time);
    if(s.explosion)this.blast(s.x,s.y,s.explosion,s.damage,{weapon:s.weapon,attackId:s.attackId});else this.damageEnemy(e,s.damage,{weapon:s.weapon,attackId:s.attackId,impactAngle:Math.atan2(s.y-s.py,s.x-s.px),knock:s.knock,leech:s.leech,refund:s.refund,bleed:s.bleed,slow:s.slow,vulnerability:s.vulnerability});if(s.impactBlast)this.blast(e.x,e.y,s.impactBlast,s.damage*.6,{weapon:s.weapon,attackId:s.attackId});
    if(s.ricochet){const a=Math.atan2(s.y-e.y,s.x-e.x);s.vx=Math.cos(a)*s.speed;s.vy=Math.sin(a)*s.speed;s.x=e.x+Math.cos(a)*(e.r+s.r+1);s.y=e.y+Math.sin(a)*(e.r+s.r+1);}
    if(s.zone)this.zone({weapon:s.weapon,attackId:s.attackId,x:s.x,y:s.y,...s.zone,r:s.zone.r*this.range()});
    if(s.splitBudget>0){s.splitBudget=0;for(const delta of [-.85,.85])this.projectile({x:s.x,y:s.y,angle:Math.atan2(s.vy,s.vx)+delta,damage:s.damage,speed:s.speed/(1+this.lv('projectile')*.1),life:Math.min(1.8,s.life),r:7,kind:s.splitKind||'ball',bouncing:!s.splitKind,ricochet:!s.splitKind,pierce:99,repeat:.3,color:'#c5f4ff',weapon:s.weapon,attackId:s.attackId});}
    if(s.pierce>0){if(!s.repeat)s.pierce--;if(s.ricochet)break;continue;}s.life=0;break;
   }
   if(s.hit.size>400){s.hit.clear();s.hitAt.clear();}
  }
 }
 updateAreas(dt){
  const initialZones=this.zones.length;for(let i=0;i<initialZones;i++){const z=this.zones[i];z.life-=dt;z.tick-=dt;if(z.follow){z.x=this.player.x;z.y=this.player.y;}if(z.blocksBullets&&(z.kind!=='veil'||this.veilActive()))this.blockCircle(z.x,z.y,z.r);if(z.tick<=0){z.tick=.34;if(z.heal&&distance2(z,this.player)<z.r*z.r)this.heal(z.heal,true);if(z.kind==='shockwave'){const r=z.r*(1-z.life/z.maxLife);for(const e of this.grid.near(z.x,z.y,z.r+60))if(Math.abs(Math.sqrt(distance2(z,e))-r)<35+e.r)this.damageEnemy(e,z.damage,{weapon:z.weapon,attackId:z.attackId});}else if(z.damage)this.hitArea(z.x,z.y,z.r,z.damage,{weapon:z.weapon,attackId:z.attackId,slow:z.kind==='vortex'?.55:z.slow||0,vulnerability:z.vulnerability||0});}
   if(z.pull||z.kind==='veil'&&this.veilActive()){for(const e of this.grid.near(z.x,z.y,z.r+50)){const d=Math.sqrt(distance2(z,e));if(d>0&&d<z.r&&e.kind!=='boss'&&!(e.sequencing&&this.threats.some(t=>t.id===e.sequencing&&!t.done))){const force=z.kind==='veil'?-Math.min(z.r-d+e.r,150*dt):z.pull*dt;e.x+=(z.x-e.x)/d*force;e.y+=(z.y-e.y)/d*force;}}}if(z.life<=0){if(z.burst)this.blast(z.x,z.y,z.r*1.15,z.burst,{weapon:z.weapon,attackId:z.attackId});if(z.veil)this.zone({weapon:z.weapon,attackId:z.attackId,x:z.x,y:z.y,r:z.r,life:3*this.duration(),damage:0,kind:'veil',blocksBullets:true,burst:z.veilBurst});}}
  for(const l of this.lasers){l.life-=dt;l.tick-=dt;l.angle+=(l.spin||0)*dt;if(l.follow){l.x=this.player.x;l.y=this.player.y;}if(l.kind==='inward')l.radius=Math.max(0,l.length*l.life/l.maxLife);if(l.tick<=0){l.tick=.22;const dx=Math.cos(l.angle)*l.length,dy=Math.sin(l.angle)*l.length;for(const e of this.grid.near(l.x,l.y,l.length+65)){const hit=l.kind==='inward'?Math.abs(Math.sqrt(distance2(l,e))-l.radius)<e.r+l.width:segmentDistance2(e.x,e.y,l.x-dx,l.y-dy,l.x+dx,l.y+dy)<(e.r+l.width)**2;if(hit)this.damageEnemy(e,l.damage,{weapon:l.weapon,attackId:l.attackId,slow:l.slow,bleed:l.bleed});}}}
  for(const m of this.mines){m.life-=dt;m.arm-=dt;if(m.arm>0)continue;const trigger=this.grid.near(m.x,m.y,80).some(e=>!e.dead&&e.spawnIn<=0&&distance2(m,e)<(e.r+40)**2);if(trigger||m.life<=0){m.life=0;this.blast(m.x,m.y,m.r,m.damage,{weapon:m.weapon,attackId:m.attackId});if(m.kind==='inferno')this.zone({weapon:m.weapon,attackId:m.attackId,x:m.x,y:m.y,r:m.r*.85,life:5*this.duration(),damage:35,kind:'fire'});if(m.kind==='thunderMine')this.zone({weapon:m.weapon,attackId:m.attackId,x:m.x,y:m.y,r:m.r*1.5,life:1,damage:90,kind:'shockwave'});}}
  for(const m of this.meteors){m.delay-=dt;if(m.delay<=0){this.blast(m.x,m.y,m.r,m.damage,{weapon:m.weapon,attackId:m.attackId});this.shake=Math.max(this.shake,5);}}
 }
 updatePickups(dt){
  const p=this.player;for(const g of [...this.gems,...this.loot]){if(g.dead)continue;const d=Math.sqrt(distance2(g,p));if(d<this.magnetRadius())g.pulling=true;if(g.pulling&&d>0){const v=Math.min(d,dt*(400+d*.8));g.x+=(p.x-g.x)/d*v;g.y+=(p.y-g.y)/d*v;}if(distance2(g,p)>25**2)continue;
   g.dead=true;if(!g.kind){this.addXp(g.value);this.emit('xp');}
   else if(g.kind==='heal')this.heal(p.maxHp*.3);
   else if(g.kind==='magnet')this.collectAll();
   else if(g.kind==='bomb'){for(const e of this.enemies)if(e.spawnIn<=0&&distance2(e,p)<850**2)this.damageEnemy(e,(e.kind==='boss'?e.maxHp*.1:e.hp)/this.power(),{weapon:'pickupBomb',attackId:'pickup-'+g.id});this.ring(p.x,p.y,700,'#fff3b5',.7);this.shake=9;this.emit('meteor');}
   else if(g.kind==='chest'){const roll=this.rng();this.chestPicks+=roll<.06?5:roll<.27?3:1;this.emit('chest');}
  }
  // Keep a bounded set of drops in an unbounded world; remote XP is compacted,
  // never counted as a kill and never added to score by cleanup.
  const far=Math.max(1900,this.viewport.height*2.4);let xp=0;this.gems=this.gems.filter(g=>{if(g.dead)return false;if(!g.pulling&&distance2(g,p)>far**2){xp+=g.value;return false;}return true;});if(xp){const a=this.rng()*Math.PI*2;this.dropGem(p.x+Math.cos(a)*650,p.y+Math.sin(a)*650,xp);}
  this.loot=this.loot.filter(l=>!l.dead&&(l.pulling||distance2(l,p)<far**2));
 }
 step(dt,input={x:0,y:0}){
  if(this.mode!=='playing')return;dt=clamp(dt,0,.05);if(!dt)return;this.time+=dt;if(this.veilGuard<=0&&this.time>=this.veilBreakUntil)this.veilGuard=2;const p=this.player;const reward=this.effects.step(dt);if(reward)this.emit('multikill',reward);
  p.invincible=Math.max(0,p.invincible-dt);p.reviveGrace=Math.max(0,(p.reviveGrace||0)-dt);p.contactGrace=Math.max(0,(p.contactGrace||0)-dt);this.comboTime-=dt;if(this.comboTime<=0)this.combo=0;this.shake=Math.max(0,this.shake-dt*24);
  let x=Number.isFinite(input.x)?input.x:0,y=Number.isFinite(input.y)?input.y:0,len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}p.x+=x*this.speed()*dt;p.y+=y*this.speed()*dt;this.moving=len>.1;if(this.moving){this.aim=Math.atan2(y,x);if(Math.abs(x)>.1)this.facing=x>0?1:-1;}
  updateMotion(this,dt,{x,y});if(this.options.encounters)updateEncounters(this,dt);this.updateSpawns(dt);this.updateEnemies(dt);updateThreats(this,dt);if(p.hp>0)this.withAttack('hero-'+this.options.hero,()=>updateHero(this,dt));if(p.hp<=0){this.mode='lost';this.emit('result');this.cleanup();return;}
  for(const id of equipped(this.levels,'attack')){this.cooldowns[id]=(this.cooldowns[id]||0)-dt;if(this.cooldowns[id]<=0){this.cooldowns[id]=this.withAttack(id,()=>castWeapon(this,id))*this.cooldown();}}
  const orbits=this.orbiters();for(const o of orbits)for(const e of this.grid.near(o.x,o.y,70))if(e.orbitHit<=0&&distance2(o,e)<(e.r+18)**2){this.damageEnemy(e,damageAt('orbit',this.lv('orbit'),this.evolvedWeapon('orbit')),{knock:160,weapon:'orbit',attackId:Math.floor(this.time/.35)+'-orbit'});e.orbitHit=.32;}
  this.updateProjectiles(dt);this.updateAreas(dt);const sheltered=this.zones.some(z=>z.kind==='veil'&&z.life>0&&distance2(z,p)<z.r*z.r);if(sheltered&&this.veilActive()){this.veilGuard=Math.max(0,this.veilGuard-dt);if(this.veilGuard===0)this.veilBreakUntil=this.time+1.8;}else if(this.time>=this.veilBreakUntil)this.veilGuard=Math.min(2,this.veilGuard+dt);
  for(const b of this.hostile){if(b.life<=0)continue;b.life-=dt;const bx=b.x,by=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;if(orbits.some(o=>distance2(b,o)<(b.r+22)**2)){b.life=0;continue;}if(segmentDistance2(p.x,p.y,bx,by,b.x,b.y)<(b.r+p.r-2)**2){this.damagePlayer(b.damage,'attack',b.attack);b.life=0;}}
  if(p.hp<=0){this.mode='lost';this.emit('result');this.cleanup();return;}
  this.regenTimer+=dt;if(this.regenTimer>=5){this.regenTimer-=5;if(this.lv('regen'))this.heal(p.maxHp*this.lv('regen')*.005,true);}
  this.updatePickups(dt);
  for(const f of this.particles){f.x+=f.vx*dt;f.y+=f.vy*dt;f.vx*=.96;f.vy*=.96;f.life-=dt;}
  for(const n of this.numbers){n.y-=dt*25;n.life-=dt;}for(const a of [...this.rings,...this.beams,...this.slashes])a.life-=dt;
  this.cleanup();
  if(this.chestPicks){const count=this.chestPicks;this.chestPicks=0;this.openChoice('chest',count);}else this.checkLevel();
 }
 cleanup(){this.enemies=this.enemies.filter(e=>!e.dead&&!e.retired);this.shots=this.shots.filter(s=>s.life>0);this.hostile=this.hostile.filter(s=>s.life>0);this.zones=this.zones.filter(s=>s.life>0);this.lasers=this.lasers.filter(s=>s.life>0);this.mines=this.mines.filter(s=>s.life>0);this.meteors=this.meteors.filter(s=>s.delay>0);this.particles=this.particles.filter(s=>s.life>0);this.rings=this.rings.filter(s=>s.life>0);this.beams=this.beams.filter(s=>s.life>0);this.slashes=this.slashes.filter(s=>s.life>0);this.numbers=this.numbers.filter(s=>s.life>0);}
 result(){return {weapons:structuredClone(this.weaponStats),lastAttack:this.lastAttack,cleanBosses:this.cleanBosses,maxAttackKills:this.maxAttackKills,...this.encounterStats,score:this.score,coins:Math.floor(this.coins),hero:this.options.hero,kills:this.kills,bossKills:this.bossKills,seconds:this.time,level:this.level,wave:this.wave,maxCombo:this.maxCombo,mainWeapon:this.mainWeapon,levels:{...this.levels},evolved:[...this.evolved]};}
}
