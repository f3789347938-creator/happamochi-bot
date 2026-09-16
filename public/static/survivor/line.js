import {LINE_CONFIG} from './line-config.js';
import {BY_ID} from './abilities.js';
export function validLiffId(id){return typeof id==='string'&&/^\d{6,20}-[a-zA-Z0-9]{3,32}$/.test(id);}
export function safePublicLink(value){
 if(!value)return '';try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return '';if(!['miniapp.line.me','liff.line.me'].includes(url.hostname))return '';if(!/^\/\d{6,20}-[a-zA-Z0-9]{3,32}\/?$/.test(url.pathname))return '';return url.origin+url.pathname.replace(/\/$/,'');}catch{return '';}
}
export function resultText(result,config=LINE_CONFIG){
 const seconds=Math.max(0,Math.floor(result.seconds||0)),time=Math.floor(seconds/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0');
 const lines=['もち軍団サバイバル・エンドレス',`🌿 ${time} 生存！`, `スコア ${Math.max(0,Math.floor(result.score)).toLocaleString('ja-JP')} / Lv.${Math.max(1,Math.floor(result.level))}`,`倒した敵 ${Math.max(0,Math.floor(result.kills))}体 / ボス ${Math.max(0,Math.floor(result.bossKills||0))}体`];
 if(result.recordTitle)lines.push('称号：'+String(result.recordTitle).slice(0,30));if(result.runMode==='challenge')lines.push('週間チャレンジ');
 const evolved=(result.evolved||[]).filter(id=>BY_ID[id]).map(id=>BY_ID[id].name);if(evolved.length)lines.push('進化：'+evolved.join('・'));
 const link=safePublicLink(config.publicAppUrl);if(link)lines.push('あなたのもち軍団でも挑戦！',link);return lines.join('\n');
}
export function lineShareURL(text){return 'https://line.me/R/share?text='+encodeURIComponent(text);}
export function officialAccountCard(config=LINE_CONFIG){
 const id=typeof config.officialAccountId==='string'?config.officialAccountId.trim():'';
 if(!/^@[A-Za-z0-9._-]{3,32}$/.test(id))return null;
 const name=(typeof config.officialAccountName==='string'?config.officialAccountName.trim():'').slice(0,60)||id;
 const contents={type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:'公式LINEのご紹介',size:'sm',color:'#49776A'},{type:'text',text:name,weight:'bold',size:'xl',wrap:true},{type:'text',text:id,size:'sm',color:'#666666'},{type:'text',text:'友だち追加はこちらから。',size:'md',wrap:true}]},footer:{type:'box',layout:'vertical',contents:[{type:'button',style:'primary',color:'#06A34F',action:{type:'uri',label:'友だち追加',uri:'https://line.me/R/ti/p/'+encodeURIComponent(id)}}]}};
 // The optional image must be explicitly configured, never inferred from this page.
 if(config.officialAccountImageUrl){try{const u=new URL(config.officialAccountImageUrl);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.hostname.endsWith('.chatgpt.site'))contents.hero={type:'image',url:u.href,size:'full',aspectRatio:'1:1',aspectMode:'cover'};}catch{}}
 return {type:'flex',altText:name+'の公式LINEをご紹介',contents};
}
export class LineBridge {
 constructor({window:win=globalThis.window,document:doc=globalThis.document,config=LINE_CONFIG}={}){this.win=win;this.doc=doc;this.config=config;this.status='idle';this.sdk=null;this.forceURL=false;this.promise=null;}
 init(){
  if(this.promise)return this.promise;
  if(!this.config.liffId){this.status='unconfigured';return Promise.resolve({status:this.status});}
  if(!validLiffId(this.config.liffId)){this.status='error';return Promise.resolve({status:this.status});}
  this.status='loading';
  this.promise=(async()=>{
   let timer;try{
    const work=(async()=>{
     if(!this.win.liff)await new Promise((resolve,reject)=>{const script=this.doc.createElement('script');script.src='https://static.line-scdn.net/liff/edge/2/sdk.js';script.async=true;script.charset='utf-8';script.onload=resolve;script.onerror=()=>reject(new Error('LINE SDK unavailable'));this.doc.head.appendChild(script);});
     const sdk=this.win.liff;if(!sdk)throw new Error('LINE SDK unavailable');
     // Do not change or copy location before init resolves: it can contain tokens.
     await sdk.init({liffId:this.config.liffId,withLoginOnExternalBrowser:false});return sdk;
    })();
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('LINE connection timed out')),10000);});
    this.sdk=await Promise.race([work,timeout]);this.status='ready';return {status:'ready',inClient:this.sdk.isInClient()};
   }catch{this.status='error';return {status:'error'};}finally{clearTimeout(timer);}
  })();return this.promise;
 }
 inClient(){return this.status==='ready'&&!!this.sdk?.isInClient();}
 close(){if(this.inClient())this.sdk.closeWindow();}
 revivalAvailability(){
  if(!validLiffId(this.config.liffId)||!officialAccountCard(this.config))return 'unconfigured';
  if(this.status==='loading'||this.status==='idle')return 'loading';
  try{if(this.status!=='ready'||!this.sdk?.isLoggedIn()||!this.sdk.isApiAvailable('shareTargetPicker'))return 'unavailable';}catch{return 'unavailable';}
  return 'ready';
 }
 async shareRevival(){
  const available=this.revivalAvailability();if(available!=='ready')return {status:available};
  // A URL-scheme launch has no delivery acknowledgement and cannot grant a revive.
  try{const sent=await this.sdk.shareTargetPicker([officialAccountCard(this.config)],{isMultiple:true});return {status:sent?.status==='success'?'sent':sent===undefined?'cancelled':'failed'};}
  catch{return {status:'failed'};}
 }
 async share(result){
  const text=resultText(result,this.config);
  if(!this.forceURL&&this.status==='ready'&&this.sdk.isApiAvailable('shareTargetPicker')){
   try{const sent=await this.sdk.shareTargetPicker([{type:'text',text}],{isMultiple:true});return {status:sent?.status==='success'?'sent':'cancelled'};}
   catch{this.forceURL=true;return {status:'retry'};}
  }
  // Synchronous navigation during the user's click, with no recipient preselected.
  const link=this.doc.createElement('a');link.href=lineShareURL(text);link.target='_blank';link.rel='noopener noreferrer';link.style.display='none';this.doc.body.appendChild(link);link.click();link.remove();return {status:'opened'};
 }
}
