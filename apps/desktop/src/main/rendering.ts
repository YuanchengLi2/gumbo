import {frameFormat,renderConcurrency} from './render-settings';
import {withExportLock} from './export-lock';
import {renderServer} from './render-server';
import {withWebGl,usesWebGl} from './gl-preflight';
import {normalizeLoudness} from './export-loudness';
import {exportNative,browserLayer} from './native-export';
import {app,dialog,BrowserWindow} from 'electron';import {randomUUID} from 'node:crypto';import {existsSync,renameSync,unlinkSync,rmSync} from 'node:fs';import {join} from 'node:path';import {renderMedia,selectComposition,makeCancelSignal} from '@remotion/renderer';import {resolve} from '@dream/timeline';import type {ProjectState} from '@dream/project-db';import {runtimePaths,compositorDirectory} from './resources';import {spawn} from 'node:child_process';
let cancel:undefined|(()=>void);
async function exportProjectUnlocked(state:ProjectState,window:BrowserWindow,publish:(type:string,payload:unknown)=>void,authorize?:(path:string)=>void,options?:{destination?:string;signal?:AbortSignal;read?:(path:string)=>void}){if(cancel)throw new Error('An export is already running.');options?.signal?.throwIfAborted();if(resolve(state.timeline,state.footage).durationInFrames<1)throw new Error('Add footage to the timeline before exporting.');const missing=state.footage.assets.filter(a=>a.missing&&(state.timeline.spine.some(c=>c.assetId===a.id)||state.timeline.attached.some(i=>i.source?.assetId===a.id)||state.timeline.music.some(m=>m.assetId===a.id)));if(missing.length)throw new Error(`Relink ${missing.map(a=>a.filename).join(', ')} for an original-quality export.`);const used=new Set([...state.timeline.spine.map(c=>c.assetId),...state.timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...state.timeline.music.map(m=>m.assetId)]);for(const asset of state.footage.assets)if(used.has(asset.id))options?.read?.(asset.originalPath);const picked=options?.destination?{canceled:false,filePath:options.destination}:await dialog.showSaveDialog(window,{title:'Export video',defaultPath:join(state.meta.folder,'Exports',`${state.meta.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,100)||'Dream video'}.mp4`),filters:[{name:'MP4 video',extensions:['mp4']}]});if(picked.canceled||!picked.filePath)return null;authorize?.(picked.filePath);const destination=picked.filePath,temp=`${destination}.${randomUUID()}.tmp.mp4`;
const server=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),options?.read,{engineRuntime:join(runtimePaths().staged,'engine')});const media=server.media;const paths=runtimePaths();const binariesDirectory=compositorDirectory();const {cancel:cancelBrowser,cancelSignal}=makeCancelSignal(),nativeAbort=new AbortController(),stop=()=>{cancelBrowser();nativeAbort.abort();};cancel=stop;options?.signal?.addEventListener('abort',stop,{once:true});try{
 const serveUrl=paths.renderBundle;if(!existsSync(join(serveUrl,'index.html')))throw new Error(app.isPackaged?'This installation is missing its rendering bundle. Reinstall a complete Dream build.':'Build the shared composition with pnpm exec tsx scripts/build-remotion.ts before exporting.');
 const browserExecutable=existsSync(paths.browser)?paths.browser:undefined;if(app.isPackaged&&!browserExecutable)throw new Error('This installation is missing the offline rendering browser.');const inputProps={timeline:state.timeline,footage:state.footage,media,audioMedia:server.audioMedia,exporting:true,engineBase:server.engineBase};
 // 3D engine scenes need WebGL in the export browser; the working backend is found on the first such export.
 await withWebGl(app.getPath('userData'),usesWebGl(state.timeline,state.footage.assets),async gl=>{const chromiumOptions=gl?{gl}:{};const composition=await selectComposition({serveUrl,id:'Dream',inputProps,browserExecutable,binariesDirectory,chromiumOptions});
  const browserExport=()=>renderMedia({serveUrl,composition,inputProps,chromiumOptions,codec:'h264',...frameFormat(),colorSpace:'bt709',outputLocation:temp,browserExecutable,binariesDirectory,cancelSignal,concurrency:renderConcurrency(),onProgress:p=>publish('export.progress',{status:'rendering',progress:p.progress,phase:'Rendering video and audio'})});
  if(process.env.DREAM_EXPORT==='browser')return void await browserExport();
  // Footage is rendered by ffmpeg straight from the sources; only the parts only the browser can draw go through it, without
  // captions (they are drawn over the whole video afterwards), and graphics over footage come from it as a transparent layer.
  // Should the native path fail, the browser renders it all.
  // (A composition renders with the props it was selected with, so each layer is selected with its own.)
  const workDir=`${temp}.work`,layers=new Map<string,Promise<{props:typeof inputProps;composition:typeof composition}>>();
  const layerComposition=(layer:'all'|'overlays')=>{if(!layers.has(layer))layers.set(layer,(async()=>{const l=browserLayer(state.timeline,layer),props={...inputProps,timeline:l.timeline,transparentBackground:l.transparentBackground};return{props,composition:await selectComposition({serveUrl,id:'Dream',inputProps:props,browserExecutable,binariesDirectory,chromiumOptions})};})());return layers.get(layer)!;};
  try{await exportNative({ffmpeg:paths.ffmpeg,timeline:state.timeline,footage:state.footage,output:temp,workDir,signal:nativeAbort.signal,
    renderBrowser:async(from,to,file,layer)=>{const {props,composition:selected}=await layerComposition(layer);await renderMedia({serveUrl,composition:selected,inputProps:props,chromiumOptions,...browserLayer(state.timeline,layer).render,muted:true,outputLocation:file,browserExecutable,binariesDirectory,cancelSignal,concurrency:renderConcurrency(),frameRange:[from,to-1]});},
    onProgress:(done,total,phase)=>publish('export.progress',{status:'rendering',progress:done/total,phase})});}
  catch(error){if(nativeAbort.signal.aborted)throw error;console.error('Native export failed; rendering with the browser instead.',error);if(existsSync(temp))unlinkSync(temp);await browserExport();}
  finally{rmSync(workDir,{recursive:true,force:true});}
 });await validateExport(temp,paths.ffprobe,resolve(state.timeline,state.footage).durationSec,state.timeline.settings.fps);
 // The finished mix is brought to the standard online level; the picture is copied untouched.
 publish('export.progress',{status:'rendering',progress:1,phase:'Balancing the sound'});await normalizeLoudness(paths.ffmpeg,temp,options?.signal);renameSync(temp,destination);publish('export.progress',{status:'completed',progress:1,path:destination});return {path:destination};
}catch(error){if(existsSync(temp))unlinkSync(temp);publish('export.progress',{status:'failed',progress:0,error:(error as Error).message});throw error;}finally{options?.signal?.removeEventListener('abort',stop);cancel=undefined;await server.close();}}
export function cancelExport(){cancel?.();}

async function validateExport(path:string,ffprobe:string,duration:number,fps:number){
 const info=await new Promise<string>((resolve,reject)=>{const child=spawn(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{windowsHide:true});let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error('Export validation failed.')));});
 const probe=JSON.parse(info);if(!probe.streams?.some((s:any)=>s.codec_type==='video')||Math.abs(Number(probe.format?.duration)-duration)>Math.max(2/fps,.1))throw new Error('Rendered output does not match the selected timeline duration.');
}

export function exportProject(...args:Parameters<typeof exportProjectUnlocked>){return withExportLock(()=>exportProjectUnlocked(...args));}
