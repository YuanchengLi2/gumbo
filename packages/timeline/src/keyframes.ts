import {z} from 'zod';
import {rampProgress,rampTime,type SpeedRamp} from './ramp';
/** CapCut-style keyframes on a clip or a layer. Each keyframe sits on the item's source clock (the seconds of srcIn and
 * srcOut), so trimming, splitting and speed changes keep it on the same moment of footage. A property animates between the
 * keyframes that set it; before the first and after the last it holds. A keyframe's easing shapes the move that arrives at
 * it. The player draws them live and Export draws the same values; nothing is baked. */
export const KEYFRAME_EASINGS=['linear','ease_in','ease_out','ease_in_out','hold'] as const;
export const KeyframeSchema=z.object({
 sec:z.number().nonnegative().describe('On the source clock: the same seconds as srcIn/srcOut (a held still counts from srcIn).'),
 easing:z.enum(KEYFRAME_EASINGS).default('linear').describe('Shape of the move arriving at this keyframe; hold jumps here at its time.'),
 scale:z.number().min(.05).max(20).optional().describe('Size; 1 is the clip\'s normal size.'),
 x:z.number().min(-2).max(3).optional().describe('Where the picture\'s centre sits across the frame; .5 is centred, lower moves it left.'),
 y:z.number().min(-2).max(3).optional().describe('Where the picture\'s centre sits down the frame; .5 is centred, lower moves it up.'),
 rotation:z.number().min(-3600).max(3600).optional().describe('Degrees clockwise.'),
 opacity:z.number().min(0).max(1).optional(),
 exposure:z.number().min(-2).max(2).optional().describe('Stops.'),
 contrast:z.number().min(0).max(3).optional(),
 saturation:z.number().min(0).max(3).optional(),
 temperature:z.number().min(-1).max(1).optional().describe('Negative cooler, positive warmer.')
});
export type Keyframe=z.infer<typeof KeyframeSchema>;
export const KEYFRAME_PROPS=['scale','x','y','rotation','opacity','exposure','contrast','saturation','temperature'] as const;
export type KeyframeProp=typeof KEYFRAME_PROPS[number];
export type KeyframeValues=Partial<Record<KeyframeProp,number>>;

const ease=(easing:Keyframe['easing']|undefined,t:number)=>easing==='hold'?0:easing==='ease_in'?t*t:easing==='ease_out'?1-(1-t)*(1-t):easing==='ease_in_out'?(t<.5?2*t*t:1-2*(1-t)*(1-t)):t;
/** The animated values at a moment on the source clock; a property no keyframe sets is absent. */
export function keyframeValues(keyframes:Keyframe[]|undefined,sec:number):KeyframeValues{
 const out:KeyframeValues={};if(!keyframes?.length)return out;
 const sorted=[...keyframes].sort((a,b)=>a.sec-b.sec);
 for(const prop of KEYFRAME_PROPS){
  const points=sorted.filter(k=>k[prop]!==undefined);if(!points.length)continue;
  const next=points.findIndex(k=>k.sec>sec);
  if(next===0){out[prop]=points[0][prop];continue;}if(next<0){out[prop]=points.at(-1)![prop];continue;}
  const a=points[next-1],b=points[next],t=ease(b.easing,(sec-a.sec)/Math.max(1e-9,b.sec-a.sec));out[prop]=a[prop]!+(b[prop]!-a[prop]!)*t;
 }
 return out;
}
type Clocked={start:number;srcIn:number;speed:number;holdSec?:number;end?:number;srcOut?:number;speedRamp?:SpeedRamp};
const ramped=(c:Clocked):c is Clocked&{end:number;srcOut:number;speedRamp:SpeedRamp}=>!!c.speedRamp&&!c.holdSec&&c.end!==undefined&&c.srcOut!==undefined&&c.end>c.start;
/** A spine clip's source clock at a timeline time: srcIn plus elapsed time at the clip's speed (a held still runs at 1),
 * or along its speed curve when it has one (a placed clip, with its end). */
export const clipClock=(clip:Clocked,time:number)=>ramped(clip)?clip.srcIn+(clip.srcOut-clip.srcIn)*rampProgress(clip.speedRamp,(time-clip.start)/(clip.end-clip.start)):clip.srcIn+(time-clip.start)*(clip.holdSec?1:clip.speed);
/** The timeline time where a clip's source clock reads sec. */
export const clipTimeAt=(clip:Clocked,sec:number)=>ramped(clip)?clip.start+(clip.end-clip.start)*rampTime(clip.speedRamp,(sec-clip.srcIn)/Math.max(1e-9,clip.srcOut-clip.srcIn)):clip.start+(sec-clip.srcIn)/(clip.holdSec?1:clip.speed);
/** A layer's source clock: its source's srcIn plus elapsed time (seconds since it starts when it has no source). */
export const itemClock=(item:{timelineStart:number;source?:{srcIn:number}},time:number)=>(item.source?.srcIn??0)+time-item.timelineStart;
export const itemTimeAt=(item:{timelineStart:number;source?:{srcIn:number}},sec:number)=>item.timelineStart+sec-(item.source?.srcIn??0);
