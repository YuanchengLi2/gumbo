import {readdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,extname,basename,parse} from 'node:path';
import {mediaFacts} from '../../../../packages/footage/src/capture-time';

export const mediaKinds:Record<'video'|'image'|'audio',string[]>={
 video:['.mp4','.mov','.m4v','.webm','.mkv','.avi','.mts','.m2ts','.3gp','.mpg','.mpeg','.wmv','.mxf'],
 image:['.jpg','.jpeg','.png','.webp','.heic','.heif','.avif','.gif','.dng','.tif','.tiff'],
 audio:['.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus']
};
const kindOf=(path:string)=>{const extension=extname(path).toLowerCase();return(Object.keys(mediaKinds) as ('video'|'image'|'audio')[]).find(kind=>mediaKinds[kind].includes(extension));};
const skip=new Set(['node_modules','$recycle.bin','system volume information','appdata','.git','.cache','thumbnails','.thumbnails','cache']);

export type MediaFolder={name:string;path:string;exists:boolean;removable?:boolean};
/** Where phones, cameras and screen recorders usually put new media on this computer. Phones connected over MTP are
 * not file paths and cannot be listed; their photos appear here once synced or imported (for example to Camera Roll). */
export function familiarMediaFolders(paths:{home:string;pictures:string;videos:string;downloads:string;desktop:string},env:Record<string,string|undefined>=process.env,drives:string[]=[]):MediaFolder[]{
 const oneDrive=[env.OneDrive,env.OneDriveConsumer,env.OneDriveCommercial].filter((p):p is string=>!!p);
 const folders:{name:string;path:string;removable?:boolean}[]=[
  {name:'Camera Roll',path:join(paths.pictures,'Camera Roll')},
  ...oneDrive.flatMap(root=>[{name:'OneDrive Camera Roll',path:join(root,'Pictures','Camera Roll')},{name:'OneDrive Camera imports',path:join(root,'Pictures','Camera imports')}]),
  {name:'iCloud Photos',path:join(paths.pictures,'iCloud Photos','Photos')},{name:'iCloud Photos',path:join(paths.home,'iCloudPhotos')},
  {name:'Screenshots',path:join(paths.pictures,'Screenshots')},
  {name:'Videos',path:paths.videos},{name:'Captures',path:join(paths.videos,'Captures')},
  {name:'Pictures',path:paths.pictures},{name:'Downloads',path:paths.downloads},{name:'Desktop',path:paths.desktop},
  // Memory cards and cameras mounted as drives keep their media in DCIM.
  ...drives.filter(drive=>parse(drive).root.toLowerCase()!==parse(paths.home).root.toLowerCase()).map(drive=>({name:`${drive.replace(/[\\/]+$/,'')} camera card`,path:join(drive,'DCIM'),removable:true}))
 ];
 const seen=new Set<string>();
 return folders.filter(folder=>{const key=folder.path.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).map(folder=>({...folder,exists:existsSync(folder.path)}));
}

export type FindMediaRequest={when?:'today'|'yesterday'|'this_week'|'last_7_days';from?:string;to?:string;kinds?:('video'|'image'|'audio')[];query?:string;minDurationSec?:number;sort?:'captured'|'modified'|'name';limit?:number};
export type MediaEntry={path:string;name:string;kind:'video'|'image'|'audio';capturedAt?:string;capturedAtSource?:string;modifiedAt:string;sizeMB:number;durationSec?:number;width?:number;height?:number};
export type MediaCatalog={media:MediaEntry[];scanned:number;matched:number;truncated:boolean;window?:{from:string;to:string};now:string;timeZone:string;folders:{name:string;path:string}[]};

/** The local-time window a request means: today, yesterday, this week (from Monday) or the last 7 days. */
export function mediaWindow(request:FindMediaRequest,now=new Date()):{from:Date;to:Date}|undefined{
 if(request.from||request.to)return{from:request.from?new Date(request.from):new Date(0),to:request.to?new Date(request.to):now};
 if(!request.when)return;const midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=86_400_000;
 if(request.when==='today')return{from:midnight,to:new Date(midnight.getTime()+day)};
 if(request.when==='yesterday')return{from:new Date(midnight.getTime()-day),to:midnight};
 if(request.when==='this_week'){const monday=new Date(midnight.getTime()-((midnight.getDay()+6)%7)*day);return{from:monday,to:new Date(midnight.getTime()+day)};}
 return{from:new Date(midnight.getTime()-6*day),to:new Date(midnight.getTime()+day)};
}

/** Scans folders for media in a time window, reads each candidate's capture time from its own metadata, and returns a
 * compact catalog sorted by capture time. Files outside a two-day margin of the window are skipped by modification
 * time before any metadata is read; the scan stops after 5000 files or 8 seconds and says so. */
export async function findMedia(folders:{name:string;path:string}[],request:FindMediaRequest,signal?:AbortSignal,now=new Date()):Promise<MediaCatalog>{
 const window=mediaWindow(request,now),margin=2*86_400_000,kinds=new Set(request.kinds?.length?request.kinds:['video','image','audio']),query=request.query?.toLowerCase(),limit=Math.min(200,request.limit??100);
 const started=Date.now(),found:MediaEntry[]=[],seen=new Set<string>();let scanned=0,truncated=false;
 const queue=folders.map(folder=>({path:folder.path,depth:0}));
 while(queue.length){
  signal?.throwIfAborted();if(scanned>=5000||Date.now()-started>8000){truncated=true;break;}
  const {path,depth}=queue.shift()!;let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{continue;}
  for(const entry of entries){
   if(entry.isSymbolicLink())continue;const target=join(path,entry.name);
   if(entry.isDirectory()){if(depth<5&&!entry.name.startsWith('.')&&!skip.has(entry.name.toLowerCase()))queue.push({path:target,depth:depth+1});continue;}
   const kind=kindOf(target);if(!kind||!kinds.has(kind))continue;if(query&&!entry.name.toLowerCase().includes(query))continue;
   const key=target.toLowerCase();if(seen.has(key))continue;seen.add(key);scanned++;
   let info;try{info=await stat(target);}catch{continue;}
   const newest=Math.max(info.mtimeMs,info.birthtimeMs||0),oldest=Math.min(info.mtimeMs,info.birthtimeMs||info.mtimeMs);
   if(window&&(oldest>window.to.getTime()+margin||newest<window.from.getTime()-margin))continue;
   const facts=mediaFacts(target),captured=facts.capturedAt?Date.parse(facts.capturedAt):info.mtimeMs;
   if(window&&(captured<window.from.getTime()||captured>=window.to.getTime()))continue;
   if(request.minDurationSec&&facts.durationSec!==undefined&&facts.durationSec<request.minDurationSec)continue;
   found.push({path:target,name:basename(target),kind,...(facts.capturedAt?{capturedAt:facts.capturedAt,capturedAtSource:facts.capturedAtSource}:{}),modifiedAt:info.mtime.toISOString(),sizeMB:Math.round(info.size/1048576*10)/10,...(facts.durationSec!==undefined?{durationSec:facts.durationSec}:{}),...(facts.width?{width:facts.width,height:facts.height}:{})});
  }
 }
 const sort=request.sort??'captured';
 found.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='modified'?a.modifiedAt.localeCompare(b.modifiedAt):(a.capturedAt??a.modifiedAt).localeCompare(b.capturedAt??b.modifiedAt));
 return{media:found.slice(0,limit),scanned,matched:found.length,truncated:truncated||found.length>limit,...(window?{window:{from:window.from.toISOString(),to:window.to.toISOString()}}:{}),now:now.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,folders};
}
