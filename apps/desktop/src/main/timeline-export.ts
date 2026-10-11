import {frameFormat,renderConcurrency} from './render-settings';
import {withExportLock} from './export-lock';
import {authoredFiles,workspacePath,digest} from '../../../../packages/project-db/src/workspace-store';
import {readFileSync} from 'node:fs';
import {audioManifest,audioAutomation,type AudioSegment} from '../../../../packages/composition/src/audio-manifest';
import {dialog,type BrowserWindow} from 'electron';
import {copyFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename,dirname,join,resolve as resolvePath,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolve,type TimelineDocument} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import type {Asset} from '@dream/footage';
import {renderMedia,selectComposition,makeCancelSignal} from '@remotion/renderer';
import {runtimePaths,compositorDirectory} from './resources';
import {renderServer} from './render-server';
import {timelineXML,type ExchangeClip} from './timeline-xml';
import {copyMedia} from '../../../project-service/src/media-io';
import {run} from '../../../project-service/src/media';

let controller:AbortController|undefined;
export const cancelTimelineExport=()=>controller?.abort();
export const timelineExportRunning=()=>!!controller;
const safe=(name:string)=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,100)||'Dream';

async function exportEditableTimelineUnlocked(state:ProjectState,window:BrowserWindow,publish:(type:string,payload:unknown)=>void,authorize:(path:string,write?:boolean)=>void){
 if(controller)throw new Error('An editable export is already running.');
 const timeline=state.timeline,resolved=resolve(timeline,state.footage),fps=timeline.settings.fps;
 if(!resolved.durationInFrames)throw new Error('Add media to the timeline before exporting.');
 const picked=await dialog.showSaveDialog(window,{title:'Export editable timeline',defaultPath:join(state.meta.folder,'Exports',safe(state.meta.name)+'.xml'),filters:[{name:'Premiere / Resolve timeline',extensions:['xml']}]});
 if(picked.canceled||!picked.filePath)return null;
 const destination=resolvePath(picked.filePath),parent=dirname(destination),suffix=randomUUID().slice(0,8),assetsName=safe(basename(destination,'.xml'))+' Media '+suffix,finalAssets=join(parent,assetsName),staging=join(parent,'.dream-export-'+suffix);
 authorize(destination,true);authorize(finalAssets,true);controller=new AbortController();const signal=controller.signal;
 const paths=runtimePaths(),clips:ExchangeClip[]=[],copies=new Map<string,string>();let server:Awaited<ReturnType<typeof renderServer>>|undefined;
 const warnings=new Set<string>();let completed=0,published=false;const xmlTemporary=destination+'.'+suffix+'.tmp';
 const total=resolved.clips.length+resolved.items.length+audioManifest(timeline,state.footage,true).length+(timeline.captions?1:0);
 const progress=(phase:string)=>publish('export.progress',{status:'rendering',progress:Math.min(.95,completed/Math.max(1,total)),phase});
 const source=(id:string)=>{const asset=state.footage.assets.find(a=>a.id===id);if(!asset)throw new Error('A timeline source is missing.');return asset;};
 const copy=async(path:string)=>{signal.throwIfAborted();authorize(path);const cached=copies.get(path);if(cached)return cached;if(!existsSync(path))throw new Error('Relink '+basename(path)+' before exporting.');const name=copies.size+'-'+safe(basename(path));await copyMedia(path,join(staging,name),signal);copies.set(path,join(finalAssets,name));return join(finalAssets,name);};
 const render=async(t:TimelineDocument,name:string,start:number,end:number,alpha=false)=>{
  signal.throwIfAborted();progress('Preparing '+name);
  server??=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),path=>authorize(path),{engineRuntime:join(paths.staged,'engine')});
  const props={timeline:t,footage:state.footage,media:server.media,audioMedia:server.audioMedia,exporting:true,transparentBackground:alpha,engineBase:server.engineBase};
  const options={serveUrl:paths.renderBundle,id:'Dream',inputProps:props,browserExecutable:existsSync(paths.browser)?paths.browser:undefined,binariesDirectory:compositorDirectory()};
  const composition=await selectComposition(options),cancel=makeCancelSignal();const stop=()=>cancel.cancel();signal.addEventListener('abort',stop,{once:true});
  try{await renderMedia({...options,composition,inputProps:props,outputLocation:join(staging,name),codec:alpha?'prores':'h264',...(alpha?{proResProfile:'4444' as const,pixelFormat:'yuva444p10le' as const}:{}),...frameFormat(alpha),muted:true,frameRange:[Math.round(start*fps),Math.max(Math.round(start*fps),Math.round(end*fps)-1)],cancelSignal:cancel.cancelSignal,concurrency:renderConcurrency()});}finally{signal.removeEventListener('abort',stop);}
  return join(finalAssets,name);
 };
 const visualBase={...timeline,trackSettings:{...timeline.trackSettings,video:{...timeline.trackSettings?.video,hidden:false}},captions:undefined,music:[],attached:timeline.attached.filter(i=>i.type==='effect')};
 const visual=(id:string,name:string,path:string,track:string,start:number,end:number,inSec:number,outSec:number,asset?:Asset,enabled=true):ExchangeClip=>({id,name,path,kind:'video',track,start,end,sourceIn:inSec,sourceOut:outSec,sourceDuration:asset?.durationSec??end-start,sourceFps:asset?.fps||fps,width:asset?.width||timeline.settings.width,height:asset?.height||timeline.settings.height,enabled});
 const audio=async(segment:AudioSegment)=>{
  const asset=source(segment.assetId),id=segment.id,track=segment.trackName!,start=segment.startSample/48000,end=start+segment.durationSamples/48000,speed=segment.speed,gainDb=segment.gainDb,fadeInSec=segment.fadeInSamples/48000,fadeOutSec=segment.fadeOutSamples/48000,enabled=segment.enabled!==false;let inSec=segment.sourceStartSample/48000,outSec=inSec+(end-start)*speed;
  const audioSource=asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath;authorize(audioSource);let path=await copy(audioSource),duration=asset.durationSec;
  if(speed!==1||!asset.audioPath){const name=safe(id)+'-audio.wav';const factors:number[]=[];let remaining=speed;while(remaining>2){factors.push(2);remaining/=2;}while(remaining<.5){factors.push(.5);remaining/=.5;}factors.push(remaining);const tempo=factors.map(n=>'atempo='+n).join(',');await run(paths.ffmpeg,['-y','-ss',String(inSec),'-t',String(outSec-inSec),'-i',audioSource,'-vn','-af',tempo,'-ar','48000','-ac','2','-c:a','pcm_s16le',join(staging,name)],signal);path=join(finalAssets,name);inSec=0;outSec=end-start;duration=outSec;}
  clips.push({id:id+'-audio',name:asset.filename,path,kind:'audio',track,start,end,sourceIn:inSec,sourceOut:outSec,sourceDuration:duration,sourceFps:fps,width:0,height:0,enabled,gainDb,fadeInSec,fadeOutSec,trackId:segment.trackId,trackOrder:segment.trackOrder,linkGroup:id,automation:audioAutomation(segment,resolved.words,fps)});
 };
 try{
  await mkdir(staging,{recursive:false});
  for(const c of resolved.clips){
   const asset=source(c.assetId);progress('Copying '+asset.filename);const original=await copy(asset.originalPath);
   if(asset.kind!=='audio'){
    const bake=!!asset.scene||!!asset.sequence||asset.width*timeline.settings.height!==asset.height*timeline.settings.width||c.speed!==1||!!c.framing||!!c.transitionIn&&c.transitionIn.type!=='cut'||!!resolved.clips[resolved.clips.indexOf(c)+1]?.transitionIn&&resolved.clips[resolved.clips.indexOf(c)+1].transitionIn!.type!=='cut'||resolved.items.some(i=>i.type==='effect'&&i.timelineStart<c.end&&i.timelineEnd>c.start);
    const path=bake?await render(visualBase,safe(c.id)+'.mp4',c.start,c.end):original;
    if(bake)warnings.add('Generated scenes, framing, effects, transitions and speed changes are rendered into individual video clips. Their positions and cuts remain editable; original media is also included.');
    clips.push({...visual(c.id,asset.filename,path,timeline.trackSettings?.video?.name??'Video',c.start,c.end,bake?0:c.srcIn,bake?c.end-c.start:c.srcOut,bake?undefined:asset,!timeline.trackSettings?.video?.hidden),trackId:'video',trackOrder:0,linkGroup:c.id});
   }
   completed++;
  }
  for(const item of resolved.items){
   if(item.timelineEnd<=item.timelineStart){completed++;continue;}
   const trackKey=(item.type==='sfx'?'audio:':'visual:')+item.layer,track=timeline.trackSettings?.[trackKey];
   if(item.type!=='sfx'&&item.type!=='effect'){
    const t={...timeline,spine:[],music:[],captions:undefined,settings:{...timeline.settings,durationSec:resolved.durationSec},attached:[{...item,start:{kind:'project' as const,at:'start' as const,offsetSec:item.timelineStart},end:undefined,durationSec:item.timelineEnd-item.timelineStart}],trackSettings:{}};
    const asset=item.source?source(item.source.assetId):undefined,p=item.params;const direct=asset&&!asset.scene&&!asset.sequence&&item.timelineEnd-item.timelineStart<=item.source!.srcOut-item.source!.srcIn+.001&&Number(p.opacity??1)===1&&Number(p.scale??1)===1&&Number(p.rotation??0)===0&&Number(p.x??.5)===.5&&Number(p.y??.5)===.5&&asset.width*timeline.settings.height===asset.height*timeline.settings.width;const path=direct?await copy(asset.originalPath):await render(t,safe(item.id)+'.mov',item.timelineStart,item.timelineEnd,true);
    clips.push({...visual(item.id,asset?.filename??String(item.params.text??item.component),path,track?.name??'Visual '+(item.layer+1),item.timelineStart,item.timelineEnd,direct?item.source!.srcIn:0,direct?item.source!.srcIn+item.timelineEnd-item.timelineStart:item.timelineEnd-item.timelineStart,direct?asset:undefined,!track?.hidden),trackId:trackKey,trackOrder:10+item.layer,linkGroup:item.id});
    if(!direct)warnings.add('Graphics are separate transparent ProRes clips, so layers and timing remain editable. Their internal animation is baked.');
   }
   completed++;
  }
  for(const segment of audioManifest(timeline,state.footage,true)){progress('Preparing '+segment.trackName);await audio(segment);completed++;}
  if(timeline.captions&&resolved.words.length){
   const t={...timeline,spine:timeline.spine,attached:[],music:[],trackSettings:{...timeline.trackSettings,video:{hidden:true},captions:{hidden:false}}};
   const path=await render(t,'Captions.mov',0,resolved.durationSec,true);clips.push({...visual('captions','Captions',path,'Captions',0,resolved.durationSec,0,resolved.durationSec,undefined,!timeline.trackSettings?.captions?.hidden),trackId:'captions',trackOrder:100000});
   const time=(sec:number)=>{const ms=Math.round(sec*1000);return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+','+String(ms%1000).padStart(3,'0');};
   await writeFile(join(staging,'Captions.srt'),resolved.words.map((w,i)=>String(i+1)+'\n'+time(w.start)+' --> '+time(w.end)+'\n'+w.text+'\n').join('\n'));
   warnings.add('Captions include a transparent appearance layer and an editable SRT file. Disable the appearance layer when importing the SRT to avoid duplicate captions.');completed++;
  }
  await writeFile(join(staging,'README.txt'),'Import the XML into Premiere Pro or DaVinci Resolve. Keep this media folder with it. If moved to another computer, relink to this folder.\n\n'+[...warnings].join('\n'));
  await writeFile(join(staging,'Dream-timeline.json'),JSON.stringify({schemaVersion:1,timeline:state.timeline,clips},null,2));
  const sourceRoot=join(state.meta.folder,'Workspace'),sourceManifest:Record<string,string>={};
  for(const file of authoredFiles(sourceRoot)){const input=workspacePath(sourceRoot,file),output=workspacePath(join(staging,'Source'),file);authorize(input);await mkdir(dirname(output),{recursive:true});await copyFile(input,output);sourceManifest[file]=digest(readFileSync(input));}
  await writeFile(join(staging,'Source-manifest.json'),JSON.stringify({versionId:state.versionId,files:sourceManifest,outputs:clips.map(c=>({id:c.id,path:c.path,track:c.track}))},null,2));
  progress('Writing editable timeline');signal.throwIfAborted();await rename(staging,finalAssets);await writeFile(xmlTemporary,timelineXML(state.meta.name,timeline.settings,resolved.durationSec,clips));await rename(xmlTemporary,destination);published=true;
  publish('export.progress',{status:'completed',progress:1,path:destination,warnings:[...warnings]});return{path:destination,format:'timeline' as const};
 }catch(error){publish('export.progress',{status:signal.aborted?'cancelled':'failed',progress:0,error:(error as Error).message});throw error;}
 finally{controller=undefined;await server?.close();if(!published){await rm(xmlTemporary,{force:true});const owned=relative(parent,finalAssets);if(!isAbsolute(owned)&&!owned.startsWith('..')&&basename(finalAssets)===assetsName)await rm(finalAssets,{recursive:true,force:true});}const rel=relative(parent,staging);if(!isAbsolute(rel)&&!rel.startsWith('..')&&basename(staging)==='.dream-export-'+suffix)await rm(staging,{recursive:true,force:true});}
}

export function exportEditableTimeline(...args:Parameters<typeof exportEditableTimelineUnlocked>){return withExportLock(()=>exportEditableTimelineUnlocked(...args));}
