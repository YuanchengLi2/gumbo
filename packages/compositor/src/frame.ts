import {resolve,keyframeValues,clipClock,sequenceFrame as sequenceAt,itemTrackId,filterGrade,filterFx,effectInfo,textStyle,captionStyle,stickerInfo,type TimelineDocument,type ResolvedTimeline,type ResolvedClip,type ResolvedItem,type ResolvedWord,type SpineClip} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';

/** What one frame of the edit shows, as a list of layers drawn in order over the background. It is the single description
 * of the picture: the player draws it live and Export draws the same layers at each output frame, so the two cannot
 * differ. Everything is in the project's frame pixels; a renderer scales it to its own canvas. */
export type Grade={exposure:number;contrast:number;saturation:number;temperature:number;
 /** Gumbo's filters: green (-1) to magenta (1), lifted blacks (0-1), a hue turn in degrees, a teal-and-orange split tone. */
 tint?:number;fade?:number;hue?:number;splitTone?:number};
/** What a layer keeps, in frame pixels: a rectangle (wipes), a circle (reveals), the side of an edge at or past `d` along
 * its normal, soft over `feather` px (diagonal and soft wipes), a clock hand's sweep from twelve (radians), or stripes
 * open by `open` (0-1) of each `period` px, across x unless `vertical` is false. */
export type Mask={kind:'rect';rect:Rect}|{kind:'circle';cx:number;cy:number;r:number}|{kind:'edge';nx:number;ny:number;d:number;feather:number}|{kind:'clock';cx:number;cy:number;sweep:number}|{kind:'stripes';period:number;open:number;vertical:boolean};
/** Effects drawn on a layer's own pixels, in frame pixels where they have a size: vignette, grain, glow and scan lines
 * (0-1), the colour channels pulled apart (px), blocks (px), bands shifted sideways (0-1), and the seed that moves them.
 * Film burn, light leak and zoom blur are 0-1; streak is a motion blur along (streakX, streakY) px; phase (seconds) moves
 * the burn and the leak smoothly and variant picks their shape. */
export type Fx={vignette?:number;grain?:number;glow?:number;split?:number;scan?:number;pixel?:number;jitter?:number;seed?:number;burn?:number;leak?:number;zoomBlur?:number;streakX?:number;streakY?:number;phase?:number;variant?:number};
/** A 2x3 affine transform [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix=[number,number,number,number,number,number];
export type Rect={x:number;y:number;w:number;h:number};
export type MediaLayer={kind:'media';
 /** The clip or overlay drawing it: a player keeps one video per key. */
 key:string;assetId:string;
 /** A scene is coded motion graphics, drawn by its own document at frameIndex of its frames. */
 media:'video'|'image'|'sequence'|'scene';
 /** Source seconds to show (video), or the sequence frame to show. */
 time:number;frameIndex?:number;
 /** Source seconds per timeline second while playing (the clip's speed; 0 for a held still). */
 rate:number;
 /** The part of the source shown (0-1 of its width and height) and where it lands in the frame before the transform. */
 uv:Rect;rect:Rect;transform:Matrix;opacity:number;grades:Grade[];blur:number;mask?:Mask;fx?:Fx};
export type FillLayer={kind:'fill';color:string;rect:Rect;transform:Matrix;opacity:number;mask?:Mask};
export type TextLayer={kind:'text';key:string;
 component:'text'|'title_card'|'lower_third'|'circle_highlight'|'callout_arrow'|'counter'|'progress_bar'|'caption'|'audio_card'|'sticker';
 text:string;x:number;y:number;rotation:number;scale:number;opacity:number;color:string;background?:string;fontSize:number;fontWeight:number;
 /** Caption words, with the ones shown in the highlight colour (or on the word box), words not said yet hidden in their
  * place, and the current word's pop; the highlight colour and word box colour. */
 words?:{text:string;highlight:boolean;hidden?:boolean;scale?:number}[];highlightColor?:string;wordBox?:string;size?:number;progress?:number;
 /** Text styles: font, italics, letter spacing, outline, shadow, glow, box padding and corner, and how much of the text the
  * typewriter has revealed (0-1). */
 fontFamily?:string;italic?:boolean;letterSpacing?:number;stroke?:string;strokeWidth?:number;shadow?:string;shadowBlur?:number;shadowX?:number;shadowY?:number;glow?:string;glowSize?:number;padding?:number;radius?:number;reveal?:number;
 /** Lower thirds and animations: left alignment (x is the box's left edge), an accent bar, a smaller second line and its
  * colour, a blur (frame px) for blur in and out, and the reveal counted in words rather than characters. */
 align?:'left'|'center';accent?:string;subtext?:string;subColor?:string;blur?:number;revealBy?:'words';
 /** A sticker: which drawing (color is its colour, background its accent), and seconds since it appeared. */
 sticker?:string;time?:number};
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
const EXTRA=['tint','fade','hue','splitTone'] as const;
/** A grade from values that may be missing; the filter fields are only present when they change something. */
export const gradeOf=(g:Partial<Record<keyof Grade,unknown>>|undefined):Grade=>{const out:Grade={exposure:Number(g?.exposure??0),contrast:Number(g?.contrast??1),saturation:Number(g?.saturation??1),temperature:Number(g?.temperature??0)};for(const key of EXTRA){const v=Number(g?.[key]??0);if(v)out[key]=v;}return out;};
const isNeutral=(g:Grade)=>g.exposure===0&&g.contrast===1&&g.saturation===1&&g.temperature===0&&EXTRA.every(key=>!g[key]);
const mergeFx=(a:Fx|undefined,b:Fx|undefined):Fx|undefined=>{if(!a)return b;if(!b)return a;const out:Fx={...a};for(const [key,value] of Object.entries(b) as [keyof Fx,number][])out[key]=key==='seed'||key==='phase'||key==='variant'?value:key==='streakX'||key==='streakY'?(Math.abs(value)>Math.abs(out[key]??0)?value:out[key]):Math.max(out[key]??0,value);return out;};
/** Coded scenes play in their own documents in the preview, which can be placed, faded, cropped and masked (with hard
 * edges) but not graded, blurred or given effects; a scene layer carries none of those, so the preview and Export draw
 * it alike. */
const sceneSafe=(kind:MediaLayer['media'],o:{grades:Grade[];blur:number;fx?:Fx})=>kind==='scene'?{grades:[],blur:0,fx:undefined}:o;
const sceneMask=(kind:MediaLayer['media'],mask:Mask|undefined):Mask|undefined=>kind==='scene'&&mask?.kind==='edge'?{...mask,feather:0}:mask;

/** Where a source's pixels land in a frame-sized box, as object-fit and object-position place them, clipped to the box. */
export function fitInBox(sourceW:number,sourceH:number,box:Rect,fit:'contain'|'cover',x=.5,y=.5):{uv:Rect;rect:Rect}{
 const iw=sourceW||box.w,ih=sourceH||box.h,k=fit==='cover'?Math.max(box.w/iw,box.h/ih):Math.min(box.w/iw,box.h/ih),w=iw*k,h=ih*k,left=box.x+(box.w-w)*x,top=box.y+(box.h-h)*y;
 const x0=Math.max(box.x,left),y0=Math.max(box.y,top),x1=Math.min(box.x+box.w,left+w),y1=Math.min(box.y+box.h,top+h);
 return{rect:{x:x0,y:y0,w:Math.max(0,x1-x0),h:Math.max(0,y1-y0)},uv:{x:(x0-left)/w,y:(y0-top)/h,w:Math.max(0,x1-x0)/w,h:Math.max(0,y1-y0)/h}};
}
const mediaKind=(a:Asset):MediaLayer['media']|undefined=>a.scene?'scene':a.sequence?'sequence':a.kind==='image'?'image':a.kind==='video'?'video':undefined;
/** The scene frame shown at a source time: its frame at that moment, held on the last one. */
const sceneFrame=(a:Asset,sourceTime:number)=>Math.max(0,Math.min((a.scene?.durationInFrames??1)-1,Math.floor(sourceTime*(a.fps||30)+1e-7)));
const frameOf=(a:Asset,kind:MediaLayer['media'],sourceTime:number)=>kind==='sequence'?sequenceFrame(a,sourceTime):kind==='scene'?sceneFrame(a,sourceTime):undefined;

export type FrameInput={timeline:TimelineDocument;footage:FootageIndex;resolved?:ResolvedTimeline};
/** Everything that does not change from frame to frame, worked out once. */
export function prepare(input:FrameInput){
 const resolved=input.resolved??resolve(input.timeline,input.footage),assets=new Map(input.footage.assets.map(a=>[a.id,a]));
 const t=input.timeline,hidden=(i:ResolvedItem)=>!!t.trackSettings?.[itemTrackId(i)]?.hidden;
 return{timeline:t,resolved,assets,visible:resolved.items.filter(i=>i.type!=='sfx'&&!hidden(i)).sort((a,b)=>a.layer-b.layer),words:[...resolved.words].sort((a,b)=>a.start-b.start)};
}
export type Prepared=ReturnType<typeof prepare>;

const chance=(n:number)=>{const x=Math.sin(n*12.9898)*43758.5453;return x-Math.floor(x);};
/** A look's grain, vignette and glow as shader effects (grain moving with the frame), or nothing for a plain grade. */
const lookFx=(id:unknown,intensity:unknown,frameNo:number):Fx|undefined=>{const fx=filterFx(typeof id==='string'?id:undefined,Number(intensity??1));return Object.keys(fx).length?{...fx,...(fx.grain?{seed:frameNo}:{})}:undefined;};
/** What the effect items over a moment do to a picture: a zoom and a shake (main track only), grades (filter items and
 * looks that come with an effect), blur, shader effects and cinema bars. Overlays take only the effects that ask for them
 * (`params.apply: "all"`). Amounts follow the frame's height, so a 4K edit looks like its 1080p preview. */
function effectsAt(p:Prepared,time:number,o:{progress:number;clipFrame:number;main:boolean}){
 const {height:H,fps}=p.timeline.settings,frameNo=Math.round(time*fps),px=H/1080;let motion=1,dx=0,blur=0,bars=0,fx:Fx|undefined;const grades:Grade[]=[];
 const add=(more:Fx)=>{fx=mergeFx(fx,more);};
 for(const item of p.visible){if(item.type!=='effect'||time<item.timelineStart||time>=item.timelineEnd)continue;const q=item.params as Record<string,unknown>;
  if(!o.main&&q.apply!=='all')continue;
  const a=Math.max(0,Number(q.amount??effectInfo(item.component)?.params.find(x=>x.key==='amount')?.default??.5)),elapsed=time-item.timelineStart;
  switch(item.component){
   case 'slow_push':if(o.main)motion*=1+o.progress*Number(q.amount??.08);break;
   case 'pull_out':if(o.main)motion*=1+(1-o.progress)*a;break;
   case 'punch_zoom':if(o.main)motion*=1+Number(q.amount??.15);break;
   case 'zoom_pulse':if(o.main)motion*=1+a*(.5-.5*Math.cos(2*Math.PI*Number(q.rate??2)*elapsed));break;
   case 'shake':if(o.main)dx=Math.sin(o.clipFrame*2.7)*Number(q.amount??.1)*40;break;
   case 'grade':{const e=gradeOf({...filterGrade(typeof q.preset==='string'?q.preset:undefined,Number(q.intensity??1)),...q});if(!isNeutral(e))grades.push(e);const look=lookFx(q.preset,q.intensity,frameNo);if(look)add(look);break;}
   case 'blur':blur+=a*24*px;break;
   case 'vignette':add({vignette:Math.min(1,a)});break;
   case 'glow':add({glow:Math.min(1,a)});break;
   case 'grain':add({grain:Math.min(1,a),seed:frameNo});break;
   case 'rgb_split':add({split:a*20*px});break;
   case 'pixelate':if(a>0)add({pixel:4*px+a*40*px});break;
   case 'letterbox':bars=Math.max(bars,Math.min(1,a)*.15);break;
   case 'vhs':add({split:a*4*px,scan:Math.min(1,a)*.6,jitter:a*.25,grain:a*.25,seed:frameNo});grades.push(gradeOf({saturation:1-.3*a,contrast:1-.1*a,fade:.15*a,tint:-.05*a}));break;
   case 'glitch':{const on=chance(Math.floor(frameNo/3)+item.timelineStart*7)<.25+.5*Math.min(1,a);add({split:a*16*px*(on?1:.15),jitter:on?Math.min(1,a):0,seed:frameNo});break;}
  }}
 return{motion,dx,blur,bars,grades,fx};
}

/** A clip's look at a moment: its framing with keyframed values, the effects over it (slow push, punch zoom, shake, grade
 * layers) and its grade, as the clip's CSS was worked out before. A filter on the clip (`framing.filter`) grades it first. */
function clipLook(p:Prepared,clip:ResolvedClip,time:number){
 const {width,height,fps}=p.timeline.settings,f=clip.framing,keys=keyframeValues(clip.keyframes,clipClock(clip,time));
 const grades:Grade[]=[],filter=gradeOf(filterGrade(f?.filter,f?.filterIntensity??1));if(!isNeutral(filter))grades.push(filter);const g=gradeOf({...f,...keys});if(!isNeutral(g))grades.push(g);
 const frame=Math.max(0,(time-clip.start)*fps),progress=Math.max(0,Math.min(1,(time-clip.start)/Math.max(1e-9,clip.end-clip.start)));
 const effects=effectsAt(p,time,{progress,clipFrame:frame,main:true}),motion=effects.motion,dx=effects.dx;grades.push(...effects.grades);
 // A hard rule: the main track always fills the project's frame. Footage of another shape is cropped to cover it (never
 // letterboxed), it is never zoomed out below the frame, and moves and shake only travel as far as the zoom leaves room,
 // so no edge or bar ever shows, whatever framing a request sets.
 const scale=Math.max(1,(keys.scale??f?.scale??1)*motion),room=(scale-1)/2,clampOffset=(v:number)=>Math.max(-room,Math.min(room,v));
 const x=.5+clampOffset((keys.x??.5)-.5),y=.5+clampOffset((keys.y??.5)-.5),shake=Math.max(-room*width,Math.min(room*width,dx));
 const transform=aboutCentre(width,height,translate((x-.5)*width,(y-.5)*height),translate(shake,0),rotation(keys.rotation??f?.rotation??0),scaling(scale*(f?.flipX?-1:1),scale*(f?.flipY?-1:1)));
 return{transform,opacity:keys.opacity??f?.opacity??1,grades:grades.slice(0,4),fit:'cover' as 'cover'|'contain',objectX:f?.x??.5,objectY:f?.y??.5,fx:mergeFx(lookFx(f?.filter,f?.filterIntensity,Math.round(time*fps)),effects.fx),blur:effects.blur,bars:effects.bars};
}

/** A clip's picture: its background and its media, at the source time given, all under one more transform and opacity. */
function clipLayers(p:Prepared,clip:ResolvedClip,time:number,sourceTime:number,outer:Matrix=identity,outerOpacity=1,blur=0,background=true,mask?:Mask,fx?:Fx):Layer[]{
 const {width,height}=p.timeline.settings,asset=p.assets.get(clip.assetId),box={x:0,y:0,w:width,h:height};if(!asset)return[];
 const look=clipLook(p,clip,time),transform=multiply(outer,look.transform),opacity=look.opacity*outerOpacity;
 const layers:Layer[]=background?[{kind:'fill',color:CLIP_BG,rect:box,transform:outer,opacity:outerOpacity}]:[];
 const kind=mediaKind(asset);
 if(kind){const placed=fitInBox(asset.width,asset.height,box,look.fit,look.objectX,look.objectY);
  const effect=sceneSafe(kind,{grades:look.grades,blur:Math.max(blur,look.blur),fx:mergeFx(look.fx,fx)});
  layers.push({kind:'media',key:clip.id,assetId:asset.id,media:kind,time:sourceTime,rate:clip.holdSec?0:clip.speed,frameIndex:frameOf(asset,kind,sourceTime),uv:placed.uv,rect:placed.rect,transform,opacity,grades:effect.grades,blur:effect.blur,...(effect.fx?{fx:effect.fx}:{}),...(mask?{mask:sceneMask(kind,mask)}:{})});}
 else if(asset.kind==='audio')layers.push({kind:'text',key:'audio:'+asset.id,component:'audio_card',text:asset.filename,x:.5,y:.5,rotation:0,scale:1,opacity:outerOpacity,color:'#cbd4e5',background:'#161c26',fontSize:42,fontWeight:400});
 return layers;
}
const sequenceFrame=(a:Asset,sourceTime:number)=>sequenceAt(sourceTime,a.sequence!.fps,a.sequence!.frameCount);

/** A transition between two clips, centred on the cut and drawn over black. Crossfade, slide and zoom through are drawn as
 * the player first drew them; Gumbo's library adds dips to black and white, a flash, wipes (hard, soft, diagonal, clock,
 * split and blinds), a zoom out, a blur dissolve, a spin, a circle reveal, a glitch, a zoom blur, a film burn, a light
 * leak, a shake cut, a flip and a pixelate. Directional ones go the way their direction says (left by default: the next
 * shot comes in from the right). `intensity` scales how far the strong ones move, blur, burn or shake. */
function transitionLayers(p:Prepared,before:ResolvedClip,after:ResolvedClip,time:number):Layer[]{
 const {width:W,height:H,fps}=p.timeline.settings,t=after.transitionIn!,frames=Math.max(1,Math.round(t.durationSec*fps)),start=(after.from-Math.round(t.durationSec*fps/2))/fps,frame=Math.round((time-start)*fps),k=Math.max(0,Math.min(1,frame/(frames-1||1)));
 const elapsed=Math.max(0,time-start),dir=t.direction??'left',[vx,vy]=dir==='left'?[-1,0]:dir==='right'?[1,0]:dir==='up'?[0,-1]:[0,1],s=Math.max(0,Math.min(1,t.intensity??1)),px=H/1080;
 const outTime=Math.max(0,before.srcOut-t.durationSec*before.speed/2)+elapsed*before.speed,inTime=Math.max(0,after.srcIn-t.durationSec*after.speed/2)+elapsed*after.speed;
 type Look={outer?:Matrix;opacity?:number;blur?:number;mask?:Mask;fx?:Fx};
 const out=(o:Look={})=>clipLayers(p,before,time,outTime,o.outer??identity,o.opacity??1,o.blur??0,false,o.mask,o.fx);
 const into=(o:Look={})=>clipLayers(p,after,time,inTime,o.outer??identity,o.opacity??1,o.blur??0,false,o.mask,o.fx);
 const fill=(color:string,opacity:number):FillLayer=>({kind:'fill',color,rect:{x:0,y:0,w:W,h:H},transform:identity,opacity});
 const smooth=(x:number)=>x*x*(3-2*x),zoom=(s:number,turn=0)=>aboutCentre(W,H,rotation(turn),scaling(s,s));
 const peak=Math.sin(k*Math.PI),mid=(a:number,b:number)=>smooth(Math.max(0,Math.min(1,(k-a)/(b-a)))),phase=elapsed,variant=after.from%7;
 switch(t.type){
  case 'dip_to_black':case 'dip_to_white':{const color=t.type==='dip_to_white'?'#ffffff':'#000000';return k<.5?[...out(),fill(color,smooth(k*2))]:[...into(),fill(color,smooth((1-k)*2))];}
  case 'flash':return[...out(),...into({opacity:k}),fill('#ffffff',peak*.9*s)];
  case 'wipe':{const rect=dir==='left'?{x:W*(1-k),y:0,w:W*k,h:H}:dir==='right'?{x:0,y:0,w:W*k,h:H}:dir==='up'?{x:0,y:H*(1-k),w:W,h:H*k}:{x:0,y:0,w:W,h:H*k};return[...out(),...into({mask:{kind:'rect',rect}})];}
  case 'slide':return[...out({outer:translate(vx*k*W,vy*k*H)}),...into({outer:translate(-vx*(1-k)*W,-vy*(1-k)*H)})];
  // A whip eases through the pan (fastest on the cut) and streaks both shots along the way they move, as a fast pan does.
  case 'whip':{const e=smooth(k),fx:Fx={streakX:vx*peak*.12*W*s,streakY:vy*peak*.12*H*s};return[...out({outer:translate(vx*e*W,vy*e*H),fx}),...into({outer:translate(-vx*(1-e)*W,-vy*(1-e)*H),fx})];}
  case 'cover':{const e=smooth(k);return[...out(),fill('#000000',.35*e),...into({outer:translate(-vx*(1-e)*W,-vy*(1-e)*H)})];}
  case 'zoom_through':return[...out({outer:zoom(1+k*.5*s),opacity:1-k}),...into({outer:zoom(1+.5*s-.5*s*k),opacity:k})];
  case 'zoom_out':return[...out({outer:zoom(1-.35*s*smooth(k)),opacity:1-k}),...into({outer:zoom(1+.25*s-.25*s*smooth(k)),opacity:k})];
  case 'blur':{const blur=peak*24*px*s;return[...out({blur}),...into({opacity:k,blur})];}
  case 'spin':return[...out({outer:zoom(1+k*.8*s,k*90*s),opacity:1-k}),...into({outer:zoom(1+.8*s-.8*s*k,-(1-k)*90*s),opacity:k})];
  case 'iris':return[...out(),...into({mask:{kind:'circle',cx:W/2,cy:H/2,r:smooth(k)*Math.hypot(W,H)/2}})];
  case 'glitch':{const fx:Fx={split:peak*18*px*s,jitter:peak*s,seed:after.from+frame};return k<.5?out({fx}):into({fx});}
  // Rushes into the middle (accelerating) on a radial blur, then out of the next shot; the two meet in a short dissolve.
  case 'zoom_blur':{const a=k*k,b=(1-k)*(1-k);return[...out({outer:zoom(1+.7*s*a),fx:{zoomBlur:s*Math.min(1,a*2)}}),...into({outer:zoom(1+.7*s*b),opacity:mid(.4,.6),fx:{zoomBlur:s*Math.min(1,b*2)}})];}
  case 'film_burn':{const fx:Fx={burn:peak*s,phase,variant};return[...out({fx}),...into({opacity:mid(.35,.65),fx})];}
  case 'light_leak':{const fx:Fx={leak:peak*s,phase,variant};return[...out({fx}),...into({opacity:mid(.3,.7),fx})];}
  // A hard cut on the middle frame, the camera knocked about either side of it, hardest on the cut: a hit of a few
  // per cent of the frame, zoomed in enough that no edge shows, streaked along the jolt.
  case 'shake_cut':{const amp=Math.pow(peak,2)*s,jx=(chance(after.from*3+frame)-.5)*2,jy=(chance(after.from*5+frame+.5)-.5)*2,dx=jx*.045*W*amp,dy=jy*.045*H*amp,turn=jx*2.5*amp,r=turn*Math.PI/180;
   const cover=Math.cos(r)+Math.max(W/H,H/W)*Math.abs(Math.sin(r))+.1*amp,outer=multiply(translate(dx,dy),aboutCentre(W,H,rotation(turn),scaling(cover,cover))),fx:Fx={streakX:dx*.6,streakY:dy*.6};return k<.5?out({outer,fx}):into({outer,fx});}
  case 'clock_wipe':return[...out(),...into({mask:{kind:'clock',cx:W/2,cy:H/2,sweep:k*Math.PI*2}})];
  case 'split':{const e=smooth(k),rect=vx?{x:W*(1-e)/2,y:0,w:W*e,h:H}:{x:0,y:H*(1-e)/2,w:W,h:H*e};return[...out(),...into({mask:{kind:'rect',rect}})];}
  // An edge whose normal points at the corner the next shot comes from, swept across the frame's corners.
  case 'diagonal':case 'smooth_wipe':{const [nx,ny]=t.type==='diagonal'?(dir==='left'?[1,1]:dir==='right'?[-1,-1]:dir==='up'?[-1,1]:[1,-1]).map(v=>v*Math.SQRT1_2):[0-vx,0-vy],feather=t.type==='smooth_wipe'?.12*Math.max(W,H):0;
   const ends=[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>x*nx+y*ny),hi=Math.max(...ends)+feather,lo=Math.min(...ends)-feather;return[...out(),...into({mask:{kind:'edge',nx,ny,d:hi-(hi-lo)*smooth(k),feather}})];}
  case 'blinds':return[...out(),...into({mask:{kind:'stripes',period:(vx?W:H)/8,open:smooth(k),vertical:!!vx}})];
  // A card turning over: this shot narrows to an edge and the next opens from it, a little smaller in the middle of the turn.
  case 'flip':{const turn=Math.abs(Math.cos(k*Math.PI)),z=1-.12*peak,m=aboutCentre(W,H,scaling(vx?turn*z:z,vx?z:turn*z));return k<.5?out({outer:m}):into({outer:m});}
  case 'pixelate':{const fx:Fx={pixel:4*px+peak*56*px*s};return[...out({fx}),...into({opacity:mid(.4,.6),fx})];}
  default:return[...out(),...into({opacity:k})];
 }
}
const visualKinds=new Set(['video','image','sequence','scene']);

/** An overlay or b-roll: a frame-sized box of its source (cover unless asked to contain), moved, turned and scaled about
 * the frame's centre by its params and keyframes. */
function sourceLayer(p:Prepared,item:ResolvedItem,time:number):Layer[]{
 const asset=p.assets.get(item.source!.assetId),kind=asset&&mediaKind(asset);if(!asset||!kind)return[];
 const {width,height}=p.timeline.settings,elapsed=time-item.timelineStart,q={...item.params,...keyframeValues(item.keyframes,item.source!.srcIn+elapsed)} as any;
 const box={x:0,y:0,w:width,h:height},placed=fitInBox(asset.width,asset.height,box,q.fit==='contain'||kind==='sequence'?'contain':'cover');
 const transform=aboutCentre(width,height,translate((Number(q.x??.5)-.5)*width,(Number(q.y??.5)-.5)*height),rotation(Number(q.rotation??0)),scaling(Number(q.scale??1),Number(q.scale??1)));
 const filter=gradeOf(filterGrade(typeof q.filter==='string'?q.filter:undefined,Number(q.filterIntensity??1))),g=gradeOf(q),sourceTime=item.source!.srcIn+elapsed,effects=effectsAt(p,time,{progress:0,clipFrame:0,main:false});
 const look=sceneSafe(kind,{grades:[...(isNeutral(filter)?[]:[filter]),...(isNeutral(g)?[]:[g]),...effects.grades].slice(0,4),blur:effects.blur,fx:mergeFx(lookFx(q.filter,q.filterIntensity,Math.round(time*p.timeline.settings.fps)),effects.fx)});
 return[{kind:'media',key:item.id,assetId:asset.id,media:kind,time:sourceTime,rate:1,frameIndex:frameOf(asset,kind,sourceTime),uv:placed.uv,rect:placed.rect,transform,opacity:Number(q.opacity??1),grades:look.grades,blur:look.blur,...(look.fx?{fx:look.fx}:{})}];
}
const components=new Set(['title_card','lower_third','circle_highlight','callout_arrow','counter','progress_bar']);
/** How long a text's or sticker's entrance lasts: the typewriter types about 22 characters a second and word by word
 * brings in about five words a second (at least 0.4 s, at most 70% of its time); the others last animationSec (0.4 s), at
 * most half its time. */
export function entranceSec(params:Record<string,unknown>,lengthSec:number,sticker=false){
 const style=textStyle(params.style),q={...(style?.params??{}),...params},animation=String(q.animation??(sticker?'pop':'fade'));
 if(animation==='none')return 0;if(animation==='typewriter')return Math.min(lengthSec*.7,Math.max(.4,String(q.text??'').length*.045));
 if(animation==='words')return Math.min(lengthSec*.7,Math.max(.4,String(q.text??'').split(/\s+/).filter(Boolean).length*.2));
 return Math.min(lengthSec/2,Number(q.animationSec??.4));
}
const clamp01=(v:number)=>Math.max(0,Math.min(1,v)),easeOut=(t:number)=>1-Math.pow(1-t,3),back=(t:number)=>1+2.70158*Math.pow(t-1,3)+1.70158*Math.pow(t-1,2);
/** A ball dropped onto the floor: 0 to 1 with three shrinking bounces. */
const bounced=(t:number)=>{const n=7.5625,d=2.75;return t<1/d?n*t*t:t<2/d?n*(t-=1.5/d)*t+.75:t<2.5/d?n*(t-=2.25/d)*t+.9375:n*(t-=2.625/d)*t+.984375;};
/** A drawn element (a title, lower third, highlight, arrow, counter or progress bar), text and stickers. Text with a style
 * takes the style's values under its own; it comes in, goes out and moves as its animations say (as CapCut's in, out and
 * loop). Elements and text from before styles (no style, no animation) fade in over their first 8 frames, as they did. */
function elementLayers(p:Prepared,item:ResolvedItem,time:number):Layer[]{
 const {fps,width:W,height:H}=p.timeline.settings,elapsed=time-item.timelineStart,frame=Math.max(0,Math.round(elapsed*fps)),length=item.timelineEnd-item.timelineStart;
 const sticker=item.component==='sticker'?stickerInfo(item.params.sticker):undefined,style=textStyle(item.params.style);
 const q={...(style?.params??{}),...item.params,...keyframeValues(item.keyframes,elapsed)} as Record<string,any>;
 const component=(sticker||item.component==='sticker'?'sticker':components.has(item.component)?item.component:'text') as TextLayer['component'];
 let opacity=Number(q.opacity??1),scale=Number(q.scale??1),rotation=Number(q.rotation??0),x=Number(q.x??.5),y=Number(q.y??(item.component==='title_card'||component==='sticker'?.5:.8)),reveal:number|undefined,blur=0,revealBy:'words'|undefined;
 if(!style&&q.animation===undefined&&component!=='sticker')opacity*=Math.min(1,frame/8);
 else{
  const animation=String(q.animation??(component==='sticker'?'pop':'fade')),out=String(q.animationOut??'none'),loop=String(q.loop??sticker?.loop??'none');
  const inSec=entranceSec(item.params,length,component==='sticker'),k=inSec>0?clamp01(elapsed/inSec):1,e=easeOut(k);
  if(animation==='fade')opacity*=e;else if(animation==='pop'){scale*=Math.max(0,back(k));opacity*=clamp01(k*4);}else if(animation==='slide_up'){y+=(1-e)*.06;opacity*=e;}
  else if(animation==='slide_down'){y-=(1-e)*.06;opacity*=e;}else if(animation==='zoom'){scale*=.5+.5*e;opacity*=e;}else if(animation==='typewriter')reveal=k;
  else if(animation==='slide_left'){x+=(1-e)*.06;opacity*=e;}else if(animation==='slide_right'){x-=(1-e)*.06;opacity*=e;}
  else if(animation==='stamp'){scale*=1+.9*(1-e);opacity*=clamp01(k*3);}else if(animation==='bounce'){y-=(1-bounced(k))*.12;opacity*=clamp01(k*4);}
  else if(animation==='blur_in'){blur+=(1-e)*24;opacity*=e;}else if(animation==='words'){reveal=k;revealBy='words';}
  const outSec=Math.min(length/2,Number(q.animationOutSec??.35)),left=outSec>0?clamp01((item.timelineEnd-time)/outSec):1,o=easeOut(left);
  if(out==='fade')opacity*=o;else if(out==='pop'){scale*=.4+.6*o;opacity*=o;}else if(out==='slide_down'){y+=(1-o)*.06;opacity*=o;}else if(out==='zoom'){scale*=1+(1-o)*.4;opacity*=o;}
  else if(out==='slide_up'){y-=(1-o)*.06;opacity*=o;}else if(out==='blur_out'){blur+=(1-o)*24;opacity*=o;}
  if(loop==='pulse')scale*=1+.06*Math.sin(2*Math.PI*1.5*elapsed);else if(loop==='wiggle')rotation+=6*Math.sin(2*Math.PI*2*elapsed);else if(loop==='float')y+=.012*Math.sin(2*Math.PI*.8*elapsed);
  else if(loop==='bounce')y-=.03*Math.abs(Math.sin(Math.PI*2*elapsed));else if(loop==='spin')rotation+=60*elapsed;
  // A shake jolts it a little every frame; a flicker dims it now and then, about twelve times a second at most.
  else if(loop==='shake'){x+=(chance(frame*1.3+1)-.5)*.008;y+=(chance(frame*1.7+2)-.5)*.008;rotation+=(chance(frame*1.1+3)-.5)*2;}
  else if(loop==='flicker'&&chance(Math.floor(elapsed*12)+item.timelineStart)<.18)opacity*=.55;
 }
 const base={kind:'text' as const,key:item.id,component,x,y,rotation,scale,opacity:clamp01(opacity)};
 if(component==='sticker')return[{...base,text:String(q.text??''),color:String(q.color??sticker?.color??'#ffffff'),background:String(q.accent??sticker?.accent??'#ffffff'),fontSize:0,fontWeight:0,size:Number(q.size??.3*Math.min(W,H)),sticker:sticker?.id??String(q.sticker??''),time:elapsed}];
 const optional=(key:string,make:(v:any)=>unknown)=>q[key]===undefined||q[key]===''?{}:{[key]:make(q[key])};
 const styled={...optional('fontFamily',String),...optional('italic',Boolean),...optional('letterSpacing',Number),...optional('stroke',String),...optional('strokeWidth',Number),...optional('shadowBlur',Number),...optional('shadowX',Number),...optional('shadowY',Number),...optional('glow',String),...optional('glowSize',Number),...optional('padding',Number),...optional('radius',Number),
  // A styled text without a shadow of its own has none (the soft default shadow is for text from before styles).
  ...(q.shadow!==undefined?{shadow:String(q.shadow)}:style?{shadow:'transparent'}:{}),...(reveal===undefined?{}:{reveal}),...(revealBy?{revealBy}:{}),...(blur>.01?{blur}:{}),
  ...(q.align==='left'?{align:'left' as const}:{}),...optional('accent',String),...optional('subtext',String),...optional('subColor',String)};
 const text=String(q.text??''),shown=q.uppercase?text.toUpperCase():text;
 return[{...base,text:shown,color:String(q.color??'#ffffff'),background:q.background===undefined||q.background===''?undefined:String(q.background),fontSize:Number(q.fontSize??60),fontWeight:Number(q.fontWeight??500),size:Number(q.size??220),...styled,
  progress:component==='counter'?Math.round(Math.min(1,frame/60)*Number(q.value??100)):component==='progress_bar'?Math.min(100,frame*2):undefined,...(component==='counter'?{text:String(Math.round(Math.min(1,frame/60)*Number(q.value??100)))+String(q.suffix??'')}:{})}];
}
/** Captions in their style (the library's values under the edit's own): the word being spoken (one word at a time), a
 * sliding line of up to seven words of its clip around it (the first styles), or the clip's words in fixed groups of
 * `words`, so a group holds still while it is said and through pauses under 0.35 s. The current word, the words said so
 * far or only emphasised ones take the highlight colour or the word box; the current word can pop up as it is said and
 * a typewriter hides the words not said yet, in their place. Placed at the bottom, or centred at `y`. */
function captionLayers(p:Prepared,time:number):Layer[]{
 const c=p.timeline.captions;if(!c||p.timeline.trackSettings?.captions?.hidden)return[];
 const q={...(captionStyle(c.style)?.params??{}),...c.params} as Record<string,any>,size=Math.max(1,Math.round(Number(q.words??7))),grouped=q.words!==undefined&&size>1;
 let current=p.words.find(w=>time>=w.start&&time<w.end);
 if(!current&&grouped){let last:ResolvedWord|undefined;for(const w of p.words){if(w.start>time)break;last=w;}if(last&&time<last.end+.35)current=last;}
 if(!current)return[];const said=current,mine=p.words.filter(w=>w.clipId===said.clipId),at=mine.indexOf(said);
 const near:ResolvedWord[]=size===1?[said]:grouped?mine.slice(Math.floor(at/size)*size,Math.floor(at/size)*size+size):mine.filter(w=>w.start>=said.start-1&&w.start<said.start+1.2).slice(0,7);
 const mode=String(q.highlight??'none'),pop=Number(q.pop??1),cased=(s:string)=>q.uppercase?s.toUpperCase():s;
 const words=near.map(w=>{const highlight=size>1&&((mode==='current'&&w.id===said.id)||(mode==='spoken'&&w.start<=said.start)||w.emphasis);
  return{text:cased(w.text),highlight,...(q.reveal&&w.start>said.start?{hidden:true}:{}),...(pop!==1&&w.id===said.id?{scale:1+(pop-1)*back(clamp01((time-w.start)/.18))}:{})};});
 const optional=(key:string,make:(v:any)=>unknown)=>q[key]===undefined||q[key]===''?{}:{[key]:make(q[key])};
 return[{kind:'text',key:'captions',component:'caption',text:words.map(w=>w.text).join(' '),words,x:.5,y:q.y===undefined?1:Number(q.y),rotation:0,scale:1,opacity:1,color:String(q.color??'#fff'),background:String(q.background??'#0008'),fontSize:Number(q.fontSize??42),fontWeight:Number(q.fontWeight??600),
  ...optional('fontFamily',String),...optional('stroke',String),...optional('strokeWidth',Number),...optional('glow',String),...optional('glowSize',Number),...optional('shadow',String),...optional('shadowBlur',Number),...optional('highlightColor',String),...optional('wordBox',String)}];
}

/** The frame at a timeline time. */
export function frameAt(p:Prepared,time:number):Frame{
 const {width,height,fps}=p.timeline.settings,layers:Layer[]=[],r=p.resolved,videoHidden=!!p.timeline.trackSettings?.video?.hidden,frameNo=Math.round(time*fps);
 if(!videoHidden){
  const n=r.clips.findIndex(c=>frameNo>=c.from&&frameNo<c.from+c.durationInFrames),clip=r.clips[n];
  // A transition window centred on the incoming clip's start, between two clips with a picture, draws both over black.
  const visual=(c:ResolvedClip)=>{const a=p.assets.get(c.assetId);return !!a&&visualKinds.has(mediaKind(a)??'');};
  const window=r.clips.findIndex((c,i)=>{if(!i||!c.transitionIn||c.transitionIn.type==='cut'||!c.transitionIn.durationSec||!visual(c)||!visual(r.clips[i-1]))return false;const from=c.from-Math.round(c.transitionIn.durationSec*fps/2);return frameNo>=from&&frameNo<from+Math.max(1,Math.round(c.transitionIn.durationSec*fps));});
  if(window>0)layers.push({kind:'fill',color:TRANSITION_BG,rect:{x:0,y:0,w:width,h:height},transform:identity,opacity:1},...transitionLayers(p,r.clips[window-1],r.clips[window],time));
  else if(clip){const elapsed=time-clip.start,dip=n===0&&(clip.transitionIn?.type==='dip_to_black'||clip.transitionIn?.type==='dip_to_white')?Math.min(1,(frameNo-clip.from)/(clip.transitionIn.durationSec*fps/2||1)):1;
   // A dip into the first clip fades it in from black (or white) at the start of the video.
   if(dip<1&&clip.transitionIn?.type==='dip_to_white')layers.push({kind:'fill',color:'#ffffff',rect:{x:0,y:0,w:width,h:height},transform:identity,opacity:1});
   layers.push(...clipLayers(p,clip,time,clip.srcIn+(clip.holdSec?0:elapsed*clip.speed),identity,dip));}
  // Cinema bars from a letterbox effect sit on the main track, under overlays, text and captions.
  const bars=effectsAt(p,time,{progress:0,clipFrame:0,main:true}).bars;
  if(bars>0)for(const y of [0,height*(1-bars)])layers.push({kind:'fill',color:'#000000',rect:{x:0,y,w:width,h:height*bars},transform:identity,opacity:1});
 }
 for(const item of p.visible){if(item.type==='effect'||time<item.timelineStart||time>=item.timelineEnd)continue;layers.push(...(item.source?sourceLayer(p,item,time):elementLayers(p,item,time)));}
 layers.push(...captionLayers(p,time));
 return{width,height,background:COMPOSITION_BG,layers};
}
/** The source moments of video a frame needs, by asset: what a decoder must deliver for it. */
export function videoNeeds(frame:Frame){return frame.layers.filter((l):l is MediaLayer=>l.kind==='media'&&l.media==='video').map(l=>({key:l.key,assetId:l.assetId,time:l.time}));}
export type {SpineClip};
