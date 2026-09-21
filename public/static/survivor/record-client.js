import {RULESET,reportOf,weekAt} from './records.js';
import {getAccessToken,initLiff} from './liff-auth.js';
const QUEUE='mochi-record-outbox-v1',TERMINAL='mochi-record-receipts-v1';
// APIの置き場所。元パックは '/api' 直下だったが、この葉っぱもちBotには
// 既に /api/mochi/* などが居るので /api/survivor/* に分けている。
const API_BASE='/api/survivor';
// A stalled SDK must release the departure button and its offline fallback.
export async function waitForRecordLogin(initialize=initLiff,timeoutMs=8000){
 let timer;
 try{return await Promise.race([
  initialize(),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('LINE連携に時間がかかっています。もう一度試してください。')),timeoutMs);}),
 ]);}finally{clearTimeout(timer);}
}
export class RecordClient{
 constructor(storage,fetcher=(...args)=>globalThis.fetch(...args)){this.storage=storage;this.fetcher=fetcher;this.profile=null;this.account=null;this.flushing=null;this.week=weekAt();this.challengeBest=0;this.active=null;this.error='';this.busy=false;this.queue=[];this.rewards=new Map();this.terminal=new Set();try{const handled=JSON.parse(storage?.getItem(TERMINAL)||'[]');if(Array.isArray(handled))this.terminal=new Set(handled.filter(x=>typeof x==='string').slice(-80));}catch{}try{const value=JSON.parse(storage?.getItem(QUEUE)||'[]');if(Array.isArray(value))this.queue=value.filter(r=>typeof r.id==='string'&&r.report).slice(-20);}catch{}}
 // すべてのリクエストにアクセストークンを添える。
 // userId は送らない。誰なのかはサーバーがLINEに問い合わせて決める。
 async request(path,body){
  const token=getAccessToken();
  if(!token){const e=new Error('記録を使うにはLINEでログインしてください。');e.status=401;this.error=e.message;throw e;}
  // GETでもトークンが要るので、読み取り系もPOSTで送る形に統一する。
  const payload={...(body||{}),accessToken:token};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const res=await this.fetcher(API_BASE+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',signal:controller.signal});
   let data;try{data=await res.json();}catch{throw Error('記録サービスにつながりません。');}
   if(!res.ok){const e=new Error(data.error||'記録を保存できませんでした。');e.status=res.status;throw e;}
   this.error='';return data;
  }catch(e){this.error=e.name==='AbortError'?'通信に時間がかかっています。もう一度試してください。':e.message;throw e;}
  finally{clearTimeout(timer);}
 }
 async load(){const data=await this.request('/me');this.profile=data.profile;this.account=data.account;this.week=data.week;this.challengeBest=data.challengeBest;this.active=data.active;return data;}
 async start(id,mode,weapon){if(!this.account)await this.load();const data=await this.request('/runs/start',{id,mode,weapon,ruleset:RULESET});if(data.week.key!==this.week.key)this.challengeBest=0;this.week=data.week;this.active={id:data.id,mode:data.mode};return data;}
 persist(){try{this.storage?.setItem(QUEUE,JSON.stringify(this.queue));this.storage?.setItem(TERMINAL,JSON.stringify([...this.terminal].slice(-80)));}catch{this.error='未送信の記録を端末に保存できません。この画面を閉じずに再送してください。';}}
 enqueue(id,report,account=this.account){if(this.terminal.has(id))return;if(!this.queue.some(r=>r.id===id))this.queue.push({id,account,report:reportOf(report)});this.persist();}
 get pending(){return this.queue.filter(r=>!r.account||r.account===this.account);}
 get blocked(){return this.pending.filter(r=>r.blocked);}
 discardBlocked(){for(const r of this.blocked)this.terminal.add(r.id);this.queue=this.queue.filter(r=>!this.blocked.includes(r));this.persist();}
 flush(){if(this.flushing)return this.flushing;this.busy=true;this.flushing=(async()=>{const unlocked=[];
  while(true){const item=this.pending.find(r=>!r.blocked);if(!item)break;try{const data=await this.request('/runs/finish',item);this.profile=data.profile;unlocked.push(...data.unlocked);this.rewards.set(item.id,data.reward||null);if(this.rewards.size>80)this.rewards.delete(this.rewards.keys().next().value);this.terminal.add(item.id);this.queue=this.queue.filter(r=>r!==item);this.persist();}catch(e){if([400,404,409].includes(e.status)){item.blocked=e.message;this.persist();continue;}throw e;}}
  return [...new Set(unlocked)];
 })().finally(()=>{this.busy=false;this.flushing=null;});return this.flushing;}
 rewardFor(id){return this.rewards.get(id)||null;}

 async update(changes){const data=await this.request('/profile',changes);this.profile=data.profile;return data;}
 async board(mode='normal',period='week'){return this.request('/leaderboard',{mode,period});}
 async abandon(){if(this.active){await this.request('/runs/abandon',{id:this.active.id});this.active=null;}return this.load();}
 cosmetics(){const p=this.profile;return p?{title:p.title,outfit:p.outfit,killEffect:p.killEffect}:{};}
}
