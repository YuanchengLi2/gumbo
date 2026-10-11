import {resolve,type TimelineDocument} from '@dream/timeline';
import {rangeProblems,problemWords,type FootageIndex} from '@dream/footage';

const sec=(n:number)=>`${Math.round(n*10)/10}s`;
const grade=(f:any)=>f?['exposure','contrast','saturation','temperature'].filter(k=>typeof f[k]==='number').map(k=>`${k} ${f[k]}`).join(', '):'';

/** What is in the video, in order, one line per clip, item and music track with its place on the timeline: enough to act
 * on "the middle clip" or "the title" without reading project.json or looking at the footage again. */
export function timelineOutline(t:TimelineDocument,footage:FootageIndex,limit=40){
 const resolved=resolve(t,footage),names=new Map(footage.assets.map(a=>[a.id,a.scene?`scene ${a.filename}`:a.filename]));
 const name=(assetId:string)=>names.get(assetId)??assetId,assets=new Map(footage.assets.map(a=>[a.id,a]));
 // What a placed range shows and what is wrong in it, from the source's footage map.
 const seen=(assetId:string,start:number,end:number)=>{const asset=assets.get(assetId);if(!asset?.footageMap)return'';const shot=footage.shots.find(s=>s.assetId===assetId&&s.log&&s.end>start&&s.start<end),problems=[...new Set(rangeProblems(asset,footage.shots,start,end).map(p=>problemWords[p.problem]??p.problem))];return`${shot?.log?` (${shot.log.description.slice(0,80)})`:''}${problems.length?` [${problems.join(', ')}]`:''}`;};
 const clips=resolved.clips.map((c,n)=>`${n+1}. ${c.id} at ${sec(c.start)}-${sec(c.end)}: ${name(c.assetId)} ${sec(c.srcIn)}-${sec(c.srcOut)}${c.speed!==1?`, speed ${c.speed}`:''}${c.framing&&c.framing.mode!=='fit'?`, ${c.framing.mode}`:''}${grade(c.framing)?`, ${grade(c.framing)}`:''}${c.transitionIn&&c.transitionIn.type!=='cut'?`, ${c.transitionIn.type} in`:''}${c.audio?.mute?', muted':''}${seen(c.assetId,c.srcIn,c.srcOut)}`);
 const items=resolved.items.map(i=>`${i.type} ${i.id} at ${sec(i.timelineStart)}-${sec(i.timelineEnd)}: ${i.source?name(i.source.assetId):i.component}`);
 const music=resolved.music.map(m=>`music ${m.id} at ${sec(m.timelineStart)}-${sec(m.timelineEnd)}: ${name(m.assetId)}, ${m.gainDb} dB`);
 const lines=[...clips.slice(0,limit),...(clips.length>limit?[`…and ${clips.length-limit} more clips`]:[]),...items.slice(0,20),...music.slice(0,8),...(t.captions?[`captions: ${t.captions.style}`]:[])];
 return{durationSec:Math.round(resolved.durationSec*10)/10,lines};
}
