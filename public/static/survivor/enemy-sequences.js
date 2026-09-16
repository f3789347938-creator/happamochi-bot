// Every path is committed when the warning starts. No phase tracks the player.
export const SEQUENCE_PATTERNS=['gate','bloom','relay','rotor','dogleg','cage'];
const clamp=v=>Math.max(0,Math.min(1,v));
const line=(x,y,angle,length,width,fireAt,duration=.24)=>({shape:'line',x,y,angle,length,width,fireAt,duration});
const circle=(x,y,r,fireAt,duration=.22,innerR=0)=>({shape:'circle',x,y,r,innerR,fireAt,duration});
export function sequencePaths(e,p,pattern){
 const a=Math.atan2(p.y-e.y,p.x-e.x),ux=Math.cos(a),uy=Math.sin(a),nx=-uy,ny=ux;
 let paths=[];
 if(pattern==='gate'){
  const cx=p.x+nx*55,cy=p.y+ny*55;
  paths=[-78,78].map(offset=>line(cx+nx*offset-ux*260,cy+ny*offset-uy*260,a,520,18,1.4,.28));
 }else if(pattern==='bloom')paths=[circle(p.x,p.y,72,1.35),circle(p.x,p.y,190,2.3,.22,110)];
 else if(pattern==='relay')paths=[-160,-80,0,80,160].map((n,i)=>circle(p.x+ux*n,p.y+uy*n,44,1.4+i*.4));
 else if(pattern==='rotor')paths=[-.6,0,.6].map((n,i)=>line(e.x,e.y,a+n,520,12,1.4+i*.85));
 else if(pattern==='dogleg'){
  const turn=a+(e.id%2?1:-1)*Math.PI/2;
  paths=[line(e.x,e.y,a,230,e.r+5,1.45,.46),line(e.x+ux*230,e.y+uy*230,turn,160,e.r+5,2.76,.4)];
  for(const path of paths)path.dash=true;
 }else if(pattern==='cage'){
  // Rotate the doorway toward the side away from the caster. Its 120px gap
  // remains 62px wide after the player's full diameter and wall endcaps.
  const point=(x,y)=>({x:p.x+ux*x+nx*y,y:p.y+uy*x+ny*y});
  const wall=(x,y,angle,length)=>{const start=point(x,y);return line(start.x,start.y,a+angle,length,12,1.4,1.25);};
  paths=[wall(-140,-140,0,280),wall(-140,140,0,280),wall(-140,-140,Math.PI/2,280),wall(140,-140,Math.PI/2,80),wall(140,60,Math.PI/2,80),circle(p.x,p.y,95,2.4,.24)];
 }
 return paths.map((path,i)=>({...path,order:pattern==='gate'?1:pattern==='cage'?(i===5?2:1):i+1,active:false,finished:false}));
}
export function pathContains(p,path){
 if(path.shape==='circle'){
  const d=Math.hypot(p.x-path.x,p.y-path.y);
  return d<path.r+p.r&&(!path.innerR||d>path.innerR-p.r);
 }
 const dx=p.x-path.x,dy=p.y-path.y,along=dx*Math.cos(path.angle)+dy*Math.sin(path.angle),across=-dx*Math.sin(path.angle)+dy*Math.cos(path.angle);
 return along>-p.r&&along<path.length+p.r&&Math.abs(across)<path.width+p.r;
}
export function updateSequence(g,t,e,dt){
 let moved=false;const previous=t.age;t.age+=dt;t.delay=Math.max(0,t.maxDelay-t.age);e.tell=t.delay;
 for(const path of t.paths){
  const end=path.fireAt+path.duration;
  path.active=t.age>=path.fireAt&&t.age<end;path.finished=t.age>=end;
  if(previous<path.fireAt&&t.age>=path.fireAt){e.attackFlash=.3;t.fired=true;}
  if(t.age<path.fireAt||previous>=end)continue;
  if(path.dash){
   const before=clamp((previous-path.fireAt)/path.duration),after=clamp((t.age-path.fireAt)/path.duration),ux=Math.cos(path.angle),uy=Math.sin(path.angle);
   const x=path.x+ux*path.length*before,y=path.y+uy*path.length*before;
   moved=true;e.x=path.x+ux*path.length*after;e.y=path.y+uy*path.length*after;
   const dx=e.x-x,dy=e.y-y,p=g.player,u=clamp(((p.x-x)*dx+(p.y-y)*dy)/(dx*dx+dy*dy||1));
   if((p.x-x-u*dx)**2+(p.y-y-u*dy)**2<(e.r+p.r)**2)g.damagePlayer(t.damage,'attack',t.attack);
  }else if(path.active&&pathContains(g.player,path))g.damagePlayer(t.damage,'attack',t.attack);
 }
 if(t.pattern==='dogleg'){const next=t.paths.find(path=>t.age<path.fireAt);e.tell=next?next.fireAt-t.age:0;}
 if(t.age>=t.duration){t.done=true;e.attacking=null;e.sequencing=null;}
 return moved;
}
