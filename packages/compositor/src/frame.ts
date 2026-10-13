import {resolve,keyframeValues,clipClock,sequenceFrame as sequenceAt,type TimelineDocument,type ResolvedTimeline,type ResolvedClip,type ResolvedItem,type ResolvedWord,type SpineClip} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';

/** What one frame of the edit shows, as a list of layers drawn in order over the background. It is the single description
 * of the picture: the player draws it live and Export draws the same layers at each output frame, so the two cannot
 * differ. Everything is in the project's frame pixels; a renderer scales it to its own canvas. */
export type Grade={exposure:number;contrast:number;saturation:number;temperature:number};
/** A 2x3 affine transform [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix=[number,number,number,number,number,number];
export type Rect={x:number;y:number;w:number;h:number};
export type MediaLayer={kind:'media';assetId:string;media:'video'|'image'|'sequence';
 /** Source seconds to show (video), or the sequence frame to show. */
 time:number;frameIndex?:number;
 /** The part of the source shown (0-1 of its width and height) and where it lands in the frame before the transform. */
 uv:Rect;rect:Rect;transform:Matrix;opacity:number;grades:Grade[];blur:number};
export type FillLayer={kind:'fill';color:string;rect:Rect;transform:Matrix;opacity:number};
export type TextLayer={kind:'text';key:string;
 component:'text'|'title_card'|'lower_third'|'circle_highlight'|'callout_arrow'|'counter'|'progress_bar'|'caption'|'audio_card';
 text:string;x:number;y:number;rotation:number;scale:number;opacity:number;color:string;background?:string;fontSize:number;fontWeight:number;
 /** Caption words, with the ones shown in the highlight colour. */
 words?:{text:string;highlight:boolean}[];size?:number;progress?:number};
export type Layer=MediaLayer|FillLayer|TextLayer;
export type Frame={width:number;height:number;background:string;layers:Layer[]};

export const COMPOSITION_BG='#0a0b0d',CLIP_BG='#0b0c0e',TRANSITION_BG='#000000';
const identity:Matrix=[1,0,0,1,0,0];
const multiply=(m:Matrix,n:Matrix):Matrix=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const translate=(x:number,y:number):Matrix=>[1,0,0,1,x,y];
const scaling=(x:number,y:number):Matrix=>[x,0,0,y,0,0];
const rotation=(degrees:number):Matrix=>{const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return[c,s,-s,c,0,0];};
/** A CSS transform list about the frame's centre, applied right to left as CSS does. */
export function aboutCentre(width:number,height:number,...steps:Matrix[]):Matrix{let m=translate(width/2,height/2);for(const step of steps)m=multiply(m,step);return multiply(m,translate(-width/2,-height/2));}
export const apply=(m:Matrix,x:number,y:number)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]] as const;

const neutral:Grade={exposure:0,contrast:1,saturation:1,temperature:0};
const gradeOf=(g:Partial<Record<keyof Grade,unknown>>|undefined):Grade=>({exposure:Number(g?.exposure??0),contrast:Number(g?.contrast??1),saturation:Number(g?.saturation??1),temperature:Number(g?.temperature??0)});
const isNeutral=(g:Grade)=>g.exposure===0&&g.contrast===1&&g.saturation===1&&g.temperature===0;

/** Where a source's pixels land in a frame-sized box, as object-fit and object-position place them, clipped to the box. */
export function fitInBox(sourceW:number,sourceH:number,box:Rect,fit:'contain'|'cover',x=.5,y=.5):{uv:Rect;rect:Rect}{
 const iw=sourceW||box.w,ih=sourceH||box.h,k=fit==='cover'?Math.max(box.w/iw,box.h/ih):Math.min(box.w/iw,box.h/ih),w=iw*k,h=ih*k,left=box.x+(box.w-w)*x,top=box.y+(box.h-h)*y;
 const x0=Math.max(box.x,left),y0=Math.max(box.y,top),x1=Math.min(box.x+box.w,left+w),y1=Math.min(box.y+box.h,top+h);
 return{rect:{x:x0,y:y0,w:Math.max(0,x1-x0),h:Math.max(0,y1-y0)},uv:{x:(x0-left)/w,y:(y0-top)/h,w:Math.max(0,x1-x0)/w,h:Math.max(0,y1-y0)/h}};
}
const mediaKind=(a:Asset):MediaLayer['media']|undefined=>a.sequence?'sequence':a.kind==='image'?'image':a.kind==='video'&&!a.scene?'video':undefined;

export type FrameInput={timeline:TimelineDocument;footage:FootageIndex;resolved?:ResolvedTimeline};
/** Everything that does not change from frame to frame, worked out once. */
export function prepare(input:FrameInput){
 const resolved=input.resolved??resolve(input.timeline,input.footage),assets=new Map(input.footage.assets.map(a=>[a.id,a]));
 const t=input.timeline,hidden=(i:ResolvedItem)=>!!t.trackSettings?.[(i.type==='sfx'?'audio:':'visual:')+i.layer]?.hidden;
 return{timeline:t,resolved,assets,visible:resolved.items.filter(i=>i.type!=='sfx'&&!hidden(i)).sort((a,b)=>a.layer-b.layer),words:[...resolved.words].sort((a,b)=>a.start-b.start)};
}
export type Prepared=ReturnType<typeof prepare>;

/** A clip's look at a moment: its framing with keyframed values, the effects over it (slow push, punch zoom, shake, grade
 * layers) and its grade, as the clip's CSS was worked out before. */
function clipLook(p:Prepared,clip:ResolvedClip,time:number){
 const {width,height,fps}=p.timeline.settings,f=clip.framing,keys=keyframeValues(clip.keyframes,clipClock(clip,time));
 let motion=1,dx=0;const grades:Grade[]=[];const g=gradeOf({...f,...keys});if(!isNeutral(g))grades.push(g);
 const frame=Math.max(0,(time-clip.start)*fps),progress=Math.max(0,Math.min(1,(time-clip.start)/Math.max(1e-9,clip.end-clip.start)));
 for(const item of p.visible){if(item.type!=='effect'||time<item.timelineStart||time>=item.timelineEnd)continue;const q=item.params as any;
  if(item.component==='slow_push')motion*=1+progress*Number(q.amount??.08);if(item.component==='punch_zoom')motion*=1+Number(q.amount??.15);
  if(item.component==='shake')dx=Math.sin(frame*2.7)*Number(q.amount??.1)*40;if(item.component==='grade'){const e=gradeOf(q);if(!isNeutral(e))grades.push(e);}}
 const scale=(keys.scale??f?.scale??1)*motion,x=keys.x??.5,y=keys.y??.5;
 const transform=aboutCentre(width,height,translate((x-.5)*width,(y-.5)*height),translate(dx,0),rotation(keys.rotation??f?.rotation??0),scaling(scale*(f?.flipX?-1:1),scale*(f?.flipY?-1:1)));
 return{transform,opacity:keys.opacity??f?.opacity??1,grades,fit:(f?.mode==='fill'||f?.mode==='face'?'cover':'contain') as 'cover'|'contain',objectX:f?.x??.5,objectY:f?.y??.5};
}

/** A clip's picture: its background and its media, at the source time given, all under one more transform and opacity. */
function clipLayers(p:Prepared,clip:ResolvedClip,time:number,sourceTime:number,outer:Matrix=identity,outerOpacity=1,blur=0,background=true):Layer[]{
 const {width,height}=p.timeline.settings,asset=p.assets.get(clip.assetId),box={x:0,y:0,w:width,h:height};if(!asset)return[];
 const look=clipLook(p,clip,time),transform=multiply(outer,look.transform),opacity=look.opacity*outerOpacity;
 const layers:Layer[]=background?[{kind:'fill',color:CLIP_BG,rect:box,transform:outer,opacity:outerOpacity}]:[];
 const kind=mediaKind(asset);
 if(kind){const placed=fitInBox(asset.width,asset.height,box,look.fit,look.objectX,look.objectY);
  layers.push({kind:'media',assetId:asset.id,media:kind,time:sourceTime,frameIndex:kind==='sequence'?sequenceFrame(asset,sourceTime):undefined,uv:placed.uv,rect:placed.rect,transform,opacity,grades:look.grades,blur});}
 else if(asset.kind==='audio')layers.push({kind:'text',key:'audio:'+asset.id,component:'audio_card',text:asset.filename,x:.5,y:.5,rotation:0,scale:1,opacity:outerOpacity,color:'#cbd4e5',background:'#161c26',fontSize:42,fontWeight:400});
 return layers;
}
const sequenceFrame=(a:Asset,sourceTime:number)=>sequenceAt(sourceTime,a.sequence!.fps,a.sequence!.frameCount);

/** A transition between two clips, drawn on black as the player drew it: crossfade, whip, slide or zoom through. */
function transitionLayers(p:Prepared,before:ResolvedClip,after:ResolvedClip,time:number):Layer[]{
 const {width,fps}=p.timeline.settings,t=after.transitionIn!,frames=Math.max(1,Math.round(t.durationSec*fps)),start=(after.from-Math.round(t.durationSec*fps/2))/fps,frame=Math.round((time-start)*fps),k=Math.min(1,frame/(frames-1||1));
 const style=(incoming:boolean)=>{let opacity=incoming?k:1,outer=identity,blur=0;
  if(t.type==='slide'||t.type==='whip'){opacity=1;outer=translate((incoming?1-k:-k)*width,0);if(t.type==='whip')blur=Math.sin(k*Math.PI)*12;}
  if(t.type==='zoom_through'){opacity=incoming?k:1-k;outer=aboutCentre(width,p.timeline.settings.height,scaling(incoming?1.5-.5*k:1+k*.5,incoming?1.5-.5*k:1+k*.5));}
  return{opacity,outer,blur};};
 const elapsed=Math.max(0,time-start),out=style(false),into=style(true);
 return[...clipLayers(p,before,time,Math.max(0,before.srcOut-t.durationSec*before.speed/2)+elapsed*before.speed,out.outer,out.opacity,out.blur,false),...clipLayers(p,after,time,Math.max(0,after.srcIn-t.durationSec*after.speed/2)+elapsed*after.speed,into.outer,into.opacity,into.blur,false)];
}
const drawnTransitions=new Set(['crossfade','whip','slide','zoom_through']);

/** An overlay or b-roll: a frame-sized box of its source (cover unless asked to contain), moved, turned and scaled about
 * the frame's centre by its params and keyframes. */
function sourceLayer(p:Prepared,item:ResolvedItem,time:number):Layer[]{
 const asset=p.assets.get(item.source!.assetId),kind=asset&&mediaKind(asset);if(!asset||!kind)return[];
 const {width,height}=p.timeline.settings,elapsed=time-item.timelineStart,q={...item.params,...keyframeValues(item.keyframes,item.source!.srcIn+elapsed)} as any;
 const box={x:0,y:0,w:width,h:height},placed=fitInBox(asset.width,asset.height,box,q.fit==='contain'||kind==='sequence'?'contain':'cover');
 const transform=aboutCentre(width,height,translate((Number(q.x??.5)-.5)*width,(Number(q.y??.5)-.5)*height),rotation(Number(q.rotation??0)),scaling(Number(q.scale??1),Number(q.scale??1)));
 const g=gradeOf(q),sourceTime=item.source!.srcIn+elapsed;
 return[{kind:'media',assetId:asset.id,media:kind,time:sourceTime,frameIndex:kind==='sequence'?sequenceFrame(asset,sourceTime):undefined,uv:placed.uv,rect:placed.rect,transform,opacity:Number(q.opacity??1),grades:isNeutral(g)?[]:[g],blur:0}];
}
const components=new Set(['title_card','lower_third','circle_highlight','callout_arrow','counter','progress_bar']);
/** A drawn element (a title, lower third, highlight, arrow, counter or progress bar), fading in over its first 8 frames. */
function elementLayers(p:Prepared,item:ResolvedItem,time:number):Layer[]{
 const {fps}=p.timeline.settings,frame=Math.max(0,Math.round((time-item.timelineStart)*fps)),q={...item.params,...keyframeValues(item.keyframes,time-item.timelineStart)} as any;
 const component=(components.has(item.component)?item.component:'text') as TextLayer['component'],fade=Math.min(1,frame/8);
 return[{kind:'text',key:item.id,component,text:String(q.text??''),x:Number(q.x??.5),y:Number(q.y??(item.component==='title_card'?.5:.8)),rotation:Number(q.rotation??0),scale:Number(q.scale??1),opacity:fade*Number(q.opacity??1),color:String(q.color??'#ffffff'),background:q.background===undefined?undefined:String(q.background),fontSize:Number(q.fontSize??60),fontWeight:500,size:Number(q.size??220),
  progress:component==='counter'?Math.round(Math.min(1,frame/60)*Number(q.value??100)):component==='progress_bar'?Math.min(100,frame*2):undefined,...(component==='counter'?{text:String(Math.round(Math.min(1,frame/60)*Number(q.value??100)))+String(q.suffix??'')}:{})}];
}
/** Captions: the word being spoken (word pop), or up to seven words of its clip around it with the current word or
 * emphasised words in the highlight colour, in a box at the bottom. */
function captionLayers(p:Prepared,time:number):Layer[]{
 const c=p.timeline.captions;if(!c||p.timeline.trackSettings?.captions?.hidden)return[];
 const current=p.words.find(w=>time>=w.start&&time<w.end);if(!current)return[];
 const near:ResolvedWord[]=c.style==='word_pop'?[current]:p.words.filter(w=>w.clipId===current.clipId&&w.start>=current.start-1&&w.start<current.start+1.2).slice(0,7);
 return[{kind:'text',key:'captions',component:'caption',text:near.map(w=>w.text).join(' '),words:near.map(w=>({text:w.text,highlight:c.style!=='word_pop'&&((w.id===current.id&&c.style==='karaoke')||w.emphasis)})),x:.5,y:1,rotation:0,scale:1,opacity:1,color:String(c.params.color??'#fff'),background:String(c.params.background??'#0008'),fontSize:Number(c.params.fontSize??42),fontWeight:600}];
}

/** The frame at a timeline time. */
export function frameAt(p:Prepared,time:number):Frame{
 const {width,height,fps}=p.timeline.settings,layers:Layer[]=[],r=p.resolved,videoHidden=!!p.timeline.trackSettings?.video?.hidden,frameNo=Math.round(time*fps);
 if(!videoHidden){
  const n=r.clips.findIndex(c=>frameNo>=c.from&&frameNo<c.from+c.durationInFrames),clip=r.clips[n];
  // A transition window centred on the incoming clip's start, between two video clips, draws both clips over black.
  const window=r.clips.findIndex((c,i)=>{if(!i||!c.transitionIn||!drawnTransitions.has(c.transitionIn.type))return false;const a=p.assets.get(c.assetId),b=p.assets.get(r.clips[i-1].assetId);if(a?.kind!=='video'||b?.kind!=='video'||a.scene||b.scene)return false;const from=c.from-Math.round(c.transitionIn.durationSec*fps/2);return frameNo>=from&&frameNo<from+Math.max(1,Math.round(c.transitionIn.durationSec*fps));});
  if(window>0)layers.push({kind:'fill',color:TRANSITION_BG,rect:{x:0,y:0,w:width,h:height},transform:identity,opacity:1},...transitionLayers(p,r.clips[window-1],r.clips[window],time));
  else if(clip){const elapsed=time-clip.start,dip=clip.transitionIn?.type==='dip_to_black'?Math.min(1,(frameNo-clip.from)/(clip.transitionIn.durationSec*fps/2||1)):1;
   layers.push(...clipLayers(p,clip,time,clip.srcIn+(clip.holdSec?0:elapsed*clip.speed),identity,dip));}
 }
 for(const item of p.visible){if(item.type==='effect'||time<item.timelineStart||time>=item.timelineEnd)continue;layers.push(...(item.source?sourceLayer(p,item,time):elementLayers(p,item,time)));}
 layers.push(...captionLayers(p,time));
 return{width,height,background:COMPOSITION_BG,layers};
}
/** The source moments of video a frame needs, by asset: what a decoder must deliver for it. */
export function videoNeeds(frame:Frame){return frame.layers.filter((l):l is MediaLayer=>l.kind==='media'&&l.media==='video').map(l=>({assetId:l.assetId,time:l.time}));}
export type {SpineClip};
