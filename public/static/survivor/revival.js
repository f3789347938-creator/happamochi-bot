// The share operation is injected so cancellation and delayed responses can be
// checked without ever sending a real LINE message during automated tests.
export class Revival {
 constructor(game,{share,isCurrent}){this.game=game;this.share=share;this.isCurrent=isCurrent;this.pending=false;this.closed=false;this.requestId=0;}
 invalidate(){this.closed=true;this.requestId++;this.pending=false;}
 async attempt(){
  if(this.closed||!this.game.canRevive()||!this.isCurrent())return {status:'stale'};
  if(this.pending)return {status:'busy'};
  this.pending=true;const id=++this.requestId;
  try{
   let outcome;try{outcome=await this.share();}catch{outcome={status:'failed'};}
   if(this.closed||id!==this.requestId||!this.game.canRevive()||!this.isCurrent())return {status:'stale'};
   if(outcome?.status!=='sent')return {status:outcome?.status||'failed'};
   if(!this.game.revive())return {status:'stale'};
   this.closed=true;return {status:'revived'};
  }finally{if(id===this.requestId)this.pending=false;}
 }
}
