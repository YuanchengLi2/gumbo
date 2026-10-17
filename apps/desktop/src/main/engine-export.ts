import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,writeSync,closeSync,mkdirSync,rmSync,existsSync,unlinkSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {resolve} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {exportAudio} from './export-audio';
import {type ExportSettings,exportPath,outputSize,audioExtension} from './export-settings';
import {runtimePaths} from './resources';
import {logExport} from './crash-log';

/** The main process's half of an export. The window draws and encodes the video with the engine and streams it here;
 * meanwhile the sound is mixed and levelled from the same envelope the player uses. Finishing joins the two without
 * re-encoding either, with the index at the front so the file starts playing at once. */
type Job={id:string;startedAt:number;state:ProjectState;settings:ExportSettings;videoPath?:string;audioPath?:string;temp?:string;fd?:number;workDir:string;sound?:Promise<boolean>;abort:AbortController;publish:(type:string,payload:unknown)=>void;
 /** Settles when the export is saved, fails or is cancelled, for a caller in this process (the agent's export). */
 done:Promise<{path:string;paths:string[]}>;settle:{resolve:(result:{path:string;paths:string[]})=>void;reject:(error:Error)=>void}};
const jobs=new Map<string,Job>();
export const exportRunning=()=>jobs.size>0;

/** destination names the video file exactly (the agent's export, approved for that path); otherwise it is named in the
 * chosen folder without overwriting another export. */
export function beginExport(state:ProjectState,settings:ExportSettings,publish:Job['publish'],authorize?:(path:string)=>void,destination?:string){
 if(jobs.size)throw new Error('An export is already running.');const duration=resolve(state.timeline,state.footage).durationSec;if(duration<=0)throw new Error('Add footage to the timeline before exporting.');
 const missing=state.footage.assets.filter(a=>a.missing&&(state.timeline.spine.some(c=>c.assetId===a.id)||state.timeline.attached.some(i=>i.source?.assetId===a.id)||state.timeline.music.some(m=>m.assetId===a.id)));if(missing.length)throw new Error(`Relink ${missing.map(a=>a.filename).join(', ')} for an original-quality export.`);
 const folder=destination?dirname(destination):settings.folder||join(state.meta.folder,'Exports');mkdirSync(folder,{recursive:true});
 let settle!:Job['settle'];const done=new Promise<{path:string;paths:string[]}>((resolve,reject)=>{settle={resolve,reject};});done.catch(()=>{});
 const job:Job={id:randomUUID(),startedAt:Date.now(),state,settings,workDir:'',abort:new AbortController(),publish,done,settle};
 if(settings.video){job.videoPath=destination??exportPath(folder,settings.name||state.meta.name,settings.format);authorize?.(job.videoPath);job.temp=`${job.videoPath}.${job.id}.video.${settings.format}`;job.fd=openSync(job.temp,'w');}
 if(settings.audio){job.audioPath=exportPath(folder,settings.name||state.meta.name,audioExtension(settings));authorize?.(job.audioPath);}
 job.workDir=join(folder,`.gumbo-export-${job.id}`);mkdirSync(job.workDir,{recursive:true});
 const ffmpeg=runtimePaths().ffmpeg,input={ffmpeg,timeline:state.timeline,footage:state.footage,signal:job.abort.signal};
 // The sound is mixed while the picture renders; it needs little of what the picture uses.
 if(job.videoPath)job.sound=exportAudio({...input,workDir:join(job.workDir,'mix')},join(job.workDir,'sound.m4a'),'aac');
 jobs.set(job.id,job);
 const {width,height,fps}=state.timeline.settings,size=outputSize(settings,width,height);
 return{id:job.id,video:job.videoPath?{...size,fps:settings.fps==='source'?fps:settings.fps,codec:settings.codec,quality:settings.quality,container:settings.format}:undefined};
}
export function exportChunk(id:string,position:number,data:Uint8Array){const job=jobs.get(id);if(!job?.fd&&job?.fd!==0)throw new Error('This export is not running.');writeSync(job.fd,data,0,data.byteLength,position);}

function ffmpeg(args:string[],signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const child=spawn(runtimePaths().ffmpeg,args,{windowsHide:true,signal});let log='';child.stderr.on('data',c=>{log=(log+c).slice(-3000);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Saving the video failed: '+log.slice(-800))));});}
function probeDuration(path:string){return new Promise<number>((resolve,reject)=>{const child=spawn(runtimePaths().ffprobe,['-v','error','-show_entries','format=duration','-of','csv=p=0',path],{windowsHide:true});let out='';child.stdout.on('data',c=>out+=c);child.on('error',reject);child.on('close',()=>resolve(Number(out.trim())));});}

/** timing is the window's account of drawing the video (RenderTiming), logged with the time this half took to finish. */
export async function finishExport(id:string,timing?:unknown){
 const job=jobs.get(id);if(!job)throw new Error('This export is not running.');const {publish,abort}=job,written:string[]=[],finishing=Date.now();
 try{
  if(job.videoPath&&job.temp){
   if(job.fd!==undefined){closeSync(job.fd);job.fd=undefined;}
   publish('export.progress',{status:'rendering',progress:1,phase:'Adding the sound'});const sound=await job.sound,soundFile=join(job.workDir,'sound.m4a');
   const joined=`${job.videoPath}.${job.id}.joined.${job.settings.format}`;
   await ffmpeg(['-hide_banner','-v','error','-y','-i',job.temp,...(sound?['-i',soundFile]:[]),'-map','0:v',...(sound?['-map','1:a']:[]),'-c','copy','-movflags','+faststart','-f',job.settings.format,joined],abort.signal);
   const expected=resolve(job.state.timeline,job.state.footage).durationSec,actual=await probeDuration(joined);
   if(!(Math.abs(actual-expected)<=Math.max(.1,2/job.state.timeline.settings.fps)))throw new Error(`The saved video is ${actual.toFixed(2)} s long instead of ${expected.toFixed(2)} s.`);
   renameSync(joined,job.videoPath);written.push(job.videoPath);
  }
  if(job.audioPath){publish('export.progress',{status:'rendering',progress:1,phase:'Saving the audio'});
   if(!await exportAudio({ffmpeg:runtimePaths().ffmpeg,timeline:job.state.timeline,footage:job.state.footage,workDir:join(job.workDir,'audio'),signal:abort.signal},job.audioPath,job.settings.audioFormat)&&!job.videoPath)throw new Error('This edit has no sound to export.');
   if(existsSync(job.audioPath))written.push(job.audioPath);}
  const {width,height,fps}=job.state.timeline.settings,now=Date.now();
  logExport({project:job.state.meta.name,path:written[0],timeline:{width,height,fps,durationSec:resolve(job.state.timeline,job.state.footage).durationSec},settings:job.settings,totalMs:now-job.startedAt,finishMs:now-finishing,render:timing&&typeof timing==='object'?timing:undefined});
  publish('export.progress',{status:'completed',progress:1,path:written[0],paths:written});const result={path:written[0],paths:written};job.settle.resolve(result);return result;
 }catch(error){for(const path of written)if(existsSync(path))unlinkSync(path);publish('export.progress',{status:abort.signal.aborted?'cancelled':'failed',progress:0,error:(error as Error).message});job.settle.reject(error as Error);throw error;}
 finally{cleanup(job);}
}
function cleanup(job:Job){if(job.fd!==undefined){try{closeSync(job.fd);}catch{}job.fd=undefined;}for(const path of [job.temp]){if(path&&existsSync(path))rmSync(path,{force:true});}for(const f of [`${job.videoPath}.${job.id}.joined.${job.settings.format}`])if(existsSync(f))rmSync(f,{force:true});rmSync(job.workDir,{recursive:true,force:true});jobs.delete(job.id);}
export function cancelEngineExport(id?:string){for(const job of jobs.values())if(!id||job.id===id)stop(job,'cancelled','The export was cancelled.');}
/** The window could not draw the video (a clip it cannot decode, the window closing): the export stops with its reason. */
export function failEngineExport(id:string,message:string){const job=jobs.get(id);if(job)stop(job,'failed',message);}
function stop(job:Job,status:'cancelled'|'failed',message:string){jobs.delete(job.id);job.abort.abort();if(job.sound)void job.sound.catch(()=>{}).finally(()=>cleanup(job));else cleanup(job);job.publish('export.progress',{status,progress:0,...(status==='failed'?{error:message}:{})});job.settle.reject(new Error(message));}
/** Waits for an export begun here to be saved; rejects when it fails or is cancelled. */
export function exportDone(id:string){const job=jobs.get(id);if(!job)return Promise.reject(new Error('This export is not running.'));return job.done;}
