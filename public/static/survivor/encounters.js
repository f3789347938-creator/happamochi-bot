import {stageAt} from './enemies.js';
const sq=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const DEFINITIONS={treasure:{name:'宝もちを追え',hint:'逃げる宝もちを倒すと20コイン',duration:24},commander:{name:'精鋭の護衛隊',hint:'指揮官を倒して護衛を連鎖爆破',duration:42},trap:{name:'危険な宝箱',hint:'近づいて「挑む」で開封。見送ってもOK',duration:30}};
export function initEncounters(g){g.encounter=null;g.encounterNext=50;g.encounterIndex=0;g.eventChain=[];g.encounterStats={treasures:0,commanders:0,traps:0};}
function troop(g,event,role,x,y){
 if(g.enemies.filter(e=>!e.dead&&!e.retired).length>=317)return null;
 const id=stageAt(g.time).trash[0],e=g.spawnEnemy(id,{x,y});if(!e)return null;
 e.eventId=event.id;e.eventRole=role;e.spawnIn=1.5;e.portal=true;
 if(role==='treasure'){e.name='宝もち';e.sprite=25;e.hp=e.maxHp=45+Math.min(5,stageAt(g.time).index)*25;e.speed=122;e.damage=5;e.score=80;e.xp=5;}
 if(role==='commander'){e.name='護衛隊の指揮官';e.sprite=19;e.hp=e.maxHp=100+Math.min(5,stageAt(g.time).index)*60;e.r=28;e.speed=55;e.score=150;e.xp=8;}
 if(role==='guard'){e.name='護衛もち兵';e.hp=e.maxHp=Math.min(150,e.hp*1.25);e.score+=10;}
 event.ids.push(e.id);return e;
}
export function startEncounter(g,kind){
 if(g.encounter||!DEFINITIONS[kind]||g.enemies.length>309||g.mode!=='playing')return false;
 const def=DEFINITIONS[kind],a=g.rng()*Math.PI*2,range=Math.min(220,g.viewport.width*.34),x=g.player.x+Math.cos(a)*range,y=g.player.y+Math.sin(a)*range;
 const event={id:g.nextId++,kind,...def,x,y,until:g.time+def.duration,ids:[],killed:[],state:kind==='trap'?'offered':'active'};
 if(kind==='treasure')troop(g,event,'treasure',x,y);
 if(kind==='commander'){const commander=troop(g,event,'commander',x,y);event.commander=commander?.id;for(let i=0;i<4;i++){const a=i*Math.PI/2;troop(g,event,'guard',x+Math.cos(a)*65,y+Math.sin(a)*65);}}
 g.encounter=event;g.emit('encounter',{name:event.name,hint:event.hint});return true;
}
export function acceptTrap(g){
 const e=g.encounter;if(g.mode!=='playing'||!e||e.kind!=='trap'||e.state!=='offered'||sq(e,g.player)>100**2||g.enemies.length>309)return false;
 e.state='active';e.until=g.time+36;e.hint='宝箱の護衛をすべて倒そう';
 for(let i=0;i<6;i++){const a=i*Math.PI/3;troop(g,e,'guard',e.x+Math.cos(a)*130,e.y+Math.sin(a)*130);}
 if(!e.ids.length){e.state='offered';return false;}g.emit('encounter',{name:'宝箱の護衛、襲来',hint:'護衛 '+e.ids.length+'体を倒すと35コイン'});return true;
}
function finish(g,success){const e=g.encounter;if(!e)return;
 if(success){const field={treasure:'treasures',commander:'commanders',trap:'traps'}[e.kind];g.encounterStats[field]++;const coins=e.kind==='trap'?35:e.kind==='treasure'?20:15;g.coins+=coins;g.emit('encounterDone',{name:e.kind==='treasure'?'宝もちを捕まえた！':e.kind==='trap'?'宝箱を開封！':'護衛隊を撃破！',coins});g.effects.celebrate(e.x,e.y);}
 else g.emit('encounterGone',{name:e.kind==='treasure'?'宝もちは逃げてしまった':e.state==='offered'?'宝箱を見送った':'護衛隊との戦いは終了'});
 for(const enemy of g.enemies)if(enemy.eventId===e.id){if(enemy.eventRole==='treasure'&&!enemy.dead)enemy.retired=true;delete enemy.eventRole;delete enemy.eventId;}
 g.encounter=null;g.encounterNext=g.time+65+g.rng()*25;
}
export function encounterKill(g,enemy){const e=g.encounter;if(!e||e.id!==enemy.eventId||e.killed.includes(enemy.id))return;e.killed.push(enemy.id);
 if(e.kind==='treasure'){finish(g,true);return;}
 if(e.kind==='commander'&&enemy.id===e.commander){e.state='chain';e.hint='護衛が連鎖爆発！';let i=0;for(const guard of g.enemies)if(guard.eventId===e.id&&guard.id!==enemy.id&&!guard.dead)g.eventChain.push({id:guard.id,at:g.time+.16*++i});if(!i)finish(g,true);}
 else if(e.kind==='trap'&&e.ids.every(id=>e.killed.includes(id)))finish(g,true);
}
export function updateEncounters(g,dt){
 if(g.time>=g.encounterNext&&!g.encounter&&g.enemies.length<=309){const kinds=['treasure','commander','trap'];if(startEncounter(g,kinds[g.encounterIndex%3]))g.encounterIndex++;}
 const event=g.encounter;if(!event)return;
 if(event.kind==='treasure'){const e=g.enemies.find(e=>e.id===event.ids[0]);if(e&&!e.dead){event.x=e.x;event.y=e.y;if(e.spawnIn<=0){const a=Math.atan2(e.y-g.player.y,e.x-g.player.x)+Math.sin(g.time*2)*.22;e.x+=Math.cos(a)*e.speed*dt;e.y+=Math.sin(a)*e.speed*dt;}}}
 const due=g.eventChain.filter(c=>c.at<=g.time);g.eventChain=g.eventChain.filter(c=>c.at>g.time);
 for(const link of due){const guard=g.enemies.find(e=>e.id===link.id);if(guard&&!guard.dead){guard.spawnIn=0;g.withAttack('eventChain',()=>{g.damageEnemy(guard,guard.hp/g.power()+1,{weapon:'eventChain'});g.blast(guard.x,guard.y,130,100,{weapon:'eventChain',color:'#ffdc77'});});}}
 if(event.state==='chain'&&!g.eventChain.length){finish(g,true);return;}
 if(event.until<=g.time||sq(event,g.player)>1400**2){finish(g,false);return;}
 if(event.state==='active'&&event.ids.some(id=>!event.killed.includes(id)&&!g.enemies.some(e=>e.id===id&&!e.retired))){finish(g,false);}
}
export function encounterInfo(g){const e=g.encounter;if(!e)return null;return {...e,remaining:Math.ceil(Math.max(0,e.until-g.time)),canOpen:e.kind==='trap'&&e.state==='offered'&&sq(e,g.player)<=100**2&&g.enemies.length<=309,remainingGuards:e.ids.length-e.killed.length};}
