import {ZodError} from 'zod';
import {apply,resolve,EditError,ActionSchema,type Op,type TimelineDocument,type Anchor} from '@dream/timeline';
import {documentDelta} from '../../../packages/timeline/src/document-delta';
import type {FootageIndex} from '@dream/footage';
import {WorkspaceOutputSchema,type WorkspaceDocument} from '@dream/contracts';

type Output=WorkspaceDocument['outputs'][number];
const seconds=(n:number)=>`${Math.round(n*100)/100}s`;
const ids=(items:{id:string}[])=>items.length?items.map(i=>i.id).join(', '):'none';

/** What went wrong with one action, with the IDs that do exist when it named one that does not. */
function describe(error:unknown,timeline:TimelineDocument){
 if(error instanceof ZodError)return error.issues.slice(0,6).map(i=>`${i.path.join('.')||'action'}: ${i.message}`).join('; ')+'.';
 if(error instanceof EditError){
  const hint=error.code==='clip_not_found'?` Clips on the timeline: ${ids(timeline.spine)}.`:error.code==='item_not_found'?` Attached items: ${ids(timeline.attached)}.`:error.code==='music_not_found'?` Music: ${ids(timeline.music)}.`:error.code==='word_not_found'?' Use read_transcript for the word IDs of that source.':error.code==='duplicate_id'?' Choose a new ID.':'';
  return error.message+hint;
 }
 return(error as Error).message;
}

/** Changed or new entries of a collection, by ID. */
const changed=<T extends {id:string}>(before:T[],after:T[])=>{const old=new Map(before.map(i=>[i.id,JSON.stringify(i)]));return after.filter(i=>old.get(i.id)!==JSON.stringify(i));};

/** Checks the result against the sources: every source exists, every range lies inside its source, every item has a
 * place and a length. Only entries the actions changed are checked, plus anything a deleted clip leaves unanchored. */
function problems(before:TimelineDocument,after:TimelineDocument,outputs:Output[],footage:FootageIndex){
 const out:string[]=[],clips=new Set(after.spine.map(c=>c.id)),earlier=new Set(before.spine.map(c=>c.id));
 const length=(assetId:string,what:string):number|undefined=>{
  if(assetId.startsWith('output:')){const output=outputs.find(o=>o.id===assetId.slice(7));if(!output){out.push(`${what} uses ${assetId}, which is not declared; add it to outputs in the same call.`);return;}return output.durationInFrames?output.durationInFrames/(output.fps??after.settings.fps):undefined;}
  const asset=footage.assets.find(a=>a.id===assetId);if(!asset){out.push(`${what} uses asset ${assetId}, which is not in the project.`);return;}
  return asset.kind==='image'||!asset.durationSec?undefined:asset.durationSec;
 };
 const range=(assetId:string,srcIn:number,srcOut:number,what:string)=>{
  const total=length(assetId,what);
  if(srcOut<=srcIn)out.push(`${what}: srcOut (${seconds(srcOut)}) must be after srcIn (${seconds(srcIn)}).`);
  else if(total!==undefined&&srcOut>total+.05)out.push(`${what} ends at ${seconds(srcOut)} but its source is ${seconds(total)} long.`);
 };
 const anchored=(anchor:Anchor|undefined,what:string,touched:boolean)=>{if(anchor&&anchor.kind!=='project'&&!clips.has(anchor.clipId)&&(touched||earlier.has(anchor.clipId)))out.push(`${what} is anchored to clip ${anchor.clipId}, which is not on the timeline; re-anchor or remove it in the same call.`);};
 for(const clip of changed(before.spine,after.spine))range(clip.assetId,clip.srcIn,clip.srcOut,`clip ${clip.id}`);
 for(const music of changed(before.music,after.music))range(music.assetId,music.srcIn,music.srcOut,`music ${music.id}`);
 for(const item of changed(before.attached,after.attached)){
  if(item.source)range(item.source.assetId,item.source.srcIn,item.source.srcOut,`item ${item.id}`);
  if(!item.end&&!item.durationSec)out.push(`item ${item.id} has no length; give it durationSec or an end anchor.`);
 }
 // Changed items need a clip to stand on, and a deleted clip must not strand items that were anchored to it.
 const items=new Set(changed(before.attached,after.attached).map(i=>i.id)),tracks=new Set(changed(before.music,after.music).map(m=>m.id));
 for(const item of after.attached){anchored(item.start,`item ${item.id}`,items.has(item.id));anchored(item.end,`item ${item.id} (end)`,items.has(item.id));}
 for(const music of after.music)anchored(music.start,`music ${music.id}`,tracks.has(music.id));
 return[...new Set(out)];
}

/** A compact account of what changed: one line per changed part, with the new entries themselves. */
export function timelineChangeLines(before:TimelineDocument,after:TimelineDocument,limit=20){
 const lines=documentDelta(before,after).map(change=>{
  const where=change.path.join('.')||'timeline';
  if(change.collection){const {put,remove,order}=change.collection;return[`${where}:`,...put.map(item=>`set ${JSON.stringify(item).slice(0,400)}`),...(remove.length?[`removed ${remove.join(', ')}`]:[]),...(order?[`order ${order.join(', ')}`]:[])].join(' ');}
  return change.remove?`${where} removed`:`${where} = ${JSON.stringify(change.value).slice(0,300)}`;
 });
 return lines.length>limit?[...lines.slice(0,limit),`…and ${lines.length-limit} more changes.`]:lines;
}

/** What is questionable in an edit that is otherwise valid, so the agent can fix it or say why it kept it: slow motion
 * below half speed, one clip taking most of the video, and the same footage used twice. Facts about the timeline only;
 * what the footage shows is for the agent to look at. Only what this edit changed is judged, plus the clip lengths and
 * repeats it leads to. */
export function placementWarnings(before:TimelineDocument,after:TimelineDocument,footage:FootageIndex){
 const out:string[]=[],assets=new Map(footage.assets.map(a=>[a.id,a]));
 const clips=changed(before.spine,after.spine),touched=new Set(clips.map(c=>c.id));
 for(const clip of clips)if(clip.speed<.5)out.push(`clip ${clip.id} plays at ${clip.speed}x: slow motion below half speed looks stretched, so use it only when asked for.`);
 const resolved=resolve(after,footage),total=resolved.durationSec;
 if(total>=15&&after.spine.length>=3)for(const clip of resolved.clips)if(touched.has(clip.id)&&(clip.end-clip.start)/total>.4)out.push(`clip ${clip.id} is ${seconds(clip.end-clip.start)} of a ${seconds(total)} video: one shot that long usually drags.`);
 const spine=after.spine;for(let i=0;i<spine.length;i++)for(let j=i+1;j<spine.length;j++){const a=spine[i],b=spine[j],shared=Math.min(a.srcOut,b.srcOut)-Math.max(a.srcIn,b.srcIn);if(a.assetId===b.assetId&&shared>1&&(touched.has(a.id)||touched.has(b.id))&&!assets.get(a.assetId)?.scene)out.push(`clips ${a.id} and ${b.id} show the same footage (${assets.get(a.assetId)?.filename??a.assetId} ${seconds(Math.max(a.srcIn,b.srcIn))}-${seconds(Math.min(a.srcOut,b.srcOut))}).`);}
 return[...new Set(out)].slice(0,12);
}

/** Applies agent actions to a workspace document in order. Nothing is applied unless every action and every check passes. */
export function applyTimelineActions(document:WorkspaceDocument,actions:unknown[],outputs:unknown[]|undefined,footage:FootageIndex){
 const declared=[...document.outputs];
 for(const [n,raw] of (outputs??[]).entries()){const parsed=WorkspaceOutputSchema.safeParse(raw);if(!parsed.success)throw new Error(`Output ${n+1}: ${describe(parsed.error,document.timeline)} No actions were applied.`);const at=declared.findIndex(o=>o.id===parsed.data.id);if(at>=0)declared[at]=parsed.data;else declared.push(parsed.data);}
 let timeline=document.timeline;
 for(const [n,raw] of actions.entries()){
  const type=raw&&typeof raw==='object'&&typeof (raw as any).type==='string'?` (${(raw as any).type})`:'';
  try{const action=ActionSchema.parse(raw);timeline=apply(timeline,[{...action,reason:action.reason||'Requested edit'} as Op],footage);}
  catch(error){throw new Error(`Action ${n+1}${type}: ${describe(error,timeline)} No actions were applied.`);}
 }
 const found=problems(document.timeline,timeline,declared,footage);
 if(found.length)throw new Error('Nothing was applied, because:\n'+found.slice(0,10).join('\n'));
 return{document:{...document,timeline,outputs:declared},changes:timelineChangeLines(document.timeline,timeline),warnings:placementWarnings(document.timeline,timeline,footage)};
}
