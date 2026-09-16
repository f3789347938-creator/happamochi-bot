import {HERO_BY_ID} from './heroes.js';
const TAU=Math.PI*2;
// Timing and damage below are preview tuning, not claimed live-game coefficients.
export function initHero(g){g.heroState={cooldown:0,stance:'palm',active:0,hitTimer:0,shield:0,retreat:0,chips:0,chipTimer:0,hits:0,bearHits:0,exposed:0,tone:null,toneUntil:0,adrenalineUntil:0,mecha:false,sync:100};}
export function manualInfo(g){const h=HERO_BY_ID[g.options.hero],s=g.heroState;if(!h.manual||h.awakenedManual&&!g.options.awakening)return null;const tone=['毒','衰弱','寒冷'][Math.floor(g.time/3)%3];return {name:h.id==='metallia'?`三音演奏・${tone}`:h.id==='yang'?`切替 → ${s.stance==='palm'?'護体真気':'掌風'}`:h.manual,cooldown:s.cooldown,active:s.active,shield:s.shield};}
export function activateHero(g){const info=manualInfo(g),s=g.heroState,p=g.player,h=g.options.hero;if(g.mode!=='playing'||!info||s.cooldown>0)return false;
 s.cooldown=h==='metallia'?20:30;s.active=0;
 if(h==='yang'){s.stance=s.stance==='palm'?'ki':'palm';g.cooldowns.palm=0;}
 else if(h==='common')s.shield=Math.min(p.maxHp,s.shield+p.maxHp*.3);
 else if(h==='king')p.invincible=Math.max(p.invincible,3);
 else if(h==='worm')s.active=8;
 else if(h==='wesson')for(let i=0;i<8;i++)g.meteor(p.x+(i%4-1.5)*120,p.y+(Math.floor(i/4)-.5)*150,100,120,.2+i*.13);
 else if(h==='metallia'){s.tone=['poison','weaken','chill'][Math.floor(g.time/3)%3];s.toneUntil=g.time+5+(g.options.heroStars>=6?15:g.options.heroStars>=3?5:0);s.active=5;}
 else if(h==='joey'){s.active=30;s.hitTimer=0;s.bearHits=0;}
 else if(h==='taloxa'){s.mecha=true;s.active=g.options.heroStars>=3?15:10;g.cooldowns.funnel=0;}
 else if(h==='venato'){s.active=10;g.zone({x:p.x,y:p.y,r:140,life:10,damage:18,kind:'bats',follow:true});}
 g.effects.celebrate(p.x,p.y);g.emit('hero',{name:info.name});return true;
}
export function heroPower(g){const s=g.heroState;let bonus=0;if(s.adrenalineUntil>g.time)bonus=g.lv('adrenaline')*(g.options.awakening>=5?.1:g.options.heroStars>=3?.05:.02);return 1+bonus;}
export function heroHit(g,e,base){const h=g.options.hero,s=g.heroState;let mult=1;
 if(g.lv('listening')&&Math.hypot(e.x-g.player.x,e.y-g.player.y)<180*g.range())mult+=g.lv('listening')*.05;
 if(g.lv('harmony')&&(e.poisonUntil>g.time||e.slow>0))mult+=g.lv('harmony')*.05;
 if(g.lv('harmony')&&e.weakenUntil>g.time&&g.time>=(s.harmonyAt||0)){s.harmonyAt=g.time+.5;s.shield=Math.min(g.player.maxHp*.3,s.shield+g.lv('harmony')*.1);}
 if(h==='joey'&&['boss','elite'].includes(e.kind)){mult+=.1;s.hits++;if(s.hits%200===0){s.exposed=Math.min(10,s.exposed+1);s.exposedUntil=g.time+(g.options.heroStars>=3?20:5);}if(s.exposedUntil>g.time&&(e.poisonUntil>g.time||e.weakenUntil>g.time||e.slow>0))mult+=s.exposed*.02;}
 if(s.toneUntil>g.time){if(s.tone==='poison'){e.poisonUntil=g.time+5;e.poisonDamage=base*.05;e.poisonWeapon='harmony';}if(s.tone==='weaken')e.weakenUntil=g.time+5;if(s.tone==='chill'){e.slow=5;e.slowFactor=.65;}}
 const critChance=g.has('instinctE')?.5:g.lv('instinct')*.08;let crit=critChance>0&&g.rng()<critChance;if(!crit&&critChance>0&&g.options.heroStars>=6)crit=g.rng()<critChance;if(crit){mult*=g.has('instinctE')?2.25:2;g.float(e.x,e.y-30,'CRIT','#ffe391');}return mult;
}
export function heroHurt(g){g.heroState.adrenalineUntil=g.time+(g.options.heroStars>=3?5:3);}
export function updateHero(g,dt){const h=g.options.hero,s=g.heroState,p=g.player;s.cooldown=Math.max(0,s.cooldown-dt);const was=s.active;s.active=Math.max(0,s.active-dt);
 if(h==='venato'&&was>0){const drain=p.maxHp*.08*(g.options.awakening>=5?2:1)*Math.min(dt,was),actual=Math.min(Math.max(0,p.hp-1),drain);p.hp-=actual;s.shield=Math.min(p.maxHp,s.shield+actual*(g.options.awakening>=1?1.2:1));if(actual>0)heroHurt(g);}
 if(h==='venato'&&s.active<=0)s.shield=Math.max(0,s.shield-p.maxHp*.04*dt);
 if(h==='joey'&&was>0){s.hitTimer-=dt;if(s.hitTimer<=0){s.hitTimer=.12;const t=g.nearest(p,600);if(t){g.blast(t.x,t.y,45,25,{color:'#cbb6ff'});s.bearHits++;}}if(s.active<=0){const t=g.nearest(p,650);if(t){g.blast(t.x,t.y,180,100+s.bearHits*4,{color:'#dfbaff'});t.weakenUntil=g.time+5;}}}
 if(h==='taloxa'&&s.active<=0&&s.mecha){s.mecha=false;g.cooldowns.funnel=0;}
 if(g.has('listeningE')){s.retreat+=dt;if(s.retreat>=8){s.retreat=0;for(const e of g.enemies)if(!['boss','elite'].includes(e.kind)&&Math.hypot(e.x-p.x,e.y-p.y)<180*g.range()){e.retired=true;g.ring(e.x,e.y,35,'#b4ffe1');}}}
 for(const e of g.enemies){if(e.dead)continue;e.dotTimer=(e.dotTimer||0)-dt;if(e.dotTimer<=0){e.dotTimer=.5;if(e.bleedUntil>g.time)g.damageEnemy(e,e.bleedDamage||2,{dot:true,weapon:e.bleedWeapon||'other'});if(e.poisonUntil>g.time&&!e.dead)g.damageEnemy(e,e.poisonDamage||2,{dot:true,weapon:e.poisonWeapon||'harmony'});}}
}
export function castExclusive(g,id){const p=g.player,l=Math.min(5,g.lv(id)||5),e=g.evolvedWeapon(id),h=g.options.hero,s=g.heroState,stars=g.options.heroStars,target=g.nearest(p,650),aim=target?Math.atan2(target.y-p.y,target.x-p.x):g.aim,face=g.options.aimAssist?aim:g.aim;
 const shot=(angle,damage,extra={})=>g.projectile({x:p.x,y:p.y,angle,damage,weapon:id,speed:400,r:8,life:1.5,...extra});
 const orbit=(n,damage,r,extra={})=>{const live=g.shots.filter(a=>a.weapon===id&&a.persistent);for(const a of live)Object.assign(a,{damage,r:extra.r||18,orbitRadius:r},extra);for(let i=live.length;i<n;i++)shot(i/n*TAU,damage,{kind:'heroOrbit',persistent:true,pierce:99,repeat:.4,r:18,orbitRadius:r,life:999999,color:'#e8f6ff',...extra});};
 const healZone=()=>g.zone({x:p.x,y:p.y,r:(60+l*8)*g.range(),life:4*g.duration(),damage:0,heal:(stars>=6?2:1)*(1+l)*.5,kind:'heal'});
 switch(id){
 case 'medidrone':{const state=g.weaponStates[id]??={};state.firedAt=g.time;healZone();return 6;}
 case 'divine':case 'holy':case 'redeemer':{const t=g.weaponStates[id]??={healAt:0,angle:0};if(g.time>=t.healAt){healZone();t.healAt=g.time+6;}t.angle+=id==='redeemer'?-.4:.4;t.firedAt=g.time;const origin=g.drone(id),droneAim=target?Math.atan2(target.y-origin.y,target.x-origin.x):aim;for(let i=0;i<(id==='divine'?14:5);i++)shot(g.tech('droneA')?droneAim+(i-(id==='divine'?6.5:2))*.14:t.angle+i/(id==='divine'?14:5)*TAU,id==='divine'?60:45,{x:origin.x,y:origin.y,kind:'missile',homing:g.tech('droneA')||g.tech('droneB'),color:'#ffc5e4'});return id==='redeemer'?1.4:1;}
 case 'moon':{const evolved=e||g.has('eternity')||g.has('frost'),r=evolved?155:120,damage=(15+l*9)*(g.has('eternity')?1.6:1);g.slash(face,evolved?Math.PI:1.5,r,damage,{slow:g.has('frost')?.5:0,color:'#c6d3ff'});if(evolved)g.blockCircle(p.x,p.y,r*g.range());return 1.5;}
 case 'grenade':g.motion.throw={angle:aim,life:.32,maxLife:.32};g.emit('throw',{weapon:id});shot(aim,e?220:60+l*18,{kind:'bottle',speed:180,life:.8,noCollision:true,zone:{kind:'em',r:e?200:100,life:e?2:.5,damage:e?100:30,blocksBullets:e&&stars>=6,color:'#b7fbff'}});return e?60:15;
 case 'pistol':for(const offset of [-.08,.08])shot(aim+offset,14+l*6,{ricochet:l>=3,bouncing:l>=3,pierce:l>=3?l-2:0,repeat:.2,color:'#c6e9ff'});return .65;
 case 'palm':if(s.stance==='ki'){for(let i=0;i<3;i++)shot(i/3*TAU,e?65:18+l*8,{kind:'heroOrbit',orbitRadius:(e?130:100)*g.range(),life:2.2,r:22,pierce:99,repeat:.4,blocksBullets:true,color:'#ffe8a0',zone:e&&stars>=3?{kind:'ki',r:70,life:2,damage:25,slow:.1,vulnerability:.5}:undefined});}else shot(aim,e?120:20+l*10,{kind:'blade',r:e?22:14,pierce:99,life:1.8,vulnerability:e?.15:0,color:'#ffcf82'});return s.stance==='ki'?2.3:.7;
 case 'funnel':if(s.mecha){if(e)g.laser({x:p.x,y:p.y,angle:0,length:350,width:18,life:1,damage:90,spin:0,follow:true,bleed:true,color:'#ffbea4'});else shot(face,40+l*10,{speed:650,bleed:true,color:'#ffcc99'});return e?1:.12;}for(let i=0;i<2+Math.floor(l/2);i++)shot(aim+(i-1)*.2,20+l*8,{homing:true,ricochet:e,pierce:e?3:0,repeat:.2,kind:'needle',bleed:true,color:'#bff9ff'});return .9;
 case 'cosmic':for(let i=0;i<2;i++)shot(face+i*Math.PI,(20+l*9)*(stars>=6?2:1),{kind:'spiral',pierce:99,repeat:.35,life:2,r:18,color:'#ffc3e5'});shot(aim,30+l*10,{kind:'slash',r:25,pierce:99,life:1.8,color:'#ffe293'});return 2;
 case 'hammer':{const st=g.weaponStates[id]??={attacks:0};st.attacks++;g.slash(face,1.8,170,(30+l*13)*(stars>=3?2:1),{knock:140,color:'#ffc680'});return 1.3;}
 case 'spatula':if(e){orbit(3,80,120*g.range(),{r:20});}else if(target)g.blast(target.x,target.y,45*(stars>=3?1.4:1),30+l*12);return e&&stars>=6?1.6:2;
 case 'clarinet':g.blast(p.x,p.y,(90+l*12)*g.range(),20+l*9,{color:'#d8baff',deathBlast:e?75:0});return stars>=3?1.2:2;
 case 'starPunch':g.slash(face,1.6,120,25+l*13,{knock:120,color:'#ffc4cf'});if(e){const clone={x:p.x-55,y:p.y-5},t=g.nearest(clone,140);if(t)g.blast(t.x,t.y,42,65,{color:'#ffc4cf'});}return stars>=3?.6:1;
 case 'lasso':orbit(1,(20+l*9)*(e&&stars>=6?1.25:1),120*g.range(),{r:e?32:20,orbitSpeed:e&&stars>=6?2.9:2.4,color:e?'#bfeaff':'#ffdfba',rope:!e});return .5;
 case 'dualKatana':{const st=g.weaponStates[id]??={attacks:0};st.attacks++;g.slash(face+(st.attacks%2?0:Math.PI),e?Math.PI:1.9,st.attacks%2?180:110,25+l*10,{color:'#bcdeff'});return .6;}
 case 'sai':{const st=g.weaponStates[id]??={attacks:0};st.attacks++;for(const delta of [-.1,.1])shot(face+delta,25+l*8,{kind:'blade',pierce:e?99:2,bleed:stars>=3,color:'#ffaaa9'});if(stars>=3&&st.attacks%5===0)shot(face,130,{kind:'blade',r:25,pierce:99,bleed:true,color:'#ffc6b6'});return .9;}
 case 'microphone':shot(aim,20+l*10,{kind:'ball',r:e?22:12,pierce:1,impactBlast:e&&stars>=6?90:0,color:'#ffc7ef'});return .8;
 case 'nunchucks':g.slash(face,1.6,110,15+l*9,{color:'#ffe9ae'});shot(face,20+l*9,{kind:'spiral',r:20,pierce:99,repeat:.3,life:2,color:'#d5ffff'});return 1.4;
 case 'staff':g.slash(face,Math.PI,130,25+l*10,{knock:110,color:'#d5baff'});return 1.1;
 case 'secret':if(e)g.blast(p.x,p.y,200,100,{slow:stars>=3?.5:0,color:'#d4f6e7'});else shot(aim,30+l*10,{kind:'slash',r:25,pierce:99,slow:stars>=3?.6:0,color:'#d4f6e7'});return 1.2;
 default:return 1;
 }
}
