import {LATE_ENEMIES,LATE_STAGES} from './late-enemies.js';
import {SEQUENCE_PATTERNS,sequencePaths,updateSequence} from './enemy-sequences.js';
const groundPattern=pattern=>['bomb','cross','charge','flankCharge',...SEQUENCE_PATTERNS].includes(pattern);
// Enemy identities, fixed stage rosters and attacks are shared with the field guide.
const TAU=Math.PI*2;
const def=(name,sprite,hp,speed,damage,pattern='chase',extra={})=>({name,sprite:sprite+6,hp,speed,damage,pattern,r:19,xp:2,score:20,color:'#ff9c7f',...extra});
export const ENEMIES={
 ...LATE_ENEMIES,
 imp:def('若葉もち',0,10,44,6,'chase',{xp:1,score:10}),
 orange:def('はねもち',3,17,69,8,'hop',{score:15}),
 ice:def('こおり子',2,28,42,10,'fan',{count:1,cooldown:6,tell:1.2,color:'#9deaff'}),
 thorn:def('トゲ甲虫',9,45,66,12,'chase',{r:22}),
 lancer:def('赤角ランサー',1,42,62,15,'charge',{cooldown:6,tell:1.15,score:32}),
 fanling:def('扇の魔女',5,40,46,13,'fan',{count:3,cooldown:6,tell:1.1,color:'#dda4ff'}),
 bomber:def('ボムきのこ',6,48,49,16,'bomb',{count:1,cooldown:7,tell:1.45,score:35}),
 skitter:def('影走り',7,72,80,17,'flank',{score:42}),
 frostshot:def('氷連射士',2,68,50,17,'burst',{count:3,cooldown:6,tell:1.1,color:'#9deaff'}),
 prism:def('プリズム砲台',8,85,43,22,'snipe',{cooldown:7,tell:1.35,color:'#ffb9f3',score:55}),
 shaman:def('鼓舞のシャーマン',11,80,48,15,'support',{cooldown:8,tell:1.1,color:'#ccacff',score:65}),
 cinder:def('灰角もち兵',1,72,70,15,'chase',{xp:1,score:24,color:'#ffa789'}),
 spark:def('雷羽もち兵',3,95,78,18,'hop',{xp:1,score:30,color:'#ffe391'}),
 night:def('黒曜もち兵',9,120,82,22,'chase',{xp:1,score:36,color:'#cab4ff'}),
 reaver:def('二段斬りの鬼',1,112,73,23,'charge',{repeats:2,cooldown:7,tell:1.05,score:65}),
 artillery:def('迫撃かに',4,125,46,26,'bomb',{count:2,cooldown:7,tell:1.5,score:75}),
 wheel:def('輪弾の魔女',5,95,51,23,'ring',{count:12,cooldown:7,tell:1.25,color:'#efa8ff',score:65}),
 wraith:def('遊撃ゴースト',10,92,75,22,'flankFan',{count:3,cooldown:6,tell:1.1,color:'#a8fff0',score:65}),
 stormling:def('雷羽の襲撃者',3,155,80,28,'burstFan',{count:3,cooldown:7,tell:1.15,color:'#ffe391',score:95}),
 sentinel:def('十字砲の番人',8,175,43,32,'cross',{cooldown:8,tell:1.5,score:110}),
 hexer:def('地雷きのこ',6,160,53,30,'bomb',{count:3,cooldown:8,tell:1.55,score:105}),
 stalker:def('幻影ニンジャ',7,140,84,30,'flankCharge',{repeats:2,cooldown:7,tell:1.1,score:100}),
 obsidian:def('黒曜の突撃兵',9,230,80,36,'charge',{repeats:2,cooldown:6,tell:1.05,r:23,score:130}),
 tempest:def('嵐の指揮官',11,210,58,34,'sweep',{count:5,cooldown:7,tell:1.2,color:'#d1b0ff',score:145}),
 oracle:def('星落とし',5,195,55,38,'bomb',{count:3,cooldown:7,tell:1.4,color:'#ffb8e7',score:150}),
 phantom:def('残月の追跡者',7,200,88,36,'flankCharge',{repeats:3,cooldown:8,tell:1.1,color:'#b6ecff',score:145}),
 eliteRam:def('精鋭・破城鬼',1,380,65,22,'charge',{kind:'elite',r:31,repeats:2,cooldown:6,tell:1.25,xp:12,score:220}),
 eliteCrab:def('精鋭・重砲かに',4,620,49,29,'bomb',{kind:'elite',r:33,count:3,cooldown:6,tell:1.5,xp:16,score:380}),
 eliteSpecter:def('精鋭・幽玄',10,900,66,35,'ring',{kind:'elite',r:32,count:16,cooldown:6,tell:1.3,xp:20,score:550}),
 eliteVolt:def('精鋭・雷装甲',8,1200,57,40,'cross',{kind:'elite',r:34,cooldown:6,tell:1.5,xp:24,score:750}),
 oniKing:def('紅蓮の鬼王',12,1600,44,24,'boss',{kind:'boss',r:53,patterns:['charge','fan'],count:5,tell:1.4,cooldown:4.8,xp:35,score:1500}),
 frostQueen:def('氷冠の女王',13,2900,44,29,'boss',{kind:'boss',r:53,patterns:['ring','bomb','burstFan'],count:3,tell:1.5,cooldown:4.8,xp:40,score:2200,color:'#a8eeff'}),
 voidLord:def('幽界の魔導王',14,4600,46,35,'boss',{kind:'boss',r:55,patterns:['cross','bomb','charge'],count:3,repeats:2,tell:1.5,cooldown:4.7,xp:45,score:3200,color:'#dfb2ff'}),
 thunderEmperor:def('雷帝・黄金もち',15,6500,48,40,'boss',{kind:'boss',r:55,patterns:['sweep','charge','bomb','ring'],count:5,repeats:2,tell:1.5,cooldown:4.6,xp:50,score:4500,color:'#ffe89c'})
};
export const STAGES=[
 {at:0,name:'若葉の群れ',hint:'経験値を集めて、武器を育てよう',trash:['imp','orange'],pool:['imp','orange','ice'],elite:'eliteRam',boss:'oniKing',specials:3},
 {at:120,name:'赤角の進軍',hint:'突進は横へ。爆撃は赤い円から離れよう',trash:['thorn'],pool:['thorn','lancer','fanling','bomber'],elite:'eliteRam',boss:'oniKing',specials:5},
 {at:300,name:'影と氷の包囲',hint:'狙撃の線を避け、支援役を先に倒そう',trash:['skitter'],pool:['skitter','frostshot','prism','shaman'],elite:'eliteCrab',boss:'frostQueen',specials:7},
 {at:480,name:'幽境の砲火',hint:'二段目の突進に注意。投げられた爆弾は撃破後も落ちる',trash:['cinder'],pool:['cinder','reaver','artillery','wheel','wraith'],elite:'eliteSpecter',boss:'voidLord',specials:9},
 {at:720,name:'雷雲の襲来',hint:'十字砲は斜めへ。連射の狙いは固定',trash:['spark'],pool:['spark','stormling','sentinel','hexer','stalker'],elite:'eliteVolt',boss:'thunderEmperor',specials:11},
 {at:960,name:'終極の軍勢',hint:'多段の突進と掃射に注意。20分から水晶の軍勢が出現',trash:['night'],pool:['night','obsidian','tempest','oracle','phantom'],elite:'eliteVolt',boss:'thunderEmperor',specials:12},
 ...LATE_STAGES
];
export function stageAt(time){let index=0;while(index+1<STAGES.length&&time>=STAGES[index+1].at)index++;return {...STAGES[index],index};}
export function spawnStats(id,time){const stage=stageAt(time);id=id==='boss'?stage.boss:id==='elite'?stage.elite:id;const spec=ENEMIES[id]||ENEMIES.imp;return {species:id,kind:spec.kind||id,...spec};}
// Restore the pre-stage update's rising spawn tempo. Never drop a spawn because
// the specialist roster is full: fill that slot with this stage's own trash.
export function spawnTempo(time){const minutes=Math.max(0,time)/60;return {burst:Math.min(14,2+Math.floor(minutes*1.7)),interval:Math.max(.22,.86-minutes*.038)};}
export function pickTrash(g){const pool=stageAt(g.time).trash;return pool[Math.min(pool.length-1,Math.floor(g.rng()*pool.length))];}
export function pickSpecies(g){const stage=stageAt(g.time);if(stage.index===0){const roll=g.rng();return g.time<35?'imp':g.time<75?(roll<.7?'imp':'orange'):roll<.55?'imp':roll<.86?'orange':'ice';}if(g.rng()<.8)return pickTrash(g);const pool=stage.pool.filter(id=>!stage.trash.includes(id));return pool[Math.min(pool.length-1,Math.floor(g.rng()*pool.length))];}
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const special=e=>!['chase','hop','flank'].includes(e.pattern);
export function canSpawn(g,id){
 const spec=ENEMIES[id];if(!spec||spec.kind||!special(spec))return true;
 const stage=stageAt(g.time),live=g.enemies.filter(e=>!e.dead&&!e.retired&&!['elite','boss'].includes(e.kind)&&special(e));
 const types=stage.pool.filter(id=>special(ENEMIES[id])).length,perType=Math.ceil(stage.specials/Math.max(1,types));
 return live.length<stage.specials&&live.filter(e=>e.species===id).length<perType;
}
function line(x,y,angle,length,width){return {shape:'line',x,y,angle,length,width};}
function circles(e,p,count){return Array.from({length:Math.min(3,count)},(_,i)=>({shape:'circle',x:p.x+(i===1?-132:i===2?132:0),y:p.y+(i===0?0:45),r:e.kind==='boss'?78:62}));}
function fanPaths(e,a,n,spread=.22){return Array.from({length:n},(_,i)=>line(e.x,e.y,a+(i-(n-1)/2)*spread,520,9));}
function beginAttack(g,e,pattern){
 const p=g.player,angle=Math.atan2(p.y-e.y,p.x-e.x);let paths=[],count=e.count||3,rounds=1;
 if(['charge','flankCharge'].includes(pattern))paths=[line(e.x,e.y,angle,300,e.r+5)];
 else if(pattern==='bomb')paths=circles(e,p,count);
 else if(pattern==='snipe')paths=[line(e.x,e.y,angle,700,12)];
 else if(pattern==='cross')paths=[line(p.x-280,p.y,0,560,14),line(p.x,p.y-280,Math.PI/2,560,14)];
 else if(pattern==='ring'){
  // A clearly telegraphed 100-degree escape wedge is never filled by this attack.
  const gap=angle+((e.attackIndex%3)-1)*.7,n=e.kind==='boss'?18:count;
  for(let i=0;i<n;i++){const a=i/n*TAU;if(Math.abs(angleDiff(a,gap))>.88)paths.push(line(e.x,e.y,a,470,9));}
 }else if(pattern==='support')paths=[{shape:'circle',x:e.x,y:e.y,r:170,support:true}];
 else {const n=pattern==='burst'?1:count;paths=fanPaths(e,angle,n,pattern==='sweep'?.25:.23);rounds=['burst','burstFan','sweep'].includes(pattern)?3:1;}
 const sequence=SEQUENCE_PATTERNS.includes(pattern);if(sequence)paths=sequencePaths(e,p,pattern);
 const tell=sequence?Math.min(...paths.map(path=>path.fireAt)):e.tellDuration||e.tell||1.2,t={id:g.nextId++,owner:e.id,attack:{name:e.name,pattern},pattern,paths,delay:tell,maxDelay:tell,life:.24,rounds,nextRound:0,damage:e.damage*(e.kind==='boss'?1.25:1.15),fired:false,color:e.color};
 if(sequence){Object.assign(t,{sequence:true,age:0,duration:Math.max(...paths.map(path=>path.fireAt+path.duration))});e.sequencing=t.id;}
 const continuing=e.continuation;if(['charge','flankCharge'].includes(pattern)){if(!continuing)e.chargesLeft=Math.max(0,(e.repeats||1)-1);e.continuation=false;}if(!continuing)e.attackIndex++;e.tell=tell;e.attackIn=(e.cooldown||6)+g.rng()*1.2+(sequence?t.duration:0);e.attacking=t.id;e.lastAttackAt=g.time;g.threats.push(t);g.nextThreatAt=g.time+.75;
 return t;
}
export function prepareArrival(g,e){
 // A visible portal bomber winds up while arriving, then throws on emergence.
 // The player gets the full arrival + landing warning, with a fixed target.
 if(!e.portal||e.pattern!=='bomb'||g.time<g.nextThreatAt||g.threats.length>=2||g.threats.some(t=>groundPattern(t.pattern)))return;
 const t=beginAttack(g,e,'bomb');t.delay+=e.spawnIn;t.maxDelay=t.delay;t.arrival=true;t.arrivalLeft=e.spawnIn;e.tell=t.delay;
}
export function updateEnemyAI(g,e,dt){
 const p=g.player,dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;let speed=e.speed*(e.slow>0?e.slowFactor:1)*(e.boostUntil>g.time?1.15:1),vx=dx/d,vy=dy/d;
 e.attackIn-=dt;e.tell=Math.max(0,e.tell-dt);e.attackFlash=Math.max(0,(e.attackFlash||0)-dt);
 if(e.sequencing&&g.threats.some(t=>t.id===e.sequencing&&!t.done)){e.knockX*=Math.max(0,1-dt*10);e.knockY*=Math.max(0,1-dt*10);return;}
 if(e.dash>0){const ox=e.x,oy=e.y;e.dash=Math.max(0,e.dash-dt);e.x+=e.dashX*dt;e.y+=e.dashY*dt;const sx=e.x-ox,sy=e.y-oy,t=Math.max(0,Math.min(1,((p.x-ox)*sx+(p.y-oy)*sy)/(sx*sx+sy*sy||1)));if((p.x-ox-sx*t)**2+(p.y-oy-sy*t)**2<(e.r+p.r)**2)g.damagePlayer(e.damage*1.3,'attack',{name:e.name,pattern:'charge'});if(!e.dash&&e.chargesLeft>0){e.chargesLeft--;e.attackIn=.8;e.continuation=true;}return;}
 const pattern=e.continuation?'charge':e.patterns?.length?e.patterns[e.attackIndex%e.patterns.length]:e.pattern;
 if(e.tell>0)speed=0;
 else if(['fan','burst','burstFan','snipe','bomb','cross','ring','sweep','support',...SEQUENCE_PATTERNS].includes(pattern)&&d<280)speed=d<190?-speed*.55:0;
 else if(['flank','flankFan','flankCharge'].includes(pattern)){const side=e.id%2?1:-1,a=Math.atan2(dy,dx)+side*(d<340?.85:.35);vx=Math.cos(a);vy=Math.sin(a);}
 else if(pattern==='hop')speed*=.75+.35*Math.max(0,Math.sin(g.time*4+e.id));
 e.x+=vx*speed*dt+e.knockX*dt;e.y+=vy*speed*dt+e.knockY*dt;e.knockX*=Math.max(0,1-dt*10);e.knockY*=Math.max(0,1-dt*10);
 const onScreen=Math.abs(e.x-p.x)<g.viewport.width*.5-32&&Math.abs(e.y-p.y)<g.viewport.height*.5-45;
 // Major attacks take turns. Ground attacks cannot stack on the same player position.
 if(special(e)&&e.attackIn<=0&&!e.tell&&onScreen&&g.time>=g.nextThreatAt&&g.threats.filter(t=>!t.done).length<2){
  const ground=groundPattern(pattern);if(ground&&g.threats.some(t=>groundPattern(t.pattern)&&!t.done))return;
  beginAttack(g,e,pattern);
 }
}
function fireAttack(g,t,e){
 e.attackFlash=.3;
 if(['charge','flankCharge'].includes(t.pattern)){const path=t.paths[0];e.dash=.75;e.dashX=Math.cos(path.angle)*400;e.dashY=Math.sin(path.angle)*400;t.life=.75;}
 else if(['bomb','cross','snipe'].includes(t.pattern)){t.life=.24;}
 else if(t.pattern==='support'){for(const other of g.enemies)if(!other.dead&&d2(other,e)<170**2)other.boostUntil=g.time+3.5;t.life=.45;}
 else for(const path of t.paths)g.addHostile(path.x,path.y,Math.cos(path.angle)*195,Math.sin(path.angle)*195,8,t.damage,t.attack);
}
export function updateThreats(g,dt){
 let moved=false;
 for(const t of g.threats){
  if(t.done)continue;const alive=g.enemies.find(e=>e.id===t.owner&&!e.dead&&!e.retired),e=alive||(t.released?t.caster:null);if(!e||alive&&e.spawnIn>0&&!t.arrival){t.done=true;continue;}
  if(t.sequence){moved=updateSequence(g,t,e,dt)||moved;continue;}
  let justFired=false;if(t.delay>0){t.delay-=dt;if(t.arrival){t.arrivalLeft-=dt;e.tell=Math.max(0,t.delay);}if(t.pattern==='bomb'&&(t.arrival?t.arrivalLeft<=0:t.delay<=.6)&&!t.released){t.released=true;t.flightDuration=t.delay;t.caster=e;t.releaseX=e.x;t.releaseY=e.y;}if(['charge','flankCharge'].includes(t.pattern)){t.paths[0].x=e.x;t.paths[0].y=e.y;}if(t.delay>0)continue;t.fired=true;justFired=true;fireAttack(g,t,e);t.rounds--;t.nextRound=.22;}
  else if(t.rounds>0){t.nextRound-=dt;if(t.nextRound<=0){fireAttack(g,t,e);t.rounds--;t.nextRound=.22;}}
  if(t.rounds<=0&&!justFired)t.life-=dt;
  if(t.fired&&['bomb','cross','snipe'].includes(t.pattern)&&t.life>0){for(const path of t.paths){const p=g.player;let hit=false;if(path.shape==='circle')hit=d2(p,path)<(path.r+p.r*.6)**2;else{const dx=p.x-path.x,dy=p.y-path.y,along=dx*Math.cos(path.angle)+dy*Math.sin(path.angle),across=-dx*Math.sin(path.angle)+dy*Math.cos(path.angle);hit=along>-p.r&&along<path.length+p.r&&Math.abs(across)<path.width+p.r*.6;}if(hit)g.damagePlayer(t.damage,'attack',t.attack);}}
  if(t.life<=0){t.done=true;e.attacking=null;}
 }
 g.threats=g.threats.filter(t=>!t.done);
 // Sequence dashes move after the normal enemy pass: refresh broad-phase cells
 // before player projectiles query them, especially for large bosses.
 if(moved)g.grid.build(g.enemies);
}
