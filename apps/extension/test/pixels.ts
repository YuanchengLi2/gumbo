/** Compares where text is drawn in screenshots, to check ghost text sits exactly where accepted text lands: the ink new
 * since a "before" shot is found in two shots (ghost shown, text inserted) and each must cover the other within a pixel. */
import {PNG} from 'pngjs';
type Mask={width:number;height:number;on:Uint8Array};
export function ink(png:Buffer,threshold=55):Mask{
 const image=PNG.sync.read(png),{width,height,data}=image,counts=new Map<number,number>();
 for(let i=0;i<data.length;i+=4*7){const key=(data[i]<<16)|(data[i+1]<<8)|data[i+2];counts.set(key,(counts.get(key)??0)+1);}
 const bg=[...counts].sort((a,b)=>b[1]-a[1])[0][0],br=bg>>16&255,bgG=bg>>8&255,bb=bg&255;
 const on=new Uint8Array(width*height);
 for(let p=0;p<width*height;p++){const i=p*4;if(Math.max(Math.abs(data[i]-br),Math.abs(data[i+1]-bgG),Math.abs(data[i+2]-bb))>threshold)on[p]=1;}
 return{width,height,on};
}
export function dilate(mask:Mask,r=1):Mask{
 const out=new Uint8Array(mask.on.length);
 for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++){if(!mask.on[y*mask.width+x])continue;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<mask.width&&Y<mask.height)out[Y*mask.width+X]=1;}}
 return{...mask,on:out};
}
/** Ink in `after` that was not already in `before`. */
export function added(after:Mask,before:Mask):Mask{const base=dilate(before,1),on=new Uint8Array(after.on.length);for(let i=0;i<on.length;i++)on[i]=after.on[i]&&!base.on[i]?1:0;return{...after,on};}
/** How much of a is covered by b within r pixels (1 when a is empty). */
export function covered(a:Mask,b:Mask,r=1):number{const near=dilate(b,r);let total=0,hit=0;for(let i=0;i<a.on.length;i++)if(a.on[i]){total++;if(near.on[i])hit++;}return total?hit/total:1;}
export const count=(m:Mask)=>m.on.reduce((n,v)=>n+v,0);
