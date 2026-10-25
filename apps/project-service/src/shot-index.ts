import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {ProjectDB} from '@dream/project-db';
import type {Asset} from '@dream/footage';
import {jpeg} from './source-frames';

/** The footage index: the agent's way to know its material, as an editor knows the rushes. Every imported video is split
 * into shots (long takes into parts of at most six seconds), each with facts measured from its frames and sound (camera
 * movement and shake, light, colour, sharpness, how much moves, loudness) and a short description of what happens in it
 * and any text on screen, written once by a small vision model from three of its frames (early, middle, late), so an
 * action, a goal or a reaction inside a long take is written down, not only what one frame shows. The agent searches it by meaning and facts, and every result comes back with its
 * frame, so it judges with its own eyes: a wrong description costs a glance, never a wrong edit. Nothing here is pushed into
 * the agent's context; it asks. */
export const SHOT_INDEX_VERSION=1;
const W=96,H=54,RATE=4,FRAME=W*H*3,MAX_PART=6,SPLIT_OVER=8;
export type ShotFacts={brightness:number;saturation:number;sharpness:number;panX:number;panY:number;shake:number;activity:number;loudnessDb?:number};
export type Shot={id:string;assetId:string;start:number;end:number;cutIn:boolean;part?:[number,number];facts:ShotFacts;labels:string[];what?:string;text?:string;tags?:string[]};
export type ShotIndex={version:number;assetId:string;fingerprint:string;durationSec:number;shots:Shot[];sharpnessMedian:number;describedAt?:string;describeError?:string};
/** Asks a small vision model about one image (the director's inference, so its cost is recorded like any call). */
export type Describe=(system:string,content:unknown[],signal:AbortSignal)=>Promise<{content?:any[]}>;

const r2=(n:number)=>Math.round(n*100)/100,r3=(n:number)=>Math.round(n*1000)/1000;
const median=(values:number[])=>{if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;

type FrameStat={t:number;luma:Float32Array;small:Float32Array;hist:Float32Array;brightness:number;saturation:number;sharpness:number};
function analyseFrame(rgb:Buffer,t:number):FrameStat{
 const n=W*H,luma=new Float32Array(n),hist=new Float32Array(64);let sum=0,sat=0;
 for(let i=0;i<n;i++){const r=rgb[i*3],g=rgb[i*3+1],b=rgb[i*3+2],y=.299*r+.587*g+.114*b,max=Math.max(r,g,b),min=Math.min(r,g,b);luma[i]=y;sum+=y;sat+=max?(max-min)/max:0;hist[(r>>6)*16+(g>>6)*4+(b>>6)]++;}
 for(let k=0;k<64;k++)hist[k]/=n;
 // Sharpness: the variance of the Laplacian, compared later with the same source's median (soft = out of focus or blurred).
 let total=0,squares=0,count=0;for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x,l=4*luma[i]-luma[i-1]-luma[i+1]-luma[i-W]-luma[i+W];total+=l;squares+=l*l;count++;}
 const small=new Float32Array((W/2)*(H/2));for(let y=0;y<H/2;y++)for(let x=0;x<W/2;x++){const i=2*y*W+2*x;small[y*(W/2)+x]=(luma[i]+luma[i+1]+luma[i+W]+luma[i+W+1])/4;}
 return{t,luma,small,hist,brightness:sum/n/255,saturation:sat/n,sharpness:squares/count-(total/count)**2};
}
const histDistance=(a:Float32Array,b:Float32Array)=>{let d=0;for(let k=0;k<64;k++)d+=Math.abs(a[k]-b[k]);return d/2;};
/** Mean absolute difference when b's content is moved by (dx,dy) onto a, over the overlap, on a grid of step pixels. */
function difference(a:Float32Array,b:Float32Array,w:number,h:number,dx:number,dy:number,step=1){
 let s=0,c=0;for(let y=Math.max(0,dy);y<Math.min(h,h+dy);y+=step)for(let x=Math.max(0,dx);x<Math.min(w,w+dx);x+=step){s+=Math.abs(a[y*w+x]-b[(y-dy)*w+(x-dx)]);c++;}
 return c?s/c:255;
}
/** How the picture moved between two frames: the content shift (pixels of a 96-wide frame) that best lines them up, found
 * coarse to fine, and what still differs after it (things moving in the shot). */
function shift(a:FrameStat,b:FrameStat){
 // No movement unless a shift fits clearly better: on a flat or blank picture every shift fits, and none happened.
 let best={dx:0,dy:0,d:difference(a.small,b.small,W/2,H/2,0,0)};for(let dy=-3;dy<=3;dy++)for(let dx=-4;dx<=4;dx++){const d=difference(a.small,b.small,W/2,H/2,dx,dy);if(d<best.d-.5)best={dx,dy,d};}
 let fine={dx:best.dx*2,dy:best.dy*2,d:difference(a.luma,b.luma,W,H,best.dx*2,best.dy*2,2)};for(let dy=best.dy*2-1;dy<=best.dy*2+1;dy++)for(let dx=best.dx*2-1;dx<=best.dx*2+1;dx++){const d=difference(a.luma,b.luma,W,H,dx,dy,2);if(d<fine.d-.5)fine={dx,dy,d};}
 return{dx:fine.dx,dy:fine.dy,residual:fine.d/255};
}
/** A cut: the colours change at once, beyond what the camera moving explains. Absolute for hard cuts, relative to the
 * recent frames for cuts between similar-looking shots. */
export function isCut(distance:number,residual:number,recent:number[]){
 if(distance>=.42)return true;const usual=Math.max(.02,median(recent));
 return distance>=.2&&distance>=usual*3.5&&residual>=.06;
}

function frames(ffmpeg:string,path:string,image:boolean,signal:AbortSignal,each:(rgb:Buffer,t:number)=>void){return new Promise<void>((resolve,reject)=>{
 const child=spawn(ffmpeg,['-v','error','-threads','2','-i',path,'-an',...(image?['-frames:v','1']:[]),'-vf',`${image?'':`fps=${RATE},`}scale=${W}:${H}:flags=area,format=rgb24`,'-f','rawvideo','pipe:1'],{windowsHide:true,signal});
 let pending=Buffer.alloc(0),n=0,error='';
 child.stdout.on('data',(chunk:Buffer)=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=FRAME){each(pending.subarray(0,FRAME),n/RATE);n++;pending=pending.subarray(FRAME);}});
 child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-1500);});child.on('error',reject);
 child.on('close',code=>code===0||n>0?resolve():reject(new Error('The footage could not be read for indexing. '+error)));
});}
/** Loudness in dBFS per quarter second, from the source's sound. */
function loudness(ffmpeg:string,path:string,signal:AbortSignal){return new Promise<number[]>((resolve,reject)=>{
 const child=spawn(ffmpeg,['-v','error','-i',path,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{windowsHide:true,signal});
 const out:number[]=[];let pending=Buffer.alloc(0),squares=0,count=0;const window=8000/RATE;
 child.stdout.on('data',(chunk:Buffer)=>{const b=Buffer.concat([pending,chunk]);let i=0;for(;i+1<b.length;i+=2){const v=b.readInt16LE(i)/32768;squares+=v*v;if(++count>=window){out.push(10*Math.log10(squares/count+1e-10));squares=0;count=0;}}pending=b.subarray(i);});
 child.stderr.resume();child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error('The sound could not be read for indexing.')));
});}

/** Words for the facts, with thresholds calibrated on handheld travel footage at 96x54 and four frames a second: pan in
 * percent of the frame width per second, shake as the average jolt between quarter seconds. */
export function labelsFor(f:ShotFacts,sharpnessMedian:number){
 const out:string[]=[],pan=Math.hypot(f.panX,f.panY);
 if(f.shake>=2.4)out.push('shaky');else if(f.shake>=1.1)out.push('handheld');else if(pan<3)out.push('steady');
 if(Math.abs(f.panX)>=6&&Math.abs(f.panX)>=Math.abs(f.panY)*1.5)out.push(f.panX>0?'pans right':'pans left');else if(Math.abs(f.panY)>=6)out.push(f.panY>0?'tilts down':'tilts up');
 if(f.brightness<.22)out.push('dark');else if(f.brightness>.68)out.push('bright');
 if(f.saturation>.5)out.push('colourful');else if(f.saturation<.12)out.push('muted colours');
 // Soft: far less fine detail than the source usually has; a flat card (no detail at all) is not called soft.
 if(sharpnessMedian>0&&f.sharpness>2&&f.sharpness<sharpnessMedian*.35)out.push('soft');
 if(f.activity>.075)out.push('busy');else if(f.activity<.012&&pan<1.5)out.push('still');
 if(f.loudnessDb!==undefined){if(f.loudnessDb<-50)out.push('silent');else if(f.loudnessDb>-18)out.push('loud');}
 return out;
}

/** Shots and their facts for one video or image. A shot longer than eight seconds is split into parts of at most six. */
export async function measureShots(ffmpeg:string,asset:Pick<Asset,'id'|'kind'|'durationSec'|'originalPath'|'proxyPath'|'audioPath'|'hasAudio'>,signal:AbortSignal){
 const path=asset.proxyPath&&existsSync(asset.proxyPath)?asset.proxyPath:asset.originalPath,image=asset.kind==='image';
 const stats:FrameStat[]=[],moves:{dx:number;dy:number;residual:number;distance:number}[]=[];
 await frames(ffmpeg,path,image,signal,(rgb,t)=>{const s=analyseFrame(rgb,t),prev=stats.at(-1);if(prev){const m=shift(prev,s);moves.push({...m,distance:histDistance(prev.hist,s.hist)});}else moves.push({dx:0,dy:0,residual:0,distance:0});stats.push(s);});
 signal.throwIfAborted();if(!stats.length)throw new Error('No frames could be read for indexing.');
 const audio=asset.hasAudio&&!image?await loudness(ffmpeg,asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath,signal).catch(()=>[] as number[]):[];
 const end=image?0:Math.max(asset.durationSec,stats.length/RATE);
 // Cut points (frame indices), at least three quarters of a second apart.
 const cuts=[0];for(let i=1;i<stats.length;i++){const m=moves[i];if(isCut(m.distance,m.residual,moves.slice(Math.max(1,i-8),i).map(x=>x.distance))&&i-cuts.at(-1)!>=3)cuts.push(i);}
 const ranges:{from:number;to:number;cutIn:boolean;part?:[number,number]}[]=[];
 cuts.forEach((from,k)=>{const to=k+1<cuts.length?cuts[k+1]:stats.length,length=(to-from)/RATE;
  if(length<=SPLIT_OVER){ranges.push({from,to,cutIn:k>0});return;}
  const parts=Math.ceil(length/MAX_PART);for(let p=0;p<parts;p++)ranges.push({from:from+Math.round((to-from)*p/parts),to:from+Math.round((to-from)*(p+1)/parts),cutIn:k>0&&p===0,part:[p+1,parts]});});
 const sharpnessMedian=median(stats.map(s=>s.sharpness));
 const shots:Shot[]=ranges.map(r=>{
  const own=stats.slice(r.from,r.to),motion=moves.slice(r.from+1,r.to),pct=100/W*RATE;
  const dx=motion.map(m=>m.dx),dy=motion.map(m=>m.dy),jolts=motion.slice(1).map((m,i)=>Math.hypot(m.dx-motion[i].dx,m.dy-motion[i].dy));
  const sound=audio.slice(r.from,r.to),facts:ShotFacts={brightness:r3(mean(own.map(s=>s.brightness))),saturation:r3(mean(own.map(s=>s.saturation))),sharpness:r2(median(own.map(s=>s.sharpness))),
   // The shift is how far the picture's content moved left (and up) between frames: content moving left means the camera
   // turns right, so a positive shift is a pan right (or a tilt down).
   panX:r2(mean(dx)*pct),panY:r2(mean(dy)*pct),shake:r2(mean(jolts)*100/W),activity:r3(median(motion.map(m=>m.residual))),...(sound.length?{loudnessDb:Math.round(10*Math.log10(mean(sound.map(d=>10**(d/10)))+1e-10))}:{})};
  const start=image?0:r2(r.from/RATE),stop=image?0:r2(Math.min(end,r.to/RATE));
  return{id:`${asset.id}@${start}`,assetId:asset.id,start,end:stop,cutIn:r.cutIn,...(r.part?{part:r.part}:{}),facts,labels:labelsFor(facts,sharpnessMedian)};
 });
 return{shots,sharpnessMedian};
}

export const describeSystem=`You index video footage for a video editor, so moments can be found by searching. The image is a grid of frames: each row is one shot (row 1 at the top), its three frames in time order from left to right (early, middle, late). The footage can be anything: a vlog, an interview, a film, sport, gameplay, a screen recording, slides, animation. Reply with a JSON array only, one object per row: {"n": row number, "what": "what happens in the shot, at most 25 words: who or what, the action and how it changes across the three frames, the place; name a person only when a caption or name tag says it", "text": "readable text on screen, briefly: a title, caption, slide heading, score, game HUD or sign; empty when there is none", "tags": ["8 to 14 single lowercase words: the kind of picture (camera, screen, game, slides, animation, graphic), the setting (street, room, stage, field, studio, desk…), indoor or outdoor, day or night, people (none, person, couple, group, crowd), shot size (wide, medium, closeup), the view (selfie, aerial, pov, overhead) when it applies, and the main subjects, actions and notable things"]}. Describe only what is visible.`;
/** The representative frame of a shot: its middle. */
export const shotFrameTime=(s:Shot)=>r3((s.start+s.end)/2);
/** The three frames a shot is described from: a sixth in, the middle, a sixth before the end. */
export const describeTimes=(s:Shot)=>{const d=s.end-s.start;return[r3(s.start+d/6),shotFrameTime(s),r3(s.end-d/6)];};
function parseDescriptions(text:string,count:number){
 const a=text.indexOf('['),b=text.lastIndexOf(']');if(a<0||b<a)return[];
 try{const rows=JSON.parse(text.slice(a,b+1));return(Array.isArray(rows)?rows:[]).filter((r:any)=>Number.isInteger(r?.n)&&r.n>=1&&r.n<=count&&typeof r.what==='string').map((r:any)=>({n:r.n as number,what:String(r.what).replace(/\s+/g,' ').trim().slice(0,240),text:typeof r.text==='string'?r.text.replace(/\s+/g,' ').trim().slice(0,160):'',tags:(Array.isArray(r.tags)?r.tags:[]).map((t:unknown)=>String(t).toLowerCase().trim()).filter(Boolean).slice(0,16) as string[]}));}catch{return[];}
}

/** Builds, saves and describes the index of one asset; reuses what is saved for the same file. */
export class ShotIndexer{
 private running=new Map<string,Promise<ShotIndex|undefined>>();private controller=new AbortController();private queued:string[]=[];private draining=false;
 constructor(private db:ProjectDB,private ffmpeg:string,private describe?:Describe,private sheet?:(images:{data:string}[],signal:AbortSignal)=>Promise<{data:string}>){}
 /** Indexes these assets one after another in the background: new imports, and footage of projects made before the index. */
 queue(ids:string[]){for(const id of ids)if(!this.queued.includes(id))this.queued.push(id);if(!this.draining)void this.drain();}
 private async drain(){this.draining=true;try{while(this.queued.length&&!this.controller.signal.aborted){const id=this.queued.shift()!;try{await this.ensure(id,this.controller.signal);}catch{}}}finally{this.draining=false;}}
 /** Indexable footage with no index yet, or shots not yet described. */
 missing(){return this.db.footage().assets.filter(a=>ShotIndexer.indexable(a)&&!this.saved(a.id)?.shots.every(s=>s.what)).map(a=>a.id);}
 get signal(){return this.controller.signal;}
 close(){this.controller.abort();}
 static indexable(a:Asset){return(a.kind==='video'||a.kind==='image')&&!a.scene&&!a.sequence&&!a.creation&&!a.generated&&!a.missing&&a.status!=='failed';}
 saved(assetId:string){const asset=this.db.footage().assets.find(a=>a.id===assetId),index=this.db.loadState<ShotIndex>('shot-index:'+assetId);return asset&&index&&index.version===SHOT_INDEX_VERSION&&index.fingerprint===asset.fingerprint?index:undefined;}
 status(assetId:string){const index=this.saved(assetId);if(!index)return this.running.has(assetId)?'indexing':'not indexed';const described=index.shots.filter(s=>s.what).length;return described===index.shots.length?`${index.shots.length} shots`:`${index.shots.length} shots, ${described} described${index.describeError?` (describing failed: ${index.describeError.slice(0,80)})`:''}`;}
 /** The index of an asset, measuring and describing what is missing. Concurrent calls share the work. */
 ensure(assetId:string,signal:AbortSignal):Promise<ShotIndex|undefined>{
  const existing=this.running.get(assetId);if(existing)return existing;
  const work=(async()=>{
   const asset=this.db.footage().assets.find(a=>a.id===assetId);if(!asset||!ShotIndexer.indexable(asset))return undefined;
   let index=this.saved(assetId);
   if(!index){const measured=await measureShots(this.ffmpeg,asset,signal);index={version:SHOT_INDEX_VERSION,assetId,fingerprint:asset.fingerprint,durationSec:asset.durationSec,...measured};this.db.saveState('shot-index:'+assetId,index);}
   if(this.describe&&this.sheet&&index.shots.some(s=>!s.what))index=await this.describeMissing(asset,index,signal);
   return index;
  })().finally(()=>this.running.delete(assetId));
  this.running.set(assetId,work);return work;
 }
 private async describeMissing(asset:Asset,index:ShotIndex,signal:AbortSignal){
  // Four shots a sheet, a row of three frames each; four sheets at a time.
  const missing=index.shots.filter(s=>!s.what);
  const batches=Array.from({length:Math.ceil(missing.length/4)},(_,k)=>missing.slice(k*4,k*4+4));let failure:string|undefined,next=0;
  await Promise.all(Array.from({length:Math.min(4,batches.length)},async()=>{for(;;){const batch=batches[next++];if(!batch)return;signal.throwIfAborted();
   try{
    const images=(await Promise.all(batch.map(s=>Promise.all((asset.kind==='image'?[0,0,0]:describeTimes(s)).map(async t=>({data:(await this.frameAt(asset,t,signal)).toString('base64')})))))).flat();
    const sheet=await this.sheet!(images,signal),response=await this.describe!(describeSystem,[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:sheet.data}},{type:'text',text:`${batch.length} rows.`}],signal);
    const rows=parseDescriptions((response.content??[]).filter((b:any)=>b?.type==='text').map((b:any)=>b.text).join(''),batch.length);
    for(const row of rows){const shot=batch[row.n-1];shot.what=row.what;shot.tags=row.tags;if(row.text)shot.text=row.text;}
    if(!rows.length)failure='the description reply was not readable';
   }catch(error){signal.throwIfAborted();failure=(error as Error).message;}
  }}));
  const current=this.saved(asset.id)??index,byId=new Map(index.shots.map(s=>[s.id,s]));
  const merged:ShotIndex={...current,shots:current.shots.map(s=>{const d=byId.get(s.id);return d?.what?{...s,what:d.what,tags:d.tags,...(d.text?{text:d.text}:{})}:s;}),describedAt:new Date().toISOString(),...(failure?{describeError:failure}:{describeError:undefined})};
  this.db.saveState('shot-index:'+asset.id,merged);return merged;
 }
 /** A shot's representative frame, cached by file and time. */
 frame(asset:Asset,shot:Shot,signal:AbortSignal){return this.frameAt(asset,asset.kind==='image'?0:shotFrameTime(shot),signal);}
 /** A frame of the source, from its short-keyframe preview copy when there is one (seeks are cheap there), cached. */
 async frameAt(asset:Asset,time:number,signal:AbortSignal){
  const path=asset.proxyPath&&existsSync(asset.proxyPath)?asset.proxyPath:asset.originalPath,key=`shot-frame:v1:${asset.fingerprint}:${time}`,saved=this.db.getMeta(key);
  if(saved)return Buffer.from(this.db.blobs.get(saved),'base64');
  const bytes=await jpeg(this.ffmpeg,path,time,signal,512);this.db.setMeta(key,this.db.blobs.put(bytes.toString('base64')));return bytes;
 }
}

// Search: words matched loosely (case, accents, plural and -ing forms), ranked like a search engine (BM25), what happens,
// the text on screen and the tags counting double, spoken words and fact labels once.
const STOP=new Set(['a','an','the','of','and','or','in','on','at','to','with','for','from','by','is','are','be','some','any','shot','shots','clip','clips','footage','video','videos','scene','scenes','that','this','where','me','my','i','show','find','want']);
const stem=(w:string)=>{if(w.length<=4)return w;let s=w.replace(/ies$/,'y').replace(/(?<!s)(es|s)$/,'');if(s.length>5)s=s.replace(/(ing|ed)$/,'');return s.length>4?s.replace(/e$/,''):s;};
export const terms=(text:string)=>text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').split(/[^\p{L}\p{N}]+/u).filter(w=>w&&!STOP.has(w)).map(stem);
export type ShotQuery={query?:string;assetIds?:string[];steady?:boolean;light?:'dark'|'normal'|'bright';speech?:boolean;unused?:boolean;minSec?:number;limit?:number;offset?:number};
export type ShotHit={shot:Shot;score:number;words:string;usedAt?:number};
/** Where each source range is used in the edit (main track, attached items, music), in timeline seconds. */
export function usedRanges(resolved:{clips:{assetId:string;srcIn:number;srcOut:number;start:number}[];items:{source?:{assetId:string;srcIn:number;srcOut:number};timelineStart:number}[]}){
 const out:{assetId:string;from:number;to:number;at:number}[]=[];
 for(const c of resolved.clips)out.push({assetId:c.assetId,from:c.srcIn,to:c.srcOut,at:c.start});
 for(const i of resolved.items)if(i.source)out.push({assetId:i.source.assetId,from:i.source.srcIn,to:i.source.srcOut,at:i.timelineStart});
 return out;
}
export function searchShots(shots:Shot[],q:ShotQuery,spoken:(s:Shot)=>string,used:{assetId:string;from:number;to:number;at:number}[]){
 const wanted=terms(q.query??''),excluded=new Set(terms((q.query??'').split(/\s+/).filter(w=>w.startsWith('-')).join(' '))),include=wanted.filter(t=>!excluded.has(t));
 const docs=shots.map(shot=>{const words=spoken(shot),text=[...terms(`${shot.what??''} ${shot.text??''} ${(shot.tags??[]).join(' ')}`).flatMap(t=>[t,t]),...terms(words),...terms(shot.labels.join(' '))];const tf=new Map<string,number>();for(const t of text)tf.set(t,(tf.get(t)??0)+1);
  const overlap=used.filter(u=>u.assetId===shot.assetId&&Math.min(u.to,shot.end)-Math.max(u.from,shot.start)>Math.max(.5,(shot.end-shot.start)*.4));
  return{shot,words,tf,length:text.length,usedAt:overlap.length?r2(Math.min(...overlap.map(u=>u.at+Math.max(0,shot.start-u.from)))):undefined};});
 const avg=mean(docs.map(d=>d.length))||1,df=new Map<string,number>();for(const d of docs)for(const t of new Set(d.tf.keys()))df.set(t,(df.get(t)??0)+1);
 return docs.filter(d=>{
  if(q.assetIds?.length&&!q.assetIds.includes(d.shot.assetId))return false;
  if(q.steady&&d.shot.labels.some(l=>l==='shaky'||l==='handheld'))return false;
  if(q.light==='dark'&&!d.shot.labels.includes('dark')||q.light==='bright'&&!d.shot.labels.includes('bright')||q.light==='normal'&&d.shot.labels.some(l=>l==='dark'||l==='bright'))return false;
  if(q.speech!==undefined&&(!!d.words)!==q.speech)return false;
  if(q.unused&&d.usedAt!==undefined)return false;
  if(q.minSec&&d.shot.end-d.shot.start<q.minSec&&d.shot.end>d.shot.start)return false;
  for(const t of excluded)if(d.tf.has(t))return false;
  return true;
 }).map(d=>{let score=0;for(const t of include){const f=d.tf.get(t)??0;if(!f)continue;const idf=Math.log(1+(docs.length-(df.get(t)??0)+.5)/((df.get(t)??0)+.5));score+=idf*f*2.2/(f+1.2*(.4+.6*d.length/avg));}
  return{shot:d.shot,score,words:d.words,usedAt:d.usedAt};})
  .filter(h=>!include.length||h.score>0).sort((a,b)=>include.length?b.score-a.score:a.shot.assetId===b.shot.assetId?a.shot.start-b.shot.start:0);
}
/** What the index knows about a source range used in the edit, as one line: what its main shot shows, the labels of the shots that make up a fair share
 * of it, its worst shake, and any camera cut inside it (seconds into the clip, at its speed). Undefined when the range has no
 * indexed shots. */
export function rangeFacts(index:ShotIndex,srcIn:number,srcOut:number,speed=1){
 const shots=index.shots.filter(s=>s.end>srcIn&&s.start<srcOut);if(!shots.length)return undefined;
 const share=Math.min(.5,(srcOut-srcIn)*.4),main=shots.filter(s=>Math.min(s.end,srcOut)-Math.max(s.start,srcIn)>=share||shots.length===1);
 const labels=[...new Set((main.length?main:shots).flatMap(s=>s.labels))],shake=Math.max(...shots.map(s=>s.facts.shake));
 const cuts=shots.filter(s=>s.cutIn&&s.start>srcIn+.1&&s.start<srcOut-.1).map(s=>r2((s.start-srcIn)/(speed||1)));
 const longest=[...shots].sort((a,b)=>(Math.min(b.end,srcOut)-Math.max(b.start,srcIn))-(Math.min(a.end,srcOut)-Math.max(a.start,srcIn)))[0];
 return[...(longest.what?[`"${longest.what}"`]:[]),labels.join(', ')||'no notable facts',`shake ${r2(shake)}`,...(cuts.length?[`camera cut inside, ${cuts.join('s and ')}s in`]:[])].join('; ');
}
/** One result as one line: where it is, what happens, any text on screen, the measured facts, what is said, and where the edit uses it. */
export function shotLine(hit:ShotHit,n:number,filename?:string){
 const s=hit.shot,length=s.end>s.start?` (${r2(s.end-s.start)}s)`:'';
 return[`${n}. ${s.assetId}${filename?` ${filename}`:''} ${s.end>s.start?`${s.start}-${s.end}s`:'image'}${length}`,s.what??'(not described yet)',...(s.text?[`on screen "${s.text}"`]:[]),s.labels.join(', ')||'-',...(hit.words?[`says "${hit.words.slice(0,90)}${hit.words.length>90?'…':''}"`]:[]),...(hit.usedAt!==undefined?[`in the edit at ${hit.usedAt}s`]:[])].join(' | ');
}
