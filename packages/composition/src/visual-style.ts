import type {CSSProperties} from 'react';
import {keyframeValues,clipClock,type SpineClip,type ResolvedClip,type ResolvedItem,type TimelineDocument,type Keyframe,type KeyframeValues} from '@dream/timeline';
/** White balance as an SVG colour matrix: warmer raises red and lowers blue, cooler the reverse, and green follows red a
 * little, as a real white-balance shift does. Sepia plus a hue rotation, used before, turned every colour around the wheel
 * and made cool footage warmer. Values are kept to hundredths so each distinct temperature has one filter. */
export const whiteBalance=(t:number)=>Math.round(Math.max(-1,Math.min(1,t))*100)/100;
export const whiteBalanceId=(t:number)=>`dream-wb-${Math.round(whiteBalance(t)*100)}`;
export function whiteBalanceMatrix(t:number){const k=whiteBalance(t),r=1+.25*k,g=1+.04*k,b=1-.25*k;return`${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`;}
const whiteBalanceFilter=(t:number)=>whiteBalance(t)?` url(#${whiteBalanceId(t)})`:'';
/** Every temperature the timeline uses, on clips and on grade layers, so the composition can define their filters. */
export function whiteBalances(timeline:TimelineDocument){return[...new Set([...timeline.spine.map(c=>c.framing?.temperature??0),...timeline.attached.filter(i=>i.type==='effect'&&i.component==='grade').map(i=>Number((i.params as any).temperature??0)),...[...timeline.spine,...timeline.attached].flatMap(i=>keyframedTemperatures(i.keyframes))].map(whiteBalance).filter(t=>t!==0))];}
/** Keyframed temperature passes through every hundredth between its keyframes, so each needs a filter. */
function keyframedTemperatures(keyframes:Keyframe[]|undefined){const values=(keyframes??[]).map(k=>k.temperature).filter((t):t is number=>t!==undefined);if(!values.length)return[];const low=Math.round(Math.min(0,...values)*100),high=Math.round(Math.max(0,...values)*100);return Array.from({length:high-low+1},(_,n)=>(low+n)/100);}
/** Keyframed values over the clip's framing. x and y place the picture's centre in the frame (.5 centred). */
export function keyframedFraming(framing:SpineClip['framing'],values:KeyframeValues){const {x,y,...rest}=values;return{framing:{...framing,...rest} as SpineClip['framing'],x:x??.5,y:y??.5};}
export function clipStyle(framing:SpineClip['framing'],motionScale=1,dx=0,x=.5,y=.5):CSSProperties{
 const f=framing;const exposure=f?.exposure??0,contrast=f?.contrast??1,saturation=f?.saturation??1,temperature=f?.temperature??0;
 return{width:'100%',height:'100%',objectFit:f?.mode==='fill'||f?.mode==='face'?'cover':'contain',objectPosition:`${(f?.x??.5)*100}% ${(f?.y??.5)*100}%`,opacity:f?.opacity??1,transform:`translate(${(x-.5)*100}%,${(y-.5)*100}%) translateX(${dx}px) rotate(${f?.rotation??0}deg) scale(${(f?.scale??1)*motionScale}) scaleX(${f?.flipX?-1:1}) scaleY(${f?.flipY?-1:1})`,filter:`brightness(${2**exposure}) contrast(${contrast}) saturate(${saturation})${whiteBalanceFilter(temperature)}`};
}
/** A layer's params with its keyframed values at elapsed seconds since it starts (x, y, scale, rotation and opacity
 * keep the meaning they have as params). */
export function keyedParams(item:ResolvedItem,elapsed:number):Record<string,unknown>{return item.keyframes?.length?{...item.params,...keyframeValues(item.keyframes,(item.source?.srcIn??0)+elapsed)}:item.params;}
export const keyframesColour=(item:ResolvedItem)=>!!item.keyframes?.some(k=>k.exposure!==undefined||k.contrast!==undefined||k.saturation!==undefined||k.temperature!==undefined);
export function gradeFilter(params:Record<string,unknown>){return `brightness(${2**Number(params.exposure??0)}) contrast(${Number(params.contrast??1)}) saturate(${Number(params.saturation??1)})${whiteBalanceFilter(Number(params.temperature??0))}`;}

export function clipStyleAt(clip:ResolvedClip,timeline:TimelineDocument,items:ResolvedItem[],time:number):CSSProperties{
 let scale=1,dx=0,grade='';const frame=Math.max(0,(time-clip.start)*timeline.settings.fps),progress=Math.max(0,Math.min(1,(time-clip.start)/(clip.end-clip.start)));
 for(const item of items){if(item.type!=='effect'||timeline.trackSettings?.['visual:'+item.layer]?.hidden||time<item.timelineStart||time>=item.timelineEnd)continue;const p=item.params;if(item.component==='slow_push')scale*=1+progress*Number(p.amount??.08);if(item.component==='punch_zoom')scale*=1+Number(p.amount??.15);if(item.component==='shake')dx=Math.sin(frame*2.7)*Number(p.amount??.1)*40;if(item.component==='grade')grade+=' '+gradeFilter(p);}
 const keyed=keyframedFraming(clip.framing,keyframeValues(clip.keyframes,clipClock(clip,time)));
 const style=clipStyle(keyed.framing,scale,dx,keyed.x,keyed.y);style.filter=String(style.filter)+grade;return style;
}
