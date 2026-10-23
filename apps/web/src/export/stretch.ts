/** A clip's sound at another speed with its pitch kept, as ffmpeg's atempo does it for the desktop export: WSOLA. Each
 * 40 ms output frame is read from where the speed puts it in the source, moved by up to 10 ms to where it best continues
 * the frame before (so voices and notes do not stutter), and the frames overlap by half under a Hann window, which sums
 * to one. The best position is found on every fourth sample first, then to the sample. */
const FRAME=1920,HOP=FRAME/2,TOLERANCE=480,STEP=4;
const hann=Float32Array.from({length:FRAME},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/FRAME));

export function stretch(planes:Float32Array[],speed:number,length:number):Float32Array[]{
 const size=planes[0]?.length??0,out=planes.map(()=>new Float32Array(length+FRAME));
 const mono=new Float32Array(size);for(const p of planes)for(let i=0;i<size;i++)mono[i]+=p[i]/planes.length;
 const similarity=(a:number,b:number,count:number,step:number)=>{let dot=0,energy=1e-9;for(let i=0;i<count;i+=step){const x=mono[a+i]??0,y=mono[b+i]??0;dot+=x*y;energy+=y*y;}return dot/Math.sqrt(energy);};
 const last=Math.max(0,size-FRAME);let previous=0;
 for(let k=0;k*HOP<length;k++){
  const nominal=Math.min(last,Math.round(k*HOP*speed));let best=nominal;
  if(k>0){
   // What would naturally follow the previous frame, compared over half a frame.
   const follow=previous+HOP,from=Math.max(0,nominal-TOLERANCE),to=Math.min(last,nominal+TOLERANCE);let top=-Infinity;
   for(let c=from;c<=to;c+=STEP){const s=similarity(follow,c,HOP,STEP);if(s>top){top=s;best=c;}}
   const coarse=best;top=-Infinity;for(let c=Math.max(from,coarse-STEP+1);c<=Math.min(to,coarse+STEP-1);c++){const s=similarity(follow,c,HOP,1);if(s>top){top=s;best=c;}}
  }
  previous=best;const at=k*HOP;
  // The first frame's rising half is played at full level: nothing comes before it to overlap.
  for(let ch=0;ch<planes.length;ch++){const src=planes[ch],dst=out[ch];for(let i=0;i<FRAME&&best+i<size;i++)dst[at+i]+=src[best+i]*(k===0&&i<HOP?1:hann[i]);}
 }
 return out.map(o=>o.subarray(0,length));
}
