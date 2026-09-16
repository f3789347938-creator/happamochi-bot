// Shared definitions for the game, account records and weekly competition.
export const RULESET='endless-depth-2';
export const ACHIEVEMENTS=[
 {id:'survive3',name:'はじまりの冒険者',detail:'1回の出撃で3分生存',field:'seconds',target:180,title:'若葉の冒険者',outfit:'explorer'},
 {id:'survive15',name:'十五分の猛者',detail:'1回の出撃で15分生存',field:'seconds',target:900,title:'不屈のもち',effect:'aurora'},
 {id:'cleanBoss',name:'華麗なる討伐',detail:'ボス出現から撃破まで体力ダメージなし',field:'cleanBosses',target:1,title:'無傷の剣舞',outfit:'ninja'},
 {id:'burst50',name:'軍団をひと飲み',detail:'1回の攻撃で50体撃破',field:'maxAttackKills',target:50,title:'一網打尽',effect:'gold'},
 {id:'treasure3',name:'お宝の嗅覚',detail:'宝もちを累計3体倒す',field:'treasures',target:3,cumulative:true,title:'お宝ハンター',effect:'petal'},
 {id:'commander3',name:'指揮官キラー',detail:'護衛隊を累計3回攻略',field:'commanders',target:3,cumulative:true,title:'連鎖の達人'},
 {id:'trap3',name:'危険もごちそう',detail:'危険な宝箱を累計3回攻略',field:'traps',target:3,cumulative:true,title:'命知らず'},
 {id:'boss10',name:'もち軍団の王',detail:'ボスを累計10体倒す',field:'bossKills',target:10,cumulative:true,title:'もちの王',outfit:'royal'},
];
export const OUTFITS=[{id:'default',name:'いつものもち',sprite:0},{id:'ninja',name:'月影の忍装束',sprite:22},{id:'royal',name:'王様のマント',sprite:23},{id:'explorer',name:'探検隊の制服',sprite:24}];
export const KILL_EFFECTS=[{id:'default',name:'いつもの光',color:'#e5b9ff'},{id:'petal',name:'桜のきらめき',color:'#ff9cd4'},{id:'aurora',name:'極光の余韻',color:'#7beeff'},{id:'gold',name:'黄金の閃光',color:'#ffdf79'}];
export const SCALAR_FIELDS=['score','coins','kills','bossKills','seconds','level','maxCombo','cleanBosses','maxAttackKills','treasures','commanders','traps'];
const bounded=(n,max=1e9)=>Number.isFinite(+n)?Math.max(0,Math.min(max,+n)):0;
export function reportOf(raw={}){
 const report=Object.fromEntries(SCALAR_FIELDS.map(k=>[k,bounded(raw[k])]));
 report.weapons=Object.entries(raw.weapons||{}).filter(([id,v])=>/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(id)&&v&&typeof v==='object').slice(0,100).map(([id,v])=>[id,{damage:bounded(v.damage,1e12),kills:Math.floor(bounded(v.kills))}]);
 report.weapons=Object.fromEntries(report.weapons);
 report.lastAttack=raw.lastAttack?{name:String(raw.lastAttack.name||'敵の攻撃').slice(0,40),pattern:String(raw.lastAttack.pattern||'contact').slice(0,30),damage:bounded(raw.lastAttack.damage,1e4)}:null;
 report.mainWeapon=String(raw.mainWeapon||'kunai').slice(0,40);report.hero=String(raw.hero||'common').slice(0,40);
 report.ended=raw.ended==='death'?'death':raw.ended==='retire'?'retire':'interrupted';
 return report;
}
export function achievementProgress(records,id){const a=ACHIEVEMENTS.find(a=>a.id===id);return a?Math.min(a.target,records?.[a.field]||0):0;}
export function unlockedFrom(records){return ACHIEVEMENTS.filter(a=>(records?.[a.field]||0)>=a.target).map(a=>a.id);}
export function mergeRecords(before={},report={}){const out={...before};for(const a of ACHIEVEMENTS)out[a.field]=a.cumulative?(before[a.field]||0)+(report[a.field]||0):Math.max(before[a.field]||0,report[a.field]||0);return out;}
export function allowedCosmetic(unlocked,kind,id){return id==='default'||kind==='title'&&id===''||ACHIEVEMENTS.some(a=>unlocked.includes(a.id)&&(kind==='title'?a.id===id:a[kind]===id));}
export function titleText(id){return ACHIEVEMENTS.find(a=>a.id===id)?.title||'';}
export function weekAt(now=Date.now()){
 const day=86400000,offset=9*3600000,local=new Date(now+offset),monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-((local.getUTCDay()+6)%7)*day-offset;
 const key=new Date(monday+offset).toISOString().slice(0,10);let seed=2166136261;for(const ch of RULESET+key)seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
 const weapons=['kunai','bat','shotgun','katana','revolver','lightchaser'];return {key,seed,startsAt:monday,endsAt:monday+7*day,weapon:weapons[Math.floor(monday/(7*day))%weapons.length],ruleset:RULESET};
}
export function challengeOptions(cosmetics={}){return {encounters:true,hero:'common',heroStars:1,awakening:0,weaponGrade:'normal',metaPower:0,metaHP:0,forgeE:0,forgeV:0,tech:[],techRanks:{},lockedSkills:[],aimAssist:true,title:cosmetics.title||'',outfit:cosmetics.outfit||'default',killEffect:cosmetics.killEffect||'default',bestScore:Number(cosmetics.bestScore)||0};}
