import {ORIGINAL_NAMES} from './reference-rules.js';
import {HERO_SKILLS,HERO_EVOLUTIONS,allowedSkill,attackSlots} from './heroes.js';
export {iconSvg} from './icons.js';
export const MAX_SLOTS=6, MAX_LEVEL=5;
const attack=(id,name,icon,summary,upgrade,main=false)=>({id,name,icon,group:'attack',main,summary,desc:Array.from({length:5},(_,i)=>i===0?summary:`${upgrade}（★${i+1}）`)});
const passive=(id,name,icon,desc)=>({id,name,icon,group:'passive',summary:desc(1),desc:Array.from({length:5},(_,i)=>desc(i+1))});
export const MAIN_WEAPONS=[
 attack('kunai','もちつぶ','pierce','近い敵へ自動で狙う、扱いやすい連射弾。','連射数と威力がアップ',true),
 attack('bat','もちつき杵','giant','前方の敵をなぎ払い、流血と強いノックバック。','振り幅・範囲・威力がアップ',true),
 attack('katana','おもち包丁','speed','近い敵の方向と後ろへ、貫通する斬撃。','斬撃の数と大きさがアップ',true),
 attack('shotgun','こめ粉ショット','split','前方に散弾を発射し、広い範囲を攻撃。','弾数と威力がアップ',true),
 attack('revolver','だんご鉄砲','blast','前方へ強力な弾を6発。撃ち切るとリロード。','1発の威力がアップ',true),
 attack('lightchaser','月光の杵','blizzard','近い敵へ、幅広い光の波を飛ばす。','光の波と追加斬撃が増える',true),
 attack('void','黒ごま砲','orbit','着弾した場所に渦をつくり、敵を引き寄せる。','渦の範囲と威力がアップ',true),
 attack('sword','流れもち剣','comet','突きと追尾剣で攻撃。撃破で幽閉を蓄え全攻撃を強化。','追尾する剣の数が増える',true),
];
export const ACTIVE_SKILLS=[
 attack('boomerang','もちリング','bounce','投げたリングが手元へ戻りながら貫通。','リングの数・範囲・威力がアップ'),
 attack('brick','きね落とし','meteor','レンガを上へ投げる。科学技術を装備すると敵を貫通。','投げる数と威力がアップ'),
 attack('drill','こめつぶドリル','pierce','高速のドリルが敵を貫き、画面端で反射。','ドリルの数と威力がアップ'),
 attack('droneA','さくらもち衛星','army','時計回りにミサイルを発射。追尾は科学技術の効果。','ミサイルの数と威力がアップ'),
 attack('droneB','よもぎもち衛星','split','反時計回りに重いミサイルを発射。追尾は科学技術の効果。','ミサイルの数と威力がアップ'),
 attack('durian','こんぺいとう玉','giant','1個の玉が消えずに跳ね回り、触れた敵を攻撃。','玉の大きさと威力がアップ'),
 attack('field','ほかほか結界','shield','周囲の敵に、連続でダメージを与える。','結界の範囲と威力がアップ'),
 attack('orbit','ぐるぐるもち','orbit','周囲を回るもちが敵を押し返し、敵弾も消す。','もちの数・範囲・持続がアップ'),
 attack('laser','あめ光線','blizzard','足元から伸びる光線が敵を貫く。','光線の本数と威力がアップ'),
 attack('lightning','ぱちぱち砂糖','ricochet','敵を狙って雷を落とす。','落雷する数と威力がアップ'),
 attack('mine','ぱちぱち地雷','blast','近づいた敵を感知して、大きく爆発。','設置する数・爆発範囲がアップ'),
 attack('fire','みたらし火鉢','blast','周りに炎のたまりをつくり、通る敵を攻撃。','炎の数・範囲・威力がアップ'),
 attack('rocket','だんごロケット','comet','敵へ飛ぶロケットが、大きく爆発。','爆発の範囲と威力がアップ'),
 attack('ball','はずみ大福','bounce','弾む大福が高速で跳ね回る。','大福の数と威力がアップ'),
];
export const PASSIVES=[
 passive('projectile','かぜの粉','speed',n=>`弾の飛ぶ速さ＋${n*10}%。`),
 passive('cooldown','早つき拍子','ricochet',n=>`攻撃の待ち時間−${n*8}%。`),
 passive('regen','あったか抹茶','heal',n=>`5秒ごとに最大体力の${n*.5}%を回復。継続回復の合計上限あり。`),
 passive('duration','のびのび生地','orbit',n=>`攻撃・結界の持続時間＋${n*10}%。`),
 passive('vitality','ふっくら心得','heal',n=>`最大体力＋${n*20}%。`),
 passive('size','ふくらし粉','giant',n=>`攻撃の大きさ・範囲＋${n*10}%。`),
 passive('power','力もち','blast',n=>`すべての攻撃の威力＋${n*10}%。`),
 passive('magnet','おもち招き','magnet',n=>`経験値・アイテムの回収範囲＋${n*100}%。`),
 passive('xp','おけいこ帖','pierce',n=>`手に入る経験値＋${n*8}%。`),
 passive('fortune','福引き券','giant',n=>`獲得コイン＋${n*8}%。`),
 passive('armor','もちの皮','shield',n=>`受けるダメージ−${n*10}%。`),
 passive('speed','うさぎ足袋','speed',n=>`移動の速さ＋${n*10}%。`),
];
const twin=attack('twinLance','Twin Lance – Starforged Havoc','comet','創星・破滅の2枠で開始。両方★5で1枠に合体。','',true);
MAIN_WEAPONS.push(twin);
export const SS_SKILLS=[attack('starforge','創星（Starforge）','orbit','往復する光輪。2回の発射で過負荷を蓄え、10秒間全攻撃を強化。','光輪の威力がアップ',true),attack('havoc','破滅（Havoc）','pierce','前方へ槍を突き出し、亀裂で敵の弱点をさらす。','槍の数・範囲・威力がアップ',true)];
export const ABILITIES=[...MAIN_WEAPONS.filter(a=>a.id!=='twinLance'),...SS_SKILLS,...ACTIVE_SKILLS,...PASSIVES,...HERO_SKILLS];
const evo=(id,name,base,support,icon,desc)=>({id,name,base,support,icon,desc,group:'attack',requires:[base,support],fusion:false});
const fusion=(id,name,a,b,icon,desc)=>({id,name,icon,desc,group:'attack',requires:[a,b],fusion:true});
export const EVOLUTIONS=[
 evo('kunaiE','もちの千本雨','kunai','xp','army','狙った敵へ高速の貫通弾を2発ずつ放つ。'),
 evo('batE','満月もちつき','bat','vitality','orbit','威力と範囲を強化。全周攻撃はレジェンド装備の効果。'),
 evo('katanaE','妖刀もちきり','katana','armor','blizzard','前後へ巨大な斬撃。命中回復はレジェンド装備の効果。'),
 evo('shotgunE','こめ粉ガトリング','shotgun','power','army','9発の高速弾を集中射撃するガトリング！'),
 evo('revolverE','だんごマグナム','revolver','power','ricochet','二丁のリボルバーから2発を同時発射。'),
 evo('lightchaserE','月光もち嵐','lightchaser','armor','blizzard','幅広い光の波と、周囲をなぎ払う斬撃！'),
 evo('voidE','黒ごま新星','void','duration','comet','渦のあとにバリアを残す。中で守られるのは連続2秒まで。再展開1.8秒。地面の予告攻撃は避けよう。'),
 evo('swordE','天もち乱舞','sword','magnet','comet','追尾剣に加え、敵の頭上へ流星が降る！'),
 evo('boomerangE','もち大旋回','boomerang','magnet','orbit','大きなリングが回りながら広がり、戻る！'),
 evo('brickE','もち鉄槌','brick','vitality','giant','8方向へ鉄槌を飛ばして、まとめて押し返す！'),
 evo('drillE','追いかけ米矢','drill','projectile','pierce','1本の矢が消えずに飛び続け、敵を追尾・貫通。'),
 evo('durianE','金平糖の大嵐','durian','size','giant','大きな玉が跳ねながら、全方向へ小弾を放つ！'),
 evo('fieldE','熱々もち結界','field','regen','shield','広い結界で敵を減速させ、連続ダメージ！'),
 evo('orbitE','もちの守護陣','orbit','duration','orbit','6匹がずっと周回。敵と敵弾を押し返す！'),
 evo('laserE','あめの光輪','laser','cooldown','blizzard','周囲から内側へ縮む光線で連続攻撃。'),
 evo('lightningE','雷もち大連鎖','lightning','cooldown','ricochet','落雷した場所から電撃の衝撃波が広がる。'),
 evo('fireE','みたらし火の海','fire','fortune','blast','広い炎が長く残り、敵の進路を焼き尽くす！'),
 evo('rocketE','超だんご砲','rocket','size','comet','巨大ロケットで広い範囲を吹き飛ばす！'),
 evo('ballE','量子もちバウンド','ball','speed','bounce','高速で跳ねる大福が、命中で分裂！'),
 fusion('destroyer','もち衛星合体','droneA','droneB','army','2機が合体して14発のミサイルを一斉発射。攻撃枠が1つ空く！'),
 fusion('inferno','みたらし大地雷','mine','fire','blast','大爆発のあとに炎が残る。攻撃枠が1つ空く！'),
 fusion('thunderMine','雷もち大地雷','mine','lightning','ricochet','大爆発から電撃の衝撃波が広がる。攻撃枠が1つ空く！'),
];
EVOLUTIONS.push(fusion('havocNova','Havoc Nova','starforge','havoc','comet','創星と破滅が合体。1枠になり、槍が自動照準になる。'),...HERO_EVOLUTIONS);
for(const a of [...ABILITIES,...EVOLUTIONS]){a.mochiName=a.name;a.name=ORIGINAL_NAMES[a.id]||a.name;}
export const BY_ID=Object.fromEntries([...MAIN_WEAPONS,...ABILITIES,...EVOLUTIONS].map(a=>[a.id,a]));
export function equipped(levels,group){return Object.keys(levels).filter(id=>BY_ID[id]?.group===group);}
export function evolvedBase(base,evolved){return EVOLUTIONS.some(e=>!e.fusion&&e.base===base&&evolved.includes(e.id));}
export function consumed(id,evolved){return EVOLUTIONS.some(e=>e.fusion&&evolved.includes(e.id)&&[...e.requires,...(e.paths||[]).flatMap(p=>p.requires)].includes(id));}
export function evolutionInputs(e,levels,evolved,context={}){return [{requires:e.requires,minStars:e.minStars||1},...(e.paths||[])].find(p=>(context.heroStars||1)>=p.minStars&&p.requires.every(id=>levels[id]>=5&&!evolvedBase(id,evolved)))?.requires;}
export function eligibleEvolutions(levels,evolved,context={}){return EVOLUTIONS.filter(e=>{
 if(evolved.includes(e.id)||!allowedSkill(e,context)||(e.minStars&&(context.heroStars||1)<e.minStars))return false;
 if(e.previous&&!evolved.includes(e.previous))return false;
 if(e.previous&&EVOLUTIONS.some(other=>other.previous===e.previous&&evolved.includes(other.id)))return false;
 if(e.bladeGate&&(context.heroStars||1)<6&&!['katanaE','lightchaserE'].some(id=>evolved.includes(id)))return false;
 return e.fusion?!!evolutionInputs(e,levels,evolved,context):levels[e.base]>=5&&(!e.support||levels[e.support]>=1);
});}
function shuffle(list,rng){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function createChoices(levels,evolved,rng=Math.random,context={}){
 const choices=ABILITIES.filter(a=>allowedSkill(a,context)&&!consumed(a.id,evolved)&&((levels[a.id]||0)>0?levels[a.id]<5:!a.main&&equipped(levels,a.group).length<(a.group==='attack'?attackSlots(context):6))).map(a=>({id:a.id,kind:levels[a.id]?'upgrade':'new'}));
 const ready=shuffle(eligibleEvolutions(levels,evolved,context),rng).map(e=>({id:e.id,kind:'evolution'}));
 const out=[];const add=c=>{if(c&&out.length<3&&!out.some(x=>x.id===c.id))out.push(c);};add(ready[0]);
 const owned=shuffle(choices.filter(c=>c.kind==='upgrade'),rng);add(owned[0]);
 const partners=EVOLUTIONS.filter(e=>!evolved.includes(e.id)&&(e.fusion?e.requires.some(id=>levels[id]):levels[e.base])).flatMap(e=>e.fusion?e.requires:[e.support]);
 const fresh=shuffle(choices.filter(c=>c.kind==='new'),rng);add(fresh.find(c=>partners.includes(c.id))||fresh[0]);
 for(const c of shuffle([...ready,...choices],rng))add(c);
 for(const id of ['recover','coins','collect'])if(id!=='recover'||context.recoverAvailable!==false)add({id,kind:'supply'});
 return shuffle(out,rng);
}
export function choiceInfo(choice,levels){
 if(choice.kind==='supply')return {recover:{name:'回復もち',desc:'最大体力の12%を回復。次に選べるのは戦闘時間で60秒後（宝箱と共通）。',icon:'heal'},coins:{name:'コイン袋',desc:'コインを12枚獲得。石油債権で増える。',icon:'giant'},collect:{name:'経験値ぜんぶ回収',desc:'落ちている経験値とアイテムを引き寄せる。',icon:'magnet'}}[choice.id];
 const a=BY_ID[choice.id];return {...a,desc:choice.kind==='evolution'?a.desc:a.desc[levels[a.id]||0]};
}
export function recipeLabel(e){if(e.paths)return '破壊者 EVO ＋ メディカル ★5 ／ 聖なる支配者 ＋ B★5 ／ 贖罪者 ＋ A★5（後の2つはキャラ3★）';const base=e.requires.map(id=>BY_ID[id].name+(BY_ID[id].fusion?' EVO':e.fusion||id===e.base?' ★5':' ★1')).join(' ＋ ');return (e.previous?'二段階進化：':e.fusion?'合体：':'')+base+(e.hero?' · 専用':'')+(e.minStars?' · キャラ'+e.minStars+'★以上':'')+(e.bladeGate?' · 3★は進化済みのかたな／ライトチェイサー、6★は武器不問':'');}
