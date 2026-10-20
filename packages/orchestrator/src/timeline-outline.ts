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

const clock=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
// Captions are many short text items: named for captions (cap000, caption-12, polished-caption-3) or made by a caption component.
const isCaption=(i:{id:string;component:string})=>/(^|[-_])(cap|caption|subtitle|sub)s?[-_]?\d|caption|subtitle/i.test(i.id)||/caption/i.test(i.component);
/** The whole edit at a glance, for an edit too big for the outline (which lists the first 40 clips, 20 items and 8 music
 * tracks): the video in 30-second sections (which source ranges play, which titles and scenes start, the music, how many
 * captions), then every title and chapter card with its words, every scene, every music track and where captions run.
 * On a 10-minute edit the agent used to spend its first eight or ten steps (2-3 credits) mapping the cut with commands
 * before it could change anything. */
export function editMap(t:TimelineDocument,footage:FootageIndex,sectionSec=30){
 const r=resolve(t,footage),assets=new Map(footage.assets.map(a=>[a.id,a]));
 const name=(assetId:string)=>{const a=assets.get(assetId);return a?(a.scene?`scene ${a.filename}`:a.filename):assetId;};
 // A title's words: text, title or label, or for a scene title the words among its settings (a chapter card's
 // {num:'01',name:'HANOI',sub:'Arrival'} reads "HANOI · Arrival"); layout, colors and numbers are not words.
 const layout=/^(x|y|scale|fit|color|colou?rs?|background|font|fontFamily|fontSize|align|position|size|src|path|assetId|style|variant|theme|easing|mode|direction|accent)$/i;
 const words=(i:{params?:Record<string,unknown>})=>{const p=i.params??{},main=p.text??p.title??p.label;
  const v=typeof main==='string'?main:Object.entries(p).filter(([k,x])=>typeof x==='string'&&!layout.test(k)&&x.trim()&&!/^(#|rgba?\(|\d+(\.\d+)?(px|%|s)?$)/i.test(x.trim())).map(([,x])=>String(x).trim()).join(' · ');
  return v.replace(/\s+/g,' ').trim().slice(0,60);};
 const label=(i:typeof r.items[number])=>{const w=words(i);return w?`"${w}"`:i.source?name(i.source.assetId):i.component;};
 const overlays=r.items.filter(i=>!isCaption(i)),captions=r.items.filter(isCaption);
 const sections:string[]=[];
 for(let a=0;a<r.durationSec;a+=sectionSec){
  const b=Math.min(r.durationSec,a+sectionSec),clips=r.clips.filter(c=>c.start<b&&c.end>a);
  const ranges=new Map<string,[number,number]>();for(const c of clips){const old=ranges.get(c.assetId);ranges.set(c.assetId,old?[Math.min(old[0],c.srcIn),Math.max(old[1],c.srcOut)]:[c.srcIn,c.srcOut]);}
  // The same thing starting several times (narration pieces, a whoosh) reads once with its count.
  const counts=new Map<string,number>();for(const i of overlays)if(i.timelineStart>=a&&i.timelineStart<b){const key=`${i.type} ${label(i)}`;counts.set(key,(counts.get(key)??0)+1);}
  const starting=[...counts].map(([key,n])=>n>1?`${key} x${n}`:key);
  const music=[...new Set(r.music.filter(m=>m.timelineStart<b&&m.timelineEnd>a).map(m=>m.id))];
  const said=captions.filter(i=>i.timelineStart<b&&i.timelineEnd>a).length;
  sections.push(`${clock(a)}-${clock(b)}: ${clips.length} clips (${[...ranges].map(([id,[x,y]])=>`${name(id)} ${sec(x)}-${sec(y)}`).join('; ')||'none'})`+(starting.length?`; starts ${starting.slice(0,6).join(', ')}${starting.length>6?` +${starting.length-6} more`:''}`:'')+(music.length?`; music ${music.join(', ')}`:'')+(said?`; ${said} captions`:''));
 }
 const titles=overlays.filter(i=>words(i)).map(i=>`${clock(i.timelineStart)}-${clock(i.timelineEnd)} ${i.id}: "${words(i)}"`);
 const scenes=overlays.filter(i=>i.source&&assets.get(i.source.assetId)?.scene).map(i=>`${clock(i.timelineStart)}-${clock(i.timelineEnd)} ${i.id}: ${name(i.source!.assetId)}`);
 return{durationSec:Math.round(r.durationSec*10)/10,mainTrackClips:r.clips.length,sections,
  titles:titles.slice(0,40),...(titles.length>40?{moreTitles:titles.length-40}:{}),
  scenes:scenes.slice(0,40),...(scenes.length>40?{moreScenes:scenes.length-40}:{}),
  music:r.music.map(m=>`${clock(m.timelineStart)}-${clock(m.timelineEnd)} ${m.id}: ${name(m.assetId)}, ${m.gainDb} dB`),
  ...(captions.length?{captions:`${captions.length} caption items, ${clock(Math.min(...captions.map(i=>i.timelineStart)))}-${clock(Math.max(...captions.map(i=>i.timelineEnd)))}`}:{})};
}
/** Whether the outline leaves part of the edit out, so the edit map is worth sending. */
export function outlineCut(t:TimelineDocument,footage:FootageIndex){const r=resolve(t,footage);return r.clips.length>40||r.items.length>20||r.music.length>8;}
