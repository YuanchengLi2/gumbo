import {resolve,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import type {ReviewRenderRequest} from '@dream/contracts';
import {audioManifest} from '../../composition/src/audio-manifest';
import {lint} from '@dream/guardrails';

/** Deterministic, bounded evidence from the same resolved frames and sample manifest as playback. */
export function reviewPacket(versionId:string,timeline:TimelineDocument,footage:FootageIndex){
 const r=resolve(timeline,footage),fps=timeline.settings.fps;
 if(!r.durationInFrames)throw new Error('There is no edit to review.');
 const selected=new Map<number,Set<string>>();
 const add=(frame:number,label:string)=>{frame=Math.max(0,Math.min(r.durationInFrames-1,Math.round(frame)));const labels=selected.get(frame)??new Set<string>();labels.add(label);selected.set(frame,labels);};
 const spread=<T>(items:T[],count:number)=>items.length<=count?items:Array.from({length:count},(_,i)=>items[Math.floor(i*(items.length-1)/Math.max(1,count-1))]);
 add(0,'Opening');add(fps*.75,'Opening at 0.75 seconds');add(fps*2,'Opening at 2 seconds');add(r.durationInFrames-1,'Ending');
 for(const item of spread(r.items.filter(i=>i.type!=='sfx'),4))add((item.timelineStart+item.timelineEnd)*fps/2,`Effect ${item.id}: ${item.component}`);
 for(const clip of spread(r.clips.slice(1),4)){add(clip.from-1,`Before cut to ${clip.id}`);add(clip.from,`Cut to ${clip.id}${clip.transitionIn?`: ${clip.transitionIn.type}`:''}`);}
 const frames=[...selected].sort(([a],[b])=>a-b).map(([frame,labels])=>({frame,labels:[...labels]}));
 const assetIds=new Set([...timeline.spine.map(c=>c.assetId),...timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...timeline.music.map(m=>m.assetId)]);
 const usedWords=footage.words.filter(w=>timeline.spine.some(c=>c.assetId===w.assetId&&w.start>=c.srcIn-.001&&w.start<c.srcOut&&w.end<=c.srcOut+.001));
 const request:ReviewRenderRequest={versionId,timeline,footage:{...footage,assets:footage.assets.filter(a=>assetIds.has(a.id)).map(a=>({...a,waveform:[]})),words:usedWords,shots:[],faces:footage.faces.filter(f=>timeline.spine.some(c=>c.framing?.faceTrackId===f.id))},frames};
 const cuts=r.clips.map(c=>({id:c.id,assetId:c.assetId,startFrame:c.from,endFrame:c.from+c.durationInFrames,sourceIn:c.srcIn,sourceOut:c.srcOut,speed:c.speed,beatId:c.beatId,transition:c.transitionIn,framing:c.framing}));
 const beats=timeline.beats.map(b=>({...b,clips:r.clips.filter(c=>c.beatId===b.id).map(c=>c.id),actualSec:r.clips.filter(c=>c.beatId===b.id).reduce((sum,c)=>sum+c.end-c.start,0)}));
 const transcript=spread(r.words,240).map(w=>({clipId:w.clipId,wordId:w.wordId,text:w.text,start:w.start,end:w.end}));
 const audio=audioManifest(timeline,footage);
 const sources=footage.assets.filter(a=>cuts.some(c=>c.assetId===a.id)||audio.some(s=>s.assetId===a.id)).map(a=>({id:a.id,kind:a.kind,hasAudio:a.hasAudio,missing:a.missing,peak:a.waveform.length?Math.max(...a.waveform):null}));
 return {request,evidence:{versionId,indexRevision:footage.revision,settings:timeline.settings,durationSec:r.durationSec,frames,cuts:spread(cuts,80),beats:spread(beats,24).map(b=>({...b,clips:b.clips.slice(0,50)})),effects:spread(r.items,40).map(i=>({id:i.id,component:i.component,start:i.timelineStart,end:i.timelineEnd,params:JSON.stringify(i.params).length<=1500?i.params:{partial:true,read:'get_project',id:i.id}})),transcript,transcriptSampled:r.words.length>240,audio:{sampleRate:48000,segments:spread(audio,64),sources:spread(sources,40),sampled:audio.length>64||sources.length>40,limitation:'These are timing, gain and envelope data, not a listening test or measured final-mix loudness.'},warnings:lint(timeline,footage).slice(0,40),coverage:{sampledFrames:frames.length,totalFrames:r.durationInFrames,cutCount:cuts.length,cutSheetSampled:cuts.length>80,beatCount:beats.length,effectCount:r.items.length,limitation:'Only listed frames were rendered. Do not infer motion quality or unsampled visual details.'}}};
}
