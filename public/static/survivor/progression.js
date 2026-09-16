import {reportOf} from './records.js';
import {AURAS} from './cosmetics.js';
import {HEROES,HERO_BY_ID} from './heroes.js';
export const SAVE_KEY='mochi-survivor-progress-v1';
export const QUALITY=['ノーマル','グッド','ベター','エクセレント','エピック','レジェンド'];
export const WEAPON_IDS=['kunai','bat','katana','shotgun','revolver','lightchaser','void','sword','twinLance'];
export const TECHS=[{id:'drone',name:'精密誘導',desc:'ドローンのミサイルが敵を追尾。',icon:'army'},{id:'laser',name:'減速光線',desc:'レーザーに減速効果。',icon:'blizzard'},{id:'brick',name:'貫通レンガ',desc:'未進化のレンガも敵を貫く。',icon:'giant'},{id:'boomerang',name:'高速回収',desc:'戻ったブーメランをすぐに再発射。',icon:'bounce'},{id:'durian',name:'近距離周回',desc:'ドリアンが近くを跳ね回る。',icon:'orbit'},{id:'drill',name:'双矢の設計',desc:'赤まで強化すると、進化した矢が2本になる。',icon:'pierce'}];
const basicHeroes=['common','catnips','tsukuyomi','worm','wesson','king','yelena'];
const sHeroes=['yang','metallia','joey','taloxa','venato'];
export const heroGate=id=>id==='common'?1:basicHeroes.includes(id)?2:sHeroes.includes(id)?6:5;
export const shardCost=id=>sHeroes.includes(id)?120:80;
export const rankOf=p=>1+Math.min(29,Math.floor(Math.sqrt(p.xp/100)));
export const nextRankXP=p=>rankOf(p)**2*100;
export const skillGate=id=>['laser','durian'].includes(id)?4:id==='mine'?10:1;
export const skillLocks=p=>['laser','durian','mine'].filter(id=>rankOf(p)<skillGate(id));
export const levelCost=item=>({coins:Math.round(30*item.level*(1+Math.max(0,item.level-10)/15)**1.35),designs:1+Math.floor(item.level/5)});
export const heroLevelCost=item=>({coins:Math.round(25*item.level*(1+Math.max(0,item.level-10)/15)**1.35),essence:1+Math.floor(item.level/5)});
export const mergeCopies=tier=>[2,3,3,5,8][tier]??Infinity;
export const starCost=stars=>[0,20,40,80,120,200][stars]??Infinity;
export const growth=(level,early,middle,late)=>Math.min(9,Math.max(0,level-1))*early+Math.min(20,Math.max(0,level-10))*middle+Math.min(30,Math.max(0,level-30))*late;
export const weaponBonus=level=>growth(level,.04,.008,.004);
export const heroBonus=level=>growth(level,.02,.005,.0025);
export const healthBonus=level=>Math.round(growth(level,3,1.5,.75));
export const starCoins=stars=>200*stars*stars;
const int=(n,max=1e9)=>Number.isFinite(+n)?Math.min(max,Math.max(0,Math.floor(+n))):0;
export function freshProfile(){return {version:1,coins:0,designs:0,essence:0,parts:0,cores:0,crates:0,xp:0,totalKills:0,bossKills:0,runs:0,bestScore:0,bestSeconds:0,weapons:{kunai:{level:1,tier:0,copies:0}},heroes:{common:{level:1,stars:1,awakening:0}},shards:{},tech:{},equippedTech:[],forge:{e:0,v:0},selectedWeapon:'kunai',selectedHero:'common',recruit:'catnips',aimAssist:true,claims:[],auras:['mint'],selectedAura:'mint',active:null,lastReceipt:null};}
export function sanitize(raw){const p=freshProfile();if(!raw||raw.version!==1)return p;for(const k of ['coins','designs','essence','parts','cores','crates','xp','totalKills','bossKills','runs','bestScore','bestSeconds'])p[k]=int(raw[k]);
 for(const id of WEAPON_IDS){const w=raw.weapons?.[id];if(w&&typeof w==='object')p.weapons[id]={level:Math.max(1,int(w.level,60)),tier:int(w.tier,5),copies:int(w.copies)};}
 for(const h of HEROES.filter(h=>h.available!==false)){const a=raw.heroes?.[h.id];if(a&&typeof a==='object')p.heroes[h.id]={level:Math.max(1,int(a.level,60)),stars:Math.max(1,int(a.stars,6)),awakening:int(a.stars,6)===6?int(a.awakening,6):0};p.shards[h.id]=int(raw.shards?.[h.id]);}
 for(const t of TECHS)if(raw.tech?.[t.id])p.tech[t.id]=Math.max(1,int(raw.tech[t.id],2));p.equippedTech=[...new Set((Array.isArray(raw.equippedTech)?raw.equippedTech:[]).filter(id=>p.tech[id]))].slice(0,6);
 p.selectedWeapon=p.weapons[raw.selectedWeapon]?raw.selectedWeapon:'kunai';p.selectedHero=p.heroes[raw.selectedHero]?raw.selectedHero:'common';p.recruit=HERO_BY_ID[raw.recruit]?.available!==false&&HERO_BY_ID[raw.recruit]&&heroGate(raw.recruit)<=rankOf(p)?raw.recruit:'catnips';p.aimAssist=raw.aimAssist!==false;p.claims=Array.isArray(raw.claims)?[...new Set(raw.claims.filter(x=>typeof x==='string'))].slice(0,100):[];p.forge={e:int(raw.forge?.e,5),v:int(raw.forge?.v,5)};
 p.auras=[...new Set(['mint',...(Array.isArray(raw.auras)?raw.auras:[]).filter(id=>AURAS.some(a=>a.id===id))])];p.selectedAura=p.auras.includes(raw.selectedAura)?raw.selectedAura:'mint';
 if(raw.active&&typeof raw.active.id==='string')p.active={id:raw.active.id,hero:p.heroes[raw.active.hero]?raw.active.hero:'common',weapon:p.weapons[raw.active.weapon]?raw.active.weapon:'kunai',stats:runStats(raw.active.stats),account:typeof raw.active.account==='string'?raw.active.account:null,ranked:raw.active.ranked===true,mode:raw.active.mode==='challenge'?'challenge':'normal',report:raw.active.report?reportOf(raw.active.report):null};
 if(raw.lastReceipt&&typeof raw.lastReceipt.id==='string')p.lastReceipt=raw.lastReceipt;return p;
}
export const runStats=s=>Object.fromEntries(['coins','kills','bossKills','seconds','score'].map(k=>[k,int(s?.[k])]));
export const MISSIONS=[
 {id:'first',name:'はじめての帰還',detail:'最初の冒険を終える',value:p=>p.runs,target:1,reward:{coins:100,designs:3},label:'100コイン・設計図3枚'},
 {id:'fifty',name:'新しい武器',detail:'敵を累計50体倒す',value:p=>p.totalKills,target:50,reward:{weapon:'bat'},label:'野球バットを獲得'},
 {id:'minute',name:'逃げ切る力',detail:'1回の冒険で60秒生き残る',value:p=>p.bestSeconds,target:60,reward:{hero:'catnips',shards:40,coins:100},label:'キティースの欠片40個・100コイン'},
 {id:'twohundred',name:'新しい仲間',detail:'敵を累計200体倒す',value:p=>p.totalKills,target:200,reward:{hero:'catnips',shards:40},label:'キティースの欠片40個'},
 {id:'boss',name:'初めてのボス撃破',detail:'ボスを1体倒す',value:p=>p.bossKills,target:1,reward:{crates:2,parts:10},label:'装備箱2個・科学パーツ10個'},
 {id:'three',name:'3分の壁',detail:'1回の冒険で180秒生き残る',value:p=>p.bestSeconds,target:180,reward:{coins:300,crates:2},label:'300コイン・装備箱2個'},
 {id:'thousand',name:'軍団の先頭へ',detail:'敵を累計1,000体倒す',value:p=>p.totalKills,target:1000,reward:{coins:500,cores:5,parts:10},label:'500コイン・コア5個・科学パーツ10個'},
];
export function nextMission(p){return MISSIONS.find(m=>!p.claims.includes(m.id));}
function grantWeapon(p,id){const w=p.weapons[id];if(w){w.copies++;return false;}p.weapons[id]={level:1,tier:['lightchaser','void','sword'].includes(id)?3:id==='twinLance'?5:0,copies:0};return true;}
export function loadout(p){const h=p.heroes[p.selectedHero]||p.heroes.common,w=p.weapons[p.selectedWeapon]||p.weapons.kunai;return {weapon:p.selectedWeapon,options:{encounters:true,hero:p.selectedHero,heroStars:h.stars,awakening:h.awakening,weaponGrade:w.tier>=5?'legendary':w.tier>=3?'excellent':'normal',aimAssist:p.aimAssist,tech:p.equippedTech,techRanks:p.tech,techGrade:'purple',forgeE:p.selectedWeapon==='twinLance'?p.forge.e:0,forgeV:p.selectedWeapon==='twinLance'?p.forge.v:0,metaPower:weaponBonus(w.level)+heroBonus(h.level),metaHP:healthBonus(h.level),aura:p.selectedAura,lockedSkills:skillLocks(p)}};}
export class Progression{
 constructor(storage,rng=Math.random){this.storage=storage;this.rng=rng;this.volatile=false;this.notice='';this.p=freshProfile();this.refresh();}
 refresh(){if(this.volatile)return this.p;try{const raw=this.storage?.getItem(SAVE_KEY);if(raw){const parsed=JSON.parse(raw);if(parsed?.version!==1)throw Error('unsupported save');this.p=sanitize(parsed);}}catch{this.notice='保存データを読み込めません。この画面を閉じると進行が失われる場合があります。';this.volatile=true;}return this.p;}
 save(){if(this.volatile)return false;try{if(!this.storage)throw Error();this.storage.setItem(SAVE_KEY,JSON.stringify(this.p));return true;}catch{this.volatile=true;this.notice='保存できません。この画面を閉じると進行が失われます。';return false;}}
 begin(id,mode='normal',ranked=false,account=null){this.refresh();if(this.p.active)return {ok:false,message:'別の冒険が進行中です。ホームに戻って確認してください。'};this.p.active={id,mode,ranked,account,hero:this.p.selectedHero,weapon:this.p.selectedWeapon,stats:runStats({})};this.save();return {ok:true,...loadout(this.p)};}
 checkpoint(id,stats){this.refresh();const a=this.p.active;if(!a||a.id!==id)return false;const incoming=runStats(stats);a.report=reportOf(stats);for(const k of Object.keys(incoming))a.stats[k]=Math.max(a.stats[k],incoming[k]);this.save();return true;}
 finish(id){this.refresh();const p=this.p,a=p.active;if(!a||a.id!==id)return p.lastReceipt?.id===id?p.lastReceipt:null;const s=a.stats,oldKills=p.totalKills,oldRank=rankOf(p),started=s.seconds>=1||s.kills>0;
 const receipt={id,account:a.account||null,ranked:!!a.ranked,mode:a.mode||'normal',report:a.report||null,coins:s.coins,designs:Math.floor(s.kills/80)+s.bossKills*3,essence:Math.floor(s.kills/100)+s.bossKills,parts:Math.floor((oldKills+s.kills)/500)-Math.floor(oldKills/500)+s.bossKills*2,cores:s.bossKills,crates:Math.floor((oldKills+s.kills)/500)-Math.floor(oldKills/500)+s.bossKills,hero:p.recruit,shards:(Math.floor((oldKills+s.kills)/50)-Math.floor(oldKills/50))*5,oldRank};
 for(const k of ['coins','designs','essence','parts','cores','crates'])p[k]=Math.min(1e9,p[k]+receipt[k]);p.shards[p.recruit]=(p.shards[p.recruit]||0)+receipt.shards;p.xp+=s.kills+s.bossKills*100;p.totalKills+=s.kills;p.bossKills+=s.bossKills;if(started)p.runs++;if(a.mode!=='challenge')p.bestScore=Math.max(p.bestScore,s.score);p.bestSeconds=Math.max(p.bestSeconds,s.seconds);receipt.rank=rankOf(p);p.active=null;p.lastReceipt=receipt;this.save();return receipt;}
 recover(){this.refresh();return this.p.active?this.finish(this.p.active.id):null;}
 action(type,id){this.refresh();const p=this.p,rank=rankOf(p),fail=message=>({ok:false,message});if(p.active)return fail('育成や装備変更は冒険から戻ってからできます。');let message='';
 if(type==='claim'){const m=MISSIONS.find(m=>m.id===id);if(!m||p.claims.includes(id)||m.value(p)<m.target)return fail('まだ条件を達成していません。');p.claims.push(id);for(const k of ['coins','designs','essence','parts','cores','crates'])p[k]+=m.reward[k]||0;if(m.reward.weapon)grantWeapon(p,m.reward.weapon);if(m.reward.hero)p.shards[m.reward.hero]=(p.shards[m.reward.hero]||0)+m.reward.shards;message=m.label;}
 else if(type==='equip'){if(!p.weapons[id])return fail('まだ持っていない武器です。');p.selectedWeapon=id;message='武器を装備しました。';}
 else if(type==='weapon-level'){const w=p.weapons[id];if(!w)return fail('武器を入手すると強化できます。');const cost=levelCost(w),cap=10*(w.tier+1);if(w.level>=cap)return fail('品質を上げると、さらに強化できます。');if(p.coins<cost.coins||p.designs<cost.designs)return fail('コインか設計図が足りません。');p.coins-=cost.coins;p.designs-=cost.designs;w.level++;message='武器がLv.'+w.level+'に成長！';}
 else if(type==='merge'){const w=p.weapons[id],need=w?mergeCopies(w.tier):Infinity;if(!w||w.copies<need)return fail('合成に必要な同名装備が足りません。');w.copies-=need;w.tier++;message=QUALITY[w.tier]+'に合成！';}
 else if(type==='crate'){if(p.crates<1)return fail('装備箱がありません。');p.crates--;const pool=WEAPON_IDS.filter(w=>w!=='twinLance'&&(rank>=5||!['lightchaser','void','sword'].includes(w)));const weapon=pool[Math.min(pool.length-1,Math.floor(this.rng()*pool.length))];const isNew=grantWeapon(p,weapon);this.save();return {ok:true,weapon,isNew,message:isNew?'新しい武器を獲得！':'同名装備を獲得。合成に使えます。'};}
 else if(type==='recruit'){if(!HERO_BY_ID[id]||HERO_BY_ID[id].available===false||heroGate(id)>rank)return fail('この仲間の募集は、さらに進むと解放されます。');p.recruit=id;message='以降の冒険で、この仲間の欠片を集めます。';}
 else if(type==='hero-unlock'){if(!HERO_BY_ID[id]||HERO_BY_ID[id].available===false||p.heroes[id]||heroGate(id)>rank||(p.shards[id]||0)<shardCost(id))return fail('解放に必要な欠片か探索ランクが足りません。');p.shards[id]-=shardCost(id);p.heroes[id]={level:1,stars:1,awakening:0};message=HERO_BY_ID[id].name+'が仲間になった！';}
 else if(type==='hero-equip'){if(!p.heroes[id])return fail('仲間にすると選べます。');p.selectedHero=id;message='出撃する仲間を変更しました。';}
 else if(type==='hero-level'){const h=p.heroes[id];if(!h)return fail('まだ仲間になっていません。');const c=heroLevelCost(h);if(h.level>=Math.min(60,rank*5))return fail('探索ランクを上げると、さらに成長できます。');if(p.coins<c.coins||p.essence<c.essence)return fail('コインかエナジーが足りません。');p.coins-=c.coins;p.essence-=c.essence;h.level++;message='仲間がLv.'+h.level+'に成長！';}
 else if(type==='aura'){const a=AURAS.find(a=>a.id===id);if(!a)return fail('この演出は選べません。');if(!p.auras.includes(id)){if(p.coins<a.cost)return fail('コインが足りません。');p.coins-=a.cost;p.auras.push(id);}p.selectedAura=id;message=a.name+'を装備しました。';}
 else if(type==='star'){const h=p.heroes[id],need=h?starCost(h.stars):Infinity;if(!h||(p.shards[id]||0)<need||p.coins<starCoins(h.stars))return fail('この仲間の欠片かコインが足りません。');p.coins-=starCoins(h.stars);p.shards[id]-=need;h.stars++;message='キャラが'+h.stars+'★に成長！';}
 else if(type==='awaken'){const h=p.heroes[id],need=h?80+h.awakening*40:Infinity;if(!h||h.stars<6||h.awakening>=6||(p.shards[id]||0)<need||p.cores<5+h.awakening*3)return fail('6★の仲間・欠片・覚醒コアが必要です。');p.shards[id]-=need;p.cores-=5+h.awakening*3;h.awakening++;message='覚醒'+h.awakening+'に到達！';}
 else if(type==='tech'){const t=TECHS.find(t=>t.id===id),level=p.tech[id]||0,red=id==='drill',parts=red?60:10,coins=red?1000:200;if(!t||rank<(red?8:4)||level>=2||level&&!red||p.parts<parts||p.coins<coins)return fail('解放条件か強化素材が足りません。');p.parts-=parts;p.coins-=coins;p.tech[id]=red?2:1;if(!p.equippedTech.includes(id))p.equippedTech.push(id);message=level?'科学技術がレジェンドに成長！':'科学技術を開発・装備しました。';}
 else if(type==='tech-equip'){if(!p.tech[id])return fail('開発すると装備できます。');p.equippedTech=p.equippedTech.includes(id)?p.equippedTech.filter(x=>x!==id):[...p.equippedTech,id].slice(0,6);message='科学技術の装備を変更しました。';}
 else if(type==='ss'){if(p.weapons.twinLance||rank<8||!Object.values(p.weapons).some(w=>w.tier>=5)||p.coins<3000||p.cores<30)return fail('ランク8・レジェンド装備・3000コイン・コア30個が必要です。');p.coins-=3000;p.cores-=30;grantWeapon(p,'twinLance');message='Twin Lanceを鍛造！';}
 else if(type==='forge'){if(!['e','v'].includes(id)||!p.weapons.twinLance||p.forge[id]>=5)return fail('SS武器を鍛造すると強化できます。');const need=5+p.forge[id]*3;if(p.cores<need||p.coins<1000)return fail('1000コインとコア'+need+'個が必要です。');p.coins-=1000;p.cores-=need;p.forge[id]++;message='神器鋳造 '+p.forge[id]+'に強化！';}
 else if(type==='assist'){p.aimAssist=!p.aimAssist;message=p.aimAssist?'照準アシストON':'照準アシストOFF';}
 else return fail('操作を確認できませんでした。');this.save();return {ok:true,message};
 }
}
