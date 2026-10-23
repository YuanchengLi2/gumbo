/// <reference lib="webworker" />
import {deliver} from './globals';
import type {Asset} from '@dream/footage';
import {connectFs,mkdirSync,existsSync,rmSync} from './fs/sync-fs';
import {initSqlite} from './shims/better-sqlite3';
import {connectPrograms} from './shims/child-process';
import {startHost,host,hostUpdate} from './host';
import {syncRoutes} from './routes';

/** The project worker: Gumbo's project service (apps/project-service/src/main.ts, unchanged) in the browser. It starts
 * the storage worker (synchronous files over OPFS) and the media worker (ffmpeg and ffprobe's commands), opens SQLite,
 * then loads the service. Messages: {boot:{env}} first; {host:{id,action,args}} for the project list; anything else is
 * the service's own protocol (commands, connection and file answers), as the desktop's utility process receives it. */
const post=(message:unknown)=>(self as unknown as Worker).postMessage(message);
let booted:Promise<void>|undefined,openFolder:string|undefined;
/** One project service per browser: SQLite's files open in one place only. The lock lives as long as this worker, so a
 * reloaded page's new worker waits for the old one to stop, and a second tab waits until the first closes. */
function exclusive(){
 return new Promise<void>(resolve=>{
  const hold=()=>{resolve();return new Promise<never>(()=>{});};
  void navigator.locks.request('gumbo-project-service',{ifAvailable:true},lock=>{if(lock)return hold();post({waiting:'another-tab'});void navigator.locks.request('gumbo-project-service',hold);return undefined;});
 });
}
/** Footage dropped or picked waits in /imports (bridge/imports.ts) until it is imported; once the project holds its own
 * copy, the waiting one is removed, so the browser's storage keeps the footage once. */
function releaseStaged(assets:Asset[]){
 for(const asset of assets){const from=asset.source?.path;if(!from?.startsWith('/imports/')||asset.originalPath===from)continue;const folder=from.slice(0,from.lastIndexOf('/'));if(existsSync(folder))rmSync(folder,{recursive:true,force:true});}
}
async function boot(env:Record<string,string>){
 await exclusive();
 Object.assign(process.env,{DREAM_FFMPEG:'ffmpeg',DREAM_FFPROBE:'ffprobe',DREAM_INGEST_BINARY:'',DREAM_WHISPER_BINARY:'',DREAM_WHISPER_MODEL:'',...env});
 await connectFs(new Worker(new URL('./fs/storage.worker.ts',import.meta.url),{type:'module'}));
 connectPrograms(new Worker(new URL('./media/media.worker.ts',import.meta.url),{type:'module'}));
 await initSqlite();
 for(const folder of ['/tmp','/profile','/Dream/Projects'])mkdirSync(folder,{recursive:true});
 startHost();
 const send=(process as any).parentPort.postMessage.bind((process as any).parentPort);
 // States it reports also refresh the project list and the service worker's media routes (routes.ts), before they leave:
 // the editor asks for the media as soon as it sees them. Messages keep their order (state deltas are numbered).
 let outgoing=Promise.resolve();
 (process as any).parentPort.postMessage=(message:any)=>{
  const state=message?.result?.timeline?message.result:message?.event?.type==='state'?message.event.payload:undefined;if(state?.meta){openFolder=state.meta.folder;hostUpdate(state);}
  const footage=state?.footage??(message?.event?.type==='state.delta'?message.event.payload?.changes?.footage:undefined);
  if(footage?.assets)releaseStaged(footage.assets);
  outgoing=outgoing.then(async()=>{if(footage?.assets)await syncRoutes(footage.assets);send(message);});};
 await import('../../../project-service/src/main');
}
self.onmessage=async(event:MessageEvent)=>{
 const data=event.data;
 if(data?.boot){booted??=boot(data.boot.env??{});try{await booted;post({booted:true});}catch(error){post({bootError:String((error as Error)?.stack??error)});}return;}
 await booted;
 if(data?.host){const {id,action,args}=data.host;try{post({hostResult:{id,result:host(action,args,openFolder)}});}catch(error){post({hostResult:{id,error:(error as Error).message}});}return;}
 deliver(data);
};
