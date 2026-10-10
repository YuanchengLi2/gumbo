import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ProjectDB} from '@dream/project-db';
import {InspectFootageSchema,type SourceInspector,type SourceFrames,type Asset} from '@dream/footage';

type FrameResult={frames:{file:string;timeSec:number;selection:string}[];elapsedMs:number;cached:boolean};
function extract(request:Record<string,unknown>,signal?:AbortSignal):Promise<FrameResult>{
 const binary=process.env.DREAM_CONTEXT_BINARY,python=process.env.DREAM_CONTEXT_PYTHON,script=process.env.DREAM_CONTEXT_SCRIPT;
 const executable=binary&&existsSync(binary)?binary:python;
 if(!executable||(!binary&&(!script||!existsSync(script))))throw new Error('The fast media-context runtime is missing.');
 const args=executable===binary?[]:[script!];
 return new Promise((resolve,reject)=>{
  const env:NodeJS.ProcessEnv={NODE_ENV:'production',PYTHONUTF8:'1'};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(executable,args,{windowsHide:true,signal,env});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),45000);
  child.stdout.on('data',d=>stdout+=d.toString());child.stderr.on('data',d=>stderr=(stderr+d.toString()).slice(-2000));
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);if(signal?.aborted){reject(new DOMException('Media context canceled','AbortError'));return;}try{if(code!==0)throw new Error(stderr||'Media context extraction did not finish.');const response=JSON.parse(stdout.trim());if(response.error)throw new Error(response.error);resolve(response.result);}catch(error){reject(error);}});
  child.stdin.on('error',reject);child.stdin.end(JSON.stringify(request)+'\n');
 });
}

/** CRV supplies actual timestamped images. The editing Claude interprets them directly. */
export function quickSourceInspector(db:ProjectDB,ffmpeg:string,ffprobe:string,detail:SourceInspector,authorize?:(paths:string[],signal?:AbortSignal)=>Promise<void>):SourceInspector{
 const inflight=new Map<string,Promise<SourceFrames>>();
 return async(raw,signal)=>{
  const request=InspectFootageSchema.parse(raw);
  if(request.detail!=='overview')return detail(request,signal);
  const asset=db.footage().assets.find(a=>a.id===request.assetId);if(!asset)throw new Error('Source asset is not in this project.');
  if(asset.kind==='image')return detail({...request,endSec:Math.min(asset.durationSec,request.endSec),detail:'normal'},signal);
  if(asset.kind==='audio'||asset.scene||asset.sequence)throw new Error('Use transcripts for audio or preview_frames for generated scenes.');
  const source=asset.proxyPath&&existsSync(asset.proxyPath)?asset.proxyPath:asset.originalPath;
  await authorize?.([source],signal);signal?.throwIfAborted();
  if(!existsSync(source))throw new Error('Relink the missing video before requesting its context.');
  const endSec=Math.min(request.endSec,asset.durationSec);
  if(request.startSec>=endSec)throw new Error('The source range is outside this video.');
  const key=createHash('sha256').update(JSON.stringify(['crv-0.10.7-dream-1',asset.fingerprint,source===asset.proxyPath,request.startSec,endSec])).digest('hex');
  const cached=db.loadState<SourceFrames>('quick-context:'+key);if(cached)return cached;
  // Concurrent background preparation and the first edit share the same decode.
  const pending=inflight.get(key);if(pending)return pending;
  const task=(async()=>{
   const output=join(db.folder,'Media','Analysis',asset.id,'context',key);
   const result=await extract({source,output,ffmpeg,ffprobe,startSec:request.startSec,endSec,maxFrames:12,width:Math.min(512,Math.max(128,Math.round(512*asset.width/Math.max(1,asset.height))))},signal);
   signal?.throwIfAborted();
   const frames=result.frames.map(f=>{if(!/^frame-\d{2}\.jpg$/.test(f.file)||!Number.isFinite(f.timeSec)||f.timeSec<request.startSec-.05||f.timeSec>endSec+.05)throw new Error('Media context returned invalid frame metadata.');const bytes=readFileSync(join(output,f.file));return{timeSec:f.timeSec,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64'),mimeType:'image/jpeg' as const};});
   const value:SourceFrames={assetId:asset.id,fingerprint:asset.fingerprint,startSec:request.startSec,endSec,sampleIntervalSec:0,frames,coverage:'Scene-aware, deduplicated visual overview from claude-real-video. Each image has its actual source timestamp. This is sampled visual context, not exhaustive playback or an audio transcript. Repeated frames may be omitted; use inspect_footage with normal or motion detail for exact actions and cuts.'};
   db.saveState('quick-context:'+key,value);db.event('media.context',{assetId:asset.id,frames:frames.length,elapsedMs:result.elapsedMs,cached:result.cached});return value;
  })().finally(()=>inflight.delete(key));inflight.set(key,task);return task;
 };
}
