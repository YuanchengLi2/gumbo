import {Input,BlobSource,ALL_FORMATS,EncodedPacketSink,EncodedVideoPacketSource,EncodedAudioPacketSource,Output,Mp4OutputFormat,MovOutputFormat,StreamTarget} from 'mediabunny';
import {resolve} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {ExportSettingsSchema,outputSize,audioExtension,safeName,type ExportSettings} from '../../../desktop/src/main/export-settings';
import {fileAt,writable,exists,remove,grantFolder} from '../project/media/paths';
import type {SoundRequest} from '../export/sound';
import {publish} from './events';

/** The desktop main process's half of an export (main/engine-export.ts), in the page. The editor draws and encodes the
 * video with the engine (renderer/engine/export.ts, unchanged) and hands it over in pieces, written to a file in this
 * browser's storage; meanwhile the sound worker mixes and levels the sound. Finishing joins the two without re-encoding
 * either, with the index at the front so the file starts playing at once, checks its length, and saves it: into a folder
 * the user chose, or into the project's Exports and then to the computer's Downloads. */
type Job={id:string;state:ProjectState;settings:ExportSettings;videoPath?:string;audioPath?:string;temp?:string;out?:FileSystemWritableFileStream;
 workDir:string;sound?:Promise<boolean>;abort:AbortController};
let job:Job|undefined;
let worker:Worker|undefined;const answers=new Map<string,{resolve:(v:boolean)=>void;reject:(e:Error)=>void}>();
/** Mixes the sound in the worker; cancelled with the export. */
function sound(request:SoundRequest,signal:AbortSignal){
 worker??=new Worker(new URL('../export/sound.worker.ts',import.meta.url),{type:'module',name:'gumbo-sound'});
 worker.onmessage=({data})=>{const a=answers.get(data.id);answers.delete(data.id);if(a)data.error?a.reject(new Error(data.error)):a.resolve(data.result);};
 const id=crypto.randomUUID();signal.addEventListener('abort',()=>worker?.postMessage({cancel:id}),{once:true});
 return new Promise<boolean>((resolve,reject)=>{answers.set(id,{resolve,reject});worker!.postMessage({id,request});});
}
/** name.ext in the folder, or "name (2).ext" and so on, so an export never overwrites another (export-settings exportPath). */
async function freePath(folder:string,name:string,extension:string){for(let n=1;;n++){const path=`${folder}/${safeName(name)}${n>1?` (${n})`:''}.${extension}`;if(!await exists(path))return path;}}
const inStorage=(path:string)=>!path.startsWith('/granted/');

export async function beginExport(raw:unknown,state:ProjectState){
 const settings=ExportSettingsSchema.parse(raw);if(job)throw new Error('An export is already running.');
 if(resolve(state.timeline,state.footage).durationSec<=0)throw new Error('Add footage to the timeline before exporting.');
 const missing=state.footage.assets.filter(a=>a.missing&&(state.timeline.spine.some(c=>c.assetId===a.id)||state.timeline.attached.some(i=>i.source?.assetId===a.id)||state.timeline.music.some(m=>m.assetId===a.id)));if(missing.length)throw new Error(`Relink ${missing.map(a=>a.filename).join(', ')} for an original-quality export.`);
 // Exports go to the project's own Exports or to a folder the user granted, never elsewhere in this site's storage.
 const own=`${state.meta.folder}/Exports`,folder=(settings.folder??own).replace(/[\\/]+$/,'');if(folder!==own&&!folder.startsWith('/granted/'))throw new Error('Choose a folder to export to.');
 const id=crypto.randomUUID(),next:Job={id,state,settings,workDir:`/tmp/export-${id}`,abort:new AbortController()};
 if(settings.video){next.videoPath=await freePath(folder,settings.name||state.meta.name,settings.format);next.temp=`${next.workDir}/video.${settings.format}`;next.out=await writable(next.temp);}
 if(settings.audio)next.audioPath=await freePath(folder,settings.name||state.meta.name,audioExtension(settings));
 // The sound is mixed while the picture renders; it needs little of what the picture uses.
 if(next.videoPath){next.sound=sound({timeline:state.timeline,footage:state.footage,output:`${next.workDir}/sound.m4a`,format:'aac',workDir:next.workDir},next.abort.signal);next.sound.catch(()=>{});}
 job=next;
 const {width,height,fps}=state.timeline.settings,size=outputSize(settings,width,height);
 return{id,video:next.videoPath?{...size,fps:settings.fps==='source'?fps:settings.fps,codec:settings.codec,quality:settings.quality,container:settings.format}:undefined};
}
export async function exportChunk(id:string,position:number,data:Uint8Array){if(job?.id!==id||!job.out)throw new Error('This export is not running.');await job.out.write({type:'write',position,data:data as Uint8Array<ArrayBuffer>});}

/** The picture and the sound in one file, their packets copied as they are, interleaved by time. */
async function join(video:string,audio:string|undefined,output:string,format:'mp4'|'mov',signal:AbortSignal){
 const inputs=[new Input({source:new BlobSource(await fileAt(video)),formats:ALL_FORMATS}),...(audio?[new Input({source:new BlobSource(await fileAt(audio)),formats:ALL_FORMATS})]:[])];
 const target=await writable(output);
 try{
  const picture=await inputs[0].getPrimaryVideoTrack(),sound=await inputs[1]?.getPrimaryAudioTrack();if(!picture)throw new Error('The drawn video has no picture.');
  // The index is reserved at the front, sized by the packets each track has.
  const out=new Output({format:format==='mov'?new MovOutputFormat({fastStart:'reserve'}):new Mp4OutputFormat({fastStart:'reserve'}),target:new StreamTarget(target as unknown as WritableStream<any>,{chunked:true})});
  const videoSource=new EncodedVideoPacketSource(picture.codec!);out.addVideoTrack(videoSource,{maximumPacketCount:(await picture.computePacketStats()).packetCount});
  const audioSource=sound?new EncodedAudioPacketSource(sound.codec!):undefined;if(sound&&audioSource)out.addAudioTrack(audioSource,{maximumPacketCount:(await sound.computePacketStats()).packetCount});
  await out.start();
  try{
   const videoMeta={decoderConfig:(await picture.getDecoderConfig())!},audioMeta=sound?{decoderConfig:(await sound.getDecoderConfig())!}:undefined;
   const audioPackets=sound?new EncodedPacketSink(sound).packets():undefined;let pending=await audioPackets?.next(),firstAudio=true,firstVideo=true;
   const flush=async(until:number)=>{while(pending&&!pending.done&&pending.value.timestamp<=until){await audioSource!.add(pending.value,firstAudio?audioMeta:undefined);firstAudio=false;pending=await audioPackets!.next();}};
   for await(const packet of new EncodedPacketSink(picture).packets()){signal.throwIfAborted();await flush(packet.timestamp);await videoSource.add(packet,firstVideo?videoMeta:undefined);firstVideo=false;}
   await flush(Infinity);videoSource.close();audioSource?.close();await out.finalize();
  }catch(error){await out.cancel().catch(()=>{});throw error;}
 }finally{for(const input of inputs)input.dispose?.();}
}
async function duration(path:string){const input=new Input({source:new BlobSource(await fileAt(path)),formats:ALL_FORMATS});try{return await input.computeDuration();}finally{input.dispose?.();}}
/** A file from this site's storage to the computer's Downloads. */
export async function download(path:string){const url=URL.createObjectURL(await fileAt(path)),a=document.createElement('a');a.href=url;a.download=path.split('/').pop()!;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);}

export async function finishExport(id:string,timing?:unknown){
 const current=job;if(current?.id!==id)throw new Error('This export is not running.');const {abort,state,settings}=current,written:string[]=[],began=performance.now();
 try{
  if(current.videoPath&&current.temp){
   await current.out?.close();current.out=undefined;
   publish('export.progress',{status:'rendering',progress:1,phase:'Adding the sound'});const hasSound=await current.sound;
   await join(current.temp,hasSound?`${current.workDir}/sound.m4a`:undefined,current.videoPath,settings.format,abort.signal);written.push(current.videoPath);
   const expected=resolve(state.timeline,state.footage).durationSec,actual=await duration(current.videoPath);
   if(!(Math.abs(actual-expected)<=Math.max(.1,2/state.timeline.settings.fps)))throw new Error(`The saved video is ${actual.toFixed(2)} s long instead of ${expected.toFixed(2)} s.`);
  }
  if(current.audioPath){publish('export.progress',{status:'rendering',progress:1,phase:'Saving the audio'});
   if(await sound({timeline:state.timeline,footage:state.footage,output:current.audioPath,format:settings.audioFormat,workDir:current.workDir},abort.signal))written.push(current.audioPath);
   else if(!current.videoPath)throw new Error('This edit has no sound to export.');}
  console.info('[export]',{project:state.meta.name,paths:written,settings,finishMs:Math.round(performance.now()-began),render:timing});
  // What was saved in this site's storage also goes to the computer's Downloads, where people look for an export.
  for(const path of written)if(inStorage(path))await download(path);
  publish('export.progress',{status:'completed',progress:1,path:written[0],paths:written});return{path:written[0],paths:written};
 }catch(error){for(const path of written)await remove(path).catch(()=>{});publish('export.progress',{status:abort.signal.aborted?'cancelled':'failed',progress:0,error:(error as Error).message});throw error;}
 finally{await cleanup(current);}
}
async function cleanup(ended:Job){if(job===ended)job=undefined;await ended.out?.abort().catch(()=>{});ended.out=undefined;await remove(ended.workDir).catch(()=>{});}
function stop(status:'cancelled'|'failed',message:string){const ended=job;if(!ended)return;job=undefined;ended.abort.abort();void (ended.sound??Promise.resolve()).catch(()=>{}).finally(()=>cleanup(ended));publish('export.progress',{status,progress:0,...(status==='failed'?{error:message}:{})});}
export const cancelExport=()=>stop('cancelled','The export was cancelled.');
/** The editor could not draw the video (a clip it cannot decode): the export stops with its reason. */
export function failExport(id:string,message:string){if(job?.id===id)stop('failed',String(message||'The video could not be drawn.').slice(0,2000));}

/** A folder on the computer to export into, kept for later exports (the desktop's folder dialog). */
export async function pickExportFolder(){
 try{const handle=await (window as any).showDirectoryPicker({id:'gumbo-exports',mode:'readwrite',startIn:'videos'}) as FileSystemDirectoryHandle;return grantFolder(handle);}
 catch(error){if((error as DOMException).name==='AbortError')return null;throw error;}
}
/** "Show in folder": an export kept in this site's storage is downloaded again; one in the user's own folder is already there. */
export async function reveal(path:string){if(typeof path==='string'&&inStorage(path)&&await exists(path))await download(path);}
