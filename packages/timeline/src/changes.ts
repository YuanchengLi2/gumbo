import type {FootageIndex} from '@dream/footage';
import type {TimelineDocument} from './schema';
import type {Op} from './ops';
import {resolve} from './resolve';
import {canvasRatio} from './canvas';
import {TRANSITIONS,EFFECTS} from './library';

/** One change a request made, as a card can show it: what it was, where it sits on the timeline, the details, and the
 * operations that undo it alone (against the timeline the request left). Ids name the clip, element or audio it touched. */
export type TimelineChange={key:string;kind:'added'|'removed'|'changed';target:'clip'|'element'|'audio'|'captions'|'settings'|'order'|'tracks';
 id?:string;title:string;details:string[];start?:number;end?:number;restore?:Op[]};

const clock=(sec:number)=>{const s=Math.max(0,sec);return `${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`;};
const same=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const reason='Undo this change';
const components:Record<string,string>={title_card:'title card',lower_third:'lower third',circle_highlight:'highlight',callout_arrow:'arrow',counter:'counter',progress_bar:'progress bar',text:'text',
 ...Object.fromEntries(EFFECTS.map(e=>[e.id,e.name.toLowerCase()])),grade:'colour grade',sticker:'sticker',source_layer:'overlay'};
const transitions:Record<string,string>={cut:'cut',...Object.fromEntries(TRANSITIONS.map(t=>[t.id,t.name.toLowerCase()]))};
const without=<T extends {id:string}>(value:T)=>{const {id:_,...rest}=value;return rest;};

export function timelineChangeList(before:TimelineDocument,after:TimelineDocument,options:{name:(assetId:string)=>string;footage?:FootageIndex}):TimelineChange[]{
 const {name}=options,out:TimelineChange[]=[];
 const placed=(t:TimelineDocument)=>{try{return options.footage?resolve(t,options.footage):undefined;}catch{return undefined;}};
 const was=placed(before),now=placed(after);
 const span=(r:ReturnType<typeof placed>,id:string)=>{if(!r)return{};const c=r.clips.find(c=>c.id===id);if(c)return{start:c.start,end:c.end};const i=r.items.find(i=>i.id===id);if(i)return{start:i.timelineStart,end:i.timelineEnd};const m=r.music.find(m=>m.id===id);return m?{start:m.timelineStart,end:m.timelineEnd}:{};};
 const itemName=(i:TimelineDocument['attached'][number])=>{
  if(i.type==='sfx')return `sound effect ${i.source?name(i.source.assetId):i.component.replaceAll('_',' ')}`;
  if(typeof i.params.text==='string'&&i.params.text.trim())return `${components[i.component]??'text'} “${String(i.params.text).slice(0,60)}”`;
  if(i.source){const asset=i.source.assetId.startsWith('output:')?i.source.assetId.slice(7):name(i.source.assetId);return i.type==='broll'?`B-roll ${asset}`:`${components[i.component]??'overlay'} ${asset}`;}
  return components[i.component]??i.component.replaceAll('_',' ');
 };

 // Clips on the main track.
 const beforeClips=new Map(before.spine.map((c,n)=>[c.id,{clip:c,index:n}])),afterClips=new Map(after.spine.map((c,n)=>[c.id,{clip:c,index:n}]));
 for(const [id,{clip}] of afterClips)if(!beforeClips.has(id)){
  const details=[`${clock(clip.srcIn)}–${clock(clip.srcOut)} of the source`];if(clip.speed!==1)details.push(`${clip.speed}× speed`);if(clip.transitionIn&&clip.transitionIn.type!=='cut')details.push(`${transitions[clip.transitionIn.type]} in`);if(clip.keyframes?.length)details.push('Keyframed motion');
  out.push({key:'clip+'+id,kind:'added',target:'clip',id,title:`Added ${name(clip.assetId)}`,details,...span(now,id),restore:[{type:'delete_clips',clipIds:[id],reason}]});
 }
 for(const [id,{clip,index}] of beforeClips)if(!afterClips.has(id))
  out.push({key:'clip-'+id,kind:'removed',target:'clip',id,title:`Removed ${name(clip.assetId)}`,details:[`${clock(clip.srcIn)}–${clock(clip.srcOut)} of the source`],...span(was,id),restore:[{type:'insert_clip',clip,position:Math.min(index,after.spine.length),reason}]});
 for(const [id,{clip}] of afterClips){const old=beforeClips.get(id)?.clip;if(!old)continue;const details:string[]=[],restore:Op[]=[];
  if(old.assetId!==clip.assetId){details.push(`Source ${name(old.assetId)} → ${name(clip.assetId)}`);restore.push({type:'replace_clip_source',clipId:id,assetId:old.assetId,srcIn:old.srcIn,srcOut:old.srcOut,reason});}
  else if(old.srcIn!==clip.srcIn||old.srcOut!==clip.srcOut){details.push(`Trimmed ${clock(old.srcIn)}–${clock(old.srcOut)} → ${clock(clip.srcIn)}–${clock(clip.srcOut)}`);restore.push({type:'trim_clip',clipId:id,srcIn:old.srcIn,srcOut:old.srcOut,reason});}
  if(old.speed!==clip.speed){details.push(`Speed ${old.speed}× → ${clip.speed}×`);restore.push({type:'set_speed',clipId:id,speed:old.speed,reason});}
  if(!same(old.speedRamp,clip.speedRamp)){details.push(clip.speedRamp?`Speed curve ${clip.speedRamp.preset.replaceAll('_',' ')}`:'Speed curve removed');restore.push({type:'set_speed_ramp',clipId:id,ramp:old.speedRamp??null,reason});}
  if(old.holdSec!==clip.holdSec){details.push(clip.holdSec?`Held for ${clip.holdSec}s`:'No longer held');if(old.holdSec)restore.push({type:'set_clip_hold',clipId:id,holdSec:old.holdSec,reason});}
  if(!same(old.framing,clip.framing)){details.push('Framing or colour');restore.push({type:'set_framing',clipId:id,framing:old.framing??{mode:'fit',scale:1,x:.5,y:.5},reason});}
  if(!same(old.keyframes,clip.keyframes)){details.push(clip.keyframes?.length?`${clip.keyframes.length} keyframes`:'Keyframes removed');restore.push({type:'set_keyframes',id,keyframes:old.keyframes??[],reason});}
  if(!same(old.audio,clip.audio)){details.push(clip.audio.mute&&!old.audio.mute?'Muted':`Sound ${old.audio.gainDb} → ${clip.audio.gainDb} dB`);restore.push({type:'set_clip_audio',clipId:id,audio:old.audio,reason});}
  if(!same(old.transitionIn,clip.transitionIn)){details.push(`Transition ${transitions[old.transitionIn?.type??'cut']} → ${transitions[clip.transitionIn?.type??'cut']}`);restore.push({type:'set_transition',clipId:id,transition:old.transitionIn??null,reason});}
  if(details.length)out.push({key:'clip~'+id,kind:'changed',target:'clip',id,title:`Edited ${name(clip.assetId)}`,details,...span(now,id),restore});
 }
 const kept=before.spine.filter(c=>afterClips.has(c.id)).map(c=>c.id),order=after.spine.filter(c=>beforeClips.has(c.id)).map(c=>c.id);
 if(!same(kept,order))out.push({key:'order',kind:'changed',target:'order',title:'Reordered the clips',details:[`${order.length} clips in a new order`],restore:kept.map((clipId,position)=>({type:'move_clip' as const,clipId,position,reason}))});

 // Elements on the other tracks: text, graphics, overlays, effects, filters and sound effects.
 const beforeItems=new Map(before.attached.map(i=>[i.id,i])),afterItems=new Map(after.attached.map(i=>[i.id,i]));
 for(const [id,item] of afterItems){const old=beforeItems.get(id);
  if(!old)out.push({key:'item+'+id,kind:'added',target:'element',id,title:`Added ${itemName(item)}`,details:[item.durationSec?`${item.durationSec}s long`:'',item.layer?`Track ${item.layer+1}`:''].filter(Boolean),...span(now,id),restore:[{type:'remove_item',itemId:id,reason}]});
  else if(!same(old,item)){const fields=[...new Set([...Object.keys(old),...Object.keys(item)])].filter(k=>k!=='reason'&&!same((old as any)[k],(item as any)[k]));
   const params=fields.includes('params')?[...new Set([...Object.keys(old.params),...Object.keys(item.params)])].filter(k=>!same(old.params[k],item.params[k])):[];
   out.push({key:'item~'+id,kind:'changed',target:'element',id,title:`Edited ${itemName(item)}`,details:[...fields.filter(f=>f!=='params').map(f=>f==='start'||f==='end'||f==='durationSec'?'Timing':f==='layer'?'Track':f),...params.map(k=>k.replaceAll('_',' '))].filter((v,n,all)=>all.indexOf(v)===n),...span(now,id),restore:[{type:'update_item',itemId:id,clearEnd:!old.end&&!!item.end,changes:without(old),reason}]});}
 }
 for(const [id,item] of beforeItems)if(!afterItems.has(id))out.push({key:'item-'+id,kind:'removed',target:'element',id,title:`Removed ${itemName(item)}`,details:[],...span(was,id),restore:[{type:'add_item',item,reason}]});

 // Music and voice-over.
 const beforeMusic=new Map(before.music.map(m=>[m.id,m])),afterMusic=new Map(after.music.map(m=>[m.id,m]));
 for(const [id,m] of afterMusic){const old=beforeMusic.get(id);
  if(!old)out.push({key:'music+'+id,kind:'added',target:'audio',id,title:`Added audio ${name(m.assetId)}`,details:[`${m.gainDb} dB`,m.duckUnderSpeechDb?'Ducks under speech':''].filter(Boolean),...span(now,id),restore:[{type:'remove_music',musicId:id,reason}]});
  else if(!same(old,m))out.push({key:'music~'+id,kind:'changed',target:'audio',id,title:`Adjusted ${name(m.assetId)}`,details:[old.gainDb!==m.gainDb?`Volume ${old.gainDb} → ${m.gainDb} dB`:'',old.srcIn!==m.srcIn||old.srcOut!==m.srcOut?'Trimmed':'',!same(old.start,m.start)?'Moved':''].filter(Boolean),...span(now,id),restore:[{type:'update_music',musicId:id,changes:without(old),reason}]});
 }
 for(const [id,m] of beforeMusic)if(!afterMusic.has(id))out.push({key:'music-'+id,kind:'removed',target:'audio',id,title:`Removed audio ${name(m.assetId)}`,details:[],...span(was,id),restore:[{type:'add_music',music:m,reason}]});

 if(!same(before.captions,after.captions))out.push({key:'captions',kind:!before.captions?'added':!after.captions?'removed':'changed',target:'captions',title:!before.captions?'Added captions':!after.captions?'Removed captions':'Updated the captions',
  details:after.captions?[`Style: ${String((after.captions as any).style??'standard').replaceAll('_',' ')}`]:[],restore:[{type:'set_captions',captions:before.captions??null,reason}]});
 const s0=before.settings,s1=after.settings,settings:string[]=[];
 if(s0.width!==s1.width||s0.height!==s1.height)settings.push(`Format ${canvasRatio(s0.width,s0.height)} → ${canvasRatio(s1.width,s1.height)}`);
 if(s0.fps!==s1.fps)settings.push(`Frame rate ${s0.fps} → ${s1.fps} fps`);
 if(settings.length)out.push({key:'settings',kind:'changed',target:'settings',title:'Changed the video settings',details:settings,restore:[{type:'set_project_settings',settings:{width:s0.width,height:s0.height,fps:s0.fps},reason}]});
 if(!same(before.trackSettings,after.trackSettings)){const ids=[...new Set([...Object.keys(before.trackSettings??{}),...Object.keys(after.trackSettings??{})])].filter(k=>!same(before.trackSettings?.[k],after.trackSettings?.[k]));
  out.push({key:'tracks',kind:'changed',target:'tracks',title:'Updated track settings',details:ids.map(id=>id.replace(':',' ')),restore:ids.map(trackId=>({type:'set_track_settings' as const,trackId,settings:{muted:false,hidden:false,locked:false,...before.trackSettings?.[trackId]},reason}))});}
 return out;
}
