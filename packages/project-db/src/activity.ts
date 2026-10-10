import type {PublicActivity,WorkTask} from '@dream/contracts';
import {canvasRatio,diff,type TimelineDocument} from '@dream/timeline';

export type ActivityStep={sequence?:number;id?:string;label:string;status:string;detail?:string;updatedAt?:string};
export type TurnActivity={events?:PublicActivity[];tasks?:WorkTask[];phase?:'answering'|'planning'|'editing';steps:ActivityStep[];status:string;changes:string[];startVersionId?:string;fileChanges?:Record<string,string[]>};
export function timelineChanges(before:TimelineDocument,after:TimelineDocument,name:(id:string)=>string):string[]{
 const result:string[]=[],change=diff(before,after);
 const count=(items:unknown[],singular:string,plural:string)=>{if(items.length)result.push(items.length===1?singular:plural.replace('{n}',String(items.length)));};
 if(before.settings.width!==after.settings.width||before.settings.height!==after.settings.height)result.push(`Changed the video format to ${canvasRatio(after.settings.width,after.settings.height)}`);
 if(before.settings.fps!==after.settings.fps)result.push(`Set the frame rate to ${after.settings.fps} fps`);
 const added=after.spine.filter(c=>change.added.includes(c.id)),removed=before.spine.filter(c=>change.removed.includes(c.id));
 count(added,added[0]?`Added ${name(added[0].assetId)}`:'','Added {n} clips');count(removed,removed[0]?`Removed ${name(removed[0].assetId)}`:'','Removed {n} clips');
 let trims=0,speeds=0,framing=0,audio=0;
 for(const clip of after.spine){const previous=before.spine.find(c=>c.id===clip.id);if(!previous)continue;if(previous.srcIn!==clip.srcIn||previous.srcOut!==clip.srcOut||previous.holdSec!==clip.holdSec)trims++;if(previous.speed!==clip.speed)speeds++;if(JSON.stringify(previous.framing)!==JSON.stringify(clip.framing))framing++;if(JSON.stringify(previous.audio)!==JSON.stringify(clip.audio))audio++;if(JSON.stringify(previous.transitionIn)!==JSON.stringify(clip.transitionIn))result.push(clip.transitionIn&&clip.transitionIn.type!=='cut'?`Added a ${clip.transitionIn.type.replaceAll('_',' ')} transition`:'Removed a transition');}
 if(trims)result.push(`Trimmed ${trims===1?'a clip':`${trims} clips`}`);if(speeds)result.push(`Changed playback speed on ${speeds===1?'a clip':`${speeds} clips`}`);if(framing)result.push(`Adjusted framing or color on ${framing===1?'a clip':`${framing} clips`}`);if(audio)result.push(`Adjusted clip audio${audio>1?` on ${audio} clips`:''}`);
 const existing=new Set(before.spine.map(c=>c.id));if(JSON.stringify(before.spine.filter(c=>after.spine.some(n=>n.id===c.id)).map(c=>c.id))!==JSON.stringify(after.spine.filter(c=>existing.has(c.id)).map(c=>c.id)))result.push('Reordered the clips');
 for(const [items,verb] of [[after.attached.filter(i=>change.added.includes(i.id)),'Added'],[after.attached.filter(i=>change.changed.includes(i.id)),'Updated'],[before.attached.filter(i=>change.removed.includes(i.id)),'Removed']] as const){for(const item of items.slice(0,6)){const label=item.params.text?`text “${String(item.params.text).slice(0,90)}”`:item.source?name(item.source.assetId):item.component.replaceAll('_',' ');result.push(`${verb} ${label}`);}if(items.length>6)result.push(`${verb} ${items.length-6} more elements`);}
 const musicAdded=after.music.filter(i=>change.added.includes(i.id)),musicRemoved=before.music.filter(i=>change.removed.includes(i.id));count(musicAdded,musicAdded[0]?`Added audio: ${name(musicAdded[0].assetId)}`:'','Added {n} audio clips');count(musicRemoved,'Removed an audio clip','Removed {n} audio clips');if(after.music.some(i=>change.changed.includes(i.id)))result.push('Adjusted the music or audio mix');
 if(change.captionsChanged)result.push(!after.captions?'Removed captions':!before.captions?'Added captions':'Updated the captions');
 if(JSON.stringify(before.trackSettings)!==JSON.stringify(after.trackSettings))result.push('Updated track settings');
 if(before.settings.durationSec!==after.settings.durationSec&&after.settings.durationSec!==undefined)result.push(`Set the canvas length to ${after.settings.durationSec} seconds`);
 return [...new Set(result)];
}
