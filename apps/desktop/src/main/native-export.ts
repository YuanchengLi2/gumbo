import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,rmSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {resolve as resolveTimeline,type TimelineDocument,type ResolvedClip,type ResolvedItem,type ResolvedTimeline} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {audioManifest,envelope} from '../../../../packages/composition/src/audio-manifest';
import {whiteBalance} from '../../../../packages/composition/src/visual-style';
import {encodeAtLoudness} from './export-loudness';

/** Native export: the timeline is cut into pieces (a stretch of one clip with a constant set of overlays and effects, or a
 * transition between two clips), and each piece is rendered by ffmpeg straight from the source files: framing, grade, white
 * balance, effects, crossfades, dips, footage overlays and captions, encoded on the graphics card when there is one. Only a
 * piece holding something only the browser can draw (code scenes, text components, other transitions) is rendered by the
 * browser, then given the same captions and encoding. Consecutive pieces render as one ffmpeg run, several runs at once, and
 * the runs join without re-encoding. Plain footage never leaves YUV; anything graded or composited is drawn in RGB with the
 * browser's colour maths (its CSS filters exactly, and its reading of untagged video as BT.709). The sound is mixed from the
 * same envelope the player uses, levelled and encoded while the picture renders. */

const COMPOSITION_BG='0x0a0b0d',CLIP_BG='0x0b0c0e';
export type Piece={index:number;from:number;to:number;kind:'clip'|'transition'|'gap';clip?:ResolvedClip;before?:ResolvedClip;after?:ResolvedClip;overlays:ResolvedItem[];effects:ResolvedItem[];browser:string|undefined;
 /** What the browser draws: the whole frame, or (when only overlays need it) the overlays alone on transparency, put
  * over the footage ffmpeg draws. Decoding footage in the browser is its slowest work, far into a long recording most. */
 browserLayer?:'all'|'overlays'};
type Asset_=Asset;

const visualAsset=(asset:Asset_|undefined)=>!!asset&&!asset.scene&&!asset.sequence&&(asset.kind==='video'||asset.kind==='image');
const nativeEffects=new Set(['slow_push','punch_zoom','shake','grade']),drawnTransitions=new Set(['crossfade','whip','slide','zoom_through']);

/** Why the piece's base (its clip or transition, framing and effects) needs the browser, or undefined. */
function baseReason(piece:Omit<Piece,'browser'|'index'>,footage:FootageIndex):string|undefined{
 const asset=(id:string)=>footage.assets.find(a=>a.id===id);
 if(piece.kind==='clip'&&!visualAsset(asset(piece.clip!.assetId)))return'the clip is a scene or not footage';
 if(piece.kind==='transition'){if(!['crossfade'].includes(piece.after!.transitionIn!.type))return`a ${piece.after!.transitionIn!.type} transition`;if(!visualAsset(asset(piece.before!.assetId))||!visualAsset(asset(piece.after!.assetId)))return'a transition between scenes';}
 for(const effect of piece.effects)if(!nativeEffects.has(effect.component))return`the ${effect.component} effect`;
 if(piece.kind!=='gap'){for(const clip of [piece.clip,piece.before,piece.after].filter(Boolean) as ResolvedClip[])if(clip.framing?.mode==='face')return'face framing';}
 return;
}
/** Why the piece's overlays need the browser, or undefined when ffmpeg draws them all. */
function overlayReason(piece:Omit<Piece,'browser'|'index'>,footage:FootageIndex):string|undefined{
 for(const item of piece.overlays){if(!item.source)return`the ${item.component} element`;const a=footage.assets.find(x=>x.id===item.source!.assetId);if(!visualAsset(a))return'a scene overlay';if(Number((item.params as any).rotation??0)!==0)return'a rotated overlay';}
 return;
}

/** Pieces covering every frame of the video, split wherever what is on screen changes. */
export function planPieces(timeline:TimelineDocument,footage:FootageIndex,resolved:ResolvedTimeline=resolveTimeline(timeline,footage)):Piece[]{
 const fps=timeline.settings.fps,total=resolved.durationInFrames,frame=(seconds:number)=>Math.max(0,Math.min(total,Math.round(seconds*fps)));
 const hidden=(i:ResolvedItem)=>!!timeline.trackSettings?.[(i.type==='sfx'?'audio:':'visual:')+i.layer]?.hidden;
 const visible=resolved.items.filter(i=>i.type!=='sfx'&&!hidden(i));
 // Transition windows, as the player draws them: centred on the incoming clip's start, for the drawn types, between two
 // video clips (anything else is a cut).
 const kind=(id:string)=>footage.assets.find(a=>a.id===id)?.kind;
 const windows=resolved.clips.flatMap((c,n)=>n>0&&c.transitionIn&&drawnTransitions.has(c.transitionIn.type)&&kind(c.assetId)==='video'&&kind(resolved.clips[n-1].assetId)==='video'?[{before:resolved.clips[n-1],after:c,from:c.from-Math.round(c.transitionIn.durationSec*fps/2),to:c.from-Math.round(c.transitionIn.durationSec*fps/2)+Math.max(1,Math.round(c.transitionIn.durationSec*fps))}]:[]);
 const cuts=new Set<number>([0,total]);
 for(const c of resolved.clips){cuts.add(c.from);cuts.add(c.from+c.durationInFrames);if(c.transitionIn?.type==='dip_to_black')cuts.add(c.from+Math.max(1,Math.round(c.transitionIn.durationSec*fps/2)));}
 for(const w of windows){cuts.add(w.from);cuts.add(w.to);}
 for(const i of visible){cuts.add(frame(i.timelineStart));cuts.add(Math.max(frame(i.timelineStart)+1,frame(i.timelineEnd)));}
 const bounds=[...cuts].filter(f=>f>=0&&f<=total).sort((a,b)=>a-b),pieces:Piece[]=[];
 for(let n=0;n<bounds.length-1;n++){
  const from=bounds[n],to=bounds[n+1];if(to<=from)continue;
  const active=visible.filter(i=>frame(i.timelineStart)<=from&&Math.max(frame(i.timelineStart)+1,frame(i.timelineEnd))>=to);
  const window=windows.find(w=>w.from<=from&&w.to>=to),clip=resolved.clips.find(c=>c.from<=from&&c.from+c.durationInFrames>=to);
  const base={from,to,overlays:active.filter(i=>i.type!=='effect').sort((a,b)=>a.layer-b.layer),effects:active.filter(i=>i.type==='effect')};
  const piece:Omit<Piece,'browser'|'index'>=timeline.trackSettings?.video?.hidden?{...base,kind:'gap'}:window?{...base,kind:'transition',before:window.before,after:window.after}:clip?{...base,kind:'clip',clip}:{...base,kind:'gap'};
  const whole=baseReason(piece,footage),layer=overlayReason(piece,footage);
  pieces.push({...piece,index:pieces.length,browser:whole??layer,...(whole?{browserLayer:'all' as const}:layer?{browserLayer:'overlays' as const}:{})});
 }
 return pieces;
}

// ---- Colour: the player's CSS filters as ffmpeg filters, exactly. brightness(b) multiplies, contrast(c) is (x-0.5)c+0.5,
// saturate(s) is the CSS luminance matrix, and the white balance is the same matrix as the player's SVG filter.
const num=(n:number)=>Number(n.toFixed(6)).toString();
function gradeChain(g:{exposure?:number;contrast?:number;saturation?:number;temperature?:number}|undefined){
 if(!g)return[];const b=2**(g.exposure??0),c=g.contrast??1,s=g.saturation??1,t=whiteBalance(g.temperature??0),out:string[]=[];
 if(b!==1||c!==1){const k=b*c,o=(.5-.5*c)*255;out.push(`lutrgb=r='clip(clip(val*${num(b)},0,255)*${num(c)}+${num(o)},0,255)':g='clip(clip(val*${num(b)},0,255)*${num(c)}+${num(o)},0,255)':b='clip(clip(val*${num(b)},0,255)*${num(c)}+${num(o)},0,255)'`);void k;}
 if(s!==1){const m=[[.213+.787*s,.715-.715*s,.072-.072*s],[.213-.213*s,.715+.285*s,.072-.072*s],[.213-.213*s,.715-.715*s,.072+.928*s]];out.push(`colorchannelmixer=rr=${num(m[0][0])}:rg=${num(m[0][1])}:rb=${num(m[0][2])}:gr=${num(m[1][0])}:gg=${num(m[1][1])}:gb=${num(m[1][2])}:br=${num(m[2][0])}:bg=${num(m[2][1])}:bb=${num(m[2][2])}`);}
 if(t)out.push(`colorchannelmixer=rr=${num(1+.25*t)}:gg=${num(1+.04*t)}:bb=${num(1-.25*t)}`);
 return out;
}
const gradeOf=(f:any)=>f&&{exposure:f.exposure,contrast:f.contrast,saturation:f.saturation,temperature:f.temperature};

// ---- How a source's pixels turn into colours, read from the file: the browser reads untagged video as BT.709 limited range
// (and untagged JPEG as BT.601 full range), where ffmpeg would assume BT.601, so conversions name the matrix. Video already in
// the output's form (8-bit 4:2:0, BT.709, limited range) can be cut and encoded without converting at all.
export type Colour={matrix:string;range:'tv'|'pc';yuv:boolean};
const matrices:Record<string,string>={bt709:'bt709',bt470bg:'bt470',smpte170m:'smpte170m',bt2020nc:'bt2020',bt2020c:'bt2020',fcc:'fcc',smpte240m:'smpte240m'};
export function parseColour(log:string,image:boolean):Colour{
 const m=/Stream #\d+:\d+[^:]*: Video: [^,]+, (\w+)(?:\(([^)]*)\))?/.exec(log),format=m?.[1]??'',tags=(m?.[2]??'').split(/[,/]\s*|\s+/);
 const matrix=tags.map(t=>matrices[t]).find(Boolean)??(image?'bt470':'bt709'),range=tags.includes('pc')||format.startsWith('yuvj')||(image&&!tags.includes('tv'))?'pc':'tv';
 return{matrix,range,yuv:format==='yuv420p'&&range==='tv'&&matrix==='bt709'};
}
function probeColour(ffmpeg:string,path:string,image:boolean){return new Promise<Colour>(resolve=>{const child=spawn(ffmpeg,['-hide_banner','-i',path],{windowsHide:true});let log='';child.stderr.on('data',chunk=>{log+=chunk.toString();});child.on('error',()=>resolve(parseColour('',image)));child.on('close',()=>resolve(parseColour(log,image)));});}

/** The element box as CSS lays it out: the source scaled by object-fit (contain or cover) into a frame-sized box at its
 * object-position, cropped to that box, graded, as a [width x height] RGBA picture centred on the frame. */
function boxSize(asset:Asset_,fit:'contain'|'cover',width:number,height:number){
 const iw=asset.width||width,ih=asset.height||height,k=fit==='cover'?Math.max(width/iw,height/ih):Math.min(width/iw,height/ih);
 return{w:Math.max(2,Math.round(iw*k/2)*2),h:Math.max(2,Math.round(ih*k/2)*2)};
}
/** (An opaque box, one that fills the frame, has no alpha channel; one that also needs no RGB work stays in YUV.) */
function boxChain(input:string,asset:Asset_,colour:Colour,fit:'contain'|'cover',x:number,y:number,width:number,height:number,fps:number,speed:number,grades:string[],opaque=false,yuv=false){
 const {w,h}=boxSize(asset,fit,width,height);
 const place=fit==='cover'?`crop=${width}:${height}:${Math.round((w-width)*x)}:${Math.round((h-height)*y)}`:`pad=${width}:${height}:${Math.round((width-w)*x)}:${Math.round((height-h)*y)}:color=0x00000000`;
 const convert=yuv?'format=yuv420p':`scale=in_color_matrix=${colour.matrix}:in_range=${colour.range},format=rgb24`;
 return[`[${input}]setpts=(PTS-STARTPTS)/${num(speed)},fps=${fps},${convert}`,...grades,...(w===asset.width&&h===asset.height?[]:[`scale=${w}:${h}:flags=bicubic`]),...(opaque?[]:['format=rgba']),...(opaque&&w===width&&h===height?[]:[place])].join(',');
}

/** One clip as the player draws it: the element box over the clip background, then the CSS transform about the frame centre
 * (shake offset, rotation, scale with effects, flips) and the clip's opacity. Grade layers follow the clip's own grade.
 * When the clip covers the whole frame at every moment (opaque footage filling it, not shrunk, rotated or shaken), the
 * background shows nowhere: the clip is drawn without alpha, zoomed by scaling up and keeping the centre, and kept in YUV
 * when nothing on it needs RGB (rgb false). The chain then ends at [output] itself (opaque). */
function clipChain(input:string,output:string,clip:ResolvedClip,asset:Asset_,colour:Colour,piece:Piece,width:number,height:number,fps:number,rgb:boolean){
 const f=clip.framing,cover=f?.mode==='fill'||f?.mode==='face',start=piece.from/fps,clipStart=clip.start,clipLength=Math.max(1e-6,clip.end-clip.start),rotation=(f?.rotation??0)*Math.PI/180;
 // Scale and shake as expressions of TIME, the seconds since the piece starts.
 let scale=`${num(f?.scale??1)}`,dx='0',shrinks=(f?.scale??1)<1;
 for(const e of piece.effects){const amount=Number((e.params as any).amount??(e.component==='slow_push'?.08:e.component==='punch_zoom'?.15:.1));
  if(e.component==='slow_push')scale+=`*(1+max(0,min(1,(${num(start)}+TIME-${num(clipStart)})/${num(clipLength)}))*${num(amount)})`;
  if(e.component==='punch_zoom')scale+=`*${num(1+amount)}`;
  if((e.component==='slow_push'||e.component==='punch_zoom')&&amount<0)shrinks=true;
  if(e.component==='shake')dx=`sin(max(0,${num(start)}+TIME-${num(clipStart)})*${fps}*2.7)*${num(amount)}*40`;}
 const animated=scale.includes('TIME')||dx!=='0',grades=[...gradeChain(gradeOf(f)),...piece.effects.filter(e=>e.component==='grade').flatMap(e=>gradeChain(e.params as any))];
 const fit=cover?'cover':'contain',box=boxSize(asset,fit,width,height),opacity=f?.opacity??1;
 const opaque=asset.kind==='video'&&(cover||(box.w===width&&box.h===height))&&!rotation&&dx==='0'&&!shrinks&&opacity>=1;
 const yuv=opaque&&!rgb&&!grades.length&&colour.yuv;
 const chain=[boxChain(input,asset,colour,fit,f?.x??.5,f?.y??.5,width,height,fps,clip.speed,grades,opaque,yuv),...(f?.flipX?['hflip']:[]),...(f?.flipY?['vflip']:[])];
 // A changing size rebuilds the scaler every frame, and bilinear rebuilds fastest (it is also how the browser samples a
 // transformed video). The size steps by 4 pixels so the centre crop stays on whole chroma samples. (crop keeps the input
 // size it started with, so its offset is worked out from the same time expression rather than from the input.)
 const grown=(z:string,frame:number)=>`trunc((${frame}*(${z})-${frame})/4)*4`;
 if(opaque){
  if(scale!=='1'){const z=scale.replace(/TIME/g,'t');chain.push(`scale=w='${width}+${grown(z,width)}':h='${height}+${grown(z,height)}':eval=${animated?'frame':'init'}:flags=${animated?'bilinear':'bicubic'}`,`crop=w=${width}:h=${height}:x='${grown(z,width)}/2':y='${grown(z,height)}/2'`);}
  return{chain:chain.join(',')+`[${output}]`,overlay:undefined,yuv};
 }
 if(rotation)chain.push(`rotate=${num(rotation)}:ow='rotw(${num(rotation)})':oh='roth(${num(rotation)})':c=none`);
 if(scale!=='1')chain.push(`scale=w='max(2,trunc(iw*(${scale.replace(/TIME/g,'t')})/2)*2)':h='max(2,trunc(ih*(${scale.replace(/TIME/g,'t')})/2)*2)':eval=${animated?'frame':'init'}:flags=${animated?'bilinear':'bicubic'}`);
 if(opacity<1)chain.push(`colorchannelmixer=aa=${num(opacity)}`);
 return{chain:chain.join(',')+`[${output}fg]`,overlay:`[${output}bg][${output}fg]overlay=x='(main_w-overlay_w)/2+${dx.replace(/TIME/g,'t')}':y='(main_h-overlay_h)/2':eval=${animated?'frame':'init'}:format=rgb[${output}]`,yuv:false};
}

/** A footage overlay (b-roll) as the player draws it: a frame-sized box of the source (cover by default, contain when asked)
 * moved by (x-0.5, y-0.5) of the frame and scaled about its centre, at its opacity. */
function overlayChain(input:string,item:ResolvedItem,asset:Asset_,colour:Colour,width:number,height:number,fps:number){
 const p=item.params as any,s=Number(p.scale??1),opacity=Number(p.opacity??1);
 const chain=[boxChain(input,asset,colour,p.fit==='contain'?'contain':'cover',.5,.5,width,height,fps,1,[]),...(s!==1?[`scale=${Math.max(2,Math.round(width*s/2)*2)}:${Math.max(2,Math.round(height*s/2)*2)}:flags=bicubic`]:[]),...(opacity<1?[`colorchannelmixer=aa=${num(opacity)}`]:[])].join(',');
 return{chain,x:`(main_w-overlay_w)/2+${num((Number(p.x??.5)-.5)*width)}`,y:`(main_h-overlay_h)/2+${num((Number(p.y??.5)-.5)*height)}`};
}

// ---- Captions as ASS subtitles, drawn the way the player draws them: up to seven words of the current clip around the word
// being spoken, in a translucent box at the bottom; karaoke and emphasis colour the current word.
const assTime=(t:number)=>{const cs=Math.max(0,Math.round(t*100)),h=Math.floor(cs/360000),m=Math.floor(cs/6000)%60,s=Math.floor(cs/100)%60;return`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
const assColor=(css:string,fallback:string)=>{const m=/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css.trim())??/^#?([0-9a-f]{3})([0-9a-f])?$/i.exec(css.trim());if(!m)return fallback;let hex=m[1];if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');let a=m[2]??'ff';if(a.length===1)a+=a;const alpha=255-parseInt(a,16);return`&H${alpha.toString(16).padStart(2,'0').toUpperCase()}${hex.slice(4,6)}${hex.slice(2,4)}${hex.slice(0,2)}`.toUpperCase();};
export function captionsAss(timeline:TimelineDocument,resolved:ResolvedTimeline,from:number,to:number){
 const c=timeline.captions;if(!c||timeline.trackSettings?.captions?.hidden)return;
 // libass sizes a font by its cell (Arial's ascent plus descent, 2288 units) where CSS sizes it by the em (2048 units). The box
 // is padded 14px by 24px and sits 5% of the frame width above the bottom, as the player's caption box does.
 const {width,height}=timeline.settings,size=Number(c.params.fontSize??42),cell=Math.round(size*2288/2048*10)/10,color=assColor(String(c.params.color??'#fff'),'&H00FFFFFF'),box=assColor(String(c.params.background??'#0008'),'&H77000000');
 const head=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,${cell},${color},${color},${box},${box},-1,0,0,0,100,100,0,0,3,14,0,2,${Math.round(width*.09)},${Math.round(width*.09)},${Math.round(width*.05+14)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
 const fps=timeline.settings.fps,a=from/fps,b=to/fps,lines:string[]=[];
 for(const w of resolved.words){if(w.end<=a||w.start>=b)continue;
  const near=c.style==='word_pop'?[w]:resolved.words.filter(o=>o.clipId===w.clipId&&o.start>=w.start-1&&o.start<w.start+1.2).slice(0,7);
  const text=near.map(o=>{const t=o.text.replace(/[{}\\]/g,'');return(o.id===w.id&&c.style==='karaoke')||o.emphasis?`{\\c&HFFB8A5&}${t}{\\c${color}}`:t;}).join(' ');
  lines.push(`Dialogue: 0,${assTime(Math.max(0,w.start-a))},${assTime(Math.min(b,w.end)-a)},Caption,,0,0,0,,{\\xbord24\\ybord14}${text}`);}
 return lines.length?head+lines.join('\n')+'\n':undefined;
}

// ---- Encoding: the graphics card's encoder when this computer has one, else x264. Every piece uses the same settings so
// the pieces can be joined without re-encoding.
export type Encoder={name:string;args:string[];pixelFormat:string};
const candidates:Encoder[]=[{name:'h264_nvenc',args:['-c:v','h264_nvenc','-preset','p5','-rc','vbr','-cq','19','-b:v','0'],pixelFormat:'yuv420p'},{name:'h264_qsv',args:['-c:v','h264_qsv','-global_quality','20','-look_ahead','0'],pixelFormat:'nv12'},{name:'h264_amf',args:['-c:v','h264_amf','-quality','quality','-rc','cqp','-qp_i','18','-qp_p','20'],pixelFormat:'yuv420p'}];
const software:Encoder={name:'libx264',args:['-c:v','libx264','-preset','veryfast','-crf','18'],pixelFormat:'yuv420p'};
let chosen:Promise<Encoder>|undefined;
export function pickEncoder(ffmpeg:string){
 if(process.env.DREAM_EXPORT_ENCODER==='software')return Promise.resolve(software);
 return chosen??=(async()=>{for(const encoder of candidates){try{await runFfmpeg(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i','testsrc2=s=256x144:r=30:d=0.5','-vf',`format=${encoder.pixelFormat}`,...encoder.args,'-f','null','-']);return encoder;}catch{}}return software;})();
}

function runFfmpeg(ffmpeg:string,args:string[],signal?:AbortSignal,cwd?:string){return new Promise<void>((resolve,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,signal,cwd});let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4000);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('ffmpeg failed: '+log.slice(-1500))));});}

export type NativeExportOptions={ffmpeg:string;timeline:TimelineDocument;footage:FootageIndex;output:string;workDir:string;signal?:AbortSignal;concurrency?:number;
 /** Renders frames [from,to) of the composition (captions hidden, no audio) with the browser to a video file: the whole frame,
  * or with layer 'overlays' only the overlays, on transparency (the footage is ffmpeg's). */
 renderBrowser:(from:number,to:number,file:string,layer:'all'|'overlays')=>Promise<void>;onProgress?:(done:number,total:number,phase:string)=>void};

/** What the browser renders for a piece: the composition without captions (drawn over the whole video afterwards), and for
 * the overlays layer also without the footage, on a transparent background, as ProRes 4444 with alpha. */
export function browserLayer(timeline:TimelineDocument,layer:'all'|'overlays'){
 const tracks=timeline.trackSettings??{},overlays=layer==='overlays';
 return{timeline:{...timeline,trackSettings:{...tracks,captions:{...tracks.captions,hidden:true},...(overlays?{video:{...tracks.video,hidden:true}}:{})}},transparentBackground:overlays,
  render:overlays?{codec:'prores' as const,proResProfile:'4444' as const,imageFormat:'png' as const,pixelFormat:'yuva444p10le' as const}:{codec:'prores' as const,proResProfile:'hq' as const}};
}

/** Renders the timeline natively. Returns what it did so callers can report it. */
export async function exportNative(o:NativeExportOptions){
 const {timeline,footage,ffmpeg,workDir}=o,{width,height,fps}=timeline.settings,resolved=resolveTimeline(timeline,footage),pieces=planPieces(timeline,footage,resolved),encoder=await pickEncoder(ffmpeg);
 mkdirSync(workDir,{recursive:true});const asset=(id:string)=>footage.assets.find(a=>a.id===id)!;
 // Each source's colour tags, read once.
 const used=new Set(pieces.filter(p=>p.browserLayer!=='all').flatMap(p=>[p.clip,p.before,p.after].filter(Boolean).map(c=>c!.assetId).concat(p.browserLayer?[]:p.overlays.map(i=>i.source!.assetId))));
 const colours=new Map(await Promise.all([...used].map(async id=>[id,await probeColour(ffmpeg,asset(id).originalPath,asset(id).kind==='image')] as const)));
 const encode=[...encoder.args,'-pix_fmt',encoder.pixelFormat==='nv12'?'nv12':'yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-r',String(fps),'-g',String(fps*2),'-video_track_timescale',String(fps*1000),'-an'];

 /** One piece's part of a run's filter graph: its inputs (numbered from first) and filters, ending at [p<index>] as frame-sized
  * 4:2:0 BT.709 frames, exactly as many as the piece has. Labels carry the piece's index so pieces share one graph. */
 const buildPiece=async(p:Piece,first:number)=>{
  const frames=p.to-p.from,seconds=frames/fps,inputs:string[]=[],filters:string[]=[],L=(name:string)=>`p${p.index}${name}`;
  const addInput=(path:string,seek:number,length:number,image=false)=>{if(image)inputs.push('-loop','1','-framerate',String(fps),'-t',num(length+1/fps),'-i',path);else inputs.push('-ss',num(Math.max(0,seek)),'-t',num(length+2/fps),'-i',path);return first+inputs.filter(a=>a==='-i').length-1;};
  let last=L('base'),yuv=false;
  if(p.browserLayer==='all'){const raw=join(workDir,`browser-${p.index}.mov`);await o.renderBrowser(p.from,p.to,raw,'all');const n=addInput(raw,0,seconds);filters.push(`[${n}:v]fps=${fps},format=rgb24[${last}]`);}
  else{
   // The composition background; transitions are drawn on black, and a clip on its own background, as the player does.
   const plate=(color:string,label:string)=>`color=c=${color}:s=${width}x${height}:r=${fps}:d=${num(seconds+1/fps)},format=rgba[${label}]`;
   const base=plate(p.kind==='transition'?'black':COMPOSITION_BG,L('base'));if(p.kind!=='clip')filters.push(base);
   // A clip with footage over it is drawn in RGB, where the overlay is blended.
   const drawClip=(clip:ResolvedClip,label:string,sourceStart:number,background:string)=>{const a=asset(clip.assetId),n=addInput(a.originalPath,sourceStart,seconds*clip.speed,a.kind==='image');const c=clipChain(`${n}:v`,label,clip,a,colours.get(a.id)!,p,width,height,fps,p.kind!=='clip'||p.overlays.length>0);
     if(c.overlay)filters.push(plate(background,`${label}bg`),c.chain,c.overlay);else filters.push(c.chain);return{label,opaque:!c.overlay,yuv:c.yuv};};
   if(p.kind==='clip'){const clip=p.clip!,offset=(p.from-clip.from)/fps*clip.speed;const drawn=drawClip(clip,L('c0'),clip.srcIn+offset,CLIP_BG);
    const dip=clip.transitionIn?.type==='dip_to_black'&&p.from===clip.from?Math.max(1,Math.round(clip.transitionIn.durationSec*fps/2)):0;
    // An opaque clip hides the composition background, so it is the frame.
    if(!drawn.opaque)filters.push(base);
    filters.push(`${drawn.opaque?`[${drawn.label}]null`:`[${L('base')}][${drawn.label}]overlay=0:0:format=rgb`}${dip?`,fade=t=in:st=0:d=${num(dip/fps)}:color=${COMPOSITION_BG}`:''}[${L('v0')}]`);last=L('v0');yuv=drawn.yuv;}
   if(p.kind==='transition'){const before=p.before!,after=p.after!,d=Math.max(1,Math.round(after.transitionIn!.durationSec*fps));
    // As the player does: the outgoing clip runs on past its out point, the incoming one starts before its in point.
    const into=(p.from-(after.from-Math.round(after.transitionIn!.durationSec*fps/2)))/fps;
    drawClip(before,L('c0'),Math.max(0,before.srcOut-after.transitionIn!.durationSec*before.speed/2)+into*before.speed,'0x00000000');drawClip(after,L('c1'),Math.max(0,after.srcIn-after.transitionIn!.durationSec*after.speed/2)+into*after.speed,'0x00000000');
    // The incoming clip at opacity p over the outgoing one on black, as the player does, with p going from 0 to 1 over the
    // transition's frames: its alpha faded in, timed from the transition's start (this piece may begin part way through).
    const offset=p.from-(after.from-Math.round(after.transitionIn!.durationSec*fps/2));
    filters.push(`[${L('base')}][${L('c0')}]overlay=0:0:format=rgb[${L('out')}]`,`[${L('c1')}]format=rgba,setpts=PTS+${offset}/(${fps}*TB),fade=t=in:st=0:d=${num(Math.max(1,d-1)/fps)}:alpha=1,setpts=PTS-STARTPTS[${L('in')}]`,`[${L('out')}][${L('in')}]overlay=0:0:format=rgb[${L('v0')}]`);last=L('v0');}
   // Overlays only the browser can draw come from it as one transparent layer over the footage; the others ffmpeg draws.
   if(p.browserLayer==='overlays'){const raw=join(workDir,`overlays-${p.index}.mov`);await o.renderBrowser(p.from,p.to,raw,'overlays');const n=addInput(raw,0,seconds);
    filters.push(`[${n}:v]fps=${fps},format=rgba[${L('layer')}]`,`[${last}][${L('layer')}]overlay=0:0:format=rgb[${L('layered')}]`);last=L('layered');}
   else p.overlays.forEach((item,i)=>{const a=asset(item.source!.assetId),offset=(p.from/fps)-item.timelineStart,n=addInput(a.originalPath,item.source!.srcIn+Math.max(0,offset),seconds,a.kind==='image'),c=overlayChain(`${n}:v`,item,a,colours.get(a.id)!,width,height,fps);
    filters.push(`${c.chain}[${L('o'+i)}]`,`[${last}][${L('o'+i)}]overlay=x='${c.x}':y='${c.y}':format=rgb[${L('ov'+i)}]`);last=L('ov'+i);});
  }
  // Exactly the piece's frames (a source that ends early holds its last frame), as 4:2:0 BT.709. Frames already in that form
  // pass through: converting YUV to YUV would reinterpret an untagged source's matrix.
  const convert=yuv?'format=yuv420p':'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
  filters.push(`[${last}]${convert},setsar=1,tpad=stop_mode=clone:stop=${frames},trim=end_frame=${frames},setpts=PTS-STARTPTS[p${p.index}]`);
  return{inputs,filters,count:inputs.filter(a=>a==='-i').length};
 };

 // Runs of pieces rendered by one ffmpeg each: starting the encoder and loading the caption fonts takes a second or two, which
 // a long edit with a cut every few seconds would otherwise pay hundreds of times. A browser piece is a run of its own, and
 // runs are kept short enough that several render at once.
 const runs:Piece[][]=[];
 for(const p of pieces){const run=runs.at(-1);if(run&&p.browserLayer!=='all'&&run[0].browserLayer!=='all'&&run.length<24&&p.to-run[0].from<=fps*90)run.push(p);else runs.push([p]);}
 const runFile=(run:Piece[])=>join(workDir,`run-${String(run[0].index).padStart(5,'0')}.mp4`);let done=0;
 const renderRun=async(run:Piece[])=>{
  o.signal?.throwIfAborted();const from=run[0].from,to=run.at(-1)!.to,args:string[]=['-hide_banner','-v','error','-y'],filters:string[]=[];let inputs=0;
  for(const p of run){const built=await buildPiece(p,inputs);args.push(...built.inputs);filters.push(...built.filters);inputs+=built.count;}
  let last='joined';filters.push(`${run.map(p=>`[p${p.index}]`).join('')}concat=n=${run.length}:v=1:a=0[joined]`);
  const ass=captionsAss(timeline,resolved,from,to),assName=`run-${run[0].index}.ass`,assFile=join(workDir,assName);if(ass)writeFileSync(assFile,ass);
  // Filter files are named relative to the work directory, where ffmpeg runs: no drive colon to escape.
  if(ass)filters.push(`[${last}]subtitles=filename=${assName}[sub]`),last='sub';
  filters.push(`[${last}]format=${encoder.pixelFormat}[out]`);
  args.push('-filter_complex',filters.join(';'),'-map','[out]','-frames:v',String(to-from),...encode,runFile(run));
  if(process.env.DREAM_EXPORT_DEBUG)writeFileSync(join(workDir,`run-${run[0].index}.json`),JSON.stringify(args));
  try{await runFfmpeg(ffmpeg,args,o.signal,workDir);}catch(error){throw new Error(`Pieces ${run[0].index}-${run.at(-1)!.index} (frames ${from}-${to}): ${(error as Error).message}
Filters: ${filters.join(';')}`);}finally{if(existsSync(assFile)&&!process.env.DREAM_EXPORT_DEBUG)rmSync(assFile,{force:true});}
  done+=run.length;o.onProgress?.(done,pieces.length,'Rendering the video');
 };
 // The sound is mixed, levelled and encoded while the picture renders; it needs little of the processor the picture uses.
 const sound=(async()=>{const mix=join(workDir,'mix.wav'),encoded=join(workDir,'sound.m4a');if(!await mixAudio(o,resolved,mix))return;await encodeAtLoudness(ffmpeg,mix,encoded,o.signal);rmSync(mix,{force:true});return encoded;})();
 const limit=o.concurrency??3;let next=0;const errors:unknown[]=[];
 const picture=Promise.all(Array.from({length:Math.min(limit,runs.length)},async()=>{while(next<runs.length&&!errors.length){const run=runs[next++];try{await renderRun(run);}catch(error){errors.push(error);}}}));
 const [,audio]=await Promise.all([picture,sound]);
 if(errors.length)throw errors[0];
 const list=join(workDir,'runs.txt');writeFileSync(list,runs.map(run=>`file '${runFile(run).replace(/\\/g,'/').replace(/'/g,"'\\''")}'`).join('\n'));
 o.onProgress?.(pieces.length,pieces.length,'Joining picture and sound');
 const temp=o.output+'.native.mp4';
 await runFfmpeg(ffmpeg,['-hide_banner','-v','error','-y','-f','concat','-safe','0','-i',list,...(audio?['-i',audio]:[]),'-map','0:v',...(audio?['-map','1:a']:[]),'-c','copy','-movflags','+faststart','-t',num(resolved.durationInFrames/fps),temp],o.signal);
 renameSync(temp,o.output);
 return{pieces:pieces.length,runs:runs.length,browserPieces:pieces.filter(p=>p.browser).length,encoder:encoder.name};
}

/** The sound: each segment trimmed, sped (pitch kept), shaped by the same per-frame envelope the player applies (gain, fades,
 * ducking under speech), and placed at its start. Segments are mixed in batches, in timeline order, each batch covering only
 * its own stretch (a long edit has hundreds of segments, more inputs than one command line can hold), and the batches are
 * then mixed into the whole. The filter graphs are read from files for the same reason. */
async function mixAudio(o:NativeExportOptions,resolved:ResolvedTimeline,output:string){
 const fps=o.timeline.settings.fps,totalSamples=Math.round(resolved.durationInFrames/fps*48000);
 const segments=audioManifest(o.timeline,o.footage).map((segment,i)=>({segment,i})).sort((a,b)=>a.segment.startSample-b.segment.startSample);if(!segments.length)return false;
 // Whether a word is being spoken at a sample: the last word starting by then, or one just before it, still running.
 const words=[...resolved.words].sort((a,b)=>a.start-b.start),speaking=(sample:number)=>{const t=sample/48000;let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>1;if(words[mid].start<=t)lo=mid+1;else hi=mid;}for(let k=lo-1;k>=Math.max(0,lo-4);k--)if(words[k].end>t)return true;return false;};
 const mix=async(batch:typeof segments,from:number,to:number,file:string)=>{
  const args=['-hide_banner','-v','error','-y'],filters:string[]=[],labels:string[]=[];
  batch.forEach(({segment,i},n)=>{
   const asset=o.footage.assets.find(a=>a.id===segment.assetId)!,path=asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath,length=segment.durationSamples/48000;
   args.push('-ss',num(segment.sourceStartSample/48000),'-t',num(length*segment.speed+.1),'-i',path);
   // The envelope per frame, as a command file: one volume change wherever the value changes.
   const commands:string[]=[];let previous=-1;
   for(let f=0;f<=Math.ceil(length*fps);f++){const sample=segment.startSample+Math.round(f/fps*48000),value=Math.round(envelope(segment,Math.min(sample,segment.startSample+segment.durationSamples-1),speaking(sample))*10000)/10000;if(value!==previous){commands.push(`${num(f/fps)} volume@v${i} volume ${value};`);previous=value;}}
   writeFileSync(join(o.workDir,`envelope-${i}.cmd`),commands.join('\n'));
   let tempo='';let remaining=segment.speed;const factors:number[]=[];while(remaining>2){factors.push(2);remaining/=2;}while(remaining<.5){factors.push(.5);remaining/=.5;}factors.push(remaining);if(segment.speed!==1)tempo=factors.map(n=>`atempo=${num(n)}`).join(',')+',';
   filters.push(`[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${tempo}atrim=0:${num(length)},asetpts=PTS-STARTPTS,asendcmd=f=envelope-${i}.cmd,volume@v${i}=0:eval=frame,adelay=${segment.startSample-from}S:all=1[a${n}]`);labels.push(`[a${n}]`);
  });
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${to-from}[mix]`);
  const graph=`${file}.graph`;writeFileSync(graph,filters.join(';\n'));
  args.push('-filter_complex_script',graph,'-map','[mix]','-c:a','pcm_f32le',file);
  await runFfmpeg(o.ffmpeg,args,o.signal,o.workDir);
 };
 const size=32,batches=Array.from({length:Math.ceil(segments.length/size)},(_,k)=>segments.slice(k*size,(k+1)*size));
 if(batches.length===1){await mix(segments,0,totalSamples,output);return true;}
 const parts=await Promise.all(batches.map(async(batch,k)=>{const from=batch[0].segment.startSample,to=Math.min(totalSamples,Math.max(...batch.map(s=>s.segment.startSample+s.segment.durationSamples))),file=join(o.workDir,`mix-${k}.wav`);await mix(batch,from,to,file);return{file,from};}));
 const filters=[...parts.map((p,k)=>`[${k}:a]adelay=${p.from}S:all=1[b${k}]`),`${parts.map((_,k)=>`[b${k}]`).join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${totalSamples}[mix]`],graph=join(o.workDir,'mix.graph');
 writeFileSync(graph,filters.join(';\n'));
 await runFfmpeg(o.ffmpeg,['-hide_banner','-v','error','-y',...parts.flatMap(p=>['-i',p.file]),'-filter_complex_script',graph,'-map','[mix]','-c:a','pcm_f32le',output],o.signal,o.workDir);
 for(const p of parts)rmSync(p.file,{force:true});
 return true;
}
