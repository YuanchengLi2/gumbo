import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {SourceFrames} from '@dream/footage';

/** Seek using the container's keyframe index; never decode the intervening video. */
export function keyframe(ffmpeg:string,path:string,timeSec:number,signal?:AbortSignal):Promise<SourceFrames['frames'][number]>{
 return new Promise((resolve,reject)=>{
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','info','-threads','1','-skip_frame','nokey','-noaccurate_seek','-ss',String(timeSec),'-copyts','-i',path,'-an','-frames:v','1','-vf',"scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease,showinfo",'-threads','1','-fps_mode','passthrough','-f','image2pipe','-c:v','mjpeg','pipe:1'],{windowsHide:true,signal});
  const chunks:Buffer[]=[];let stderr='',size=0;const timer=setTimeout(()=>child.kill(),15000);
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>3_000_000)child.kill();else chunks.push(chunk);});child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-12000));
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);if(signal?.aborted){reject(new DOMException('Context canceled','AbortError'));return;}const bytes=Buffer.concat(chunks),match=/pts_time:([\d.eE+-]+)/.exec(stderr),actual=match?Number(match[1]):NaN;if(code!==0||bytes[0]!==255||bytes[1]!==216||!Number.isFinite(actual)){reject(new Error('Could not read a source keyframe: '+stderr.slice(-500)));return;}resolve({timeSec:Math.max(0,actual),sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64'),mimeType:'image/jpeg'});});
 });
}

const slots=6;let active=0;const waiters:(()=>void)[]=[];
async function bounded<T>(work:()=>Promise<T>,signal?:AbortSignal){signal?.throwIfAborted();if(active>=slots)await new Promise<void>((done,reject)=>{const next=()=>{signal?.removeEventListener('abort',abort);done();};const abort=()=>{const index=waiters.indexOf(next);if(index>=0)waiters.splice(index,1);reject(signal?.reason);};signal?.addEventListener('abort',abort,{once:true});waiters.push(next);});else active++;try{signal?.throwIfAborted();return await work();}finally{const next=waiters.shift();if(next)next();else active--;}}

export async function keyframeOverview(ffmpeg:string,path:string,startSec:number,endSec:number,signal?:AbortSignal){
 const count=Math.min(12,Math.max(1,Math.ceil((endSec-startSec)/2)));
 const results=await Promise.allSettled(Array.from({length:count},(_,i)=>bounded(()=>{signal?.throwIfAborted();return keyframe(ffmpeg,path,count===1?startSec:startSec+Math.max(0,endSec-startSec-.1)*i/(count-1),signal);},signal))); 
 // Preserve recurring images at different times: an A-B-A return can matter to a story.
 signal?.throwIfAborted();const frames=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
 return [...new Map(frames.map(f=>[f.timeSec,f])).values()].sort((a,b)=>a.timeSec-b.timeSec);
}
