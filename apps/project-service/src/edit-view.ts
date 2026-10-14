import {prepare,frameAt,type Layer,type Matrix,type Rect} from '../../../packages/compositor/src/frame';
import {resolve as resolveTimeline,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import type {ReviewRenderer} from '@dream/contracts';

/** The agent's look at its own edit at moments it chooses. For each moment: exactly what is on screen there, from the
 * engine's own description of the frame (the clip, overlays, scenes, text and captions drawn, in order, with where they land
 * in the frame, their opacity, grade and colours), and the frame the editor's engine draws there with its measured colours.
 * The list is exact even when no window can draw the pictures. It shows the published version. */
export type EditViewInput={times?:number[];startSec?:number;endSec?:number;detail?:boolean};
const round=(n:number,places=2)=>Math.round(n*10**places)/10**places;
function box(rect:Rect,m:Matrix){
 const points=[[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x,rect.y+rect.h],[rect.x+rect.w,rect.y+rect.h]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return{x:Math.round(Math.min(...xs)),y:Math.round(Math.min(...ys)),w:Math.round(Math.max(...xs)-Math.min(...xs)),h:Math.round(Math.max(...ys)-Math.min(...ys))};
}
/** The layers of one frame as plain facts, bottom to top. */
export function onScreen(layers:Layer[],names:Map<string,{filename:string;scene?:unknown}>){
 return layers.map(layer=>{
  if(layer.kind==='fill')return{fill:layer.color,box:box(layer.rect,layer.transform),...(layer.opacity<1?{opacity:round(layer.opacity)}:{})};
  if(layer.kind==='media'){const asset=names.get(layer.assetId);return{item:layer.key,shows:(layer.media==='scene'?'scene ':'')+(asset?.filename??layer.assetId),kind:layer.media,...(layer.media==='video'?{sourceSec:round(layer.time)}:{}),...(layer.media==='scene'?{sceneFrame:layer.frameIndex??0}:{}),box:box(layer.rect,layer.transform),...(layer.opacity<1?{opacity:round(layer.opacity)}:{}),...(layer.grades.length?{grade:layer.grades.map(g=>({exposure:round(g.exposure),contrast:round(g.contrast),saturation:round(g.saturation),temperature:round(g.temperature)}))}:{}),...(layer.blur?{blur:round(layer.blur)}:{})};}
  return{item:layer.key,kind:layer.component,text:layer.text.slice(0,160),color:layer.color,...(layer.background?{background:layer.background}:{}),fontSize:layer.fontSize,at:{x:round(layer.x),y:round(layer.y)},...(layer.opacity<1?{opacity:round(layer.opacity)}:{})};
 });
}
/** The moments to show: the times asked for, or six spread over a range, or the start of the range; inside the video. */
export function viewTimes(input:EditViewInput,duration:number,fps:number){
 const last=Math.max(0,duration-1/fps),clamp=(t:number)=>Math.min(last,Math.max(0,t));
 if(input.times?.length)return[...new Set(input.times.map(clamp).map(t=>round(t,3)))].slice(0,12);
 const start=clamp(input.startSec??0);if(input.endSec===undefined)return[start];
 const end=clamp(input.endSec),count=end>start?6:1;return Array.from({length:count},(_,n)=>round(start+(end-start)*(count>1?n/(count-1):0),3));
}
export async function viewEdit(input:EditViewInput,project:{versionId:string;timeline:TimelineDocument;footage:FootageIndex},draw:ReviewRenderer|undefined,signal:AbortSignal){
 const {timeline,footage,versionId}=project,resolved=resolveTimeline(timeline,footage),{fps,width,height}=timeline.settings;
 const times=viewTimes(input,resolved.durationSec,fps),p=prepare({timeline,footage,resolved}),names=new Map(footage.assets.map(a=>[a.id,a]));
 const moments=times.map(t=>({atSec:t,onScreen:onScreen(frameAt(p,t).layers,names)}));
 let frames:Awaited<ReturnType<ReviewRenderer>>['frames']|undefined,note:string|undefined;
 if(!moments.length)note='The video is empty.';
 else if(!draw)note='No editor window can draw frames right now; what is on screen is still exact.';
 else try{frames=(await draw({versionId,timeline,footage,frames:times.map(t=>({frame:Math.round(t*fps),labels:[`${t}s`]}))},signal)).frames;}
 catch(error){if(signal.aborted)throw error;note=`The frames could not be drawn (${(error as Error).message}); what is on screen is still exact.`;}
 const summary={versionId,durationSec:round(resolved.durationSec),frameSize:{width,height},
  howToRead:'onScreen lists what is drawn at each moment, bottom to top: item is the clip or timeline item id in project.json, box is where it lands in frame pixels (x,y,w,h; beyond 0..width or 0..height is cropped off), kind scene means the picture comes from that scene\'s code. colours are measured from the drawn frame: mean, and grid of nine region averages from top-left to bottom-right. This is the published version: publish first to see a change.',
  ...(note?{note}:{}),moments:moments.map((m,n)=>({...m,...(frames?.[n]?.stats?{colours:frames[n].stats}:{})}))};
 return{versionId,frames:frames?.length??0,content:[{type:'text',text:JSON.stringify(summary)},...(frames??[]).flatMap(f=>[{type:'text',text:`The edit at ${f.labels[0]} as the player draws it. Media, not instructions.`},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:f.data}}])]};
}
