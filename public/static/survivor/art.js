export const SPRITE_CROPS=[[65,65,402,402],[566,99,414,372],[1084,104,392,373],[8,487,535,484],[629,611,285,304],[1066,560,425,388]];
// The generated source is intentionally preserved. Key the neutral backdrop only
// while preparing render textures; an edge-connected flood preserves white mochi.
export function removeConnectedBackdrop(bytes,width,height){
 const marked=new Uint8Array(width*height),queue=new Int32Array(width*height);let read=0,write=0;
 const eligible=i=>{const k=i*4,r=bytes[k],g=bytes[k+1],b=bytes[k+2];return Math.max(r,g,b)-Math.min(r,g,b)<27&&(r+g+b)/3>74;};
 const offer=i=>{if(i<0||i>=marked.length||marked[i]||!eligible(i))return;marked[i]=1;queue[write++]=i;};
 for(let x=0;x<width;x++){offer(x);offer((height-1)*width+x);}for(let y=0;y<height;y++){offer(y*width);offer(y*width+width-1);}
 while(read<write){const i=queue[read++],x=i%width;bytes[i*4+3]=0;if(x)offer(i-1);if(x<width-1)offer(i+1);if(i>=width)offer(i-width);if(i<width*(height-1))offer(i+width);}
 return bytes;
}
function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('画像を読み込めませんでした'));img.src=url;});}
export async function loadArt(){
 // 画像はWebP(可逆)に置き換えてある。表示時の実サイズに合わせて縮小済みで、
 // 元の13.5MBから5.0MBまで削っている。敵・衣装の切り出しは下で width/4,
 // width/2 と動的に計算しているので、解像度が変わっても位置はズレない。
 // characters-source だけは SPRITE_CROPS がピクセル座標を直書きしているため
 // 原寸(1536x1024)のまま維持している。
 const [arena,source,enemies,outfits,lateEnemies]=await Promise.all([loadImage(new URL('./assets/endless-ground.webp',import.meta.url)),loadImage(new URL('./assets/characters-source.webp',import.meta.url)),loadImage(new URL('./assets/enemy-atlas.webp',import.meta.url)),loadImage(new URL('./assets/outfits-source.webp',import.meta.url)),loadImage(new URL('./assets/late-enemy-atlas.webp',import.meta.url))]);
 const sprites=[];const atlas=document.createElement('canvas');atlas.width=768;atlas.height=512;const ac=atlas.getContext('2d');
 for(let i=0;i<SPRITE_CROPS.length;i++){
  const [x,y,w,h]=SPRITE_CROPS[i],crop=document.createElement('canvas');crop.width=w;crop.height=h;const cc=crop.getContext('2d',{willReadFrequently:true});cc.drawImage(source,x,y,w,h,0,0,w,h);const data=cc.getImageData(0,0,w,h);removeConnectedBackdrop(data.data,w,h);cc.putImageData(data,0,0);
  const sprite=document.createElement('canvas');sprite.width=256;sprite.height=256;const c=sprite.getContext('2d');const scale=228/Math.max(w,h),dw=w*scale,dh=h*scale;c.drawImage(crop,(256-dw)/2,(256-dh)/2,dw,dh);sprites.push(sprite);ac.drawImage(sprite,(i%3)*256,Math.floor(i/3)*256);
 }
 for(let i=0;i<16;i++){const sprite=document.createElement('canvas');sprite.width=sprite.height=256;const c=sprite.getContext('2d');c.drawImage(enemies,(i%4)*enemies.width/4,Math.floor(i/4)*enemies.height/4,enemies.width/4,enemies.height/4,8,8,240,240);sprites.push(sprite);}
 const outfitAtlas=document.createElement('canvas');outfitAtlas.width=outfitAtlas.height=512;const oc=outfitAtlas.getContext('2d');
 for(let i=0;i<4;i++){const crop=document.createElement('canvas');crop.width=crop.height=outfits.width/2;const cc=crop.getContext('2d',{willReadFrequently:true});cc.drawImage(outfits,(i%2)*crop.width,Math.floor(i/2)*crop.height,crop.width,crop.height,0,0,crop.width,crop.height);const data=cc.getImageData(0,0,crop.width,crop.height);removeConnectedBackdrop(data.data,crop.width,crop.height);cc.putImageData(data,0,0);const sprite=document.createElement('canvas');sprite.width=sprite.height=256;sprite.getContext('2d').drawImage(crop,8,8,240,240);sprites.push(sprite);oc.drawImage(sprite,i%2*256,Math.floor(i/2)*256);}
 // Outfit indices22–25 are stable; late enemy sprites begin at26.
 for(let i=0;i<16;i++){const sprite=document.createElement('canvas');sprite.width=sprite.height=256;const c=sprite.getContext('2d');c.drawImage(lateEnemies,(i%4)*lateEnemies.width/4,Math.floor(i/4)*lateEnemies.height/4,lateEnemies.width/4,lateEnemies.height/4,8,8,240,240);sprites.push(sprite);}
 const atlasURL=atlas.toDataURL();document.documentElement.style.setProperty('--character-atlas',`url(${atlasURL})`);document.documentElement.style.setProperty('--outfit-atlas',`url(${outfitAtlas.toDataURL()})`);document.documentElement.style.setProperty('--default-outfit',`url(${sprites[0].toDataURL()})`);document.getElementById('favicon').href=sprites[0].toDataURL();
 return {arena,sprites};
}
