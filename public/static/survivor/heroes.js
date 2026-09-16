// Character identities and structural rules: see PARITY.md for source dates and remaining gaps.
const hero=(id,name,skill,summary,extra={})=>({id,name,skill,summary,stars:1,...extra});
export const HEROES=[
 hero('common','コモン',null,'専用のレベルアップ枠なし。', {manual:'電子防護',awakenedManual:true}),
 hero('catnips','キティース','medidrone','回復エリアを作るメディカルドローン。3★でドローン合体解放。'),
 hero('tsukuyomi','ツキヨミ','moon','前方斬撃から周囲を守る円形斬撃へ。'),
 hero('worm','ヴォルマー','listening','周囲の敵の弱点を見抜く補助スキル。6★で寝返り工作。',{manual:'勇往邁進',awakenedManual:true}),
 hero('wesson','ウィチェ','grenade','電磁手榴弾。6★で進化後の電磁場が敵弾を遮る。',{manual:'火力支援',awakenedManual:true}),
 hero('king','キング','instinct','会心率を伸ばす専用補助。3★で致命感応へ。',{manual:'黄金の殻',awakenedManual:true}),
 hero('yelena','エレナ','pistol','跳弾する二丁式拳銃。'),
 hero('yang','マスターヤン','palm','掌風と護体真気を切り替える陰陽均衡。',{manual:'陰陽切替'}),
 hero('metallia','リンネ','harmony','和声の力は補助枠。三音演奏で毒・衰弱・寒冷を選ぶ。',{manual:'三音演奏'}),
 hero('joey','ジョイ',null,'決闘は常時効果。ボスの弱点を突き、金属熊で連撃。',{manual:'爆裂・星砕拳'}),
 hero('taloxa','タローシア','funnel','初期フィンネルと、変形後のバルカンガン。',{manual:'オーバーロード',initial:true}),
 hero('venato','ヴィトール','adrenaline','体力減少で一時強化。血の契約は体力をシールドに変換。',{manual:'血の契約'}),
 hero('nezha','ナタク','cosmic','乾坤輪と混天綾。3★で攻撃枠が1つ増える。',{initial:true,available:false}),
 hero('vulcan','ヴァルカン','hammer','炎のハンマー。3★で専用武器の威力が倍増。',{initial:true,available:false}),
 hero('spongebob','スポンジボブ','spatula','最も近い敵をヘラで攻撃。',{replaceMain:true}),
 hero('squidward','イカルド','clarinet','周囲に音波を放つクラリネット。',{replaceMain:true}),
 hero('patrick','パトリック','starPunch','拳で攻撃。',{replaceMain:true}),
 hero('sandy','サンディ','lasso','ロープについたナッツを周囲で回す。',{replaceMain:true}),
 hero('leonardo','レオナルド','dualKatana','長短の二刀を交互に振る。',{replaceMain:true}),
 hero('raphael','ラファエロ','sai','2本のサイを投げる。3★で5回ごとに大型のサイ。',{replaceMain:true}),
 hero('april','エイプリル','microphone','マイクから音波球を放つ。',{replaceMain:true}),
 hero('michelangelo','ミケランジェロ','nunchucks','ヌンチャクから旋風を飛ばす。',{replaceMain:true}),
 hero('donatello','ドナテロ','staff','回転する棒で周囲を攻撃。',{replaceMain:true}),
 hero('splinter','スプリンター','secret','杖から気功波。3★から命中した敵を減速。',{replaceMain:true}),
];
export const HERO_BY_ID=Object.fromEntries(HEROES.map(h=>[h.id,h]));
const skill=(id,name,hero,summary,group='attack',extra={})=>({id,name,hero,group,icon:group==='passive'?'shield':'comet',summary,desc:Array.from({length:5},(_,i)=>i?`${summary}（★${i+1}に強化）`:summary),...extra});
export const HERO_SKILLS=[
 skill('medidrone','メディカルドローン','catnips','回復エリアを設置。中に立つと体力が回復。'),
 skill('moon','月華一斬','tsukuyomi','前方を切り払う。進化で円形斬撃になり敵弾を遮る。'),
 skill('listening','極秘盗聴','worm','近くの敵が受けるダメージを増やす。','passive'),
 skill('grenade','電磁式手榴弾','wesson','手榴弾を投げ、着弾点を爆破する。'),
 skill('instinct','サバイバー直感','king','1段階ごとに会心率＋8%。','passive'),
 skill('pistol','二丁式拳銃','yelena','2丁の拳銃で攻撃。成長すると弾が跳弾する。'),
 skill('palm','陰陽均衡','yang','掌風は狙撃、護体真気は周回防御。切替ボタンで変更。'),
 skill('harmony','和声の力','metallia','毒・寒冷の敵への攻撃を強化。衰弱した敵への命中でシールド回復。','passive'),
 skill('adrenaline','アドレナリン','venato','体力減少で一時的に全攻撃を強化。覚醒5で高性能化。','passive'),
 ...HEROES.filter(h=>['taloxa','nezha','vulcan'].includes(h.id)||h.replaceMain).map(h=>skill(h.skill,({funnel:'フィンネル',cosmic:'乾坤輪・混天綾',hammer:'Pyrogod Hammer',spatula:'ヘラ',clarinet:'クラリネット',starPunch:'ヒトデ拳',lasso:'投げ縄ナッツ',dualKatana:'疾風の双刃',sai:'鉄のサイ',microphone:'マイク',nunchucks:'アークヌンチャク',staff:'追撃の棒',secret:'秘術衝撃'})[h.skill],h.id,h.summary,'attack',{main:!!h.replaceMain})),
];
const evolve=(id,name,base,support,hero,desc,extra={})=>({id,name,base,support,hero,desc,group:'attack',icon:'comet',requires:support?[base,support]:[base],fusion:false,...extra});
const merge=(id,name,inputs,desc)=>({id,name,requires:inputs,hero:'catnips',minStars:3,desc,group:'attack',icon:'army',fusion:true});
for(const skill of HERO_SKILLS){if(skill.id==='instinct')skill.desc=Array.from({length:5},(_,i)=>`会心率＋${(i+1)*8}%。`);}
export const HERO_EVOLUTIONS=[
 {...merge('divine','神聖・破壊者',['destroyer','medidrone'],'破壊者＋メディカル、または回復との合体機＋残りの攻撃ドローン。3機を1枠に合体。'),minStars:1,paths:[{requires:['holy','droneB'],minStars:3},{requires:['redeemer','droneA'],minStars:3}]},
 merge('holy','聖なる支配者',['droneA','medidrone'],'タイプAのミサイルと回復エリアを1枠に合体。'),
 merge('redeemer','贖罪者',['droneB','medidrone'],'タイプBのミサイルと回復エリアを1枠に合体。'),
 evolve('moonE','月華一斬・進化','moon','armor','tsukuyomi','円形の斬撃が周囲を攻撃し敵弾を遮る。'),
 evolve('eternity','月の永遠','moon',null,'tsukuyomi','進化した月華一斬の威力を強化。',{previous:'moonE',minStars:3,bladeGate:true}),
 evolve('frost','月の霜華','moon',null,'tsukuyomi','進化した月華一斬が敵を減速。',{previous:'moonE',minStars:3,bladeGate:true}),
 evolve('listeningE','寝返り工作','listening',null,'worm','盗聴範囲内で蓄積したゲージにより、通常の敵を退却させる。',{group:'passive',minStars:6}),
 evolve('grenadeE','教官の怒り','grenade','power','wesson','広範囲の電磁爆発。キャラ6★で電磁場が敵弾を遮る。'),
 evolve('instinctE','致命感応','instinct',null,'king','会心率＋50%、会心ダメージ＋25%。',{group:'passive',minStars:3}),
 evolve('palmE','烈陽掌／純陽真気','palm',null,'yang','烈陽掌と純陽真気を切替。純陽真気の爆発は敵の弱点をさらす。'),
 evolve('funnelE','ワープフィンネル／ビームキャノン','funnel',null,'taloxa','通常形態は跳弾レーザー、メカ形態は横方向のビーム。'),
 evolve('clarinetE','致命楽章','clarinet','size','squidward','音波で倒した敵が爆発して周囲を巻き込む。'),
 evolve('starPunchE','ヒトデ空手','starPunch','vitality','patrick','分身が付き添い、一緒に拳で攻撃。'),
 evolve('lassoE','無敵バブル','lasso','xp','sandy','周囲を回るバブルに進化。'),
 evolve('dualKatanaE','満月の斬撃','dualKatana','armor','leonardo','回転する満月の斬撃へ強化。'),
 evolve('saiE','怒りのサイ','sai','power','raphael','大型のサイが敵を貫く。'),
 evolve('microphoneE','超音波球（伝説のマイク）','microphone','size','april','大型の音波球。キャラ6★で命中時に爆発。'),
 evolve('spatulaE','全自動ターボヘラ','spatula','cooldown','spongebob','3枚のヘラが周囲を回転する。'),
];
export function normalizeOptions(raw={}){return {encounters:raw.encounters===true,bestScore:Math.max(0,Number(raw.bestScore)||0),title:typeof raw.title==='string'?raw.title:'',outfit:['ninja','royal','explorer'].includes(raw.outfit)?raw.outfit:'default',killEffect:['petal','aurora','gold'].includes(raw.killEffect)?raw.killEffect:'default',aura:typeof raw.aura==='string'?raw.aura:'mint',hero:HERO_BY_ID[raw.hero]&&HERO_BY_ID[raw.hero].available!==false?raw.hero:'common',heroStars:+raw.awakening>0?6:Math.max(1,Math.min(6,Math.floor(+raw.heroStars||1))),awakening:Math.max(0,Math.min(6,Math.floor(+raw.awakening||0))),weaponGrade:['normal','excellent','legendary'].includes(raw.weaponGrade)?raw.weaponGrade:'excellent',aimAssist:raw.aimAssist!==false,tech:[...new Set(raw.tech||[])].slice(0,6),techGrade:raw.techGrade==='red'?'red':'purple',techRanks:raw.techRanks&&typeof raw.techRanks==='object'?{...raw.techRanks}:null,metaPower:Math.max(0,Math.min(5,+raw.metaPower||0)),metaHP:Math.max(0,Math.min(1000,+raw.metaHP||0)),lockedSkills:Array.isArray(raw.lockedSkills)?raw.lockedSkills.filter(id=>['laser','durian','mine'].includes(id)):[],forgeE:Math.max(0,Math.min(5,+raw.forgeE||0)),forgeV:Math.max(0,Math.min(5,+raw.forgeV||0))};}
export function attackSlots(options={}){return 6+((options.hero==='nezha'&&options.heroStars>=3)||(options.hero==='taloxa'&&options.awakening>=6)?1:0);}
export function allowedSkill(a,context={}){return !context.lockedSkills?.includes(a.id)&&(!a.hero||a.hero===(context.hero||'common'));}
export const PENDING_FEATURES=[
 ['育成と解放','装備獲得・レベル・合成、キャラの欠片・星・覚醒を追加。必要な素材数と解放ランクはエンドレス用の調整で、本家と完全一致ではない。'],
 ['今回反映した範囲','開始装備9種、通常攻撃14種、通常補助12種を収録。初期はコモンとクナイのみ。仲間・装備は獲得して解放。'],
 ['専用技能の再現度','攻撃形状と一部の効果を再現した段階。キャラの常時効果・手動技の全性能、弱点判定、変身ゲージ、細かな発動条件は本家と未一致。'],
 ['二丁式拳銃 → ホログラム投影','必要なスニーカーは確認済み。投影の発動条件・持続時間に資料の不一致があり、進化は未実装。'],
 ['SP・コラボの追加進化','ナタク・ヴァルカンは初期カード構成が未確認で選択不可。ミケランジェロ・ドナテロ・スプリンターの進化は未実装。'],
 ['ツインボーン12モード','6組の存在を確認。各段階の挙動・共振条件をまだ再現できていない。'],
 ['覚醒・共振・SS追加変形','覚醒の一部と神器鋳造を実装。全覚醒、共振、Chaos Fusion、Xeno Transmuteは未対応。'],
 ['数値の一致','通常技能の弾数・相対威力は公開資料を参照。攻撃間隔・半径・専用技能の威力はこの試遊版の調整値。最新本家との完全一致ではない。'],
];
