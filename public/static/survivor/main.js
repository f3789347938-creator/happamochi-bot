import {RecordClient,waitForRecordLogin} from './record-client.js?v=20260921-rewards';
import {battleReport,shareRecordImage,escapeHTML} from './record-ui.js';
import {challengeOptions,titleText,ACHIEVEMENTS} from './records.js';
import {encounterInfo} from './encounters.js';
import {stageAt,STAGES} from './enemies.js';
import {Progression,SAVE_KEY,loadout,skillGate,rankOf} from './progression.js';
import {renderHome,rewardMarkup} from './progression-ui.js';
import {HEROES,HERO_BY_ID,HERO_SKILLS,PENDING_FEATURES} from './heroes.js';
import {Game,xpNeeded,formatTime,seededRandom} from './engine.js';
import {MAIN_WEAPONS,ACTIVE_SKILLS,PASSIVES,EVOLUTIONS,BY_ID,equipped,recipeLabel,choiceInfo,iconSvg} from './abilities.js';
import {ChoiceGate,movementVector} from './input.js';
import {loadArt} from './art.js';
import {Renderer} from './renderer.js';
import {Sound} from './audio.js';
import {LineBridge} from './line.js';
import {Revival} from './revival.js';
import {gameRewardText} from '../game-rewards.mjs?v=20260921-rewards';
const $=id=>document.getElementById(id),game=new Game(),sound=new Sound(),line=new LineBridge(),gate=new ChoiceGate();
const canvas=$('game'),keys=new Set(),dialogs=['menu','choice-dialog','pause-dialog','book-dialog','result-dialog','loot-dialog','revive-dialog'];
let renderer,drag=null,vector={x:0,y:0},lastFrame=0,accumulator=0,lastHud=0,lastLoadout='',bannerTimer,toastTimer,moved=false,result=null,sharing=false,selectedWeapon='kunai',bookFilter='attack';
let localSave;try{localSave=window.localStorage;}catch{}
const progress=new Progression(localSave);let homeTab='home',gearItem=null,heroItem=null,activeRunId=null,lastCheckpoint=0;
const records=new RecordClient(localSave),boardState={mode:'normal',period:'week',loading:false,data:null,seq:0};
let revival=null,starting=false,runMode='normal',runRanked=false,recordNoticeUntil=0;
const departureState={busy:false,error:'',offline:false};
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function show(id){const d=$(id);if(!d.open)d.showModal();}
function close(id){if($(id).open)$(id).close();}
function closeAll(){for(const id of dialogs)close(id);}
function releaseMovement(){if(drag&&canvas.hasPointerCapture(drag.id)){try{canvas.releasePointerCapture(drag.id);}catch{}}drag=null;vector={x:0,y:0};keys.clear();$('joystick').hidden=true;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2300);}
function banner(title,subtitle='',evolution=false){const el=$('wave-banner');el.replaceChildren(document.createTextNode(title));if(subtitle){const small=document.createElement('small');small.textContent=subtitle;el.appendChild(small);}el.classList.toggle('evolution',evolution);el.classList.add('show');clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>el.classList.remove('show'),evolution?2600:1900);}
function soundUI(){$('sound').setAttribute('aria-pressed',String(sound.enabled));$('sound').setAttribute('aria-label',sound.enabled?'音をオフにする':'音をオンにする');$('sound-waves').setAttribute('d',sound.enabled?'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14':'m16 9 5 6m0-6-5 6');}
function slotMarkup(levels,evolved,group,empty=true){
 const items=equipped(levels,group).map(id=>{const evo=evolved.map(key=>BY_ID[key]).filter(e=>e&&(e.base===id||e.id===id)).slice(-1)[0],a=evo||BY_ID[id],label=a.name+(evo?' EVO':' ★'+levels[id]);return `<div class="slot filled ${group} ${evo?'evolved':''}" title="${label}" role="img" aria-label="${label}">${iconSvg(a.icon)}<span class="slot-lv">${evo?'EVO':levels[id]}</span></div>`;});
 if(empty)while(items.length<(group==='attack'?game.slots():6))items.push('<div class="slot empty" role="img" aria-label="空きスロット"></div>');return items.join('');
}
function updateHud(){
 const p=game.player;const event=encounterInfo(game);$('encounter-hud').hidden=!event||game.mode==='menu';if(event){$('encounter-name').textContent=event.name+' · '+event.remaining+'秒';$('encounter-detail').textContent=event.kind==='trap'&&event.state==='active'?'護衛 あと'+event.remainingGuards+'体':event.hint;$('encounter-action').hidden=!event.canOpen||game.mode!=='playing';}
 const best=game.options.bestScore;$('best-progress').hidden=!(best>0)||game.mode==='menu';$('best-progress').textContent=game.recordBeaten?'自己ベスト更新中！':'自己ベストまで '+Math.max(0,best-game.score+1).toLocaleString('ja-JP')+' pt';$('best-progress').classList.toggle('beaten',game.recordBeaten);$('record-notice').hidden=game.time>=recordNoticeUntil||game.mode==='menu';
 $('health-fill').style.width=(p.hp/p.maxHp*100)+'%';$('health-number').textContent=Math.ceil(p.hp);const health=document.querySelector('.health');health.setAttribute('aria-valuenow',String(Math.ceil(p.hp)));health.setAttribute('aria-valuemax',String(p.maxHp));
 $('score').innerHTML=game.score.toLocaleString('ja-JP')+' <small>pt</small>';$('level-label').textContent='Lv.'+game.level;const xp=Math.min(100,game.xp/xpNeeded(game.level)*100);$('xp-fill').style.width=xp+'%';document.querySelector('.xp-track').setAttribute('aria-valuenow',String(Math.round(xp)));
 $('wave-label').textContent=formatTime(game.time);$('kill-count').textContent='撃破 '+game.kills.toLocaleString('ja-JP');const stage=stageAt(game.time),next=STAGES[stage.index+1];$('pressure-label').textContent=stage.name+(next?' · 次 '+formatTime(next.at-game.time):'');$('pause').disabled=game.mode!=='playing';$('combo').dataset.tier=game.combo>=100?'3':game.combo>=25?'2':'1';$('combo').innerHTML=game.combo>=8?game.combo+'<small>連続撃破</small>':'';
 const boss=game.enemies.find(e=>e.kind==='boss'&&!e.dead);$('boss-hud').hidden=!boss;if(boss)$('boss-name').textContent=boss.name;$('boss-fill').style.width=boss?Math.max(0,boss.hp/boss.maxHp)*100+'%':'0%';
 const action=game.manual();$('hero-action').hidden=!action||game.mode!=='playing';if(action){$('hero-action').disabled=action.cooldown>0;$('hero-action-name').textContent=action.name;$('hero-action-status').textContent=action.cooldown>0?Math.ceil(action.cooldown)+'秒':action.active>0?'発動中':'発動';} $('kill-count').textContent+=' · コイン '+Math.floor(game.coins);
 const signature=JSON.stringify([game.levels,game.evolved,game.slots(),game.options.hero]);if(signature!==lastLoadout){lastLoadout=signature;$('loadout').style.gridTemplateColumns=`repeat(${game.slots()},minmax(0,1fr))`;$('loadout').innerHTML=slotMarkup(game.levels,game.evolved,'attack');$('passive-loadout').innerHTML=slotMarkup(game.levels,game.evolved,'passive');$('attack-count').textContent=equipped(game.levels,'attack').length+' / '+game.slots();$('passive-count').textContent=equipped(game.levels,'passive').length+' / 6';}
}
function showChoices(){
 releaseMovement();gate.open(performance.now());$('choice-level').textContent=game.choiceSource==='chest'?'TREASURE · あと'+game.pendingPicks+'回':'LEVEL '+game.level+' UP';$('choice-title').textContent=game.choiceSource==='chest'?'宝箱のごほうび':'能力を選ぶ';$('choice-foot').textContent='指を離してから選んでね';
 $('choices').innerHTML=game.choices.map(choice=>{
  const info=choiceInfo(choice,game.levels),kind=choice.kind,label={new:'NEW',upgrade:'強化',evolution:'進化',supply:'補給'}[kind];
  const category=info.group==='passive'?'補助':'攻撃';const detail=kind==='upgrade'?`${category} ★${game.lv(choice.id)} → ★${game.lv(choice.id)+1}`:kind==='new'?`${category} ★1`:kind==='evolution'?recipeLabel(BY_ID[choice.id]):'';
  return `<button class="choice-card ${kind}" data-id="${choice.id}" disabled><span class="choice-icon-wrap">${iconSvg(info.icon)}</span><span class="choice-copy"><span class="choice-meta"><span class="badge">${label}</span><span>${detail}</span></span><strong class="choice-title">${info.name}</strong><span class="choice-description">${info.desc}</span></span></button>`;
 }).join('');show('choice-dialog');sound.play('level');updateHud();
}
function processEvents(){for(const e of game.drainEvents()){
 if(e.type==='level')showChoices();
 else if(e.type==='start'){banner('ENDLESS SURVIVAL','倒れるまで、どこまでいける？');sound.play('wave');}
 else if(e.type==='throw'||e.type==='bottleBreak')sound.play(e.type,e);
 else if(e.type==='stage'){banner(e.stage.name,e.stage.hint,true);sound.play('wave');}
 else if(e.type==='boss'){banner('BOSS INCOMING',e.name+'があらわれた！');sound.play('wave');}
 else if(e.type==='bossKilled'){banner('BOSS DOWN','+'+e.score.toLocaleString('ja-JP')+' pt · 宝箱を回収しよう',true);sound.play('evolution');}
 else if(e.type==='evolution'){banner(e.name,'EVOLUTION!',true);sound.play('evolution');}
 else if(e.type==='hero'){banner(e.name,'SKILL!',true);sound.play('evolution');}
 else if(e.type==='revive'){banner('もち軍団、復活！','3秒間無敵 · 能力とスコアはそのまま',true);sound.play('evolution');}
 else if(e.type==='encounter'){toast(e.name+'：'+e.hint);sound.play('wave');}
 else if(e.type==='encounterDone'){toast(e.name+' ＋'+e.coins+'コイン');sound.play('evolution');}
 else if(e.type==='encounterGone')toast(e.name);
 else if(e.type==='personalBest'){recordNoticeUntil=game.time+3;$('record-notice').innerHTML='自己ベスト更新！<small>この先は、まだ見たことのない記録</small>';sound.play('evolution');}
 else if(e.type==='ability')toast(e.name+' ★'+e.level);
 else if(e.type==='collect')toast('経験値をまとめて回収！');
 else if(e.type==='milestone'){const el=$('combo');el.classList.remove('combo-kick');void el.offsetWidth;el.classList.add('combo-kick');sound.play('milestone');}
 else if(e.type==='multikill')sound.play('multikill',e);
 else if(e.type==='result')showDefeat();
 else if(['shot','kill','xp','hurt','meteor','shield','heal'].includes(e.type))sound.play(e.type,e);
}if(game.effects.hitSound){sound.play('impact',{heavy:game.effects.hitSound>1});game.effects.hitSound=0;}}
function renderHub(){progress.refresh();selectedWeapon=progress.p.selectedWeapon;const view=renderHome(progress,homeTab,homeTab==='gear'?gearItem:heroItem,records,boardState,departureState);homeTab=view.tab;$('home-body').innerHTML=view.html;const avatar=document.querySelector('.home-avatar');if(avatar)avatar.className='home-avatar outfit-preview outfit-'+(records.profile?.outfit||'default');}
function invalidateRun(){activeRunId=null;releaseMovement();returnToMenu();toast('別の画面で冒険が終了しました。保存済みの報酬を拠点で確認できます。');}
function checkpoint(){if(!activeRunId)return true;const ok=progress.checkpoint(activeRunId,game.result());if(!ok)invalidateRun();lastCheckpoint=game.time;return ok;}
function settleRun(){if(!activeRunId)return null;if(!checkpoint())return {invalid:true};const receipt=progress.finish(activeRunId);activeRunId=null;return receipt;}
async function start(mode='normal',offline=false){
 if(starting||activeRunId||['playing','paused','choice'].includes(game.mode))return;starting=true;runMode=mode==='challenge'?'challenge':'normal';
 Object.assign(departureState,{busy:true,error:'',offline:false});if($('menu').open)renderHub();
 const retry=$('retry');retry.disabled=true;retry.textContent='出撃準備中…';
 const id=globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);let session=null;
 try{
  if(!offline){await waitForRecordLogin();if(!records.account)await records.load();await records.flush();session=await records.start(id,runMode,progress.p.selectedWeapon);}
  const run=progress.begin(id,runMode,!!session,records.account);if(!run.ok){if(session)void records.request('/runs/abandon',{id});throw Error(run.message);}
  activeRunId=id;runRanked=!!session;lastCheckpoint=0;clearRevival();selectedWeapon=session?.mode==='challenge'?session.weapon:run.weapon;
  const best=runMode==='challenge'?records.challengeBest:Math.max(progress.p.bestScore,records.profile?.bestScore||0);
  const options=runMode==='challenge'?challengeOptions({...records.cosmetics(),bestScore:best}):{...run.options,...records.cosmetics(),bestScore:best};
  closeAll();gate.reset();releaseMovement();moved=false;result=null;sharing=false;recordNoticeUntil=0;$('share').disabled=false;$('control-hint').classList.remove('gone');$('quit-confirm').hidden=true;$('quit').hidden=false;
  void sound.unlock();game.rng=session?seededRandom(session.seed):Math.random;game.start(selectedWeapon,options);game.setViewport(runMode==='challenge'?650:renderer.worldWidth,runMode==='challenge'?900:renderer.worldHeight);renderer.camera={x:0,y:0};lastFrame=performance.now();accumulator=0;updateHud();processEvents();canvas.focus({preventScroll:true});if(progress.notice)toast(progress.notice);
 }catch(e){
  departureState.error=e.name==='AbortError'?'接続に時間がかかっています。もう一度出撃を押してください。':e.message||'出撃を開始できませんでした。もう一度試してください。';
  departureState.offline=runMode==='normal'&&!progress.p.active;homeTab=runMode==='challenge'?'challenge':'home';close('result-dialog');show('menu');
  // Refresh stale reservations without delaying or erasing the original start error.
  if(e.status===409)void records.load().then(()=>{if($('menu').open)renderHub();}).catch(()=>{});
 }finally{
  starting=false;departureState.busy=false;retry.disabled=false;retry.textContent='もう一度出撃';
  if($('menu').open){renderHub();if(departureState.error)$('departure-status')?.scrollIntoView({block:'nearest'});}
 }
}
function pause(){if(game.mode!=='playing')return;releaseMovement();game.pause();show('pause-dialog');updateHud();}
function resume(){if(!activeRunId){invalidateRun();return;}close('pause-dialog');$('quit-confirm').hidden=true;$('quit').hidden=false;releaseMovement();game.resume();void sound.unlock();lastFrame=performance.now();accumulator=0;canvas.focus({preventScroll:true});updateHud();}
function returnToMenu(){clearRevival();closeAll();const config=loadout(progress.refresh());game.reset(config.weapon,config.options);releaseMovement();gate.reset();$('wave-banner').classList.remove('show');homeTab='home';runMode='normal';updateHud();renderHub();show('menu');}
function retire(){if(!activeRunId){returnToMenu();return;}game.mode='lost';showResult();}
function clearRevival(){revival?.invalidate();revival=null;close('revive-dialog');}
function renderRevival(message=''){
 const available=line.revivalAvailability(),pending=!!revival?.pending;
 $('revive-share').disabled=pending||available!=='ready';$('revive-share').textContent=pending?'LINEで送信先を選んでね':'公式LINEをシェアして復活';
 $('revive-dialog').setAttribute('aria-busy',String(pending));
 $('revive-message').textContent=message||(pending?'送信結果を待っています。':{ready:'送信先は自分で選べます。キャンセルしても再挑戦できます。',loading:'LINEにつないでいます…',unconfigured:'シェア復活は現在準備中です。ここまでの報酬は持ち帰れます。',unavailable:'この環境ではシェア復活を利用できません。ここまでの報酬は持ち帰れます。'}[available]);
}
function showDefeat(){
 if(!game.canRevive()){showResult();return;}
 if(!activeRunId||!checkpoint())return;const runId=activeRunId;
 clearRevival();releaseMovement();closeAll();gate.reset();accumulator=0;$('wave-banner').classList.remove('show');
 revival=new Revival(game,{share:()=>line.shareRevival(),isCurrent:()=>activeRunId===runId&&$('revive-dialog').open&&checkpoint()});
 $('revive-score').textContent=game.score.toLocaleString('ja-JP');$('revive-record').textContent=`${formatTime(game.time)} 生存 · Lv.${game.level} · 撃破 ${game.kills.toLocaleString('ja-JP')}体`;
 renderRevival();show('revive-dialog');sound.play('lose');updateHud();
}
async function shareToRevive(){
 const offer=revival;if(!offer||offer.pending||line.revivalAvailability()!=='ready')return;
 const work=offer.attempt();if(revival!==offer)return;renderRevival();const outcome=await work;
 if(revival!==offer)return;
 if(outcome.status==='revived'){
  clearRevival();releaseMovement();gate.reset();lastFrame=performance.now();accumulator=0;checkpoint();
  if(!activeRunId)return;
  if(document.hidden||!document.hasFocus()){pause();sound.suspend();}else{void sound.unlock();processEvents();canvas.focus({preventScroll:true});}updateHud();
 }else renderRevival({cancelled:'シェアをキャンセルしました。復活はまだ使っていません。',failed:'送信できませんでした。もう一度シェアを試せます。',unavailable:'共有画面を利用できません。復活はまだ使っていません。',stale:'この冒険の復活は終了しました。'}[outcome.status]);
}
function showResult(){
 clearRevival();releaseMovement();result={...game.result(),ended:game.player.hp<=0?'death':'retire',runMode,recordTitle:titleText(game.options.title)};const receipt=settleRun();if(receipt?.invalid)return;result.runId=receipt?.id;result.ranked=runRanked;$('result-rewards').innerHTML=rewardMarkup(receipt);$('result-save-status').textContent=progress.notice||'ゲーム内の育成報酬と育成状況を保存しました';$('game-points-status').textContent=runRanked?'ガチャ用ポイントを確認しています…':gameRewardText({status:'offline'});close('choice-dialog');close('pause-dialog');$('wave-banner').classList.remove('show');
 $('result-eyebrow').textContent='ENDLESS RECORD';$('result-title').textContent='もち軍団、おつかれさま';$('result-description').textContent=`Lv.${result.level} · ボス${result.bossKills}体撃破。次はどんな軍団にする？`;
 $('result-score').textContent=result.score.toLocaleString('ja-JP');$('result-stats').innerHTML=[['生存時間',formatTime(result.seconds)],['倒した敵',`${result.kills.toLocaleString('ja-JP')}体`],['最大連続撃破',`${result.maxCombo}体`]].map(([name,value])=>`<div class="result-stat"><b>${value}</b><span>${name}</span></div>`).join('');
 $('result-report').innerHTML=battleReport(result);$('result-achievements').innerHTML='';document.querySelector('.result-portrait').className='result-portrait outfit-preview outfit-'+game.options.outfit;$('record-save-status').textContent=runRanked?'記録を送信しています…':'記録なしの出撃です。育成用の報酬は持ち帰れます。';$('record-retry').hidden=true;if(receipt&&runRanked){records.enqueue(receipt.id,result);void syncRecords();}
 $('result-build').innerHTML=slotMarkup(result.levels,result.evolved,'attack')+slotMarkup(result.levels,result.evolved,'passive');$('line-close').hidden=!line.inClient();$('share-message').textContent='';show('result-dialog');sound.play('lose');updateHud();
}
function buildBook(){
 if(bookFilter==='coverage'){document.querySelectorAll('[data-book]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.book===bookFilter)));$('ability-book').innerHTML='<p class="coverage-lead">再現は途中です。全種類・全効果が本家と一致した版ではありません。</p>'+PENDING_FEATURES.map(([name,note])=>`<article class="book-item"><div><h3>${name}</h3><p>${note}</p></div></article>`).join('');return;}
 const list={main:MAIN_WEAPONS,attack:ACTIVE_SKILLS,passive:PASSIVES,evolution:EVOLUTIONS,hero:HERO_SKILLS}[bookFilter];
 document.querySelectorAll('[data-book]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.book===bookFilter)));
 $('ability-book').innerHTML=list.map(a=>{
  const owned=game.lv(a.id)||game.evolved.includes(a.id),evo=game.evolved.map(key=>BY_ID[key]).filter(e=>e?.base===a.id).slice(-1)[0],recipe=bookFilter==='evolution'?recipeLabel(a):EVOLUTIONS.find(e=>e.base===a.id)?recipeLabel(EVOLUTIONS.find(e=>e.base===a.id)):'';
  const locked=skillGate(a.id)>rankOf(progress.p);const summary=(locked?'探索ランク'+skillGate(a.id)+'で解放。':'')+(bookFilter==='evolution'?a.desc:a.summary),upgrade=bookFilter==='passive'?a.desc[4]:bookFilter==='evolution'?'':a.desc[4];
  return `<article class="book-item ${owned?'owned':''}">${iconSvg(a.icon)}<div><h3>${evo?evo.name:a.name}${a.hero?`<small>${HERO_BY_ID[a.hero].name}専用${HERO_BY_ID[a.hero].available===false?'・選択不可':''}</small>`:''}${owned?`<small>${evo||game.evolved.includes(a.id)?'EVO':`装備中 ★${game.lv(a.id)}`}</small>`:''}</h3><p>${summary}${upgrade?'<br>'+upgrade:''}</p>${recipe?`<small>${recipe}</small>`:''}</div></article>`;
 }).join('');
}
function openBook(){buildBook();show('book-dialog');}
function getInput(){if(drag)return vector;let x=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0),y=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0);const len=Math.hypot(x,y);return len?{x:x/len,y:y/len}:{x:0,y:0};}
function frame(now){
 const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
 if(game.mode==='playing'&&!document.hidden){accumulator+=dt;while(accumulator>=1/60&&game.mode==='playing'){game.step(1/60,getInput());accumulator-=1/60;}processEvents();}else accumulator=0;
 if(game.mode==='choice'){const ready=gate.ready(now);document.querySelectorAll('.choice-card').forEach(b=>b.disabled=!ready);$('choice-foot').textContent=ready?`攻撃 ${equipped(game.levels,'attack').length}/${game.slots()} · 補助 ${equipped(game.levels,'passive').length}/6 · 1つ選ぶ`:'指を離してから選んでね';}
 if(activeRunId&&game.time-lastCheckpoint>=3)checkpoint();
 if(now-lastHud>100){lastHud=now;updateHud();}renderer.draw(game,dt);requestAnimationFrame(frame);
}
$('hero-action').addEventListener('pointerdown',e=>e.stopPropagation());$('hero-action').addEventListener('click',()=>{game.activateHero();processEvents();updateHud();});
$('menu').addEventListener('click',e=>{
 const target=e.target.closest('button');if(!target||target.disabled)return;
 if(starting)return;
 if(target.dataset.recordAction==='offline'){void start('normal',true);return;}
 if(target.id==='start'){start();return;}if(target.id==='open-book'){openBook();return;}
 if(target.dataset.homeTab){homeTab=target.dataset.homeTab;renderHub();if(homeTab==='ranking')void loadBoard();else if(['challenge','achievements'].includes(homeTab))void loadRecords();return;}
 if(target.dataset.boardMode||target.dataset.boardPeriod){if(target.dataset.boardMode)boardState.mode=target.dataset.boardMode;if(target.dataset.boardPeriod)boardState.period=target.dataset.boardPeriod;void loadBoard();return;}
 if(target.dataset.recordAction){void recordAction(target);return;}
 if(target.dataset.gearItem){gearItem=target.dataset.gearItem;renderHub();return;}
 if(target.dataset.heroItem){heroItem=target.dataset.heroItem;renderHub();return;}
 if(target.dataset.progress){const outcome=progress.action(target.dataset.progress,target.dataset.item);renderHub();if(outcome.weapon){gearItem=outcome.weapon;$('loot-title').textContent=outcome.isNew?'新しい武器を獲得！':'合成用の装備を獲得';$('loot-icon').innerHTML=iconSvg(BY_ID[outcome.weapon].icon);$('loot-name').textContent=BY_ID[outcome.weapon].name;$('loot-description').textContent=outcome.isNew?BY_ID[outcome.weapon].summary:'同名装備を集めると、武器の品質を上げられます。';show('loot-dialog');sound.play('evolution');}else toast(outcome.message);if(progress.notice)toast(progress.notice);}
});
$('loot-close').addEventListener('click',()=>{close('loot-dialog');homeTab='gear';renderHub();});
$('choices').addEventListener('click',event=>{const button=event.target.closest('.choice-card');if(!button||button.disabled||!gate.ready(performance.now()))return;if(!activeRunId){invalidateRun();return;}close('choice-dialog');if(game.choose(button.dataset.id)){void sound.unlock();releaseMovement();updateHud();processEvents();if(game.mode==='playing')canvas.focus({preventScroll:true});}else show('choice-dialog');});
document.addEventListener('pointerdown',e=>gate.pointerDown(e.pointerId),true);document.addEventListener('pointerup',e=>gate.pointerUp(e.pointerId,performance.now()),true);document.addEventListener('pointercancel',e=>gate.pointerUp(e.pointerId,performance.now()),true);
canvas.addEventListener('pointerdown',e=>{if(game.mode!=='playing'||drag||e.button!==0)return;e.preventDefault();void sound.unlock();const box=canvas.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY};vector={x:0,y:0};canvas.setPointerCapture(e.pointerId);$('joystick').style.transform=`translate(${e.clientX-box.left-50}px,${e.clientY-box.top-50}px)`;$('joystick-knob').style.transform='translate(0,0)';$('joystick').hidden=false;});
canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId||game.mode!=='playing')return;e.preventDefault();const dx=e.clientX-drag.x,dy=e.clientY-drag.y;vector=movementVector(dx,dy);const len=Math.hypot(dx,dy),f=len>44?44/len:1;$('joystick-knob').style.transform=`translate(${dx*f}px,${dy*f}px)`;if(len>6&&!moved){moved=true;$('control-hint').classList.add('gone');}});
canvas.addEventListener('pointerup',e=>{if(drag?.id===e.pointerId)releaseMovement();});canvas.addEventListener('pointercancel',e=>{if(drag?.id===e.pointerId)releaseMovement();});canvas.addEventListener('lostpointercapture',e=>{if(drag?.id===e.pointerId)releaseMovement();});canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{if(e.code==='Escape'&&game.mode==='playing'){e.preventDefault();pause();return;}if(game.mode!=='playing')return;if(e.code==='Space'){e.preventDefault();game.activateHero();processEvents();return;}if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);if(!moved){moved=true;$('control-hint').classList.add('gone');}}});document.addEventListener('keyup',e=>keys.delete(e.code));
for(const id of ['menu','choice-dialog','result-dialog','revive-dialog'])$(id).addEventListener('cancel',e=>e.preventDefault());$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});
$('revive-share').addEventListener('click',shareToRevive);$('revive-end').addEventListener('click',()=>{if(revival&&activeRunId)showResult();});
$('retry').addEventListener('click',()=>start(runMode,!runRanked));$('change-weapon').addEventListener('click',returnToMenu);$('pause').addEventListener('click',pause);$('resume').addEventListener('click',resume);$('sound').addEventListener('click',()=>{sound.toggle();soundUI();});
$('pause-book').addEventListener('click',openBook);$('book-close').addEventListener('click',()=>close('book-dialog'));
document.querySelector('.book-filters').addEventListener('click',e=>{const b=e.target.closest('[data-book]');if(b){bookFilter=b.dataset.book;buildBook();}});
$('quit').addEventListener('click',()=>{$('quit-confirm').hidden=false;$('quit').hidden=true;});$('quit-no').addEventListener('click',()=>{$('quit-confirm').hidden=true;$('quit').hidden=false;});$('quit-yes').addEventListener('click',retire);
$('share').addEventListener('click',async()=>{if(sharing||!result)return;sharing=true;$('share').disabled=true;$('share-message').textContent='';try{const r=await line.share(result);$('share-message').textContent={sent:'LINEにシェアしました。',cancelled:'シェアをキャンセルしました。',opened:'LINEで送信先を選んでください。',retry:'共有画面につながりませんでした。もう一度押すとLINEを開きます。'}[r.status];}catch{$('share-message').textContent='共有画面を開けませんでした。もう一度試してください。';}finally{sharing=false;$('share').disabled=false;}});
$('line-close').addEventListener('click',()=>line.close());
function interrupted(){checkpoint();releaseMovement();gate.reset();if(game.mode==='choice')gate.open(performance.now());if(game.mode==='playing')pause();sound.suspend();}
window.addEventListener('blur',interrupted);document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupted();else{lastFrame=performance.now();accumulator=0;}});window.addEventListener('pagehide',interrupted);
window.addEventListener('storage',e=>{if(e.key!==SAVE_KEY)return;progress.refresh();if(activeRunId&&progress.p.active?.id!==activeRunId){invalidateRun();}if($('menu').open)renderHub();});
async function loadRecords(){try{await records.load();await records.flush();await records.load();}catch{}if($('menu').open)renderHub();}
async function syncRecords(){
 const current=result;
 try{
  const unlocked=await records.flush();
  if(result!==current||!current)return;
  const blocked=records.blocked.find(item=>item.id===current.runId);
  $('record-save-status').textContent=blocked?'この記録は送信条件を満たしませんでした。拠点の「今週」で詳細を確認できます。':'ランキングと実績を保存しました。';
  $('game-points-status').textContent=blocked?'記録を保存できなかったため、ガチャ用ポイントは付与されていません。':gameRewardText(records.rewardFor(current.runId));
  $('record-retry').hidden=true;
  $('result-achievements').innerHTML=unlocked.map(id=>{const a=ACHIEVEMENTS.find(a=>a.id===id);return '<p>実績達成：'+escapeHTML(a.name)+'<br>称号「'+escapeHTML(a.title)+'」'+(a.outfit?'と衣装':a.effect?'と撃破演出':'')+'を獲得！</p>';}).join('');
  if(unlocked.length)sound.play('evolution');
  // Refreshing the hub must not turn an already confirmed reward into an error.
  await records.load().catch(()=>{});
 }catch{
  if(result!==current||!current)return;
  const reward=records.rewardFor(current.runId);
  $('record-save-status').textContent=reward?'ランキングと実績を保存しました。':records.error;
  $('game-points-status').textContent=reward?gameRewardText(reward):'ガチャ用ポイントの付与結果はまだ確認できていません。';
  $('record-retry').hidden=!!reward;
 }
}
async function loadBoard(){const seq=++boardState.seq;boardState.loading=true;boardState.data=null;renderHub();try{const data=await records.board(boardState.mode,boardState.period);if(seq===boardState.seq)boardState.data=data;}catch{}finally{if(seq===boardState.seq){boardState.loading=false;if($('menu').open)renderHub();}}}
async function recordAction(button){const action=button.dataset.recordAction;if(action==='challenge'){void start('challenge');return;}button.disabled=true;try{if(action==='refresh'){await records.load();await loadBoard();}else if(action==='retry'){await records.flush();await records.load();renderHub();toast('記録を保存しました。');}else if(action==='discard'){records.discardBlocked();renderHub();}else if(action==='abandon'){await records.abandon();renderHub();toast('前の出撃を整理しました。');}else if(action==='cosmetic'){await records.update({[button.dataset.kind]:button.dataset.value});renderHub();toast('装備を変更しました。');}}catch(e){toast(e.message);renderHub();}finally{if(button.isConnected)button.disabled=false;}}
$('menu').addEventListener('submit',async e=>{if(e.target.id!=='nickname-form')return;e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await records.update({nickname:new FormData(e.target).get('nickname')});toast('名前を保存しました。');if(homeTab==='ranking')await loadBoard();}catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}});
$('encounter-action').addEventListener('pointerdown',e=>e.stopPropagation());$('encounter-action').addEventListener('click',()=>{if(game.openDangerChest()){processEvents();updateHud();}});
$('record-retry').addEventListener('click',()=>{void syncRecords();});
$('share-image').addEventListener('click',async()=>{if(!result)return;$('share-image').disabled=true;try{const state=await shareRecordImage(result,{...records.profile,title:game.options.title,outfit:game.options.outfit},renderer.art);$('share-message').textContent=state==='downloaded'?'戦績画像を保存しました。LINEに添付してシェアできます。':'戦績画像を共有しました。';}catch(e){$('share-message').textContent=e.name==='AbortError'?'画像の共有をキャンセルしました。':'戦績画像を共有できませんでした。';}finally{$('share-image').disabled=false;}});
function resizeGame(){renderer.resize();game.setViewport(runMode==='challenge'?650:renderer.worldWidth,runMode==='challenge'?900:renderer.worldHeight);}
async function boot(){
 const recovered=progress.recover(),pendingReceipt=recovered||progress.p.lastReceipt;if(pendingReceipt?.ranked&&pendingReceipt.report)records.enqueue(pendingReceipt.id,{...pendingReceipt.report,ended:pendingReceipt.report.ended||'interrupted'},pendingReceipt.account);void loadRecords();const config=loadout(progress.p);game.reset(config.weapon,config.options);renderHub();soundUI();buildBook();updateHud();const lineReady=line.init();

 try{const art=await loadArt();renderer=new Renderer(canvas,art,reduced);game.setViewport(renderer.worldWidth,renderer.worldHeight);new ResizeObserver(resizeGame).observe($('arena'));window.visualViewport?.addEventListener('resize',resizeGame);$('loading').hidden=true;show('menu');if(recovered)toast('前の冒険の報酬を持ち帰りました。');lastFrame=performance.now();requestAnimationFrame(frame);}catch{$('loading').classList.add('loading-error');$('loading').innerHTML='<p>もちたちを呼べませんでした。<br>通信を確認して、もう一度読み込んでね。</p><button id="reload" class="button primary">読み込み直す</button>';$('reload').addEventListener('click',()=>location.reload());}
 void lineReady.then(status=>{if(status.status==='error')toast('LINE連携につながりません。ゲームはそのまま遊べます。');$('line-close').hidden=!line.inClient();if($('revive-dialog').open)renderRevival();});
}
void boot();
