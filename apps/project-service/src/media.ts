import {measureLoudness} from './loudness';
import {copyMedia,canPreviewOriginal,canRemuxForPreview,canPreviewAudio,playbackCapabilities,keyframeGap,PREVIEW_KEYFRAME_SEC,LONG_GOP_SEC} from './media-io';
import {setTimeout as wait} from 'node:timers/promises';
import {transcriptWords} from './transcript';
import {analyzeStage} from './analysis-client';
import {atomicArtifact} from './artifacts';
import {mediaFacts} from '../../../packages/footage/src/capture-time';
import {spawn} from 'node:child_process';import {createReadStream,existsSync,mkdirSync,writeFileSync,readFileSync,statSync,readdirSync,unlinkSync} from 'node:fs';import {join,basename,extname} from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {ProjectDB} from '@dream/project-db';import {AssetSchema,type Asset} from '@dream/footage';
export function run(exe:string,args:string[],signal?:AbortSignal):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,signal});let out='',err='';child.stdout.on('data',d=>{out+=d.toString();});child.stderr.on('data',d=>{err=(err+d.toString()).slice(-16000);});child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(`${basename(exe)} exited ${code}: ${err.slice(-1500)}`)));});}
export async function fingerprint(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
/** When the media was captured: the phone's own creation date (with its time zone), the container's creation time, EXIF for photos, else the file time. */
function captureTime(path:string,info:any):{capturedAt?:string;capturedAtSource?:'quicktime'|'mp4'|'exif'|'file'}{
 const tags=[info.format?.tags,...(info.streams??[]).map((s:any)=>s.tags)].filter(Boolean),find=(name:string)=>tags.map((t:any)=>Object.entries(t).find(([k])=>k.toLowerCase()===name)?.[1]).find(Boolean) as string|undefined;
 const apple=find('com.apple.quicktime.creationdate');if(apple){const date=new Date(apple.replace(/([+-]\d{2})(\d{2})$/,'$1:$2'));if(Number.isFinite(date.getTime()))return{capturedAt:date.toISOString(),capturedAtSource:'quicktime'};}
 const facts=mediaFacts(path);if(facts.capturedAt&&facts.capturedAtSource!=='file')return{capturedAt:facts.capturedAt,capturedAtSource:facts.capturedAtSource};
 const created=find('creation_time');if(created){const date=new Date(created);if(Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1995)return{capturedAt:date.toISOString(),capturedAtSource:'mp4'};}
 return facts.capturedAt?{capturedAt:facts.capturedAt,capturedAtSource:facts.capturedAtSource}:{};
}
/** The keyframe times in a source's first video stream over its first span seconds, read from packets without decoding. */
export async function keyframeTimes(path:string,ffprobe:string,span=60,signal?:AbortSignal){
 const out=await run(ffprobe,['-v','error','-select_streams','v:0','-read_intervals','%+'+span,'-show_entries','packet=pts_time,flags','-of','csv=p=0',path],signal);
 return out.split(/\r?\n/).map(line=>line.split(',')).filter(([,flags])=>flags?.startsWith('K')).map(([time])=>Number(time)).filter(Number.isFinite);
}
export async function probe(path:string,ffprobe:string){const info=JSON.parse(await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path]));const video=info.streams.find((s:any)=>s.codec_type==='video'),audio=info.streams.find((s:any)=>s.codec_type==='audio');const image=/\.(png|jpe?g|webp|bmp|heic|heif|avif|tiff?|dng)$/i.test(path);const rate=(video?.avg_frame_rate??'30/1').split('/').map(Number);return {kind:image?'image':video?'video':'audio',durationSec:image?5:Number(video?.duration??info.format.duration??audio?.duration??0),fps:video?rate[0]/(rate[1]||1)||30:0,width:video?.width??0,height:video?.height??0,hasAudio:!!audio,videoCodec:video?.codec_name,audioCodec:audio?.codec_name,rotation:Number(video?.side_data_list?.find((s:any)=>s.rotation)?.rotation??0),...captureTime(path,info)} as const;}
export class Ingest {
 private queue:{asset:Asset;step?:string}[]=[];
 private background:{asset:Asset;step?:string}[]=[];
 private preparing=new Map<string,AbortController>();private analyzing=new Map<string,AbortController>();private speeches=new Map<string,AbortController>();
 private idle:(()=>void)[]=[];private canceled=false;
 // Transcription runs for at most two sources at a time, so a bulk import does not flood the speech service.
 private speechQueue:Asset[]=[];
 // Preview copies are made one at a time, in their own queue, so a long encode never holds up another import's steps.
 private previewQueue:Asset[]=[];private previewing?:{id:string;controller:AbortController};
 private save(asset:Asset){asset.playback=playbackCapabilities(asset);const current=this.db.footage().assets.find(a=>a.id===asset.id);if(current?.understanding)asset.understanding=current.understanding;if(current?.context)asset.context=current.context;if(current?.license)asset.license=current.license;if(current?.previewPath&&!asset.previewPath)asset.previewPath=current.previewPath;this.db.saveAsset(asset);}
 constructor(private db:ProjectDB,private ffmpeg:string,private ffprobe:string,private publish:(type:string,payload:unknown)=>void,private onReady?:(asset:Asset)=>void,private authorize?:(paths:string[],signal?:AbortSignal)=>Promise<void>,private speech?:(asset:Asset,signal:AbortSignal)=>Promise<void>,private indexShots?:(asset:Asset)=>void){}
 recover(){this.canceled=false;const state=this.db.state();for(const asset of state.footage.assets){if(asset.sequence)continue;
  // Speech is transcribed (or a saved transcript fitted to its sound again, from saved chunks) for imports and for media
  // the agent made with code alike.
  if(!asset.missing&&asset.hasAudio&&!asset.generated&&(!state.jobs.some(j=>j.assetId===asset.id&&j.step==='transcription'&&j.status==='complete')||!this.db.getMeta('speech-fit:v1:'+asset.id)))this.startSpeech(asset);this.startPreview(asset);if(asset.creation)continue;if(!asset.missing&&(asset.status==='registered'||asset.status==='processing'||!asset.playback||!playbackCapabilities(asset).ready||asset.copyRequested||asset.fingerprint.startsWith('pending:')||state.jobs.some(j=>j.assetId===asset.id&&j.status==='interrupted'&&['proxy','playback_audio','copy','thumbnail','waveform'].includes(j.step))))this.queue.push({asset});}void this.drain();}
 async register(path:string,copy=false,requestKey?:string,signal?:AbortSignal,quiet=false){
  const assetId=requestKey?'a_'+createHash('sha256').update(requestKey).digest('hex').slice(0,24):`a_${randomUUID()}`;
  const existing=this.db.footage().assets.find(a=>a.id===assetId);if(existing){if(existing.status==='failed')this.retry(existing);return existing;}
  this.canceled=false;signal?.throwIfAborted();await this.authorize?.([path],signal);if(!existsSync(path))throw new Error('The selected source no longer exists.');
  const originalPath=path,info=statSync(path),fold=(p:string)=>process.platform==='win32'?p.toLowerCase():p;
  // The same unchanged file is imported once, whichever request brings it in again.
  const same=this.db.footage().assets.find(a=>a.source&&fold(a.source.path)===fold(path)&&a.source.size===info.size&&a.source.modifiedAt===info.mtime.toISOString()&&!a.missing);if(same){if(same.status==='failed')this.retry(same);return same;}
  const checksum='pending:'+createHash('sha256').update(JSON.stringify([assetId,info.size,info.mtimeMs])).digest('hex');
  // A container the browser cannot read (AVI, WMV, FLV) says so plainly, naming the file, instead of ffprobe's words.
  const meta=await probe(originalPath,this.ffprobe).catch(error=>{if(/unsupported or unrecognizable format/i.test((error as Error).message))throw new Error(`${basename(path)} is in a format Gumbo can't open in the browser yet (${(extname(path).slice(1)||'unknown').toUpperCase()}). Save it as an MP4 or MOV and add it again.`);throw error;});signal?.throwIfAborted();const asset=AssetSchema.parse({id:assetId,filename:basename(path),originalPath,...meta,contentType:meta.kind==='video'?'mixed':'broll',status:'registered',missing:false,waveform:[],fingerprint:checksum,copyRequested:copy,source:{path,size:info.size,modifiedAt:info.mtime.toISOString()},playback:{ready:canPreviewOriginal({...meta,originalPath}),video:canPreviewOriginal({...meta,originalPath})?'original':'proxy'}});asset.playback=playbackCapabilities(asset);this.db.saveAsset(asset);this.startSpeech(asset);if(asset.playback?.ready)this.onReady?.(asset);this.queue.push({asset});if(!quiet)this.publish('state',this.db.state({bounded:true}));void this.drain();return asset;
 }
 /** Registers many files, four at a time, with one state update at the end. Preparation (proxies, thumbnails, speech) continues in the background. */
 async registerMany(paths:string[],copy:(path:string)=>boolean,requestKey:string,signal?:AbortSignal){
  const results:({asset:Asset}|{path:string;error:string})[]=new Array(paths.length);let next=0;
  const worker=async()=>{for(;;){const n=next++;if(n>=paths.length)return;signal?.throwIfAborted();try{results[n]={asset:await this.register(paths[n],copy(paths[n]),`${requestKey}:${n}`,signal,true)};}catch(error){signal?.throwIfAborted();results[n]={path:paths[n],error:(error as Error).message};}}};
  try{await Promise.all(Array.from({length:Math.min(4,paths.length)},worker));}finally{this.publish('state',this.db.state({bounded:true}));}
  return results;
 }
 private startSpeech(asset:Asset){
  // Media the agent made with code (a cleaned-up narration, a downloaded clip) is transcribed like an import, so captions and
  // cuts can follow its speech; synthesized scores and sound effects are not.
  if(!this.speech||!asset.hasAudio||asset.sequence||asset.generated||asset.durationSec<=0||this.speeches.has(asset.id))return;
  // Clips under two seconds rarely carry usable speech and are not sent for transcription.
  if(asset.durationSec<2){this.db.job(asset.id,'transcription','complete',100);this.db.setMeta('speech-fit:v1:'+asset.id,'1');return;}
  if(this.speeches.size>=2){if(!this.speechQueue.some(a=>a.id===asset.id)){this.speechQueue.push(asset);this.db.job(asset.id,'transcription','queued');}return;}
  const controller=new AbortController();this.speeches.set(asset.id,controller);this.db.job(asset.id,'transcription','running');
  void (async()=>{await this.authorize?.([asset.originalPath],controller.signal);await this.speech!({...asset},controller.signal);controller.signal.throwIfAborted();this.db.job(asset.id,'transcription','complete',100);})().catch(error=>{this.db.job(asset.id,'transcription',controller.signal.aborted?'interrupted':'failed',0,(error as Error).message);}).finally(()=>{this.speeches.delete(asset.id);const queued=this.speechQueue.shift();if(queued)this.startSpeech(queued);this.publish('state',this.db.state({bounded:true}));void this.drain();});
 }
 /** A preview copy of video whose keyframes lie far apart (phone footage often has one every few seconds): a keyframe
  * every half second and at most 1080p, so the preview player can show a cut into the middle of a clip at once instead of
  * decoding seconds of video first. Only the preview plays it; export and the agent's frames decode the original. It is
  * made after the source is settled (copied and fingerprinted), once per fingerprint, and footage that already seeks
  * quickly gets none. */
 private startPreview(asset:Asset){
  if(asset.kind!=='video'||asset.missing||asset.sequence||asset.scene||asset.copyRequested||asset.fingerprint.startsWith('pending:')||asset.durationSec<=0)return;
  const key=`stage:${asset.id}:preview_proxy`,identity=`preview-1:${asset.fingerprint}`,folder=join(this.db.folder,'Media/Proxies'),target=join(folder,`${asset.id}-preview-v1.mp4`);
  // Made already; a save of the asset from an older copy that dropped the field gets it back.
  if(this.db.getMeta(key)===identity){if(!asset.previewPath&&existsSync(target)){const current=this.db.footage().assets.find(a=>a.id===asset.id);if(current&&!current.previewPath)this.save({...current,previewPath:target});}return;}
  if(this.previewing){if(this.previewing.id!==asset.id&&!this.previewQueue.some(a=>a.id===asset.id))this.previewQueue.push(asset);return;}
  const controller=new AbortController(),signal=controller.signal;this.previewing={id:asset.id,controller};
  void (async()=>{
   await this.authorize?.([asset.originalPath,...(asset.proxyPath?[asset.proxyPath]:[])],signal);
   const playing=asset.proxyPath&&existsSync(asset.proxyPath)?asset.proxyPath:asset.originalPath,span=Math.min(asset.durationSec,60);
   let previewPath:string|undefined;
   if(keyframeGap(await keyframeTimes(playing,this.ffprobe,60,signal),span)>LONG_GOP_SEC){
    this.db.job(asset.id,'preview_proxy','running');
    const every=PREVIEW_KEYFRAME_SEC,frames=String(Math.max(1,Math.round((asset.fps||30)*every)));
    mkdirSync(folder,{recursive:true});
    // A preview cut short when the app closed leaves its partial file behind (one is made at a time, so none is in use).
    for(const name of readdirSync(folder))if(name.startsWith(`.${asset.id}-preview-v1.`)&&name.endsWith('.partial.mp4'))try{unlinkSync(join(folder,name));}catch{}
    await atomicArtifact(target,async temporary=>{await run(this.ffmpeg,['-y','-i',asset.originalPath,'-map','0:v:0','-an','-sn','-dn',
     '-vf',"scale=w='trunc(iw*min(1,1080/min(iw,ih))/2)*2':h='trunc(ih*min(1,1080/min(iw,ih))/2)*2'",
     '-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-g',frames,'-keyint_min',frames,'-force_key_frames',`expr:gte(t,n_forced*${every})`,
     '-fps_mode','passthrough','-movflags','+faststart',temporary],signal);},async temporary=>{await probe(temporary,this.ffprobe);});
    signal.throwIfAborted();previewPath=target;
   }
   const current=this.db.footage().assets.find(a=>a.id===asset.id);if(!current)return;
   if(previewPath)this.save({...current,previewPath});this.db.setMeta(key,identity);this.db.job(asset.id,'preview_proxy','complete',100);
  })().catch(error=>{if(this.db.footage().assets.some(a=>a.id===asset.id))this.db.job(asset.id,'preview_proxy',signal.aborted?'interrupted':'failed',0,(error as Error).message);})
   .finally(()=>{this.previewing=undefined;const next=this.previewQueue.shift();if(next&&!this.canceled)this.startPreview(next);this.publish('state',this.db.state({bounded:true}));void this.drain();});
 }
 async waitUntilUsable(ids:string[],signal:AbortSignal){
  const assets=this.db.db.prepare('SELECT json FROM assets WHERE id=?'),jobs=this.db.db.prepare('SELECT step,status,error FROM jobs WHERE asset_id=?');
  for(;;){signal.throwIfAborted();let ready=true;for(const id of ids){const row=assets.get(id) as {json:string}|undefined;if(!row)throw new Error('Imported media is missing.');const asset=AssetSchema.parse(JSON.parse(row.json));if(asset.playback?.ready)continue;const required=[...(asset.kind==='video'&&asset.playback?.video!=='original'?['proxy']:[]),...(asset.hasAudio?['playback_audio']:[])];const states=jobs.all(id) as {step:string;status:string;error?:string}[];if(asset.status==='failed')throw new Error(states.find(j=>j.step==='analysis')?.error??'Media preparation failed.');for(const step of required){const job=states.find(j=>j.step===step);if(job?.status==='failed')throw new Error(job.error??`Could not prepare ${asset.filename}.`);if(job?.status!=='complete')ready=false;}}if(ready)return;await wait(100,undefined,{signal});}
 }
 /** Starts or resumes transcription and waits until it is complete or, while it runs, until enough() says the part being
  * read is there (it is saved chunk by chunk), for at most 45 seconds: the caller works with what has arrived. */
 async ensureTranscript(assetId:string,signal:AbortSignal,enough:()=>boolean=()=>false){
  const asset=this.db.footage().assets.find(a=>a.id===assetId);if(!asset?.hasAudio)throw new Error('This media has no audio track.');
  const job=()=>this.db.state().jobs.find(j=>j.assetId===assetId&&j.step==='transcription');
  if(job()?.status==='complete')return;
  if(!this.speech)throw new Error('Transcription is unavailable.');
  this.startSpeech(asset);
  const deadline=Date.now()+45000;
  for(;;){signal.throwIfAborted();const current=job();if(current?.status==='complete'||enough()||Date.now()>deadline)return;if(current&&['failed','interrupted'].includes(current.status))throw new Error(current.error??'Transcription could not finish.');await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},200);const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});});}
 }
 modelsChanged(){if(!process.env.DREAM_WHISPER_MODEL)return;const state=this.db.state();for(const asset of state.footage.assets)if(state.jobs.some(j=>j.assetId===asset.id&&j.step==='transcription'&&j.status==='waiting_for_model'))this.retry(asset,'transcription');}
 retry(asset:Asset,step?:string){this.canceled=false;if(this.speech&&step==='transcription'){this.startSpeech(asset);return;}if(this.queue.some(a=>a.asset.id===asset.id)||this.background.some(a=>a.asset.id===asset.id)||this.preparing.has(asset.id)||this.analyzing.has(asset.id))return;asset.status='registered';this.db.saveAsset(asset);this.db.job(asset.id,'analysis','queued');this.queue.push({asset,step:step==='analysis'?undefined:step});void this.drain();}
 async cancel(){this.canceled=true;this.queue=[];this.background=[];this.previewQueue=[];for(const controller of [...this.preparing.values(),...this.analyzing.values(),...this.speeches.values(),...(this.previewing?[this.previewing.controller]:[])])controller.abort();await this.drain();}
 drain():Promise<void>{
  if(!this.canceled){
   while(this.queue.length&&this.preparing.size<2){const task=this.queue.shift()!,controller=new AbortController();this.preparing.set(task.asset.id,controller);
    void this.analyze(task.asset,controller.signal,task.step,false).then(()=>{if(!this.canceled)this.background.push(task);}).catch(error=>{task.asset.status=controller.signal.aborted?'registered':'failed';this.save(task.asset);this.db.job(task.asset.id,'analysis',controller.signal.aborted?'interrupted':'failed',0,(error as Error).message);}).finally(()=>{this.preparing.delete(task.asset.id);this.publish('state',this.db.state({bounded:true}));void this.drain();});
   }
   if(this.background.length&&!this.analyzing.size){const task=this.background.shift()!,controller=new AbortController();this.analyzing.set(task.asset.id,controller);
    void this.analyze(task.asset,controller.signal,task.step,true).catch(error=>{this.db.job(task.asset.id,'analysis',controller.signal.aborted?'interrupted':'failed',0,(error as Error).message);}).finally(()=>{this.analyzing.delete(task.asset.id);this.publish('state',this.db.state({bounded:true}));void this.drain();});
   }
  }
  if(!this.queue.length&&!this.background.length&&!this.preparing.size&&!this.analyzing.size&&!this.speeches.size&&!this.previewing){this.idle.splice(0).forEach(done=>done());return Promise.resolve();}
  return new Promise(done=>this.idle.push(done));
 }
 async analyze(a:Asset,signal:AbortSignal,requested?:string,background=false){
  await this.authorize?.([a.originalPath,...[a.proxyPath,a.audioPath,a.thumbnailPath].filter((p):p is string=>!!p)],signal);
  const dir=join(this.db.folder,'Media/Analysis',a.id);mkdirSync(dir,{recursive:true});
  if(background&&(a.copyRequested||a.fingerprint.startsWith('pending:'))){this.db.job(a.id,'copy','running');const target=a.copyRequested?join(this.db.folder,'Media/Originals',a.id+'-'+a.filename):a.originalPath;const previous=a.fingerprint;const hash=target!==a.originalPath?await copyMedia(a.originalPath,target,signal):await fingerprint(a.originalPath);a.originalPath=target;a.fingerprint=hash;a.copyRequested=false;const context=this.db.footage().assets.find(asset=>asset.id===a.id)?.context;if(context?.revision===previous){context.revision=hash;const current=this.db.footage().assets.find(asset=>asset.id===a.id)!;this.db.saveAsset({...current,context});}for(const stage of this.db.db.prepare('SELECT key,value FROM meta WHERE key LIKE ?').all('stage:'+a.id+':%') as {key:string;value:string}[])this.db.setMeta(stage.key,stage.value.replaceAll(previous,hash));this.save(a);this.db.job(a.id,'copy','complete',100);for(const row of this.db.db.prepare("SELECT key,value FROM meta WHERE key LIKE ?").all('keyframes:v1:'+previous+':%') as {key:string;value:string}[]){const data=JSON.parse(this.db.blobs.get(row.value));data.fingerprint=hash;this.db.setMeta(row.key.replace(previous,hash),this.db.blobs.put(JSON.stringify(data)));}}
  const jobs=new Map(this.db.state().jobs.filter(j=>j.assetId===a.id).map(j=>[j.step,j]));
  if(!background){a.status=a.playback?.ready?'ready':'processing';this.save(a);if(!a.videoCodec&&a.kind==='video')Object.assign(a,await probe(a.originalPath,this.ffprobe));}
  const publish=()=>this.publish('state',this.db.state());
  const revision=`dream-media-3:${a.fingerprint}`;
  const stage=async(name:string,execute:()=>Promise<void>,artifact?:string,backend='')=>{
   signal.throwIfAborted();const key=`stage:${a.id}:${name}`,identity=revision+backend;
   const complete=jobs.get(name)?.status==='complete'&&this.db.getMeta(key)===identity&&(!artifact||existsSync(artifact));
   if(complete&&requested!==name)return true;
   if(requested&&requested!==name&&!['proxy','thumbnail','playback_audio'].includes(name))return complete;
   this.db.job(a.id,name,'running');publish();
   try{await execute();signal.throwIfAborted();if(artifact)this.db.setMeta(`${key}:artifact`,JSON.stringify({sha256:await fingerprint(artifact),bytes:statSync(artifact).size,pipelineRevision:identity}));this.db.setMeta(key,identity);this.save(a);this.db.job(a.id,name,'complete',100);publish();return true;}
   catch(error){this.db.job(a.id,name,signal.aborted?'interrupted':'failed',0,(error as Error).message);publish();if(signal.aborted)throw error;return false;}
  };
  if(!background&&a.kind==='video'&&(!canPreviewOriginal(a)||requested==='proxy')){
   const proxy=join(this.db.folder,'Media/Proxies',`${a.id}-proxy-v2.mp4`);
   // A playable codec in another container is copied into an MP4 as it is (the sound made AAC); anything else, or a
   // copy that fails, is encoded again at 960 wide.
   const encode=(temporary:string)=>run(this.ffmpeg,['-y','-i',a.originalPath,'-vf',"scale=w='min(960,iw)':h=-2",'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',temporary],signal);
   const remux=(temporary:string)=>run(this.ffmpeg,['-y','-i',a.originalPath,'-map','0:v:0','-map','0:a:0?','-c:v','copy',...(a.videoCodec==='hevc'?['-tag:v','hvc1']:[]),'-c:a','aac','-b:a','192k','-movflags','+faststart',temporary],signal);
   const proxyReady=await stage('proxy',async()=>{await atomicArtifact(proxy,async temporary=>{if(canRemuxForPreview(a)){try{await remux(temporary);await probe(temporary,this.ffprobe);return;}catch(error){signal.throwIfAborted();}}await encode(temporary);},async temporary=>{await probe(temporary,this.ffprobe);});a.proxyPath=proxy;},proxy);if(!proxyReady)throw new Error('The video could not be prepared for playback.');
  }
  if(background&&a.kind!=='audio'){
   const thumbnail=join(dir,'thumbnail.jpg');
   await stage('thumbnail',async()=>{await atomicArtifact(thumbnail,async temporary=>{await run(this.ffmpeg,['-y',...(a.kind==='video'?['-ss',String(Math.min(1,a.durationSec/3))]:[]),'-i',a.proxyPath&&existsSync(a.proxyPath)?a.proxyPath:a.originalPath,'-frames:v','1','-vf','scale=480:-2',temporary],signal);});a.thumbnailPath=thumbnail;},thumbnail);
  }
  if(a.hasAudio){
   // Lossless FLAC, about half the size of the WAV it replaces, with the same samples, so sync and export are unchanged.
   const master=join(dir,'audio-v3.flac');
   const needsAudio=(!a.audioPath||!existsSync(a.audioPath)||requested==='playback_audio')&&(background||!canPreviewAudio(a)||requested==='playback_audio'),audioReady=!needsAudio?!!a.audioPath||canPreviewAudio(a):await stage('playback_audio',async()=>{await atomicArtifact(master,async temporary=>{await run(this.ffmpeg,['-y','-i',a.originalPath,'-vn','-af','aresample=async=1:first_pts=0,apad','-t',String(a.durationSec),'-ar','48000','-ac','2','-c:a','flac','-f','flac',temporary],signal);},async temporary=>{await probe(temporary,this.ffprobe);});a.audioPath=master;},master);
   if(!background&&!audioReady)throw new Error('The audio could not be prepared for playback.');
   if(background&&audioReady&&a.audioPath){
    await stage('waveform',async()=>{a.waveform=await this.waveform(master,a.durationSec,signal);});
    const whisper=process.env.DREAM_WHISPER_BINARY,model=process.env.DREAM_WHISPER_MODEL;
    if(!this.speech&&whisper&&model&&existsSync(whisper)&&existsSync(model)){
     const modelInfo=statSync(model),transcriptPath=join(dir,'transcript.json');
     await stage('transcription',async()=>{
      const speech=join(dir,'speech.wav');await atomicArtifact(speech,async temporary=>{await run(this.ffmpeg,['-y','-i',master,'-ar','16000','-ac','1',temporary],signal);});
      await atomicArtifact(transcriptPath,async temporary=>{await run(whisper,['-m',model,'-f',speech,'-ojf','-of',temporary.slice(0,-5),'-t','4'],signal);},async temporary=>{const result=JSON.parse(readFileSync(temporary,'utf8'));if(!Array.isArray(result.transcription))throw new Error('The speech worker returned an invalid transcript.');});
      this.db.replaceRecords('words',a.id,transcriptWords(a.id,JSON.parse(readFileSync(transcriptPath,'utf8')),a.durationSec));
     },transcriptPath,`:whisper-b5130:${modelInfo.size}:${modelInfo.mtimeMs}`);
    }else if(!this.speech)this.db.job(a.id,'transcription','waiting_for_model',0,'Install the Whisper runtime and model in Settings.');
   }
  }
  if(!background){a.status='ready';a.playback=playbackCapabilities(a);this.save(a);publish();if(!requested)this.onReady?.(a);return;}
  // Nothing here interprets the footage for the agent: it looks at frames and measures what it needs itself.
  // The footage index (shot-index.ts) is built in its own queue, so a long video's shots never hold up its other steps.
  if(a.kind!=='audio')this.indexShots?.(a);
  this.startPreview(a);
  if(a.hasAudio&&a.audioPath&&existsSync(a.audioPath))await stage('loudness',async()=>{a.loudnessLufs=await measureLoudness(this.ffmpeg,a.audioPath!,signal);},undefined,':loudness-1');
  const sidecar=process.env.DREAM_INGEST_BINARY;
  for(const name of requested==='audio_features'?['audio_features' as const]:[]){
   if(!sidecar||!existsSync(sidecar)){this.db.job(a.id,name,'waiting_for_runtime',0,'The local analysis runtime must be installed.');continue;}
   await stage(name,async()=>{if(name==='audio_features'&&!a.audioPath)throw new Error('Playback audio must finish before audio analysis.');const result=await analyzeStage(sidecar,name,a,name==='audio_features'?a.audioPath!:a.originalPath,dir,signal,{mediaPipelineRevision:'dream-media-3'});this.db.setMeta(`analysis:${a.id}:${name}`,JSON.stringify(result));});
  }
  a.status='ready';this.save(a);const unfinished=this.db.state().jobs.some(j=>j.assetId===a.id&&['copy','proxy','playback_audio','thumbnail','waveform','transcription'].includes(j.step)&&j.status!=='complete');this.db.job(a.id,'analysis',unfinished?'partial':'complete',unfinished?0:100);publish();
 }
 private waveform(path:string,duration:number,signal:AbortSignal){return new Promise<number[]>((resolve,reject)=>{
  const child=spawn(this.ffmpeg,['-v','error','-i',path,'-vn','-ar','1000','-ac','1','-f','s16le','pipe:1'],{windowsHide:true,signal});const result:number[]=[];let pending=Buffer.alloc(0),maximum=0,count=0;
  child.stdout.on('data',(data:Buffer)=>{const buffer=Buffer.concat([pending,data]);for(let i=0;i+1<buffer.length;i+=2){maximum=Math.max(maximum,Math.abs(buffer.readInt16LE(i)/32768));if(++count>=Math.max(1,Math.ceil(duration))){result.push(maximum);maximum=0;count=0;}}pending=buffer.length%2?buffer.subarray(-1):Buffer.alloc(0);});child.stderr.resume();child.on('error',reject);child.on('close',code=>{if(count)result.push(maximum);code===0?resolve(result):reject(new Error('Waveform extraction failed.'));});
 });}
}

