import type {FootageIndex} from '@dream/footage';
import type {TimelineDocument} from './schema';
import type {Op} from './ops';
import {resolve} from './resolve';
import {apply} from './apply';

// Shared by the manual editor and drag-and-drop onto the assistant timeline.
const reason='Manual edit';
export const newId=()=>`manual-${crypto.randomUUID()}`;
export const projectAnchor=(time:number)=>({kind:'project' as const,at:'start' as const,offsetSec:Math.max(0,time)});
export function ensureDuration(t:TimelineDocument,_end:number):Op[]{return t.settings.autoDuration?[]:[{type:'set_project_settings',settings:{autoDuration:true},reason}];}

/** Ops that place an asset at a time on a track: the video track is the magnetic story (a clip crossing the drop point is
 * split there), music:N holds audio, and anything else becomes an overlay on visual:N. */
export function addAsset(t:TimelineDocument,f:FootageIndex,assetId:string,track:string,time:number):Op[]{const asset=f.assets.find(a=>a.id===assetId);if(!asset)throw new Error('This media is no longer in the project.');const duration=asset.kind==='image'?5:asset.durationSec;if(duration<=0)throw new Error('Media has no usable duration.');const id=newId();
 if(track==='video'){const r=resolve(t,f),crossing=r.clips.find(c=>time>c.start+1/t.settings.fps&&time<c.end-1/t.settings.fps),ops:Op[]=[];let position=r.clips.findIndex(c=>c.start>=time);if(position<0)position=r.clips.length;if(crossing){position=r.clips.indexOf(crossing)+1;ops.push({type:'split_clip',clipId:crossing.id,atSec:time-crossing.start,newClipId:newId(),reason});}ops.push({type:'insert_clip',position,clip:{id,assetId,srcIn:0,srcOut:duration,speed:1,...(asset.kind==='image'?{holdSec:duration}:{}),audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason},reason});return ops;}
 if(asset.kind==='audio'||track.startsWith('music:')){if(asset.kind!=='audio')throw new Error('Drop audio onto an audio track.');return[...ensureDuration(t,time+duration),{type:'add_music',music:{id,assetId,srcIn:0,srcOut:duration,start:projectAnchor(time),layer:Number(track.split(':')[1]??0),gainDb:0,duckUnderSpeechDb:0,fadeInSec:0,fadeOutSec:0,reason},reason}];}
 return[...ensureDuration(t,time+duration),{type:'add_item',item:{id,type:'overlay',component:asset.sequence?'generated_visual':'media',source:{assetId,srcIn:0,srcOut:duration},start:projectAnchor(time),durationSec:duration,params:{x:.5,y:.5,scale:1,opacity:1,mute:true,fit:'contain'},layer:Number(track.split(':')[1]??0),reason},reason}];
}

/** The track a dropped asset belongs on, given the row it was dropped on: audio always goes to music, video and photos
 * dropped on the story row join it, and visuals dropped anywhere else become overlays. */
export function dropTrack(row:string,kind:'video'|'audio'|'image'){return kind==='audio'?'music:0':row==='video'?'video':'visual:0';}

/** Places several assets one after another from a time, in capture order when known, as one undoable change. */
export function placeAssets(t:TimelineDocument,f:FootageIndex,assetIds:string[],row:string,time:number):Op[]{
 const assets=assetIds.map(id=>f.assets.find(a=>a.id===id)).filter((a):a is NonNullable<typeof a>=>!!a).sort((a,b)=>(a.capturedAt??'').localeCompare(b.capturedAt??''));
 const ops:Op[]=[];let doc=t,at=time;
 for(const asset of assets){const next=addAsset(doc,f,asset.id,dropTrack(row,asset.kind),at);ops.push(...next);doc=apply(doc,next,f);at+=asset.kind==='image'?5:asset.durationSec;}
 return ops;
}

export type SelectionRef={id:string;kind:'clip'|'item'|'music'|'caption';assetId?:string;srcIn?:number;srcOut?:number;label:string;start:number;end:number};
/** What a set of selected timeline ids refers to, so a message can show (and later recall) exactly what was selected. */
export function selectionRefs(t:TimelineDocument,f:FootageIndex,ids:string[]):SelectionRef[]{
 if(!ids.length)return[];const r=resolve(t,f),names=new Map(f.assets.map(a=>[a.id,a.filename])),wanted=new Set(ids),refs:SelectionRef[]=[];
 for(const c of r.clips)if(wanted.has(c.id))refs.push({id:c.id,kind:'clip',assetId:c.assetId,srcIn:c.srcIn,srcOut:c.srcOut,label:names.get(c.assetId)??'Clip',start:c.start,end:c.end});
 for(const i of r.items)if(wanted.has(i.id))refs.push({id:i.id,kind:'item',...(i.source?{assetId:i.source.assetId,srcIn:i.source.srcIn,srcOut:i.source.srcOut}:{}),label:String(i.params.text??(i.source?names.get(i.source.assetId):undefined)??i.component),start:i.timelineStart,end:i.timelineEnd});
 for(const m of r.music)if(wanted.has(m.id))refs.push({id:m.id,kind:'music',assetId:m.assetId,srcIn:m.srcIn,srcOut:m.srcOut,label:names.get(m.assetId)??'Audio',start:m.timelineStart,end:m.timelineEnd});
 for(const w of r.words)if(wanted.has(w.id))refs.push({id:w.id,kind:'caption',label:w.text,start:w.start,end:w.end});
 return refs.slice(0,40);
}
