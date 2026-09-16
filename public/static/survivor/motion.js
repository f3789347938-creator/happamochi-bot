// Poses use simulation time. Rendering never advances motion or weapon state.
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const DRONES={
 droneA:{radius:86,phase:Math.PI,speed:1.55,color:'#ffc6e6',size:46},
 droneB:{radius:111,phase:0,speed:-1.4,color:'#b6ffd3',size:46},
 destroyer:{radius:98,phase:-Math.PI/2,speed:1.2,color:'#ffe29b',size:61},
 medidrone:{radius:74,phase:-Math.PI/2,speed:.85,color:'#a4ffbf',size:45},
 holy:{radius:96,phase:Math.PI,speed:1.3,color:'#ffc7ee',size:56},
 redeemer:{radius:110,phase:0,speed:-1.3,color:'#b6fff0',size:56},
 divine:{radius:104,phase:-Math.PI/2,speed:1.1,color:'#fff0af',size:64},
};
export function initialMotion(){return {move:0,stride:0,lean:0,leanY:0,fire:0,strike:null,throw:null,trail:[],trailAt:0,anchorX:0,anchorY:0};}
// Elevation is separate from world Y: throwing north or south follows the same arc.
export function bottlePose(s,age=s.age){
 const u=clamp(age/s.maxLife,0,1),arc=s.arcHeight||62;
 return {x:u===1?s.targetX:s.originX+(s.targetX-s.originX)*u,y:u===1?s.targetY:s.originY+(s.targetY-s.originY)*u,
  height:24*(1-u)+4*arc*u*(1-u),rotation:s.angle-Math.PI/2+u*Math.PI*1.6,progress:u};
}
export function weaponPose(g){
 const m=g.motion,id=g.mainWeapon,melee=['bat','katana','lightchaser','sword','twinLance'].includes(id),strike=m.strike;
 const cd=g.cooldowns[id]??1,wind=melee&&!strike&&g.enemies.some(e=>!e.dead&&e.spawnIn<=0)&&(cd>0&&cd<.14)?1-cd/.14:0;
 const t=strike?clamp(1-strike.life/strike.maxLife,0,1):0,swing=strike?-.95+2.3*(1-(1-Math.min(1,t/.7))**3):-.95*wind;
 const recoil=m.fire*(id==='shotgun'?9:id==='revolver'?7:3),angle=(strike?.angle??g.attackAim)+(melee?swing:0);
 return {id,melee,wind,angle,recoil,reach:melee?24+Math.sin(t*Math.PI)*7:26-recoil};
}
export function updateMotion(g,dt,input){
 const m=g.motion,p=g.player,ease=1-Math.exp(-dt*12);
 m.move+=((g.moving?1:0)-m.move)*ease;m.lean+=(input.x-m.lean)*ease;m.leanY+=(input.y-m.leanY)*ease;
 if(g.moving)m.stride=(m.stride+Math.min(1,Math.hypot(input.x,input.y))*g.speed()*dt/19)%TAU;
 m.fire=Math.max(0,m.fire-dt*7);
 if(m.strike){m.strike.life-=dt;if(m.strike.life<=0)m.strike=null;}
 if(m.throw){m.throw.life-=dt;if(m.throw.life<=0)m.throw=null;}
 for(const t of m.trail)t.life-=dt;m.trail=m.trail.filter(t=>t.life>0);
 if(g.moving&&g.time>=m.trailAt){m.trailAt=g.time+.055;m.trail.push({x:p.x,y:p.y,life:.45});if(m.trail.length>10)m.trail.shift();}
 const dx=p.x-m.anchorX,dy=p.y-m.anchorY;if(Math.hypot(dx,dy)>180){m.anchorX=p.x;m.anchorY=p.y;}else{m.anchorX+=dx*ease;m.anchorY+=dy*ease;}
}
export function dronePose(g,id){
 const spec=DRONES[id];if(!spec)return null;
 const p=g.player,m=g.motion,state=g.weaponStates[id],phase=spec.phase+g.time*spec.speed;
 const ax=p.x+clamp((m?.anchorX??p.x)-p.x,-60,60),ay=p.y+clamp((m?.anchorY??p.y)-p.y,-60,60);
 const hover=Math.sin(g.time*3.6+spec.phase)*3.5,depth=ay+Math.sin(phase)*spec.radius*.63;
 const fire=Number.isFinite(state?.firedAt)?clamp(1-(g.time-state.firedAt)/.22,0,1):0;
 return {id,drone:true,x:ax+Math.cos(phase)*spec.radius,y:depth-24+hover,depth,hover,phase,
  anchorX:ax,anchorY:ay,radius:spec.radius,color:spec.color,size:spec.size,fire,direction:Math.sign(spec.speed),
  tilt:clamp(-Math.sin(phase)*spec.speed*.11+(p.x-ax)*.006,-.32,.32),spin:g.time*(spec.speed<0?-12:12),
 };
}
