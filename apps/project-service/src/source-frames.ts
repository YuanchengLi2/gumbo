import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import type {ProjectDB} from '@dream/project-db';
import {AssetSchema,InspectFootageSchema,type SourceFrames,type SourceInspector} from '@dream/footage';
import {hydrateAsset} from '../../../packages/project-db/src/paths';
import {keyframeOverview} from './keyframe-context';

export function frameTimes(start:number,end:number,fps:number,detail:'normal'|'motion'|'overview'|'preview',image=false,sourceDuration=end){
 if(image)return[0];const rate=Math.max(1,fps),first=Math.ceil(start*rate-1e-7),last=Math.max(first,end>=sourceDuration-1e-6?Math.ceil(end*rate)-1:Math.floor(end*rate+1e-7)),interval=detail==='motion'?.25:.5;
 if(detail==='preview'){const count=Math.min(12,Math.max(1,Math.ceil((end-start)/2)));return Array.from({length:count},(_,n)=>Math.floor((start+(end-start)*(n+.5)/count)*rate)/rate);}
 if(first===last)return[first/rate];const count=Math.min(16,Math.max(2,Math.ceil((last-first)/rate/interval)+1));
 return [...new Set(Array.from({length:count},(_,n)=>Math.round(first+(last-first)*n/(count-1))/rate))];
}
// A still image has one frame, and seeking into it (even -ss 0) skips that frame, so ffmpeg wrote nothing and every .jpg the
// agent's code made "could not be decoded". Stills and the very start are read without a seek.
const still=/\.(?:png|jpe?g|webp|bmp|gif|tiff?)$/i;
/** A frame as JPEG. A time at or just past the last frame decodes nothing (the stream ends before it), so a frame that
 * cannot be decoded is taken a quarter and then a whole second earlier: a look at the end of a clip shows its last
 * frames instead of failing (on October 18 such failures each cost the agent a step). */
export async function jpeg(ffmpeg:string,path:string,time:number,signal?:AbortSignal,max=768){
 let last:unknown;for(const at of [time,time-.25,time-1]){if(at<0&&at!==time)break;try{return await jpegAt(ffmpeg,path,Math.max(0,at),signal,max);}catch(error){if(signal?.aborted||/timed out/.test((error as Error).message))throw error;last=error;}}
 throw last;
}
// A look at three 4K clips asks for nine frames at once. Each seek decodes from the previous keyframe, about 7.5 s on one
// thread for 4K H.264, so nine single-threaded decodes beside proxy encoding ran past the 30 s limit and every frame
// "could not be decoded" (October 20). Decodes now queue, a few at a time with two threads each, and the limit counts only
// from a decode's start.
const DECODES=3;let decoding=0;const waiting:(()=>void)[]=[];
function decodeSlot(signal?:AbortSignal){if(decoding<DECODES){decoding++;return Promise.resolve();}return new Promise<void>((resolve,reject)=>{const go=()=>{signal?.removeEventListener('abort',cancel);decoding++;resolve();};const cancel=()=>{const at=waiting.indexOf(go);if(at>=0)waiting.splice(at,1);reject(new DOMException('Source inspection canceled','AbortError'));};waiting.push(go);signal?.addEventListener('abort',cancel,{once:true});});}
function decodeDone(){decoding--;waiting.shift()?.();}
async function jpegAt(ffmpeg:string,path:string,time:number,signal?:AbortSignal,max=768){await decodeSlot(signal);try{return await new Promise<Buffer>((resolve,reject)=>{
 const seek=time>.001&&!still.test(path)?['-ss',String(time-.001)]:[];
 const child=spawn(ffmpeg,['-v','error','-threads','2',...seek,'-i',path,'-frames:v','1','-vf',`scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease`,'-threads','1','-q:v','4','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,signal});let size=0;const chunks:Buffer[]=[];let error='',timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;child.kill();},60000);child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>3_000_000)child.kill();else chunks.push(chunk);});child.stderr.on('data',chunk=>error=(error+chunk.toString()).slice(-1200));child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);const bytes=Buffer.concat(chunks);if(signal?.aborted)reject(new DOMException('Source inspection canceled','AbortError'));else if(timedOut)reject(new Error('Reading this source frame timed out (a very large source or a busy computer); try fewer times at once.'));else if(code||bytes.length<4||bytes[0]!==255||bytes[1]!==216)reject(new Error('Source frame could not be decoded. '+error));else resolve(bytes);});
});}finally{decodeDone();}}
export function sourceInspector(db:ProjectDB,ffmpeg:string,authorize?:(paths:string[],signal?:AbortSignal)=>Promise<void>):SourceInspector{const inflight=new Map<string,{promise:Promise<SourceFrames>;controller:AbortController;users:number}>();const inspect:SourceInspector=async(raw,signal)=>{
 const request=InspectFootageSchema.parse(raw),row=db.db.prepare('SELECT json FROM assets WHERE id=?').get(request.assetId) as {json:string}|undefined;if(!row)throw new Error('Source asset is not in this project.');
 const asset=hydrateAsset(AssetSchema.parse(JSON.parse(row.json)),db.folder);if(asset.kind==='audio'||asset.sequence)throw new Error('Inspect an imported video or image; use preview_frames for generated timeline scenes.');
 // A project-owned playback copy is valid source evidence and remains usable
 // after access to an older linked original is revoked or the original moves.
 const source=asset.proxyPath&&existsSync(asset.proxyPath)?asset.proxyPath:asset.originalPath;
 if(!existsSync(source))throw new Error('Relink the missing source before inspecting its visual evidence.');
 await authorize?.([source],signal);
 if(request.startSec>=asset.durationSec){const span=Math.max(.5,Math.min(request.endSec-request.startSec,asset.durationSec));request.startSec=Math.max(0,asset.durationSec-span);request.endSec=asset.durationSec;}
 if(request.detail==='preview'&&asset.kind==='video'){
  const endSec=Math.min(request.endSec,asset.durationSec),cacheKey='keyframes:v1:'+asset.fingerprint+':'+request.startSec+':'+endSec;
  const saved=db.getMeta(cacheKey);if(saved){const cached=JSON.parse(db.blobs.get(saved));if(cached.fingerprint===asset.fingerprint&&cached.frames?.length)return cached;}
  const frames=await keyframeOverview(ffmpeg,source,request.startSec,endSec,signal);
  // Long GOPs may expose only one keyframe even when the shot contains action.
  // Supplement those previews with actual middle/end frames rather than treating
  // the codec's keyframe spacing as evidence of static footage.
  if(frames.length<3&&endSec-request.startSec>2){const times=[...(frames.length?[]:[request.startSec]),request.startSec+(endSec-request.startSec)/2,Math.max(request.startSec,endSec-.2)];const extra=await Promise.allSettled(times.map(async timeSec=>{const bytes=await jpeg(ffmpeg,source,timeSec,signal);return{timeSec,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64'),mimeType:'image/jpeg' as const};}));signal?.throwIfAborted();frames.push(...extra.flatMap(result=>result.status==='fulfilled'?[result.value]:[]));frames.sort((a,b)=>a.timeSec-b.timeSec);}
  if(!frames.length)throw new Error('No preview frames could be decoded from this source.');
  const result:SourceFrames={assetId:asset.id,fingerprint:asset.fingerprint,startSec:request.startSec,endSec,sampleIntervalSec:0,frames,coverage:'Fast visual overview sampled across the requested source duration using encoded keyframes. Images carry actual source timestamps; they may precede requested seek points. This covers broad visual content, not every event or spoken word. Use normal/motion inspection to verify actions, text changes and precise cuts, and read_footage for speech.'};
  db.setMeta(cacheKey,db.blobs.put(JSON.stringify(result)));return result;
 }
 const end=Math.min(request.endSec,asset.durationSec),times=frameTimes(request.startSec,end,asset.fps,request.detail,asset.kind==='image',asset.durationSec),frames:SourceFrames['frames']=[];
 let next=0;
 await Promise.all(Array.from({length:Math.min(3,times.length)},async()=>{for(;;){const index=next++;if(index>=times.length)return;const timeSec=times[index];signal?.throwIfAborted();const key=`source-frame:v2:${asset.fingerprint}:${source===asset.proxyPath?'proxy':'original'}:${timeSec}`,saved=db.getMeta(key);let data:string;
  if(saved)data=db.blobs.get(saved);else{data=(await jpeg(ffmpeg,source,timeSec,signal)).toString('base64');db.setMeta(key,db.blobs.put(data));}
  frames[index]={timeSec,sha256:createHash('sha256').update(Buffer.from(data,'base64')).digest('hex'),data,mimeType:'image/jpeg'};
 }}));
 return{assetId:asset.id,fingerprint:asset.fingerprint,startSec:request.startSec,endSec:end,sampleIntervalSec:frames.length>1?(frames.at(-1)!.timeSec-frames[0].timeSec)/(frames.length-1):0,frames,coverage:'These are ordered sampled source frames, not continuous playback. Timestamps are requested source seek positions. Events between samples may be missed. No audio was listened to. Use a shorter motion-detail range to verify uncertain actions.'};
};
 return (raw,signal)=>{
  signal?.throwIfAborted();const request=InspectFootageSchema.parse(raw),row=db.db.prepare('SELECT json FROM assets WHERE id=?').get(request.assetId) as {json:string}|undefined;
  const key=JSON.stringify([request,row?JSON.parse(row.json).fingerprint:null]);let entry=inflight.get(key);
  if(!entry){const controller=new AbortController();entry={controller,users:0,promise:inspect(request,controller.signal).finally(()=>inflight.delete(key))};inflight.set(key,entry);}
  const shared=entry;shared.users++;
  return new Promise<SourceFrames>((resolve,reject)=>{let done=false;const finish=(error?:unknown,value?:SourceFrames)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);if(--shared.users===0)shared.controller.abort();error?reject(error):resolve(value!);};const abort=()=>finish(signal?.reason??new DOMException('Canceled','AbortError'));signal?.addEventListener('abort',abort,{once:true});shared.promise.then(value=>finish(undefined,value),error=>finish(error));});
 };
}
