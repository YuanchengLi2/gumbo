import {resolve,apply,newId,projectAnchor,ensureDuration,addAsset,KEYFRAME_PROPS,transitionInfo,effectInfo,filterInfo,textStyle,stickerInfo,type Direction,type Keyframe,type KeyframeProp,type Op,type TimelineDocument} from '@dream/timeline';
// Placement helpers live in @dream/timeline so the assistant timeline's drag-and-drop shares them.
export {newId,projectAnchor,ensureDuration,addAsset};
import type {FootageIndex} from '@dream/footage';
import {computeGroupResize} from './opencut/timeline/group-resize/compute-resize';
import {resolveTimelineSnap} from './opencut/timeline/snapping/resolve';
import {getTimelineSnapThresholdInTicks} from './opencut/timeline/snapping/threshold';
import {TICKS_PER_SECOND as TPS} from './opencut/compat';
export type Look='clip'|'effect'|'filter'|'text'|'sticker'|'graphic'|'overlay'|'sfx'|'music'|'caption';
/** look: what the block is, for how it is drawn; of: the clip a derived block (a clip's own grade) stands for. */
export type Item={id:string;kind:'clip'|'item'|'music'|'caption';track:string;start:number;end:number;label:string;assetId?:string;look?:Look;of?:string;
 /** The source second at the block's start and source seconds per timeline second, for drawing its frames. */
 srcIn?:number;speed?:number};
type Grade={exposure?:number;contrast?:number;saturation?:number;temperature?:number;[key:string]:unknown};
const gradeLabel=(g:Grade)=>typeof g.preset==='string'&&filterInfo(g.preset)?filterInfo(g.preset)!.name:typeof g.filter==='string'&&filterInfo(g.filter)?filterInfo(g.filter)!.name:['Grade',g.temperature?(Number(g.temperature)>0?'warm':'cool'):'',g.exposure?(Number(g.exposure)>0?'brighter':'darker'):'',g.saturation!==undefined&&g.saturation!==1?(Number(g.saturation)>1?'vivid':'muted'):''].filter(Boolean).join(' · ');
/** What an attached item is, laid out as CapCut does: effects, filters (grades), text and stickers on their own tracks;
 * motion graphics (scenes the agent wrote) and overlay media on overlay tracks; sound effects on audio tracks. */
export function itemLook(i:{type:string;component:string;params:Record<string,unknown>;source?:{assetId:string}},f:FootageIndex):Look{
 if(i.type==='sfx')return'sfx';if(i.type==='effect')return i.component==='grade'?'filter':'effect';
 if(!i.source)return i.component==='sticker'?'sticker':typeof i.params.text==='string'?'text':'graphic';
 const a=f.assets.find(a=>a.id===i.source!.assetId);return a?.scene||i.source.assetId.startsWith('output:')?'graphic':'overlay';
}
export const lookTrack=(look:Look,layer:number)=>(look==='sfx'?'audio:':look==='effect'?'effects:':look==='filter'?'filters:':look==='text'?'text:':look==='sticker'?'stickers:':'visual:')+layer;
/** A clip's own grade (a filter, or exposure, contrast, saturation or warmth in its framing), shown as a filter block over the clip. */
export function clipLooks(t:TimelineDocument,f:FootageIndex):Item[]{
 return resolve(t,f).clips.flatMap(c=>{const g=t.spine.find(x=>x.id===c.id)?.framing as Grade|undefined;if(!g||[g.exposure,g.contrast,g.saturation,g.temperature,g.tint,g.fade,g.filter].every(v=>v===undefined))return[];
  return[{id:'grade:'+c.id,kind:'item' as const,look:'filter' as const,of:c.id,track:'filters:clip',start:c.start,end:c.end,label:gradeLabel(g)}];});
}
export const reason='Manual edit';
export function manualItems(t:TimelineDocument,f:FootageIndex):Item[]{const r=resolve(t,f),assets=new Map(f.assets.map(a=>[a.id,a.filename]));const attachedLabel=(i:{component:string;params:Record<string,unknown>;source?:{assetId:string}},look:Look)=>look==='sticker'?stickerInfo(i.params.sticker)?.name??'Sticker':look==='effect'?effectInfo(i.component)?.name??i.component.replaceAll('_',' '):look==='filter'?gradeLabel(i.params as Grade):String(i.params.text??(i.source?assets.get(i.source.assetId)??i.source.assetId.replace(/^output:/,''):undefined)??i.component);return[
 ...r.clips.map(c=>({look:(f.assets.find(a=>a.id===c.assetId)?.scene?'graphic':'clip') as Look,id:c.id,kind:'clip' as const,track:'video',start:c.start,end:c.end,label:assets.get(c.assetId)??c.id,assetId:c.assetId,srcIn:c.srcIn,speed:c.holdSec?0:c.speed})),
 ...r.items.map(i=>{const look=itemLook(i,f);return{id:i.id,kind:'item' as const,look,track:lookTrack(look,i.layer),start:i.timelineStart,end:i.timelineEnd,label:attachedLabel(i,look),assetId:i.source?.assetId,srcIn:i.source?.srcIn,speed:1};}),
 ...r.music.map(m=>({look:'music' as const,id:m.id,kind:'music' as const,track:'music:'+(m.layer??0),start:m.timelineStart,end:m.timelineEnd,label:assets.get(m.assetId)??m.id,assetId:m.assetId})),
 ...(t.captions?r.words.map(w=>({look:'caption' as const,id:w.id,kind:'caption' as const,track:'captions',start:w.start,end:w.end,label:w.text})):[])
];}
export function removeItems(t:TimelineDocument,f:FootageIndex,ids:string[]):Op[]{const selected=new Set(ids),items=manualItems(t,f).filter(i=>selected.has(i.id)),ops:Op[]=[];
 for(const id of ids){const clipId=transitionClip(id);if(clipId&&!selected.has(clipId)&&t.spine.some(c=>c.id===clipId&&c.transitionIn))ops.push({type:'set_transition',clipId,transition:null,reason});}const clips=items.filter(i=>i.kind==='clip').map(i=>i.id);if(clips.length)ops.push({type:'delete_clips',clipIds:clips,reason});for(const i of items){if(i.kind==='item')ops.push({type:'remove_item',itemId:i.id,reason});if(i.kind==='music')ops.push({type:'remove_music',musicId:i.id,reason});if(i.kind==='caption'){const w=resolve(t,f).words.find(w=>w.id===i.id)!;ops.push({type:'update_caption_overrides',overrides:[{wordId:w.wordId,clipId:w.clipId,hidden:true}],reason});}}return ops;}
export function splitItems(t:TimelineDocument,f:FootageIndex,ids:string[],time:number):Op[]{const items=manualItems(t,f).filter(i=>(!ids.length||ids.includes(i.id))&&i.start+1/t.settings.fps<=time&&i.end-1/t.settings.fps>=time),ops:Op[]=[];for(const i of items){const offset=Math.round((time-i.start)*t.settings.fps)/t.settings.fps;if(i.kind==='clip')ops.push({type:'split_clip',clipId:i.id,atSec:offset,newClipId:newId(),reason});else if(i.kind==='music'){const m=t.music.find(m=>m.id===i.id)!;ops.push({type:'update_music',musicId:i.id,changes:{srcOut:m.srcIn+offset},reason},{type:'add_music',music:{...m,id:newId(),srcIn:m.srcIn+offset,start:projectAnchor(time)},reason});}else if(i.kind==='item'){const item=t.attached.find(a=>a.id===i.id)!,right={...item,id:newId(),start:projectAnchor(time),end:undefined,durationSec:i.end-time,...(item.source&&f.assets.find(a=>a.id===item.source!.assetId)?.kind!=='image'?{source:{...item.source,srcIn:item.source.srcIn+offset}}:{})};ops.push({type:'update_item',clearEnd:true,itemId:i.id,changes:{durationSec:offset,end:undefined,...(item.source&&f.assets.find(a=>a.id===item.source!.assetId)?.kind!=='image'?{source:{...item.source,srcOut:item.source.srcIn+offset}}:{})},reason},{type:'add_item',item:right,reason});}}return ops;}
export function trimItems(t:TimelineDocument,f:FootageIndex,ids:string[],side:'left'|'right',delta:number):Op[]{const items=manualItems(t,f).filter(i=>ids.includes(i.id)&&i.kind!=='caption');const members=items.map(i=>{const clip=t.spine.find(c=>c.id===i.id),item=t.attached.find(c=>c.id===i.id),music=t.music.find(c=>c.id===i.id),asset=f.assets.find(a=>a.id===i.assetId),sourceIn=clip?.srcIn??item?.source?.srcIn??music?.srcIn??0,speed=clip?.speed??1,sourceOut=clip?.srcOut??item?.source?.srcOut??music?.srcOut??0;return{elementId:i.id,trackId:i.track,startTime:(i.kind==='clip'?sourceIn/speed:i.start)*TPS,duration:(i.end-i.start)*TPS,trimStart:sourceIn*TPS,trimEnd:Math.max(0,(asset?.durationSec??0)-sourceOut)*TPS,sourceDuration:asset&&asset.kind!=='image'?asset.durationSec*TPS:undefined,retime:speed!==1?{speed}:undefined,leftNeighborBound:null,rightNeighborBound:null};});
 const resized=computeGroupResize({members,side,deltaTime:delta*TPS,fps:{numerator:t.settings.fps,denominator:1}}),ops:Op[]=[];
 for(const update of resized.updates){const i=items.find(i=>i.id===update.elementId)!,p=update.patch,clip=t.spine.find(c=>c.id===i.id),item=t.attached.find(c=>c.id===i.id),music=t.music.find(c=>c.id===i.id),asset=f.assets.find(a=>a.id===i.assetId);if(clip){if(asset?.kind==='image')ops.push({type:'set_clip_hold',clipId:i.id,holdSec:p.duration/TPS,reason});else ops.push({type:'trim_clip',clipId:i.id,srcIn:p.trimStart/TPS,srcOut:p.trimStart/TPS+p.duration/TPS*clip.speed,reason});}
  else if(music)ops.push({type:'update_music',musicId:i.id,changes:{start:projectAnchor(p.startTime/TPS),srcIn:p.trimStart/TPS,srcOut:(p.trimStart+p.duration)/TPS},reason});
  else if(item)ops.push({type:'update_item',clearEnd:true,itemId:i.id,changes:{start:projectAnchor(p.startTime/TPS),end:undefined,durationSec:p.duration/TPS,...(item.source&&asset?.kind!=='image'?{source:{...item.source,srcIn:p.trimStart/TPS,srcOut:(p.trimStart+p.duration)/TPS}}:{})},reason});
 }
 if(items.some(i=>i.kind!=='clip')){const candidate=apply(t,ops,f);const end=Math.max(...items.filter(i=>i.kind!=='clip').map(i=>{const p=resized.updates.find(u=>u.elementId===i.id)!.patch;return(p.startTime+p.duration)/TPS;}));ops.push(...ensureDuration(candidate,end));}return ops;
}
export function snapMove(items:Item[],selected:string[],delta:number,zoom:number,playhead:number,enabled:boolean){if(!enabled)return{delta,snap:null as number|null};const chosen=items.filter(i=>selected.includes(i.id)),points=[{time:playhead*TPS,type:'playhead' as const},...items.filter(i=>!selected.includes(i.id)&&i.kind!=='caption').flatMap(i=>[{time:i.start*TPS,type:'element-start' as const},{time:i.end*TPS,type:'element-end' as const}])];let distance=Infinity,result={delta,snap:null as number|null};for(const i of chosen)for(const edge of [i.start,i.end]){const snap=resolveTimelineSnap({targetTime:(edge+delta)*TPS,snapPoints:points,maxSnapDistance:getTimelineSnapThresholdInTicks({zoomLevel:zoom})});if(snap.snapPoint&&snap.snapDistance<distance){distance=snap.snapDistance;result={delta:snap.snappedTime/TPS-edge,snap:snap.snappedTime/TPS};}}return result;}
export function moveItems(t:TimelineDocument,f:FootageIndex,ids:string[],delta:number,targetTrack?:string):Op[]{const selected=manualItems(t,f).filter(i=>ids.includes(i.id)&&i.kind!=='caption');if(!selected.length)return[];delta=Math.round(Math.max(delta,-Math.min(...selected.map(i=>i.start)))*t.settings.fps)/t.settings.fps;const ops:Op[]=[];
 const main=selected.filter(i=>i.kind==='clip');if(main.length){const remaining=resolve(t,f).clips.filter(c=>!ids.includes(c.id)),desired=Math.max(0,main[0].start+delta);let position=remaining.findIndex(c=>c.start+c.durationInFrames/t.settings.fps/2>=desired);if(position<0)position=remaining.length;const ordered=main.sort((a,b)=>a.start-b.start).map((i,n)=>({i,position:position+n}));if(position>=t.spine.findIndex(c=>c.id===main[0].id))ordered.reverse();ordered.forEach(({i,position})=>ops.push({type:'move_clip',clipId:i.id,position,reason}));}
 for(const i of selected){if(i.kind==='music')ops.push({type:'update_music',musicId:i.id,changes:{start:projectAnchor(i.start+delta),...(targetTrack?.startsWith('music:')?{layer:Number(targetTrack.split(':')[1])}:{})},reason});if(i.kind==='item'){const item=t.attached.find(a=>a.id===i.id)!;ops.push({type:'update_item',clearEnd:true,itemId:i.id,changes:{start:projectAnchor(i.start+delta),end:undefined,durationSec:i.end-i.start,...(targetTrack&&/^(visual|text|effects|filters|audio):\d+$/.test(targetTrack)&&targetTrack.startsWith('audio:')===(item.type==='sfx')?{layer:Number(targetTrack.split(':')[1])}:{})},reason});}}
 if(selected.some(i=>i.kind!=='clip'))ops.push(...ensureDuration(t,Math.max(...selected.filter(i=>i.kind!=='clip').map(i=>i.end+delta))));return ops;
}
export function duplicateItems(t:TimelineDocument,f:FootageIndex,ids:string[],at?:number,target=t):Op[]{const selected=manualItems(t,f).filter(i=>ids.includes(i.id)&&i.kind!=='caption');if(!selected.length)return[];const offset=(at??Math.max(...selected.map(i=>i.end)))-Math.min(...selected.map(i=>i.start)),ops:Op[]=[];const insertTime=at??Math.max(...selected.map(i=>i.end)),resolved=resolve(target,f),crossing=selected.some(i=>i.kind==='clip')?resolved.clips.find(c=>insertTime>c.start+1/target.settings.fps&&insertTime<c.end-1/target.settings.fps):undefined;let position=resolved.clips.findIndex(c=>c.start>=insertTime);if(position<0)position=target.spine.length;if(crossing){position=resolved.clips.indexOf(crossing)+1;ops.push({type:'split_clip',clipId:crossing.id,atSec:insertTime-crossing.start,newClipId:newId(),reason});}let extra=0;for(const i of selected){if(i.kind==='clip'){const clip=t.spine.find(c=>c.id===i.id)!;ops.push({type:'insert_clip',position:position+extra++,clip:{...structuredClone(clip),id:newId()},reason});}else if(i.kind==='item'){const item=t.attached.find(a=>a.id===i.id)!;ops.push({type:'add_item',item:{...structuredClone(item),id:newId(),start:projectAnchor(i.start+offset),end:undefined,durationSec:i.end-i.start},reason});}else{const music=t.music.find(m=>m.id===i.id)!;ops.push({type:'add_music',music:{...structuredClone(music),id:newId(),start:projectAnchor(i.start+offset)},reason});}}if(selected.some(i=>i.kind!=='clip'))ops.push(...ensureDuration(target,Math.max(...selected.filter(i=>i.kind!=='clip').map(i=>i.end+offset))));return ops;}

/** A transition into a clip from the library, centred on its cut. Video on either side needs footage past the cut for half
 * the transition (a handle): when a clip has none left there, it is trimmed back by what is missing. Photos and graphics
 * hold their picture, so they need none. */
export function transitionOps(t:TimelineDocument,f:FootageIndex,clipId:string,type:string,durationSec?:number,direction?:Direction):Op[]{
 const index=t.spine.findIndex(c=>c.id===clipId),clip=t.spine[index];if(!clip)throw new Error('Select a clip on the main track.');
 if(type==='cut')return[{type:'set_transition',clipId,transition:null,reason}];
 if(index<1)throw new Error('Transitions go between two clips. Put this one on the cut before a clip.');
 const before=t.spine[index-1],assets=new Map(f.assets.map(a=>[a.id,a])),a=assets.get(before.assetId),b=assets.get(clip.assetId);
 if(!a||!b||a.kind==='audio'||b.kind==='audio')throw new Error('Transitions go between two clips with a picture.');
 const info=transitionInfo(type);if(!info)throw new Error('Unknown transition: '+type);
 const duration=Math.max(2/t.settings.fps,Math.min(3,durationSec??clip.transitionIn?.durationSec??info.durationSec)),half=duration/2,ops:Op[]=[];
 const footage=(x:typeof a)=>x.kind==='video'&&!x.scene&&!x.sequence;
 const outgoing=footage(a)&&!before.holdSec?Math.max(0,half-(a.durationSec-before.srcOut)/before.speed):0,incoming=footage(b)&&!clip.holdSec?Math.max(0,half-clip.srcIn/clip.speed):0;
 const length=(c:typeof clip)=>c.holdSec??(c.srcOut-c.srcIn)/c.speed;
 if(length(before)<=outgoing+half+1/t.settings.fps||length(clip)<=incoming+half+1/t.settings.fps)throw new Error('These clips are too short for a transition this long.');
 if(outgoing>0)ops.push({type:'trim_clip',clipId:before.id,srcOut:before.srcOut-outgoing*before.speed,reason});
 if(incoming>0)ops.push({type:'trim_clip',clipId,srcIn:clip.srcIn+incoming*clip.speed,reason});
 ops.push({type:'set_transition',clipId,transition:{type:info.id,durationSec:Math.round(duration*1000)/1000,...(info.directional?{direction:direction??clip.transitionIn?.direction??'left'}:{})},reason});return ops;
}
/** The cut nearest a time on the main track: the clip that starts there (never the first). */
export function nearestCut(t:TimelineDocument,f:FootageIndex,time:number){const clips=resolve(t,f).clips.slice(1);let best:typeof clips[number]|undefined;for(const c of clips)if(!best||Math.abs(c.start-time)<Math.abs(best.start-time))best=c;return best;}
/** Transitions are selected as `transition:<clip id>`, the clip they lead into. */
export const transitionId=(clipId:string)=>'transition:'+clipId;
export const transitionClip=(id:string)=>id.startsWith('transition:')?id.slice(11):undefined;
export function elementOps(t:TimelineDocument,component:string,time:number,layer=0):Op[]{return[...ensureDuration(t,time+3),{type:'add_item',item:{id:newId(),type:['punch_zoom','slow_push','shake'].includes(component)?'effect':'overlay',component,start:projectAnchor(time),durationSec:3,layer,params:{text:component==='lower_third'?'Your name':'Your title',x:.5,y:component==='lower_third'?.8:.5,fontSize:60,color:'#ffffff',amount:.1},reason},reason}];}

/** Split at the playhead and remove one side, as OpenCut's Q and W do: the part before the playhead (left) or after it
 * (right) of every selected block the playhead crosses, or of every unlocked block it crosses when nothing is selected. */
export function splitRemove(t:TimelineDocument,f:FootageIndex,ids:string[],time:number,side:'left'|'right'):Op[]{
 const crossing=manualItems(t,f).filter(i=>i.kind!=='caption'&&(ids.length?ids.includes(i.id):!t.trackSettings?.[i.track]?.locked)&&i.start+1/t.settings.fps<=time&&i.end-1/t.settings.fps>=time);
 if(!crossing.length)return[];const split=splitItems(t,f,crossing.map(i=>i.id),time),after=apply(t,split,f);
 // A split keeps the block's own id on the left part; the right part is the new block the split made.
 const right=split.flatMap(o=>o.type==='split_clip'?[o.newClipId]:o.type==='add_item'?[o.item.id]:o.type==='add_music'?[o.music.id]:[]);
 return[...split,...removeItems(after,f,side==='left'?crossing.map(i=>i.id):right)];
}
/** Everything on the timeline that can be selected and changed (captions are words of the speech, not blocks). */
export const selectableIds=(t:TimelineDocument,f:FootageIndex)=>manualItems(t,f).filter(i=>i.kind!=='caption'&&!t.trackSettings?.[i.track]?.locked).map(i=>i.id);

/** A keyframe list with prop set to value at sec (a keyframe within half a frame is that keyframe), or removed there. */
export function setKeyframe(keys:Keyframe[]|undefined,sec:number,prop:KeyframeProp,value:number|undefined,fps:number):Keyframe[]{
 const list=[...(keys??[])].sort((a,b)=>a.sec-b.sec),at=list.findIndex(k=>Math.abs(k.sec-sec)<=.5/fps);
 if(value===undefined){if(at<0)return list;const k={...list[at]};delete k[prop];return KEYFRAME_PROPS.some(name=>k[name]!==undefined)?list.map((x,n)=>n===at?k:x):list.filter((_,n)=>n!==at);}
 if(at>=0)return list.map((k,n)=>n===at?{...k,[prop]:value}:k);
 return [...list,{sec:Math.max(0,sec),easing:'linear' as const,[prop]:value}].sort((a,b)=>a.sec-b.sec);
}


/** The free layer for a new block of a kind at a time: the lowest row of that kind with nothing there for the span. */
function freeLayer(t:TimelineDocument,f:FootageIndex,look:Look,start:number,end:number){const taken=manualItems(t,f).filter(i=>i.look===look&&i.start<end-1e-6&&i.end>start+1e-6).map(i=>Number(i.track.split(':')[1]));let layer=0;while(taken.includes(layer))layer++;return layer;}
export type LibraryDrop={kind:'effect'|'filter'|'text'|'sticker';id:string};
/** A library piece put on the timeline, as CapCut does: text and stickers for three seconds at the time on their own
 * rows; an effect or a filter over one clip when it lands on a clip (it then follows the clip), else for three seconds
 * from the time; a filter on a clip's own picture when dropped onto it (onClip). */
export function libraryOps(t:TimelineDocument,f:FootageIndex,drop:LibraryDrop,time:number,o:{clipId?:string;onClip?:boolean}={}):Op[]{
 const at=Math.max(0,Math.round(time*t.settings.fps)/t.settings.fps),clip=o.clipId?resolve(t,f).clips.find(c=>c.id===o.clipId):undefined,length=3;
 if(drop.kind==='filter'&&o.onClip&&clip){const c=t.spine.find(x=>x.id===clip.id)!;return[{type:'set_framing',clipId:c.id,framing:{...(c.framing??{mode:'fit',scale:1,x:.5,y:.5}),filter:drop.id,filterIntensity:1},reason}];}
 const span=clip?{start:{kind:'clip' as const,clipId:clip.id,at:'start' as const,offsetSec:0},end:{kind:'clip' as const,clipId:clip.id,at:'end' as const,offsetSec:0}}:{start:projectAnchor(at),durationSec:length};
 const from=clip?clip.start:at,to=clip?clip.end:at+length;
 if(drop.kind==='effect'){const info=effectInfo(drop.id);if(!info)throw new Error('Unknown effect: '+drop.id);return[...ensureDuration(t,to),{type:'add_item',item:{id:newId(),type:'effect',component:info.id,...span,layer:freeLayer(t,f,'effect',from,to),params:Object.fromEntries(info.params.map(x=>[x.key,x.default])),reason},reason}];}
 if(drop.kind==='filter'){if(!filterInfo(drop.id))throw new Error('Unknown filter: '+drop.id);return[...ensureDuration(t,to),{type:'add_item',item:{id:newId(),type:'effect',component:'grade',...span,layer:freeLayer(t,f,'filter',from,to),params:{preset:drop.id,intensity:1},reason},reason}];}
 if(drop.kind==='text'){const style=textStyle(drop.id);if(!style)throw new Error('Unknown text style: '+drop.id);return[...ensureDuration(t,at+length),{type:'add_item',item:{id:newId(),type:'overlay',component:'text',start:projectAnchor(at),durationSec:length,layer:freeLayer(t,f,'text',at,at+length),params:{text:style.sample,style:style.id,x:.5,y:Number(style.params.y??.5)},reason},reason}];}
 const sticker=stickerInfo(drop.id);if(!sticker)throw new Error('Unknown sticker: '+drop.id);
 return[...ensureDuration(t,at+length),{type:'add_item',item:{id:newId(),type:'overlay',component:'sticker',start:projectAnchor(at),durationSec:length,layer:freeLayer(t,f,'sticker',at,at+length),params:{sticker:sticker.id,x:.5,y:.45},reason},reason}];
}
