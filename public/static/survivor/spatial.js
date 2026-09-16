// Rebuilt once per simulation step; collision queries inspect only nearby cells.
export class SpatialGrid{
 constructor(size=100){this.size=size;this.cells=new Map();}
 clear(){this.cells.clear();}
 build(items){this.clear();for(const e of items){if(e.dead||e.spawnIn>0)continue;const key=Math.floor(e.x/this.size)+','+Math.floor(e.y/this.size);let cell=this.cells.get(key);if(!cell){cell=[];this.cells.set(key,cell);}cell.push(e);}}
 near(x,y,r){const out=[];for(let iy=Math.floor((y-r)/this.size);iy<=Math.floor((y+r)/this.size);iy++)for(let ix=Math.floor((x-r)/this.size);ix<=Math.floor((x+r)/this.size);ix++){const c=this.cells.get(ix+','+iy);if(c)for(const e of c)if(!e.dead)out.push(e);}return out;}
}
