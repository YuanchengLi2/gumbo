import {z} from 'zod';
/** Speed curves, as CapCut's speed ramps: a clip's speed rises and falls along a preset shape while it plays the same
 * stretch of source in the same time, so a ramp never changes the edit's length or what follows. `amount` (0-1) is how
 * far the speed swings. The player and Export both read the source time from here, and the clip's own sound is left out
 * while it is ramped (its words are not captioned), as the picture no longer plays at one speed. */
export const SPEED_RAMPS=[
 {id:'montage',name:'Montage',about:'Fast, slow, fast, slow: a beat-cut feel.'},
 {id:'hero',name:'Hero',about:'Normal, a slow-motion moment in the middle, normal again.'},
 {id:'bullet',name:'Bullet',about:'Fast in and out with a long slow-motion middle.'},
 {id:'jump',name:'Jump cut',about:'Normal, a sudden burst of speed in the middle, normal.'},
 {id:'flash_in',name:'Flash in',about:'Starts fast and slows to normal.'},
 {id:'flash_out',name:'Flash out',about:'Starts normal and speeds away.'}] as const;
export const SPEED_RAMP_IDS=['montage','hero','bullet','jump','flash_in','flash_out'] as const;
export type SpeedRampId=typeof SPEED_RAMP_IDS[number];
export const SpeedRampSchema=z.object({preset:z.enum(SPEED_RAMP_IDS),amount:z.number().min(0).max(1).default(1)});
export type SpeedRamp=z.infer<typeof SpeedRampSchema>;

/** The curve's speed (before it is evened out to keep the clip's length) at u, 0-1 through the clip. */
function shape(preset:SpeedRampId,a:number,u:number){
 const bump=(c:number,w:number,p=2)=>Math.exp(-Math.pow(Math.abs(u-c)/w,p));
 switch(preset){
  case 'montage':return 1+.75*a*Math.cos(4*Math.PI*u);
  case 'hero':return 1-.85*a*bump(.5,.15);
  case 'bullet':return 1+1.5*a-2.3*a*bump(.5,.28,4);
  case 'jump':return 1+4*a*bump(.5,.08);
  case 'flash_in':return 1+3*a*(1-u)*(1-u);
  case 'flash_out':return 1+3*a*u*u;
 }
}
const STEPS=256,tables=new Map<string,Float64Array>();
/** How far through its source a ramped clip is (0-1) at each of STEPS+1 points through its time, evened out to end at 1. */
function table(r:SpeedRamp){
 const key=r.preset+':'+r.amount;let t=tables.get(key);if(t)return t;t=new Float64Array(STEPS+1);
 for(let n=1;n<=STEPS;n++)t[n]=t[n-1]+(shape(r.preset,r.amount,(n-1)/STEPS)+shape(r.preset,r.amount,n/STEPS))/2;
 const total=t[STEPS];for(let n=0;n<=STEPS;n++)t[n]/=total;tables.set(key,t);return t;
}
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
/** Source progress (0-1) at time progress u (0-1). */
export function rampProgress(r:SpeedRamp,u:number){const t=table(r),x=clamp01(u)*STEPS,n=Math.min(STEPS-1,Math.floor(x));return t[n]+(t[n+1]-t[n])*(x-n);}
/** The speed at u as a share of the clip's own speed (1 is the clip's speed). */
export function rampRate(r:SpeedRamp,u:number){const t=table(r),n=Math.min(STEPS-1,Math.floor(clamp01(u)*STEPS));return(t[n+1]-t[n])*STEPS;}
/** Time progress (0-1) where the source progress is s: the inverse of rampProgress. */
export function rampTime(r:SpeedRamp,s:number){const t=table(r),v=clamp01(s);let lo=0,hi=STEPS;while(hi-lo>1){const mid=(lo+hi)>>1;if(t[mid]<=v)lo=mid;else hi=mid;}return(lo+(t[hi]>t[lo]?(v-t[lo])/(t[hi]-t[lo]):0))/STEPS;}
