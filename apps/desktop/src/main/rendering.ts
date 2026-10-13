import {frameFormat,renderConcurrency} from './render-settings';
import {withExportLock} from './export-lock';
import {renderServer} from './render-server';
import {withWebGl,usesWebGl} from './gl-preflight';
import {normalizeLoudness} from './export-loudness';
import {exportNative,exportAudio,browserLayer} from './native-export';
import {type ExportSettings,exportPath,outputSize,audioExtension} from './export-settings';
import {app,dialog,BrowserWindow} from 'electron';import {randomUUID} from 'node:crypto';import {existsSync,renameSync,unlinkSync,rmSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {renderMedia,selectComposition,makeCancelSignal} from '@remotion/renderer';import {resolve} from '@dream/timeline';import type {ProjectState} from '@dream/project-db';import {runtimePaths,compositorDirectory} from './resources';import {spawn} from 'node:child_process';
let cancel:undefined|(()=>void);
async function exportProjectUnlocked(state:ProjectState,window:BrowserWindow,publish:(type:string,payload:unknown)=>void,authorize?:(path:string)=>void,options?:{destination?:string;signal?:AbortSignal;read?:(path:string)=>void;settings?:ExportSettings}){if(cancel)throw new Error('An export is already running.');options?.signal?.throwIfAborted();if(resolve(state.timeline,state.footage).durationInFrames<1)throw new Error('Add footage to the timeline before exporting.');const missing=state.footage.assets.filter(a=>a.missing&&(state.timeline.spine.some(c=>c.assetId===a.id)||state.timeline.attached.some(i=>i.source?.assetId===a.id)||state.timeline.music.some(m=>m.assetId===a.id)));if(missing.length)throw new Error(`Relink ${missing.map(a=>a.filename).join(', ')} for an original-quality export.`);const used=new Set([...state.timeline.spine.map(c=>c.assetId),...state.timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...state.timeline.music.map(m=>m.assetId)]);for(const asset of state.footage.assets)if(used.has(asset.id))options?.read?.(asset.originalPath);const settings=options?.settings,folder=settings?(settings.folder||join(state.meta.folder,'Exports')):'';if(settings)mkdirSync(folder,{recursive:true});
 const videoPath=settings?.video?exportPath(folder,settings.name||state.meta.name,settings.format):undefined,audioPath=settings?.audio?exportPath(folder,settings.name||state.meta.name,audioExtension(settings)):undefined;
 if(settings&&!settings.video)return exportSoundOnly(state,publish,audioPath!,settings,authorize,options);
 const picked=videoPath?{canceled:false,filePath:videoPath}:options?.destination?{canceled:false,filePath:options.destination}:await dialog.showSaveDialog(window,{title:'Export video',defaultPath:join(state.meta.folder,'Exports',`${state.meta.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,100)||'Figjam video'}.mp4`),filters:[{name:'MP4 video',extensions:['mp4']}]});if(picked.canceled||!picked.filePath)return null;authorize?.(picked.filePath);const destination=picked.filePath,temp=`${destination}.${randomUUID()}.tmp.${settings?.format??'mp4'}`;
 const {width,height,fps}=state.timeline.settings,size=settings?outputSize(settings,width,height):{width,height},video=settings?{...size,fps:settings.fps==='source'?fps:settings.fps,codec:settings.codec,quality:settings.quality}:undefined;
const server=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),options?.read,{engineRuntime:join(runtimePaths().staged,'engine')});const media=server.media;const paths=runtimePaths();const binariesDirectory=compositorDirectory();const {cancel:cancelBrowser,cancelSignal}=makeCancelSignal(),nativeAbort=new AbortController(),stop=()=>{cancelBrowser();nativeAbort.abort();};cancel=stop;options?.signal?.addEventListener('abort',stop,{once:true});try{
 const serveUrl=paths.renderBundle;if(!existsSync(join(serveUrl,'index.html')))throw new Error(app.isPackaged?'This installation is missing its rendering bundle. Reinstall a complete Figjam build.':'Build the shared composition with pnpm exec tsx scripts/build-remotion.ts before exporting.');
 const browserExecutable=existsSync(paths.browser)?paths.browser:undefined;if(app.isPackaged&&!browserExecutable)throw new Error('This installation is missing the offline rendering browser.');const inputProps={timeline:state.timeline,footage:state.footage,media,audioMedia:server.audioMedia,exporting:true,engineBase:server.engineBase};
 // 3D engine scenes need WebGL in the export browser; the working backend is found on the first such export.
 await withWebGl(app.getPath('userData'),usesWebGl(state.timeline,state.footage.assets),async gl=>{const chromiumOptions=gl?{gl}:{};const composition=await selectComposition({serveUrl,id:'Dream',inputProps,browserExecutable,binariesDirectory,chromiumOptions});
  const browserExport=()=>renderMedia({serveUrl,composition,inputProps,chromiumOptions,codec:video?.codec==='hevc'?'h265':'h264',...(video?{scale:video.width/width,crf:{lower:24,recommended:18,higher:15}[video.quality]+(video.codec==='hevc'?4:0)}:{}),...frameFormat(),colorSpace:'bt709',outputLocation:temp,browserExecutable,binariesDirectory,cancelSignal,concurrency:renderConcurrency(),onProgress:p=>publish('export.progress',{status:'rendering',progress:p.progress,phase:'Rendering video and audio'})});
  if(process.env.DREAM_EXPORT==='browser')return void await browserExport();
  // Footage is rendered by ffmpeg straight from the sources; only the parts only the browser can draw go through it, without
  // captions (they are drawn over the whole video afterwards), and graphics over footage come from it as a transparent layer.
  // Should the native path fail, the browser renders it all.
  // (A composition renders with the props it was selected with, so each layer is selected with its own.)
  const workDir=`${temp}.work`,layers=new Map<string,Promise<{props:typeof inputProps;composition:typeof composition}>>();
  const layerComposition=(layer:'all'|'overlays')=>{if(!layers.has(layer))layers.set(layer,(async()=>{const l=browserLayer(state.timeline,layer),props={...inputProps,timeline:l.timeline,transparentBackground:l.transparentBackground};return{props,composition:await selectComposition({serveUrl,id:'Dream',inputProps:props,browserExecutable,binariesDirectory,chromiumOptions})};})());return layers.get(layer)!;};
  try{await exportNative({ffmpeg:paths.ffmpeg,timeline:state.timeline,footage:state.footage,output:temp,workDir,signal:nativeAbort.signal,video,container:settings?.format,
    renderBrowser:async(from,to,file,layer)=>{const {props,composition:selected}=await layerComposition(layer);await renderMedia({serveUrl,composition:selected,inputProps:props,chromiumOptions,...browserLayer(state.timeline,layer).render,muted:true,outputLocation:file,browserExecutable,binariesDirectory,cancelSignal,concurrency:renderConcurrency(),frameRange:[from,to-1]});},
    onProgress:(done,total,phase)=>publish('export.progress',{status:'rendering',progress:done/total,phase})});}
  // A full drive is not retried in the browser, which needs more space still; any other failure is, and if that fails too
  // the first error is reported with it.
  catch(error){if(nativeAbort.signal.aborted)throw error;const native=error as Error&{code?:string};if(native.code==='ENOSPC'||/ENOSPC|no space left|not enough space|disk (is )?full/i.test(native.message))throw native;
   console.error('Native export failed; rendering with the browser instead.',error);if(existsSync(temp))unlinkSync(temp);
   try{await browserExport();}catch(browser){throw new Error(`${(browser as Error).message} (The faster export failed first: ${native.message.split('\n')[0].slice(0,300)})`);}}
  finally{rmSync(workDir,{recursive:true,force:true});}
 });await validateExport(temp,paths.ffprobe,resolve(state.timeline,state.footage).durationSec,state.timeline.settings.fps);
 // The finished mix is brought to the standard online level; the picture is copied untouched.
 publish('export.progress',{status:'rendering',progress:1,phase:'Balancing the sound'});await normalizeLoudness(paths.ffmpeg,temp,options?.signal);renameSync(temp,destination);
 // The sound as its own file too, from the same mix.
 if(audioPath){publish('export.progress',{status:'rendering',progress:1,phase:'Saving the audio'});authorize?.(audioPath);await exportAudio({ffmpeg:paths.ffmpeg,timeline:state.timeline,footage:state.footage,workDir:`${audioPath}.work`,signal:options?.signal},audioPath,settings!.audioFormat);}
 const paths_=[destination,...(audioPath?[audioPath]:[])];publish('export.progress',{status:'completed',progress:1,path:destination,paths:paths_});return {path:destination,paths:paths_};
}catch(error){if(existsSync(temp))unlinkSync(temp);publish('export.progress',{status:'failed',progress:0,error:(error as Error).message});throw error;}finally{options?.signal?.removeEventListener('abort',stop);cancel=undefined;await server.close();}}
export function cancelExport(){cancel?.();}

/** Audio only, as CapCut exports it: the mix, levelled, in the chosen format, with no picture drawn. */
async function exportSoundOnly(state:ProjectState,publish:(type:string,payload:unknown)=>void,path:string,settings:ExportSettings,authorize?:(path:string)=>void,options?:{signal?:AbortSignal;read?:(path:string)=>void}){
 const abort=new AbortController(),stop=()=>abort.abort();cancel=stop;options?.signal?.addEventListener('abort',stop,{once:true});authorize?.(path);
 try{publish('export.progress',{status:'rendering',progress:.5,phase:'Mixing the sound'});
  if(!await exportAudio({ffmpeg:runtimePaths().ffmpeg,timeline:state.timeline,footage:state.footage,workDir:`${path}.work`,signal:abort.signal},path,settings.audioFormat))throw new Error('This edit has no sound to export.');
  publish('export.progress',{status:'completed',progress:1,path,paths:[path]});return{path,paths:[path]};}
 catch(error){if(existsSync(path))unlinkSync(path);publish('export.progress',{status:abort.signal.aborted?'cancelled':'failed',progress:0,error:(error as Error).message});throw error;}
 finally{options?.signal?.removeEventListener('abort',stop);cancel=undefined;}
}

async function validateExport(path:string,ffprobe:string,duration:number,fps:number){
 const info=await new Promise<string>((resolve,reject)=>{const child=spawn(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{windowsHide:true});let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error('Export validation failed.')));});
 const probe=JSON.parse(info);if(!probe.streams?.some((s:any)=>s.codec_type==='video')||Math.abs(Number(probe.format?.duration)-duration)>Math.max(2/fps,.1))throw new Error('Rendered output does not match the selected timeline duration.');
}

export function exportProject(...args:Parameters<typeof exportProjectUnlocked>){return withExportLock(()=>exportProjectUnlocked(...args));}
