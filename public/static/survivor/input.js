export function movementVector(dx,dy,radius=48){
 const length=Math.hypot(dx,dy); if(length<radius*.12)return {x:0,y:0};
 const power=Math.min(1,(length/radius-.12)/.88);
 return {x:dx/length*power,y:dy/length*power};
}
// The level-up overlay must never consume the finger that was moving the hero.
export class ChoiceGate {
 constructor(){this.pointers=new Set();this.openedAt=Infinity;this.releasedAt=Infinity;}
 pointerDown(id){this.pointers.add(id);}
 pointerUp(id,now){this.pointers.delete(id);if(this.pointers.size===0&&this.releasedAt===Infinity)this.releasedAt=now;}
 open(now){this.openedAt=now;this.releasedAt=this.pointers.size?Infinity:now;}
 ready(now){return now-this.openedAt>=300 && now-this.releasedAt>=180;}
 reset(){this.pointers.clear();this.openedAt=Infinity;this.releasedAt=Infinity;}
}
