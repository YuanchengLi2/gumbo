import {resolve,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';

const sec=(n:number)=>`${Math.round(n*10)/10}s`;
const grade=(f:any)=>f?['exposure','contrast','saturation','temperature'].filter(k=>typeof f[k]==='number').map(k=>`${k} ${f[k]}`).join(', '):'';

/** The footage index's line for a source range: what its main shot shows and what was measured (camera, light, sharpness,
 * cuts inside it). Frames remain the truth; the line says what to expect and where to look. */
export type SourceFacts=(assetId:string,srcIn:number,srcOut:number,speed:number)=>string|undefined;
/** What is in the video, in order, one line per clip, item and music track with its place on the timeline: enough to act
 * on "the middle clip" or "the title" without reading project.json. With the footage index, each clip and footage item says
 * what its source range shows and how it was shot, so the edit reads as its material. */
export function timelineOutline(t:TimelineDocument,footage:FootageIndex,limit=40,facts?:SourceFacts){
 const resolved=resolve(t,footage),names=new Map(footage.assets.map(a=>[a.id,a.scene?`scene ${a.filename}`:a.filename]));
 const name=(assetId:string)=>names.get(assetId)??assetId,seen=(assetId:string,srcIn:number,srcOut:number,speed=1)=>{const line=facts?.(assetId,srcIn,srcOut,speed);return line?` | ${line}`:'';};
 const clips=resolved.clips.map((c,n)=>`${n+1}. ${c.id} at ${sec(c.start)}-${sec(c.end)}: ${name(c.assetId)} ${sec(c.srcIn)}-${sec(c.srcOut)}${c.speed!==1?`, speed ${c.speed}`:''}${c.framing&&c.framing.mode!=='fit'?`, ${c.framing.mode}`:''}${c.framing&&(c.framing.scale??1)!==1?`, scale ${c.framing.scale}`:''}${grade(c.framing)?`, ${grade(c.framing)}`:''}${c.keyframes?.length?`, ${c.keyframes.length} keyframes`:''}${c.transitionIn&&c.transitionIn.type!=='cut'?`, ${c.transitionIn.type} in`:''}${c.audio?.mute?', muted':''}${seen(c.assetId,c.srcIn,c.srcOut,c.speed)}`);
 const items=resolved.items.map(i=>`${i.type} ${i.id} at ${sec(i.timelineStart)}-${sec(i.timelineEnd)}: ${i.source?name(i.source.assetId)+seen(i.source.assetId,i.source.srcIn,i.source.srcOut):i.component}`);
 const music=resolved.music.map(m=>`music ${m.id} at ${sec(m.timelineStart)}-${sec(m.timelineEnd)}: ${name(m.assetId)}, ${m.gainDb} dB`);
 const lines=[...clips.slice(0,limit),...(clips.length>limit?[`…and ${clips.length-limit} more clips`]:[]),...items.slice(0,20),...music.slice(0,8),...(t.captions?[`captions: ${t.captions.style}`]:[])];
 return{durationSec:Math.round(resolved.durationSec*10)/10,lines};
}
